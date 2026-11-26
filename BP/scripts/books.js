// Enchanted books: [id, name, maxLevel, price of level I]  - price of level n = base * 2^(n-1)
// Medium prices: every book costs half of what it cost before (Sharpness V 40,000 -> 20,000, Mending 30,000 -> 15,000).
const RAW = [
  // armor
  ["protection","Protection",4,1000],["fire_protection","Fire Protection",4,750],["blast_protection","Blast Protection",4,1000],
  ["projectile_protection","Projectile Protection",4,750],["feather_falling","Feather Falling",4,750],["respiration","Respiration",3,1000],
  ["aqua_affinity","Aqua Affinity",1,2000],["thorns","Thorns",3,1500],["depth_strider","Depth Strider",3,1500],["frost_walker","Frost Walker",2,3000],
  ["soul_speed","Soul Speed",3,4000],["swift_sneak","Swift Sneak",3,6000],["binding","Curse of Binding",1,500],
  // melee
  ["sharpness","Sharpness",5,1250],["smite","Smite",5,750],["bane_of_arthropods","Bane of Arthropods",5,750],["knockback","Knockback",2,1250],
  ["fire_aspect","Fire Aspect",2,2000],["looting","Looting",3,3000],["sweeping_edge","Sweeping Edge",3,1500],
  ["wind_burst","Wind Burst",3,6000],["density","Density",5,2000],["breach","Breach",4,4000],["lunge","Lunge",3,3000],
  // tools
  ["efficiency","Efficiency",5,1250],["silk_touch","Silk Touch",1,7500],["fortune","Fortune",3,4000],
  // bows / crossbows / tridents / fishing
  ["power","Power",5,1250],["punch","Punch",2,1000],["flame","Flame",1,2500],["infinity","Infinity",1,10000],
  ["multishot","Multishot",1,3000],["piercing","Piercing",4,1250],["quick_charge","Quick Charge",3,2000],
  ["impaling","Impaling",5,1000],["riptide","Riptide",3,3000],["loyalty","Loyalty",3,1500],["channeling","Channeling",1,3000],
  ["luck_of_the_sea","Luck of the Sea",3,2000],["lure","Lure",3,1500],
  // universal
  ["unbreaking","Unbreaking",3,1750],["mending","Mending",1,15000],["vanishing","Curse of Vanishing",1,500],
];
export const ROMAN = ["", "I", "II", "III", "IV", "V"];
export const ENCHANTS = RAW.map(([id, name, max, base]) => ({ id, name, max, base }));
export const bookPrice = (e, level) => e.base * 2 ** (level - 1);
export const BOOKS_CATEGORY = {
  id: "books", name: "Enchanted Books", icon: "textures/items/book_enchanted", type: "book",
  items: ENCHANTS.map((e) => [e.id, e.name + " (max " + ROMAN[e.max] + ")", "textures/items/book_enchanted", e.base, 0]),
};
