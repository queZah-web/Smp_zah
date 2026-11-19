// =====================================================================================================================
// TNT RUN DESIGN - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   63 x 63 blocks, ~48 high.  Inside: 4 floors (43 x 43) 8 blocks apart, every floor block has a TNT block under it
//   (the classic look: the TNT never explodes, the script just removes the floor block + the TNT under it):
//     Layer 1  y +32  sand with gravel rings           Layer 2  y +24  sand
//     Layer 3  y +16  gravel                            Layer 4  y +8   sand with a red sand star
//   under layer 4: the elimination floor (y 0).  Walls: stone bricks, polished andesite, quartz pillars, chiseled bands,
//   red tops and lights (like a classic TNT Run hall).  On top of the walls: 6 rows of seats all around for the
//   spectators and the eliminated players, behind glass, a back wall with pillars and red banners, corner towers.
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const TNTR = {
  R: 21,                                    // the floors: |x|, |z| <= 21
  HX: 31, UP: 48, DOWN: 2,
  layers: [32, 24, 16, 8],                  // y of the floor blocks (the TNT is 1 below)
  elimY: 6.5,                               // a player whose feet are lower than this (relative) is out
  view: { x: 0, y: 43, z: 29 },             // the south walkway behind the seats, looking at the arena
  board: { x: 0, y: 47.5, z: -27 },         // the leaderboard (hologram) above the north seats
};
const FLOOR_IDS = ["sand", "gravel", "red_sand"];
export const isFloorId = (id) => FLOOR_IDS.includes(String(id).replace("minecraft:", ""));
/** the floor block of layer n (0 = top) at x, z */
export function floorBlock(n, x, z) {
  const ring = Math.max(Math.abs(x), Math.abs(z));
  if (n === 0) return ring % 5 === 2 || (ring <= 1) ? "gravel" : "sand";
  if (n === 1) return "sand";
  if (n === 2) return "gravel";
  return (Math.abs(x) === Math.abs(z) || x === 0 || z === 0) && ring >= 3 ? "red_sand" : "sand";
}
/** the blocks that are not the main material of a layer (to put a layer back fast: fill the main one, then these) */
export const MAIN = ["sand", "sand", "gravel", "sand"];

const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));

export function* tntGen() {
  const T = TNTR, C = new Canvas(), R = T.R;
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);

  // ------------------------------------------------------------ the elimination floor + the 4 layers
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z));
    put(x, 0, z, ring % 4 === 0 ? "red_concrete" : (x + z) % 2 ? "polished_blackstone" : "blackstone");
    T.layers.forEach((y, n) => { put(x, y - 1, z, "tnt"); put(x, y, z, floorBlock(n, x, z)); });
  }
  for (let x = -R; x <= R; x += 7) for (let z = -R; z <= R; z += 7) put(x, 1, z, "light_block_14", undefined, true);
  yield;

  // ------------------------------------------------------------ the walls (rings 22 + 23), y 0 .. 36
  for (let x = -23; x <= 23; x++) for (let z = -23; z <= 23; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z)); if (ring < 22) continue;
    const side = Math.abs(x) >= Math.abs(z), along = side ? z : x, corner = Math.abs(x) === Math.abs(z);
    const pillar = ring === 22 && (corner || (along + 60) % 6 === 0);
    for (let y = 0; y <= 36; y++) {
      let b;
      const band = T.layers.some((ly) => y === ly + 3), base = T.layers.some((ly) => y === ly + 1 || y === ly + 2);
      if (ring === 23) b = y >= 35 ? "red_wool" : "stone_bricks";
      else if (pillar) b = y % 8 === 0 ? "chiseled_quartz_block" : "quartz_pillar";
      else if (y >= 35) b = "red_wool";
      else if (band) b = "chiseled_stone_bricks";
      else if (base) b = (along + 60) % 3 === 0 ? "polished_andesite" : "stone_bricks";
      else if (T.layers.some((ly) => y === ly + 5) && (along + 60) % 6 === 3) b = "sea_lantern";
      else if (y <= 1 || T.layers.some((ly) => y === ly || y === ly - 1)) b = "polished_andesite";
      else b = (y + along + 60) % 7 === 0 ? "cracked_stone_bricks" : "stone_bricks";
      put(x, y, z, b, b === "quartz_pillar" ? { pillar_axis: "y" } : undefined);
    }
    put(x, 37, z, ring === 23 ? "glass" : "red_wool");
    if (ring === 23) put(x, 38, z, "glass");
  }
  yield;

  // ------------------------------------------------------------ the seats (rings 24 .. 29) on supports, a walkway, the back wall (ring 30)
  for (let x = -T.HX + 1; x <= T.HX - 1; x++) for (let z = -T.HX + 1; z <= T.HX - 1; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z)); if (ring < 24 || ring > 30) continue;
    const ax = Math.abs(x), az = Math.abs(z), side = ax >= az, along = side ? z : x, out = side ? [Math.sign(x), 0] : [0, Math.sign(z)];
    if (ring === 30) {
      const pillar = (along + 60) % 6 === 0 || ax === az;
      for (let y = pillar ? 0 : 30; y <= 46; y++) {
        let b = pillar ? (y % 8 === 0 ? "chiseled_quartz_block" : "quartz_pillar") : y === 46 || y === 30 ? "polished_andesite" : y >= 41 && y <= 44 && (along + 60) % 6 >= 2 && (along + 60) % 6 <= 4 ? "red_wool" : "stone_bricks";
        if (!pillar && y >= 38 && y <= 39 && (along + 60) % 6 === 3) b = "sea_lantern";
        put(x, y, z, b, b === "quartz_pillar" ? { pillar_axis: "y" } : undefined);
      }
      if (pillar) put(x, 47, z, "polished_andesite");
      continue;
    }
    const k = ring - 24, h = 37 + k;
    for (let y = 36; y < h; y++) put(x, y, z, "stone_bricks");
    if (ring === 29) { put(x, h, z, "polished_andesite"); continue; }   // the top walkway
    const aisle = (along + 60) % 12 === 0;
    put(x, h, z, aisle ? "stone_brick_stairs" : k % 2 ? "red_nether_brick_stairs" : "polished_andesite_stairs", { weirdo_direction: dirOf(out[0], out[1]), upside_down_bit: false });
  }
  // the stands rest on the walls + a row of arches below (ring 24 .. 29 at y 35)
  for (let x = -29; x <= 29; x++) for (let z = -29; z <= 29; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z)); if (ring < 24 || ring > 29) continue;
    put(x, 35, z, "stone_brick_slab", { "minecraft:vertical_half": "top" });
  }
  // lanterns on the walkway
  for (let x = -29; x <= 29; x++) for (let z = -29; z <= 29; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 29) continue;
    const along = Math.abs(x) >= Math.abs(z) ? z : x;
    if ((along + 60) % 6 === 3) put(x, 43, z, "lantern", { hanging: false }, true);
    if ((along + 60) % 6 === 3) for (let y = 42 - 4; y < 43; y++) put(x, y, z, "polished_andesite_wall|andesite_wall");
  }
  yield;

  // ------------------------------------------------------------ 4 corner towers (above the corners) with red tops + light
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) for (let y = 0; y <= 48; y++) {
      const x = sx * (29 + dx - 1), z = sz * (29 + dz - 1); if (Math.abs(x) > T.HX || Math.abs(z) > T.HX) continue;
      put(x, y, z, y >= 47 ? "red_wool" : y === 46 ? "sea_lantern" : (y % 8 === 0 ? "chiseled_stone_bricks" : "stone_bricks"));
    }
  }
  // the ground around (ring 31)
  for (let x = -T.HX; x <= T.HX; x++) for (let z = -T.HX; z <= T.HX; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z)); if (ring < 24 || C.has(x, 0, z)) continue;
    put(x, 0, z, (x + z) % 2 ? "polished_andesite" : "stone_bricks");
  }
  return C;
}
export function tntArena() { const g = tntGen(); let r; while (!(r = g.next()).done); return r.value; }
