// STAFF WORLD TOOLS (no menus here - the pages are in staffmenu.js): vanish, area locks, performance report, manual Clear Lag,
// gifts (shards / trade levels / items), death backup + restore, shop control (prices + availability).
// Every public function checks the operator's role again and returns { ok: true, ... } or { err: "text" }; nothing here can throw into the rest of the addon.
import { notice } from "../smp/fxprefs.js";
import { world, system, ItemStack, EnchantmentTypes, EquipmentSlot } from "@minecraft/server";
import { isStaff, opAlert } from "./opcore.js";
import { allow, can, slog, makeStore, readOf, writeOf, online, say, cleanText, shopStore, shopBlocked, vanishedIds } from "./staffcore.js";
import { duelView, duelHold } from "./duelstate.js";
import { STAFF as C } from "./config.js";
import { CATEGORIES } from "../shop_data.js";
import { addShardsById, stats, touch } from "../data.js";
import { xpToReach, progress, MAX_LEVEL } from "../xp.js";
import { resolveItem, addAliases } from "../alias.js";
import { ENCHANTS, ROMAN } from "../books.js";
import { stackValue } from "../value.js";
import { spaceFor, give } from "../inv.js";
import { clearItems, clearMobs, clearMobsOn, setClearMobsOn, resetTimer, setClearLagOn, setClearLagSeconds } from "./clearlag.js";
import { money, num } from "../format.js";

const HOUR = 3600000;
const dimShort = (id) => String(id).replace("minecraft:", "");

// ================================================================ vanish (invisibility effect; the name in the player list can not be hidden by a script)
const vanished = vanishedIds;                                       // shared with staffcore.js / lux.js (see there)
export const isVanished = (p) => vanished.has(p.id);
export function toggleVanish(p) {
  try {
    if (!allow(p, "vanish")) return { err: "No permission." };
    if (vanished.has(p.id)) {
      vanished.delete(p.id);
      try { p.removeEffect("invisibility"); } catch (e) { /* ignore */ }
      slog(p, "vanish", null, "off");
      return { ok: true, on: false };
    }
    vanished.add(p.id);
    try { p.addEffect("invisibility", 200, { amplifier: 0, showParticles: false }); } catch (e) { vanished.delete(p.id); return { err: "Could not turn the invisibility on." }; }
    slog(p, "vanish", null, "on");
    return { ok: true, on: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
system.runInterval(() => {
  try {
    for (const id of [...vanished]) {
      const p = online(id);
      if (!p || !can(p, "vanish")) { vanished.delete(id); if (p) { try { p.removeEffect("invisibility"); } catch (e) { /* ignore */ } } continue; }
      try { p.addEffect("invisibility", 200, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}, 40);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { vanished.delete(playerId); }); } catch (e) { /* ignore */ }

// ================================================================ area locks: a square around the operator that normal players can not enter (operators are never blocked)
const lockStore = makeStore("stf:lock", () => ({ l: [] }));
function locksNow() {
  const st = lockStore.get(); if (!st) return [];
  const now = Date.now(), keep = st.l.filter((z) => !z.u || z.u > now);
  if (keep.length !== st.l.length) { st.l = keep; lockStore.save(); }
  return st.l;
}
export const listLocks = () => locksNow();
export function addLock(actor, radius, ms, reason) {
  try {
    if (!allow(actor, "lock")) return { err: "No permission." };
    if (!C.lockRadii.includes(radius)) return { err: "Choose a size from the list." };
    const why = cleanText(reason, 80); if (why.length < Math.max(1, C.reasonMin)) return { err: "A reason is required (at least " + Math.max(1, C.reasonMin) + " letters)." };
    const st = lockStore.get(); if (!st) return { err: "Could not read the locks." };
    const list = locksNow();
    if (list.length >= C.maxLocks) return { err: "There are already " + C.maxLocks + " locked areas. Unlock one first." };
    const l = actor.location, z = { i: Date.now().toString(36), d: actor.dimension.id, x1: Math.floor(l.x - radius), x2: Math.floor(l.x + radius), z1: Math.floor(l.z - radius), z2: Math.floor(l.z + radius), r: why, by: String(actor.name).slice(0, 32), t: Date.now(), u: ms > 0 ? Date.now() + ms : 0 };
    st.l.push(z);
    if (!lockStore.save()) { st.l.pop(); return { err: "Could not save the lock." }; }
    slog(actor, "lock", null, dimShort(z.d) + " " + Math.floor(l.x) + ", " + Math.floor(l.z) + " r" + radius + " - " + why);
    opAlert("§f" + actor.name + " §clocked an area §7(" + dimShort(z.d) + " " + Math.floor(l.x) + ", " + Math.floor(l.z) + ", size " + (radius * 2) + ") - " + why, { chat: false });
    try { world.sendMessage("§c[Area] §fAn area near §e" + Math.floor(l.x) + ", " + Math.floor(l.z) + " §fis closed by the staff: §7" + why); } catch (e) { /* ignore */ }
    return { ok: true, zone: z };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function removeLock(actor, id) {
  try {
    if (!allow(actor, "lock")) return { err: "No permission." };
    const st = lockStore.get(); if (!st) return { err: "Could not read the locks." };
    const i = st.l.findIndex((z) => z.i === id); if (i < 0) return { err: "Already unlocked." };
    const [z] = st.l.splice(i, 1);
    if (!lockStore.save()) { st.l.splice(i, 0, z); return { err: "Could not save." }; }
    slog(actor, "unlock", null, dimShort(z.d) + " " + z.x1 + ", " + z.z1);
    try { world.sendMessage("§a[Area] §fThe area near §e" + Math.floor((z.x1 + z.x2) / 2) + ", " + Math.floor((z.z1 + z.z2) / 2) + " §fis open again."); } catch (e) { /* ignore */ }
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
const inZone = (z, d, x, zz) => z.d === d && x >= z.x1 && x < z.x2 + 1 && zz >= z.z1 && zz < z.z2 + 1;
const zoneAt = (list, d, x, zz) => list.find((z) => inZone(z, d, x, zz)) ?? null;
const outPos = new Map(), lockMsgAt = new Map();
function exitSpot(p, z) {                                            // nearest edge of the zone (overworld only: the top block is a safe floor there)
  try {
    const l = p.location, dim = p.dimension;
    if (dim.id !== "minecraft:overworld") return null;
    const dl = l.x - z.x1, dr = z.x2 + 1 - l.x, dn = l.z - z.z1, ds = z.z2 + 1 - l.z, m = Math.min(dl, dr, dn, ds);
    let x = l.x, zz = l.z;
    if (m === dl) x = z.x1 - 2; else if (m === dr) x = z.x2 + 3; else if (m === dn) zz = z.z1 - 2; else zz = z.z2 + 3;
    const t = dim.getTopmostBlock({ x: Math.floor(x), z: Math.floor(zz) });
    return t ? { x: Math.floor(x) + 0.5, y: t.y + 1, z: Math.floor(zz) + 0.5 } : null;
  } catch (e) { return null; }
}
function savedSpawn() {
  try {
    const raw = world.getDynamicProperty("spawn:v1"), o = typeof raw === "string" ? JSON.parse(raw) : null;
    if (o && [o.x, o.y, o.z].every((n) => typeof n === "number" && Number.isFinite(n))) return { x: o.x + 0.5, y: o.y, z: o.z + 0.5, d: typeof o.d === "string" ? o.d : "minecraft:overworld" };
  } catch (e) { /* ignore */ }
  return null;
}
system.runInterval(() => {
  try {
    const list = locksNow();
    for (const p of world.getAllPlayers()) {
      try {
        if (isStaff(p)) continue;
        const l = p.location, d = p.dimension.id, z = list.length ? zoneAt(list, d, l.x, l.z) : null;
        if (!z) { outPos.set(p.id, { x: l.x, y: l.y, z: l.z, d }); continue; }
        let inDuel = false; try { inDuel = duelView.bar(p) != null; } catch (e) { inDuel = false; }
        if (inDuel) continue;                                       // a duel round is never moved
        const back = outPos.get(p.id);
        let spot = back && back.d === d && !zoneAt(list, back.d, back.x, back.z) ? back : null;
        if (!spot) spot = exitSpot(p, z);
        if (!spot) { const sp = savedSpawn(); if (sp && !zoneAt(list, sp.d, sp.x, sp.z)) spot = sp; }
        if (spot) { try { p.teleport({ x: spot.x, y: spot.y, z: spot.z }, { dimension: world.getDimension(spot.d ?? d) }); } catch (e) { /* ignore */ } }
        const now = Date.now();
        if (now - (lockMsgAt.get(p.id) ?? 0) > 4000) { lockMsgAt.set(p.id, now); say(p, "§c[Area] This area is closed by the staff. §7Reason: §f" + z.r); }
      } catch (e) { /* ignore this player */ }
    }
  } catch (e) { /* ignore */ }
}, 10);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { outPos.delete(playerId); lockMsgAt.delete(playerId); }); } catch (e) { /* ignore */ }

// ================================================================ performance report (read only)
export function perfReport() {
  const out = { players: 0, dims: [], top: [], hot: [], sampled: false };
  try {
    out.players = world.getAllPlayers().length;
    const types = new Map(), chunks = new Map();
    for (const id of ["overworld", "nether", "the_end"]) {
      let ents = [];
      try { ents = world.getDimension(id).getEntities(); } catch (e) { continue; }
      let items = 0, mobs = 0, n = 0;
      for (const e of ents) {
        if (n++ >= 6000) { out.sampled = true; break; }
        try {
          const t = e.typeId;
          types.set(t, (types.get(t) ?? 0) + 1);
          if (t === "minecraft:player") continue;
          if (t === "minecraft:item") items++; else mobs++;
          const l = e.location, k = id + "|" + Math.floor(l.x / 16) + "|" + Math.floor(l.z / 16);
          chunks.set(k, (chunks.get(k) ?? 0) + 1);
        } catch (err) { /* gone */ }
      }
      out.dims.push({ id, total: ents.length, items, mobs });
    }
    out.top = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => ({ t: t.replace("minecraft:", ""), c }));
    out.hot = [...chunks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => { const [d, cx, cz] = k.split("|"); return { d, x: Number(cx) * 16 + 8, z: Number(cz) * 16 + 8, c }; });
  } catch (e) { /* partial result */ }
  return out;
}

// ================================================================ manual Clear Lag (the normal timer keeps running; it is restarted after a manual clear)
export function runClearLag(actor) {
  try {
    if (!allow(actor, "clearlag")) return { err: "No permission." };
    if (duelHold.until > Date.now()) return { err: "A duel is running - its loot must stay on the ground for now." };
    const n = clearItems(), withMobs = clearMobsOn(), m = withMobs ? clearMobs() : 0;
    try { resetTimer(); } catch (e) { /* ignore */ }
    try { notice("clearlag", "§a[ClearLag] §fCleared §e" + n + " §fdropped item" + (n === 1 ? "" : "s") + (withMobs ? " §fand §e" + m + " §fmob" + (m === 1 ? "" : "s") : "") + " §7(by the staff)."); } catch (e) { /* ignore */ }
    slog(actor, "clearlag", null, n + " items" + (withMobs ? ", " + m + " mobs" : ""));
    return { ok: true, n, m, mobs: withMobs };
  } catch (e) { return { err: "Something went wrong." }; }
}

/** switch the automatic Clear Lag ON / OFF.  Returns { ok, on } or { err } */
export function clearLagSwitch(actor, on) {
  try {
    if (!allow(actor, "clearlag")) return { err: "No permission." };
    const r = setClearLagOn(on);
    if (r.ok) slog(actor, "clearlag", null, "automatic Clear Lag " + (r.on ? "ON" : "OFF"));
    return r;
  } catch (e) { return { err: "Something went wrong." }; }
}
/** switch "Clear lag also removes the mobs" ON / OFF (mobs with a name tag are never removed).  Returns { ok, on } or { err } */
export function clearLagMobsSwitch(actor, on) {
  try {
    if (!allow(actor, "clearlag")) return { err: "No permission." };
    const r = setClearMobsOn(on);
    if (r.ok) slog(actor, "clearlag", null, "Clear Lag deletes mobs " + (r.on ? "ON" : "OFF"));
    return r;
  } catch (e) { return { err: "Something went wrong." }; }
}
/** change the seconds between two automatic clears (30 or more).  Returns { ok, seconds } or { err } */
export function clearLagSetTime(actor, seconds) {
  try {
    if (!allow(actor, "clearlag")) return { err: "No permission." };
    const r = setClearLagSeconds(seconds);
    if (r.ok) slog(actor, "clearlag", null, "Clear Lag every " + r.seconds + " s");
    return r;
  } catch (e) { return { err: "Something went wrong." }; }
}

// ================================================================ gifts: shards, trade levels, items
const DENY_ITEMS = new Set(["command_block", "repeating_command_block", "chain_command_block", "command_block_minecart", "structure_block", "structure_void", "barrier", "bedrock", "jigsaw", "allow", "deny", "border_block", "light_block", "debug_stick", "end_portal_frame", "reinforced_deepslate", "knowledge_book", "spawn_egg"]);
export function giveShards(actor, target, n, note) {
  try {
    if (!allow(actor, "shards")) return { err: "No permission." };
    n = Math.floor(Number(n)); if (!(n >= 1 && n <= 1000000)) return { err: "Type a whole amount from 1 to 1,000,000." };
    if (!target || !target.id) return { err: "Player not found." };
    if (!addShardsById(target.id, n)) return { err: "Could not find the data of " + target.name + "." };
    const t = online(target.id); if (t) { try { touch(t); } catch (e) { /* ignore */ } say(t, "§d[Staff] You received §f" + num(n) + " shards§d."); }
    slog(actor, "shards", target, "+" + num(n) + (note ? " - " + cleanText(note, 60) : ""));
    opAlert("§f" + actor.name + " §7gave §d" + num(n) + " shards §7to §f" + target.name, { chat: false });
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** track: "b" (Buyer) | "s" (Seller).  Adds whole levels (no level rewards are paid); only for players who are online */
export function giveLevels(actor, target, track, n, note) {
  try {
    if (!allow(actor, "levels")) return { err: "No permission." };
    n = Math.floor(Number(n)); if (!(n >= 1 && n <= 100)) return { err: "Type a whole number of levels from 1 to 100." };
    const t = target ? online(target.id) : null; if (!t) return { err: "He must be online." };
    const key = track === "b" ? "bxp" : "sxp", s = stats(t), before = progress(s[key]).level, after = Math.min(MAX_LEVEL, before + n);
    if (after <= before) return { err: "He is already at the maximum level." };
    s[key] = Math.max(s[key], xpToReach(after));
    try { touch(t); } catch (e) { /* ignore */ }
    const nm = track === "b" ? "Buyer" : "Seller";
    say(t, "§d[Staff] Your " + nm + " level is now §f" + after + "§d.");
    slog(actor, "levels", target, nm + " " + before + " > " + after + (note ? " - " + cleanText(note, 50) : ""));
    opAlert("§f" + actor.name + " §7gave §d" + (after - before) + " " + nm + " levels §7to §f" + target.name, { chat: false });
    return { ok: true, before, after };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function giveItem(actor, target, rawId, qty, note) {
  try {
    if (!allow(actor, "giveitem")) return { err: "No permission." };
    const t = target ? online(target.id) : null; if (!t) return { err: "He must be online." };
    const id = String(rawId ?? "").trim().toLowerCase().replace(/^minecraft:/, "").replace(/\s+/g, "_");
    if (!/^[a-z0-9_]{2,48}$/.test(id)) return { err: "Type an item id, like diamond_sword." };
    if (DENY_ITEMS.has(id)) return { err: "That item can't be given from here." };
    qty = Math.floor(Number(qty)); if (!(qty >= 1 && qty <= 2304)) return { err: "The amount must be from 1 to 2304." };
    const r = resolveItem(id, null); if (!r || r.legacy) return { err: "Unknown item: " + id };
    const space = spaceFor(t, id);
    if (space < 0) return { err: "That item does not exist in this game version." };
    if (space < qty) return { err: "His inventory has room for only " + space + "." };
    if (!give(t, id, qty)) return { err: "The item could not be delivered." };
    say(t, "§b[Staff] You received §f" + num(qty) + "x " + id.split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") + "§b.");
    slog(actor, "item", target, qty + "x " + id + (note ? " - " + cleanText(note, 50) : ""));
    opAlert("§f" + actor.name + " §7gave §b" + qty + "x " + id + " §7to §f" + target.name, { chat: false });
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ================================================================ death backup: every few seconds the inventories are copied in memory; when a player dies that copy is saved in the DEATH LOG of the player
// (the last STAFF.deathKeepCount deaths, each kept STAFF.deathKeepHours hours; key "stf:d:<playerId>:<time>" - the old single key "stf:d:<playerId>" is still read as the oldest entry).
// An Admin can give it back (online players only).  Items with contents or special data (shulker boxes, bundles, potions, maps, books ...) can not be copied exactly, so they are NOT restored and are listed instead.
const UNEXACT = /(shulker_box|bundle|potion|tipped_arrow|mob_spawner|written_book|writable_book|filled_map|firework|banner|suspicious_stew|goat_horn|player_head|skull|decorated_pot|trial_key|ominous|ender_chest)/;
const SLOTS = ["Head", "Chest", "Legs", "Feet", "Offhand"];
const SNAP = new Map(), deadNow = new Set();
const PD = "stf:d:";
const priceLine = (l) => /^Sell: \$[\d,]+( each)?$/.test(String(l).replace(/§./g, ""));
function recOf(s, where) {
  const r = { i: s.typeId, n: s.amount, w: where };
  try { if (s.nameTag) r.nm = String(s.nameTag).slice(0, 60); } catch (e) { return null; }
  try { const lore = s.getLore().filter((l) => !priceLine(l)); if (lore.length) r.l = lore.slice(0, 6).map((l) => String(l).slice(0, 80)); } catch (e) { return null; }
  try { const du = s.getComponent("durability"); if (du && du.damage > 0) r.d = du.damage; } catch (e) { return null; }
  try { const en = s.getComponent("enchantable"); if (en) { const l = en.getEnchantments(); if (l.length) r.e = l.map((x) => [String(x.type?.id ?? x.type).replace("minecraft:", ""), x.level]); } } catch (e) { return null; }
  try { if (typeof s.getDynamicPropertyIds === "function" && s.getDynamicPropertyIds().length) return null; } catch (e) { /* ignore */ }
  try { if (s.getComponent("inventory")) return null; } catch (e) { /* no such component = fine */ }                       // items with contents
  try { if (s.lockMode && String(s.lockMode).toLowerCase() !== "none") return null; } catch (e) { /* ignore */ }
  try { if ((s.getCanPlaceOn() ?? []).length || (s.getCanDestroy() ?? []).length) return null; } catch (e) { /* ignore */ }
  try { const dy = s.getComponent("dyeable"), v = dy && dy.color; if (v) r.c = [Math.round(v.red * 255), Math.round(v.green * 255), Math.round(v.blue * 255)]; } catch (e) { /* ignore */ }
  return r;
}
function takeSnap(p) {
  const items = [], skipped = [];
  const add = (s, where) => {
    if (!s) return;
    const label = s.typeId.replace("minecraft:", "") + " x" + s.amount;
    if (UNEXACT.test(s.typeId)) { skipped.push(label); return; }
    const r = recOf(s, where);
    if (r) items.push(r); else skipped.push(label);
  };
  const inv = p.getComponent("inventory")?.container;
  if (inv) for (let i = 0; i < inv.size; i++) add(inv.getItem(i), "i" + i);
  try { const eq = p.getComponent("equippable"); if (eq) for (const nm of SLOTS) add(eq.getEquipment(EquipmentSlot[nm]), nm); } catch (e) { /* ignore */ }
  return { t: Date.now(), items, skipped };
}
system.runInterval(() => {
  try {
    const now = Date.now();
    for (const p of world.getAllPlayers()) {
      try {
        if (deadNow.has(p.id)) continue;
        const hp = p.getComponent("health"); if (hp && hp.currentValue <= 0) continue;
        const prev = SNAP.get(p.id), cur = takeSnap(p);
        if (!cur.items.length && !cur.skipped.length && prev && (prev.items.length || prev.skipped.length) && now - prev.t < 15000) continue;     // keep the last good copy for a moment
        SNAP.set(p.id, cur);
      } catch (e) { /* ignore this player */ }
    }
  } catch (e) { /* ignore */ }
}, Math.max(20, C.deathScanSec * 20));
try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      const d = ev.deadEntity; if (!d || d.typeId !== "minecraft:player") return;
      deadNow.add(d.id);
      const sn = SNAP.get(d.id);
      if (!sn || (!sn.items.length && !sn.skipped.length)) return;
      let cause = "unknown"; try { cause = String(ev.damageSource?.cause ?? "unknown"); } catch (e) { /* ignore */ }
      let killer = ""; try { killer = ev.damageSource?.damagingEntity?.typeId === "minecraft:player" ? ev.damageSource.damagingEntity.name : ""; } catch (e) { /* ignore */ }
      const l = d.location;
      const now = Date.now();
      writeOf(PD + d.id + ":" + now, { t: now, at: sn.t, n: d.name, d: d.dimension.id, x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z), c: cause, k: killer, items: sn.items, skipped: sn.skipped, used: false });
      trimDeaths(d.id);
    } catch (e) { /* ignore */ }
  });
  world.afterEvents.playerSpawn.subscribe(({ player }) => { deadNow.delete(player.id); });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { SNAP.delete(playerId); deadNow.delete(playerId); });
} catch (e) { console.warn("[staff] death backup not started: " + e); }
function purgeOldDeaths() {
  try {
    const cut = Date.now() - C.deathKeepHours * HOUR;
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(PD)) continue;
      const d = readOf(k);
      if (d && typeof d.t === "number" && d.t < cut) writeOf(k, null);
    }
  } catch (e) { /* ignore */ }
}
system.runInterval(purgeOldDeaths, 20 * 60 * 10);
const validDeath = (d) => !!d && typeof d.t === "number" && Array.isArray(d.items) && Array.isArray(d.skipped ?? []) && d.t >= Date.now() - C.deathKeepHours * HOUR;
/** every saved death of a player, NEWEST FIRST: [{ key, d }] (d = the saved record). Expired / broken records are left out */
function deathEntries(id) {
  const out = [], pre = PD + id + ":";
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (k !== PD + id && !k.startsWith(pre)) continue;               // k === PD + id is the old single record
      const d = readOf(k);
      if (!validDeath(d)) continue;
      if (!Array.isArray(d.skipped)) d.skipped = [];
      out.push({ key: k, d });
    }
  } catch (e) { /* ignore */ }
  return out.sort((a, b) => b.d.t - a.d.t);
}
/** keeps only the newest STAFF.deathKeepCount deaths of a player */
function trimDeaths(id) {
  try { const keep = Math.max(1, C.deathKeepCount ?? 10); deathEntries(id).slice(keep).forEach((e) => writeOf(e.key, null)); } catch (e) { /* ignore */ }
}
/** the death log of a player for the menu, newest first: [{ key, d }] */
export function deathLog(id) { return deathEntries(id); }
/** one saved death of a player (or null). Without `key` = the LAST death. The returned record has .key (where it is saved) */
export function deathOf(id, key) {
  const list = deathEntries(id);
  const e = key ? list.find((x) => x.key === key) : list[0];
  return e ? { ...e.d, key: e.key } : null;
}
// ---- read-only preview of the saved inventory (what the Admin sees BEFORE restoring): names, enchantments, durability, sell value and shop price.
const BYTYPE = new Map(); let aliasDone = false;
function lookupItem(typeId) {
  if (!BYTYPE.size) for (const c of CATEGORIES) for (const it of c.items) if (!BYTYPE.has(it[0])) BYTYPE.set(it[0], it);       // same arrays as the shop: current prices
  if (!aliasDone) { try { addAliases(BYTYPE); aliasDone = true; } catch (e) { /* try again next time */ } }
  return BYTYPE.get(String(typeId).replace("minecraft:", ""));
}
const EN_NAME = new Map(ENCHANTS.map((e) => [e.id, e.name]));
const niceId = (id) => String(id).replace("minecraft:", "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
/** { d, rows: [{ w (slot), id, n, name, icon, nm, ench[], pct (durability %, or null), unit (sell value of one), buy (shop price of one) }], sellTotal, shopTotal, enchanted } or null.  Changes nothing. */
export function deathPreview(id, key) {
  try {
    const d = deathOf(id, key); if (!d) return null;
    const rows = []; let sellTotal = 0, shopTotal = 0, enchanted = 0;
    for (const r of d.items) {
      const row = { w: r.w, id: r.i, n: Math.max(1, r.n), name: niceId(r.i), icon: null, nm: r.nm ?? null, ench: (r.e ?? []).map(([e, lv]) => (EN_NAME.get(e) ?? niceId(e)) + " " + (ROMAN[lv] || lv)), pct: null, unit: 0, buy: 0 };
      try {
        const it = lookupItem(r.i);
        if (it) { row.name = it[1]; row.icon = it[2]; row.buy = it[3]; }
        const st = new ItemStack(r.i, row.n);
        if (r.nm) st.nameTag = r.nm;
        if (r.l && r.l.length) st.setLore(r.l);
        const du = st.getComponent("durability");
        if (du) { if (r.d) du.damage = Math.min(r.d, du.maxDurability); if (du.maxDurability > 0) row.pct = Math.round(100 * (du.maxDurability - du.damage) / du.maxDurability); }
        const en = st.getComponent("enchantable");
        if (en && r.e) for (const [eid, lv] of r.e) { try { const type = EnchantmentTypes.get(eid) ?? EnchantmentTypes.get("minecraft:" + eid); if (type) en.addEnchantment({ type, level: lv }); } catch (e2) { /* ignore */ } }
        if (it) row.unit = stackValue(st, it).unit;
      } catch (e) { /* the row is still shown, just without the price */ }
      if (row.ench.length) enchanted++;
      sellTotal += row.unit * row.n; shopTotal += row.buy * row.n;
      rows.push(row);
    }
    return { d, rows, sellTotal, shopTotal, enchanted };
  } catch (e) { return null; }
}
export function restoreDeath(actor, target, key) {
  try {
    if (!allow(actor, "restore")) return { err: "No permission." };
    const t = target ? online(target.id) : null; if (!t) return { err: "He must be online." };
    const d = deathOf(target.id, key); if (!d) return { err: "No saved death for this player." };
    const saveKey = d.key; delete d.key;                              // the key is only the place where it is saved
    if (d.used) return { err: "This death was already restored." };
    d.used = true;                                                   // marked FIRST: a second click can never give the items twice
    if (!writeOf(saveKey, d)) return { err: "Could not save - nothing was given." };
    const inv = t.getComponent("inventory")?.container; if (!inv) { d.used = false; writeOf(saveKey, d); return { err: "Could not open his inventory." }; }
    let given = 0, failed = 0, dropped = 0;
    for (const r of d.items) {
      try {
        const st = new ItemStack(r.i, Math.max(1, r.n));
        if (r.nm) st.nameTag = r.nm;
        if (r.l && r.l.length) st.setLore(r.l);
        if (r.d) { const du = st.getComponent("durability"); if (du) du.damage = Math.min(r.d, du.maxDurability); }
        if (r.c) { const dy = st.getComponent("dyeable"); if (dy) dy.color = { red: r.c[0] / 255, green: r.c[1] / 255, blue: r.c[2] / 255 }; }
        if (r.e && r.e.length) {
          const en = st.getComponent("enchantable");
          for (const [id, lv] of r.e) { try { const type = EnchantmentTypes.get(id) ?? EnchantmentTypes.get("minecraft:" + id); if (type && en) en.addEnchantment({ type, level: lv }); else failed++; } catch (e) { failed++; } }
        }
        const rest = inv.addItem(st);
        if (rest) { try { t.dimension.spawnItem(rest, t.location); dropped++; } catch (e) { failed++; } }
        given++;
      } catch (e) { failed++; }
    }
    say(t, "§6[Staff] Your inventory from before you died was restored (" + given + " stacks" + (dropped ? ", " + dropped + " dropped at your feet because the inventory was full" : "") + ").");
    slog(actor, "restore", target, given + " stacks" + (failed ? ", " + failed + " failed" : "") + (d.skipped.length ? ", " + d.skipped.length + " not copied" : ""));
    opAlert("§f" + actor.name + " §6restored an inventory §7of §f" + target.name + " §7(died " + new Date(d.t).toISOString().slice(0, 16).replace("T", " ") + " UTC, " + given + " stacks)", { chat: false });
    return { ok: true, given, failed, dropped, skipped: d.skipped.length };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ================================================================ shop control: change a money price, or make an item temporarily unavailable.
// The catalogue arrays are edited in place (everything that reads the price afterwards sees the new one); the originals are remembered for "Reset".
// Safety: a sell price can never be more than STAFF.shopSellRatio of the buy price, and an item that can not be sold can not be made sellable.
const ALL = new Map(), ORIG = new Map(), NAMES = [];
for (const c of CATEGORIES) {
  for (const it of c.items) {
    let a = ALL.get(it[0]);
    if (!a) { a = []; ALL.set(it[0], a); ORIG.set(it[0], [it[3], it[4]]); NAMES.push({ id: it[0], name: it[1], icon: it[2], cat: c.name }); }
    a.push(it);
  }
}
function setArrays(id, buy, sell) { const a = ALL.get(id); if (!a) return false; for (const it of a) { it[3] = buy; it[4] = sell; } return true; }
let applied = false;
function applyShop() {
  if (applied) return true;
  const st = shopStore.get(); if (!st) return false;
  try {
    for (const id of Object.keys(st.p ?? {})) { const v = st.p[id]; if (Array.isArray(v) && ORIG.has(id)) setArrays(id, v[0], v[1]); }
    applied = true;
  } catch (e) { console.warn("[staff] shop prices not applied: " + e); applied = true; }
  return true;
}
system.run(() => {
  try {
    if (applyShop()) return;
    let n = 0; const h = system.runInterval(() => { try { if (applyShop() || ++n > 30) system.clearRun(h); } catch (e) { system.clearRun(h); } }, 20);
  } catch (e) { /* ignore */ }
});
export const shopItems = () => NAMES;
export const shopCategories = () => CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon, items: c.items.map((it) => it[0]) }));
export const shopInfo = (id) => { const a = ALL.get(id)?.[0], o = ORIG.get(id); return a ? { id, name: a[1], icon: a[2], buy: a[3], sell: a[4], origBuy: o[0], origSell: o[1], changed: a[3] !== o[0] || a[4] !== o[1], blocked: shopBlocked(id) } : null; };
export const shopChangedCount = () => { try { const st = shopStore.get(); return st ? Object.keys(st.p).length + Object.keys(st.b).length : 0; } catch (e) { return 0; } };
export function setShopPrice(actor, id, buy, sell) {
  try {
    if (!allow(actor, "shop")) return { err: "No permission." };
    const cur = shopInfo(id); if (!cur) return { err: "Unknown shop item." };
    buy = Math.floor(Number(buy)); sell = Math.floor(Number(sell));
    if (!(buy >= 1 && buy <= 1000000000)) return { err: "The buy price must be from 1 to 1,000,000,000." };
    if (!(sell >= 0)) return { err: "The sell price can't be negative." };
    if (cur.origSell <= 0 && sell > 0) return { err: "This item can't be sold in the shop, so it can't be made sellable." };
    const max = Math.floor(buy * C.shopSellRatio);
    if (sell > max) return { err: "The sell price can be at most " + money(max) + " (" + Math.round(C.shopSellRatio * 100) + "% of the buy price)." };
    const st = shopStore.get(); if (!st) return { err: "Could not read the shop settings." };
    const old = st.p[id];
    if (buy === cur.origBuy && sell === cur.origSell) delete st.p[id]; else st.p[id] = [buy, sell];
    if (Object.keys(st.p).length > 200) { if (old) st.p[id] = old; else delete st.p[id]; return { err: "Too many changed prices (200). Reset some first." }; }
    if (!shopStore.save()) { if (old) st.p[id] = old; else delete st.p[id]; return { err: "Could not save." }; }
    setArrays(id, buy, sell);
    slog(actor, "price", null, cur.name + ": buy " + money(cur.buy) + " > " + money(buy) + ", sell " + money(cur.sell) + " > " + money(sell));
    opAlert("§f" + actor.name + " §6changed the price of §f" + cur.name + " §7(buy " + money(buy) + ", sell " + money(sell) + ")", { chat: false });
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function resetShopPrice(actor, id) {
  const o = ORIG.get(id); if (!o) return { err: "Unknown shop item." };
  return setShopPrice(actor, id, o[0], o[1]);
}
export function setShopBlocked(actor, id, on) {
  try {
    if (!allow(actor, "shop")) return { err: "No permission." };
    const cur = shopInfo(id); if (!cur) return { err: "Unknown shop item." };
    const st = shopStore.get(); if (!st) return { err: "Could not read the shop settings." };
    if (on) { if (Object.keys(st.b).length >= 100) return { err: "Too many switched-off items (100)." }; st.b[id] = 1; } else delete st.b[id];
    if (!shopStore.save()) { if (on) delete st.b[id]; else st.b[id] = 1; return { err: "Could not save." }; }
    slog(actor, "block", null, cur.name + (on ? ": switched OFF" : ": switched ON"));
    opAlert("§f" + actor.name + " §6switched §f" + cur.name + (on ? " §coff" : " §aon") + " §7in the shop", { chat: false });
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
