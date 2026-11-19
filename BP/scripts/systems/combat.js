// Combat tag: hitting another player (or being hit by one) starts a 20s timer in the middle-bottom of the screen
// (action bar). While it runs every teleport is blocked (homes, rtp, spawn, tpa, clan home, ender pearl, chorus fruit).
import { world, system } from "@minecraft/server";
import { sendBar } from "../barsend.js";
import { stats } from "../data.js";
import { updateHud } from "../hud.js";
import { combatBusy, clanBusy } from "../state.js";
import { clanView } from "./clanstate.js";
import { COMBAT_SECONDS } from "./config.js";
import { duelView } from "./duelstate.js";
import { menuMsg } from "./menulang.js";

const until = new Map();                                         // player id -> end time (ms)
export const combatLeft = (p) => Math.max(0, (until.get(p.id) ?? 0) - Date.now());

const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[combat] cannot start " + name + ": " + e); } };
const bar = (p) => { if (clanBusy.has(p.id)) return; try { sendBar(p, duelView.bar(p) ?? ("§c§lCOMBAT §r§f" + Math.ceil(combatLeft(p) / 1000) + "s §7- no teleport")); } catch (e) { /* ignore */ } };   // during a 1 vs 1 duel the duel timer is shown instead

function tag(p) {
  const was = combatLeft(p) > 0;
  until.set(p.id, Date.now() + COMBAT_SECONDS * 1000);
  combatBusy.add(p.id);
  if (!was) { try { p.sendMessage(menuMsg(p, "§c[Combat] You are in combat! Teleporting is disabled for §f" + COMBAT_SECONDS + "s§c.")); } catch (e) { /* ignore */ } }
  bar(p);
}
function release(p) {
  until.delete(p.id); combatBusy.delete(p.id);
  try {
    if ((stats(p).hud ?? "panel") === "bar") updateHud(p, true);
    else p.onScreenDisplay.setActionBar("§a§lCombat ended §r§7- you can teleport");
  } catch (e) { /* ignore */ }
}

/** used by the 1 vs 1 duel: keeps a player "in combat" (no teleports) / lets him out */
export function combatHold(p) { tag(p); }
export function combatClear(p) { if (until.has(p.id)) release(p); }

safe("hit tracking", () => world.afterEvents.entityHurt.subscribe((ev) => {
  const victim = ev.hurtEntity, attacker = ev.damageSource?.damagingEntity;
  if (!victim || !attacker || victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player" || victim.id === attacker.id) return;
  if (clanView.noHit(attacker, victim)) return;          // clan mates (friendly fire off) are never "in combat"
  tag(victim); tag(attacker);
}));

safe("death", () => world.afterEvents.entityDie.subscribe((ev) => {
  const d = ev.deadEntity;
  if (d?.typeId !== "minecraft:player" || !until.has(d.id)) return;
  until.delete(d.id); combatBusy.delete(d.id);
}));

safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { until.delete(playerId); combatBusy.delete(playerId); }));

// ender pearls and chorus fruit are teleports too
safe("pearl block", () => world.beforeEvents.itemUse.subscribe((ev) => {
  const id = ev.itemStack?.typeId;
  if (id !== "minecraft:ender_pearl" && id !== "minecraft:chorus_fruit") return;
  const p = ev.source;
  if (combatLeft(p) <= 0) return;
  ev.cancel = true;
  system.run(() => { try { p.sendMessage(menuMsg(p, "§c[Combat] You can't use that while in combat §7(" + Math.ceil(combatLeft(p) / 1000) + "s)")); } catch (e) { /* ignore */ } });
}));

// the counter
system.runInterval(() => {
  if (until.size === 0) return;
  const now = Date.now();
  const players = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [id, end] of [...until]) {
    const p = players.get(id);
    if (!p) { until.delete(id); combatBusy.delete(id); continue; }
    if (end <= now) { release(p); continue; }
    bar(p);
  }
}, 5);
