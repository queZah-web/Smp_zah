// DUEL LOG - one record per 1 vs 1 duel FIGHT (only people inside a duel are logged; normal PvP is not).  Read by Operator > 1 vs 1 Duel > Duel log (permission "duelset").
// A record (short keys, to stay small):
//   t   time (ms) the fight ended          r   "win" | "draw"          w   winner id (or null)          p   [{ i: id, n: name }]  all fighters
//   k   kill feed: [{ k: killer name | null, v: victim name, c: cause }]
//   l   losers: [{ i, n, how: "killed" | "left" , by: killer name | null, inv: [[slot, item, amount], ...] }]    inv = his WHOLE inventory when he died (slots 0-35, 36-39 armor, 40 off hand)
//   pk  what the winner picked up from the losers: [[item, count], ...]     wi  the winner's whole inventory when his loot time was over (just before he is sent back)   (both filled in then: u = 1)
// Every record is its own world property ("dl:<n>"), the index "dl:idx" lists the numbers, oldest ones are deleted after MAX_RECORDS.
import { world } from "@minecraft/server";

export const MAX_RECORDS = 100;
const IDX = "dl:idx", PFX = "dl:";
const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
const readIdx = () => { const a = safe(() => JSON.parse(world.getDynamicProperty(IDX) ?? "[]"), []); return Array.isArray(a) ? a.filter((n) => Number.isInteger(n)) : []; };

/** saves a record, returns its number (or null) */
export function addDuelRecord(rec) {
  try {
    const idx = readIdx(), n = (idx.length ? Math.max(...idx) : 0) + 1;
    const s = JSON.stringify(rec);
    world.setDynamicProperty(PFX + n, s);
    idx.push(n);
    while (idx.length > MAX_RECORDS) { const old = idx.shift(); safe(() => world.setDynamicProperty(PFX + old, undefined)); }
    world.setDynamicProperty(IDX, JSON.stringify(idx));
    return n;
  } catch (e) { console.warn("[duellog] save failed: " + e); return null; }
}
/** adds fields to a saved record (e.g. what the winner picked up) */
export function updateDuelRecord(n, patch) {
  try {
    if (n === null || n === undefined) return;
    const raw = world.getDynamicProperty(PFX + n);
    if (typeof raw !== "string") return;
    world.setDynamicProperty(PFX + n, JSON.stringify({ ...JSON.parse(raw), ...patch }));
  } catch (e) { console.warn("[duellog] update failed: " + e); }
}
/** newest first: [{ n, ...record }] */
export function duelRecords() {
  const out = [];
  for (const n of readIdx().reverse()) {
    const r = safe(() => JSON.parse(world.getDynamicProperty(PFX + n)), null);
    if (r && typeof r === "object") out.push({ n, ...r });
  }
  return out;
}
export const duelRecordCount = () => readIdx().length;
/** deletes ONE fight (Owner only: the menu checks it).  Returns true when it was there. */
export function deleteDuelRecord(n) {
  try {
    if (!Number.isInteger(n)) return false;
    const idx = readIdx(); if (!idx.includes(n)) return false;
    world.setDynamicProperty(IDX, JSON.stringify(idx.filter((x) => x !== n)));
    safe(() => world.setDynamicProperty(PFX + n, undefined));
    return true;
  } catch (e) { console.warn("[duellog] delete failed: " + e); return false; }
}
/** deletes the whole log */
export function clearDuelRecords() {
  for (const n of readIdx()) safe(() => world.setDynamicProperty(PFX + n, undefined));
  safe(() => world.setDynamicProperty(IDX, undefined));
}
/** [ItemStack, ...] -> [[item, count], ...] biggest first ("minecraft:" removed) */
export function tally(items) {
  const m = new Map();
  for (const it of items ?? []) { try { const k = String(it.typeId).replace("minecraft:", ""); m.set(k, (m.get(k) ?? 0) + (it.amount ?? 1)); } catch (e) { /* ignore */ } }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
