// LAND PROTECTION - core: data, prices, real-time timers, permission checks. (No menus here, so every other system can import it safely.)
//
// A protection ("claim") is a box of blocks: 10x10x10, 20x20x20 or 40x40x40, centred on the player who buys it.
// Every size is open for every player (no clan needed). Each player can own DEFAULT_CLAIMS protections; an admin can change that per player.
// It lasts for REAL time (an absolute end date saved with the claim), so it keeps running while the player is offline
// and even while the server is switched off. When the time is over the claim simply disappears.
// Every claim is stored in its own world dynamic property  "pr:<claim id>"  (nothing else in the world data is touched).
import { world, system } from "@minecraft/server";
import { stats, takeMoney, addMoney, allRecords } from "../data.js";
import { buyPrice } from "../priceperks.js";
import { luxProtect } from "../lux.js";
import { staffHook } from "./opcore.js";
import { zoneOverlaps } from "./spawnzone.js";

// ---------------------------------------------------------------- settings you can edit safely
export const SIZES = [
  { key: "s", name: "Small",  w: 10, h: 10, rate: 999 },       // rate = price of ONE hour
  { key: "m", name: "Medium", w: 20, h: 20, rate: 2999 },
  { key: "l", name: "Large",  w: 40, h: 40, rate: 5999 },
];
export const HOUR = 3600000;
export const MAX_HOURS = 24;                                    // the most protection time one claim can hold
export const MAX_MS = MAX_HOURS * HOUR;
export const DEFAULT_CLAIMS = 3;                                // protections every player may own (an admin can give one player more / fewer)
export const MAX_CLAIM_LIMIT = 18;                              // the most an admin can allow for one player (the land menu has room for 18)
export const MAX_TRUSTED = 12;                                  // players you can allow inside one claim
export const BELOW = 0.25;                                      // share of the height that goes BELOW your feet (10 -> 3 blocks under you, 6 above)
export const ADMIN_TAG = "landadmin";                           // players with this tag bypass every protection:  /tag <name> add landadmin
const PFX = "pr:", PEND = "prm:", LIM = "plim:";

export const sizeOf = (key) => SIZES.find((s) => s.key === key) ?? SIZES[0];

// ---------------------------------------------------------------- land prices set by an admin (the same price for EVERY land of a size)
// Saved in one world property "psize" = { s, m, l } (price of ONE hour).  Nothing saved = the default prices above.
// `size.rate` is a getter, so buying, renewing and every menu use the admin price without any other change.
const PRICE_KEY = "psize", MAX_PRICE = 10000000;
const prices = {}, baseRate = {};
let pricesLoaded = false;
function loadPrices() {         // lazy: world data can't be read while the script is starting
  if (pricesLoaded) return;
  try {
    const raw = world.getDynamicProperty(PRICE_KEY);
    pricesLoaded = true;
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      for (const z of SIZES) { const n = Math.floor(Number(v?.[z.key])); if (Number.isFinite(n) && n >= 1 && n <= MAX_PRICE) prices[z.key] = n; }
    }
  } catch (e) { /* unreadable: default prices */ }
}
for (const z of SIZES) {
  baseRate[z.key] = z.rate;
  Object.defineProperty(z, "rate", { get() { loadPrices(); return prices[z.key] ?? baseRate[z.key]; }, enumerable: true });
}
export const defaultRate = (key) => baseRate[key] ?? 0;
export const MAX_LAND_PRICE = MAX_PRICE;
/** v = { s, m, l } (price per hour).  Returns an error text, or null when saved. */
export function setSizePrices(v) {
  const next = {};
  for (const z of SIZES) {
    const n = Math.floor(Number(v?.[z.key]));
    if (!Number.isFinite(n) || n < 1 || n > MAX_PRICE) return "The " + z.name + " price must be a number from 1 to " + MAX_PRICE + ".";
    next[z.key] = n;
  }
  try { world.setDynamicProperty(PRICE_KEY, JSON.stringify(next)); } catch (e) { console.warn("[land] price save failed: " + e); return "Could not save it."; }
  loadPrices(); for (const z of SIZES) prices[z.key] = next[z.key];
  return null;
}
export function resetSizePrices() {
  try { world.setDynamicProperty(PRICE_KEY, undefined); } catch (e) { return "Could not save it."; }
  for (const k of Object.keys(prices)) delete prices[k];
  return null;
}

// ---------------------------------------------------------------- storage
const claims = new Map();        // id -> claim
let loaded = false;
// claim = { id, o: owner id, on: owner name, n: name, s: size key, d: dimension id, x1,y1,z1,x2,y2,z2 (inclusive), e: end time (ms epoch), t: { id: name }, c: created, ord, sp: {x,y,z} }

function load() {                // lazy: world data can't be read while the script is starting
  if (loaded) return;
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(PFX)) continue;
      try { const c = JSON.parse(world.getDynamicProperty(k)); if (c && c.id && c.o) { c.t ??= {}; claims.set(c.id, c); } } catch (e) { /* skip a broken record */ }
    }
    loaded = true;
  } catch (e) { console.warn("[land] load failed: " + e); }
}
const save = (c) => { try { world.setDynamicProperty(PFX + c.id, JSON.stringify(c)); return true; } catch (e) { console.warn("[land] save failed: " + e); return false; } };
const drop = (c) => { try { world.setDynamicProperty(PFX + c.id, undefined); } catch (e) { /* ignore */ } claims.delete(c.id); };

// ---------------------------------------------------------------- time
export const timeLeft = (c) => Math.max(0, c.e - Date.now());
export const active = (c) => c.e > Date.now();
export function dur(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s %= 60;
  if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
  if (m > 0) return m + "m " + String(s).padStart(2, "0") + "s";
  return s + "s";
}

// ---------------------------------------------------------------- lookups
/** every claim whose time is not over (expired ones are removed by the 1-second loop below, but they never protect anything meanwhile) */
export function allClaims() { load(); const out = []; for (const c of claims.values()) if (active(c)) out.push(c); return out; }
export const claimById = (id) => { load(); const c = claims.get(id); return c && active(c) ? c : null; };
export function claimsOf(playerId) { return allClaims().filter((c) => c.o === playerId).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.c - b.c); }
export const sharedWith = (playerId) => allClaims().filter((c) => c.o !== playerId && c.t[playerId]);

// ---------------------------------------------------------------- how many protections a player may own
// Everybody: DEFAULT_CLAIMS.  An admin can change it for one player (Land menu > Protection limits).
// Saved per player: "plim:<player id>" = { n: limit, p: name }.  The default is never saved.  Nothing here is linked to clans.
const DEFLIM = "plimdef";
/** how many protections EVERY player may own (admin setting; nothing saved = DEFAULT_CLAIMS) */
export function defaultLimit() {
  try {
    const raw = world.getDynamicProperty(DEFLIM);
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.min(MAX_CLAIM_LIMIT, Math.floor(raw)));
  } catch (e) { /* unreadable: use the default */ }
  return DEFAULT_CLAIMS;
}
/** the same limit for ALL players at once (it also removes the special per-player limits, so nobody is left out).  Returns an error text, or null. */
export function setDefaultLimit(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > MAX_CLAIM_LIMIT) return "Write a number from 0 to " + MAX_CLAIM_LIMIT + ".";
  try {
    for (const k of world.getDynamicPropertyIds()) if (k.startsWith(LIM)) world.setDynamicProperty(k, undefined);
    world.setDynamicProperty(DEFLIM, n === DEFAULT_CLAIMS ? undefined : n);
    return null;
  } catch (e) { console.warn("[land] default limit save failed: " + e); return "Could not save it."; }
}
export function claimLimit(id) {
  try {
    const raw = world.getDynamicProperty(LIM + id);
    if (typeof raw === "string") { const v = JSON.parse(raw), n = Math.floor(Number(v?.n)); if (Number.isFinite(n)) return Math.max(0, Math.min(MAX_CLAIM_LIMIT, n)); }
  } catch (e) { /* unreadable: use the default */ }
  return defaultLimit();
}
/** returns an error text, or null when it was saved */
export function setClaimLimit(id, name, n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > MAX_CLAIM_LIMIT) return "Write a number from 0 to " + MAX_CLAIM_LIMIT + ".";
  try {
    if (n === defaultLimit()) world.setDynamicProperty(LIM + id, undefined);
    else world.setDynamicProperty(LIM + id, JSON.stringify({ n, p: String(name ?? "").slice(0, 32) }));
    return null;
  } catch (e) { console.warn("[land] limit save failed: " + e); return "Could not save it."; }
}
/** players who have a limit different from the default: [{ id, name, n }] */
export function customLimits() {
  const out = [];
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(LIM)) continue;
      try { const v = JSON.parse(world.getDynamicProperty(k)); const n = Math.floor(Number(v?.n)); if (Number.isFinite(n)) out.push({ id: k.slice(LIM.length), name: String(v.p ?? "?"), n }); } catch (e) { /* skip */ }
    }
  } catch (e) { /* ignore */ }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const inside = (c, x, y, z) => x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2 && z >= c.z1 && z <= c.z2;
/** the active claim that contains this block position (or null) */
export function claimAt(dimId, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  for (const c of allClaims()) if (c.d === dimId && inside(c, x, y, z)) return c;
  return null;
}
/** the active claim within `m` blocks of this position (box grown by m) - used for fluids / fire / pistons close to the border */
export function claimNear(dimId, x, y, z, m, except) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  for (const c of allClaims()) {
    if (c.d !== dimId || c === except) continue;
    if (x >= c.x1 - m && x <= c.x2 + m && y >= c.y1 - m && y <= c.y2 + m && z >= c.z1 - m && z <= c.z2 + m) return c;
  }
  return null;
}
export const isAdmin = (p) => { try { return p.hasTag(ADMIN_TAG); } catch (e) { return false; } };
/** owner or allowed player of this claim */
export const isMember = (c, p) => c.o === p.id || !!c.t[p.id];

// ---------------------------------------------------------------- OWNER LOCK ("supreme protection")
// The server Owner can LOCK a protection: a land (c.k = true), ALL lands at once, or the AFK area.  A locked protection can NOT be broken, bypassed,
// changed or removed by anybody - not by a land owner, not by an Admin, not by an Operator, not even with the "landadmin" bypass tag.  ONLY the Owner can
// go through it, and only the Owner can unlock it.  Saved in ONE world property ("slock:v1" = { afk, all }); a locked land keeps its flag inside its own record.
const LOCK_KEY = "slock:v1";
let lockCfg = null;
function lockState() {
  if (lockCfg) return lockCfg;
  try {
    const raw = world.getDynamicProperty(LOCK_KEY), o = typeof raw === "string" ? JSON.parse(raw) : {};
    lockCfg = { afk: o.afk === true, all: o.all === true };
    return lockCfg;
  } catch (e) { return { afk: false, all: false }; }                // world not ready yet: not cached, asked again next time
}
function lockSave(next) {
  try { world.setDynamicProperty(LOCK_KEY, JSON.stringify(next)); lockCfg = next; return true; } catch (e) { console.warn("[lock] save failed: " + e); return false; }
}
/** is this player the server Owner? (the only one who can lock, unlock and pass a lock) */
export const isOwnerPlayer = (p) => { try { return !!p && !!staffHook.owner && !!staffHook.owner(p.id); } catch (e) { return false; } };
const ONLY_OWNER = "Only the Owner can lock or unlock protections.";
export const afkLocked = () => lockState().afk === true;
export const allLandsLocked = () => lockState().all === true;
/** is this land locked by the Owner (on its own, or because ALL lands are locked)? */
export const isLocked = (c) => !!c && (c.k === true || lockState().all === true);
/** may this player skip the protection of this land?  Locked: ONLY the Owner.  Not locked: the "landadmin" bypass, like before. */
export const bypass = (c, p) => (isLocked(c) ? isOwnerPlayer(p) : isAdmin(p));
/** Owner only: lock / unlock ONE land.  Returns { ok } or { err } */
export function setClaimLock(actor, c, on) {
  if (!isOwnerPlayer(actor)) return { err: ONLY_OWNER };
  if (!c || !claims.has(c.id)) return { err: "This protection no longer exists." };
  const old = c.k; if (on) c.k = true; else delete c.k;
  if (!save(c)) { if (old) c.k = old; else delete c.k; return { err: "Could not save." }; }
  return { ok: true };
}
/** Owner only: lock / unlock EVERY land (also the ones bought later) */
export function setAllLandsLock(actor, on) {
  if (!isOwnerPlayer(actor)) return { err: ONLY_OWNER };
  return lockSave({ ...lockState(), all: !!on }) ? { ok: true } : { err: "Could not save." };
}
/** Owner only: lock / unlock the AFK area (rules, area, arrival spot and the blocks inside) */
export function setAfkLock(actor, on) {
  if (!isOwnerPlayer(actor)) return { err: ONLY_OWNER };
  return lockSave({ ...lockState(), afk: !!on }) ? { ok: true } : { err: "Could not save." };
}
/** how many lands are locked on their own flag */
export const lockedLandCount = () => allClaims().filter((c) => c.k === true).length;

/** may this player change blocks / use things at this position? */
export function canEdit(p, dimId, x, y, z) {
  const c = claimAt(dimId, x, y, z);
  return !c || isMember(c, p) || bypass(c, p);
}
export const canEditBlock = (p, b) => { try { return canEdit(p, b.dimension.id, b.x, b.y, b.z); } catch (e) { return true; } };

// ---------------------------------------------------------------- prices (exact, per real time)
/** how much time a purchase button adds right now.  mode: "1" = +1 hour, "12" / "24" = top up to 12 / 24 hours in total */
export function addMs(leftMs, mode) {
  const room = Math.max(0, MAX_MS - leftMs);
  if (mode === "1") return Math.min(HOUR, room);
  const target = (mode === "12" ? 12 : 24) * HOUR;
  return Math.max(0, Math.min(target - leftMs, room));
}
/** price of `ms` of protection - exact: you only pay for the time you really get */
export const priceFor = (size, ms) => (ms <= 0 ? 0 : Math.max(1, Math.ceil((size.rate * ms) / HOUR)));

// ---------------------------------------------------------------- FAST GROWTH (paid upgrade of one land, only the crops INSIDE that land grow faster)
// claim.g = { lv: 1..4, e: end time (ms epoch) }.  Time is bought in packs of GROW_PACK_H hours, a land can hold at most GROW_MAX_H hours.
// price = $ per hour for a Small land; every bigger size adds GROW_SIZE_STEP.  The pack price = 6 hours.  A level can only be changed when no growth time is left.
export const GROW_SIZE_STEP = 2999;
const gr = (b) => [b, b + GROW_SIZE_STEP, b + 2 * GROW_SIZE_STEP];
export const GROW = [
  { lv: 1, name: "Grow I",   x: 2, rates: gr(4999) },
  { lv: 2, name: "Grow II",  x: 3, rates: gr(8999) },
  { lv: 3, name: "Grow III", x: 4, rates: gr(11999) },
  { lv: 4, name: "Grow IV",  x: 6, rates: gr(17999) },
  { lv: 5, name: "Grow V",   x: 8, rates: gr(22999) },
];
export const GROW_PACK_H = 6, GROW_MAX_H = 24;
export const growOf = (lv) => GROW.find((g) => g.lv === lv) ?? null;
export const growLeft = (c) => Math.max(0, (c?.g?.e ?? 0) - Date.now());
/** the active growth level of a land (0 = none) */
export const growLevel = (c) => (c && c.g && growLeft(c) > 0 && growOf(c.g.lv) ? c.g.lv : 0);
export const growRate = (c, lv) => (growOf(lv)?.rates[Math.max(0, SIZES.findIndex((s) => s.key === c.s))] ?? 0);
export const growPrice = (c, lv) => growRate(c, lv) * GROW_PACK_H;
/** why this purchase is not possible right now (or null) */
export function growBlock(c, lv) {
  if (!growOf(lv)) return "Unknown growth level.";
  if (!active(c)) return "This protection already ended.";
  const left = growLeft(c);
  if (left > 0 && c.g.lv !== lv) return "Fast growth is running at " + growOf(c.g.lv).name + " - wait until it ends to change the level.";
  if (left + GROW_PACK_H * HOUR > GROW_MAX_H * HOUR) return "You can hold at most " + GROW_MAX_H + " hours of fast growth.";
  return null;
}
export function buyGrow(p, c, lv) {
  if (c.o !== p.id) return { err: "Only the owner can buy fast growth." };
  const why = growBlock(c, lv); if (why) return { err: why };
  const cost = buyPrice(p, growPrice(c, lv), 0);
  if (stats(p).money < cost) return { err: "Not enough money. You need $" + cost.toLocaleString("en-US") + "." };
  if (!takeMoney(p, cost)) return { err: "Not enough money." };
  const old = c.g;
  c.g = { lv, e: Math.max(Date.now(), old?.e ?? 0) + GROW_PACK_H * HOUR };
  if (!save(c)) { c.g = old; addMoney(p, cost); return { err: "Could not save - you were not charged." }; }
  return { cost };
}

// ---------------------------------------------------------------- creating / renewing / deleting
/** box for a claim bought at this spot */
export function boxAt(size, loc) {
  const half = size.w / 2, below = Math.round(size.h * BELOW);
  const x1 = Math.floor(loc.x) - half + 1, z1 = Math.floor(loc.z) - half + 1;
  const y1 = Math.floor(loc.y) - below;
  return { x1, y1, z1, x2: x1 + size.w - 1, y2: y1 + size.h - 1, z2: z1 + size.w - 1 };
}
const overlaps = (a, b) => a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1 && a.z1 <= b.z2 && a.z2 >= b.z1;
/** returns an error text, or null when a claim of this size can be bought here */
export function checkSpot(p, size) {
  load();
  const lim = claimLimit(p.id);
  if (claimsOf(p.id).length >= lim) return lim > 0 ? "You already own the maximum of " + lim + " protections." : "You are not allowed to own protections.";
  const box = boxAt(size, p.location), d = p.dimension.id;
  if (zoneOverlaps(d, box)) return "This spot overlaps the server spawn or an arena.";
  for (const c of allClaims()) if (c.d === d && overlaps(box, c)) return c.o === p.id ? "This spot overlaps your protection \"" + c.n + "\"." : "This spot overlaps the protected land of " + c.on + ".";
  return null;
}
export function createClaim(p, sizeKey, mode) {
  load();
  const size = sizeOf(sizeKey), ms = addMs(0, mode), cost = buyPrice(p, priceFor(size, ms), 0);
  const err = checkSpot(p, size); if (err) return { err };
  if (stats(p).money < cost) return { err: "Not enough money. You need $" + cost.toLocaleString("en-US") + "." };
  const mine = claimsOf(p.id), box = boxAt(size, p.location), l = p.location;
  const c = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), o: p.id, on: p.name, n: "Land " + (mine.length + 1), s: size.key, d: p.dimension.id, ...box,
    e: Date.now() + ms, t: {}, c: Date.now(), ord: (mine.length ? Math.max(...mine.map((m) => m.ord ?? 0)) : 0) + 1, sp: { x: Math.round(l.x * 10) / 10, y: Math.round(l.y * 10) / 10, z: Math.round(l.z * 10) / 10 },
  };
  if (!takeMoney(p, cost)) return { err: "Not enough money." };
  claims.set(c.id, c);
  if (!save(c)) { claims.delete(c.id); addMoney(p, cost); return { err: "Could not save the protection - you were not charged." }; }
  return { claim: c, cost, ms };
}
export function renew(p, c, mode) {
  if (c.o !== p.id) return { err: "Only the owner can buy time." };
  if (!active(c)) return { err: "This protection already ended." };
  const size = sizeOf(c.s), ms = addMs(timeLeft(c), mode), cost = buyPrice(p, priceFor(size, ms), 0);
  if (ms <= 0) return { err: "This protection already has " + (mode === "24" || mode === "1" ? "the maximum (" + MAX_HOURS + "h)" : "at least that much time") + "." };
  if (stats(p).money < cost) return { err: "Not enough money. You need $" + cost.toLocaleString("en-US") + "." };
  if (!takeMoney(p, cost)) return { err: "Not enough money." };
  const old = c.e; c.e = Math.max(Date.now(), c.e) + ms;
  if (!save(c)) { c.e = old; addMoney(p, cost); return { err: "Could not save - you were not charged." }; }
  warned.delete(c.id);
  return { cost, ms };
}
/** info hologram settings of a land: c.hl = { off?: true, x, y, z } (x/y/z = the middle of the board; none = the middle of the land) */
export function setHolo(c, hl) { if (hl) c.hl = hl; else delete c.hl; return save(c); }
/** a locked land can never be deleted by this function unless force = true (only the Owner-controlled code passes it) */
export function deleteClaim(c, force = false) { if (isLocked(c) && !force) return false; warned.delete(c.id); drop(c); return true; }
export function rename(c, name) {
  const n = String(name ?? "").replace(/[§\n\r]/g, "").trim();
  if (n.length < 2 || n.length > 20) return "The name must be 2-20 characters.";
  c.n = n; save(c); return null;
}
/** swap the list position with the neighbour (dir -1 = up, +1 = down) */
export function move(c, dir) {
  const list = claimsOf(c.o), i = list.indexOf(c), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  list.forEach((x, k) => { x.ord = k; });                      // normalise, then swap
  const o = list[j].ord; list[j].ord = list[i].ord; list[i].ord = o;
  save(list[i]); save(list[j]);
}
export function addTrusted(c, id, name) {
  if (id === c.o) return "That is you - the owner always has access.";
  if (c.t[id]) return name + " is already allowed.";
  if (Object.keys(c.t).length >= MAX_TRUSTED) return "You can allow at most " + MAX_TRUSTED + " players.";
  c.t[id] = name; save(c); return null;
}
export function removeTrusted(c, id) { delete c.t[id]; save(c); }
/** known player (ever joined) by name, case-insensitive */
export function findPlayer(name) {
  const n = String(name ?? "").trim().toLowerCase(); if (!n) return null;
  const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === n); if (online) return { id: online.id, name: online.name };
  const r = allRecords().find((x) => String(x.name).toLowerCase() === n); return r ? { id: r.id, name: r.name } : null;
}

// ---------------------------------------------------------------- messages for players who were offline when something happened
function pend(id, text) {
  try { const raw = world.getDynamicProperty(PEND + id); const a = typeof raw === "string" ? JSON.parse(raw) : []; a.push(text); while (a.length > 10) a.shift(); world.setDynamicProperty(PEND + id, JSON.stringify(a)); } catch (e) { /* ignore */ }
}
const say = (id, text) => { const p = world.getAllPlayers().find((x) => x.id === id); if (!p) return false; try { p.sendMessage(text); } catch (e) { return false; } return true; };
const tell = (id, text) => { if (!say(id, text)) pend(id, text); };
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    system.runTimeout(() => {
      try {
        const raw = world.getDynamicProperty(PEND + player.id);
        if (typeof raw !== "string") return;
        world.setDynamicProperty(PEND + player.id, undefined);
        for (const t of JSON.parse(raw)) player.sendMessage(t);
      } catch (e) { /* ignore */ }
    }, 60);
  });
} catch (e) { console.warn("[land] spawn hook: " + e); }

// ---------------------------------------------------------------- the 1-second loop: end of time + warnings
const warned = new Map();       // claim id -> 0 none, 1 = 10 min warning sent, 2 = 1 min warning sent
const centreOf = (c) => ({ x: (c.x1 + c.x2 + 1) / 2, y: (c.y1 + c.y2 + 1) / 2, z: (c.z1 + c.z2 + 1) / 2 });
function sweep() {
  load();
  const now = Date.now();
  for (const c of [...claims.values()]) {
    const left = c.e - now;
    if (left <= 0) {
      drop(c);
      tell(c.o, "§c[Protection] Your protection §f" + c.n + " §chas ended - the land is no longer protected. Buy time again from the shop menu.");
      try { luxProtect("end", world.getDimension(c.d), centreOf(c)); } catch (e) { /* the area may not be loaded */ }
      continue;
    }
    const lvl = warned.get(c.id) ?? 0;
    if (left <= 60000 && lvl < 2) { warned.set(c.id, 2); say(c.o, "§c[Protection] §f" + c.n + " §cends in less than §f1 minute§c!"); }
    else if (left <= 600000 && lvl < 1) { warned.set(c.id, 1); say(c.o, "§e[Protection] §f" + c.n + " §eends in less than §f10 minutes§e."); }
  }
}
system.runInterval(() => { try { sweep(); } catch (e) { console.warn("[land] sweep: " + e); } }, 20);
