// =====================================================================================================================
// SPLEEF DESIGN - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   65 x 65 blocks, ~36 high.  A round colosseum:
//     * the SNOW FLOOR: a round floor of snow blocks (radius 20, 41 across) at y +20 - the only thing that can be dug
//     * under it a deep round PIT (stone walls with glowing cracks) and a LAVA lake at the bottom (looks deadly; nobody ever
//       reaches it: falling below the floor = out at once, and the players have fire resistance during the game)
//     * the inner wall around the floor (4 blocks higher than the snow, so nobody can climb out), blue ice + packed ice
//       bands, frosty lanterns
//     * 6 rows of spruce seats all around for the spectators and the eliminated players, a walkway, a back wall with
//       arches, banners of ice blue, snowy pine trees and lanterns on the top
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const SPLEEF = {
  R: 20,                                   // the snow floor: x^2 + z^2 <= (R + 0.5)^2
  HX: 32, UP: 36, DOWN: 2,
  floorY: 20,                              // y of the snow blocks
  elimY: 18.6,                             // feet lower than this (relative) = out
  view: { x: 0, y: 30, z: 29 },            // the south walkway behind the seats, looking at the arena
  board: { x: 0, y: 35.5, z: -29 },        // the leaderboard (hologram) above the north seats
};
export const inFloor = (x, z) => x * x + z * z <= (SPLEEF.R + 0.5) ** 2;
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));

export function* spleefGen() {
  const S = SPLEEF, C = new Canvas(), FY = S.floorY;
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const rnd = (x, y, z) => { let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  // ------------------------------------------------------------ the pit: lava lake, walls, the snow floor
  for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) {
    const r = Math.hypot(x, z);
    if (r <= 20.5) {
      put(x, 0, z, "netherrack"); put(x, 1, z, "lava");
      put(x, FY, z, "snow");
      continue;
    }
    if (r <= 22.6) {                                                    // the wall around the pit and the floor
      for (let y = 0; y <= FY + 4; y++) {
        let b = rnd(x, y, z) < 0.18 ? "cracked_deepslate_bricks" : "deepslate_bricks";
        if (y < FY - 1 && rnd(x, y, z) < 0.05) b = "magma";
        if (y === FY - 1 || y === FY + 4) b = "polished_deepslate";
        if (y === FY + 1 || y === FY + 3) b = r < 21.6 ? "packed_ice" : "deepslate_bricks";
        if (y === FY + 2) b = r < 21.6 ? (Math.round(Math.atan2(z, x) * 20) % 4 === 0 ? "sea_lantern" : "blue_ice") : "deepslate_bricks";
        put(x, y, z, b);
      }
    }
  }
  yield;

  // ------------------------------------------------------------ the seats (r 23 .. 29), the walkway (r 30), the back wall (r 31..32)
  for (let x = -32; x <= 32; x++) for (let z = -32; z <= 32; z++) {
    const r = Math.hypot(x, z); if (r <= 22.6 || r > 32.6) continue;
    const k = Math.floor(r - 22.6);                                     // 0 .. 9
    const ang = Math.atan2(z, x), aisle = Math.round(ang * 30 / Math.PI) % 10 === 0;
    if (k <= 5) {                                                       // 6 rows of seats, each 1 higher
      const h = FY + 4 + k;
      for (let y = 0; y < h; y++) put(x, y, z, y >= FY ? "spruce_planks" : "deepslate_bricks");
      put(x, h, z, aisle ? "polished_deepslate_stairs" : "spruce_stairs", { weirdo_direction: dirOf(x, z), upside_down_bit: false });
    } else if (k === 6 || k === 7) {                                    // the walkway
      for (let y = 0; y <= FY + 9; y++) put(x, y, z, y === FY + 9 ? (k === 6 ? "spruce_planks" : "stripped_spruce_log") : "deepslate_bricks", y === FY + 9 && k === 7 ? { pillar_axis: "y" } : undefined);
    } else {                                                            // the back wall with arches + a crown of snow
      const u = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 96), pillar = u % 6 === 0;
      for (let y = 0; y <= FY + 15; y++) {
        let b = pillar ? (y % 5 === 0 ? "chiseled_deepslate" : "deepslate_tiles") : "deepslate_bricks";
        if (!pillar && y >= FY + 11 && y <= FY + 13 && k === 8) b = y === FY + 13 ? "polished_deepslate" : "light_blue_stained_glass";
        if (k === 9 && !pillar && u % 6 === 3 && ((y >= 4 && y <= 10) || (y >= 14 && y <= 19))) b = y === 10 || y === 19 ? "sea_lantern" : "light_blue_stained_glass";   // tall windows outside
        if (k === 9 && (y === 12 || y === 1)) b = "polished_deepslate";
        if (y === FY + 15) b = "snow";
        if (y === FY + 14) b = pillar ? "sea_lantern" : "polished_deepslate";
        put(x, y, z, b);
      }
      if (pillar && k === 8) put(x, FY + 16, z, "snow_layer", { height: 2, covered_bit: false }, true);
    }
  }
  yield;

  // ------------------------------------------------------------ lanterns on the walkway, banners of ice (blue wool), snowy pines on the top
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, x = Math.round(Math.cos(a) * 29.6), z = Math.round(Math.sin(a) * 29.6);
    if (C.id(x, FY + 9, z)) { put(x, FY + 10, z, "spruce_fence"); put(x, FY + 11, z, "soul_lantern", { hanging: false }, true); }
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1, x = Math.round(Math.cos(a) * 31), z = Math.round(Math.sin(a) * 31);
    for (let y = FY + 4; y <= FY + 10; y++) put(x - Math.sign(x) * (Math.abs(x) > Math.abs(z) ? 1 : 0), y, z - Math.sign(z) * (Math.abs(z) >= Math.abs(x) ? 1 : 0), y === FY + 4 ? "white_wool" : "light_blue_wool");
  }
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {        // snowy pines in the 4 corners outside the wall
    const tx = sx * 30, tz = sz * 30;
    if (Math.hypot(tx, tz) <= 32.6) continue;
    for (let y = 0; y <= 14; y++) put(tx, y, tz, "spruce_log", { pillar_axis: "y" });
    for (let y = 5; y <= 16; y++) { const rr = Math.max(0, Math.round((16 - y) / 3)); for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) { if (Math.abs(dx) + Math.abs(dz) > rr + 1 || (dx === 0 && dz === 0 && y <= 14)) continue; if (Math.abs(tx + dx) > 32 || Math.abs(tz + dz) > 32) continue; put(tx + dx, y, tz + dz, y % 3 === 0 ? "snow" : "spruce_leaves", y % 3 === 0 ? undefined : { persistent_bit: true }); } }
  }
  // the ground around + light (no mobs)
  for (let x = -32; x <= 32; x++) for (let z = -32; z <= 32; z++) if (!C.has(x, 0, z)) put(x, 0, z, (x + z) % 3 ? "snow" : "packed_ice");
  for (let x = -18; x <= 18; x += 6) for (let z = -18; z <= 18; z += 6) { if (inFloor(x, z)) { put(x, FY + 3, z, "light_block_14", undefined, true); put(x, FY - 6, z, "light_block_14", undefined, true); } }
  return C;
}
export function spleefArena() { const g = spleefGen(); let r; while (!(r = g.next()).done); return r.value; }
