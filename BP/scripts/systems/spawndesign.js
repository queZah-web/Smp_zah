// =====================================================================================================================
// SPAWN DESIGNS (pure data: no game calls here, so it can be tested / previewed outside the game)
//
//   grandSpawn()  -> "The Ancient Sanctuary"  151 x 151 blocks, up to ~40 high
//       * a walled city: mossy stone walls (14 high) with buttresses, hanging leaves and glow berries,
//         4 corner towers (copper roofs), 4 big gates with gate towers
//       * the middle: an island with a GIANT tree of life (roots, branches, huge canopy, glowing vines), a water moat, 4 bridges
//       * 4 avenues with lamp posts, planters and stone guardian statues
//       * NE: the Crate Temple (gothic hall, 2 spire towers, rose window, 3 crate altars)
//       * NW: the Hall of Legends (round courtyard, colonnade, 10 obelisks for the TOP boards, a crowned statue)
//       * SE: a terraced cliff with a waterfall into a pool (merges into the corner tower)
//       * SW: the Ruins garden (fountain, broken colonnade, benches) + a leafy pergola walk
//       * gardens everywhere: trees, bushes, flowers, invisible light blocks (no mobs)
//   smallSpawn()  -> the 41 x 41 garden spawn
//
// Both return a Canvas: blocks are kept compact (one number per block) and come out already in a safe building order.
// =====================================================================================================================

/** compact block store. x / z: -80..89, y: -12..57 */
export class Canvas {
  constructor() { this.m = new Map(); this.pal = []; this.pi = new Map(); }
  static k(x, y, z) { return ((x + 80) * 70 + (y + 12)) * 170 + (z + 80); }
  p(id, st, late) {
    const key = id + "#" + (st ? JSON.stringify(st) : "") + "#" + (late ? 1 : 0);
    let i = this.pi.get(key);
    if (i === undefined) { i = this.pal.length; this.pal.push({ id, st, late: !!late }); this.pi.set(key, i); }
    return i;
  }
  put(x, y, z, id, st, late = false) { if (y < -12 || y > 57 || x < -80 || x > 89 || z < -80 || z > 89) return; this.m.set(Canvas.k(x, y, z), this.p(id, st, late)); }
  del(x, y, z) { this.m.delete(Canvas.k(x, y, z)); }
  has(x, y, z) { return this.m.has(Canvas.k(x, y, z)); }
  id(x, y, z) { const i = this.m.get(Canvas.k(x, y, z)); return i === undefined ? null : this.pal[i].id; }
  get size() { return this.m.size; }
  /** same as ordered(), a little at a time (for system.runJob); the result is the generator's return value */
  *orderedGen() {
    const pal = this.pal, buckets = new Map(); let n = 0;
    for (const [k, i] of this.m) {
      const z = (k % 170) - 80, r = Math.floor(k / 170), y = (r % 70) - 12, x = Math.floor(r / 70) - 80;
      const p = pal[i], rank = p.id === "water" ? 2 : p.late ? 1 : 0;
      const key = rank * 100 + (rank === 1 ? 69 - (y + 12) : y + 12);
      let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
      b.push(x, y, z, i);
      if (++n % 4000 === 0) yield;
    }
    return [...buckets.keys()].sort((a, b) => a - b).map((k) => buckets.get(k));     // flat arrays [x, y, z, i, x, y, z, i ...]
  }
  /** every block as [x, y, z, paletteIndex] in building order: solid blocks bottom-up, then hanging / standing things top-down, water last */
  ordered() {
    const out = [];
    for (const [k, i] of this.m) {
      const z = (k % 170) - 80, r = Math.floor(k / 170), y = (r % 70) - 12, x = Math.floor(r / 70) - 80;
      out.push([x, y, z, i]);
    }
    const pal = this.pal, rank = (e) => { const p = pal[e[3]]; return p.id === "water" ? 2 : p.late ? 1 : 0; };
    out.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? b[1] - a[1] : a[1] - b[1]));
    return out;
  }
}

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LEAF = { persistent_bit: true };
const AGE = { growing_plant_age: 25 };
// stairs: the high side looks towards this direction (0 = +x, 1 = -x, 2 = +z, 3 = -z)
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const rnd = (v) => Math.sign(v) * Math.round(Math.abs(v));
const FLOWERS = ["cornflower", "allium", "oxeye_daisy", "lily_of_the_valley", "azure_bluet", "pink_tulip", "white_tulip", "blue_orchid", "dandelion", "poppy"];
const COPPER_LANTERN = "waxed_oxidized_copper_lantern|soul_lantern";
const CHAIN = "waxed_oxidized_copper_chain|iron_chain|chain";

// =====================================================================================================================
// THE ANCIENT SANCTUARY (151 x 151)
// =====================================================================================================================
export const GRAND = {
  R: 75, UP: 52, DOWN: 8, spawn: { x: 0, y: 2, z: 13 },
  // the 3 crates (crates.js types) and where they stand (on their altars)
  crates: [{ type: "rare", x: 40, y: 3, z: -59 }, { type: "legendary", x: 47, y: 3, z: -59 }, { type: "epic", x: 54, y: 3, z: -59 }],
  // the 10 TOP boards (ranks.js list keys), placed around the Hall of Legends
  hall: { x: -46, z: -46 },
  boards: ["money", "kills", "duel", "play", "clan", "sell", "buy", "shards", "skills", "ach"],
  places: { crates: { x: 47, y: 1, z: -40 }, top: { x: -46, y: 1, z: -31 } },
};
/** where the 10 TOP boards stand (relative): [{ key, x, y, z }] */
export function boardSpots() {
  const out = [], c = GRAND.hall;
  GRAND.boards.forEach((key, k) => {
    const a = ((108 + 36 * k) * Math.PI) / 180;
    out.push({ key, x: c.x + Math.cos(a) * 11 + 0.5, y: 1.5, z: c.z + Math.sin(a) * 11 + 0.5 });
  });
  return out;
}

/** the design, made a little at a time (for system.runJob) */
export function* grandSpawnGen() {
  const C = new Canvas(), rng = rngOf(77011);
  const R = GRAND.R;
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const res = new Set();                                       // reserved columns: no garden decoration / trees here
  const reserve = (x, z) => res.add(x + "," + z);
  const isRes = (x, z) => res.has(x + "," + z);
  const pick = (list) => { let q = rng(), s = 0; for (const [id, w] of list) { s += w; if (q < s) return id; } return list[list.length - 1][0]; };
  const STONE = [["stone_bricks", 0.46], ["mossy_stone_bricks", 0.32], ["cracked_stone_bricks", 0.12], ["mossy_cobblestone", 0.1]];
  const DARK = [["deepslate_bricks", 0.55], ["polished_deepslate", 0.2], ["cracked_deepslate_bricks", 0.12], ["tuff_bricks", 0.13]];
  const ROCK = [["stone", 0.34], ["andesite", 0.22], ["mossy_cobblestone", 0.16], ["tuff", 0.14], ["cobblestone", 0.14]];
  const stone = () => pick(STONE), dark = () => pick(DARK), rock = () => pick(ROCK);
  const leaf = () => { const q = rng(); return q < 0.5 ? "oak_leaves" : q < 0.8 ? "azalea_leaves" : "azalea_leaves_flowered"; };
  const turn = (k, a, b) => { let x = a, z = b; for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; };   // local (along, minor) -> world, k * 90 degrees
  const hangBerries = (x, y, z, len) => { for (let i = 0; i < len; i++) { if (C.has(x, y - i, z) || y - i < 4) break; put(x, y - i, z, i === len - 1 ? "cave_vines_head_with_berries" : "cave_vines_body_with_berries", AGE, true); } };
  const ellipsoid = (cx, cy, cz, rx, ry, rz, fn) => {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
      if (d <= 1) fn(x, y, z, d);
    }
  };
  /** a leaf cluster; remembers the lowest leaf of every column (for hanging vines / lanterns) */
  const lows = new Map();
  const canopy = (cx, cy, cz, rx, ry) => ellipsoid(cx, cy, cz, rx, ry, rx, (x, y, z, d) => {
    if (d > 1 - rng() * 0.22 || C.has(x, y, z)) return;
    put(x, y, z, leaf(), LEAF);
    const k = x + "," + z; if (!lows.has(k) || lows.get(k) > y) lows.set(k, y);
  });

  yield;
  // ------------------------------------------------------------ 1. ground: grass everywhere (decorated at the end)
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) put(x, 0, z, "grass_block");

  yield;
  // ------------------------------------------------------------ 2. outer walls, corner towers, gates
  const TOWER = 64;                                            // corner towers: |x| and |z| >= 64
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m < 72) continue;
    reserve(x, z);
    if (Math.abs(x) >= TOWER && Math.abs(z) >= TOWER) continue;  // tower (below)
    const minor = Math.abs(x) >= 72 && Math.abs(z) < 72 ? Math.abs(z) : Math.abs(x);
    if (minor <= 4) put(x, 0, z, minor === 4 ? "polished_andesite" : "stone_bricks");
    for (let y = 1; y <= 14; y++) {
      if (minor <= 4 && y <= (minor <= 2 ? 10 : 12 - minor)) continue;          // gate opening (pointed)
      const edge = minor <= 5 && y <= 12;
      put(x, y, z, edge && y === (minor <= 2 ? 11 : 13 - minor) ? "chiseled_stone_bricks" : stone());
    }
    if (m === 75 || m === 72) { if ((x + z) % 2 === 0) put(x, 15, z, rng() < 0.3 ? leaf() : stone(), rng() < 0.3 ? LEAF : undefined); }   // crenellations
    else if (rng() < 0.35) put(x, 15, z, leaf(), LEAF);                                                        // leaves on the wall walk
    put(x, 14, z, "stone_bricks");
  }
  // gate towers (both sides of every gate) + lanterns
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    for (let a = 69; a <= 75; a++) for (let b = 6; b <= 10; b++) {
      const [x, z] = turn(k, a, b * s); reserve(x, z);
      for (let y = 1; y <= 20; y++) put(x, y, z, y === 1 || y === 20 ? "chiseled_stone_bricks" : stone());
      if ((a + b) % 2 === 0) put(x, 21, z, stone());
    }
    const [lx, lz] = turn(k, 68, 6 * s); put(lx, 8, lz, COPPER_LANTERN, { hanging: false }, true);
    const [sx, sz] = turn(k, 68, 6 * s); put(sx, 7, sz, "chiseled_stone_bricks");
  }
  // buttresses on the inner side of the walls, with lanterns; curtains of leaves and glow berries
  for (let k = 0; k < 4; k++) for (let b = -60; b <= 60; b++) {
    if (Math.abs(b) <= 12) continue;
    if (((b % 12) + 12) % 12 === 0) {
      for (const a of [70, 71]) for (const bb of [b, b + 1]) {
        const [x, z] = turn(k, a, bb); reserve(x, z);
        for (let y = 1; y <= 16; y++) if (a === 71 || y <= 12) put(x, y, z, y === 1 || y === 16 ? "chiseled_stone_bricks" : stone());
      }
      const [x, z] = turn(k, 71, b); put(x, 17, z, COPPER_LANTERN, { hanging: false }, true);
      const [hx, hz] = turn(k, 69, b); put(hx, 11, hz, "soul_lantern", { hanging: true }, true);
      const [ox, oz] = turn(k, 70, b); put(ox, 12, oz, "chiseled_stone_bricks");
    } else if (rng() < 0.4) {
      const [x, z] = turn(k, 71, b), len = 1 + Math.floor(rng() * 5);
      for (let y = 14; y > 14 - len; y--) put(x, y, z, leaf(), LEAF);
      if (rng() < 0.6) hangBerries(x, 14 - len, z, 1 + Math.floor(rng() * 3));
    }
  }
  // corner towers: 12 x 12, 30 high, windows, crenellations, copper roof
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let a = TOWER; a <= R; a++) for (let b = TOWER; b <= R; b++) {
      const x = a * sx, z = b * sz; reserve(x, z);
      const wall = a === TOWER || a === R || b === TOWER || b === R;
      for (let y = 1; y <= 30; y++) {
        if (!wall) { if (y === 1 || y === 15) put(x, y, z, "polished_andesite"); continue; }
        const win = (y % 8 === 4 || y % 8 === 5) && ((a + b) % 4 === 0) && a !== b;
        put(x, y, z, win ? "cyan_stained_glass" : y % 10 === 0 ? "chiseled_stone_bricks" : stone());
      }
      if (wall && (a + b) % 2 === 0) put(x, 31, z, stone());
      if (!wall) put(x, 30, z, "stone_bricks");
    }
    for (let lv = 0; lv < 6; lv++) {                               // pyramid roof
      const lo = TOWER + 1 + lv, hi = R - 1 - lv; if (lo > hi) break;
      for (let a = lo; a <= hi; a++) for (let b = lo; b <= hi; b++) if (a === lo || a === hi || b === lo || b === hi || lv === 5) put(a * sx, 31 + lv, b * sz, "waxed_oxidized_cut_copper");
    }
    put(70 * sx, 36, 70 * sz, "waxed_oxidized_copper"); put(70 * sx, 37, 70 * sz, "end_rod", { facing_direction: 1 }, true);
    const ix = (TOWER - 1) * sx, iz = (TOWER - 1) * sz;             // lanterns at the inner corner
    put(ix, 1, iz, "chiseled_stone_bricks"); put(ix, 2, iz, "stone_bricks"); put(ix, 3, iz, COPPER_LANTERN, { hanging: false }, true);
  }

  yield;
  // ------------------------------------------------------------ 3. centre: moat, island, tree of life
  for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) {
    const r = Math.hypot(x, z); if (r > 21.5) continue;
    reserve(x, z);
    const bridge = Math.min(Math.abs(x), Math.abs(z)) <= 4;
    if (r >= 17 && r < 20.5) {                                       // moat (water 2 deep, lights at the bottom)
      put(x, -3, z, (Math.abs(x) + Math.abs(z)) % 5 === 0 ? "sea_lantern" : "prismarine_bricks");
      put(x, -2, z, "water", { liquid_depth: 0 }, true); put(x, -1, z, "water", { liquid_depth: 0 }, true);
      if (bridge) { put(x, 0, z, Math.min(Math.abs(x), Math.abs(z)) === 4 ? "polished_andesite" : "stone_bricks"); if (Math.min(Math.abs(x), Math.abs(z)) === 4) put(x, 1, z, "stone_brick_slab", { "minecraft:vertical_half": "bottom" }); }
      else C.del(x, 0, z);
    } else if ((r >= 16.5 && r < 17) || (r >= 20.5 && r < 21.5)) { put(x, -1, z, "mossy_stone_bricks"); put(x, -2, z, "mossy_stone_bricks"); }
    if (r < 17) {                                                    // island one block up
      put(x, 0, z, "dirt");
      const pathM = Math.min(Math.abs(x), Math.abs(z));
      if (r >= 15.5) put(x, 1, z, pathM <= 3 ? "stone_brick_stairs" : "mossy_stone_bricks", pathM <= 3 ? { weirdo_direction: dirOf(-x, -z), upside_down_bit: false } : undefined);
      else if (pathM <= 2 && r > 4) put(x, 1, z, rng() < 0.3 ? "mossy_stone_bricks" : "stone_bricks");
      else put(x, 1, z, rng() < 0.15 ? "moss_block" : "grass_block");
    }
  }
  // light pillars around the tree
  for (let k = 0; k < 8; k++) {
    const a = ((k * 45 + 22.5) * Math.PI) / 180, x = rnd(Math.cos(a) * 11), z = rnd(Math.sin(a) * 11);
    put(x, 2, z, "chiseled_stone_bricks"); put(x, 3, z, "mossy_stone_bricks"); put(x, 4, z, "chiseled_stone_bricks"); put(x, 5, z, "verdant_froglight");
  }
  // the TREE OF LIFE: trunk, roots, branches, canopy
  const trunkR = (y) => (y <= 12 ? 2.7 : y <= 20 ? 2 : y <= 27 ? 1.3 : 0.7);
  for (let y = 2; y <= 31; y++) { const r0 = trunkR(y); for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, z) <= r0) put(x, y, z, "dark_oak_log", { pillar_axis: "y" }); }
  for (let k = 0; k < 8; k++) {
    const a = ((k * 45 + 12) * Math.PI) / 180;
    for (let t = 0; t <= 7; t += 0.5) {
      const x = rnd(Math.cos(a) * (2.6 + t)), z = rnd(Math.sin(a) * (2.6 + t)), top = 2 + Math.max(0, Math.round(3.2 - t * 0.55));
      for (let y = 2; y <= top; y++) put(x, y, z, "dark_oak_log", { pillar_axis: Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? "x" : "z" });
    }
  }
  const BR = [[14, 0, 11, 7], [16, 70, 10, 8], [19, 140, 12, 7], [15, 200, 11, 8], [21, 255, 10, 7], [17, 310, 12, 8], [24, 30, 8, 6], [24, 230, 8, 6]];
  for (const [h0, deg, L, rise] of BR) {
    const a = (deg * Math.PI) / 180, ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? "x" : "z";
    let ex = 0, ey = 0, ez = 0;
    for (let t = 0; t <= L; t += 0.4) {
      const r0 = 1.6 + t, x = rnd(Math.cos(a) * r0), z = rnd(Math.sin(a) * r0), y = Math.round(h0 + (rise * t) / L);
      put(x, y, z, "dark_oak_log", { pillar_axis: ax }); if (t < L * 0.5) put(x, y - 1, z, "dark_oak_log", { pillar_axis: ax });
      ex = x; ey = y; ez = z;
    }
    canopy(ex, ey + 2, ez, 5.5, 3.6);
  }
  canopy(0, 31, 0, 13, 6.5);
  canopy(0, 36, 0, 8, 4);
  for (const [k, y] of lows) {                                      // glow berries + lanterns under the canopy
    const [x, z] = k.split(",").map(Number);
    if (Math.hypot(x, z) < 3.5) continue;
    const q = rng();
    if (q < 0.2) hangBerries(x, y - 1, z, 1 + Math.floor(rng() * 4));
    else if (q < 0.235 && y - 1 >= 8 && !C.has(x, y - 1, z)) put(x, y - 1, z, COPPER_LANTERN, { hanging: true }, true);
  }

  yield;
  // ------------------------------------------------------------ 4. the 4 avenues (gate -> island)
  const statue = (bx, bz, fx, fz) => {                             // a stone guardian (7 high) looking towards (fx, fz)
    const rx = -fz, rz = fx, P = (r, f, y, id, st, late) => put(bx + rx * r + fx * f, y, bz + rz * r + fz * f, id, st, late);
    for (let r = -1; r <= 1; r++) for (let f = -1; f <= 1; f++) { P(r, f, 1, "chiseled_stone_bricks"); P(r, f, 2, "polished_andesite"); reserve(bx + rx * r + fx * f, bz + rz * r + fz * f); }
    for (let y = 3; y <= 5; y++) for (let r = -1; r <= 1; r++) P(r, 0, y, stone());                   // robe
    for (let y = 6; y <= 8; y++) for (let r = -1; r <= 1; r++) for (const f of [0, -1]) P(r, f, y, stone());   // body
    for (const r of [-2, 2]) { P(r, 0, 7, stone()); P(r, 0, 6, stone()); }                            // arms
    for (let y = 3; y <= 7; y++) P(0, 1, y, "polished_diorite");                                   // sword
    P(-1, 1, 6, "polished_diorite"); P(1, 1, 6, "polished_diorite"); P(0, 1, 8, "chiseled_stone_bricks");
    P(0, 0, 9, "mossy_stone_bricks"); P(0, -1, 9, stone()); P(0, 0, 10, "chiseled_stone_bricks"); P(0, -1, 10, stone());   // head + hood
    P(-1, 0, 9, "azalea_leaves", LEAF); P(1, -1, 9, "azalea_leaves_flowered", LEAF); P(0, -1, 11, "moss_block");
  };
  for (let k = 0; k < 4; k++) {
    for (let a = 17; a <= 71; a++) for (let b = -5; b <= 5; b++) {
      const [x, z] = turn(k, a, b), ab = Math.abs(b), r = Math.hypot(x, z);
      if (r < 20.5) continue;                                                             // bridge part is done by the moat
      reserve(x, z);
      if (ab <= 3) put(x, 0, z, ab === 3 ? "polished_andesite" : a % 8 === 0 ? "chiseled_stone_bricks" : stone());
      else if (ab === 4) { put(x, 0, z, "moss_block"); if (rng() < 0.3) put(x, 1, z, rng() < 0.5 ? "fern" : "short_grass", undefined, true); }
      else {
        if (a % 10 === 5 && a < 66) {                                                     // lamp post
          put(x, 0, z, "stone_bricks"); put(x, 1, z, "chiseled_stone_bricks"); put(x, 2, z, "stone_bricks"); put(x, 3, z, "stone_bricks"); put(x, 4, z, "chiseled_stone_bricks");
          put(x, 5, z, COPPER_LANTERN, { hanging: false }, true);
        } else if (a < 68) { put(x, 0, z, "stone_bricks"); put(x, 1, z, "mossy_stone_bricks"); if (rng() < 0.55) put(x, 2, z, leaf(), LEAF); }
      }
    }
    for (const a of [30, 57]) for (const s of [-1, 1]) {                                 // guardian statues facing the avenue
      const [x, z] = turn(k, a, 8 * s), [fx, fz] = turn(k, 0, -s); statue(x, z, fx, fz);
    }
  }

  yield;
  // ------------------------------------------------------------ 5. NE: the CRATE TEMPLE
  {
    const X1 = 32, X2 = 62, Z1 = -64, Z2 = -36, XC = 47;
    for (let x = X1 - 3; x <= X2 + 3; x++) for (let z = Z1 - 2; z <= Z2 + 6; z++) reserve(x, z);
    for (let x = X1; x <= X2; x++) for (let z = Z1; z <= Z2; z++) {
      const wall = x === X1 || x === X2 || z === Z1 || z === Z2;
      put(x, 0, z, Math.abs(x - XC) <= 2 ? ((z % 4 === 0) ? "sea_lantern" : "dark_prismarine") : (x + z) % 2 ? "polished_deepslate" : "deepslate_tiles");
      if (wall) for (let y = 1; y <= 17; y++) put(x, y, z, y === 1 || y === 17 ? "polished_deepslate" : dark());
      put(x, 18, z, "deepslate_tiles");
      if (wall && (x + z) % 2 === 0) put(x, 19, z, "polished_deepslate");
    }
    // door (pointed arch) + frame + rose window
    for (let x = XC - 2; x <= XC + 2; x++) for (let y = 1; y <= 9; y++) if (y <= 8 || Math.abs(x - XC) <= 1) C.del(x, y, Z2);
    C.del(XC, 10, Z2);
    for (let y = 1; y <= 10; y++) { put(XC - 3, y, Z2, "chiseled_deepslate"); put(XC + 3, y, Z2, "chiseled_deepslate"); }
    put(XC - 2, 10, Z2, "chiseled_deepslate"); put(XC + 2, 10, Z2, "chiseled_deepslate"); put(XC - 1, 11, Z2, "chiseled_deepslate"); put(XC + 1, 11, Z2, "chiseled_deepslate"); put(XC, 11, Z2, "chiseled_deepslate");
    for (let x = XC - 5; x <= XC + 5; x++) for (let y = 9; y <= 17; y++) {
      const d = Math.hypot(x - XC, y - 13.5);
      if (y >= 12 && d <= 3.6) put(x, y, Z2, d <= 1 ? "sea_lantern" : (Math.abs(x - XC) + y) % 2 ? "cyan_stained_glass" : "light_blue_stained_glass");
      else if (y >= 12 && d <= 4.5) put(x, y, Z2, "chiseled_deepslate");
    }
    // side windows + buttresses with lanterns
    for (const x of [X1, X2]) for (let z = Z1 + 3; z <= Z2 - 3; z++) {
      const out = x === X1 ? -1 : 1;
      if ((z - Z1) % 6 === 0) {
        for (let y = 1; y <= 14; y++) { put(x + out, y, z, dark()); if (y <= 9) put(x + 2 * out, y, z, dark()); }
        put(x + out, 15, z, "polished_deepslate"); put(x + out, 16, z, "soul_lantern", { hanging: false }, true);
      } else if ((z - Z1) % 6 === 3) for (let y = 5; y <= 13; y++) for (const dz of [0, 1]) put(x, y, z + dz, y === 13 ? "chiseled_deepslate" : "cyan_stained_glass");
    }
    // the two spire towers at the front
    for (const tx of [X1 + 4, X2 - 8]) {
      for (let x = tx; x <= tx + 4; x++) for (let z = Z2 - 2; z <= Z2 + 2; z++) {
        const edge = x === tx || x === tx + 4 || z === Z2 - 2 || z === Z2 + 2;
        for (let y = 1; y <= 24; y++) if (edge || y === 18) put(x, y, z, (y % 6 === 3 && edge && (x === tx + 2 || z === Z2)) ? "cyan_stained_glass" : y % 8 === 0 ? "chiseled_deepslate" : dark());
      }
      for (let lv = 0; lv < 3; lv++) for (let x = tx + lv; x <= tx + 4 - lv; x++) for (let z = Z2 - 2 + lv; z <= Z2 + 2 - lv; z++) put(x, 25 + lv * 2, z, "waxed_oxidized_cut_copper"), put(x, 26 + lv * 2, z, "waxed_oxidized_cut_copper");
      put(tx + 2, 31, Z2, "waxed_oxidized_copper"); put(tx + 2, 32, Z2, "end_rod", { facing_direction: 1 }, true);
    }
    // roof lantern (copper pyramid)
    for (let lv = 0; lv < 4; lv++) for (let x = XC - 3 + lv; x <= XC + 3 - lv; x++) for (let z = -53 + lv; z <= -47 - lv; z++) put(x, 19 + lv, z, "waxed_oxidized_cut_copper");
    // inside: pillars, chandeliers, crate altars, coloured light windows behind them
    for (const x of [38, 56]) for (let z = -52; z <= -40; z += 6) { for (let y = 1; y <= 17; y++) put(x, y, z, y === 1 || y === 16 ? "chiseled_deepslate" : "polished_deepslate"); const ix = x + (x === 38 ? 1 : -1); put(ix, 11, z, "chiseled_deepslate"); put(ix, 12, z, COPPER_LANTERN, { hanging: false }, true); }
    for (const z of [-44, -50, -56]) { for (let y = 13; y <= 16; y++) put(XC, y, z, CHAIN, { pillar_axis: "y" }, true); put(XC, 12, z, COPPER_LANTERN, { hanging: true }, true); }
    const ALT = { rare: ["prismarine_bricks", "light_blue_stained_glass", "sea_lantern"], legendary: ["red_nether_brick", "red_stained_glass", "shroomlight"], epic: ["amethyst_block", "purple_stained_glass", "verdant_froglight"] };
    for (const c of GRAND.crates) {
      const [mat, glass, light] = ALT[c.type];
      for (let x = c.x - 2; x <= c.x + 2; x++) for (let z = c.z - 2; z <= c.z + 2; z++) put(x, 1, z, Math.abs(x - c.x) === 2 || Math.abs(z - c.z) === 2 ? "polished_deepslate" : mat);
      for (let x = c.x - 1; x <= c.x + 1; x++) for (let z = c.z - 1; z <= c.z + 1; z++) put(x, 2, z, x === c.x && z === c.z ? "gold_block" : mat);
      for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { put(c.x + ox, 2, c.z + oz, "chiseled_deepslate"); put(c.x + ox, 3, c.z + oz, light); }
      for (let x = c.x - 1; x <= c.x + 1; x++) for (let y = 4; y <= 14; y++) put(x, y, Z1, y === 14 || y === 4 ? "chiseled_deepslate" : glass);
      C.del(c.x, c.y, c.z);                                       // the crate goes here (crates.js)
    }
    // the way from the east avenue to the door + square in front
    for (let x = XC - 3; x <= XC + 3; x++) for (let z = Z2 + 1; z <= -6; z++) { reserve(x, z); put(x, 0, z, Math.abs(x - XC) === 3 ? "polished_andesite" : stone()); }
    for (let x = X1 + 2; x <= X2 - 2; x++) for (let z = Z2 + 1; z <= Z2 + 5; z++) put(x, 0, z, (x + z) % 2 ? "polished_deepslate" : "polished_andesite");
    for (let z = Z2 + 8; z <= -8; z += 7) for (const x of [XC - 4, XC + 4]) { reserve(x, z); put(x, 1, z, "chiseled_stone_bricks"); put(x, 2, z, "stone_bricks"); put(x, 3, z, COPPER_LANTERN, { hanging: false }, true); }
  }

  yield;
  // ------------------------------------------------------------ 6. NW: the HALL OF LEGENDS (TOP boards)
  {
    const HX = GRAND.hall.x, HZ = GRAND.hall.z;
    for (let x = HX - 21; x <= HX + 21; x++) for (let z = HZ - 21; z <= HZ + 21; z++) {
      const r = Math.hypot(x - HX, z - HZ); if (r > 20.5) continue;
      reserve(x, z);
      if (r < 19) {
        const ring = Math.floor(r) % 4;
        put(x, 0, z, r < 5 ? "polished_andesite" : ring === 0 ? "deepslate_tiles" : (Math.abs(x - HX) + Math.abs(z - HZ)) % 2 ? "calcite" : "polished_diorite");
        if (Math.abs(r - 8) < 0.5 && ((Math.atan2(z - HZ, x - HX) * 180) / Math.PI + 360) % 30 < 5) put(x, 0, z, "verdant_froglight");
      }
    }
    // colonnade ring (open to the south), lintels, leaves, glow berries
    for (let deg = 0; deg < 360; deg += 2) {
      const a = (deg * Math.PI) / 180, x = HX + rnd(Math.cos(a) * 18), z = HZ + rnd(Math.sin(a) * 18);
      if (deg > 72 && deg < 108) continue;
      if (deg % 16 === 0) for (let y = 1; y <= 8; y++) put(x, y, z, y === 1 || y === 8 ? "chiseled_stone_bricks" : y <= 2 ? "polished_andesite" : "quartz_pillar", y > 2 && y < 8 ? { pillar_axis: "y" } : undefined);
      put(x, 9, z, stone());
      if (rng() < 0.55) put(x, 10, z, leaf(), LEAF);
      if (deg % 16 === 8 && rng() < 0.6) hangBerries(x, 8, z, 1 + Math.floor(rng() * 3));
    }
    // 10 obelisks (the boards stand in front of them)
    for (let k = 0; k < 10; k++) {
      const a = ((108 + 36 * k) * Math.PI) / 180, ox = HX + rnd(Math.cos(a) * 14), oz = HZ + rnd(Math.sin(a) * 14);
      for (let x = ox - 1; x <= ox + 1; x++) for (let z = oz - 1; z <= oz + 1; z++) { put(x, 1, z, "polished_deepslate"); put(x, 2, z, "chiseled_stone_bricks"); }
      for (let y = 3; y <= 10; y++) put(ox, y, oz, "quartz_pillar", { pillar_axis: "y" });
      put(ox, 11, oz, "chiseled_quartz_block"); put(ox, 12, oz, "verdant_froglight"); put(ox, 13, oz, "end_rod", { facing_direction: 1 }, true);
    }
    // the crowned statue in the middle
    for (let x = HX - 2; x <= HX + 2; x++) for (let z = HZ - 2; z <= HZ + 2; z++) { put(x, 1, z, "polished_deepslate"); put(x, 2, z, "chiseled_stone_bricks"); }
    for (let y = 3; y <= 6; y++) for (const dx of [-1, 1]) put(HX + dx, y, HZ, "polished_andesite");
    for (let y = 7; y <= 10; y++) for (let dx = -1; dx <= 1; dx++) for (const dz of [0, 1]) put(HX + dx, y, HZ + dz, "polished_andesite");
    for (const dx of [-2, 2]) for (let y = 7; y <= 9; y++) put(HX + dx, y, HZ, "polished_andesite");
    put(HX + 2, 10, HZ, "polished_diorite"); put(HX + 2, 11, HZ, "polished_diorite"); put(HX + 2, 12, HZ, "polished_diorite");   // raised sword
    for (let y = 11; y <= 12; y++) for (const dz of [0, 1]) put(HX, y, HZ + dz, "polished_diorite");
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 2], [-1, 1], [1, 1]]) put(HX + dx, 13, HZ + dz, "gold_block");
    // entrance path from the west avenue
    for (let x = HX - 3; x <= HX + 3; x++) for (let z = HZ + 19; z <= -6; z++) { reserve(x, z); put(x, 0, z, Math.abs(x - HX) === 3 ? "polished_andesite" : stone()); }
    for (let z = HZ + 22; z <= -8; z += 6) for (const x of [HX - 4, HX + 4]) { reserve(x, z); put(x, 1, z, "chiseled_stone_bricks"); put(x, 2, z, "stone_bricks"); put(x, 3, z, COPPER_LANTERN, { hanging: false }, true); }
  }

  yield;
  // ------------------------------------------------------------ 7. SE: terraced cliff + waterfall + pool
  {
    const CX = 69, CZ = 69, PC = [50, 50], PR = 8;
    const hRaw = (x, z) => { const d = Math.hypot(x - CX, z - CZ); return 31 - d * 0.82 + 1.6 * Math.sin(x * 0.37) + 1.3 * Math.cos(z * 0.41); };
    const H = new Map();
    for (let x = 24; x <= 71; x++) for (let z = 24; z <= 71; z++) {
      if (Math.max(x, z) >= 72 || (x >= TOWER && z >= TOWER)) continue;
      let h = Math.floor(hRaw(x, z) / 3) * 3;
      const dp = Math.hypot(x - PC[0], z - PC[1]);
      if (dp < PR + 0.5) h = 0;
      if (h > 0) H.set(x + "," + z, h);
    }
    const hAt = (x, z) => H.get(x + "," + z) ?? 0;
    // waterfall notch: 3 sources on the rim of the pool bowl (towards the cliff), the cells around them raised
    const toC = [CX - PC[0], CZ - PC[1]], L0 = Math.hypot(...toC), ux = toC[0] / L0, uz = toC[1] / L0;
    const F = [Math.round(PC[0] + ux * (PR + 1)), Math.round(PC[1] + uz * (PR + 1))];
    const hF = Math.max(9, hAt(F[0], F[1]) || 12);
    const SRC = [[F[0], F[1]], [F[0] + 1, F[1] - 1], [F[0] - 1, F[1] + 1]];
    for (const [sx, sz] of SRC) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = sx + dx, z = sz + dz;
      if (Math.hypot(x - PC[0], z - PC[1]) < PR + 0.5) continue;
      H.set(x + "," + z, Math.max(hAt(x, z), hF + 1));
    }
    for (const [sx, sz] of SRC) H.set(sx + "," + sz, hF);
    for (const [k, h] of H) {
      const [x, z] = k.split(",").map(Number); reserve(x, z);
      const lowN = Math.min(hAt(x + 1, z), hAt(x - 1, z), hAt(x, z + 1), hAt(x, z - 1));
      for (let y = Math.max(1, lowN - 1); y <= h; y++) put(x, y, z, y === h ? (lowN >= h ? "grass_block" : "moss_block") : rock());
      if (lowN >= h) {                                                   // flat top: bushes / flowers / small trees later
        const q = rng();
        if (q < 0.2) put(x, h + 1, z, "short_grass", undefined, true);
        else if (q < 0.3) put(x, h + 1, z, FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true);
        else if (q < 0.36) put(x, h + 1, z, leaf(), LEAF);
      }
    }
    for (const [sx, sz] of SRC) put(sx, hF, sz, "water", { liquid_depth: 0 }, true);
    // the pool
    for (let x = PC[0] - PR - 2; x <= PC[0] + PR + 2; x++) for (let z = PC[1] - PR - 2; z <= PC[1] + PR + 2; z++) {
      const d = Math.hypot(x - PC[0], z - PC[1]); if (d > PR + 1.5) continue;
      reserve(x, z);
      if (d < PR + 0.5) { put(x, -3, z, (x + z) % 4 === 0 ? "sea_lantern" : "mossy_cobblestone"); put(x, -2, z, "water", { liquid_depth: 0 }, true); put(x, -1, z, "water", { liquid_depth: 0 }, true); put(x, 0, z, "water", { liquid_depth: 0 }, true); }
      else if (!H.has(x + "," + z)) { put(x, 0, z, "mossy_stone_bricks"); put(x, -1, z, "mossy_stone_bricks"); put(x, -2, z, "mossy_stone_bricks"); if (rng() < 0.3) put(x, 1, z, rng() < 0.5 ? "moss_carpet" : "fern", undefined, true); }
    }
    // stone path from the south avenue to the pool, with lamps
    for (let x = 6; x <= PC[0] - PR; x++) for (let z = PC[1] - 1; z <= PC[1] + 1; z++) { if (H.has(x + "," + z)) continue; reserve(x, z); put(x, 0, z, z === PC[1] ? stone() : "polished_andesite"); }
    for (let x = 12; x <= PC[0] - PR - 2; x += 8) { reserve(x, PC[1] + 2); put(x, 1, PC[1] + 2, "chiseled_stone_bricks"); put(x, 2, PC[1] + 2, COPPER_LANTERN, { hanging: false }, true); }
  }

  yield;
  // ------------------------------------------------------------ 8. SW: the RUINS garden + pergola walk
  {
    const RX = -46, RZ = 46;
    for (let x = RX - 17; x <= RX + 17; x++) for (let z = RZ - 17; z <= RZ + 17; z++) {
      const r = Math.hypot(x - RX, z - RZ); if (r > 16.5) continue;
      reserve(x, z);
      const q = rng();
      if (r < 5) { put(x, -1, z, (x + z) % 3 === 0 ? "sea_lantern" : "prismarine_bricks"); put(x, 0, z, "water", { liquid_depth: 0 }, true); }
      else if (r < 6) { put(x, 0, z, "mossy_stone_bricks"); put(x, 1, z, "mossy_stone_brick_slab", { "minecraft:vertical_half": "bottom" }); }
      else put(x, 0, z, q < 0.22 ? "grass_block" : q < 0.32 ? "moss_block" : q < 0.62 ? "mossy_stone_bricks" : q < 0.8 ? "cracked_stone_bricks" : "stone_bricks");
      if (r >= 6 && r < 16 && C.id(x, 0, z) === "grass_block" && rng() < 0.4) put(x, 1, z, rng() < 0.6 ? "short_grass" : FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true);
    }
    C.del(RX, 0, RZ);
    for (let y = 0; y <= 5; y++) put(RX, y, RZ, y === 4 ? "sea_lantern" : y === 5 ? "moss_block" : y % 2 ? "mossy_stone_bricks" : "chiseled_stone_bricks");
    put(RX, 6, RZ, "flowering_azalea", undefined, true);
    // broken colonnade (16 pillars, random heights; lintels where two neighbours are whole)
    const hs = [];
    for (let k = 0; k < 16; k++) hs.push(rng() < 0.55 ? 9 : 3 + Math.floor(rng() * 5));
    for (let k = 0; k < 16; k++) {
      const a = (k * 22.5 * Math.PI) / 180, x = RX + rnd(Math.cos(a) * 12), z = RZ + rnd(Math.sin(a) * 12);
      for (let y = 1; y <= hs[k]; y++) put(x, y, z, y === 1 ? "chiseled_stone_bricks" : stone());
      put(x, hs[k] + 1, z, leaf(), LEAF);
      if (hs[k] === 9 && hs[(k + 1) % 16] === 9) {
        const b = ((k + 1) * 22.5 * Math.PI) / 180, x2 = RX + rnd(Math.cos(b) * 12), z2 = RZ + rnd(Math.sin(b) * 12);
        for (let t = 0; t <= 1; t += 0.1) { const lx = Math.round(x + (x2 - x) * t), lz = Math.round(z + (z2 - z) * t); put(lx, 10, lz, stone()); if (rng() < 0.4) put(lx, 11, lz, leaf(), LEAF); }
        hangBerries(Math.round((x + x2) / 2), 9, Math.round((z + z2) / 2), 2);
      }
    }
    // benches looking at the fountain
    for (let k = 0; k < 8; k++) {
      const a = ((k * 45 + 22.5) * Math.PI) / 180, x = RX + rnd(Math.cos(a) * 8), z = RZ + rnd(Math.sin(a) * 8);
      put(x, 1, z, "dark_oak_stairs", { weirdo_direction: dirOf(x - RX, z - RZ), upside_down_bit: false });
    }
    // pergola walk from the south avenue to the ruins
    for (let x = RX + 13; x <= -6; x++) for (let z = RZ - 3; z <= RZ + 3; z++) {
      reserve(x, z);
      put(x, 0, z, Math.abs(z - RZ) === 3 ? "moss_block" : Math.abs(z - RZ) === 2 ? "polished_andesite" : stone());
      if (Math.abs(z - RZ) === 3 && (x % 4 === 0)) for (let y = 1; y <= 4; y++) put(x, y, z, "dark_oak_log", { pillar_axis: "y" });
      if (x % 4 === 0 && Math.abs(z - RZ) <= 3) put(x, 5, z, "dark_oak_log", { pillar_axis: "z" });
      if (rng() < 0.75) put(x, 6, z, leaf(), LEAF);
      if (Math.abs(z - RZ) <= 2 && x % 4 === 2 && rng() < 0.5) hangBerries(x, 5, z, 1 + Math.floor(rng() * 2));
    }
  }

  yield;
  // ------------------------------------------------------------ 9. garden trees (everywhere that is still free)
  const trees = [];
  const freeAround = (x, z, r) => { for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (isRes(x + dx, z + dz) || Math.max(Math.abs(x + dx), Math.abs(z + dz)) >= 70) return false; return true; };
  for (let gx = -66; gx <= 66; gx += 9) for (let gz = -66; gz <= 66; gz += 9) {
    const x = gx + Math.floor(rng() * 5) - 2, z = gz + Math.floor(rng() * 5) - 2;
    if (!freeAround(x, z, 3) || rng() < 0.25) continue;
    if (trees.some(([a, b]) => Math.hypot(a - x, b - z) < 8)) continue;
    trees.push([x, z]);
    const h = 5 + Math.floor(rng() * 4), log = rng() < 0.6 ? "dark_oak_log" : "oak_log";
    for (let y = 1; y <= h; y++) put(x, y, z, log, { pillar_axis: "y" });
    canopy(x, h + 1, z, 3 + rng() * 1.2, 2.6);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) reserve(x + dx, z + dz);
    const ly = lows.get((x + 2) + "," + z); if (ly && ly - 1 >= 3 && !C.has(x + 2, ly - 1, z)) put(x + 2, ly - 1, z, "lantern", { hanging: true }, true);
    for (const [ox, oz] of [[-2, 1], [1, -2], [2, 2]]) { const y = lows.get((x + ox) + "," + (z + oz)); if (y && rng() < 0.6) hangBerries(x + ox, y - 1, z + oz, 1 + Math.floor(rng() * 2)); }
  }

  yield;
  // ------------------------------------------------------------ 10. garden ground + invisible lights (no mobs anywhere)
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) >= 72) continue;
    const g = C.id(x, 0, z);
    const lightSpot = ((x % 6) + 6) % 6 === 3 && ((z % 6) + 6) % 6 === 3;
    if (lightSpot && !C.has(x, 1, z) && (g === "grass_block" || g === "moss_block" || g === "stone_bricks" || g === "mossy_stone_bricks" || g === "cracked_stone_bricks" || g === "polished_andesite" || g === "mossy_cobblestone" || g === "calcite" || g === "polished_diorite" || g === "deepslate_tiles")) { put(x, 1, z, "light_block_14", undefined, true); continue; }
    if (lightSpot && g === "dirt" && Math.hypot(x, z) > 3.5 && !C.has(x, 2, z)) { put(x, 2, z, "light_block_14", undefined, true); continue; }
    if (g === "dirt" && C.id(x, 1, z) === "grass_block" && !C.has(x, 2, z) && Math.hypot(x, z) > 3.5) { const q = rng(); if (q < 0.3) put(x, 2, z, "short_grass", undefined, true); else if (q < 0.42) put(x, 2, z, FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true); continue; }
    if (g !== "grass_block" || isRes(x, z) || C.has(x, 1, z)) continue;
    const q = rng();
    if (q < 0.07) put(x, 0, z, "moss_block");
    else if (q < 0.1) put(x, 0, z, "podzol");
    else if (q < 0.12) put(x, 0, z, "coarse_dirt");
    const q2 = rng();
    if (q2 < 0.26) put(x, 1, z, "short_grass", undefined, true);
    else if (q2 < 0.36) put(x, 1, z, FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true);
    else if (q2 < 0.4) put(x, 1, z, "fern", undefined, true);
    else if (q2 < 0.43) put(x, 1, z, leaf(), LEAF);
    else if (q2 < 0.445) put(x, 1, z, rng() < 0.5 ? "azalea" : "flowering_azalea", undefined, true);
    else if (q2 < 0.46) put(x, 1, z, "pink_petals", { growth: 3, "minecraft:cardinal_direction": ["north", "south", "east", "west"][Math.floor(rng() * 4)] }, true);
  }
  // inside the temple and the towers: lights too
  for (let x = 34; x <= 60; x += 6) for (let z = -62; z <= -38; z += 6) if (!C.has(x, 1, z)) put(x, 1, z, "light_block_14", undefined, true);
  return C;
}

/** the whole design at once (tests / preview) */
export function grandSpawn() { const g = grandSpawnGen(); let r; while (!(r = g.next()).done); return r.value; }

// =====================================================================================================================
// THE GARDEN SPAWN (41 x 41)
// =====================================================================================================================
export const SMALL = { R: 20, UP: 24, DOWN: 4, spawn: { x: 0, y: 1, z: 9 }, crates: [], boards: [] };
export function smallSpawn() {
  const R = SMALL.R, C = new Canvas(), rng = rngOf(20251119);
  const put = (x, y, z, id, st, late = false) => C.put(x, y, z, id, st, late);
  const has = (x, y, z) => C.has(x, y, z);
  const pathMinor = (x, z) => (Math.abs(z) <= 2 ? Math.abs(z) : Math.abs(x) <= 2 ? Math.abs(x) : 99);
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const r = Math.hypot(x, z); if (r > R + 0.5) continue;
    const pm = pathMinor(x, z);
    let b;
    if (r < 2.6) b = null;
    else if (r < 3.6) b = "polished_diorite";
    else if (r < 5.5) b = (Math.abs(r - 4.5) < 0.5 && Math.abs((((Math.atan2(z, x) * 180) / Math.PI) + 382.5) % 45 - 22.5) < 7) ? "verdant_froglight" : (Math.abs(x) + Math.abs(z)) % 2 ? "calcite" : "polished_diorite";
    else if (r < 7.5) b = rng() < 0.35 ? "mossy_stone_bricks" : "stone_bricks";
    else if (r < 11.5) { const ang = (((Math.atan2(z, x) * 180) / Math.PI) + 360) % 30; if (Math.abs(r - 9.8) < 0.5) b = ang < 6 ? "verdant_froglight" : "calcite"; else { const q = rng(); b = q < 0.12 ? "cracked_deepslate_tiles" : q < 0.25 ? "polished_deepslate" : "deepslate_tiles"; } }
    else if (pm <= 2) { if (pm === 2) b = "polished_andesite"; else { const q = rng(); b = q < 0.25 ? "mossy_stone_bricks" : q < 0.35 ? "cracked_stone_bricks" : "stone_bricks"; } }
    else if (r < 12.5) b = "mossy_stone_bricks";
    else b = "grass_block";
    if (b) put(x, 0, z, b);
  }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const r = Math.hypot(x, z);
    if (r < 2.6) { put(x, -1, z, Math.abs(x) + Math.abs(z) === 1 ? "sea_lantern" : "prismarine_bricks"); if (x || z) put(x, 0, z, "water", { liquid_depth: 0 }, true); }
    else if (r < 3.6) put(x, 1, z, "smooth_quartz_slab", { "minecraft:vertical_half": "bottom" });
  }
  ["chiseled_stone_bricks", "chiseled_stone_bricks", "mossy_stone_bricks", "chiseled_stone_bricks", "sea_lantern", "moss_block"].forEach((b, i) => put(0, i, 0, b));
  put(0, 6, 0, "flowering_azalea", undefined, true);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, px = rnd(6.5 * Math.cos(a)), pz = rnd(6.5 * Math.sin(a));
    put(px, 1, pz, "chiseled_stone_bricks");
    for (let y = 2; y <= 6; y++) put(px, y, pz, "quartz_pillar", { pillar_axis: "y" });
    put(px, 7, pz, "chiseled_stone_bricks");
    const b = a + Math.PI / 8; put(rnd(6 * Math.cos(b)), 7, rnd(6 * Math.sin(b)), COPPER_LANTERN.replace("soul_lantern", "lantern"), { hanging: true }, true);
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    const r = Math.hypot(x, z);
    if (r >= 5.6 && r < 7.6) put(x, 8, z, "stone_bricks");
    else if (r >= 7.6 && r < 8.5) {
      put(x, 8, z, "mossy_stone_bricks");
      put(x, 9, z, rng() < 0.3 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF);
      if (rng() < 0.4) { if (rng() < 0.45) { put(x, 7, z, "cave_vines_body_with_berries", AGE, true); put(x, 6, z, "cave_vines_head_with_berries", AGE, true); } else put(x, 7, z, "cave_vines_head_with_berries", AGE, true); }
    }
  }
  const RINGS = [7.6, 6.43, 5.26, 4.09, 2.92, 1.75, 0.58, -1];
  for (let k = 0; k < 7; k++) for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    const r = Math.hypot(x, z); if (r >= RINGS[k] || r < RINGS[k + 1]) continue;
    if (k === 6 || Math.abs(x) === Math.abs(z)) put(x, 9 + k, z, k === 6 ? "waxed_oxidized_copper" : "waxed_oxidized_cut_copper");
    else put(x, 9 + k, z, "waxed_oxidized_cut_copper_stairs", { weirdo_direction: dirOf(-x, -z), upside_down_bit: false });
  }
  put(0, 16, 0, "end_rod", { facing_direction: 1 }, true);
  for (let y = 11; y <= 14; y++) put(0, y, 0, CHAIN, { pillar_axis: "y" }, true);
  put(0, 10, 0, "waxed_oxidized_copper_lantern|lantern", { hanging: true }, true);
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) { const r = Math.hypot(x, z); if (r >= 12.6 && r < 13.4 && pathMinor(x, z) > 3) put(x, 1, z, rng() < 0.25 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF); }
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const r = Math.hypot(x, z); if (r >= R - 0.5 && r <= R + 0.5 && pathMinor(x, z) > 2) put(x, 1, z, rng() < 0.2 ? "azalea_leaves_flowered" : "oak_leaves", LEAF); }
  const turn = (k, x, z) => { for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; };
  const turnDir = (k, d) => { const v = [[1, 0], [-1, 0], [0, 1], [0, -1]][d]; const [a, b] = turn(k, v[0], v[1]); return dirOf(a, b); };
  for (let k = 0; k < 4; k++) {
    const P = (x, y, z, id, st, late) => { const [a, b] = turn(k, x, z); put(a, y, b, id, st, late); };
    for (const s of [-1, 1]) {
      for (const lx of [13, 18]) { P(lx, 1, 3 * s, "dark_oak_fence"); P(lx, 2, 3 * s, "dark_oak_fence"); P(lx, 3, 3 * s, "lantern", { hanging: false }, true); }
      for (const bx of [15, 16]) P(bx, 1, 3 * s, "dark_oak_stairs", { weirdo_direction: turnDir(k, s > 0 ? 2 : 3), upside_down_bit: false });
      for (let y = 1; y <= 4; y++) P(19, y, 3 * s, y === 1 || y === 4 ? "chiseled_stone_bricks" : "mossy_stone_bricks");
    }
    for (let z = -3; z <= 3; z++) { P(19, 5, z, z === 0 ? "chiseled_stone_bricks" : "stone_bricks"); P(19, 6, z, rng() < 0.35 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF); }
    P(19, 4, 0, "lantern", { hanging: true }, true);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tx = 11 * sx, tz = 11 * sz;
    for (let y = 1; y <= 7; y++) put(tx, y, tz, "dark_oak_log", { pillar_axis: "y" });
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(tx + ox, 1, tz + oz, "dark_oak_log", { pillar_axis: ox ? "x" : "z" });
    const low = new Map();
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = -4; z <= 4; z++) {
      const d = Math.hypot(x, y * 1.15, z);
      if (d > 3.4 - rng() * 0.7 || (x === 0 && z === 0 && y <= 0)) continue;
      const q = rng();
      put(tx + x, 7 + y, tz + z, q < 0.55 ? "oak_leaves" : q < 0.82 ? "azalea_leaves" : "azalea_leaves_flowered", LEAF);
      const key = x + "," + z; if (!low.has(key) || low.get(key) > 7 + y) low.set(key, 7 + y);
    }
    for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const y = low.get(ox + "," + oz); if (y && y - 1 >= 3) put(tx + ox, y - 1, tz + oz, "lantern", { hanging: true }, true); }
    for (const [key, y] of low) {
      const [x, z] = key.split(",").map(Number);
      if ((Math.abs(x) === 2 && z === 0) || (Math.abs(z) === 2 && x === 0) || (x === 0 && z === 0) || y - 1 < 3 || rng() > 0.22) continue;
      put(tx + x, y - 1, tz + z, "cave_vines_head_with_berries", AGE, true);
    }
  }
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    if (C.id(x, 0, z) !== "grass_block" || has(x, 1, z)) continue;
    if (((x % 5) + 5) % 5 === 0 && ((z % 5) + 5) % 5 === 0) { put(x, 1, z, "light_block_14", undefined, true); continue; }
    const q = rng();
    if (q < 0.28) put(x, 1, z, "short_grass", undefined, true);
    else if (q < 0.46) put(x, 1, z, FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true);
    else if (q < 0.5) put(x, 1, z, "pink_petals", { growth: 3, "minecraft:cardinal_direction": ["north", "south", "east", "west"][Math.floor(rng() * 4)] }, true);
    else if (q < 0.525) put(x, 1, z, rng() < 0.5 ? "azalea" : "flowering_azalea", undefined, true);
  }
  return C;
}
