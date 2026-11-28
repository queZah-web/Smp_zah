// Shared helpers: teleport rules (combat + cooldown) and safe teleporting.
import { world } from "@minecraft/server";
import { COOLDOWN } from "./config.js";
import { combatLeft } from "./combat.js";
import { luxTeleport, here, luxRtpGo, luxRtpLand } from "../lux.js";
import { menuMsg } from "./menulang.js";

export const valid = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (err) { return false; } };

const cd = new Map();            // "playerId:key" -> end time (ms)

/** true when the player may teleport now (not in combat, cooldown over). Sends the reason otherwise. */
/** other systems can refuse every teleport of a player: fn(p) -> a message (refused) or null (watchers: watcher.js) */
export const tpGuards = [];
export function canTeleport(p, key) {
  for (const g of tpGuards) { try { const m = g(p); if (m) { p.sendMessage(m); return false; } } catch (e) { /* ignore */ } }
  const left = combatLeft(p);
  if (left > 0) { p.sendMessage(menuMsg(p, "§c[Combat] You can't teleport while in combat §7(" + Math.ceil(left / 1000) + "s left)")); return false; }
  const c = (cd.get(p.id + ":" + key) ?? 0) - Date.now();
  if (c > 0) { p.sendMessage(menuMsg(p, "§c[Teleport] Please wait §f" + Math.ceil(c / 1000) + "s §cbefore using this again.")); return false; }
  return true;
}
export function stamp(p, key) { const s = COOLDOWN[key] ?? 0; if (s > 0) cd.set(p.id + ":" + key, Date.now() + s * 1000); }

export function teleportTo(p, loc, dimId) {
  const dim = world.getDimension(dimId ?? p.dimension.id);
  const from = here(p);
  p.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension: dim });
  luxTeleport(p, from);
}
/** Teleport with the SAME effects as /rtp: the violet 360 degree swirl + its sound while you "warm up" (about 1 second), the jump, then the soft landing swirl + sound.
 *  Used by /home and "Go there" (protected land). Same rules as before: the caller already checked canTeleport; the combat tag is checked again at the jump
 *  (so nobody escapes a fight during the warm-up); the cooldown starts only after a successful jump. ok() / bad() are optional callbacks. */
const warping = new Set();
export function teleportWithFx(p, loc, dimId, key, ok, bad) {
  if (warping.has(p.id)) return;                                   // already on its way: a second click does nothing
  warping.add(p.id);
  luxRtpGo(p, () => {                                              // called ONCE, also if the effect cannot play
    warping.delete(p.id);
    if (!valid(p)) return;
    if (!canTeleport(p, key)) return;                              // combat started meanwhile: cancelled (the player is told why)
    try { p.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension: world.getDimension(dimId ?? p.dimension.id) }); }
    catch (e) { if (bad) bad(); return; }
    stamp(p, key);
    luxRtpLand(p);
    if (ok) ok();
  });
}
export const dimLabel = (id) => (String(id).includes("nether") ? "Nether" : String(id).includes("end") ? "End" : "Overworld");
export const online = (id) => world.getAllPlayers().find((p) => p.id === id);
