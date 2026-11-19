// /back - takes a player back to the place where he died (the last death only).
//   * The place is saved when the player dies (smp/store.js: ex(p).back = { x, y, z, d, t }) and is cleared after a successful /back.
//   * Not saved: deaths inside the 1 vs 1 duel arena (the player who loses a duel can NOT use /back: an older saved place is deleted too), and deaths in the void (nothing to stand on).
//   * Same rules as /home: no teleport while in combat, a short cooldown (config.js COOLDOWN.back) and the same swirl effect as /rtp.
//   * Admins / Owner switch it ON / OFF (permission "back": Operator > Server & staff > /back button, or /backset on|off|status). Default = ON.
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
// IMPORTANT: this file is imported BEFORE duel.js (systems/index.js) so that its death handler runs first and still sees the duel state.
import { world, system } from "@minecraft/server";
import { ex } from "../smp/store.js";
import { canTeleport, teleportWithFx } from "./util.js";
import { duelView } from "./duelstate.js";
import { pick } from "./arextra.js";
import { slog } from "./staffcore.js";

const KEY = "back:on";
let on = null;
/** true while /back is allowed (default ON) */
export function backOn() {
  if (on === null) { try { on = world.getDynamicProperty(KEY) !== false; } catch (e) { return true; } }
  return on;
}
/** Owner / Admin (the caller checks allow(p, "back")).  Returns { ok, on } or { err } */
export function setBackOn(actor, value) {
  try {
    const v = !!value;
    try { world.setDynamicProperty(KEY, v); } catch (e) { return { err: "Could not save." }; }
    on = v;
    slog(actor, "back", null, v ? "/back ON" : "/back OFF");
    return { ok: true, on: v };
  } catch (e) { return { err: "Something went wrong." }; }
}

const say = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };

/** /back */
export function goBack(p) {
  if (!backOn()) return say(p, "§c[Back] The /back command is turned off by the admins.", "§c[العودة] أمر /back معطّل من قبل الإدارة.");
  const b = ex(p).back;
  if (!b || ![b.x, b.y, b.z].every((n) => typeof n === "number" && Number.isFinite(n)) || typeof b.d !== "string") {
    return say(p, "§c[Back] You have no saved death place.", "§c[العودة] ليس لديك مكان موت محفوظ.");
  }
  if (!canTeleport(p, "back")) return;
  teleportWithFx(p, b, b.d, "back",
    () => { try { delete ex(p).back; } catch (e) { /* ignore */ } say(p, "§a[Back] Teleported to the place where you died.", "§a[العودة] تم نقلك إلى المكان الذي متّ فيه."); },
    () => say(p, "§c[Back] Teleport failed.", "§c[العودة] فشل الانتقال."));
}

// ---- save the place of every death
try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      const d = ev.deadEntity;
      if (!d || d.typeId !== "minecraft:player") return;
      let inDuelDeath = false;
      try { if (ex(d).duelBack) inDuelDeath = true; } catch (e) { /* ignore */ }       // died in the duel arena: never saved
      try { if (duelView.bar(d)) inDuelDeath = true; } catch (e) { /* ignore */ }
      if (inDuelDeath) { try { delete ex(d).back; } catch (e) { /* ignore */ } return; }   // he lost the fight and his loot: no /back at all (an older saved death place is deleted too)
      const l = d.location, dim = d.dimension;
      let minY = -64;
      try { const r = dim.heightRange; if (r && typeof r.min === "number") minY = r.min; } catch (e) { /* ignore */ }
      if (![l.x, l.y, l.z].every((n) => Number.isFinite(n)) || l.y < minY + 1) return;      // died in the void
      ex(d).back = { x: Math.round(l.x * 10) / 10, y: Math.round(l.y * 10) / 10, z: Math.round(l.z * 10) / 10, d: dim.id, t: Date.now() };
      if (!backOn()) return;
      const id = d.id;
      system.runTimeout(() => {                                                          // after he sees the death screen
        const p = world.getAllPlayers().find((q) => q.id === id);
        if (p) say(p, "§e[Back] Use §f/back §eto return to where you died.", "§e[العودة] استخدم §f/back §eللرجوع إلى المكان الذي متّ فيه.");
      }, 40);
    } catch (e) { console.warn("[back] " + e); }
  });
} catch (e) { console.warn("[back] not started: " + e); }
