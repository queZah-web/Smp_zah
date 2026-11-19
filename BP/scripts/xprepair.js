// SPAWNER XP -> REPAIR FIRST.  When XP is taken out of a spawner it first repairs what the player HOLDS and WEARS, the rest goes to the player's level.
//  * order: item in the hand -> helmet -> chestplate / elytra -> leggings -> boots   (only these slots; nothing else in the inventory is touched)
//  * 1 XP = DURABILITY_PER_XP durability points (1 = "the same number as the XP", vanilla Mending would be 2)
//  * ONLY items that have the Mending enchantment are repaired; only damaged items are touched; the XP that is not needed for repairs is given to the player as normal XP
import { EquipmentSlot } from "@minecraft/server";

export const DURABILITY_PER_XP = 1;
const SLOTS = [EquipmentSlot.Mainhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];

const hasMending = (it) => {
  try {
    const e = it.getComponent("enchantable"); if (!e) return false;
    return e.getEnchantments().some((x) => String(x.type?.id ?? x.type).replace("minecraft:", "") === "mending");
  } catch (err) { return false; }
};

/** repairs held + worn items with up to `xp` XP.  returns { left: XP that was NOT used, points: durability restored, items: how many items were repaired } */
export function repairWithXp(p, xp) {
  let left = Math.max(0, Math.floor(xp)), points = 0, items = 0;
  let eq; try { eq = p.getComponent("equippable"); } catch (e) { eq = null; }
  if (!eq || left <= 0) return { left, points, items };
  for (const slot of SLOTS) {
    if (left <= 0) break;
    try {
      const it = eq.getEquipment(slot); if (!it || !hasMending(it)) continue;
      const d = it.getComponent("durability"); if (!d || !(d.damage > 0)) continue;
      const fix = Math.min(d.damage, left * DURABILITY_PER_XP);             // durability points this item can still take
      if (fix <= 0) continue;
      d.damage = d.damage - fix;
      eq.setEquipment(slot, it);
      const used = Math.min(left, Math.ceil(fix / DURABILITY_PER_XP));      // XP this repair costs
      left -= used; points += fix; items++;
    } catch (e) { /* this slot is skipped, the XP stays available for the next one */ }
  }
  return { left, points, items };
}

/** gives `xp` to the player: repairs first, the rest becomes normal XP.  returns false when the XP could not be given at all */
export function giveXp(p, xp) {
  const r = repairWithXp(p, xp);
  if (r.left > 0) { try { p.addExperience(r.left); } catch (e) { return r.points > 0 ? r : false; } }
  return r;
}
