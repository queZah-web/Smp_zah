// HOURLY 1 vs 1 DUEL  (the time between rounds is 60 minutes by default; an operator can change it - even to every minute - in Operator > Server & staff > 1 vs 1 Duel)
//  - Every duelEvery() minutes (DUEL.everyMinutes by default) a challenge menu opens for everybody online. A 3-minute countdown starts (action bar + scoreboard).
//  - In the menu: "Fight" (confirm), "Withdraw" (pay the withdraw price, $7,999 by default, an operator can set $999 - $19,999 -> out of the round) or the X (closing only closes the menu: you are STILL in the round and fight). /duel reopens it.
//  - When the countdown ends the fighters are shuffled into groups: pairs (1 vs 1) - and when the number is odd ONE group of 3 (free for all, last one alive wins).
//    Players of the same clan are never in the same group. If only members of ONE clan are online the round is cancelled.
//  - Every group goes to its OWN random place (surface or cave, never inside protected land), at least 5 blocks apart. A place is searched for 30 s, then 30 s more,
//    then 30 s more - after the third failure the round of that group is cancelled (everybody goes back, nothing lost).
//  - 5 seconds protected "get ready", then the fight. Dying = loss (everything drops). Leaving the game during the fight = loss (everything drops where he stood).
//    No winner after DUEL.fightMinutes = draw (everybody goes back). The winner goes back after DUEL.lootSeconds. The winner's name is announced in chat.
//  - Leaving the game during the challenge countdown / before the fight starts / in the last 5 minutes before the round = the withdraw price is charged when he comes back (even below zero).
//  - Players INSIDE the AFK area are never taken into a round. Nobody can enter the AFK area (/afk) in the last 5 minutes before the round, during the countdown or in a fight.
//  - If the server stops / a player leaves in the middle, the saved "way back" brings him home when he is back.
import { clanView } from "./clanstate.js";
import { world, system } from "@minecraft/server";
import { stats, takeMoney, addMoney, playSeconds } from "../data.js";
import { updateHud, hudMode } from "../hud.js";
import { money } from "../format.js";
import { ex } from "../smp/store.js";
import { make, set, open, hdr, COLS, NAV, SHORT_ROWS, status } from "../smp/ui.js";
import { confirmShort } from "./forms.js";
import { clanOf } from "./clans.js";
import { combatHold, combatClear } from "./combat.js";
import { enterSky, leaveSky } from "./locate.js";
import { generated, surfaceAt, caveAt } from "./rtpfind.js";
import { claimAt, claimNear } from "./landcore.js";
import { valid } from "./util.js";
import { duelView, duelHold } from "./duelstate.js";
import { luxDing } from "../lux.js";
import { slog } from "./staffcore.js";
import { inAfkZone } from "./afk.js";
import { addDuelRecord, updateDuelRecord, tally } from "./duellog.js";
import { menuMsg } from "./menulang.js";
import { isAr, pick, freeAr } from "./arextra.js";
import { notice } from "../smp/fxprefs.js";

// ---------------------------------------------------------------- settings (edit here)
export const DUEL = {
  everyMinutes: 60,        // a round every hour
  joinSeconds: 180,        // countdown before the fights start (3 minutes)
  withdrawPrice: 7999,     // DEFAULT $ to get out of a round (an operator can change it: DUEL_LIMITS.priceMin - priceMax) (also charged to a player who leaves the game to escape)
  readySeconds: 5,         // protected seconds after arriving
  fightMinutes: 5,         // no winner after this long = draw
  lootSeconds: 30,         // the winner stays this long before going back (loot)
  caveChance: 0.35,        // chance that a group fights in a cave (otherwise on the surface)
  min: 300, max: 8000,     // distance from 0,0 of the random places
  apart: 5,                // fighters are at least this many blocks from each other
  searchSeconds: 30,       // time to find a safe place (up to 3 times)
  immuneHours: 2,          // new players are not taken into the duels during their first hours of play time
  afkMinutes: 5,           // a player who did not move at all for this long is not taken into the round
  escapeWindowMinutes: 5,  // the last minutes before the duel: nobody can enter the AFK area, and leaving the game (or at any time during the countdown) = the withdraw price is charged when he comes back
  escapeReturnMinutes: 30, // ...if he comes back within this time after the fight started
};
export const DUEL_LIMITS = { min: 1, max: 10080, immuneMax: 10080, lockMin: 1, lockMax: 15, priceMin: 999, priceMax: 19999 };   // lockMin / lockMax = minutes before the duel when /afk is locked (an operator chooses 1-15)
   // minutes between two rounds that an operator may choose (1 minute ... 7 days)
const LOAD_TICKS = DUEL.searchSeconds * 20, MAX_TRIES = 3;
const RADIUS = 32, CAVE_SAMPLES = 300, CAVE_RADIUS = 40, CLAIM_GAP = 24;

const dimOf = () => world.getDimension("overworld");
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const sec = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(t / 60); return m > 0 ? m + "m" + String(t % 60).padStart(2, "0") + "s" : t + "s"; };   // no ":" (the scoreboard protocol uses it)
const find = (id) => world.getAllPlayers().find((p) => p.id === id);
const tell = (p, m) => { try { p.sendMessage(menuMsg(p, m)); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[duel] " + name + ": " + e); } };

// ---------------------------------------------------------------- state
let nextAt = null;                 // ms - when the next round starts (saved in the world, so a restart does not reset it)
let round = null;                  // { endAt, parts: Map id -> { out: bool, yes: bool }, started: bool }
const matches = [];                // running fights  { ps: [{id,name,st,alive}], state: "load"|"ready"|"fight"|"over", ... }
const inMatch = (id) => matches.find((m) => m.state !== "over" && m.ps.some((s) => s.id === id)) ?? null;
const activeIn = (id) => matches.find((m) => m.state !== "over" && m.ps.some((s) => s.id === id && s.alive)) ?? null;

function readNext() { try { const v = world.getDynamicProperty("duel:next"); if (typeof v === "number") return v; } catch (e) { /* ignore */ } return null; }
function readLast() { try { const v = world.getDynamicProperty("duel:last"); if (typeof v === "number") return v; } catch (e) { /* ignore */ } return 0; }
function saveLast(v) { try { world.setDynamicProperty("duel:last", v); } catch (e) { /* ignore */ } }
function saveNext() { try { world.setDynamicProperty("duel:next", nextAt); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- ON / OFF (Operator > Server & staff > 1 vs 1 Duel, permission "duelset")
// OFF = no new hourly round starts (the timer keeps rolling). A countdown that is still open is cancelled (nothing is charged); fights already running finish normally.
let enabled = null;
export function duelOn() {
  if (enabled === null) { try { enabled = world.getDynamicProperty("duel:on") !== false; } catch (e) { return true; } }
  return enabled;
}
/** the caller checks allow(p, "duelset").  Returns { ok, on } or { err } */
export function setDuelOn(actor, on) {
  try {
    on = !!on;
    try { world.setDynamicProperty("duel:on", on); } catch (e) { return { err: "Could not save." }; }
    enabled = on;
    if (!on && round && !round.started) {
      for (const id of round.parts.keys()) { const p = find(id); if (p) tell(p, "§e[Duel] The 1 vs 1 was cancelled by an operator. Nothing was lost."); }
      round = null;
    }
    try { slog(actor, "duelset", null, on ? "1 vs 1 duel ON" : "1 vs 1 duel OFF"); } catch (e) { /* ignore */ }
    try { world.sendMessage("§c[Duel] §fThe hourly 1 vs 1 is now " + (on ? "§aON" : "§cOFF") + "§f."); } catch (e) { /* ignore */ }
    return { ok: true, on };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- NEW PLAYER PROTECTION (Operator > Server & staff > 1 vs 1 Duel, permission "duelset")
// A new player is not taken into the duels during his first minutes of play time (DUEL.immuneHours = 2 hours until an operator changes it).
// duelImmuneOn()  = is the protection active (an operator can switch it OFF and back ON; the time is kept)
// duelImmuneMin() = how long it lasts, in minutes of play time (saved in the world)
let immOn = null, immMin = null;
export function duelImmuneOn() {
  if (immOn === null) { try { immOn = world.getDynamicProperty("duel:immuneOn") !== false; } catch (e) { return true; } }
  return immOn;
}
export function duelImmuneMin() {
  if (immMin === null) {
    let v = null; try { v = world.getDynamicProperty("duel:immuneMin"); } catch (e) { /* ignore */ }
    immMin = typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= DUEL_LIMITS.immuneMax ? v : Math.round(DUEL.immuneHours * 60);
  }
  return immMin;
}
/** the caller checks allow(p, "duelset").  Returns { ok, on } or { err } */
export function setDuelImmuneOn(actor, on) {
  try {
    on = !!on;
    try { world.setDynamicProperty("duel:immuneOn", on); } catch (e) { return { err: "Could not save." }; }
    immOn = on;
    try { slog(actor, "duelset", null, "duel new-player protection " + (on ? "ON" : "OFF")); } catch (e) { /* ignore */ }
    return { ok: true, on };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** the caller checks allow(p, "duelset").  Returns { ok, minutes } or { err } */
export function setDuelImmuneMin(actor, minutes) {
  try {
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > DUEL_LIMITS.immuneMax) return { err: "Type a whole number from 1 to " + DUEL_LIMITS.immuneMax + " minutes." };
    try { world.setDynamicProperty("duel:immuneMin", minutes); } catch (e) { return { err: "Could not save." }; }
    immMin = minutes;
    try { slog(actor, "duelset", null, "duel new-player protection = " + minutes + " min"); } catch (e) { /* ignore */ }
    return { ok: true, minutes };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- AFK LOCK TIME (Operator > Server & staff > 1 vs 1 Duel, permission "duelset")
// How many minutes before the round nobody can enter the AFK area (and leaving the game costs the withdraw price).  1 - 15 minutes, 5 by default.
let lockMin = null;
export function duelAfkLockMin() {
  if (lockMin === null) {
    let v = null; try { v = world.getDynamicProperty("duel:afkLockMin"); } catch (e) { /* ignore */ }
    lockMin = typeof v === "number" && Number.isInteger(v) && v >= DUEL_LIMITS.lockMin && v <= DUEL_LIMITS.lockMax ? v : DUEL.escapeWindowMinutes;
  }
  return lockMin;
}
/** the caller checks allow(p, "duelset").  Returns { ok, minutes } or { err } */
export function setDuelAfkLockMin(actor, minutes) {
  try {
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < DUEL_LIMITS.lockMin || minutes > DUEL_LIMITS.lockMax) return { err: "Type a whole number from " + DUEL_LIMITS.lockMin + " to " + DUEL_LIMITS.lockMax + " minutes." };
    try { world.setDynamicProperty("duel:afkLockMin", minutes); } catch (e) { return { err: "Could not save." }; }
    lockMin = minutes;
    try { slog(actor, "duelset", null, "duel AFK lock = " + minutes + " min before the round"); } catch (e) { /* ignore */ }
    return { ok: true, minutes };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- WITHDRAW PRICE (Operator > Server & staff > 1 vs 1 Duel, permission "duelset")
// What the WITHDRAW button costs (also charged to a player who leaves the game to escape).  $7,999 by default, an operator can choose $999 - $19,999.
let wPrice = null;
export function duelWithdrawPrice() {
  if (wPrice === null) {
    let v = null; try { v = world.getDynamicProperty("duel:withdrawPrice"); } catch (e) { /* ignore */ }
    wPrice = typeof v === "number" && Number.isInteger(v) && v >= DUEL_LIMITS.priceMin && v <= DUEL_LIMITS.priceMax ? v : DUEL.withdrawPrice;
  }
  return wPrice;
}
/** the caller checks allow(p, "duelset").  Returns { ok, price } or { err } */
export function setDuelWithdrawPrice(actor, price) {
  try {
    if (typeof price !== "number" || !Number.isInteger(price) || price < DUEL_LIMITS.priceMin || price > DUEL_LIMITS.priceMax) return { err: "Type a whole number from " + money(DUEL_LIMITS.priceMin) + " to " + money(DUEL_LIMITS.priceMax) + "." };
    try { world.setDynamicProperty("duel:withdrawPrice", price); } catch (e) { return { err: "Could not save." }; }
    wPrice = price;
    try { slog(actor, "duelset", null, "duel withdraw price = " + money(price)); } catch (e) { /* ignore */ }
    return { ok: true, price };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- EXCLUDED PLAYERS (Operator > Server & staff > 1 vs 1 Duel > Excluded players, permission "duelset")
// Players on this list are never taken into the duels (online or offline: the list is kept by player id). An operator adds / removes them.
const EXCL_MAX = 200;
let excl = null;                                              // [{ id, n }]
function exclList() {
  if (excl === null) {
    excl = [];
    try { const raw = world.getDynamicProperty("duel:excl"); if (typeof raw === "string") { const a = JSON.parse(raw); if (Array.isArray(a)) excl = a.filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, n: String(x.n ?? "?") })); } } catch (e) { excl = []; }
  }
  return excl;
}
function saveExcl() { try { world.setDynamicProperty("duel:excl", JSON.stringify(exclList())); return true; } catch (e) { return false; } }
export const duelExcluded = () => exclList().map((x) => ({ id: x.id, n: x.n }));
export const isDuelExcludedId = (id) => exclList().some((x) => x.id === id);
const isExcluded = (p) => { try { return isDuelExcludedId(p.id); } catch (e) { return false; } };
/** the caller checks allow(p, "duelset").  Returns { ok } or { err } */
export function addDuelExcluded(actor, id, name) {
  try {
    id = String(id ?? ""); name = String(name ?? "?");
    if (!id) return { err: "No player." };
    const l = exclList();
    if (l.some((x) => x.id === id)) return { err: name + " is already on the list." };
    if (l.length >= EXCL_MAX) return { err: "The list is full (" + EXCL_MAX + " players)." };
    l.push({ id, n: name });
    if (!saveExcl()) { l.pop(); return { err: "Could not save." }; }
    // an open countdown: he is taken out for free (nothing is charged)
    try { const e = round && !round.started ? round.parts.get(id) : null; if (e && !e.out) { e.out = true; const p = find(id); if (p) tell(p, "§e[Duel] An operator excluded you from the 1 vs 1. You are out of this round, nothing was charged."); } } catch (e) { /* ignore */ }
    try { const p = find(id); if (p) tell(p, "§a[Duel] An operator excluded you from the hourly 1 vs 1 duels."); } catch (e) { /* ignore */ }
    try { slog(actor, "duelset", null, "duel: excluded " + name); } catch (e) { /* ignore */ }
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** the caller checks allow(p, "duelset").  Returns { ok } or { err } */
export function removeDuelExcluded(actor, id) {
  try {
    const l = exclList(), i = l.findIndex((x) => x.id === id);
    if (i < 0) return { err: "He is not on the list." };
    const [gone] = l.splice(i, 1);
    if (!saveExcl()) { l.splice(i, 0, gone); return { err: "Could not save." }; }
    try { const p = find(id); if (p) tell(p, "§e[Duel] You are no longer excluded from the hourly 1 vs 1 duels."); } catch (e) { /* ignore */ }
    try { slog(actor, "duelset", null, "duel: exclusion removed for " + gone.n); } catch (e) { /* ignore */ }
    return { ok: true, name: gone.n };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- WHEN the round starts (Operator > Server & staff > 1 vs 1 Duel, permission "duelset")
// duelEvery()  = minutes between two rounds (saved in the world; DUEL.everyMinutes until an operator changes it)
// setDuelEvery = change that time; the next round is then counted from NOW with the new time
// setDuelNextIn = only move the NEXT round (it starts in x minutes), the normal time between rounds stays the same
// A countdown / fight that is already running is never touched.
let every = null;
export function duelEvery() {
  if (every === null) {
    let v = null; try { v = world.getDynamicProperty("duel:every"); } catch (e) { /* ignore */ }
    every = typeof v === "number" && Number.isInteger(v) && v >= DUEL_LIMITS.min && v <= DUEL_LIMITS.max ? v : DUEL.everyMinutes;
  }
  return every;
}
/** "1 minute" / "45 minutes" / "2 hours" / "1 hour 30 min" */
export function minutesText(n) {
  n = Math.max(0, Math.round(n));
  if (n < 60) return n + " minute" + (n === 1 ? "" : "s");
  const h = Math.floor(n / 60), m = n % 60;
  return h + " hour" + (h === 1 ? "" : "s") + (m ? " " + m + " min" : "");
}
/** ms until the next round starts (null = not known yet) */
export function duelNextMs() { return nextAt === null ? null : Math.max(0, nextAt - Date.now()); }
export function duelRoundOpen() { return !!round || matches.some((m) => m.state !== "over"); }
const okMinutes = (n) => typeof n === "number" && Number.isInteger(n) && n >= DUEL_LIMITS.min && n <= DUEL_LIMITS.max;
const rangeText = () => "a whole number from " + DUEL_LIMITS.min + " to " + DUEL_LIMITS.max + " minutes";
/** the caller checks allow(p, "duelset").  Returns { ok, minutes } or { err } */
export function setDuelEvery(actor, minutes) {
  try {
    if (!okMinutes(minutes)) return { err: "Type " + rangeText() + "." };
    try { world.setDynamicProperty("duel:every", minutes); } catch (e) { return { err: "Could not save." }; }
    every = minutes;
    nextAt = Date.now() + minutes * 60000; saveNext();
    try { slog(actor, "duelset", null, "1 vs 1 duel every " + minutes + " min"); } catch (e) { /* ignore */ }
    try { world.sendMessage("§c[Duel] §fThe 1 vs 1 now starts every §e" + minutesText(minutes) + "§f." + (duelOn() ? " Next one in §e" + minutesText(minutes) + "§f." : " §7(it is OFF right now)")); } catch (e) { /* ignore */ }
    return { ok: true, minutes };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** the caller checks allow(p, "duelset").  Returns { ok, minutes } or { err } */
export function setDuelNextIn(actor, minutes) {
  try {
    if (!okMinutes(minutes)) return { err: "Type " + rangeText() + "." };
    if (duelRoundOpen()) return { err: "A round is running right now. Change the time after it ends." };
    nextAt = Date.now() + minutes * 60000; saveNext();
    try { slog(actor, "duelset", null, "next 1 vs 1 duel in " + minutes + " min"); } catch (e) { /* ignore */ }
    try { if (duelOn()) world.sendMessage("§c[Duel] §fThe next 1 vs 1 starts in §e" + minutesText(minutes) + "§f."); } catch (e) { /* ignore */ }
    return { ok: true, minutes };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- AFK (nobody who did not move AT ALL for 5 minutes is taken into a round)
const act = new Map();            // player id -> { t: last time he was active, + what was seen last time }
const ang = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function sampleAfk(p) {
  let riding = false; try { riding = !!p.getComponent("minecraft:riding")?.entityRidingOn; } catch (e) { /* ignore */ }
  let jump = false; try { jump = !!p.isJumping; } catch (e) { /* ignore */ }
  const l = p.location, r = p.getRotation(), cur = { x: l.x, y: l.y, z: l.z, rx: r.x, ry: r.y, slot: p.selectedSlotIndex, sn: !!p.isSneaking }, a = act.get(p.id);
  if (!a) { act.set(p.id, { ...cur, t: Date.now() }); return; }
  let moved = jump || Math.abs(cur.rx - a.rx) > 0.3 || ang(cur.ry, a.ry) > 0.3 || cur.slot !== a.slot || cur.sn !== a.sn;
  if (!riding && (Math.abs(cur.x - a.x) > 0.05 || Math.abs(cur.y - a.y) > 0.05 || Math.abs(cur.z - a.z) > 0.05)) moved = true;   // a boat / minecart carrying him is not "moving"
  Object.assign(a, cur); if (moved) a.t = Date.now();
}
const isAfk = (p) => { const a = act.get(p.id); return !!a && Date.now() - a.t >= DUEL.afkMinutes * 60000; };
const seen = (p) => { const a = act.get(p?.id); if (a) a.t = Date.now(); };          // he did something (break / place / use / hit)
for (const [ev, get] of [["playerBreakBlock", (e) => e.player], ["playerPlaceBlock", (e) => e.player], ["itemUse", (e) => e.source], ["playerInteractWithBlock", (e) => e.player]]) {
  try { world.afterEvents[ev].subscribe((e) => seen(get(e))); } catch (e) { /* ignore */ }
}
try { world.afterEvents.entityHitEntity.subscribe((e) => { if (e.damagingEntity?.typeId === "minecraft:player") seen(e.damagingEntity); }); } catch (e) { /* ignore */ }
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => act.delete(playerId)); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- new player immunity + the big centered message
const immuneLeft = (p) => { try { if (!duelImmuneOn()) return 0; return Math.max(0, duelImmuneMin() * 60 - playSeconds(p)); } catch (e) { return 0; } };
const isImmune = (p) => immuneLeft(p) > 0;
const banners = new Map();                                   // player id -> { until, marker, text }
/** "You have 2 free hours of immunity in Duel combat." shown in the middle of the screen for a few seconds (the side-panel players get it through the scoreboard UI, the others as a title) */
function showBanner(p) {
  const left = immuneLeft(p); if (left <= 0) return;
  const total = duelImmuneMin() * 60, full = left >= total - 120;
  const leftMin = Math.max(1, Math.ceil(left / 60));
  const nice = (m) => m >= 60 ? Math.floor(m / 60) + " free hour" + (Math.floor(m / 60) === 1 ? "" : "s") + (m % 60 ? " " + (m % 60) + " min" : "") : m + " free minute" + (m === 1 ? "" : "s");
  const T = full ? nice(Math.round(total / 60)) : nice(leftMin);
  // the side panel has fixed texts ("2 free hours" and 1-119 free minutes): use it only when it says the right thing, else the title in the middle shows it
  const n = full ? 0 : leftMin;
  const panelOk = (full ? Math.round(total / 60) === 120 : leftMin <= 119) && !isAr(p);   // the side panel has English-only fixed texts: Arabic players get the Arabic title in the middle
  const marker = "QQBAN" + (n === 0 ? "QQBHQ" : "QQB" + n + "Q");
  const mode = hudMode(p);
  if (mode !== "bar" && panelOk) banners.set(p.id, { until: Date.now() + 8000, marker });
  if (mode === "bar" || !panelOk) { try { p.onScreenDisplay.setTitle(isAr(p) ? pick(p, "", "§8◆ ─────── ◆\n§fلديك §a§l" + freeAr(full ? Math.round(total / 60) : leftMin) + "§r\n§fمن §a§lالحصانة§r§f في قتال المبارزة.\n§8◆ ─────── ◆", 30) : "§8◆ ─────── ◆\n§fYou have §a§l" + T + "§r\n§fof §a§limmunity§r§f in Duel combat.\n§8◆ ─────── ◆", { fadeInDuration: 5, stayDuration: 120, fadeOutDuration: 20 }); } catch (e) { /* ignore */ } }
  else updateHud(p, true);
}
duelView.banner = (p) => { const b = banners.get(p.id); if (!b) return null; if (Date.now() > b.until) { banners.delete(p.id); return null; } return b.marker; };

// ---------------------------------------------------------------- what the scoreboard / action bar show
duelView.field = (p) => {
  const now = Date.now(), m = inMatch(p.id);
  if (m) return m.state === "fight" ? "Duel " + sec(m.endAt - now) : m.state === "ready" ? "Go " + sec(m.readyAt - now) : "Loading";
  if (round && !round.started) { const e = round.parts.get(p.id); return e && !e.out ? "Join " + sec(round.endAt - now) : e ? "Out" : "Busy"; }
  if (round) return "Busy";
  return nextAt ? sec(nextAt - now) : "";
};
duelView.bar = (p) => {
  const now = Date.now(), m = inMatch(p.id);
  if (m) {
    if (m.state === "ready") return "§c⚔ Fight starts in: §f" + clock(m.readyAt - now);
    if (m.state === "fight") return "§c⚔ Duel ends in: §f" + clock(m.endAt - now);
    return null;
  }
  if (round && !round.started) { const e = round.parts.get(p.id); if (e && !e.out) return "§c⚔ 1 vs 1 starts in: §f" + clock(round.endAt - now); }
  return null;
};

// ---------------------------------------------------------------- the challenge menu
export function duelPage(p) {
  if (!duelOn() && (!round || round.started)) return tell(p, "§e[Duel] The 1 vs 1 duel is turned off by the operators.");
  if (!round || round.started) {
    return tell(p, "§e[Duel] No challenge is open now. The next 1 vs 1 starts in §f" + (nextAt ? clock(nextAt - Date.now()) : "?") + "§e.");
  }
  const e = round.parts.get(p.id);
  if (!e) return tell(p, "§e[Duel] You are not in this round.");
  if (e.out) return tell(p, "§e[Duel] You withdrew from this round.");
  const f = make("1 vs 1 Duel", SHORT_ROWS); f.self = () => duelPage(p);
  const bal = stats(p).money, price = duelWithdrawPrice(), left = clock(round.endAt - Date.now());
  set(f, 0 * COLS + 4, hdr(1) + "§c§l⚔ 1 vs 1 DUEL\n§r§7Starts in §f" + left + "\n§r§7You fight a random player\n§r§7in a random place.\n§r§7Closing this window does NOT\n§r§7cancel it - you still fight.", "textures/items/diamond_sword", null);
  set(f, 2 * COLS + 2, hdr(1, "g") + "§a§lFIGHT\n§r§7I accept the challenge\n§r" + (e.yes ? "§aYou are ready" : "§eClick to confirm"), NAV.ok, { run: () => accept(p) });
  set(f, 2 * COLS + 6, hdr(1, bal >= price ? "g" : "r") + "§6§lWITHDRAW\n§r§7Pay §a" + money(price) + " §7to stay out\n§r" + (bal >= price ? "§eClick to pay" : "§cNeed " + money(price - bal) + " more"), NAV.no, { run: () => withdrawAsk(p) });
  status(p, f);
  open(p, f);
}
function accept(p) {
  const e = round && !round.started ? round.parts.get(p.id) : null; if (!e || e.out) return;
  e.yes = true;
  tell(p, "§a[Duel] You accepted. The fight starts when the counter ends §7(" + clock(round.endAt - Date.now()) + ")");
}
function withdrawAsk(p) {
  const e = round && !round.started ? round.parts.get(p.id) : null; if (!e || e.out) return;
  const price = duelWithdrawPrice();
  if (stats(p).money < price) { tell(p, "§c[Duel] You need §f" + money(price - stats(p).money) + " §cmore to withdraw."); return duelPage(p); }
  confirmShort(p, "Withdraw", ["§7Pay §a" + money(price) + " §7and stay out", "§7of this 1 vs 1 round?", "§7Your balance: §a" + money(stats(p).money)], () => withdraw(p), () => duelPage(p));
}
function withdraw(p) {
  const e = round && !round.started ? round.parts.get(p.id) : null;       // checked again: the round may have started while the page was open
  if (!e || e.out) { tell(p, "§e[Duel] Too late - the round is already running or you are out."); return; }
  if (!takeMoney(p, duelWithdrawPrice())) { tell(p, "§c[Duel] Not enough money."); return; }
  e.out = true;
  tell(p, "§a[Duel] You paid §e" + money(duelWithdrawPrice()) + " §aand withdrew. You will not fight this round.");
  luxDing(p);
}

// ---------------------------------------------------------------- starting a round
function eligible(p) {
  try { const g = String(p.getGameMode?.() ?? "").toLowerCase(); if (g === "creative" || g === "spectator") return false; } catch (e) { /* ignore */ }
  return true;
}
const clanId = (p) => { try { return clanOf(p)?.id ?? null; } catch (e) { return null; } };
const sameClan = (a, b) => { const x = clanId(a); return !!x && x === clanId(b); };
/** only members of ONE clan (nobody without a clan, nobody from another clan) -> nobody could fight */
const onlyOneClan = (list) => list.length > 0 && list.every((p) => clanId(p) && clanId(p) === clanId(list[0]));

function startRound() {
  const everyone = world.getAllPlayers().filter((p) => valid(p) && eligible(p) && !inMatch(p.id));
  const all = everyone.filter((p) => !isImmune(p) && !isExcluded(p) && !inAfkZone(p));   // players INSIDE the AFK area are not taken into the duel
  const list = all.filter((p) => !isAfk(p));
  for (const p of everyone) if (isImmune(p)) showBanner(p);       // new players: not in the duel, and reminded how long it lasts
  for (const p of all) if (!list.includes(p)) tell(p, "§e[Duel] You were skipped in the hourly 1 vs 1: you did not move for " + DUEL.afkMinutes + " minutes.");
  if (list.length < 2) return;                                           // nobody to fight: skip this hour silently
  if (onlyOneClan(list)) { notice("duel", "§e[Duel] The hourly 1 vs 1 was cancelled: all players online are in the same clan."); return; }
  round = { endAt: Date.now() + DUEL.joinSeconds * 1000, parts: new Map(list.map((p) => [p.id, { out: false, yes: false }])), started: false };
  saveLast(round.endAt);
  notice("duel", "§c§l⚔ 1 vs 1 DUEL §r§7- the hourly challenge is open! The fights start in §f" + clock(DUEL.joinSeconds * 1000) + "§7. Withdraw costs §a" + money(duelWithdrawPrice()) + "§7.");
  for (const p of list) system.runTimeout(() => safe("menu", () => { if (valid(p) && round && !round.started && !round.parts.get(p.id)?.out) duelPage(p); }), 5);
}

// ---------------------------------------------------------------- groups: pairs, and ONE group of 3 when the number is odd (never two players of the same clan together)
function groupUp(players) {
  const n = players.length, odd = n % 2 === 1;
  let best = null;
  for (let t = 0; t < 60; t++) {
    const pool = players.slice().sort(() => Math.random() - 0.5), groups = [], left = [];
    let wantTrio = odd && n >= 3, trio = false;
    while (pool.length) {
      const x = pool.shift(), g = [x], target = wantTrio ? 3 : 2;
      for (let i = 0; i < pool.length && g.length < target;) {
        if (g.every((z) => !sameClan(z, pool[i]))) g.push(pool.splice(i, 1)[0]); else i++;
      }
      if (g.length >= 2) { groups.push(g); if (g.length === 3) { wantTrio = false; trio = true; } } else left.push(x);
    }
    const score = groups.reduce((a, g) => a + g.length, 0) * 10 + (odd && trio ? 1 : 0);
    if (!best || score > best.score) best = { groups, left, score };
    if (!left.length && (!odd || trio)) break;
  }
  return best;
}
function finishCountdown() {
  const r = round; r.started = true;
  let ps = [...r.parts].filter(([, e]) => !e.out).map(([id]) => find(id)).filter((p) => p && valid(p) && eligible(p) && !inMatch(p.id));
  ps = ps.filter((p) => !inAfkZone(p));                                  // (cannot happen: /afk is locked) but never take anybody out of the AFK area
  for (const p of ps.filter(isAfk)) tell(p, "§e[Duel] You were skipped: you did not move for " + DUEL.afkMinutes + " minutes. Nothing was lost.");
  ps = ps.filter((p) => !isAfk(p));
  const stop = (msg) => { for (const p of ps) tell(p, msg); round = null; };
  if (ps.length < 2) return stop("§e[Duel] Nobody else is fighting this round. Next 1 vs 1 in " + minutesText(duelEvery()) + ".");
  if (onlyOneClan(ps)) return stop("§e[Duel] The round was cancelled: only members of one clan are left. Nothing was lost.");
  const { groups, left } = groupUp(ps);
  for (const p of left) tell(p, "§e[Duel] No opponent for you this round (clan members never fight each other). Nothing was lost.");
  if (!groups.length) { round = null; return; }
  let delay = 0;
  for (const g of groups) { system.runTimeout(() => safe("match", () => startMatch(g)), delay); delay += 10; }
  system.runTimeout(() => { round = null; }, delay + 2);
}

// ---------------------------------------------------------------- finding the places
const spotOk = (dim, r) => !!r && !claimNear(dim.id, r.x, r.y, r.z, CLAIM_GAP) && !claimAt(dim.id, r.x, r.y, r.z);
function randomXZ() {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random() * (DUEL.max * DUEL.max - DUEL.min * DUEL.min) + DUEL.min * DUEL.min);
  return [Math.floor(Math.cos(a) * r), Math.floor(Math.sin(a) * r)];
}
// spot | null (nothing usable around x,z) | undefined (not ready / not loaded yet)
function findSpot(dim, m) {
  const x = m.x, z = m.z, gen = generated(dim, x, z);
  if (gen === null) return undefined;
  if (gen === false) { m.readyTick ??= system.currentTick; if (system.currentTick - m.readyTick < 60) return undefined; }
  if (m.cave) {
    for (let i = 0; i < 16; i++) {
      const sx = x + Math.floor((Math.random() * 2 - 1) * CAVE_RADIUS), sz = z + Math.floor((Math.random() * 2 - 1) * CAVE_RADIUS);
      if (generated(dim, sx, sz) !== true && gen !== false) continue;
      const r = caveAt(dim, sx, sz);
      if (r === undefined) continue;
      if (spotOk(dim, r)) return r;
      if (++m.samples >= CAVE_SAMPLES) return null;
    }
    return undefined;
  }
  m.offs ??= (() => { const a = []; for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) if (dx * dx + dz * dz <= RADIUS * RADIUS) a.push([dx, dz, dx * dx + dz * dz]); return a.sort((p, q) => p[2] - q[2]); })();
  m.idx ??= 0;
  for (let i = 0; i < 120 && m.idx < m.offs.length; i++) {
    const o = m.offs[m.idx], r = surfaceAt(dim, x + o[0], z + o[1]);
    if (r === undefined) { if (m.idx === 0) return undefined; m.idx++; continue; }
    if (spotOk(dim, r)) return r;
    m.idx++;
  }
  return m.idx >= m.offs.length ? null : undefined;
}
/** one safe spot for EVERY fighter: the first one is `r`, the others are 5-12 blocks from it and at least DUEL.apart blocks from each other. null = not possible here */
function spotsFor(dim, m, r) {
  const out = [r];
  while (out.length < m.ps.length) {
    let got = null;
    for (let i = 0; i < 120 && !got; i++) {
      const a = Math.random() * Math.PI * 2, d = DUEL.apart + Math.random() * (m.cave ? 5 : 8), sx = Math.floor(r.x + Math.cos(a) * d), sz = Math.floor(r.z + Math.sin(a) * d);
      let s; try { s = m.cave ? caveAt(dim, sx, sz) : surfaceAt(dim, sx, sz); } catch (e) { s = null; }
      if (!s || !spotOk(dim, s) || Math.abs(s.y - r.y) > (m.cave ? 4 : 12)) continue;
      if (out.every((o) => Math.hypot(s.x - o.x, s.z - o.z) >= DUEL.apart)) got = s;
    }
    if (!got) return null;
    out.push(got);
  }
  return out;
}

// ---------------------------------------------------------------- items
function equipSlots() { return ["Head", "Chest", "Legs", "Feet", "Offhand"]; }
/** a copy of everything the player carries (inventory + armor + offhand) */
function collect(p) {
  const items = [];
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it) items.push(it.clone()); } } catch (e) { /* ignore */ }
  try { const eq = p.getComponent("minecraft:equippable"); for (const s of equipSlots()) { const it = eq?.getEquipment(s); if (it) items.push(it.clone()); } } catch (e) { /* ignore */ }
  return { items, dim: p.dimension, loc: { x: p.location.x, y: p.location.y, z: p.location.z } };
}
function emptyAll(p) {
  try { p.getComponent("minecraft:inventory").container.clearAll(); } catch (e) { /* ignore */ }
  try { const eq = p.getComponent("minecraft:equippable"); for (const s of equipSlots()) eq?.setEquipment(s, undefined); } catch (e) { /* ignore */ }
}
/** drops the items; pk.ents keeps every dropped stack { e: entity, k: item, n: amount } so the duel log can tell what the winner picked up afterwards */
function dropPack(pk) {
  pk.ents = pk.ents ?? [];
  for (const it of pk.items) { try { pk.ents.push({ e: pk.dim.spawnItem(it, pk.loc), k: String(it.typeId).replace("minecraft:", ""), n: it.amount ?? 1 }); } catch (e) { /* ignore */ } }
}
/** a player who died in a duel: whatever is still on him (keep inventory) falls right where he died */
function dropAll(p) { const pk = collect(p); if (pk.items.length) { emptyAll(p); dropPack(pk); } return pk; }

// ---------------------------------------------------------------- inventory snapshots for the duel log: [[slot, item, amount], ...]  slots 0-35 = inventory (0-8 hotbar), 36-39 = head / chest / legs / feet, 40 = off hand
// (without "keep inventory" the game has already dropped everything when the death event arrives, so the last snapshot taken during the fight is what he carried)
function snapOf(p) {
  const out = [];
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it) out.push([i, String(it.typeId).replace("minecraft:", ""), it.amount ?? 1]); } } catch (e) { /* ignore */ }
  try { const eq = p.getComponent("minecraft:equippable"); equipSlots().forEach((sl, i) => { const it = eq?.getEquipment(sl); if (it) out.push([36 + i, String(it.typeId).replace("minecraft:", ""), it.amount ?? 1]); }); } catch (e) { /* ignore */ }
  return out;
}
const lastInv = new Map();               // player id -> his last snapshot during a fight
const tallyInv = (inv) => tally((inv ?? []).map((x) => ({ typeId: x[1], amount: x[2] })));
const snapFighters = () => { for (const m of matches) { if (m.state !== "fight") continue; for (const s of m.ps) { if (!s.alive) continue; const p = find(s.id); if (p) safe("snap", () => lastInv.set(s.id, snapOf(p))); } } };
system.runInterval(() => safe("snapshots", snapFighters), 5);
safe("hurt snap", () => world.afterEvents.entityHurt.subscribe((ev) => {      // the hit just before a death: the inventory is still complete
  const h = ev.hurtEntity; if (h?.typeId !== "minecraft:player") return;
  const m = activeIn(h.id); if (m && m.state === "fight") lastInv.set(h.id, snapOf(h));
}));

// ---------------------------------------------------------------- a match: find a place, go there, ready, fight, end
const wayBack = (p) => (ex(p).duelBack ?? null);
function sendBack(p) {                                    // put a player where he was before the duel
  const b = wayBack(p); if (!b) return;
  try { p.teleport({ x: b.x, y: b.y, z: b.z }, { dimension: world.getDimension(b.d) }); } catch (e) { return; }
  delete ex(p).duelBack;
}
function clearSky(p) { try { p.removeEffect("slow_falling"); } catch (e) { /* ignore */ } try { p.removeEffect("resistance"); } catch (e) { /* ignore */ } }
const names = (m, except) => m.ps.filter((s) => s.id !== except).map((s) => s.name).join(" & ");

function startMatch(group) {
  if (group.some((p) => !valid(p) || inMatch(p.id))) { for (const p of group) if (valid(p)) tell(p, "§c[Duel] An opponent is not available. No fight this round."); return; }
  const dim = dimOf(), [x, z] = randomXZ();
  const m = { ps: group.map((p) => ({ id: p.id, name: p.name, st: { sky: false }, alive: true })), state: "load", x, z, cave: Math.random() < DUEL.caveChance, samples: 0, attempt: 1, t0: system.currentTick, handle: null };
  matches.push(m);
  for (const p of group) {                                 // remember the way back (saved with the player: survives restart / leaving)
    const l = p.location; ex(p).duelBack = { x: l.x, y: l.y, z: l.z, d: p.dimension.id };
    tell(p, "§c[Duel] §fThe fight is starting - " + (group.length === 3 ? "free for all against §e" : "you fight §e") + names(m, p.id) + "§f. Searching a place...");
  }
  for (const p of group) combatHold(p);                    // from now on no teleport command works for them (the tag is refreshed every second)
  try { for (const s of m.ps) enterSky(find(s.id), dim, x, z, s.st); } catch (e) { return cancel(m, "§c[Duel] Could not start the fight. Nothing was lost."); }
  m.handle = system.runInterval(() => safe("load", () => load(m, dim)), 5);
}
/** the place was not found in time / around this spot: 30 more seconds at a NEW random spot, at most 3 tries, then the round is cancelled */
function nextTry(m, dim, why) {
  if (m.attempt >= MAX_TRIES) return cancel(m, "§e[Duel] No safe place was found (" + MAX_TRIES + " tries). The round was cancelled - you were sent back, nothing was lost.");
  m.attempt++;
  [m.x, m.z] = randomXZ(); m.idx = 0; m.samples = 0; m.readyTick = null; m.t0 = system.currentTick;
  for (const s of m.ps) { const p = find(s.id); if (p) { try { enterSky(p, dim, m.x, m.z, s.st); } catch (e) { /* ignore */ } tell(p, "§e[Duel] No safe place yet - §f" + DUEL.searchSeconds + " extra seconds §e(try " + m.attempt + " of " + MAX_TRIES + ")"); } }
}
function load(m, dim) {
  if (m.state !== "load") return;
  const pl = m.ps.map((s) => find(s.id));
  if (pl.some((p) => !p)) return cancel(m, "§e[Duel] An opponent left. No fight.");
  if (system.currentTick - m.t0 > LOAD_TICKS) return nextTry(m, dim);
  let r; try { r = findSpot(dim, m); } catch (e) { r = undefined; }
  if (r === undefined) return;
  const spots = r ? spotsFor(dim, m, r) : null;
  if (!spots) return nextTry(m, dim);                      // nothing usable around this spot, or no room for everybody
  system.clearRun(m.handle); m.handle = null;
  const order = spots.slice().sort(() => Math.random() - 0.5);
  try { pl.forEach((p, i) => p.teleport(order[i], { dimension: dim })); } catch (e) { return cancel(m, "§e[Duel] Teleport failed. No fight - you were sent back."); }
  m.center = { x: spots[0].x, z: spots[0].z };
  m.state = "ready"; m.readyAt = Date.now() + DUEL.readySeconds * 1000;
  for (const p of pl) { tell(p, "§c[Duel] §fGet ready! The fight starts in §e" + DUEL.readySeconds + "s§f. You are protected until then."); combatHold(p); }
  m.handle = system.runTimeout(() => safe("go", () => go(m)), DUEL.readySeconds * 20);
}
function go(m) {
  if (m.state !== "ready") return;
  const pl = m.ps.map((s) => find(s.id));
  if (pl.some((p) => !p)) return cancel(m, "§e[Duel] An opponent left. No fight.");
  const away = pl.find((p) => p.dimension.id !== "minecraft:overworld" || Math.hypot(p.location.x - m.center.x, p.location.z - m.center.z) > 80);
  if (away) return cancel(m, "§e[Duel] A fighter was taken away from the place. No fight - you were sent back, nothing was lost.");
  m.ps.forEach((s, i) => leaveSky(pl[i], s.st));
  m.state = "fight"; m.endAt = Date.now() + DUEL.fightMinutes * 60000;
  for (const p of pl) { tell(p, "§c§l⚔ FIGHT!"); try { p.onScreenDisplay.setTitle("§c§l⚔ FIGHT!", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10 }); } catch (e) { /* ignore */ } combatHold(p); }
}

/** a match that never became a fight: everybody goes back, nothing lost */
function cancel(m, msg) {
  if (m.state === "over") return;
  m.state = "over";
  if (m.handle !== null) { try { system.clearRun(m.handle); } catch (e) { /* ignore */ } m.handle = null; }
  for (const s of m.ps) { const p = find(s.id); if (!p) continue; leaveSky(p, s.st); tell(p, msg); sendBack(p); combatClear(p); }
  drop(m);
}
function drop(m) { const i = matches.indexOf(m); if (i >= 0) matches.splice(i, 1); }

const alivePlayers = (m) => m.ps.filter((s) => s.alive).map((s) => find(s.id)).filter((p) => { if (!p) return false; try { return (p.getComponent("minecraft:health")?.currentValue ?? 1) > 0; } catch (e) { return true; } });
/** after somebody was eliminated (died / left): one left = winner, nobody left = draw */
function checkEnd(m) {
  if (m.state !== "fight") return;
  const left = alivePlayers(m);
  if (left.length === 1) end(m, left[0].id, "");
  else if (left.length === 0) end(m, null, "Everybody was eliminated.");
}
/** the fight is over: winnerId = the winner, or null = draw */
/** what the winner picked up: the items he has now that he did not have when the fight ended, but ONLY kinds the losers carried */
function pickedUp(m, winnerId, before, after) {
  const theirs = new Set();
  for (const s of m.ps) if (s.id !== winnerId) for (const x of s.inv ?? []) theirs.add(x[1]);
  const a = new Map(), got = [];
  for (const [k, n] of tallyInv(before)) a.set(k, n);
  for (const [k, n] of tallyInv(after)) { const d = n - (a.get(k) ?? 0); if (d > 0 && theirs.has(k)) got.push({ typeId: k, amount: d }); }
  return tally(got);
}
function logFight(m, winnerId, why) {
  try {
    const rec = {
      t: Date.now(), r: winnerId ? "win" : "draw", w: winnerId ?? null, p: m.ps.map((s) => ({ i: s.id, n: s.name })), k: m.kills ?? [],
      l: m.ps.filter((s) => s.how).map((s) => ({ i: s.id, n: s.name, how: s.how, by: s.by ?? null, inv: s.inv ?? [] })),
    };
    if (why) rec.y = String(why).slice(0, 60);
    m.seq = addDuelRecord(rec);
  } catch (e) { console.warn("[duel] log failed: " + e); }
}
function end(m, winnerId, why) {
  if (m.state !== "fight") return;
  m.state = "over";
  logFight(m, winnerId, why);
  if (winnerId) { const wp = find(winnerId); m.wBefore = wp ? snapOf(wp) : []; }
  if (winnerId) {
    notice("duel", "§6⚔ §e" + (m.ps.find((s) => s.id === winnerId)?.name ?? "?") + " §6won the duel!");
    try { const wp = find(winnerId); if (wp) stats(wp).dw = (stats(wp).dw ?? 0) + 1; } catch (e) { /* the win counter never blocks a duel */ }
    for (const s of m.ps) { if (s.id === winnerId) continue; const l = find(s.id); if (!l) continue; combatClear(l); if (s.dead) delete ex(l).duelBack; else sendBack(l); }   // the ones who died respawn on their own; one who LEFT and is back is sent home
    const w = find(winnerId);
    if (w) { tell(w, "§a[Duel] You won! You go back in §f" + DUEL.lootSeconds + "s§a. §7(pick up the loot)"); combatClear(w); }
    duelHold.until = Math.max(duelHold.until, Date.now() + (DUEL.lootSeconds + 5) * 1000);
    // the log gets his inventory when the loot time (30 s) is over, just before he is sent back
    system.runTimeout(() => safe("back", () => { safe("log loot", () => { const wp = find(winnerId), after = wp ? snapOf(wp) : null; updateDuelRecord(m.seq, { pk: after ? pickedUp(m, winnerId, m.wBefore, after) : [], wi: after, u: 1 }); }); const p = find(winnerId); if (p) sendBack(p); drop(m); }), DUEL.lootSeconds * 20);
  } else {
    notice("duel", "§6⚔ §7The duel between §f" + m.ps.map((s) => s.name).join(" §7and §f") + " §7ended in a draw.");
    for (const s of m.ps) { const p = find(s.id); if (!p) continue; if (s.alive) { tell(p, "§e[Duel] " + why); sendBack(p); } combatClear(p); }
    drop(m);
  }
}

// ---------------------------------------------------------------- events
safe("death", () => world.afterEvents.entityDie.subscribe((ev) => {
  const d = ev.deadEntity; if (d?.typeId !== "minecraft:player") return;
  const m = inMatch(d.id);
  if (!m) { if (wayBack(d)) delete ex(d).duelBack; return; }      // died during the loot time: he respawns normally, no teleport later
  if (m.state !== "fight") return cancel(m, "§e[Duel] A player died before the fight. No fight.");
  const s = m.ps.find((x) => x.id === d.id); if (s) { s.alive = false; s.dead = true; }
  let pk = null, inv = [];
  safe("snap death", () => { const now = snapOf(d); inv = now.length ? now : (lastInv.get(d.id) ?? []); });     // what he carried (keep inventory: still on him / otherwise the last snapshot)
  safe("drop", () => { pk = dropAll(d); });                        // everything falls where he died (also with keep inventory)
  safe("log death", () => {                                        // duel log: who killed him and everything he lost
    const kx = ev.damageSource?.damagingEntity, killer = kx?.typeId === "minecraft:player" ? m.ps.find((x) => x.id === kx.id) : null, cause = String(ev.damageSource?.cause ?? "unknown");
    if (s) { s.how = "killed"; s.by = killer?.name ?? null; s.inv = inv; }
    (m.kills = m.kills ?? []).push({ k: killer?.name ?? null, v: d.name, c: cause });
  });
  delete ex(d).duelBack;                                           // the loser respawns at his own spawn
  checkEnd(m);
}));
// the player is still there in this event (read only): remember what he must pay / lose, the changes are made right after
safe("leave before", () => world.beforeEvents.playerLeave.subscribe((ev) => {
  const p = ev.player, m = inMatch(p.id), e = round?.parts.get(p.id), now = Date.now(), back = DUEL.escapeReturnMinutes * 60000;
  let fine = null;
  if (e && !e.out) fine = { amount: duelWithdrawPrice(), until: round.endAt + back };                                   // left during the countdown
  else if (m && m.state !== "fight") fine = { amount: duelWithdrawPrice(), until: now + back };                          // left after being paired, before the fight
  else if (!round && nextAt && duelOn() && eligible(p) && !isAfk(p) && !isImmune(p) && !isExcluded(p) && !inAfkZone(p)) {                                // left shortly BEFORE the countdown: only counts if a round really happens
    const fightAt = nextAt + DUEL.joinSeconds * 1000;
    if (fightAt > now && nextAt - now <= duelAfkLockMin() * 60000) fine = { amount: duelWithdrawPrice(), round: fightAt, until: fightAt + back };
  }
  if (fine) ex(p).duelFine = fine;
  if (m && m.state === "fight" && m.ps.find((x) => x.id === p.id)?.alive) {                                             // left in the middle of the fight: loses everything, it falls right here
    const pk = collect(p); ex(p).duelWipe = true;
    safe("log leave", () => {                                                                                              // duel log: he left = he lost everything
      const sx = m.ps.find((x) => x.id === p.id);
      if (sx) { sx.how = "left"; sx.by = null; sx.inv = snapOf(p); }
      (m.kills = m.kills ?? []).push({ k: null, v: p.name, c: "left the game" });
    });
    system.run(() => safe("leave drop", () => dropPack(pk)));
  }
}));
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  if (round) round.parts.delete(playerId);
  const m = inMatch(playerId); if (!m) return;
  if (m.state === "fight") { const s = m.ps.find((x) => x.id === playerId); if (s) s.alive = false; checkEnd(m); }
  else cancel(m, "§e[Duel] An opponent left. No fight.");
}));
// when he is back: the fine, the lost items, and the way home
safe("spawn", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => safe("immunity message", () => { if (valid(player)) showBanner(player); }), 60);
  system.run(() => safe("fine on join", () => {                       // at once: nothing can be moved or spent before this
    if (!valid(player)) return;
    const d = ex(player);
    if (d.duelWipe) { delete d.duelWipe; emptyAll(player); tell(player, "§c[Duel] You left the game during a fight - you lost the duel and everything you carried."); }
    if (d.duelFine) {
      const f = typeof d.duelFine === "number" ? { amount: d.duelFine } : d.duelFine; delete d.duelFine;
      const stale = (f.until && Date.now() > f.until) || (f.round && Math.abs(readLast() - f.round) > 10000);      // too late, or no round happened after all: nothing to pay
      if (!stale && f.amount > 0) { addMoney(player, -f.amount); tell(player, "§c[Duel] You left the game shortly before / during the 1 vs 1 challenge: §f" + money(f.amount) + " §cwas charged." + (stats(player).money < 0 ? " §7Your balance is below zero until you earn it back." : "")); }
    }
  }));
  system.runTimeout(() => safe("back on join", () => {
    if (valid(player) && wayBack(player) && !activeIn(player.id)) { clearSky(player); sendBack(player); tell(player, "§e[Duel] The duel is over - you were brought back."); }
  }), 40);
}));

// ---------------------------------------------------------------- the clock (every second)
system.runInterval(() => safe("clock", () => {
  const now = Date.now();
  for (const p of world.getAllPlayers()) safe("afk", () => sampleAfk(p));
  if (nextAt === null) { const v = readNext(); nextAt = v === null ? now + duelEvery() * 60000 : (v < now ? now + 120000 : v); saveNext(); }
  if (!round && now >= nextAt && !matches.some((m) => m.state !== "over")) { nextAt = now + duelEvery() * 60000; saveNext(); if (duelOn()) startRound(); }
  if (round && !round.started) {
    for (const id of [...round.parts.keys()]) if (!find(id)) round.parts.delete(id);
    if (now >= round.endAt) finishCountdown();
  }
  for (const m of [...matches]) {
    if (m.state === "ready" || m.state === "fight") duelHold.until = Math.max(duelHold.until, now + 20000);      // Clear Lag must not wipe the loot
    if (m.state === "load" || m.state === "ready") { for (const s of m.ps) { const p = find(s.id); if (p) combatHold(p); } continue; }
    if (m.state !== "fight") continue;
    if (now >= m.endAt) { end(m, null, "Time is up - draw. Nobody won."); continue; }
    for (const s of m.ps) { const p = find(s.id); if (p && s.alive) combatHold(p); }   // no teleport while fighting (refreshed, the tag is 20 s)
  }
}), 20);

// /afk asks this: may this player enter the AFK area right now?  Not in the last 5 minutes before the round, and not while he is in the round / a fight.
duelView.afkLock = (p) => {
  try {
    if (!duelOn() || !valid(p) || !eligible(p) || isImmune(p) || isExcluded(p)) return 0;
    if (round && !round.started) { const e = round.parts.get(p.id); return e && !e.out ? Math.max(1, round.endAt - Date.now()) : 0; }
    if (inMatch(p.id)) return 1;
    if (!round && nextAt !== null && nextAt - Date.now() <= duelAfkLockMin() * 60000) return Math.max(1, nextAt - Date.now() + DUEL.joinSeconds * 1000);
  } catch (e) { /* ignore */ }
  return 0;
};

// kills in a duel always count in the scoreboard (data.js asks this to skip the "same victim again" rule)
duelView.fighting = (a, b) => matches.some((m) => m.state === "fight" && m.ps.some((s) => s.id === a) && m.ps.some((s) => s.id === b));
