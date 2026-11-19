// END EVENT: The End is closed for everybody, however they try to get there (End portal, ender pearl, /tp, tpa, home, rtp, clan home ...).
// Any player who ends up in The End while it is CLOSED is moved straight back to the last place he was outside The End.
//   * Owner + Admin (permission "endgate") start an EVENT: a world-wide notice, a countdown with sounds + particles + titles, then The End opens
//     and stays open for the chosen time (default 15 minutes), warns before it closes, then closes itself and sends everybody out.
//   * The first player who reaches The End during an opening is announced to everybody.
//   * Every opening / closing / schedule / cancel is saved in the End log (menu: Operator > World > End event > Event log).
//   * Holograms on the End portals (endholo.js) show the state and the timer.
// Menu: Operator > World > End event          Command: /end [start|open|close|cancel|status]
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system } from "@minecraft/server";
import { allow, can, slog, makeStore } from "./staffcore.js";
import { opAlert } from "./opcore.js";
import { getSpawn } from "./spawn.js";
import { pick, niceAr } from "./arextra.js";
import { isMuted } from "../smp/fxprefs.js";

const KEY = "endgate:v2", OLD_KEY = "endgate:v1", END = "minecraft:the_end";
/** true = the Owner and Admins are blocked too while the End is closed (they must open it first).  false = they can walk in anytime. */
const BLOCK_OWNER_AND_ADMIN = true;
const CHECK_TICKS = 4, TICK_EVENT = 10;
export const DEFAULT_OPEN_MS = 15 * 60000;                  // how long The End stays open (shown on the hologram)
const OPEN_MILESTONES = [3600, 1800, 600, 300, 60, 30];     // seconds before opening / closing: world notice
const FINAL = 10;                                           // last seconds: big countdown with sounds

// ------------------------------------------------------------------ saved state
let state = null;     // { open, openAt (scheduled opening, ms, 0 = none), openUntil (auto close, ms, 0 = until closed), dur (planned open time), by, t, holo, skip[], first {n, t} | null }
function load() {
  if (state) return state;
  try {
    const raw = world.getDynamicProperty(KEY);
    let o = typeof raw === "string" ? JSON.parse(raw) : null;
    if (!o) { const old = world.getDynamicProperty(OLD_KEY); o = typeof old === "string" ? JSON.parse(old) : null; }
    o = o && typeof o === "object" ? o : {};
    state = {
      open: o.open === true, openAt: Number(o.openAt) || 0, openUntil: Number(o.openUntil) || 0, dur: Number(o.dur) || DEFAULT_OPEN_MS,
      by: String(o.by ?? "").slice(0, 32), t: Number(o.t) || 0, holo: o.holo !== false,
      skip: Array.isArray(o.skip) ? o.skip.filter((x) => typeof x === "string").slice(0, 40) : [],
      first: o.first && typeof o.first === "object" ? { n: String(o.first.n ?? "").slice(0, 32), t: Number(o.first.t) || 0 } : null,
    };
  } catch (e) { return null; }                               // world not ready: do nothing (the saved value stays as it is)
  return state;
}
function save() {
  try { world.setDynamicProperty(KEY, JSON.stringify(state)); return true; }
  catch (e) { console.warn("[endgate] save failed: " + e); return false; }
}
/** a copy of the state for the menu / hologram (never null) */
export const eventView = () => { const s = load(); return s ? { ...s, skip: [...s.skip] } : { open: false, openAt: 0, openUntil: 0, dur: DEFAULT_OPEN_MS, by: "", t: 0, holo: true, skip: [], first: null }; };
/** true when The End is open for everybody. Unreadable -> closed (never opens the End by mistake) */
export const endGateOpen = () => { const s = load(); return !!(s && s.open); };
export const endGateInfo = eventView;

// ------------------------------------------------------------------ the End log (newest first)
const logStore = makeStore("endgate:log", () => ({ l: [] }), 12000);
const LOG_CAP = 60;
/** a = open | close | auto | start | cancel | first */
function elog(a, by, d) {
  try {
    const st = logStore.get(); if (!st) return;
    st.l.unshift({ t: Date.now(), a, by: String(by ?? "system").slice(0, 32), d: String(d ?? "").slice(0, 80) });
    if (st.l.length > LOG_CAP) st.l.length = LOG_CAP;
    logStore.save();
  } catch (e) { console.warn("[endgate] log failed: " + e); }
}
export function endLog() { const st = logStore.get(); return st ? st.l : []; }

// ------------------------------------------------------------------ text + effects helpers
const all = () => { try { return world.getAllPlayers(); } catch (e) { return []; } };
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
export const nice = (ms) => { const m = Math.round(ms / 60000); return ms < 60000 ? Math.round(ms / 1000) + " seconds" : m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? " hour" : " hours") : m + (m === 1 ? " minute" : " minutes"); };
function sound(id, vol = 1, pitch = 1) { for (const p of all()) { try { p.playSound(id, { volume: vol, pitch }); } catch (e) { /* ignore */ } } }
// every notice has an optional Arabic version (arT / arSub / arMsg): it is shown only to players whose language is Arabic
function title(t, sub, stay = 40, arT, arSub) { for (const p of all()) { try { if (isMuted(p, "end.msg")) continue; p.onScreenDisplay.setTitle(arT === undefined ? t : pick(p, t, arT, 24), { stayDuration: stay, fadeInDuration: 2, fadeOutDuration: 12, subtitle: arSub === undefined ? sub : pick(p, sub, arSub, 30) }); } catch (e) { /* ignore */ } } }
function say(msg, arMsg) {
  for (const p of all()) { try { if (!isMuted(p, "end.msg")) p.sendMessage(arMsg === undefined ? msg : pick(p, msg, arMsg)); } catch (e) { /* ignore */ } }
}
function ring(p, id, n = 12, r = 1.8, h = 1.0) {
  try {
    const l = p.location, d = p.dimension;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; try { d.spawnParticle(id, { x: l.x + Math.cos(a) * r, y: l.y + h, z: l.z + Math.sin(a) * r }); } catch (e) { return; } }
  } catch (e) { /* ignore */ }
}
function burst() { for (const p of all()) { if (p.dimension.id === END) continue; ring(p, "minecraft:endrod", 20, 2.2, 0.5); ring(p, "minecraft:endrod", 16, 1.2, 1.6); ring(p, "minecraft:totem_particle", 10, 1.5, 1.0); } }

// ------------------------------------------------------------------ opening / closing
let fired = new Set(), lastSec = -1;
function resetNotices() { fired = new Set(); lastSec = -1; }

function doOpen(by, why) {
  const s = load(); if (!s) return;
  const now = Date.now();
  s.open = true; s.openAt = 0; s.openUntil = s.dur > 0 ? now + s.dur : 0; s.first = null; s.t = now; if (by) s.by = by;
  if (!save()) return;
  resetNotices();
  elog("open", by || s.by || "schedule", (why ?? "opened") + (s.dur > 0 ? ", open for " + nice(s.dur) : ", until closed"));
  say("§5§l[End] §r§aTHE END IS NOW OPEN!" + (s.dur > 0 ? " §7It closes in §f" + nice(s.dur) + "§7." : "") + " §dWho will be the first one in?",
    "§5§l[الإند] §r§aالإند مفتوح الآن!" + (s.dur > 0 ? " §7يُغلق بعد §f" + niceAr(s.dur) + "§7." : "") + " §dمن سيكون أول الداخلين؟");
  title("§a§lTHE END IS OPEN", "§dFind an End portal - who gets there first?", 70, "§a§lالإند مفتوح", "§dابحث عن بوابة الإند - من يصل أولاً؟");
  sound("mob.enderdragon.growl", 0.8, 1); sound("random.levelup", 1, 1); sound("block.end_portal.spawn", 1, 1);
  burst(); system.runTimeout(burst, 10); system.runTimeout(burst, 20);
  try { opAlert("§5The End §7is now §aopen" + (by ? " §7(" + by + ")" : ""), { chat: false }); } catch (e) { /* ignore */ }
}
function doClose(by, why, auto) {
  const s = load(); if (!s) return;
  s.open = false; s.openAt = 0; s.openUntil = 0; s.t = Date.now(); if (by) s.by = by;
  if (!save()) return;
  resetNotices();
  elog(auto ? "auto" : "close", by || "system", (why ?? "closed") + (s.first ? ", first in: " + s.first.n : ", nobody went in"));
  say("§5§l[End] §r§cTHE END IS NOW CLOSED." + (s.first ? " §7First one in this time: §d" + s.first.n + "§7." : ""),
    "§5§l[الإند] §r§cتم إغلاق الإند." + (s.first ? " §7أول من دخل هذه المرة: §d" + s.first.n + "§7." : ""));
  title("§c§lTHE END IS CLOSED", "§7See you at the next event", 60, "§c§lالإند مغلق", "§7نراكم في الفعالية القادمة");
  sound("mob.endermen.portal", 1, 0.6); sound("random.anvil_land", 0.6, 0.6);
  system.run(sweep);
  try { opAlert("§5The End §7is now §cclosed" + (auto ? " §7(timer ended)" : by ? " §7(" + by + ")" : ""), { chat: false }); } catch (e) { /* ignore */ }
}

/** Owner / Admin: start the event. delayMs = 0 -> opens right away (no countdown). durMs = 0 -> stays open until a staff member closes it. */
export function startEvent(actor, delayMs, durMs) {
  try {
    if (!allow(actor, "endgate")) return { err: "No permission." };
    const s = load(); if (!s) return { err: "Could not read the End gate." };
    if (s.open) return { err: "The End is already open. Close it first." };
    if (s.openAt) return { err: "An event is already counting down. Cancel it first." };
    s.dur = Math.max(0, Math.floor(durMs)); s.by = String(actor.name).slice(0, 32);
    slog(actor, "endgate", null, delayMs > 0 ? "started a countdown (" + nice(delayMs) + ")" : "opened The End");
    if (delayMs <= 0) { doOpen(s.by, "opened right away"); return { ok: true, open: true }; }
    s.openAt = Date.now() + Math.floor(delayMs); s.t = Date.now();
    if (!save()) { s.openAt = 0; return { err: "Could not save." }; }
    resetNotices();
    for (const m of OPEN_MILESTONES) if (m * 1000 >= delayMs) fired.add("o" + m);
    elog("start", s.by, "opens in " + nice(delayMs) + (s.dur > 0 ? ", open for " + nice(s.dur) : ", until closed"));
    say("§5§l[End] §r§eThe End opens in §f" + nice(delayMs) + "§e! " + (s.dur > 0 ? "§7It will stay open for §f" + nice(s.dur) + "§7. " : "") + "§dGet ready!",
      "§5§l[الإند] §r§eيفتح الإند بعد §f" + niceAr(delayMs) + "§e! " + (s.dur > 0 ? "§7سيبقى مفتوحاً لمدة §f" + niceAr(s.dur) + "§7. " : "") + "§dاستعدوا!");
    title("§5§lTHE END EVENT", "§dOpens in " + nice(delayMs), 70, "§5§lفعالية الإند", "§dيفتح بعد " + niceAr(delayMs));
    sound("block.end_portal.spawn", 0.7, 1.2); sound("note.pling", 1, 1.2);
    try { opAlert("§f" + s.by + " §7started the §5End §7countdown (" + nice(delayMs) + ")", { chat: false }); } catch (e) { /* ignore */ }
    return { ok: true, open: false };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** Owner / Admin: close The End now (or stop the countdown) */
export function stopEvent(actor) {
  try {
    if (!allow(actor, "endgate")) return { err: "No permission." };
    const s = load(); if (!s) return { err: "Could not read the End gate." };
    const by = String(actor.name).slice(0, 32);
    if (s.open) { slog(actor, "endgate", null, "closed The End"); doClose(by, "closed by hand", false); return { ok: true, open: false }; }
    if (s.openAt) {
      s.openAt = 0; s.t = Date.now(); if (!save()) return { err: "Could not save." };
      resetNotices(); slog(actor, "endgate", null, "cancelled the countdown"); elog("cancel", by, "countdown cancelled");
      say("§5[End] §cThe End event was cancelled.", "§5[الإند] §cتم إلغاء فعالية الإند.");
      title("§c§lEVENT CANCELLED", "§7The End stays closed", 40); sound("random.anvil_land", 0.6, 0.8);
      return { ok: true, open: false };
    }
    return { err: "The End is already closed." };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** quick switch used by older buttons: open right away (default 15 minutes) or close */
export function setEndGate(actor, open) { const s = load(); if (open && s && !s.dur) s.dur = DEFAULT_OPEN_MS; return open ? startEvent(actor, 0, s?.dur ?? DEFAULT_OPEN_MS) : stopEvent(actor); }

// holograms: on / off, remove one gate, bring them back (Owner / Admin)
export function setHoloOn(actor, on) {
  try { if (!allow(actor, "endgate")) return { err: "No permission." }; const s = load(); if (!s) return { err: "Could not read." }; s.holo = !!on; if (!save()) return { err: "Could not save." }; slog(actor, "endgate", null, "holograms " + (on ? "on" : "off")); return { ok: true }; }
  catch (e) { return { err: "Something went wrong." }; }
}
export function skipGate(actor, key) {
  try { if (!allow(actor, "endgate")) return { err: "No permission." }; const s = load(); if (!s) return { err: "Could not read." }; if (!s.skip.includes(key)) s.skip.push(key); if (s.skip.length > 40) s.skip.shift(); if (!save()) return { err: "Could not save." }; slog(actor, "endgate", null, "removed a portal hologram"); return { ok: true }; }
  catch (e) { return { err: "Something went wrong." }; }
}
export function clearSkips(actor) {
  try { if (!allow(actor, "endgate")) return { err: "No permission." }; const s = load(); if (!s) return { err: "Could not read." }; s.skip = []; if (!save()) return { err: "Could not save." }; slog(actor, "endgate", null, "brought the portal holograms back"); return { ok: true }; }
  catch (e) { return { err: "Something went wrong." }; }
}

// ------------------------------------------------------------------ the clock: notices, final countdown, automatic opening / closing
function countdownFx(sec, kind) {
  const open = kind === "open";
  title((open ? "§5§l" : "§c§l") + sec, open ? "§dThe End opens in" : "§7The End closes in", 14, (open ? "§5§l" : "§c§l") + sec, open ? "§dيفتح الإند بعد" : "§7يُغلق الإند بعد");
  sound(open ? "note.pling" : "note.bass", 1, open ? 0.8 + (FINAL - sec) * 0.08 : 0.7 + (FINAL - sec) * 0.04);
  for (const p of all()) { if (p.dimension.id !== END) ring(p, open ? "minecraft:endrod" : "minecraft:villager_angry", 10, 1.6 + (FINAL - sec) * 0.08, 0.6 + (FINAL - sec) * 0.12); }
}
function notices(left, kind) {
  const secs = left / 1000;
  for (const m of OPEN_MILESTONES) {
    const id = (kind === "open" ? "o" : "c") + m;
    if (fired.has(id) || secs > m) continue;
    fired.add(id);
    if (secs <= m - 15) continue;                           // missed it (e.g. after a restart): no late notice
    say(kind === "open" ? "§5[End] §eThe End opens in §f" + nice(m * 1000) + "§e!" : "§5[End] §cThe End closes in §f" + nice(m * 1000) + "§c! §7Leave it in time.",
      kind === "open" ? "§5[الإند] §eيفتح الإند بعد §f" + niceAr(m * 1000) + "§e!" : "§5[الإند] §cيُغلق الإند بعد §f" + niceAr(m * 1000) + "§c! §7اخرج قبل فوات الوقت.");
    sound(kind === "open" ? "note.pling" : "note.bass", 0.8, 1);
  }
  const sec = Math.ceil(secs);
  if (sec <= FINAL && sec >= 1 && sec !== lastSec) { lastSec = sec; countdownFx(sec, kind); }
}
try {
  system.runInterval(() => {
    try {
      const s = load(); if (!s) return;
      const now = Date.now();
      if (!s.open && s.openAt) { const left = s.openAt - now; if (left <= 0) doOpen(s.by, "countdown ended"); else notices(left, "open"); }
      else if (s.open && s.openUntil) { const left = s.openUntil - now; if (left <= 0) doClose(null, "timer ended", true); else notices(left, "close"); }
    } catch (e) { console.warn("[endgate] clock: " + e); }
  }, TICK_EVENT);
} catch (e) { console.warn("[endgate] clock not started: " + e); }

// ------------------------------------------------------------------ enforcement
const lastOut = new Map();                                    // player id -> last position outside The End { x, y, z, d }
const msgAt = new Map();
const exempt = (p) => { try { return !BLOCK_OWNER_AND_ADMIN && can(p, "endgate"); } catch (e) { return false; } };

function sendOut(p, from) {
  let spot = from ?? lastOut.get(p.id) ?? null;
  try {
    if (!spot) {                                              // nothing known (e.g. he logged out inside The End): bed / spawn
      const sp = p.getSpawnPoint?.();
      if (sp && sp.dimension && sp.dimension.id !== END) spot = { x: sp.x + 0.5, y: sp.y + 1, z: sp.z + 0.5, d: sp.dimension.id };
    }
    if (!spot) {
      const s = getSpawn(), dim = world.getDimension(s.d && s.d !== END ? s.d : "overworld");
      let y = s.y;
      if (typeof y !== "number") { try { const t = dim.getTopmostBlock({ x: Math.floor(s.x), z: Math.floor(s.z) }); y = t ? t.y + 1 : 100; } catch (e) { y = 100; } }
      spot = { x: s.x + 0.5, y, z: s.z + 0.5, d: dim.id };
    }
    p.teleport({ x: spot.x, y: spot.y, z: spot.z }, { dimension: world.getDimension(spot.d) });
    const now = Date.now();
    if (now - (msgAt.get(p.id) ?? 0) > 3000) { msgAt.set(p.id, now); p.sendMessage(pick(p, "§5[End] §cThe End is closed. §7You were sent back.", "§5[الإند] §cالإند مغلق. §7تمت إعادتك.")); }
    try { p.extinguishFire?.(); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[endgate] send back failed: " + e); }
}
function sweep() {
  try {
    if (endGateOpen()) return;
    for (const p of all()) { try { if (p.dimension.id === END && !exempt(p)) sendOut(p, null); } catch (e) { /* next player */ } }
  } catch (e) { /* ignore */ }
}
try {
  system.runInterval(() => {
    try {
      const s = load(); if (!s) return;
      for (const p of all()) {
        try {
          const l = p.location, d = p.dimension.id;
          if (d !== END) { lastOut.set(p.id, { x: l.x, y: l.y, z: l.z, d }); continue; }
          if (!s.open && !exempt(p)) sendOut(p, null);
        } catch (e) { /* next player */ }
      }
      if (!s.open) {                                          // ender pearls can't be used inside The End either
        try { for (const e of world.getDimension("the_end").getEntities({ type: "minecraft:ender_pearl" })) { try { e.remove(); } catch (x) { /* ignore */ } } } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }, CHECK_TICKS);
} catch (e) { console.warn("[endgate] guard not started: " + e); }

// somebody changes dimension: while closed -> back to the place he came from;  while open -> the first one in is announced
try {
  world.afterEvents.playerDimensionChange.subscribe((ev) => {
    try {
      const { player, toDimension, fromDimension, fromLocation } = ev;
      if (!player || toDimension?.id !== END) return;
      if (!endGateOpen()) {
        if (exempt(player)) return;
        const from = fromDimension && fromDimension.id !== END && fromLocation ? { x: fromLocation.x, y: fromLocation.y, z: fromLocation.z, d: fromDimension.id } : null;
        system.run(() => { try { if (player.isValid && player.dimension.id === END) sendOut(player, from); } catch (e) { /* ignore */ } });
        return;
      }
      const s = load();
      if (s && !s.first) {
        s.first = { n: String(player.name).slice(0, 32), t: Date.now() };
        if (save()) {
          elog("first", player.name, "first player in The End");
          say("§5§l[End] §r§d" + player.name + " §fis the §6FIRST §fplayer to reach The End!", "§5§l[الإند] §r§d" + player.name + " §fهو §6أول §fلاعب يصل إلى الإند!");
          title("§6§l" + player.name, "§dFirst player in The End!", 80, "§6§l" + player.name, "§dأول لاعب في الإند!");
          sound("random.levelup", 1, 0.8); sound("mob.enderdragon.growl", 0.6, 1.4);
        }
      }
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[endgate] dimension hook not started: " + e); }
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastOut.delete(playerId); msgAt.delete(playerId); }); } catch (e) { /* ignore */ }
