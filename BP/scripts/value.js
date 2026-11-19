// Sell value of a REAL item stack (enchants + durability aware).
//
// Anti-exploit rules (so nobody can buy books -> enchant -> sell for profit):
//   1. every enchantment is worth only ENCH_RATE (30%) of what its book costs in the shop
//   2. the whole item can never sell for more than CAP_RATE (60%) of the item's SHOP BUY price
//      -> even free enchants (enchanting table) on a bought item can never make a profit
//   3. damaged items are worth a little less: a worn-out item loses at most WEAR_MAX (20%) of its price (half worn = -10%)
//   4. renamed / lore items, curses and enchanted books are worth nothing extra / not sellable
import { ENCHANTS, bookPrice } from "./books.js";
import { isPriceLine } from "./inv.js";

// ---- upgraded tools (pickaxe / axe / shovel / hoe with "Speed Boost +5%..25%")
// Every +5% upgrade adds a RANDOM 7% - 15% to the tool's value (rolled in skills.js, stored on the tool as the lore line "Upgrade Value +X%").
// The value is applied here, so the sell box, chest sell and the "Sell: $X each" line all agree. The upgraded value is capped at UP_CAP (80%) of the shop buy price, so it can never be a profit.
const stripC = (x) => String(x).replace(/§./g, "");
export const VALUE_RE = /^Upgrade Value \+(\d+(?:\.\d+)?)%$/;
export const BOOST_RE = /^Speed Boost \+\d+%$/;
export const valueLine = (pct) => "§r§6Upgrade Value §a+" + pct + "%";
/** total value multiplier of an upgraded tool: 1 = no bonus */
export function upgradeMult(st) {
  try { for (const l of st.getLore()) { const m = VALUE_RE.exec(stripC(l)); if (m) return 1 + Math.min(500, parseFloat(m[1]) || 0) / 100; } } catch (e) { /* ignore */ }
  return 1;
}
/** lore lines that we write ourselves: they are not "custom lore" (so an upgraded tool can still be sold) */
const ours = (l) => isPriceLine(l) || BOOST_RE.test(stripC(l)) || VALUE_RE.test(stripC(l));

export const ENCH_RATE = 0.30;
export const CAP_RATE = 0.60;
export const UP_CAP = 0.80;
export const UP_BOOST = 1.5;                  // an upgraded tool sells for 50% MORE than its (old) upgraded price - still limited by UP_CAP
export const WEAR_MAX = 0.20;                 // the most a damaged item can lose: 20% (at 0 durability left)
const CURSES = new Set(["binding", "vanishing"]);
const BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]));
export const UPGRADABLE = /(sword|pickaxe|_axe$|shovel|hoe|helmet|chestplate|leggings|boots|^bow$|crossbow|trident|shield|elytra|mace|fishing_rod|shears)/;

/** value of one enchantment (id, level) */
export function enchantValue(id, level) {
  id = String(id).replace("minecraft:", "");
  const e = BY_ID.get(id);
  if (!e || CURSES.has(id)) return 0;
  return Math.floor(bookPrice(e, Math.max(1, Math.min(level, e.max))) * ENCH_RATE);
}

/**
 * it = shop catalogue entry [id, name, texture, buyPrice, sellPrice]
 * returns { unit, up } : price of ONE item of this stack, and whether enchants raised it.  unit = 0 -> cannot be sold
 */
export function stackValue(st, it) {
  const buy = it[3], sell = it[4];
  if (sell <= 0) return { unit: 0, up: false };
  try {
    if (st.nameTag) return { unit: 0, up: false };
    if (st.getLore().filter((l) => !ours(l)).length) return { unit: 0, up: false };
    let frac = 1;
    const d = st.getComponent("durability");
    if (d && d.maxDurability > 0) frac = 1 - WEAR_MAX * Math.min(1, Math.max(0, d.damage / d.maxDurability));     // full durability = 100%, worn out = 80%
    let bonus = 0;
    const e = st.getComponent("enchantable");
    if (e) for (const en of e.getEnchantments()) bonus += enchantValue(en.type.id, en.level);
    const raw = sell + bonus, cap = Math.max(sell, Math.floor(buy * CAP_RATE));
    const base0 = Math.min(raw, cap);
    const mult = upgradeMult(st);
    // upgraded tool: +7-15% per +5%. It may sell above its normal price (an upgrade can not be earned again if the tool is lost), but NEVER above UP_CAP (80%)
    // of the shop buy price: with the best shop discount (-10%) and sell bonus (+10%) buy -> upgrade -> sell can then never make a profit.
    const upCap = Math.floor(buy * UP_CAP);
    const base = mult > 1 ? Math.max(base0, Math.min(Math.floor(base0 * mult * UP_BOOST), upCap)) : base0;
    const v = base > 0 ? Math.max(1, Math.floor(base * frac)) : 0;
    return { unit: v > 0 ? v : 0, up: base > sell };
  } catch (err) { return { unit: 0, up: false }; }
}
