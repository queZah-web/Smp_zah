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
  fallback = false; rule(!on);
  try { slog(actor, "fastheal", null, "fast healing " + (on ? "ON" : "OFF")); } catch (e) { /* ignore */ }
  return { ok: true };
}
system.runTimeout(() => { try { rule(!fastHealOn()); } catch (e) { /* ignore */ } }, 20);

const score = new Map();
const comp = (p, ids) => { for (const id of ids) { try { const c = p.getComponent(id); if (c) return c; } catch (e) { /* next name */ } } return null; };
const SAT = ["minecraft:player.saturation", "player.saturation"], HUN = ["minecraft:player.hunger", "player.hunger"], HP = ["minecraft:health", "health"];
const playMode = (p) => { try { const g = String(p.getGameMode()).toLowerCase(); return g === "survival" || g === "adventure"; } catch (e) { return false; } };
// safety: if this game version does not let the script read the food bar, the normal (vanilla) healing comes back by
// itself, so nobody is ever left without healing.  It is tried again every minute.
let blind = 0, fallback = false;
function useFallback(v) {
  if (v === fallback) return;
  fallback = v; rule(v || !fastHealOn());
  console.warn("[fastheal] " + (v ? "the food bar can't be read by the script: the normal healing is used for now" : "fast healing works again"));
}
system.runInterval(() => {
  if (!fastHealOn()) { if (fallback) { fallback = false; } return; }
  let peaceful = false; try { peaceful = String(world.getDifficulty()).toLowerCase() === "peaceful"; } catch (e) { /* ignore */ }
  let read = 0, missing = 0;
  for (const p of world.getAllPlayers()) {
    try {
      if (!playMode(p)) continue;
      const hp = comp(p, HP); if (!hp || hp.currentValue <= 0) continue;
      const sat = comp(p, SAT), hun = comp(p, HUN);
      if (!sat || !hun) { missing++; continue; }
      read++;
      if (fallback) continue;                                    // the normal healing is on: never heal twice
      if (peaceful && sat.currentValue < 5) { try { sat.setCurrentValue(5); } catch (e) { /* ignore */ } }
      if (hp.currentValue >= hp.effectiveMax) { score.set(p.id, 0); continue; }
      const bySat = sat.currentValue >= 3 && hun.currentValue >= 18, byHun = hun.currentValue > 18;
      if (!bySat && !byHun) { score.set(p.id, 0); continue; }
      const s = (score.get(p.id) ?? 0) + 1;
      if (s < COOLDOWN) { score.set(p.id, s); continue; }
      score.set(p.id, 0);
      if (!peaceful) {                                           // the food it costs (a refused write never stops the healing)
        try { if (bySat) sat.setCurrentValue(Math.max(0, sat.currentValue - 1.5)); else hun.setCurrentValue(hun.currentValue - 1); } catch (e) { /* ignore */ }
      }
      hp.setCurrentValue(Math.min(hp.currentValue + 1, hp.effectiveMax));
    } catch (e) { /* this player is not ready */ }
  }
  if (missing && !read) { if (++blind >= 10) useFallback(true); }    // ~1 s of players without a readable food bar
  else if (read) { blind = 0; if (fallback && system.currentTick % 1200 < EVERY) useFallback(false); }
}, EVERY);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => score.delete(playerId)); } catch (e) { /* ignore */ }
