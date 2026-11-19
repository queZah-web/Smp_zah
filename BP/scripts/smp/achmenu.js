// Achievement pages:  hub -> category pages, profile + titles, leaderboards, missions, server firsts.
// Same chest look as the other SMP pages (see ui.js).
import { knownPlayers } from "../data.js";
import { money, num, ago, countdown } from "../format.js";
import { ex, exOf } from "./store.js";
import { COLS, NAV, hdr, make, set, open, status, backBtn } from "./ui.js";
import {
  ACHIEVEMENTS, CATEGORIES, TIERS, DIFF, TITLES, MAX_AP, catOf, catTotal, catDoneOfData, apOfData, monthApOfData, monthLabel, apOf, isDone, fmtVal, rewardText,
  achievementCount, titleOwned, titleTag, selectTitle, titleById, firstOf, allFirsts,
} from "./achievements.js";
import { missionList, claimMission, readyCount, periodLabel, BONUS, allClaimed, bonusTaken, msToWeekReset } from "./missions.js";
import { msToReset } from "./daily.js";
import { titlesPage } from "./cosmenu.js";

const ICON = { star: "textures/items/nether_star", paper: "textures/items/paper", tag: "textures/items/name_tag", gold: "textures/items/gold_ingot", iron: "textures/items/iron_ingot", copper: "textures/items/copper_ingot", book: "textures/items/book_writable", player: NAV.player, clock: "textures/items/clock_item", emerald: "textures/items/emerald" };
const bar = (v, g) => { const n = Math.max(0, Math.min(10, Math.floor((v / g) * 10))); return "§a" + "|".repeat(n) + "§8" + "|".repeat(10 - n); };
const tierLabel = (a) => (a.diff === "legendary" ? "§dLegendary" : a.chain ? TIERS[Math.min(a.tier, 3)].color + TIERS[Math.min(a.tier, 3)].name : DIFF[a.diff].color + DIFF[a.diff].name);
const slotAt = (row, col) => row * COLS + col;

// ================================================================ hub
export function achHub(player, back) {
  const e = ex(player), done = achievementCount(player), ap = apOf(player), t = titleById(e.title);
  const f = make("Achievements §8(" + done + "/" + ACHIEVEMENTS.length + ")", 9); f.self = () => achHub(player, back);
  set(f, slotAt(0, 4), hdr(1) + "§6§l" + player.name + "\n§r§7Achievement Points: §e" + num(ap) + "§7/" + num(MAX_AP) + "\n§r§7This month (" + monthLabel() + "): §e" + num(monthApOfData(e)) + " AP\n§r§7Unlocked: §f" + done + "§7/§f" + ACHIEVEMENTS.length + "\n§r§7Title: " + (t && e.title ? t.color + t.name : "§8none"), ICON.star, null);
  CATEGORIES.forEach((c, i) => {
    const d = catDoneOfData(e, c.id), tot = catTotal(c.id), row = i < 4 ? 2 : 4, col = 1 + 2 * (i % 4);
    set(f, slotAt(row, col), hdr(d >= tot ? 1 : 1, d >= tot ? "g" : "c") + c.color + "§l" + c.name + "\n§r§7" + c.text + "\n§r§7Done: §f" + d + "§7/§f" + tot + "\n§r" + bar(d, tot), c.icon, { run: () => categoryPage(player, c.id, 0, () => achHub(player, back)) });
  });
  const rc = readyCount(player), hub = () => achHub(player, back);
  set(f, slotAt(6, 1), hdr(1) + "§e§lProfile & Badges\n§r§7Your badges, server firsts\n§r§7and your title (in Cosmetics)", "textures/ui/shop/ic_medal", { run: () => profilePage(player, hub) });
  set(f, slotAt(6, 3), hdr(Math.max(1, rc), rc ? "g" : "c") + "§b§lMissions\n§r§7Daily and weekly missions\n§r" + (rc ? "§a" + rc + " ready to claim!" : "§7Small rewards, every day"), ICON.clock, { run: () => missionsPage(player, hub) });
  set(f, slotAt(6, 5), hdr(1) + "§d§lLeaderboards\n§r§7All-time, monthly and\n§r§7category masters", "textures/ui/shop/ic_trophy", { run: () => boardPage(player, "all", hub) });
  set(f, slotAt(6, 7), hdr(1) + "§6§lServer Firsts\n§r§7Who was the first to do\n§r§7the hardest things", "textures/ui/shop/ic_medal", { run: () => firstsPage(player, hub) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ one category
export function categoryPage(player, catId, page, back) {
  const c = catOf(catId), e = ex(player), list = ACHIEVEMENTS.filter((a) => a.cat === catId);
  const f = make(c.name + " §8(" + catDoneOfData(e, catId) + "/" + list.length + ")", 9); f.self = () => categoryPage(player, catId, page, back);
  list.slice(0, 72).forEach((a, i) => {
    const d = DIFF[a.diff], head = tierLabel(a) + " §8| " + d.color + d.name + " §8| §7" + d.ap + " AP";
    const fr = a.first ? (() => { const r = firstOf(a.id); return "\n§r§e★ First on the server: " + (r ? "§f" + r.n : "§7nobody yet"); })() : "";
    if (isDone(player, a)) set(f, i, hdr(1, "g") + "§a§l" + a.name + "\n§r§7" + a.desc + "\n§r" + head + "\n§r§aUnlocked §8(" + ago(e.ach[a.id]) + ")\n§r§7Reward: " + rewardText(a.reward) + fr, a.icon, null);
    else {
      let v = 0; try { v = Math.min(a.val(player), a.goal); } catch (err) { /* ignore */ }
      const pct = Math.floor((v / a.goal) * 100);
      set(f, i, hdr(1, "r") + "§c§l" + a.name + "\n§r§7" + a.desc + "\n§r" + head + "\n§r§7Progress: §f" + fmtVal(a, v) + "§7 / §f" + fmtVal(a, a.goal) + " §8(" + pct + "%)\n§r" + bar(v, a.goal) + "\n§r§7Reward: " + rewardText(a.reward) + fr, a.icon, null);
    }
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ profile + titles
export function profilePage(player, back) {
  const e = ex(player), f = make("Profile & Badges"); f.self = () => profilePage(player, back);
  const byDiff = Object.keys(DIFF).map((k) => { const l = ACHIEVEMENTS.filter((a) => a.diff === k); return DIFF[k].color + DIFF[k].name + " §f" + l.filter((a) => e.ach[a.id]).length + "§7/§f" + l.length; });
  const mine = Object.entries(allFirsts()).filter(([, r]) => r.p === player.id).map(([id]) => ACHIEVEMENTS.find((a) => a.id === id)?.name).filter(Boolean);
  const cur = titleById(e.title);
  set(f, slotAt(0, 4), hdr(1) + "§6§l" + player.name + " " + titleTag(player) + "\n§r§7Achievement Points: §e" + num(apOf(player)) + "§7/" + num(MAX_AP) + "\n§r§7Rank this month: §f" + (rankOf(player, "month") ?? "-") + "§7 | all-time: §f" + (rankOf(player, "all") ?? "-"), ICON.star, null);
  set(f, slotAt(3, 4), hdr(1) + "§e§lChange title\n§r§7Titles moved to Cosmetics\n§r§eClick to open", ICON.tag, { run: () => titlesPage(player, 0, () => profilePage(player, back)) });
  set(f, slotAt(5, 2), hdr(1) + "§e§lBadges\n§r" + byDiff.join("\n§r"), "textures/ui/shop/ic_medal", null);
  set(f, slotAt(5, 4), hdr(Math.max(1, mine.length), mine.length ? "g" : "c") + "§6§l★ Server Firsts\n§r" + (mine.length ? "§f" + mine.join("§7, §f") : "§7You hold no first record yet"), ICON.gold, null);
  set(f, slotAt(5, 6), hdr(1) + "§b§lCurrent title\n§r" + (cur && e.title ? cur.color + cur.name : "§7none") + "\n§r§7It shows next to your name in chat.", ICON.tag, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ leaderboards
function everyone() {
  const out = [];
  for (const k of knownPlayers()) { try { out.push({ id: k.id, name: k.name, d: exOf(k.id) }); } catch (err) { /* skip */ } }
  return out;
}
function rankOf(player, kind) {
  try {
    const fn = kind === "month" ? monthApOfData : apOfData, me = ex(player), mine = fn(me);
    if (mine <= 0) return null;
    return 1 + everyone().filter((x) => x.id !== player.id && fn(x.d) > mine).length;
  } catch (err) { return null; }
}
export function boardPage(player, tab, back) {
  const f = make("Leaderboards", 9); f.self = () => boardPage(player, tab, back);
  const all = everyone();
  const medal = [ICON.gold, ICON.iron, ICON.copper];
  if (tab === "cats") {
    CATEGORIES.forEach((c, i) => {
      const best = all.map((x) => ({ n: x.name, v: catDoneOfData(x.d, c.id) })).sort((a, b) => b.v - a.v)[0];
      set(f, slotAt(i < 4 ? 1 : 3, 1 + 2 * (i % 4)), hdr(1) + c.color + "§l" + c.name + " Master\n§r" + (best && best.v > 0 ? "§f" + best.n + "\n§r§7" + best.v + "/" + catTotal(c.id) + " achievements" : "§7Nobody yet"), c.icon, null);
    });
  } else {
    const fn = tab === "month" ? monthApOfData : apOfData;
    const rows = all.map((x) => ({ id: x.id, n: x.name, v: fn(x.d) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    rows.slice(0, 10).forEach((r, i) => {
      const slot = slotAt(i < 5 ? 1 : 3, 2 + (i % 5));
      set(f, slot, hdr(i + 1, r.id === player.id ? "g" : "c") + (i < 3 ? "§6§l" : "§f§l") + "#" + (i + 1) + " " + r.n + "\n§r§e" + num(r.v) + " AP" + (tab === "month" ? " §7(" + monthLabel() + ")" : ""), medal[i] ?? ICON.paper, null);
    });
    if (!rows.length) set(f, slotAt(2, 4), hdr(1) + "§7Nobody has points yet", ICON.paper, null);
    const mine = fn(ex(player)), pos = rows.findIndex((r) => r.id === player.id);
    set(f, slotAt(5, 4), hdr(1) + "§e§lYou\n§r§7Points: §e" + num(mine) + " AP\n§r§7Rank: §f" + (pos >= 0 ? "#" + (pos + 1) : "-") + (tab === "month" ? "\n§r§8The monthly board resets on the 1st." : ""), ICON.star, null);
  }
  set(f, slotAt(7, 2), hdr(1, tab === "all" ? "g" : "c") + "§6§lAll-time AP\n§r§7Total achievement points", ICON.gold, { run: () => boardPage(player, "all", back) });
  set(f, slotAt(7, 4), hdr(1, tab === "month" ? "g" : "c") + "§b§lThis month\n§r§7" + monthLabel() + " (resets on the 1st)", ICON.clock, { run: () => boardPage(player, "month", back) });
  set(f, slotAt(7, 6), hdr(1, tab === "cats" ? "g" : "c") + "§d§lCategory masters\n§r§7Most achievements per category", "textures/ui/shop/ic_medal", { run: () => boardPage(player, "cats", back) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ missions
export function missionsPage(player, back) {
  const f = make("Missions", 9); f.self = () => missionsPage(player, back);
  const draw = (per, row, cols) => {
    const list = missionList(player, per);
    list.forEach((x, i) => {
      const m = x.m, body = "\n§r§7" + m.desc + "\n§r§7Progress: §f" + num(x.prog) + "§7 / §f" + num(m.goal) + "\n§r" + bar(x.prog, m.goal) + "\n§r§7Reward: §a" + money(m.money) + (m.shards ? "§7 + §d" + m.shards + " shards" : "");
      if (x.claimed) set(f, slotAt(row, cols[i]), hdr(1, "g") + "§a§l" + m.name + body + "\n§r§aClaimed", "textures/ui/shop/ic_confirm", null);
      else if (x.complete) set(f, slotAt(row, cols[i]), hdr(1, "g") + "§e§l" + m.name + body + "\n§r§eClick to claim!", ICON.emerald, { run: () => { claimMission(player, per, m.id); missionsPage(player, back); } });
      else set(f, slotAt(row, cols[i]), hdr(1, "r") + "§c§l" + m.name + body, ICON.paper, null);
    });
    const b = BONUS[per], got = bonusTaken(player, per);
    set(f, slotAt(row + 1, 4), hdr(1, got ? "g" : "c") + "§6§l" + periodLabel(per) + " bonus\n§r§7Finish all missions: §a" + money(b.money) + "§7 + §d" + b.shards + " shards\n§r" + (got ? "§aReceived" : allClaimed(player, per) ? "§aDone" : "§7Claim every mission first"), ICON.gold, null);
  };
  set(f, slotAt(0, 2), hdr(1) + "§b§lDaily missions\n§r§7New ones in §f" + countdown(msToReset()), ICON.clock, null);
  draw("d", 1, [2, 4, 6]);
  set(f, slotAt(4, 2), hdr(1) + "§d§lWeekly missions\n§r§7New ones in §f" + countdown(msToWeekReset()), ICON.clock, null);
  draw("w", 5, [3, 5, 0]);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ server firsts
export function firstsPage(player, back) {
  const f = make("Server Firsts", 9); f.self = () => firstsPage(player, back);
  const list = ACHIEVEMENTS.filter((a) => a.first);
  set(f, slotAt(0, 4), hdr(1) + "§6§l★ Server Firsts\n§r§7The first player to unlock these\n§r§7keeps the record forever.\n§r§8Counted from the day this system started.", "textures/ui/shop/ic_medal", null);
  list.forEach((a, i) => {
    const r = firstOf(a.id), d = DIFF[a.diff];
    set(f, slotAt(2, 3 + 2 * i), hdr(1, r ? "g" : "c") + "§e§l" + a.name + "\n§r§7" + a.desc + "\n§r" + d.color + d.name + "\n§r" + (r ? "§6★ §f" + r.n + "\n§r§8" + ago(r.t) : "§aNobody yet - be the first!"), a.icon, null);
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
