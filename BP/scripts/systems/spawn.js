// /spawn - back to the spawn point. The point is the one an operator saved from the Operator menu > Set spawn (kept in the world),
// or - while none is saved - config.js SPAWN (default 0 0 0 -> the surface there).
import { world } from "@minecraft/server";
import { SPAWN } from "./config.js";
import { canTeleport, stamp, valid } from "./util.js";
import { nearSurface, seek, leaveSky } from "./locate.js";
import { luxTeleport, here } from "../lux.js";
import { menuMsg } from "./menulang.js";

const busy = new Set();
const KEY = "spawn:v1";

/** the spawn point now in use: { x, y, z, d (dimension id), custom }. y = null -> the surface is searched (config default) */
export function getSpawn() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      if ([o.x, o.y, o.z].every((n) => typeof n === "number" && Number.isFinite(n))) return { x: o.x, y: o.y, z: o.z, d: typeof o.d === "string" ? o.d : "minecraft:overworld", custom: true };
    }
  } catch (e) { /* unreadable: use the default */ }
  return { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, d: "minecraft:overworld", custom: false };
}
/** saves the operator's current position as the spawn point. Returns the new point or null */
export function setSpawn(p) {
  try {
    const l = p.location, o = { x: Math.floor(l.x), y: Math.round(l.y * 100) / 100, z: Math.floor(l.z), d: p.dimension.id };
    world.setDynamicProperty(KEY, JSON.stringify(o));
    return { ...o, custom: true };
  } catch (e) { console.warn("[spawn] save failed: " + e); return null; }
}
/** goes back to the config default (0 0 0 surface) */
export function resetSpawn() {
  try { world.setDynamicProperty(KEY, undefined); return true; } catch (e) { console.warn("[spawn] reset failed: " + e); return false; }
}

export function goSpawn(player) {
  if (busy.has(player.id)) return;
  if (!canTeleport(player, "spawn")) return;
  const SP = getSpawn();
  let dim;
  try { dim = world.getDimension(SP.d); } catch (e) { dim = world.getDimension("overworld"); }
  const done = (spot) => {
    const from = here(player);
    try { player.teleport(spot, { dimension: dim }); } catch (e) { return player.sendMessage(menuMsg(player, "§c[Spawn] Teleport failed.")); }
    luxTeleport(player, from);
    stamp(player, "spawn");
    player.sendMessage(menuMsg(player, "§a[Spawn] Teleported to spawn."));
  };
  if (typeof SP.y === "number") return done({ x: SP.x + 0.5, y: SP.y, z: SP.z + 0.5 });
  const origin = { loc: { x: player.location.x, y: player.location.y, z: player.location.z }, dim: player.dimension };
  const st = { sky: false };
  busy.add(player.id);
  seek(player, dim, SP.x, SP.z, () => nearSurface(dim, SP.x, SP.z), (r) => {
    busy.delete(player.id);
    if (!valid(player)) return;
    leaveSky(player, st);
    if (r === undefined) { try { player.teleport(origin.loc, { dimension: origin.dim }); } catch (e) { /* ignore */ } return player.sendMessage(menuMsg(player, "§c[Spawn] Could not load the spawn area - try again.")); }
    if (r === null) {                                        // nothing safe near spawn: use the top block
      try { const t = dim.getTopmostBlock({ x: SP.x, z: SP.z }); return done({ x: SP.x + 0.5, y: (t ? t.y : 64) + 1, z: SP.z + 0.5 }); } catch (e) { return player.sendMessage(menuMsg(player, "§c[Spawn] Could not find a spot.")); }
    }
    done(r);
  }, st);
}
