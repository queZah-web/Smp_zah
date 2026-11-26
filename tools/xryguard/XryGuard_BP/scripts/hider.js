// ============================================================
//  XryGuard - إخفاء الخامات وكشفها
// ============================================================
import { BlockPermutation, BlockVolume } from "@minecraft/server";
import { ORES, ORE_INDEX, HOSTS, HOST_SET, OCCLUDERS, DIMENSIONS, defaultHost } from "./config.js";
import * as store from "./store.js";
import { WAIT } from "./scheduler.js";

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const SCAN_IDS = ORES;
const HOST_PRIORITY = new Map(HOSTS.map((id, i) => [id, i]));

export function safeBlock(dim, loc) {
  try {
    return dim.getBlock(loc);
  } catch {
    return undefined;
  }
}

export function chunkLoaded(dim, cx, cz) {
  const info = DIMENSIONS[dim.id];
  return safeBlock(dim, { x: cx * 16, y: info.minY, z: cz * 16 }) !== undefined;
}

// الخامة مغطاة بالكامل؟ (كل الجيران الستة بلوكات مصمتة)
export function isEnclosed(dim, x, y, z) {
  for (const [dx, dy, dz] of DIRS) {
    const b = safeBlock(dim, { x: x + dx, y: y + dy, z: z + dz });
    if (!b || !OCCLUDERS.has(b.typeId)) return false;
  }
  return true;
}

// نختار الحجر اللي حول الخامة حتى تتنكر بنفس شكله.
function chooseHost(dim, x, y, z, oreId) {
  const counts = new Map();
  for (const [dx, dy, dz] of DIRS) {
    const b = safeBlock(dim, { x: x + dx, y: y + dy, z: z + dz });
    if (b && HOST_SET.has(b.typeId)) {
      const c = counts.get(b.typeId);
      if (c) c.n++;
      else counts.set(b.typeId, { n: 1, perm: b.permutation });
    }
  }
  let best;
  for (const [id, c] of counts) {
    if (!best || c.n > best.n || (c.n === best.n && HOST_PRIORITY.get(id) < HOST_PRIORITY.get(best.id)))
      best = { id, ...c };
  }
  return best ? best.perm : BlockPermutation.resolve(defaultHost(oreId));
}

// يفحص التشنك ويخفي كل الخامات المدفونة بيه.
// يرجع true إذا خلص، false إذا التشنك (أو جيرانه) مو محمّل.
export function* processChunk(dim, cx, cz) {
  const info = DIMENSIONS[dim.id];
  if (!info) return true;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) if (!chunkLoaded(dim, cx + dx, cz + dz)) return false;

  const rec = store.getOrCreate(dim.id, cx, cz);
  if (rec.done) return true;

  const x0 = cx * 16;
  const z0 = cz * 16;
  const found = [];
  for (let y = info.minY; y <= info.scanMaxY; y += 16) {
    const vol = new BlockVolume({ x: x0, y, z: z0 }, { x: x0 + 15, y: Math.min(y + 15, info.scanMaxY), z: z0 + 15 });
    let list;
    try {
      list = dim.getBlocks(vol, { includeTypes: SCAN_IDS }, false);
    } catch {
      return false;
    }
    for (const loc of list.getBlockLocationIterator()) found.push({ x: loc.x, y: loc.y, z: loc.z });
    yield;
  }

  let n = 0;
  for (const loc of found) {
    const b = safeBlock(dim, loc);
    if (!b) {
      store.markDirty(rec);
      return false;
    }
    const code = ORE_INDEX.get(b.typeId);
    if (code === undefined) continue;
    if (!isEnclosed(dim, loc.x, loc.y, loc.z)) continue;
    const host = chooseHost(dim, loc.x, loc.y, loc.z, b.typeId);
    rec.entries.set(store.localIndex(loc.x, loc.y, loc.z, info.minY), code);
    b.setPermutation(host);
    if (++n % 24 === 0) {
      store.markDirty(rec);
      yield;
    }
  }
  rec.done = true;
  store.markDirty(rec);
  return true;
}

function recordAt(dimId, x, y, z) {
  const info = DIMENSIONS[dimId];
  if (!info) return undefined;
  const rec = store.get(dimId, Math.floor(x / 16), Math.floor(z / 16));
  if (!rec) return undefined;
  const idx = store.localIndex(x, y, z, info.minY);
  const ore = rec.entries.get(idx);
  return ore === undefined ? undefined : { rec, idx, ore };
}

export function isHidden(dimId, loc) {
  return recordAt(dimId, Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z)) !== undefined;
}

// يرجّع الخامة الحقيقية بمكانها.
export function reveal(dim, x, y, z) {
  const r = recordAt(dim.id, x, y, z);
  if (!r) return false;
  const b = safeBlock(dim, { x, y, z });
  if (!b) return false; // التشنك مو محمّل، نخلي السجل
  if (HOST_SET.has(b.typeId)) b.setType(ORES[r.ore]);
  r.rec.entries.delete(r.idx);
  store.markDirty(r.rec);
  return true;
}

// ينكشف كل شي يم بلوك انكسر أو تغيّر.
export function revealNeighbors(dim, loc) {
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  for (const [dx, dy, dz] of DIRS) reveal(dim, x + dx, y + dy, z + dz);
}

// يفحص كل الخامات المخفية بمنطقة، وأي وحدة صارت مكشوفة يرجعها.
export function* checkArea(dim, center, r) {
  const info = DIMENSIONS[dim.id];
  if (!info) return;
  const cxMin = Math.floor((center.x - r) / 16);
  const cxMax = Math.floor((center.x + r) / 16);
  const czMin = Math.floor((center.z - r) / 16);
  const czMax = Math.floor((center.z + r) / 16);
  let n = 0;
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cz = czMin; cz <= czMax; cz++) {
      const rec = store.get(dim.id, cx, cz);
      if (!rec || rec.entries.size === 0) continue;
      const candidates = [];
      for (const idx of rec.entries.keys()) {
        const p = store.fromLocalIndex(idx, cx, cz, info.minY);
        if (Math.abs(p.x - center.x) <= r && Math.abs(p.y - center.y) <= r && Math.abs(p.z - center.z) <= r)
          candidates.push(p);
      }
      for (const p of candidates) {
        if (!isEnclosed(dim, p.x, p.y, p.z)) reveal(dim, p.x, p.y, p.z);
        if (++n % 16 === 0) yield;
      }
    }
  }
}

// يرجّع كل الخامات بتشنك واحد ويمسح سجله.
export function restoreChunk(dim, cx, cz) {
  const info = DIMENSIONS[dim.id];
  const rec = store.get(dim.id, cx, cz);
  if (!rec) return 0;
  let n = 0;
  for (const [idx, ore] of rec.entries) {
    const p = store.fromLocalIndex(idx, cx, cz, info.minY);
    const b = safeBlock(dim, p);
    if (!b) return -1;
    if (HOST_SET.has(b.typeId)) {
      b.setType(ORES[ore]);
      n++;
    }
  }
  store.remove(rec);
  return n;
}

export { WAIT };
