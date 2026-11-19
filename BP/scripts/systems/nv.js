// Night vision (/nv) - PAID TIME, like the mining tools:
//  * price per hour and the maximum stack are in config.js (NV).  Time is REAL time: it is saved as an end date, so it also runs while the player is offline
//    (buy 10 hours, stay away 2 hours -> 8 hours are left).  It keeps running while night vision is switched off, too.
//  * the effect stays after death / respawn while there is time left; when the time is over it is removed.  Drinking MILK removes it (like any other effect).
//  * NEW players (first join AFTER this version was installed) get NV.giftHours free hours, once.  Players who already existed get nothing.
// The effect itself gets exactly the time that is left (it is refreshed when hours are bought and corrected every second if it is off by more than 2 s).
// The player's choice (on/off) is saved with their settings (ex(p).set.nv), the paid time as ex(p).nvEnd, the gift as ex(p).nvGift.
import { world, system } from "@minecraft/server";
import { sendBar } from "../barsend.js";
import { ex } from "../smp/store.js";
import { stats } from "../data.js";
import { valid } from "./util.js";
import { NV } from "./config.js";
import { luxToggle } from "../lux.js";
import { menuMsg } from "./menulang.js";

const MAX_TICKS = 20000000;     // the most the game allows for one effect (about 231 days) - we never get near it (12 hours = 864000)
const HOUR = 3600000;
const SYNC_TICKS = 40;          // the shown time may differ from the real time by at most 2 seconds before it is corrected

// ---------------------------------------------------------------- paid time
/** ms of night vision time left */
export const nvTimeLeft = (p) => Math.max(0, (ex(p).nvEnd ?? 0) - Date.now());
/** how many whole hours can still be added without going over the maximum */
export const nvHoursFit = (p) => Math.max(0, Math.floor((NV.maxHours * HOUR - nvTimeLeft(p)) / HOUR));
export const nvFitsMin = (p, min) => nvTimeLeft(p) + min * 60000 <= NV.maxHours * HOUR;
// prices set by an admin (/menu -> Night Vision -> Set prices): saved in one world property "nvprice" = { price, p60, p360 }.  Nothing saved = config.js.
const NVP = "nvprice", NV_KEYS = ["price", "p60", "p360"], NV_BASE = { price: NV.price, p60: NV.p60, p360: NV.p360 };
export const NV_MAX_PRICE = 10000000;
let nvLoaded = false;
function nvLoad() {             // lazy: world data can't be read while the script is starting
  if (nvLoaded) return;
  try {
    const raw = world.getDynamicProperty(NVP);
    nvLoaded = true;
    if (typeof raw === "string") { const v = JSON.parse(raw); for (const k of NV_KEYS) { const n = Math.floor(Number(v?.[k])); if (Number.isFinite(n) && n >= 1 && n <= NV_MAX_PRICE) NV[k] = n; } }
  } catch (e) { /* unreadable: normal prices */ }
}
export const nvPrice = (min) => { nvLoad(); return min === 360 ? NV.p360 : min === 60 ? NV.p60 : NV.price; };
export const nvBasePrice = (min) => (min === 360 ? NV_BASE.p360 : min === 60 ? NV_BASE.p60 : NV_BASE.price);
/** v = { 30, 60, 360 } -> new prices.  Returns an error text, or null when saved. */
export function nvSetPrices(v) {
  const next = { price: Math.floor(Number(v[30])), p60: Math.floor(Number(v[60])), p360: Math.floor(Number(v[360])) };
  for (const k of NV_KEYS) if (!Number.isFinite(next[k]) || next[k] < 1 || next[k] > NV_MAX_PRICE) return "Prices must be whole numbers from 1 to " + NV_MAX_PRICE + ".";
  try { world.setDynamicProperty(NVP, JSON.stringify(next)); } catch (e) { return "Could not save it."; }
  nvLoaded = true; for (const k of NV_KEYS) NV[k] = next[k];
  return null;
}
export function nvResetPrices() {
  try { world.setDynamicProperty(NVP, undefined); } catch (e) { return "Could not save it."; }
  nvLoaded = true; for (const k of NV_KEYS) NV[k] = NV_BASE[k];
  return null;
}
export function nvAddMinutes(p, min) {
  const d = ex(p); d.nvEnd = Math.max(Date.now(), d.nvEnd ?? 0) + min * 60000;
  try { if (valid(p) && d.set.nv === true && nvHas(p)) nvApply(p); } catch (e) { /* ignore */ }
}
/** adds `n` hours (the caller has already checked nvHoursFit and taken the money) */
export function nvAddHours(p, n) {
  const d = ex(p); d.nvEnd = Math.max(Date.now(), d.nvEnd ?? 0) + n * HOUR;
  try { if (valid(p) && d.set.nv === true && nvHas(p)) nvApply(p); } catch (e) { /* ignore */ }     // effect already running -> show the new time right away
}
export const nvClock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600); return h + ":" + String(Math.floor((t % 3600) / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };

/** effect duration in ticks = the paid time that is really left (so the effects screen shows the true time, e.g. 720:00 for 12 hours) */
export const nvTicks = (p) => Math.min(MAX_TICKS, Math.max(1, Math.ceil(nvTimeLeft(p) / 50)));
/** gives the effect with exactly the time left. Throws if the game refuses it. */
function nvApply(p) { p.addEffect("night_vision", nvTicks(p), { amplifier: 0, showParticles: false }); }

// ---------------------------------------------------------------- big notice (action bar): "Night vision is Enabled / Disabled" + the live time left
// Shown for NOTICE_SECONDS, refreshed 4x a second (the clock counts down in real time, other bars can't hide it).
// The last FADE_STEPS refreshes dim the colours step by step (bright -> dark -> grey), then the bar is cleared: a soft fade-out.
const NOTICE_SECONDS = 10, TICK_EVERY = 5, FADE_STEPS = 8;
const NOTICE_TOTAL = NOTICE_SECONDS * (20 / TICK_EVERY);
const HEAD = { on: ["\u00a7b", "\u00a73", "\u00a78"], off: ["\u00a7c", "\u00a74", "\u00a78"] }, TIME = ["\u00a7f", "\u00a77", "\u00a78"];
const notices = new Map();       // player id -> the latest notice (a newer one replaces the older)
export function nvNotice(p, on) {
  const tok = {}; notices.set(p.id, tok);
  let n = 0, h = null;
  const stop = () => { if (h !== null) { try { system.clearRun(h); } catch (e) { /* ignore */ } h = null; } };
  const show = () => {
    if (notices.get(p.id) !== tok || !valid(p)) return stop();                  // replaced by a newer notice / player left
    try {
      if (n >= NOTICE_TOTAL) { p.onScreenDisplay.setActionBar(""); notices.delete(p.id); return stop(); }
      const k = n - (NOTICE_TOTAL - FADE_STEPS), lv = k < 2 ? 0 : k < 5 ? 1 : 2;   // 0 = full colour, 1 = darker, 2 = grey
      sendBar(p, HEAD[on ? "on" : "off"][lv] + "Night vision is " + (on ? "Enabled" : "Disabled") + "\n" + TIME[lv] + "Time " + nvClock(nvTimeLeft(p)));
    } catch (e) { return stop(); }
    n++;
  };
  show();
  h = system.runInterval(show, TICK_EVERY);
}
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { notices.delete(playerId); }); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- on / off
export const nvHas = (p) => { try { return !!p.getEffect("night_vision"); } catch (e) { return false; } };
/** switched on by the player (our own switch) AND the effect is really there */
export const nvIsOn = (p) => ex(p).set.nv === true && nvHas(p);
/** turns it on. Does nothing (returns false) when there is no time left. Throws if the game refuses the effect. */
export function nvOn(p) {
  if (nvTimeLeft(p) <= 0) return false;
  nvApply(p);
  ex(p).set.nv = true;
  return true;
}
export function nvOff(p) {
  ex(p).set.nv = false;
  try { p.removeEffect("night_vision"); } catch (e) { /* ignore */ }
}
/** the ON / OFF switch used by /nv and by the menu. returns "on" | "off" | "none" (no time left) | "error" */
export function nvToggle(p) {
  if (nvIsOn(p)) { nvOff(p); luxToggle(p, false); nvNotice(p, false); p.sendMessage(menuMsg(p, "\u00a77[NV] Night vision \u00a7cOFF \u00a77- time left: \u00a7f" + nvClock(nvTimeLeft(p)))); return "off"; }
  if (nvTimeLeft(p) <= 0) return "none";
  try {
    if (!nvOn(p)) return "none";
    luxToggle(p, true); nvNotice(p, true);
    p.sendMessage(menuMsg(p, "\u00a7a[NV] Night vision ON \u00a77- time left: \u00a7f" + nvClock(nvTimeLeft(p)) + " \u00a77(stays after death - use /nv again to turn it off)"));
    return "on";
  } catch (e) { p.sendMessage(menuMsg(p, "\u00a7c[NV] Could not apply night vision.")); return "error"; }
}

// ---------------------------------------------------------------- time is over -> switch it off (checked every second)
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      if (!valid(p) || ex(p).set.nv !== true) continue;
      if (nvTimeLeft(p) <= 0) {
        nvOff(p); luxToggle(p, false); nvNotice(p, false);
        p.sendMessage(menuMsg(p, "\u00a7c[NV] Your night vision time is over. \u00a77Buy more in \u00a7f/menu \u00a77-> Night Vision (or use \u00a7f/nv\u00a77)."));
        continue;
      }
      // keep the time shown on the effects screen equal to the paid time (fixes old huge values and any lag drift)
      const eff = p.getEffect("night_vision");
      if (!eff) continue;
      const want = nvTicks(p), diff = eff.duration - want;
      if (diff < -SYNC_TICKS) nvApply(p);                                                  // shows too little -> a longer effect simply replaces it
      else if (diff > SYNC_TICKS) { p.removeEffect("night_vision"); nvApply(p); }          // shows too much -> remove and give it again with the right time
    } catch (e) { /* ignore */ }
  }
}, 20);

// ---------------------------------------------------------------- free gift for NEW players (once)
// "since" = the moment this version first ran in this world. Only players whose data was created AFTER that moment (data.js: stats(p).joined) are new.
// Players that already existed (older "joined", or no "joined" at all) never get the gift. If anything is unclear, nobody gets it.
const SINCE_KEY = "nv:since";
let since = null;
system.run(() => {
  try {
    let v = world.getDynamicProperty(SINCE_KEY);
    if (typeof v !== "number") { v = Date.now(); world.setDynamicProperty(SINCE_KEY, v); }
    since = v;
  } catch (e) { console.warn("[nv] cannot read/save the start date: " + e); }
});
function gift(p) {
  try {
    if (!valid(p) || since === null || NV.giftHours <= 0) return;
    const d = ex(p), j = stats(p).joined;
    if (d.nvGift === true || typeof j !== "number" || j < since) return;
    d.nvGift = true;                                    // marked FIRST, so it can never be given twice
    nvAddHours(p, Math.min(NV.giftHours, NV.maxHours));
    p.sendMessage(menuMsg(p, "\u00a7b[NV] Welcome gift: \u00a7f" + NV.giftHours + " free hours of night vision! \u00a77Use \u00a7f/nv \u00a77to turn it on."));
  } catch (e) { console.warn("[nv] gift failed: " + e); }
}
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (initialSpawn) system.runTimeout(() => gift(player), 40);
  });
} catch (e) { console.warn("[nv] cannot watch joins: " + e); }

// respawn (and joining) -> put it back if the player still wants it AND there is time left
try {
  world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (ex(player).set.nv !== true) return;
    system.runTimeout(() => { try { if (valid(player) && nvTimeLeft(player) > 0 && !nvHas(player)) nvApply(player); } catch (e) { /* ignore */ } }, 10);
  });
} catch (e) { console.warn("[nv] cannot watch respawns: " + e); }

// milk removes the effect -> forget the choice so it does not come back after the next respawn (the paid time stays)
try {
  world.afterEvents.itemCompleteUse.subscribe(({ source, itemStack }) => {
    if (!itemStack || itemStack.typeId !== "minecraft:milk_bucket" || source?.typeId !== "minecraft:player") return;
    if (ex(source).set.nv !== true) return;
    ex(source).set.nv = false;
    system.runTimeout(() => { try { if (valid(source)) { source.removeEffect("night_vision"); nvNotice(source, false); source.sendMessage(menuMsg(source, "\u00a77[NV] Milk removed your night vision. Use \u00a7f/nv \u00a77to turn it on again.")); } } catch (e) { /* ignore */ } }, 2);
  });
} catch (e) { console.warn("[nv] cannot watch milk: " + e); }
