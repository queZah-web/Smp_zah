// Heart purchase log (admin only data, shown in /shop > Hearts > Logs).
//
// One record per buyer, saved in a world property "smp_hb:<player id>" (works for offline players too):
//   { v, nm: last known name, c: hearts bought (all time), s: money spent (all time), l: [[time, price, number], ...] newest first (last 150), bf: 1 = history rebuilt from old transactions }
// "number" = the 1st, 2nd, 3rd ... heart that this player bought.
//
// The first time the pack runs with this file, the purchases that are still in the players' own transaction
// history (the shop keeps the last 120 transactions per player) are copied into the log, once.
import { world, system } from "@minecraft/server";
import { knownPlayers, recordOf } from "./data.js";
import { HEART_ITEM } from "./heartids.js";

const PFX = "smp_hb:", BF_KEY = "smp_hb_bf", KEEP = 150;
const cache = new Map();

function read(id) {
  let r = cache.get(id);
  if (r) return r;
  try { const raw = world.getDynamicProperty(PFX + id); if (typeof raw === "string") r = JSON.parse(raw); } catch (e) { r = null; }
  if (!r || typeof r !== "object") return null;
  r.l = Array.isArray(r.l) ? r.l : []; r.c = Number(r.c) || 0; r.s = Number(r.s) || 0;
  cache.set(id, r);
  return r;
}
function save(id, r) {
  cache.set(id, r);
  try { world.setDynamicProperty(PFX + id, JSON.stringify(r)); } catch (e) { console.warn("[heartlog] cannot save " + id + ": " + e); }
}

// ---------------------------------------------------------------- history that already exists (runs once)
let bfDone = false;
export function ensureBackfill() {
  if (bfDone) return;
  try { if (world.getDynamicProperty(BF_KEY)) { bfDone = true; return; } } catch (e) { return; }
  try {
    for (const k of knownPlayers()) {
      if (read(k.id)) continue;
      const tx = recordOf(k.id)?.tx;
      if (!Array.isArray(tx)) continue;
      const buys = tx.filter((x) => x && x.type === "buy" && x.id === HEART_ITEM && Number(x.t) > 0 && Number(x.total) > 0).sort((a, b) => a.t - b.t);
      if (!buys.length) continue;
      const r = { v: 1, nm: k.name ?? "?", c: buys.length, s: 0, l: [], bf: 1 };
      buys.forEach((x, i) => { r.s += Math.floor(x.total); r.l.unshift([x.t, Math.floor(x.total), i + 1]); });
      r.l.length = Math.min(r.l.length, KEEP);
      save(k.id, r);
    }
    world.setDynamicProperty(BF_KEY, 1); bfDone = true;
  } catch (e) { console.warn("[heartlog] backfill: " + e); }
}
try { system.runTimeout(() => ensureBackfill(), 100); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- writing (call it BEFORE the shop writes the transaction)
export function logHeartBuy(id, name, price) {
  ensureBackfill();
  const r = read(id) ?? { v: 1, nm: name ?? "?", c: 0, s: 0, l: [] };
  r.nm = name ?? r.nm; r.c += 1; r.s += Math.floor(price);
  r.l.unshift([Date.now(), Math.floor(price), r.c]);
  if (r.l.length > KEEP) r.l.length = KEEP;
  save(id, r);
}

// ---------------------------------------------------------------- reading
/** every buyer: [{ id, name, count, spent, last, bf }] - the latest buyer first */
export function buyersList() {
  ensureBackfill();
  const out = [];
  try {
    for (const key of world.getDynamicPropertyIds()) {
      if (!key.startsWith(PFX)) continue;
      const id = key.slice(PFX.length), r = read(id); if (!r || r.c < 1) continue;
      out.push({ id, name: r.nm ?? "?", count: r.c, spent: r.s, last: r.l[0]?.[0] ?? 0, bf: !!r.bf });
    }
  } catch (e) { console.warn("[heartlog] list: " + e); }
  return out.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}
/** the purchases of one buyer: [{ t, price, n }] newest first, plus the totals */
export function buyerInfo(id) {
  const r = read(id); if (!r) return null;
  return { id, name: r.nm ?? "?", count: r.c, spent: r.s, bf: !!r.bf, list: r.l.map((x) => ({ t: x[0], price: x[1], n: x[2] })) };
}
/** every purchase of every buyer, newest first: [{ id, name, t, price, n }] */
export function allPurchases() {
  const out = [];
  for (const b of buyersList()) { const info = buyerInfo(b.id); if (info) for (const x of info.list) out.push({ id: b.id, name: info.name, ...x }); }
  return out.sort((a, b) => b.t - a.t);
}
export function logTotals() {
  let buyers = 0, hearts = 0, spent = 0;
  for (const b of buyersList()) { buyers++; hearts += b.count; spent += b.spent; }
  return { buyers, hearts, spent };
}
/** "2026-10-22 14:05 UTC" */
export function stamp(t) {
  try { return new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC"; } catch (e) { return "?"; }
}
