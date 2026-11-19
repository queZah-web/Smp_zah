// =====================================================================================================================
// RED LIGHT, GREEN LIGHT - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   69 x 145 blocks, ~26 high, like the show:
//     * a long sandy field (55 x 141) between high walls painted like a blue sky with white clouds
//     * SOUTH: the start area behind the red START line (z +54)
//     * the middle: hay bales, barrels and rocks (only decoration / cover), pink guard statues along the walls
//     * NORTH: the white FINISH line (z -50), a huge glowing gate with FINISH on it and 2 big signal lights (red / green)
//       on top, the place of the giant doll (an animated entity, smp:sg_doll) on a pedestal next to a bare tree
//     * 2 spectator balconies along the walls (y 14), behind glass, for the eliminated players and the viewers
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const SQ = {
  HX: 34, HZ: 72, UP: 30, DOWN: 2,
  FX: 27,                                  // the field: |x| <= 27
  startZ: 54, finishZ: -50,                // players start south of the start line and run north
  startArea: { z1: 56, z2: 68 },
  doll: { x: 0, y: 2, z: -60 },
  view: { x: -31, y: 15, z: 0 },           // the west balcony
  board: { x: 0, y: 9, z: 64 },            // the leaderboard above the start area
  lights: { red: { x: -6, y: 22 }, green: { x: 6, y: 22 }, z: -52, r: 3 },
};
/** the blocks of a signal light (relative), "red" or "green" */
export function lightCells(color) {
  const L = SQ.lights, c = L[color], out = [];
  for (let dx = -L.r; dx <= L.r; dx++) for (let dy = -L.r; dy <= L.r; dy++) if (Math.hypot(dx, dy) <= L.r + 0.3) out.push({ x: c.x + dx, y: c.y + dy, z: L.z + 1 });
  return out;
}
export const LIGHT = { red: "redstone_block", green: "verdant_froglight", off: "black_concrete" };

const FONT = {
  F: ["###", "#..", "##.", "#..", "#.."], I: ["###", ".#.", ".#.", ".#.", "###"], N: ["#.#", "###", "###", "###", "#.#"],
  S: ["###", "#..", "###", "..#", "###"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
};
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function* squidGen() {
  const S = SQ, C = new Canvas();
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);

  // ------------------------------------------------------------ the field
  for (let x = -S.FX; x <= S.FX; x++) for (let z = -70; z <= 70; z++) {
    const r = hash(x, z);
    let b = r < 0.55 ? "smooth_sandstone" : r < 0.85 ? "sandstone" : r < 0.97 ? "cut_sandstone" : "sand";
    if (z === S.startZ || z === S.startZ + 1) b = "red_concrete";
    if (z === S.finishZ || z === S.finishZ - 1) b = "white_concrete";
    put(x, 0, z, b);
  }
  for (let x = -S.FX; x <= S.FX; x += 9) for (let z = -66; z <= 66; z += 11) put(x, 1, z, "light_block_14", undefined, true);
  yield;

  // ------------------------------------------------------------ the sky walls (x = +-28, z = +-71), y 0 .. 13
  const clouds = [];
  for (let a = -80; a <= 80; a += 13) clouds.push([a + Math.floor(hash(a, 1) * 6), 5 + Math.floor(hash(a, 2) * 6), 3 + Math.floor(hash(a, 3) * 3)]);
  const sky = (along, y) => { for (const [ca, cy, rr] of clouds) if (((along - ca) / rr) ** 2 + ((y - cy) / (rr * 0.45)) ** 2 <= 1) return "white_concrete"; return y <= 1 ? "light_blue_concrete" : "light_blue_concrete"; };
  for (let z = -71; z <= 71; z++) for (const sx of [-1, 1]) for (let y = 0; y <= 13; y++) put(sx * 28, y, z, y === 0 ? "smooth_sandstone" : sky(z * sx, y));
  for (let x = -28; x <= 28; x++) for (const sz of [-1, 1]) for (let y = 0; y <= 13; y++) put(x, y, sz * 71, y === 0 ? "smooth_sandstone" : sky(x * sz + 200, y));
  for (let z = -71; z <= 71; z++) for (const sx of [-1, 1]) put(sx * 28, 14, z, "white_concrete");
  for (let x = -28; x <= 28; x++) for (const sz of [-1, 1]) put(x, 14, sz * 71, "white_concrete");
  yield;

  // ------------------------------------------------------------ the spectator balconies (|x| 29 .. 33, y 14), glass, roof
  for (let z = -70; z <= 70; z++) for (const sx of [-1, 1]) {
    for (let ax = 29; ax <= 34; ax++) {
      const x = sx * ax;
      put(x, 14, z, ax === 34 ? "white_concrete" : (z + 100) % 6 === 0 ? "pink_concrete" : "white_concrete");
      if (ax === 34) for (let y = 0; y <= 20; y++) put(x, y, z, y === 20 ? "pink_concrete" : y > 14 && (z + 100) % 6 === 3 && y >= 16 && y <= 18 ? "glass" : "light_gray_concrete");
      if (ax >= 29 && ax <= 33) put(x, 20, z, (z + 100) % 6 === 0 ? "pink_stained_glass" : "white_stained_glass");
      if ((z + 100) % 12 === 0 && ax === 31) put(x, 19, z, "lantern", { hanging: true }, true);
    }
    put(sx * 28, 15, z, "glass"); put(sx * 28, 16, z, "glass");
    if ((z + 100) % 10 === 0) { put(sx * 33, 15, z, "pink_concrete"); }
  }
  for (const sx of [-1, 1]) for (let ax = 29; ax <= 34; ax++) for (const z of [-71, 71]) for (let y = 0; y <= 20; y++) put(sx * ax, y, z, y === 20 ? "pink_concrete" : "light_gray_concrete");
  yield;

  // ------------------------------------------------------------ the start area: guard booths + railing
  for (let x = -S.FX; x <= S.FX; x++) put(x, 1, 69, "white_concrete_wall|andesite_wall");
  for (const sx of [-1, 1]) for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) for (let y = 1; y <= 4; y++) {
    const x = sx * (24 + dx), z = 60 + dz, edge = dx !== 1 || dz !== 1;
    put(x, y, z, y === 4 ? "pink_concrete" : edge && !(y === 2 && dx === 1) ? "pink_concrete" : "air");
    if (!edge) C.del(x, y, z);
  }
  yield;

  // ------------------------------------------------------------ the middle: hay bales, barrels, rocks (decoration / cover)
  let n = 0;
  for (let z = -42; z <= 44; z += 6) for (let k = 0; k < 2; k++) {
    const x = Math.floor((hash(z, k + 7) - 0.5) * 46), kind = Math.floor(hash(z, k + 9) * 3);
    if (Math.abs(x) <= 2) continue;
    if (kind === 0) { put(x, 1, z, "hay_block", { pillar_axis: "y" }); put(x + 1, 1, z, "hay_block", { pillar_axis: "y" }); if (n % 2) put(x, 2, z, "hay_block", { pillar_axis: "y" }); }
    else if (kind === 1) { put(x, 1, z, "barrel", { facing_direction: 1 }); put(x, 1, z + 1, "barrel", { facing_direction: 1 }); }
    else { put(x, 1, z, "cobblestone"); put(x + 1, 1, z, "mossy_cobblestone"); put(x, 1, z + 1, "cobblestone_slab", { "minecraft:vertical_half": "bottom" }); }
    n++;
  }
  // pink guards along the walls (pink suit, black mask)
  for (let z = -40; z <= 40; z += 20) for (const sx of [-1, 1]) {
    const x = sx * 26;
    put(x, 1, z, "black_concrete"); put(x, 2, z, "pink_concrete"); put(x, 3, z, "pink_concrete"); put(x, 4, z, "black_concrete");
    put(x, 3, z - 1, "pink_concrete"); put(x, 3, z + 1, "pink_concrete");
  }
  yield;

  // ------------------------------------------------------------ the finish gate (z -52): glowing pillars, beam, FINISH, the 2 signal lights
  const gz = -52;
  for (const sx of [-1, 1]) for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) for (let y = 1; y <= 16; y++) {
    const x = sx * (12 + dx), z = gz - 1 + dz;
    put(x, y, z, dx === 1 && dz === 1 ? "sea_lantern" : y % 4 === 0 ? "sea_lantern" : "quartz_block");
  }
  for (let x = -14; x <= 14; x++) for (let y = 14; y <= 18; y++) for (let dz = 0; dz < 2; dz++) put(x, y, gz - dz, y === 14 || y === 18 ? "sea_lantern" : "quartz_block");
  const word = "FINISH";
  for (let i = 0; i < word.length; i++) {
    const g = FONT[word[i]];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === "#") put(-11 + (i * 4 + c), 17 - r, gz + 1, "red_concrete");
  }
  for (const color of ["red", "green"]) {
    const L = S.lights[color];
    for (let dx = -S.lights.r - 1; dx <= S.lights.r + 1; dx++) for (let dy = -S.lights.r - 1; dy <= S.lights.r + 1; dy++) {
      if (Math.hypot(dx, dy) > S.lights.r + 1.3) continue;
      put(L.x + dx, L.y + dy, S.lights.z, "polished_blackstone");
    }
    for (const c of lightCells(color)) put(c.x, c.y, c.z, LIGHT.off);
    for (let y = 18; y < L.y - S.lights.r - 1; y++) put(L.x, y, S.lights.z, "polished_blackstone_wall");
  }
  yield;

  // ------------------------------------------------------------ the doll's pedestal + the bare tree
  for (let x = -3; x <= 3; x++) for (let z = -63; z <= -57; z++) { if (Math.hypot(x, z + 60) > 3.4) continue; put(x, 1, z, Math.hypot(x, z + 60) > 2.4 ? "smooth_quartz_slab|smooth_quartz" : "smooth_quartz"); }
  const tx = 10, tz = -62;
  for (let y = 1; y <= 12; y++) put(tx, y, tz, "oak_log", { pillar_axis: "y" });
  const branch = (dx, dz, y0, len, up) => { for (let i = 1; i <= len; i++) put(tx + dx * i, y0 + Math.floor(i * up), tz + dz * i, "oak_fence"); };
  branch(1, 0, 8, 4, 0.6); branch(-1, 0, 9, 4, 0.7); branch(0, 1, 10, 3, 0.8); branch(0, -1, 7, 3, 0.5); branch(1, 1, 11, 3, 0.6);
  return C;
}
export function squidArena() { const g = squidGen(); let r; while (!(r = g.next()).done); return r.value; }
