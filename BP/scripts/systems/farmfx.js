// 🌿 DRUID'S FARMING (inside a protected land): stand on the ground and CROUCH (Shift) 3 times quickly.
//   LOGIC : the nearest growable plant / sapling in each of 4 directions (north, south, east, west) grows ONE stage
//           (crops, berries, flowers, cane, cactus, bamboo, ALL saplings + fungus + propagule -> a real tree, a full melon/pumpkin stem -> fruit)
//           and a hologram above each one shows how much its growth rose (+12%) or 0% when it did not rise (croppct.js)
//           (only inside the land you are standing in, only if you are its owner / allowed player / admin).
//   VISUAL: a 360 degree aura around the player (rings on the ground, a rising spiral, orbiting leaves, rotating sparkles),
//           green energy flowing from the player to every plant that grew, and a green + gold burst on that plant.
// Purely script-driven: the particles are lux:ring_y, lux:vortex, lux:spark, lux:column (lux.js) and smp:farm_bit (RP/particles).
// Everything is try/catch-wrapped and tiny (a few dozen particles for ~2.5 s): a problem here can never stop the other systems.
import * as MC from "@minecraft/server";
import { world, system } from "@minecraft/server";
import { claimAt, isMember, isAdmin } from "./landcore.js";
import { CROPS, bumpInfo, inBox } from "./growth.js";
import { popPct, pctText } from "./croppct.js";
import { fx, soundAt } from "../lux.js";

export const FARMFX = {
  crouches: 3,            // quick crouches needed
  windowTicks: 40,        // ...within this time (2 s)
  cooldownTicks: 80,      // pause after an activation (4 s)
  reach: 6,               // horizontal reach in blocks (vertical +-2)
  auraTicks: 48,          // how long the aura lasts (2.4 s)
};
const EM = [0.25, 0.95, 0.5], LIME = [0.62, 1.0, 0.3], GOLD = [1.0, 0.84, 0.35];       // emerald / lime / soft gold
const FILTER = { includeTypes: Object.keys(CROPS) };
const state = new Map();                                                                 // player id -> { was, hits, cd }
const alive = (p) => { try { return typeof p.isValid === "function" ? p.isValid() : !!p.isValid; } catch (e) { return false; } };
const gm = (p) => { try { return String(p.getGameMode()).toLowerCase(); } catch (e) { return "survival"; } };
const rgb = (c, k = "") => ({ ["r" + k]: c[0], ["g" + k]: c[1], ["b" + k]: c[2] });

// ---------------------------------------------------------------- the growth part
/** the nearest plant that really grows in each quarter (east / west / south / north) around the player, inside the land; returns { grown: the plants that grew (with their result), zero: plants that could not grow } */
function growAround(p, claim) {
  const dim = p.dimension, l = p.location, R = FARMFX.reach, cx = Math.floor(l.x), cy = Math.floor(l.y), cz = Math.floor(l.z);
  const x1 = Math.max(claim.x1, cx - R), x2 = Math.min(claim.x2, cx + R), z1 = Math.max(claim.z1, cz - R), z2 = Math.min(claim.z2, cz + R);
  const y1 = Math.max(claim.y1, cy - 2), y2 = Math.min(claim.y2, cy + 2);
  if (x1 > x2 || z1 > z2 || y1 > y2) return { grown: [], zero: [] };
  const q = [[], [], [], []];
  let n = 0;
  for (const b of dim.getBlocks(new MC.BlockVolume({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }), FILTER, false).getBlockLocationIterator()) {
    if (++n > 600) break;
    const dx = b.x + 0.5 - l.x, dz = b.z + 0.5 - l.z;
    q[Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 1) : (dz >= 0 ? 2 : 3)].push({ x: b.x, y: b.y, z: b.z, d: dx * dx + dz * dz });
  }
  const grown = [], zero = [];
  for (const list of q) {
    list.sort((a, b) => a.d - b.d);
    let did = false;
    for (const c of list.slice(0, 12)) {                                  // the nearest one that can still grow wins
      try {
        const blk = dim.getBlock(c); if (!blk) continue;
        const def = CROPS[blk.typeId]; if (!def || !inBox(claim, c)) continue;
        const r = bumpInfo(blk, def, claim);
        if (r.ok) { grown.push({ x: c.x, y: c.y, z: c.z, r }); did = true; break; }
      } catch (e) { /* try the next plant */ }
    }
    if (!did && list.length) zero.push({ x: list[0].x, y: list[0].y, z: list[0].z });       // nothing grew here: its nearest plant shows 0%
  }
  return { grown, zero };
}

// ---------------------------------------------------------------- the visual part (all 360 degrees, symmetric)
const at = (l, dy = 0) => ({ x: l.x, y: l.y + dy, z: l.z });
function pulse(dim, l, size, c, life = 1.1) { fx(dim, "lux:ring_y", at(l, 0.06), { size, life, ...rgb(c) }); }
function spiral(dim, l, tb) {                                            // emerald + lime + gold pixels spiralling up from the soil
  const base = { ring: 1.15, life: 1.3, rise: 0.5, shrink: 0.55, spin: 380, hmax: 1.7, tb, size: 0.075, alpha: 1 };
  fx(dim, "lux:vortex", at(l, 0.05), { ...base, count: 5, ...rgb(EM) });
  fx(dim, "lux:vortex", at(l, 0.05), { ...base, count: 3, ...rgb(LIME), spin: -330 });
  fx(dim, "lux:vortex", at(l, 0.05), { ...base, count: 2, ...rgb(GOLD), size: 0.06 });
}
function leaves(dim, l, i) {                                             // leaves orbiting in both directions + a few sprouts and pollen rising
  const dir = i % 2 ? 1 : -1;
  fx(dim, "smp:farm_bit", at(l, 0.1), { count: 3, tile: 0, ring: 1.5, rise: 1.7, h0: 0.15, spin: dir * 150, life: 2.0, size: 0.2, ...rgb(EM), ...rgb(GOLD, "2") });
  if (i % 2 === 0) fx(dim, "smp:farm_bit", at(l, 0.1), { count: 2, tile: 1, ring: 0.9, rise: 1.3, h0: 0.1, spin: -dir * 110, life: 1.7, size: 0.2, ...rgb(LIME), ...rgb(EM, "2") });
  if (i % 3 === 0) fx(dim, "smp:farm_bit", at(l, 0.1), { count: 4, tile: 2, ring: 1.1, rise: 2.0, h0: 0.1, spin: dir * 220, life: 1.6, size: 0.11, ...rgb(GOLD), ...rgb(LIME, "2") });
}
function rim(dim, l, i) {                                                // 6 sparkles on a circle that turns smoothly: seamless 360 degrees
  const th = i * 0.5;
  for (let k = 0; k < 6; k++) {
    const a = th + k * Math.PI / 3, r = 1.45 + 0.25 * Math.sin(i * 0.4 + k);
    fx(dim, "lux:spark", { x: l.x + Math.cos(a) * r, y: l.y + 0.1, z: l.z + Math.sin(a) * r }, { count: 1, radius: 0.05, speed: 0.25, life: 0.8, size: 0.12, ...rgb(k % 2 ? GOLD : EM) });
  }
}
function wave(dim, from, to, step) {                                     // green energy that flows over the soil from the player to the plant
  const t = (step + 1) / 6, loc = { x: from.x + (to.x - from.x) * t, y: from.y + 0.12, z: from.z + (to.z - from.z) * t };
  fx(dim, "smp:farm_bit", loc, { count: 2, tile: 2, ring: 0.12, rise: 0.25, h0: 0, spin: 200, life: 0.7, size: 0.1, ...rgb(LIME), ...rgb(GOLD, "2") });
  fx(dim, "lux:spark", loc, { count: 1, radius: 0.05, speed: 0.15, life: 0.6, size: 0.1, ...rgb(EM) });
}
function burst(dim, b) {                                                 // short, elegant growth burst on one plant
  const c = { x: b.x + 0.5, y: b.y + 0.15, z: b.z + 0.5 };
  fx(dim, "lux:ring_y", at(c, 0.05), { size: 1.7, life: 0.8, ...rgb(LIME) });
  fx(dim, "lux:column", c, { count: 7, radius: 0.3, speed: 1.2, life: 1.0, size: 0.13, ...rgb(EM) });
  fx(dim, "lux:spark", at(c, 0.3), { count: 5, radius: 0.3, speed: 1.0, life: 0.8, size: 0.13, ...rgb(GOLD) });
  fx(dim, "smp:farm_bit", c, { count: 3, tile: 1, ring: 0.35, rise: 1.0, h0: 0.1, spin: 160, life: 1.2, size: 0.17, ...rgb(LIME), ...rgb(EM, "2") });
  fx(dim, "smp:farm_bit", c, { count: 3, tile: 0, ring: 0.5, rise: 1.2, h0: 0.2, spin: -140, life: 1.4, size: 0.17, ...rgb(EM), ...rgb(GOLD, "2") });
}

/** the whole show, driven tick by tick (ends cleanly by itself, also if the player leaves or dies) */
function show(p, grown) {
  const t0 = system.currentTick, from0 = at(p.location);
  let i = 0;
  const h = system.runInterval(() => {
    try {
      if (!alive(p) || i > FARMFX.auraTicks / 2) { system.clearRun(h); return; }
      const dim = p.dimension, l = p.location;
      if (i === 0) { pulse(dim, l, 6.0, EM, 1.2); spiral(dim, l, 0); }
      if (i === 3) pulse(dim, l, 3.6, GOLD, 1.0);
      if (i === 6) { pulse(dim, l, 2.2, LIME, 0.9); spiral(dim, l, 0.3); }
      if (i === 12) pulse(dim, l, 4.6, EM, 1.0);
      if (i === 16) spiral(dim, l, 0.6);
      if (i % 2 === 0) leaves(dim, l, i / 2);
      rim(dim, l, i);
      if (i < 6) for (const g of grown) wave(dim, from0, { x: g.x + 0.5, y: g.y, z: g.z + 0.5 }, i);
      if (i === 6) for (const g of grown) burst(dim, g);
      i++;
    } catch (e) { try { system.clearRun(h); } catch (e2) { /* ignore */ } }
  }, 2);
}

// ---------------------------------------------------------------- crouch detection
function activate(p) {
  try {
    const l = p.location, claim = claimAt(p.dimension.id, l.x, l.y, l.z);
    if (!claim || !(isMember(claim, p) || isAdmin(p))) return false;
    const { grown, zero } = growAround(p, claim);
    const dim = p.dimension;
    for (const g of zero) popPct(dim, g, pctText({ ok: false, delta: 0 }));                  // 0% above a plant that did not rise
    if (!grown.length) { try { p.onScreenDisplay.setActionBar(zero.length ? "§7Nothing can grow more here" : "§7No plant to grow here"); } catch (e) { /* ignore */ } return zero.length > 0; }
    show(p, grown);
    for (const g of grown) popPct(dim, g, pctText(g.r));                                  // +12% above a plant that rose
    try { soundAt(p, "block.composter.fill_success", at(l), 0.7, 1.3); } catch (e) { /* ignore */ }
    try { p.onScreenDisplay.setActionBar("§a🌿 §2Growth §a+" + grown.length); } catch (e) { /* ignore */ }
    return true;
  } catch (e) { console.warn("[farmfx] " + e); return false; }
}
try {
  system.runInterval(() => {
    const now = system.currentTick;
    for (const p of world.getAllPlayers()) {
      try {
        let s = state.get(p.id); if (!s) { s = { was: false, hits: [], cd: 0 }; state.set(p.id, s); }
        const sn = !!p.isSneaking;
        if (sn && !s.was) {                                              // a new crouch
          s.hits = s.hits.filter((t) => now - t <= FARMFX.windowTicks); s.hits.push(now);
          if (s.hits.length >= FARMFX.crouches && now >= s.cd && p.isOnGround && gm(p) !== "spectator") {
            s.hits = [];
            if (activate(p)) s.cd = now + FARMFX.cooldownTicks;
          }
        }
        s.was = sn;
      } catch (e) { /* skip this player */ }
    }
  }, 2);
  world.afterEvents.playerLeave.subscribe((ev) => { state.delete(ev.playerId); });
} catch (e) { console.warn("[farmfx] not started: " + e); }
