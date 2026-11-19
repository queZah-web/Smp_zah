#!/usr/bin/env python3
"""Exploit check for the shop prices: python3 tools/check_prices.py  (exit 1 = a problem)"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
t = open(os.path.join(ROOT, "BP", "scripts", "shop_data.js"), encoding="utf-8").read().split("export const CATEGORIES = ", 1)[1].strip().rstrip(";")
P = {}
for c in json.loads(t):
    for it in c["items"]: P.setdefault(it[0], (it[3], it[4]))
bad = 0
worst = max((s / b, i) for i, (b, s) in P.items() if s > 0)
print("highest sell/buy ratio: %.2f (%s)" % worst)
for i, (b, s) in P.items():
    if s > 0 and b * 0.9 < s * 1.1 * 1.0 and max(b * 0.9, s * 1.1) < s * 1.1:      # buyPrice() never goes under 110% of sell
        print("PERK LOOP", i, b, s); bad += 1
# recipes: (output, count) <- [(input, n), ...]   buy inputs, craft, sell output (+10% bonus) must lose money
W = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"]
R = []
for w in W:
    R += [((w + "_planks", 4), [(w + "_log", 1)]), ((w + "_slab", 6), [(w + "_planks", 3)]), ((w + "_stairs", 4), [(w + "_planks", 6)]),
          ((w + "_boat", 1), [(w + "_planks", 5)]), ((w + "_button", 1), [(w + "_planks", 1)]), ((w + "_pressure_plate", 1), [(w + "_planks", 2)]),
          ((w + "_door" if w != "oak" else "wooden_door", 3), [(w + "_planks", 6)]), ((w + "_trapdoor" if w != "oak" else "trapdoor", 2), [(w + "_planks", 6)]),
          ((w + "_fence" if w != "oak" else "fence", 3), [(w + "_planks", 4), ("stick", 2)]), (("stripped_" + w + "_log", 1), [(w + "_log", 1)])]
R += [(("stick", 4), [("oak_planks", 2)]), (("chest", 1), [("oak_planks", 8)]), (("crafting_table", 1), [("oak_planks", 4)]), (("barrel", 1), [("oak_planks", 6), ("oak_slab", 2)])]
for blk, ing, n in [("diamond_block", "diamond", 9), ("emerald_block", "emerald", 9), ("iron_block", "iron_ingot", 9), ("gold_block", "gold_ingot", 9), ("copper_block", "copper_ingot", 9),
                    ("coal_block", "coal", 9), ("lapis_block", "lapis_lazuli", 9), ("redstone_block", "redstone", 9), ("netherite_block", "netherite_ingot", 9), ("raw_iron_block", "raw_iron", 9),
                    ("raw_gold_block", "raw_gold", 9), ("raw_copper_block", "raw_copper", 9), ("hay_block", "wheat", 9), ("slime", "slime_ball", 9), ("bone_block", "bone_meal", 9),
                    ("quartz_block", "quartz", 4), ("amethyst_block", "amethyst_shard", 4), ("glowstone", "glowstone_dust", 4), ("honeycomb_block", "honeycomb", 4), ("dried_kelp_block", "dried_kelp", 9)]:
    R += [((blk, 1), [(ing, n)]), ((ing, n), [(blk, 1)])]
R += [(("iron_ingot", 1), [("iron_nugget", 9)]), (("iron_nugget", 9), [("iron_ingot", 1)]), (("gold_ingot", 1), [("gold_nugget", 9)]), (("gold_nugget", 9), [("gold_ingot", 1)]),
      (("iron_ingot", 1), [("raw_iron", 1)]), (("gold_ingot", 1), [("raw_gold", 1)]), (("copper_ingot", 1), [("raw_copper", 1)]), (("netherite_ingot", 1), [("netherite_scrap", 4), ("gold_ingot", 4)]),
      (("netherite_scrap", 1), [("ancient_debris", 1)]), (("bread", 1), [("wheat", 3)]), (("golden_apple", 1), [("apple", 1), ("gold_ingot", 8)]), (("golden_carrot", 1), [("carrot", 1), ("gold_nugget", 8)]),
      (("glass", 1), [("sand", 1)]), (("stone", 1), [("cobblestone", 1)]), (("smooth_stone", 1), [("stone", 1)]), (("stonebrick", 4), [("stone", 4)]), (("charcoal", 1), [("oak_log", 1)]),
      (("bucket", 1), [("iron_ingot", 3)]), (("shears", 1), [("iron_ingot", 2)]), (("compass", 1), [("iron_ingot", 4), ("redstone", 1)]), (("clock", 1), [("gold_ingot", 4), ("redstone", 1)]),
      (("cooked_beef", 1), [("beef", 1)]), (("cooked_porkchop", 1), [("porkchop", 1)]), (("cooked_chicken", 1), [("chicken", 1)]), (("cooked_mutton", 1), [("mutton", 1)]),
      (("sugar", 1), [("reeds", 1)]), (("paper", 3), [("reeds", 3)]), (("book", 1), [("paper", 3), ("leather", 1)]), (("bookshelf", 1), [("oak_planks", 6), ("book", 3)]),
      (("bone_meal", 3), [("bone", 1)]), (("blaze_powder", 2), [("blaze_rod", 1)]), (("ender_eye", 1), [("ender_pearl", 1), ("blaze_powder", 1)]), (("torch", 4), [("coal", 1), ("stick", 1)]),
      (("hopper", 1), [("iron_ingot", 5), ("chest", 1)]), (("anvil", 1), [("iron_block", 3), ("iron_ingot", 4)]), (("piston", 1), [("oak_planks", 3), ("cobblestone", 4), ("iron_ingot", 1), ("redstone", 1)]),
      (("enchanting_table", 1), [("diamond", 2), ("obsidian", 4), ("book", 1)]), (("beacon", 1), [("nether_star", 1), ("obsidian", 3), ("glass", 5)]), (("ender_chest", 1), [("obsidian", 8), ("ender_eye", 1)]),
      (("shulker_box", 1), [("shulker_shell", 2), ("chest", 1)]), (("jukebox", 1), [("oak_planks", 8), ("diamond", 1)]), (("tnt", 1), [("gunpowder", 5), ("sand", 4)]),
      (("white_wool", 1), [("string", 4)]), (("white_bed", 1), [("white_wool", 3), ("oak_planks", 3)]), (("white_carpet", 3), [("white_wool", 2)]), (("lead", 2), [("string", 4), ("slime_ball", 1)]),
      (("mace", 1), [("heavy_core", 1), ("breeze_rod", 1)]), (("conduit", 1), [("heart_of_the_sea", 1), ("nautilus_shell", 8)]), (("lodestone", 1), [("chiseled_stone_bricks", 8), ("netherite_ingot", 1)])]
TOOLN = {"sword": 2, "pickaxe": 3, "axe": 3, "shovel": 1, "hoe": 2}
ARMN = {"helmet": 5, "chestplate": 8, "leggings": 7, "boots": 4}
for m, ing in [("wooden", "oak_planks"), ("stone", "cobblestone"), ("copper", "copper_ingot"), ("iron", "iron_ingot"), ("golden", "gold_ingot"), ("diamond", "diamond")]:
    for t, n in TOOLN.items(): R.append(((m + "_" + t, 1), [(ing, n), ("stick", 1 if t == "sword" else 2)]))
for m, ing in [("leather", "leather"), ("copper", "copper_ingot"), ("iron", "iron_ingot"), ("golden", "gold_ingot"), ("diamond", "diamond")]:
    for a, n in ARMN.items(): R.append(((m + "_" + a, 1), [(ing, n)]))
for t in list(TOOLN) + list(ARMN):
    R.append((("netherite_" + t, 1), [("diamond_" + t, 1), ("netherite_ingot", 1), ("netherite_upgrade_smithing_template", 1)]))
miss = set()
for (o, k), ins in R:
    if o not in P or any(i not in P for i, _ in ins): miss.update([o] + [i for i, _ in ins if i not in P]); continue
    cost = sum(max(P[i][0] * 0.9, P[i][1] * 1.1) * n for i, n in ins)        # cheapest possible buy (trading perk -10%)
    gain = P[o][1] * k * 1.1                                                 # best possible sell (+10%)
    if gain >= cost: print("CRAFT PROFIT", o, "x%d" % k, "cost %.0f" % cost, "sell %.0f" % gain); bad += 1
    rev = sum(P[i][1] * n for i, n in ins) * 1.1                              # sell the inputs after buying the output
    if k == 1 and len(ins) == 1 and rev >= max(P[o][0] * 0.9, P[o][1] * 1.1): print("UNCRAFT PROFIT", o, rev, P[o][0]); bad += 1
print("recipes checked:", len(R), "| not in shop:", ", ".join(sorted(miss)) or "-")
print("OK" if not bad else "%d PROBLEMS" % bad); sys.exit(1 if bad else 0)
