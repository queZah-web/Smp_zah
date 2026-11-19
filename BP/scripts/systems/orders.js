// BUY ORDERS (/order) - the data and the rules. The pages are in smp/ordermenu.js.
//   * a player says "I want 64 diamonds, I pay $100 for each": the whole price is taken at once and kept safe (escrow)
//   * every other player can sell that item to the order from his inventory and gets the money at once
//   * the buyer collects the items he received in "My orders"; he can cancel an order and get the money of what is still missing back
//   * an order ends after DURATION_HOURS: the money of the missing items is paid back by itself, the items wait to be collected
// Only plain items (no name, lore, enchantments or damage) are traded here, so nothing can be lost or faked.
// Safe by design: the items leave the seller first, the order is saved, and only then the seller is paid. Nothing touches the shop or the stats.
import { econMsg } from "./staffcore.js";   // staff tools: frozen money account
import { world, system } from "@minecraft/server";
import { addMoney, takeMoney, addMoneyById, recordOf } from "../data.js";
import { countPlain, removePlain, give, container } from "../inv.js";
import { HEART_ITEM, buyerOf, tagBuyer, makeHeartStack } from "../heartids.js";
import { resolveItem, realId } from "../alias.js";
import { notify } from "../smp/notify.js";
import { money } from "../format.js";
import { logOrder } from "./oplog.js";   // Operator > Logs > Auction & Orders log

export const DURATION_HOURS = 48;
export const MAX_PER_PLAYER = 8;           // orders (active + waiting to be collected) per player
export const MAX_TOTAL = 2000;
export const MAX_QTY = 2304;               // 36 stacks of 64
export const MAX_COST = 1e10;              // the whole order
export const MAX_EACH = 1e8;
const CHECK_TICKS = 200, NOTICE_DELAY_TICKS = 100, MAX_NOTICES = 30;
const LKEY = "or:l:", NKEY = "or:n:";

// ---------------------------------------------------------------- the orders (kept in memory, saved one by one)
let all = null;                            // id -> { i, b: buyer id, n: buyer name, t: shop item id, nm: item name, q: wanted, f: filled, h: filled but not collected, p: price each, c, e, x: 0 open | 1 closed }
let ver = 0;
const views = new Map();
const strip = (r) => ({ i: r.i, b: r.b, n: r.n, t: r.t, nm: r.nm, q: r.q, f: r.f, h: r.h, p: r.p, c: r.c, e: r.e, x: r.x, ...(r.hb && r.hb.length ? { hb: r.hb } : {}) });
const save = (r) => { try { world.setDynamicProperty(LKEY + r.i, JSON.stringify(strip(r))); return true; } catch (e) { console.warn("[order] save failed: " + e); return false; } };
const drop = (r) => { try { world.setDynamicProperty(LKEY + r.i, undefined); return true; } catch (e) { console.warn("[order] delete failed: " + e); return false; } };
const changed = () => { ver++; views.clear(); };
const now = () => Date.now();

function load() {
  if (all) return all;
  const m = new Map();
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(LKEY)) continue;
      try {
        const r = JSON.parse(world.getDynamicProperty(k));
        if (r && r.i && r.b && r.t && r.q > 0 && r.p > 0) { r.f = r.f | 0; r.h = r.h | 0; if (r.hb && !Array.isArray(r.hb)) r.hb = []; m.set(r.i, r); }
      } catch (e) { console.warn("[order] unreadable " + k); }
    }
  } catch (e) { return null; }
  all = m;
  return all;
}
export const isOpen = (r) => r.x === 0 && r.e > now() && r.f < r.q;
export const left = (r) => Math.max(0, r.q - r.f);
export const getOrder = (id) => (load() ?? new Map()).get(id) ?? null;
export const mine = (buyerId) => {
  const out = [];
  for (const r of (load() ?? new Map()).values()) if (r.b === buyerId) out.push(r);
  return out.sort((a, b) => (isOpen(a) === isOpen(b) ? b.c - a.c : isOpen(a) ? -1 : 1));
};
export const waiting = (buyerId) => { let n = 0; for (const r of (load() ?? new Map()).values()) if (r.b === buyerId) n += r.h; return n; };

// ---------------------------------------------------------------- the shop items that can be ordered
let ITEMS = null;                          // shop id -> { id, name, icon, cat }
let CATS = [];
let RAW = [];
/** the catalog is read on first use (the game item list is not ready while the scripts load); an empty result is tried again next time */
export function setCatalog(categories) { RAW = categories; ITEMS = null; }
function ensure() {
  if (ITEMS) return;
  build(RAW);
  if (!ITEMS.size) ITEMS = null;
}
function build(categories) {
  ITEMS = new Map(); CATS = [];
  for (const c of categories) {
    const list = [];
    for (const it of c.items) {
      try {
        const id = it[0], name = it[1];
        if (ITEMS.has(id)) continue;
        const r = resolveItem(id, name);
        if (!r || !r.full || r.full !== realId(id)) continue;          // only items the inventory helpers can count exactly
        const rec = { id, name, icon: it[2], cat: c.id };
        ITEMS.set(id, rec); list.push(rec);
      } catch (e) { /* skip this item */ }
    }
    CATS.push({ id: c.id, name: c.name, icon: c.icon, items: list });
  }
  if (ITEMS.size) {                                                    // our own item: the Heart (full Hearts only; the hidden buyer tag travels with it)
    const rec = { id: HEART_ITEM, name: "Heart", icon: "textures/items/smp_heart", cat: "hearts" };
    ITEMS.set(rec.id, rec); CATS.push({ id: "hearts", name: "Hearts", icon: rec.icon, items: [rec] });
  }
}

// ---------------------------------------------------------------- Hearts (custom item, not "plain": it has lore + a hidden buyer tag)
// The buyer tags of the Hearts that were sold into an order are kept in r.hb = [[buyer id, buyer name, count], ...] (id "" = no tag)
// and put back on the Hearts when the buyer collects them, so the admin Heart logs still know who bought each Heart in the shop.
const HEART_STACK = 16;
const countHearts = (p) => { let n = 0; const c = container(p); for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s && s.typeId === HEART_ITEM) n += s.amount; } return n; };
function removeHearts(p, qty) {
  const c = container(p), tags = []; let left = qty;
  for (let i = 0; i < c.size && left > 0; i++) {
    const s = c.getItem(i);
    if (!s || s.typeId !== HEART_ITEM) continue;
    const take = Math.min(left, s.amount), b = buyerOf(s);
    if (take === s.amount) c.setItem(i, undefined); else { s.amount -= take; c.setItem(i, s); }
    left -= take; addTag(tags, b ? b.id : "", b ? b.name : "", take);
  }
  return { n: qty - left, tags };
}
function addTag(tags, id, name, n) { const t = tags.find((x) => x[0] === id); if (t) t[2] += n; else tags.push([id, name, n]); }
/** the Heart stacks for n Hearts with these buyer tags (a missing tag = Hearts without a buyer) */
function heartStacks(n, tags) {
  const out = []; let left = n;
  const put = (id, name, k) => { k = Math.min(k, left); while (k > 0) { const t = Math.min(HEART_STACK, k); const s = makeHeartStack(t); if (id) tagBuyer(s, id, name); out.push(s); k -= t; left -= t; } };
  for (const [id, name, k] of tags ?? []) put(id, name, k);
  put("", "", left);
  return out;
}
/** hands Heart stacks over (the caller checked there is room; anything that still does not fit is dropped at the feet) */
function handOver(p, stacks) {
  for (const s of stacks) { try { const rest = container(p).addItem(s); if (rest) p.dimension.spawnItem(rest, p.location); } catch (e) { try { p.dimension.spawnItem(s, p.location); } catch (er) { /* ignore */ } } }
  return true;
}
export const catalogCats = () => { ensure(); return CATS; };
export const itemInfo = (id) => { ensure(); return (ITEMS ? ITEMS.get(id) : null) ?? null; };
export const allItems = () => { ensure(); return ITEMS ? [...ITEMS.values()] : []; };

export const SORTS = [
  { key: "high", label: "Highest price", fn: (a, b) => b.p - a.p || b.c - a.c },
  { key: "new", label: "Newest first", fn: (a, b) => b.c - a.c },
  { key: "big", label: "Most items wanted", fn: (a, b) => left(b) - left(a) },
  { key: "end", label: "Ending soon", fn: (a, b) => a.e - b.e },
];
export function browse(sortKey, cat, q) {
  const list = load();
  if (!list) return [];
  const key = sortKey + "|" + cat + "|" + q + "|" + ver;
  let v = views.get(key);
  if (v) return v;
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  v = [];
  for (const r of list.values()) {
    if (!isOpen(r)) continue;
    if (cat && cat !== "all") { const it = itemInfo(r.t); if (!it || it.cat !== cat) continue; }
    if (words.length) { const h = (r.nm + " " + r.t.replace(/_/g, " ") + " " + r.n).toLowerCase(); if (!words.every((w) => h.includes(w))) continue; }
    v.push(r);
  }
  v.sort((SORTS.find((s) => s.key === sortKey) ?? SORTS[0]).fn);
  if (views.size > 12) views.clear();
  views.set(key, v);
  return v;
}

// ---------------------------------------------------------------- notices for the buyer
const online = (id) => { try { return world.getAllPlayers().find((x) => x.id === id) ?? null; } catch (e) { return null; } };
const readQ = (id) => { try { const v = world.getDynamicProperty(NKEY + id); if (typeof v === "string") { const a = JSON.parse(v); if (Array.isArray(a)) return a; } } catch (e) { /* ignore */ } return []; };
const writeQ = (id, q) => { try { world.setDynamicProperty(NKEY + id, q.length ? JSON.stringify(q) : undefined); } catch (e) { /* ignore */ } };
const fillText = (n) => "§6[Order] §a" + n.f + " §7sold you §f" + n.k + "x " + n.nm + " §7(order paid " + money(n.g) + "). Collect it with §f/order §7> My orders.";
function tellBuyer(r, fillerName, k, paid) {
  const n = { f: fillerName, k, nm: r.nm, g: paid };
  const bp = online(r.b);
  if (bp) { try { notify(bp, fillText(n), { key: "order_fill_" + r.i }); } catch (e) { /* ignore */ } return; }
  const q = readQ(r.b); q.push(n); if (q.length > MAX_NOTICES) q.splice(0, q.length - MAX_NOTICES);
  writeQ(r.b, q);
}
function deliverNotices(p) {
  const q = readQ(p.id);
  if (q.length) { writeQ(p.id, []); for (const n of q) { try { notify(p, fillText(n)); } catch (e) { /* ignore */ } } }
  const w = waiting(p.id);
  if (w > 0) { try { notify(p, "§6[Order] §7You have §f" + w + " §7item" + (w > 1 ? "s" : "") + " waiting in §f/order §7> My orders.", { key: "order_wait" }); } catch (e) { /* ignore */ } }
}
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => { try { if (player.isValid === false) return; deliverNotices(player); } catch (e) { /* ignore */ } }, NOTICE_DELAY_TICKS);
});

// ---------------------------------------------------------------- make an order
/** Returns { ok, rec } or { err } */
export function createOrder(p, shopId, qty, each) {
  { const em = econMsg(p); if (em) return { err: em.replace(/§./g, "") }; }
  try {
    const list = load(), it = itemInfo(shopId);
    if (!list) return { err: "Orders are not ready yet, try again in a moment." };
    if (!it) return { err: "This item can not be ordered." };
    qty = Math.floor(qty); each = Math.floor(each);
    if (!(qty >= 1 && qty <= MAX_QTY)) return { err: "The amount must be between 1 and " + MAX_QTY + "." };
    if (!(each >= 1 && each <= MAX_EACH)) return { err: "The price for each item must be between $1 and " + money(MAX_EACH) + "." };
    const total = qty * each;
    if (total > MAX_COST) return { err: "The whole order can not cost more than " + money(MAX_COST) + "." };
    if ([...list.values()].filter((r) => r.b === p.id).length >= MAX_PER_PLAYER) return { err: "You already have " + MAX_PER_PLAYER + " orders. Cancel one or collect the finished ones first." };
    if (list.size >= MAX_TOTAL) return { err: "There are too many orders right now." };
    const rec0 = recordOf(p.id);
    if (!rec0 || (Number(rec0.money) || 0) < total) return { err: "Not enough money. This order costs " + money(total) + "." };
    if (!takeMoney(p, total)) return { err: "Not enough money. This order costs " + money(total) + "." };
    const r = { i: now().toString(36) + Math.random().toString(36).slice(2, 6), b: p.id, n: p.name, t: it.id, nm: it.name, q: qty, f: 0, h: 0, p: each, c: now(), e: now() + DURATION_HOURS * 3600000, x: 0 };
    while (list.has(r.i)) r.i += "x";
    if (!save(r)) { addMoney(p, total); return { err: "The order could not be saved. You were not charged." }; }
    list.set(r.i, r); changed();
    try { logOrder({ k: "ord", actor: p, typeId: it.id, name: it.name, qty, total }); } catch (e) { /* the log can never break an order */ }
    return { ok: true, rec: r, total };
  } catch (e) { console.warn("[order] create failed: " + e); return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- sell to an order
export const canSell = (p, r) => { try { return r.t === HEART_ITEM ? countHearts(p) : countPlain(p, r.t); } catch (e) { return 0; } };
/** the player gives `k` items to the order and gets the money. Returns { ok, k, paid } or { err } */
export function fillOrder(p, id, k) {
  { const em = econMsg(p); if (em) return { err: em.replace(/§./g, "") }; }
  try {
    const r = getOrder(id);
    if (!r || !isOpen(r)) return { err: "This order is closed or already full." };
    if (r.b === p.id) return { err: "This is your own order." };
    k = Math.floor(Number(k) || 0);
    k = Math.min(k, left(r), canSell(p, r));
    const heart = r.t === HEART_ITEM;
    if (k < 1) return { err: heart ? "You do not carry any Heart." : "You do not carry any plain " + r.nm + " (no name, enchantments or damage)." };
    let got, tags = null;
    if (heart) { const x = removeHearts(p, k); got = x.n; tags = x.tags; }
    else got = removePlain(p, r.t, k);                                   // the items leave the seller first
    if (got < 1) return { err: heart ? "You do not carry any Heart." : "You do not carry any plain " + r.nm + "." };
    const oldHb = heart ? (r.hb ?? []).map((t) => t.slice()) : null;
    if (heart) { r.hb = (r.hb ?? []).map((t) => t.slice()); for (const [id, nm, n] of tags) addTag(r.hb, id, nm, n); }
    r.f += got; r.h += got; if (r.f >= r.q) r.x = 1;
    if (!save(r)) {                                                      // not saved: the seller gets his items back and nothing happened
      r.f -= got; r.h -= got; if (r.f < r.q) r.x = 0;
      if (heart) { r.hb = oldHb; handOver(p, heartStacks(got, tags)); }
      else give(p, r.t, got, r.nm);
      return { err: "The order could not be saved. Your items were given back." };
    }
    changed();
    const paid = got * r.p;
    addMoney(p, paid);
    tellBuyer(r, p.name, got, paid);
    try { logOrder({ k: "ordf", actor: p, ownerId: r.b, ownerName: r.n, typeId: r.t, name: r.nm, qty: got, total: paid }); } catch (e) { /* the log can never break a sale */ }
    return { ok: true, k: got, paid, rec: r };
  } catch (e) { console.warn("[order] fill failed: " + e); return { err: "Something went wrong. Check your inventory." }; }
}

// ---------------------------------------------------------------- collect / cancel
function finish(r) {                                                     // a closed order with nothing left to collect disappears
  const list = load();
  if (r.x === 1 && r.h === 0 && list && list.get(r.i) === r) { if (drop(r)) { list.delete(r.i); } changed(); }
}
export function collect(p, id) {
  try {
    const r = getOrder(id);
    if (!r || r.b !== p.id) return { err: "This order is gone." };
    if (r.h < 1) return { err: "Nothing to collect yet." };
    const n = r.h, heart = r.t === HEART_ITEM, oldHb = r.hb;
    let stacks = null;
    if (heart) {
      stacks = heartStacks(n, r.hb);
      if (container(p).emptySlotsCount < stacks.length) return { err: "Free " + stacks.length + " inventory slot" + (stacks.length > 1 ? "s" : "") + " first." };
    }
    r.h = 0; if (heart) r.hb = [];
    if (!save(r)) { r.h = n; r.hb = oldHb; return { err: "Could not save. Try again." }; }
    if (!(heart ? handOver(p, stacks) : give(p, r.t, n, r.nm))) { r.h = n; r.hb = oldHb; save(r); return { err: "The items could not be delivered. They stay in your order." }; }
    changed(); finish(r);
    return { ok: true, n, rec: r };
  } catch (e) { console.warn("[order] collect failed: " + e); return { err: "Something went wrong." }; }
}
export function collectAll(p) {
  let n = 0;
  for (const r of mine(p.id)) { if (r.h > 0) { const res = collect(p, r.i); if (res.ok) n += res.n; else break; } }
  return n;
}
/** the buyer cancels: the money of the missing items comes back, the items already received are collected */
export function cancelOrder(p, id) {
  try {
    const r = getOrder(id);
    if (!r || r.b !== p.id) return { err: "This order is gone." };
    const missing = left(r), refund = missing * r.p;
    if (r.x === 0 && missing > 0) {
      const old = { q: r.q, x: r.x };
      r.q = r.f; r.x = 1;
      if (!save(r)) { r.q = old.q; r.x = old.x; return { err: "Could not save. Try again." }; }
      addMoney(p, refund);
      changed();
      try { logOrder({ k: "ordc", actor: p, typeId: r.t, name: r.nm, qty: missing, total: refund }); } catch (e) { /* the log can never break a cancel */ }
    }
    const got = r.h > 0 ? collect(p, id) : { ok: true, n: 0 };
    if (r.h === 0) finish(r);
    return { ok: true, refund, n: got.n ?? 0, rec: r };
  } catch (e) { console.warn("[order] cancel failed: " + e); return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- end of time
function expireJob() {
  const list = load();
  if (!list) return;
  let any = false;
  for (const r of [...list.values()]) {
    if (r.x !== 0 || r.e > now()) continue;
    const missing = left(r), refund = missing * r.p, oldQ = r.q;
    r.x = 1; r.q = r.f;
    if (!save(r)) { r.x = 0; r.q = oldQ; continue; }                     // not saved: try again at the next check
    any = true;
    if (refund > 0) addMoneyById(r.b, refund);
    const bp = online(r.b);
    if (bp) { try { notify(bp, "§6[Order] §7Your order for §f" + r.nm + " §7ended" + (refund > 0 ? ". §a" + money(refund) + " §7came back to you." : "."), { key: "order_end_" + r.i }); } catch (e) { /* ignore */ } }
    if (r.h === 0) finish(r);
  }
  if (any) changed();
}
system.runInterval(() => { try { expireJob(); } catch (e) { console.warn("[order] expire: " + e); } }, CHECK_TICKS);
system.runTimeout(() => { try { load(); } catch (e) { /* ignore */ } }, 120);
