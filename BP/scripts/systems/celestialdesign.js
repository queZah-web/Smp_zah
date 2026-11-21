// =====================================================================================================================
// THE CELESTIAL SANCTUARY - the third spawn (pure data, no game calls: can be tested / previewed outside the game)
//
//   201 x 201 (radius 100), up to ~64 high.  A white & dark-slate sanctuary in a big round garden:
//     * THE RING: 7 tiers of white seats all around (like an amphitheatre), on them a gothic COLONNADE of 64 tall pillars
//       with pointed arches, a dark cornice with hanging lanterns and a spire on every pillar; 3 grand gates (E, S, W)
//     * THE CATHEDRAL (north): a white hall with mosaic windows, twin towers with spires, inside: pews, a red carpet,
//       columns, an altar with candles, chandeliers, an organ wall of bookshelves, side chapels
//     * THE PLAZA (middle): a patterned round square with a three-tier fountain; 4 avenues with lamp posts
//     * NE  the CRATE PAVILION: a domed gazebo with 3 crate altars (the crates are placed and work)
//     * NW  the HALL OF LEGENDS: a round colonnade with 10 obelisks for the TOP boards
//     * SE  the LIBRARY & CAFE: a two-room house, fully furnished (bookshelves, reading tables, lecterns, armchairs,
//           a café counter, tables and chairs, barrels, a kitchen, flower pots, chandeliers)
//     * SW  the WISTERIA GARDEN (picture 2): a giant dark tree with pink hanging leaves, lanterns on chains, a swing,
//           a pond with stepping stones, flowers, amethyst, potted plants, a little tree house with furniture
//     * S   the MOONLIT GARDEN (picture 3): water channels, white stone paths, white arches with hanging pale moss,
//           mushroom lamps, glowing lanterns, blue flowers
//     * E / W  white PERGOLA gardens with leafy roofs, benches, flower beds (picture 1)
//     * big leafy trees, bushes and flowers everywhere; invisible light blocks (no mobs)
// The big flat parts are boxes (fills: built with one call each).  Everything else is listed block by block.
// =====================================================================================================================

/** compact block store for a 221 x 221 area. x / z: -110..110, y: -12..79 */
export class BigCanvas {
  constructor() { this.m = new Map(); this.pal = []; this.pi = new Map(); this.fills = []; }
  static k(x, y, z) { return ((x + 110) * 92 + (y + 12)) * 221 + (z + 110); }
  p(id, st, late) { const key = id + "#" + (st ? JSON.stringify(st) : "") + "#" + (late ? 1 : 0); let i = this.pi.get(key); if (i === undefined) { i = this.pal.length; this.pal.push({ id, st, late: !!late }); this.pi.set(key, i); } return i; }
  put(x, y, z, id, st, late = false) { if (id == null) { this.del(x, y, z); return; } if (y < -12 || y > 79 || x < -110 || x > 110 || z < -110 || z > 110) return; this.m.set(BigCanvas.k(x, y, z), this.p(id, st, late)); }
  del(x, y, z) { this.m.delete(BigCanvas.k(x, y, z)); }
  has(x, y, z) { return this.m.has(BigCanvas.k(x, y, z)); }
  id(x, y, z) { const i = this.m.get(BigCanvas.k(x, y, z)); return i === undefined ? null : this.pal[i].id; }
  get size() { return this.m.size; }
  fill(x1, y1, z1, x2, y2, z2, id) { this.fills.push({ from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) }, to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) }, id }); }
  *orderedGen() {
    const pal = this.pal, buckets = new Map(); let n = 0;
    for (const [k, i] of this.m) {
      const z = (k % 221) - 110, r = Math.floor(k / 221), y = (r % 92) - 12, x = Math.floor(r / 92) - 110;
      const p = pal[i], rank = p.id === "water" ? 2 : p.late ? 1 : 0;
      const key = rank * 1000 + (rank === 1 ? 91 - (y + 12) : y + 12);
      let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
      b.push(x, y, z, i);
      if (++n % 4000 === 0) yield;
    }
    return [...buckets.keys()].sort((a, b) => a - b).map((k) => buckets.get(k));
  }
  ordered() { const g = this.orderedGen(); let r; while (!(r = g.next()).done); const out = []; for (const b of r.value) for (let i = 0; i < b.length; i += 4) out.push([b[i], b[i + 1], b[i + 2], b[i + 3]]); return out; }
}

export const CELESTIAL = {
  R: 100, UP: 66, DOWN: 6, spawn: { x: 0, y: 1, z: 15 },
  crates: [{ type: "rare", x: 41, y: 2, z: -44 }, { type: "legendary", x: 45, y: 2, z: -46 }, { type: "epic", x: 49, y: 2, z: -44 }],
  hall: { x: -45, z: -42 },
  boards: ["money", "kills", "duel", "play", "clan", "sell", "buy", "shards", "skills", "ach"],
  places: { crates: { x: 45, y: 1, z: -33 }, top: { x: -45, y: 1, z: -28 } },
};
/** where the 10 TOP boards stand (relative): [{ key, x, y, z }] */
export function celestialBoards() {
  const out = [], c = CELESTIAL.hall;
  CELESTIAL.boards.forEach((key, k) => { const a = ((108 + 36 * k) * Math.PI) / 180; out.push({ key, x: c.x + Math.cos(a) * 9 + 0.5, y: 2.5, z: c.z + Math.sin(a) * 9 + 0.5 }); });
  return out;
}

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// stairs: the high side looks towards this direction (0 = +x, 1 = -x, 2 = +z, 3 = -z)
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const CARD = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? "east" : "west") : (vz > 0 ? "south" : "north"));
const LEAF = { persistent_bit: true };
const CHAIN = "iron_chain|chain";
const GLASS = ["cyan_stained_glass", "light_blue_stained_glass", "lime_stained_glass", "cyan_stained_glass", "blue_stained_glass", "white_stained_glass"];

export function* celestialGen() {
  const D = CELESTIAL, C = new BigCanvas(), rng = rngOf(2025);
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const free = (x, y, z) => !C.has(x, y, z);
  const stair = (x, y, z, id, hx, hz, up = false) => put(x, y, z, id, { weirdo_direction: dirOf(hx, hz), upside_down_bit: up });
  const chair = (x, y, z, fx, fz, wood = "dark_oak") => stair(x, y, z, wood + "_stairs", -fx, -fz);          // you sit looking towards fx, fz
  const table = (x, y, z, wood = "spruce") => { put(x, y, z, wood + "_fence"); put(x, y + 1, z, wood + "_pressure_plate", undefined, true); };
  const hang = (x, top, z, len, lamp = "lantern") => { for (let i = 0; i < len; i++) put(x, top - i, z, CHAIN, { pillar_axis: "y" }, true); put(x, top - len, z, lamp, { hanging: true }, true); };
  const chandelier = (x, top, z, len) => { hang(x, top, z, len); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { put(x + dx, top - len, z + dz, "lantern", { hanging: false }, true); } put(x, top - len - 1, z, "lantern", { hanging: true }, true); };
  const candle = (x, y, z, n = 3, c = "white_candle") => put(x, y, z, c, { candles: n - 1, lit: true }, true);
  const pot = (x, y, z) => put(x, y, z, "flower_pot", undefined, true);
  const bed = (x, y, z, dir) => { const v = [[0, 1], [-1, 0], [0, -1], [1, 0]][dir]; put(x, y, z, "bed", { direction: dir, head_piece_bit: false, occupied_bit: false }); put(x + v[0], y, z + v[1], "bed", { direction: dir, head_piece_bit: true, occupied_bit: false }); };
  const light = (x, y, z) => { if (free(x, y, z)) put(x, y, z, "light_block_14", undefined, true); };
  const tree = (x, z, h, r, leaves = "oak_leaves", log = "oak_log", y0 = 1) => {
    for (let y = 0; y < h; y++) put(x, y0 + y, z, log, { pillar_axis: "y" });
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -2; dy <= r - 1; dy++) {
      const d = Math.hypot(dx, dz * 1.0, dy * 1.3); if (d > r + 0.3 || rng() < 0.12) continue;
      const y = y0 + h - 1 + dy; if (!C.has(x + dx, y, z + dz)) put(x + dx, y, z + dz, leaves, LEAF);
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y0 + h - 3, z + dz, log, { pillar_axis: dx ? "x" : "z" });
  };
  const flowers = ["cornflower", "allium", "oxeye_daisy", "lily_of_the_valley", "azure_bluet", "pink_tulip", "white_tulip", "blue_orchid", "poppy", "dandelion"];

  // ================================================================ 1. the ground (fills) + the paths, the plaza
  C.fill(-100, 0, -100, 0, 0, 100, "grass_block"); C.fill(1, 0, -100, 100, 0, 100, "grass_block");
  for (let x = -100; x <= 100; x++) for (let z = -100; z <= 100; z++) {
    const r = Math.hypot(x, z); if (r > 100.5) continue;
    const ax = Math.abs(x), az = Math.abs(z);
    let b = null;
    if (r <= 21) b = Math.round(r) % 5 === 0 ? "polished_deepslate" : Math.round(r) % 5 === 3 ? "calcite" : ((Math.round(Math.atan2(z, x) * 8) + Math.round(r)) % 2 ? "smooth_quartz" : "polished_diorite");
    else if ((ax <= 3 && r < 80) || (az <= 3 && r < 80 && x !== 0)) b = (ax <= 3 && az > 21) ? (ax === 3 ? "polished_deepslate" : (z + 100) % 4 === 0 ? "calcite" : "smooth_quartz") : (az === 3 ? "polished_deepslate" : (x + 100) % 4 === 0 ? "calcite" : "smooth_quartz");
    else if (r > 91 && r < 94) b = (Math.round(Math.atan2(z, x) * 30) % 2) ? "calcite" : "polished_diorite";      // the path around, outside the ring
    if (b) put(x, 0, z, b);
  }
  yield;

  // ================================================================ 2. THE RING: tiers of seats + the colonnade (+ gates E, S, W)
  const gate = (x, z) => (Math.abs(z) <= 5 && Math.abs(x) > 60) || (Math.abs(x) <= 5 && z > 60);
  for (let x = -91; x <= 91; x++) for (let z = -91; z <= 91; z++) {
    const r = Math.hypot(x, z); if (r < 79.5 || r >= 90.5) continue;
    if (z < -62 && Math.abs(x) <= 26) continue;                                                     // the cathedral side: open
    const k = Math.floor(r - 79.5);                                                               // 0 .. 10
    if (gate(x, z)) { if (k >= 8) continue; put(x, 0, z, "smooth_quartz"); continue; }
    if (k <= 6) {                                                                                 // 7 tiers of seats
      for (let y = 1; y <= k; y++) put(x, y, z, "smooth_quartz");
      put(x, k + 1, z, (Math.round(Math.atan2(z, x) * 57.3) % 15 === 0) ? "polished_diorite_stairs" : "quartz_stairs", { weirdo_direction: dirOf(x, z), upside_down_bit: false });
    } else for (let y = 1; y <= 8; y++) put(x, y, z, y === 8 ? "polished_diorite" : "smooth_quartz");   // the top walk (y 8)
  }
  // grand stairs out through the gates
  for (const [gx, gz] of [[1, 0], [-1, 0], [0, 1]]) for (let s = -5; s <= 5; s++) for (let k = 0; k < 4; k++) {
    const rr = 80 + k, x = gx ? gx * rr : s, z = gz ? gz * rr : s;
    put(x, 0, z, k % 2 ? "calcite" : "smooth_quartz");
  }
  // the colonnade: 64 pillars on the top walk (r 88.5), pointed arches between them, a dark cornice, spires
  const NP = 64;
  for (let x = -91; x <= 91; x++) for (let z = -91; z <= 91; z++) {
    const r = Math.hypot(x, z); if (r < 87.6 || r > 89.4) continue;
    if (z < -62 && Math.abs(x) <= 26) continue;
    const ang = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2), u = (ang / (Math.PI * 2)) * NP, f = u - Math.floor(u), isGate = gate(x, z);
    const pillar = f < 0.14 || f > 0.86;
    const archTop = 20 + Math.round(7 * Math.sqrt(Math.max(0, 1 - Math.abs(2 * f - 1))));      // pointed arch
    for (let y = 9; y <= 30; y++) {
      let b = null;
      if (pillar) b = y === 9 || y === 21 ? "chiseled_quartz_block" : "quartz_pillar";
      else if (y >= archTop) b = y >= 28 ? "deepslate_tiles" : y === archTop ? "quartz_stairs" : "smooth_quartz";
      if (isGate && y < 26 && !pillar) b = null;
      if (y >= 28) b = y === 30 ? "polished_deepslate" : "deepslate_tiles";
      if (b === "quartz_stairs") put(x, y, z, b, { weirdo_direction: dirOf(x, z), upside_down_bit: true }); else if (b) put(x, y, z, b, b === "quartz_pillar" ? { pillar_axis: "y" } : undefined);
    }
    if (pillar && f < 0.07) { for (let y = 31; y <= 36; y++) put(x, y, z, y === 36 ? "end_rod" : y >= 34 ? "polished_deepslate_wall" : "quartz_pillar", y === 36 ? { facing_direction: 1 } : y < 34 ? { pillar_axis: "y" } : undefined, y === 36); }
    if (!pillar && Math.abs(f - 0.5) < 0.08 && r < 88.4) hang(x, archTop - 1, z, 2);
  }
  // the gate arches (higher, with a crown)
  for (const [gx, gz] of [[1, 0], [-1, 0], [0, 1]]) for (let s = -6; s <= 6; s++) for (let y = 26; y <= 34; y++) {
    if (Math.abs(s) <= 4 && y < 31) continue;
    for (const rr of [88, 89]) { const x = gx ? gx * rr : s, z = gz ? gz * rr : s; put(x, y, z, y === 34 ? "gold_block" : y === 33 ? "polished_deepslate" : "smooth_quartz"); }
  }
  yield;

  // ================================================================ 3. THE CATHEDRAL (north): hall z -70..-30, x -20..20, twin towers at the front
  const CX1 = -20, CX2 = 20, CZ1 = -72, CZ2 = -30, WALL_TOP = 22;
  C.fill(CX1, 0, CZ1, CX2, 0, CZ2, "polished_deepslate");
  for (let x = CX1 + 1; x < CX2; x++) for (let z = CZ1 + 1; z < CZ2; z++) put(x, 0, z, (x + z) % 2 ? "smooth_quartz" : "polished_diorite");
  for (let x = CX1; x <= CX2; x++) for (let z = CZ1; z <= CZ2; z++) {
    const edge = x === CX1 || x === CX2 || z === CZ1 || z === CZ2; if (!edge) continue;
    const side = x === CX1 || x === CX2, along = side ? z : x;
    for (let y = 1; y <= WALL_TOP; y++) {
      let b = (along + 100) % 6 === 0 || (side && (z === CZ1 || z === CZ2)) ? "quartz_pillar" : y % 7 === 0 ? "chiseled_quartz_block" : "smooth_quartz";
      const win = (along + 100) % 6 >= 2 && (along + 100) % 6 <= 4 && y >= 4 && y <= 17;
      if (win && !(z === CZ2 && Math.abs(x) <= 4)) b = GLASS[(y + along * 3 + 100) % GLASS.length];
      if (y === WALL_TOP) b = "polished_deepslate";
      if (z === CZ2 && Math.abs(x) <= 3 && y <= 10) b = null;                                                // the great door
      if (z === CZ2 && Math.abs(x) <= 3 && y > 10 && y <= 12) b = y === 11 ? "chiseled_quartz_block" : "polished_deepslate";
      if (b) put(x, y, z, b, b === "quartz_pillar" ? { pillar_axis: "y" } : undefined);
    }
  }
  // the rose window above the door
  for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) { const d = Math.hypot(dx, dy); if (d > 5.3) continue; put(dx, 17 + dy, CZ2, d > 4.4 ? "polished_deepslate" : d < 1.2 ? "sea_lantern" : GLASS[(Math.round(Math.atan2(dy, dx) * 4) + 8) % GLASS.length]); }
  // the roof: a steep dark roof along z (stairs), with a ridge
  for (let k = 0; k <= 21; k++) for (let z = CZ1 - 1; z <= CZ2 + 1; z++) {
    const y = WALL_TOP + 1 + k; if (k > 20) break;
    for (const s of [-1, 1]) { const x = s * (21 - k); if (Math.abs(x) < 1) continue; stair(x, y, z, "deepslate_tile_stairs", -s, 0); if (k > 0) put(x + s, y, z, "deepslate_tiles"); }
  }
  for (let z = CZ1 - 1; z <= CZ2 + 1; z++) { put(0, WALL_TOP + 21, z, "polished_deepslate"); put(0, WALL_TOP + 22, z, z % 4 === 0 ? "end_rod" : "polished_deepslate_wall", z % 4 === 0 ? { facing_direction: 1 } : undefined, z % 4 === 0); put(1, WALL_TOP + 21, z, "deepslate_tiles"); put(-1, WALL_TOP + 21, z, "deepslate_tiles"); }
  for (let x = -20; x <= 20; x++) for (const z of [CZ1, CZ2]) for (let y = WALL_TOP + 1; y <= WALL_TOP + 21 - Math.abs(x); y++) if (!(z === CZ2 && Math.abs(x) <= 5 && y <= 22)) put(x, y, z, Math.abs(x) % 4 === 0 ? "quartz_pillar" : (y + x) % 5 === 0 ? GLASS[Math.abs(x) % GLASS.length] : "smooth_quartz", Math.abs(x) % 4 === 0 ? { pillar_axis: "y" } : undefined);
  yield;
  // the twin towers (9 x 9) at the front corners, 46 high + spires
  for (const sx of [-1, 1]) {
    const tx = sx * 21, tz = -31;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const edge = Math.abs(dx) === 4 || Math.abs(dz) === 4, corner = Math.abs(dx) === 4 && Math.abs(dz) === 4;
      if (!edge) continue;
      for (let y = 1; y <= 46; y++) {
        let b = corner ? "polished_deepslate" : y % 8 === 0 ? "deepslate_tiles" : "smooth_quartz";
        if (!corner && Math.abs(dx) <= 1 && Math.abs(dz) === 4 && y % 8 >= 2 && y % 8 <= 6) b = GLASS[(y + dx + 9) % GLASS.length];
        if (!corner && Math.abs(dz) <= 1 && Math.abs(dx) === 4 && y % 8 >= 2 && y % 8 <= 6) b = GLASS[(y + dz + 4) % GLASS.length];
        if (dz === 4 && sx * dx < 0 && Math.abs(dx) <= 1 && y <= 4 && false) b = null;
        put(tx + dx, y, tz + dz, b);
      }
    }
    for (let y = 8; y <= 46; y += 8) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) put(tx + dx, y, tz + dz, "smooth_quartz");   // floors inside
    for (let k = 0; k <= 5; k++) for (let dx = -5 + k; dx <= 5 - k; dx++) for (let dz = -5 + k; dz <= 5 - k; dz++) {     // the spire
      const edge = Math.abs(dx) === 5 - k || Math.abs(dz) === 5 - k; if (!edge && k < 5) continue;
      put(tx + dx, 47 + k * 2, tz + dz, k % 2 ? "deepslate_tiles" : "polished_deepslate"); put(tx + dx, 48 + k * 2, tz + dz, "polished_deepslate");
    }
    for (let y = 59; y <= 63; y++) put(tx, y, tz, y === 63 ? "lightning_rod" : y === 62 ? "gold_block" : "polished_deepslate_wall", y === 63 ? { facing_direction: 1 } : undefined, y === 63);
    for (const [cx, cz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) for (let y = 47; y <= 52; y++) put(tx + cx, y, tz + cz, y === 52 ? "end_rod" : "polished_deepslate_wall", y === 52 ? { facing_direction: 1 } : undefined, y === 52);
  }
  // the cathedral inside: columns, pews, a red carpet, the altar, the organ wall, chandeliers, side chapels
  for (let z = CZ2 - 4; z >= CZ1 + 4; z -= 6) for (const sx of [-1, 1]) {
    for (let y = 1; y <= 20; y++) put(sx * 11, y, z, y === 1 || y === 20 ? "chiseled_quartz_block" : "quartz_pillar", y === 1 || y === 20 ? undefined : { pillar_axis: "y" });
    put(sx * 11 - sx, 8, z, "lantern", { hanging: false }, true);
  }
  for (let z = CZ2 - 1; z >= CZ1 + 9; z--) for (let x = -2; x <= 2; x++) put(x, 1, z, Math.abs(x) === 2 ? "yellow_carpet" : "red_carpet", undefined, true);
  for (let z = CZ2 - 6; z >= CZ1 + 12; z -= 3) for (const sx of [-1, 1]) for (let a = 4; a <= 9; a++) { chair(sx * a, 1, z, 0, -1, "dark_oak"); if (a === 4 || a === 9) put(sx * a, 2, z, "dark_oak_fence"); }
  for (let x = -8; x <= 8; x++) for (let z = CZ1 + 1; z <= CZ1 + 8; z++) put(x, 1, z, z === CZ1 + 8 ? "quartz_stairs" : "smooth_quartz", z === CZ1 + 8 ? { weirdo_direction: 3, upside_down_bit: false } : undefined);
  for (let x = -2; x <= 2; x++) { put(x, 2, CZ1 + 4, "gold_block"); put(x, 3, CZ1 + 4, "white_carpet", undefined, true); }
  candle(-2, 4, CZ1 + 4, 3, "white_candle"); candle(2, 4, CZ1 + 4, 3, "white_candle"); candle(0, 4, CZ1 + 4, 4, "yellow_candle");
  for (let x = -6; x <= 6; x++) for (let y = 2; y <= 9; y++) put(x, y, CZ1 + 1, y === 9 || Math.abs(x) === 6 ? "dark_oak_planks" : (x + y) % 3 === 0 ? "chiseled_bookshelf" : "bookshelf", (x + y) % 3 === 0 && y < 9 && Math.abs(x) < 6 ? { books_stored: 63, direction: 0 } : undefined);
  for (let x = -6; x <= 6; x += 2) for (let y = 10; y <= 14; y++) put(x, y, CZ1 + 1, "iron_bars");                            // organ pipes
  for (const sx of [-1, 1]) { put(sx * 7, 2, CZ1 + 6, "lectern", { "minecraft:cardinal_direction": "south", powered_bit: false }); put(sx * 4, 2, CZ1 + 3, "flower_pot", undefined, true); put(sx * 8, 2, CZ1 + 3, "amethyst_block"); put(sx * 8, 3, CZ1 + 3, "amethyst_cluster", { "minecraft:block_face": "up" }, true); }
  for (let z = CZ2 - 5; z >= CZ1 + 6; z -= 8) chandelier(0, 21, z, 4);
  for (let z = CZ2 - 8; z >= CZ1 + 12; z -= 8) for (const sx of [-1, 1]) chandelier(sx * 16, 21, z, 6);
  for (const sx of [-1, 1]) for (let z = CZ2 - 4; z >= CZ1 + 8; z -= 9) {              // side chapels: a bench, candles, flowers, a little shelf
    put(sx * 19, 1, z, "bookshelf"); put(sx * 19, 2, z, "white_candle", { candles: 2, lit: true }, true); chair(sx * 18, 1, z - 1, -sx, 0, "spruce"); chair(sx * 18, 1, z + 1, -sx, 0, "spruce");
    put(sx * 19, 1, z - 2, "potted_azalea_bush|flower_pot", undefined, true); put(sx * 19, 1, z + 2, "decorated_pot", { direction: 0 }, true);
  }
  yield;

  // ================================================================ 4. THE PLAZA: a three-tier fountain, benches, lamp posts
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    const r = Math.hypot(x, z); if (r > 7.3) continue;
    if (r > 6.3) { put(x, 1, z, "quartz_bricks"); put(x, 2, z, "smooth_quartz_slab", { "minecraft:vertical_half": "bottom" }); }
    else { put(x, 0, z, "sea_lantern"); put(x, 1, z, "water"); }
  }
  for (let y = 1; y <= 4; y++) put(0, y, 0, "quartz_pillar", { pillar_axis: "y" });
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const r = Math.hypot(x, z); if (r > 3.3) continue; put(x, 5, z, r > 2.3 ? "quartz_bricks" : "water"); }
  for (let y = 6; y <= 8; y++) put(0, y, 0, "quartz_pillar", { pillar_axis: "y" });
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) put(dx, 9, dz, dx || dz ? "quartz_bricks" : "sea_lantern");
  put(0, 10, 0, "water");
  for (let k = 0; k < 12; k++) {                                   // benches + lamp posts around the plaza
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12, x = Math.round(Math.cos(a) * 17), z = Math.round(Math.sin(a) * 17);
    if ((Math.abs(x) <= 4) || (Math.abs(z) <= 4)) continue;
    if (k % 2) { chair(x, 1, z, -Math.sign(x) * (Math.abs(x) >= Math.abs(z) ? 1 : 0), -Math.sign(z) * (Math.abs(z) > Math.abs(x) ? 1 : 0), "birch"); put(x + Math.sign(x), 1, z, "azalea_leaves", LEAF); }
    else { for (let y = 1; y <= 4; y++) put(x, y, z, y === 4 ? "lantern" : "polished_deepslate_wall", undefined, y === 4); }
  }
  // the avenues: lamp posts + flower beds
  for (const [ax, az] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) for (let d = 26; d <= 76; d += 10) for (const s of [-5, 5]) {
    const x = ax ? ax * d : s, z = az ? az * d : s;
    if (az === -1 && d > 25) continue;
    for (let y = 1; y <= 5; y++) put(x, y, z, y === 5 ? "lantern" : y === 1 ? "polished_deepslate" : "polished_deepslate_wall", undefined, y === 5);
    for (const t of [-3, -1, 1, 3]) { const fx = ax ? ax * (d + t) : s, fz = az ? az * (d + t) : s; if (free(fx, 1, fz)) put(fx, 1, fz, flowers[(d + t + 20) % flowers.length], undefined, true); }
  }
  for (let d = 22; d <= 29; d++) for (const s of [-5, 5]) { put(s, 1, -d, "polished_deepslate_wall"); if (d % 3 === 0) put(s, 2, -d, "lantern", undefined, true); }
  yield;

  // ================================================================ 5. NE: the CRATE PAVILION (domed gazebo, 3 crate altars)
  { const px = 45, pz = -42, R = 9;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const r = Math.hypot(x, z); if (r > R + 0.3) continue; put(px + x, 0, pz + z, r > R - 1 ? "polished_deepslate" : (x + z) % 2 ? "smooth_quartz" : "calcite"); }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8, x = Math.round(Math.cos(a) * (R - 1)), z = Math.round(Math.sin(a) * (R - 1)); for (let y = 1; y <= 7; y++) put(px + x, y, pz + z, y === 7 ? "chiseled_quartz_block" : "quartz_pillar", y === 7 ? undefined : { pillar_axis: "y" }); }
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) for (let y = 8; y <= 14; y++) {       // the dome
      const d = Math.hypot(x, z, (y - 8) * 1.4); if (d > R - 0.5 || d < R - 1.6) continue;
      put(px + x, y, pz + z, (y + Math.round(Math.atan2(z, x) * 6)) % 3 === 0 ? "light_blue_stained_glass" : y === 8 ? "deepslate_tiles" : "smooth_quartz");
    }
    put(px, 15, pz, "gold_block"); put(px, 16, pz, "lightning_rod", { facing_direction: 1 }, true); hang(px, 13, pz, 4);
    for (const c of D.crates) { put(c.x, 1, c.z, "chiseled_quartz_block"); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(c.x + dx, 1, c.z + dz, "quartz_stairs", { weirdo_direction: dirOf(-dx, -dz), upside_down_bit: false }); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, x = Math.round(Math.cos(a) * 6), z = Math.round(Math.sin(a) * 6); if (Math.abs(pz + z - D.crates[0].z) <= 2 && z < 0) continue; pot(px + x, 1, pz + z); }
    for (let s = -2; s <= 2; s++) for (let k = 0; k < 4; k++) put(px + s, 0, pz + R + k, "smooth_quartz");
  }
  yield;

  // ================================================================ 6. NW: the HALL OF LEGENDS (round colonnade, 10 obelisks for the TOP boards)
  { const hx = D.hall.x, hz = D.hall.z, R = 13;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const r = Math.hypot(x, z); if (r > R + 0.3) continue; put(hx + x, 0, hz + z, r < 3 ? "gold_block" : Math.round(r) % 3 === 0 ? "polished_deepslate" : "smooth_quartz"); }
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, x = Math.round(Math.cos(a) * R), z = Math.round(Math.sin(a) * R); if (z > 10 && Math.abs(x) <= 3) continue; for (let y = 1; y <= 9; y++) put(hx + x, y, hz + z, y === 9 ? "chiseled_quartz_block" : "quartz_pillar", y === 9 ? undefined : { pillar_axis: "y" }); }
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const r = Math.hypot(x, z); if (r > R + 0.5 || r < R - 1.5) continue; put(hx + x, 10, hz + z, "polished_deepslate"); put(hx + x, 11, hz + z, (x + z) % 3 === 0 ? "lantern" : "polished_deepslate_wall", undefined, (x + z) % 3 === 0); }
    for (const s of celestialBoards()) { const x = Math.floor(s.x), z = Math.floor(s.z); put(x, 1, z, "polished_deepslate"); put(x, 2, z, "quartz_pillar", { pillar_axis: "y" }); }
    for (let y = 1; y <= 6; y++) put(hx, y, hz, y === 6 ? "beacon|gold_block" : "gold_block");
    for (const [dx, dz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) { chair(hx + dx * 2, 1, hz + dz * 2, -Math.sign(dx), 0, "dark_oak"); }
  }
  yield;

  // ================================================================ 7. SE: the LIBRARY & CAFE (a furnished house)
  { const x1 = 36, x2 = 62, z1 = 30, z2 = 50, top = 8, mid = 49;
    C.fill(x1, 0, z1, x2, 0, z2, "polished_deepslate");
    for (let x = x1 + 1; x < x2; x++) for (let z = z1 + 1; z < z2; z++) put(x, 0, z, x < mid ? ((x + z) % 2 ? "dark_oak_planks" : "spruce_planks") : (x + z) % 2 ? "polished_diorite" : "smooth_quartz");
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
      const edge = x === x1 || x === x2 || z === z1 || z === z2, inner = x === mid; if (!edge && !inner) continue;
      for (let y = 1; y <= top; y++) {
        let b = (x === x1 || x === x2) && (z === z1 || z === z2) ? "stripped_dark_oak_log" : y === 1 ? "polished_deepslate" : y === top ? "dark_oak_planks" : "smooth_quartz";
        const along = edge ? (x === x1 || x === x2 ? z : x) : z;
        if (edge && y >= 3 && y <= 6 && (along + 40) % 4 >= 1 && (along + 40) % 4 <= 2) b = "glass_pane";
        if (inner && Math.abs(z - 40) <= 1 && y <= 3) b = null;                                      // the door between the rooms
        if (z === z1 && (x === 43 || x === 44 || x === 55 || x === 56) && y <= 3) b = null;          // front doors (north side)
        if (b) put(x, y, z, b, b === "stripped_dark_oak_log" ? { pillar_axis: "y" } : undefined);
      }
    }
    for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) put(x, top + 1, z, (x === x1 - 1 || x === x2 + 1 || z === z1 - 1 || z === z2 + 1) ? "dark_oak_slab" : "dark_oak_planks", (x === x1 - 1 || x === x2 + 1 || z === z1 - 1 || z === z2 + 1) ? { "minecraft:vertical_half": "bottom" } : undefined);
    for (let x = x1 + 2; x <= x2 - 2; x += 3) for (let z = z1 + 2; z <= z2 - 2; z += 3) put(x, top + 2, z, "polished_deepslate_wall");
    // the LIBRARY (west room): shelves along the walls, reading tables with chairs, lecterns, an armchair corner, a chandelier
    for (let z = z1 + 1; z < z2; z++) for (let y = 1; y <= 5; y++) if (y <= 4 && Math.abs(z - 40) > 1 && (z - z1) % 6 !== 0) put(x1 + 1, y, z, (z + y) % 4 === 0 ? "chiseled_bookshelf" : "bookshelf", (z + y) % 4 === 0 ? { books_stored: 42, direction: 3 } : undefined);
    for (let x = x1 + 2; x < mid; x++) for (let y = 1; y <= 4; y++) if ((x - x1) % 5 !== 0) put(x, y, z2 - 1, "bookshelf");
    for (const [tx, tz] of [[41, 35], [41, 43], [45, 35], [45, 43]]) {
      table(tx, 1, tz, "dark_oak"); chair(tx, 1, tz - 1, 0, 1, "spruce"); chair(tx, 1, tz + 1, 0, -1, "spruce"); candle(tx, 2, tz, 2, "red_candle");
    }
    put(40, 1, 39, "lectern", { "minecraft:cardinal_direction": "east", powered_bit: false }); put(47, 1, 39, "lectern", { "minecraft:cardinal_direction": "west", powered_bit: false });
    chair(38, 1, 46, 1, 0, "crimson"); chair(38, 1, 47, 1, 0, "crimson"); put(39, 1, 48, "red_carpet", undefined, true); pot(38, 1, 45); put(40, 1, 46, "red_carpet", undefined, true); put(40, 1, 47, "red_carpet", undefined, true);
    for (let x = 39; x <= 47; x++) for (let z = 37; z <= 41; z++) if (!C.has(x, 1, z)) put(x, 1, z, (x + z) % 2 ? "red_carpet" : "brown_carpet", undefined, true);
    chandelier(43, top, 40, 2); hang(39, top, 33, 2); hang(47, top, 47, 2);
    put(47, 1, 31, "enchanting_table"); put(39, 1, 31, "cartography_table"); put(46, 1, 31, "white_candle", { candles: 3, lit: true }, true);
    // the CAFE (east room): a counter, coffee + cake, barrels, a little kitchen, tables with chairs, plants, a chandelier
    for (let z = z1 + 2; z <= z1 + 9; z++) { put(x2 - 3, 1, z, "stripped_birch_log", { pillar_axis: "z" }); if (z % 3 === 0) put(x2 - 3, 2, z, "cake", undefined, true); else if (z % 3 === 1) put(x2 - 3, 2, z, "flower_pot", undefined, true); }
    for (let z = z1 + 1; z <= z1 + 9; z++) { put(x2 - 1, 1, z, z % 3 === 0 ? "smoker" : z % 3 === 1 ? "barrel" : "furnace", z % 3 === 1 ? { facing_direction: 4, open_bit: false } : { "minecraft:cardinal_direction": "west" }); put(x2 - 1, 2, z, z % 2 ? "barrel" : "chiseled_bookshelf", z % 2 ? { facing_direction: 4, open_bit: false } : { books_stored: 7, direction: 1 }); put(x2 - 1, 3, z, "spruce_trapdoor|trapdoor", { direction: 1, open_bit: true, upside_down_bit: false }); }
    put(x2 - 2, 1, z1 + 1, "cauldron"); put(x2 - 2, 1, z1 + 10, "crafting_table");
    for (const [tx, tz] of [[52, 36], [52, 42], [56, 39], [56, 46], [52, 47]]) { table(tx, 1, tz, "birch"); chair(tx - 1, 1, tz, 1, 0, "birch"); chair(tx + 1, 1, tz, -1, 0, "birch"); pot(tx, 2, tz); }
    for (const [px, pz] of [[50, 31], [61, 49], [50, 49], [61, 31]]) { put(px, 1, pz, "azalea_leaves", LEAF); put(px, 2, pz, "azalea_leaves_flowered|azalea_leaves", LEAF); }
    chandelier(55, top, 40, 2); hang(52, top, 33, 1); hang(58, top, 46, 1);
    // a terrace in front (north) with umbrellas, benches and flowers
    for (let x = x1; x <= x2; x++) for (let z = z1 - 6; z < z1; z++) put(x, 0, z, (x + z) % 2 ? "polished_diorite" : "smooth_quartz");
    for (const tx of [40, 48, 58]) { table(tx, 1, z1 - 3, "dark_oak"); chair(tx - 1, 1, z1 - 3, 1, 0); chair(tx + 1, 1, z1 - 3, -1, 0); for (let y = 2; y <= 4; y++) put(tx, y, z1 - 3, "dark_oak_fence"); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(tx + dx, 5, z1 - 3 + dz, (dx + dz) % 2 ? "red_wool" : "white_wool"); }
  }
  yield;

  // ================================================================ 8. SW: the WISTERIA GARDEN (picture 2) - the giant tree, swing, pond, tree house
  { const gx = -48, gz = 46;
    for (let x = -18; x <= 18; x++) for (let z = -16; z <= 16; z++) {                          // the pond + grass + paths
      const r = Math.hypot(x, z * 1.1); if (r > 17) continue;
      const pond = r > 7 && r < 12.5 && !(Math.abs(x) <= 1) && !(Math.abs(z) <= 1);
      if (pond) { put(gx + x, -1, gz + z, "mud"); put(gx + x, 0, gz + z, "water"); if ((x * 7 + z * 3 + 100) % 11 === 0) put(gx + x, 1, gz + z, "waterlily", undefined, true); }
      else put(gx + x, 0, gz + z, (x * 3 + z * 5 + 100) % 7 === 0 ? "coarse_dirt" : (x + z) % 5 === 0 ? "moss_block" : "grass_block");
    }
    for (let d = -17; d <= 17; d++) { put(gx + d, 0, gz, d % 2 ? "mud_bricks" : "packed_mud"); put(gx, 0, gz + d, d % 2 ? "mud_bricks" : "packed_mud"); }
    // the trunk (dark red wood, wide at the bottom) and branches
    const T = "crimson_hyphae|dark_oak_wood", T2 = "mangrove_wood|dark_oak_wood";
    for (let y = 1; y <= 16; y++) { const w = y <= 3 ? 2 : y <= 10 ? 1 : 1; for (let dx = -w; dx <= w; dx++) for (let dz = -w; dz <= w; dz++) { if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; if (y > 10 && Math.abs(dx) + Math.abs(dz) > 1) continue; put(gx + dx, y, gz + dz, (dx + dz + y) % 3 ? T : T2); } }
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) put(gx + dx, 1, gz + dz, "mangrove_roots");
    const branches = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    branches.forEach(([bx, bz], i) => { for (let k = 1; k <= 7; k++) put(gx + bx * k, 12 + Math.floor(k / 2) + (i % 2), gz + bz * k, T); });
    // the pink canopy with long hanging leaves (wisteria)
    for (let x = -13; x <= 13; x++) for (let z = -13; z <= 13; z++) for (let y = 14; y <= 20; y++) {
      const d = Math.hypot(x, z, (y - 17) * 2); if (d > 13 || rng() < 0.18) continue;
      if (!C.has(gx + x, y, gz + z)) put(gx + x, y, gz + z, (x + z + y) % 4 === 0 ? "azalea_leaves_flowered|cherry_leaves" : "cherry_leaves", LEAF);
    }
    for (let k = 0; k < 70; k++) {                                                              // hanging strands
      const a = rng() * Math.PI * 2, r = 4 + rng() * 9, x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r), len = 3 + Math.floor(rng() * 6);
      for (let i = 1; i <= len; i++) { const y = 14 - i; if (y < 3) break; put(gx + x, y, gz + z, i === len ? "azalea_leaves_flowered|cherry_leaves" : (k % 3 ? "cherry_leaves" : "weeping_vines"), i === len || k % 3 ? LEAF : { weeping_vines_age: 25 }, true); }
    }
    for (const [x, z, len] of [[3, 2, 6], [-3, -2, 5], [2, -4, 7], [-4, 3, 6], [5, -1, 8], [-2, 5, 7], [6, 4, 6], [-6, -4, 7]]) hang(gx + x, 13, gz + z, len);   // lanterns on chains
    // the swing (a bench hanging on chains under a branch)
    for (let y = 5; y <= 13; y++) { put(gx + 6, y, gz - 2, CHAIN, { pillar_axis: "y" }, true); put(gx + 6, y, gz + 2, CHAIN, { pillar_axis: "y" }, true); }
    for (let dz = -2; dz <= 2; dz++) stair(gx + 6, 4, gz + dz, "spruce_stairs", 1, 0);
    for (let dz = -2; dz <= 2; dz++) put(gx + 7, 5, gz + dz, "spruce_trapdoor|trapdoor", { direction: 2, open_bit: true, upside_down_bit: false }, true);
    // benches, flowers, amethyst, potted plants, stepping stones
    for (const [x, z, fx, fz] of [[-8, -14, 0, 1], [-7, -14, 0, 1], [9, 13, 0, -1], [10, 13, 0, -1], [14, -6, -1, 0], [14, -5, -1, 0]]) chair(gx + x, 1, gz + z, fx, fz, "spruce");
    for (let k = 0; k < 90; k++) { const a = rng() * Math.PI * 2, r = 3 + rng() * 14, x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r * 0.9); if (C.id(gx + x, 0, gz + z) === "water" || C.has(gx + x, 1, gz + z)) continue; const f = k % 9 === 0 ? "amethyst_cluster" : k % 5 === 0 ? "pink_petals" : k % 4 === 0 ? "lilac" : k % 3 === 0 ? "torchflower" : ["allium", "pink_tulip", "azure_bluet", "oxeye_daisy", "lily_of_the_valley"][k % 5]; put(gx + x, 1, gz + z, f, f === "amethyst_cluster" ? { "minecraft:block_face": "up" } : f === "pink_petals" ? { growth: 3, "minecraft:cardinal_direction": "north" } : f === "lilac" ? { upper_block_bit: false } : undefined, true); if (f === "lilac") put(gx + x, 2, gz + z, "lilac", { upper_block_bit: true }, true); }
    for (const [x, z] of [[-12, 8], [11, -9], [-10, -10], [12, 9]]) { put(gx + x, 1, gz + z, "decorated_pot", { direction: 0 }, true); pot(gx + x + 1, 1, gz + z); }
    // the little tree house (a platform in the tree with a table, chairs, a bed, a ladder)
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { if (Math.abs(x) <= 1 && Math.abs(z) <= 1) continue; if (Math.abs(x) === 4 || Math.abs(z) === 4) { put(gx + x, 9, gz + z, "spruce_planks"); put(gx + x, 10, gz + z, "spruce_fence"); } else put(gx + x, 9, gz + z, "spruce_planks"); }
    for (let y = 1; y <= 9; y++) put(gx + 2, y, gz - 4, "ladder", { facing_direction: 2 }, true);
    put(gx + 2, 10, gz - 4, "air"); C.del(gx + 2, 10, gz - 4);
    table(gx - 3, 10, gz + 2, "spruce"); chair(gx - 3, 10, gz + 3, 0, -1, "spruce"); chair(gx - 2, 10, gz + 2, -1, 0, "spruce"); bed(gx + 3, 10, gz + 1, 0); pot(gx - 3, 10, gz - 3); put(gx + 3, 10, gz - 3, "barrel", { facing_direction: 1, open_bit: false }); candle(gx - 3, 11, gz + 2, 3, "orange_candle");
    hang(gx, 13, gz + 3, 2); hang(gx - 3, 13, gz - 1, 2);
  }
  yield;

  // ================================================================ 9. S: the MOONLIT GARDEN (picture 3) - water channels, white paths, arches with pale moss, mushroom lamps
  { const z1 = 30, z2 = 74;
    for (const sx of [-1, 1]) for (let ax = 6; ax <= 22; ax++) for (let z = z1; z <= z2; z++) {
      const x = sx * ax, wiggle = Math.round(Math.sin(z / 5) * 2), water = ax >= 9 + wiggle && ax <= 13 + wiggle;
      if (water) { put(x, -1, z, "sea_lantern"); put(x, 0, z, "water"); continue; }
      const path = (ax <= 8 + wiggle) || (z % 9 <= 1 && ax <= 18);
      put(x, 0, z, path ? ((x + z) % 3 === 0 ? "calcite" : "smooth_quartz") : (x * 3 + z) % 6 === 0 ? "moss_block" : "grass_block");
      if (!path && (x * 7 + z * 13 + 1000) % 9 === 0) put(x, 1, z, ["blue_orchid", "cornflower", "lily_of_the_valley", "azure_bluet"][(x + z + 100) % 4], undefined, true);
      if (!path && (x * 5 + z * 11 + 1000) % 17 === 0) put(x, 1, z, "short_grass|tallgrass", undefined, true);
    }
    // little bridges over the channels
    for (let z = z1 + 4; z <= z2; z += 9) for (const sx of [-1, 1]) for (let ax = 8; ax <= 15; ax++) put(sx * ax, 0, z, "smooth_quartz_slab", { "minecraft:vertical_half": "top" });
    // white arches with hanging pale moss over the paths
    for (let z = z1 + 6; z <= z2; z += 11) for (const sx of [-1, 1]) {
      const ax0 = 16;
      for (let y = 1; y <= 7; y++) { put(sx * ax0, y, z - 2, "smooth_quartz"); put(sx * ax0, y, z + 2, "smooth_quartz"); }
      for (let dz = -2; dz <= 2; dz++) { put(sx * ax0, 8, z + dz, "quartz_bricks"); if (Math.abs(dz) <= 1) for (let y = 7; y >= 4 + Math.abs(dz) * 2; y--) put(sx * ax0, y, z + dz, "pale_hanging_moss|weeping_vines", { tip: y === 4 + Math.abs(dz) * 2 }, true); }
      put(sx * ax0, 9, z, "soul_lantern", { hanging: false }, true);
    }
    // mushroom lamps (white cap on a stem) + lanterns on the ground + glowing pickles in the water
    for (let z = z1 + 2; z <= z2; z += 5) for (const sx of [-1, 1]) {
      const x = sx * (17 + ((z / 5) % 3 | 0));
      for (let y = 1; y <= 2; y++) put(x, y, z, "mushroom_stem", { huge_mushroom_bits: 15 });
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(x + dx, 3, z + dz, dx || dz ? "white_concrete" : "pearlescent_froglight|ochre_froglight");
      put(sx * 7, 1, z, "soul_lantern", { hanging: false }, true);
      put(sx * 11, 0, z, "sea_pickle", { cluster_count: 3, dead_bit: false }, true); C.del(sx * 11, -1, z); put(sx * 11, -1, z, "sea_lantern");
    }
  }
  yield;

  // ================================================================ 10. E / W: the PERGOLA gardens (picture 1) - white pergolas with leafy roofs, flower beds, benches
  for (const sx of [-1, 1]) {
    const cx = sx * 48, cz = 0;
    for (let x = -14; x <= 14; x++) for (let z = -12; z <= 12; z++) {
      if (Math.abs(z) <= 3) continue;                                                            // the avenue
      const ex = cx + x, onGrid = (x + 14) % 7 === 0 && (Math.abs(z) - 4) % 4 === 0;
      put(ex, 0, z, (x + z) % 2 ? "polished_diorite" : "calcite");
      if (onGrid) { for (let y = 1; y <= 5; y++) put(ex, y, z, y === 5 ? "chiseled_quartz_block" : "quartz_pillar", y === 5 ? undefined : { pillar_axis: "y" }); }
      if ((x + 14) % 7 === 0 || (Math.abs(z) - 4) % 4 === 0) { put(ex, 6, z, "smooth_quartz_slab", { "minecraft:vertical_half": "bottom" }); if (rng() < 0.55) put(ex, 7, z, rng() < 0.3 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF); }
      else if (rng() < 0.25) put(ex, 7, z, "azalea_leaves", LEAF);
      if (!onGrid && (x + 14) % 7 === 3 && (Math.abs(z) - 4) % 4 === 2) { if ((x + z) % 2) table(ex, 1, z, "birch"); else put(ex, 1, z, flowers[(x + z + 50) % flowers.length], undefined, true); }
      if (!onGrid && (x + 14) % 7 === 3 && Math.abs(z) === 4) chair(ex, 1, z, 0, z > 0 ? 1 : -1, "birch");
    }
    for (let x = -14; x <= 14; x += 4) for (const s of [-1, 1]) { const z = s * 13; put(cx + x, 1, z, "azalea_leaves_flowered|azalea_leaves", LEAF); put(cx + x + 1, 1, z, flowers[(x + 40) % flowers.length], undefined, true); }
  }
  yield;

  // ================================================================ 11. the outer garden: big trees, bushes, flowers (between the ring and the edge, and inside the ring)
  const busy = (x, z) => {
    if (C.id(x, 0, z) !== null) return true;                                                   // the trunk stands on grass
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 1; y <= 9; y++) if (C.has(x + dx, y, z + dz)) return true;
    return false;
  };
  let trees = 0;
  for (let k = 0; k < 1200 && trees < 80; k++) {
    const a = rng() * Math.PI * 2, r = rng() < 0.5 ? 95.5 + rng() * 2.5 : 54 + rng() * 22, x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    if (Math.hypot(x, z) > 97) continue;
    if (r < 80 && (Math.abs(x) <= 8 || Math.abs(z) <= 8)) continue;
    if (busy(x, z)) continue;
    tree(x, z, 6 + Math.floor(rng() * 4), 4 + Math.floor(rng() * 2), rng() < 0.2 ? "azalea_leaves" : rng() < 0.15 ? "cherry_leaves" : "oak_leaves", rng() < 0.15 ? "cherry_log" : rng() < 0.4 ? "dark_oak_log" : "oak_log");
    trees++;
  }
  for (let k = 0; k < 900; k++) {                                                                   // bushes + flowers on the free grass
    const x = Math.round((rng() - 0.5) * 196), z = Math.round((rng() - 0.5) * 196), r = Math.hypot(x, z);
    if (r > 98 || (r > 79 && r < 95) || C.has(x, 1, z) || (C.id(x, 0, z) ?? "grass_block") !== "grass_block") continue;
    const t = rng();
    if (t < 0.12) { put(x, 1, z, "azalea_leaves", LEAF); if (rng() < 0.5) put(x, 2, z, "azalea_leaves_flowered|azalea_leaves", LEAF); }
    else if (t < 0.55) put(x, 1, z, flowers[Math.floor(rng() * flowers.length)], undefined, true);
    else put(x, 1, z, rng() < 0.5 ? "short_grass|tallgrass" : "fern", undefined, true);
  }
  yield;

  // ================================================================ 12. light everywhere (invisible light blocks: no mobs)
  for (let x = -98; x <= 98; x += 7) for (let z = -98; z <= 98; z += 7) {
    if (Math.hypot(x, z) > 99) continue;
    let y = 1; while (y < 30 && C.has(x, y, z)) y++;
    if (y < 30) light(x, y, z);
  }
  for (let x = -18; x <= 18; x += 6) for (let z = -68; z <= -33; z += 6) light(x, 3, z);                 // inside the cathedral
  for (let x = 38; x <= 60; x += 5) for (let z = 32; z <= 48; z += 5) light(x, 3, z);                     // the house
  return C;
}
export function celestialSpawn() { const g = celestialGen(); let r; while (!(r = g.next()).done); return r.value; }
