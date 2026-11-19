// BUNDLES ARE BANNED (they were used to duplicate items).  Every bundle - the plain one and every coloured one - is taken away from a player as soon as he has it:
//   * the inventory (36 slots), the off hand and the item on the mouse cursor are checked every half second;
//   * a bundle that is thrown on the ground is removed the moment it appears;
//   * using a bundle is cancelled;  the shop no longer sells it (shop_data.js).
// The bundle is DELETED together with everything inside it.  The player is told, and the staff log gets a line (at most one per player per minute).
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system, EquipmentSlot } from "@minecraft/server";
import { invWatch } from "./invwatch.js";
import { pick } from "./arextra.js";
import { slog } from "./staffcore.js";

const isBundle = (typeId) => { try { return /(^|:|_)bundle$/.test(String(typeId)); } catch (e) { return false; } };   // minecraft:bundle, minecraft:red_bundle ...
const told = new Map(), logged = new Map();       // player id -> last time (ms)

function warn(p, n) {
  const now = Date.now();
  try {
    if (now - (told.get(p.id) ?? 0) > 5000) {
      told.set(p.id, now);
      p.sendMessage(pick(p, "§c[Server] Bundles are banned on this server. It was removed.", "§c[السيرفر] الباندل ممنوع في السيرفر. تمت إزالته."));
    }
    if (now - (logged.get(p.id) ?? 0) > 60000) { logged.set(p.id, now); slog(null, "bundle", p, n + " bundle(s) removed"); }
  } catch (e) { /* ignore */ }
}

function sweep(p, skipInv = false) {
  let n = 0;
  if (!skipInv) try {
    const inv = p.getComponent("inventory")?.container;
    if (inv) for (let i = 0; i < inv.size; i++) { const s = inv.getItem(i); if (s && isBundle(s.typeId)) { inv.setItem(i, undefined); n++; } }
  } catch (e) { /* ignore */ }
  try {
    const eq = p.getComponent("equippable");
    const s = eq && eq.getEquipment(EquipmentSlot.Offhand);
    if (s && isBundle(s.typeId)) { eq.setEquipment(EquipmentSlot.Offhand, undefined); n++; }
  } catch (e) { /* ignore */ }
  try {
    const c = p.getComponent("cursor_inventory");                       // the item that is being moved with the finger / mouse
    if (c && c.item && isBundle(c.item.typeId)) { c.clear(); n++; }
  } catch (e) { /* ignore */ }
  if (n) warn(p, n);
}

try {
  const watch = invWatch(4);      // performance: the 36 slots are read again only when the inventory changed (and at least every 2 s); off hand + cursor: every time
  system.runInterval(() => { watch.next(); const list = world.getAllPlayers(); for (let k = 0; k < list.length; k++) sweep(list[k], !watch.need(list[k], k)); }, 10);
  world.afterEvents.entitySpawn.subscribe((ev) => {
    try {
      const e = ev.entity;
      if (e.typeId !== "minecraft:item") return;
      const t = e.getComponent("minecraft:item")?.itemStack?.typeId;
      if (isBundle(t)) e.remove();
    } catch (err) { /* ignore */ }
  });
  world.beforeEvents.itemUse.subscribe((ev) => {
    try {
      if (!isBundle(ev.itemStack?.typeId)) return;
      ev.cancel = true;
      const p = ev.source;
      system.run(() => sweep(p));
    } catch (e) { /* ignore */ }
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { told.delete(playerId); logged.delete(playerId); });
} catch (e) { console.warn("[nobundle] not started: " + e); }
