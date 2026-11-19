// OPERATOR CORE (no menus here, so any system can import it safely)
//  - isStaff(p)    : true only for operators (the 👑 menu is hidden from everybody else)
//  - opAlert(text) : staff notice that is SAVED, so operators who were offline see it when they join (and in 👑 > Alerts)
//  - manual bans   : ban / unban any known player (online or offline), with a duration and a reason
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system, CommandPermissionLevel } from "@minecraft/server";
import { oprMsg } from "./oprlang.js";

const clean = (s) => String(s ?? "").replace(/[§"\\\n\r]/g, "").trim().slice(0, 60);

/** staffcore.js plugs in here: has(playerId) = true when the player was given a staff role (Helper / Mod / Admin) in the Operator menu */
export const staffHook = { has: null, owner: null };
/** operator = Aternos "operator" (game director or higher) OR a player who was given a staff role in the 👑 Operator menu.
 *  Unknown problem -> false (never gives staff rights by mistake) */
export function isStaff(p) {
  try { if (staffHook.has && p && staffHook.has(p.id)) return true; } catch (e) { /* ignore */ }
  try { if (typeof p.isOp === "function" && p.isOp()) return true; } catch (e) { /* not available */ }
  try {
    const l = p.commandPermissionLevel;
    if (typeof l === "number" && typeof CommandPermissionLevel?.GameDirectors === "number" && l >= CommandPermissionLevel.GameDirectors) return true;
  } catch (e) { /* not available */ }
  return false;
}

// ------------------------------------------------------------------ alert inbox (newest first)
const IKEY = "opn:v1", SEEN = "opn:s:", INBOX_MAX = 60, DAY = 86400000;
let inbox = null;
function loadInbox() {
  if (inbox) return inbox;
  try {
    const raw = world.getDynamicProperty(IKEY);
    const a = typeof raw === "string" ? JSON.parse(raw) : [];
    inbox = Array.isArray(a) ? a : [];
  } catch (e) { return null; }                                 // world not ready yet: do nothing (never overwrite saved data)
  return inbox;
}
const saveInbox = () => { try { world.setDynamicProperty(IKEY, JSON.stringify(inbox)); } catch (e) { console.warn("[op] inbox save failed: " + e); } };
const getSeen = (id) => { try { const v = world.getDynamicProperty(SEEN + id); return typeof v === "number" ? v : 0; } catch (e) { return 0; } };
const setSeen = (id, t) => { try { world.setDynamicProperty(SEEN + id, t); } catch (e) { /* ignore */ } };

/** the saved staff alerts: [{ t: time (ms), x: text }], newest first */
export function listAlerts() { return loadInbox() ?? []; }
/** number of alerts this operator has not seen yet */
export function unseenCount(p) { const s = getSeen(p.id); return listAlerts().filter((a) => a.t > s).length; }
export function markAlertsSeen(p) { setSeen(p.id, Date.now()); }

/** Saves a staff alert.  Operators who are online get it now (chat: false = they already got a chat line from the caller), the others get it when they join. */
export function opAlert(text, opts = {}) {
  try {
    const list = loadInbox(); if (!list) return;
    const now = Date.now();
    list.unshift({ t: now, x: String(text) });
    if (list.length > INBOX_MAX) list.length = INBOX_MAX;
    saveInbox();
    for (const p of world.getAllPlayers()) {
      if (!isStaff(p)) continue;
      if (opts.chat !== false) { try { p.sendMessage(oprMsg(p, "§6[Operator] §r" + text)); } catch (e) { /* ignore */ } }
      setSeen(p.id, now);                                         // he saw it live
    }
  } catch (e) { console.warn("[op] alert failed: " + e); }
}

const agoTxt = (ms) => { const s = Math.floor(ms / 1000); return s < 90 ? s + "s" : s < 5400 ? Math.round(s / 60) + "m" : s < 172800 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
function deliver(p) {
  try {
    if (!isStaff(p)) return;
    const now = Date.now(), seen = Math.max(getSeen(p.id), now - 7 * DAY);
    const missed = listAlerts().filter((a) => a.t > seen);
    setSeen(p.id, now);
    if (!missed.length) return;
    p.sendMessage(oprMsg(p, "§6[Operator] §fWhile you were away: §e" + missed.length + " §falert" + (missed.length > 1 ? "s" : "") + " §7(also in /menu > Operator > Alerts)"));
    for (const a of missed.slice(0, 10).reverse()) p.sendMessage(oprMsg(p, "§8" + agoTxt(now - a.t) + " ago §r" + a.x));
    if (missed.length > 10) p.sendMessage(oprMsg(p, "§7... and " + (missed.length - 10) + " older alerts in the Alerts page."));
  } catch (e) { console.warn("[op] deliver failed: " + e); }
}
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    system.runTimeout(() => deliver(player), 100);
  });
} catch (e) { console.warn("[op] join hook not started: " + e); }

// ------------------------------------------------------------------ manual bans
const BKEY = "opban:v1";
let bans = null;                                                 // id -> { n: name, u: until (ms, 0 = permanent), r: reason, by: operator name, t: when }
function loadBans() {
  if (bans) return bans;
  try {
    const raw = world.getDynamicProperty(BKEY);
    const d = typeof raw === "string" ? JSON.parse(raw) : {};
    bans = d && typeof d === "object" ? d : {};
  } catch (e) { return null; }
  return bans;
}
const saveBans = () => { try { world.setDynamicProperty(BKEY, JSON.stringify(bans)); } catch (e) { console.warn("[op] ban save failed: " + e); } };

/** the active manual ban of a player id, or null */
export function banOfId(id) {
  const b = loadBans(); if (!b) return null;
  const x = b[id]; if (!x) return null;
  if (x.u && x.u <= Date.now()) { delete b[id]; saveBans(); return null; }
  return x;
}
/** every active manual ban: [{ id, n, u, r, by, t }] */
export function listManualBans() {
  const b = loadBans(); if (!b) return [];
  const now = Date.now(); let changed = false; const out = [];
  for (const id of Object.keys(b)) {
    if (b[id].u && b[id].u <= now) { delete b[id]; changed = true; continue; }
    out.push({ id, ...b[id] });
  }
  if (changed) saveBans();
  return out;
}
/** ms = 0 -> permanent. Returns false when the data could not be read. */
export function addBan(id, name, ms, reason, by) {
  try { if (staffHook.owner && staffHook.owner(id)) return false; } catch (e) { /* ignore */ }      // the Owner can never be banned
  const b = loadBans(); if (!b) return false;
  b[id] = { n: String(name), u: ms > 0 ? Date.now() + ms : 0, r: clean(reason) || "No reason given", by: String(by ?? "?"), t: Date.now() };
  saveBans();
  return true;
}
export function removeBan(id) {
  const b = loadBans(); if (!b || !b[id]) return false;
  delete b[id]; saveBans(); return true;
}
export function leftText(untilMs, now = Date.now()) {
  if (!untilMs) return "permanent";
  const m = Math.max(1, Math.ceil((untilMs - now) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return ((d ? d + "d " : "") + (h ? h + "h " : "") + (!d ? mm + "m" : "")).trim();
}

const kickedAt = new Map();
function enforce(p, now = Date.now()) {
  const b = banOfId(p.id);
  if (!b || isStaff(p)) return;                                  // operators can never be locked out
  if (now - (kickedAt.get(p.id) ?? 0) < 1000) return;
  kickedAt.set(p.id, now);
  const why = "You are banned by the staff. Reason: " + b.r + ". Time left: " + leftText(b.u, now);
  try { world.getDimension("overworld").runCommand('kick "' + p.name + '" ' + why); }
  catch (e) { try { p.runCommand("kick @s " + why); } catch (e2) { console.warn("[op] kick failed: " + e2); } }
}
/** kicks the player now if he has an active manual ban (used right after banning an online player) */
export function enforceNow(p) { try { enforce(p); } catch (e) { /* ignore */ } }
try {
  system.runInterval(() => {
    const now = Date.now();
    for (const p of world.getAllPlayers()) { try { enforce(p, now); } catch (e) { /* ignore */ } }
  }, 20);
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => { if (initialSpawn) { try { enforce(player); } catch (e) { /* ignore */ } } });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => kickedAt.delete(playerId));
} catch (e) { console.warn("[op] ban loop not started: " + e); }
