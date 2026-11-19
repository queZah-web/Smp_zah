// Heart pickup log (admin only data, shown in /shop > Hearts > Logs > "Heart Pickups").
//
// WHO picked a Heart (or Half Heart / Heart of Malevolence) up - from the GROUND or from a CHEST (or any other container).
//
// How it is detected (no special event is needed, so it works for every way of picking up):
//   * every 4 ticks the Hearts in each player's inventory are counted per BUYER TAG (hidden tag, see heartids.js).
//     More half-hearts than a moment ago = the player just got a Heart.
//   * where it came from:
//       GROUND    - a Heart item entity was lying within 5 blocks of the player a moment ago and is gone now
//       CONTAINER - the player opened a chest / barrel / shulker box / ender chest / hopper / chest minecart ... (and is still near it)
//       OTHER     - anything else (admin /give, player-to-player trade, ...)
//   * purchases and repairs are NOT pickups: hearts.js calls syncHeartPickups(p) right after it gives the item.
//   * a spoiled Heart turning into a Half Heart inside the inventory does not change the total, so it is not counted again.
//
// One record per picker, saved in a world property "smp_hp:<player id>" (works for offline players too):
//   { v, nm: last known name, c: hearts picked up (all time), l: [[time, type, amount, buyer id, buyer name, source, place, x, y, z, dim], ...] newest first (last 100) }
//   type: 0 Heart | 1 Half Heart | 2 Heart of Malevolence      source: "g" ground | "c" container | "o" other      dim: "o" overworld | "n" nether | "e" end
import { world, system } from "@minecraft/server";
import { isHeart, buyerOf, HEART_ITEM, HALF_ITEM, CURSED_ITEM, unitsOfItem } from "./heartids.js";

const PFX = "smp_hp:", KEEP = 100;
const POLL = 4;                    // ticks between two checks
const SCAN_R = 5;                  // blocks: Hearts lying this close to the player are watched
const CONT_MS = 180000;            // a container opened in the last 3 minutes ...
const CONT_R = 12;                 // ... and within 12 blocks of the player counts as the source
const TYPES = [HEART_ITEM, HALF_ITEM, CURSED_ITEM];
const cache = new Map();

// ---------------------------------------------------------------- storage
function read(id) {
  let r = cache.get(id);
  if (r) return r;
  try { const raw = world.getDynamicProperty(PFX + id); if (typeof raw === "string") r = JSON.parse(raw); } catch (e) { r = null; }
  if (!r || typeof r !== "object") return null;
  r.l = Array.isArray(r.l) ? r.l : []; r.c = Number(r.c) || 0;
  cache.set(id, r);
  return r;
}
function save(id, r) {
  cache.set(id, r);
  try { world.setDynamicProperty(PFX + id, JSON.stringify(r)); } catch (e) { console.warn("[heartpickup] cannot save " + id + ": " + e); }
}
function logPickup(p, ev, src, place, loc, dim) {
  const r = read(p.id) ?? { v: 1, nm: p.name ?? "?", c: 0, l: [] };
  r.nm = p.name ?? r.nm; r.c += ev.amount;
  r.l.unshift([Date.now(), Math.max(0, TYPES.indexOf(ev.type)), ev.amount, ev.bid, String(ev.bnm ?? "").slice(0, 32), src, String(place ?? "").slice(0, 24), Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), dim]);
  if (r.l.length > KEEP) r.l.length = KEEP;
  save(p.id, r);
}

// ---------------------------------------------------------------- what the player holds
const invOf = (p) => { try { return p.getComponent("inventory").container; } catch (e) { return null; } };
/** { units: Map buyerKey -> half hearts, types: Map buyerKey -> Map typeId -> item count, names: Map buyerKey -> buyer name } ("-" = a Heart without buyer tag) */
function scanInv(p) {
  const c = invOf(p); if (!c) return null;
  const units = new Map(), types = new Map(), names = new Map();
  for (let i = 0; i < c.size; i++) {
    const s = c.getItem(i); if (!s || !isHeart(s.typeId)) continue;
    const tag = buyerOf(s), key = tag ? tag.id : "-";
    units.set(key, (units.get(key) ?? 0) + unitsOfItem(s.typeId) * s.amount);
    let t = types.get(key); if (!t) types.set(key, (t = new Map()));
    t.set(s.typeId, (t.get(s.typeId) ?? 0) + s.amount);
    if (tag && !names.has(key)) names.set(key, tag.name);
  }
  return { units, types, names };
}
/** the Hearts that were gained between two scans: [{ type, amount, bid, bnm }] */
function gained(prev, cur) {
  const out = [];
  for (const [key, u] of cur.units) {
    let left = u - (prev.units.get(key) ?? 0); if (left <= 0) continue;
    const pt = prev.types.get(key), ct = cur.types.get(key);
    for (const type of TYPES) {
      const d = (ct.get(type) ?? 0) - (pt?.get(type) ?? 0), per = unitsOfItem(type);
      if (d <= 0 || left < per) continue;
      const n = Math.min(d, Math.floor(left / per));
      out.push({ type, amount: n, bid: key, bnm: cur.names.get(key) ?? "" }); left -= n * per;
    }
  }
  return out;
}

// ---------------------------------------------------------------- where it came from
const state = new Map();           // player id -> { inv, scans: [Map entity id -> { type, bid, x, y, z, d }, ...] (newest first) }
const ready = new Map();           // player id -> time (ms) after which pickups are logged (a join / respawn is not a pickup)
const lastCont = new Map();        // player id -> { t, label, x, y, z, dim }

// Pickup credits: every pickup that happened is remembered for a short time, so the Heart loss log (heartfx.js / heartloss.js) can tell
// "this Heart item on the ground vanished because a player took it" from "this Heart item was destroyed".
const credits = [];                // { t, bid, dim, x, y, z, left }
function addCredit(ev, loc, dim, now) {
  credits.push({ t: now, bid: ev.bid, dim, x: loc.x, y: loc.y, z: loc.z, left: ev.amount });
  if (credits.length > 80) credits.shift();
}
/** how many of `want` Hearts (buyer `bid`) that vanished near `loc` were picked up by a player (since = the last time the item was seen).  Uses the credits up. */
export function takePickupCredit(bid, dim, loc, since, want, now) {
  let got = 0;
  for (const c of credits) {
    if (got >= want) break;
    if (c.left <= 0 || c.bid !== bid || c.dim !== dim || c.t < since || now - c.t > 30000) continue;
    if (Math.hypot(c.x - loc.x, c.y - loc.y, c.z - loc.z) > 7) continue;
    const k = Math.min(c.left, want - got); c.left -= k; got += k;
  }
  return got;
}
/** true when a player close to `loc` had his pickups switched off (just joined / respawned) after `since`: a pickup there may not have been seen */
export function settlingNear(dim, loc, since) {
  try {
    for (const p of world.getAllPlayers()) {
      if ((ready.get(p.id) ?? 0) <= since || dimCode(p) !== dim) continue;
      const l = p.location;
      if (Math.hypot(l.x - loc.x, l.y - loc.y, l.z - loc.z) <= 9) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

function scanGround(p) {
  const out = new Map();
  try {
    const pl = p.location;
    for (const e of p.dimension.getEntities({ type: "minecraft:item", location: pl, maxDistance: SCAN_R })) {
      try {
        const it = e.getComponent("minecraft:item")?.itemStack; if (!it || !isHeart(it.typeId)) continue;
        const l = e.location;
        out.set(e.id, { type: it.typeId, bid: buyerOf(it)?.id ?? "-", x: l.x, y: l.y, z: l.z, d: Math.hypot(l.x - pl.x, l.y - pl.y, l.z - pl.z) });
      } catch (x) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return out;
}
const entityGone = (id) => { try { return !world.getEntity(id); } catch (e) { return true; } };
const dimCode = (p) => { const d = String(p.dimension.id).replace("minecraft:", ""); return d === "overworld" ? "o" : d === "nether" ? "n" : d === "the_end" ? "e" : d; };

const pretty = (id) => String(id).replace("minecraft:", "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const CONTAINER_BLOCK = /chest|barrel|shulker_box|hopper|dropper|dispenser|furnace|smoker|brewing_stand|crafter/;
const CONTAINER_ENTITY = /chest|hopper|donkey|mule|llama/;
function noteContainer(p, label, loc, dim) { lastCont.set(p.id, { t: Date.now(), label, x: loc.x, y: loc.y, z: loc.z, dim }); }
try {
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      const b = ev.block, id = b.typeId; let ok = CONTAINER_BLOCK.test(id);
      if (!ok) { try { ok = !!b.getComponent("minecraft:inventory"); } catch (e) { ok = false; } }
      if (ok) noteContainer(ev.player, pretty(id), b.location, String(b.dimension.id));
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[heartpickup] cannot watch containers: " + e); }
try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    try {
      const t = ev.target, id = t.typeId;
      if (CONTAINER_ENTITY.test(id)) noteContainer(ev.player, pretty(id), t.location, String(t.dimension.id));
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

function containerFor(p, now) {
  const c = lastCont.get(p.id); if (!c || now - c.t > CONT_MS) return null;
  const pl = p.location;
  if (c.dim !== String(p.dimension.id) || Math.hypot(pl.x - c.x, pl.y - c.y, pl.z - c.z) > CONT_R) return null;
  return c;
}

// ---------------------------------------------------------------- the loop
function poll(p, now) {
  const inv = scanInv(p); if (!inv) return;
  const scan = scanGround(p), st = state.get(p.id);
  if (!st || now < (ready.get(p.id) ?? 0)) { state.set(p.id, { inv, scans: [scan] }); return; }          // first look at this player: just remember
  const events = gained(st.inv, inv);
  let usedGround = false;
  if (events.length) {
    // Hearts that lay near him a moment ago and are gone now
    const gone = [];
    for (const sc of st.scans) for (const [id, g] of sc) if (g.d <= 3.6 && !gone.some((x) => x.id === id) && entityGone(id)) gone.push({ id, ...g });
    const dim = dimCode(p), cont = containerFor(p, now), pl = p.location;
    for (const ev of events) {
      let k = gone.findIndex((g) => g.bid === ev.bid && g.type === ev.type); if (k < 0) k = gone.findIndex((g) => g.bid === ev.bid); if (k < 0) k = gone.length ? 0 : -1;
      if (k >= 0) { const g = gone.splice(k, 1)[0]; usedGround = true; logPickup(p, ev, "g", "", g, dim); addCredit(ev, g, dim, now); }
      else if (cont) { logPickup(p, ev, "c", cont.label, cont, dim); addCredit(ev, pl, dim, now); }
      else { logPickup(p, ev, "o", "", pl, dim); addCredit(ev, pl, dim, now); }
    }
  }
  state.set(p.id, { inv, scans: usedGround ? [scan] : [scan, ...st.scans].slice(0, 2) });
}
system.runInterval(() => {
  const now = Date.now();
  for (const p of world.getAllPlayers()) { try { poll(p, now); } catch (e) { /* ignore */ } }
}, POLL);

/** call right after the pack itself gives / changes a Heart in a player's inventory (purchase, repair): that is not a pickup */
export function syncHeartPickups(p) {
  try { const st = state.get(p.id), inv = scanInv(p); if (st && inv) st.inv = inv; } catch (e) { /* ignore */ }
}
try {
  world.afterEvents.playerSpawn.subscribe(({ player }) => { ready.set(player.id, Date.now() + 4000); state.delete(player.id); });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { state.delete(playerId); ready.delete(playerId); lastCont.delete(playerId); cache.delete(playerId); });
} catch (e) { console.warn("[heartpickup] events: " + e); }

// ---------------------------------------------------------------- reading
export const TYPE_NAMES = ["Heart", "Half Heart", "Heart of Malevolence"];
const row = (x) => ({ t: x[0], type: x[1], amount: x[2], buyerId: x[3], buyerName: x[4], src: x[5], place: x[6], x: x[7], y: x[8], z: x[9], dim: x[10] });
/** "Ground" | "Chest" | "Other (give / trade)" */
export const sourceText = (x) => (x.src === "g" ? "Ground" : x.src === "c" ? (x.place || "Container") : "Other (give/trade)");
/** "120 64 -300" + " (Nether)" / " (End)" */
export const placeText = (x) => x.x + " " + x.y + " " + x.z + (x.dim === "n" ? " (Nether)" : x.dim === "e" ? " (End)" : "");

/** every picker: [{ id, name, count, last }] - the latest picker first */
export function pickersList() {
  const out = [];
  try {
    for (const key of world.getDynamicPropertyIds()) {
      if (!key.startsWith(PFX)) continue;
      const id = key.slice(PFX.length), r = read(id); if (!r || r.c < 1) continue;
      out.push({ id, name: r.nm ?? "?", count: r.c, last: r.l[0]?.[0] ?? 0 });
    }
  } catch (e) { console.warn("[heartpickup] list: " + e); }
  return out.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}
/** the pickups of one player (newest first) + his total */
export function pickerInfo(id) {
  const r = read(id); if (!r) return null;
  return { id, name: r.nm ?? "?", count: r.c, list: r.l.map(row) };
}
/** every pickup of every player, newest first: [{ id, name, t, type, amount, buyerId, buyerName, src, place, x, y, z, dim }] */
export function allPickups() {
  const out = [];
  for (const b of pickersList()) { const info = pickerInfo(b.id); if (info) for (const x of info.list) out.push({ id: b.id, name: info.name, ...x }); }
  return out.sort((a, b) => b.t - a.t);
}
export function pickupTotals() {
  let pickers = 0, hearts = 0;
  for (const b of pickersList()) { pickers++; hearts += b.count; }
  return { pickers, hearts };
}
