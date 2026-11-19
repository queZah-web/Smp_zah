// Placed logs: every log (also wood / stem / hyphae, stripped or not) that a PLAYER places is remembered, so Timber (mining.js) never cuts it.
// A house made of logs is safe from Timber - also when the builder leaves the world and comes back, and also for other players' Timber.
//   * saved in the world (dynamic properties "plg:<dimension>:<chunk x>:<chunk z>:<slab>"), so it survives restarts.  One property = one chunk (16 x 16) and 64 blocks of height.
//   * small builds are saved as a list of numbers, big builds as a bit map (max ~4 KB per property).
//   * the mark is removed when a player breaks that log.
// Only logs placed AFTER this update are remembered (the game can not know who built older ones).
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system } from "@minecraft/server";

const LOGRE = /^minecraft:(?:stripped_)?.+_(?:log|wood|stem|hyphae)$/;
const PFX = "plg:", BYTES = 2048, MAX_CACHE = 400;      // 16 x 16 x 64 = 16384 positions = 2048 bytes
const cache = new Map();                                  // property key -> { bits: Uint8Array, dirty: boolean }
const dimShort = (d) => String(d ?? "").replace("minecraft:", "");
const mod = (n, m) => ((n % m) + m) % m;

function where(dimId, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const yy = y + 64, slab = Math.floor(yy / 64);
  return { key: PFX + dimShort(dimId) + ":" + Math.floor(x / 16) + ":" + Math.floor(z / 16) + ":" + slab, idx: mod(yy, 64) * 256 + mod(x, 16) * 16 + mod(z, 16) };
}
function decode(raw, bits) {
  if (typeof raw !== "string") return;
  if (raw.startsWith("L:")) { for (const t of raw.slice(2).split(",")) { const i = parseInt(t, 36); if (i >= 0 && i < BYTES * 8) bits[i >> 3] |= 1 << (i & 7); } }
  else if (raw.startsWith("B:")) { for (let i = 0; i < BYTES; i++) bits[i] = parseInt(raw.substr(2 + i * 2, 2), 16) || 0; }
}
function encode(bits) {
  const list = [];
  for (let i = 0; i < BYTES * 8; i++) if (bits[i >> 3] & (1 << (i & 7))) list.push(i);
  if (!list.length) return undefined;
  if (list.length * 4 <= BYTES * 2) return "L:" + list.map((i) => i.toString(36)).join(",");
  let s = "B:"; for (let i = 0; i < BYTES; i++) s += (bits[i] < 16 ? "0" : "") + bits[i].toString(16);
  return s;
}
function bucket(key) {
  let b = cache.get(key);
  if (b) return b;
  b = { bits: new Uint8Array(BYTES), dirty: false };
  try { decode(world.getDynamicProperty(key), b.bits); } catch (e) { /* not readable: empty */ }
  cache.set(key, b);
  return b;
}
function flush() {
  for (const [key, b] of cache) {
    if (!b.dirty) continue;
    try { world.setDynamicProperty(key, encode(b.bits)); b.dirty = false; } catch (e) { console.warn("[placedlogs] save: " + e); }
  }
  if (cache.size > MAX_CACHE) for (const [key, b] of cache) if (!b.dirty) cache.delete(key);
}
system.runInterval(flush, 100);
try { system.beforeEvents.shutdown.subscribe(() => { try { flush(); } catch (e) { /* ignore */ } }); } catch (e) { /* not in this version */ }
try { world.afterEvents.playerLeave.subscribe(() => { try { flush(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }

/** was the log at this place put there by a player?  dim = Dimension (or its id), loc = { x, y, z } */
export function isPlacedLog(dim, loc) {
  try { const w = where(typeof dim === "string" ? dim : dim.id, loc.x, loc.y, loc.z); return !!(bucket(w.key).bits[w.idx >> 3] & (1 << (w.idx & 7))); } catch (e) { return false; }
}
function setMark(dimId, loc, on) {
  const w = where(dimId, loc.x, loc.y, loc.z), b = bucket(w.key), has = !!(b.bits[w.idx >> 3] & (1 << (w.idx & 7)));
  if (has === on) return;
  if (on) b.bits[w.idx >> 3] |= 1 << (w.idx & 7); else b.bits[w.idx >> 3] &= ~(1 << (w.idx & 7));
  b.dirty = true;
}

// a player places a log -> remembered
try {
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    try { const b = ev.block; if (b && LOGRE.test(b.typeId)) setMark(b.dimension.id, b.location, true); } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[placedlogs] not started: " + e); }

// a player breaks a log -> forgotten (one tick later, so Timber (mining.js) can still ask about it during the break)
try {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    try {
      if (!LOGRE.test(ev.brokenBlockPermutation.type.id)) return;
      const dimId = ev.block.dimension.id, l = ev.block.location, loc = { x: l.x, y: l.y, z: l.z };
      system.run(() => { try { setMark(dimId, loc, false); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }
