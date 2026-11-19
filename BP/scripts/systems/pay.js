// /pay - send money to another player (online OR offline).
//   /pay                    opens the Pay menu (also: /menu -> Pay)
//   /pay <player> [amount]  jumps straight to the amount page / the approve page (online players)
// Flow:  choose a player (two lists: Online with a green dot, Offline = everybody who ever joined)  ->  type the amount  ->  green check button
//        ->  "Do you want to approve?"  ->  Approve  ->  the money moves at once.
// The receiver gets the notice  "<name> pay you $50k"  (cyan, middle of the screen) 15 seconds later.
// An offline receiver gets it 15 seconds after joining. The notices are saved in the world data, so they survive a restart.
import { world, system } from "@minecraft/server";
import { sendBar } from "../barsend.js";
import { stats, takeMoney, addMoney, addMoneyById, knownPlayers, touch } from "../data.js";
import { econMsg, hiddenFrom } from "./staffcore.js";   // staff tools: frozen money account, vanished operators
import { money, short } from "../format.js";
import { payBusy } from "../state.js";
import { make, set, open, hdr, COLS, NAV, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { showModal, textField } from "./forms.js";
import { notify } from "../smp/notify.js";
import { luxDing } from "../lux.js";
import { logPay } from "./oplog.js";
import { valid } from "./util.js";
import { ModalFormData } from "@minecraft/server-ui";
import { menuMsg, MenuForm } from "./menulang.js";

const DELAY_MS = 15000;           // the receiver's notice comes 15 seconds after the payment (offline: 15 seconds after joining)
const SHOW_TICKS = 100;           // the notice stays 5 seconds
const MIN_AMOUNT = 1000;           // the smallest payment: $1,000 (1k)
const MAX_AMOUNT = 1e12;
const MAX_QUEUE = 50;
const PER_PAGE = 72;
const ICON = { player: NAV.player, prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", gold: NAV.bal };

// ---------------------------------------------------------------- amount: "5000"  "50k"  "1.5m"  (Arabic digits work too)
export function parseAmount(raw) {
  const t = String(raw ?? "").trim().toLowerCase()
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[$,\s_]/g, "");
  const m = /^(\d+(?:\.\d+)?)([kmbt]?)$/.exec(t);
  if (!m) return null;
  const n = Math.floor(Number(m[1]) * ({ "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 })[m[2]] + 1e-6);
  return Number.isFinite(n) && n >= 1 && n <= MAX_AMOUNT ? n : null;
}

// ---------------------------------------------------------------- who can be paid
// Everybody who joined this world at least once has a saved record (data.js "p:<id>") -> that is the offline list. Nobody who never joined is in it.
let rosterAt = 0, roster = [];
const known = () => { if (Date.now() - rosterAt > 20000) { try { roster = knownPlayers(); } catch (e) { roster = []; } rosterAt = Date.now(); } return roster; };
const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
const findOnline = (id) => world.getAllPlayers().find((x) => x.id === id);

function lists(p) {
  const live = new Map(world.getAllPlayers().filter((x) => x.id !== p.id && !hiddenFrom(p, x)).map((x) => [x.id, x]));      // a vanished operator shows as offline
  const online = [], offline = [], seen = new Set();
  for (const r of known()) {
    if (r.id === p.id || !r.name || seen.has(r.id)) continue;
    seen.add(r.id);
    const o = live.get(r.id);
    if (o) online.push({ id: r.id, name: o.name }); else offline.push({ id: r.id, name: r.name });
  }
  for (const [id, o] of live) if (!seen.has(id)) online.push({ id, name: o.name });     // just joined, not in the saved list yet
  return { online: online.sort(byName), offline: offline.sort(byName) };
}

// ---------------------------------------------------------------- notices (saved per receiver:  "pay:in:<id>" = [{ n: sender name, a: amount, d: show at (ms; 0 = when he joins) }])
const KEY = "pay:in:";
const waiting = new Set();          // receiver ids that have notices waiting
const armed = new Set();            // online receivers whose old notices were already re-timed after joining
const showing = new Set();          // receivers that see a notice right now
function readQ(id) {
  try { const r = world.getDynamicProperty(KEY + id); if (typeof r === "string") { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) { /* ignore */ }
  return [];
}
function writeQ(id, q) {
  try {
    if (q.length) { world.setDynamicProperty(KEY + id, JSON.stringify(q)); waiting.add(id); }
    else { world.setDynamicProperty(KEY + id, undefined); waiting.delete(id); }
  } catch (e) { console.warn("[pay] cannot save notice: " + e); }
}
function enqueue(id, name, amount, due) {
  const q = readQ(id);
  q.push({ n: String(name).slice(0, 32), a: amount, d: due });
  while (q.length > MAX_QUEUE) q.shift();
  writeQ(id, q);
}
system.run(() => { try { for (const id of world.getDynamicPropertyIds()) if (id.startsWith(KEY)) waiting.add(id.slice(KEY.length)); } catch (e) { /* ignore */ } });

/** "ZahraaBelle pay you $50k" in the middle of the screen (action bar, cyan), re-sent so other bars can't hide it */
function deliver(p, e) {
  const text = "\u00a7b" + e.n + " pay you $" + short(e.a);
  showing.add(p.id); payBusy.add(p.id);
  try { notify(p, "\u00a7a" + e.n + " paid you \u00a7e" + money(e.a), { chat: false }); } catch (err) { /* ignore */ }
  luxDing(p);
  let n = 0, h = null;
  const stop = () => {
    if (h !== null) { try { system.clearRun(h); } catch (err) { /* ignore */ } h = null; }
    showing.delete(p.id); payBusy.delete(p.id);
    try { if (valid(p)) p.onScreenDisplay.setActionBar(""); } catch (err) { /* ignore */ }
  };
  const show = () => {
    if (n++ * 5 >= SHOW_TICKS || !valid(p)) return stop();
    try { sendBar(p, text); } catch (err) { stop(); }
  };
  show();
  if (h === null && showing.has(p.id)) h = system.runInterval(show, 5);
}

system.runInterval(() => {
  if (waiting.size === 0) return;
  const now = Date.now();
  for (const p of world.getAllPlayers()) {
    if (!waiting.has(p.id) || showing.has(p.id)) continue;
    let q = readQ(p.id);
    if (q.length === 0) { waiting.delete(p.id); continue; }     // nothing left (data removed) -> stop checking him every second
    if (!armed.has(p.id)) {                                   // first time we see him since he joined: old / offline notices come 15 s from NOW
      armed.add(p.id);
      for (const e of q) if (!(e.d > now)) e.d = now + DELAY_MS;
      writeQ(p.id, q);
      continue;
    }
    const i = q.findIndex((e) => e.d > 0 && e.d <= now);
    if (i < 0) continue;
    const [e] = q.splice(i, 1);
    writeQ(p.id, q);
    deliver(p, e);
  }
}, 20);
world.afterEvents.playerLeave.subscribe(({ playerId }) => { armed.delete(playerId); showing.delete(playerId); payBusy.delete(playerId); rosterAt = 0; });

// ---------------------------------------------------------------- the money moves here (every check is done again, so an old page can never cheat)
function transfer(p, t, amount) {
  { const em = econMsg(p); if (em) return p.sendMessage(menuMsg(p, em)), false; }
  if (!Number.isInteger(amount) || amount > MAX_AMOUNT) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] Invalid amount.")), false;
  if (amount < MIN_AMOUNT) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] The minimum payment is \u00a7f" + money(MIN_AMOUNT) + "\u00a7c.")), false;
  if (t.id === p.id) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] You can't pay yourself.")), false;
  const bal = stats(p).money;
  if (bal < amount) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] You don't have enough money! You need \u00a7f" + money(amount - bal) + " \u00a7cmore.")), false;
  if (!takeMoney(p, amount)) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] Payment failed.")), false;
  let ok = false;
  try { ok = addMoneyById(t.id, amount); } catch (e) { ok = false; }
  if (!ok) { addMoney(p, amount); p.sendMessage(menuMsg(p, "\u00a7c[Pay] \u00a7f" + t.name + " \u00a7ccan't receive money. You were not charged.")); return false; }   // refund
  const live = findOnline(t.id);
  if (live) { try { touch(live); } catch (e) { /* ignore */ } }
  enqueue(t.id, p.name, amount, live ? Date.now() + DELAY_MS : 0);
  p.sendMessage(menuMsg(p, "\u00a7a[Pay] You sent \u00a7e" + money(amount) + " \u00a7ato \u00a7f" + t.name + "\u00a7a." + (live ? "" : " \u00a77(" + t.name + " is offline - they get it when they join)")));
  try { logPay(p, t, amount); } catch (e) { /* a log must never break a payment */ }
  luxDing(p);
  return true;
}

// ---------------------------------------------------------------- pages
const dot = (on) => (on ? "\u00a7a\u25CF" : "\u00a78\u25CF");

/** step 1: choose a player - two lists (Online / Offline) */
export function payPage(p, back, st = { tab: null, page: 0 }) {
  const { online, offline } = lists(p);
  if (st.tab === null) st.tab = online.length ? "on" : "off";
  const on = st.tab === "on", list = on ? online : offline;
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  st.page = Math.max(0, Math.min(st.page, pages - 1));
  const f = make("Pay", 9); f.self = () => payPage(p, back, st);
  list.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE).forEach((t, i) => {
    set(f, i, hdr(1) + dot(on) + " \u00a7f" + t.name + "\n\u00a7r" + (on ? "\u00a7aOnline" : "\u00a77Offline") + "\n\u00a7r\u00a7eClick to pay", ICON.player, { run: () => composePage(p, back, t, 0, st) });
  });
  if (list.length === 0) set(f, 3 * COLS + 4, hdr(1) + (on ? "\u00a77No other players online" : "\u00a77No offline players yet") + "\n\u00a7r\u00a78Players appear here after they join once", ICON.player, null);
  set(f, 8 * COLS + 3, hdr(1, on ? "g" : "c") + "\u00a7a\u25CF \u00a7f\u00a7lOnline\n\u00a7r\u00a77" + online.length + " player" + (online.length === 1 ? "" : "s") + (on ? "\n\u00a7r\u00a7aShowing" : "\n\u00a7r\u00a7eClick to show"), ICON.player, { run: () => { st.tab = "on"; st.page = 0; payPage(p, back, st); } });
  set(f, 8 * COLS + 4, hdr(1, on ? "c" : "g") + "\u00a78\u25CF \u00a7f\u00a7lOffline\n\u00a7r\u00a77" + offline.length + " player" + (offline.length === 1 ? "" : "s") + (on ? "\n\u00a7r\u00a7eClick to show" : "\n\u00a7r\u00a7aShowing"), ICON.player, { run: () => { st.tab = "off"; st.page = 0; payPage(p, back, st); } });
  if (pages > 1) {
    if (st.page > 0) set(f, 8 * COLS + 6, hdr(1) + "\u00a7e\u00a7lPrevious page", ICON.prev, { run: () => { st.page--; payPage(p, back, st); } });
    set(f, 8 * COLS + 7, hdr(1) + "\u00a77Page \u00a7f" + (st.page + 1) + "\u00a77/\u00a7f" + pages, NAV.page, null);
    if (st.page < pages - 1) set(f, 8 * COLS + 8, hdr(1) + "\u00a7e\u00a7lNext page", ICON.next, { run: () => { st.page++; payPage(p, back, st); } });
  }
  if (back) backBtn(f, back);
  status(p, f);
  open(p, f);
}

/** step 2: type the amount, then press the green check */
function composePage(p, back, t, amount, st) {
  const live = findOnline(t.id), bal = stats(p).money, ok = amount >= MIN_AMOUNT && amount <= bal;
  const f = make("Pay", SHORT_ROWS); f.self = () => composePage(p, back, t, amount, st);
  const again = () => composePage(p, back, t, amount, st);
  set(f, 0 * COLS + 4, hdr(1) + "\u00a7e\u00a7l" + t.name + "\n\u00a7r" + dot(!!live) + (live ? " \u00a7aOnline" : " \u00a77Offline") + "\n\u00a7r\u00a77Your balance: \u00a7a" + money(bal), ICON.player, null);
  set(f, 2 * COLS + 2, hdr(1) + "\u00a76\u00a7lAmount\n\u00a7r\u00a77Now: " + (amount > 0 ? "\u00a7a" + money(amount) : "\u00a7cnot set") + "\n\u00a7r\u00a7eClick to type a number\n\u00a7r\u00a78Minimum: $1,000  (1k)\n\u00a7r\u00a78Example: 5000  or  50k  or  1.5m", ICON.gold, {
    run: () => {
      const form = new MenuForm().title("Pay " + t.name);
      textField(form, "Amount (example: 5000, 50k, 1.5m)", "50000");
      showModal(p, form, (v) => {
        if (!v) return again();
        const a = parseAmount(v[0]);
        if (a === null) { p.sendMessage(menuMsg(p, "\u00a7c[Pay] Type a valid number, for example 5000 or 50k.")); return again(); }
        if (a < MIN_AMOUNT) { p.sendMessage(menuMsg(p, "\u00a7c[Pay] The minimum payment is \u00a7f" + money(MIN_AMOUNT) + "\u00a7c.")); return again(); }
        composePage(p, back, t, a, st);
      });
    },
  });
  set(f, 2 * COLS + 6, hdr(1, ok ? "g" : "r") + (ok ? "\u00a7a\u00a7lSend " + money(amount) + "\n\u00a7r\u00a77To: \u00a7f" + t.name + "\n\u00a7r\u00a7eClick to continue" : "\u00a7c\u00a7lSend\n\u00a7r" + (amount > bal ? "\u00a7cYou only have " + money(bal) : "\u00a7cType an amount first (min " + money(MIN_AMOUNT) + ")")), NAV.ok, {
    run: () => {
      if (!ok) { p.sendMessage(menuMsg(p, amount > bal ? "\u00a7c[Pay] You don't have enough money." : "\u00a7c[Pay] Click Amount and type a number first (minimum " + money(MIN_AMOUNT) + ").")); return again(); }
      confirmPage(p, back, t, amount, st);
    },
  });
  backBtn(f, () => payPage(p, back, st));
  status(p, f);
  open(p, f);
}

/** step 3: "Do you want to approve?"  ->  Approve */
function confirmPage(p, back, t, amount, st) {
  const live = findOnline(t.id), bal = stats(p).money;
  const f = make("Pay", SHORT_ROWS); f.self = () => confirmPage(p, back, t, amount, st); f.noRefresh = true;
  set(f, 0 * COLS + 4, hdr(1) + "\u00a7e\u00a7lDo you want to approve?\n\u00a7r\u00a77Send to: " + dot(!!live) + " \u00a7f" + t.name + "\n\u00a7r\u00a77Amount: \u00a7a" + money(amount) + "\n\u00a7r\u00a77Balance after: \u00a7f" + money(Math.max(0, bal - amount)), NAV.page, null);
  set(f, 2 * COLS + 2, hdr(1, "g") + "\u00a7a\u00a7lApprove\n\u00a7r\u00a77Send " + money(amount) + " now", NAV.ok, { run: () => { transfer(p, t, amount); } });
  set(f, 2 * COLS + 6, hdr(1, "r") + "\u00a7c\u00a7lCancel\n\u00a7r\u00a77Go back", NAV.no, { run: () => composePage(p, back, t, amount, st) });
  status(p, f);
  open(p, f);
}

/** /pay <player> [amount] (online players) */
export function payTo(p, back, t, rawAmount) {
  { const em = econMsg(p); if (em) return p.sendMessage(menuMsg(p, em)); }
  if (!t || t.id === p.id) return p.sendMessage(menuMsg(p, "\u00a7c[Pay] Choose another player."));
  const st = { tab: "on", page: 0 }, target = { id: t.id, name: t.name };
  if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === "") return composePage(p, back, target, 0, st);
  const a = parseAmount(rawAmount);
  if (a === null) { p.sendMessage(menuMsg(p, "\u00a7c[Pay] Type a valid number, for example 5000 or 50k.")); return composePage(p, back, target, 0, st); }
  if (a < MIN_AMOUNT) { p.sendMessage(menuMsg(p, "\u00a7c[Pay] The minimum payment is \u00a7f" + money(MIN_AMOUNT) + "\u00a7c.")); return composePage(p, back, target, 0, st); }
  if (a > stats(p).money) { p.sendMessage(menuMsg(p, "\u00a7c[Pay] You don't have enough money.")); return composePage(p, back, target, 0, st); }
  confirmPage(p, back, target, a, st);
}
