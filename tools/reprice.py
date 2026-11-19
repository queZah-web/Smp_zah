#!/usr/bin/env python3
"""Shop re-pricing (medium difficulty).  Run:  python3 tools/reprice.py   (rewrites BP/scripts/shop_data.js, writes tools/price_changes.csv)

Rules
  * SELL price = what the materials of the item are worth (crafting recipe), so crafting then selling never makes money from nothing.
  * BUY price  = about 3x the sell price (cheap blocks: a little more, minimum $5). Never higher than before.
  * Every item: buy >= 1.3 x sell  -> with the best trading perks (-10% buy, +10% sell) buy -> sell can never be a profit.
  * Known anchors (asked by the owner): diamond 1800 / 600, diamond tools 2000-5500, diamond pickaxe sells 1800 (3 diamonds),
    shovel 600 (1 diamond), netherite tools sell 7800-9000.
"""
import json, re, csv, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "BP", "scripts", "shop_data.js")
BASE = os.path.join(ROOT, "tools", "shop_data.original.js")       # the prices BEFORE re-pricing (never changed)
text = open(BASE, encoding="utf-8").read()
head, body = text.split("export const CATEGORIES = ", 1)
cats = json.loads(body.strip().rstrip(";"))
items = {}
for c in cats:
    for it in c["items"]:
        items.setdefault(it[0], []).append((c["id"], it))
OLD = {k: (v[0][1][3], v[0][1][4]) for k, v in items.items()}

def nice(n):
    """round a buy price to a friendly number"""
    if n < 20: return max(1, int(round(n)))
    if n < 100: return int(round(n / 5.0) * 5)
    if n < 1000: return int(round(n / 10.0) * 10)
    if n < 10000: return int(round(n / 50.0) * 50)
    return int(round(n / 100.0) * 100)

S = {}     # new sell (can be float while computing)
B = {}     # new buy (explicit)
def put(i, sell, buy=None):
    S[i] = sell
    if buy is not None: B[i] = buy

# ------------------------------------------------------------------ raw materials (sell) - buy = 3x
MAT = {
    "diamond": 600, "emerald": 100, "iron_ingot": 25, "raw_iron": 22, "iron_nugget": 25 / 9,
    "gold_ingot": 50, "raw_gold": 45, "gold_nugget": 50 / 9, "copper_ingot": 10, "raw_copper": 8, "copper_nugget": 10 / 9,
    "coal": 8, "charcoal": 6, "lapis_lazuli": 5, "redstone": 4, "quartz": 4, "amethyst_shard": 25,
    "netherite_scrap": 1800, "ancient_debris": 1800, "netherite_ingot": 7400,
    "stick": 1, "oak_planks": 2, "leather": 3, "string": 1, "flint": 2, "feather": 1, "cobblestone": 1, "blaze_rod": 20,
    "slime_ball": 3, "glowstone_dust": 6, "bone": 3, "honeycomb": 5, "breeze_rod": 50, "heavy_core": 3000, "turtle_scute": 30,
    "wheat": 3, "sugar": 3, "egg": 2, "apple": 6, "carrot": 3, "melon_slice": 1, "phantom_membrane": 15, "rabbit_hide": 2,
}
for k, v in MAT.items(): put(k, v)
put("diamond", 600, 1800); put("emerald", 100, 400)
for blk, ing, n in [("diamond_block", "diamond", 9), ("emerald_block", "emerald", 9), ("iron_block", "iron_ingot", 9), ("raw_iron_block", "raw_iron", 9),
                    ("gold_block", "gold_ingot", 9), ("raw_gold_block", "raw_gold", 9), ("copper_block", "copper_ingot", 9), ("raw_copper_block", "raw_copper", 9),
                    ("coal_block", "coal", 9), ("lapis_block", "lapis_lazuli", 9), ("redstone_block", "redstone", 9), ("quartz_block", "quartz", 4),
                    ("amethyst_block", "amethyst_shard", 4), ("netherite_block", "netherite_ingot", 9), ("bone_block", "bone", 3), ("slime", "slime_ball", 9),
                    ("hay_block", "wheat", 9), ("honeycomb_block", "honeycomb", 4), ("glowstone", "glowstone_dust", 4)]:
    put(blk, S[ing] * n)
# ores (silk touch): same as what they drop, a little more to buy
ORE_DROP = {"coal": ("coal", 1), "iron": ("raw_iron", 1), "copper": ("raw_copper", 3), "gold": ("raw_gold", 1), "redstone": ("redstone", 4),
            "lapis": ("lapis_lazuli", 6), "diamond": ("diamond", 1), "emerald": ("emerald", 1)}
for o, (d, n) in ORE_DROP.items():
    put(o + "_ore", S[d] * n); put("deepslate_" + o + "_ore", S[d] * n)
put("nether_gold_ore", S["gold_nugget"] * 4); put("nether_quartz_ore", S["quartz"])
# amethyst growth
put("amethyst_cluster", 100); put("large_amethyst_bud", 40); put("medium_amethyst_bud", 20); put("small_amethyst_bud", 10)
# copper family: 1 block of copper = 9 ingots; cut / chiseled / grate = 1 block each (4 -> 4)
cb = S["copper_block"]
for age in ["", "exposed_", "weathered_", "oxidized_"]:
    for wax in ["", "waxed_"]:
        w = 5 if wax else 0
        base = (wax + age + "copper") if age else (wax + "copper_block")
        put(base, cb + w)
        put(wax + age + "cut_copper", cb + w); put(wax + age + "cut_copper_slab", (cb + w) / 2); put(wax + age + "cut_copper_stairs", (cb + w) * 1.5)
        put(wax + age + "chiseled_copper", cb + w); put(wax + age + "copper_grate", cb + w)
        put(wax + age + "copper_bulb", cb * 0.75 + 20 + w)
        put(wax + age + "copper_door", S["copper_ingot"] * 2 + w); put(wax + age + "copper_trapdoor", S["copper_ingot"] * 3 + w)
for age in ["", "exposed_", "weathered_", "oxidized_"]: put(age + "copper_chest", 8 * S["copper_ingot"] + 16)

# ------------------------------------------------------------------ tools & weapons: material count x material sell
TOOL_N = {"sword": 2, "pickaxe": 3, "axe": 3, "shovel": 1, "hoe": 2}
TOOL_MAT = {"wooden": S["oak_planks"], "stone": S["cobblestone"], "copper": S["copper_ingot"], "iron": S["iron_ingot"], "golden": S["gold_ingot"], "diamond": 600}
for m, v in TOOL_MAT.items():
    for t, n in TOOL_N.items():
        sticks = 1 if t == "sword" else 2
        put(m + "_" + t, v * n + sticks * S["stick"] if m != "diamond" else v * n)
DIA_BUY = {"shovel": 2000, "sword": 4000, "hoe": 4000, "pickaxe": 5500, "axe": 5500}
for t, b in DIA_BUY.items(): B["diamond_" + t] = b
for t in TOOL_N:                       # netherite = diamond tool + 1 netherite ingot (sell 7800 - 9000)
    put("netherite_" + t, S["diamond_" + t] + 7200, None)
    B["netherite_" + t] = nice(S["netherite_" + t] * 4)
ARMOR_N = {"helmet": 5, "chestplate": 8, "leggings": 7, "boots": 4}
ARMOR_MAT = {"leather": S["leather"], "copper": S["copper_ingot"], "iron": S["iron_ingot"], "golden": S["gold_ingot"], "diamond": 600}
for m, v in ARMOR_MAT.items():
    for a, n in ARMOR_N.items(): put(m + "_" + a, v * n)
for a, n in ARMOR_N.items():
    put("chainmail_" + a, S["iron_" + a] * 1.2); B["chainmail_" + a] = nice(S["chainmail_" + a] * 4)
    put("netherite_" + a, S["diamond_" + a] + 7200); B["netherite_" + a] = nice(S["netherite_" + a] * 4)
put("turtle_helmet", 5 * S["turtle_scute"])
put("leather_horse_armor", 7 * S["leather"]); put("copper_horse_armor", 60); put("iron_horse_armor", 150); put("golden_horse_armor", 300)
put("diamond_horse_armor", 3000, 12000); put("wolf_armor", 6 * 50, 1500)
put("name_tag", 9, 500); put("elytra", 5000, 250000); put("mace", 4000, 35000); put("heavy_core", 3000, 15000); put("trident", 1500, 9000)
put("bow", 3 * S["stick"] + 3 * S["string"]); put("crossbow", 25); put("arrow", 1); put("spectral_arrow", 13)
put("shield", 6 * S["oak_planks"] + S["iron_ingot"]); put("flint_and_steel", S["iron_ingot"] + S["flint"]); put("shears", 2 * S["iron_ingot"])
put("fishing_rod", 4); put("carrot_on_a_stick", 8); put("warped_fungus_on_a_stick", 12); put("lead", 8); put("brush", 12)
put("compass", 4 * S["iron_ingot"] + S["redstone"]); put("clock", 4 * S["gold_ingot"] + S["redstone"]); put("spyglass", 2 * S["copper_ingot"] + S["amethyst_shard"])
put("firework_rocket", 2); put("fire_charge", 6); put("firework_star", 6)
put("bucket", 3 * S["iron_ingot"])
for b in ["water_bucket", "milk_bucket"]: put(b, S["bucket"] + 1)
for b in ["lava_bucket", "powder_snow_bucket"]: put(b, S["bucket"] + 5)
for b in ["cod_bucket", "salmon_bucket", "tropical_fish_bucket", "pufferfish_bucket"]: put(b, S["bucket"] + 10)
put("axolotl_bucket", 150, 1200); put("tadpole_bucket", 100, 500)

# ------------------------------------------------------------------ food
put("bread", 3 * S["wheat"]); put("golden_apple", 8 * S["gold_ingot"] + S["apple"]); put("enchanted_golden_apple", 2500, 25000)
put("golden_carrot", 8 * S["gold_nugget"] + S["carrot"]); put("glistering_melon_slice", 8 * S["gold_nugget"] + S["melon_slice"])
put("cake", 20); put("pumpkin_pie", 8)

# ------------------------------------------------------------------ wood: everything from the log (1 log = 4 planks)
WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak", "crimson", "warped", "bamboo"]
LOG = 8
for w in WOODS:
    stem = w in ("crimson", "warped")
    lg = (w + "_stem") if stem else (w + "_log")
    put(lg, LOG)
    for x in (["stripped_" + w + "_stem", w + "_hyphae", "stripped_" + w + "_hyphae"] if stem else ["stripped_" + w + "_log", w + "_wood", "stripped_" + w + "_wood"]):
        put(x, LOG)
    p = LOG / 4
    if w == "bamboo":
        put("bamboo_block", 9 * 0.5); put("stripped_bamboo_block", 9 * 0.5); p = 9 * 0.5 / 2; put("bamboo_mosaic", p)
        put("bamboo_mosaic_slab", p / 2); put("bamboo_mosaic_stairs", p * 1.5)
    put(w + "_planks", p)
    put(w + "_slab", p / 2); put(w + "_stairs", p * 1.5)
    put("fence" if w == "oak" else w + "_fence", p * 5 / 3); put("fence_gate" if w == "oak" else w + "_fence_gate", p * 2 + 2)
    put("wooden_door" if w == "oak" else w + "_door", p * 2); put("trapdoor" if w == "oak" else w + "_trapdoor", p * 3)
    put(w + "_button", p); put(w + "_pressure_plate", p * 2)
    put(w + "_sign", p * 2 + 0.5); put(w + "_hanging_sign", LOG + 4)
    if not stem:
        put(w + "_raft" if w == "bamboo" else w + "_boat", p * 5); put(w + "_chest_raft" if w == "bamboo" else w + "_chest_boat", p * 13)
put("stick", 1); put("crafting_table", 4 * 2); put("chest", 8 * 2); put("barrel", 7 * 2); put("ladder", 2); put("bookshelf", 6 * 2 + 3 * 9)

# ------------------------------------------------------------------ flowers & plants: cheaper to sell (they are free to farm)
FLOWERS1 = ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
            "cornflower", "lily_of_the_valley", "wildflowers", "pink_petals", "cherry_petals", "short_grass", "tallgrass", "fern", "large_fern",
            "short_dry_grass", "tall_dry_grass", "dead_bush", "bush", "leaf_litter", "hanging_roots", "vine", "glow_lichen", "moss_carpet",
            "pale_moss_carpet", "pale_hanging_moss", "seagrass", "kelp", "nether_sprouts", "crimson_roots", "warped_roots", "weeping_vines", "twisting_vines"]
for f in FLOWERS1: put(f, 1)
for f in ["sunflower", "lilac", "rose_bush", "peony", "waterlily", "moss_block", "pale_moss_block", "small_dripleaf", "azalea", "flowering_azalea", "cactus_flower",
          "mangrove_propagule", "mangrove_roots", "muddy_mangrove_roots", "big_dripleaf", "firefly_bush"]:
    put(f, 2)
for f in ["torchflower", "pitcher_plant", "closed_eyeblossom", "open_eyeblossom", "spore_blossom"]: put(f, 5)
put("wither_rose", 60)
for w in ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"]:
    put(w + "_sapling", 1); put(w + "_leaves", 1)
put("azalea_leaves", 1); put("flowering_azalea_leaves", 1)
for x in ["brown_mushroom", "red_mushroom", "brown_mushroom_block", "red_mushroom_block", "mushroom_stem", "crimson_fungus", "warped_fungus"]: put(x, 3)

# ------------------------------------------------------------------ apply: explicit sells, family rules (slab / stairs / wall), generic buy
def cat_of(i): return items[i][0][0]
def base_for(i, suf):
    b = i[: -len(suf)]
    for cand in [b, b + "s", b + "_block", b.replace("brick", "bricks"), b.replace("_brick", "_bricks"), b + "_planks",
                 b.replace("stone_brick", "stonebrick"), b.replace("nether_brick", "nether_brick"), b.replace("smooth_stone", "smooth_stone"),
                 b.replace("quartz", "quartz_block"), b.replace("tile", "tiles"), b.replace("purpur", "purpur_block"), b.replace("end_stone_brick", "end_bricks"),
                 b.replace("mossy_stone_brick", "mossy_stone_bricks"), b.replace("prismarine_brick", "prismarine_bricks"), b.replace("resin_brick", "resin_bricks")]:
        if cand in items and cand != i: return cand
    return None

def buy_mult(sell):
    if sell < 2: return 6
    if sell < 10: return 4
    if sell < 100: return 3.5
    return 3

new = {}
FAMILY = {"_slab": 0.5, "_stairs": 1.5, "_wall": 1.0}
for i, (ob, os_) in OLD.items():
    if i in S:
        sell = S[i]
    else:
        sell = os_
        for suf, r in FAMILY.items():
            if i.endswith(suf):
                b = base_for(i, suf)
                if b:
                    bs = S.get(b, OLD[b][1]); sell = max(bs * r, 1 if bs >= 1 else 0)
                break
    sell = int(math.floor(sell)) if sell >= 1 else (1 if sell > 0 else 0)
    if os_ == 0 and i not in S: sell = 0           # not sellable before: stays not sellable (shulker / special items)
    if i in B:
        buy = B[i]
    else:
        target = max(5, (sell if sell > 0 else os_ if os_ > 0 else ob / 20) * buy_mult(max(sell, 1)))
        if ob >= 2000 and i not in S:              # rare items the owner priced high on purpose: at most 40% cheaper
            target = max(target, ob * 0.6)
        buy = nice(min(ob, target)) if i not in S else nice(target)
    buy = max(buy, int(math.ceil(sell * 1.3)) + 1, 1)
    new[i] = (buy, sell)

for c in cats:
    for it in c["items"]:
        it[3], it[4] = new[it[0]]
open(SRC, "w", encoding="utf-8").write(head + "export const CATEGORIES = " + json.dumps(cats, ensure_ascii=False, separators=(",", ":")) + ";\n")
with open(os.path.join(ROOT, "tools", "price_changes.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["category", "item", "old_buy", "new_buy", "old_sell", "new_sell"])
    for c in cats:
        seen = set()
        for it in c["items"]:
            if it[0] in seen: continue
            seen.add(it[0]); w.writerow([c["id"], it[0], OLD[it[0]][0], new[it[0]][0], OLD[it[0]][1], new[it[0]][1]])
print("repriced", len(new), "items")
