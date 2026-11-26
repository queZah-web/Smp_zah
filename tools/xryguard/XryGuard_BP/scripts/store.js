// ============================================================
//  XryGuard - تخزين أماكن الخامات المخفية (داخل العالم نفسه)
// ============================================================
import { world } from "@minecraft/server";
import { DIMENSIONS, DIM_BY_SHORT, DEFAULT_SETTINGS } from "./config.js";

const PREFIX = "xry:c:";
const SETTINGS_KEY = "xry:cfg";
const MAX_PART = 30000;
const MAX_CACHE = 3000;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

// مكان البلوك داخل التشنك كرقم واحد: x(4 بت) z(4 بت) y(9 بت)
export function localIndex(x, y, z, minY) {
  return (x & 15) | ((z & 15) << 4) | ((y - minY) << 8);
}

export function fromLocalIndex(idx, cx, cz, minY) {
  return {
    x: cx * 16 + (idx & 15),
    z: cz * 16 + ((idx >> 4) & 15),
    y: (idx >> 8) + minY,
  };
}

export function chunkKey(dimId, cx, cz) {
  return `${PREFIX}${DIMENSIONS[dimId].short}:${cx}:${cz}`;
}

export function parseKey(key) {
  const [s, cx, cz] = key.slice(PREFIX.length).split(":");
  return { dimId: DIM_BY_SHORT[s], cx: Number(cx), cz: Number(cz) };
}

function encode(entries) {
  let out = "";
  for (const [idx, ore] of entries) {
    const v = idx | (ore << 17); // 24 بت = 4 حروف
    out += B64[v & 63] + B64[(v >> 6) & 63] + B64[(v >> 12) & 63] + B64[(v >> 18) & 63];
  }
  return out;
}

function decode(str) {
  const entries = new Map();
  for (let i = 0; i + 3 < str.length; i += 4) {
    const v =
      B64_INDEX.get(str[i]) |
      (B64_INDEX.get(str[i + 1]) << 6) |
      (B64_INDEX.get(str[i + 2]) << 12) |
      (B64_INDEX.get(str[i + 3]) << 18);
    entries.set(v & 0x1ffff, v >> 17);
  }
  return entries;
}

class ChunkRecord {
  constructor(key, dimId, cx, cz) {
    this.key = key;
    this.dimId = dimId;
    this.cx = cx;
    this.cz = cz;
    this.done = false; // انفحص التشنك بالكامل؟
    this.entries = new Map(); // localIndex -> رقم الخامة
    this.parts = 1;
  }
}

const known = new Set(); // كل التشنكات اللي إلها سجل
const cache = new Map(); // key -> ChunkRecord
const dirty = new Set();
let settings = { ...DEFAULT_SETTINGS };

export function init() {
  known.clear();
  cache.clear();
  dirty.clear();
  for (const id of world.getDynamicPropertyIds()) {
    if (id.startsWith(PREFIX) && !id.includes("#")) known.add(id);
  }
  try {
    const raw = world.getDynamicProperty(SETTINGS_KEY);
    if (typeof raw === "string") settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(settings));
}

function load(key) {
  const raw = world.getDynamicProperty(key);
  if (typeof raw !== "string") return undefined;
  const { dimId, cx, cz } = parseKey(key);
  const rec = new ChunkRecord(key, dimId, cx, cz);
  const bar = raw.indexOf("|");
  const header = raw.slice(0, bar);
  rec.done = header[0] === "D";
  rec.parts = header.length > 1 ? Number(header.slice(1)) : 1;
  let data = raw.slice(bar + 1);
  for (let i = 1; i < rec.parts; i++) {
    const p = world.getDynamicProperty(`${key}#${i}`);
    if (typeof p === "string") data += p;
  }
  rec.entries = decode(data);
  return rec;
}

function touch(key, rec) {
  cache.delete(key);
  cache.set(key, rec);
  if (cache.size > MAX_CACHE) {
    for (const [k] of cache) {
      if (cache.size <= MAX_CACHE) break;
      if (!dirty.has(k)) cache.delete(k);
    }
  }
}

export function get(dimId, cx, cz) {
  const key = chunkKey(dimId, cx, cz);
  let rec = cache.get(key);
  if (rec) {
    touch(key, rec);
    return rec;
  }
  if (!known.has(key)) return undefined;
  rec = load(key);
  if (!rec) {
    known.delete(key);
    return undefined;
  }
  touch(key, rec);
  return rec;
}

export function getOrCreate(dimId, cx, cz) {
  const existing = get(dimId, cx, cz);
  if (existing) return existing;
  const key = chunkKey(dimId, cx, cz);
  const rec = new ChunkRecord(key, dimId, cx, cz);
  known.add(key);
  touch(key, rec);
  return rec;
}

export function isDone(dimId, cx, cz) {
  const key = chunkKey(dimId, cx, cz);
  if (!known.has(key)) return false;
  const rec = get(dimId, cx, cz);
  return !!rec && rec.done;
}

export function markDirty(rec) {
  dirty.add(rec.key);
}

export function remove(rec) {
  for (let i = 1; i < rec.parts; i++) world.setDynamicProperty(`${rec.key}#${i}`, undefined);
  world.setDynamicProperty(rec.key, undefined);
  known.delete(rec.key);
  cache.delete(rec.key);
  dirty.delete(rec.key);
}

function save(rec) {
  const data = encode(rec.entries);
  const chunks = [];
  for (let i = 0; i < data.length; i += MAX_PART) chunks.push(data.slice(i, i + MAX_PART));
  if (chunks.length === 0) chunks.push("");
  const flag = rec.done ? "D" : "P";
  const header = chunks.length > 1 ? `${flag}${chunks.length}` : flag;
  world.setDynamicProperty(rec.key, `${header}|${chunks[0]}`);
  for (let i = 1; i < chunks.length; i++) world.setDynamicProperty(`${rec.key}#${i}`, chunks[i]);
  for (let i = chunks.length; i < rec.parts; i++) world.setDynamicProperty(`${rec.key}#${i}`, undefined);
  rec.parts = chunks.length;
}

export function flush() {
  for (const key of dirty) {
    const rec = cache.get(key);
    if (rec) {
      try {
        save(rec);
      } catch (e) {
        console.warn(`[XryGuard] save failed ${key}: ${e}`);
      }
    }
  }
  dirty.clear();
}

export function knownKeys(dimId) {
  const prefix = `${PREFIX}${DIMENSIONS[dimId].short}:`;
  return [...known].filter((k) => k.startsWith(prefix));
}

export function stats() {
  let hidden = 0;
  for (const rec of cache.values()) hidden += rec.entries.size;
  return { chunks: known.size, cached: cache.size, hiddenInCache: hidden };
}
