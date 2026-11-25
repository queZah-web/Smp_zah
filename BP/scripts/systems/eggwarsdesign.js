// =====================================================================================================================
// EGG WARS DESIGN - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   Floating islands in the sky (the floors at y +60 over the place where the Owner stood), tidy and all the same height:
//     * 10 (or 20) PLAYER islands in a ring, each in its own COLOUR (red, blue, lime ...):
//         - a stone-brick floor with a cross of the player's colour, grass corners with flowers, a hanging rock under it
//           with a band of the player's colour
//         - at the back the EGG SHRINE: a black pedestal for the egg, 4 coloured pillars with sea lanterns, a coloured
//           glass roof with a beacon base on top (the dragon egg + the beacon are put there when a game starts: the beam
//           in the player's colour shows from far away that his egg is alive)
//         - the IRON generator (iron block) and the GOLD generator (gold block) in the front, the SHOP (a villager under a
//           coloured market roof) on one side, a small tree on the other side, the spawn in the middle
//     * 4 MIDDLE islands with a DIAMOND generator each (between the ring and the centre)
//     * the CENTRE island: a quartz floor, a tall beacon tower, 2 diamond + 2 gold generators
//   Under the arena, buried in the ground and closed with barrier blocks: the LOCKERS (2 barrels per player).
// =====================================================================================================================
import { BigCanvas } from "./celestialdesign.js";

export const TOP = 60;                                   // y of the island floors
//      key           name          chat  concrete / main block        wool              glass                          terracotta
export const COLORS = [
  ["red", "Red", "§c", "red_concrete", "red_wool", "red_stained_glass", "red_terracotta"],
  ["blue", "Blue", "§9", "blue_concrete", "blue_wool", "blue_stained_glass", "blue_terracotta"],
  ["lime", "Lime", "§a", "lime_concrete", "lime_wool", "lime_stained_glass", "lime_terracotta"],
  ["yellow", "Yellow", "§e", "yellow_concrete", "yellow_wool", "yellow_stained_glass", "yellow_terracotta"],
  ["cyan", "Cyan", "§3", "cyan_concrete", "cyan_wool", "cyan_stained_glass", "cyan_terracotta"],
  ["orange", "Orange", "§6", "orange_concrete", "orange_wool", "orange_stained_glass", "orange_terracotta"],
  ["purple", "Purple", "§5", "purple_concrete", "purple_wool", "purple_stained_glass", "purple_terracotta"],
  ["aqua", "Light Blue", "§b", "light_blue_concrete", "light_blue_wool", "light_blue_stained_glass", "light_blue_terracotta"],
  ["pink", "Pink", "§d", "pink_concrete", "pink_wool", "pink_stained_glass", "pink_terracotta"],
  ["white", "White", "§f", "white_concrete", "white_wool", "white_stained_glass", "white_terracotta"],
  ["green", "Green", "§2", "green_concrete", "green_wool", "green_stained_glass", "green_terracotta"],
  ["magenta", "Magenta", "§d", "magenta_concrete", "magenta_wool", "magenta_stained_glass", "magenta_terracotta"],
  ["gray", "Gray", "§8", "gray_concrete", "gray_wool", "gray_stained_glass", "gray_terracotta"],
  ["black", "Black", "§0", "black_concrete", "black_wool", "black_stained_glass", "black_terracotta"],
  ["brown", "Brown", "§6", "brown_concrete", "brown_wool", "brown_stained_glass", "brown_terracotta"],
  ["silver", "Silver", "§7", "light_gray_concrete", "light_gray_wool", "light_gray_stained_glass", "light_gray_terracotta"],
  ["gold", "Gold", "§p", "raw_gold_block", "yellow_wool", "yellow_stained_glass", "yellow_terracotta"],
  ["copper", "Copper", "§n", "waxed_copper", "orange_wool", "orange_stained_glass", "orange_terracotta"],
  ["amethyst", "Amethyst", "§u", "amethyst_block", "purple_wool", "purple_stained_glass", "purple_terracotta"],
  ["quartz", "Quartz", "§h", "quartz_block", "white_wool", "white_stained_glass", "white_terracotta"],
];

/** outward direction of an island snapped to the 4 sides (the islands are built square to the world: no holes) */
const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const snap = (a) => SIDES[((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4];

export function layout(n) {                              // n = 10 or 20 players
  const R = n > 10 ? 70 : 40, RM = n > 10 ? 38 : 22, islands = [], mids = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, x = Math.round(Math.cos(a) * R), z = Math.round(Math.sin(a) * R), o = snap(a);
    // local (u = to the right, v = to the back / away from the middle)  ->  world
    const w = (u, y, v) => ({ x: x + o[0] * v - o[1] * u, y: TOP + y, z: z + o[1] * v + o[0] * u });
    islands.push({
      i, x, z, a, o, col: COLORS[i % COLORS.length][0],
      spawn: w(0, 1, -1), egg: w(0, 2, 4), beacon: w(0, 7, 4), eggHolo: w(0, 9.9, 4),
      iron: w(-4, 1, -4), gold: w(4, 1, -4), trader: w(5, 1, 1), look: w(0, 1, -7),
    });
  }
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; mids.push({ x: Math.round(Math.cos(a) * RM), z: Math.round(Math.sin(a) * RM), gen: { x: Math.round(Math.cos(a) * RM), y: TOP + 1, z: Math.round(Math.sin(a) * RM) } }); }
  const center = { r: n > 10 ? 11 : 9, gens: [{ k: "diamond", x: 3, y: TOP + 1, z: 0 }, { k: "diamond", x: -3, y: TOP + 1, z: 0 }, { k: "gold", x: 0, y: TOP + 1, z: 3 }, { k: "gold", x: 0, y: TOP + 1, z: -3 }] };
  const HX = R + 12;
  return { n, R, RM, HX, UP: TOP + 30, DOWN: 4, islands, mids, center, voidY: TOP - 16, watch: { x: 0, y: TOP + 14, z: 0 } };
}
/** the locker barrels (2 per player), buried under the arena: relative positions */
export const lockerAt = (k) => ({ x: (k % 20) - 10, y: -2, z: k < 20 ? 0 : 2 });

const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const FACE = { "1,0": "east", "-1,0": "west", "0,1": "south", "0,-1": "north" };

/** the arena blocks: { canvas, L }  (eggs, villagers and holograms are added by the game) */
export function* eggGen(n) {
  const L = layout(n), C = new BigCanvas();
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  const ROCK = ["stone", "stone", "andesite", "cobblestone", "tuff", "stone", "andesite"];
  // a hanging rock under a floor cell: deeper in the middle
  const hang = (x, z, depth, rng, band) => {
    for (let k = 1; k <= depth; k++) {
      let b = ROCK[Math.floor(rng() * ROCK.length)];
      if (band && k === 2) b = band;
      else if (k > 3 && rng() < 0.04) b = rng() < 0.5 ? "iron_ore" : "coal_ore";
      if (k === depth && k > 3) b = rng() < 0.5 ? "gravel" : "cobblestone";
      put(x, TOP - k, z, b);
    }
  };

  // ---- the player islands
  L.islands.forEach((is) => {
    const rng = rngOf(3100 + is.i), c = COLORS[is.i % COLORS.length], o = is.o;
    const W = (u, y, v) => [is.x + o[0] * v - o[1] * u, TOP + y, is.z + o[1] * v + o[0] * u];
    const P = (u, y, v, id, st, late) => { const [x, yy, z] = W(u, y, v); put(x, yy, z, id, st, late); };
    const inIsle = (u, v) => (Math.abs(u) / 7.4) ** 3 + (Math.abs(v) / 7.4) ** 3 <= 1;
    for (let u = -8; u <= 8; u++) for (let v = -8; v <= 8; v++) {
      if (!inIsle(u, v)) continue;
      const edge = !inIsle(u + 1, v) || !inIsle(u - 1, v) || !inIsle(u, v + 1) || !inIsle(u, v - 1);
      const corner = Math.abs(u) >= 4 && Math.abs(v) >= 4;
      let b = (u + v) % 2 ? "stone_bricks" : "polished_andesite";
      if (u === 0 || v === -1) b = c[3];                                                   // the cross of the player's colour
      if (corner) b = "grass_block";
      if (edge) b = "stone_bricks";
      P(u, 0, v, b);
      const [x, , z] = W(u, 0, v), d = Math.hypot(u, v);
      hang(x, z, Math.max(2, Math.round(9 - d + rng() * 2)), rng, d < 6 ? c[6] : null);
      if (corner && !edge && rng() < 0.45) P(u, 1, v, rng() < 0.5 ? "short_grass" : rng() < 0.5 ? "poppy" : "dandelion", undefined, true);
    }
    // the egg shrine (back): pedestal, 4 pillars, a glass roof
    for (let u = -1; u <= 1; u++) for (let v = 3; v <= 5; v++) P(u, 1, v, u === 0 && v === 4 ? "obsidian" : "polished_blackstone_bricks");
    for (const [u, v] of [[-2, 2], [2, 2], [-2, 6], [2, 6]]) { for (let y = 1; y <= 4; y++) P(u, y, v, y === 4 ? "sea_lantern" : c[3]); }
    for (let u = -2; u <= 2; u++) for (let v = 2; v <= 6; v++) P(u, 5, v, Math.abs(u) === 2 || v === 2 || v === 6 ? c[3] : c[5]);
    // on the roof: the base of the BEACON (the beacon itself is put there when a game starts: its beam in the player's colour = the egg is alive)
    for (let u = -1; u <= 1; u++) for (let v = 3; v <= 5; v++) P(u, 6, v, "iron_block");
    P(0, 8, 4, c[5]);
    // the generators (front): iron left, gold right, a lantern on a post next to each
    P(-4, 1, -4, "iron_block"); P(4, 1, -4, "gold_block");
    P(-5, 1, -5, "polished_blackstone_wall|cobblestone_wall"); P(-5, 2, -5, "lantern", { hanging: false }, true);
    P(5, 1, -5, "polished_blackstone_wall|cobblestone_wall"); P(5, 2, -5, "lantern", { hanging: false }, true);
    // the shop (right): a coloured market roof on fences, a barrel and a crafting table as the counter
    for (const [u, v] of [[4, 0], [6, 0], [4, 2], [6, 2]]) { P(u, 1, v, "oak_fence"); P(u, 2, v, "oak_fence"); }
    for (let u = 3; u <= 7; u++) for (let v = -1; v <= 3; v++) if ((Math.abs(u - 5) <= 2 && Math.abs(v - 1) <= 2) && inIsle(u, v)) P(u, 3, v, (u + v) % 2 ? c[4] : "white_wool");
    P(6, 1, 1, "barrel", { facing_direction: 1, open_bit: false });
    // the tree (left)
    { const tu = -5, tv = 1;
      for (let y = 1; y <= 4; y++) P(tu, y, tv, "oak_log", { pillar_axis: "y" });
      for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) for (let y = 3; y <= 6; y++) {
        const dd = Math.abs(du) + Math.abs(dv) + (y - 4) * 0.9; if (dd > 3.1 || (du === 0 && dv === 0 && y <= 4) || !inIsle(tu + du, tv + dv) || rng() < 0.08) continue;
        P(tu + du, y, tv + dv, "oak_leaves", { persistent_bit: true });
      }
    }
  });
  yield;

  // ---- the middle islands: a diamond generator each
  L.mids.forEach((m, k) => {
    const rng = rngOf(5200 + k);
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const d = Math.hypot(dx, dz); if (d > 4.6) continue;
      put(m.x + dx, TOP, m.z + dz, d > 3.6 ? "mossy_stone_bricks" : (dx + dz) % 2 ? "stone_bricks" : "cracked_stone_bricks");
      hang(m.x + dx, m.z + dz, Math.max(2, Math.round(7 - d + rng() * 2)), rng, null);
    }
    put(m.x, TOP + 1, m.z, "diamond_block");
    for (const [dx, dz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) { put(m.x + dx, TOP + 1, m.z + dz, "stone_brick_wall|cobblestone_wall"); put(m.x + dx, TOP + 2, m.z + dz, "soul_lantern|lantern", { hanging: false }, true); }
  });
  yield;

  // ---- the centre island: quartz floor, the beacon tower, 2 diamond + 2 gold generators
  { const rng = rngOf(4343), r = L.center.r;
    for (let dx = -r - 1; dx <= r + 1; dx++) for (let dz = -r - 1; dz <= r + 1; dz++) {
      const d = Math.hypot(dx, dz); if (d > r + 0.4) continue;
      let b = d > r - 1 ? "chiseled_quartz_block" : Math.round(d) % 3 === 0 ? "smooth_quartz" : "quartz_block";
      if ((dx === 0 || dz === 0) && d > 5) b = "polished_blackstone_bricks";
      put(dx, TOP, dz, b);
      hang(dx, dz, Math.max(3, Math.round(r + 3 - d + rng() * 2)), rng, d < r - 2 ? "light_blue_terracotta" : null);
    }
    for (let y = 1; y <= 8; y++) for (const [dx, dz] of [[0, 0]]) put(dx, TOP + y, dz, y === 8 ? "beacon" : y % 3 === 0 ? "sea_lantern" : "quartz_pillar", y === 8 || y % 3 === 0 ? undefined : { pillar_axis: "y" });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = 1; y <= 3; y++) put(dx, TOP + y, dz, y === 3 ? "quartz_slab|smooth_quartz_slab" : "quartz_block", y === 3 ? { "minecraft:vertical_half": "bottom" } : undefined);
    for (const g of L.center.gens) put(g.x, g.y, g.z, g.k === "diamond" ? "diamond_block" : "gold_block");
    for (const [dx, dz] of [[5, 5], [-5, 5], [5, -5], [-5, -5]]) { for (let y = 1; y <= 3; y++) put(dx, TOP + y, dz, y === 3 ? "sea_lantern" : "quartz_pillar", y === 3 ? undefined : { pillar_axis: "y" }); }
  }
  return { canvas: C, L };
}
/** the locker room (barrels in barriers, under the ground): [{ x, y, z, id, st }] */
export function lockerBlocks() {
  const out = [];
  for (let x = -12; x <= 11; x++) for (let z = -1; z <= 3; z++) for (let y = -3; y <= -1; y++) out.push({ x, y, z, id: "barrier" });
  for (let k = 0; k < 40; k++) { const l = lockerAt(k); out.push({ ...l, id: "barrel", st: { facing_direction: 1, open_bit: false } }); }
  return out;
}
export const faceOf = (o) => FACE[o.join(",")] ?? "north";
