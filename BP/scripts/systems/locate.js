// Finding SAFE places to teleport to (surface and caves) + waiting for chunks to load.
import { system } from "@minecraft/server";
import { valid } from "./util.js";

const idOf = (b) => b.typeId.replace("minecraft:", "");
// blocks that hurt / trap the player
const DANGER = /^(lava|flowing_lava|magma|cactus|fire|soul_fire|campfire|soul_campfire|sweet_berry_bush|powder_snow|pointed_dripstone|wither_rose|web|tnt|end_portal|portal|bubble_column|water|flowing_water|cave_vines.*)$/;
const isDanger = (b) => DANGER.test(idOf(b));
// things that sit ABOVE the ground (trees) - never used as the floor
const isTree = (b) => /leaves|_log$|_wood$|_stem$|hyphae|^vine$|mangrove_roots|^bee_nest$|^bamboo/.test(idOf(b));

/** floor y of the safe surface spot (feet position) at x,z -> {x,y,z} | null (not safe here) | undefined (chunk not loaded yet) */
export function surfaceSpot(dim, x, z) {
  let top;
  try { top = dim.getTopmostBlock({ x, z }); } catch (e) { return undefined; }
  if (!top) return undefined;
  let g = null, y = top.y;
  for (let i = 0; i < 80 && y > -60; i++, y--) {
    let b;
    try { b = dim.getBlock({ x, y, z }); } catch (e) { return undefined; }
    if (!b) return undefined;
    if (b.isAir) continue;
    if (b.isLiquid || isDanger(b)) return null;       // water / lava / cactus ... -> not here
    if (isTree(b) || !b.isSolid) continue;            // leaves, logs, grass, snow layer: look further down
    g = b; break;
  }
  if (!g || g.y + 2 > 318) return null;
  for (const dy of [1, 2]) {                          // body space must be free
    let b;
    try { b = dim.getBlock({ x, y: g.y + dy, z }); } catch (e) { return undefined; }
    if (!b) return null;
    if (b.isAir) continue;
    if (b.isLiquid || b.isSolid || isDanger(b)) return null;
  }
  return { x: x + 0.5, y: g.y + 1, z: z + 0.5 };
}

// a free pocket with a solid floor, no lava / fire / magma / water around it
function caveOk(dim, x, y, z) {
  let air = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) {
    const b = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz });
    if (!b) return false;
    if (isDanger(b) || b.isLiquid) return false;
    if (dy >= 0 && dy <= 1 && b.isAir) air++;
  }
  return air >= 10;                                   // a real cave room, not a 1 block crack
}

/** random cave spot inside the chunk that starts at cx,cz -> {x,y,z} | null | undefined (chunk not loaded) */
export function caveSpot(dim, cx, cz, samples = 40) {
  for (let s = 0; s < samples; s++) {
    const x = cx + Math.floor(Math.random() * 16), z = cz + Math.floor(Math.random() * 16);
    let top;
    try { top = dim.getTopmostBlock({ x, z }); } catch (e) { return undefined; }
    if (!top) return undefined;
    const found = [];
    try {
      for (let y = Math.min(top.y - 10, 50); y >= -52; y--) {
        const b = dim.getBlock({ x, y, z });
        if (!b) return undefined;
        if (!b.isAir) continue;
        const below = dim.getBlock({ x, y: y - 1, z }), above = dim.getBlock({ x, y: y + 1, z });
        if (!below || !above || !above.isAir) continue;
        if (!below.isSolid || below.isLiquid || isDanger(below)) continue;
        if (caveOk(dim, x, y, z)) found.push(y);
      }
    } catch (e) { return undefined; }
    if (found.length) return { x: x + 0.5, y: found[Math.floor(Math.random() * found.length)], z: z + 0.5 };
  }
  return null;
}

/** spawn: the safest surface spot as close as possible to x,z */
export function nearSurface(dim, cx, cz, radius = 12) {
  for (let r = 0; r <= radius; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const s = surfaceSpot(dim, cx + dx, cz + dz);
    if (s === undefined) return undefined;
    if (s) return s;
  }
  return null;
}

// ---------------------------------------------------------------- waiting for chunks
// An unloaded chunk can't be read. The player is sent high above the target (slow falling + resistance, so nothing can
// hurt them), the chunk loads around them, the finder runs, and the player is moved to the result.
export const SKY_Y = 300;
export function enterSky(player, dim, x, z, st) {
  if (!st.sky) {
    st.sky = true;
    try { player.addEffect("slow_falling", 1200, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
    try { player.addEffect("resistance", 1200, { amplifier: 4, showParticles: false }); } catch (e) { /* ignore */ }
  }
  player.teleport({ x: x + 0.5, y: SKY_Y, z: z + 0.5 }, { dimension: dim });
}
export function leaveSky(player, st) {
  if (!st.sky) return;
  st.sky = false;
  try { player.removeEffect("slow_falling"); } catch (e) { /* ignore */ }
  try { player.removeEffect("resistance"); } catch (e) { /* ignore */ }
}

/** runs finder() (returns spot | null | undefined) until the chunk is loaded, then cb(result). cb(undefined) = timeout / player gone. */
export function seek(player, dim, x, z, finder, cb, st) {
  let r;
  try { r = finder(); } catch (e) { r = undefined; }
  if (r !== undefined) { cb(r); return; }
  try { enterSky(player, dim, x, z, st); } catch (e) { cb(undefined); return; }
  let waited = 0;
  const t = system.runInterval(() => {
    if (!valid(player)) { system.clearRun(t); cb(undefined); return; }
    waited += 4;
    let res;
    try { res = finder(); } catch (e) { res = undefined; }
    if (res === undefined) { if (waited > 400) { system.clearRun(t); cb(undefined); } return; }
    system.clearRun(t); cb(res);
  }, 4);
}
