// =====================================================================================================================
// THE CELESTIAL SANCTUARY - the third spawn (pure data, no game calls: can be tested / previewed outside the game)
//   (271 x 271 now: + a boulevard around the ring, the NETHER GATE (south) and 4 BUTTERFLY LANTERN portals - see 10b)
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

/** compact block store for a 281 x 281 area. x / z: -140..140, y: -12..79 */
export class BigCanvas {
  constructor() { this.m = new Map(); this.pal = []; this.pi = new Map(); this.fills = []; }
  static k(x, y, z) { return ((x + 140) * 92 + (y + 12)) * 281 + (z + 140); }
  p(id, st, late) { const key = id + "#" + (st ? JSON.stringify(st) : "") + "#" + (late ? 1 : 0); let i = this.pi.get(key); if (i === undefined) { i = this.pal.length; this.pal.push({ id, st, late: !!late }); this.pi.set(key, i); } return i; }
  put(x, y, z, id, st, late = false) { if (id == null) { this.del(x, y, z); return; } if (y < -12 || y > 79 || x < -140 || x > 140 || z < -140 || z > 140) return; this.m.set(BigCanvas.k(x, y, z), this.p(id, st, late)); }
  del(x, y, z) { this.m.delete(BigCanvas.k(x, y, z)); }
  has(x, y, z) { return this.m.has(BigCanvas.k(x, y, z)); }
  id(x, y, z) { const i = this.m.get(BigCanvas.k(x, y, z)); return i === undefined ? null : this.pal[i].id; }
  get size() { return this.m.size; }
  fill(x1, y1, z1, x2, y2, z2, id) { this.fills.push({ from: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) }, to: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) }, id }); }
  *orderedGen() {
    const pal = this.pal, buckets = new Map(); let n = 0;
    for (const [k, i] of this.m) {
      const z = (k % 281) - 140, r = Math.floor(k / 281), y = (r % 92) - 12, x = Math.floor(r / 92) - 140;
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
  R: 135, UP: 66, DOWN: 6, spawn: { x: 0, y: 1, z: 15 },
  // the Nether portals (relative boxes of portal blocks) - the script sends a player who walks in to a RANDOM place in the Nether
  portals: [],
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
  C.fill(-135, 0, -135, -16, 0, 135, "grass_block"); C.fill(-15, 0, -135, 104, 0, 135, "grass_block"); C.fill(105, 0, -135, 135, 0, 135, "grass_block");
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

  // ================================================================ 10b. outside the ring: the BOULEVARD (r 104 - 108), avenues, the NETHER GATE (south), 4 BUTTERFLY LANTERNS
  for (let x = -135; x <= 135; x++) for (let z = -135; z <= 135; z++) {
    const r = Math.hypot(x, z); if (r < 99 || r > 135) continue;
    const ang = Math.atan2(z, x), ax = Math.abs(x), az = Math.abs(z);
    let b = null;
    if (r >= 103.5 && r <= 108.5) b = r < 104.5 || r > 107.5 ? "polished_deepslate" : (Math.round(ang * 60) % 2 ? "calcite" : "smooth_quartz");      // the boulevard
    else if ((ax <= 3 && z > 0) || (az <= 3 && ax > 0) || (ax <= 3 && z < -100)) b = ax === 3 || az === 3 ? "polished_deepslate" : ((x + z + 200) % 4 === 0 ? "calcite" : "smooth_quartz");   // the avenues out of the gates
    else if (Math.abs(ax - az) <= 2 && r < 116) b = Math.abs(ax - az) === 2 ? "polished_deepslate" : "calcite";                    // the diagonal paths to the lanterns
    if (b) put(x, 0, z, b);
  }
  for (let k = 0; k < 36; k++) {                                                                // lamp posts along the boulevard
    const a = (k / 36) * Math.PI * 2 + 0.04, x = Math.round(Math.cos(a) * 109.5), z = Math.round(Math.sin(a) * 109.5);
    if (Math.abs(x) <= 6 || Math.abs(z) <= 6 || Math.abs(Math.abs(x) - Math.abs(z)) <= 4) continue;
    for (let y = 1; y <= 6; y++) put(x, y, z, y === 6 ? "soul_lantern" : y === 1 ? "polished_deepslate" : "polished_deepslate_wall", y === 6 ? { hanging: false } : undefined, y === 6);
    put(x + Math.sign(x), 1, z, flowers[k % flowers.length], undefined, true);
  }
  const portalBox = (x1, y1, z1, x2, y2, z2, axis, pad) => {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) if (C.id(x, y, z) === "portal") { /* already */ }
    D.portals.push({ x1, y1, z1, x2, y2, z2, axis, pad });
  };
  // ---- THE NETHER GATE (picture 1): stone wings fanned out, a pointed arch, a purple mosaic, a real portal inside
  { D.portals.length = 0;
    const gz = 124, PW = 5, PH = 15;                                   // the portal opening: |x| <= 5 (11 wide), y 2 .. 16 + a pointed top
    const inPortal = (x, y) => { if (Math.abs(x) > PW) return false; if (y < 2) return false; const top = PH + 1 + Math.round(4 * Math.sqrt(Math.max(0, 1 - (Math.abs(x) / (PW + 0.5)) ** 2))); return y <= Math.min(top, PH + 5) && y <= PH + 1 + (PW - Math.abs(x)); };
    // the plaza in front (purple mosaic floor), stairs up
    for (let x = -16; x <= 16; x++) for (let z = 104; z <= 123; z++) { const r = Math.hypot(x, (z - 116) * 1.2); if (r > 16) continue; put(x, 0, z, r < 4 ? "amethyst_block" : Math.round(r) % 3 === 0 ? "purpur_block" : (x + z) % 2 ? "polished_diorite" : "calcite", Math.round(r) % 3 === 0 && r >= 4 ? { pillar_axis: "y" } : undefined); }
    for (let x = -9; x <= 9; x++) { put(x, 1, 122, "smooth_quartz"); stair(x, 1, 121, "quartz_stairs", 0, 1); }
    // the portal + its obsidian frame + the purple lattice around it
    for (let x = -PW - 3; x <= PW + 3; x++) for (let y = 1; y <= PH + 12; y++) {
      const inside = inPortal(x, y);
      if (inside) { put(x, y, gz, "portal", { portal_axis: "x" }); continue; }
      const nb = inPortal(x - 1, y) || inPortal(x + 1, y) || inPortal(x, y - 1) || inPortal(x, y + 1);
      if (nb) { put(x, y, gz, (x + y) % 5 === 0 ? "crying_obsidian" : "obsidian"); continue; }
      const nb2 = [[-2, 0], [2, 0], [0, 2], [-1, 1], [1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => inPortal(x + dx, y + dy));
      if (nb2) put(x, y, gz, (x + y) % 2 ? "purple_stained_glass" : "amethyst_block");
    }
    portalBox(-PW, 2, gz, PW, PH + 5, gz, "x", { x: 0, y: 1, z: 117 });
    // the arch: two white pillars with purple stripes, a pointed stone arch, a crown with a purple diamond
    for (const sx of [-1, 1]) for (let y = 1; y <= 22; y++) for (let dx = 0; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = sx * (PW + 3 + dx), z = gz + dz;
      put(x, y, z, dz === 0 && dx === 0 && y % 4 === 2 ? "purpur_pillar" : y % 6 === 0 ? "chiseled_quartz_block" : dx === 1 ? "calcite" : "quartz_pillar", dz === 0 && dx === 0 && y % 4 === 2 ? { pillar_axis: "y" } : (y % 6 === 0 || dx === 1) ? undefined : { pillar_axis: "y" });
    }
    for (let x = -PW - 4; x <= PW + 4; x++) for (let y = 20; y <= 30; y++) {
      const ax = Math.abs(x), top = 30 - Math.floor(ax * 0.9), bot = PH + 6 + Math.max(0, 4 - ax);
      if (y < bot || y > top) continue;
      if (C.id(x, y, gz) === "portal") continue;
      for (const dz of [-1, 0, 1]) put(x, y, gz + dz, y === top ? "polished_deepslate" : (x + y) % 3 === 0 ? "chiseled_quartz_block" : "smooth_quartz");
    }
    for (const [dx, dy] of [[0, 0], [1, -1], [-1, -1], [0, -2], [1, 1], [-1, 1], [0, 2], [0, -1], [0, 1], [1, 0], [-1, 0]]) put(dx, 26 + dy, gz - 2, Math.abs(dx) + Math.abs(dy) <= 1 ? "amethyst_block" : "purple_stained_glass");
    put(0, 32, gz, "end_rod", { facing_direction: 1 }, true); put(0, 31, gz, "gold_block");
    // the WINGS: 8 curved stone spikes on each side, fanning out like feathers, with moss and glow lichen
    const WING = ["calcite", "polished_diorite", "smooth_quartz", "diorite", "stone_bricks", "polished_andesite"];
    for (const sx of [-1, 1]) for (let f = 0; f < 8; f++) {
      const baseA = (100 - f * 13) * Math.PI / 180, len = 14 + f * 1.6 - (f > 5 ? (f - 5) * 3 : 0), w0 = 3.2 - f * 0.15;
      for (let t = 0; t <= len; t += 0.5) {
        const k = t / len, bend = 0.55 * k * k, a = baseA - bend * (f < 4 ? 1 : 0.6);
        const cxw = sx * (PW + 5 + Math.cos(a) * t * 1.15), cyw = 3 + Math.sin(a) * t * 1.25 + f * 0.6, wd = Math.max(0.6, w0 * (1 - k * 0.85));
        for (let dx = -Math.ceil(wd); dx <= Math.ceil(wd); dx++) for (let dy = -Math.ceil(wd); dy <= Math.ceil(wd); dy++) {
          if (Math.hypot(dx, dy) > wd) continue;
          const x = Math.round(cxw + dx), y = Math.round(cyw + dy); if (y < 1 || y > 44) continue;
          for (let dz = -1; dz <= (k < 0.5 ? 1 : 0); dz++) { const z = gz + 1 + dz + Math.round(k * 2); if (C.id(x, y, z) === "portal") continue; put(x, y, z, WING[(x * 3 + y * 7 + f + 100) % WING.length]); }
        }
      }
    }
    for (let k = 0; k < 60; k++) {                                       // moss + vines + glow lichen on the wings and the base
      const x = Math.round((rng() - 0.5) * 60), y = 1 + Math.floor(rng() * 20), z = gz + 1 + Math.floor(rng() * 3);
      if (C.has(x, y, z) && !C.has(x, y, z - 1) && C.id(x, y, z) !== "portal") { if (rng() < 0.5) put(x, y, z - 1, "glow_lichen", { multi_face_direction_bits: 16 }, true); else put(x, y, z - 1, "vine", { vine_direction_bits: 1 }, true); }
    }
    for (let x = -26; x <= 26; x++) for (let z = gz - 3; z <= gz + 5; z++) {                  // rocks at the foot
      const r = Math.hypot(x * 0.6, z - gz - 1); if (r > 4.5 || Math.abs(x) < PW + 4) continue;
      for (let y = 1; y <= Math.round(3 - r * 0.5); y++) put(x, y, z, (x + z + y) % 4 === 0 ? "mossy_stone_bricks" : (x + y) % 3 ? "stone_bricks" : "tuff_bricks");
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const x = sx * (8 + k * 3), z = 106 + k; for (let y = 1; y <= 4; y++) put(x, y, z, y === 4 ? "amethyst_cluster" : "purpur_pillar", y === 4 ? { "minecraft:block_face": "up" } : { pillar_axis: "y" }, y === 4); }
  }
  // ---- 4 BUTTERFLY LANTERNS (picture 2): a cream lantern with purple glass, a portal inside, a crystal on top
  const WINGMAP = [
    "......KKK....", ".....KLLLK...", "....KLLBBLK..", "...KLLBBBBLK.", "..KLLBBWBBBLK", ".KLLBBBBBBLLK", "KLLBBBBBBLLK.", "KLBBBBBLLLK..", "KLLLLLLKKK...",
    "KPPPPPPK.....", "KMPPPPPPK....", "KMMPWPPPPK...", "KMMMPPPPPK...", ".KMMMRRPPK...", "..KMMRRRK....", "...KKMMK.....", ".....KK......",
  ];
  const WC = { K: "black_concrete", L: "light_blue_concrete", B: "blue_concrete", W: "white_concrete", P: "purple_concrete", M: "magenta_concrete", R: "pink_concrete" };
  const WG = { L: "light_blue_stained_glass", B: "blue_stained_glass", P: "purple_stained_glass", M: "magenta_stained_glass", R: "pink_stained_glass" };
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const lx = sx * 84, lz = sz * 84, toward = [-sx, -sz];                              // the front looks at the spawn (portal on the side facing the middle along z)
    const fz = -sz;                                                                    // the portal face: the side towards the spawn (z)
    // the plaza + steps
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) { const r = Math.hypot(x, z); if (r > 9.3) continue; put(lx + x, 0, lz + z, r < 6 ? ((x + z) % 2 ? "smooth_sandstone" : "cut_sandstone") : Math.round(r) === 7 ? "purpur_block" : "calcite", Math.round(r) === 7 && r >= 6 ? { pillar_axis: "y" } : undefined); }
    // the legs + the base frame (y 1 .. 3), floor at y 3
    for (const [cx, cz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { for (let y = 1; y <= 3; y++) put(lx + cx, y, lz + cz, y === 1 ? "smooth_sandstone_stairs" : "smooth_sandstone", y === 1 ? { weirdo_direction: dirOf(-cx, -cz), upside_down_bit: true } : undefined); }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) put(lx + x, 3, lz + z, Math.abs(x) === 4 || Math.abs(z) === 4 ? "cut_sandstone" : "purpur_block", Math.abs(x) === 4 || Math.abs(z) === 4 ? undefined : { pillar_axis: "y" });
    for (let x = -2; x <= 2; x++) for (let k = 0; k < 4; k++) {                 // the steps up to the portal (it starts at y 5)
      const z = lz + fz * (5 + k), top = 4 - k;
      for (let y = 1; y < top; y++) put(lx + x, y, z, "cut_sandstone");
      put(lx + x, top, z, "smooth_sandstone_stairs", { weirdo_direction: dirOf(0, -fz), upside_down_bit: false });
    }
    // the body: corner posts, purple glass walls, the portal on the front face
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 4; y <= 15; y++) {
      const edgeX = Math.abs(x) === 4, edgeZ = Math.abs(z) === 4; if (!edgeX && !edgeZ) continue;
      const corner = edgeX && edgeZ, front = z === fz * 4 && !corner;
      let b = corner ? "smooth_sandstone" : y === 4 || y === 15 ? "cut_sandstone" : y === 14 ? (x + z) % 2 ? "magenta_stained_glass" : "cut_sandstone" : "purple_stained_glass";
      if (front) { b = Math.abs(x) <= 2 && y >= 5 && y <= 12 ? "portal" : Math.abs(x) === 3 || y === 4 || y === 13 ? "obsidian" : b; }
      put(lx + x, y, lz + z, b, b === "portal" ? { portal_axis: "x" } : undefined);
    }
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 4; y <= 14; y++) if (!(Math.abs(x) <= 2 && z === fz * 4)) { if (y === 4) put(lx + x, y, lz + z, "amethyst_block"); }
    hang(lx, 14, lz, 3, "soul_lantern");
    portalBox(lx - 2, 5, lz + fz * 4, lx + 2, 12, lz + fz * 4, "x", { x: lx, y: 1, z: lz + fz * 10 });
    // the roof: a cornice with green trim, a tiered top, a pole
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { const e = Math.abs(x) === 5 || Math.abs(z) === 5; put(lx + x, 16, lz + z, e ? "smooth_sandstone_slab" : "cut_sandstone", e ? { "minecraft:vertical_half": "bottom" } : undefined); if (!e && (Math.abs(x) === 4 || Math.abs(z) === 4) && (x + z) % 2 === 0) put(lx + x, 17, lz + z, "waxed_oxidized_cut_copper|prismarine_bricks"); }
    for (let k = 0; k < 4; k++) for (let x = -4 + k; x <= 4 - k; x++) for (let z = -4 + k; z <= 4 - k; z++) { if (Math.abs(x) === 4 - k || Math.abs(z) === 4 - k) stair(lx + x, 17 + k, lz + z, "smooth_sandstone_stairs", Math.abs(x) >= Math.abs(z) ? -Math.sign(x) || 1 : 0, Math.abs(z) > Math.abs(x) ? -Math.sign(z) : 0); }
    for (let y = 21; y <= 23; y++) put(lx, y, lz, "smooth_sandstone_wall|sandstone_wall");
    for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) put(lx + cx, 15, lz + cz, "end_rod", { facing_direction: 0 }, true);
    // the top: a purple crystal finial with a soul lantern (the butterflies fly in the sky now - butterflies.js)
    put(lx, 24, lz, "amethyst_block"); put(lx, 25, lz, "amethyst_cluster", { "minecraft:block_face": "up" }, true);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(lx + dx, 23, lz + dz, "soul_lantern", { hanging: false }, true);
    // flowers + crystals around the plaza
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, x = Math.round(Math.cos(a) * 8), z = Math.round(Math.sin(a) * 8); if (C.has(lx + x, 1, lz + z)) continue; put(lx + x, 1, lz + z, k % 3 === 0 ? "amethyst_cluster" : ["allium", "lilac", "pink_tulip"][k % 3], k % 3 === 0 ? { "minecraft:block_face": "up" } : k % 3 === 1 ? { upper_block_bit: false } : undefined, true); if (k % 3 === 1) put(lx + x, 2, lz + z, "lilac", { upper_block_bit: true }, true); }
  }
  yield;

  // ================================================================ 10c. GARDEN PIECES from the pictures, around the outer garden (r ~121)
  const W = (x, z) => { put(x, -1, z, "mud"); put(x, 0, z, "water"); };
  const edgeStone = (x, z) => put(x, 0, z, ["cobblestone", "andesite", "stone", "mossy_cobblestone", "tuff"][Math.abs(x * 7 + z * 3) % 5]);
  const lampPost = (x, z, h = 2, wood = "spruce_fence") => { for (let y = 1; y <= h; y++) put(x, y, z, wood); put(x, h + 1, z, "lantern", { hanging: false }, true); };
  const leafBush = (x, y, z, n = 1) => { for (let k = 0; k < n; k++) put(x, y + k, z, k ? "azalea_leaves_flowered|azalea_leaves" : "oak_leaves", LEAF); };
  // 1) the pond with a terracotta bridge and a little pergola (picture 1)
  function pondBridge(cx, cz) {
    for (let x = -7; x <= 7; x++) for (let z = -5; z <= 5; z++) {
      const e = Math.abs(x) === 7 || Math.abs(z) === 5;
      if (e) edgeStone(cx + x, cz + z); else { W(cx + x, cz + z); if ((x * 5 + z * 3 + 50) % 7 === 0) put(cx + x, 1, cz + z, "waterlily", undefined, true); }
    }
    for (let x = -3; x <= 3; x++) {                                                      // the bridge across (along z), up 2 in the middle
      const h = 3 - Math.max(1, Math.abs(x));
      for (let z = -6; z <= 6; z++) {
        const side = Math.abs(z) >= 1 && Math.abs(z) <= 1 ? false : false;
        if (Math.abs(z) <= 1) { for (let y = 1; y <= h; y++) put(cx + x, y, cz + z, y === h ? "cut_sandstone" : "hardened_clay"); if (h === 0) put(cx + x, 0, cz + z, "cut_sandstone"); }
        else if (Math.abs(z) === 2) { for (let y = 1; y <= h + 1; y++) put(cx + x, y, cz + z, "hardened_clay"); }
        void side;
      }
    }
    for (const sx of [-1, 1]) for (let k = 4; k <= 6; k++) for (let z = -1; z <= 1; z++) { const x = sx * k; if (k === 4) stair(cx + x, 1, cz + z, "smooth_sandstone_stairs", -sx, 0); else put(cx + x, 0, cz + z, "cut_sandstone"); }
    for (const [x, z] of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) lampPost(cx + x, cz + z, 1, "hardened_clay");
    for (let x = -11; x <= -8; x++) for (let z = -2; z <= 2; z++) { put(cx + x, 0, cz + z, "spruce_planks"); if ((x === -11 || x === -8) && Math.abs(z) === 2) for (let y = 1; y <= 3; y++) put(cx + x, y, cz + z, "spruce_log", { pillar_axis: "y" }); }
    for (let x = -12; x <= -7; x++) for (let z = -3; z <= 3; z++) put(cx + x, 4, cz + z, (x + z) % 2 ? "spruce_slab" : "spruce_planks", (x + z) % 2 ? { "minecraft:vertical_half": "bottom" } : undefined);
    chair(cx - 10, 1, cz, 1, 0, "spruce"); pot(cx - 9, 1, cz - 1); leafBush(cx - 12, 1, cz + 3, 2);
    for (const [x, z] of [[-6, -4], [-6, 4], [6, 4], [5, -4]]) { for (let y = 1; y <= 3; y++) put(cx + x, y, cz + z, "bamboo|sugar_cane", undefined, true); }
    for (const [x, z, f] of [[-8, 4, "lilac"], [8, -3, "peony"], [8, 3, "allium"], [-8, -4, "pink_tulip"]]) { put(cx + x, 1, cz + z, f, f === "lilac" || f === "peony" ? { upper_block_bit: false } : undefined, true); if (f === "lilac" || f === "peony") put(cx + x, 2, cz + z, f, { upper_block_bit: true }, true); }
  }
  // 2) the medium pond: seagrass, lily pads, a gravel path, red + blue mushrooms, bushes, a small tree (picture 2)
  function mediumPond(cx, cz) {
    for (let x = -8; x <= 8; x++) for (let z = -7; z <= 7; z++) {
      const d = Math.hypot(x * 0.95, z * 1.1) + Math.sin(x * 0.9 + z * 0.7) * 0.8;
      if (d < 5.5) { W(cx + x, cz + z); if ((x + z * 3 + 40) % 4 === 0) put(cx + x, 0, cz + z, "seagrass", { sea_grass_type: "default" }); if ((x * 3 + z + 40) % 6 === 0) put(cx + x, 1, cz + z, "waterlily", undefined, true); }
      else if (d < 6.6) put(cx + x, 0, cz + z, (x + z) % 3 ? "gravel" : "cobblestone");
      else if (d < 8.5 && (x * 7 + z * 5 + 99) % 5 === 0) leafBush(cx + x, 1, cz + z, 1 + ((x + z + 40) % 2));
    }
    for (const [x, z, cap] of [[-6, -5, "red_mushroom_block"], [6, -4, "brown_mushroom_block|red_mushroom_block"], [-5, 6, "red_mushroom_block"], [7, 5, "warped_wart_block"]]) {
      put(cx + x, 1, cz + z, "mushroom_stem", { huge_mushroom_bits: 15 });
      for (let dx = -1; dx <= 0; dx++) for (let dz = -1; dz <= 0; dz++) put(cx + x + dx, 2, cz + z + dz, cap, cap === "warped_wart_block" ? undefined : { huge_mushroom_bits: 14 });
    }
    tree(cx - 7, cz + 1, 5, 3, "oak_leaves", "dark_oak_log");
    for (const [x, z] of [[-3, 7], [2, -7], [7, 1], [-8, -3]]) put(cx + x, 1, cz + z, ["red_tulip", "poppy", "oxeye_daisy", "red_tulip"][(x + 9) % 4], undefined, true);
  }
  // 3) the rocky pond with two trees and a wooden gazebo (picture 3)
  function rockPond(cx, cz) {
    for (let x = -9; x <= 9; x++) for (let z = -8; z <= 8; z++) {
      const d = Math.hypot(x, z * 1.15);
      if (d < 4.5) W(cx + x, cz + z);
      else if (d < 9) { const h = d < 6 ? 1 : Math.min(3, 1 + Math.floor((d - 6) * 0.8)); if (z > 4 && Math.abs(x) < 3) continue; for (let y = 1; y <= h; y++) put(cx + x, y, cz + z, (x * 3 + z + y) % 4 === 0 ? "mossy_cobblestone" : (x + y) % 3 ? "stone" : "andesite"); if ((x + z) % 4 === 0) put(cx + x, h + 1, cz + z, d < 7 ? "short_grass|tallgrass" : "moss_carpet", undefined, true); }
    }
    for (let z = 5; z <= 8; z++) for (let x = -2; x <= 2; x++) { const h = z - 5; for (let y = 1; y <= h; y++) put(cx + x, y, cz + z, "stone_bricks"); if (z > 5) stair(cx + x, h + 1 > 3 ? 3 : h, cz + z, "stone_brick_stairs", 0, 1); }
    tree(cx - 6, cz - 5, 8, 4, "oak_leaves", "oak_log", 3); tree(cx + 6, cz - 4, 7, 4, "azalea_leaves", "dark_oak_log", 3);
    for (let x = 4; x <= 7; x++) for (let z = 1; z <= 4; z++) { put(cx + x, 2, cz + z, "oak_planks"); if ((x === 4 || x === 7) && (z === 1 || z === 4)) for (let y = 3; y <= 5; y++) put(cx + x, y, cz + z, "oak_fence"); }
    for (let x = 3; x <= 8; x++) for (let z = 0; z <= 5; z++) put(cx + x, 6, cz + z, (x + z) % 2 ? "oak_slab" : "oak_planks", (x + z) % 2 ? { "minecraft:vertical_half": "bottom" } : undefined);
    put(cx + 6, 3, cz + 3, "barrel", { facing_direction: 1, open_bit: false }); chair(cx + 5, 3, cz + 2, 0, 1, "oak"); hang(cx + 5, 5, cz + 2, 0);
    for (const [x, z] of [[-3, -6], [3, -6], [-7, 2]]) put(cx + x, 4, cz + z, "amethyst_cluster", { "minecraft:block_face": "up" }, true);
  }
  // 4) the grotto: a stone-brick wall with ledges, hanging leaves, chains with lanterns, a small pond, barrels (picture 4)
  function grotto(cx, cz) {
    for (let x = -8; x <= 8; x++) for (let z = -6; z <= -3; z++) for (let y = 1; y <= 6; y++) {
      const back = z === -6, arch = Math.abs(x) <= 3 && y <= 4 && z > -6;
      if (arch) continue;
      if (back || y >= 5 || Math.abs(x) >= 6) put(cx + x, y, cz + z, y === 6 ? "stone_brick_slab" : (x + y + z) % 5 === 0 ? "cracked_stone_bricks" : (x * 3 + y) % 4 === 0 ? "mossy_stone_bricks" : "stone_bricks", y === 6 ? { "minecraft:vertical_half": "bottom" } : undefined);
    }
    for (let x = -8; x <= 8; x++) { put(cx + x, 5, cz - 2, "stone_brick_slab", { "minecraft:vertical_half": "top" }); if ((x + 20) % 3 !== 0) for (let y = 4; y >= 3 - ((x + 20) % 2); y--) put(cx + x, y, cz - 2, "oak_leaves", LEAF, true); for (let y = 7; y <= 7; y++) put(cx + x, y, cz - 5, "oak_leaves", LEAF); }
    for (const x of [-5, 5]) hang(cx + x, 4, cz - 1, 1);
    for (let x = -3; x <= 3; x++) for (let z = -5; z <= -1; z++) { if (z <= -4 && Math.abs(x) <= 2) { put(cx + x, 0, cz + z, (x + z) % 2 ? "grass_block" : "moss_block"); continue; } if (z >= -3) W(cx + x, cz + z); }
    put(cx - 1, 1, cz - 5, "rooted_dirt|dirt"); put(cx - 1, 2, cz - 5, "grass_block"); put(cx, 1, cz - 5, "grass_block"); put(cx + 1, 1, cz - 5, "flowering_azalea|azalea", undefined, true);
    for (const x of [-2, 2]) for (let y = 1; y <= 4; y++) put(cx + x, y, cz - 4, "vine", { vine_direction_bits: 4 }, true);
    for (let x = -6; x <= 6; x++) { put(cx + x, 0, cz, Math.abs(x) <= 3 ? "smooth_stone" : "stone_bricks"); if (Math.abs(x) >= 4) stair(cx + x, 1, cz, "stone_brick_stairs", 0, -1); }
    for (const [x, z] of [[-7, 1], [7, 1]]) { put(cx + x, 1, cz + z, "barrel", { facing_direction: 1, open_bit: false }); put(cx + x, 1, cz + z + 1, "spruce_slab", { "minecraft:vertical_half": "bottom" }); }
    for (const [x, z] of [[-2, 3], [2, 4], [0, 6], [-4, 5]]) put(cx + x, 0, cz + z, "cobblestone");
    for (const [x, z] of [[-6, -1], [6, -1], [-5, 2], [5, 3]]) put(cx + x, 1, cz + z, "fern", undefined, true);
  }
  // 5) the picnic island: a grass island in a water ring, log posts with lanterns, bamboo, a picnic blanket, benches, a bridge (picture 5)
  function picnic(cx, cz) {
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
      const d = Math.max(Math.abs(x), Math.abs(z)) + Math.sin(x * 0.8) * 0.4;
      if (d <= 6.5) { put(cx + x, 0, cz + z, "dirt"); put(cx + x, 1, cz + z, (x + z) % 7 === 0 ? "moss_block" : "grass_block"); }
      else if (d <= 8.5) { W(cx + x, cz + z); if ((x * 3 + z * 5 + 60) % 9 === 0) put(cx + x, 0, cz + z, "seagrass", { sea_grass_type: "default" }); }
      else if (d <= 10) { put(cx + x, 0, cz + z, "mossy_stone_bricks"); if ((x + z + 40) % 3 !== 0) put(cx + x, 1, cz + z, (x + z) % 2 ? "mossy_stone_bricks" : "stone_bricks"); if ((x * 5 + z + 60) % 7 === 0) put(cx + x, 2, cz + z, "mossy_cobblestone_wall|cobblestone_wall"); }
    }
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [-6, 0], [6, 0]]) { for (let y = 2; y <= 3; y++) put(cx + x, y, cz + z, "oak_log", { pillar_axis: "y" }); put(cx + x, 4, cz + z, "lantern", { hanging: false }, true); }
    for (const [x, z] of [[-5, -3], [5, 4], [-4, 5], [4, -5]]) for (let y = 2; y <= 5; y++) put(cx + x, y, cz + z, "bamboo|sugar_cane", undefined, true);
    for (let x = -2; x <= 2; x++) for (let z = -1; z <= 2; z++) put(cx + x, 2, cz + z, (x + z) % 2 ? "pink_carpet" : "white_carpet", undefined, true);
    chair(cx, 2, cz - 3, 0, 1, "spruce"); chair(cx - 1, 2, cz - 3, 0, 1, "spruce"); table(cx + 3, 2, cz - 2, "spruce"); pot(cx - 3, 2, cz + 3); put(cx + 3, 2, cz + 3, "cake", undefined, true);
    for (const [x, z] of [[-4, -2], [4, 2]]) { put(cx + x, 2, cz + z, "spruce_fence"); put(cx + x, 2, cz + z + 1, "spruce_fence"); }
    for (let z = 7; z <= 11; z++) for (let x = -1; x <= 1; x++) put(cx + x, 1, cz + z, (z % 2) ? "spruce_planks" : "spruce_slab", (z % 2) ? undefined : { "minecraft:vertical_half": "top" });
    for (const x of [-2, 2]) for (const z of [7, 11]) { put(cx + x, 1, cz + z, "oak_log", { pillar_axis: "y" }); put(cx + x, 2, cz + z, "lantern", { hanging: false }, true); }
    tree(cx + 1, cz + 1, 5, 3, "azalea_leaves", "oak_log", 2);
  }
  { const spots = [22, 68, 112, 158, 202, 248, 292, 338], kinds = [pondBridge, mediumPond, rockPond, grotto, picnic, mediumPond, pondBridge, picnic];
    spots.forEach((deg, i) => { const a = (deg * Math.PI) / 180, cx = Math.round(Math.cos(a) * 121), cz = Math.round(Math.sin(a) * 121); kinds[i](cx, cz); });
  }
  yield;

  // ================================================================ 10d. the NATURAL GROUND: gentle hills and dips, patches of moss / coarse dirt / podzol, rocks
  // (only on free grass, never on paths or buildings; the hills fade to flat 4 blocks before anything that was built)
  const H = new Map(), hk = (x, z) => x * 1000 + z;
  const heightAt = (x, z) => H.get(hk(x, z)) ?? 0;
  { const N = 135, dist = new Map();
    for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
      const r = Math.hypot(x, z); let blocked = r > 133 || (r > 79 && r < 100) || r < 22 || C.id(x, 0, z) !== null;
      if (!blocked) for (let y = 1; y <= 3; y++) if (C.has(x, y, z)) { blocked = true; break; }
      dist.set(hk(x, z), blocked ? 0 : 9);
    }
    for (let pass = 0; pass < 4; pass++) for (let x = -N + 1; x < N; x++) for (let z = -N + 1; z < N; z++) {
      const k = hk(x, z), v = dist.get(k); if (v === 0) continue;
      const m = Math.min(dist.get(hk(x + 1, z)), dist.get(hk(x - 1, z)), dist.get(hk(x, z + 1)), dist.get(hk(x, z - 1))) + 1;
      if (m < v) dist.set(k, m);
    }
    yield;
    for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
      const dd = dist.get(hk(x, z)); if (!dd) continue;
      const n = Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.7) + 0.5 * Math.sin((x + z) * 0.11) + 0.35 * Math.cos(x * 0.19 - z * 0.13);
      const h = Math.max(0, Math.min(3, Math.round((n + 0.35) * 1.7 * Math.min(1, (dd - 1) / 3))));
      const p2 = Math.sin(x * 0.23 + z * 0.17) + Math.cos(z * 0.21 - x * 0.09);
      const top = p2 > 1.35 ? "moss_block" : p2 < -1.45 ? "coarse_dirt" : p2 > 1.15 ? "podzol" : "grass_block";
      if (h > 0) { put(x, 0, z, "dirt"); for (let y = 1; y <= h; y++) put(x, y, z, y === h ? top : "dirt"); H.set(hk(x, z), h); }
      else if (top !== "grass_block") put(x, 0, z, top);
    }
    yield;
    for (let k = 0; k < 70; k++) {                                                                 // mossy boulders
      const x = Math.round((rng() - 0.5) * 260), z = Math.round((rng() - 0.5) * 260);
      if ((dist.get(hk(x, z)) ?? 0) < 4) continue;
      const y0 = heightAt(x, z) + 1, sz = 1 + Math.floor(rng() * 2);
      for (let dx = -sz; dx <= sz; dx++) for (let dz = -sz; dz <= sz; dz++) for (let dy = 0; dy <= sz; dy++) {
        if (Math.hypot(dx, dz, dy * 1.4) > sz + 0.4 || rng() < 0.15) continue;
        put(x + dx, y0 + dy - 1, z + dz, ["mossy_cobblestone", "andesite", "stone", "cobblestone", "tuff"][Math.floor(rng() * 5)]);
      }
    }
  }
  yield;

  // ================================================================ 11. the outer garden: big trees, bushes, flowers (between the ring and the edge, and inside the ring)
  const busy = (x, z) => {
    if (C.id(x, 0, z) !== null && !H.has(hk(x, z))) return true;                                // the trunk stands on grass (or a hill)
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 1 + heightAt(x + dx, z + dz); y <= 12; y++) if (C.has(x + dx, y, z + dz)) return true;
    return false;
  };
  let trees = 0;
  for (let k = 0; k < 2400 && trees < 140; k++) {
    const t3 = rng(), a = rng() * Math.PI * 2, r = t3 < 0.3 ? 95.5 + rng() * 2.5 : t3 < 0.55 ? 54 + rng() * 22 : 112 + rng() * 20, x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    if (Math.hypot(x, z) > 132 || (Math.hypot(x, z) > 97 && Math.hypot(x, z) < 112)) continue;
    if (Math.hypot(Math.abs(x) - 84, Math.abs(z) - 84) < 16 || (Math.abs(x) < 38 && z > 98)) continue;     // keep the lanterns + the Nether gate free
    if ([22, 68, 112, 158, 202, 248, 292, 338].some((deg) => Math.hypot(x - Math.cos((deg * Math.PI) / 180) * 121, z - Math.sin((deg * Math.PI) / 180) * 121) < 17)) continue;   // and the garden pieces
    if (r < 80 && (Math.abs(x) <= 8 || Math.abs(z) <= 8)) continue;
    if (busy(x, z)) continue;
    tree(x, z, 6 + Math.floor(rng() * 4), 4 + Math.floor(rng() * 2), rng() < 0.2 ? "azalea_leaves" : rng() < 0.15 ? "cherry_leaves" : "oak_leaves", rng() < 0.15 ? "cherry_log" : rng() < 0.4 ? "dark_oak_log" : "oak_log", 1 + heightAt(x, z));
    trees++;
  }
  for (let k = 0; k < 3200; k++) {                                                                  // bushes + flowers + grass on the free ground
    const x = Math.round((rng() - 0.5) * 266), z = Math.round((rng() - 0.5) * 266), r = Math.hypot(x, z);
    const gy = heightAt(x, z), y1 = gy + 1;
    if (r > 133 || (r > 79 && r < 95) || C.has(x, y1, z) || (gy === 0 && (C.id(x, 0, z) ?? "grass_block") !== "grass_block") || (gy > 0 && C.id(x, gy, z) !== "grass_block")) continue;
    const t = rng();
    if (t < 0.12) { put(x, y1, z, "azalea_leaves", LEAF); if (rng() < 0.5) put(x, y1 + 1, z, "azalea_leaves_flowered|azalea_leaves", LEAF); }
    else if (t < 0.55) put(x, y1, z, flowers[Math.floor(rng() * flowers.length)], undefined, true);
    else put(x, y1, z, rng() < 0.5 ? "short_grass|tallgrass" : "fern", undefined, true);
  }
  yield;

  // ================================================================ 12. light everywhere (invisible light blocks: no mobs)
  for (let x = -133; x <= 133; x += 7) for (let z = -133; z <= 133; z += 7) {
    if (Math.hypot(x, z) > 134) continue;
    let y = 1; while (y < 30 && C.has(x, y, z)) y++;
    if (y < 30) light(x, y, z);
  }
  for (let x = -18; x <= 18; x += 6) for (let z = -68; z <= -33; z += 6) light(x, 3, z);                 // inside the cathedral
  for (let x = 38; x <= 60; x += 5) for (let z = 32; z <= 48; z += 5) light(x, 3, z);                     // the house
  return C;
}
export function celestialSpawn() { const g = celestialGen(); let r; while (!(r = g.next()).done); return r.value; }
