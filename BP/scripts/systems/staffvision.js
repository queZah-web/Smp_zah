// 👁 ADMIN VISION (Operator menu, Admin role only)
//  1) Spectator: one click switches to Spectator, one more click returns to the game mode the admin had before.
//  2) Ore vision: coloured frames (only on the admin's own screen: Player.spawnParticle) around the ores near him.
//     It also sees ores hidden by Anti X-Ray (smp:ax_*), because those are mapped back to the real ore.
//     Bedrock hides particles behind solid blocks, so it works best together with Spectator (fly inside the rock).
// Everything is try/catch-wrapped and time-boxed: a problem here can never stop the other systems.
import * as MC from "@minecraft/server";
import { world, system, GameMode } from "@minecraft/server";
import { ORE_KEY, ORES, ALL_FAKE, realOf } from "./axrids.js";
import { can, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";

export const VISION = {
  everyTicks: 10,         // how often the frames are refreshed (10 = twice a second)
  radiusXZ: 20,           // blocks around the admin that are searched
  radiusY: 14,
  maxMarks: 64,           // frames drawn per refresh (the nearest ores first)
  budgetMs: 4,
};
const COLOR = {           // ore -> frame colour (r, g, b)
  diamond: [0.2, 1, 1], emerald: [0.2, 1, 0.3], gold: [1, 0.85, 0.1], iron: [0.95, 0.75, 0.6], lapis: [0.3, 0.45, 1],
  redstone: [1, 0.15, 0.15], coal: [0.55, 0.55, 0.55], copper: [1, 0.5, 0.2], ancient_debris: [0.85, 0.5, 0.3], quartz: [1, 1, 1], nether_gold: [1, 0.85, 0.1],
};
const RARE = new Set(["diamond", "emerald", "gold", "ancient_debris"]);

const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const FILTER = { includeTypes: [...ORES.map((o) => "minecraft:" + o), ...ALL_FAKE] };

// ---------------------------------------------------------------- spectator
const prevMode = new Map();                                       // player id -> game mode before Spectator (also saved on the player)
const PKEY = "stf:pgm";
const modeName = (p) => { try { return String(p.getGameMode()).toLowerCase(); } catch (e) { return "survival"; } };
const MODES = { survival: GameMode.Survival, creative: GameMode.Creative, adventure: GameMode.Adventure, spectator: GameMode.Spectator };
export const isSpectator = (p) => modeName(p) === "spectator";
export const modeLabel = (p) => { const m = modeName(p); return m ? m[0].toUpperCase() + m.slice(1) : "?"; };
const solid = (b) => { try { return b.isSolid === true; } catch (e) { return false; } };
/** leaving Spectator inside rock: move up to the first free 2-block space so he does not suffocate */
function unstick(p) {
  try {
    const dim = p.dimension, l = p.location, x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    const a0 = dim.getBlock({ x, y, z }), b0 = dim.getBlock({ x, y: y + 1, z });
    if (!a0 || !b0 || (!solid(a0) && !solid(b0))) return;
    for (let i = 1; i < 90; i++) {
      const a = dim.getBlock({ x, y: y + i, z }), b = dim.getBlock({ x, y: y + i + 1, z });
      if (!a || !b) return;
      if (!solid(a) && !solid(b)) { p.teleport({ x: x + 0.5, y: y + i, z: z + 0.5 }); return; }
    }
  } catch (e) { /* ignore */ }
}
/** Spectator <-> previous mode.  Returns { ok, on } or { err } */
export function toggleSpectator(p) {
  try {
    if (!can(p, "spectate")) return { err: "No permission." };
    if (isSpectator(p)) {
      let back = prevMode.get(p.id);
      if (!back) { try { const v = p.getDynamicProperty(PKEY); if (typeof v === "string") back = v; } catch (e) { /* ignore */ } }
      const g = MODES[back] && back !== "spectator" ? back : "survival";
      p.setGameMode(MODES[g]); prevMode.delete(p.id);
      try { p.setDynamicProperty(PKEY, undefined); } catch (e) { /* ignore */ }
      if (g !== "creative") unstick(p);
      slog(p, "spectate", null, "off > " + g);
      return { ok: true, on: false, mode: g };
    }
    const cur = modeName(p);
    prevMode.set(p.id, cur);
    try { p.setDynamicProperty(PKEY, cur); } catch (e) { /* ignore */ }
    p.setGameMode(GameMode.Spectator);
    slog(p, "spectate", null, "on");
    return { ok: true, on: true, mode: cur };
  } catch (e) { return { err: "Could not change the game mode." }; }
}

/** Go INTO Spectator (never out of it). Used by "Spectator on player": already in Spectator = nothing changes. Returns { ok, on?, already? } or { err } */
export function enterSpectator(p, note) {
  try {
    if (!can(p, "spectate")) return { err: "No permission." };
    if (isSpectator(p)) { slog(p, "spectate", null, "to > " + String(note ?? "")); return { ok: true, already: true }; }
    const cur = modeName(p);
    prevMode.set(p.id, cur);
    try { p.setDynamicProperty(PKEY, cur); } catch (e) { /* ignore */ }
    p.setGameMode(GameMode.Spectator);
    slog(p, "spectate", null, "on" + (note ? " > " + String(note) : ""));
    return { ok: true, on: true, mode: cur };
  } catch (e) { return { err: "Could not change the game mode." }; }
}

// ---------------------------------------------------------------- ore vision
const vision = new Map();                                         // player id -> "all" | "rare"
export const visionMode = (p) => vision.get(p.id) ?? null;
export function setVision(p, mode) {
  try {
    if (!can(p, "orevision")) return { err: "No permission." };
    if (mode === "all" || mode === "rare") vision.set(p.id, mode); else vision.delete(p.id);
    slog(p, "orevision", null, mode ?? "off");
    return { ok: true, mode: mode ?? null };
  } catch (e) { return { err: "Something went wrong." }; }
}

const vars = new Map();                                           // ore key -> MolangVariableMap (one per colour)
function varsOf(key) {
  let v = vars.get(key);
  if (!v) { const c = COLOR[key] ?? [1, 1, 1]; v = new MC.MolangVariableMap(); v.setFloat("variable.r", c[0]); v.setFloat("variable.g", c[1]); v.setFloat("variable.b", c[2]); vars.set(key, v); }
  return v;
}
const PLANES = ["smp:orebox_xy", "smp:orebox_xz", "smp:orebox_yz"];

function draw(p, mode) {
  const dim = p.dimension, hr = dim.heightRange, l = p.location;
  const cx = Math.floor(l.x), cy = Math.floor(l.y), cz = Math.floor(l.z), rx = VISION.radiusXZ, ry = VISION.radiusY;
  const vol = new MC.BlockVolume({ x: cx - rx, y: Math.max(hr.min, cy - ry), z: cz - rx }, { x: cx + rx, y: Math.min(hr.max - 1, cy + ry), z: cz + rx });
  const found = []; let n = 0;
  for (const b of dim.getBlocks(vol, FILTER, true).getBlockLocationIterator()) {
    if (++n > 4000) break;
    const dx = b.x - cx, dy = b.y - cy, dz = b.z - cz;
    found.push({ x: b.x, y: b.y, z: b.z, d: dx * dx + dy * dy + dz * dz });
  }
  found.sort((a, b) => a.d - b.d);
  let drawn = 0;
  for (const f of found) {
    if (drawn >= VISION.maxMarks) break;
    let id; try { id = dim.getBlock(f)?.typeId; } catch (e) { continue; }
    if (!id) continue;
    const key = ORE_KEY[realOf(id).replace("minecraft:", "")];
    if (!key || (mode === "rare" && !RARE.has(key))) continue;
    const loc = { x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 }, v = varsOf(key);
    for (const pl of PLANES) p.spawnParticle(pl, loc, v);
    drawn++;
  }
}
try {
  system.runInterval(() => {
    if (!vision.size) return;
    const t0 = Date.now();
    for (const [id, mode] of [...vision]) {
      const p = world.getAllPlayers().find((x) => x.id === id);
      if (!p || !can(p, "orevision")) { vision.delete(id); continue; }       // left the game or lost the Admin role
      if (Date.now() - t0 > VISION.budgetMs) break;
      try { draw(p, mode); } catch (e) { console.warn("[vision] " + e); }
    }
  }, VISION.everyTicks);
} catch (e) { console.warn("[vision] not started: " + e); }
try { world.afterEvents.playerLeave.subscribe((ev) => { vision.delete(ev.playerId); }); } catch (e) { /* ignore */ }
