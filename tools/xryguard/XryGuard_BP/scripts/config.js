// ============================================================
//  XryGuard - الإعدادات
// ============================================================

// الخامات اللي تنخفي.
// ⚠️ لا تغيّر الترتيب ولا تحذف شي: رقم كل خامة محفوظ بالعالم.
// إذا تريد تضيف خامة جديدة، ضيفها بآخر القائمة فقط.
export const ORES = [
  "minecraft:coal_ore",
  "minecraft:deepslate_coal_ore",
  "minecraft:iron_ore",
  "minecraft:deepslate_iron_ore",
  "minecraft:copper_ore",
  "minecraft:deepslate_copper_ore",
  "minecraft:gold_ore",
  "minecraft:deepslate_gold_ore",
  "minecraft:redstone_ore",
  "minecraft:deepslate_redstone_ore",
  "minecraft:emerald_ore",
  "minecraft:deepslate_emerald_ore",
  "minecraft:lapis_ore",
  "minecraft:deepslate_lapis_ore",
  "minecraft:diamond_ore",
  "minecraft:deepslate_diamond_ore",
  "minecraft:nether_gold_ore",
  "minecraft:quartz_ore",
  "minecraft:ancient_debris",
  "minecraft:raw_iron_block", // عروق الحديد الكبيرة
  "minecraft:raw_copper_block", // عروق النحاس الكبيرة
];

export const ORE_INDEX = new Map(ORES.map((id, i) => [id, i]));

// الردستون المضيء (من يلمسه اللاعب). ما ينخفي، بس يُحسب بلوك صلب.
export const LIT_ORES = [
  "minecraft:lit_redstone_ore",
  "minecraft:lit_deepslate_redstone_ore",
];

// البلوكات اللي ممكن الخامة تتنكر بشكلها.
export const HOSTS = [
  "minecraft:stone",
  "minecraft:granite",
  "minecraft:diorite",
  "minecraft:andesite",
  "minecraft:deepslate",
  "minecraft:tuff",
  "minecraft:calcite",
  "minecraft:netherrack",
  "minecraft:basalt",
  "minecraft:smooth_basalt",
  "minecraft:blackstone",
];
export const HOST_SET = new Set(HOSTS);

// البلوك الافتراضي لكل خامة إذا ما لگينا حجر يمها.
export function defaultHost(oreId) {
  if (oreId.includes("deepslate")) return "minecraft:deepslate";
  if (oreId === "minecraft:nether_gold_ore" || oreId === "minecraft:quartz_ore" || oreId === "minecraft:ancient_debris")
    return "minecraft:netherrack";
  if (oreId === "minecraft:raw_iron_block") return "minecraft:tuff";
  if (oreId === "minecraft:raw_copper_block") return "minecraft:granite";
  return "minecraft:stone";
}

// بلوكات مصمتة تغطي الخامة بالكامل.
// إذا أي جار للخامة مو من هاي القائمة (هوا، ماي، زجاج، تراب، رمل...)
// تبقى الخامة حقيقية حتى اللاعب العادي يشوفها طبيعي.
// ملاحظة: التراب والرمل والحصى مو موجودة عن قصد، لأنها تنشال (Enderman)
// أو تطيح (رمل/حصى) بدون ما ينكسر بلوك.
export const OCCLUDERS = new Set([
  ...HOSTS,
  ...ORES,
  ...LIT_ORES,
  "minecraft:bedrock",
  "minecraft:obsidian",
  "minecraft:dripstone_block",
  "minecraft:infested_stone",
  "minecraft:infested_deepslate",
  "minecraft:magma",
  "minecraft:soul_soil",
  "minecraft:cobblestone",
  "minecraft:cobbled_deepslate",
  "minecraft:polished_basalt",
  "minecraft:gilded_blackstone",
]);

// الأبعاد المدعومة. minY ثابت لأنه داخل بتشفير البيانات.
export const DIMENSIONS = {
  "minecraft:overworld": { short: "o", minY: -64, scanMaxY: 319 },
  "minecraft:nether": { short: "n", minY: 0, scanMaxY: 127 },
};
export const DIM_BY_SHORT = Object.fromEntries(
  Object.entries(DIMENSIONS).map(([id, d]) => [d.short, id])
);

// الإعدادات الافتراضية (تتغير بالأوامر وتنحفظ بالعالم).
export const DEFAULT_SETTINGS = {
  radius: 10, // نصف قطر الفحص حول كل لاعب (بالتشنكات)
  budgetMs: 5, // أقصى وقت بالملي ثانية يستهلكه الأدآون كل تك
  healRadius: 6, // نصف قطر الفحص الاحتياطي حول اللاعب (بلوكات)
  paused: false,
};

export const TICKING_AREA = "xry_load";
