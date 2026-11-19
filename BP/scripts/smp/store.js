// Extra per-player data for the SMP systems (statistics counters, achievements, daily reward, notifications, settings).
// Stored in its OWN world dynamic property  "x:<player id>"  - the shop data ("p:<id>") is never touched.
import { world, system } from "@minecraft/server";

const PFX = "x:";
const cache = new Map();       // id -> { d: data, saved: last saved json }

function fill(d) {
  d.st ??= {};
  for (const k of ["broken", "placed", "mobs", "bought", "sold", "trades", "ores", "diamond", "debris", "emerald", "rtp", "deep", "nether", "end"]) d.st[k] ??= 0;
  d.ach ??= {};                                  // achievement id -> unlock time
  d.titles ??= {};                               // unlocked titles: title id -> time (never removed)
  d.title ??= "";                                // the title the player chose to show
  d.mis ??= {};                                  // daily / weekly missions (see missions.js)
  d.daily ??= {};
  d.daily.last ??= -1; d.daily.streak ??= 0; d.daily.best ??= 0; d.daily.total ??= 0; d.daily.notified ??= -1;
  d.notes ??= [];                                // [{ t: time, x: text, r: 1 if read, k: key }]
  d.set ??= {};                                  // player settings
  return d;
}
function read(id) {
  try { const raw = world.getDynamicProperty(PFX + id); if (typeof raw === "string") return JSON.parse(raw); } catch (e) { /* ignore */ }
  return null;
}
function flush(id, e) {
  const s = JSON.stringify(e.d);
  if (s === e.saved) return;                     // nothing changed -> no write
  try { world.setDynamicProperty(PFX + id, s); e.saved = s; } catch (err) { console.warn("[smp] save failed " + id + " " + err); }
}

/** the extra data object of a player (loaded on first use) */
export function ex(p) {
  let e = cache.get(p.id);
  if (!e) { e = { d: fill(read(p.id) ?? {}), saved: "" }; cache.set(p.id, e); }
  return e.d;
}

system.runInterval(() => { for (const [id, e] of cache) flush(id, e); }, 100);       // every 5 s (only changed data)
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const e = cache.get(playerId);
  if (!e) return;
  flush(playerId, e); cache.delete(playerId);
});

/** read-only copy of the extra data of ANY player by id (online or offline); nothing is cached or saved */
export function exOf(id) {
  const e = cache.get(id);
  return e ? e.d : fill(read(id) ?? {});
}
