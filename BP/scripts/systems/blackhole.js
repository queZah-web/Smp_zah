// HOLOGRAPHIC BLACK HOLE (entity smp:hub_blackhole, placed from 👑 Operator > Leaderboards > Info Hub > "Place black hole").
//   * The tendrils follow a 20 second loop:  rest 0-3s -> extend slowly 3-8s -> hold at ~10 blocks 8-11s -> retract 11-16s -> rest 16-20s.
//   * This script is the clock: it writes the extension (0..1) into the entity property "smp:ext" and the resource pack animates the arms from it,
//     so the arms the players SEE and the damage zone the server uses are always in step.
//   * Light pull: players and mobs close by are drawn gently towards the centre.   Minor damage: touching a tendril or the core.
// Everything is wrapped in try/catch: a problem here can never break another system.
import { world, system } from "@minecraft/server";

const TYPE = "smp:hub_blackhole";
const CYCLE = 20;                        // seconds of one loop
const CENTER_Y = 4;                      // blocks above the entity (the sphere is 4 blocks up in the model)
const REACH = 10;                        // blocks: how far the tendrils go
const PULL_RANGE = 8, PULL_FORCE = 0.07; // light pull
const HIT_DIST = 1.7, DAMAGE = 1;        // minor damage (1 = half a heart) when a tendril touches you
const CORE_DIST = 1.5;                   // touching the black sphere itself
const COOLDOWN = 25;                     // ticks between two hits on the same player
const PITCH = [0, 20, -20, 20, 0, 20, -20, 20];   // must match the model: tendril k points 45*k degrees around, tilted by PITCH[k]
const DIRS = PITCH.map((p, k) => { const a = (45 * k * Math.PI) / 180, q = (p * Math.PI) / 180; return { x: -Math.sin(a) * Math.cos(q), y: -Math.sin(q), z: -Math.cos(a) * Math.cos(q) }; });

const smooth = (t, a, b) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const extension = (sec) => { const t = sec % CYCLE; return smooth(t, 3, 8) - smooth(t, 11, 16); };

const lastHit = new Map();
function distToSegment(p, o, d, len) {            // distance from point p to the segment o + d*[0..len]
  const vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z;
  let t = vx * d.x + vy * d.y + vz * d.z; t = Math.min(len, Math.max(0, t));
  const dx = vx - d.x * t, dy = vy - d.y * t, dz = vz - d.z * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function pull(e, c, strength) {
  const dx = c.x - e.location.x, dy = c.y - e.location.y, dz = c.z - e.location.z, m = Math.hypot(dx, dy, dz);
  if (m < 1.2 || m > PULL_RANGE) return;
  const f = strength * (1 - m / PULL_RANGE + 0.25);
  try {
    if (e.typeId === "minecraft:player") e.applyKnockback({ x: (dx / m) * f, z: (dz / m) * f }, (dy / m) * f * 0.5);
    else e.applyImpulse({ x: (dx / m) * f * 0.5, y: (dy / m) * f * 0.25, z: (dz / m) * f * 0.5 });
  } catch (er) { /* ignore */ }
}

system.runInterval(() => {
  try {
    const tick = system.currentTick, ext = extension(tick / 20);
    for (const dn of ["overworld", "nether", "the_end"]) {
      let dim; try { dim = world.getDimension(dn); } catch (e) { continue; }
      let holes = []; try { holes = dim.getEntities({ type: TYPE }); } catch (e) { continue; }
      for (const h of holes) {
        try {
          h.setProperty("smp:ext", Math.round(ext * 1000) / 1000);
          const c = { x: h.location.x, y: h.location.y + CENTER_Y, z: h.location.z };
          let near = []; try { near = dim.getEntities({ location: c, maxDistance: Math.max(PULL_RANGE, REACH + 2) }); } catch (e) { continue; }
          for (const e of near) {
            try {
              if (e.typeId === TYPE || e.typeId.startsWith("smp:") || e.typeId.startsWith("shop:")) continue;
              const isPlayer = e.typeId === "minecraft:player";
              if (isPlayer) { const gm = e.getGameMode(); if (gm === "creative" || gm === "spectator") continue; }
              else if (!e.getComponent("minecraft:health")) continue;            // items, armor stands ... are left alone
              if (tick % 2 === 0) pull(e, c, PULL_FORCE);
              if (!isPlayer && e.typeId !== "minecraft:player") { /* mobs are pulled but not hurt */ }
              if (!isPlayer) continue;
              const p = { x: e.location.x, y: e.location.y + 0.9, z: e.location.z };
              let hit = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < CORE_DIST;
              if (!hit && ext > 0.12) for (const d of DIRS) { if (distToSegment(p, c, d, REACH * ext) < HIT_DIST) { hit = true; break; } }
              if (hit && tick - (lastHit.get(e.id) ?? -999) >= COOLDOWN) {
                lastHit.set(e.id, tick);
                e.applyDamage(DAMAGE, { cause: "magic" });
                try { e.playSound("random.fizz", { volume: 0.6, pitch: 0.7 }); } catch (er) { /* ignore */ }
              }
            } catch (er) { /* ignore this entity */ }
          }
        } catch (er) { /* ignore this hole */ }
      }
    }
    if (tick % 1200 === 0) lastHit.clear();
  } catch (e) { /* ignore */ }
}, 1);
