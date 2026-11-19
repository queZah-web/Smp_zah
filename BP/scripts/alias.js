// ITEM ID RESOLVER
// The shop list uses names like "reeds", "rooted_dirt", "snow_block", "cobblestone_stairs", "white_bed" ...
// but every Minecraft version names some items differently ("sugar_cane", "dirt_with_roots", "snow", "stone_stairs", "bed" + colour data ...).
// So instead of trusting one name, we ask the GAME which item types really exist (ItemTypes.getAll) and pick the first matching candidate:
//   1) the explicit alias table below   2) the shop id itself   3) the shop display name ("Sugar Cane" -> sugar_cane)
//   4) small spelling variants          5) word-by-word fuzzy match against the real list
// If an item only exists as an old "id + data value" item (e.g. coloured beds), it is delivered with the /give command instead.
// Nothing here changes a price, an icon or a shop entry.
import { ItemStack, ItemTypes, system } from "@minecraft/server";
import { shopMsg } from "./systems/shoplang.js";

const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];

const ALIAS = {};       // shop id -> candidate item ids (first one that exists in the game wins)
const LEGACY = {};      // shop id -> [old item id, data value, max stack]   (only used when no real item id exists)
const NAME_LEGACY = {}; // display name -> [old item id, data value, max stack]
const alias = (id, ...c) => { ALIAS[id] = [...(ALIAS[id] ?? []), ...c]; };

// ---- names that really differ between versions
alias("reeds", "sugar_cane", "reeds");
alias("sugar_cane", "sugar_cane", "reeds");
alias("rooted_dirt", "dirt_with_roots", "rooted_dirt");
alias("dirt_with_roots", "dirt_with_roots", "rooted_dirt");
alias("snow_block", "snow", "snow_block");
alias("cobblestone_stairs", "cobblestone_stairs", "stone_stairs");
alias("stone_stairs", "normal_stone_stairs", "stone_stairs");
alias("stone_slab", "normal_stone_slab", "stone_slab", "stone_block_slab");
alias("cobblestone_slab", "cobblestone_slab");
alias("grass_block", "grass_block", "grass");
alias("melon_block", "melon_block", "melon");
alias("brick_block", "brick_block", "bricks");
alias("stonebrick", "stonebrick", "stone_bricks");
alias("nether_brick", "nether_brick", "nether_bricks");
alias("red_nether_brick", "red_nether_brick", "red_nether_bricks");
alias("waterlily", "waterlily", "lily_pad");
alias("short_grass", "short_grass", "tallgrass");
alias("tallgrass", "tallgrass", "short_grass");
alias("dandelion", "dandelion", "yellow_flower");
alias("poppy", "poppy", "red_flower");
alias("nether_quartz_ore", "nether_quartz_ore", "quartz_ore");
alias("waxed_copper_block", "waxed_copper_block", "waxed_copper");
alias("shulker_box", "undyed_shulker_box", "shulker_box");
alias("terracotta", "terracotta", "hardened_clay");
alias("wooden_door", "wooden_door", "oak_door");
alias("trapdoor", "trapdoor", "oak_trapdoor");
alias("fence", "fence", "oak_fence");
alias("fence_gate", "fence_gate", "oak_fence_gate");
alias("light_gray_glazed_terracotta", "light_gray_glazed_terracotta", "silver_glazed_terracotta");
alias("light_gray_dye", "light_gray_dye", "silver_dye");
alias("chain", "chain", "iron_chain");
alias("zombie_pigman_spawn_egg", "zombie_pigman_spawn_egg", "zombified_piglin_spawn_egg");
alias("noteblock", "noteblock", "note_block");
alias("stonecutter_block", "stonecutter_block", "stonecutter");
alias("lapis_lazuli", "lapis_lazuli", "lapis");

// ---- extra names (v47): Bedrock ids that differ from the shop ids. The shop id itself is always tried first.
alias("frogspawn", "frogspawn", "frog_spawn");
alias("cobweb", "cobweb", "web");
alias("jack_o_lantern", "jack_o_lantern", "lit_pumpkin");
alias("powered_rail", "powered_rail", "golden_rail");
alias("turtle_scute", "turtle_scute", "scute");
alias("cherry_petals", "cherry_petals", "pink_petals");
alias("magma_block", "magma_block", "magma");
alias("small_dripleaf", "small_dripleaf", "small_dripleaf_block");
alias("end_stone_brick_stairs", "end_stone_brick_stairs", "end_brick_stairs");
alias("end_stone_brick_slab", "end_stone_brick_slab", "end_brick_slab");
alias("end_stone_brick_wall", "end_stone_brick_wall", "end_brick_wall");
alias("end_bricks", "end_bricks", "end_stone_bricks", "end_brick");
alias("repeater", "repeater", "unpowered_repeater");
alias("comparator", "comparator", "unpowered_comparator");
for (const n of ["13", "cat", "blocks", "chirp", "far", "mall", "mellohi", "stal", "strad", "ward", "11", "wait", "pigstep", "otherside", "5", "relic"]) alias("music_disc_" + n, "music_disc_" + n, "record_" + n);
alias("experience_bottle", "experience_bottle", "xp_bottle");

// ---- wood: oak_* is the "plain" wood. Older versions call it wooden_* / have no wood name at all
for (const [k, c] of Object.entries({
  slab: ["wooden_slab"], button: ["wooden_button"], pressure_plate: ["wooden_pressure_plate"], sign: ["sign"], boat: ["boat"],
  chest_boat: ["chest_boat"], leaves: ["leaves"], sapling: ["sapling"], wood: ["wood"], fence: ["fence"], fence_gate: ["fence_gate"],
  trapdoor: ["trapdoor"], door: ["wooden_door"],
})) alias("oak_" + k, "oak_" + k, ...c);

// ---- old "id + data value" items (used only if the game has no separate id for them)
COLORS.forEach((c, i) => {
  LEGACY[c + "_bed"] = ["bed", i, 1];
  LEGACY[c + "_wool"] = ["wool", i, 64];
  LEGACY[c + "_carpet"] = ["carpet", i, 64];
  LEGACY[c + "_concrete"] = ["concrete", i, 64];
  LEGACY[c + "_concrete_powder"] = ["concrete_powder", i, 64];
  LEGACY[c + "_stained_glass"] = ["stained_glass", i, 64];
  LEGACY[c + "_stained_glass_pane"] = ["stained_glass_pane", i, 64];
  LEGACY[c + "_terracotta"] = ["stained_hardened_clay", i, 64];
  LEGACY[c + "_banner"] = ["banner", 15 - i, 16];
});
WOODS.forEach((w, i) => {
  LEGACY[w + "_planks"] = ["planks", i, 64];
  LEGACY[w + "_slab"] = ["wooden_slab", i, 64];
  LEGACY[w + "_sapling"] = ["sapling", i, 64];
  if (w !== "oak") LEGACY[w + "_fence"] = ["fence", i, 64];
  if (i < 4) { LEGACY[w + "_leaves"] = ["leaves", i, 64]; LEGACY[w + "_log"] = ["log", i, 64]; }
  else { LEGACY[w + "_leaves"] = ["leaves2", i - 4, 64]; LEGACY[w + "_log"] = ["log2", i - 4, 64]; }
});
["poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley"]
  .forEach((f, i) => { LEGACY[f] = ["red_flower", i, 64]; });
["sunflower", "lilac", "tallgrass", "large_fern", "rose_bush", "peony"].forEach((f, i) => { LEGACY[f] = ["double_plant", i, 64]; });
LEGACY.dandelion = ["yellow_flower", 0, 64];
LEGACY.fern = ["tallgrass", 2, 64];
LEGACY.short_grass = ["tallgrass", 1, 64];
LEGACY.cobblestone_slab = ["stone_block_slab", 3, 64];
LEGACY.mossy_stone_bricks = ["stonebrick", 1, 64];
LEGACY.cracked_stone_bricks = ["stonebrick", 2, 64];
LEGACY.chiseled_stone_bricks = ["stonebrick", 3, 64];
LEGACY.coarse_dirt = ["dirt", 1, 64];
LEGACY.wet_sponge = ["sponge", 1, 64];
NAME_LEGACY["Skeleton Skull"] = ["skull", 0, 64]; NAME_LEGACY["Wither Skeleton Skull"] = ["skull", 1, 64]; NAME_LEGACY["Zombie Head"] = ["skull", 2, 64];
NAME_LEGACY["Creeper Head"] = ["skull", 4, 64]; NAME_LEGACY["Dragon Head"] = ["skull", 5, 64]; NAME_LEGACY["Piglin Head"] = ["skull", 6, 64];

// several shop entries share the id "skull" -> they are told apart by their display name
const BY_NAME_ONLY = new Set(["skull"]);

// ---------------------------------------------------------------- the real list of item types in this game version
let TYPES = null, IDX_FULL = null, IDX_LOOSE = null, IDX_SQUASH = null;
const squash = (s) => String(s ?? "").toLowerCase().replace(/^minecraft:/, "").replace(/[^a-z0-9]+/g, "");
const cache = new Map();
const stem = (w) => w.replace(/ies$/, "y").replace(/(ed|es|s)$/, "");
const tokens = (s, loose) => String(s).toLowerCase().replace(/^minecraft:/, "").split(/[^a-z0-9]+/).filter(Boolean)
  .filter((w) => !(loose && (w === "block" || w === "with" || w === "of" || w === "the"))).map(stem).sort().join("|");
const snake = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const bare = (id) => String(id).replace(/^minecraft:/, "");

function loadTypes() {
  if (TYPES) return TYPES;
  try {
    const all = ItemTypes.getAll();
    if (!all || !all.length) return null;
    const set = new Set(all.map((t) => t.id)), full = new Map(), loose = new Map(), sq = new Map();
    for (const id of set) {
      if (!id.startsWith("minecraft:")) continue;
      for (const [map, lo] of [[full, false], [loose, true]]) {
        const k = tokens(id, lo); map.set(k, map.has(k) ? null : id);        // null = two items share the key -> ambiguous, never guess
      }
    }
    for (const id of set) { if (!id.startsWith("minecraft:")) continue; const k = squash(id); sq.set(k, sq.has(k) ? null : id); }
    TYPES = set; IDX_FULL = full; IDX_LOOSE = loose; IDX_SQUASH = sq;
  } catch (e) { return null; }
  return TYPES;
}
function exists(full) {
  try { const t = loadTypes(); if (t && !t.has(full)) return false; new ItemStack(full, 1); return true; } catch (e) { return false; }
}
function variants(id) {
  const out = [];
  if (id.endsWith("_block")) out.push(id.slice(0, -6));
  if (id.startsWith("wooden_")) out.push("oak_" + id.slice(7)); else if (id.startsWith("oak_")) out.push("wooden_" + id.slice(4));
  if (/_bricks?(_|$)/.test(id)) out.push(id.replace(/_bricks(_|$)/, "_brick$1"), id.replace(/_brick(_|$)/, "_bricks$1"));
  if (/_tiles?(_|$)/.test(id)) out.push(id.replace(/_tiles(_|$)/, "_tile$1"), id.replace(/_tile(_|$)/, "_tiles$1"));
  return out;
}

/** -> { full: "minecraft:sugar_cane" } | { legacy: [oldId, data, maxStack] } | null (the item does not exist in this game version) */
export function resolveItem(shopId, name) {
  const id = bare(shopId), key = id + "|" + (name ?? "");
  if (cache.has(key)) return cache.get(key);
  const loaded = !!loadTypes();
  let res = null;
  const cands = [];
  if (BY_NAME_ONLY.has(id) && name) cands.push(snake(name));
  cands.push(...(ALIAS[id] ?? []), id);
  if (name) cands.push(snake(name));
  cands.push(...variants(id));
  for (const c of cands) { const full = "minecraft:" + bare(c); if (exists(full)) { res = { full }; break; } }
  if (!res && loaded) {                                  // word-by-word match against the real list
    for (const [src, idx, loose, sq] of [[id, IDX_FULL, false], [name, IDX_FULL, false], [id, IDX_LOOSE, true], [name, IDX_LOOSE, true], [id, IDX_SQUASH, false, true], [name, IDX_SQUASH, false, true]]) {
      if (!src) continue;
      const hit = idx.get(sq ? squash(src) : tokens(src, loose));
      if (hit && exists(hit)) { res = { full: hit }; break; }
    }
  }
  if (!res) {
    const lg = (name && NAME_LEGACY[name]) || LEGACY[id];
    if (lg && (!loaded || TYPES.has("minecraft:" + lg[0]))) res = { legacy: lg };
  }
  if (res || loaded) cache.set(key, res);                // before the game is ready a miss is not remembered
  return res;
}

/** full game id of a shop id (falls back to "minecraft:<id>" so old callers keep working) */
export function realId(id, name) {
  const r = resolveItem(id, name);
  if (r?.full) return r.full;
  if (r?.legacy) return "minecraft:" + r.legacy[0];
  return "minecraft:" + bare(id);
}

/** lets the sell box / price line find an item by its REAL game id too (a stack of sugar_cane is found as "reeds") */
export function addAliases(map) {
  for (const [id, it] of [...map]) {
    try {
      const r = resolveItem(id, it?.[1]);
      const n = r?.full ? bare(r.full) : null;
      if (n && !map.has(n)) map.set(n, it);
    } catch (e) { /* keep going */ }
  }
}

/** every shop entry that cannot be bought in this game version */
export function findMissing(categories) {
  const out = [];
  for (const c of categories) for (const it of c.items) if (!resolveItem(it[0], it[1])) out.push(`${it[1]} (${it[0]})`);
  return out;
}

/** /scriptevent shop:check  -> tells you which shop items this game version does not have (also written to the content log) */
export function registerCheck(categories) {
  try {
    system.runTimeout(() => {
      try { const m = findMissing(categories); console.warn(`[shop] ${m.length} shop item(s) not available in this game version` + (m.length ? ": " + m.join(", ") : "")); } catch (e) { /* ignore */ }
    }, 100);
    system.afterEvents.scriptEventReceive.subscribe((ev) => {
      if (ev.id !== "shop:check") return;
      const m = findMissing(categories), to = ev.sourceEntity;
      const msg = m.length ? `§e[Shop] ${m.length} item(s) cannot be bought here:\n§7` + m.join(", ") : "§a[Shop] All shop items work in this game version.";
      if (to && to.sendMessage) to.sendMessage(shopMsg(to, msg)); else console.warn(msg);
    });
  } catch (e) { /* ignore */ }
}
