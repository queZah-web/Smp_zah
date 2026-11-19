// AFK AREA.  /afk teleports the player to the AFK area.  While he is INSIDE the area a timer shows on his screen (action bar) and every
// full minute he gets money + shards.  Everything below can be changed in game by the Owner and by Admins:
//   Operator > Server & staff > AFK area   (or /afkset)     permission "afkset"  (Admin by default; the Owner can block it for Admin in Role permissions)
//   * rewards per minute (money, shards)      * the area: width (X), length (Z), height (Y) around the operator, like a land
//   * the arrival spot (where /afk puts the player)           * remove the area
// The area is protected: only operators with the permission can break / place blocks inside it.  The Owner / Admins choose WHICH protections are on
// (Operator > Server & staff > AFK area > Protection): no breaking, no placing, no PvP, no hitting mobs / touching things, no fire (Fire Aspect, Flame, lava, fire charge, flint), no explosions.
// Saved in ONE world property ("afk:v1").  Every function checks the permission again and returns { ok } or { err }; nothing here can throw.
import { world, system } from "@minecraft/server";
import { addMoney, addShards } from "../data.js";
import { money, num } from "../format.js";
import { sendBar } from "../barsend.js";
import { afkBusy, combatBusy, clanBusy, payBusy } from "../state.js";
import { allow, can, slog, econMsg } from "./staffcore.js";
import { BELOW, isAdmin, afkLocked, isOwnerPlayer } from "./landcore.js";
import { canTeleport, stamp, teleportWithFx, valid } from "./util.js";
import { duelView } from "./duelstate.js";
import { menuMsg } from "./menulang.js";

const KEY = "afk:v1";
const DEFAULT = { money: 25, shards: 10 };
export const AFK_LIMITS = { money: [0, 1000000], shards: [0, 100000], w: [3, 256], l: [3, 256], h: [3, 384] };
const MINUTE = 60000, SAFE_CATCHUP = 5;
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[afk] " + name + " not started: " + e); } };
const say = (p, m) => { try { p.sendMessage(menuMsg(p, m)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- the protection rules (the Owner / Admins switch each one ON / OFF; all ON by default)
export const AFK_RULES = [
  { k: "nobreak", def: true, name: "No breaking", info: "Players can't break blocks" },
  { k: "noplace", def: true, name: "No placing", info: "No blocks, buckets, lava, water, TNT" },
  { k: "nopvp", def: true, name: "No PvP", info: "Players can't hit each other (arrows too)" },
  { k: "nomob", def: true, name: "No hitting mobs", info: "Mobs, animals, armor stands, frames" },
  { k: "nofire", def: true, name: "No fire", info: "Fire Aspect, Flame, lava, fire charge, flint" },
  { k: "noboom", def: true, name: "No explosions", info: "TNT / creepers break nothing, hurt nobody" },
  { k: "nouse", def: false, name: "No using blocks", info: "Chests, doors, buttons, levers, ..." },
];

// ---------------------------------------------------------------- saved settings  { m: money/min, s: shards/min, z: { d, x1, x2, y1, y2, z1, z2, sx, sy, sz } | null }
let cfg = null;
function load() {
  if (cfg) return cfg;
  try {
    const raw = world.getDynamicProperty(KEY), o = typeof raw === "string" ? JSON.parse(raw) : {};
    const r = {}; for (const x of AFK_RULES) r[x.k] = o.r && typeof o.r[x.k] === "boolean" ? o.r[x.k] : x.def;
    cfg = { m: Number.isFinite(o.m) ? o.m : DEFAULT.money, s: Number.isFinite(o.s) ? o.s : DEFAULT.shards, z: o.z && typeof o.z === "object" ? o.z : null, r };
  } catch (e) { return null; }                                       // world not ready: never overwrite saved data
  return cfg;
}
function persist() {
  try { world.setDynamicProperty(KEY, JSON.stringify(cfg)); return true; } catch (e) { console.warn("[afk] save failed: " + e); return false; }
}
/** { money, shards, zone } now in use (zone = null when none is set) */
export function afkSettings() { const c = load() ?? { m: DEFAULT.money, s: DEFAULT.shards, z: null }; return { money: c.m, shards: c.s, zone: c.z ? { ...c.z } : null, defaults: DEFAULT }; }
/** { nobreak: true, ... } the protection rules now in use */
export function afkRules() { const c = load(), o = {}; for (const x of AFK_RULES) o[x.k] = c && c.r ? c.r[x.k] : x.def; return o; }
const rule = (k) => { const c = cfg; return !!c && !!c.r && c.r[k] === true; };
/** switch one protection ON / OFF (Owner / Admin with the "afkset" permission) */
export function setAfkRule(actor, key, on) {
  if (!can(actor, "afkset")) return denied(actor);
  { const lk = lockedFor(actor); if (lk) return lk; }
  const def = AFK_RULES.find((x) => x.k === key); if (!def) return { err: "Unknown protection." };
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  const old = c.r[key]; c.r[key] = !!on;
  if (!persist()) { c.r[key] = old; return { err: "Could not save." }; }
  slog(actor, "afkset", null, "protection '" + def.name + "' " + (on ? "ON" : "OFF"));
  return { ok: true };
}
/** all protections ON / all OFF at once */
export function setAfkRulesAll(actor, on) {
  if (!can(actor, "afkset")) return denied(actor);
  { const lk = lockedFor(actor); if (lk) return lk; }
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  const old = { ...c.r }; for (const x of AFK_RULES) c.r[x.k] = !!on;
  if (!persist()) { c.r = old; return { err: "Could not save." }; }
  slog(actor, "afkset", null, "all protections " + (on ? "ON" : "OFF"));
  return { ok: true };
}
export const zoneSize = (z) => ({ w: z.x2 - z.x1 + 1, l: z.z2 - z.z1 + 1, h: z.y2 - z.y1 + 1 });
const inZone = (z, dimId, x, y, z2) => !!z && z.d === dimId && x >= z.x1 && x < z.x2 + 1 && y >= z.y1 && y < z.y2 + 1 && z2 >= z.z1 && z2 < z.z2 + 1;
export function inAfkZone(p) {
  try { const c = load(); const l = p.location; return !!c && inZone(c.z, p.dimension.id, l.x, l.y, l.z); } catch (e) { return false; }
}

/** is this point inside the AFK area? (used by /sethome and /home) */
export function pointInAfkZone(dimId, x, y, z) { try { const c = load(); return !!c && inZone(c.z, dimId, x, y, z); } catch (e) { return false; } }

const denied = (p) => { allow(p, "afkset"); return { err: "You are not allowed to change the AFK area." }; };
/** the AFK area is LOCKED by the Owner: only the Owner can change its protection, its area or its arrival spot.  Returns an error object, or null. */
const lockedFor = (actor) => (afkLocked() && !isOwnerPlayer(actor) ? { err: "The AFK area is LOCKED by the Owner. Only the Owner can change or remove it." } : null);
const wholeIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
/** rewards per minute (whole numbers; 0 = nothing) */
export function setAfkRewards(actor, m, s) {
  if (!can(actor, "afkset")) return denied(actor);
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  if (!wholeIn(m, AFK_LIMITS.money)) return { err: "Money must be a whole number from " + AFK_LIMITS.money[0] + " to " + num(AFK_LIMITS.money[1]) + "." };
  if (!wholeIn(s, AFK_LIMITS.shards)) return { err: "Shards must be a whole number from " + AFK_LIMITS.shards[0] + " to " + num(AFK_LIMITS.shards[1]) + "." };
  const old = { m: c.m, s: c.s }; c.m = m; c.s = s;
  if (!persist()) { c.m = old.m; c.s = old.s; return { err: "Could not save." }; }
  slog(actor, "afkset", null, "reward per minute: $" + m + " + " + s + " shards");
  return { ok: true };
}
/** the area around the operator: width (X), length (Z), height (Y).  Like a land, 1/4 of the height goes below his feet.  His position becomes the arrival spot. */
export function setAfkZone(actor, w, l, h) {
  if (!can(actor, "afkset")) return denied(actor);
  { const lk = lockedFor(actor); if (lk) return lk; }
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  if (!wholeIn(w, AFK_LIMITS.w)) return { err: "Width must be a whole number from " + AFK_LIMITS.w[0] + " to " + AFK_LIMITS.w[1] + "." };
  if (!wholeIn(l, AFK_LIMITS.l)) return { err: "Length must be a whole number from " + AFK_LIMITS.l[0] + " to " + AFK_LIMITS.l[1] + "." };
  if (!wholeIn(h, AFK_LIMITS.h)) return { err: "Height must be a whole number from " + AFK_LIMITS.h[0] + " to " + AFK_LIMITS.h[1] + "." };
  let loc, d;
  try { loc = actor.location; d = actor.dimension.id; } catch (e) { return { err: "Could not read your position." }; }
  const cx = Math.floor(loc.x), cz = Math.floor(loc.z), fy = Math.floor(loc.y);
  const x1 = cx - Math.floor((w - 1) / 2), z1 = cz - Math.floor((l - 1) / 2), y1 = fy - Math.round(h * BELOW);
  const zone = { d, x1, x2: x1 + w - 1, y1, y2: y1 + h - 1, z1, z2: z1 + l - 1, sx: Math.round(loc.x * 10) / 10, sy: Math.round(loc.y * 10) / 10, sz: Math.round(loc.z * 10) / 10 };
  const old = c.z; c.z = zone;
  if (!persist()) { c.z = old; return { err: "Could not save." }; }
  slog(actor, "afkset", null, "area " + w + "x" + l + "x" + h + " at " + cx + "," + fy + "," + cz);
  return { ok: true };
}
/** the arrival spot = where the operator stands now (must be inside the area) */
export function setAfkSpot(actor) {
  if (!can(actor, "afkset")) return denied(actor);
  { const lk = lockedFor(actor); if (lk) return lk; }
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  if (!c.z) return { err: "There is no AFK area yet. Set the area first." };
  let loc; try { loc = actor.location; } catch (e) { return { err: "Could not read your position." }; }
  if (!inAfkZone(actor)) return { err: "Stand INSIDE the AFK area to set the arrival spot." };
  const old = { sx: c.z.sx, sy: c.z.sy, sz: c.z.sz };
  c.z.sx = Math.round(loc.x * 10) / 10; c.z.sy = Math.round(loc.y * 10) / 10; c.z.sz = Math.round(loc.z * 10) / 10;
  if (!persist()) { Object.assign(c.z, old); return { err: "Could not save." }; }
  slog(actor, "afkset", null, "arrival spot moved");
  return { ok: true };
}
export function clearAfkZone(actor) {
  if (!can(actor, "afkset")) return denied(actor);
  { const lk = lockedFor(actor); if (lk) return lk; }
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  const old = c.z; c.z = null;
  if (!persist()) { c.z = old; return { err: "Could not save." }; }
  slog(actor, "afkset", null, "area removed");
  return { ok: true };
}
/** Building > AFK Hall (afkhall.js): puts an exact area + arrival spot (or null = no area). Owner only. Returns { ok, old } or { err } */
export function setAfkZoneExact(actor, zone) {
  if (!isOwnerPlayer(actor)) return { err: "Only the Owner can do this." };
  const c = load(); if (!c) return { err: "The settings could not be read yet. Try again in a moment." };
  const old = c.z ? { ...c.z } : null; c.z = zone ? { ...zone } : null;
  if (!persist()) { c.z = old; return { err: "Could not save." }; }
  slog(actor, "afkset", null, zone ? "area set by the AFK Hall builder" : "area put back (AFK Hall undo)");
  return { ok: true, old };
}
/** operator test: go to the AFK spot at once (no cooldown) */
export function gotoAfkZone(actor) {
  if (!can(actor, "afkset")) return denied(actor);
  const c = load(); if (!c || !c.z) return { err: "There is no AFK area yet." };
  try { actor.teleport({ x: c.z.sx, y: c.z.sy, z: c.z.sz }, { dimension: world.getDimension(c.z.d) }); } catch (e) { return { err: "Teleport failed." }; }
  return { ok: true };
}

// ---------------------------------------------------------------- /afk
const origin = new Map();                                            // player id -> where he came from (so /afk inside the area takes him back)
export function afkCommand(p) {
  const c = load();
  if (!c || !c.z) return say(p, "§c[AFK] The AFK area is not set yet. §7Ask an operator.");
  if (inAfkZone(p)) {
    const o = origin.get(p.id);
    if (!o) return say(p, "§e[AFK] §fYou are in the AFK area. Use §e/spawn §fto leave.");
    if (!canTeleport(p, "afk")) return;
    return teleportWithFx(p, o, o.d, "afk", () => { origin.delete(p.id); say(p, "§a[AFK] Welcome back."); }, () => say(p, "§c[AFK] Teleport failed."));
  }
  let lock = 0; try { lock = duelView.afkLock(p); } catch (e) { lock = 0; }
  if (lock > 0) return say(p, "§c[AFK] §fYou can't enter the AFK area now: the §c1 vs 1 DUEL §fis about to start (or running). §7You cannot skip the fight.");
  if (!canTeleport(p, "afk")) return;
  const from = { x: p.location.x, y: p.location.y, z: p.location.z, d: p.dimension.id };
  const z = c.z;
  teleportWithFx(p, { x: z.sx, y: z.sy, z: z.sz }, z.d, "afk",
    () => { origin.set(p.id, from); say(p, "§a[AFK] You are in the AFK area. §7Every minute: §a" + money(c.m) + " §7+ §d" + num(c.s) + " shards§7. §8(/afk again = back)"); },
    () => say(p, "§c[AFK] Teleport failed."));
}

// ---------------------------------------------------------------- the timer on the screen + the rewards
const st = new Map();                                                // player id -> { since, paid, flash: { until, text } }
const clock = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, t = (n) => String(n).padStart(2, "0"); return (h ? h + ":" : "") + t(m) + ":" + t(x); };
function drop(id) { st.delete(id); afkBusy.delete(id); }
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { drop(playerId); origin.delete(playerId); }));
safe("loop", () => system.runInterval(() => {
  const c = load(); if (!c || !c.z) { if (st.size) for (const id of [...st.keys()]) drop(id); return; }
  const now = Date.now(), seen = new Set();
  for (const p of world.getAllPlayers()) {
    try {
      if (!valid(p)) continue;
      if (!inAfkZone(p)) continue;
      seen.add(p.id);
      let e = st.get(p.id);
      if (!e) { e = { since: now, paid: 0, flash: null }; st.set(p.id, e); }
      afkBusy.add(p.id);
      const total = now - e.since, due = Math.min(SAFE_CATCHUP, Math.floor(total / MINUTE) - e.paid);
      if (due > 0) {
        e.paid += due;
        const frozen = econMsg(p), m = frozen ? 0 : c.m * due, s = frozen ? 0 : c.s * due;     // a frozen money account earns nothing
        if (m > 0) addMoney(p, m);
        if (s > 0) addShards(p, s);
        e.flash = { until: now + 4000, text: m > 0 || s > 0 ? "§a§l+" + money(m) + " §d§l+" + num(s) + " shards" : "§7Your money account is frozen" };
        try { p.playSound("random.orb", { volume: 0.7, pitch: 1.3 }); } catch (x) { /* ignore */ }
      }
      if (combatBusy.has(p.id) || clanBusy.has(p.id) || payBusy.has(p.id)) continue;           // those messages own the action bar for a moment
      const next = MINUTE - (total % MINUTE);
      const l1 = "§e§lAFK §r§f" + clock(total) + " §8| §7next in §a" + Math.ceil(next / 1000) + "s";
      const l2 = e.flash && e.flash.until > now ? e.flash.text : "§7Every minute: §a" + money(c.m) + " §7+ §d" + num(c.s) + " shards";
      sendBar(p, l1 + "\n§r" + l2);
    } catch (x) { /* one player never stops the others */ }
  }
  for (const id of [...st.keys()]) if (!seen.has(id)) drop(id);                                // left the area: timer starts again next time
}, 10));

// ---------------------------------------------------------------- the area is protected (operators with the permission and "landadmin" are never stopped)
// Each protection is a rule the Owner / Admin switches ON / OFF (see AFK_RULES).  Several layers on purpose, like the land guard.
// Locked by the Owner: nobody passes except the Owner - operators, Admins and the "landadmin" bypass are all stopped like normal players.
const mayBuild = (p) => { try { if (afkLocked()) return isOwnerPlayer(p); return can(p, "afkset") || isAdmin(p); } catch (e) { return false; } };
const hit = (b) => { const c = cfg; return !!c && inZone(c.z, b.dimension.id, b.x + 0.5, b.y + 0.5, b.z + 0.5); };
const inE = (e) => { try { const c = cfg, l = e.location; return !!c && inZone(c.z, e.dimension.id, l.x, l.y, l.z); } catch (x) { return false; } };
const lastMsg = new Map();
const deny = (p, what) => system.run(() => { try { const n = Date.now(); if (n - (lastMsg.get(p.id) ?? 0) < 2000) return; lastMsg.set(p.id, n); p.sendMessage(menuMsg(p, "§c[AFK] " + (what || "You can't change blocks in the AFK area."))); } catch (e) { /* ignore */ } });
safe("leave 2", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => lastMsg.delete(playerId)));

// ---- blocks: break / place
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => { if (rule("nobreak") && hit(ev.block) && !mayBuild(ev.player)) { ev.cancel = true; deny(ev.player); } }));
safe("place", () => { const ev = world.beforeEvents.playerPlaceBlock; if (!ev) return; ev.subscribe((e) => { if (rule("noplace") && hit(e.block) && !mayBuild(e.player)) { e.cancel = true; deny(e.player); } }); });
safe("place backup", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try { if (!rule("noplace") || !hit(block) || mayBuild(player)) return; system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } }); deny(player); } catch (e) { /* ignore */ }
}));

// ---- items used on blocks: buckets / TNT (placing), flint & steel / fire charge (fire), any block (No using blocks)
const FACE = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
const PLACER = /^(tnt|tnt_minecart)$/, FIRER = /^(flint_and_steel|fire_charge)$/;
const LIQUID = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper)$/, FLOW_MARGIN = 10;     // water / lava FLOW: placed outside or high above, they run into the area
/** is this spot in the COLUMN of the area: within m blocks sideways and at any height above its floor? */
const inColumn = (dimId, x, y, z, m) => { const c = cfg, a = c && c.z; return !!a && a.d === dimId && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m && y >= a.y1 - 2; };
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (mayBuild(p)) return;
  const f = FACE[String(ev.blockFace)] ?? [0, 0, 0], b = ev.block;
  if (rule("noplace") && LIQUID.test(ev.itemStack?.typeId?.replace("minecraft:", "") ?? "") && inColumn(b.dimension.id, b.x + f[0], b.y + f[1], b.z + f[2], FLOW_MARGIN)) { ev.cancel = true; return deny(p, "You can't use liquids near the AFK area."); }
  const inside = hit(b) || hit({ dimension: b.dimension, x: b.x + f[0], y: b.y + f[1], z: b.z + f[2] });   // the block clicked OR the spot the item would act on
  if (!inside) return;
  const it = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (rule("noplace") && PLACER.test(it)) { ev.cancel = true; return deny(p); }
  if ((rule("nofire") || rule("noplace")) && FIRER.test(it)) { ev.cancel = true; return deny(p, "You can't light fires in the AFK area."); }
  if (rule("nouse") && hit(b)) { ev.cancel = true; deny(p, "You can't use things in the AFK area."); }
}));

// ---- entities: armor stands, frames, animals, boats ... (rule "No hitting mobs")
safe("entity interact", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target; if (!t || t.typeId === "minecraft:player" || !rule("nomob") || mayBuild(ev.player) || !inE(t)) return;
  ev.cancel = true; deny(ev.player, "You can't touch this in the AFK area.");
}));

// ---- explosions never break blocks inside the area (rule "No explosions")
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!rule("noboom")) return;
  const all = ev.getImpactedBlocks(), keep = all.filter((b) => !hit({ dimension: ev.dimension, x: b.x, y: b.y, z: b.z }));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---- hurting: PvP, mobs, fire, explosions
const FIRE_CAUSE = new Set(["fire", "fireTick", "lava", "magma"]), BOOM_CAUSE = new Set(["blockExplosion", "entityExplosion"]);
function attackerOf(src) {
  try {
    const a = src?.damagingEntity;
    if (a?.typeId === "minecraft:player") return a;
    const o = src?.damagingProjectile?.getComponent("minecraft:projectile")?.owner;
    return o?.typeId === "minecraft:player" ? o : null;
  } catch (e) { return null; }
}
/** why this hit must not happen: { why: rule key, who: the attacker or null }  or null */
function stopped(victim, src) {
  const c = cfg; if (!c || !c.z) return null;
  const cause = String(src?.cause ?? "");
  if (rule("nofire") && FIRE_CAUSE.has(cause) && inE(victim)) return { why: "nofire", who: null };
  if (rule("noboom") && BOOM_CAUSE.has(cause) && inE(victim)) return { why: "noboom", who: null };
  const a = attackerOf(src); if (!a || a.id === victim.id || mayBuild(a)) return null;
  if (!inE(victim) && !inE(a)) return null;                                      // a fight fully outside the area is none of our business
  if (victim.typeId === "minecraft:player") return rule("nopvp") ? { why: "nopvp", who: a } : null;
  return rule("nomob") ? { why: "nomob", who: a } : null;
}
const HAS_BEFORE = (() => { try { return !!world.beforeEvents.entityHurt; } catch (e) { return false; } })();
safe("hurt (before)", () => { const ev = world.beforeEvents.entityHurt; if (!ev) return; ev.subscribe((e) => {
  const s = stopped(e.hurtEntity, e.damageSource); if (!s) return;
  e.cancel = true; if (s.who) deny(s.who, s.why === "nopvp" ? "No fighting in the AFK area." : "You can't hurt anything in the AFK area.");
}); });
safe("hurt (after)", () => world.afterEvents.entityHurt.subscribe((ev) => {
  const v = ev.hurtEntity;
  if (rule("nofire") && inE(v)) system.run(() => { try { v.extinguishFire(); } catch (e) { /* ignore */ } });     // Fire Aspect / Flame: the hit may land, the fire never stays
  if (HAS_BEFORE) return;                                                          // the "before" event already stopped it; this is only the backup
  const s = stopped(v, ev.damageSource); if (!s) return;
  try { const h = v.getComponent("minecraft:health"); if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + ev.damage)); } catch (e) { /* ignore */ }
  if (s.who) deny(s.who, "You can't hurt anything in the AFK area.");
}));

// ---- fire: every second, everything burning inside the area (players, mobs, items) is put out
let tick = 0;
safe("fire loop", () => system.runInterval(() => {
  const c = cfg; if (!c || !c.z || !rule("nofire")) return;
  if (++tick % 2) return;
  const z = c.z; let dim; try { dim = world.getDimension(z.d); } catch (e) { return; }
  if (!world.getAllPlayers().some((p) => { try { return p.dimension.id === z.d && inAfkZone(p); } catch (e) { return false; } })) return;   // nobody inside: nothing to protect
  try {
    for (const e of dim.getEntities({ location: { x: z.x1, y: z.y1, z: z.z1 }, volume: { x: z.x2 - z.x1 + 1, y: z.y2 - z.y1 + 1, z: z.z2 - z.z1 + 1 } })) {
      try { e.extinguishFire(); } catch (x) { /* ignore */ }
    }
  } catch (e) { /* the area is not loaded */ }
}, 10));
safe("warm", () => system.runTimeout(() => { load(); }, 40));
