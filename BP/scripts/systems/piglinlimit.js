// ===================================================================================================================
// GOLD FARM LIMIT (less lag)  -  Admin / Owner: /opr > World > Gold farm
//   * at most N Zombified Piglins in every area of 8 x 8 chunks (128 x 128 blocks), N = 10 / 20 / 30 / 50 (or OFF).
//     Every 5 s the extra ones are removed (no drops).  Named piglins (name tag) are never removed.
//   * what a Zombified Piglin drops when it dies (gold nuggets, gold ingots, rotten flesh, swords) disappears after
//     10 / 20 / 30 s (or never) if nobody picked it up.  The XP orbs are not touched.
// Saved in the world ("pig:max", "pig:drop").  No lag: one entity query per dimension every 5 s.
// ===================================================================================================================
import { world, system } from "@minecraft/server";

const PIG = "minecraft:zombie_pigman", AREA = 128, DIMS = ["minecraft:overworld", "minecraft:nether"];
export const PIG_MAXES = [10, 20, 30, 50, 0], PIG_DROPS = [10, 20, 30, 0];
const getW = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "number" ? v : d; } catch (e) { return d; } };
export const pigMax = () => getW("pig:max", 10);
export const pigDrop = () => getW("pig:drop", 10);
export function setPig(key, v) { try { world.setDynamicProperty(key === "max" ? "pig:max" : "pig:drop", v); return true; } catch (e) { return false; } }

// ---- the limit
system.runInterval(() => {
  const max = pigMax(); if (!max) return;
  for (const d of DIMS) {
    let list; try { list = world.getDimension(d).getEntities({ type: PIG }); } catch (e) { continue; }
    if (list.length <= max) continue;
    const areas = new Map();
    for (const e of list) {
      try { if (e.nameTag) continue; const l = e.location, k = Math.floor(l.x / AREA) + "," + Math.floor(l.z / AREA); let a = areas.get(k); if (!a) areas.set(k, (a = [])); a.push(e); } catch (x) { /* gone */ }
    }
    for (const a of areas.values()) {
      if (a.length <= max) continue;
      for (const e of a.slice(max)) { try { e.remove(); } catch (x) { /* ignore */ } }
    }
  }
}, 100);

// ---- the drops vanish
const deaths = [];                   // { d, x, y, z, t } of the last ticks
const expire = new Map();            // item entity -> tick when it is removed
world.afterEvents.entityDie.subscribe(({ deadEntity: e }) => {
  try {
    if (e?.typeId !== PIG || !pigDrop()) return;
    const l = e.location; deaths.push({ d: e.dimension.id, x: l.x, y: l.y, z: l.z, t: system.currentTick });
    if (deaths.length > 64) deaths.splice(0, deaths.length - 64);
  } catch (x) { /* ignore */ }
});
world.afterEvents.entitySpawn.subscribe(({ entity: e }) => {
  try {
    if (!deaths.length || e?.typeId !== "minecraft:item") return;
    const t = system.currentTick, l = e.location, d = e.dimension.id;
    if (deaths.some((k) => t - k.t <= 2 && k.d === d && Math.abs(k.x - l.x) < 2.5 && Math.abs(k.y - l.y) < 2.5 && Math.abs(k.z - l.z) < 2.5)) expire.set(e, t + pigDrop() * 20);
  } catch (x) { /* ignore */ }
});
system.runInterval(() => {
  const t = system.currentTick;
  while (deaths.length && t - deaths[0].t > 2) deaths.shift();
  for (const [e, at] of expire) {
    let ok = false; try { ok = typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (x) { ok = false; }
    if (!ok) { expire.delete(e); continue; }
    if (t >= at) { try { e.remove(); } catch (x) { /* ignore */ } expire.delete(e); }
  }
}, 10);
