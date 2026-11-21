// ===================================================================================================================
// THE BUTTERFLIES OF THE CELESTIAL SANCTUARY - big purple / pink / teal butterflies that fly in the sky around the spawn
//
//   * 12 butterflies (entity smp:butterfly, model + flapping wings in the resource pack); some carry a glowing lantern
//   * each one flies its own wide circle around the spawn: radius 45 - 125 blocks, 28 - 62 blocks above the ground,
//     some clockwise, some the other way, slowly moving in and out and up and down -> they look free and random
//   * nobody can hit / kill / push them, they never fall, they never leave; they are not monsters (the "no monsters"
//     rule does not touch them)
//   * one gone (/kill ...) -> it comes back by itself; Undo of the spawn -> they are removed
//   * the Owner: Building > Spawn > Butterflies (on / off) and "New butterflies" (new paths)
// No lag: they move only while a player is near the spawn (one teleport each per tick, 12 entities).
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { getZone } from "./spawnzone.js";

const TYPE = "smp:butterfly", N = 12, NEAR = 260, KEY = "spawn:bf", SEED = "spawn:bfseed";
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (x) { return false; } };
export const butterfliesOn = () => { try { return world.getDynamicProperty(KEY) !== 0; } catch (e) { return true; } };
const celestial = () => { const z = getZone(); return z && z.kind === "celestial" ? z : null; };

// ---------------------------------------------------------------- the paths (fixed by the seed: the same after a restart)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let paths = null, pathSeed = null;
function getPaths() {
  let s; try { s = world.getDynamicProperty(SEED); } catch (e) { s = undefined; }
  if (typeof s !== "number") { s = Math.floor(Math.random() * 1e9); try { world.setDynamicProperty(SEED, s); } catch (e) { /* ignore */ } }
  if (paths && pathSeed === s) return paths;
  const r = rng(s); paths = []; pathSeed = s;
  for (let i = 0; i < N; i++) {
    const rad = 45 + r() * 80, v = 0.14 + r() * 0.1;                        // blocks per tick
    paths.push({ a0: r() * Math.PI * 2, w: (r() < 0.5 ? -1 : 1) * v / rad, rad, rw: 4 + r() * 8, rf: 0.002 + r() * 0.004, rp: r() * 6.3,
      h: 28 + r() * 34, hw: 2 + r() * 4, hf: 0.01 + r() * 0.02, hp: r() * 6.3 });
  }
  return paths;
}
function posAt(P, z, t) {
  const a = P.a0 + P.w * t, rad = P.rad + P.rw * Math.sin(t * P.rf + P.rp);
  return { x: z.cx + 0.5 + Math.cos(a) * rad, y: z.cy + 1 + P.h + P.hw * Math.sin(t * P.hf + P.hp), z: z.cz + 0.5 + Math.sin(a) * rad };
}

// ---------------------------------------------------------------- the list of butterflies (looked up every 5 s)
let list = new Map();                                  // index -> entity
function scan(dim, z) {
  const m = new Map();
  let all = [];
  try { all = dim.getEntities({ type: TYPE }); } catch (e) { return; }
  for (const e of all) {
    let i; try { i = e.getDynamicProperty("bf"); } catch (x) { i = undefined; }
    if (typeof i !== "number" || i < 0 || i >= N || m.has(i) || !butterfliesOn() || !z) { try { e.remove(); } catch (x) { /* ignore */ } continue; }
    m.set(i, e);
  }
  list = m;
}
function spawnMissing(dim, z) {
  const P = getPaths(), t = system.currentTick;
  for (let i = 0; i < N; i++) {
    if (list.has(i)) continue;
    try {
      const e = dim.spawnEntity(TYPE, posAt(P[i], z, t));
      e.setDynamicProperty("bf", i);
      try { e.setProperty("smp:color", i % 3); e.setProperty("smp:lantern", i % 3 === 0 || i % 4 === 1); } catch (x) { /* ignore */ }
      list.set(i, e);
    } catch (x) { /* the place is not loaded yet - next time */ }
  }
}
const playerNear = (z) => { for (const p of world.getAllPlayers()) { try { if (p.dimension.id !== z.d) continue; const l = p.location; if ((l.x - z.cx) ** 2 + (l.z - z.cz) ** 2 < NEAR * NEAR) return true; } catch (e) { /* ignore */ } } return false; };

/** removes every butterfly (Undo / switched off / new paths) */
export function removeButterflies() {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) { try { for (const e of world.getDimension(id).getEntities({ type: TYPE })) e.remove(); } catch (e) { /* ignore */ } }
  list = new Map();
}
export function setButterflies(on) { try { world.setDynamicProperty(KEY, on ? 1 : 0); } catch (e) { /* ignore */ } if (!on) removeButterflies(); }
export function newButterflies() { try { world.setDynamicProperty(SEED, Math.floor(Math.random() * 1e9)); } catch (e) { /* ignore */ } removeButterflies(); }

system.runInterval(() => {
  const z = celestial();
  if (!z) { if (list.size) removeButterflies(); return; }
  if (!butterfliesOn() || !playerNear(z)) return;
  let dim; try { dim = world.getDimension(z.d); } catch (e) { return; }
  scan(dim, z);
  spawnMissing(dim, z);
}, 100);

// the flight: every tick, only while a player is near
let near = false;
system.runInterval(() => { const z = celestial(); near = !!(z && butterfliesOn() && list.size && playerNear(z)); }, 20);
system.runInterval(() => {
  if (!near) return;
  const z = celestial(); if (!z) return;
  const P = getPaths(), t = system.currentTick;
  for (const [i, e] of list) {
    if (!alive(e)) { list.delete(i); continue; }
    const a = posAt(P[i], z, t), b = posAt(P[i], z, t + 4);
    const yaw = Math.atan2(-(b.x - a.x), b.z - a.z) * 180 / Math.PI;
    try { e.teleport(a, { rotation: { x: 0, y: yaw }, keepVelocity: false }); } catch (x) { /* not loaded */ }
  }
}, 1);
