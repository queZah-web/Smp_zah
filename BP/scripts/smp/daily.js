// Daily reward with a streak. The "day" changes at midnight of UTC_OFFSET_HOURS (see config.js).
import { addMoney, addShards } from "../data.js";
import { give } from "../inv.js";
import { giveSpawner } from "../systems/spawners.js";
import { money, num } from "../format.js";
import { ex } from "./store.js";
import { notify, markKeyRead } from "./notify.js";
import { checkAchievements } from "./achievements.js";
import { DAILY, UTC_OFFSET_HOURS } from "./config.js";

const DAY = 86400000, OFFSET = UTC_OFFSET_HOURS * 3600000;
export const dayNumber = (t = Date.now()) => Math.floor((t + OFFSET) / DAY);
export const msToReset = () => (dayNumber() + 1) * DAY - OFFSET - Date.now();

const pretty = (id) => id.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
export function rewardLine(r) {
  const parts = [];
  if (r.money) parts.push("§a" + money(r.money));
  if (r.shards) parts.push("§d" + num(r.shards) + " shards");
  for (const [id, n] of r.items ?? []) parts.push("§f" + n + "x " + pretty(id));
  for (const [mob, n] of r.spawners ?? []) parts.push("§c" + n + "x " + pretty(mob) + " Spawner");
  return parts.join("§7 + ");
}

/** { available, alive, lost, streak, nextStreak, pos }   pos = which day (1..) of the cycle is claimed next (or was claimed today) */
export function dailyInfo(p) {
  const d = ex(p).daily, today = dayNumber();
  const available = d.last < today;
  const alive = d.last === today || d.last === today - 1;          // the streak is still running
  const nextStreak = available ? (d.last === today - 1 ? d.streak + 1 : 1) : d.streak;
  return { available, alive, lost: !alive && d.streak > 0, streak: alive ? d.streak : 0, nextStreak, pos: ((Math.max(1, nextStreak) - 1) % DAILY.length) + 1 };
}

export function claimDaily(p) {
  const info = dailyInfo(p);
  if (!info.available) return false;
  const d = ex(p).daily, r = DAILY[info.pos - 1];
  d.last = dayNumber(); d.streak = info.nextStreak; d.best = Math.max(d.best, d.streak); d.total += 1;
  if (r.money) addMoney(p, r.money);
  if (r.shards) addShards(p, r.shards);
  for (const [id, n] of r.items ?? []) give(p, id, n);
  for (const [mob, n] of r.spawners ?? []) giveSpawner(p, mob, n);
  markKeyRead(p, "daily");
  notify(p, `§a§l[Daily] §r§aDay ${info.pos} claimed §7(streak ${d.streak}): ${rewardLine(r)}`);
  try { p.playSound("random.levelup"); } catch (e) { /* ignore */ }
  checkAchievements(p);
  return true;
}

/** tells the player once per day that the reward is ready (stored in the notification center) */
export function remindDaily(p, chat = true) {
  const d = ex(p).daily, today = dayNumber();
  if (d.last >= today || d.notified === today) return false;
  d.notified = today;
  notify(p, "§e§l[Daily] §r§eYour daily reward is ready! §7(SMP menu > Daily Reward)", { key: "daily", chat });
  return true;
}
