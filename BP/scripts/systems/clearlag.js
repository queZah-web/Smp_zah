// Clear Lag: removes all dropped items (EXCEPT Hearts and the loot of a dead player (tag death_loot, see deathloot.js) - they are never touched) every clearLagSeconds() (default CLEARLAG_SECONDS = 60; an operator can set 30 s or more, or switch it OFF) with a warning a few seconds before.
// Uses the real clock (Date.now) so the timing stays exact even when the server lags.
import { world, system } from "@minecraft/server";
import { CLEARLAG_SECONDS as DEFAULT_SECONDS, CLEARLAG_WARN_AT } from "./config.js";
import { luxClearWarn, luxClearDone } from "../lux.js";
import { duelHold } from "./duelstate.js";
import { notice } from "../smp/fxprefs.js";
import { isHeart } from "../heartids.js";

const WARN = [...CLEARLAG_WARN_AT].sort((a, b) => a - b);
let next = 0, lastWarn = 0;
const warned = new Set();

// ---- Operator control (/opr > World > Clear lag, permission "clearlag"): ON / OFF and the time between two clears (saved in the world)
// clearLagOn()      = is the automatic clearing running (OFF = nothing is cleared by the timer; the manual button still works)
// clearLagSeconds() = seconds between two clears: CLEARLAG_LIMITS.min (30) up to CLEARLAG_LIMITS.max; CLEARLAG_SECONDS in config.js until an operator changes it
export const CLEARLAG_LIMITS = { min: 30, max: 3600 };
let lagOn = null, lagSecs = null;
export function clearLagOn() {
  if (lagOn === null) { try { lagOn = world.getDynamicProperty("clearlag:on") !== false; } catch (e) { return true; } }
  return lagOn;
}
export function clearLagSeconds() {
  if (lagSecs === null) {
    let v = null; try { v = world.getDynamicProperty("clearlag:secs"); } catch (e) { /* ignore */ }
    lagSecs = typeof v === "number" && Number.isInteger(v) && v >= CLEARLAG_LIMITS.min && v <= CLEARLAG_LIMITS.max ? v : DEFAULT_SECONDS;
  }
  return lagSecs;
}
/** no permission check here: the caller checks allow(p, "clearlag").  Returns { ok, on } or { err } */
export function setClearLagOn(on) {
  try {
    on = !!on;
    try { world.setDynamicProperty("clearlag:on", on); } catch (e) { return { err: "Could not save." }; }
    lagOn = on;
    resetTimer();                                            // ON: a full new countdown starts now (OFF: the loop below stops it)
    return { ok: true, on };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** no permission check here: the caller checks allow(p, "clearlag").  Returns { ok, seconds } or { err } */
export function setClearLagSeconds(seconds) {
  try {
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < CLEARLAG_LIMITS.min || seconds > CLEARLAG_LIMITS.max) return { err: "Type a whole number of seconds from " + CLEARLAG_LIMITS.min + " to " + CLEARLAG_LIMITS.max + "." };
    try { world.setDynamicProperty("clearlag:secs", seconds); } catch (e) { return { err: "Could not save." }; }
    lagSecs = seconds;
    resetTimer();                                            // the new time is counted from NOW
    return { ok: true, seconds };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---- optional: Clear lag also removes the mobs (OFF until an operator turns it ON; saved in the world). Mobs with a name tag are NEVER removed.
let mobsOn = null;
export function clearMobsOn() {
  if (mobsOn === null) { try { mobsOn = world.getDynamicProperty("clearlag:mobs") === true; } catch (e) { return false; } }
  return mobsOn;
}
/** no permission check here: the caller checks allow(p, "clearlag").  Returns { ok, on } or { err } */
export function setClearMobsOn(on) {
  try {
    on = !!on;
    try { world.setDynamicProperty("clearlag:mobs", on); } catch (e) { return { err: "Could not save." }; }
    mobsOn = on;
    return { ok: true, on };
  } catch (e) { return { err: "Something went wrong." }; }
}
const MOB_KEEP = new Set(["minecraft:player", "minecraft:ender_dragon", "minecraft:wither", "minecraft:npc", "minecraft:armor_stand"]);
/** removes the mobs of the three worlds (no drops). Skipped: players, bosses, NPCs, armor stands, this addon's own entities and every mob that has a name tag. Returns how many were removed */
export function clearMobs() {
  let n = 0;
  for (const id of ["overworld", "nether", "the_end"]) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ families: ["mob"] }); } catch (e) { continue; }
    for (const e of list) {
      try {
        const t = e.typeId;
        if (!t.startsWith("minecraft:") || MOB_KEEP.has(t)) continue;
        if (e.nameTag) continue;                                 // has a name tag = stays
        e.remove(); n++;
      } catch (e2) { /* already gone */ }
    }
  }
  return n;
}

export function clearItems() {
  let n = 0; const gone = [];
  for (const id of ["overworld", "nether", "the_end"]) {
    let items = [];
    try { items = world.getDimension(id).getEntities({ type: "minecraft:item" }); } catch (e) { continue; }
    const dimObj = world.getDimension(id);
    for (const it of items) {
      // Hearts (smp:heart / smp:heart_half / smp:heart_cursed) are NEVER cleared: ClearLag skips them completely.
      // If the item can't be read for any reason, it is skipped too (better to keep one item than to delete a heart).
      try { const tid = it.getComponent("minecraft:item")?.itemStack?.typeId; if (!tid || isHeart(tid)) continue; if (it.hasTag("death_loot")) continue; } catch (e) { continue; }
      try { gone.push({ dim: dimObj, loc: { x: it.location.x, y: it.location.y, z: it.location.z } }); } catch (e) { /* ignore */ }
      try { it.remove(); n++; } catch (e) { try { it.kill(); n++; } catch (e2) { /* already gone */ } }
    }
  }
  luxClearDone(gone);
  return n;
}
export function resetTimer() { next = Date.now() + clearLagSeconds() * 1000; warned.clear(); }
/** milliseconds left until the next clear (read only, used by itemtimer.js); null while Clear lag is OFF or the timer has not started */
export function clearLagLeftMs() { try { if (!clearLagOn() || !next) return null; return Math.max(0, next - Date.now()); } catch (e) { return null; } }

system.runInterval(() => {
  try {
    const now = Date.now();
    if (!clearLagOn()) { next = 0; return; }                  // switched OFF by an operator: no countdown, no warning, no clearing
    if (!next) resetTimer();
    if (now < duelHold.until && next - now < 20000 && next < duelHold.until + 3000) { next = duelHold.until + 3000; warned.clear(); }      // a 1 vs 1 duel is running: its loot must stay (only when the date really has to move - otherwise "warned" was cleared every tick = the same warning again and again)
    const left = next - now;
    if (left <= 0) {
      const n = clearItems(), withMobs = clearMobsOn(), m = withMobs ? clearMobs() : 0;
      notice("clearlag", "§a[ClearLag] §fCleared §e" + n + " §fdropped item" + (n === 1 ? "" : "s") + (withMobs ? " §fand §e" + m + " §fmob" + (m === 1 ? "" : "s") : "") + "§f.");
      next += clearLagSeconds() * 1000;                       // fixed schedule (no drift)
      if (next - now < 1000) next = now + clearLagSeconds() * 1000;
      warned.clear();
      return;
    }
    for (const s of WARN) {                                   // smallest threshold that is reached (one message only, even after a lag spike)
      if (left <= s * 1000) {
        if (!warned.has(s)) {
          for (const t of WARN) if (t >= s) warned.add(t);
          if (now - lastWarn < 1500) break;                      // safety: never more than one warning per 1.5 s, whatever happens
          lastWarn = now;
          luxClearWarn(s);
          notice("clearlag", (clearMobsOn() ? "§e[ClearLag] §fDropped items and mobs will be cleared in §c" : "§e[ClearLag] §fDropped items will be cleared in §c") + s + " §fsecond" + (s === 1 ? "" : "s") + "!");
        }
        break;
      }
    }
  } catch (e) { console.warn("[clearlag] " + e); }
}, 2);
