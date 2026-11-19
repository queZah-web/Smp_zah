// Death loot: what a player drops when he DIES is never removed by Clear lag. It stays on the ground for 30 minutes (so /back is useful), then it is removed.
//   * the drops of a death are found right after the death (they were just spawned next to the place of death) and get the tag "death_loot" + an end time (dynamic property "dl:exp")
//   * clearlag.js skips every item with the tag "death_loot";  itemtimer.js shows a 30-minute countdown above it
//   * a dropped item normally disappears after 5 minutes by itself: so every ~3.5 minutes the item is put back in the same place (same stack, same tags, same end time) - its own 5 minute clock starts again
//   * after the 30 minutes the item is removed.  Deaths in the 1 vs 1 duel arena are NOT included (same rule as /back); Hearts are not touched (they have their own rules)
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
// IMPORTANT: imported BEFORE duel.js (systems/index.js), like back.js, so that the death handler still sees the duel state.
import { world, system } from "@minecraft/server";
import { ex } from "../smp/store.js";
import { duelView } from "./duelstate.js";
import { isHeart } from "../heartids.js";

export const DEATH_LOOT_MIN = 30;                       // minutes on the ground
const TAG = "death_loot", EXP = "dl:exp", REF = "dl:ref";
const REFRESH_MS = 210000;                              // 3.5 minutes (vanilla removes a dropped item after 5)
const DIMS = ["overworld", "nether", "the_end"];
const ok = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (x) { return false; } };

/** true if this item entity is the loot of a dead player */
export function isDeathLoot(e) { try { return !!e && e.hasTag(TAG); } catch (x) { return false; } }
/** milliseconds left until a death-loot item is removed; null if it is not death loot (or the end time is unknown) */
export function deathLootLeftMs(e) {
  try { if (!e.hasTag(TAG)) return null; const t = e.getDynamicProperty(EXP); return typeof t === "number" ? Math.max(0, t - Date.now()) : null; } catch (x) { return null; }
}

// ---- remember when every item appeared (the drops of a death appear in the same tick as the death)
const spawned = new Map();                               // item id -> time
try {
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try { if (entity && entity.typeId === "minecraft:item") spawned.set(entity.id, Date.now()); } catch (x) { /* ignore */ }
  });
} catch (e) { console.warn("[deathloot] spawn: " + e); }
system.runInterval(() => { const now = Date.now(); for (const [id, t] of spawned) if (now - t > 15000) spawned.delete(id); }, 100);

function mark(e, now) {
  try {
    const tid = e.getComponent("minecraft:item")?.itemStack?.typeId;
    if (!tid || isHeart(tid) || e.hasTag(TAG)) return;
    e.addTag(TAG); e.setDynamicProperty(EXP, now + DEATH_LOOT_MIN * 60000); e.setDynamicProperty(REF, now);
  } catch (x) { /* ignore */ }
}
function scan(dim, loc, t0) {
  let list = [];
  try { list = dim.getEntities({ type: "minecraft:item", location: loc, maxDistance: 8 }); } catch (x) { return; }
  const now = Date.now();
  for (const e of list) {
    try {
      const t = spawned.get(e.id);
      if (t === undefined || t < t0 - 3000 || t > t0 + 4000) continue;     // only items that appeared together with the death
      mark(e, now);
    } catch (x) { /* ignore */ }
  }
}

// ---- a player dies
try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      const d = ev.deadEntity;
      if (!d || d.typeId !== "minecraft:player") return;
      try { if (ex(d).duelBack) return; } catch (e) { /* ignore */ }                  // duel arena: not included
      try { if (duelView.bar(d)) return; } catch (e) { /* ignore */ }
      const l = d.location, dim = d.dimension, t0 = Date.now();
      if (![l.x, l.y, l.z].every((n) => Number.isFinite(n))) return;
      const loc = { x: l.x, y: l.y, z: l.z };
      for (const tick of [1, 4, 10, 25, 50]) system.runTimeout(() => { try { scan(dim, loc, t0); } catch (x) { /* ignore */ } }, tick);   // the drops can appear a moment after the death
    } catch (e) { console.warn("[deathloot] " + e); }
  });
} catch (e) { console.warn("[deathloot] not started: " + e); }

// ---- every second: remove what is older than 30 minutes, put back what is close to the vanilla 5 minute despawn
system.runInterval(() => {
  const now = Date.now();
  for (const dn of DIMS) {
    let list = [];
    try { list = world.getDimension(dn).getEntities({ type: "minecraft:item", tags: [TAG] }); } catch (x) { continue; }
    for (const e of list) {
      try {
        if (!ok(e)) continue;
        const exp = e.getDynamicProperty(EXP);
        if (typeof exp !== "number") { e.removeTag(TAG); continue; }              // unreadable end time: it is a normal item again
        if (now >= exp) { e.remove(); continue; }                                 // 30 minutes are over
        const ref = e.getDynamicProperty(REF);
        if (typeof ref === "number" && now - ref < REFRESH_MS) continue;
        const st = e.getComponent("minecraft:item")?.itemStack; if (!st) continue;
        const l = e.location, ne = e.dimension.spawnItem(st, { x: l.x, y: l.y, z: l.z });
        try { ne.addTag(TAG); ne.setDynamicProperty(EXP, exp); ne.setDynamicProperty(REF, now); } catch (x) { /* ignore */ }
        try { ne.clearVelocity(); } catch (x) { /* ignore */ }
        e.remove();
      } catch (x) { /* ignore this item */ }
    }
  }
}, 20);
