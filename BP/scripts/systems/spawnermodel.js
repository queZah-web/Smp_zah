// SPAWNER MODELS: a small slowly spinning mob inside the cage of every stacked spawner (smp:spawner_<mob>), like a vanilla spawner.
// The mob is a harmless client-side model (entity smp:spawner_mob, no AI, no hitbox, cannot be hit or clicked: the spawner block is what you click).
// Same pattern as spawnerholo.js: only spawners near a player are drawn, one model per spawner, and models of spawners that no longer exist are removed.
// Nothing here can break another system (every step is wrapped).
import { world, system } from "@minecraft/server";
import * as D from "../spawner_data.js";
import { MODELS } from "./spawnermodels_data.js";

const TYPE = "smp:spawner_mob", TAG = "spawner_model";
const RANGE = 24, RANGE_Y = 16, EVERY = 40, CLEAN_EVERY = 60;
const DIM = { o: "overworld", n: "nether", e: "the_end" };
const SHORT = { "minecraft:overworld": "o", "minecraft:nether": "n", "minecraft:the_end": "e" };
const tagOf = (d, x, y, z) => ("sm_" + d + "_" + x + "_" + y + "_" + z).replace(/-/g, "m");

/** every saved spawner: [{ d, x, y, z }] */
function allSpawners() {
  const out = [];
  let ids = []; try { ids = world.getDynamicPropertyIds(); } catch (e) { return out; }
  for (const id of ids) {
    if (!id.startsWith("sp:")) continue;
    const m = /^sp:([one]):(-?\d+),(-?\d+),(-?\d+)$/.exec(id); if (!m) continue;
    out.push({ d: m[1], x: +m[2], y: +m[3], z: +m[4] });
  }
  return out;
}
const modelsOf = (dim, tag) => { try { return dim.getEntities({ type: TYPE, tags: [TAG, tag] }); } catch (e) { return []; } };
function removeAll(list) { for (const e of list) { try { e.remove(); } catch (er) { /* ignore */ } } }

function draw(dim, s, mob) {
  const m = MODELS[mob]; if (!m) return;
  const tag = tagOf(s.d, s.x, s.y, s.z), mtag = "smm_" + mob, found = modelsOf(dim, tag);
  if (found.length === 1) { try { if (found[0].hasTag(mtag)) return; } catch (e) { /* respawn below */ } }
  removeAll(found);                                                  // none / doubled / wrong mob: start again
  try {
    const e = dim.spawnEntity(TYPE, { x: s.x + 0.5, y: s.y + 0.5, z: s.z + 0.5 });
    e.addTag(TAG); e.addTag(tag); e.addTag(mtag);
    e.setProperty("smp:mob", m[0]); e.setProperty("smp:size", m[1]);
  } catch (e) { /* chunk not ready: the next scan tries again */ }
}

// ------------------------------------------------------------------ scan: spawners near players
system.runInterval(() => {
  try {
    const players = world.getAllPlayers(); if (!players.length) return;
    const near = players.map((p) => ({ d: SHORT[p.dimension.id], x: p.location.x, y: p.location.y, z: p.location.z, p }));
    for (const s of allSpawners()) {
      try {
        const q = near.find((n) => n.d === s.d && Math.abs(n.x - s.x) <= RANGE && Math.abs(n.z - s.z) <= RANGE && Math.abs(n.y - s.y) <= RANGE_Y);
        if (!q) continue;
        const dim = q.p.dimension, b = dim.getBlock({ x: s.x, y: s.y, z: s.z });
        if (!b) continue;                                              // not loaded
        const mob = b.typeId.startsWith(D.TYPE_PREFIX) ? b.typeId.slice(D.TYPE_PREFIX.length) : null;
        if (!mob) { removeAll(modelsOf(dim, tagOf(s.d, s.x, s.y, s.z))); continue; }   // the block is gone
        draw(dim, s, mob);
      } catch (e) { /* next one */ }
    }
  } catch (e) { console.warn("[spawnermodel] " + e); }
}, EVERY);

// ------------------------------------------------------------------ cleaner: models of spawners that no longer exist
system.runInterval(() => {
  try {
    const valid = new Set();
    for (const s of allSpawners()) valid.add(tagOf(s.d, s.x, s.y, s.z));
    for (const d of Object.values(DIM)) {
      let list = []; try { list = world.getDimension(d).getEntities({ type: TYPE, tags: [TAG] }); } catch (e) { continue; }
      for (const e of list) {
        try { const t = e.getTags().find((x) => x.startsWith("sm_")); if (!t || !valid.has(t)) e.remove(); } catch (er) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}, CLEAN_EVERY);
