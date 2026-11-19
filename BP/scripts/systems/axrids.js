// Anti X-Ray: block ids (pure data, no game imports, so any file can import it safely).
// A "hidden" ore is a normal ore that is completely buried: the game sends the client a plain
// stone-looking block (smp:ax_<ore>__<skin>) instead of the ore, so an X-Ray texture pack / hacked client sees nothing.
// The real ore comes back the moment any side of it touches air / water / lava / anything see-through.
export const NS = "smp:ax_";

// real ore (without "minecraft:") -> config switch name
export const ORE_KEY = {
  coal_ore: "coal", deepslate_coal_ore: "coal",
  copper_ore: "copper", deepslate_copper_ore: "copper",
  iron_ore: "iron", deepslate_iron_ore: "iron",
  gold_ore: "gold", deepslate_gold_ore: "gold",
  lapis_ore: "lapis", deepslate_lapis_ore: "lapis",
  redstone_ore: "redstone", deepslate_redstone_ore: "redstone",
  diamond_ore: "diamond", deepslate_diamond_ore: "diamond",
  emerald_ore: "emerald", deepslate_emerald_ore: "emerald",
  ancient_debris: "ancient_debris", quartz_ore: "quartz", nether_gold_ore: "nether_gold",
};
export const NETHER_ORES = new Set(["ancient_debris", "quartz_ore", "nether_gold_ore"]);
export const OW_SKINS = ["stone", "deepslate"];
export const NE_SKINS = ["netherrack", "blackstone", "basalt"];
export const ORES = Object.keys(ORE_KEY);
export const skinsOf = (ore) => (NETHER_ORES.has(ore) ? NE_SKINS : OW_SKINS);
export const defaultSkin = (ore) => (NETHER_ORES.has(ore) ? "netherrack" : ore.startsWith("deepslate_") ? "deepslate" : "stone");

export const fakeId = (ore, skin) => NS + ore + "__" + skin;
export const ALL_FAKE = [];
for (const ore of ORES) for (const s of skinsOf(ore)) ALL_FAKE.push(fakeId(ore, s));

export const isFake = (typeId) => typeof typeId === "string" && typeId.startsWith(NS);
/** smp:ax_diamond_ore__stone -> minecraft:diamond_ore ; any other id is returned unchanged */
export const realOf = (typeId) => (isFake(typeId) ? "minecraft:" + typeId.slice(NS.length).split("__")[0] : typeId);
