// Shop extras:
//   PER PLAYER  - Favorites (stars) and Recent (items you looked at)      -> saved inside the player's own data (stats(p).fav / .rec)
//   FOR EVERYONE - Most purchased and Best seller (units, all players)    -> saved in the world data  "shop:stats"
// Every shop transaction already goes through data.js addTx -> we count it from the onTx hook, so nothing else had to change.
import { world, system } from "@minecraft/server";
import { stats, onTx } from "./data.js";
import { CATEGORIES } from "./shop_data.js";

export const MIN_COUNT = 1;       // an item needs at least this many units bought / sold to get a badge or to appear in the top lists
export const TOP_PER_CATEGORY = 3;   // how many "Most purchased" and how many "Best seller" items are pushed to the start of a category
export const MAX_FAV = 72, MAX_RECENT = 36;
const KEY = "shop:stats", KEEP = 400;

const VALID = new Set();
for (const c of CATEGORIES) for (const it of c.items) VALID.add(it[0]);

// ---------------------------------------------------------------- shop-wide counters
let S = null, ver = 1, dirty = false;
function load() {
  if (S) return S;
  S = { b: {}, s: {} };
  try { const r = world.getDynamicProperty(KEY); if (typeof r === "string") { const o = JSON.parse(r); S.b = o.b ?? {}; S.s = o.s ?? {}; } } catch (e) { /* ignore */ }
  return S;
}
function prune(m) {
  const k = Object.keys(m);
  if (k.length <= KEEP) return;
  k.sort((a, b) => m[b] - m[a]);
  for (const id of k.slice(KEEP)) delete m[id];
}
function save() {
  if (!dirty || !S) return;
  dirty = false;
  prune(S.b); prune(S.s);
  try { world.setDynamicProperty(KEY, JSON.stringify(S)); } catch (e) { console.warn("[shop] cannot save stats: " + e); dirty = true; }
}
system.runInterval(save, 200);     // every 10 s, only when something changed
try { world.beforeEvents.playerLeave.subscribe(() => { try { save(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }

onTx((p, rec) => {
  try {
    if (!rec || rec.cur || !VALID.has(rec.id) || String(rec.name ?? "").includes("(spawner)")) return;     // shards purchases, spawners, books, potions: not counted
    const q = Math.floor(Number(rec.qty));
    if (!(q > 0)) return;
    const m = rec.type === "buy" ? load().b : rec.type === "sell" ? load().s : null;
    if (!m) return;
    m[rec.id] = (m[rec.id] ?? 0) + q;
    dirty = true; ver++;
  } catch (e) { /* a counter must never break a purchase */ }
});

// ---------------------------------------------------------------- enchantments: units bought per "enchantment id : level"
// Counts every enchanted book AND every enchantment that comes on gear bought in the shop (enchantshop.js). Saved apart from the item counters above
// (world data "shop:ench"), so the normal Most purchased / Best seller lists are not touched at all.
const EKEY = "shop:ench";
let E = null, eVer = 1, eDirty = false;
function eLoad() {
  if (E) return E;
  E = {};
  try {
    const r = world.getDynamicProperty(EKEY);
    if (typeof r === "string") { const o = JSON.parse(r); if (o && typeof o === "object") for (const k of Object.keys(o)) { const n = Math.floor(Number(o[k])); if (n > 0) E[k] = n; } }
  } catch (e) { /* ignore */ }
  return E;
}
function eSave() {
  if (!eDirty || !E) return;
  eDirty = false;
  try { world.setDynamicProperty(EKEY, JSON.stringify(E)); } catch (e) { console.warn("[shop] cannot save enchant stats: " + e); eDirty = true; }
}
system.runInterval(eSave, 200);
try { world.beforeEvents.playerLeave.subscribe(() => { try { eSave(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }

/** list = [[enchantment id, level], ...] - one purchase of each of them */
export function countEnchants(list) {
  try {
    const m = eLoad();
    for (const [id, lv] of list) {
      const l = Math.floor(Number(lv));
      if (!id || !(l > 0)) continue;
      const k = id + ":" + l;
      m[k] = (m[k] ?? 0) + 1; eDirty = true; eVer++;
    }
  } catch (e) { /* a counter must never break a purchase */ }
}
const eCache = { ver: -1, lv: null, tot: null };
function eRanks() {
  if (eCache.ver === eVer && eCache.lv) return eCache;
  const m = eLoad(), tot = {};
  for (const k of Object.keys(m)) { const id = k.slice(0, k.lastIndexOf(":")); tot[id] = (tot[id] ?? 0) + m[k]; }
  const top = (obj) => {
    const out = new Map();
    Object.keys(obj).filter((k) => obj[k] >= MIN_COUNT).sort((a, b) => obj[b] - obj[a] || (a < b ? -1 : 1)).slice(0, TOP_PER_CATEGORY).forEach((k, i) => out.set(k, { rank: i + 1, n: obj[k] }));
    return out;
  };
  eCache.ver = eVer; eCache.lv = top(m); eCache.tot = top(tot);
  return eCache;
}
/** { rank, n } when this enchantment at this level is one of the most bought (top 3), else null */
export const enchantLevelTag = (id, lv) => eRanks().lv.get(id + ":" + lv) ?? null;
/** { rank, n } when this enchantment (all levels together) is one of the most bought (top 3), else null */
export const enchantTag = (id) => eRanks().tot.get(id) ?? null;

/** units bought ("b") or sold ("s") by everybody */
export const total = (kind, id) => load()[kind][id] ?? 0;

const sortedCache = { b: null, s: null };
/** [[id, units], ...] biggest first (only items with at least MIN_COUNT) */
export function ranking(kind) {
  const c = sortedCache[kind];
  if (c && c.ver === ver) return c.list;
  const m = load()[kind];
  const list = Object.keys(m).filter((id) => m[id] >= MIN_COUNT && VALID.has(id)).sort((a, b) => m[b] - m[a] || (a < b ? -1 : 1)).map((id) => [id, m[id]]);
  sortedCache[kind] = { ver, list };
  return list;
}

const topCache = new Map();
/** the best items INSIDE one category:  { b: Map(id -> { rank, n }), s: Map(id -> { rank, n }) } */
export function categoryTops(key, items) {
  const hit = topCache.get(key);
  if (hit && hit.ver === ver) return hit.v;
  const S2 = load(), v = { b: new Map(), s: new Map() };
  for (const kind of ["b", "s"]) {
    const m = S2[kind];
    const best = items.filter((it) => (m[it[0]] ?? 0) >= MIN_COUNT).sort((x, y) => m[y[0]] - m[x[0]]);
    const seen = new Set();
    for (const it of best) { if (seen.has(it[0])) continue; seen.add(it[0]); if (v[kind].size >= TOP_PER_CATEGORY) break; v[kind].set(it[0], { rank: v[kind].size + 1, n: m[it[0]] }); }
  }
  topCache.set(key, { ver, v });
  return v;
}
/** the category's items with the best sellers / most purchased ones moved to the start (the rest keeps its normal order) */
export function orderedItems(key, items) {
  const t = categoryTops(key, items);
  if (!t.b.size && !t.s.size) return items;
  const score = (id) => Math.min(t.b.get(id)?.rank ?? 99, t.s.get(id)?.rank ?? 99) * 10 - (t.b.has(id) && t.s.has(id) ? 5 : 0);
  const picks = [], seen = new Set();
  for (const it of items) { if ((t.b.has(it[0]) || t.s.has(it[0])) && !seen.has(it[0])) { seen.add(it[0]); picks.push(it); } }
  picks.sort((x, y) => score(x[0]) - score(y[0]));
  return [...picks, ...items.filter((it) => !seen.has(it[0]))];
}

// ---------------------------------------------------------------- per player: favorites + recent
const favs = (p) => (stats(p).fav ??= []);
const recs = (p) => (stats(p).rec ??= []);
export const favList = (p) => favs(p);
export const isFav = (p, id) => favs(p).includes(id);
/** true = added, false = removed, null = list is full */
export function toggleFav(p, id) {
  const a = favs(p), i = a.indexOf(id);
  if (i >= 0) { a.splice(i, 1); return false; }
  if (a.length >= MAX_FAV) return null;
  a.unshift(id);
  return true;
}
export const recentList = (p) => recs(p);
export function pushRecent(p, id) {
  const a = recs(p), i = a.indexOf(id);
  if (i === 0) return;
  if (i > 0) a.splice(i, 1);
  a.unshift(id);
  if (a.length > MAX_RECENT) a.length = MAX_RECENT;
}
export const clearRecent = (p) => { recs(p).length = 0; };
