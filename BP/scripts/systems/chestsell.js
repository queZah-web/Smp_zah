// "Chest Sell" (paid upgrade in /mining, AXE): breaking a chest / trapped chest / barrel with an axe sells everything inside
// that can be sold (shop sell prices, bonuses, XP, history - exactly like /sell). 
// The chest itself is NOT broken: it stays in place, only its contents are sold; unsellable items stay inside.  Survival mode only.
import { econMsg } from "./staffcore.js";   // staff tools: frozen money account
import { world, system, ItemStack } from "@minecraft/server";
import { activeOpts } from "./mining.js";
import { atLimit } from "./specialtool.js";
import { canEditBlock } from "./landcore.js";
import { CATEGORIES } from "../shop_data.js";
import { addAliases } from "../alias.js";
import { stackValue } from "../value.js";
import { sellCommit } from "../priceperks.js";
import { addMoney, addTx } from "../data.js";
import { addXp, xpPerUnit } from "../xp.js";
import { saleFx } from "../salefx.js";
import { money, num } from "../format.js";
import { menuMsg } from "./menulang.js";

const BY = new Map();
for (const c of CATEGORIES) for (const it of c.items) if (!BY.has(it[0])) BY.set(it[0], it);
try { system.runTimeout(() => { try { addAliases(BY); } catch (e) { /* ignore */ } }, 25); } catch (e) { /* ignore */ }

const BOXES = new Set(["chest", "trapped_chest", "barrel"]);
const busy = new Set();
const enchLevel = (item, name) => { try { return item.getComponent("enchantable")?.getEnchantment(name)?.level ?? 0; } catch (e) { return 0; } };
const infoOf = (st) => {
  const it = BY.get(st.typeId.replace("minecraft:", "")); if (!it) return null;
  const v = stackValue(st, it); return v.unit > 0 ? { it, unit: v.unit } : null;
};

function wearAxe(player, toolId) {
  try {
    const c = player.getComponent("inventory").container, slot = player.selectedSlotIndex, item = c.getItem(slot);
    if (!item || item.typeId !== toolId) return;
    if (atLimit(item, 1)) return;                       // special tool: never breaks
    const d = item.getComponent("durability"); if (!d) return;
    if (Math.random() < 1 / (enchLevel(item, "unbreaking") + 1)) {
      if (d.damage + 1 >= d.maxDurability) { c.setItem(slot, undefined); try { player.playSound("random.break"); } catch (e) { /* ignore */ } return; }
      d.damage += 1; c.setItem(slot, item);
    }
  } catch (e) { /* ignore */ }
}

/** gives to the player, what does not fit is dropped at the feet - never lost */
function giveBack(player, st) {
  try {
    const left = player.getComponent("inventory").container.addItem(st);
    if (left) player.dimension.spawnItem(left, player.location);
  } catch (e) { try { player.dimension.spawnItem(st, player.location); } catch (e2) { /* ignore */ } }
}

function process(player, dim, loc, typeId, toolId) {
  { const em = econMsg(player); if (em) { try { player.sendMessage(menuMsg(player, em)); } catch (e) { /* ignore */ } return; } }
  const block = dim.getBlock(loc);
  if (!block || block.typeId !== typeId) return;
  const held = player.getComponent("inventory")?.container?.getItem(player.selectedSlotIndex);
  if (!held || held.typeId !== toolId) return;
  const cont = block.getComponent("minecraft:inventory")?.container;
  const sold = {};
  let total = 0, n = 0, xp = 0, bonus = 0, kept = 0;
  if (cont) {
    for (let i = 0; i < cont.size; i++) {
      const st = cont.getItem(i); if (!st) continue;
      const info = infoOf(st);
      if (info) {
        const plan = sellCommit(player, info.it[0], info.unit, st.amount);
        cont.setItem(i, undefined);
        total += plan.total; bonus += plan.bonus; n += st.amount; xp += st.amount * xpPerUnit(info.it[3]);
        sold[info.it[0]] ??= { it: info.it, qty: 0, total: 0 }; sold[info.it[0]].qty += st.amount; sold[info.it[0]].total += plan.total;
      } else kept += st.amount;
    }
  }
  wearAxe(player, toolId);
  if (total > 0) {
    addMoney(player, total);
    for (const k in sold) addTx(player, { type: "sell", id: sold[k].it[0], name: sold[k].it[1], qty: sold[k].qty, total: sold[k].total });
    try { saleFx(player, total); } catch (e) { /* ignore */ }
    player.sendMessage(menuMsg(player, "§a[Chest Sell] Sold §f" + num(n) + " §aitems for §e" + money(total) + (bonus > 0 ? " §8(+" + money(bonus) + " bonus)" : "") + (kept ? " §7- " + num(kept) + " unsellable items stay in the chest" : "") + "."));
    try { addXp(player, "s", xp); } catch (e) { /* ignore */ }
  } else player.sendMessage(menuMsg(player, "§7[Chest Sell] Nothing to sell in this chest."));
}

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.cancel) return;
    const player = ev.player, block = ev.block;
    const tool = ev.itemStack?.typeId ?? "";
    if (!/_axe$/.test(tool)) return;
    if (atLimit(ev.itemStack)) return;                 // special axe at its limit: specialtool.js cancels the break
    const id = block.typeId.replace("minecraft:", "");
    if (!BOXES.has(id)) return;
    const gm = String(player.getGameMode()).toLowerCase();
    if (gm === "creative" || gm === "spectator") return;
    if (!activeOpts(player).chest) return;
    if (!canEditBlock(player, block)) return;
    if (busy.has(player.id)) { ev.cancel = true; return; }
    ev.cancel = true;
    busy.add(player.id);
    const dim = block.dimension, loc = { x: block.location.x, y: block.location.y, z: block.location.z }, typeId = block.typeId;
    system.run(() => { try { process(player, dim, loc, typeId, tool); } catch (e) { console.warn("chest sell failed: " + e); } finally { busy.delete(player.id); } });
  } catch (e) { /* never break normal mining */ }
});
