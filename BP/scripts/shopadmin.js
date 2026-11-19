// Admin price / time editing for the Shards Shop (spawners, spawn eggs, shard items, purchase cooldowns).
// Same idea as the mining prices (systems/mining.js): everything is saved in ONE world property "shopadmin" and only what differs from
// the normal values (spawner_data.js, mobs.js, shards.js, limits.js) is stored.  Nothing saved = normal values.  Same value for every player.
//   sp  = { mobId: money }          spawner money price
//   spS = { mobId: shards }         spawner shards price (only when set by hand; otherwise it follows the money price)
//   eg  = { mobId: { m, s } }       spawn egg money / shards
//   si  = { itemId: shards }        "Items for shards"
//   lim = { key: hours }            window of the purchase limit (spawner, spawn_egg + ANY shop entry key; 0 = the limit was removed)
//   cnt = { key: units }            units each player may buy per window (missing = 1)
//   cl  = { catId: { h, c } }       limit for a whole category (every entry without its own limit): c units every h hours
//   it  = { itemId: { b, s } }      money shop: buy price / sell price of an item (every category)
//   bk  = { enchantId: price }      enchanted books: price of level I (level n = price * 2^(n-1))
//   pt  = { potionKey: { b, s } }   potions: buy / sell price of one exact potion
// The saved text can be longer than one world property allows, so it is split over several properties (shopadmin, shopadmin:1, ...).
import { world } from "@minecraft/server";
import { LIMITS, COUNTS, CAT_LIM, KEY_CAT, MAX_COUNT } from "./limits.js";
import { ENCHANTS, BOOKS_CATEGORY } from "./books.js";
import { ALL_POTIONS, POTION_OVERRIDE, POTIONS_CATEGORY, basePotionPrice } from "./potions.js";
import { EGGS } from "./mobs.js";
import { SHARD_ITEMS } from "./shards.js";
import { PRICES } from "./spawner_data.js";
import { CATEGORIES } from "./shop_data.js";

const KEY = "shopadmin", CHUNK = 30000;
export const MAX_MONEY = 100000000, MAX_SHARDS = 10000000, MAX_HOURS = 720;
export const SP_SHARDS = {};            // spawner shard prices set by hand (id -> shards)

const BASE = { sp: { ...PRICES }, eg: {}, si: {}, lim: { ...LIMITS }, bk: {} };
for (const e of ENCHANTS) BASE.bk[e.id] = e.base;
export const EXTRA_KEYS = new Set();          // limit keys that are not shop item ids: books and potions
for (const e of ENCHANTS) EXTRA_KEYS.add(bookKey(e.id));
for (const x of ALL_POTIONS) EXTRA_KEYS.add(x.key);
export const POTIONS = new Map(ALL_POTIONS.map((x) => [x.key, x]));
export const CAT_IDS = new Set([...CATEGORIES.map((c) => c.id), BOOKS_CATEGORY.id, POTIONS_CATEGORY.id]);
for (const c of CATEGORIES) for (const it of c.items) if (!KEY_CAT.has(it[0])) KEY_CAT.set(it[0], c.id);       // which category a key belongs to (category limit)
for (const e of ENCHANTS) KEY_CAT.set(bookKey(e.id), BOOKS_CATEGORY.id);
for (const x of ALL_POTIONS) KEY_CAT.set(x.key, POTIONS_CATEGORY.id);
export const ITEMS = new Map();              // item id -> every catalogue entry with that id (an id can be in two categories)
const BASE_IT = new Map();                   // entry -> { b, s } normal prices
for (const c of CATEGORIES) for (const it of c.items) { if (!ITEMS.has(it[0])) ITEMS.set(it[0], []); ITEMS.get(it[0]).push(it); BASE_IT.set(it, { b: it[3], s: it[4] }); }
export const baseItemPrice = (it) => BASE_IT.get(it);
export const canRemoveLimit = (key) => key !== "spawner" && key !== "spawn_egg" && key !== "spawn_egg_villager";     // the spawner / egg shops always need their time
export const baseBook = (id) => BASE.bk[id];
export const basePotion = (x) => basePotionPrice(x.eff, x.form, x.v);
for (const e of EGGS) BASE.eg[e.id] = { m: e.money, s: e.shards };
for (const it of SHARD_ITEMS) BASE.si[it[0]] = it[2];

export const LIMIT_KEYS = Object.keys(BASE.lim);
export const LIMIT_NAMES = { spawner: "Spawners", spawn_egg: "Spawn eggs", spawn_egg_villager: "Villager spawn egg", elytra: "Elytra", nether_star: "Nether Star", beacon: "Beacon", dragon_egg: "Dragon Egg" };
export const baseSpawner = (id) => BASE.sp[id];
export const baseEgg = (id) => BASE.eg[id];
export const baseItem = (id) => BASE.si[id];
export const baseLimit = (key) => BASE.lim[key];

export function bookKey(id) { return "book:" + id; }
const whole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

function diff() {
  const o = { sp: {}, spS: {}, eg: {}, si: {}, lim: {}, cnt: {}, cl: {}, it: {}, bk: {}, pt: {} };
  for (const id of Object.keys(BASE.sp)) if (PRICES[id] !== BASE.sp[id]) o.sp[id] = PRICES[id];
  for (const id of Object.keys(SP_SHARDS)) o.spS[id] = SP_SHARDS[id];
  for (const e of EGGS) { const b = BASE.eg[e.id]; if (e.money !== b.m || e.shards !== b.s) o.eg[e.id] = { m: e.money, s: e.shards }; }
  for (const it of SHARD_ITEMS) if (it[2] !== BASE.si[it[0]]) o.si[it[0]] = it[2];
  for (const k of new Set([...Object.keys(BASE.lim), ...Object.keys(LIMITS)])) if (LIMITS[k] !== BASE.lim[k]) o.lim[k] = LIMITS[k] === undefined ? 0 : LIMITS[k];
  for (const k of Object.keys(COUNTS)) if (COUNTS[k] !== 1) o.cnt[k] = COUNTS[k];
  for (const c of Object.keys(CAT_LIM)) o.cl[c] = { h: CAT_LIM[c].h, c: CAT_LIM[c].c };
  for (const [id, arr] of ITEMS) { const it = arr[0], b = BASE_IT.get(it); if (it[3] !== b.b || it[4] !== b.s) o.it[id] = { b: it[3], s: it[4] }; }
  for (const e of ENCHANTS) if (e.base !== BASE.bk[e.id]) o.bk[e.id] = e.base;
  for (const [k, v] of POTION_OVERRIDE) o.pt[k] = { b: v.buy, s: v.sell };
  return o;
}
function apply(o) {                       // normal values first, then the saved differences (checked)
  for (const id of Object.keys(BASE.sp)) PRICES[id] = BASE.sp[id];
  for (const id of Object.keys(SP_SHARDS)) delete SP_SHARDS[id];
  for (const e of EGGS) { e.money = BASE.eg[e.id].m; e.shards = BASE.eg[e.id].s; }
  for (const it of SHARD_ITEMS) it[2] = BASE.si[it[0]];
  for (const k of Object.keys(LIMITS)) delete LIMITS[k];
  for (const k of Object.keys(BASE.lim)) LIMITS[k] = BASE.lim[k];
  for (const k of Object.keys(COUNTS)) delete COUNTS[k];
  for (const c of Object.keys(CAT_LIM)) delete CAT_LIM[c];
  for (const it of BASE_IT.keys()) { it[3] = BASE_IT.get(it).b; it[4] = BASE_IT.get(it).s; }
  for (const e of ENCHANTS) e.base = BASE.bk[e.id];
  POTION_OVERRIDE.clear();
  if (!o) return;
  for (const id of Object.keys(o.sp ?? {})) if (id in BASE.sp && whole(o.sp[id], 1, MAX_MONEY)) PRICES[id] = o.sp[id];
  for (const id of Object.keys(o.spS ?? {})) if (id in BASE.sp && whole(o.spS[id], 1, MAX_SHARDS)) SP_SHARDS[id] = o.spS[id];
  for (const e of EGGS) { const v = o.eg?.[e.id]; if (v && whole(v.m, 1, MAX_MONEY) && whole(v.s, 1, MAX_SHARDS)) { e.money = v.m; e.shards = v.s; } }
  for (const it of SHARD_ITEMS) { const v = o.si?.[it[0]]; if (whole(v, 1, MAX_SHARDS)) it[2] = v; }
  for (const k of Object.keys(o.lim ?? {})) {
    const v = o.lim[k];
    if (!validKey(k)) continue;
    if (v === 0) { if (canRemoveLimit(k)) LIMITS[k] = 0; } else if (whole(v, 1, MAX_HOURS)) LIMITS[k] = v;
  }
  for (const k of Object.keys(o.cnt ?? {})) if (validKey(k) && whole(o.cnt[k], 1, MAX_COUNT)) COUNTS[k] = o.cnt[k];
  for (const c of Object.keys(o.cl ?? {})) { const v = o.cl[c]; if (CAT_IDS.has(c) && v && whole(v.h, 1, MAX_HOURS) && whole(v.c, 1, MAX_COUNT)) CAT_LIM[c] = { h: v.h, c: v.c }; }
  for (const id of Object.keys(o.it ?? {})) {
    const v = o.it[id], arr = ITEMS.get(id);
    if (arr && v && whole(v.b, 1, MAX_MONEY) && whole(v.s, 0, v.b)) for (const it of arr) { it[3] = v.b; it[4] = v.s; }
  }
  for (const e of ENCHANTS) { const v = o.bk?.[e.id]; if (whole(v, 1, MAX_MONEY)) e.base = v; }
  for (const k of Object.keys(o.pt ?? {})) { const v = o.pt[k]; if (POTIONS.has(k) && v && whole(v.b, 1, MAX_MONEY) && whole(v.s, 0, v.b)) POTION_OVERRIDE.set(k, { buy: v.b, sell: v.s }); }
  syncBooks();
}
const validKey = (k) => k in BASE.lim || ITEMS.has(k) || EXTRA_KEYS.has(k);
const syncBooks = () => { for (const row of BOOKS_CATEGORY.items) { const e = ENCHANTS.find((x) => x.id === row[0]); if (e) row[3] = e.base; } };    // the "price" column of the book rows follows the admin price
const empty = (o) => !Object.values(o).some((x) => Object.keys(x).length);

// ---------------------------------------------------------------- saving: one JSON text split over several world properties
function readAll() {
  const first = world.getDynamicProperty(KEY);
  if (typeof first !== "string") return null;
  let raw = first;
  for (let i = 1; i < 50; i++) { const part = world.getDynamicProperty(KEY + ":" + i); if (typeof part !== "string") break; raw += part; }
  return raw;
}
function writeAll(text) {                      // text = undefined -> everything removed
  const parts = [];
  if (text !== undefined) for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  if (parts.length > 40) throw new Error("too much data");
  parts.forEach((x, i) => world.setDynamicProperty(i === 0 ? KEY : KEY + ":" + i, x));
  for (let i = Math.max(1, parts.length); i < 50; i++) { if (typeof world.getDynamicProperty(KEY + ":" + i) !== "string") break; world.setDynamicProperty(KEY + ":" + i, undefined); }
  if (parts.length === 0) world.setDynamicProperty(KEY, undefined);
}

let loaded = false;
/** lazy: world data can not be read while the script is starting */
export function adminLoad() {
  if (loaded) return;
  try {
    const raw = readAll();
    loaded = true;
    if (typeof raw === "string") apply(JSON.parse(raw));
  } catch (e) { /* unreadable: normal values */ }
}

/** runs fn (which changes the live values) and saves.  Returns an error text, or null when saved. */
function edit(fn) {
  adminLoad();
  const prev = diff();
  try { fn(); } catch (e) { apply(prev); return "Could not change it."; }
  try {
    const now = diff();
    writeAll(empty(now) ? undefined : JSON.stringify(now));
  } catch (e) { apply(prev); return "Could not save it."; }
  return null;
}

export const spawnerMoneyOf = (id) => { adminLoad(); return PRICES[id]; };
/** m = money, s = shards (null / undefined = follow the money price) */
export function setSpawner(id, m, s) {
  if (!(id in BASE.sp)) return "Unknown spawner.";
  if (!whole(m, 1, MAX_MONEY)) return "Money must be a whole number from 1 to " + MAX_MONEY + ".";
  if (s != null && !whole(s, 1, MAX_SHARDS)) return "Shards must be a whole number from 1 to " + MAX_SHARDS + ".";
  return edit(() => { PRICES[id] = m; if (s == null) delete SP_SHARDS[id]; else SP_SHARDS[id] = s; });
}
export function setEgg(id, m, s) {
  const e = EGGS.find((x) => x.id === id); if (!e) return "Unknown egg.";
  if (!whole(m, 1, MAX_MONEY)) return "Money must be a whole number from 1 to " + MAX_MONEY + ".";
  if (!whole(s, 1, MAX_SHARDS)) return "Shards must be a whole number from 1 to " + MAX_SHARDS + ".";
  return edit(() => { e.money = m; e.shards = s; });
}
export function setItem(id, s) {
  const it = SHARD_ITEMS.find((x) => x[0] === id); if (!it) return "Unknown item.";
  if (!whole(s, 1, MAX_SHARDS)) return "Shards must be a whole number from 1 to " + MAX_SHARDS + ".";
  return edit(() => { it[2] = s; });
}
/** The purchase limit of ONE entry (item id, "book:<id>", "pot:...", "spawner", "spawn_egg"):
 *  every player can buy `count` units every `hours` hours.  hours = 1..720 (the form offers 1 / 6 / 12 / 24 / 48), count = 1..MAX_COUNT.
 *  hours === null removes the limit (only where canRemoveLimit allows it). */
export function setLimit(key, hours, count = 1) {
  if (!validKey(key)) return "Unknown limit.";
  if (hours === null) {
    if (!canRemoveLimit(key)) return "This limit can not be removed.";
    return edit(() => { if ((key in BASE.lim) || KEY_CAT.has(key) && CAT_LIM[KEY_CAT.get(key)]) LIMITS[key] = 0; else delete LIMITS[key]; delete COUNTS[key]; });
  }
  if (!whole(hours, 1, MAX_HOURS)) return "Hours must be a whole number from 1 to " + MAX_HOURS + ".";
  if (!whole(count, 1, MAX_COUNT)) return "Purchases per time must be a whole number from 1 to " + MAX_COUNT + ".";
  return edit(() => { LIMITS[key] = hours; if (count === 1) delete COUNTS[key]; else COUNTS[key] = count; });
}
/** same limit for a whole category (every entry that has no limit of its own).  hours === null removes it. */
export function setCategoryLimit(catId, hours, count = 1) {
  if (!CAT_IDS.has(catId)) return "Unknown category.";
  if (hours === null) return edit(() => { delete CAT_LIM[catId]; });
  if (!whole(hours, 1, MAX_HOURS)) return "Hours must be a whole number from 1 to " + MAX_HOURS + ".";
  if (!whole(count, 1, MAX_COUNT)) return "Purchases per time must be a whole number from 1 to " + MAX_COUNT + ".";
  return edit(() => { CAT_LIM[catId] = { h: hours, c: count }; });
}
/** money shop: buy price b (1..MAX_MONEY) and sell price s (0 = not sellable, never higher than b) for every entry with this id */
export function setItemPrice(id, b, s) {
  const arr = ITEMS.get(id); if (!arr) return "Unknown item.";
  if (!whole(b, 1, MAX_MONEY)) return "Buy price must be a whole number from 1 to " + MAX_MONEY + ".";
  if (!whole(s, 0, b)) return "Sell price must be a whole number from 0 to the buy price (0 = can not be sold).";
  return edit(() => { for (const it of arr) { it[3] = b; it[4] = s; } });
}
/** enchanted books: price of level I (level II costs double, III four times ...) */
export function setBookPrice(id, price) {
  const e = ENCHANTS.find((x) => x.id === id); if (!e) return "Unknown book.";
  if (!whole(price, 1, MAX_MONEY)) return "Price must be a whole number from 1 to " + MAX_MONEY + ".";
  return edit(() => { e.base = price; syncBooks(); });
}
/** one exact potion (key = potionKey): buy price b and sell price s (0 = can not be sold, never above b) */
export function setPotionPrice(key, b, s) {
  if (!POTIONS.has(key)) return "Unknown potion.";
  if (!whole(b, 1, MAX_MONEY)) return "Buy price must be a whole number from 1 to " + MAX_MONEY + ".";
  if (!whole(s, 0, b)) return "Sell price must be a whole number from 0 to the buy price (0 = can not be sold).";
  return edit(() => { POTION_OVERRIDE.set(key, { buy: b, sell: s }); });
}
/** back to the normal values: kind = "spawner" | "egg" | "item" | "limit" | "itemprice" | "book" | "potion" | "catlimit" + id */
export function resetOne(kind, id) {
  return edit(() => {
    if (kind === "spawner") { PRICES[id] = BASE.sp[id]; delete SP_SHARDS[id]; }
    else if (kind === "egg") { const e = EGGS.find((x) => x.id === id); if (e) { e.money = BASE.eg[id].m; e.shards = BASE.eg[id].s; } }
    else if (kind === "item") { const it = SHARD_ITEMS.find((x) => x[0] === id); if (it) it[2] = BASE.si[id]; }
    else if (kind === "limit") { if (id in BASE.lim) LIMITS[id] = BASE.lim[id]; else delete LIMITS[id]; delete COUNTS[id]; }
    else if (kind === "itemprice") { for (const it of ITEMS.get(id) ?? []) { it[3] = BASE_IT.get(it).b; it[4] = BASE_IT.get(it).s; } }
    else if (kind === "book") { const e = ENCHANTS.find((x) => x.id === id); if (e) { e.base = BASE.bk[id]; syncBooks(); } }
    else if (kind === "potion") POTION_OVERRIDE.delete(id);
    else if (kind === "catlimit") delete CAT_LIM[id];
  });
}
