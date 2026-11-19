// SMP menu (dashboard) and its pages: Statistics, Achievements, Daily Reward, Notifications, Settings.
// The Shop stays exactly as it was - the dashboard only opens it (main.js registers the opener with setShopOpener).
import { system } from "@minecraft/server";
import { stats, playSeconds } from "../data.js";
import { money, num, playtime, ago, countdown } from "../format.js";
import { progress } from "../xp.js";
import { ex } from "./store.js";
import { getLang, setLang } from "./lang.js";
import { t, tr } from "./i18n.js";
import { notes, unread, markAllRead, clearNotes, inferGo } from "./notify.js";
import { ACHIEVEMENTS, achievementCount, apOf, MAX_AP } from "./achievements.js";
import { achHub, profilePage as achProfilePage, missionsPage } from "./achmenu.js";
import { readyCount } from "./missions.js";
import { DAILY } from "./config.js";
import { dailyInfo, claimDaily, rewardLine, msToReset } from "./daily.js";
import { COLS, NAV_START, NAV, hdr, make, set, open, status, backBtn } from "./ui.js";
import { homePage } from "../systems/homes.js";
import { rtpPage } from "../systems/rtp.js";
import { goSpawn } from "../systems/spawn.js";
import { tpaPage, pending as tpPending } from "../systems/tpa.js";
import { clanPage, clanOf } from "../systems/clans.js";
import { miningPage } from "../systems/miningmenu.js";
import { landPage } from "../systems/landmenu.js";
import { nvPage } from "../systems/nvmenu.js";
import { payPage } from "../systems/pay.js";
import { ranksPage } from "./rankmenu.js";
import { ahPage } from "./ahmenu.js";
import { orderPage } from "./ordermenu.js";
import { cosmeticsPage, fxPage } from "./cosmenu.js";
import { skillsPage } from "../systems/skillsmenu.js";
import { crownPage } from "../systems/crownmenu.js";
import { afkCommand } from "../systems/afk.js";
import { warpPage, warpCount, WARP_ICON } from "../systems/warp.js";
import { sellSlotOn, toggleSellSlot } from "../systems/sellslot.js";

let openShop = null;
export const setShopOpener = (fn) => { openShop = fn; };

const ICON = {
  time: "textures/ui/shop/hud_time", kills: "textures/ui/shop/hud_kills", deaths: "textures/ui/shop/hud_deaths", money: "textures/ui/shop/hud_money",
  pick: "textures/items/iron_pickaxe", block: "textures/ui/shop/i3d_cobblestone", sword: "textures/items/iron_sword", buy: "textures/items/diamond",
  sell: "textures/items/emerald", book: "textures/items/book_writable", star: "textures/items/nether_star", paper: "textures/items/paper",
  tag: "textures/items/name_tag", shard: "textures/ui/shop/hud_shards",
};
const HUD_LABEL = { panel: "side panel", bar: "action bar", off: "off" };

/** text of the "SMP Menu" button that main.js puts into the shop's main menu */
export function smpButtonText(player) {
  const n = unread(player), d = dailyInfo(player);
  return hdr(n) + t(player, "menu.button") + (d.available ? t(player, "menu.button.daily") : "") + (n > 0 ? t(player, n > 1 ? "menu.button.newN" : "menu.button.new1", n) : "");
}
export const smpButtonIcon = ICON.star;

// ================================================================ dashboard
// Tooltip in the "Where to?" style: green name, grey description, white "Click to ..." line, grey command hint.
const TIP = (name, lines, click, cmd, zone = "c") => hdr(1, zone) + "§a" + name + lines.map((l) => "\n§r§7" + l).join("") + (click ? "\n§r§f" + click : "") + (cmd ? "\n§r§8" + cmd : "");

export function dashboard(player) {
  const s = stats(player), di = dailyInfo(player), n = unread(player);
  const f = make(t(player, "menu.title"), 6); f.self = () => dashboard(player);
  f.glass = true;                                                  // every empty slot = Black Stained Glass Pane (same icon as /shop > Colored Blocks), no tooltip, click does nothing
  f.noRefresh = true;                                              // the menu rebuilds every time it is opened
  const S = (r, c) => r * COLS + c;
  const toMenu = () => dashboard(player);

  // LAYOUT (6 rows x 9 columns).  Every row is filled by place(): the buttons that exist are centred in the row,
  // so when a button is missing (no shop, no warps ...) the rest moves together and the menu keeps a clean, symmetric shape.
  //   row 0  GO / MONEY  Spawn . Homes . Random TP . TP Requests . SHOP . Pay . Auction . Orders . Ranks
  //   row 1  WARPS       Warps
  //   row 2  YOU         Profile . Skills . Statistics . Achievements . Daily . Notifications     (Skills + Abilities are ONE button now)
  //   row 3  TOOLS       Clans . Mining . Land . Night Vision . AFK . Cosmetics . Crowns
  //   row 4  Language . Red Sell Slot (ON / OFF)
  //   row 5  FOOTER      Tip . Settings . Balance
  const POS = { 1: [4], 2: [3, 5], 3: [2, 4, 6], 4: [1, 3, 5, 7], 5: [0, 2, 4, 6, 8], 6: [1, 2, 3, 5, 6, 7], 7: [1, 2, 3, 4, 5, 6, 7], 8: [0, 1, 2, 3, 5, 6, 7, 8], 9: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  const place = (row, list) => { const l = list.filter(Boolean).slice(0, 9); const pos = POS[l.length] || []; l.forEach((fn, i) => fn(S(row, pos[i]))); };
  const T = (key, cmd, zone = "c", extra = [], click = "click.open") => TIP(t(player, key + ".name"), [].concat(t(player, key + ".lines"), extra), t(player, click), cmd, zone);

  place(0, [
    (sl) => set(f, sl, T("spawn", "/spawn", "c", [], "click.teleport"), "textures/items/compass_item", { run: () => goSpawn(player) }),
    (sl) => set(f, sl, T("homes", "/home  /sethome"), "textures/items/bed_red", { run: () => homePage(player, toMenu) }),
    (sl) => set(f, sl, T("rtp", "/rtp"), "textures/items/ender_pearl", { run: () => rtpPage(player, toMenu) }),
    (sl) => set(f, sl, T("tpa", "/tpa  /tphere  /tpaccept", "c", tpPending(player) ? [t(player, "tpa.waiting")] : []), "textures/items/ender_eye", { run: () => tpaPage(player, toMenu) }),
    openShop ? ((sl) => set(f, sl, T("shop", null, "g"), NAV.chest, { run: () => openShop(player) })) : null,
    (sl) => set(f, sl, T("pay", "/pay"), ICON.money, { run: () => payPage(player, toMenu) }),
    (sl) => set(f, sl, T("ah", "/ah"), "textures/ui/shop/ic_gavel", { run: () => ahPage(player, toMenu) }),
    (sl) => set(f, sl, T("orders", "/order"), "textures/items/book_writable", { run: () => orderPage(player, toMenu) }),
    (sl) => set(f, sl, T("ranks", "/top"), "textures/ui/shop/ic_trophy", { run: () => ranksPage(player, toMenu) }),
  ]);

  // row 1: Warps (visible to every player; admins get Add / Edit / Remove inside the page)
  place(1, [
    (sl) => { const wc = warpCount();
      set(f, sl, TIP(t(player, "warps.name"), [wc > 0 ? t(player, wc === 1 ? "warps.one" : "warps.many", wc) : t(player, "warps.none"), t(player, "warps.tp")], t(player, "click.open"), "/warp"), WARP_ICON, { run: () => warpPage(player, toMenu) }); },
  ]);

  // row 2: you  (Skills = levels + rewards + abilities, all on one page)
  place(2, [
    (sl) => set(f, sl, hdr(1) + t(player, "profile.text", player.name, money(s.money), num(s.shards), playtime(playSeconds(player)), progress(s.bxp).level, progress(s.sxp).level, achievementCount(player), ACHIEVEMENTS.length, apOf(player), di.streak, tr(player, di.streak === 1 ? "day" : "days")), NAV.player, null),
    (sl) => set(f, sl, T("skills", "/skills"), "textures/items/iron_axe", { run: () => skillsPage(player, toMenu) }),
    (sl) => set(f, sl, T("stats", null), "textures/ui/shop/ic_stats", { run: () => statsPage(player) }),
    (sl) => set(f, sl, TIP(t(player, "ach.name"), [t(player, "ach.unlocked", achievementCount(player), ACHIEVEMENTS.length)].concat(readyCount(player) ? [t(player, "ach.ready")] : []), t(player, "click.open")), ICON.star, { run: () => achievementsPage(player) }),
    (sl) => set(f, sl, TIP(t(player, "daily.name"), [di.available ? t(player, "daily.available") : t(player, "daily.next", countdown(msToReset())), t(player, "daily.streak", di.streak)], di.available ? t(player, "click.claim") : t(player, "click.open"), null, di.available ? "g" : "c"), "textures/ui/shop/ic_gift", { run: () => dailyPage(player) }),
    (sl) => set(f, sl, TIP(t(player, "notif.name"), [n > 0 ? t(player, "notif.new", n) : t(player, "notif.none")], t(player, "click.open"), null, "c").replace(/^c\d\d/, hdr(n)), "textures/ui/shop/ic_mail", { run: () => notificationsPage(player) }),
  ]);

  // row 3: tools
  place(3, [
    (sl) => set(f, sl, T("clans", "/clan  /clanhome"), ICON.tag, { run: () => clanPage(player, toMenu) }),
    (sl) => set(f, sl, T("mining", "/mining"), "textures/items/diamond_pickaxe", { run: () => miningPage(player, toMenu) }),
    (sl) => set(f, sl, T("land", "/protect"), NAV.shield, { run: () => landPage(player, toMenu) }),
    (sl) => set(f, sl, T("nv", "/nv"), "textures/ui/shop/nv_potion", { run: () => nvPage(player, toMenu) }),
    (sl) => set(f, sl, T("afk", "/afk", "c", [], "click.teleport"), "textures/items/clock_item", { run: () => afkCommand(player) }),
    (sl) => set(f, sl, T("cos", "/cosmetics"), "textures/ui/shop/x_firework_star", { run: () => cosmeticsPage(player, toMenu) }),
    (sl) => set(f, sl, T("crowns", null), "textures/ui/shop/ic_crown", { run: () => crownPage(player, toMenu) }),
  ]);

  // row 4: Language (Arabic / English)
  place(4, [
    (sl) => set(f, sl, TIP(t(player, "lang.name"), [t(player, "lang.now", tr(player, getLang(player) === "ar" ? "lang.ar" : "lang.en")), t(player, "lang.choose")], t(player, "click.open"), null), "textures/items/book_enchanted", { run: () => languagePage(player) }),
    (sl) => { const on = sellSlotOn(player);   // red sell slot: one click switches it ON / OFF (state shown by the colour)
      set(f, sl, TIP(t(player, "sellslot.name"), [t(player, "sellslot.now", tr(player, on ? "sellslot.on" : "sellslot.off")), t(player, "sellslot.where"), t(player, "sellslot.desc")], t(player, on ? "sellslot.turnoff" : "sellslot.turnon"), "/sellslot", on ? "g" : "r"), "textures/items/redstone_dust", { run: () => { toggleSellSlot(player); dashboard(player); } }); },
  ]);

  // row 5: footer
  place(5, [
    (sl) => set(f, sl, hdr(1) + t(player, "tip.text"), "textures/ui/shop/ic_help", null),
    (sl) => set(f, sl, T("settings", null), "textures/ui/shop/ic_gear", { run: () => settingsPage(player) }),
    (sl) => status(player, f, sl),
  ]);
  open(player, f);
}

// ================================================================ statistics
export function statsPage(player) {
  const s = stats(player), t = ex(player).st, f = make("Statistics", 6); f.self = () => statsPage(player);
  const cell = (row, col, icon, title, ...lines) => set(f, ({ 1: 1, 3: 2, 5: 3, 7: 4 }[row]) * COLS + col, hdr(1) + "§e§l" + title + lines.map((l) => "\n§r" + l).join(""), icon, null);
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
  cell(1, 2, ICON.time, "Playtime", "§7Total: §f" + playtime(playSeconds(player)), ...(s.joined ? ["§7First seen: §f" + ago(s.joined)] : []));
  cell(1, 4, ICON.pick, "Blocks Broken", "§f" + num(t.broken));
  cell(1, 6, ICON.block, "Blocks Placed", "§f" + num(t.placed));
  cell(3, 2, ICON.sword, "Mobs Killed", "§f" + num(t.mobs));
  cell(3, 4, ICON.kills, "Players Killed", "§f" + num(s.kills), "§7K/D ratio: §f" + kd);
  cell(3, 6, ICON.deaths, "Deaths", "§f" + num(s.deaths));
  cell(5, 2, ICON.buy, "Items Bought", "§f" + num(t.bought));
  cell(5, 4, ICON.sell, "Items Sold", "§f" + num(t.sold));
  cell(5, 6, ICON.book, "Transactions", "§f" + num(t.trades));
  cell(7, 2, ICON.money, "Shop Money", "§7Spent: §c" + money(s.spent), "§7Earned: §a" + money(s.earned));
  cell(7, 4, ICON.star, "Achievements", "§f" + achievementCount(player) + "§7/§f" + ACHIEVEMENTS.length);
  const d = ex(player).daily;
  cell(7, 6, ICON.sell, "Daily Rewards", "§7Claimed: §f" + num(d.total), "§7Best streak: §f" + d.best + " days");
  backBtn(f, () => dashboard(player)); status(player, f);
  open(player, f);
}

// ================================================================ achievements (pages live in achmenu.js)
export function achievementsPage(player) { achHub(player, () => dashboard(player)); }

// ================================================================ daily reward
export function dailyPage(player) {
  const f = make("Daily Reward"); f.self = () => dailyPage(player);
  const info = dailyInfo(player), d = ex(player).daily;
  const claim = () => { claimDaily(player); dailyPage(player); };
  const rows = Math.ceil(DAILY.length / 7);
  DAILY.forEach((r, i) => {
    const day = i + 1, today = info.available && day === info.pos, claimed = info.available ? day < info.pos : day <= info.pos;
    const slot = (1 + 2 * Math.floor(i / 7)) * COLS + 1 + (i % 7);
    const name = (r.rare ? "§6§lDay " : "§f§lDay ") + day;
    if (claimed) set(f, slot, hdr(day, "g") + name + "\n§r§aClaimed\n§r§7Reward: " + rewardLine(r), r.icon ?? (r.rare ? ICON.star : ICON.sell), null);
    else if (today) set(f, slot, hdr(day) + name + " §e(TODAY)\n§r§7Reward: " + rewardLine(r) + "\n§r§eClick to claim", r.icon ?? (r.rare ? ICON.star : ICON.sell), { run: claim });
    else set(f, slot, hdr(day) + name + "\n§r§7Reward: " + rewardLine(r) + (r.rare ? "\n§r§6Rare reward!" : ""), r.icon ?? (r.rare ? ICON.star : ICON.sell), null);
  });
  const base = 1 + 2 * rows;
  if (info.available) set(f, base * COLS + 4, hdr(1, "g") + "§a§lClaim Day " + info.pos + " reward\n§r§7Reward: " + rewardLine(DAILY[info.pos - 1]) + "\n§r§eClick to claim", NAV.ok, { run: claim });
  else set(f, base * COLS + 4, hdr(1, "r") + "§c§lAlready claimed today\n§r§7Next reward in §f" + countdown(msToReset()), NAV.no, null);
  set(f, (base + 2) * COLS + 4, hdr(1) + "§e§lYour streak\n§r§7Current: §f" + info.streak + " day" + (info.streak === 1 ? "" : "s") + "\n§r§7Best: §f" + d.best + "\n§r§7Total claims: §f" + d.total +
    (info.lost ? "\n§r§cYour streak was broken. You start again at Day 1." : "\n§r§8Miss a day and the streak starts again at Day 1."), ICON.star, null);
  backBtn(f, () => dashboard(player)); status(player, f);
  open(player, f);
}

// ================================================================ notifications
// Where each notification leads.  id -> { open(player, back), steps (how to get there by hand), block?(player, note) }.
// block() returns { reason, steps? } when the player cannot open that place right now: then a guide page explains
// the way ("Step 1 / Step 2 / ...") instead of opening it.  The id of a note comes from notify.js (opts.go or its [Tag]).
const MENU_STEP = ["nt.p.menu"], OPEN_STEP = (id) => ["nt.p.open", "nt.d." + id];
const DEST = {
  orders:   { open: (p, b) => orderPage(p, b), steps: [MENU_STEP, OPEN_STEP("orders"), ["nt.p.or2"]] },
  ah:       { open: (p, b) => ahPage(p, b), steps: [MENU_STEP, OPEN_STEP("ah"), ["nt.p.ah2"]] },
  clan:     { open: (p, b) => clanPage(p, b), steps: [MENU_STEP, OPEN_STEP("clan")],
              block: (p, n) => (/invited you/.test(String(n.x)) && clanOf(p)
                ? { reason: "nt.r.clan", steps: [MENU_STEP, OPEN_STEP("clan"), ["nt.p.leave"], ["nt.p.again"]] } : null) },
  skills:   { open: (p, b) => skillsPage(p, b), steps: [MENU_STEP, OPEN_STEP("skills")] },
  ranks:    { open: (p, b) => ranksPage(p, b), steps: [MENU_STEP, OPEN_STEP("ranks")] },
  daily:    { open: (p) => dailyPage(p), steps: [MENU_STEP, OPEN_STEP("daily")] },
  pay:      { open: (p, b) => payPage(p, b), steps: [MENU_STEP, OPEN_STEP("pay")] },
  missions: { open: (p, b) => missionsPage(p, b), steps: [MENU_STEP, OPEN_STEP("ach"), ["nt.p.open", "nt.d.missions"]] },
  profile:  { open: (p, b) => achProfilePage(p, b), steps: [MENU_STEP, OPEN_STEP("ach"), ["nt.p.open", "nt.d.profile"]] },
  ach:      { open: (p, b) => achHub(p, b), steps: [MENU_STEP, OPEN_STEP("ach")] },
};
const destOf = (n) => { const id = n.g ?? inferGo(n.x); return DEST[id] ? id : null; };

/** click on a notification: open the place it is about, or explain how to get there when that is not possible now */
function goNote(player, n) {
  const id = destOf(n);
  if (!id) return notificationsPage(player);
  const d = DEST[id], back = () => notificationsPage(player);
  let b = null;
  try { b = d.block ? d.block(player, n) : null; } catch (e) { b = null; }
  if (b) return guidePage(player, b.reason, b.steps ?? d.steps, back);
  try { d.open(player, back); } catch (e) { guidePage(player, "nt.r.err", d.steps, back); }
}

/** "How to get there": the reason + numbered steps (the number is also the stack count of the item) */
function guidePage(player, reason, steps, back) {
  const f = make(t(player, "nt.guide.title"), 6); f.self = () => guidePage(player, reason, steps, back);
  f.glass = true; f.noRefresh = true;
  set(f, 1 * COLS + 4, hdr(1, "r") + t(player, "nt.guide.cant", tr(player, reason)), NAV.no, null);
  const list = steps.slice(0, 7), first = Math.floor((COLS - list.length) / 2);
  list.forEach(([key, ...args], i) => {
    const line = tr(player, key, ...args.map((a) => tr(player, a)));
    set(f, 3 * COLS + first + i, hdr(i + 1) + t(player, "nt.guide.step", i + 1, line), "textures/items/paper", null);
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ notifications
export function notificationsPage(player) {
  const list = notes(player), f = make("Notifications", 9); f.self = () => notificationsPage(player);
  list.slice(0, 72).forEach((n, i) => {
    const id = destOf(n);
    set(f, i, hdr(1, n.r ? "c" : "g") + (n.r ? "" : "§e● NEW\n§r") + n.x + "\n§r§8" + ago(n.t) + (id ? "\n" + t(player, "nt.go", tr(player, "nt.d." + id)) : ""),
      "textures/ui/shop/ic_mail", id ? { run: () => goNote(player, n) } : null);
  });
  if (list.length === 0) set(f, 3 * COLS + 4, hdr(1) + "§7No notifications", "textures/ui/shop/ic_mail", null);
  else set(f, 8 * COLS + 4, hdr(1) + "§c§lClear all\n§r§7Delete all notifications", NAV.no, { run: () => { clearNotes(player); notificationsPage(player); } });
  markAllRead(player);                                    // they were just shown
  backBtn(f, () => dashboard(player)); status(player, f);
  open(player, f);
}

// ================================================================ settings
export function settingsPage(player) {
  const e = ex(player), f = make("Settings"); f.self = () => settingsPage(player);
  const hud = stats(player).hud ?? "panel", chat = e.set.chat !== false, join = e.set.join !== false, pop = e.set.achTitle !== false;
  set(f, 3 * COLS + 3, hdr(1, chat ? "g" : "r") + "§b§lChat notifications\n§r§7Now: " + (chat ? "§aON" : "§cOFF") + "\n§r§7Achievements and daily messages\n§r§7in chat (they are always saved\n§r§7in the notification center).\n§r§eClick to switch", "textures/ui/shop/ic_mail", { run: () => { e.set.chat = !chat; settingsPage(player); } });
  set(f, 3 * COLS + 5, hdr(1, join ? "g" : "r") + "§b§lJoin message\n§r§7Now: " + (join ? "§aON" : "§cOFF") + "\n§r§7Short summary when you join.\n§r§eClick to switch", ICON.tag, { run: () => { e.set.join = !join; settingsPage(player); } });
  // the look & effect switches (scoreboard style, achievement pop-up, particles, sounds) moved to Cosmetics > Effects & Sounds
  set(f, 5 * COLS + 4, hdr(1) + "§d§lEffects, sounds & scoreboard\n§r§7Moved to Cosmetics:\n§r§7particles, sounds, scoreboard style,\n§r§7achievement pop-up\n§r§eClick to open", "textures/ui/shop/x_firework_star", { run: () => fxPage(player, () => settingsPage(player)) });
  backBtn(f, () => dashboard(player)); status(player, f);
  open(player, f);
}

// ================================================================ language (Arabic / English)
// Only the choice is saved here (lang.js). The menus are translated later.
export function languagePage(player) {
  const cur = getLang(player), f = make(t(player, "lp.title"), 5); f.self = () => languagePage(player);
  f.glass = true;
  const pick = (code) => { setLang(player, code); languagePage(player); };
  const mark = (code) => (cur === code ? t(player, "lp.selected") : t(player, "lp.select"));
  set(f, 2 * COLS + 3, hdr(1, cur === "ar" ? "g" : "c") + t(player, "lp.ar") + "\n§r" + mark("ar"), "textures/items/book_enchanted", cur === "ar" ? null : { run: () => pick("ar") });
  set(f, 2 * COLS + 5, hdr(1, cur === "en" ? "g" : "c") + t(player, "lp.en") + "\n§r" + mark("en"), "textures/items/book_writable", cur === "en" ? null : { run: () => pick("en") });
  backBtn(f, () => dashboard(player)); status(player, f);
  open(player, f);
}
