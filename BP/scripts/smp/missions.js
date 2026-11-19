// Daily and weekly missions.  Everybody gets the same missions on the same day / week (chosen by a fixed shuffle of the day number).
//  * Progress = how much the player's own counters grew since the missions were handed out - nothing can be pre-farmed.
//  * Rewards are small on purpose (a few thousand $ per day): missions are a nudge to play, never the fastest way to get rich.
//  * Mission rewards give money / shards only (no AP), so the leaderboards stay about real achievements.
import { addMoney, addShards, playSeconds } from "../data.js";
import { money, num } from "../format.js";
import { ex } from "./store.js";
import { notify } from "./notify.js";
import { dayNumber } from "./daily.js";
import { UTC_OFFSET_HOURS } from "./config.js";

const DAY = 86400000, OFFSET = UTC_OFFSET_HOURS * 3600000;
export const weekNumber = (t = Date.now()) => Math.floor((dayNumber(t) + 3) / 7);          // a week starts on Monday (midnight of the server time zone)
export const msToWeekReset = () => ((weekNumber() + 1) * 7 - 3) * DAY - OFFSET - Date.now();

// key = which counter grows: a name of ex(p).st, or "play" (minutes played)
export const DAILY_POOL = [
  { id: "d_break", name: "Digger", desc: "Break 400 blocks", key: "broken", goal: 400, money: 1200 },
  { id: "d_ores", name: "Prospector", desc: "Mine 30 ores", key: "ores", goal: 30, money: 1800 },
  { id: "d_mobs", name: "Monster Patrol", desc: "Kill 30 mobs", key: "mobs", goal: 30, money: 1500 },
  { id: "d_sell", name: "Market Day", desc: "Sell 100 items to the shop", key: "sold", goal: 100, money: 1200 },
  { id: "d_place", name: "Builder", desc: "Place 300 blocks", key: "placed", goal: 300, money: 1000 },
  { id: "d_play", name: "Stay a While", desc: "Play for 45 minutes", key: "play", goal: 45, money: 1000 },
  { id: "d_trade", name: "Busy Trader", desc: "Complete 15 shop transactions", key: "trades", goal: 15, money: 1000 },
];
export const WEEKLY_POOL = [
  { id: "w_break", name: "Quarry Master", desc: "Break 5,000 blocks", key: "broken", goal: 5000, money: 12000, shards: 10 },
  { id: "w_ores", name: "Ore Rush", desc: "Mine 300 ores", key: "ores", goal: 300, money: 15000, shards: 10 },
  { id: "w_mobs", name: "Monster Purge", desc: "Kill 400 mobs", key: "mobs", goal: 400, money: 12000, shards: 10 },
  { id: "w_sell", name: "Export Week", desc: "Sell 1,500 items to the shop", key: "sold", goal: 1500, money: 10000, shards: 10 },
  { id: "w_play", name: "Long Haul", desc: "Play for 8 hours", key: "play", goal: 480, money: 10000, shards: 10 },
  { id: "w_trade", name: "Trade Network", desc: "Complete 150 shop transactions", key: "trades", goal: 150, money: 10000, shards: 10 },
];
export const BONUS = { d: { money: 2000, shards: 5 }, w: { money: 5000, shards: 20 } };     // for finishing ALL missions of the period
const COUNT = { d: 3, w: 2 };
const POOL = { d: DAILY_POOL, w: WEEKLY_POOL };

const cur = (p, key) => (key === "play" ? Math.floor(playSeconds(p) / 60) : (ex(p).st[key] ?? 0));
function pick(pool, n, seed) {                                // fixed shuffle (mulberry32) so everybody gets the same missions
  let a = (seed * 2654435761) >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const l = pool.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l.slice(0, n);
}
const periodNo = (per) => (per === "d" ? dayNumber() : weekNumber());

/** the current state of one period ("d" or "w"); a new period hands out new missions with fresh counters */
function state(p, per) {
  const m = (ex(p).mis ??= {});
  let s = m[per];
  const no = periodNo(per);
  if (!s || s.n !== no) {
    const list = pick(POOL[per], COUNT[per], no * 2 + (per === "d" ? 1 : 2));
    s = m[per] = { n: no, ids: list.map((x) => x.id), base: {}, claimed: {}, done: {}, bonus: 0 };
    for (const x of list) s.base[x.key] = cur(p, x.key);
  }
  return s;
}
export const periodLabel = (per) => (per === "d" ? "Daily" : "Weekly");

/** [{ m, prog, complete, claimed }] */
export function missionList(p, per) {
  const s = state(p, per);
  return s.ids.map((id) => {
    const m = POOL[per].find((x) => x.id === id), prog = Math.max(0, Math.min(m.goal, cur(p, m.key) - (s.base[m.key] ?? 0)));
    return { m, prog, complete: prog >= m.goal, claimed: !!s.claimed[id] };
  });
}
export const readyCount = (p) => { try { return missionList(p, "d").concat(missionList(p, "w")).filter((x) => x.complete && !x.claimed).length; } catch (e) { return 0; } };
export const allClaimed = (p, per) => missionList(p, per).every((x) => x.claimed);
export const bonusTaken = (p, per) => state(p, per).bonus === 1;

export function claimMission(p, per, id) {
  const s = state(p, per), x = missionList(p, per).find((y) => y.m.id === id);
  if (!x || !x.complete || x.claimed) return false;
  s.claimed[id] = 1;
  if (x.m.money) addMoney(p, x.m.money);
  if (x.m.shards) addShards(p, x.m.shards);
  notify(p, `§b§l[Mission] §r§f${x.m.name} §7- §a${money(x.m.money)}` + (x.m.shards ? `§7 + §d${num(x.m.shards)} shards` : ""));
  if (allClaimed(p, per) && !s.bonus) {
    s.bonus = 1; const b = BONUS[per];
    addMoney(p, b.money); addShards(p, b.shards);
    notify(p, `§b§l[Mission] §r§f${periodLabel(per)} bonus: all missions done! §7- §a${money(b.money)}§7 + §d${b.shards} shards`);
  }
  try { p.playSound("random.levelup"); } catch (e) { /* ignore */ }
  return true;
}

/** tells the player (once per mission) that a mission is finished */
export function tickMissions(p) {
  for (const per of ["d", "w"]) {
    const s = state(p, per); s.seen ??= {};
    for (const x of missionList(p, per)) {
      if (!x.complete || s.seen[x.m.id]) continue;
      s.seen[x.m.id] = 1;
      notify(p, `§b§l[Mission] §r§fMission complete: §e${x.m.name} §7- claim it in SMP menu > Achievements > Missions`, { key: "mission" });
    }
  }
}
