// Buy a tool / armor / weapon ALREADY enchanted.  The player picks books on the item page, the price grows with every one.
//   price = item price  +  for each chosen enchantment:  (price of that book at that level + FEE_PER_LEVEL * level)
// Anti-exploit: selling an enchanted item is capped at 30% of the book prices (value.js), so buying here and selling again never makes a profit.
import { econMsg } from "./systems/staffcore.js";   // staff tools: frozen money account
import { ItemStack, EnchantmentTypes } from "@minecraft/server";
import { ENCHANTS, ROMAN, bookPrice } from "./books.js";
import { balance, takeMoney, addTx } from "./data.js";
import { countEnchants } from "./shopmeta.js";
import { money } from "./format.js";
import { container } from "./inv.js";
import { resolveItem } from "./alias.js";
import { buyPrice } from "./priceperks.js";
import { addXp, xpPerUnit } from "./xp.js";
import { buyFx } from "./salefx.js";
import { luxDing, luxShop } from "./lux.js";
import { shopMsg } from "./systems/shoplang.js";

/** extra fee on top of the book price: 100 per level (level III = +300).  Change it here. */
export const FEE_PER_LEVEL = 100;

const ARMOR = ["protection", "fire_protection", "blast_protection", "projectile_protection"];
const END = ["unbreaking", "mending", "vanishing"];
const SETS = [
  [/_helmet$/, [...ARMOR, "respiration", "aqua_affinity", "thorns", "binding", ...END]],
  [/_chestplate$/, [...ARMOR, "thorns", "binding", ...END]],
  [/_leggings$/, [...ARMOR, "thorns", "swift_sneak", "binding", ...END]],
  [/_boots$/, [...ARMOR, "feather_falling", "depth_strider", "frost_walker", "soul_speed", "thorns", "binding", ...END]],
  [/_sword$/, ["sharpness", "smite", "bane_of_arthropods", "knockback", "fire_aspect", "looting", "sweeping_edge", ...END]],
  [/_axe$/, ["sharpness", "smite", "bane_of_arthropods", "efficiency", "silk_touch", "fortune", ...END]],
  [/_(pickaxe|shovel|hoe)$/, ["efficiency", "silk_touch", "fortune", ...END]],
  [/^mace$/, ["density", "breach", "wind_burst", "smite", "bane_of_arthropods", "fire_aspect", ...END]],
  [/^bow$/, ["power", "punch", "flame", "infinity", ...END]],
  [/^crossbow$/, ["multishot", "piercing", "quick_charge", ...END]],
  [/^trident$/, ["impaling", "riptide", "loyalty", "channeling", ...END]],
  [/^fishing_rod$/, ["luck_of_the_sea", "lure", ...END]],
  [/^shears$/, ["efficiency", "unbreaking", "mending"]],
  [/^(elytra|shield)$/, END],
];
// enchantments that cannot be on the same item
const EXCLUSIVE = [
  ARMOR, ["sharpness", "smite", "bane_of_arthropods", "density", "breach"], ["silk_touch", "fortune"], ["infinity", "mending"],
  ["multishot", "piercing"], ["riptide", "loyalty", "channeling"], ["depth_strider", "frost_walker"],
];
const BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]));
const exists = (id) => { try { return !!EnchantmentTypes.get(id); } catch (e) { return false; } };

/** the enchantments (objects from books.js) that can be bought for this shop item id ([] = not enchantable) */
export function enchantsFor(id) {
  const key = String(id).replace(/^minecraft:/, "");
  const set = SETS.find(([re]) => re.test(key));
  return set ? set[1].map((n) => BY_ID.get(n)).filter((e) => e && exists(e.id)) : [];
}
export const enchantCost = (e, lv) => bookPrice(e, lv) + FEE_PER_LEVEL * lv;

/** sel = Map(enchant id -> level).  Click = next level, after the maximum = removed.  Removes the ones that conflict. */
export function cycle(sel, e) {
  const next = (sel.get(e.id) ?? 0) + 1;
  if (next > e.max) { sel.delete(e.id); return; }
  sel.set(e.id, next);
  for (const g of EXCLUSIVE) if (g.includes(e.id)) for (const o of g) if (o !== e.id) sel.delete(o);
}

/** { base, parts: [{e, lv, price}], total }  - every part gets the player's trade discount, like the book shop */
export function quote(p, it, sel) {
  const base = buyPrice(p, it[3], it[4]), parts = [];
  let total = base;
  for (const [id, lv] of sel) {
    const e = BY_ID.get(id); if (!e) continue;
    const price = buyPrice(p, enchantCost(e, lv), 0);
    parts.push({ e, lv, price }); total += price;
  }
  return { base, parts, total };
}

export function buyEnchanted(p, it, sel) {
  const [id, name] = it, q = quote(p, it, sel), fail = (m) => { p.sendMessage(shopMsg(p, m)); return false; };
  { const em = econMsg(p); if (em) return fail(em); }
  if (!q.parts.length) return fail("§c[Shop] Choose at least one enchantment.");
  if (balance(p) < q.total) return fail(`§c[Shop] Not enough money. Need §f${money(q.total)}§c.`);
  if (container(p).emptySlotsCount < 1) return fail("§c[Shop] Your inventory is full.");
  const r = resolveItem(id, name);
  if (!r || r.legacy) return fail(`§c[Shop] "${name}" is not available in this game version.`);
  let stack;
  try {
    stack = new ItemStack(r.full, 1);
    const comp = stack.getComponent("enchantable");
    for (const { e, lv } of q.parts) comp.addEnchantment({ type: EnchantmentTypes.get(e.id), level: lv });
  } catch (err) { return fail("§c[Shop] Those enchantments cannot be combined on this item. You were not charged."); }
  takeMoney(p, q.total); container(p).addItem(stack);
  addTx(p, { type: "buy", id, name: `${name} (${q.parts.map((x) => x.e.name + " " + ROMAN[x.lv]).join(", ")})`, qty: 1, total: q.total });
  try { countEnchants(q.parts.map((x) => [x.e.id, x.lv])); } catch (err) { /* ignore */ }
  buyFx(p, q.total); p.sendMessage(shopMsg(p, `§c+1 ${name} §d(${q.parts.length} enchant${q.parts.length > 1 ? "s" : ""}) §c(-${money(q.total)})`)); luxDing(p); luxShop(p);
  addXp(p, "b", xpPerUnit(q.total));
  return true;
}
