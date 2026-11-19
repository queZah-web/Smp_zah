// ===================================================================================================================
// FAST HOPPERS (DonutSMP style): a hopper moves up to 20 items at once (vanilla: 1 item every 0.4 s).
//   * every 0.4 s (8 ticks) each known hopper:  PULLS up to 20 items from the container above it
//     (chest, barrel, shulker box, another hopper, dropper ... / the OUTPUT slot of a furnace, smoker, blast furnace)
//     and PUSHES up to 20 items into the container it points to (into the top of a furnace = the input slot).
//   * a hopper that is locked by redstone does nothing (like vanilla).  The normal vanilla moving still happens too.
//   * crates (crates.js) are never emptied.  Hopper -> furnace from the side (fuel) is left to vanilla.
// Which hoppers: every hopper a player places or opens, and the hoppers around the players (found slowly, a small area
// at a time).  Saved in the world ("hop:o", "hop:n", "hop:e") so they keep working after a restart.
// No lag: at most HOPS_PER_RUN hoppers per run, unloaded hoppers are skipped, nothing runs when there are no hoppers.
// ===================================================================================================================
import { world, system, BlockVolume } from "@minecraft/server";
import { isCrateAt } from "./crates.js";

export const FAST_HOPPER = { amount: 20, every: 8, perRun: 250, max: 3000 };
const DIMS = { o: "minecraft:overworld", n: "minecraft:nether", e: "minecraft:the_end" };
const short = (d) => (d === DIMS.o ? "o" : d === DIMS.n ? "n" : d === DIMS.e ? "e" : null);
const FURN = /^minecraft:(lit_)?(furnace|smoker|blast_furnace)$/;
const FACE = [[0, -1, 0], null, [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];      // facing_direction 0 down, 2 north, 3 south, 4 west, 5 east
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[hopper] " + name + ": " + e); } };

// ---------------------------------------------------------------- the list of hoppers
const hops = { o: new Map(), n: new Map(), e: new Map() };      // "x,y,z" -> [x, y, z]
let loaded = false, dirty = false;
function load() {
  if (loaded) return true;
  try {
    for (const d of Object.keys(hops)) { const raw = world.getDynamicProperty("hop:" + d); if (typeof raw === "string") for (const k of JSON.parse(raw)) { const a = k.split(",").map(Number); if (a.length === 3) hops[d].set(k, a); } }
    loaded = true;
  } catch (e) { return false; }
  return true;
}
const total = () => hops.o.size + hops.n.size + hops.e.size;
function add(dimId, x, y, z) {
  const d = short(dimId); if (!d || !load()) return;
  const k = x + "," + y + "," + z; if (hops[d].has(k) || total() >= FAST_HOPPER.max) return;
  hops[d].set(k, [x, y, z]); dirty = true;
}
system.runInterval(() => {
  if (!dirty) return; dirty = false;
  try { for (const d of Object.keys(hops)) world.setDynamicProperty("hop:" + d, hops[d].size ? JSON.stringify([...hops[d].keys()]) : undefined); } catch (e) { /* ignore */ }
}, 200);
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ block }) => { try { if (block.typeId === "minecraft:hopper") add(block.dimension.id, block.x, block.y, block.z); } catch (e) { /* ignore */ } }));
safe("open", () => world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => { try { if (block.typeId === "minecraft:hopper") add(block.dimension.id, block.x, block.y, block.z); } catch (e) { /* ignore */ } }));
// existing hoppers: one 16 x 16 x 32 area around one player every 2 seconds (5 x 5 chunks around each player, then again)
let scanI = 0;
system.runInterval(() => {
  try {
    if (!load()) return;
    const ps = world.getAllPlayers(); if (!ps.length) return;
    const p = ps[scanI % ps.length], step = Math.floor(scanI / ps.length) % 25; scanI++;
    const cx = (Math.floor(p.location.x / 16) + (step % 5) - 2) * 16, cz = (Math.floor(p.location.z / 16) + Math.floor(step / 5) - 2) * 16;
    const hr = p.dimension.heightRange, y = Math.floor(p.location.y), y1 = Math.max(hr.min, y - 16), y2 = Math.min(hr.max - 1, y + 15);
    const list = p.dimension.getBlocks(new BlockVolume({ x: cx, y: y1, z: cz }, { x: cx + 15, y: y2, z: cz + 15 }), { includeTypes: ["minecraft:hopper"] }, false);
    for (const l of list.getBlockLocationIterator()) add(p.dimension.id, l.x, l.y, l.z);
  } catch (e) { /* not loaded / not supported */ }
}, 40);

// ---------------------------------------------------------------- moving items
const inv = (b) => { try { return b.getComponent("minecraft:inventory")?.container ?? null; } catch (e) { return null; } };
/** moves up to n items of ONE stack from container `from` (only the slots in `slots`, or all) into `to` (only `toSlot`, or anywhere). Returns how many moved. */
function move(from, to, n, slots, toSlot) {
  const list = slots ?? [...Array(from.size).keys()];
  for (const i of list) {
    const s = from.getItem(i); if (!s) continue;
    const want = Math.min(n, s.amount);
    let moved = 0;
    if (toSlot === undefined) {
      const part = s.clone(); part.amount = want;
      const rest = to.addItem(part);
      moved = want - (rest ? rest.amount : 0);
    } else {
      const t = to.getItem(toSlot);
      if (!t) { const part = s.clone(); part.amount = want; to.setItem(toSlot, part); moved = want; }
      else if (t.isStackableWith(s) && t.amount < t.maxAmount) { moved = Math.min(want, t.maxAmount - t.amount); t.amount += moved; to.setItem(toSlot, t); }
    }
    if (moved <= 0) continue;
    if (moved >= s.amount) from.setItem(i, undefined); else { s.amount -= moved; from.setItem(i, s); }
    return moved;
  }
  return 0;
}
function runHopper(dim, x, y, z) {
  const b = dim.getBlock({ x, y, z });
  if (!b) return true;                                                     // not loaded: keep it, skip
  if (b.typeId !== "minecraft:hopper") return false;                       // gone: forget it
  const perm = b.permutation;
  if (perm.getState("toggle_bit")) return true;                            // locked by redstone
  const me = inv(b); if (!me) return true;
  const N = FAST_HOPPER.amount;
  // push
  const f = FACE[Number(perm.getState("facing_direction") ?? 0)] ?? FACE[0];
  const t = dim.getBlock({ x: x + f[0], y: y + f[1], z: z + f[2] });
  if (t && !isCrateAt(dim.id, t.x, t.y, t.z)) {
    if (FURN.test(t.typeId)) { if (f[1] === -1) { const c = inv(t); if (c) move(me, c, N, null, 0); } }
    else { const c = inv(t); if (c) move(me, c, N); }
  }
  // pull
  const a = dim.getBlock({ x, y: y + 1, z });
  if (a && !isCrateAt(dim.id, a.x, a.y, a.z)) {
    const c = inv(a);
    if (c) { if (FURN.test(a.typeId)) move(c, me, N, [2]); else move(c, me, N); }
  }
  return true;
}
let tick = 0;
const queue = [];                                                          // round robin over every hopper
system.runInterval(() => {
  tick++;
  if (!load() || !total()) return;
  if (!queue.length) for (const d of Object.keys(hops)) for (const [k, v] of hops[d]) queue.push([d, k, v]);
  const n = Math.min(queue.length, FAST_HOPPER.perRun);
  const dims = {};
  for (let i = 0; i < n; i++) {
    const [d, k, [x, y, z]] = queue.shift();
    try {
      const dim = dims[d] ?? (dims[d] = world.getDimension(DIMS[d]));
      if (!runHopper(dim, x, y, z)) { hops[d].delete(k); dirty = true; }
    } catch (e) { /* one hopper never stops the others */ }
  }
}, FAST_HOPPER.every);
