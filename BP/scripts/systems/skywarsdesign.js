// =====================================================================================================================
// SKY WARS DESIGN - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   Floating islands in the sky (the tops at y +60 over the place where the Owner stood):
//     * the CENTRE island (radius ~13): grass + sand paths, rocky ground, 4 stone spires with terracotta bands and
//       ladders (like the picture), a raised middle with the 4 best chests, 4 more chests around, an enchanting corner
//     * 10 (or 20) PLAYER islands in a ring around it, every island 32 blocks from the next one: grass top, dirt, a stone /
//       andesite / granite underside that hangs down like a rock, a small tree, a rock spire, 2 chests, the spawn point
//   Under the arena, buried in the ground and closed with barrier blocks: the LOCKERS (2 barrels per player) where the
//   players' own things wait during a game (nobody can reach them).
// =====================================================================================================================
import { BigCanvas } from "./celestialdesign.js";

export const TOP = 60;                       // y of the grass on the islands
export function layout(n) {                  // n = 10 or 20 players
  const R = Math.round(32 / (2 * Math.sin(Math.PI / n)));            // the islands are 32 blocks apart (neighbour to neighbour)
  const islands = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; islands.push({ x: Math.round(Math.cos(a) * R), z: Math.round(Math.sin(a) * R), a }); }
  const HX = R + 12;
  return { n, R, HX, UP: TOP + 34, DOWN: 4, islands, voidY: TOP - 18, center: { x: 0, y: TOP + 1, z: 0 } };
}
/** the locker barrels (2 per player), buried under the arena: relative positions */
export const lockerAt = (k) => ({ x: (k % 20) - 10, y: -2, z: k < 20 ? 0 : 2 });

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? "east" : "west") : (vz > 0 ? "south" : "north"));

/** the islands (blocks) + the chests [{ x, y, z, tier }] + the spawn points [{ x, y, z }] */
export function* skyGen(n) {
  const L = layout(n), C = new BigCanvas(), chests = [], spawns = [];
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const ROCK = ["stone", "stone", "andesite", "cobblestone", "stone", "granite", "tuff"];
  // one irregular island: top at TOP, hanging rock under it
  const blob = (x0, z0, r, rng, rockRich) => {
    for (let dx = -r - 2; dx <= r + 2; dx++) for (let dz = -r - 2; dz <= r + 2; dz++) {
      const ang = Math.atan2(dz, dx), edge = r + Math.sin(ang * 3 + x0) * 1.2 + Math.cos(ang * 5 + z0) * 0.8, d = Math.hypot(dx, dz);
      if (d > edge) continue;
      const depth = Math.round(3 + (edge - d) * (rockRich ? 1.5 : 1.2) + rng() * 2);
      for (let k = 0; k <= depth; k++) {
        const y = TOP - k;
        let b = k === 0 ? "grass_block" : k <= 2 ? "dirt" : ROCK[Math.floor(rng() * ROCK.length)];
        if (k > 2 && (k + Math.round(d)) % 7 === 0) b = rng() < 0.5 ? "hardened_clay" : "brown_terracotta";      // the red-brown bands of the picture
        if (k > depth - 2 && k > 3) b = rng() < 0.5 ? "gravel" : "coarse_dirt";
        put(x0 + dx, y, z0 + dz, b);
      }
    }
  };
  const tree = (x, z, rng) => {
    for (let y = 1; y <= 4; y++) put(x, TOP + y, z, "oak_log", { pillar_axis: "y" });
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 6; dy++) {
      const d = Math.abs(dx) + Math.abs(dz) + (dy - 4) * 0.8; if (d > 3.2 || (dx === 0 && dz === 0 && dy < 5) || rng() < 0.1) continue;
      put(x + dx, TOP + dy, z + dz, "oak_leaves", { persistent_bit: true });
    }
  };
  const spire = (x, z, h, ladder) => {
    for (let y = 1; y <= h; y++) for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      if (y > h - 2 && (dx || dz)) continue;
      put(x + dx, TOP + y, z + dz, y % 4 === 0 ? "hardened_clay" : y % 4 === 1 ? "stone_bricks" : (dx + dz) % 2 ? "cobblestone" : "andesite");
    }
    if (ladder) for (let y = 1; y <= h - 2; y++) put(x - 1, TOP + y, z, "ladder", { facing_direction: 4 });
  };
  const chest = (x, y, z, face, tier) => { put(x, y, z, "chest", { "minecraft:cardinal_direction": face }); chests.push({ x, y, z, tier }); };

  // ---- the player islands
  L.islands.forEach((is, i) => {
    const rng = rngOf(7000 + i), ix = is.x, iz = is.z;
    blob(ix, iz, 6, rng, false);
    const tx = -Math.round(Math.cos(is.a)), tz = -Math.round(Math.sin(is.a));          // towards the centre
    for (let k = -4; k <= 3; k++) { const x = ix + Math.round(Math.cos(is.a) * -k), z = iz + Math.round(Math.sin(is.a) * -k); if (C.id(x, TOP, z) === "grass_block") put(x, TOP, z, "sand"); }   // a sand path to the edge facing the middle
    const side = [Math.round(-Math.sin(is.a) * 3), Math.round(Math.cos(is.a) * 3)];
    tree(ix + side[0], iz + side[1], rng);
    spire(ix - side[0] - Math.round(Math.cos(is.a) * 2), iz - side[1] - Math.round(Math.sin(is.a) * 2), 5 + Math.floor(rng() * 3), false);
    const back = [Math.round(Math.cos(is.a) * 3), Math.round(Math.sin(is.a) * 3)];       // the chests stand behind the spawn (away from the middle)
    chest(ix + back[0] + Math.round(-Math.sin(is.a)), TOP + 1, iz + back[1] + Math.round(Math.cos(is.a)), dirOf(tx, tz), "island");
    chest(ix + back[0] - Math.round(-Math.sin(is.a)), TOP + 1, iz + back[1] - Math.round(Math.cos(is.a)), dirOf(tx, tz), "island");
    spawns.push({ x: ix, y: TOP + 1, z: iz });
    if (rng() < 0.8) put(ix - side[0], TOP + 1, iz - side[1], "short_grass", undefined, true);
  });
  yield;

  // ---- the centre island: rocky, 4 spires with ladders, a raised middle with the best chests
  { const rng = rngOf(4242);
    blob(0, 0, 13, rng, true);
    for (let x = -13; x <= 13; x++) for (let z = -13; z <= 13; z++) { if (C.id(x, TOP, z) !== "grass_block") continue; if ((Math.abs(x) <= 1 || Math.abs(z) <= 1) && Math.hypot(x, z) > 3) put(x, TOP, z, "sand"); }   // paths
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const r = Math.max(Math.abs(x), Math.abs(z)); put(x, TOP + 1, z, r === 3 ? "stone_brick_slab" : "stone_bricks", r === 3 ? { "minecraft:vertical_half": "bottom" } : undefined); if (r <= 1) put(x, TOP + 2, z, "chiseled_stone_bricks"); }
    chest(0, TOP + 3, -1, "south", "center"); chest(0, TOP + 3, 1, "north", "center"); chest(-1, TOP + 3, 0, "east", "center"); chest(1, TOP + 3, 0, "west", "center");
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      spire(sx * 8, sz * 8, 10 + Math.floor(rng() * 5), true);
      chest(sx * 6, TOP + 1, sz * 6, dirOf(-sx, -sz), "center");
      put(sx * 5, TOP + 1, sz * 9, "mossy_cobblestone"); put(sx * 9, TOP + 1, sz * 5, "cobblestone_wall"); put(sx * 9, TOP + 2, sz * 5, "torch", undefined, true);
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
