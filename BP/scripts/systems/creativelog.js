// CREATIVE LOG.  Every time ANYBODY (member, helper, mod, admin, owner) is in Creative mode, one entry (a "session") is saved for the operators:
//   * who, his role, which game mode he came from, when it started / ended (or "left the game in Creative")
//   * every item that APPEARED in his inventory / armor / off-hand while he was in Creative (kind + amount).  What he already carried when he
//     switched does not count; items he only moves around do not count.  Contents of shulker boxes / bundles are not opened.
// Shown in: Operator > Logs > Creative log (pages in staffmenu.js).  Members who switch to Creative also send an alert to the operators.
// Detection is a 0.5 s check of the game mode (works however the mode was changed: /gamemode, an operator tool, a command block ...).
// Saved in a few world properties ("crelog:*", newest first, oldest entries are replaced when full).  Everything is in try/catch: nothing here can throw.
import { world, system, EquipmentSlot, GameMode } from "@minecraft/server";
import { isStaff, opAlert } from "./opcore.js";
import { roleOf, isOwner, isOwnerId, slog } from "./staffcore.js";
import { menuMsg } from "./menulang.js";

const KEY = "crelog:", CHUNK = 24000, MAX_CHUNKS = 6, CAP = 120, TYPES = 40;

// The Owner can also BLOCK a player from Creative (saved apart): the moment he is in Creative he is sent back to Survival.
// ---------------------------------------------------------------- storage  { t: start, e: end (0 = running, -1 = unknown), i: id, p: name, r: role or "", f: mode before ("" = joined in Creative), l: 1 = left the game in Creative,
//   it: { item: amount } = items that appeared, x: amount of items over the type limit, b: { item: amount } = inventory when he switched, a: { item: amount } = inventory at the last change / when he left Creative,
//   k: 1 = he tried while blocked (no inventory kept) }
let list = null, dirty = false, saveT = null;
function load() {
  if (list) return list;
  try {
    const n = world.getDynamicProperty(KEY + "n"), cnt = Number.isInteger(n) ? n : 0, out = [];
    for (let i = 0; i < cnt; i++) {
      const raw = world.getDynamicProperty(KEY + i);
      if (typeof raw !== "string") continue;
      try { const a = JSON.parse(raw); if (Array.isArray(a)) out.push(...a); } catch (e) { /* skip a broken piece */ }
    }
    for (const e of out) if (e && !e.e) e.e = -1;                    // a session that was running when the server stopped: end time unknown
    list = out;
  } catch (e) { return null; }                                        // world not ready: never overwrite saved data
  return list;
}
function flush() {
  saveT = null;
  if (!dirty || !list) return;
  dirty = false;
  try {
    const chunks = []; let cur = [], len = 2;
    for (const e of list) {
      const s = JSON.stringify(e).length + 1;
      if (len + s > CHUNK && cur.length) { chunks.push(cur); cur = []; len = 2; }
      cur.push(e); len += s;
    }
    if (cur.length) chunks.push(cur);
    if (chunks.length > MAX_CHUNKS) { chunks.length = MAX_CHUNKS; list.length = chunks.reduce((a, c) => a + c.length, 0); }
    chunks.forEach((c, i) => world.setDynamicProperty(KEY + i, JSON.stringify(c)));
    const old = world.getDynamicProperty(KEY + "n");
    for (let i = chunks.length; i < (Number.isInteger(old) ? old : 0); i++) world.setDynamicProperty(KEY + i, undefined);
    world.setDynamicProperty(KEY + "n", chunks.length);
  } catch (e) { dirty = true; console.warn("[creativelog] save failed: " + e); }
}
function touch() { dirty = true; if (!saveT) saveT = system.runTimeout(flush, 100); }
world.afterEvents.playerLeave.subscribe(() => { try { flush(); } catch (e) { /* ignore */ } });

// ---------------------------------------------------------------- reading (for the menu)
/** all sessions, newest first */
export const creativeEntries = () => { const l = load(); return l ? l.slice() : []; };
/** deletes ONE entry (Owner only: the menu checks it).  A session that is still running can't be deleted.  Returns true when it was removed. */
export function deleteCreativeEntry(e) {
  try {
    const l = load(); if (!l || !e) return false;
    let i = l.indexOf(e);
    if (i < 0) i = l.findIndex((x) => x.t === e.t && x.i === e.i && x.k === e.k && x.e === e.e);
    if (i < 0) return false;
    if (act.has(l[i].i) && l[i].e === 0) return false;                  // he is in Creative right now
    l.splice(i, 1); touch();
    return true;
  } catch (err) { console.warn("[creativelog] delete failed: " + err); return false; }
}
/** ids of the players who are in Creative right now */
export const creativeActiveIds = () => new Set(act.keys());

// ---------------------------------------------------------------- Owner: block a player from Creative  { playerId: name }
let ban = null;
function loadBan() {
  if (ban) return ban;
  try { const raw = world.getDynamicProperty(KEY + "ban"), o = typeof raw === "string" ? JSON.parse(raw) : {}; ban = o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return null; }
  return ban;
}
/** [{ id, name }] of the players blocked from Creative */
export const creativeBlocked = () => { const b = loadBan(); return b ? Object.entries(b).map(([id, name]) => ({ id, name: String(name) })) : []; };
export const isCreativeBlocked = (id) => { const b = loadBan(); return !!b && Object.prototype.hasOwnProperty.call(b, id); };
/** only the Owner; the Owner himself can never be blocked */
export function setCreativeBlock(actor, id, name, on) {
  if (!isOwner(actor)) return { err: "Only the Owner can block or allow Creative." };
  if (!id || isOwnerId(id)) return { err: "The Owner can't be blocked." };
  const b = loadBan(); if (!b) return { err: "The settings could not be read yet. Try again in a moment." };
  const had = Object.prototype.hasOwnProperty.call(b, id), old = b[id];
  if (on) b[id] = String(name ?? "").slice(0, 32); else delete b[id];
  try { world.setDynamicProperty(KEY + "ban", JSON.stringify(b)); } catch (e) { if (had) b[id] = old; else delete b[id]; return { err: "Could not save." }; }
  slog(actor, "crelock", { id, name }, on ? "blocked from Creative" : "Creative allowed again");
  return { ok: true };
}
// ---------------------------------------------------------------- Owner: FORCE SURVIVAL  { p: 1 = on for every normal player, a: 1 = on for the operators (helper / mod / admin) }
//   While it is on nobody in that group can be in Creative: he is sent back to Survival within 0.1 s, also when he joins the game in Creative.
//   The Owner is never forced.  Only the Owner can switch it (checked again here).
let force = null;
function loadForce() {
  if (force) return force;
  try { const raw = world.getDynamicProperty(KEY + "force"), o = typeof raw === "string" ? JSON.parse(raw) : {}; force = { p: o && o.p ? 1 : 0, a: o && o.a ? 1 : 0 }; } catch (e) { return null; }
  return force;
}
/** { players: bool, admins: bool } */
export const forceState = () => { const f = loadForce(); return { players: !!(f && f.p), admins: !!(f && f.a) }; };
/** is this player forced to stay out of Creative right now? (never the Owner) */
export function isForcedSurvival(p) {
  try {
    const f = loadForce(); if (!f || (!f.p && !f.a) || !p || isOwner(p)) return false;
    return isStaff(p) ? !!f.a : !!f.p;
  } catch (e) { return false; }
}
/** only the Owner.  which = "players" | "admins" */
export function setForceSurvival(actor, which, on) {
  if (!isOwner(actor)) return { err: "Only the Owner can do this." };
  const key = which === "admins" ? "a" : which === "players" ? "p" : null; if (!key) return { err: "Unknown option." };
  const f = loadForce(); if (!f) return { err: "The settings could not be read yet. Try again in a moment." };
  const old = f[key]; f[key] = on ? 1 : 0;
  try { world.setDynamicProperty(KEY + "force", JSON.stringify(f)); } catch (e) { f[key] = old; return { err: "Could not save." }; }
  slog(actor, "crelock", { id: "all", name: which === "admins" ? "All operators" : "All players" }, on ? "Force Survival ON" : "Force Survival OFF");
  if (on) sweepForced();
  return { ok: true };
}
// sends everybody who is forced and in Creative back to Survival (used when the switch is turned on, when somebody joins, and by the fast check)
function sweepForced(only) {
  try {
    for (const p of only ? [only] : world.getAllPlayers()) {
      try {
        if (!isForcedSurvival(p)) continue;
        if (String(p.getGameMode()).toLowerCase() !== "creative") continue;
        const a = act.get(p.id); if (a) finish(p.id, a, false, p);
        blockedTry(p, mode.get(p.id));
      } catch (e) { /* one player never stops the others */ }
    }
  } catch (e) { /* ignore */ }
}
system.runInterval(() => { try { const f = force; if (f ? (f.p || f.a) : loadForce()) sweepForced(); } catch (e) { /* ignore */ } }, 2);
world.afterEvents.playerSpawn.subscribe((ev) => { try { if (ev.initialSpawn) { system.runTimeout(() => sweepForced(ev.player), 1); system.runTimeout(() => sweepForced(ev.player), 20); } } catch (e) { /* ignore */ } });

const lastMsg = new Map();                                            // player id -> when he last got the "not allowed" chat message
const lastTry = new Map();                                            // player id -> when his last blocked try was saved (one entry per 30 s)
function blockedTry(p, was) {
  try { p.setGameMode(GameMode.Survival); } catch (e) { /* ignore */ }
  mode.set(p.id, "survival");
  const now = Date.now();
  if (now - (lastMsg.get(p.id) ?? 0) > 3000) { lastMsg.set(p.id, now); try { p.sendMessage(menuMsg(p, isForcedSurvival(p) ? "§c[Creative] Survival mode is forced on the server. Creative is not allowed." : "§c[Creative] You are not allowed to use Creative mode.")); } catch (e) { /* ignore */ } }
  const l = load();
  if (!l || now - (lastTry.get(p.id) ?? 0) < 30000) return;
  lastTry.set(p.id, now);
  let role = ""; try { role = roleOf(p) || ""; } catch (e) { role = ""; }
  l.unshift({ t: now, e: now, i: p.id, p: p.name, r: role, f: was ?? "", it: {}, x: 0, k: 1 }); if (l.length > CAP) l.length = CAP; touch();
}

// ---------------------------------------------------------------- the check
const act = new Map();                                                // player id -> { e: entry, prev: Map(item -> amount) }
const mode = new Map();                                               // player id -> last game mode seen
const short = (id) => String(id).replace("minecraft:", "");
const SLOTS = () => [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
function counts(p) {
  const m = new Map(), add = (it) => { if (it) m.set(it.typeId, (m.get(it.typeId) ?? 0) + it.amount); };
  try { const c = p.getComponent("minecraft:inventory")?.container; if (c) for (let i = 0; i < c.size; i++) add(c.getItem(i)); } catch (e) { /* ignore */ }
  try { const q = p.getComponent("minecraft:equippable"); if (q) for (const s of SLOTS()) add(q.getEquipment(s)); } catch (e) { /* ignore */ }
  return m;
}
const compact = (m) => { const o = {}; let n = 0; for (const [id, c] of m) { if (n++ >= 45) break; o[short(id)] = c; } return o; };
function begin(p, from) {
  const l = load(); if (!l) return null;
  let role = ""; try { role = roleOf(p) || ""; } catch (e) { role = ""; }
  const first = counts(p), e = { t: Date.now(), e: 0, i: p.id, p: p.name, r: role, f: from, it: {}, x: 0, b: compact(first) };
  l.unshift(e); if (l.length > CAP) l.length = CAP;
  const a = { e, prev: first }; act.set(p.id, a); touch();
  try { if (!isStaff(p)) opAlert("§e[Logs] §f" + p.name + " §7switched to §dCreative §7mode §8(Operator > Logs > Creative log)"); } catch (x) { /* ignore */ }
  return a;
}
function take(p, a) {
  const cur = counts(p); let changed = false;
  for (const [id, n] of cur) {
    const d = n - (a.prev.get(id) ?? 0); if (d <= 0) continue;
    const k = short(id), it = a.e.it;
    if (it[k] !== undefined) it[k] += d; else if (Object.keys(it).length < TYPES) it[k] = d; else a.e.x += d;
    changed = true;
  }
  a.prev = cur;
  if (changed) { a.e.a = compact(cur); touch(); }
}
function finish(id, a, left, p) {
  a.e.e = Date.now(); if (left) a.e.l = 1;
  if (p) { try { a.e.a = compact(counts(p)); } catch (x) { /* keep the last one */ } }
  act.delete(id); touch();
}

system.runInterval(() => {
  try {
    if (!load()) return;
    const online = new Set();
    for (const p of world.getAllPlayers()) {
      try {
        online.add(p.id);
        const gm = String(p.getGameMode()).toLowerCase(), was = mode.get(p.id); mode.set(p.id, gm);
        const a = act.get(p.id);
        if (gm === "creative" && !isOwner(p) && (isCreativeBlocked(p.id) || isForcedSurvival(p))) { if (a) finish(p.id, a, false, p); blockedTry(p, was); continue; }
        if (gm === "creative") { if (!a) begin(p, was ?? ""); else take(p, a); }
        else if (a) finish(p.id, a, false, p);
      } catch (e) { /* one player never stops the others */ }
    }
    for (const [id, a] of [...act]) if (!online.has(id)) finish(id, a, true, null);        // left the game while in Creative
    for (const id of [...mode.keys()]) if (!online.has(id)) mode.delete(id);
  } catch (e) { /* ignore */ }
}, 10);
