// The area of the spawn that was built from  /opr > Building > Spawn  (only data, no game events here).
// Saved in the world:  sbld:zone = { d: dimension id, x1, y1, z1, x2, y2, z2, cx, cy, cz }
// Used by spawnbuild.js (Owner-only protection) and landcore.js (no land protection can be bought on top of it).
import { world } from "@minecraft/server";

const KEY = "sbld:zone";
let cache;            // undefined = not read yet, null = no zone
export function getZone() {
  if (cache !== undefined) return cache;
  try { const raw = world.getDynamicProperty(KEY); cache = typeof raw === "string" ? JSON.parse(raw) : null; } catch (e) { return null; }   // world not ready yet: try again later
  return cache;
}
export function setZone(z) { world.setDynamicProperty(KEY, JSON.stringify(z)); cache = z; }
export function clearZone() { try { world.setDynamicProperty(KEY, undefined); } catch (e) { /* ignore */ } cache = null; }
/** true when the block x y z (dimension dimId) is inside the spawn area (+ margin blocks around it) */
export function inZone(dimId, x, y, z, margin = 0) {
  const s = getZone(); if (!s || s.d !== dimId) return false;
  return x >= s.x1 - margin && x <= s.x2 + margin && y >= s.y1 - margin && y <= s.y2 + margin && z >= s.z1 - margin && z <= s.z2 + margin;
}
/** like inZone, but any height above the floor (liquids placed high above still fall in) */
export function inZoneColumn(dimId, x, y, z, margin = 0) {
  const s = getZone(); if (!s || s.d !== dimId) return false;
  return x >= s.x1 - margin && x <= s.x2 + margin && z >= s.z1 - margin && z <= s.z2 + margin && y >= s.y1 - 2;
}
/** box = { x1, y1, z1, x2, y2, z2 } in dimension d overlaps the spawn area */
export function zoneOverlaps(d, b) {
  const s = getZone(); if (!s || s.d !== d) return false;
  return b.x1 <= s.x2 && b.x2 >= s.x1 && b.y1 <= s.y2 && b.y2 >= s.y1 && b.z1 <= s.z2 && b.z2 >= s.z1;
}
