// =====================================================================================================================
// LUCKY BLOCK WARS DESIGN - the arena (pure data: can be tested / previewed outside the game)
//
//   The Sky Wars islands (skywarsdesign.js: 10 / 20 player islands ~32 blocks from the middle, 4 middle islands, the
//   centre) in a GOLDEN look (yellow paths, yellow / orange bands in the rock) and, instead of chests, LUCKY BLOCKS:
//     * every player island: 5 lucky blocks around the spawn
//     * every middle island: 3 (better luck)
//     * the centre: 8 lucky blocks around + the MEGA LUCKY BLOCK on the raised middle (3 x 3 x 3 = 27 lucky blocks with the
//       best luck: legendary weapons, totems, elytra ...)
//   A lucky block is a yellow glazed terracotta (a vanilla block: no resource pack needed).
// =====================================================================================================================
import { TOP, layout, lockerAt, skyGen, lockerBlocks } from "./skywarsdesign.js";
export { TOP, layout, lockerAt, lockerBlocks };

export const LUCKY = "yellow_glazed_terracotta";
const RECOLOR = { sand: "yellow_concrete", hardened_clay: "yellow_terracotta", brown_terracotta: "orange_terracotta", stone_brick_slab: "smooth_sandstone_slab|sandstone_slab", chiseled_stone_bricks: "gold_block" };

/** { canvas, lucky: [{ x, y, z, t: island | mid | center | mega }], spawns, L } */
export function* luckyGen(n) {
  const g = skyGen(n); let r; while (!(r = g.next()).done) yield;
  const { canvas: C, chests, spawns, L } = r.value;
  for (const p of C.pal) if (RECOLOR[p.id]) p.id = RECOLOR[p.id];
  const lucky = [], used = new Set(), k = (x, y, z) => x + "," + y + "," + z;
  const add = (x, y, z, t) => { if (used.has(k(x, y, z))) return false; used.add(k(x, y, z)); C.put(x, y, z, LUCKY); lucky.push({ x, y, z, t }); return true; };
  const free = (x, y, z) => !C.has(x, y, z) || C.id(x, y, z) === "short_grass";
  // the chests of Sky Wars become lucky blocks (the raised centre ones become the mega block)
  for (const c of chests) if (c.tier !== "center" || c.y !== TOP + 3) add(c.x, c.y, c.z, c.tier === "island" ? "island" : c.tier === "mid" ? "mid" : "center");
  // + 3 more on every player island (5 in all), around the spawn
  L.islands.forEach((is, i) => {
    const sp = spawns[i], T = is.top; let n2 = 0;
    for (const [dx, dz] of [[2, 1], [-1, 2], [1, -2], [-2, -1], [3, 0], [0, 3], [-3, 0], [0, -3], [2, 2], [-2, -2]]) {
      if (n2 >= 3) break;
      const x = sp.x + dx, z = sp.z + dz, ground = C.id(x, T, z);
      if (!ground || !["grass_block", "yellow_concrete", "dirt"].includes(ground) || !free(x, T + 1, z) || !free(x, T + 2, z)) continue;
      if (add(x, T + 1, z, "island")) n2++;
    }
  });
  // + 1 more on every middle island
  for (const m of L.mids) { const x = m.x + Math.round(Math.cos(m.a) * 2), z = m.z + Math.round(Math.sin(m.a) * 2); if (C.has(x, m.top, z) && free(x, m.top + 1, z)) add(x, m.top + 1, z, "mid"); }
  // the centre: 4 more around + the MEGA lucky block (3 x 3 x 3) on the raised middle
  for (const [x, z] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (C.has(x, TOP, z) && free(x, TOP + 1, z)) add(x, TOP + 1, z, "center");
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = TOP + 3; y <= TOP + 5; y++) add(x, y, z, "mega");
  for (const [x, z] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) { C.put(x, TOP + 2, z, "gold_block"); C.put(x, TOP + 3, z, "end_rod", { facing_direction: 1 }, true); }
  return { canvas: C, lucky, spawns, L };
}
