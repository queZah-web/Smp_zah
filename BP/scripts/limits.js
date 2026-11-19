import { stats } from "./data.js";
import { countdown, num } from "./format.js";
// Purchase limits for EVERY shop entry (money shop categories, books, potions, shard shop ...).
//   A limit = "each player can buy COUNT units every HOURS hours".  COUNT = 1 .. MAX_COUNT (1 = once per window, 1000 = a thousand times ...).
//   The window starts at the player's first purchase and lasts HOURS hours; when it ends the player gets the whole COUNT again.
//   The admin changes the hours (1 / 6 / 12 / 24 / 48 h), the count and the prices in the shop itself (shopadmin.js saves it).
// key = item id ("diamond"), "book:<enchant>", "pot:<effect>:<form>:<level>", "spawner", "spawn_egg"  (shared by money shop and shard shop)
export const LIMITS = { elytra: 48, nether_star: 24, beacon: 24, dragon_egg: 72, spawner: 24, spawn_egg: 24, spawn_egg_villager: 12 };   // key -> hours of the window (0 = admin removed the limit)
export const COUNTS = { spawn_egg_villager: 10 };   // key -> units per window (missing = 1)
export const CAT_LIM = {};                 // category id -> { h, c }: default for every entry of that category that has no limit of its own
export const KEY_CAT = new Map();          // key -> category id (filled by shopadmin.js)
export const MAX_COUNT = 1000000;
export const WINDOW_CHOICES = [1, 6, 12, 24, 48];     // hours the admin can pick in the form

const own = (key) => Object.prototype.hasOwnProperty.call(LIMITS, key);
const cat = (key) => { const c = KEY_CAT.get(key); return c !== undefined ? CAT_LIM[c] : undefined; };
/** hours of the window for this key (0 = no limit) */
export const hoursOf = (key) => (own(key) ? LIMITS[key] || 0 : cat(key)?.h ?? 0);
/** units each player may buy per window (1 when there is no setting) */
export const countOf = (key) => (own(key) ? COUNTS[key] ?? 1 : cat(key)?.c ?? 1);
export const hasLimit = (key) => hoursOf(key) > 0;
/** where the limit of this key comes from: "own" | "category" | "none" */
export const limitSource = (key) => (own(key) ? (LIMITS[key] > 0 ? "own" : "none") : cat(key) ? "category" : "none");
export const hoursTxt = (h) => (!h ? "none" : h % 24 === 0 ? h / 24 + (h === 24 ? " day" : " days") + " (" + h + "h)" : h + "h");
/** "1 every 24h" | "1,000 every 6h" */
export const limitText = (key) => (hasLimit(key) ? num(countOf(key)) + " every " + hoursOf(key) + "h" : "no limit");

// ---- what a player already used inside the running window
function view(p, key) {
  const win = hoursOf(key) * 3600000, s = stats(p), now = Date.now();
  let e = s.lw?.[key];
  if (!e) { const t = s.lim?.[key]; e = t ? { t, n: 1 } : null; }       // old saves: only the time of the last purchase (= 1 unit)
  if (!e || win <= 0 || now - e.t >= win) return { n: 0, t: 0, win };
  return { n: e.n, t: e.t, win };
}
/** units the player can still buy right now (Infinity when there is no limit) */
export const unitsLeft = (p, key) => (hasLimit(key) ? Math.max(0, countOf(key) - view(p, key).n) : Infinity);
/** ms until the window ends (0 = the player has not used anything yet) */
export const resetIn = (p, key) => { const v = view(p, key); return v.n > 0 ? Math.max(0, v.t + v.win - Date.now()) : 0; };
/** ms until the player can buy again, 0 = can buy now  (same meaning as before) */
export const remaining = (p, key) => (hasLimit(key) && unitsLeft(p, key) <= 0 ? resetIn(p, key) : 0);
/** call after a successful purchase of qty units */
export function stamp(p, key, qty = 1) {
  if (!hasLimit(key)) return;
  const s = stats(p), v = view(p, key);
  s.lw ??= {};
  s.lw[key] = v.n > 0 ? { t: v.t, n: v.n + Math.max(1, Math.floor(qty)) } : { t: Date.now(), n: Math.max(1, Math.floor(qty)) };
  if (s.lim) delete s.lim[key];
  const now = Date.now();                                                 // forget finished windows so the player record stays small
  for (const k of Object.keys(s.lw)) { const w = hoursOf(k) * 3600000; if (w <= 0 || now - s.lw[k].t >= w) delete s.lw[k]; }
}
/** null = the player may buy qty units, otherwise the red message to show */
export function limitBlock(p, key, label, qty = 1) {
  if (!hasLimit(key)) return null;
  const left = unitsLeft(p, key);
  if (left <= 0) return `§c[Shop] ${label} is limited to ${limitText(key)}. Next purchase in §f${countdown(resetIn(p, key))}`;
  if (qty > left) return `§c[Shop] You can buy only §f${num(left)} §cmore ${label} now (limit: ${limitText(key)}). Window ends in §f${countdown(resetIn(p, key))}`;
  return null;
}
