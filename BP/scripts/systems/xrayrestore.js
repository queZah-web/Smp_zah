// Ore restore (safety net only - there is NO anti-cheat / anti X-Ray any more).
// Older versions hid buried ores as stone-looking blocks (smp:ax_*, BP/blocks/ax). Nothing is hidden any more;
// this file only turns every old hidden ore back into the real ore (around the players, as they walk / mine / blow things up).
// KEEP BP/blocks/ax and axrids.js until the whole world was restored, otherwise old hidden ores would disappear.
// Everything is wrapped in try/catch and time-boxed: a problem here can never stop the other systems.
import * as MC from "@minecraft/server";
import { world, system, BlockPermutation } from "@minecraft/server";
import { ALL_FAKE, isFake, realOf } from "./axrids.js";

const FILTER_FAKE = { includeTypes: ALL_FAKE };
const SWEEP_EVERY = 5, SWEEP_RADIUS = 9, CHUNK_RADIUS = 3, BUDGET_MS = 3;
let apiOk = typeof MC.BlockVolume === "function";
let tickN = 0;
const done = new Set();                       // chunks already restored ("dim|cx|cz")
const queue = [];

function setBlock(b, id) {
  try { b.setPermutation(BlockPermutation.resolve(id)); return true; } catch (e) { /* try the other way */ }
  try { b.setType(id); return true; } catch (e) { return false; }
}
function revealAt(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (!b || !isFake(b.typeId)) return false;
    return setBlock(b, realOf(b.typeId));
  } catch (e) { return false; }
}
function fakesIn(dim, vol) {
  const out = [];
  for (const l of dim.getBlocks(vol, FILTER_FAKE, true).getBlockLocationIterator()) out.push({ x: l.x, y: l.y, z: l.z });
  return out;
}

function sweep(t0) {
  const r = SWEEP_RADIUS;
  for (const p of world.getAllPlayers()) {
    if (Date.now() - t0 > BUDGET_MS + 2) return;
    try {
      const dim = p.dimension, l = p.location, hr = dim.heightRange;
      const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
      const vol = new MC.BlockVolume({ x: x - r, y: Math.max(hr.min, y - r), z: z - r }, { x: x + r, y: Math.min(hr.max - 1, y + r), z: z + r });
      for (const loc of fakesIn(dim, vol)) revealAt(dim, loc);
    } catch (e) { /* player in an unloaded area: next time */ }
  }
}
function enqueue() {
  if (done.size > 40000) done.clear();
  for (const p of world.getAllPlayers()) {
    try {
      const dim = p.dimension;
      if (dim.id === "minecraft:the_end") continue;
      const pc = Math.floor(p.location.x / 16), pz = Math.floor(p.location.z / 16);
      for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
        const key = dim.id + "|" + (pc + dx) + "|" + (pz + dz);
        if (done.has(key) || queue.length >= 400) continue;
        done.add(key); queue.push({ dim: dim.id, cx: pc + dx, cz: pz + dz, key, d: dx * dx + dz * dz });
      }
    } catch (e) { /* ignore */ }
  }
  if (queue.length > 1) queue.sort((a, b) => a.d - b.d);
}
function restoreChunk(job) {
  const dim = world.getDimension(job.dim), hr = dim.heightRange;
  try { if (!dim.getBlock({ x: job.cx * 16 + 8, y: hr.min + 1, z: job.cz * 16 + 8 })) { done.delete(job.key); return; } } catch (e) { done.delete(job.key); return; }   // not loaded yet: try again later
  const vol = new MC.BlockVolume({ x: job.cx * 16, y: hr.min, z: job.cz * 16 }, { x: job.cx * 16 + 15, y: hr.max - 1, z: job.cz * 16 + 15 });
  for (const l of fakesIn(dim, vol)) revealAt(dim, l);
}

try {
  system.runInterval(() => {
    if (!apiOk) return;
    tickN++;
    const t0 = Date.now();
    try {
      if (tickN % 20 === 0) enqueue();
      if (tickN % SWEEP_EVERY === 0) sweep(t0);
      if (queue.length && Date.now() - t0 < BUDGET_MS + 2) {
        const job = queue.shift();
        try { restoreChunk(job); } catch (e) { if (String(e).includes("getBlocks")) apiOk = false; }
      }
    } catch (e) { console.warn("[oreRestore] tick failed: " + e); }
  }, 1);
} catch (e) { console.warn("[oreRestore] not started: " + e); }

// a leftover hidden ore can never be lost: breaking one restores it first (the player mines the real ore), explosions spare it once
try {
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    try {
      const b = ev.block;
      if (!isFake(b.typeId)) return;
      ev.cancel = true;
      const dim = b.dimension, loc = { x: b.location.x, y: b.location.y, z: b.location.z };
      system.run(() => { revealAt(dim, loc); });
    } catch (e) { /* ignore */ }
  });
  world.beforeEvents.explosion.subscribe((ev) => {
    try {
      const list = ev.getImpactedBlocks();
      const fakes = list.filter((b) => isFake(b.typeId));
      if (!fakes.length) return;
      ev.setImpactedBlocks(list.filter((b) => !isFake(b.typeId)));
      const dim = ev.dimension, locs = fakes.map((b) => ({ x: b.location.x, y: b.location.y, z: b.location.z }));
      system.run(() => { for (const l of locs) revealAt(dim, l); });
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[oreRestore] safety events not started: " + e); }
