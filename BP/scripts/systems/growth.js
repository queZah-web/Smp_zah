// FAST GROWTH for lands (/land -> a land -> Fast Growth).  Only things INSIDE a land that has growth time left grow faster.
// Every GROW_EVERY ticks each such land is scanned (engine-side block search, only for plant blocks) and every plant gets a chance
// to move up ONE growth stage.  The chance is chosen so that the average growth time is the vanilla time divided by the level's speed:
//     chance per scan = (speed - 1) * scan seconds / vanilla seconds per stage      (vanilla growth keeps running as usual)
// Plants: crops, stems, nether wart, cocoa, sugar cane, cactus, bamboo, SAPLINGS (they become a real tree).   Animals: BABY animals inside the land grow up faster
//   (the Bedrock script API cannot change the breeding cool-down of adult animals - that stays vanilla).
// Safe by design: nothing outside the land is touched, nothing happens without paid time, a failed change is skipped,
// a scan never handles more than MAX_PER_SCAN blocks, and the land is only scanned while a player is near it (loaded chunks).
import * as MC from "@minecraft/server";
const { world, system } = MC;
import { allClaims, growLevel, growOf } from "./landcore.js";

export const GROW_EVERY = 100;                    // ticks between scans (5 s)
const SCAN_SECONDS = GROW_EVERY / 20;
const MAX_PER_SCAN = 2500;
const NEAR = 128;                                 // a player must be this close (blocks) to the land for it to be scanned
const BAMBOO_MAX = 12, CANE_MAX = 3, BABY_SECONDS = 1200;       // max heights | vanilla time for a baby animal to grow up (20 min)

// type -> { state, max, sec: vanilla seconds per growth stage (average), kind }
const WHEAT = { state: "growth", max: 7, sec: 214 };           // ~25 min seed -> ripe
export const CROPS = {
  "minecraft:wheat": WHEAT, "minecraft:carrots": WHEAT, "minecraft:potatoes": WHEAT, "minecraft:beetroot": WHEAT,
  "minecraft:melon_stem": WHEAT, "minecraft:pumpkin_stem": WHEAT,                  // stems grow; the fruit still appears the vanilla way
  "minecraft:nether_wart": { state: "age", max: 3, sec: 400 },
  "minecraft:cocoa": { state: "age", max: 2, sec: 450 },
  "minecraft:reeds": { state: "age", max: 15, sec: 64, kind: "tall", block: "minecraft:reeds", high: CANE_MAX },     // sugar cane
  "minecraft:cactus": { state: "age", max: 15, sec: 64, kind: "tall", block: "minecraft:cactus", high: CANE_MAX, sides: true },
  "minecraft:bamboo": { kind: "bamboo", sec: 200 },
  // saplings: 1st stage = the sapling "ages" (age_bit), 2nd stage = it grows into a tree (built here, only when there is room and only inside the land)
  // more plants (v137): berries, ancient flowers, bamboo shoots, mangrove + fungi trees.  "auto" = the top stage is read from the game
  "minecraft:sweet_berry_bush": { state: "growth", max: 3, sec: 300 },
  "minecraft:torchflower_crop": { state: "growth", max: 1, auto: true, sec: 300 },
  "minecraft:pitcher_crop": { state: "growth", max: 4, auto: true, sec: 300 },
  "minecraft:bamboo_sapling": { kind: "bsapling", sec: 120 },
  "minecraft:mangrove_propagule": { kind: "sapling", direct: true, tree: "mangrove", sec: 300 },
  "minecraft:crimson_fungus": { kind: "sapling", direct: true, tree: "crimson", below: /nylium$/, sec: 300 },
  "minecraft:warped_fungus": { kind: "sapling", direct: true, tree: "warped", below: /nylium$/, sec: 300 },
  "minecraft:sapling": { kind: "sapling", sec: 240 }, "minecraft:cherry_sapling": { kind: "sapling", sec: 240, tree: "cherry" }, "minecraft:pale_oak_sapling": { kind: "sapling", sec: 240, tree: "pale_oak" },
};
// tree kind -> [log, leaves, min trunk, max trunk, shape].  Dark oak (one sapling) is built as a small tree too.
const TREES = {
  oak: ["oak_log", "oak_leaves", 4, 6, "round"], birch: ["birch_log", "birch_leaves", 5, 7, "round"], jungle: ["jungle_log", "jungle_leaves", 5, 8, "round"],
  spruce: ["spruce_log", "spruce_leaves", 6, 9, "cone"], acacia: ["acacia_log", "acacia_leaves", 4, 6, "flat"],
  dark_oak: ["dark_oak_log", "dark_oak_leaves", 5, 7, "round"], mangrove: ["mangrove_log", "mangrove_leaves", 5, 8, "round"],
  crimson: ["crimson_stem", "nether_wart_block", 4, 7, "round"], warped: ["warped_stem", "warped_wart_block", 4, 7, "round"],
  cherry: ["cherry_log", "cherry_leaves", 4, 6, "round"], pale_oak: ["pale_oak_log", "pale_oak_leaves", 4, 6, "round"],
};
const FILTER = { includeTypes: Object.keys(CROPS) };
const ANIMALS = new Set(["cow", "mooshroom", "sheep", "pig", "chicken", "horse", "donkey", "mule", "llama", "goat", "rabbit", "cat", "wolf", "camel", "turtle", "panda", "fox", "sniffer", "ocelot", "axolotl", "armadillo"].map((t) => "minecraft:" + t));

/** chance (0..1) that ONE plant of this type moves up one stage in one scan, at speed x */
export const chanceFor = (type, x) => { const c = CROPS[type]; return c ? Math.max(0, Math.min(1, ((x - 1) * SCAN_SECONDS) / c.sec)) : 0; };
/** chance that ONE baby animal grows up in one scan, at speed x */
export const babyChance = (x) => Math.max(0, Math.min(1, ((x - 1) * SCAN_SECONDS) / BABY_SECONDS));

const airish = (b) => !!b && (b.typeId === "minecraft:air" || /_leaves$/.test(b.typeId));
const air = (b) => !!b && b.typeId === "minecraft:air";
/** how many blocks of this plant are stacked at and below this block */
function heightAt(dim, b, type) {
  let h = 1;
  for (let i = 1; i < 20; i++) { const d = dim.getBlock({ x: b.x, y: b.y - i, z: b.z }); if (d && d.typeId === type) h++; else break; }
  return h;
}

/** a sapling that already aged becomes a small tree of its kind (false = no room / unknown kind / would leave the land) */
function growTree(block, def, box) {
  let kind = def.tree; if (!kind) { try { kind = block.permutation.getState("sapling_type"); } catch (e) { kind = null; } }
  const t = TREES[kind]; if (!t) return false;
  const dim = block.dimension, bx = block.x, by = block.y, bz = block.z, h = t[2] + Math.floor(Math.random() * (t[3] - t[2] + 1));
  const okPos = (x, y, z) => !box || inBox(box, { x, y, z });
  const cells = [];                                                            // leaves: [dx, dy, dz]
  for (let dy = (t[4] === "cone" ? 2 : h - 3); dy <= h; dy++) {
    let r;
    if (t[4] === "cone") { const k = h - dy; r = k === 0 ? 0 : k % 2 === 1 ? 1 : 2; }
    else if (t[4] === "flat") r = dy >= h - 1 ? (dy === h ? 1 : 2) : 0;
    else r = dy >= h - 1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;       // round the corners
      if (dx === 0 && dz === 0 && dy < h) continue;                              // the trunk
      cells.push([dx, dy, dz]);
    }
  }
  for (let i = 0; i < h; i++) { if (!okPos(bx, by + i, bz)) return false; if (i > 0 && !airish(dim.getBlock({ x: bx, y: by + i, z: bz }))) return false; }
  for (const [dx, dy, dz] of cells) if (!okPos(bx + dx, by + dy, bz + dz)) return false;
  for (let i = 0; i < h; i++) dim.getBlock({ x: bx, y: by + i, z: bz })?.setType("minecraft:" + t[0]);
  for (const [dx, dy, dz] of cells) { const b = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz }); if (b && b.typeId === "minecraft:air") b.setType("minecraft:" + t[1]); }
  return true;
}

/** top growth stage of a crop (some stages are read from the game) */
export function maxOf(def) {
  if (def.auto) { try { const v = (MC.BlockStates.get(def.state)?.validValues ?? []).filter((n) => typeof n === "number"); if (v.length) return Math.max(...v); } catch (e) { /* use the default */ } }
  return def.max ?? 0;
}
const FRUIT = { "minecraft:melon_stem": "minecraft:melon_block", "minecraft:pumpkin_stem": "minecraft:pumpkin" };
const SOIL = /(dirt|grass_block|farmland|podzol|mycelium|moss_block|mud)$/;

/** growth progress 0..100 of one plant (whole stages only) */
export function progress(b, def) {
  try {
    const type = b.typeId, perm = b.permutation;
    if (def.kind === "bamboo") return Math.min(100, ((heightAt(b.dimension, b, type) - 1) / (BAMBOO_MAX - 1)) * 100);
    if (def.kind === "bsapling" || def.direct) return 0;
    if (def.kind === "sapling") return perm.getState("age_bit") === true ? 50 : 0;
    const v = perm.getState(def.state); if (typeof v !== "number") return 0;
    if (def.kind === "tall") { const per = def.max + 1, total = def.high * per; return Math.min(100, (((heightAt(b.dimension, b, type) - 1) * per + v) / total) * 100); }
    const max = maxOf(def); return max ? Math.min(100, (v / max) * 100) : 0;
  } catch (e) { return 0; }
}

/** a fully grown melon / pumpkin stem puts its fruit on a free soil block next to it (inside the land) */
function fruitFor(block, type, box) {
  const dim = block.dimension, fruit = FRUIT[type]; if (!fruit) return false;
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]], free = [];
  for (const [dx, dz] of sides) {
    const n = dim.getBlock({ x: block.x + dx, y: block.y, z: block.z + dz }); if (!n) continue;
    if (n.typeId === fruit) return false;                                   // it already has its fruit
    const g = dim.getBlock({ x: n.x, y: n.y - 1, z: n.z });
    if (air(n) && g && SOIL.test(g.typeId) && (!box || inBox(box, n))) free.push(n);
  }
  if (!free.length) return false;
  free[Math.floor(Math.random() * free.length)].setType(fruit);
  return true;
}

export function bump(block, def, box) {
  const dim = block.dimension, type = block.typeId, up = dim.getBlock({ x: block.x, y: block.y + 1, z: block.z });
  if (!air(up)) return false;                                       // only the top block of a tall plant grows
  if (def.kind === "bamboo") {
    if (heightAt(dim, block, type) >= BAMBOO_MAX) return false;
    up.setType(type);
    try { up.setPermutation(up.permutation.withState("bamboo_leaf_size", "small_leaves")); } catch (e) { /* the default look is fine */ }
    return true;
  }
  if (def.kind === "bsapling") { block.setType("minecraft:bamboo"); return true; }          // a bamboo shoot becomes a real bamboo
  if (def.kind === "sapling") {
    if (def.direct) {                                               // propagule / fungus: one stage, straight to a tree
      if (block.permutation.getState("hanging") === true) return false;
      if (def.below) { const g = dim.getBlock({ x: block.x, y: block.y - 1, z: block.z }); if (!g || !def.below.test(g.typeId)) return false; }
      return growTree(block, def, box);
    }
    const age = block.permutation.getState("age_bit");
    if (!age) { block.setPermutation(block.permutation.withState("age_bit", true)); return true; }
    return growTree(block, def, box);
  }
  const perm = block.permutation, v = perm.getState(def.state), max = maxOf(def);
  if (typeof v !== "number") return false;
  if (def.kind !== "tall") {
    if (v >= max) return FRUIT[type] ? fruitFor(block, type, box) : false;    // fully grown (a stem then makes its fruit)
    block.setPermutation(perm.withState(def.state, Math.min(max, v + 1))); return true;
  }
  // sugar cane / cactus: the age counts up, at the top age a new block grows on top (only while shorter than 3)
  if (v < def.max) { block.setPermutation(perm.withState(def.state, v + 1)); return true; }
  if (heightAt(dim, block, type) >= def.high) { block.setPermutation(perm.withState(def.state, 0)); return false; }     // like vanilla: the age restarts
  if (def.sides) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (!air(dim.getBlock({ x: block.x + dx, y: block.y + 1, z: block.z + dz }))) return false; }   // cactus never grows next to blocks
  up.setType(type);
  block.setPermutation(perm.withState(def.state, 0));
  return true;
}

/** like bump(), but also says HOW MUCH the plant's growth rose: { ok, delta (percent points), fruit } */
export function bumpInfo(block, def, box) {
  const dim = block.dimension, type = block.typeId, loc = { x: block.x, y: block.y, z: block.z };
  const before = progress(block, def);
  let ok = false; try { ok = bump(block, def, box); } catch (e) { ok = false; }
  if (!ok) return { ok: false, delta: 0, fruit: false };
  let after = 100;
  try {
    let b2 = dim.getBlock(loc);
    if (def.kind === "tall" || def.kind === "bamboo") { const t = dim.getBlock({ x: loc.x, y: loc.y + 1, z: loc.z }); if (t && t.typeId === type) b2 = t; }
    if (b2 && b2.typeId === type) after = progress(b2, def);
  } catch (e) { /* the plant turned into something else: it is done */ }
  const fruit = !!FRUIT[type] && before >= 100;
  return { ok: true, delta: fruit ? 0 : Math.max(0, after - before), fruit };
}
export const inBox = (c, l) => l.x >= c.x1 && l.x <= c.x2 && l.y >= c.y1 && l.y <= c.y2 && l.z >= c.z1 && l.z <= c.z2;

function scan(c, x) {
  const dim = world.getDimension(c.d);
  const vol = new MC.BlockVolume({ x: c.x1, y: c.y1, z: c.z1 }, { x: c.x2, y: c.y2, z: c.z2 });
  let n = 0;
  for (const l of dim.getBlocks(vol, FILTER, false).getBlockLocationIterator()) {
    if (++n > MAX_PER_SCAN) break;
    if (!inBox(c, l)) continue;                                     // never outside the land
    try {
      const b = dim.getBlock(l); if (!b) continue;
      const def = CROPS[b.typeId]; if (!def) continue;
      if (Math.random() < chanceFor(b.typeId, x)) bump(b, def, c);
    } catch (e) { /* skip this block */ }
  }
}

function scanAnimals(c, x) {
  const dim = world.getDimension(c.d), p = babyChance(x);
  const size = { x: c.x2 - c.x1 + 1, y: c.y2 - c.y1 + 1, z: c.z2 - c.z1 + 1 };
  let list = [];
  try { list = dim.getEntities({ location: { x: c.x1, y: c.y1, z: c.z1 }, volume: size }); } catch (e) { return; }
  let n = 0;
  for (const e of list) {
    if (++n > 300) break;
    try {
      if (!e.isValid || !ANIMALS.has(e.typeId) || !inBox(c, e.location)) continue;
      if (!e.getComponent("minecraft:is_baby")) continue;
      if (Math.random() < p) e.getComponent("minecraft:ageable")?.growUp();
    } catch (err) { /* skip this animal */ }
  }
}

const near = (c, players) => {
  const cx = (c.x1 + c.x2) / 2, cz = (c.z1 + c.z2) / 2;
  return players.some((p) => { try { return p.dimension.id === c.d && Math.abs(p.location.x - cx) <= NEAR && Math.abs(p.location.z - cz) <= NEAR; } catch (e) { return false; } });
};

system.runInterval(() => {
  try {
    const players = world.getAllPlayers();
    if (!players.length) return;
    for (const c of allClaims()) {
      const lv = growLevel(c); if (!lv) continue;
      if (!near(c, players)) continue;
      const x = growOf(lv).x;
      try { scan(c, x); } catch (e) { /* unloaded area or API refused: try again next time */ }
      try { scanAnimals(c, x); } catch (e) { /* ignore */ }
    }
  } catch (e) { console.warn("[growth] " + e); }
}, GROW_EVERY);
