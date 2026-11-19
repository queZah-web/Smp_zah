// Shows the shop SELL price under the item name (the hover text in the inventory):
//     Raw Chicken
//     Sell: $10 each
// How: every 2 ticks (0.1 s) each player's inventory is checked; a sellable item gets one lore line "Sell: $X each" (X = exactly what the sell box pays
// for that stack, see value.js), an item that is no longer sellable loses it. Items that are not in the shop get nothing.
// inv.js / value.js ignore this line, so selling works exactly as before.
// A freshly picked up item has no line for at most 0.1 s; when it gets one it is merged into a matching stack, so stacks do not stay split.
import { world, system } from "@minecraft/server";
import { CATEGORIES } from "./shop_data.js";
import { stackValue } from "./value.js";
import { isPriceLine } from "./inv.js";
import { money } from "./format.js";
import { addAliases } from "./alias.js";

const BY_TYPE = new Map();      // same lookup as the sell box (first catalogue entry of an id)
for (const c of CATEGORIES) for (const it of c.items) if (!BY_TYPE.has(it[0])) BY_TYPE.set(it[0], it);
let aliased = false;       // the real game ids are added once, after the game has started
const lineFor = (n) => "§r§7Sell: §a" + money(n) + " §7each";

/** moves as much as fits of `item` into other identical stacks (only those that already show the same price).
 *  returns how many are left over (0 = everything was merged). An ItemStack amount can never be set to 0, so we only count here. */
function mergeInto(c, slot, item) {
  let left = item.amount;
  if (typeof item.isStackableWith !== "function") return left;
  for (let i = 0; i < c.size && left > 0; i++) {
    if (i === slot) continue;
    const o = c.getItem(i);
    if (!o || o.typeId !== item.typeId || o.amount >= o.maxAmount || !o.isStackableWith(item)) continue;
    const n = Math.min(o.maxAmount - o.amount, left);
    o.amount += n; c.setItem(i, o); left -= n;
  }
  return left;
}

function tidySlot(p, c, i, sel) {
  const s = c.getItem(i); if (!s) return;
  const lore = s.getLore(), old = lore.find(isPriceLine) ?? null;
  const it = BY_TYPE.get(s.typeId.replace("minecraft:", ""));
  const unit = it ? stackValue(s, it).unit : 0;
  const want = unit > 0 ? lineFor(unit) : null;
  if (old === want) return;                                             // already right
  if (i === sel && s.getComponent("durability")) return;                // never swap the tool in your hand while you use it
  const rest = lore.filter((l) => !isPriceLine(l));
  s.setLore(want ? [...rest, want] : rest.length ? rest : undefined);
  const left = want ? mergeInto(c, i, s) : s.amount;
  if (left <= 0) { c.setItem(i, undefined); return; }
  if (left !== s.amount) s.amount = left;
  c.setItem(i, s);
}

export function tidy(p) {
  if (!aliased) { try { addAliases(BY_TYPE); aliased = true; } catch (e) { /* try again next round */ } }
  const c = p.getComponent("inventory")?.container; if (!c) return;
  const sel = p.selectedSlotIndex;
  for (let i = 0; i < c.size; i++) {
    try { tidySlot(p, c, i, sel); } catch (e) { /* one bad slot must never stop the others */ }
  }
}

try {
  system.runInterval(() => {
    for (const p of world.getAllPlayers()) { try { tidy(p); } catch (e) { /* ignore this player this round */ } }
  }, 2);
} catch (e) { console.warn("[pricelore] cannot start: " + e); }
