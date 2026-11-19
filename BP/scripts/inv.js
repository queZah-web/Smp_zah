import { ItemStack } from "@minecraft/server";
import { realId, resolveItem } from "./alias.js";
const ns = (id, name) => realId(id, name);       // the real game id of a shop id (sugar cane = reeds / sugar_cane ...)
export const container = (p) => p.getComponent("inventory").container;

/** the "Sell: $10 each" line that pricelore.js writes under an item's name - it never counts as custom lore */
const strip = (l) => String(l).replace(/§./g, "");
export const isPriceLine = (l) => /^Sell: \$[\d,]+( each)?$/.test(strip(l));
export const customLore = (s) => s.getLore().filter((l) => !isPriceLine(l));

/** plain = untouched stack: no name, lore, enchants or damage (only these can be sold) */
export function isPlain(s) {
  try {
    if (s.nameTag) return false;
    if (customLore(s).length) return false;
    const d = s.getComponent("durability"); if (d && d.damage > 0) return false;
    const e = s.getComponent("enchantable"); if (e && e.getEnchantments().length > 0) return false;
  } catch (err) { return false; }
  return true;
}
export function countPlain(p, typeId) {
  typeId = ns(typeId); const c = container(p); let n = 0;
  for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s && s.typeId === typeId && isPlain(s)) n += s.amount; }
  return n;
}
/** how many of this item still fit (-1 = this item does not exist in this game version) */
export function spaceFor(p, typeId, name) {
  const r = resolveItem(typeId, name); if (!r) return -1;
  const c = container(p);
  if (r.legacy) return c.emptySlotsCount * r.legacy[2];            // old "id + data" item (coloured bed ...): only empty slots count
  typeId = r.full; let max;
  try { max = new ItemStack(typeId, 1).maxAmount; } catch (e) { return -1; }
  let space = 0;
  for (let i = 0; i < c.size; i++) {
    const s = c.getItem(i);
    if (!s) space += max; else if (s.typeId === typeId && isPlain(s) && s.amount < s.maxAmount) space += s.maxAmount - s.amount;
  }
  return space;
}
export function removePlain(p, typeId, qty) {
  typeId = ns(typeId); const c = container(p); let left = qty;
  for (let i = 0; i < c.size && left > 0; i++) {
    const s = c.getItem(i);
    if (!s || s.typeId !== typeId || !isPlain(s)) continue;
    const take = Math.min(left, s.amount);
    if (take === s.amount) c.setItem(i, undefined); else { s.amount -= take; c.setItem(i, s); }
    left -= take;
  }
  return qty - left;
}
export function give(p, typeId, qty, name) {
  try {
    const r = resolveItem(typeId, name); if (!r) return false;
    if (r.legacy) {                                                  // delivered with the give command (id + data value)
      const [oldId, data, max] = r.legacy; let left = qty;
      while (left > 0) {
        const n = Math.min(max, left);
        if (!(p.runCommand(`give @s ${oldId} ${n} ${data}`).successCount > 0)) return false;
        left -= n;
      }
      return true;
    }
    typeId = r.full; const max = new ItemStack(typeId, 1).maxAmount; const c = container(p);
    while (qty > 0) {
      const n = Math.min(max, qty);
      const rest = c.addItem(new ItemStack(typeId, n));
      if (rest) p.dimension.spawnItem(rest, p.location);      // full inventory -> drops at your feet
      qty -= n;
    }
    return true;
  } catch (e) { return false; }
}
