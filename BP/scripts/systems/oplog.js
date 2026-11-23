// OPERATOR LOGS: every purchase, sale, spawner deal and /pay transfer is saved for the operators (/menu > Operator > Logs),
// sorted in categories, and the system marks what looks wrong ("Suspicious"): same product again and again, buy-and-sell loops,
// fast money, auto-clicker speed, spawner floods, payment chains / new accounts.  Nothing here ever blocks or punishes anybody.
// Hooks: data.js onTx (every shop transaction), pay.js logPay (every payment).  Settings: OPLOG in systems/config.js.
// Everything is wrapped in try/catch: a problem here can never break a purchase, a sale or a payment.
import { world, system } from "@minecraft/server";
import { onTx, recordOf, stats } from "../data.js";
import { isStaff, opAlert } from "./opcore.js";
import { OPLOG as C } from "./config.js";
import { money, num } from "../format.js";
import { oprMsg } from "./oprlang.js";

export const CATS = ["sus", "buy", "sell", "spawner", "pay", "big", "shard", "ah", "ord"];
const CAP = { sus: 300, buy: 800, sell: 800, spawner: 300, pay: 400, big: 300, shard: 300, ah: 500, ord: 500 };   // kept in several saved pieces (see load / flush)
const KEY = (c) => "opl:" + c, MAXLEN = 28000;
export const RULES = {
  same10: "Same product again and again", same30: "Same product again and again", loop: "Bought AND sold the same product", earn: "Fast money from sales",
  rapid: "Too many deals per minute", spawner: "Many spawners in a short time", payrepeat: "Many payments to one player", payburst: "A lot of money sent quickly",
  paynew: "New player in a big payment", payfwd: "Money forwarded right away",
};

// ---------------------------------------------------------------- storage (newest first, one saved list per category)
const logs = {};
let loaded = false, saveT = null;
const dirty = new Set();
// one category = several world properties ("opl:buy", "opl:buy#1", "opl:buy#2" ...), each one under MAXLEN characters
const pieces = {};                                               // category -> how many pieces are saved now
function load() {
  if (loaded) return true;
  try {
    for (const c of CATS) {
      let a = [], i = 0;
      for (;;) {
        const raw = world.getDynamicProperty(i ? KEY(c) + "#" + i : KEY(c));
        if (typeof raw !== "string") break;
        try { const part = JSON.parse(raw); if (Array.isArray(part)) a = a.concat(part); } catch (e) { /* a broken piece is skipped */ }
        i++;
      }
      logs[c] = a; pieces[c] = i;
    }
    loaded = true;
  } catch (e) { return false; }                                  // world not ready yet: never overwrite what is saved
  return true;
}
function flush() {
  saveT = null;
  for (const c of dirty) {
    try {
      const arr = logs[c], parts = [];
      let cur = [], len = 2;
      for (const e of arr) { const t = JSON.stringify(e); if (len + t.length + 1 > MAXLEN && cur.length) { parts.push(cur); cur = []; len = 2; } cur.push(e); len += t.length + 1; }
      if (cur.length || !parts.length) parts.push(cur);
      parts.forEach((part, i) => world.setDynamicProperty(i ? KEY(c) + "#" + i : KEY(c), JSON.stringify(part)));
      for (let i = parts.length; i < (pieces[c] ?? 0); i++) { try { world.setDynamicProperty(KEY(c) + "#" + i, undefined); } catch (e) { /* ignore */ } }
      pieces[c] = parts.length;
    } catch (e) { console.warn("[oplog] save failed (" + c + "): " + e); }
  }
  dirty.clear();
}
const capWarned = new Set();
function push(cat, e) {
  if (!load()) return;
  const arr = logs[cat]; arr.unshift(e); if (arr.length > CAP[cat]) arr.length = CAP[cat];
  if (arr.length >= Math.floor(CAP[cat] * 0.9) && !capWarned.has(cat)) {         // warn the operators ONCE per restart before the oldest entries start to be replaced
    capWarned.add(cat);
    try { opAlert("§e[Logs] The \"" + cat + "\" log is almost full (" + arr.length + "/" + CAP[cat] + "). The oldest entries will be replaced by new ones.", { chat: true }); } catch (err) { /* ignore */ }
  }
  dirty.add(cat);
  if (!saveT) saveT = system.runTimeout(flush, 100);
}
export const entries = (cat) => (load() ? logs[cat] : []);
// ---- delete ONE record (Owner only: the menu checks it, twice).  The same record can also sit in "Big deals" (a copy), so every copy goes.
const sameEntry = (a, b) => a.t === b.t && a.k === b.k && a.i === b.i && a.a === b.a && a.x === b.x && a.q === b.q && a.r === b.r && a.d === b.d && a.oi === b.oi;
/** removes the record and its copies from every list, saves at once, returns how many were removed (0 = not found) */
export function deleteEntry(e) {
  try {
    if (!e || typeof e.t !== "number" || !load()) return 0;
    let n = 0;
    for (const c of CATS) {
      const arr = logs[c];
      for (let i = arr.length - 1; i >= 0; i--) if (sameEntry(arr[i], e)) { arr.splice(i, 1); n++; dirty.add(c); }
    }
    if (n) { try { if (saveT) system.clearRun(saveT); } catch (err) { /* ignore */ } flush(); }
    return n;
  } catch (err) { console.warn("[oplog] delete failed: " + err); return 0; }
}
world.afterEvents.playerLeave.subscribe(() => { try { if (dirty.size) flush(); } catch (e) { /* ignore */ } });

// ---------------------------------------------------------------- per operator: what he has seen, and the live feed switch
const seenCache = new Map();
function seenOf(p) {
  let m = seenCache.get(p.id);
  if (!m) { try { const raw = world.getDynamicProperty("opl:seen:" + p.id); m = typeof raw === "string" ? JSON.parse(raw) : {}; } catch (e) { m = {}; } seenCache.set(p.id, m); }
  return m;
}
export const seenAt = (p, cat) => seenOf(p)[cat] ?? 0;
export function markSeen(p, cat) {
  const m = seenOf(p); m[cat] = Date.now();
  try { world.setDynamicProperty("opl:seen:" + p.id, JSON.stringify(m)); } catch (e) { /* ignore */ }
}
export function unseenCounts(p) {
  const out = {}, m = seenOf(p);
  for (const c of CATS) out[c] = entries(c).filter((e) => e.t > (m[c] ?? 0) && e.i !== p.id).length;
  return out;
}
export function liveOn(p) { try { const v = world.getDynamicProperty("opl:live:" + p.id); return typeof v === "boolean" ? v : C.live !== false; } catch (e) { return false; } }
export function toggleLive(p) { const v = !liveOn(p); try { world.setDynamicProperty("opl:live:" + p.id, v); } catch (e) { /* ignore */ } return v; }
function live(actorId, text) {
  for (const p of world.getAllPlayers()) { try { if (p.id !== actorId && isStaff(p) && liveOn(p)) p.sendMessage(oprMsg(p, text)); } catch (e) { /* ignore */ } }
}

// ---------------------------------------------------------------- detection state (memory only, last 30 minutes)
const hist = new Map();                                         // player id -> { tx:[], pay:[], recv:[], flagged: Map }
const stOf = (id) => { let s = hist.get(id); if (!s) { s = { tx: [], pay: [], recv: [], flagged: new Map() }; hist.set(id, s); } return s; };
const MIN = 60000;
const keepMs = () => Math.max(30, ...(C.same ?? []).map((w) => w.min), C.loop?.min ?? 0, C.earn?.min ?? 0, C.spawner?.min ?? 0, C.pay?.sameTarget?.min ?? 0) * MIN + MIN;
system.runInterval(() => {
  try {
    const cut = Date.now() - keepMs();
    for (const [id, s] of hist) {
      s.tx = s.tx.filter((x) => x.t > cut); s.pay = s.pay.filter((x) => x.t > cut); s.recv = s.recv.filter((x) => x.t > cut);
      for (const [k, t] of s.flagged) if (t < cut) s.flagged.delete(k);
      if (!s.tx.length && !s.pay.length && !s.recv.length && !s.flagged.size) hist.delete(id);
    }
  } catch (e) { /* ignore */ }
}, 1200);

/** one report: saved in Suspicious + sent to the operators (offline ones see it when they join). Same player + same rule only once per cooldown */
function flag(p, ruleKey, level, text) {
  const now = Date.now(), s = stOf(p.id);
  if (now - (s.flagged.get(ruleKey) ?? 0) < (C.cooldownMin ?? 10) * MIN) return;
  s.flagged.set(ruleKey, now);
  const r = ruleKey.split(":")[0];
  push("sus", { t: now, k: "sus", i: p.id, p: p.name, r, l: level, d: String(text).slice(0, 150) });
  opAlert((level > 1 ? "§c" : "§e") + "[Logs] §f" + p.name + " §7- " + text + " §8(Operator > Logs > Suspicious)");
}
const watched = (p) => C.watchStaff === true || !isStaff(p);
const DS = { "minecraft:overworld": "o", "minecraft:nether": "n", "minecraft:the_end": "e" };
/** where the player stood + his money after the deal (added to every record) */
function where(p, e) {
  try { const l = p.location; e.w = (DS[p.dimension.id] ?? "o") + " " + Math.floor(l.x) + " " + Math.floor(l.y) + " " + Math.floor(l.z); } catch (x) { /* ignore */ }
  try { e.b = Math.floor(stats(p).money); } catch (x) { /* ignore */ }
  return e;
}

function catOf(rec) {
  const id = String(rec.id ?? ""), nm = String(rec.name ?? "");
  if (rec.cur === "shards") return "shard";
  if (id.includes("spawner") || id.endsWith("_spawn_egg") || /spawner|spawn egg/i.test(nm)) return "spawner";
  return rec.type === "sell" ? "sell" : "buy";
}
const verb = (k) => (k === "sell" ? "sold" : "bought");

function detectTx(p, x) {
  const now = x.t, s = stOf(p.id);
  s.tx.push(x); if (s.tx.length > 500) s.tx.shift();
  const money$ = s.tx.filter((y) => !y.shard);
  // 1) the same product again and again
  for (const w of C.same ?? []) {
    const from = now - w.min * MIN;
    let q = 0, a = 0;
    for (const y of money$) if (y.t >= from && y.k === x.k && y.id === x.id) { q += y.q; a += y.a; }
    if (q >= w.units || a >= w.money) flag(p, "same" + w.min + ":" + x.k + ":" + x.id, q >= 2 * w.units || a >= 2 * w.money ? 2 : 1, verb(x.k) + " " + num(q) + "x " + x.name + " (" + money(a) + ") in " + w.min + " min");
  }
  // 2) bought AND sold the same product (a price loop when he ends with a profit)
  if (C.loop) {
    const from = now - C.loop.min * MIN;
    let bq = 0, ba = 0, sq = 0, sa = 0;
    for (const y of money$) if (y.t >= from && y.id === x.id) { if (y.k === "buy") { bq += y.q; ba += y.a; } else { sq += y.q; sa += y.a; } }
    if (bq >= C.loop.minUnits && sq >= C.loop.minUnits) {
      const profit = sa - ba;
      flag(p, "loop:" + x.id, profit > 0 ? 2 : 1, "bought " + num(bq) + "x (" + money(ba) + ") and sold " + num(sq) + "x (" + money(sa) + ") " + x.name + " in " + C.loop.min + " min" + (profit > 0 ? " - PROFIT " + money(profit) : ""));
    }
  }
  // 3) fast money from sales
  if (C.earn && x.k === "sell") {
    const from = now - C.earn.min * MIN; let a = 0;
    for (const y of money$) if (y.t >= from && y.k === "sell") a += y.a;
    if (a >= C.earn.money) flag(p, "earn", a >= 2 * C.earn.money ? 2 : 1, "earned " + money(a) + " from sales in " + C.earn.min + " min");
  }
  // 4) too many deals in one minute
  if (C.rapid) {
    const n = s.tx.filter((y) => y.t >= now - MIN).length;
    if (n >= C.rapid.perMin) flag(p, "rapid", 1, n + " shop deals in one minute");
  }
  // 5) many spawners / eggs
  if (C.spawner && x.cat === "spawner" && x.k === "buy") {
    const n = s.tx.filter((y) => y.t >= now - C.spawner.min * MIN && y.cat === "spawner" && y.k === "buy").length;
    if (n >= C.spawner.count) flag(p, "spawner", 2, "bought " + n + " spawners / eggs in " + C.spawner.min + " min");
  }
}

// ---------------------------------------------------------------- hook: every shop transaction
try {
  onTx((p, rec) => {
    try {
      if (C.enabled === false || !rec) return;
      const cat = catOf(rec), shard = rec.cur === "shards", k = rec.type === "sell" ? "sell" : "buy";
      const q = Math.max(1, Math.floor(rec.qty ?? 1)), a = Math.max(0, Math.floor(rec.total ?? 0)), now = Date.now();
      const e = where(p, { t: now, k, i: p.id, p: p.name, x: String(rec.id ?? ""), n: String(rec.name ?? "?").slice(0, 48), q, a });
      if (shard) e.s = 1;
      if (rec.src) e.src = String(rec.src); if (rec.bonus > 0) e.bn = Math.floor(rec.bonus); if (rec.unit > 0) e.u = Math.floor(rec.unit); if (rec.at) e.at = String(rec.at); if (rec.what) e.wh = String(rec.what).slice(0, 40);
      push(cat, e);
      const lim = shard ? C.big?.shards : k === "sell" ? C.big?.sell : C.big?.buy;
      if (lim && a >= lim) push("big", { ...e });
      const amount = shard ? num(a) + " shards" : money(a);
      live(p.id, "§8[Log] §f" + p.name + " " + (k === "sell" ? "§a+" : "§c-") + amount + " §7" + verb(k) + " " + num(q) + "x " + e.n);
      if (!shard && watched(p)) detectTx(p, { t: now, k, id: e.x, name: e.n, q, a, cat, shard: false });
    } catch (e) { console.warn("[oplog] tx failed: " + e); }
  });
} catch (e) { console.warn("[oplog] hook not started: " + e); }

// ---------------------------------------------------------------- hook: every auction house (/ah) deal (called by auction.js after the listing / purchase was saved)
//   k "ahl" = a player put an item up for sale | k "ahb" = a player bought a listing (i / p = buyer, oi / o = seller, a = price, g = what the seller got)
export function logAh(x) {
  try {
    if (C.enabled === false || !x || !x.actor) return;
    const now = Date.now(), a = Math.max(0, Math.floor(Number(x.price) || 0)), q = Math.max(1, Math.floor(Number(x.qty) || 1));
    const e = where(x.actor, { t: now, k: x.k === "ahb" ? "ahb" : "ahl", i: x.actor.id, p: x.actor.name, x: String(x.typeId ?? ""), n: String(x.name ?? "?").replace(/§./g, "").slice(0, 40), q, a });
    if (e.k === "ahb") { e.oi = String(x.sellerId ?? ""); e.o = String(x.sellerName ?? "?"); e.g = Math.max(0, Math.floor(Number(x.gain) || a)); }
    push("ah", e);
    if (e.k === "ahb" && C.big?.buy && a >= C.big.buy) push("big", { ...e });
    if (e.k === "ahb") live(x.actor.id, "§8[Log] §f" + e.p + " §c-" + money(a) + " §7bought in the auction §f" + num(q) + "x " + e.n + " §7| auction seller §f" + e.o);
    else live(x.actor.id, "§8[Log] §f" + e.p + " §7listed in the auction §f" + num(q) + "x " + e.n + " §7| auction price §e" + money(a));
  } catch (err) { console.warn("[oplog] auction failed: " + err); }
}

// ---------------------------------------------------------------- hook: every /order deal (called by orders.js after the order was saved)
//   Saved in its own list ("ord") but the operators see it TOGETHER with the auction log (one button: Auction & Orders log).
//   k "ord"  = a player made a buy order (i / p = the buyer, a = the whole price that was kept safe)
//   k "ordf" = a player sold items into an order (i / p = the seller, oi / o = the order owner, a = what the seller got)
//   k "ordc" = the owner cancelled an order (i / p = the owner, q = items that were still missing, a = the money that came back)
export function logOrder(x) {
  try {
    if (C.enabled === false || !x || !x.actor) return;
    const now = Date.now(), a = Math.max(0, Math.floor(Number(x.total) || 0)), q = Math.max(1, Math.floor(Number(x.qty) || 1));
    const k = x.k === "ordf" ? "ordf" : x.k === "ordc" ? "ordc" : "ord";
    const e = where(x.actor, { t: now, k, i: x.actor.id, p: x.actor.name, x: String(x.typeId ?? ""), n: String(x.name ?? "?").replace(/§./g, "").slice(0, 40), q, a });
    if (k === "ordf") { e.oi = String(x.ownerId ?? ""); e.o = String(x.ownerName ?? "?"); }
    push("ord", e);
    if (k !== "ordc" && C.big?.[k === "ordf" ? "sell" : "buy"] && a >= C.big[k === "ordf" ? "sell" : "buy"]) push("big", { ...e });
    const each = money(Math.round(a / q));
    if (k === "ord") live(x.actor.id, "§8[Log] §f" + e.p + " §c-" + money(a) + " §7made an order for §f" + num(q) + "x " + e.n + " §7| each §e" + each);
    else if (k === "ordf") live(x.actor.id, "§8[Log] §f" + e.p + " §a+" + money(a) + " §7sold into an order §f" + num(q) + "x " + e.n + " §7| order owner §f" + e.o);
    else live(x.actor.id, "§8[Log] §f" + e.p + " §a+" + money(a) + " §7cancelled an order §f" + num(q) + "x " + e.n + " §7(refund)");
  } catch (err) { console.warn("[oplog] order failed: " + err); }
}

// ---------------------------------------------------------------- hook: every /pay payment (called by pay.js after the money moved)
export function logPay(p, t, amount) {
  try {
    if (C.enabled === false) return;
    const now = Date.now(), a = Math.floor(amount);
    const e = where(p, { t: now, k: "pay", i: p.id, p: p.name, oi: t.id, o: t.name, a });
    push("pay", e);
    if (C.big?.pay && a >= C.big.pay) push("big", { ...e });
    live(p.id, "§8[Log] §f" + p.name + " §e" + money(a) + " §7sent to §f" + t.name);
    const rs = stOf(t.id); rs.recv.push({ t: now, a, from: p.id });                   // the receiver's "recently received" list (for the forwarding rule)
    if (!watched(p)) return;
    const s = stOf(p.id), cfg = C.pay ?? {};
    s.pay.push({ t: now, to: t.id, a });
    if (cfg.sameTarget) {
      const from = now - cfg.sameTarget.min * MIN; let n = 0, sum = 0;
      for (const y of s.pay) if (y.t >= from && y.to === t.id) { n++; sum += y.a; }
      if (n >= cfg.sameTarget.count && sum >= cfg.sameTarget.money) flag(p, "payrepeat:" + t.id, 1, "sent " + n + " payments (" + money(sum) + ") to " + t.name + " in " + cfg.sameTarget.min + " min");
    }
    if (cfg.burst) {
      const from = now - cfg.burst.min * MIN; let sum = 0;
      for (const y of s.pay) if (y.t >= from) sum += y.a;
      if (sum >= cfg.burst.money) flag(p, "payburst", 2, "sent " + money(sum) + " in " + cfg.burst.min + " min");
    }
    if (cfg.newPlayerHours && a >= cfg.newPlayerMoney) {
      const lim = cfg.newPlayerHours * 3600;
      const sp = recordOf(p.id)?.play, tp = recordOf(t.id)?.play;
      if (typeof sp === "number" && sp < lim) flag(p, "paynew:" + p.id, 2, "a NEW player (" + Math.round(sp / 60) + " min played) sent " + money(a) + " to " + t.name);
      else if (typeof tp === "number" && tp < lim) flag(p, "paynew:" + t.id, 2, "sent " + money(a) + " to a NEW player (" + t.name + ", " + Math.round(tp / 60) + " min played)");
    }
    if (cfg.forward) {
      const from = now - cfg.forward.min * MIN; let got = 0;
      for (const y of s.recv) if (y.t >= from) got += y.a;
      if (got >= cfg.forward.money && a >= got * cfg.forward.share) flag(p, "payfwd", 2, "received " + money(got) + " and sent " + money(a) + " on to " + t.name + " within " + cfg.forward.min + " min");
    }
  } catch (e) { console.warn("[oplog] pay failed: " + e); }
}

// ---------------------------------------------------------------- views for the menu
/** everybody that appears in the logs: [{ id, name, last, n, sus }] most suspicious / most recent first */
export function playersIndex() {
  const m = new Map();
  for (const c of CATS) {
    if (c === "big") continue;                                    // big deals are copies of other entries
    for (const e of entries(c)) {
      let r = m.get(e.i); if (!r) { r = { id: e.i, name: e.p, last: 0, n: 0, sus: 0 }; m.set(e.i, r); }
      r.n++; if (c === "sus") r.sus++; if (e.t > r.last) { r.last = e.t; r.name = e.p; }
    }
  }
  return [...m.values()].sort((a, b) => b.sus - a.sus || b.last - a.last);
}
/** all entries of one player (newest first): his deals, his payments (sent and received) and his reports */
export function entriesOfPlayer(id) {
  const out = [];
  for (const c of CATS) {
    if (c === "big") continue;
    for (const e of entries(c)) if (e.i === id || e.oi === id) out.push({ ...e, c });
  }
  return out.sort((a, b) => b.t - a.t);
}
