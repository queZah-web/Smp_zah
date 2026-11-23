// Red sell slot: ONE slot of the backpack (the top-right one, slot 17) that sells whatever is moved into it.
//  * The player switches it ON / OFF (Sell Items page or /sellslot).  OFF = it is a normal slot.  Default: OFF.
//  * ON: an item that lands in the slot is sold at once with the SAME prices, bonuses, XP and history as /sell (economy.js sellStacks).
//  * It can only be switched ON while the slot is empty, so nothing that was stored there is sold by surprise.
//  * An item that can't be sold (no price, renamed, custom lore, shop-blocked, frozen money account) STAYS in the slot - never deleted, never sold
//    for nothing - and the player gets ONE message about it (no spam).
//  * While the slot is ON it holds a RED item (smp:sell_slot, not placeable, locked in the inventory, kept on death): that is the red colour the player sees.
//    An item put on it swaps with the block, is sold, and the block comes back (the block can never leave the inventory, is never sold, and is removed when the slot is switched OFF).
//  * Creative / Spectator never sell (no free money).
//  * Note: while ON the slot is never free (the red item sits in it), so picked-up items never land in it by accident.
import { world, system, ItemStack, ItemLockMode, EquipmentSlot } from "@minecraft/server";
import { CATEGORIES } from "../shop_data.js";
import { addAliases } from "../alias.js";
import { stackValue } from "../value.js";
import { sellStacks } from "../economy.js";
import { shopMsg } from "./shoplang.js";

export const SELL_SLOT = 17;                 // backpack slots are 9..35 (row by row, from the top-left): 17 = top row, right corner
const KEY = "smp:sellslot";
const EVERY = 5;                             // ticks between two checks (0.25 s)

const BY = new Map();
for (const c of CATEGORIES) for (const it of c.items) if (!BY.has(it[0])) BY.set(it[0], it);
try { system.runTimeout(() => { try { addAliases(BY); } catch (e) { /* ignore */ } }, 30); } catch (e) { /* ignore */ }

/** { it, unit, up } for a REAL stack (enchants / damage counted) or null when it can't be sold - same rule as the /sell page */
export const infoOf = (st) => {
  const it = BY.get(st.typeId.replace("minecraft:", "")); if (!it) return null;
  const v = stackValue(st, it); return v.unit > 0 ? { it, unit: v.unit, up: v.up } : null;
};

export const sellSlotOn = (p) => { try { return p.getDynamicProperty(KEY) === true; } catch (e) { return false; } };
const box = (p) => { try { return p.getComponent("inventory")?.container ?? null; } catch (e) { return null; } };
// ---- the red marker block --------------------------------------------------------------------------------------------------------------
const MARK = "smp:sell_slot";                 // own red item (BP/items/sell_slot.json): not a block, so it can never be placed in the world
export const isMark = (st) => { try { return !!st && st.typeId === MARK; } catch (e) { return false; } };
function makeMark() {
  const it = new ItemStack(MARK, 1);
  it.setLore(["§7ON: put an item on this slot", "§7and it is sold at once.", "§8Switch it OFF with /sellslot"]);
  it.lockMode = ItemLockMode.inventory;   // can move inside the inventory but never leave it (no drop, no chest)
  it.keepOnDeath = true;
  return it;
}
const cursorOf = (p) => { try { return p.getComponent("minecraft:cursor_inventory") ?? null; } catch (e) { return null; } };
/** an item put on the slot swaps with the block: the block lands on the cursor - remove it from there */
function dropCursorMark(p) { try { const cur = cursorOf(p); if (cur && isMark(cur.item)) cur.clear(); } catch (e) { /* ignore */ } }
/** removes every marker block of the player (backpack, hotbar, off hand, cursor) */
function purge(p, c) {
  for (let i = 0; i < c.size; i++) { try { if (isMark(c.getItem(i))) c.setItem(i, undefined); } catch (e) { /* ignore */ } }
  try { const eq = p.getComponent("equippable"); if (eq && isMark(eq.getEquipment(EquipmentSlot.Offhand))) eq.setEquipment(EquipmentSlot.Offhand, undefined); } catch (e) { /* ignore */ }
  dropCursorMark(p);
}
/** puts the marker in the (empty) sell slot */
function putMark(p, c) { try { purge(p, c); c.setItem(SELL_SLOT, makeMark()); } catch (e) { /* ignore */ } }
const say = (p, m) => { try { p.sendMessage(shopMsg(p, m)); } catch (e) { /* ignore */ } };

/** ON needs an empty slot.  Returns { ok, on } or { err } */
export function setSellSlot(p, on) {
  try {
    if (on) {
      const c = box(p); if (!c) return { err: "Could not read your inventory." };
      if (c.getItem(SELL_SLOT)) return { err: "Empty the top-right slot of your backpack first, then turn it ON." };
    }
    p.setDynamicProperty(KEY, on ? true : undefined);
    kept.delete(p.id);
    const c = box(p);
    if (c) { if (on) putMark(p, c); else purge(p, c); }
    return { ok: true, on: !!on };
  } catch (e) { return { err: "Something went wrong." }; }
}

/** used by the Sell Items page and by /sellslot: flips the switch and tells the player what happened */
export function toggleSellSlot(p) {
  const r = setSellSlot(p, !sellSlotOn(p));
  say(p, r.err ? "§c[Sell slot] " + r.err
    : r.on ? "§a[Sell slot] §fON §7- the §cred block§7 is in the top-right slot of your backpack. Put an item on it and it is sold at once."
    : "§c[Sell slot] §fOFF §7- the slot is a normal slot again.");
  return r;
}

/** what to do with the stack that is in the slot: "empty" | "skip" (already decided, still the same) | "unsellable" | "sell" */
export function decide(st, keptSig, info) {
  if (!st) return "empty";
  if (keptSig !== undefined && keptSig === signature(st)) return "skip";
  return info ? "sell" : "unsellable";
}
export const signature = (st) => st.typeId + "|" + st.amount + "|" + (st.nameTag ?? "");

const kept = new Map();                      // player id -> signature of a stack we left in the slot on purpose

function check(p) {
  const c = box(p); if (!c) return;
  if (!sellSlotOn(p)) {                         // OFF: no red block may stay anywhere
    kept.delete(p.id);
    if (isMark(c.getItem(SELL_SLOT))) purge(p, c);
    return;
  }
  const gm = String(p.getGameMode()).toLowerCase();
  if (gm === "creative" || gm === "spectator") return;
  dropCursorMark(p);
  const st = c.getItem(SELL_SLOT);
  if (isMark(st)) { kept.delete(p.id); return; }          // normal state: the red item sits in the slot
  if (!st) { kept.delete(p.id); putMark(p, c); return; }  // the block was moved away: bring it back (and remove stray copies)
  purge(p, c);                                            // an item sits in the slot (the red item was swapped out): no copy of the red item may stay anywhere else
  const info = infoOf(st);
  const what = decide(st, kept.get(p.id), info);
  if (what === "skip") return;
  if (what === "unsellable") {
    kept.set(p.id, signature(st));
    say(p, "§7[Sell slot] This item can't be sold (no price, renamed or special) - it stays in the slot. Take it out.");
    return;
  }
  const got = sellStacks(p, [{ slot: SELL_SLOT, typeId: st.typeId, amount: st.amount }], infoOf, "sellslot");
  const left = c.getItem(SELL_SLOT);         // frozen account / blocked item: nothing sold, the item stays - do not try again every 0.25 s
  if (!left) { kept.delete(p.id); putMark(p, c); }        // sold: the red item comes back at once
  else if (!(got > 0)) kept.set(p.id, signature(left)); else kept.delete(p.id);
}

system.runInterval(() => {
  for (const p of world.getAllPlayers()) { try { check(p); } catch (e) { console.warn("[smp] sell slot: " + e); } }
}, EVERY);

world.afterEvents.playerSpawn.subscribe((ev) => { try { if (ev.initialSpawn && !sellSlotOn(ev.player)) { const c = box(ev.player); if (c) purge(ev.player, c); } } catch (e) { /* ignore */ } });
world.afterEvents.playerLeave.subscribe((ev) => { try { kept.delete(ev.playerId); } catch (e) { /* ignore */ } });
