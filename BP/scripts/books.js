// Enchanted books: [id, name, maxLevel, price of level I]  - price of level n = base * 2^(n-1)
const RAW = [
  // armor
  ["protection","Protection",4,2000],["fire_protection","Fire Protection",4,1500],["blast_protection","Blast Protection",4,2000],
  ["projectile_protection","Projectile Protection",4,1500],["feather_falling","Feather Falling",4,1500],["respiration","Respiration",3,2000],
  ["aqua_affinity","Aqua Affinity",1,4000],["thorns","Thorns",3,3000],["depth_strider","Depth Strider",3,3000],["frost_walker","Frost Walker",2,6000],
  ["soul_speed","Soul Speed",3,8000],["swift_sneak","Swift Sneak",3,12000],["binding","Curse of Binding",1,1000],
  // melee
  ["sharpness","Sharpness",5,2500],["smite","Smite",5,1500],["bane_of_arthropods","Bane of Arthropods",5,1500],["knockback","Knockback",2,2500],
  ["fire_aspect","Fire Aspect",2,4000],["looting","Looting",3,6000],["sweeping_edge","Sweeping Edge",3,3000],
  ["wind_burst","Wind Burst",3,12000],["density","Density",5,4000],["breach","Breach",4,8000],
  // tools
  ["efficiency","Efficiency",5,2500],["silk_touch","Silk Touch",1,15000],["fortune","Fortune",3,8000],
  // bows / crossbows / tridents / fishing
  ["power","Power",5,2500],["punch","Punch",2,2000],["flame","Flame",1,5000],["infinity","Infinity",1,20000],
  ["multishot","Multishot",1,6000],["piercing","Piercing",4,2500],["quick_charge","Quick Charge",3,4000],
  ["impaling","Impaling",5,2000],["riptide","Riptide",3,6000],["loyalty","Loyalty",3,3000],["channeling","Channeling",1,6000],
  ["luck_of_the_sea","Luck of the Sea",3,4000],["lure","Lure",3,3000],
  // universal
  ["unbreaking","Unbreaking",3,3500],["mending","Mending",1,30000],["vanishing","Curse of Vanishing",1,1000],
];
export const ROMAN = ["", "I", "II", "III", "IV", "V"];
export const ENCHANTS = RAW.map(([id, name, max, base]) => ({ id, name, max, base }));
export const bookPrice = (e, level) => e.base * 2 ** (level - 1);
export const BOOKS_CATEGORY = {
  id: "books", name: "Enchanted Books", icon: "textures/items/book_enchanted", type: "book",
  items: ENCHANTS.map((e) => [e.id, e.name + " (max " + ROMAN[e.max] + ")", "textures/items/book_enchanted", e.base, 0]),
};
