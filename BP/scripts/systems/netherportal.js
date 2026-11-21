// ===================================================================================================================
// THE SPAWN'S NETHER PORTALS -> a RANDOM place in the Nether (never the same spot: no camping / no traps at the exit)
//
//   Any nether portal INSIDE the built spawn (the Nether Gate and the 4 Butterfly Lanterns of the Celestial Sanctuary, or a
//   portal the Owner builds there) works like this:
//     * a player steps into it -> he is put back one step at once (so the game's own portal never takes him), the portal
//       sound plays and the screen swirls (nausea) for a moment
//     * meanwhile a random place in the Nether is loaded (300 - 3,000 blocks from 0 0, every time a new one) and a SAFE spot is
//       searched there: solid ground (no lava, no fire, no magma, no bedrock roof), 2 blocks of air for the body, no lava next
//       to the feet.  Not found -> another random place (up to 5 times).
//     * he arrives with a short fire resistance (just in case) and a message with his coordinates
//   At most 2 searches run at the same time (each loads one small area for a moment); the others wait a few seconds.
//   Portals OUTSIDE the spawn are normal vanilla portals.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { inZone, getZone } from "./spawnzone.js";
import { pick } from "./arextra.js";

const MIN_D = 300, MAX_D = 3000, TRIES = 5, WAIT_TICKS = 200, MAX_BUSY = 2;
const DANGER = /lava|fire|magma|campfire|cactus|sweet_berry|wither_rose|pointed_dripstone|powder_snow|^minecraft:portal$/;
const PASS = /air|grass|fungus|roots|sprouts|vines|mushroom|lichen|light_block/;
const lastSafe = new Map();                        // player id -> { x, y, z } (a spot near the portal that is not portal)
const busy = new Map();                            // player id -> search
let running = 0, seq = 0;
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const nether = () => world.getDimension("nether");
const idAt = (dim, x, y, z) => { try { return dim.getBlock({ x, y, z })?.typeId ?? null; } catch (e) { return null; } };

/** a safe spot in the column x, z of the Nether (or null); undefined = not loaded */
function spotIn(dim, x, z) {
  try { if (!dim.getBlock({ x, y: 64, z })) return undefined; } catch (e) { return undefined; }
  const ys = [];
  for (let y = 32; y <= 112; y++) {
    const feet = idAt(dim, x, y, z), head = idAt(dim, x, y + 1, z), below = idAt(dim, x, y - 1, z);
    if (feet === null || head === null || below === null) return undefined;
    if (!PASS.test(feet) || !PASS.test(head) || PASS.test(below) || DANGER.test(below) || /bedrock|water|nether_portal/.test(below)) continue;
    let lava = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = idAt(dim, x + dx, y, z + dz), m = idAt(dim, x + dx, y - 1, z + dz); if ((n && DANGER.test(n)) || (m && /lava/.test(m))) { lava = true; break; } }
    if (!lava) ys.push(y);
  }
  return ys.length ? { x: x + 0.5, y: ys[Math.floor(Math.random() * ys.length)], z: z + 0.5 } : null;
}

function start(p) {
  if (busy.has(p.id)) return;
  if (running >= MAX_BUSY) { tell(p, "§5[Portal] §7The portal is busy - try again in a few seconds.", "§5[البوابة] §7البوابة مشغولة - جرب بعد كم ثانية."); return; }
  running++;
  const s = { id: p.id, tries: 0, name: "smp_nrtp_" + (++seq % 100), x: 0, z: 0, t: 0 };
  busy.set(p.id, s);
  try { p.addEffect("nausea", 100, { amplifier: 0, showParticles: false }); p.addEffect("resistance", 200, { amplifier: 4, showParticles: false }); p.playSound("portal.trigger", { volume: 0.7 }); } catch (e) { /* ignore */ }
  tell(p, "§5[Portal] §dThe portal is opening a way into the Nether...", "§5[البوابة] §dالبوابة تفتح طريق للنذر...");
  pickPlace(s);
}
function pickPlace(s) {
  const a = Math.random() * Math.PI * 2, d = MIN_D + Math.random() * (MAX_D - MIN_D);
  s.x = Math.round(Math.cos(a) * d); s.z = Math.round(Math.sin(a) * d); s.t = system.currentTick; s.tries++;
  try { nether().runCommand(`tickingarea remove ${s.name}`); } catch (e) { /* none */ }
  try { nether().runCommand(`tickingarea add circle ${s.x} 64 ${s.z} 1 ${s.name}`); } catch (e) { /* the area loads when it can */ }
}
function finish(s, p, spot) {
  busy.delete(s.id); running = Math.max(0, running - 1);
  try { nether().runCommand(`tickingarea remove ${s.name}`); } catch (e) { /* ignore */ }
  if (!p) return;
  if (!spot) { tell(p, "§5[Portal] §cNo safe place was found this time. Walk into the portal again.", "§5[البوابة] §cما لكيت مكان آمن هالمرة. ادخل البوابة مرة ثانية."); return; }
  try {
    p.teleport(spot, { dimension: nether() });
    p.addEffect("fire_resistance", 400, { amplifier: 0, showParticles: false });
    p.playSound("portal.travel", { volume: 0.5 });
    tell(p, "§5[Portal] §dWelcome to the Nether! §7(" + Math.floor(spot.x) + " " + spot.y + " " + Math.floor(spot.z) + ")", "§5[البوابة] §dأهلاً بالنذر! §7(" + Math.floor(spot.x) + " " + spot.y + " " + Math.floor(spot.z) + ")");
  } catch (e) { tell(p, "§5[Portal] §cThe teleport failed. Try again.", "§5[البوابة] §cفشل الانتقال. جرب مرة ثانية."); }
}

// the search: every 5 ticks for each running search (9 columns around the random point)
const OFFS = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]];
system.runInterval(() => {
  if (!busy.size) return;
  const dim = nether();
  for (const s of [...busy.values()]) {
    const p = world.getAllPlayers().find((q) => q.id === s.id);
    if (!p) { finish(s, null, null); continue; }
    let found = null, unloaded = false;
    for (const [dx, dz] of OFFS) {
      const v = spotIn(dim, s.x + dx, s.z + dz);
      if (v === undefined) { unloaded = true; break; }
      if (v) { found = v; break; }
    }
    if (found) { finish(s, p, found); continue; }
    if (!unloaded || system.currentTick - s.t > WAIT_TICKS) { if (s.tries >= TRIES) finish(s, p, null); else pickPlace(s); }
  }
}, 5);

// stepping into a portal inside the spawn
system.runInterval(() => {
  if (!getZone()) return;
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== "minecraft:overworld") continue;
      const l = p.location, x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
      if (!inZone(p.dimension.id, x, y, z)) { lastSafe.delete(p.id); continue; }
      const here = idAt(p.dimension, x, y, z), head = idAt(p.dimension, x, y + 1, z);
      if (here === "minecraft:portal" || head === "minecraft:portal") {
        const back = lastSafe.get(p.id);
        if (back) { try { p.teleport(back, { keepVelocity: false }); } catch (e) { /* ignore */ } }
        start(p);
      } else lastSafe.set(p.id, { x: l.x, y: l.y, z: l.z });
    } catch (e) { /* ignore this player */ }
  }
}, 2);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastSafe.delete(playerId); }); } catch (e) { /* ignore */ }
