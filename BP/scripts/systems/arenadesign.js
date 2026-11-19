// =====================================================================================================================
// ARENA DESIGN - a round colosseum (pure data, no game calls: can be tested / previewed outside the game)
//
//   ~89 x 89 blocks, ~38 high.  From the outside in:
//     * a white plaza with lamp posts, a monumental SKULL GATE with a dark crown (horns + cross) and wide stairs
//     * the outer wall: 3 tiers of arches (pillars, white cornices, glowing windows), 2 domed turrets on the rim
//     * the CONCOURSE under the stands (a huge furnished hall, 4 to 14 high):
//         south = grand lobby (carpet, chandeliers, warrior statues)      east = armory (anvils, smithing, grindstones, racks)
//         west  = rest hall (benches, tables with candles, brewing, cauldrons, books)    north = hall of champions (trophies)
//         + 8 staircases up to the stands, columns, hanging lanterns everywhere
//     * the STANDS: 11 rows of seats around the pit, aisles, iron-bar railing, a royal box above the main gate
//     * the PIT (r < 17.5): patterned floor with a glowing crest, 4 cover pillars, 4 gates from the concourse
//   style "valor": teal prismarine + white quartz + dark-red crown (Keep Inventory arena)
//   style "blood": red nether bricks + blackstone + bone (No Keep arena)
// =====================================================================================================================
import { Canvas } from "./spawndesign.js";

export const ARENA = { R: 44, UP: 44, DOWN: 4, PIT: 17.4, BUILD_MAX: 5, lobby: { x: 0, y: 1, z: 25 }, view: { x: 0, y: 16, z: 25 } };

const STYLES = {
  valor: {
    main: "prismarine_bricks", dark: "dark_prismarine", white: "smooth_quartz", white2: "quartz_block", chis: "chiseled_quartz_block", pillar: "quartz_pillar",
    bone: "bone_block", red: "red_nether_brick", crown: "nether_wart_block", crown2: "red_nether_brick", light: "sea_lantern", lamp: "soul_lantern",
    glass: "cyan_stained_glass", seat: "quartz_stairs", aisle: "prismarine_bricks_stairs|prismarine_brick_stairs|quartz_stairs", slab: "smooth_quartz_slab",
    carpet: "red_carpet", carpet2: "cyan_carpet", f1: "polished_diorite", f2: "dark_prismarine", pit1: "smooth_quartz", pit2: "prismarine_bricks", pit3: "dark_prismarine",
    glow: "verdant_froglight", wool: "red_wool",
  },
  blood: {
    main: "red_nether_brick", dark: "polished_blackstone_bricks", white: "bone_block", white2: "smooth_quartz", chis: "chiseled_polished_blackstone", pillar: "bone_block",
    bone: "bone_block", red: "red_nether_brick", crown: "blackstone", crown2: "polished_blackstone_bricks", light: "shroomlight", lamp: "lantern",
    glass: "red_stained_glass", seat: "blackstone_stairs", aisle: "red_nether_brick_stairs|blackstone_stairs", slab: "polished_blackstone_brick_slab",
    carpet: "red_carpet", carpet2: "black_carpet", f1: "polished_blackstone", f2: "red_nether_brick", pit1: "polished_blackstone", pit2: "red_nether_brick", pit3: "blackstone",
    glow: "ochre_froglight", wool: "black_wool",
  },
};

// the skull gate (front face), 21 wide, top row first.  K crown, W bone/white, R red, L light, T teal/dark, Q white pillar, D dark recess, G gate (air), X cross
const FACADE = [
  "..........X..........",
  ".........XXX.........",
  "..K.......X.......K..",
  "..K.......X.......K..",
  ".KK..K....K....K..KK.",
  ".K...KK..KKK..KK...K.",
  ".KK..KKKKKKKKKKK..KK.",
  "..KKKKKKKKKKKKKKKKK..",
  "...KKKKKKKKKKKKKKK...",
  "....WWWWWWWWWWWWW....",
  "...WWWWWWWWWWWWWWW...",
  "..WWWWWWWWWWWWWWWWW..",
  "..WWRRRWWWWWWWRRRWW..",
  "..WRRRRRWWWWWRRRRRW..",
  ".WWRRLRRWWWWWRRLRRWW.",
  ".WWRRRRRWWWWWRRRRRWW.",
  ".WWWRRRWWWTWWWRRRWWW.",
  ".WWWWWWWWTTTWWWWWWWW.",
  "..WWWWWWWLTLWWWWWWW..",
  "..WWWWWWWWWWWWWWWWW..",
  "...WDWDWDWDWDWDWDW...",
  "..QQWWWWWWWWWWWWWQQ..",
  "..QTWWWWWWWWWWWWWTQ..",
  "..QTWWWRRRRRRRWWWTQ..",
  "..QTWWRRDDDDDRRWWTQ..",
  "..QTWRRDDDDDDDRRWTQ..",
  "..QTWRDDGGGGGDDRWTQ..",
  "..QTWRDGGGGGGGDRWTQ..",
  "..QTLRDGGGGGGGDRLTQ..",
  "..QTWRDGGGGGGGDRWTQ..",
  "..QTWRDGGGGGGGDRWTQ..",
  "..QTWRDGGGGGGGDRWTQ..",
  "..QTLRDGGGGGGGDRLTQ..",
  "..QTWRDGGGGGGGDRWTQ..",
  ".QQTWRDGGGGGGGDRWTQQ.",
  "QQQTWRDGGGGGGGDRWTQQQ",
].map((r) => r.padEnd(21, ".").slice(0, 21));

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const rnd = (v) => Math.sign(v) * Math.round(Math.abs(v));
const deg = (x, z) => ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360;
const LEAF = { persistent_bit: true };
const CHAIN = "waxed_oxidized_copper_chain|iron_chain|chain";
/** height of the seat row at radius r (stands from r 19.5 to 30.5) */
export const standH = (r) => 5 + Math.floor(r - 19.5);

export function* arenaGen(style = "valor") {
  const S = STYLES[style] ?? STYLES.valor, C = new Canvas(), rng = rngOf(style === "valor" ? 4242 : 6161);
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const lamp = (x, y, z, hanging) => put(x, y, z, S.lamp, { hanging: !!hanging }, true);
  const hangLamp = (x, top, z, len) => { for (let i = 0; i < len; i++) put(x, top - i, z, CHAIN, { pillar_axis: "y" }, true); lamp(x, top - len, z, true); };

  // ------------------------------------------------------------ ground: plaza (outside), concourse floor, pit floor
  for (let x = -42; x <= 42; x++) for (let z = -42; z <= 46; z++) {
    const r = Math.hypot(x, z), a = deg(x, z);
    if (r > 41.5 && !(Math.abs(x) <= 10 && z > 0 && z <= 46)) continue;
    let b;
    if (r < 17.5) {                                                       // the pit
      const ring = Math.floor(r);
      if (r < 3.5) b = (Math.abs(x) + Math.abs(z)) % 2 ? S.glow : S.pit3;
      else if (ring === 6 || ring === 12) b = S.pit3;
      else if (ring === 9 && Math.round(a) % 30 < 4) b = S.light;
      else if (ring === 15) b = S.pit2;
      else b = ((Math.floor(a / 22.5) + (ring > 9 ? 1 : 0)) % 2) ? S.pit1 : S.pit2;
    } else if (r < 30.5) b = Math.abs(r - 25) < 0.6 ? S.dark : (Math.abs(x) + Math.abs(z)) % 2 ? S.f1 : S.white;       // concourse
    else if (r < 34.5) b = S.dark;
    else b = Math.abs(r - 38) < 0.5 ? S.dark : (Math.abs(x) + Math.abs(z)) % 2 ? S.white : S.white2;                   // plaza
    put(x, 0, z, b);
  }
  yield;

  // ------------------------------------------------------------ pit: wall, bars, gates, cover pillars
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) {
    const r = Math.hypot(x, z); if (r < 17.5 || r >= 19.5) continue;
    const gate = Math.min(Math.abs(x), Math.abs(z)) <= 1 && Math.max(Math.abs(x), Math.abs(z)) >= 17;
    for (let y = 1; y <= 5; y++) {
      if (gate && y <= 3) continue;
      put(x, y, z, y === 5 ? S.white : y === 1 ? S.dark : S.main);
    }
    if (gate) put(x, 4, z, S.chis);
    if (r >= 18.5) for (let y = 6; y <= 8; y++) put(x, y, z, "iron_bars");
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {                 // cover pillars
    const cx = rnd(7.8 * sx), cz = rnd(7.8 * sz);
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) for (let y = 1; y <= 4; y++) put(cx + dx * sx, y, cz + dz * sz, y === 4 ? S.chis : y === 1 ? S.dark : S.main);
    lamp(cx, 5, cz, false);
  }
  for (const [x, z] of [[0, 17], [0, -17], [17, 0], [-17, 0]]) {                  // lights above the gates (inside the pit)
    const ox = Math.sign(x), oz = Math.sign(z);
    put(x - ox, 0, z - oz, S.light);
  }
  yield;

  // ------------------------------------------------------------ stands (seats, aisles, light) - the space under them is the concourse
  for (let x = -31; x <= 31; x++) for (let z = -31; z <= 31; z++) {
    const r = Math.hypot(x, z); if (r < 19.5 || r >= 30.5) continue;
    const h = standH(r), a = deg(x, z);
    const aisle = Math.round(a) % 30 < 3;
    put(x, h - 1, z, S.dark);
    if (aisle) put(x, h, z, S.aisle, { weirdo_direction: dirOf(x, z), upside_down_bit: false });
    else put(x, h, z, S.seat, { weirdo_direction: dirOf(x, z), upside_down_bit: false });
    if ((x + z) % 7 === 0 && !aisle) put(x, h - 1, z, S.light);                 // lights under the seats (seen from the concourse)
  }
  yield;

  // ------------------------------------------------------------ outer wall: 3 tiers of arches
  const N = 44;                                                                    // segments around
  for (let x = -35; x <= 35; x++) for (let z = -35; z <= 35; z++) {
    const r = Math.hypot(x, z); if (r < 30.5 || r >= 34.5) continue;
    const a = deg(x, z), segF = (a / 360) * N, u = (segF - Math.floor(segF)) * ((2 * Math.PI * 34) / N);   // u = blocks along the arc inside a segment (0 .. 4.85)
    const pil = u < 1.6, mid = Math.abs(u - 3.2);
    const skin = r >= 33.5, inner = r < 31.5;
    for (let y = 1; y <= 27; y++) {
      const tier = y <= 9 ? 0 : y <= 17 ? 1 : 2, base = [0, 9, 17][tier], top = [8, 16, 23][tier];
      const cornice = y === 9 || y === 17 || y === 24 || y === 27;
      if (cornice) { put(x, y, z, cornice && y === 27 ? S.chis : S.white); continue; }
      if (y > 24) { put(x, y, z, S.main); continue; }
      const archTop = top - Math.round(mid * mid * 0.45);
      const open = !pil && y > base && y <= archTop;
      if (skin) put(x, y, z, open ? (tier === 0 ? null : S.glass) : pil ? (y === base + 1 ? S.chis : S.pillar) : y === archTop + 1 ? S.chis : S.main, pil && !(y === base + 1) ? { pillar_axis: "y" } : undefined);
      else if (inner) put(x, y, z, y <= standH(30.4) ? S.dark : open && tier > 0 ? S.glass : S.main);
      else put(x, y, z, open && tier === 0 ? (y === base + 1 ? S.dark : null) : open ? S.dark : S.main);
      if (C.id(x, y, z) === null) C.del(x, y, z);
    }
    if (skin && pil) put(x, 28, z, Math.round(a) % 16 < 8 ? S.white : S.slab, Math.round(a) % 16 < 8 ? undefined : { "minecraft:vertical_half": "bottom" });
    if (skin && !pil && Math.abs(u - 3.2) < 0.5) { lamp(x, 7, z, true); }       // lantern in every ground arch
    if (r >= 34.5 - 1 && r < 34.5 && !pil && Math.abs(u - 3.2) < 0.5) put(x, 12, z, S.light);
  }
  // cornices stick out
  for (let x = -36; x <= 36; x++) for (let z = -36; z <= 36; z++) {
    const r = Math.hypot(x, z); if (r < 34.5 || r >= 35.5) continue;
    for (const y of [9, 17, 24]) put(x, y, z, S.slab, { "minecraft:vertical_half": "top" });
  }
  // 2 domed turrets on the rim
  for (const ang of [62, 118, 242, 298]) {
    const a = (ang * Math.PI) / 180, tx = rnd(Math.cos(a) * 32.5), tz = rnd(Math.sin(a) * 32.5);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const d = Math.hypot(dx, dz); if (d > 2.5) continue;
      for (let y = 28; y <= 32; y++) put(tx + dx, y, tz + dz, d > 1.6 ? (y === 30 && (dx === 0 || dz === 0) ? S.glass : S.white) : null);
      for (let y = 28; y <= 32; y++) if (C.id(tx + dx, y, tz + dz) === null) C.del(tx + dx, y, tz + dz);
      put(tx + dx, 33, tz + dz, "waxed_oxidized_cut_copper");
      if (d <= 1.6) put(tx + dx, 34, tz + dz, "waxed_oxidized_cut_copper");
    }
    put(tx, 35, tz, "waxed_oxidized_copper"); put(tx, 36, tz, "end_rod", { facing_direction: 1 }, true);
    put(tx, 28, tz, S.light);
  }
  yield;

  // ------------------------------------------------------------ gates through the outer wall (N, E, W small; S = the skull gate)
  const tunnel = (k, len0, len1, half, h, floorId) => {
    for (let a = len0; a <= len1; a++) for (let b = -half; b <= half; b++) {
      const [x, z] = turnK(k, a, b);
      for (let y = 1; y <= h; y++) { if (y === h && Math.abs(b) === half) continue; C.del(x, y, z); }
      put(x, 0, z, Math.abs(b) === half ? S.dark : floorId);
    }
  };
  for (const k of [0, 2, 3]) {
    tunnel(k, 30, 35, 2, 6, S.carpet === "red_carpet" ? S.white : S.white);
    for (const s of [-3, 3]) { const [x, z] = turnK(k, 35, s); for (let y = 1; y <= 7; y++) put(x, y, z, y === 7 ? S.chis : S.pillar, y === 7 ? undefined : { pillar_axis: "y" }); }
    { const [x, z] = turnK(k, 35, 0); put(x, 7, z, S.chis); lamp(x, 6, z, true); }
    { const [x, z] = turnK(k, 32, 0); lamp(x, 5, z, true); }
  }
  yield;

  // ------------------------------------------------------------ the SKULL GATE (south, +z)
  {
    const front = 40, H = FACADE.length;
    const mat = (ch) => ({ K: S.crown, W: S.bone, R: S.red, L: S.light, T: S.dark, Q: S.pillar, D: S.crown2, X: S.crown, G: null }[ch]);
    for (let row = 0; row < H; row++) for (let i = 0; i < 21; i++) {
      const ch = FACADE[row][i]; if (ch === ".") continue;
      const x = i - 10, y = H - row;
      const m = mat(ch);
      for (let z = 35; z <= front; z++) {
        if (ch === "G") { C.del(x, y, z); continue; }
        if (y > 27 && z < front - 1) continue;                                   // the crown is only 2 thick
        if (ch !== "L" && z < front - 1 && y <= 27) { put(x, y, z, S.dark); continue; }
        put(x, y, z, m, ch === "Q" || ch === "W" ? (S.bone === "bone_block" || ch === "Q" ? { pillar_axis: "y" } : undefined) : undefined);
      }
    }
    // gate tunnel to the concourse (7 wide, 9 high, rounded) + carpet + lanterns
    for (let z = 30; z <= front; z++) for (let x = -3; x <= 3; x++) {
      const h = Math.abs(x) === 3 ? 7 : Math.abs(x) === 2 ? 8 : 9;
      for (let y = 1; y <= h; y++) C.del(x, y, z);
      put(x, 0, z, Math.abs(x) <= 1 ? S.carpet === "red_carpet" ? S.f2 : S.f2 : S.white);
      if (Math.abs(x) <= 1) put(x, 1, z, S.carpet, undefined, true);
    }
    for (const z of [32, 36, 39]) hangLamp(0, 8, z, 1);
    for (let z = 41; z <= 46; z++) for (let x = -9; x <= 9; x++) {                 // wide stairs in front (going down, outward)
      put(x, 0, z, (Math.abs(x) <= 1) ? S.f2 : S.white2);
      if (Math.abs(x) <= 1 && z <= 44) put(x, 1, z, S.carpet, undefined, true);
    }
    for (const x of [-9, 9]) for (const z of [42, 45]) { put(x, 1, z, S.chis); put(x, 2, z, S.pillar, { pillar_axis: "y" }); put(x, 3, z, S.pillar, { pillar_axis: "y" }); put(x, 4, z, S.chis); lamp(x, 5, z, false); }
  }
  yield;

  // ------------------------------------------------------------ plaza: lamp posts around the arena
  for (let k = 0; k < 24; k++) {
    const ang = k * 15; if (ang > 70 && ang < 110) continue;
    const a = (ang * Math.PI) / 180, x = rnd(Math.cos(a) * 38), z = rnd(Math.sin(a) * 38);
    put(x, 1, z, S.chis); put(x, 2, z, S.pillar, { pillar_axis: "y" }); put(x, 3, z, S.pillar, { pillar_axis: "y" }); put(x, 4, z, S.chis); lamp(x, 5, z, false);
  }
  yield;

  // ------------------------------------------------------------ CONCOURSE: columns, hanging lanterns, staircases to the stands
  for (let k = 0; k < 24; k++) {
    const ang = k * 15 + 7.5, a = (ang * Math.PI) / 180;
    for (const rr of [22.2, 27.6]) {
      const x = rnd(Math.cos(a) * rr), z = rnd(Math.sin(a) * rr), r = Math.hypot(x, z), top = standH(r) - 2;
      if (Math.min(Math.abs(x), Math.abs(z)) <= 3) continue;                                // keep the gate ways free
      for (let y = 1; y <= top; y++) put(x, y, z, y === 1 ? S.chis : y === top ? S.chis : S.pillar, y === 1 || y === top ? undefined : { pillar_axis: "y" });
      if (rr > 25) { const ix = rnd(Math.cos(a) * (rr - 1)), iz = rnd(Math.sin(a) * (rr - 1)); if (top >= 6) put(ix, Math.floor(top / 2) + 1, iz, S.light); }
    }
    const lx = rnd(Math.cos(((ang + 7.5) * Math.PI) / 180) * 25), lz = rnd(Math.sin(((ang + 7.5) * Math.PI) / 180) * 25);
    const ceil = standH(Math.hypot(lx, lz)) - 2;
    if (Math.min(Math.abs(lx), Math.abs(lz)) > 3 && ceil >= 6) hangLamp(lx, ceil, lz, Math.min(3, ceil - 5));
  }
  // staircases: 8 straight flights (2 at each side of every gate way), rising INWARD to the seats
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    for (let a = 30; a >= 19; a--) {
      for (const b of [6 * s, 7 * s]) {
        const [x, z] = turnK(k, a, b), r = Math.hypot(x, z), y = 30 - a + 1, seat = standH(r);
        if (y > seat + 1 || r < 19.5) break;
        for (let yy = 1; yy < y; yy++) put(x, yy, z, S.dark);
        const [ix, iz] = turnK(k, a - 1, b);
        put(x, y, z, S.aisle, { weirdo_direction: dirOf(ix - x, iz - z), upside_down_bit: false });
        for (let yy = y + 1; yy <= y + 3; yy++) { if (yy >= seat - 1) C.del(x, yy, z); }       // head room through the stands
      }
    }
    const [lx, lz] = turnK(k, 29, 8 * s); lamp(lx, 1, lz, false);
  }
  yield;

  // ------------------------------------------------------------ the 4 halls of the concourse
  const hallAt = (ang, rr) => { const a = (ang * Math.PI) / 180; return [rnd(Math.cos(a) * rr), rnd(Math.sin(a) * rr)]; };
  const free = (x, y, z) => !C.has(x, y, z);
  const inward = (x, z) => dirOf(-x, -z);
  // SOUTH: grand lobby - carpet to the pit gate, statues, chandeliers
  for (let z = 19; z <= 30; z++) for (let x = -1; x <= 1; x++) put(x, 1, z, S.carpet, undefined, true);
  for (const sx of [-5, 5]) {                                                        // warrior statues
    const x = sx, z = 25;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(x + dx, 1, z + dz, S.dark);
    put(x, 2, z, S.white2); put(x, 3, z, S.white2); put(x, 4, z, S.bone, { pillar_axis: "y" }); put(x, 5, z, S.bone, { pillar_axis: "y" }); put(x, 6, z, S.chis);
    put(x - 1, 4, z, S.bone, { pillar_axis: "x" }); put(x + 1, 4, z, S.bone, { pillar_axis: "x" });
    put(x + Math.sign(sx) * -1, 5, z - 1, "iron_bars"); put(x + Math.sign(sx) * -1, 6, z - 1, "iron_bars"); put(x + Math.sign(sx) * -1, 7, z - 1, S.chis);
  }
  for (const z of [22, 27]) hangLamp(0, standH(Math.hypot(0, z)) - 2, z, 2);
  // EAST: the armory (against the outer wall + racks)
  for (let ang = -38; ang <= 38; ang += 4) {
    if (Math.abs(ang) < 8) continue;
    const [x, z] = hallAt(ang, 29.5); if (!free(x, 1, z)) continue;
    const q = Math.abs(ang / 4) % 5;
    if (q === 0) put(x, 1, z, "anvil", { "minecraft:cardinal_direction": "north" });
    else if (q === 1) put(x, 1, z, "smithing_table");
    else if (q === 2) put(x, 1, z, "grindstone", { attachment: "standing" });
    else if (q === 3) { put(x, 1, z, "barrel", { facing_direction: 1 }); put(x, 2, z, "barrel", { facing_direction: 1 }); }
    else { put(x, 1, z, "iron_bars"); put(x, 2, z, "iron_bars"); put(x, 3, z, CHAIN, { pillar_axis: "y" }, true); }
    const [ux, uz] = hallAt(ang, 29.5); if (free(ux, 4, uz) && q !== 4) lamp(ux, 4, uz, false);
  }
  for (let ang = -30; ang <= 30; ang += 12) {                                       // weapon racks in the middle of the hall
    if (Math.abs(ang) < 8) continue;
    const [x, z] = hallAt(ang, 25.5);
    for (let y = 1; y <= 3; y++) put(x, y, z, y === 3 ? S.chis : "dark_oak_fence");
    lamp(x, 4, z, false);
  }
  // WEST: rest hall - tables with candles, benches, brewing, cauldrons, books
  for (let ang = 150; ang <= 210; ang += 10) {
    if (Math.abs(ang - 180) < 8) continue;
    const [x, z] = hallAt(ang, 25); if (!free(x, 1, z)) continue;
    put(x, 1, z, "dark_oak_fence"); put(x, 2, z, S.slab, { "minecraft:vertical_half": "bottom" });
    put(x, 3, z, "candle", { candles: 2, lit: true }, true);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (free(x + ox, 1, z + oz)) put(x + ox, 1, z + oz, "dark_oak_stairs", { weirdo_direction: dirOf(ox, oz), upside_down_bit: false });
  }
  for (let ang = 146; ang <= 214; ang += 4) {
    if (Math.abs(ang - 180) < 8) continue;
    const [x, z] = hallAt(ang, 29.5); if (!free(x, 1, z)) continue;
    const q = (ang / 4) % 5;
    if (q === 0) { put(x, 1, z, "bookshelf"); put(x, 2, z, "bookshelf"); }
    else if (q === 1) put(x, 1, z, "brewing_stand");
    else if (q === 2) put(x, 1, z, "cauldron", { fill_level: 6, cauldron_liquid: "water" });
    else if (q === 3) { put(x, 1, z, "bookshelf"); put(x, 2, z, "lectern", { "minecraft:cardinal_direction": "east" }); }
    else { put(x, 1, z, "moss_block"); put(x, 2, z, "flowering_azalea", undefined, true); }
  }
  // NORTH: hall of champions - trophy pedestals
  const TROPHY = ["gold_block", "diamond_block", "emerald_block", "netherite_block", "lapis_block", "amethyst_block"];
  let ti = 0;
  for (let ang = 236; ang <= 304; ang += 8) {
    if (Math.abs(ang - 270) < 8) continue;
    const [x, z] = hallAt(ang, 28.5); if (!free(x, 1, z)) continue;
    put(x, 1, z, S.dark); put(x, 2, z, S.white2); put(x, 3, z, TROPHY[ti++ % TROPHY.length]);
    lamp(x, 4, z, false);
  }
  for (const ang of [252, 288]) { const [x, z] = hallAt(ang, 24); put(x, 1, z, S.chis); put(x, 2, z, "enchanting_table"); }
  // corners (diagonals): planters with azaleas and pots
  for (const ang of [45, 135, 225, 315]) for (const rr of [24, 26]) {
    const [x, z] = hallAt(ang, rr); if (!free(x, 1, z)) continue;
    put(x, 1, z, "moss_block"); put(x, 2, z, rng() < 0.5 ? "azalea" : "flowering_azalea", undefined, true);
    const [px, pz] = hallAt(ang + 4, rr); if (free(px, 1, pz)) put(px, 1, pz, "decorated_pot");
  }
  yield;

  // ------------------------------------------------------------ ROYAL BOX above the skull gate (inside, over the stands)
  for (let x = -6; x <= 6; x++) for (let z = 25; z <= 31; z++) {
    put(x, 16, z, S.dark);
    for (let y = 17; y <= 21; y++) C.del(x, y, z);
    if (z === 25) put(x, 17, z, Math.abs(x) % 2 ? S.slab : S.white, Math.abs(x) % 2 ? { "minecraft:vertical_half": "bottom" } : undefined);
    if (Math.abs(x) === 6) for (let y = 17; y <= 21; y++) put(x, y, z, y === 21 ? S.chis : S.pillar, y === 21 ? undefined : { pillar_axis: "y" });
    put(x, 22, z, Math.abs(x) % 2 ? S.wool : S.white);
    if (z > 25 && Math.abs(x) < 6) put(x, 17, z, S.carpet, undefined, true);
  }
  for (const x of [-1, 0, 1]) { put(x, 17, 30, "gold_block"); put(x, 18, 30, S.seat, { weirdo_direction: 2, upside_down_bit: false }); }
  put(0, 18, 30, S.seat, { weirdo_direction: 2, upside_down_bit: false }); put(0, 19, 31, "gold_block"); put(0, 20, 31, S.light);
  for (const x of [-4, 4]) hangLamp(x, 21, 28, 1);
  yield;

  // ------------------------------------------------------------ invisible lights (no mobs in the concourse / plaza / stands)
  for (let x = -44; x <= 44; x += 5) for (let z = -44; z <= 46; z += 5) {
    const r = Math.hypot(x, z);
    if (r >= 17.5 && r < 30.5) { if (free(x, 1, z) && free(x, 2, z)) put(x, 2, z, "light_block_14", undefined, true); const h = standH(r); if (r >= 19.5 && free(x, h + 1, z)) put(x, h + 1, z, "light_block_14", undefined, true); }
    else if (r >= 34.5 && r < 41.5 && free(x, 1, z) && C.has(x, 0, z)) put(x, 1, z, "light_block_14", undefined, true);
  }
  return C;
}
function turnK(k, a, b) { let x = a, z = b; for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; }
/** whole design at once (tests / preview) */
export function arenaDesign(style) { const g = arenaGen(style); let r; while (!(r = g.next()).done); return r.value; }
