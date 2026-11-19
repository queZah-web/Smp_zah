// ===================================================================================================================
// FAST HEALING (Java Edition style) - merged from "Java Saturation" (by Raiyon), the healing part only.
//   ON:  the vanilla natural regeneration is switched off and this heals instead, like Java:
//        * saturation >= 3 and hunger >= 18  ->  +1 health (half a heart) every 0.5 s, uses 1.5 saturation
//        * else hunger > 18                  ->  +1 health every 0.5 s, uses 1 hunger point
//        (Peaceful: saturation stays full).  Survival + Adventure players only.
//   OFF: the vanilla natural regeneration comes back.
// Admin / Owner switch it in  /opr > World > Fast healing  (saved in the world, default ON).
// NOT merged on purpose: the saturation bar of that pack - it writes the action bar EVERY tick, which would hide the
// SMP action bar texts (HUD, timers, AFK, arenas, signs ...).
// No lag: one light loop every 2 ticks.
// ===================================================================================================================
import { world, system, GameMode } from "@minecraft/server";
import { roleOf, slog } from "./staffcore.js";

const KEY = "fastheal:on", EVERY = 2, COOLDOWN = 5;          // 5 runs x 2 ticks = 10 ticks = 0.5 s
let on = null;
export function fastHealOn() {
  if (on !== null) return on;
  try { const v = world.getDynamicProperty(KEY); on = v !== false; } catch (e) { return true; }
  return on;
}
const rule = (v) => { try { world.gameRules.naturalRegeneration = v; } catch (e) { /* ignore */ } };
/** Admin / Owner only.  Returns { ok } or { err } */
export function setFastHeal(actor, v) {
  let r = null; try { r = roleOf(actor); } catch (e) { r = null; }
  if (r !== "owner" && r !== "admin") return { err: "Only the Admin or the Owner can change this." };
  on = !!v;
  try { world.setDynamicProperty(KEY, on); } catch (e) { return { err: "Could not save." }; }
  rule(!on);
  try { slog(actor, "fastheal", null, "fast healing " + (on ? "ON" : "OFF")); } catch (e) { /* ignore */ }
  return { ok: true };
}
system.runTimeout(() => { try { rule(!fastHealOn()); } catch (e) { /* ignore */ } }, 20);

const score = new Map();
system.runInterval(() => {
  if (!fastHealOn()) return;
  let peaceful = false; try { peaceful = String(world.getDifficulty()) === "Peaceful"; } catch (e) { /* ignore */ }
  for (const p of world.getAllPlayers()) {
    try {
      const gm = p.getGameMode(); if (gm !== GameMode.Survival && gm !== GameMode.Adventure) continue;
      const hp = p.getComponent("minecraft:health"); if (!hp || hp.currentValue <= 0) continue;
      const sat = p.getComponent("minecraft:player.saturation"), hun = p.getComponent("minecraft:player.hunger");
      if (!sat || !hun) continue;
      if (peaceful && sat.currentValue < 5) sat.setCurrentValue(5);
      if (hp.currentValue >= hp.effectiveMax) { score.set(p.id, 0); continue; }
      const bySat = sat.currentValue >= 3, byHun = hun.currentValue > 18;
      if (!bySat && !byHun) { score.set(p.id, 0); continue; }
      const s = (score.get(p.id) ?? 0) + 1;
      if (s < COOLDOWN) { score.set(p.id, s); continue; }
      score.set(p.id, 0);
      if (bySat && hun.currentValue >= 18) { if (!peaceful) sat.setCurrentValue(Math.max(0, sat.currentValue - 1.5)); }
      else if (byHun) { if (!peaceful) hun.setCurrentValue(hun.currentValue - 1); }
      else continue;
      hp.setCurrentValue(Math.min(hp.currentValue + 1, hp.effectiveMax));
    } catch (e) { /* this player is not ready */ }
  }
}, EVERY);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => score.delete(playerId)); } catch (e) { /* ignore */ }
