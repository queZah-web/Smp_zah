// =====================================================================================================================
// LUCKY BLOCK - what happens when a lucky block is broken (luckywars.js)
//
//   ~60 surprises, LUCKY (weapons, armour sets, legendary items, pets, treasure chests, loot rain, power effects ...),
//   UNLUCKY (mobs, lightning, TNT, anvil rain, arrow rain, cages, cobwebs, bad effects, teleports, trolls ...) and FUN ones.
//   The luck depends on where the block was: a player island < a middle island < the centre < the MEGA lucky block.
//   Items drop out of the block (like the real lucky blocks) and carry the "Lucky Block item" lore: they can't be sold
//   and they are gone after the game.  Mobs carry the tag "lbw" (removed when the arena is reset).
// =====================================================================================================================
import { ItemStack, EnchantmentTypes } from "@minecraft/server";

export const LORE = ["§8Lucky Block item", "§7(disappears after the game)"];
export const LUCKY_ITEM = "minecraft:yellow_glazed_terracotta";
const TAG = "lbw";
const rnd = (n) => Math.floor(Math.random() * n);
const ench = (it, list) => { try { const c = it.getComponent("minecraft:enchantable"); for (const [t, l] of list ?? []) { try { c?.addEnchantment({ type: EnchantmentTypes.get(t), level: l }); } catch (e) { /* not for this item */ } } } catch (e) { /* ignore */ } return it; };
export function item(id, n = 1, en, name) {
  let it; try { it = new ItemStack(id.includes(":") ? id : "minecraft:" + id, n); } catch (e) { return null; }
  ench(it, en);
  try { if (name) it.nameTag = name; it.setLore(LORE); } catch (e) { /* ignore */ }
  return it;
}
export const luckyItem = (n = 1) => item(LUCKY_ITEM, n, null, "§e§lLucky Block");

// ---- helpers (c = { p, dim, at: block centre, pick(en, ar), drop(items), mob(id, n), spots(), addLucky(x, y, z) })
const air = (dim, l) => { try { const b = dim.getBlock(l); return !!b && b.isAir; } catch (e) { return false; } };
const setB = (dim, l, id) => { try { dim.getBlock(l)?.setType("minecraft:" + id); } catch (e) { /* ignore */ } };
const fx = (p, id, sec, amp = 0) => { try { p.addEffect(id, sec * 20, { amplifier: amp, showParticles: true }); } catch (e) { /* ignore */ } };
const cmd = (p, c) => { try { p.runCommand(c); } catch (e) { /* ignore */ } };
const around = (l, r) => { const out = []; for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) out.push({ x: Math.floor(l.x) + dx, z: Math.floor(l.z) + dz }); return out; };
const SET = (pre, en) => ["helmet", "chestplate", "leggings", "boots"].map((s) => item(pre + "_" + s, 1, en));

// [key, kind G / B / F, weight, min tier (0 island, 1 mid, 2 centre, 3 mega), en name, ar name, run(c)]
const LIST = [
  // ---------------------------------------------------------------- LUCKY
  ["dsword", "G", 10, 0, "Diamond Sword", "سيف دايموند", (c) => c.drop([item("diamond_sword", 1, [["sharpness", 1]])])],
  ["isword", "G", 12, 0, "Iron Sword + Shield", "سيف حديد + درع", (c) => c.drop([item("iron_sword", 1, [["sharpness", 1]]), item("shield")])],
  ["iset", "G", 10, 0, "Iron Armour Set", "طقم درع حديد", (c) => c.drop(SET("iron"))],
  ["gset", "G", 6, 0, "Shiny Golden Armour", "طقم ذهبي لامع", (c) => c.drop(SET("golden", [["protection", 3], ["unbreaking", 3]]))],
  ["dset", "G", 5, 1, "Diamond Armour Set", "طقم دايموند", (c) => c.drop(SET("diamond", [["protection", 1]]))],
  ["nsword", "G", 3, 1, "Netherite Sword", "سيف نذرايت", (c) => c.drop([item("netherite_sword", 1, [["sharpness", 2]])])],
  ["lsword", "G", 2, 2, "THE LUCKY SWORD", "سيف الحظ", (c) => c.drop([item("golden_sword", 1, [["sharpness", 5], ["fire_aspect", 2], ["knockback", 1], ["unbreaking", 3]], "§6§lLucky Sword")]), true],
  ["bow", "G", 9, 0, "Bow + Arrows", "قوس + أسهم", (c) => c.drop([item("bow", 1, [["power", 2]]), item("arrow", 24)])],
  ["lbow", "G", 2, 2, "THE LUCKY BOW", "قوس الحظ", (c) => c.drop([item("bow", 1, [["power", 5], ["flame", 1], ["punch", 2], ["infinity", 1]], "§6§lLucky Bow"), item("arrow", 1)]), true],
  ["xbow", "G", 4, 0, "Crossbow Multishot", "قوس نشاب متعدد", (c) => c.drop([item("crossbow", 1, [["multishot", 1], ["quick_charge", 2]]), item("arrow", 16)])],
  ["pearls", "G", 7, 0, "Ender Pearls", "لآلئ إندر", (c) => c.drop([item("ender_pearl", 3)])],
  ["gapple", "G", 8, 0, "Golden Apples", "تفاح ذهبي", (c) => c.drop([item("golden_apple", 4)])],
  ["egapple", "G", 2, 2, "ENCHANTED GOLDEN APPLE", "تفاحة ذهبية مسحورة", (c) => c.drop([item("enchanted_golden_apple", 1)]), true],
  ["totem", "G", 2, 1, "TOTEM OF UNDYING", "طوطم الخلود", (c) => c.drop([item("totem_of_undying", 1)]), true],
  ["blocks", "G", 12, 0, "Building Blocks", "بلوكات بناء", (c) => c.drop([item("white_wool", 64), item("oak_planks", 32)])],
  ["tnt", "G", 6, 0, "TNT Pack", "عدة TNT", (c) => c.drop([item("tnt", 6), item("flint_and_steel")])],
  ["buckets", "G", 5, 0, "Water + Lava Buckets", "سطل ماي + لافا", (c) => c.drop([item("water_bucket"), item("lava_bucket")])],
  ["webs", "G", 5, 0, "Cobwebs + Snowballs", "شبك + كرات ثلج", (c) => c.drop([item("web", 8), item("snowball", 16)])],
  ["kb", "G", 5, 0, "Knockback Stick", "عصا الدفع", (c) => c.drop([item("stick", 1, [["knockback", 2]], "§e§lKnockback Stick")])],
  ["wind", "G", 5, 0, "Wind Charges", "شحنات رياح", (c) => c.drop([item("wind_charge", 8)])],
  ["mace", "G", 2, 2, "THE MACE", "الميس", (c) => c.drop([item("mace", 1, [["wind_burst", 1], ["density", 2]])]), true],
  ["trident", "G", 3, 1, "Trident", "ترايدنت", (c) => c.drop([item("trident", 1, [["loyalty", 3], ["impaling", 2]])])],
  ["elytra", "G", 2, 2, "ELYTRA + Rockets", "إليترا + صواريخ", (c) => c.drop([item("elytra", 1), item("firework_rocket", 8)]), true],
  ["pick", "G", 5, 0, "Lucky Pickaxe", "معول الحظ", (c) => c.drop([item("diamond_pickaxe", 1, [["efficiency", 5]])])],
  ["more", "G", 5, 0, "3 Lucky Blocks!", "3 لوكي بلوك!", (c) => c.drop([luckyItem(3)])],
  ["wolves", "G", 4, 0, "Pet Wolves", "كلاب حارسة", (c) => { for (const w of c.mob("minecraft:wolf", 2)) { try { w.getComponent("minecraft:tameable")?.tame(c.p); } catch (e) { /* ignore */ } } }],
  ["potions", "G", 6, 0, "Potion Pack", "عدة جرعات", (c) => { cmd(c.p, "give @s splash_potion 1 22"); cmd(c.p, "give @s potion 1 16"); cmd(c.p, "give @s potion 1 31"); }],
  ["speed", "G", 5, 0, "Speed + Jump Boost", "سرعة + قفز", (c) => { fx(c.p, "speed", 40, 1); fx(c.p, "jump_boost", 40, 1); }],
  ["strength", "G", 4, 0, "Strength II", "قوة 2", (c) => fx(c.p, "strength", 25, 1)],
  ["regen", "G", 5, 0, "Regeneration + Absorption", "تجدد + حماية", (c) => { fx(c.p, "regeneration", 15, 1); fx(c.p, "absorption", 120, 2); }],
  ["invis", "G", 3, 0, "Invisibility", "اختفاء", (c) => fx(c.p, "invisibility", 30)],
  ["rain", "G", 4, 1, "LOOT RAIN!", "مطر الغنائم!", (c) => { const pool = ["golden_apple", "ender_pearl", "diamond_sword", "iron_chestplate", "diamond_helmet", "arrow", "tnt", "diamond_boots"]; const its = []; for (let i = 0; i < 8; i++) its.push(item(pool[rnd(pool.length)], 1)); c.drop(its, 6) }],
  ["chest", "G", 4, 0, "TREASURE CHEST!", "صندوق كنز!", (c) => {
    const l = { x: Math.floor(c.at.x), y: Math.floor(c.at.y), z: Math.floor(c.at.z) };
    try { c.dim.getBlock(l)?.setType("minecraft:chest"); const box = c.dim.getBlock(l)?.getComponent("minecraft:inventory")?.container; const pool = [["diamond_sword", 1, [["sharpness", 2]]], ["iron_helmet"], ["diamond_chestplate"], ["golden_apple", 3], ["ender_pearl", 2], ["bow", 1, [["power", 3]]], ["arrow", 16], ["oak_planks", 32], ["tnt", 3], ["iron_leggings"]]; for (let i = 0; i < 6; i++) { const s = pool[rnd(pool.length)]; box?.setItem(rnd(27), item(s[0], s[1] ?? 1, s[2])); } } catch (e) { c.drop([item("diamond_sword"), item("golden_apple", 2)]); }
  }],
  // ---------------------------------------------------------------- UNLUCKY
  ["zombies", "B", 8, 0, "Zombie Gang", "عصابة زومبي", (c) => c.mob("minecraft:zombie", 3)],
  ["skeletons", "B", 6, 0, "Skeleton Snipers", "قناصين هياكل", (c) => c.mob("minecraft:skeleton", 2)],
  ["creeper", "B", 6, 0, "Creeper Surprise", "مفاجأة كريبر", (c) => { for (const e of c.mob("minecraft:creeper", 1)) { if (Math.random() < 0.3) { try { e.triggerEvent("minecraft:become_charged"); } catch (x) { /* ignore */ } } } }],
  ["silverfish", "B", 5, 0, "Silverfish Swarm", "سرب سمك فضي", (c) => c.mob("minecraft:silverfish", 6)],
  ["spiders", "B", 5, 0, "Cave Spiders", "عناكب سامة", (c) => c.mob("minecraft:cave_spider", 3)],
  ["witch", "B", 4, 0, "The Witch", "الساحرة", (c) => c.mob("minecraft:witch", 1)],
  ["phantoms", "B", 3, 0, "Phantoms", "أشباح", (c) => c.mob("minecraft:phantom", 2)],
  ["vex", "B", 3, 0, "Vex Attack", "هجوم الفيكس", (c) => c.mob("minecraft:vex", 2)],
  ["slime", "B", 3, 0, "Giant Slime", "سلايم عملاق", (c) => c.mob("minecraft:slime", 1)],
  ["lightning", "B", 5, 0, "LIGHTNING!", "صاعقة!", (c) => { try { c.dim.spawnEntity("minecraft:lightning_bolt", c.p.location); } catch (e) { /* ignore */ } }],
  ["tntrain", "B", 5, 0, "TNT RAIN!", "مطر TNT!", (c) => { const l = c.p.location; for (let i = 0; i < 3; i++) { try { const t = c.dim.spawnEntity("minecraft:tnt", { x: l.x + (Math.random() - 0.5) * 4, y: l.y + 4 + i, z: l.z + (Math.random() - 0.5) * 4 }); t.addTag(TAG); } catch (e) { /* ignore */ } } }],
  ["anvils", "B", 5, 0, "ANVIL RAIN!", "مطر سنادين!", (c) => { const l = c.p.location; for (const s of around(l, 1)) { if (Math.random() < 0.55) { const at = { x: s.x, y: Math.floor(l.y) + 9, z: s.z }; if (air(c.dim, at)) setB(c.dim, at, "anvil"); } } }],
  ["arrows", "B", 4, 0, "Arrow Rain", "مطر أسهم", (c) => { const l = c.p.location; for (let i = 0; i < 12; i++) { try { const a = c.dim.spawnEntity("minecraft:arrow", { x: l.x + (Math.random() - 0.5) * 3, y: l.y + 7 + Math.random() * 3, z: l.z + (Math.random() - 0.5) * 3 }); a.applyImpulse({ x: 0, y: -1.5, z: 0 }); } catch (e) { /* ignore */ } } }],
  ["webtrap", "B", 4, 0, "Cobweb Trap", "فخ شبك", (c) => { const l = c.p.location; for (const s of around(l, 1)) for (const dy of [0, 1]) { const at = { x: s.x, y: Math.floor(l.y) + dy, z: s.z }; if (air(c.dim, at)) setB(c.dim, at, "web"); } }],
  ["cage", "B", 4, 0, "Glass Prison", "سجن زجاج", (c) => { const l = c.p.location, bx = Math.floor(l.x), by = Math.floor(l.y), bz = Math.floor(l.z); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) { if (dx === 0 && dz === 0 && dy < 2) continue; if (!(Math.abs(dx) === 1 || Math.abs(dz) === 1 || dy === 2)) continue; const at = { x: bx + dx, y: by + dy, z: bz + dz }; if (air(c.dim, at)) setB(c.dim, at, "glass"); } }],
  ["fire", "B", 4, 0, "Hot Feet", "رجلين حارة", (c) => { try { c.p.setOnFire(5, true); } catch (e) { /* ignore */ } }],
  ["levitate", "B", 3, 0, "Levitation", "طيران إجباري", (c) => fx(c.p, "levitation", 3, 1)],
  ["blind", "B", 5, 0, "Blindness + Slowness", "عمى + بطء", (c) => { fx(c.p, "blindness", 8); fx(c.p, "slowness", 8, 1); }],
  ["poison", "B", 5, 0, "Poison", "سم", (c) => { fx(c.p, "poison", 6, 0); fx(c.p, "hunger", 15, 1); }],
  ["nausea", "B", 4, 0, "Nausea", "دوخة", (c) => fx(c.p, "nausea", 10)],
  ["fatigue", "B", 4, 0, "Mining Fatigue + Weakness", "تعب + ضعف", (c) => { fx(c.p, "mining_fatigue", 20, 1); fx(c.p, "weakness", 15); }],
  ["teleport", "B", 3, 0, "Random Teleport", "انتقال عشوائي", (c) => { const s = c.spots(); if (s.length) { try { c.p.teleport(s[rnd(s.length)]); } catch (e) { /* ignore */ } } }],
  ["boom", "B", 4, 0, "BOOM!", "بووم!", (c) => { try { c.dim.createExplosion(c.at, 2, { breaksBlocks: true, causesFire: false }); } catch (e) { /* ignore */ } }],
  ["troll", "B", 4, 0, "Fake Diamonds", "دايموند مزيف", (c) => c.drop([item("dirt", 5, null, "§b§lDiamond §r§7(trolled!)")])],
  // ---------------------------------------------------------------- FUN
  ["nothing", "F", 4, 0, "Nothing... but fireworks!", "ولا شي... بس ألعاب نارية!", (c) => { try { for (let i = 0; i < 3; i++) c.dim.spawnEntity("minecraft:fireworks_rocket", { x: c.at.x + (Math.random() - 0.5) * 2, y: c.at.y + 1, z: c.at.z + (Math.random() - 0.5) * 2 }); } catch (e) { /* ignore */ } }],
  ["cake", "F", 3, 0, "Cake Party", "حفلة كيك", (c) => c.drop([item("cake"), item("cookie", 8)])],
  ["farm", "F", 3, 0, "Little Farm", "مزرعة صغيرة", (c) => { c.mob("minecraft:sheep", 1); c.mob("minecraft:chicken", 2); }],
  ["jump", "F", 3, 0, "Lucky Jump", "قفزة الحظ", (c) => { fx(c.p, "slow_falling", 10); try { c.p.applyKnockback({ x: 0, z: 0 }, 2.2); } catch (e) { try { c.p.applyImpulse({ x: 0, y: 2, z: 0 }); } catch (x) { /* ignore */ } } }],
];
// how lucky a block is: [chance of LUCKY, chance of FUN] by tier
const LUCK = { island: [0.6, 0.08], placed: [0.6, 0.08], mid: [0.68, 0.06], center: [0.75, 0.05], mega: [0.9, 0.03] };
const TIER = { island: 0, placed: 0, mid: 1, center: 2, mega: 3 };

/** chooses and runs one surprise.  Returns { kind, en, ar, rare } */
export function openLucky(c, tier) {
  const [pg, pf] = LUCK[tier] ?? LUCK.island, t = TIER[tier] ?? 0, r = Math.random();
  const kind = r < pg ? "G" : r < pg + pf ? "F" : "B";
  let pool = LIST.filter((o) => o[1] === kind && o[3] <= t);
  if (t >= 3 && kind === "G") pool = pool.map((o) => (o[3] >= 1 ? [...o.slice(0, 2), o[2] * 4, ...o.slice(3)] : o));   // the mega block: the best things much more often
  let w = pool.reduce((s, o) => s + o[2], 0) * Math.random(), pickO = pool[0];
  for (const o of pool) { w -= o[2]; if (w <= 0) { pickO = o; break; } }
  try { pickO[6](c); } catch (e) { console.warn("[lucky] " + pickO[0] + ": " + e); }
  return { kind, en: pickO[4], ar: pickO[5], rare: !!pickO[7], key: pickO[0] };
}
export const LUCKY_TAG = TAG;
