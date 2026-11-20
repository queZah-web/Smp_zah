// ===================================================================================================================
// VILLAGER RESTOCK - the trades of a villager come back 20 minutes after a player traded with him
//   (+ at the end: a villager spawn egg gives a villager WITHOUT a job)
//
//   * a player opens the trades of a villager (right-click) -> that villager gets a restock time: now + 20 min
//     (saved ON the villager: it keeps counting while nobody is there, after a restart, when the player leaves the
//     server and comes back later; the next time the villager is near a player and the time is over, he restocks at once)
//   * while the time runs, a TIMER shows above the villager (e.g. "⟳ 14:52") - only while a player is within
//     5 blocks of him; walk away and it disappears, come back and it shows again.  A villager with a real name keeps it
//     (the timer is shown under the name, and the name comes back alone afterwards).
//   * restock = the game's own resupply of the villager (the same thing that happens when he works at his job block):
//     every trade that was used up (the red X) can be used again.  Happy particles + a sound.
//   Why "20 min after the trade" and not "when the X shows": the game does not tell scripts when a trade is used up,
//   so the timer starts with the first trade; trades used later in those 20 minutes come back with the same restock.
// No lag: only the villagers near players are looked at, once a second.
// ===================================================================================================================
import { world, system } from "@minecraft/server";

const RESTOCK_MS = 20 * 60 * 1000, SHOW_R = 5, SCAN_R = 12;
const PROP = "smp:restock", NAME = "smp:rname", MARK = "§e⟳ ";
const VILLAGER = "minecraft:villager_v2";
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (x) { return false; } };
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// the profession (mark_variant) -> the event that puts back his normal "work" schedule
const WORK = { 1: "minecraft:schedule_work_farmer", 2: "minecraft:schedule_work_fisher", 5: "minecraft:schedule_work_librarian" };
const PRO = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);           // 0 = unskilled, 14 = nitwit: no trades
function scheduleNow(v) {                                                     // the schedule event of this hour (the villager's own clock)
  const t = world.getTimeOfDay(), job = v.getComponent("minecraft:variant")?.value ?? 0;
  const work = WORK[job] ?? "minecraft:schedule_work_pro_villager";
  if (t < 8000) return work;
  if (t < 10000) return "minecraft:schedule_gather_villager";
  if (t < 11000) return work;
  if (t < 12000) return "minecraft:schedule_home_villager";
  return "minecraft:schedule_bed_villager";
}
/** the game's resupply: the resupply group is taken off (a schedule event), put on again (= the trades are refilled), then the
 *  normal schedule of this hour is set again, so the villager goes on with his day as before */
function restock(v) {
  try { v.triggerEvent("minecraft:schedule_gather_villager"); } catch (e) { /* ignore */ }
  system.runTimeout(() => {
    if (!alive(v)) return;
    try { v.triggerEvent("minecraft:resupply_trades"); } catch (e) { /* ignore */ }
    system.runTimeout(() => {
      if (!alive(v)) return;
      try { v.triggerEvent(scheduleNow(v)); } catch (e) { /* ignore */ }
      try { v.dimension.spawnParticle("minecraft:villager_happy", { x: v.location.x, y: v.location.y + 2.1, z: v.location.z }); v.dimension.playSound("mob.villager.yes", v.location); } catch (e) { /* ignore */ }
    }, 2);
  }, 2);
}

// ---------------------------------------------------------------- the label (only while a player is close)
function realName(v) { try { const n = v.getDynamicProperty(NAME); return typeof n === "string" ? n : null; } catch (e) { return null; } }
function showLabel(v, left) {
  try {
    const cur = v.nameTag ?? "";
    if (!cur.includes(MARK)) { try { v.setDynamicProperty(NAME, cur); } catch (e) { /* ignore */ } }   // keep a real name the villager had
    const nm = realName(v) ?? "";
    const text = (nm ? nm + "\n" : "") + MARK + "§f" + fmt(left);
    if (v.nameTag !== text) v.nameTag = text;
  } catch (e) { /* ignore */ }
}
function hideLabel(v) {
  try {
    if (!(v.nameTag ?? "").includes(MARK)) return;
    v.nameTag = realName(v) ?? "";
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- trading starts the 20 minutes
try {
  world.afterEvents.playerInteractWithEntity.subscribe(({ target }) => {
    try {
      if (!target || target.typeId !== VILLAGER) return;
      const job = target.getComponent("minecraft:variant")?.value ?? 0;
      if (!PRO.has(job)) return;
      const t = target.getDynamicProperty(PROP);
      if (typeof t === "number" && t > Date.now()) return;                   // already counting
      target.setDynamicProperty(PROP, Date.now() + RESTOCK_MS);
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[restock] trade: " + e); }

// ---------------------------------------------------------------- once a second: the villagers near players
system.runInterval(() => {
  const now = Date.now(), seen = new Set();
  for (const p of world.getAllPlayers()) {
    let list = [];
    try { list = p.dimension.getEntities({ type: VILLAGER, location: p.location, maxDistance: SCAN_R }); } catch (e) { continue; }
    for (const v of list) {
      if (seen.has(v.id)) continue;
      let t; try { t = v.getDynamicProperty(PROP); } catch (e) { continue; }
      if (typeof t !== "number") { if ((v.nameTag ?? "").includes(MARK)) hideLabel(v); continue; }
      if (now >= t) { seen.add(v.id); try { v.setDynamicProperty(PROP, undefined); } catch (e) { /* ignore */ } hideLabel(v); restock(v); continue; }
      // the timer: shown only if ANY player is within 5 blocks
      let close = false;
      for (const q of world.getAllPlayers()) { if (q.dimension.id !== v.dimension.id) continue; const a = q.location, b = v.location; if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 <= SHOW_R * SHOW_R) { close = true; break; } }
      seen.add(v.id);
      if (close) showLabel(v, t - now); else hideLabel(v);
    }
  }
}, 20);

// ===================================================================================================================
// VILLAGER SPAWN EGG -> a villager WITHOUT a job (the player gives him the job he wants: he takes the first free job block)
//   The game gives an egg villager a random job.  When a player uses a villager egg on a block, the villager that appears
//   there (within 3 ticks, 3 blocks) is replaced at once by a jobless adult villager (the game's own "become unskilled" spawn).
// ===================================================================================================================
const eggUses = [];                                   // { d, x, y, z, t }
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      if (ev.itemStack?.typeId !== "minecraft:villager_spawn_egg") return;
      const b = ev.block;
      if (/mob_spawner|smp:spawner/.test(b.typeId)) return;                  // an egg used on a spawner is not a villager spawn
      eggUses.push({ d: b.dimension.id, x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5, t: system.currentTick });
      if (eggUses.length > 30) eggUses.shift();
    } catch (e) { /* ignore */ }
  });
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try {
      if (!eggUses.length || entity.typeId !== VILLAGER) return;
      const l = entity.location, d = entity.dimension.id, now = system.currentTick;
      const k = eggUses.findIndex((u) => u.d === d && now - u.t <= 3 && Math.abs(u.x - l.x) < 3 && Math.abs(u.y - l.y) < 3 && Math.abs(u.z - l.z) < 3);
      if (k < 0) return;
      eggUses.splice(k, 1);
      const dim = entity.dimension, at = { x: l.x, y: l.y, z: l.z };
      let rot = 0; try { rot = entity.getRotation().y; } catch (e) { rot = 0; }
      const name = entity.nameTag;
      entity.remove();
      let v = null;
      try { v = dim.spawnEntity(VILLAGER + "<minecraft:become_unskilled>", at); } catch (e) { v = null; }
      if (!v) { try { dim.runCommand(`summon ${VILLAGER} ${at.x.toFixed(2)} ${at.y.toFixed(2)} ${at.z.toFixed(2)} ${rot.toFixed(0)} 0 minecraft:become_unskilled`); } catch (e) { /* ignore */ } }
      else { try { if (name) v.nameTag = name; v.setRotation({ x: 0, y: rot }); } catch (e) { /* ignore */ } }
    } catch (e) { console.warn("[restock] egg: " + e); }
  });
} catch (e) { console.warn("[restock] egg setup: " + e); }
