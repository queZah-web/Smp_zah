// =====================================================================================================================
// CELESTIAL SANCTUARY - the big pieces of v4 (pure data, used by celestialdesign.js)
//   * butterfly(...)   a BUILT butterfly (blocks): two pairs of pixel wings opened in a V (blue fore wings, pink / purple hind
//                      wings, black outline + veins, white spots), a brown body, a black head, antennae (+ a little lantern)
//                      -> on top of the 4 lanterns, and big ones floating in the sky around / above the spawn
//   * nameSign(...)    the server name 『ZYTHER SMP』 in big green block letters on a floating board (readable from both sides)
//   * cathedral(...)   the TWIN CATHEDRAL: half black (left), half white (right) - a dark square bell tower with lancet strips
//                      and spiky pinnacles, a white tower with a diamond-lattice crown of many spires, between them a gothic
//                      front with a great portal, a rose window and a spire with a golden cross; the hall behind (roof half
//                      dark / half white) is fully furnished inside
// =====================================================================================================================

// ---------------------------------------------------------------- helpers
const inPoly = (pts, u, v) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) c = !c; } return c; };
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ================================================================ THE BUTTERFLY (picture: the butterfly on the lantern)
// wing shapes in (u = 0 at the body .. 1 at the tip, v = -1 front .. +1 back)
const FORE = [[0, -0.02], [0.06, -0.42], [0.26, -0.82], [0.58, -1.0], [0.92, -0.95], [1.0, -0.72], [0.8, -0.38], [0.5, -0.1], [0.22, 0.02]];
const HIND = [[0, 0.0], [0.38, -0.04], [0.7, 0.12], [0.8, 0.4], [0.68, 0.72], [0.42, 0.95], [0.18, 0.9], [0.04, 0.55]];
const VEINS_F = [[0.3, -0.3, 0.86, -0.78]];
const VEINS_H = [];
/**
 * put(x, y, z, id, states, late)
 * (x, y, z) = the middle of the body; yaw = the direction the head looks (degrees, 0 = +x, 90 = +z); size = the wing span of
 * ONE wing in blocks (the whole butterfly is about 2 x size wide); tilt = how high the wings are lifted (degrees from flat)
 */
export function butterfly(put, x0, y0, z0, yaw, size, tilt = 58, lantern = true, seed = 1) {
  const SPAN = Math.max(6, Math.round(size)), LEN = Math.max(9, Math.round(size * 1.45));
  const a = (yaw * Math.PI) / 180, fx = Math.cos(a), fz = Math.sin(a), rx = -fz, rz = fx;
  // the pixel map of one wing: 0 none, 1.. colours, 9 black
  const cell = new Map();
  const kind = (u, v) => (inPoly(FORE, u, v) ? 1 : inPoly(HIND, u, v) ? 2 : 0);
  for (let i = 0; i < SPAN; i++) for (let j = 0; j < LEN; j++) {
    const u = (i + 0.5) / SPAN, v = ((j + 0.5) / LEN) * 2 - 1, k = kind(u, v); if (!k) continue;
    const du = 1 / SPAN, dv = 2 / LEN;
    let edge = false;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const kk = kind(u + di * du, v + dj * dv); if ((kk === 0 && !(di === -1 && i === 0)) || (k === 2 && kk === 1)) edge = true; }
    let vein = false;
    for (const [ax, ay, bx, by] of k === 1 ? VEINS_F : VEINS_H) if (segDist(u * SPAN, v * LEN / 2, ax * SPAN, ay * LEN / 2, bx * SPAN, by * LEN / 2) < 0.38) vein = true;
    const d = Math.hypot(u, (v - (k === 1 ? -0.3 : 0.3)) * 0.7);
    let b;
    if (edge) b = "black_concrete";
    else if (vein && u > 0.22) b = "black_concrete";
    else if (k === 1) b = d < 0.38 ? "blue_concrete" : d < 0.72 ? (hash(i, j, seed) < 0.3 ? "light_blue_stained_glass" : "light_blue_concrete") : hash(i, j, seed + 7) < 0.16 ? "white_concrete" : hash(i, j, seed) < 0.45 ? "light_blue_stained_glass" : "light_blue_concrete";
    else b = d < 0.3 ? "purple_concrete" : d < 0.6 ? (hash(i, j, seed) < 0.3 ? "magenta_stained_glass" : "magenta_concrete") : hash(i, j, seed + 3) < 0.14 ? "white_concrete" : hash(i, j, seed) < 0.4 ? "pink_stained_glass" : "pink_concrete";
    cell.set(i + "," + j, b);
  }
  // the wings in 3D: every block takes the colour of the wing pixel whose sample lands closest to the block's middle
  const vox = new Map();
  for (const side of [-1, 1]) for (const [key, b] of cell) {
    const [i, j] = key.split(",").map(Number);
    const v = ((j + 0.5) / LEN) * 2 - 1, T = ((tilt + (v < 0 ? 6 : -6)) * Math.PI) / 180;
    for (const sa of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const sb of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const s = i + sa, f = -(((j + sb) / LEN) * 2 - 1) * (LEN / 2);
      const lat = side * (1.1 + s * Math.cos(T)), up = s * Math.sin(T);
      const wx = x0 + fx * f + rx * lat, wy = y0 + up, wz = z0 + fz * f + rz * lat;
      const X = Math.round(wx), Y = Math.round(wy), Z = Math.round(wz), d = (wx - X) ** 2 + (wy - Y) ** 2 + (wz - Z) ** 2, k = X + "," + Y + "," + Z;
      const o = vox.get(k); if (!o || d < o.d) vox.set(k, { d, b, X, Y, Z });
    }
  }
  for (const o of vox.values()) put(o.X, o.Y, o.Z, o.b);
  // the body (brown, a little thick), the head (black), the antennae
  const BL = LEN * 0.45;
  for (let f = -BL; f <= BL * 0.75; f += 0.4) for (const [l, u] of [[-0.4, 0], [0.4, 0], [0, -0.6], [0, 0.4]]) {
    const thin = f < -BL * 0.6 ? 0 : 1;
    if (!thin && (l !== 0)) continue;
    put(Math.round(x0 + fx * f + rx * l), Math.round(y0 + u - (f < 0 ? 0.6 : 0)), Math.round(z0 + fz * f + rz * l), f > BL * 0.55 ? "black_concrete" : (Math.round(f) % 3 === 0 ? "brown_terracotta" : "brown_concrete"));
  }
  const hf = BL * 0.75 + 1;
  const tips = [];
  for (const side of [-1, 1]) {
    let last = null;
    for (let t = 0; t <= 1; t += 0.08) {
      const f = hf + t * size * 0.45, l = side * (0.5 + t * size * 0.22), u = 0.5 + t * size * 0.42;
      last = [Math.round(x0 + fx * f + rx * l), Math.round(y0 + u), Math.round(z0 + fz * f + rz * l)];
      put(last[0], last[1], last[2], "black_concrete");
    }
    tips.push(last);
  }
  if (lantern) { const [tx, ty, tz] = tips[1]; const fx2 = Math.round(tx + fx), fz2 = Math.round(tz + fz); put(fx2, ty, fz2, "iron_chain|chain", { pillar_axis: "y" }, true); put(fx2, ty - 1, fz2, "iron_chain|chain", { pillar_axis: "y" }, true); put(fx2, ty - 2, fz2, "lantern", { hanging: true }, true); }
}

// ================================================================ THE NAME 『ZYTHER SMP』 (a floating board, letters on both faces)
const FONT = {
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  "«": ["#####", "#....", "#.###", "#.#..", "#.#..", "#.#..", "#.#..", "#.#..", "###.."],      // 『 (9 high)
  "»": ["..###", "..#.#", "..#.#", "..#.#", "..#.#", "..#.#", "###.#", "....#", "#####"],      // 』
  "*": [".#.", "###", ".#."],
};
/** the board stands in the plane z = zc (x from cx - w/2 .. cx + w/2), its bottom at y0. front = the face toward -z (north) */
export function nameSign(put, cx, y0, zc) {
  const SC = 2;
  const lines = [{ t: "«ZYTHER»", y: 0 }, { t: "*SMP*", y: 1 }];
  const glyphW = (ch) => FONT[ch][0].length;
  const layout = (t) => { const out = []; let x = 0; for (const ch of t) { out.push({ ch, x }); x += (glyphW(ch) + 1) * SC + (ch === "«" || ch === "*" ? SC : 0); } return { out, w: x - SC }; };
  const L1 = layout(lines[0].t), L2 = layout(lines[1].t);
  const W = Math.max(L1.w, L2.w) + 8, H = 9 * SC + 4 + 7 * SC + 8;     // the board
  const x1 = cx - Math.floor(W / 2), x2 = x1 + W - 1, yTop = y0 + H - 1;
  // the board: dark middle, a white frame with gold corners, little spires on top
  for (let x = x1; x <= x2; x++) for (let y = y0; y <= yTop; y++) {
    const e = x === x1 || x === x2 || y === y0 || y === yTop, e2 = x === x1 + 1 || x === x2 - 1 || y === y0 + 1 || y === yTop - 1;
    const corner = (x - x1 <= 2 || x2 - x <= 2) && (y - y0 <= 2 || yTop - y <= 2);
    put(x, y, zc, corner && e ? "gold_block" : e ? "smooth_quartz" : e2 ? "chiseled_quartz_block" : "polished_deepslate");
  }
  for (let x = x1; x <= x2; x += 6) { put(x, yTop + 1, zc, "diorite_wall"); put(x, yTop + 2, zc, "end_rod", { facing_direction: 1 }, true); }
  put(cx, yTop + 1, zc, "gold_block"); put(cx, yTop + 2, zc, "gold_block"); put(cx, yTop + 3, zc, "lightning_rod", { facing_direction: 1 }, true);
  // the letters (green, glowing top row) on both faces; each face reads from left to right for the one looking at it
  const draw = (L, rowTop, face) => {
    const off = Math.floor((W - L.w) / 2);
    for (const { ch, x } of L.out) {
      const g = FONT[ch], gh = g.length, top = ch === "«" || ch === "»" ? rowTop + SC : ch === "*" ? rowTop - 2 * SC : rowTop;
      g.forEach((row, r) => { for (let c = 0; c < row.length; c++) { if (row[c] !== "#") continue;
        for (let a = 0; a < SC; a++) for (let b = 0; b < SC; b++) {
          const u = off + x + c * SC + a, yy = top - r * SC - b;
          const wx = face < 0 ? x2 - u : x1 + u;                 // face -1 (north side) is seen looking south: its left is +x
          const shade = ch === "«" || ch === "»" ? "gold_block" : ch === "*" ? "emerald_block" : r === 0 && b === 0 ? "verdant_froglight" : r >= gh - 2 ? "green_concrete" : "lime_concrete";
          put(wx, yy, zc + face, shade);
        } } });
    }
  };
  for (const face of [-1, 1]) { draw(L1, yTop - 4, face); draw(L2, yTop - 4 - 9 * SC - 4, face); }
  return { x1, x2, y1: y0, y2: yTop + 3 };
}

// ================================================================ THE TWIN CATHEDRAL (half black, half white)
// The front looks south (+z) to the plaza.  Seen from the plaza: the BLACK half on the left (x < 0), the WHITE half on the right.
export function cathedral(put, C, h) {
  const { stair, chair, chandelier, candle } = h;
  const FZ = -34, BZ = -76, HW = 20;                     // the hall: x -20..20, z -76..-34 (the front wall at z -34)
  const dark = (x) => x < 0;
  const DK = { wall: "polished_blackstone_bricks", deep: "deepslate_tiles", pil: "polished_blackstone", light: "mud_bricks", trim: "nether_brick", rust: "waxed_cut_copper", glass: ["gray_stained_glass", "purple_stained_glass", "black_stained_glass", "gray_stained_glass"], spire: "polished_blackstone_wall", roofS: "deepslate_tile_stairs", roof: "deepslate_tiles" };
  const WT = { wall: "quartz_bricks", deep: "polished_andesite", pil: "quartz_pillar", light: "calcite", trim: "smooth_quartz", rust: "amethyst_block", glass: ["white_stained_glass", "purple_stained_glass", "white_stained_glass", "light_gray_stained_glass"], spire: "diorite_wall", roofS: "smooth_quartz_stairs", roof: "smooth_quartz" };
  const P = (x) => (dark(x) ? DK : WT);
  const pp = (x, y, z, id) => put(x, y, z, id, id === "quartz_pillar" ? { pillar_axis: "y" } : undefined);
  const pointed = (dx, half, top) => top + Math.round((half + 0.5) * 0.9 - Math.abs(dx) * 0.9 - Math.max(0, (Math.abs(dx) - half * 0.4)) * 0.6);   // the top of a pointed arch at offset dx

  // ---------------- the floor (inside the hall + the front terrace)
  for (let x = -HW; x <= HW; x++) for (let z = BZ; z <= FZ; z++) put(x, 0, z, (x + z) % 2 ? "polished_blackstone" : "calcite");
  for (let x = -33; x <= 33; x++) for (let z = FZ + 1; z <= FZ + 5; z++) put(x, 0, z, dark(x) ? (z % 2 ? "polished_blackstone_bricks" : "polished_deepslate") : (z % 2 ? "quartz_bricks" : "polished_diorite"));

  // ---------------- the hall walls (x = ±20) with buttresses + tall lancet windows, the back wall (z -76)
  const WALL = 26;
  for (const sx of [-1, 1]) {
    const x = sx * HW, p = P(x);
    for (let z = BZ; z <= FZ - 14; z++) for (let y = 1; y <= WALL; y++) {
      const m = (z - BZ) % 6, win = m >= 2 && m <= 4;
      let b = y === WALL ? p.deep : y % 9 === 0 ? p.light : p.wall;
      if (win) { const top = 21 + (m === 3 ? 2 : 0); if (y >= 5 && y <= top) b = y === top ? p.trim : p.glass[(y + z) % p.glass.length]; }
      if (m === 0) b = p.pil;
      pp(x, y, z, b);
    }
    for (let z = BZ; z <= FZ - 14; z += 6) for (let k = 1; k <= 3; k++) for (let y = 1; y <= WALL + 2 - k * 6; y++) {          // buttresses (stepping out)
      pp(x + sx * k, y, z, y === WALL + 2 - k * 6 ? p.deep : p.wall);
      if (k === 1 && y === WALL - 4) { for (let yy = WALL - 3; yy <= WALL + 4; yy++) put(x + sx, yy, z, yy === WALL + 4 ? (dark(x) ? "lightning_rod" : "end_rod") : p.spire, yy === WALL + 4 ? { facing_direction: 1 } : undefined, yy === WALL + 4); }
    }
  }
  for (let x = -HW; x <= HW; x++) for (let y = 1; y <= WALL + 21; y++) {                       // the back wall + its gable
    if (y > WALL && y > WALL + HW - Math.abs(x)) continue;
    const p = P(x), d = Math.hypot(x, y - 18);
    pp(x, y, BZ, d < 7 && d > 1 ? p.glass[(x + y + 40) % p.glass.length] : d <= 1 ? "sea_lantern" : y % 9 === 0 ? p.light : p.wall);
  }
  // the roof: steep, the dark slope on the left, the white slope on the right, a ridge with spikes
  for (let z = BZ - 1; z <= FZ - 1; z++) for (let k = 0; k <= HW; k++) {
    const y = WALL + 1 + k;
    for (const s of [-1, 1]) { const x = s * (HW + 1 - k); if (x === 0 || (z >= -48 && Math.abs(x) >= 20)) continue; const p = P(x); stair(x, y, z, p.roofS, -s, 0); if (k > 0 && Math.abs(x + s) <= HW && !(z >= -48 && Math.abs(x + s) >= 20)) put(x + s, y, z, p.roof); }
  }
  for (let z = BZ - 1; z <= FZ - 1; z++) { put(0, WALL + HW + 1, z, z % 2 ? "polished_blackstone" : "quartz_bricks"); if (z % 5 === 0) { put(0, WALL + HW + 2, z, "gold_block"); put(0, WALL + HW + 3, z, "lightning_rod", { facing_direction: 1 }, true); } }

  // ---------------- the two towers (15 x 15) at the front corners: x -34..-20 (black) and 20..34 (white), z -48..-34
  const TZ1 = -48, TZ2 = -34;
  // the BLACK tower: square, lancet strips all the way up, checkered light bands, a belfry, a crown of spiky pinnacles
  { const X1 = -34, X2 = -20, TOP = 78, cx = -27, cz = -41;
    for (let x = X1; x <= X2; x++) for (let z = TZ1; z <= TZ2; z++) for (let y = 1; y <= TOP; y++) {
      const ex = x === X1 || x === X2, ez = z === TZ1 || z === TZ2; if (!ex && !ez) { if (y % 14 === 0) put(x, y, z, DK.deep); continue; }
      const corner = ex && ez, u = ex ? z - cz : x - cx;                      // u: position along the face (-7..7)
      let b = DK.wall;
      if (corner || Math.abs(u) === 6) b = DK.pil;
      else if (y % 14 === 0 || y % 14 === 1) b = DK.deep;
      else if (y >= 22 && y <= 27) b = (Math.abs(u) + y) % 2 ? DK.light : DK.wall;              // the light checkered band
      else if (Math.abs(u) % 2 === 1 && Math.abs(u) <= 5) {
        const band = y < 22 ? [4, 19] : y < 50 ? [30, 47] : y < 64 ? [53, 61] : [66, 75];
        if (y >= band[0] && y <= band[1]) b = y === band[1] ? DK.trim : (y + u) % 7 === 0 ? DK.light : DK.glass[(y + u + 20) % DK.glass.length];
      } else if (y >= 30 && y <= 47 && Math.abs(u) <= 5 && (y - 30) % 6 === 0) b = DK.light;
      if (ez && z === TZ2 && Math.abs(x - cx) <= 2 && y <= 9) b = y >= 8 ? DK.trim : null;        // a door into the tower (front)
      if (ez && z === TZ2 && x === X2 && y <= 9) b = DK.pil;
      if (b) pp(x, y, z, b);
    }
    for (let x = X1 - 1; x <= X2 + 1; x++) for (let z = TZ1 - 1; z <= TZ2 + 1; z++) {           // the cornice + the crown
      const e = x === X1 - 1 || x === X2 + 1 || z === TZ1 - 1 || z === TZ2 + 1; if (!e) continue;
      put(x, TOP + 1, z, DK.deep); if ((x + z) % 2 === 0) put(x, TOP + 2, z, DK.spire);
    }
    // pinnacles: 4 big ones on the corners, 2 on each face, a slim spire in the middle
    const pin = (x, z, h, cap) => { for (let y = TOP + 1; y <= TOP + h; y++) put(x, y, z, y === TOP + h ? (cap ?? "lightning_rod") : y > TOP + h - 3 ? DK.spire : DK.pil, y === TOP + h ? { facing_direction: 1 } : undefined, y === TOP + h); };
    for (const [x, z] of [[X1 - 1, TZ1 - 1], [X2 + 1, TZ1 - 1], [X1 - 1, TZ2 + 1], [X2 + 1, TZ2 + 1]]) { pin(x, z, 13); for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!C.has(x + dx, TOP + 2, z + dz)) put(x + dx, TOP + 2, z + dz, DK.pil); }
    for (const t of [-3, 3]) { pin(cx + t, TZ1 - 1, 8); pin(cx + t, TZ2 + 1, 8); pin(X1 - 1, cz + t, 8); pin(X2 + 1, cz + t, 8); }
    for (let k = 0; k <= 6; k++) for (let dx = -3 + Math.floor(k / 2); dx <= 3 - Math.floor(k / 2); dx++) for (let dz = -3 + Math.floor(k / 2); dz <= 3 - Math.floor(k / 2); dz++) put(cx + dx, TOP + 1 + k, cz + dz, k % 3 === 2 ? DK.rust : DK.deep);
    for (let y = TOP + 8; y <= TOP + 16; y++) put(cx, y, cz, y === TOP + 16 ? "lightning_rod" : y >= TOP + 14 ? DK.rust : DK.spire, y === TOP + 16 ? { facing_direction: 1 } : undefined, y === TOP + 16);
    // a rose on the front of the tower (red eye in the middle, like the picture)
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const d = Math.hypot(dx, dy); if (d > 3.3) continue; pp(cx + dx, 38 + dy, TZ2 + (d > 2.3 ? 1 : 0), d < 0.5 ? "redstone_block" : d > 2.3 ? DK.light : DK.glass[(dx + dy + 8) % 2 ? 0 : 2]); }
  }
  // the WHITE tower: white walls with grey shadows at the edges, mossy feet, a great purple window, an octagon crown with a
  // diamond lattice, a forest of thin spires on top
  { const X1 = 20, X2 = 34, BODY = 60, cx = 27, cz = -41;
    for (let x = X1; x <= X2; x++) for (let z = TZ1; z <= TZ2; z++) for (let y = 1; y <= BODY; y++) {
      const ex = x === X1 || x === X2, ez = z === TZ1 || z === TZ2; if (!ex && !ez) { if (y % 14 === 0) put(x, y, z, "smooth_quartz"); continue; }
      const corner = ex && ez, u = ex ? z - cz : x - cx;
      let b = Math.abs(u) >= 6 ? (y % 3 ? "polished_andesite" : "stone_bricks") : Math.abs(u) === 5 ? "calcite" : y % 9 === 0 ? "chiseled_quartz_block" : "quartz_bricks";
      if (corner) b = "quartz_pillar";
      if (y <= 14 - Math.abs(u) && Math.abs(u) >= 3) b = (y + u) % 3 ? "mossy_stone_bricks" : "stone_bricks";                // the mossy feet
      const front = ez && z === TZ2;
      if (Math.abs(u) <= 4 && y >= 24 && y <= pointed(u, 4, 44)) b = y === pointed(u, 4, 44) ? "calcite" : Math.abs(u) === 2 && y < 40 ? "quartz_pillar" : (y % 5 === 0 && Math.abs(u) <= 1) ? "amethyst_block" : WT.glass[(y + u + 30) % WT.glass.length];
      if (front && Math.abs(u) <= 2 && y <= pointed(u, 2, 11)) b = y === pointed(u, 2, 11) ? "mossy_stone_bricks" : null;         // the door
      if (b) pp(x, y, z, b);
    }
    // the octagon crown (y 57..80): cut corners, a diamond lattice of quartz, glass / calcite between, purple gems
    const CR1 = BODY + 1, CR2 = 86;
    for (let y = CR1; y <= CR2; y++) {
      const r = 7 - (y > CR2 - 6 ? Math.floor((y - CR2 + 6) / 2) : 0);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const oct = Math.abs(dx) + Math.abs(dz) <= r + 3; if (!oct) continue;
        const edge = Math.abs(dx) === r || Math.abs(dz) === r || Math.abs(dx) + Math.abs(dz) === r + 3; if (!edge) { if (y === CR1 || y === CR2) put(cx + dx, y, cz + dz, "smooth_quartz"); continue; }
        const u = Math.abs(dz) === r ? dx : Math.abs(dx) === r ? dz : dx + dz, w = (u + 30 + y) % 6, w2 = (u + 30 - y + 600) % 6;
        let b = w === 0 || w2 === 0 ? "polished_andesite" : (w === 3 && w2 === 3) ? "amethyst_block" : (y % 4 === 0 ? "calcite" : "white_stained_glass");
        if (y === CR1 || y === CR2) b = "chiseled_quartz_block";
        pp(cx + dx, y, cz + dz, b);
      }
    }
    // the spires: a ring of thin white spires of different heights + a tall one in the middle
    let k = 0;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      const onRing = (Math.abs(dx) === 7 || Math.abs(dz) === 7 || Math.abs(dx) + Math.abs(dz) === 10) && Math.abs(dx) + Math.abs(dz) <= 10; if (!onRing) continue;
      const h = 6 + Math.round(hash(dx, dz, 5) * 12) + (Math.abs(dx) + Math.abs(dz) === 10 ? 3 : 0); k++;
      for (let y = CR2 - 18; y <= CR2 + h; y++) { if (y < CR2 - 18 + (k % 3) * 4) continue; const top = y === CR2 + h; const id = top ? "end_rod" : y > CR2 + h - 4 ? "diorite_wall" : "quartz_pillar"; if (y <= CR2 && C.has(cx + dx, y, cz + dz) && !C.id(cx + dx, y, cz + dz).includes("glass")) continue; put(cx + dx, y, cz + dz, id, top ? { facing_direction: 1 } : id === "quartz_pillar" ? { pillar_axis: "y" } : undefined, top); }
    }
    for (let y = CR2 + 1; y <= CR2 + 24; y++) put(cx, y, cz, y === CR2 + 24 ? "end_rod" : y > CR2 + 16 ? "diorite_wall" : y > CR2 + 6 ? "quartz_pillar" : "chiseled_quartz_block", y === CR2 + 24 ? { facing_direction: 1 } : y > CR2 + 6 && y <= CR2 + 16 ? { pillar_axis: "y" } : undefined, y === CR2 + 24);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = CR2 + 1; y <= CR2 + 8; y++) put(cx + dx, y, cz + dz, y === CR2 + 8 ? "amethyst_block" : "quartz_bricks");
    // buttress spires on the body corners
    for (const [x, z] of [[X1 - 1, TZ2 + 1], [X2 + 1, TZ2 + 1], [X1 - 1, TZ1 - 1], [X2 + 1, TZ1 - 1]]) for (let y = 1; y <= BODY + 6; y++) put(x, y, z, y === BODY + 6 ? "end_rod" : y > BODY ? "diorite_wall" : y < 12 ? "mossy_stone_bricks" : y % 2 ? "polished_andesite" : "calcite", y === BODY + 6 ? { facing_direction: 1 } : undefined, y === BODY + 6);
  }

  // ---------------- the FRONT between the towers (x -19..19, z -34): portal, gallery, rose window, gable, spire + golden cross
  const GT = 34;                                                   // the gable starts here, its peak at GT + 16
  for (let x = -19; x <= 19; x++) for (let y = 1; y <= GT + 16; y++) {
    if (y > GT && y > GT + 16 - Math.round(Math.abs(x) * 0.85)) continue;
    const p = P(x);
    let b = y % 11 === 0 ? p.light : p.wall;
    if (Math.abs(x) === 19 || Math.abs(x) === 12) b = p.pil;
    if (y > GT && y === GT + 16 - Math.round(Math.abs(x) * 0.85)) b = p.deep;
    if (Math.abs(x) >= 13 && Math.abs(x) <= 17 && y >= 5 && y <= pointed(Math.abs(x) - 15, 2, 20)) b = y === pointed(Math.abs(x) - 15, 2, 20) ? p.trim : p.glass[(y + x + 40) % p.glass.length];       // side windows
    if (y >= 22 && y <= 24 && Math.abs(x) <= 11) b = y === 23 && x % 2 ? p.pil : p.deep;                                   // the gallery
    const d = Math.hypot(x, y - 32);                                                                                        // the ROSE window
    if (d <= 9.4) b = d > 8.5 ? (dark(x) ? DK.rust : "chiseled_quartz_block") : d > 7.6 ? p.deep : d < 1.3 ? "amethyst_block" : (Math.round(Math.atan2(y - 32, x) * 12 / Math.PI) % 2 === 0 && d > 2.5 ? p.pil : d < 3.2 ? "purple_stained_glass" : (Math.round(d) + Math.round(Math.atan2(y - 32, x) * 4)) % 3 === 0 ? "purple_stained_glass" : "white_stained_glass");
    if (Math.abs(x) <= 5 && y <= pointed(x, 5, 16)) b = null;                                                                  // the great door (open)
    if (b === "quartz_pillar") pp(x, y, FZ, b); else if (b) put(x, y, FZ, b);
  }
  // the portal porch: stepped pointed arches in front of the door, a triangle (wimperg) above it
  for (let layer = 1; layer <= 3; layer++) { const z = FZ + layer, half = 5 + 3 - layer + 1, top = 16 + 3 - layer;
    for (let x = -half - 1; x <= half + 1; x++) for (let y = 1; y <= top + 3; y++) {
      const inside = Math.abs(x) <= half && y <= pointed(x, half, top); if (inside) continue;
      if (Math.abs(x) > half + 1 && y > 1) continue;
      if (y > pointed(x, half, top) + 2 && Math.abs(x) <= half) continue;
      const p = P(x); put(x, y, z, Math.abs(x) === half + 1 ? p.pil : (y + layer) % 3 === 0 ? p.light : p.trim, Math.abs(x) === half + 1 && !dark(x) ? { pillar_axis: "y" } : undefined);
    } }
  for (let x = -9; x <= 9; x++) for (let y = 20; y <= 20 + 9 - Math.abs(x); y++) put(x, y, FZ + 1, y === 20 + 9 - Math.abs(x) ? P(x).deep : P(x).wall);
  for (const sx of [-10, 10]) for (let y = 1; y <= 30; y++) put(sx, y, FZ + 1, y > 26 ? P(sx).spire : y === 30 ? "lightning_rod" : P(sx).pil, sx > 0 && y <= 26 ? { pillar_axis: "y" } : undefined);
  // the central spire on the gable + the golden cross
  for (let y = GT + 13; y <= GT + 30; y++) { const w = y < GT + 20 ? 1 : 0; for (let dx = -w; dx <= w; dx++) for (let dz = -w; dz <= w; dz++) put(dx, y, FZ - 1 + dz, P(dx).deep); if (w === 0) put(0, y, FZ - 1, y % 2 ? "polished_blackstone" : "quartz_bricks"); }
  for (let y = GT + 31; y <= GT + 37; y++) put(0, y, FZ - 1, "gold_block");
  for (const dx of [-2, -1, 1, 2]) put(dx, GT + 35, FZ - 1, "gold_block");
  // two slim pinnacles at the sides of the gable (dark one with copper top, white one with a crystal)
  for (const sx of [-1, 1]) { const x = sx * 13; for (let y = GT; y <= GT + 18; y++) put(x, y, FZ, y > GT + 14 ? (sx < 0 ? DK.rust : "amethyst_block") : P(x).pil, sx > 0 && y <= GT + 14 ? { pillar_axis: "y" } : undefined); put(x, GT + 19, FZ, sx < 0 ? "lightning_rod" : "end_rod", { facing_direction: 1 }, true); }
  // the front steps + small trees (like the picture) + lamps
  for (let x = -33; x <= 33; x++) { const p = P(x); stair(x, 1, FZ + 6, dark(x) ? "polished_blackstone_brick_stairs" : "smooth_quartz_stairs", 0, -1); if (Math.abs(x) % 6 === 3 && Math.abs(x) > 8) { put(x, 1, FZ + 4, dark(x) ? "polished_blackstone_wall" : "diorite_wall"); put(x, 2, FZ + 4, dark(x) ? "soul_lantern" : "lantern", { hanging: false }, true); } }
  for (let x = -33; x <= 33; x++) for (let z = FZ + 1; z <= FZ + 5; z++) if (!C.has(x, 1, z) && Math.abs(x) > 8) put(x, 1, z, dark(x) ? "polished_blackstone_slab" : "smooth_quartz_slab", { "minecraft:vertical_half": "bottom" });

  // ---------------- inside: columns, pews, a red carpet, the altar, the organ wall, chandeliers, side chapels
  const CZ1 = BZ, CZ2 = FZ;
  for (let z = CZ2 - 6; z >= CZ1 + 4; z -= 6) for (const sx of [-1, 1]) {
    for (let y = 1; y <= 24; y++) pp(sx * 11, y, z, y === 1 || y === 24 ? (sx < 0 ? "chiseled_polished_blackstone" : "chiseled_quartz_block") : sx < 0 ? "polished_blackstone" : "quartz_pillar");
    put(sx * 11 - sx, 8, z, sx < 0 ? "soul_lantern" : "lantern", { hanging: false }, true);
  }
  for (let x = -HW + 1; x < HW; x++) for (let z = CZ1 + 1; z < -48; z++) put(x, WALL, z, (x + z) % 4 === 0 ? (x < 0 ? "deepslate_tiles" : "chiseled_quartz_block") : x < 0 ? "polished_blackstone_bricks" : "quartz_bricks");   // the ceiling
  for (let z = CZ2 - 1; z >= CZ1 + 9; z--) for (let x = -2; x <= 2; x++) put(x, 1, z, Math.abs(x) === 2 ? "yellow_carpet" : "red_carpet", undefined, true);
  for (let z = CZ2 - 6; z >= CZ1 + 12; z -= 3) for (const sx of [-1, 1]) for (let a = 4; a <= 9; a++) { chair(sx * a, 1, z, 0, -1, "dark_oak"); if (a === 4 || a === 9) put(sx * a, 2, z, "dark_oak_fence"); }
  for (let x = -8; x <= 8; x++) for (let z = CZ1 + 1; z <= CZ1 + 8; z++) put(x, 1, z, z === CZ1 + 8 ? (x < 0 ? "polished_blackstone_brick_stairs" : "quartz_stairs") : x < 0 ? "polished_blackstone" : "smooth_quartz", z === CZ1 + 8 ? { weirdo_direction: 3, upside_down_bit: false } : undefined);
  for (let x = -2; x <= 2; x++) { put(x, 2, CZ1 + 4, "gold_block"); put(x, 3, CZ1 + 4, "white_carpet", undefined, true); }
  candle(-2, 4, CZ1 + 4, 3, "black_candle"); candle(2, 4, CZ1 + 4, 3, "white_candle"); candle(0, 4, CZ1 + 4, 4, "yellow_candle");
  for (let x = -6; x <= 6; x++) for (let y = 2; y <= 9; y++) put(x, y, CZ1 + 1, y === 9 || Math.abs(x) === 6 ? "dark_oak_planks" : (x + y) % 3 === 0 ? "chiseled_bookshelf" : "bookshelf", (x + y) % 3 === 0 && y < 9 && Math.abs(x) < 6 ? { books_stored: 63, direction: 0 } : undefined);
  for (let x = -6; x <= 6; x += 2) for (let y = 10; y <= 15; y++) put(x, y, CZ1 + 1, "iron_bars");
  for (const sx of [-1, 1]) { put(sx * 7, 2, CZ1 + 6, "lectern", { "minecraft:cardinal_direction": "south", powered_bit: false }); put(sx * 8, 2, CZ1 + 3, "amethyst_block"); put(sx * 8, 3, CZ1 + 3, "amethyst_cluster", { "minecraft:block_face": "up" }, true); }
  for (let z = CZ2 - 5; z >= CZ1 + 6; z -= 8) chandelier(0, WALL - 1, z, 5);
  for (let z = CZ2 - 9; z >= CZ1 + 12; z -= 8) for (const sx of [-1, 1]) chandelier(sx * 16, WALL - 1, z, 7);
  for (const sx of [-1, 1]) for (let z = CZ2 - 17; z >= CZ1 + 8; z -= 9) {
    put(sx * 19, 1, z, "bookshelf"); put(sx * 19, 2, z, sx < 0 ? "black_candle" : "white_candle", { candles: 2, lit: true }, true); chair(sx * 18, 1, z - 1, -sx, 0, "spruce"); chair(sx * 18, 1, z + 1, -sx, 0, "spruce");
    put(sx * 19, 1, z - 2, "decorated_pot", { direction: 0 }, true);
  }
  return { x1: -36, x2: 36, z1: BZ - 2, z2: FZ + 6 };
}
