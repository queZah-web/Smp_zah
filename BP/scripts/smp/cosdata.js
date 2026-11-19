// COSMETICS catalogue - edit prices / add items here.  (Every item is bought once with money OR shards and then owned forever.)
//  * COLORS : colour of your name in chat.            id, name, code ("§c"...) or rainbow:true, icon, money, shards
//  * TRAILS : particles that follow you when you move. id, name, icon, money, shards, and ONE of:
//               lux: [r,g,b]        -> the server's own "lux:spark" particle in that colour
//               pixel: [r,g,b]      -> tiny pixel dust (lux:pixel)
//               vanilla: "minecraft:..."  -> a normal game particle
const S = "textures/ui/shop/";
export const COLORS = [
  { id: "red",    name: "Red",     code: "§c", icon: S + "i3d_red_wool",        money: 50000, shards: 400 },
  { id: "gold",   name: "Gold",    code: "§6", icon: S + "i3d_orange_wool",     money: 50000, shards: 400 },
  { id: "yellow", name: "Yellow",  code: "§e", icon: S + "i3d_yellow_wool",     money: 50000, shards: 400 },
  { id: "green",  name: "Green",   code: "§a", icon: S + "i3d_lime_wool",       money: 50000, shards: 400 },
  { id: "aqua",   name: "Aqua",    code: "§b", icon: S + "i3d_light_blue_wool", money: 50000, shards: 400 },
  { id: "blue",   name: "Blue",    code: "§9", icon: S + "i3d_blue_wool",       money: 50000, shards: 400 },
  { id: "purple", name: "Purple",  code: "§d", icon: S + "i3d_magenta_wool",    money: 50000, shards: 400 },
  { id: "white",  name: "White",   code: "§f", icon: S + "i3d_white_wool",      money: 50000, shards: 400 },
  { id: "rainbow", name: "Rainbow", rainbow: true,  icon: S + "x_firework_star",     money: 250000, shards: 1800 },
];
export const TRAILS = [
  { id: "gold",     name: "Gold Sparks",    icon: S + "i3d_glowstone",        money: 150000, shards: 1200, lux: [1.0, 0.82, 0.42] },
  { id: "ice",      name: "Ice Sparks",     icon: S + "x_heart_of_the_sea",   money: 150000, shards: 1200, lux: [0.55, 0.9, 1.0] },
  { id: "rose",     name: "Rose Sparks",    icon: S + "x_cherry_petals",      money: 150000, shards: 1200, lux: [1.0, 0.62, 0.85] },
  { id: "emerald",  name: "Emerald Sparks", icon: "textures/items/emerald",   money: 150000, shards: 1200, lux: [0.5, 1.0, 0.65] },
  { id: "amethyst", name: "Amethyst Dust",  icon: S + "i3d_amethyst_block",   money: 250000, shards: 2000, pixel: [0.68, 0.32, 1.0] },
  { id: "hearts",   name: "Hearts",         icon: S + "i3d_pink_wool",        money: 250000, shards: 2000, vanilla: "minecraft:heart_particle" },
  { id: "notes",    name: "Music Notes",    icon: S + "i3d_noteblock",        money: 250000, shards: 2000, vanilla: "minecraft:note_particle" },
  { id: "fire",     name: "Fire",           icon: S + "ic_fire",              money: 400000, shards: 3200, vanilla: "minecraft:basic_flame_particle" },
  { id: "stars",    name: "Totem Stars",    icon: S + "x_firework_star",      money: 400000, shards: 3200, vanilla: "minecraft:totem_particle" },
];
export const colorById = (id) => COLORS.find((c) => c.id === id) ?? null;
export const trailById = (id) => TRAILS.find((t) => t.id === id) ?? null;
const RAINBOW = ["§c", "§6", "§e", "§a", "§b", "§9", "§d"];
/** the name with the colour applied  ("Steve" -> "§cSteve"), rainbow = one colour per letter */
export function paint(c, name) {
  if (!c) return name;
  if (c.rainbow) { let i = 0; return [...name].map((ch) => (ch === " " ? ch : RAINBOW[i++ % RAINBOW.length] + ch)).join("") + "§r"; }
  return c.code + name + "§r";
}
