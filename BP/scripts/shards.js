import { EGGS } from "./mobs.js";
export const SPAWNER_SHARDS = 2500, SPAWNER_MONEY = 80000;
// cheapest egg (used for the "from ..." texts); every egg has its own price in mobs.js
export const EGG_SHARDS = Math.min(...EGGS.map((e) => e.shards)), EGG_MONEY = Math.min(...EGGS.map((e) => e.money));
// [item id, amount per purchase, price in shards]  (item names/icons come from the shop catalogue)
export const SHARD_ITEMS = [
  ["stone", 16, 199], ["cobblestone", 64, 199], ["oak_log", 16, 199], ["cooked_beef", 32, 199], ["iron_ingot", 8, 249], ["obsidian", 4, 249], ["arrow", 64, 249], ["golden_carrot", 32, 249],
  ["gold_ingot", 8, 299], ["ender_pearl", 4, 349], ["diamond", 1, 399], ["emerald", 1, 349], ["golden_apple", 2, 449], ["tnt", 16, 449], ["experience_bottle", 16, 199],
  ["diamond_sword", 1, 999], ["diamond_pickaxe", 1, 1199], ["shulker_box", 1, 1499], ["diamond_chestplate", 1, 1699], ["totem_of_undying", 1, 2499],
  ["netherite_ingot", 1, 3999], ["enchanted_golden_apple", 1, 4499], ["nether_star", 1, 4999], ["beacon", 1, 5499], ["trident", 1, 5999], ["elytra", 1, 6999],
];
