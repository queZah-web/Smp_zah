// Trading perks on the shop (see systems/skills.js).  Trading level 50 = buy prices -5%, 100 = -10% (max),
// 150 = sell prices +5%, 200 = +10% (max).  Only players who reached the level get them.
//
// Anti-exploit (no loops, no easy money):
//   * the discount only touches MONEY prices (never shards) and never goes below 110% of what the same item sells for
//   * in the catalogue the best sell/buy ratio is 34% (tools/check_prices.py), so buy at -10% and sell at +10% can never profit
//   * items that were BOUGHT from the shop (money or shards) or RECEIVED from villagers never get the sell bonus
//     (the bonus is only paid on items you got some other way: mined, farmed, fished, dropped by mobs ...)
//   * every price is rounded per transaction in the shop's favour (floor for what you get, round for what you pay)
import { skillData, tradeBuyDiscount, tradeSellBonus, noBonusAdd } from "./systems/skills.js";

export { noBonusAdd };
export const discountPct = (p) => { try { return tradeBuyDiscount(p); } catch (e) { return 0; } };
export const sellBonusPct = (p) => { try { return tradeSellBonus(p); } catch (e) { return 0; } };

/** price of ONE item for this player. price = normal shop price, sellPrice = what the same item sells for (0 if not sellable) */
export function buyPrice(p, price, sellPrice = 0) {
  const d = discountPct(p);
  if (d <= 0 || !(price > 1)) return price;
  let v = Math.round((price * (100 - d)) / 100);
  if (sellPrice > 0) v = Math.max(v, Math.ceil((sellPrice * 110) / 100));      // never cheaper than the best possible sell price
  return Math.max(1, Math.min(price, v));
}

/** what selling `qty` items (normal price `unit` each) pays. used = optional Map to preview several stacks of the same item.
 *  -> { total, bonus }   (nothing is changed) */
export function sellPlan(p, id, unit, qty, used) {
  const base = unit * qty, b = sellBonusPct(p);
  if (b <= 0) return { total: base, bonus: 0 };
  let credit = 0;
  try { credit = skillData(p).nb[id] ?? 0; } catch (e) { credit = 0; }
  if (used) credit -= used.get(id) ?? 0;
  const plain = Math.max(0, Math.min(credit, qty)), rest = qty - plain;
  if (used) used.set(id, (used.get(id) ?? 0) + plain);
  const total = unit * plain + Math.floor((unit * rest * (100 + b)) / 100);
  return { total, bonus: total - base };
}

/** same as sellPlan, but it is really sold: the "bought from the shop" credit of this item is used up */
export function sellCommit(p, id, unit, qty) {
  const r = sellPlan(p, id, unit, qty);
  try {
    const nb = skillData(p).nb, c = nb[id] ?? 0;
    if (c > 0) { const left = c - Math.min(c, qty); if (left > 0) nb[id] = left; else delete nb[id]; }
  } catch (e) { /* ignore */ }
  return r;
}
