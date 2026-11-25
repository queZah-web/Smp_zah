// =====================================================================================================================
// SKY WARS DESIGN - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   Floating islands in the sky (the tops at y +60 over the place where the Owner stood):
//     * the CENTRE island (radius ~13): grass + sand paths, rocky ground, 4 stone spires with terracotta bands and
//       ladders (like the picture), a raised middle with the 4 best chests, 4 more chests around, an enchanting corner
//     * 10 PLAYER islands ~32 blocks from the middle (20 players: + 10 more at ~54, between them), each one a bit different
//       (size, height -4 .. +5, the side of the tree), 4 small MIDDLE islands between them and the centre: grass top, dirt, a stone /
//       andesite / granite underside that hangs down like a rock, a small tree, a rock spire, 2 chests, the spawn point
//   Under the arena, buried in the ground and closed with barrier blocks: the LOCKERS (2 barrels per player) where the
//   players' own things wait during a game (nobody can reach them).
// =====================================================================================================================
import { BigCanvas } from "./celestialdesign.js";

export const TOP = 60;                       // y of the grass on the centre island (the other islands are a bit higher / lower)
const RING1 = 32, RING2 = 54;                // the player islands: ~32 blocks from the middle (20 players: a 2nd ring at ~54)
export function layout(n) {                  // n = 10 or 20 players
  const rng = rngOf(900 + n), islands = [], mids = [];
  const ring = (k, r0, off, seed) => {
    for (let i = 0; i < k; i++) {
      const j = (rng() - 0.5) * 0.05, a = ((i + off) / k) * Math.PI * 2 - Math.PI / 2 + j;          // a little turned (not a perfect clock)
      const r = r0 + Math.round((rng() - 0.5) * 2.4), dy = [-4, 2, -1, 4, -3, 1, 3, -2, 0, 5][(i + seed) % 10];   // different heights
      islands.push({ x: Math.round(Math.cos(a) * r), z: Math.round(Math.sin(a) * r), a, top: TOP + dy, size: 5 + ((i + seed) % 2), ring: seed });
    }
  };
  ring(10, RING1, 0, 0);
  if (n > 10) ring(10, RING2, 0.5, 3);
  // 4 small MIDDLE islands between the centre and the ring (good loot, risky to reach)
  [0.5, 3.5, 5.5, 8.5].forEach((g, i) => { const a = (g / 10) * Math.PI * 2 - Math.PI / 2; mids.push({ x: Math.round(Math.cos(a) * 19), z: Math.round(Math.sin(a) * 19), a, top: TOP + [5, 3, 6, 4][i], size: 2 }); });
  const far = Math.max(...islands.map((is) => Math.max(Math.abs(is.x), Math.abs(is.z)) + is.size + 3));
  const HX = far + 6;
  return { n, R: RING1, HX, UP: TOP + 34, DOWN: 4, islands, mids, voidY: TOP - 24, center: { x: 0, y: TOP + 1, z: 0 } };
}
/** the locker barrels (2 per player), buried under the arena: relative positions */
export const lockerAt = (k) => ({ x: (k % 20) - 10, y: -2, z: k < 20 ? 0 : 2 });

function rngOf(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? "east" : "west") : (vz > 0 ? "south" : "north"));

/** the islands (blocks) + the chests [{ x, y, z, tier }] + the spawn points [{ x, y, z }] */
export function* skyGen(n) {
  const L = layout(n), C = new BigCanvas(), chests = [], spawns = [];
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const ROCK = ["stone", "stone", "andesite", "cobblestone", "stone", "granite", "tuff"];
  // one irregular island: top at `top`, hanging rock under it (deeper in the middle, like a real floating island)
  const blob = (x0, z0, r, top, rng, rockRich) => {
    for (let dx = -r - 2; dx <= r + 2; dx++) for (let dz = -r - 2; dz <= r + 2; dz++) {
      const ang = Math.atan2(dz, dx), edge = r + Math.sin(ang * 3 + x0) * 1.2 + Math.cos(ang * 5 + z0) * 0.8, d = Math.hypot(dx, dz);
      if (d > edge) continue;
      const depth = Math.round(2 + (edge - d) * (rockRich ? 1.5 : 1.3) + rng() * 2);
      for (let k = 0; k <= depth; k++) {
        let b = k === 0 ? "grass_block" : k <= 2 ? "dirt" : ROCK[Math.floor(rng() * ROCK.length)];
        if (k > 2 && (k + Math.round(d)) % 7 === 0) b = rng() < 0.5 ? "hardened_clay" : "brown_terracotta";      // the red-brown bands of the picture
        if (k > depth - 2 && k > 3) b = rng() < 0.5 ? "gravel" : "coarse_dirt";
        if (k > 3 && rng() < 0.015) b = rng() < 0.5 ? "coal_ore" : "iron_ore";
        put(x0 + dx, top - k, z0 + dz, b);
      }
    }
  };
  const tree = (x, z, top, rng) => {
    const h = 4 + Math.floor(rng() * 2);
    for (let y = 1; y <= h; y++) put(x, top + y, z, "oak_log", { pillar_axis: "y" });
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = h - 1; dy <= h + 2; dy++) {
      const d = Math.abs(dx) + Math.abs(dz) + (dy - h) * 0.8; if (d > 3.2 || (dx === 0 && dz === 0 && dy <= h) || rng() < 0.1) continue;
      put(x + dx, top + dy, z + dz, "oak_leaves", { persistent_bit: true });
    }
  };
  const spire = (x, z, top, h, ladder) => {
    for (let y = 1; y <= h; y++) for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      if (y > h - 2 && (dx || dz)) continue;
      put(x + dx, top + y, z + dz, y % 4 === 0 ? "hardened_clay" : y % 4 === 1 ? "stone_bricks" : (dx + dz) % 2 ? "cobblestone" : "andesite");
    }
    if (ladder) for (let y = 1; y <= h - 2; y++) put(x - 1, top + y, z, "ladder", { facing_direction: 4 });
  };
  const chest = (x, y, z, face, tier, i) => { put(x, y, z, "chest", { "minecraft:cardinal_direction": face }); chests.push({ x, y, z, tier, i }); };

  // ---- the player islands (every one a bit different: size, height, the side of the tree)
  L.islands.forEach((is, i) => {
    const rng = rngOf(7000 + i), ix = is.x, iz = is.z, T = is.top, ca = Math.cos(is.a), sa = Math.sin(is.a);
    blob(ix, iz, is.size, T, rng, false);
    const tx = -Math.round(ca), tz = -Math.round(sa);                                 // towards the centre
    for (let k = -is.size + 1; k <= 2; k++) { const x = ix + Math.round(ca * k), z = iz + Math.round(sa * k); if (C.id(x, T, z) === "grass_block") put(x, T, z, "sand"); }   // a sand path to the edge facing the middle
    const flip = i % 2 ? 1 : -1, side = [Math.round(-sa * 3 * flip), Math.round(ca * 3 * flip)];
    tree(ix + side[0], iz + side[1], T, rng);
    spire(ix - side[0] + Math.round(ca * 2), iz - side[1] + Math.round(sa * 2), T, 4 + Math.floor(rng() * 3), false);
    const back = [Math.round(ca * 3), Math.round(sa * 3)];                           // the chests stand behind the spawn (away from the middle)
    chest(ix + back[0] + Math.round(-sa), T + 1, iz + back[1] + Math.round(ca), dirOf(tx, tz), "island", i);
    chest(ix + back[0] - Math.round(-sa), T + 1, iz + back[1] - Math.round(ca), dirOf(tx, tz), "island", i);
    spawns.push({ x: ix - Math.round(ca), y: T + 1, z: iz - Math.round(sa) });
    if (rng() < 0.8) put(ix + side[0] - Math.round(ca * 2), T + 1, iz + side[1] - Math.round(sa * 2), "short_grass", undefined, true);
  });
  yield;

  // ---- the middle islands: small, a bit higher, 2 chests with good loot
  L.mids.forEach((m, i) => {
    const rng = rngOf(5100 + i), T = m.top;
    blob(m.x, m.z, m.size, T, rng, true);
    put(m.x, T + 1, m.z, "mossy_cobblestone"); put(m.x, T + 2, m.z, "cobblestone_wall"); put(m.x, T + 3, m.z, "lantern", { hanging: false }, true);
    const px = -Math.round(Math.sin(m.a) * 2), pz = Math.round(Math.cos(m.a) * 2), tx = -Math.round(Math.cos(m.a)), tz = -Math.round(Math.sin(m.a));
    chest(m.x + px, T + 1, m.z + pz, dirOf(tx, tz), "mid", 100 + i);
    chest(m.x - px, T + 1, m.z - pz, dirOf(tx, tz), "mid", 100 + i);
  });
  yield;

  // ---- the centre island: rocky, 4 spires with ladders, a raised middle with the best chests
  { const rng = rngOf(4242);
    blob(0, 0, 10, TOP, rng, true);
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) { if (C.id(x, TOP, z) !== "grass_block") continue; if ((Math.abs(x) <= 1 || Math.abs(z) <= 1) && Math.hypot(x, z) > 3) put(x, TOP, z, "sand"); }   // paths
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const r = Math.max(Math.abs(x), Math.abs(z)); put(x, TOP + 1, z, r === 3 ? "stone_brick_slab" : "stone_bricks", r === 3 ? { "minecraft:vertical_half": "bottom" } : undefined); if (r <= 1) put(x, TOP + 2, z, "chiseled_stone_bricks"); }
    chest(0, TOP + 3, -1, "south", "center", 200); chest(0, TOP + 3, 1, "north", "center", 200); chest(-1, TOP + 3, 0, "east", "center", 200); chest(1, TOP + 3, 0, "west", "center", 200);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      spire(sx * 6, sz * 6, TOP, 10 + Math.floor(rng() * 5), true);
      chest(sx * 4, TOP + 1, sz * 4, dirOf(-sx, -sz), "center", 200);
      put(sx * 3, TOP + 1, sz * 7, "mossy_cobblestone"); put(sx * 7, TOP + 1, sz * 3, "cobblestone_wall"); put(sx * 7, TOP + 2, sz * 3, "torch", undefined, true);
    }
    put(4, TOP + 1, 0, "enchanting_table"); put(-4, TOP + 1, 0, "anvil", { "minecraft:cardinal_direction": "north" });
    put(0, TOP + 1, 4, "crafting_table"); put(0, TOP + 1, -4, "furnace", { "minecraft:cardinal_direction": "south" });
  }
  return { canvas: C, chests, spawns, L };
}
/** the locker room (barrels in barriers, under the ground): [{ x, y, z, id, st }] */
export function lockerBlocks() {
  const out = [];
  for (let x = -12; x <= 11; x++) for (let z = -1; z <= 3; z++) for (let y = -3; y <= -1; y++) out.push({ x, y, z, id: "barrier" });
  for (let k = 0; k < 40; k++) { const l = lockerAt(k); out.push({ ...l, id: "barrel", st: { facing_direction: 1, open_bit: false } }); }
  return out;
}
