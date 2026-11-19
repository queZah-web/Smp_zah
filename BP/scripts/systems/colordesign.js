// =====================================================================================================================
// COLOR RUSH - the hall (pure data, no game calls: can be tested / previewed outside the game)
//
//   53 x 53, 22 high: a stone-brick hall.  In the middle the FLOOR (33 x 33 of wool, y +10) over a deep pit; around it a
//   gap (1 block) and a glass wall, then a walkway with seats for the viewers and the players who are out.
//   On the 4 inner walls a big COLOUR PANEL (the script paints it in the colour of the round).
//   The floor itself is painted by the script every round in one of 2 patterns:
//     "mixed"   every block its own colour (every colour the same number of times, shuffled)
//     "patches" 3 x 3 patches, one colour each (every colour the same number of times, no two equal patches side by side)
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const CR = {
  HX: 26, UP: 22, DOWN: 2,
  F: 16, FY: 10,                         // the floor: |x|, |z| <= 16 at y 10
  OUT_Y: 7.5,                            // feet lower than this = out
  view: { x: 0, y: 11, z: 21 },          // the south walkway
  panels: [],                            // filled below: the 4 colour panels [{ from, to }]
};
export const COLORS = [
  { id: "red", en: "RED", ar: "الأحمر", c: "§c" }, { id: "orange", en: "ORANGE", ar: "البرتقالي", c: "§6" }, { id: "yellow", en: "YELLOW", ar: "الأصفر", c: "§e" },
  { id: "lime", en: "LIME", ar: "الأخضر الفاتح", c: "§a" }, { id: "green", en: "GREEN", ar: "الأخضر", c: "§2" }, { id: "cyan", en: "CYAN", ar: "الفيروزي", c: "§3" },
  { id: "light_blue", en: "LIGHT BLUE", ar: "السمائي", c: "§b" }, { id: "blue", en: "BLUE", ar: "الأزرق", c: "§9" }, { id: "purple", en: "PURPLE", ar: "البنفسجي", c: "§5" },
  { id: "magenta", en: "MAGENTA", ar: "الأرجواني", c: "§d" }, { id: "pink", en: "PINK", ar: "الوردي", c: "§d" }, { id: "white", en: "WHITE", ar: "الأبيض", c: "§f" },
];
const N = CR.F * 2 + 1;                  // 33
for (const [px, pz, ax] of [[0, -25, "x"], [0, 25, "x"], [-25, 0, "z"], [25, 0, "z"]]) {
  const inward = ax === "x" ? (pz < 0 ? 1 : -1) : px < 0 ? 1 : -1;
  CR.panels.push(ax === "x" ? { from: { x: -6, y: 13, z: pz + inward * 0 }, to: { x: 6, y: 18, z: pz } } : { from: { x: px, y: 13, z: -6 }, to: { x: px, y: 18, z: 6 } });
}

/** a new floor: an array [33 * 33] of colour indexes. mode "mixed" or "patches"; rng() in [0, 1) */
export function floorPattern(mode, rng = Math.random, nColors = COLORS.length) {
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const out = new Array(N * N);
  if (mode === "patches") {
    const T = N / 3 | 0, tiles = shuffle(Array.from({ length: T * T }, (_, i) => i % nColors));
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < tiles.length; i++) {          // no two equal patches side by side
      const tx = i % T, tz = (i / T) | 0, same = (j) => j >= 0 && j < tiles.length && tiles[j] === tiles[i];
      if ((tx > 0 && same(i - 1)) || (tz > 0 && same(i - T))) { const j = Math.floor(rng() * tiles.length); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    }
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) out[x * N + z] = tiles[Math.min(T - 1, (x / 3) | 0) * T + Math.min(T - 1, (z / 3) | 0)];
  } else {
    const all = shuffle(Array.from({ length: N * N }, (_, i) => i % nColors));
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < all.length; i++) {               // fewer equal neighbours: spread out
      const x = (i / N) | 0, z = i % N;
      if ((z > 0 && all[i - 1] === all[i]) || (x > 0 && all[i - N] === all[i])) { const j = Math.floor(rng() * all.length); [all[i], all[j]] = [all[j], all[i]]; }
    }
    for (let i = 0; i < all.length; i++) out[i] = all[i];
  }
  return out;
}
export const cellOf = (i) => ({ x: ((i / N) | 0) - CR.F, z: (i % N) - CR.F });
export const FLOOR_N = N;

export function* colorGen() {
  const S = CR, C = new Canvas(), F = S.F, FY = S.FY;
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  // the pit (walls down to the bottom), its bottom
  for (let x = -18; x <= 18; x++) for (let z = -18; z <= 18; z++) {
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m <= 17) { put(x, 0, z, (x + z) % 2 ? "black_concrete" : "gray_concrete"); if (m <= 17 && (x * 5 + z * 7 + 100) % 13 === 0) put(x, 0, z, "shroomlight"); }
    if (m === 18) for (let y = 0; y <= FY; y++) put(x, y, z, y === FY ? "light_blue_concrete" : "polished_andesite");
  }
  // the first floor (white wool: the script paints it) + light under the hall
  for (let x = -F; x <= F; x++) for (let z = -F; z <= F; z++) put(x, FY, z, "white_wool");
  yield;
  // the glass wall on the light blue rim, the walkway, the hall walls
  for (let x = -26; x <= 26; x++) for (let z = -26; z <= 26; z++) {
    const m = Math.max(Math.abs(x), Math.abs(z)), along = Math.abs(x) >= Math.abs(z) ? z : x;
    if (m === 18) for (let y = FY + 1; y <= FY + 3; y++) put(x, y, z, "glass");
    if (m >= 19 && m <= 25) {
      for (let y = 0; y < FY; y++) if (m === 19 || m === 25) put(x, y, z, "stone_bricks");
      put(x, FY, z, m === 19 ? "polished_andesite" : (x + z) % 2 ? "stone_bricks" : "polished_andesite");
      if ((along + 60) % 7 === 0 && m === 22) put(x, FY, z, "sea_lantern");
    }
    if (m === 24 && (along + 60) % 4 !== 0 && Math.abs(along) < 22) put(x, FY + 1, z, "stone_brick_stairs", { weirdo_direction: Math.abs(x) >= Math.abs(z) ? (x > 0 ? 0 : 1) : (z > 0 ? 2 : 3), upside_down_bit: false });
    if (m === 26) for (let y = 0; y <= 22; y++) {
      let b = y % 6 === 0 ? "chiseled_stone_bricks" : (y + along + 60) % 9 === 0 ? "cracked_stone_bricks" : "stone_bricks";
      if (y === 22) b = "polished_andesite";
      if (y === 20 && (along + 60) % 6 === 3) b = "sea_lantern";
      put(x, y, z, b);
    }
  }
  // the 4 colour panels (on the inner face, 1 in front of the wall) with a frame
  for (const p of S.panels) {
    const ax = p.from.x === p.to.x ? "z" : "x", wall = ax === "x" ? p.from.z : p.from.x, inside = wall > 0 ? 25 : -25;
    for (let a = -7; a <= 7; a++) for (let y = 12; y <= 19; y++) {
      const edge = Math.abs(a) === 7 || y === 12 || y === 19;
      const x = ax === "x" ? a : inside, z = ax === "x" ? inside : a;
      put(x, y, z, edge ? "polished_blackstone" : "white_wool");
    }
  }
  // fix the panels to the inside row (25), lights along the top
  CR.panels.length = 0;
  for (const s of [-1, 1]) { CR.panels.push({ from: { x: -6, y: 13, z: s * 25 }, to: { x: 6, y: 18, z: s * 25 } }); CR.panels.push({ from: { x: s * 25, y: 13, z: -6 }, to: { x: s * 25, y: 18, z: 6 } }); }
  for (let x = -24; x <= 24; x += 6) for (let z = -24; z <= 24; z += 6) if (Math.max(Math.abs(x), Math.abs(z)) >= 20) put(x, FY + 1, z, "light_block_14", undefined, true);
  return C;
}
// the panels (also without building the design)
CR.panels.length = 0;
for (const s of [-1, 1]) { CR.panels.push({ from: { x: -6, y: 13, z: s * 25 }, to: { x: 6, y: 18, z: s * 25 } }); CR.panels.push({ from: { x: s * 25, y: 13, z: -6 }, to: { x: s * 25, y: 18, z: 6 } }); }
export function colorHall() { const g = colorGen(); let r; while (!(r = g.next()).done); return r.value; }
