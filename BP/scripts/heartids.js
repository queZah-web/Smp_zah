// The Heart items.
//   smp:heart         a full Heart   = 1 heart   (2 half hearts)
//   smp:heart_half    a Half Heart   = 1/2 heart (1 half heart)   made when a spoiled Heart is picked up; repaired with an Enchanted Golden Apple
//   smp:heart_cursed  the dark "Heart of Malevolence": a Heart that lay on the ground too long.  It turns into a Half Heart as soon as somebody picks it up.
import { ItemStack, world } from "@minecraft/server";
export const HEART_ITEM = "smp:heart", HALF_ITEM = "smp:heart_half", CURSED_ITEM = "smp:heart_cursed";
export const REPAIR_ITEM = "minecraft:enchanted_golden_apple";
export const isHeart = (id) => id === HEART_ITEM || id === HALF_ITEM || id === CURSED_ITEM;
export const unitsOfItem = (id) => (id === HEART_ITEM ? 2 : isHeart(id) ? 1 : 0);          // in half hearts

// Hidden buyer tag: the player who BOUGHT the Heart.  No player sees it (it is not readable text), admins read it with buyerOf()
// (action bar while holding the Heart + /shop > Hearts > Logs).  It follows the Heart when it is dropped, picked up, spoiled (Heart of Malevolence),
// turned into a Half Heart and repaired again.  Hearts of the same buyer stack together.
//
// The tag is stored TWICE, because a dynamic property of an item is lost as soon as the item becomes an item entity on the ground (dropped / thrown /
// dropped on death / thrown out of a chest) - which is exactly when the logs need it:
//   1. a dynamic property of the item                         (fast, used while the item is in an inventory)
//   2. an INVISIBLE code at the end of the first lore line    ("§r§r" + the number of the buyer written as colour codes + "§r§r": no text, so nothing
//      can be seen).  It is part of the item itself, so it survives the ground, chests, hoppers and relogs.
//      The number is the buyer's number in a small registry (world properties smp_bt_*:  number -> "player id|name"), so the lore stays very short.
export const BUYER_KEY = "smp_buyer";
const REG_N = "smp_bt_n", REG_ID = "smp_bt_i:", REG_IDX = "smp_bt:";
const numById = new Map(), buyerByNum = new Map();
const HID = /§r§r((?:§\d)+)§r§r/;

/** the number of this buyer in the registry (created when it does not exist yet) */
function numberFor(id, name) {
  let n = numById.get(id);
  if (n == null) { const v = world.getDynamicProperty(REG_ID + id); n = typeof v === "number" ? v : 0; }
  if (!n) { n = (Number(world.getDynamicProperty(REG_N)) || 0) + 1; world.setDynamicProperty(REG_N, n); world.setDynamicProperty(REG_ID + id, n); }
  const cur = buyerByNum.get(n);
  if (!cur || cur.name !== name) { world.setDynamicProperty(REG_IDX + n, id + "|" + name); buyerByNum.set(n, { id, name }); }
  numById.set(id, n);
  return n;
}
/** { id, name } of buyer number n */
function buyerByNumber(n) {
  let b = buyerByNum.get(n);
  if (b) return b;
  try {
    const v = world.getDynamicProperty(REG_IDX + n); if (typeof v !== "string") return null;
    const i = v.indexOf("|"); if (i < 1) return null;
    b = { id: v.slice(0, i), name: v.slice(i + 1) }; buyerByNum.set(n, b); numById.set(b.id, n); return b;
  } catch (e) { return null; }
}
const loreNumber = (stack) => {
  try { for (const line of stack.getLore()) { const m = HID.exec(line); if (m) return Number(m[1].replace(/§/g, "")); } } catch (e) { /* ignore */ }
  return null;
};
/** puts the buyer on the item (property + invisible lore code) and returns the item */
export function tagBuyer(stack, id, name) {
  try { stack.setDynamicProperty(BUYER_KEY, id + "|" + name); } catch (e) { console.warn("[hearts] cannot tag the Heart (property): " + e); }
  try {
    const code = "§r§r" + String(numberFor(id, name)).split("").map((d) => "§" + d).join("") + "§r§r";
    const lore = stack.getLore().map((l) => l.replace(new RegExp(HID.source, "g"), ""));
    if (!lore.length) lore.push("§r§7Heart");
    lore[0] += code;
    stack.setLore(lore);
  } catch (e) { console.warn("[hearts] cannot tag the Heart (lore): " + e); }
  return stack;
}
/** { id, name } of the buyer, or null (Hearts made before the tag existed / given by an admin have none) */
export function buyerOf(stack) {
  try {
    const v = stack?.getDynamicProperty(BUYER_KEY);
    if (typeof v === "string") { const i = v.indexOf("|"); if (i >= 1) return { id: v.slice(0, i), name: v.slice(i + 1) }; }
  } catch (e) { /* ignore */ }
  const n = stack ? loreNumber(stack) : null;                                 // a Heart that was on the ground has lost the property: read the lore code
  return n ? buyerByNumber(n) : null;
}
/** true when the item has the buyer property but not the invisible lore code yet (a Heart bought before the code existed) */
export function needsLoreTag(stack) {
  try { return typeof stack.getDynamicProperty(BUYER_KEY) === "string" && loreNumber(stack) == null; } catch (e) { return false; }
}
/** puts the buyer tag of `from` on `to` (when `from` has one) and returns `to` */
export function copyBuyer(from, to) {
  try { const t = buyerOf(from); if (t) tagBuyer(to, t.id, t.name); } catch (e) { /* ignore */ }
  return to;
}

export function makeHeartStack(amount = 1) {
  const it = new ItemStack(HEART_ITEM, amount);
  it.setLore(["§r§7Permanent extra heart", "§r§7Right-click to use", "§r§8Drops if you die - anyone can use it", "§r§8Left on the ground it spoils"]);
  return it;
}
export function makeHalfStack(amount = 1) {
  const it = new ItemStack(HALF_ITEM, amount);
  it.setLore(["§r§7Half a heart (spoiled)", "§r§7Right-click: use it or repair it", "§r§7Repair = 1 Enchanted Golden Apple"]);
  return it;
}
