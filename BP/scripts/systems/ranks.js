// RANKS - the data behind /top, the Ranks page of /menu and the fixed hologram boards.
//   * 10 lists: money, clan, duel, sell, buy, play, kills, shards, skills, ach
//   * the result of each list is kept for 30 seconds (a big server is not scanned on every /top)
//   * "You: #14 - $3,200" line for the player who looks at a board
//   * every week (Monday, UTC_OFFSET_HOURS) the top 3 of each player list get shards  (WEEKLY_REWARD)
//   * notification when you enter a Top 10 or somebody passes you
//   * the richest player gets "[Richest]" above the name (through clanView.rankTag -> applyTag in clans.js)
// Everything that runs on a timer is wrapped in try/catch: a problem here can never stop another system.
import { world, system } from "@minecraft/server";
import { allRecords, addShardsById, STARTER_MONEY } from "../data.js";
import { exOf } from "../smp/store.js";
import { money, num, playtime } from "../format.js";
import { notify } from "../smp/notify.js";
import { UTC_OFFSET_HOURS } from "../smp/config.js";
import { clanView } from "./clanstate.js";
import { clanOf, applyTag } from "./clans.js";
import { KEYS as SKILL_KEYS, info as skillInfo } from "./skills.js";
import { ACHIEVEMENTS } from "../smp/achievements.js";
import { can, slog, isOwnerId } from "./staffcore.js";
import { menuMsg } from "./menulang.js";

export const CACHE_MS = 30000;                       // how long a finished list is reused
export const WEEKLY_REWARD = [200, 100, 50];         // shards for place 1, 2, 3 of every player list, once a week
export const RICHEST_TAG = "§6[Richest]";       // above the head of the richest player ("" = turn the title off)
const WATCH_EVERY = 1200;                            // ticks (60 s): rank watcher + weekly reward check
const NOTIFY_GAP_MS = 10 * 60 * 1000;                // the same player gets at most one "rank" message per list every 10 minutes

// ---------------------------------------------------------------- the lists
const achIds = new Set(ACHIEVEMENTS.map((a) => a.id));
const skillTotal = (id) => {
  let t = 0;
  try { const n = exOf(id).sk?.n ?? {}, lk = exOf(id).sk?.lk ?? {}; for (const k of SKILL_KEYS) t += skillInfo(Number(n[k]) || 0, lk[k] === true).level; } catch (e) { /* ignore */ }
  return t;
};
const achTotal = (id) => { let t = 0; try { for (const k of Object.keys(exOf(id).ach ?? {})) if (achIds.has(k)) t++; } catch (e) { /* ignore */ } return t; };

export const LISTS = {
  money: { label: "Money", title: "MONEY LEADERBOARD", sub: "Top 10 Richest Players", foot: "Keep grinding!", get: (r) => r.money, fmt: (v) => "§a" + money(v) },
  clan: { label: "Clans", title: "CLAN LEADERBOARD", sub: "Top 10 Clans", foot: "Rise together!" },
  duel: { label: "Duel", title: "DUEL LEADERBOARD", sub: "Top 10 Duel Winners", foot: "Prove yourself in the arena!", get: (r) => r.dw, fmt: (v) => "§f" + num(v) + " wins" },
  sell: { label: "Sell", title: "SELLERS LEADERBOARD", sub: "Top 10 Sellers", foot: "Every sale counts!", get: (r) => r.earned, fmt: (v) => "§a" + money(v) },
  buy: { label: "Buy", title: "BUYERS LEADERBOARD", sub: "Top 10 Buyers", foot: "Big spenders!", get: (r) => r.spent, fmt: (v) => "§c" + money(v) },
  play: { label: "Playtime", title: "PLAYTIME LEADERBOARD", sub: "Top 10 Most Active", foot: "Time well spent!", get: (r) => r.play, fmt: (v) => "§f" + playtime(v) },
  kills: { label: "Kills", title: "KILLS LEADERBOARD", sub: "Top 10 Killers", foot: "Fear the best!", get: (r) => r.kills, fmt: (v) => "§c" + num(v) + " kills" },
  shards: { label: "Shards", title: "SHARDS LEADERBOARD", sub: "Top 10 Shard Holders", foot: "Shiny!", get: (r) => r.shards, fmt: (v) => "§d" + num(v) + " shards" },
  skills: { label: "Skills", title: "SKILLS LEADERBOARD", sub: "Top 10 Skill Masters", foot: "Practice makes perfect!", get: (r) => skillTotal(r.id), fmt: (v) => "§bTotal Lv " + num(v) },
  tntrun: { label: "TNT Run", title: "TNT RUN LEADERBOARD", sub: "Top 10 TNT Run Winners", foot: "Don't stop running!", get: (r) => r.tw, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS (no daily reward): only the board in the TNT Run arena + /tntrun
  squid: { label: "Red Light", title: "RED LIGHT, GREEN LIGHT", sub: "Top 10 Winners", foot: "Don't move!", get: (r) => r.sw, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS: only the board in the arena + /redlight
  dropper: { label: "Dropper", title: "DROPPER LEADERBOARD", sub: "Top 10 Dropper Winners", foot: "Mind the gap!", get: (r) => r.dr, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS: only the board at the tower + /dropper
  pillars: { label: "Pillars", title: "PILLARS OF FORTUNE", sub: "Top 10 Winners", foot: "Last one standing!", get: (r) => r.pw, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS: only /pillars
  pillars1: { label: "Pillars 1x1", title: "PILLARS OF FORTUNE 1x1", sub: "Top 10 Winners", foot: "One block is enough!", get: (r) => r.qw, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS: only /pillars1
  colors: { label: "Color Rush", title: "COLOR RUSH LEADERBOARD", sub: "Top 10 Winners", foot: "Run to the colour!", get: (r) => r.cw, fmt: (v) => "§f" + num(v) + " wins" },   // not in TOP_KEYS: only the board in the hall + /colors
  ach: { label: "Achievements", title: "ACHIEVEMENTS LEADERBOARD", sub: "Top 10 Achievers", foot: "Gotta unlock them all!", get: (r) => achTotal(r.id), fmt: (v) => "§6" + num(v) + "/" + ACHIEVEMENTS.length },
};
export const TOP_KEYS = ["money", "clan", "duel", "sell", "buy", "play", "kills", "shards", "skills", "ach"];
const ALIASES = { rich: "money", balance: "money", bal: "money", clans: "clan", duels: "duel", wins: "duel", sold: "sell", sellers: "sell", bought: "buy", buyers: "buy", playtime: "play", time: "play", kill: "kills", shard: "shards", skill: "skills", achievements: "ach", achievement: "ach" };
/** "Money" / "playtime" / ... -> the list key, or null when it is not a list. No text = money. */
export function topKey(raw) {
  let s = String(raw ?? "").trim().toLowerCase() || "money";
  s = ALIASES[s] ?? s;
  return TOP_KEYS.includes(s) ? s : null;
}
export const TOP_USAGE = TOP_KEYS.map((k) => "§e/top " + k).join("§7, ");

// ---------------------------------------------------------------- ADMIN CONTROL (/menu > Ranks > Admin, permission "boards", saved in the world)
//   REMOVE = a player (or clan) is hidden from ONE list.   BAN = a player is hidden from EVERY list (and gets no weekly shards / [Richest] tag).
//   Both can be undone.  Everything that reads a list (/top, /menu > Ranks, fixed boards, weekly rewards, rank messages) goes through ranking(), so they all follow.
const HKEY = "rk:hide";
export const boardHooks = { changed: null };          // hologram.js sets it: refresh the fixed boards at once
let hid = { ban: {}, hide: {} };                      // ban: { playerId: name }   hide: { listKey: { id: name } }
try {
  const raw = world.getDynamicProperty(HKEY);
  if (typeof raw === "string") { const o = JSON.parse(raw); if (o && typeof o === "object") hid = { ban: o.ban && typeof o.ban === "object" ? o.ban : {}, hide: o.hide && typeof o.hide === "object" ? o.hide : {} }; }
} catch (e) { hid = { ban: {}, hide: {} }; }
const hiddenIn = (key, id) => !!(hid.ban[id] || hid.hide[key]?.[id]);
export const isBanned = (id) => !!hid.ban[id];
export const bannedList = () => Object.entries(hid.ban).map(([id, name]) => ({ id, name }));
export const hiddenList = (key) => Object.entries(hid.hide[key] ?? {}).map(([id, name]) => ({ id, name }));
export const hiddenCount = (key) => Object.keys(hid.hide[key] ?? {}).length;
function commit(actor, who, detail, fn, tell) {
  if (!actor || !can(actor, "boards")) return { err: "You are not allowed to edit the leaderboards." };
  const snap = JSON.stringify(hid);
  fn();
  let ok = true;
  try { const t = JSON.stringify(hid); if (t.length > 30000) ok = false; else world.setDynamicProperty(HKEY, Object.keys(hid.ban).length || Object.keys(hid.hide).some((k) => Object.keys(hid.hide[k]).length) ? t : undefined); } catch (e) { ok = false; }
  if (!ok) { hid = JSON.parse(snap); return { err: "Could not save (the list is full)." }; }
  cache.clear();
  slog(actor, "board", who, detail);
  try { const p = world.getAllPlayers().find((x) => x.id === who?.id); if (p && tell) p.sendMessage(menuMsg(p, tell)); } catch (e) { /* ignore */ }
  try { if (boardHooks.changed) system.run(() => { try { boardHooks.changed(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  return { ok: true };
}
const nm = (n) => String(n ?? "?").replace(/§./g, "").slice(0, 20);
/** hide one player (or clan) from ONE list */
export function hideFrom(actor, key, id, name) {
  if (!LISTS[key]) return { err: "Unknown list." };
  if (key !== "clan" && isOwnerId(id)) return { err: "The Owner cannot be removed from a leaderboard." };
  return commit(actor, { id, name: nm(name) }, "removed from " + LISTS[key].label, () => { (hid.hide[key] ??= {})[id] = nm(name); }, "§c[Top] §fAn admin removed you from the §6" + LISTS[key].label + " §fleaderboard.");
}
export const restoreTo = (actor, key, id, name) => commit(actor, { id, name: nm(name) }, "put back in " + (LISTS[key]?.label ?? key), () => { if (hid.hide[key]) { delete hid.hide[key][id]; if (!Object.keys(hid.hide[key]).length) delete hid.hide[key]; } }, "§a[Top] §fAn admin put you back in the §6" + (LISTS[key]?.label ?? key) + " §fleaderboard.");
/** hide one player from EVERY list */
export function banPlayer(actor, id, name) {
  if (isOwnerId(id)) return { err: "The Owner cannot be banned from the leaderboards." };
  return commit(actor, { id, name: nm(name) }, "banned from all leaderboards", () => { hid.ban[id] = nm(name); }, "§c[Top] §fAn admin banned you from all leaderboards.");
}
export const unbanPlayer = (actor, id, name) => commit(actor, { id, name: nm(name) }, "unbanned from the leaderboards", () => { delete hid.ban[id]; }, "§a[Top] §fYou are back on the leaderboards.");

// ---------------------------------------------------------------- ranking (cached)
const cache = new Map();                              // list key -> { t: time, rows: [{ id, name, v }] }
/** all players of one list, best first (players with 0 are not ranked). fresh = ignore the cache */
export function ranking(key, fresh = false) {
  const L = LISTS[key];
  if (!L || !L.get) return [];
  const hit = cache.get(key), now = Date.now();
  if (!fresh && hit && now - hit.t < CACHE_MS) return hit.rows;
  const rows = [];
  for (const r of allRecords()) {
    let v = 0; try { v = Number(L.get(r)) || 0; } catch (e) { v = 0; }
    if (v > 0 && !hiddenIn(key, r.id)) rows.push({ id: r.id, name: String(r.name ?? "?"), v });
  }
  rows.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  cache.set(key, { t: now, rows });
  return rows;
}
function clanRows() { try { return (clanView.top() ?? []).filter((r) => !hid.hide.clan?.[r.id]); } catch (e) { return []; } }
/** the first n rows of a list as { id, name, text } (for the admin pages; clans too) */
export function topRows(key, n = 10) {
  if (key === "clan") return clanRows().slice(0, n).map((r) => ({ id: r.id, name: String(r.name), text: "§f" + r.members + " members §7| §a" + money(r.money) }));
  const L = LISTS[key]; if (!L) return [];
  return ranking(key, true).slice(0, n).map((r) => ({ id: r.id, name: r.name, text: L.fmt(r.v) }));
}

// ---------------------------------------------------------------- board text
const RANK = ["§6", "§b", "§e"];       // #1 gold, #2 aqua, #3 yellow, the rest dark aqua
const SEP = "§8-------------------------";
/** "You: #14 - $3,200" for a viewer (null when there is no viewer) */
function youLine(key, viewer) {
  if (!viewer) return null;
  try {
    if (key === "clan") {
      const c = clanOf(viewer);
      if (!c) return "§7You have no clan";
      const i = clanRows().findIndex((r) => r.id === c.id);
      return i >= 0 ? "§7Your clan: §e#" + (i + 1) : "§7Your clan is not ranked yet";
    }
    if (hiddenIn(key, viewer.id)) return "§cYou were removed from this leaderboard";
    const L = LISTS[key], rows = ranking(key), i = rows.findIndex((r) => r.id === viewer.id);
    return i >= 0 ? "§7You: §e#" + (i + 1) + " §8- " + L.fmt(rows[i].v) : "§7You: not ranked yet";
  } catch (e) { return null; }
}
function rowsOf(key) {
  if (key === "clan") return clanRows().slice(0, 10).map((r) => [r.name + " " + r.tag + "§r", "§f" + r.members + " members §7| §a" + money(r.money)]);
  const L = LISTS[key];
  return ranking(key).slice(0, 10).map((r) => [r.name, L.fmt(r.v)]);
}
const rowLine = (r, i) => (RANK[i] ?? "§3") + "§l#" + (i + 1) + " §f" + r[0] + " §8>> " + r[1];

/** lines of a board that one player asked for (shows only the real rows + his own place). Unknown key -> null */
export function tempLines(key, viewer) {
  const L = LISTS[key]; if (!L) return null;
  const rows = rowsOf(key), you = youLine(key, viewer);
  return ["§6§l" + L.title, "§b" + L.sub, SEP, ...(rows.length ? rows.map(rowLine) : ["§7Nobody yet."]), SEP, ...(you ? [you] : []), "§3" + L.foot];
}
/** lines of a fixed board: always the same number of lines (10 rows) so it can be updated in place */
export function fixedLines(key) {
  const L = LISTS[key]; if (!L) return null;
  const rows = rowsOf(key), out = [];
  for (let i = 0; i < 10; i++) out.push(rows[i] ? rowLine(rows[i], i) : "§8#" + (i + 1) + " §7-");
  return ["§6§l" + L.title, "§b" + L.sub, SEP, ...out, SEP, "§3" + L.foot];
}
/** plain chat version (used when a hologram can not be made) */
export function chatText(key, viewer) {
  const L = LISTS[key]; if (!L) return null;
  const rows = rowsOf(key), you = youLine(key, viewer);
  return "§6=== §c" + L.sub + " §6===" + (rows.length ? "\n" + rows.map((r, i) => "§6" + (i + 1) + ". §e" + r[0] + " §7- " + r[1]).join("\n") : "\n§7Nobody yet.") + (you ? "\n" + you : "");
}

// ---------------------------------------------------------------- "[Richest]" above the head
let richestId = null;
clanView.rankTag = (id) => (RICHEST_TAG && id && id === richestId ? RICHEST_TAG : "");
function updateRichest() {
  if (!RICHEST_TAG) return;
  const top = ranking("money", true)[0];
  const nid = top && top.v > 1000 ? top.id : null;
  if (nid === richestId) return;
  const old = richestId; richestId = nid;
  for (const p of world.getAllPlayers()) if (p.id === old || p.id === nid) applyTag(p);
}
world.afterEvents.playerSpawn.subscribe(({ player }) => { system.runTimeout(() => { try { if (player.id === richestId) applyTag(player); } catch (e) { /* ignore */ } }, 40); });

// ---------------------------------------------------------------- weekly rewards (top 3 of every player list)
const WEEK_KEY = "rk:week", PEND = "rk:pw:";
const PLAYER_LISTS = TOP_KEYS.filter((k) => k !== "clan");          // the clans already have their own daily reward
const weekNum = () => Math.floor((Math.floor((Date.now() + UTC_OFFSET_HOURS * 3600000) / 86400000) + 3) / 7);    // weeks start on Monday
function payWeekly() {
  let saved; try { saved = world.getDynamicProperty(WEEK_KEY); } catch (e) { return; }
  const now = weekNum();
  if (typeof saved !== "number") { try { world.setDynamicProperty(WEEK_KEY, now); } catch (e) { /* ignore */ } return; }   // first start: rewards begin with the next week
  if (now <= saved) return;
  try { world.setDynamicProperty(WEEK_KEY, now); } catch (e) { return; }                                                // marked FIRST, so it can never be paid twice
  const won = new Map();                                                                                                 // player id -> { total, parts }
  for (const k of PLAYER_LISTS) {
    ranking(k, true).slice(0, WEEKLY_REWARD.length).forEach((r, i) => {
      const amt = WEEKLY_REWARD[i];
      if (!amt || !addShardsById(r.id, amt)) return;
      const w = won.get(r.id) ?? { total: 0, parts: [] };
      w.total += amt; w.parts.push(LISTS[k].label + " #" + (i + 1));
      won.set(r.id, w);
    });
  }
  const online = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [id, w] of won) {
    const text = "§d[Weekly Top] §fYou earned §d" + num(w.total) + " shards §ffor: §e" + w.parts.join("§7, §e");
    const p = online.get(id);
    if (p) { try { notify(p, text, { key: "weekly_top" }); } catch (e) { /* ignore */ } }
    else { try { world.setDynamicProperty(PEND + id, text.slice(0, 250)); } catch (e) { /* ignore */ } }              // shown when he joins
  }
}
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      const t = world.getDynamicProperty(PEND + player.id);
      if (typeof t !== "string") return;
      world.setDynamicProperty(PEND + player.id, undefined);
      notify(player, t, { key: "weekly_top" });
    } catch (e) { /* ignore */ }
  }, 100);
});

// ---------------------------------------------------------------- rank watcher: "you entered the Top 10" / "X passed you"
const before = new Map();                              // list key -> Map(player id -> place)
const lastMsg = new Map();                             // "id|list" -> time of the last message
const gapOk = (id, k) => { const t = lastMsg.get(id + "|" + k) ?? 0; if (Date.now() - t < NOTIFY_GAP_MS) return false; lastMsg.set(id + "|" + k, Date.now()); return true; };
function watch() {
  const players = world.getAllPlayers();
  for (const k of PLAYER_LISTS) {
    const rows = ranking(k, true), now = new Map(rows.map((r, i) => [r.id, i + 1])), old = before.get(k);
    before.set(k, now);
    if (!old) continue;                                                                        // first look = only remember the places
    for (const p of players) {
      try {
        const r1 = now.get(p.id), r0 = old.get(p.id);
        if (r1 && r1 <= 10 && (!r0 || r0 > 10)) {
          if (gapOk(p.id, k)) notify(p, "§a[Top] §fYou entered the §6Top 10 " + LISTS[k].label + " §fat §e#" + r1 + "§f!", { key: "toprank_" + k });
        } else if (r0 && r0 <= 10 && (!r1 || r1 > r0)) {
          let by = null;
          for (let i = (r1 ?? rows.length + 1) - 2; i >= 0; i--) { const o = old.get(rows[i].id); if (o === undefined || o > r0) { by = rows[i]; break; } }     // the closest player above him who was below before
          if (by && gapOk(p.id, k)) notify(p, "§e[Top] §f" + by.name + " §epassed you in §6" + LISTS[k].label + " §7(#" + r0 + " §8> §7#" + (r1 ?? "10+") + ")", { key: "toprank_" + k });
        }
      } catch (e) { /* ignore one player */ }
    }
  }
}
function tick() {
  try { watch(); } catch (e) { console.warn("[ranks] watch: " + e); }
  try { updateRichest(); } catch (e) { console.warn("[ranks] richest: " + e); }
  try { payWeekly(); } catch (e) { console.warn("[ranks] weekly: " + e); }
}
system.runTimeout(tick, 200);                           // first look shortly after the world is ready
system.runInterval(tick, WATCH_EVERY);
