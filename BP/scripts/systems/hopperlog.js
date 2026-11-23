// ===================================================================================================================
// HOPPER LOG  (/opr > Logs > Hopper log)  +  the LAST LOGOUT PLACE of every player (/opr > Players > a player)
//
//   Hoppers:
//     * every hopper a player PLACES is saved: who, when, where (dimension + x y z)
//     * every player who OPENS it (uses it) is added to it (the last 6 users, with the time)
//     * who BROKE it and when - the record stays, so an operator can still go to the place after it is gone
//     * an Admin / the Owner LOOKING at a hopper (6 blocks) sees its tag in the action bar:
//         Hopper | placed by ... (time) | used by ... | ...
//     * the list (newest first, 400 hoppers) with "go there", the users, still there / removed
//   Last logout place: when a player leaves the game his position is saved (+ every 30 s while he plays, in case the
//   server stops) -> "Go to his last logout place".
// No lag: work only when a hopper is placed / opened / broken, one ray every 0.5 s for online admins only.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { roleOf, isOwner } from "./staffcore.js";
import { ago } from "../format.js";

const LOG = "hpl:log", MAX = 400, MAXLEN = 28000, USERS = 6;
const DS = { "minecraft:overworld": "o", "minecraft:nether": "n", "minecraft:the_end": "e" };
const DL = { o: "minecraft:overworld", n: "minecraft:nether", e: "minecraft:the_end" };
const keyOf = (d, x, y, z) => (DS[d] ?? d) + ":" + x + "," + y + "," + z;
const safe = (n, fn) => { try { fn(); } catch (e) { console.warn("[hopperlog] " + n + ": " + e); } };
const isAdminRole = (p) => { try { const r = roleOf(p); return r === "admin" || r === "owner" || isOwner(p); } catch (e) { return false; } };

// ---------------------------------------------------------------- storage (newest first, saved in several pieces)
let list = null, pieces = 0, saveT = null;
function load() {
  if (list) return list;
  list = [];
  try {
    for (let i = 0; ; i++) {
      const raw = world.getDynamicProperty(i ? LOG + "#" + i : LOG); if (typeof raw !== "string") { pieces = i; break; }
      try { const a = JSON.parse(raw); if (Array.isArray(a)) list = list.concat(a); } catch (e) { /* skip a broken piece */ }
    }
  } catch (e) { list = null; return []; }
  return list;
}
function flush() {
  saveT = null; if (!list) return;
  const parts = []; let cur = [], len = 2;
  for (const r of list) { const t = JSON.stringify(r); if (len + t.length + 1 > MAXLEN && cur.length) { parts.push(cur); cur = []; len = 2; } cur.push(r); len += t.length + 1; }
  if (cur.length || !parts.length) parts.push(cur);
  try {
    parts.forEach((p, i) => world.setDynamicProperty(i ? LOG + "#" + i : LOG, JSON.stringify(p)));
    for (let i = parts.length; i < pieces; i++) world.setDynamicProperty(LOG + "#" + i, undefined);
    pieces = parts.length;
  } catch (e) { console.warn("[hopperlog] save: " + e); }
}
const dirty = () => { if (!saveT) saveT = system.runTimeout(flush, 60); };
/** the record of the hopper that is there now (not removed) */
const live = (k) => load().find((r) => r.k === k && !r.r);
export const hopperList = () => load().slice();

// ---------------------------------------------------------------- events
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    if (block.typeId !== "minecraft:hopper") return;
    const d = block.dimension.id, k = keyOf(d, block.x, block.y, block.z), now = Date.now();
    load();
    for (const r of list) if (r.k === k && !r.r) r.r = ["?", "", now];       // an old record on the same spot: it is gone
    list.unshift({ k, d: DS[d] ?? d, x: block.x, y: block.y, z: block.z, p: [player.name, player.id, now], u: [] });
    if (list.length > MAX) list.length = MAX;
    dirty();
  } catch (e) { /* ignore */ }
}));
safe("use", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    if (ev.isFirstEvent === false || ev.block.typeId !== "minecraft:hopper") return;
    const p = ev.player, b = ev.block;
    if (p.isSneaking && ev.itemStack) return;                                   // placing a block next to it, not opening it
    const k = keyOf(b.dimension.id, b.x, b.y, b.z), name = p.name, id = p.id, now = Date.now();
    system.run(() => {
      let r = live(k);
      if (!r) { r = { k, d: DS[b.dimension.id] ?? "o", x: b.x, y: b.y, z: b.z, p: null, u: [] }; load().unshift(r); if (list.length > MAX) list.length = MAX; }   // an older hopper (placed before the log)
      r.u = (r.u ?? []).filter((u) => u[1] !== id); r.u.unshift([name, id, now]); if (r.u.length > USERS) r.u.length = USERS;
      dirty();
    });
  } catch (e) { /* ignore */ }
}));
safe("break", () => world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation }) => {
  try {
    if (brokenBlockPermutation?.type?.id !== "minecraft:hopper") return;
    const k = keyOf(block.dimension.id, block.x, block.y, block.z), r = live(k);
    if (r) { r.r = [player.name, player.id, Date.now()]; dirty(); }
    else { load().unshift({ k, d: DS[block.dimension.id] ?? "o", x: block.x, y: block.y, z: block.z, p: null, u: [], r: [player.name, player.id, Date.now()] }); if (list.length > MAX) list.length = MAX; dirty(); }
  } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- the tag: an admin looks at a hopper
export const hopperTag = (r) => "§6▼ Hopper §8| §7placed by " + (r?.p ? "§f" + r.p[0] + " §8(" + ago(r.p[2]) + ")" : "§8unknown") + (r?.u?.length ? " §8| §7used by §f" + r.u.slice(0, 3).map((u) => u[0]).join("§7, §f") : " §8| §7nobody used it");
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      if (!isAdminRole(p)) continue;
      const b = p.getBlockFromViewDirection({ maxDistance: 6 })?.block;
      if (!b || b.typeId !== "minecraft:hopper") continue;
      p.onScreenDisplay.setActionBar(hopperTag(live(keyOf(b.dimension.id, b.x, b.y, b.z))));
    } catch (e) { /* ignore */ }
  }
}, 10);
export const hopperDim = (r) => DL[r.d] ?? r.d;

// ---------------------------------------------------------------- the last logout place of every player
const POS = "lastpos:";
const posNow = new Map();
const snap = (p) => { try { const l = p.location; return { d: p.dimension.id, x: Math.floor(l.x * 10) / 10, y: Math.floor(l.y * 10) / 10, z: Math.floor(l.z * 10) / 10, t: Date.now() }; } catch (e) { return null; } };
const savePos = (id, v) => { try { if (v) world.setDynamicProperty(POS + id, JSON.stringify(v)); } catch (e) { /* ignore */ } };
system.runInterval(() => { for (const p of world.getAllPlayers()) { const v = snap(p); if (v) { posNow.set(p.id, v); savePos(p.id, v); } } }, 600);   // every 30 s (a crash keeps a recent one)
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  try { const v = snap(player) ?? posNow.get(player.id); if (v) { v.out = true; v.t = Date.now(); system.run(() => savePos(player.id, v)); } } catch (e) { /* ignore */ }
}));
/** { d, x, y, z, t, out } or null - out = saved when he left (else: his last known place while playing) */
export function lastLogout(id) { try { const v = world.getDynamicProperty(POS + id); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } }
