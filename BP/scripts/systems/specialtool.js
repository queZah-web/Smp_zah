// SPECIAL TOOLS: a pickaxe / axe / shovel / hoe that carries a "Speed Boost +5%" (or more) upgrade can never break.
//  * When only KEEP durability points are left (the "last hit"), breaking blocks with it is cancelled and the player is told
//    "It's a special item, it can't get broken" - repair it (anvil / mending) and it works again.
//  * Hits on mobs / stripping logs / tilling soil can use up durability too: the held tool is checked every tick (and right after a hit / block use), the whole inventory every 10 ticks,
//    so the game can never reach 0 and delete it.  (a tool that is already lower is simply lifted to the limit)
//  * Tools without an upgrade behave exactly as before.  Creative mode is never touched.
//  * The extra blocks of Timber / Vein Miner / Area Mining / Chest Sell stop at the same limit (mining.js, chestsell.js use atLimit()).
import { world, system } from "@minecraft/server";
import { boostOf } from "./skills.js";
import { menuMsg } from "./menulang.js";

export const KEEP = 3;           // durability points that always stay on a special tool

/** the stack carries a speed upgrade */
export const isSpecial = (item) => { try { return !!item && boostOf(item) > 0; } catch (e) { return false; } };
/** special tool whose remaining durability is KEEP or less (`extra` = damage about to be added) */
export function atLimit(item, extra = 0) {
  try {
    if (!isSpecial(item)) return false;
    const d = item.getComponent("durability");
    return !!d && d.maxDurability > 0 && d.damage + extra >= d.maxDurability - KEEP;
  } catch (e) { return false; }
}

const last = new Map();
const warn = (player) => {
  const now = Date.now();
  if (now - (last.get(player.id) ?? 0) < 1500) return;
  last.set(player.id, now);
  try { player.sendMessage(menuMsg(player, "§c[Special Item] It's a special item, it can't get broken! §7Repair it (anvil / mending) to use it again.")); } catch (e) { /* ignore */ }
  try { player.onScreenDisplay.setActionBar("§cIt's a special item - can't get break"); } catch (e) { /* ignore */ }
  try { player.playSound("note.bass"); } catch (e) { /* ignore */ }
};
const survival = (player) => { const g = String(player.getGameMode()).toLowerCase(); return g !== "creative" && g !== "spectator"; };

try {
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    try {
      if (!ev.itemStack || !survival(ev.player)) return;
      if (!atLimit(ev.itemStack)) return;
      ev.cancel = true;
      const player = ev.player;
      system.run(() => warn(player));
    } catch (e) { /* never break normal mining */ }
  });
} catch (e) { console.warn("[special] cannot watch breaking: " + e); }

// keep every special tool above the limit (mob hits, stripping, tilling, anything else can not break it)
const lift = (c, slot) => {
  try {
    const item = c.getItem(slot);
    if (!item || !atLimit(item)) return;
    const d = item.getComponent("durability"), top = d.maxDurability - KEEP;
    if (d.damage > top) { d.damage = top; c.setItem(slot, item); }
  } catch (e) { /* ignore */ }
};
const liftHeld = (p) => { try { const c = p.getComponent("inventory")?.container; if (c) lift(c, p.selectedSlotIndex); } catch (e) { /* ignore */ } };
// every tick: the tool in the hand
system.runInterval(() => { for (const p of world.getAllPlayers()) liftHeld(p); }, 1);
// every 10 ticks: the WHOLE inventory (a tool that is not in the hand can never sit below the limit either)
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try { const c = p.getComponent("inventory")?.container; if (!c) continue; for (let i = 0; i < c.size; i++) lift(c, i); } catch (e) { /* ignore */ }
  }
}, 10);
// right after a hit / using the tool on a block (strip, till, flatten ...): fix it at once, not only on the next interval
try { world.afterEvents.entityHitEntity.subscribe((ev) => { const p = ev.damagingEntity; if (p?.typeId === "minecraft:player") system.run(() => liftHeld(p)); }); } catch (e) { /* ignore */ }
try { world.afterEvents.playerInteractWithBlock.subscribe((ev) => { const p = ev.player; system.run(() => liftHeld(p)); }); } catch (e) { /* ignore */ }
