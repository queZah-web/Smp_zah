// =====================================================================================================================
// AFK HALL DESIGN (pure data: no game calls)  -  "The Crimson Hall"   45 x 46 blocks, 35 high
//   * a white floor with a red diamond pattern and a glowing crest in the middle, a red carpet from the door
//   * 4 rows of stone steps all around (seats), corner planters
//   * light-grey walls with tall pillars (red / white medallions), red & white banners between them, a red ribbon
//   * big red / purple crystals coming out of the 4 corners
//   * a GLASS dome on stone ribs with a red line (cloister vault), a big chandelier + 4 small ones
//   * outside: buttresses, a framed door with lamps; invisible light blocks inside (no mobs)
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const AFKHALL = { R: 22, FRONT: 25, UP: 44, DOWN: 4, IN: 18, TOP: 33, spot: { x: 0, y: 1, z: 4 } };

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const CHAIN = "iron_chain|chain";
const W = "white_concrete", RED = "red_concrete", G1 = "polished_andesite", G2 = "stone_bricks", G3 = "smooth_stone", G4 = "light_gray_concrete";
const PILLARS = [-16, -8, 0, 8, 16];

export function* afkHallGen() {
  const C = new Canvas(), rng = rngOf(1033);
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const lamp = (x, y, z, hanging) => put(x, y, z, "lantern", { hanging: !!hanging }, true);
  const m = (x, z) => Math.max(Math.abs(x), Math.abs(z));
  const door = (x, z) => z > 0 && Math.abs(x) <= 2;                          // the way in (south)
  // local wall frame: k = side (0 +x, 1 +z, 2 -x, 3 -z), a = distance out, b = along the wall
  const turn = (k, a, b) => { let x = a, z = b; for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; };

  // ------------------------------------------------------------ floor
  for (let x = -22; x <= 22; x++) for (let z = -22; z <= 25; z++) {
    const mm = m(x, z); if (mm > 22 && !(z > 22 && Math.abs(x) <= 6)) continue;
    let b = G1;
    if (mm <= 14) {
      const ax = Math.abs(x), az = Math.abs(z), s = ax + az;
      if (mm <= 3) b = mm === 0 ? "sea_lantern" : (s === 3 || (mm === 3 && (ax === 0 || az === 0))) ? RED : mm === 1 ? RED : W;
      else if (s % 6 === 0 || (ax % 6 === 3 && az % 6 === 3)) b = RED;
      else if (Math.abs(ax - az) % 6 === 0 && s % 2 === 0) b = RED;
      else if (mm === 14) b = RED;
      else b = W;
    } else if (mm <= 18) b = G2;
    put(x, 0, z, b);
  }
  // red carpet from the door to the crest
  for (let z = 4; z <= 21; z++) for (let x = -1; x <= 1; x++) put(x, 1, z, "red_carpet", undefined, true);
  yield;

  // ------------------------------------------------------------ steps (seats) all around: 4 rows
  for (let x = -18; x <= 18; x++) for (let z = -18; z <= 18; z++) {
    const mm = m(x, z); if (mm < 15 || mm > 18 || door(x, z)) continue;
    const row = mm - 15;                                                      // 0 .. 3
    for (let y = 1; y <= row; y++) put(x, y, z, G2);
    const corner = Math.abs(x) === Math.abs(z);
    if (corner) put(x, row + 1, z, G1);
    else put(x, row + 1, z, "stone_brick_stairs", { weirdo_direction: dirOf(Math.abs(x) > Math.abs(z) ? x : 0, Math.abs(z) > Math.abs(x) ? z : 0), upside_down_bit: false });
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {                 // corner planters on the floor
    for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1]]) { const x = sx * (14 + ox), z = sz * (14 + oz); put(x, 1, z, "moss_block"); put(x, 2, z, ox || oz ? "azalea" : "flowering_azalea", undefined, true); }
  }
  yield;

  // ------------------------------------------------------------ walls, pillars, medallions, banners, ribbon
  for (let x = -21; x <= 21; x++) for (let z = -21; z <= 21; z++) {
    const mm = m(x, z); if (mm < 19) continue;
    for (let y = 1; y <= 21; y++) {
      if (door(x, z) && y <= 8 && !(y === 8 && Math.abs(x) === 2)) continue;
      put(x, y, z, y === 19 ? RED : y === 20 ? W : y === 21 ? G1 : (y === 1 ? G1 : mm === 19 ? G4 : G2));
    }
  }
  const medallion = (k, b, y) => {                                                 // 3 x 3 on the inner face of a pillar (a = 18)
    const cells = [[-1, 1, G1], [0, 1, RED], [1, 1, G1], [-1, 0, RED], [0, 0, (y % 2 ? W : "red_stained_glass")], [1, 0, RED], [-1, -1, G1], [0, -1, RED], [1, -1, G1]];
    for (const [db, dy, id] of cells) { const [x, z] = turn(k, 17, b + db); put(x, y + dy, z, id); }
  };
  const skullPanel = (k, b, y) => {                                                 // white panel with a red eye (like the picture)
    for (let db = -1; db <= 1; db++) for (let dy = -1; dy <= 1; dy++) { const [x, z] = turn(k, 17, b + db); put(x, y + dy, z, db === 0 && dy === 0 ? RED : W); }
  };
  for (let k = 0; k < 4; k++) for (const b of PILLARS) {
    if (k === 1 && b === 0) continue;                                              // the door
    for (let db = -1; db <= 1; db++) {
      const [x, z] = turn(k, 18, b + db);
      for (let y = 1; y <= 20; y++) put(x, y, z, db === 0 ? (y % 4 === 0 ? "chiseled_stone_bricks" : G1) : G2);
      const [ox, oz] = turn(k, 17, b + db); put(ox, 1, oz, G2); put(ox, 2, oz, db === 0 ? "chiseled_stone_bricks" : "stone_brick_slab", db === 0 ? undefined : { "minecraft:vertical_half": "bottom" });
    }
    medallion(k, b, 6); skullPanel(k, b, 11); medallion(k, b, 16);
    { const [x, z] = turn(k, 17, b); put(x, 20, z, "chiseled_stone_bricks"); lamp(x, 19, z, true); }
  }
  // banners between the pillars (5 wide, 13 high): candy stripes and stacked diamonds
  for (let k = 0; k < 4; k++) for (const b0 of [-12, -4, 4, 12]) {
    for (let u = -2; u <= 2; u++) for (let v = 0; v <= 12; v++) {
      const [x, z] = turn(k, 19, b0 + u), y = 6 + v;
      let id;
      if (Math.abs(b0) === 12) id = Math.floor((u + 2 + v * 0.9 + Math.sin(v / 2) * 1.2) / 2.2) % 2 ? W : RED;   // curved stripes
      else { const cv = (v % 6) - 2.5, d = Math.abs(u) + Math.abs(cv) * 0.9; id = d <= 2.1 ? RED : W; }           // diamonds
      if (Math.abs(u) === 2 && Math.abs(b0) !== 12 && (v === 0 || v === 12)) id = G1;
      put(x, y, z, id);
    }
    const [tx, tz] = turn(k, 18, b0); put(tx, 19, tz, G1);                       // a small bar above every banner
  }
  yield;

  // ------------------------------------------------------------ crystals in the 4 corners
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const SH = [[0.55, 0.75, 7, 2], [0.75, 0.35, 6, 1.6], [0.35, 0.45, 5.5, 1.5], [0.9, 0.9, 4.5, 1.2]];      // direction (in, up), length, thickness
    SH.forEach(([inw, up, len, th], i) => {
      const bx = sx * 18, bz = sz * 18, by = 9 + i * 2;
      const dx = -sx * inw * (i % 2 ? 0.8 : 1), dz = -sz * inw * (i % 2 ? 1 : 0.8), dy = up, L = Math.hypot(dx, dy, dz);
      for (let t = 0; t <= len; t += 0.4) {
        const cx = bx + (dx / L) * t, cy = by + (dy / L) * t, cz = bz + (dz / L) * t, r = th * (1 - (t / len) * 0.7);
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
          if (Math.hypot(x - cx, y - cy, z - cz) > r || m(x, z) > 18) continue;
          put(x, y, z, (i + Math.floor(t)) % 3 === 0 ? "purple_stained_glass" : (rng() < 0.15 ? "magenta_stained_glass" : "red_stained_glass"));
        }
      }
    });
    put(sx * 17, 8, sz * 17, "amethyst_block"); put(sx * 17, 7, sz * 17, "amethyst_cluster", { "minecraft:block_face": "down" }, true);
  }
  yield;

  // ------------------------------------------------------------ the dome (glass on ribs) - cloister vault
  const roof = (x, z) => { const t = Math.min(1, Math.hypot(x, z) / 21.5 * 0.55 + m(x, z) / 20.6 * 0.45); return 21 + Math.round(17 * Math.sqrt(Math.max(0, 1 - t * t))); };
  const ribOf = (x, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    if (m(x, z) >= 19) return G1;                                            // the ring on the walls
    for (const p of [8]) { if (ax === p || az === p) return RED; if (Math.abs(ax - p) === 1 || Math.abs(az - p) === 1) return G1; }
    if (ax === az) return RED;
    return null;
  };
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) {
    const top = roof(x, z);
    let low = top; for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = m(x + ox, z + oz) > 20 ? 21 : roof(x + ox, z + oz); low = Math.min(low, n + 1); }
    const rib = ribOf(x, z);
    for (let y = Math.max(22, Math.min(low, top)); y <= top; y++) put(x, y, z, m(x, z) <= 1 ? "chiseled_stone_bricks" : rib ?? "glass");
  }
  // chandeliers: a big one in the middle, 4 small ones
  for (let y = 25; y <= 37; y++) put(0, y, 0, CHAIN, { pillar_axis: "y" }, true);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (m(x, z) === 2) put(x, 24, z, (x + z) % 2 ? G1 : RED);
  put(0, 24, 0, "sea_lantern");
  for (const [x, z] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) lamp(x, 23, z, true);
  for (const [x, z] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { put(x, 24, z, CHAIN, { pillar_axis: "x" }, true); }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * 9, z = sz * 9, top = roof(x, z) - 1;
    for (let y = 26; y <= top; y++) put(x, y, z, CHAIN, { pillar_axis: "y" }, true);
    put(x, 25, z, "sea_lantern"); lamp(x + sx, 25, z, false); lamp(x, 25, z + sz, false); lamp(x, 24, z, true);
  }
  yield;

  // ------------------------------------------------------------ outside: buttresses, door frame, lamps
  for (let k = 0; k < 4; k++) for (const b of PILLARS) {
    if (k === 1 && b === 0) continue;
    for (const db of [-1, 0, 1]) { const [x, z] = turn(k, 22, b + db); for (let y = 1; y <= 18; y++) put(x, y, z, db === 0 && y % 6 === 0 ? RED : G2); put(x, 19, z, "stone_brick_slab", { "minecraft:vertical_half": "bottom" }); }
  }
  for (let y = 1; y <= 10; y++) for (const x of [-3, 3]) for (const z of [21, 22]) put(x, y, z, y % 3 === 0 ? RED : y === 10 ? "chiseled_stone_bricks" : W);
  for (let x = -3; x <= 3; x++) { put(x, 9, 22, Math.abs(x) <= 1 ? RED : W); put(x, 10, 22, "chiseled_stone_bricks"); put(x, 11, 22, "stone_brick_slab", { "minecraft:vertical_half": "bottom" }); }
  for (const x of [-5, 5]) { put(x, 1, 24, "chiseled_stone_bricks"); put(x, 2, 24, G1); put(x, 3, 24, G1); put(x, 4, 24, "chiseled_stone_bricks"); lamp(x, 5, 24, false); }
  for (let z = 22; z <= 25; z++) for (let x = -1; x <= 1; x++) put(x, 1, z, "red_carpet", undefined, true);

  // ------------------------------------------------------------ invisible lights (no mobs inside)
  for (let x = -16; x <= 16; x += 4) for (let z = -16; z <= 16; z += 4) {
    for (let y = 1; y <= 5; y++) if (!C.has(x, y, z)) { if (C.has(x, y - 1, z)) put(x, y, z, "light_block_14", undefined, true); break; }
  }
  return C;
}
export function afkHallDesign() { const g = afkHallGen(); let r; while (!(r = g.next()).done); return r.value; }
