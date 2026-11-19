// =====================================================================================================================
// DROPPER DESIGN - a giant tower with 7 drop shafts (pure data, no game calls: can be tested / previewed outside the game)
//
//   The tower: 53 x 53, 136 high, a 3 x 3 grid of shafts (7 used), with an outer shell (white + purple stripes, lights,
//   DROPPER in big letters) and the waiting LOBBY at its foot (south).  Every shaft: 15 x 15 inside, its own style,
//   a start ledge at the top (y 128), obstacles on the way down and a WATER POOL at the bottom (the goal).
//     1 THE BEGINNING   80 high   oak walls with leaves, branch platforms with big openings
//     2 GLASS TUNNEL    95 high   glass walls with light rings, a long glass tunnel with windows in the middle
//     3 THE LAVA       100 high   basalt / blackstone with magma veins, plates with (sealed) lava pools, narrow openings
//     4 ROTATION        90 high   quartz + redstone, a centre pillar with 3 ROTATING arms (the script turns them)
//     5 THE NETHER     110 high   nether bricks, crimson, glowstone, openings left / right (zig-zag)
//     6 DEEP OCEAN     100 high   prismarine, sea lanterns, coral reefs, a small landing hole
//     7 THE IMPOSSIBLE 120 high   a purple / white / orange spiral, small openings, a rotating arm at the top
//   The openings are placed so that every stage can be done: the next opening is never farther away than a player can
//   move sideways while falling (the falling speed is worked out block by block).
// =====================================================================================================================

/** compact block store (taller than the other designs). x / z: -60..60, y: -8..141 */
export class TallCanvas {
  constructor() { this.m = new Map(); this.pal = []; this.pi = new Map(); this.fills = []; }
  static k(x, y, z) { return ((x + 60) * 150 + (y + 8)) * 121 + (z + 60); }
  p(id, st, late) { const key = id + "#" + (st ? JSON.stringify(st) : "") + "#" + (late ? 1 : 0); let i = this.pi.get(key); if (i === undefined) { i = this.pal.length; this.pal.push({ id, st, late: !!late }); this.pi.set(key, i); } return i; }
  put(x, y, z, id, st, late = false) { if (id == null) { this.del(x, y, z); return; } if (y < -8 || y > 141 || x < -60 || x > 60 || z < -60 || z > 60) return; this.m.set(TallCanvas.k(x, y, z), this.p(id, st, late)); }
  del(x, y, z) { this.m.delete(TallCanvas.k(x, y, z)); }
  has(x, y, z) { return this.m.has(TallCanvas.k(x, y, z)); }
  id(x, y, z) { const i = this.m.get(TallCanvas.k(x, y, z)); return i === undefined ? null : this.pal[i].id; }
  get size() { return this.m.size; }
  /** a box filled with one block, built before the single blocks (fast: one call in the game) */
  fill(x1, y1, z1, x2, y2, z2, id) { this.fills.push({ from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) }, to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) }, id }); }
  *orderedGen() {
    const pal = this.pal, buckets = new Map(); let n = 0;
    for (const [k, i] of this.m) {
      const z = (k % 121) - 60, r = Math.floor(k / 121), y = (r % 150) - 8, x = Math.floor(r / 150) - 60;
      const p = pal[i], rank = p.id === "water" || p.id === "lava" ? 2 : p.late ? 1 : 0;
      const key = rank * 1000 + (rank === 1 ? 149 - (y + 8) : y + 8);
      let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
      b.push(x, y, z, i);
      if (++n % 4000 === 0) yield;
    }
    return [...buckets.keys()].sort((a, b) => a - b).map((k) => buckets.get(k));
  }
  ordered() { const g = this.orderedGen(); let r; while (!(r = g.next()).done); const out = []; for (const b of r.value) for (let i = 0; i < b.length; i += 4) out.push([b[i], b[i + 1], b[i + 2], b[i + 3]]); return out; }
}

export const DROP = {
  HX: 26, ZS: -26, ZN: 46, TOP: 128, UP: 136, DOWN: 3,
  IN: 7,                                        // a shaft inside: |dx|, |dz| <= 7 (walls at 8)
  lobby: { x: 0, y: 1, z: 36 },                 // the waiting lobby (south, at the foot of the tower)
  board: { x: 0, y: 6.5, z: 44 },
  stages: [
    { name: "THE BEGINNING", ar: "البداية", col: "§a", cell: [-1, -1], h: 80 },
    { name: "GLASS TUNNEL", ar: "النفق الزجاجي", col: "§b", cell: [0, -1], h: 95 },
    { name: "THE LAVA", ar: "الحمم", col: "§6", cell: [1, -1], h: 100 },
    { name: "ROTATION", ar: "الدوران", col: "§e", cell: [1, 0], h: 90 },
    { name: "THE NETHER", ar: "الجحيم", col: "§c", cell: [1, 1], h: 110 },
    { name: "DEEP OCEAN", ar: "أعماق المحيط", col: "§3", cell: [-1, 1], h: 100 },
    { name: "THE IMPOSSIBLE", ar: "المستحيل", col: "§d", cell: [-1, 0], h: 120 },
  ],
};
/** the rotating arms: { stage, x, y, z, len, id } (relative to the tower) - stage 4: 3 arms, stage 7: 1 arm */
export function rotorList() {
  const out = [];
  for (const [n, levels, id] of [[3, [20, 40, 60], "redstone_block"], [6, [5], "amethyst_block"]]) {
    const c = { x: DROP.stages[n].cell[0] * 17, z: DROP.stages[n].cell[1] * 17 };
    for (const d of levels) out.push({ stage: n, x: c.x, y: DROP.TOP - d, z: c.z, len: 7, id });
  }
  return out;
}
/** the middle of a stage (relative to the tower) */
export const stageCenter = (n) => ({ x: DROP.stages[n].cell[0] * 17, z: DROP.stages[n].cell[1] * 17 });
/** the start ledge (where the players are put) */
export const ledgeOf = (n, i = 0) => { const c = stageCenter(n); return { x: c.x + ((i % 5) - 2) * 2, y: DROP.TOP + 1, z: c.z - 6 }; };
/** y of the water surface (the pool goes 3 deep under it) */
export const poolY = (n) => DROP.TOP - DROP.stages[n].h;

// the falling: ticks needed to fall d blocks from the ledge (v = (v + 0.08) * 0.98 per tick)
const FALL = (() => { const t = [0]; let v = 0, d = 0; for (let k = 1; k < 400; k++) { v = (v + 0.08) * 0.98; d += v; t.push(d); } return t; })();
export const ticksTo = (d) => { let k = 0; while (k < FALL.length - 1 && FALL[k] < d) k++; return k; };
export const SIDE = 0.14;                       // blocks per tick a falling player can safely move sideways (real: about 0.2 - 0.29)

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clampC = (v, r) => Math.max(-DROP.IN + r, Math.min(DROP.IN - r, v));

/** the openings of a stage: [{ d (depth under the top), x, z, r (half size) }] - each one can be reached from the one before */
export function holesOf(n) {
  const S = [
    { seed: 11, depths: [16, 36, 56], r: [3, 3, 3], step: 8 },
    { seed: 22, depths: [10, 22], r: [2, 2], step: 4 },
    { seed: 33, depths: [12, 26, 40, 54, 68, 82], r: [2, 2, 2, 2, 1, 1], step: 7 },
    { seed: 44, depths: [10, 30, 50, 70], r: [2, 2, 2, 2], step: 7, avoid: true },
    { seed: 55, depths: [8, 20, 34, 48, 62, 76, 92], r: [2, 2, 2, 2, 2, 1, 1], step: 9, zig: true },
    { seed: 66, depths: [12, 28, 44, 60, 76, 92], r: [2, 2, 2, 1, 1, 1], step: 7 },
    { seed: 77, depths: [9, 20, 31, 44, 58, 72, 86, 100, 112], r: [1, 1, 1, 1, 1, 1, 1, 1, 1], step: 7, avoid: true },
  ][n];
  if (n === 1) return [{ d: 10, x: -3, z: -3, r: 2 }, { d: 22, x: 0, z: 0, r: 2 }];   // the glass tunnel: the 2nd opening leads into the tunnel
  const rng = rngOf(S.seed), out = [];
  let x = 0, z = -4, d0 = 1;
  S.depths.forEach((d, i) => {
    const r = S.r[i], reach = SIDE * (ticksTo(d) - ticksTo(d0)) + (i === 0 ? 6 : 0);
    const lim = Math.min(S.step, (out[i - 1]?.r ?? 0) + r + reach - 0.5);
    for (let tries = 0; tries < 60; tries++) {
      const span = DROP.IN - r;
      const tx = S.zig ? (i % 2 ? 1 : -1) * span : Math.round((rng() * 2 - 1) * span), tz = Math.round((rng() * 2 - 1) * span);
      const k = Math.min(1, lim / Math.max(1, Math.max(Math.abs(tx - x), Math.abs(tz - z))));
      const nx = clampC(Math.round(x + (tx - x) * k), r), nz = clampC(Math.round(z + (tz - z) * k), r);
      if (i > 0 && Math.max(Math.abs(nx - x), Math.abs(nz - z)) > out[i - 1].r + r + reach - 0.5) continue;
      if (S.avoid && Math.abs(nx) <= r + 1 && Math.abs(nz) <= r + 1) continue;
      if (i > 0 && tries < 40 && Math.max(Math.abs(nx - x), Math.abs(nz - z)) < Math.min(lim, out[i - 1].r + r) * 0.8) continue;   // too easy: try again
      x = nx; z = nz; break;
    }
    out.push({ d, x, z, r }); d0 = d;
  });
  return out;
}

const FONT = {
  D: ["##.", "#.#", "#.#", "#.#", "##."], R: ["##.", "#.#", "##.", "#.#", "#.#"], O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."], E: ["###", "#..", "##.", "#..", "###"],
};

export function* dropperGen() {
  const D = DROP, C = new TallCanvas(), T = D.TOP;
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);

  // ------------------------------------------------------------ the outer shell (fills) + its stripes, windows, lights
  C.fill(-26, 0, -26, 26, 0, 26, "polished_andesite");
  C.fill(-26, 1, -26, 26, T + 3, -26, "smooth_quartz"); C.fill(-26, 1, 26, 26, T + 3, 26, "smooth_quartz");
  C.fill(-26, 1, -25, -26, T + 3, 25, "smooth_quartz"); C.fill(26, 1, -25, 26, T + 3, 25, "smooth_quartz");
  for (let a = -26; a <= 26; a++) for (let y = 1; y <= T + 3; y++) {
    const stripe = (a + 60) % 8 === 0 ? (y % 16 === 8 ? "sea_lantern" : "purple_concrete") : y % 24 === 0 ? "purple_concrete" : y === T + 3 ? "purpur_block" : null;
    if (!stripe) continue;
    put(a, y, -26, stripe); put(a, y, 26, stripe); put(-26, y, a, stripe); put(26, y, a, stripe);
  }
  // DROPPER on the south side (looking north at it: left = west), 2 x scale
  const word = "DROPPER";
  for (let i = 0; i < word.length; i++) {
    const g = FONT[word[i]];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === "#") for (let sx = 0; sx < 2; sx++) for (let sy = 0; sy < 2; sy++) put(-21 + (i * 6 + c * 2 + sx), 40 - r * 2 - sy, 27, "magenta_concrete");
  }
  yield;

  // ------------------------------------------------------------ the 7 shafts
  for (let n = 0; n < D.stages.length; n++) {
    const st = D.stages[n], c = stageCenter(n), h = st.h, by = T - h;          // by = water surface
    const W = (dx, dz) => ({ x: c.x + dx, z: c.z + dz });
    const style = [
      { wall: "oak_log", wall2: "oak_planks", accent: "azalea_leaves", light: "shroomlight", plate: "oak_leaves", plate2: "oak_log", floor: "moss_block" },
      { wall: "white_stained_glass", wall2: "light_blue_stained_glass", accent: "light_blue_stained_glass", light: "sea_lantern", plate: "light_blue_stained_glass", plate2: "white_stained_glass", floor: "white_concrete" },
      { wall: "basalt", wall2: "blackstone", accent: "magma", light: "shroomlight", plate: "polished_blackstone", plate2: "magma", floor: "blackstone" },
      { wall: "smooth_quartz", wall2: "quartz_bricks", accent: "redstone_block", light: "sea_lantern", plate: "quartz_bricks", plate2: "redstone_block", floor: "smooth_quartz" },
      { wall: "nether_brick", wall2: "netherrack", accent: "crimson_planks", light: "glowstone", plate: "nether_wart_block", plate2: "crimson_nylium", floor: "nether_brick" },
      { wall: "prismarine", wall2: "dark_prismarine", accent: "prismarine_bricks", light: "sea_lantern", plate: "prismarine_bricks", plate2: "dark_prismarine", floor: "dark_prismarine" },
      { wall: "white_concrete", wall2: "purple_concrete", accent: "orange_concrete", light: "sea_lantern", plate: "purpur_block", plate2: "amethyst_block", floor: "purple_concrete" },
    ][n];
    // walls: fill + pattern
    const wy1 = by - 3, wy2 = T + 3;
    C.fill(c.x - 8, wy1, c.z - 8, c.x + 8, wy1, c.z + 8, style.floor);
    C.fill(c.x - 8, wy1, c.z - 8, c.x + 8, wy2, c.z - 8, style.wall); C.fill(c.x - 8, wy1, c.z + 8, c.x + 8, wy2, c.z + 8, style.wall);
    C.fill(c.x - 8, wy1, c.z - 7, c.x - 8, wy2, c.z + 7, style.wall); C.fill(c.x + 8, wy1, c.z - 7, c.x + 8, wy2, c.z + 7, style.wall);
    for (let a = -8; a <= 8; a++) for (let y = wy1; y <= wy2; y++) {
      const cells = [[a, -8], [a, 8], [-8, a], [8, a]];
      for (const [dx, dz] of cells) {
        let b = null;
        const ang = Math.atan2(dz, dx), side = Math.abs(dx) === 8 ? dz : dx;
        if (n === 0) b = (y + Math.abs(side) * 3) % 13 === 0 ? style.accent : y % 9 === 0 && Math.abs(side) % 5 === 2 ? style.light : (Math.abs(side) + Math.floor(y / 4)) % 7 === 0 ? style.wall2 : null;
        else if (n === 1) b = y % 10 === 0 ? style.light : (y + side + 40) % 6 === 0 ? style.wall2 : null;
        else if (n === 2) b = ((y + 2 * side + 80) % 11 === 0 || (y - side + 80) % 17 === 0) ? style.accent : y % 12 === 6 && Math.abs(side) % 6 === 3 ? style.light : (y + side) % 3 === 0 ? style.wall2 : null;
        else if (n === 3) b = y % 8 === 0 ? style.accent : y % 8 === 4 && Math.abs(side) % 4 === 2 ? style.light : null;
        else if (n === 4) b = (y * 7 + side * 13 + 1000) % 9 === 0 ? style.wall2 : y % 10 === 5 && Math.abs(side) % 5 === 1 ? style.light : (y + side + 80) % 14 === 0 ? style.accent : null;
        else if (n === 5) b = y % 12 === 0 && Math.abs(side) % 4 === 1 ? style.light : (y + side + 80) % 5 === 0 ? style.wall2 : (y - side + 80) % 9 === 0 ? style.accent : null;
        else { const sw = ((ang * 180) / Math.PI + 360 + y * 9) % 360; b = sw < 120 ? style.wall2 : sw < 160 ? style.accent : sw < 175 ? "light_blue_stained_glass" : null; if (y % 15 === 0 && Math.abs(side) % 4 === 0) b = style.light; }
        if (b) put(c.x + dx, y, c.z + dz, b);
      }
    }
    // the start ledge (2 deep along the north wall) + a little roof sign light
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= -6; dz++) put(c.x + dx, T, c.z + dz, dz === -6 ? "polished_blackstone_slab" : "polished_blackstone", dz === -6 ? { "minecraft:vertical_half": "bottom" } : undefined);
    for (let dx = -7; dx <= 7; dx++) put(c.x + dx, T + 1, c.z - 5, "light_block_14", undefined, true);
    // the pool: water 3 deep under the surface; around it the floor (up to the surface)
    const holes = holesOf(n), last = holes[holes.length - 1];
    const poolR = n === 0 ? 7 : n === 3 ? 7 : n === 1 ? 2 : n === 6 ? 1 : 2;
    const px = n === 0 || n === 3 ? 0 : n === 1 ? 0 : last.x, pz = n === 0 || n === 3 ? 0 : n === 1 ? 0 : last.z;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      const inPool = Math.abs(dx - px) <= poolR && Math.abs(dz - pz) <= poolR;
      for (let y = by - 2; y <= by; y++) put(c.x + dx, y, c.z + dz, inPool ? "water" : (y === by ? style.floor : style.wall2));
      if (n === 3 && Math.abs(dx) <= 0 && Math.abs(dz) <= 0) for (let y = by - 2; y <= by; y++) put(c.x, y, c.z, "obsidian");
    }
    yield;
    // the plates with the openings
    holes.forEach((hl, i) => {
      const y = T - hl.d;
      for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
        const open = Math.abs(dx - hl.x) <= hl.r && Math.abs(dz - hl.z) <= hl.r;
        if (open) continue;
        let b = (dx + dz + i) % 3 === 0 ? style.plate2 : style.plate;
        if (n === 5) { const k = Math.abs(dx * 7 + dz * 3 + i * 5) % 6; b = ["pink_concrete", "yellow_concrete", "light_blue_concrete", "magenta_concrete", "orange_concrete", "prismarine_bricks"][k]; }
        if (n === 6) b = (dx * dx + dz * dz + i * 3) % 5 === 0 ? "amethyst_block" : (dx + dz) % 2 ? "purple_concrete" : "white_concrete";
        put(c.x + dx, y, c.z + dz, b);
        if (n === 2 && Math.abs(dx - hl.x) > hl.r + 1 && Math.abs(dz - hl.z) > hl.r + 1 && (dx * 3 + dz * 5 + 100) % 7 === 0 && Math.abs(dx) < 7 && Math.abs(dz) < 7) {
          put(c.x + dx, y + 1, c.z + dz, "lava");                                            // a sealed lava pool on the plate
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!(Math.abs(dx + ox - hl.x) <= hl.r && Math.abs(dz + oz - hl.z) <= hl.r)) put(c.x + dx + ox, y + 1, c.z + dz + oz, "magma");
        }
      }
      // a frame around the opening that glows (so the players see it from above)
      for (let dx = hl.x - hl.r - 1; dx <= hl.x + hl.r + 1; dx++) for (let dz = hl.z - hl.r - 1; dz <= hl.z + hl.r + 1; dz++) {
        if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
        const edge = Math.abs(dx - hl.x) === hl.r + 1 || Math.abs(dz - hl.z) === hl.r + 1;
        if (edge && (dx + dz) % 2 === 0) put(c.x + dx, y, c.z + dz, style.light);
      }
    });
    // stage 2: the glass tunnel, stage 4 / 7: the rotors (the script turns them), stage 1: leaves, stage 6: corals
    if (n === 1) {
      const tx = 0, tz = 0, ty1 = T - 34, ty2 = by + 6;
      for (let y = ty2; y <= ty1; y++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (Math.abs(dx) !== 3 && Math.abs(dz) !== 3) continue;
        const win = (y + dx * 2 + dz * 3 + 80) % 9 === 0;
        put(c.x + tx + dx, y, c.z + tz + dz, win ? "sea_lantern" : "cyan_stained_glass");
      }
      // the pool is only under the tunnel; outside it the floor
    }
    if (n === 3 || n === 6) {
      const pillarFrom = n === 3 ? 14 : 3, pillarTo = n === 3 ? 66 : 7;
      for (let d = pillarFrom; d <= pillarTo; d++) put(c.x, T - d, c.z, n === 3 ? "obsidian" : "crying_obsidian");

    }
    if (n === 0) {
      for (let k = 0; k < 10; k++) {                                              // leaves on the walls
        const y = T - 5 - k * 7, sd = k % 4, a = ((k * 5) % 11) - 5;
        const [dx, dz] = sd === 0 ? [-7, a] : sd === 1 ? [7, a] : sd === 2 ? [a, -7] : [a, 7];
        if (y > by + 4) { put(c.x + dx, y, c.z + dz, "azalea_leaves", { persistent_bit: true }); put(c.x + dx, y - 1, c.z + dz, "flowering_azalea_leaves|azalea_leaves", { persistent_bit: true }); }
      }
    }
    if (n === 5) {                                                                   // coral reefs on the walls of the ocean
      for (let k = 0; k < 14; k++) {
        const y = by + 4 + k * 6, sd = k % 4, a = ((k * 7) % 13) - 6;
        const [dx, dz] = sd === 0 ? [-7, a] : sd === 1 ? [7, a] : sd === 2 ? [a, -7] : [a, 7];
        if (y < T - 6) put(c.x + dx, y, c.z + dz, ["pink_concrete", "yellow_concrete", "magenta_concrete", "orange_concrete"][k % 4]);
      }
    }
    yield;
  }

  // ------------------------------------------------------------ the 2 empty cells: closed tops, the roof between the shafts
  for (const [ci, cj] of [[0, 0], [0, 1]]) { const cx = ci * 17, cz = cj * 17; C.fill(cx - 8, T + 3, cz - 8, cx + 8, T + 3, cz + 8, "purpur_block"); }
  // the lobby (south of the tower): floor, benches, lamps, an arch with the 7 stage colours
  for (let x = -26; x <= 26; x++) for (let z = 27; z <= 46; z++) put(x, 0, z, (x + z) % 2 ? "white_concrete" : "light_gray_concrete");
  for (let x = -26; x <= 26; x++) { put(x, 1, 46, "purpur_slab", { "minecraft:vertical_half": "bottom" }); }
  for (const z of [27, 46]) for (const sx of [-1, 1]) for (let y = 1; y <= 4; y++) put(sx * 26, y, z, y === 4 ? "sea_lantern" : "purpur_pillar", y === 4 ? undefined : { pillar_axis: "y" });
  for (let x = -20; x <= 20; x += 5) if (Math.abs(x) > 3) { put(x, 1, 40, "purpur_stairs", { weirdo_direction: 3, upside_down_bit: false }); put(x + 1, 1, 40, "purpur_stairs", { weirdo_direction: 3, upside_down_bit: false }); }
  const COLS7 = ["lime_concrete", "light_blue_concrete", "orange_concrete", "yellow_concrete", "red_concrete", "cyan_concrete", "magenta_concrete"];
  for (let i = 0; i < 7; i++) for (let y = 1; y <= 7; y++) { put(-9 + i * 3, y, 31, y === 7 ? "sea_lantern" : COLS7[i]); }
  for (let x = -26; x <= 26; x += 6) for (let y = 1; y <= 3; y++) put(x, y, 45, y === 3 ? "lantern" : "polished_blackstone_wall", undefined, y === 3);
  for (let x = -24; x <= 24; x += 8) for (let z = 30; z <= 44; z += 7) put(x, 1, z, "light_block_14", undefined, true);
  return C;
}
export function dropperTower() { const g = dropperGen(); let r; while (!(r = g.next()).done); return r.value; }
