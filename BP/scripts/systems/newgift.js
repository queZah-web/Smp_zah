// NEW PLAYER GIFT: every brand-new player gets 16 cooked steaks, ONCE.  Players who already existed never get it.
//  * "since" = the moment this version first ran in this world. Only players whose data was created AFTER that moment (data.js: stats(p).joined) are new.
//    Players that already existed (older "joined", or no "joined" at all) get nothing. If anything is unclear, nobody gets it.
//  * The gift is marked as given FIRST (saved with the player), so it can never be given twice - not after rejoining, dying or reloading.
//  * The steaks carry a lore "For new player / (للاعبين الجدد فقط)": they are not "plain" items, so the shop sell box refuses them (no free-money loop).
//  * Inventory full -> the rest is dropped at the player's feet (never lost).
import { world, system, ItemStack } from "@minecraft/server";
import { ex } from "../smp/store.js";
import { stats } from "../data.js";
import { valid } from "./util.js";
import { menuMsg } from "./menulang.js";

export const GIFT = { item: "minecraft:cooked_beef", amount: 16 };
const SINCE_KEY = "newgift:since";
let since = null;
system.run(() => {
  try {
    let v = world.getDynamicProperty(SINCE_KEY);
    if (typeof v !== "number") { v = Date.now(); world.setDynamicProperty(SINCE_KEY, v); }
    since = v;
  } catch (e) { console.warn("[newgift] cannot read/save the start date: " + e); }
});

function give(p) {
  try {
    if (!valid(p) || since === null) return;
    const d = ex(p), j = stats(p).joined;
    if (d.ngSteak === true || typeof j !== "number" || j < since) return;
    const c = p.getComponent("inventory")?.container; if (!c) return;
    d.ngSteak = true;                                   // marked FIRST, so it can never be given twice
    const item = new ItemStack(GIFT.item, GIFT.amount);
    item.setLore(["§r§aFor new player", "§r§a(للاعبين الجدد فقط)"]);
    const left = c.addItem(item);
    if (left) p.dimension.spawnItem(left, p.location);  // inventory full: drop the rest at his feet
    p.sendMessage(menuMsg(p, "§a[Welcome] §fYou got §e" + GIFT.amount + " cooked steaks §ffor new players. §7Enjoy!"));
    try { p.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[newgift] gift failed: " + e); }
}
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (initialSpawn) system.runTimeout(() => give(player), 60);
  });
} catch (e) { console.warn("[newgift] cannot watch joins: " + e); }
