// SPAWNER SETTINGS (saved).  The Owner changes the spawner numbers in game; an Admin can too, but only when the Owner allowed
// "Spawner settings" for Admin in  Operator > Owner > Role permissions  (permission "spawnerset", Owner only by default).
//   rate     kills per hour of ONE spawner        storage  hours of loot a spawner holds before it stops
//   stack    most spawners in one block           animal   speed of animals (pig, cow ...) as a share of "rate"
//   mobs     { mob id: kills per hour } for single mobs (beats rate / animal)
// Saved in ONE world property ("spcfg:v1").  Every function checks the permission again and returns { ok } or { err }; nothing here can throw.
import { world, system } from "@minecraft/server";
import { allow, can, slog } from "./staffcore.js";
import * as D from "../spawner_data.js";

const KEY = "spcfg:v1";
let loaded = false;

function load() {
  if (loaded) return true;
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") D.configure(JSON.parse(raw));
    loaded = true;                                                  // nothing saved = the defaults of spawner_data.js
  } catch (e) { return false; }                                     // world not ready yet: try again later (never overwrite saved data)
  return true;
}
// the world may not be readable at the very first tick: retry until it is
if (!load()) {
  const id = system.runInterval(() => { if (load()) system.clearRun(id); }, 20);
  try { world.afterEvents.worldLoad.subscribe(() => { load(); }); } catch (e) { /* older versions */ }
}

function persist() {
  try {
    const cur = D.current(), d = D.DEFAULTS;
    const same = cur.rate === d.rate && cur.storage === d.storage && cur.stack === d.stack && cur.animal === d.animal && !Object.keys(cur.mobs).length;
    world.setDynamicProperty(KEY, same ? undefined : JSON.stringify(cur));
    return true;
  } catch (e) { console.warn("[spawnercfg] save failed: " + e); return false; }
}
const nice = (n) => String(Math.round(n * 100) / 100);
const [R0, R1] = D.LIMITS.rate, [S0, S1] = D.LIMITS.storage, [K0, K1] = D.LIMITS.stack, [A0, A1] = D.LIMITS.animal;

export const spawnerSettings = () => { load(); return D.current(); };

/** saves the 4 main numbers.  v = { rate, storage, stack, animal } (numbers).  Returns { ok } or { err } */
export function setSpawnerMain(actor, v) {
  if (!can(actor, "spawnerset")) { allow(actor, "spawnerset"); return { err: "You are not allowed to change the spawner settings." }; }
  if (!load()) return { err: "The settings could not be read yet. Try again in a moment." };
  const chk = (x, lo, hi, name, int) => (Number.isFinite(x) && x >= lo && x <= hi && (!int || Number.isInteger(x)) ? null : name + " must be " + (int ? "a whole number" : "a number") + " from " + lo + " to " + hi + ".");
  const err = chk(v.rate, R0, R1, "Kills per hour", true) || chk(v.storage, S0, S1, "Storage hours", true) || chk(v.stack, K0, K1, "Max stack", true) || chk(v.animal, A0, A1, "Animal speed", false);
  if (err) return { err };
  const before = D.current();
  D.configure({ rate: v.rate, storage: v.storage, stack: v.stack, animal: v.animal });
  if (!persist()) { D.configure(before); return { err: "Could not save the settings." }; }
  slog(actor, "spawnerset", null, "kills/h " + v.rate + ", storage " + v.storage + "h, stack " + v.stack + ", animals x" + nice(v.animal));
  return { ok: true };
}
/** speed of ONE mob (kills per hour of one spawner).  kills = 0 -> back to the normal speed */
export function setSpawnerMob(actor, mob, kills) {
  if (!can(actor, "spawnerset")) { allow(actor, "spawnerset"); return { err: "You are not allowed to change the spawner settings." }; }
  if (!load()) return { err: "The settings could not be read yet. Try again in a moment." };
  if (!D.LOOT[mob]) return { err: "Unknown mob." };
  if (kills !== 0 && !(Number.isInteger(kills) && kills >= D.LIMITS.mob[0] && kills <= D.LIMITS.mob[1])) return { err: "Kills per hour must be a whole number from " + D.LIMITS.mob[0] + " to " + D.LIMITS.mob[1] + " (or 0 = normal speed)." };
  const before = D.current(), mobs = { ...before.mobs };
  if (kills === 0) delete mobs[mob]; else mobs[mob] = kills;
  D.configure({ mobs });
  if (!persist()) { D.configure(before); return { err: "Could not save the settings." }; }
  slog(actor, "spawnerset", null, D.itemName(mob) + ": " + (kills ? kills + " kills/h" : "normal speed"));
  return { ok: true };
}
/** everything back to the defaults of spawner_data.js */
export function resetSpawnerSettings(actor) {
  if (!can(actor, "spawnerset")) { allow(actor, "spawnerset"); return { err: "You are not allowed to change the spawner settings." }; }
  if (!load()) return { err: "The settings could not be read yet. Try again in a moment." };
  const before = D.current();
  D.configure({ ...D.DEFAULTS, rate: D.DEFAULTS.rate, storage: D.DEFAULTS.storage, stack: D.DEFAULTS.stack, animal: D.DEFAULTS.animal, mobs: {} });
  if (!persist()) { D.configure(before); return { err: "Could not save the settings." }; }
  slog(actor, "spawnerset", null, "back to the defaults");
  return { ok: true };
}
