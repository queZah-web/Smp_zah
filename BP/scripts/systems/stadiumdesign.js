// =====================================================================================================================
// STADIUM DESIGN - a football stadium (pure data, no game calls: can be tested / previewed outside the game)
//
//   85 x 109 blocks, ~40 high.  From the middle out:
//     * the PITCH: 35 x 59 striped grass inside a WHITE LINE (the ball can never leave it), halfway line, centre circle,
//       penalty boxes, goal boxes, penalty spots, corner flags; 2 goals (7 wide, 3 high) with white posts and nets
//     * a run-off strip, glowing LED advertising boards all around
//     * the STANDS: 10 rows of dark seats on all 4 sides (aisles, corners included), 2 team dugouts (blue / red glass),
//       a top walkway, a glass canopy on dark-oak beams with lanterns over the stands
//     * UNDER the stands a concourse all around: the blue and red LOCKER ROOMS (west), a snack bar (east), the trophy
//       hall (north), the entrance hall (south), 4 staircases up to the walkway, 2 player tunnels to the pitch
//     * the outer wall (sandstone + dark-oak pillars, windows), 4 doors, 4 FLOODLIGHT towers in the corners
//     * 2 big SCOREBOARDS (score + time, the script lights the digits) with "FOOTBALL" in big letters above them
//     * outside: sidewalks, roads with white lines, cherry trees and lamp posts
//   x = across the pitch (-17..17), z = along it (-29..29).  BLUE defends the north goal (z < 0), RED the south goal (z > 0).
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

// sizes (relative to the middle of the pitch, y 0 = the grass)
export const STADIUM = {
  HX: 42, HZ: 54, UP: 40, DOWN: 4,
  FX: 17, FZ: 29,                    // grass inside the white line
  LX: 18, LZ: 30,                    // the white line (the ball stays on |x| <= 18.5, |z| <= 30.5)
  GW: 3, GH: 3, GD: 33,              // goal mouth: |x| <= 3 (7 wide), 3 high, the net is at |z| = 34 (inside: 31..33)
  center: { x: 0, y: 1, z: 0 },
  view: { x: -32, y: 11, z: 0 },     // the top walkway (west), looking at the pitch
  exit: { x: -38, y: 1, z: 0 },      // outside the west door
  dug: { blue: { x: -23, y: 1, z: -7 }, red: { x: -23, y: 1, z: 7 } },
  // the script writes the score and the time here: plane z = sz * 48, x from -14 to 14 (looking from the pitch, left -> right), y 16 .. 30
  screens: [{ sz: -1 }, { sz: 1 }],
  SCR_W: 29, SCR_Y: 16, SCR_H: 15, SCR_Z: 48,
  lockers: 24,                       // hidden barrels under the pitch (y -2): the players' own armour waits there during a match
};
/** the block of locker n (relative) */
export const lockerAt = (n) => ({ x: (n % 12) - 6, y: -2, z: n < 12 ? -2 : 2 });

// 3 x 5 pixel font (rows top -> bottom)
export const FONT = {
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["###", "..#", "###", "#..", "###"], 3: ["###", "..#", "###", "..#", "###"],
  4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "###", "..#", "###"], 6: ["###", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "###"], "-": ["...", "...", "###", "...", "..."], ":": [".", "#", ".", "#", "."], " ": ["...", "...", "...", "...", "..."],
  F: ["###", "#..", "##.", "#..", "#.."], O: ["###", "#.#", "#.#", "#.#", "###"], T: ["###", ".#.", ".#.", ".#.", ".#."], B: ["##.", "#.#", "##.", "#.#", "##."],
  A: [".#.", "#.#", "###", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
};
/** screen pixel (column c from the viewer's left, row r from the top of the screen) -> relative block */
export const screenPx = (sz, c, r) => ({ x: sz > 0 ? 14 - c : -14 + c, y: STADIUM.SCR_Y + STADIUM.SCR_H - 1 - r, z: sz * STADIUM.SCR_Z });
export const SCR = { on: "sea_lantern", off: "black_concrete", blue: "lapis_block", red: "redstone_block", frame: "polished_blackstone" };
/** the pixels of the digits: [{ c, r, on }] for "BB-RR" on the top line and "MM:SS" on the bottom line */
export function screenPixels(blue, red, secs) {
  const out = [], put = (ch, c0, r0) => { const g = FONT[ch] ?? FONT[" "]; for (let r = 0; r < 5; r++) for (let c = 0; c < g[r].length; c++) out.push({ c: c0 + c, r: r0 + r, on: g[r][c] === "#" }); };
  const two = (n) => String(Math.max(0, Math.min(99, n | 0))).padStart(2, " ");
  const b = two(blue), d = String(Math.max(0, Math.min(99, red | 0))).padEnd(2, " ");
  put(b[0], 5, 1); put(b[1], 9, 1); put("-", 13, 1); put(d[0], 17, 1); put(d[1], 21, 1);
  const m = String(Math.min(99, Math.floor(Math.max(0, secs) / 60))).padStart(2, "0"), s = String(Math.floor(Math.max(0, secs) % 60)).padStart(2, "0");
  put(m[0], 6, 8); put(m[1], 10, 8); put(":", 14, 8); put(s[0], 16, 8); put(s[1], 20, 8);
  return out;
}

const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const LEAF = { persistent_bit: true };
const CHAIN = "iron_chain|chain";
const LED = ["lime_concrete", "white_concrete", "light_blue_concrete", "yellow_concrete", "orange_concrete", "white_concrete"];

/** r = the stand ring of a column: -1 = advertising boards, 0..9 = seat rows, 10..11 = top walkway, 12 = outer wall; null = pitch / outside */
export function ringOf(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > 34 || az > 48) return null;
  if (ax <= 20 && az <= 34) return null;
  return Math.max(ax - 22, az - 36);
}

export function* stadiumGen() {
  const S = STADIUM, C = new Canvas();
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const lamp = (x, y, z, hanging) => put(x, y, z, "lantern", { hanging: !!hanging }, true);
  const hang = (x, top, z, len) => { for (let i = 0; i < len; i++) put(x, top - i, z, CHAIN, { pillar_axis: "y" }, true); lamp(x, top - len, z, true); };

  // ------------------------------------------------------------ 1. the pitch (y 0): stripes, lines, marks
  for (let x = -20; x <= 20; x++) for (let z = -34; z <= 34; z++) {
    const ax = Math.abs(x), az = Math.abs(z);
    const stripe = Math.floor((z + 34) / 5) % 2 ? "moss_block" : "green_concrete";
    let b = stripe;
    const line =
      (ax === S.LX && az <= S.LZ) || (az === S.LZ && ax <= S.LX) ||                                  // the white line around
      (z === 0 && ax <= S.FX) ||                                                                     // halfway line
      (Math.abs(Math.hypot(x, z) - 5.5) < 0.5) ||                                                    // centre circle
      (az >= 22 && az <= S.LZ && ax === 9) || (az === 22 && ax <= 9) ||                             // penalty box
      (az >= 27 && az <= S.LZ && ax === 5) || (az === 27 && ax <= 5) ||                             // goal box
      (az < 22 && az > 18 && Math.abs(Math.hypot(x, az - 25) - 5.5) < 0.5) ||                       // the arc
      (x === 0 && (z === 0 || az === 25));                                                           // spots
    if (line) b = "white_concrete";
    if (ax > S.LX || az > S.LZ) b = Math.floor((z + 34) / 5) % 2 ? "green_concrete" : "moss_block";  // run-off: the stripes go on (darker order)
    put(x, 0, z, b);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { put(sx * 19, 1, sz * 31, "end_rod", { facing_direction: 1 }, true); put(sx * 19, 0, sz * 31, "white_concrete"); }   // corner flags
  yield;

  // ------------------------------------------------------------ 2. the goals: white posts + crossbar, nets (sides, back, top)
  for (const sz of [-1, 1]) {
    const z0 = sz * 31, zb = sz * 34;
    for (const sx of [-1, 1]) for (let y = 1; y <= S.GH; y++) put(sx * (S.GW + 1), y, z0, "white_concrete");
    for (let x = -(S.GW + 1); x <= S.GW + 1; x++) put(x, S.GH + 1, z0, "white_concrete");
    for (let dz = 1; dz <= 3; dz++) {
      const z = z0 + sz * dz;
      for (let x = -(S.GW + 1); x <= S.GW + 1; x++) put(x, S.GH + 1, z, dz === 3 ? "white_concrete" : "white_stained_glass");
      for (const sx of [-1, 1]) for (let y = 1; y <= S.GH; y++) put(sx * (S.GW + 1), y, z, dz === 3 ? "white_concrete" : "white_stained_glass_pane");
      if (dz === 3) for (let x = -S.GW; x <= S.GW; x++) for (let y = 1; y <= S.GH; y++) put(x, y, z, "white_stained_glass_pane");
    }
    for (let x = -S.GW; x <= S.GW; x++) for (let dz = 1; dz <= 2; dz++) put(x, 0, z0 + sz * dz, "white_concrete");
  }
  yield;

  // ------------------------------------------------------------ 3. stands, walkway, outer wall, concourse (every column of the rings)
  for (let x = -34; x <= 34; x++) {
    for (let z = -48; z <= 48; z++) {
      const r = ringOf(x, z); if (r === null) continue;
      const ax = Math.abs(x), az = Math.abs(z);
      const side = ax - 22 >= az - 36;                        // the column belongs to a side stand (else an end stand)
      const along = side ? z : x;                              // the coordinate along the stand
      const out = side ? [Math.sign(x), 0] : [0, Math.sign(z)];
      if (r === -1) {                                          // the LED advertising boards
        put(x, 0, z, "polished_deepslate");
        const seg = Math.floor((along + 60) / 6);
        put(x, 1, z, (along + 60) % 6 === 0 ? "sea_lantern" : LED[seg % LED.length]);
        continue;
      }
      if (r === 12) {                                          // the outer wall
        const pillar = (along + 60) % 6 === 0 || (ax === 34 && az === 48);
        put(x, 0, z, "polished_deepslate");
        for (let y = 1; y <= 14; y++) {
          let b = pillar ? "dark_oak_log" : y === 1 ? "polished_deepslate" : y === 14 || y === 5 ? "dark_oak_planks" : "smooth_sandstone";
          if (!pillar && ((y >= 2 && y <= 3) || (y >= 7 && y <= 9)) && (along + 60) % 6 >= 2 && (along + 60) % 6 <= 4) b = y >= 7 ? "glass_pane" : "brown_stained_glass_pane";
          put(x, y, z, b, b === "dark_oak_log" ? { pillar_axis: "y" } : undefined);
        }
        continue;
      }
      // r 0 .. 11: floor
      const corridor = r >= 5;
      put(x, 0, z, corridor ? ((x + z) % 2 ? "smooth_sandstone" : "cut_sandstone") : "polished_deepslate");
      if (r <= 9) {                                            // a seat row: support + seat (stairs, the high side away from the pitch)
        const aisle = (along + 60) % 12 === 0;
        const from = corridor ? 5 : 1;
        for (let y = from; y <= r; y++) put(x, y, z, aisle ? "smooth_sandstone" : "deepslate_tiles");
        if (corridor && r === 5) put(x, 5, z, "deepslate_tiles");
        put(x, r + 1, z, aisle ? "smooth_sandstone_stairs" : r === 9 ? "polished_blackstone_stairs" : "deepslate_tile_stairs", { weirdo_direction: dirOf(out[0], out[1]), upside_down_bit: false });
      } else {                                                 // the top walkway
        for (let y = 5; y <= 9; y++) put(x, y, z, "deepslate_tiles");
        put(x, 10, z, r === 10 ? "smooth_sandstone" : "cut_sandstone");
      }
    }
    if (x % 12 === 0) yield;
  }
  yield;

  // ------------------------------------------------------------ 4. the glass canopy over the stands (y 15) + lanterns
  for (let x = -34; x <= 34; x++) for (let z = -48; z <= 48; z++) {
    const r = ringOf(x, z); if (r === null || r < -1) continue;
    const ax = Math.abs(x), az = Math.abs(z), side = ax - 22 >= az - 36, along = side ? z : x;
    const beam = (along + 60) % 6 === 0 || r === -1 || r === 12 || (ax - 22 === az - 36);
    put(x, 15, z, beam ? "dark_oak_planks" : "glass");
    if (beam && r >= 0 && r <= 11 && (along + 60) % 6 === 0) put(x, 16, z, "dark_oak_slab", { "minecraft:vertical_half": "bottom" });
    if (r === -1 && (along + 60) % 6 === 3) hang(x, 14, z, 1);
    if (r === 11 && (along + 60) % 12 === 6) hang(x, 14, z, 1);
  }
  yield;

  // ------------------------------------------------------------ 5. tunnels (west + east, middle), doors, staircases
  for (const sx of [-1, 1]) {
    for (let ax = 21; ax <= 26; ax++) for (let z = -2; z <= 2; z++) {
      const x = sx * ax;
      for (let y = 1; y <= 4; y++) C.del(x, y, z);
      put(x, 0, z, ax === 21 ? "white_concrete" : "smooth_sandstone");
      if (ax <= 25) put(x, 5, z, "dark_oak_planks");
    }
    for (let ax = 21; ax <= 26; ax++) for (const z of [-3, 3]) for (let y = 1; y <= 5; y++) put(sx * ax, y, z, y === 1 ? "polished_deepslate" : "dark_oak_planks");
    for (let ax = 21; ax <= 25; ax++) for (const z of [-3, 3]) put(sx * ax, 6, z, "dark_oak_slab", { "minecraft:vertical_half": "bottom" });
    hang(sx * 23, 4, 0, 0);
    // the door in the outer wall (x = +-34) and the arch
    for (let z = -2; z <= 2; z++) for (let y = 1; y <= 4; y++) C.del(sx * 34, y, z);
    for (let z = -3; z <= 3; z++) put(sx * 34, 5, z, "chiseled_sandstone");
  }
  for (const sz of [-1, 1]) {                                  // doors in the ends
    for (let x = -2; x <= 2; x++) for (let y = 1; y <= 4; y++) C.del(x, y, sz * 48);
    for (let x = -3; x <= 3; x++) put(x, 5, sz * 48, "chiseled_sandstone");
  }
  // 4 staircases up to the walkway (in the outer lane of the concourse, ring 11)
  const stair = (cells) => {
    cells.forEach(([x, z, dir], k) => {
      for (let y = k + 2; y <= 10; y++) C.del(x, y, z);
      put(x, k + 1, z, "smooth_sandstone_stairs", { weirdo_direction: dir, upside_down_bit: false });
      if (k > 0) put(x, k, z, "smooth_sandstone");
    });
  };
  stair(Array.from({ length: 10 }, (_, k) => [-33, 20 + k, 2]));
  stair(Array.from({ length: 10 }, (_, k) => [33, -20 - k, 3]));
  stair(Array.from({ length: 10 }, (_, k) => [20 + k, -47, 0]));
  stair(Array.from({ length: 10 }, (_, k) => [-20 - k, 47, 1]));
  yield;

  // ------------------------------------------------------------ 6. dugouts (west, rows 0 - 1): blue (north half) and red (south half)
  for (const [z0, team] of [[-10, "blue"], [5, "red"]]) {
    const glass = team === "blue" ? "blue_stained_glass" : "red_stained_glass", wool = team === "blue" ? "blue_wool" : "red_wool";
    for (let z = z0; z <= z0 + 5; z++) {
      for (const x of [-22, -23]) { for (let y = 1; y <= 3; y++) C.del(x, y, z); put(x, 0, z, wool); }
      put(-23, 1, z, "spruce_stairs", { weirdo_direction: 1, upside_down_bit: false });
      for (const x of [-21, -22, -23]) put(x, 3, z, glass);
      put(-24, 1, z, wool); put(-24, 2, z, "deepslate_tiles"); put(-24, 3, z, "deepslate_tiles");
    }
    for (const z of [z0 - 1, z0 + 6]) for (const x of [-22, -23]) for (let y = 1; y <= 3; y++) put(x, y, z, glass);
  }
  yield;

  // ------------------------------------------------------------ 7. the concourse: lanterns, carpets, locker rooms, snack bar, trophy hall, entrance
  for (let x = -33; x <= 33; x++) for (let z = -47; z <= 47; z++) {
    const r = ringOf(x, z); if (r === null || r < 5 || r > 11) continue;
    const ax = Math.abs(x), az = Math.abs(z), side = ax - 22 >= az - 36, along = side ? z : x;
    if (r === 8 && (along + 60) % 6 === 3 && !C.has(x, 4, z)) lamp(x, 4, z, true);
    if (r === 8 && !C.has(x, 1, z)) put(x, 1, z, side ? (x < 0 ? (z < 0 ? "blue_carpet" : "red_carpet") : "gray_carpet") : z < 0 ? "yellow_carpet" : "gray_carpet", undefined, true);
  }
  // locker rooms (west concourse): blue z -16..-4, red z 4..16 - benches, lockers (barrels), team walls
  for (const [zs, team] of [[-1, "blue"], [1, "red"]]) {
    const wool = team + "_wool", carpet = team + "_carpet";
    for (let k = 4; k <= 16; k++) {
      const z = zs * k;
      put(-33, 1, z, "barrel", { facing_direction: 5 }); put(-33, 2, z, "barrel", { facing_direction: 5 });
      put(-33, 3, z, wool);
      if (k % 3 === 0) put(-30, 1, z, "spruce_stairs", { weirdo_direction: 0, upside_down_bit: false });
      if (k % 3 === 0) put(-31, 1, z, "spruce_stairs", { weirdo_direction: 1, upside_down_bit: false });
      if (!C.has(-28, 1, z)) put(-28, 1, z, carpet, undefined, true);
    }
    for (let x = -33; x <= -27; x++) put(x, 1, zs * 17, x === -28 || x === -29 ? null : wool);
    for (let x = -33; x <= -27; x++) put(x, 2, zs * 17, x === -28 || x === -29 ? null : wool);
    put(-30, 3, zs * 17, team === "blue" ? "lapis_block" : "redstone_block");
  }
  // snack bar (east concourse): counter, smokers, barrels, cakes
  for (let z = -14; z <= 14; z++) {
    if (Math.abs(z) <= 3) continue;
    put(31, 1, z, "stripped_birch_log", { pillar_axis: "z" });
    if (Math.abs(z) % 4 === 0) put(33, 1, z, "smoker", { "minecraft:cardinal_direction": "west" }); else put(33, 1, z, "barrel", { facing_direction: 4 });
    put(33, 2, z, Math.abs(z) % 3 === 0 ? "flower_pot" : "white_wool");
    if (Math.abs(z) % 5 === 0) put(31, 2, z, "cake", undefined, true);
  }
  for (const z of [-20, -24, 20, 24]) { put(29, 1, z, "spruce_fence"); put(29, 2, z, "spruce_pressure_plate", undefined, true); put(28, 1, z, "spruce_stairs", { weirdo_direction: 0, upside_down_bit: false }); put(30, 1, z, "spruce_stairs", { weirdo_direction: 1, upside_down_bit: false }); }
  // trophy hall (north concourse): pedestals with gold / diamond / emerald, quartz columns
  for (let x = -24; x <= 24; x += 6) {
    if (Math.abs(x) <= 3) continue;
    put(x, 1, -45, "quartz_pillar", { pillar_axis: "y" }); put(x, 2, -45, x % 12 === 0 ? "gold_block" : "diamond_block");
    put(x, 1, -42, "quartz_pillar", { pillar_axis: "y" }); put(x, 2, -42, "emerald_block");
  }
  for (let x = -12; x <= 12; x++) if (Math.abs(x) > 2) put(x, 1, -47, "yellow_carpet", undefined, true);
  // entrance hall (south concourse): turnstiles (fences), ticket desks
  for (let x = -10; x <= 10; x += 2) if (Math.abs(x) > 2) { put(x, 1, 44, "iron_bars"); put(x, 2, 44, "iron_bars"); }
  for (const x of [-16, -15, -14, 14, 15, 16]) { put(x, 1, 46, "stripped_dark_oak_log", { pillar_axis: "x" }); put(x, 2, 47, "lectern", { "minecraft:cardinal_direction": "north" }, true); }
  yield;

  // ------------------------------------------------------------ 8. floodlight towers (outside the 4 corners)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bx = sx * 35, bz = sz * 49;
    for (let y = 0; y <= 30; y++) for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) put(bx + sx * dx, y, bz + sz * dz, y % 10 === 0 ? "polished_blackstone" : "dark_oak_log", y % 10 === 0 ? undefined : { pillar_axis: "y" });
    for (let dx = -2; dx <= 3; dx++) for (let dz = -2; dz <= 3; dz++) {
      const x = bx + sx * dx, z = bz + sz * dz, edge = dx === -2 || dx === 3 || dz === -2 || dz === 3;
      put(x, 31, z, "polished_blackstone");
      put(x, 32, z, edge ? "polished_blackstone" : "sea_lantern");
      put(x, 33, z, edge ? "polished_blackstone_wall" : "sea_lantern");
      if (!edge) put(x, 34, z, "polished_blackstone");
    }
    for (const [dx, dz] of [[-2, -2], [3, -2], [-2, 3], [3, 3]]) put(bx + sx * dx, 34, bz + sz * dz, "end_rod", { facing_direction: 1 }, true);
    put(bx, 35, bz, "lightning_rod", { facing_direction: 1 }, true);
  }
  yield;

  // ------------------------------------------------------------ 9. the scoreboards (score + time) and FOOTBALL above them
  for (const sc of S.screens) {
    const sz = sc.sz;
    for (let c = -1; c <= S.SCR_W; c++) for (let r = -1; r <= S.SCR_H; r++) {
      const p = screenPx(sz, c, r);
      const border = c === -1 || c === S.SCR_W || r === -1 || r === S.SCR_H;
      put(p.x, p.y, p.z, border ? SCR.frame : SCR.off);
      put(p.x, p.y, p.z + sz, SCR.frame);                     // the back
    }
    for (let r = 1; r <= 5; r++) for (let c = 1; c <= 3; c++) { const a = screenPx(sz, c, r), b = screenPx(sz, S.SCR_W - 1 - c, r); put(a.x, a.y, a.z, SCR.blue); put(b.x, b.y, b.z, SCR.red); }
    for (const px of screenPixels(0, 0, 0)) { if (!px.on) continue; const p = screenPx(sz, px.c, px.r); put(p.x, p.y, p.z, SCR.on); }
    for (let c = 0; c < S.SCR_W; c++) { const p = screenPx(sz, c, 7); put(p.x, p.y, p.z, c % 2 ? SCR.frame : SCR.off); }
    // FOOTBALL (8 letters, 3 + 1 wide) above the screen
    const word = "FOOTBALL";
    for (let i = 0; i < word.length; i++) {
      const g = FONT[word[i]];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] !== "#") continue;
        const col = -1 + i * 4 + c, p = screenPx(sz, col, -3 - (4 - r));
        put(p.x, p.y + 0, p.z, "lime_concrete");
        if (r === 4) put(p.x, p.y - 1, p.z, "slime|slime_block");
      }
    }
    // the screen stands on 2 pillars
    for (const xx of [-10, 10]) for (let y = 1; y < S.SCR_Y; y++) put(xx, y, sz * (S.SCR_Z + 1), "polished_blackstone");
  }
  yield;

  // ------------------------------------------------------------ 10. outside: sidewalks, roads, cherry trees, lamp posts
  for (let x = -S.HX; x <= S.HX; x++) for (let z = -S.HZ; z <= S.HZ; z++) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax <= 34 && az <= 48) continue;
    if (C.has(x, 0, z)) continue;
    let b;
    if (ax >= 37 && ax <= 39 && az <= 50) b = ax === 38 && (z + 60) % 4 < 2 ? "white_concrete" : "deepslate_tiles";                       // the roads (sides)
    else if (az >= 51 && az <= 53 && ax <= 39) b = az === 52 && (x + 60) % 4 < 2 ? "white_concrete" : "deepslate_tiles";                // the roads (ends)
    else if (ax >= 41 || az >= 54) b = "grass_block";
    else b = (x + z) % 2 ? "smooth_sandstone" : "cut_sandstone";
    put(x, 0, z, b);
  }
  for (const sx of [-1, 1]) {                                   // cherry trees on the grass strips, lamp posts on the sidewalks
    for (let z = -44; z <= 44; z += 11) {
      const tx = sx * 41;
      for (let y = 1; y <= 3; y++) put(tx, y, z, "cherry_log", { pillar_axis: "y" });
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = 3; y <= 5; y++) {
        if (dx === 0 && dz === 0 && y === 3) continue;
        if (Math.abs(dx) + Math.abs(dz) === 2 && y !== 4) continue;
        if (Math.abs(tx + dx) > S.HX) continue;
        put(tx + dx, y, z + dz, "cherry_leaves", LEAF, true);
      }
    }
    for (let z = -42; z <= 42; z += 12) { const lx = sx * 36; put(lx, 1, z, "polished_blackstone_wall"); put(lx, 2, z, "polished_blackstone_wall"); put(lx, 3, z, "lantern", { hanging: false }, true); }
  }
  for (const sz of [-1, 1]) for (let x = -30; x <= 30; x += 10) { if (x === 0) continue; const lz = sz * 50; put(x, 1, lz, "polished_blackstone_wall"); put(x, 2, lz, "polished_blackstone_wall"); put(x, 3, lz, "lantern", { hanging: false }, true); }
  yield;

  // ------------------------------------------------------------ 11. hidden lockers under the pitch (barrels, y -2) + light blocks (no mobs)
  for (let n = 0; n < S.lockers; n++) { const l = lockerAt(n); put(l.x, l.y, l.z, "barrel", { facing_direction: 1 }); }
  for (let x = -18; x <= 18; x += 9) for (let z = -27; z <= 27; z += 9) if (!C.has(x, 1, z)) put(x, 1, z, "light_block_14", undefined, true);
  for (let x = -30; x <= 30; x += 10) for (let z = -44; z <= 44; z += 11) { const r = ringOf(x, z); if (r !== null && r >= 5 && r <= 11 && !C.has(x, 2, z)) put(x, 2, z, "light_block_14", undefined, true); }
  return C;
}
export function stadium() { const g = stadiumGen(); let r; while (!(r = g.next()).done); return r.value; }
