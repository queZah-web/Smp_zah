// ===================================================================================================================
// LIGHT ARENA RESET (Sky Wars, Egg Wars, Lucky Wars)
//
// Instead of clearing the whole sky and building every island again (tens of thousands of blocks = lag), only what
// changed is repaired:
//   1. every block the players PLACED during the game (and the blocks the game itself put there: eggs, beacons, lucky
//      surprises) is removed - or put back as it was when that place belongs to the island
//   2. water / lava / fire / cobwebs / anvils anywhere in the arena are removed with a few native filtered fills
//   3. the islands are CHECKED block by block (reading is cheap) and only the missing / changed blocks are put back
// Everything runs as a slow job (a few hundred blocks per tick), so the server never freezes.
// ===================================================================================================================
import { BlockVolume } from "@minecraft/server";
import { perm } from "./spawnbuild.js";

const LOOSE = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire", "minecraft:web", "minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil"];
const kOf = (x, y, z) => x + "," + y + "," + z;

/**
 * a = the arena record { cx, cy, cz }, canvas = the BigCanvas of the design (relative positions),
 * changed = absolute "x,y,z" keys of the placed blocks, H = half width, from / to = relative heights of the sky part.
 * Returns { removed, fixed } (generator: run it inside system.runJob)
 */
export function* lightReset(a, dim, canvas, changed, H, from, to, progress) {
  const air = perm("air"); let removed = 0, fixed = 0, n = 0;
  // 1. the placed blocks
  for (const k of changed ?? []) {
    const [x, y, z] = String(k).split(",").map(Number);
    if (!canvas.has(x - a.cx, y - a.cy, z - a.cz)) { try { const b = dim.getBlock({ x, y, z }); if (b && !b.isAir) { b.setPermutation(air); removed++; } } catch (e) { /* not loaded */ } }
    if (++n % 120 === 0) yield;
  }
  // 2. liquids, fire, cobwebs, anvils: native filtered fills (3 slices of x at a time)
  for (let x = -H; x <= H; x += 3) {
    const vol = new BlockVolume({ x: a.cx + x, y: a.cy + from, z: a.cz - H }, { x: a.cx + Math.min(H, x + 2), y: a.cy + to, z: a.cz + H });
    try { dim.fillBlocks(vol, air, { blockFilter: { includeTypes: LOOSE } }); }
    catch (e) { for (const t of LOOSE) { try { dim.fillBlocks(vol, air, { blockFilter: { includeTypes: [t] } }); } catch (x2) { /* unknown here / not loaded */ } } }
    yield;
  }
  // 3. check the islands: only what is missing / different is put back
  const og = canvas.orderedGen(); let r; while (!(r = og.next()).done) yield;
  const pal = canvas.pal.map((p) => perm(p.id, p.st)), ids = pal.map((p) => p?.type?.id ?? null);
  n = 0;
  for (const b of r.value) for (let i = 0; i < b.length; i += 4) {
    const p = pal[b[i + 3]];
    if (p) {
      try {
        const blk = dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] });
        if (blk && blk.typeId !== ids[b[i + 3]]) { blk.setPermutation(p); fixed++; }
      } catch (e) { /* not loaded */ }
    }
    if (++n % 250 === 0) { if (progress) progress(n); yield; }
  }
  return { removed, fixed };
}
export const keyOf = kOf;
