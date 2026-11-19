// 👑 OPERATOR MENU - hidden from every player that is not an operator (the button in /menu only exists for operators,
// and every page + every action checks "is operator" again, so a player who just lost operator can't use an open screen).
//   Land protection bypass ON / OFF   |   Players (money, homes, lands, inventory, ban / unban)   |   Teleport to online players
//   All named lands (teleport)        |   Bans (staff bans, unban)                                   |   Alerts (also for operators who were offline)
//   Inventory category (/opr): new, tools are added step by step (permission "inventory").
// Settings (symbol / icon / ban lengths): OPMENU in systems/config.js.
import { world, EquipmentSlot } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { makeOpr as make, set, open, hdr, COLS, NAV, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { showModal, textField, dropdown, confirmOpr as confirm } from "./forms.js";
import { knownPlayers, recordOf, addMoneyById, touch, playSeconds } from "../data.js";
import { exOf } from "../smp/store.js";
import { money, num, playtime, ago } from "../format.js";
import { progress } from "../xp.js";
import { CATEGORIES } from "../shop_data.js";
import { realId } from "../alias.js";
import { ADMIN_TAG, allClaims, claimsOf, timeLeft, dur, sizeOf } from "./landcore.js";
import { teleportTo, dimLabel } from "./util.js";
import { isStaff, opAlert, listAlerts, unseenCount, markAlertsSeen, banOfId, listManualBans, addBan, removeBan, enforceNow, leftText } from "./opcore.js";
import { OPMENU, STAFF } from "./config.js";
import { clearLagOn, clearLagSeconds, clearMobsOn, CLEARLAG_LIMITS } from "./clearlag.js";
import { holoPage } from "./holomenu.js";
import { tpButtonPage } from "./tpbutton.js";
import { toggleSpectator, enterSpectator, isSpectator, modeLabel, visionMode, setVision } from "./staffvision.js";
import { getSpawn, setSpawn, resetSpawn } from "./spawn.js";
import { iconOf as ahIcon } from "./auction.js";
import { CATS, RULES, entries, seenAt, markSeen, unseenCounts, liveOn, toggleLive, playersIndex, entriesOfPlayer, deleteEntry } from "./oplog.js";
import { allow, can, roleOf, lockText, isOwner, ROLE_NAME, ROLE_COLOR, PERM_MIN, slog, muteOf, freezeOf, econOf, warnsOf, listReports, listMutes, listFreezes, listEcon } from "./staffcore.js";
import { isVanished, listLocks, shopChangedCount, runClearLag, clearLagSwitch, clearLagSetTime, clearLagMobsSwitch } from "./staffworld.js";
import { eventView, endLog } from "./endgate.js";
import { initStaffMenu, ownerPage, perm, punishPage, reportsPage, staffLogPage, endLogPage, broadcastForm, vanishPage, bringPage, bringAllForm, locksPage, perfPage, shopPage, rolesPage, disciplinePage, givePage, inspectPage, endPage, mobRewardPage, hudNamePage, spawnerSettingsPage, afkSettingsPage, creativeLogPage } from "./staffmenu.js";
import { creativeEntries } from "./creativelog.js";
import { mobRewardOn } from "./mobreward.js";
import { backOn, setBackOn } from "./back.js";
import { isAr } from "./arextra.js";
import { duelOn, setDuelOn, duelEvery, duelNextMs, duelRoundOpen, setDuelEvery, setDuelNextIn, minutesText, DUEL_LIMITS, duelImmuneOn, duelImmuneMin, setDuelImmuneOn, setDuelImmuneMin, duelExcluded, addDuelExcluded, removeDuelExcluded, duelAfkLockMin, setDuelAfkLockMin, duelWithdrawPrice, setDuelWithdrawPrice } from "./duel.js";
import { duelLogPage } from "./duellogmenu.js";
import { duelRecordCount } from "./duellog.js";
import { cratesAdminPage, takeKeysForm } from "./crates.js";
import { oprMsg, OprForm } from "./oprlang.js";
import { hubButtons } from "./eventsmenu.js";
import { activeCount as eventsRunning } from "./events.js";
import { buildingPage } from "./spawnbuild.js";
import { fastHealOn, setFastHeal } from "./fastheal.js";

const SYM = OPMENU.symbol;
const ICON = {
  crown: OPMENU.icon, player: NAV.player, paper: "textures/items/paper", compass: "textures/items/compass_item", bed: "textures/items/bed_red", chest: NAV.chest,
  gold: "textures/items/gold_ingot", map: "textures/items/map_filled", shield: NAV.shield, barrier: "textures/ui/shop/ic_cancel", book: "textures/items/book_writable",
  prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", search: "textures/ui/shop/key_search", ender: "textures/ui/shop/ic_enderchest", item: NAV.page,
};
const guard = (p, need) => {
  if (!isStaff(p)) { try { p.sendMessage(oprMsg(p, "§c[Operator] Operators only.")); } catch (e) { /* ignore */ } return false; }
  return need ? allow(p, need) : true;                          // need = the staff permission this page / action requires (see PERM_MIN in staffcore.js)
};
const statusLine = (id) => { const a = []; if (muteOf(id)) a.push("§cMuted"); if (freezeOf(id)) a.push("§bFrozen"); if (econOf(id)) a.push("§6Money frozen"); const w = warnsOf(id).length; if (w) a.push("§eWarnings " + w); return a.length ? "\n§r" + a.join("§7, ") : ""; };
const say = (p, msg) => { try { p.sendMessage(oprMsg(p, msg)); } catch (e) { /* ignore */ } };
const online = (id) => world.getAllPlayers().find((x) => x.id === id);
const pretty = (id) => String(id).replace("minecraft:", "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

// ---- item icons for the inventory view (the shop's icon list, matched by the real game id)
const ICONS = new Map();
try {
  for (const c of CATEGORIES) for (const it of c.items) {
    if (!ICONS.has(it[0])) ICONS.set(it[0], it[2]);
    try { const real = String(realId(it[0], it[1])).replace("minecraft:", ""); if (!ICONS.has(real)) ICONS.set(real, it[2]); } catch (e) { /* ignore */ }
  }
} catch (e) { console.warn("[opmenu] icons: " + e); }

// ---- every ban source in one list: staff (manual) bans
function banMap() {
  const m = new Map(), now = Date.now(), add = (id, row) => { const a = m.get(id) ?? []; a.push(row); m.set(id, a); };
  try { for (const b of listManualBans()) add(b.id, { src: "staff", name: b.n, u: b.u, why: b.r, by: b.by }); } catch (e) { /* ignore */ }
  return m;
}
const SRC = { staff: "Staff ban" };
function liftAll(id) {
  let n = 0;
  try { if (removeBan(id)) n++; } catch (e) { /* ignore */ }
  return n;
}

// ---- teleport (no cooldown, no combat rule: this is a staff tool)
function tpTo(p, loc, dimId, label) {
  if (!guard(p)) return;
  try { teleportTo(p, { x: loc.x, y: loc.y, z: loc.z }, dimId); say(p, "§a[Operator] Teleported to §f" + label); slog(p, "goto", null, String(label).replace(/§./g, "")); }
  catch (e) { say(p, "§c[Operator] Teleport failed (the area may not be loaded)."); }
}
const homesOf = (id) => { try { return exOf(id).homes ?? []; } catch (e) { return []; } };
const spotOf = (c) => c.sp ?? { x: (c.x1 + c.x2 + 1) / 2, y: c.y1 + Math.round((c.y2 - c.y1 + 1) * 0.25), z: (c.z1 + c.z2 + 1) / 2 };

// ================================================================ generic list page (9 rows, 72 per page, paging + optional extra buttons)
// items: objects { text, icon, zone, n, run }  or  functions that return such an object (built only for the visible page = fast with many players)
function listPage(player, title, items, page, back, self, extras = []) {
  const PER = 72, pages = Math.max(1, Math.ceil(items.length / PER)), pg = Math.min(Math.max(0, page), pages - 1);
  const f = make(title + " §8(" + items.length + ")", 9); f.self = () => self(pg);
  f.glass = true;                                                                    // empty slots = Black Stained Glass Pane
  items.slice(pg * PER, pg * PER + PER).forEach((raw, i) => {
    const it = typeof raw === "function" ? raw() : raw;
    set(f, i, hdr(it.n ?? 1, it.zone ?? "c") + it.text, it.icon ?? ICON.item, it.run ? { run: it.run } : null);
  });
  if (!items.length) set(f, 3 * COLS + 4, hdr(1) + "§7Nothing here", ICON.paper, null);
  const base = 8 * COLS;
  if (pg > 0) set(f, base + 3, hdr(1) + "§e§lPrevious page", ICON.prev, { run: () => self(pg - 1) });
  if (pages > 1) set(f, base + 4, hdr(1) + "§fPage " + (pg + 1) + "§7/§f" + pages, NAV.page, null);
  if (pg < pages - 1) set(f, base + 5, hdr(1) + "§e§lNext page", ICON.next, { run: () => self(pg + 1) });
  for (const [k, text, icon, run] of extras) set(f, base + k, text, icon, { run });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ main page
// All the Operator buttons are built here ONCE, in one 6-row page.  The main page and the category pages below pick the buttons they need from it
// (same texts, same actions), so a button is never written twice.  `self` = the page that is open now (buttons use it to refresh / to come back).
function opButtons(player, back, self) {
  const bypass = (() => { try { return player.hasTag(ADMIN_TAG); } catch (e) { return false; } })();
  const unseen = unseenCount(player), nBans = banMap().size;
  const role = roleOf(player), f = make("Operator", 6); f.self = self;

  set(f, 4 * COLS + 2, hdr(1, bypass ? "g" : "r") + "§6§lProtection bypass\n§r§7Now: " + (bypass ? "§aON" : "§cOFF") + "\n§r§7ON = you can build, break and open things\n§r§7inside protected land.\n§r§eClick to switch", ICON.shield, {
    run: () => { if (!guard(player, "bypass")) return; try { if (bypass) player.removeTag(ADMIN_TAG); else player.addTag(ADMIN_TAG); say(player, "§6[Operator] Protection bypass: " + (bypass ? "§cOFF" : "§aON")); slog(player, "bypass", null, bypass ? "off" : "on"); } catch (e) { say(player, "§c[Operator] Could not change it."); } self(); } });
  set(f, 0 * COLS + 2, hdr(1) + "§e§lPlayers\n§r§7Everybody who ever joined (online or offline)\n§r§7Money, homes, lands, inventory,\n§r§7ban / unban", ICON.player, { run: () => playersPage(player, self) });
  set(f, 0 * COLS + 4, hdr(1) + "§b§lGo to a player\n§r§7Teleport to a player who is online", ICON.compass, { run: () => onlinePage(player, self) });

  set(f, 0 * COLS + 6, hdr(Math.min(99, Math.max(1, allClaims().length))) + "§a§lAll lands\n§r§7Every protected land with its name,\n§r§7owner and time left - click to go there", ICON.map, { run: () => landsPage(player, "All lands", () => allClaims().sort((a, b) => String(a.on).localeCompare(String(b.on)) || (a.ord ?? 0) - (b.ord ?? 0)), self, true) });
  set(f, 1 * COLS + 6, hdr(Math.min(99, Math.max(1, nBans))) + "§c§lBans\n§r§7Staff bans\n§r§7Click one to unban", "textures/ui/shop/ic_gavel", { run: () => bansPage(player, self) });
  set(f, 1 * COLS + 8, hdr(Math.min(99, Math.max(1, unseen)), unseen ? "g" : "c") + "§d§lAlerts\n§r" + (unseen ? "§e" + unseen + " new" : "§7No new alerts") + "\n§r§7Notices for the staff\n§r§7(saved while you are offline)", "textures/ui/shop/ic_mail", { run: () => alertsPage(player, self) });

  {
    const u = unseenCounts(player), sus = u.sus, all = CATS.reduce((a, c) => a + (c === "big" ? 0 : u[c]), 0);
    set(f, 2 * COLS + 2, hdr(Math.min(99, Math.max(1, sus || all)), sus ? "r" : all ? "g" : "c") + "§d§lLogs\n§r" + (sus ? "§c" + sus + " suspicious (new)" : all ? "§e" + all + " new" : "§7Nothing new") + "\n§r§7Every purchase, sale, spawner and\n§r§7/pay payment of the players, sorted,\n§r§7and what looks wrong", ICON.book, { run: () => logsPage(player, self) });
  }
  {
    const sp = getSpawn(), dl = sp.d.replace("minecraft:", ""), at = sp.x + ", " + (typeof sp.y === "number" ? Math.round(sp.y) : "surface") + ", " + sp.z;
    set(f, 4 * COLS + 6, hdr(1, "g") + "§a§lSet spawn here\n§r§7/spawn takes players to the place\n§r§7where YOU are standing now.\n§r§7Now: §f" + at + " §7(" + dl + ")\n§r§eClick to save this position", ICON.bed, {
      run: () => confirm(player, "Set spawn here?", ["§7New spawn: §f" + Math.floor(player.location.x) + ", " + Math.round(player.location.y) + ", " + Math.floor(player.location.z), "§7(" + player.dimension.id.replace("minecraft:", "") + ")"], () => {
        if (!guard(player, "spawn")) return;
        const n = setSpawn(player); if (n) slog(player, "spawn", null, "set " + n.x + ", " + Math.round(n.y) + ", " + n.z);
        if (n) { say(player, "§a[Operator] Spawn saved: §f" + n.x + ", " + Math.round(n.y) + ", " + n.z + " §7(" + n.d.replace("minecraft:", "") + ")"); try { opAlert("§e" + player.name + " §7moved the spawn to §f" + n.x + ", " + Math.round(n.y) + ", " + n.z, { chat: false }); } catch (e) { /* ignore */ } }
        else say(player, "§c[Operator] Could not save the spawn.");
        self();
      }, self) });
    if (sp.custom) set(f, 4 * COLS + 7, hdr(1, "r") + "§c§lReset spawn\n§r§7Back to the default 0, 0, 0", ICON.barrier, {
      run: () => confirm(player, "Reset spawn?", ["§7Spawn goes back to §f0, 0, 0"], () => {
        if (!guard(player, "spawn")) return;
        const okR = resetSpawn(); if (okR) slog(player, "spawn", null, "reset");
        say(player, okR ? "§6[Operator] Spawn reset to 0, 0, 0." : "§c[Operator] Could not reset the spawn.");
        self();
      }, self) });
  }

  set(f, 3 * COLS + 8, hdr(1) + "\u00a7e\u00a7lLeaderboards\n\u00a7r\u00a77Place fixed ranking boards\n\u00a7r\u00a77(Top Money, Clans, Duel...) anywhere", "textures/ui/shop/ic_trophy", { run: () => { if (allow(player, "boards")) holoPage(player, self); else self(); } });
  // ---- staff tools (every button checks the operator's role; a button he can't use shows a lock)
  const nRep = listReports().length, nPun = listMutes().length + listFreezes().length + listEcon().length, nLock = listLocks().length;
  set(f, 0 * COLS + 8, hdr(1) + "§d§lStaff roles\n§r§7Who is Helper, Mod or Admin\n§r§7Your role: " + ROLE_COLOR[role] + ROLE_NAME[role], "textures/ui/shop/ic_badge", { run: () => rolesPage(player, self) });
  perm(f, 1 * COLS + 2, player, "reports", "§d§lReports\n§r§7What players sent with /report\n§r§7" + (nRep ? "§e" + nRep + " open" : "No open reports") + "\n§r§eClick to open", "textures/ui/shop/ic_report", () => reportsPage(player, self), nRep ? "r" : "c", nRep);
  set(f, 1 * COLS + 4, hdr(Math.min(99, Math.max(1, nPun)), nPun ? "g" : "c") + "§e§lPunishments\n§r§7Mutes, freezes, warnings, notes\n§r§7and frozen money accounts\n§r§7To punish one player open Players", "textures/items/iron_sword", { run: () => punishPage(player, self) });
  perm(f, 2 * COLS + 4, player, "stafflog", "§6§lStaff actions\n§r§7What every operator did: money,\n§r§7bans, bypass, mutes ... with time", ICON.paper, () => staffLogPage(player, self));
  perm(f, 2 * COLS + 6, player, "perf", "§b§lPerformance\n§r§7Entities per world and the most\n§r§7crowded spots (finds lag)", "textures/ui/shop/i3d_redstone_lamp", () => perfPage(player, self));
  perm(f, 2 * COLS + 8, player, "clearlag", "§a§lClear lag now\n§r§7Removes all dropped items once", "textures/ui/shop/i3d_tnt", () => confirm(player, "Clear all dropped items now?", clearMobsOn() ? ["§7Every item lying on the ground", "§7and every mob without a name tag", "§7will disappear."] : ["§7Every item lying on the ground", "§7will disappear."], () => { const x = runClearLag(player); say(player, x.ok ? (x.mobs ? "§a[Operator] Cleared " + x.n + " dropped items and " + x.m + " mobs." : "§a[Operator] Cleared " + x.n + " dropped items.") : "§c[Operator] " + x.err); self(); }, self), "g");
  perm(f, 3 * COLS + 2, player, "broadcast", "§6§lBroadcast\n§r§7Announcement for everyone\n§r§7(chat + big title)", "textures/ui/shop/x_goat_horn", () => broadcastForm(player, self));
  { const v = isVanished(player); perm(f, 3 * COLS + 4, player, "vanish", "§7§lVanish\n§r§7Now: " + (v ? "§aON" : "§cOFF") + "\n§r§7Invisible, can't be hit, no effects,\n§r§7hidden from lists\n§r§eClick to open", "textures/ui/shop/pot_s_invisibility", () => vanishPage(player, self), v ? "g" : "r"); }
  perm(f, 3 * COLS + 6, player, "lock", "§c§lArea locks\n§r§7Close an area for players\n§r§7(events, investigations)\n§r§7Active: §f" + nLock, "textures/ui/shop/i3d_iron_trapdoor", () => locksPage(player, self), nLock ? "r" : "c", nLock);
  perm(f, 4 * COLS + 8, player, "shop", "§6§lShop control\n§r§7Change a price or switch an item off\n§r§7Changed now: §f" + shopChangedCount(), "textures/items/emerald", () => shopPage(player, self), "c");
  { // buttons of the existing tools that this role can't use get a lock
    const lock = (slot, need, name) => { if (!can(player, need)) set(f, slot, hdr(1, "r") + "§7§l" + name + "\n§r" + lockText(need, player), ICON.barrier, { run: () => allow(player, need) }); };
    lock(4 * COLS + 2, "bypass", "Protection bypass"); lock(4 * COLS + 6, "spawn", "Set spawn here"); lock(3 * COLS + 8, "boards", "Leaderboards");
    lock(2 * COLS + 2, "logs", "Logs"); lock(1 * COLS + 6, "bans", "Bans"); lock(0 * COLS + 6, "lands", "All lands");
    if (!can(player, "spawn")) { f.buttons[4 * COLS + 7] = null; f.entries[4 * COLS + 7] = null; }
  }
  return f;
}

// slots of the buttons inside opButtons (row * 9 + column)
const SLOT = { players: 2, goto: 4, lands: 6, roles: 8, reports: 11, punish: 13, bans: 15, alerts: 17, logs: 20, staffLog: 22, perf: 24, clearLag: 26, broadcast: 29, vanish: 31, locks: 33, boards: 35, bypass: 38, xray: 40, spawn: 42, spawnReset: 43, shop: 44 };
// header card of every category page: [icon, title, text]
const HEAD = {
  "Moderation": ["textures/ui/shop/ic_gavel", "§c§lModeration", "§7Reports, punishments, bans, alerts,\n§r§7logs and the staff actions"],
  "World": [ICON.map, "§b§lWorld", "§7Area locks, clear lag, performance,\n§r§7lands, The End and crates"],
  "Server & staff": ["textures/ui/shop/ic_gear", "§6§lServer & staff", "§7Protection, spawn, shop, ranks, roles,\n§r§7mob rewards, AFK area and spawners"],
  "Teleport": ["textures/items/ender_pearl", "§d§lTeleport", "§7Go to a player or bring players to you"],
  "Inventory": ["textures/ui/shop/i3d_barrel", "§d§lInventory", "§7See what the players carry\n§r§7and take items from them"],
  "Events": ["textures/ui/shop/x_firework_star", "§6§lEvents", "§7Events and temporary zones:\n§r§7rules, area, time, players"],
};
/** a category page: takes buttons from opButtons (placed at the slots in `layout`: [[slotHere, SLOT.x], ...]) and can add its own with `extra(f, self)` */
function categoryPage(player, back, title, layout, extra) {
  if (!guard(player)) return;
  const self = () => categoryPage(player, back, title, layout, extra);
  const m = opButtons(player, back, self);
  const f = make("Operator: " + title, SHORT_ROWS); f.self = self;
  f.glass = true;                                                                                                       // every empty slot = Black Stained Glass Pane
  const head = HEAD[title]; if (head) set(f, 0 * COLS + 4, hdr(1) + head[1] + "\n§r" + head[2], head[0], null);        // header card (top centre)
  const lay = typeof layout === "function" ? layout(m) : layout;                                                       // a layout may depend on which buttons exist (rebuilt on every refresh)
  for (const [here, from] of lay) { if (m.buttons[from]) { f.buttons[here] = m.buttons[from]; f.entries[here] = m.entries[from]; } }
  if (extra) extra(f, self);
  backBtn(f, back); status(player, f);
  open(player, f);
}
const moderationPage = (player, back) => categoryPage(player, back, "Moderation", [[1 * COLS + 3, SLOT.reports], [1 * COLS + 4, SLOT.punish], [1 * COLS + 5, SLOT.bans], [2 * COLS + 3, SLOT.alerts], [2 * COLS + 4, SLOT.logs], [2 * COLS + 5, SLOT.staffLog]]);
const worldPage = (player, back) => categoryPage(player, back, "World", [[2 * COLS + 3, SLOT.lands], [2 * COLS + 4, SLOT.locks]], (f, self) => {
  { const fh = fastHealOn(), r = roleOf(player), okRole = r === "owner" || r === "admin";
    set(f, 1 * COLS + 5, hdr(1, fh ? "g" : "r") + "§c§lFast healing\n§r§7Java style: +half a heart every\n§r§70.5 s when your food bar is full\n§r§7Now: " + (fh ? "§aON" : "§cOFF §7(normal healing)") + "\n§r" + (okRole ? "§eClick to switch" : "§cAdmin / Owner only"), "textures/items/apple_golden",
      { run: () => { if (!okRole) return say(player, "§c[Operator] Only the Admin or the Owner can change this."); const res = setFastHeal(player, !fh); say(player, res.err ? "§c[Operator] " + res.err : "§a[Operator] Fast healing is now " + (!fh ? "§aON" : "§cOFF") + "§a."); self(); } }); }
  perm(f, 1 * COLS + 4, player, "clearlag", "§a§lClear lag\n§r§7Remove the dropped items on the ground\n§r§eClick to open", "textures/ui/shop/i3d_tnt", () => clearLagPage(player, self), "g");
  // layout: row 1 = server tools (Clear lag - Performance is inside the Clear lag category) | row 2 = places & protection (Lands, Locks, The End) | row 3 = crates (Crates, Crate keys)
  const v = eventView(), on = v.open, cd = !on && v.openAt > 0;
  perm(f, 2 * COLS + 5, player, "endgate", "§5§lThe End event\n§r§7Now: " + (on ? "§aOPEN" : cd ? "§eCOUNTDOWN" : "§cCLOSED") + "\n§r§7Countdown, timer, holograms, log\n§r§eClick to open", ICON.ender, () => endPage(player, self), on || cd ? "g" : "r");
  perm(f, 3 * COLS + 3, player, "crates", "§b§lCrates\n§r§7Add a crate in front of you,\n§r§7remove it, give keys\n§r§eClick to open", "textures/ui/shop/ic_chest", () => cratesAdminPage(player, self));
  perm(f, 3 * COLS + 4, player, "tpbtn", "§d§lTeleport buttons\n§r§7Place a button anywhere (spawn...)\n§r§7that teleports players to X Y Z,\n§r§7with a hologram name\n§r§eClick to open", "textures/items/ender_pearl", () => tpButtonPage(player, self));
  perm(f, 3 * COLS + 5, player, "crates", "§e§lCrate keys\n§r§7Take any amount of keys\n§r§7(Rare / Epic / Legendary)\n§r§7to test the crates\n§r§eClick to take", "textures/blocks/trip_wire_source", () => takeKeysForm(player, self), "g");
});
// ---- Clear lag category (/opr > World > Clear lag)
const lagTime = (n) => (n < 60 ? n + " seconds" : n % 60 === 0 ? (n / 60) + (n === 60 ? " minute" : " minutes") + " (" + n + " seconds)" : n + " seconds");
function clearLagPage(player, back) {
  if (!guard(player, "clearlag")) return back();
  const self = () => clearLagPage(player, back), f = make("Operator: Clear lag", SHORT_ROWS); f.self = self;
  f.glass = true;
  const on = clearLagOn(), secs = clearLagSeconds(), mobsOn = clearMobsOn();
  set(f, 0 * COLS + 4, hdr(1, on ? "g" : "r") + "§a§lClear lag\n§r§7Removes the dropped items on the ground\n§r§7(Hearts are never removed)\n§r§7Automatic: " + (on ? "§aON §7- every §f" + lagTime(secs) : "§cOFF §7(nothing is cleared by the timer)"), "textures/ui/shop/i3d_tnt", null);
  perm(f, 1 * COLS + 4, player, "clearlag", "§a§lClear lag now\n§r§7Removes all dropped items once", "textures/ui/shop/i3d_tnt", () => confirm(player, "Clear all dropped items now?", mobsOn ? ["§7Every item lying on the ground", "§7and every mob without a name tag", "§7will disappear."] : ["§7Every item lying on the ground", "§7will disappear."], () => { const x = runClearLag(player); say(player, x.ok ? (x.mobs ? "§a[Operator] Cleared " + x.n + " dropped items and " + x.m + " mobs." : "§a[Operator] Cleared " + x.n + " dropped items.") : "§c[Operator] " + x.err); self(); }, self), "g");
  perm(f, 2 * COLS + 2, player, "clearlag", "§e§lAutomatic Clear lag: " + (on ? "§aON" : "§cOFF") + "\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§7OFF = the timer stops (no warning,\n§r§7no clearing) until you turn it ON\n§r§eClick to turn " + (on ? "OFF" : "ON"), "textures/ui/shop/ic_cancel", () => {
    const r = clearLagSwitch(player, !on);
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] Automatic Clear lag " + (r.on ? "§aON" : "§cOFF"));
    self();
  }, on ? "g" : "r");
  perm(f, 2 * COLS + 4, player, "clearlag", "§e§lTime between clears\n§r§7Now: §f" + lagTime(secs) + "\n§r§7From §f" + CLEARLAG_LIMITS.min + " seconds §7to §f" + CLEARLAG_LIMITS.max + " seconds\n§r§7(more than 60 is allowed)\n§r§eClick to type a time", "textures/items/clock_item", () => clearLagTimeForm(player, self), "g");
  perm(f, 2 * COLS + 6, player, "clearlag", "§b§l30 seconds\n§r§7Clear every §f30 seconds §7(the fastest)\n§r§7Now: §f" + lagTime(secs) + "\n§r§eClick", "textures/items/clock_item", () => {
    const r = clearLagSetTime(player, 30);
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] Clear lag now runs every " + lagTime(r.seconds) + ".");
    self();
  }, secs === 30 ? "g" : "c");
  perm(f, 3 * COLS + 3, player, "clearlag", "§c§lDelete mobs too: " + (mobsOn ? "§aON" : "§cOFF") + "\n§r§7Now: " + (mobsOn ? "§aON" : "§cOFF") + "\n§r§7ON = every clear also removes\n§r§7the mobs that have no name tag\n§r§eClick to turn " + (mobsOn ? "OFF" : "ON"), "textures/items/iron_sword", () => {
    const r = clearLagMobsSwitch(player, !mobsOn);
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] Delete mobs in Clear lag: " + (r.on ? "§aON" : "§cOFF"));
    self();
  }, mobsOn ? "g" : "r");
  perm(f, 3 * COLS + 5, player, "perf", "§b§lPerformance\n§r§7Entities per world and the most\n§r§7crowded spots (finds lag)", "textures/ui/shop/i3d_redstone_lamp", () => perfPage(player, self));
  backBtn(f, back); status(player, f);
  open(player, f);
}
function clearLagTimeForm(player, back) {
  if (!guard(player, "clearlag")) return back();
  const form = new OprForm().title("Clear lag time");
  try { form.textField("§fSeconds between two clears §7(" + CLEARLAG_LIMITS.min + "-" + CLEARLAG_LIMITS.max + ", e.g. 30, 60, 120, 300)", "whole number, e.g. 60", { defaultValue: String(clearLagSeconds()) }); } catch (e) { form.textField("§fSeconds between two clears §7(" + CLEARLAG_LIMITS.min + "-" + CLEARLAG_LIMITS.max + ")", "whole number, e.g. 60", String(clearLagSeconds())); }
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "clearlag")) return back();                                             // checked again
    const r = clearLagSetTime(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] Clear lag now runs every " + lagTime(r.seconds) + ".");
    back();
  });
}
// ---- 1 vs 1 duel settings: ON / OFF, the time between rounds (even every minute) and "start the next round in x minutes"
function duelSettingsPage(player, back) {
  if (!guard(player, "duelset")) return back();
  const self = () => duelSettingsPage(player, back);
  const on = duelOn(), ms = duelNextMs(), busy = duelRoundOpen(), f = make("1 vs 1 Duel", SHORT_ROWS); f.self = self;
  const nextTxt = busy ? "§eA round is running now" : ms === null ? "§7Not known yet" : "§f" + minutesText(Math.ceil(ms / 60000)) + (on ? "" : " §8(OFF: no round will start)");
  set(f, 0 * COLS + 4, hdr(1, on ? "g" : "r") + "§c§l⚔ 1 vs 1 Duel\n§r§7Status: " + (on ? "§aON" : "§cOFF") + "\n§r§7A round every: §f" + minutesText(duelEvery()) + "\n§r§7Next round in: " + nextTxt, "textures/items/diamond_sword", null);
  set(f, 1 * COLS + 1, hdr(1, on ? "g" : "r") + "§c§lTurn " + (on ? "OFF" : "ON") + "\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§7OFF cancels an open countdown\n§r§7(nothing is charged)\n§r§eClick", "textures/items/diamond_sword", {
    run: () => {
      if (!guard(player, "duelset")) return back();
      const r = setDuelOn(player, !on);
      say(player, r.err ? "§c[Operator] " + r.err : "§c[Operator] 1 vs 1 duel " + (r.on ? "§aON" : "§cOFF"));
      self();
    },
  });
  set(f, 1 * COLS + 4, hdr(1, "g") + "§e§lTime between rounds\n§r§7Now: §f" + minutesText(duelEvery()) + "\n§r§7Any time from §f" + DUEL_LIMITS.min + " minute §7to §f" + DUEL_LIMITS.max + " §7minutes\n§r§7The next round is counted from now\n§r§eClick to change", "textures/items/clock_item", { run: () => duelEveryForm(player, self) });
  set(f, 1 * COLS + 7, hdr(1, busy ? "r" : "g") + "§b§lStart the next round in...\n§r§7Only moves the NEXT round, the time\n§r§7between rounds stays §f" + minutesText(duelEvery()) + "\n§r" + (busy ? "§cA round is running now" : "§eClick to set"), "textures/items/compass_item", { run: () => duelNextForm(player, self) });
  set(f, 2 * COLS + 7, hdr(Math.min(99, Math.max(1, duelExcluded().length)), "c") + "§d§lExcluded players\n§r§7Players who never join the duel\n§r§7(online or offline)\n§r§7Now: §f" + duelExcluded().length + "\n§r§eClick to open", ICON.player, { run: () => duelExcludedPage(player, self) });
  { // new player protection: ON / OFF and how long it lasts
    const iOn = duelImmuneOn();
    set(f, 2 * COLS + 1, hdr(1, iOn ? "g" : "r") + "§a§lNew player protection: " + (iOn ? "§aON" : "§cOFF") + "\n§r§7New players are not taken into the duel\n§r§7for their first §f" + minutesText(duelImmuneMin()) + " §7of play time\n§r§eClick to turn " + (iOn ? "OFF" : "ON"), "textures/ui/shop/ic_shield", {
      run: () => {
        if (!guard(player, "duelset")) return back();
        const r = setDuelImmuneOn(player, !iOn);
        say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] New player protection " + (r.on ? "§aON" : "§cOFF"));
        self();
      },
    });
    set(f, 2 * COLS + 4, hdr(1, "g") + "§e§lProtection time\n§r§7Now: §f" + minutesText(duelImmuneMin()) + (iOn ? "" : " §8(protection is OFF)") + "\n§r§7Any time from §f1 minute §7to §f" + DUEL_LIMITS.immuneMax + " §7minutes\n§r§7(counted in play time)\n§r§eClick to change", "textures/items/clock_item", { run: () => duelImmuneForm(player, self) });
  }
  set(f, 3 * COLS + 4, hdr(1, "g") + "§6§lAFK lock time\n§r§7Nobody can enter /afk (or leave the game\n§r§7without paying) this long before the duel\n§r§7Now: §f" + minutesText(duelAfkLockMin()) + "\n§r§7From §f" + DUEL_LIMITS.lockMin + " minute §7to §f" + DUEL_LIMITS.lockMax + " §7minutes\n§r§eClick to change", "textures/items/clock_item", { run: () => duelLockForm(player, self) });
  set(f, 3 * COLS + 7, hdr(1, "g") + "§6§lWithdraw price\n§r§7What the WITHDRAW button costs\n§r§7when the fight appears\n§r§7Now: §a" + money(duelWithdrawPrice()) + "\n§r§7From §f" + money(DUEL_LIMITS.priceMin) + " §7to §f" + money(DUEL_LIMITS.priceMax) + "\n§r§eClick to change", "textures/ui/shop/hud_money", { run: () => duelPriceForm(player, self) });
  set(f, 3 * COLS + 1, hdr(Math.max(1, Math.min(99, duelRecordCount()))) + "§c§lDuel log\n§r§7Who fought, who won, the items the\n§r§7loser lost and what the winner took\n§r§7Saved fights: §f" + duelRecordCount() + "\n§r§eClick to open", "textures/items/book_writable", { run: () => duelLogPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const minutesOf = (v) => { const t = String(v ?? "").trim(); return t === "" || !/^\d{1,6}$/.test(t) ? NaN : Number(t); };
function minutesField(form, label, def) {
  try { form.textField(label, "whole number, e.g. 60", { defaultValue: String(def) }); } catch (e) { form.textField(label, "whole number, e.g. 60", String(def)); }
}
function duelEveryForm(player, back) {
  if (!guard(player, "duelset")) return back();
  const form = new OprForm().title("Time between duels");
  minutesField(form, "§fMinutes between two 1 vs 1 rounds §7(" + DUEL_LIMITS.min + "-" + DUEL_LIMITS.max + ", 1 = every minute)", duelEvery());
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "duelset")) return back();                                              // checked again
    const r = setDuelEvery(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] The 1 vs 1 now starts every " + minutesText(r.minutes) + ".");
    back();
  });
}
// ---- players excluded from the duel: the list (click = remove) and the picker (click = add; online and offline players)
function duelExcludedPage(player, back, page = 0) {
  if (!guard(player, "duelset")) return back();
  const live = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  const again = (pg) => duelExcludedPage(player, back, pg);
  const items = duelExcluded().sort((a, b) => a.n.localeCompare(b.n)).map((x) => ({
    zone: "r", icon: ICON.player,
    text: (live.has(x.id) ? "§a§l" : "§7§l") + x.n + "\n§r" + (live.has(x.id) ? "§aOnline" : "§7Offline") + "\n§r§7Never taken into the duel\n§r§cClick to remove the exclusion",
    run: () => {
      if (!guard(player, "duelset")) return back();
      const r = removeDuelExcluded(player, x.id);
      say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] " + r.name + " can be taken into the duels again.");
      again(page);
    },
  }));
  listPage(player, "Excluded from duel", items, page, back, again, [[7, hdr(1, "g") + "§a§lAdd a player\n§r§7Online or offline", ICON.player, () => duelExcludePick(player, () => again(0))]]);
}
function duelExcludePick(player, back, page = 0, q = "") {
  if (!guard(player, "duelset")) return back();
  const live = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  let all = knownPlayers().map((x) => ({ id: x.id, name: String(x.name) }));
  for (const p of live.values()) if (!all.some((x) => x.id === p.id)) all.push({ id: p.id, name: p.name });
  const have = new Set(duelExcluded().map((x) => x.id));
  all = all.filter((x) => !have.has(x.id));
  const ql = q.toLowerCase();
  if (ql) all = all.filter((x) => x.name.toLowerCase().includes(ql));
  all.sort((a, b) => (live.has(b.id) ? 1 : 0) - (live.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
  const again = (pg) => duelExcludePick(player, back, pg, q);
  const items = all.map((x) => ({
    zone: live.has(x.id) ? "g" : "c", icon: ICON.player,
    text: (live.has(x.id) ? "§a§l" : "§7§l") + x.name + "\n§r" + (live.has(x.id) ? "§aOnline" : "§7Offline") + "\n§r§eClick to exclude him from the duel",
    run: () => {
      if (!guard(player, "duelset")) return back();
      const r = addDuelExcluded(player, x.id, x.name);
      say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] " + x.name + " is excluded from the duels.");
      back();
    },
  }));
  const extras = [[7, hdr(1) + "§b§lSearch\n§r§7Find a player by name", ICON.search, () => {
    if (!guard(player, "duelset")) return back();
    const form = new OprForm().title("Search player");
    textField(form, "§fPart of the name", "e.g. steve");
    showModal(player, form, (v) => duelExcludePick(player, back, 0, v ? String(v[0] ?? "").trim() : q));
  }]];
  if (q) extras.push([8, hdr(1) + "§c§lClear search\n§r§7Show everybody again", NAV.no, () => duelExcludePick(player, back, 0, "")]);
  listPage(player, q ? "Exclude: " + q : "Exclude a player", items, page, back, again, extras);
}
function duelImmuneForm(player, back) {
  if (!guard(player, "duelset")) return back();
  const form = new OprForm().title("New player protection");
  minutesField(form, "§fMinutes of play time a new player is protected from the 1 vs 1 §7(1-" + DUEL_LIMITS.immuneMax + ", 120 = 2 hours)", duelImmuneMin());
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "duelset")) return back();                                              // checked again
    const r = setDuelImmuneMin(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] New players are now protected from the 1 vs 1 for " + minutesText(r.minutes) + ".");
    back();
  });
}
function duelPriceForm(player, back) {
  if (!guard(player, "duelset")) return back();
  const form = new OprForm().title("Withdraw price");
  const label = "§fPrice of the WITHDRAW button §7(" + DUEL_LIMITS.priceMin + "-" + DUEL_LIMITS.priceMax + ", e.g. 7999)";
  try { form.textField(label, "whole number, e.g. 7999", { defaultValue: String(duelWithdrawPrice()) }); } catch (e) { form.textField(label, "whole number, e.g. 7999", String(duelWithdrawPrice())); }
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "duelset")) return back();                                              // checked again
    const r = setDuelWithdrawPrice(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] The 1 vs 1 withdraw price is now " + money(r.price) + ".");
    back();
  });
}
function duelLockForm(player, back) {
  if (!guard(player, "duelset")) return back();
  const form = new OprForm().title("AFK lock time");
  minutesField(form, "§fMinutes before the duel when /afk is locked §7(" + DUEL_LIMITS.lockMin + "-" + DUEL_LIMITS.lockMax + ", e.g. 1, 5, 10, 15)", duelAfkLockMin());
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "duelset")) return back();                                              // checked again
    const r = setDuelAfkLockMin(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] /afk is now locked " + minutesText(r.minutes) + " before the 1 vs 1.");
    back();
  });
}
function duelNextForm(player, back) {
  if (!guard(player, "duelset")) return back();
  const ms = duelNextMs(), form = new OprForm().title("Next duel in...");
  minutesField(form, "§fStart the next 1 vs 1 round in how many minutes? §7(" + DUEL_LIMITS.min + "-" + DUEL_LIMITS.max + ")", ms === null ? duelEvery() : Math.max(1, Math.ceil(ms / 60000)));
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player, "duelset")) return back();
    const r = setDuelNextIn(player, minutesOf(v[0]));
    say(player, r.err ? "§c[Operator] " + r.err : "§a[Operator] The next 1 vs 1 starts in " + minutesText(r.minutes) + ".");
    back();
  });
}
const serverPage = (player, back) => categoryPage(player, back, "Server & staff", (m) => { const c = m.buttons[SLOT.spawnReset] ? [3, 4, 5] : [3, 5]; return [[1 * COLS + c[0], SLOT.bypass], [1 * COLS + c[1], SLOT.spawn], ...(c[2] ? [[1 * COLS + c[2], SLOT.spawnReset]] : []), [2 * COLS + 3, SLOT.shop], [2 * COLS + 4, SLOT.boards], [2 * COLS + 5, SLOT.roles]]; }, (f, self) => {
  const on = mobRewardOn(), dOn = duelOn();
  perm(f, 3 * COLS + 2, player, "duelset", "§c§l1 vs 1 Duel\n§r§7Duel: " + (dOn ? "§aON" : "§cOFF") + "\n§r§7Every §f" + minutesText(duelEvery()) + "\n§r§eClick to open", "textures/items/diamond_sword", () => duelSettingsPage(player, self), dOn ? "g" : "r");
  perm(f, 3 * COLS + 3, player, "hudname", "§6§lScoreboard name\n§r§7Change the server name shown\n§r§7on the side panel scoreboard\n§r§eClick to open", "textures/items/name_tag", () => hudNamePage(player, self));
  perm(f, 3 * COLS + 4, player, "afkset", "§e§lAFK area\n§r§7Rewards per minute and the area\n§r§7(width, length, height) of /afk\n§r§eClick to open", "textures/items/clock_item", () => afkSettingsPage(player, self));
  perm(f, 3 * COLS + 5, player, "spawnerset", "§6§lSpawner settings\n§r§7Kills per hour, storage, max stack,\n§r§7speed of every mob spawner\n§r§eClick to open", "textures/ui/shop/ic_spawner", () => spawnerSettingsPage(player, self));
  perm(f, 3 * COLS + 6, player, "mobmoney", "§6§lMob rewards\n§r§7Money for killing mobs\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§eClick to open", "textures/ui/shop/skull_zombie", () => mobRewardPage(player, self), on ? "g" : "r");
  // /back: one click switches it (the text is raw Arabic for Arabic admins: oprButton joins the letters)
  const bOn = backOn(), bAr = isAr(player);
  perm(f, 3 * COLS + 7, player, "back", bAr
    ? "§b§l/back\n§r§7الرجوع إلى مكان الموت\n§r§7الآن: " + (bOn ? "§aمفعّل" : "§cمعطّل") + "\n§r§eاضغط للتبديل"
    : "§b§l/back\n§r§7Return to where you died\n§r§7Now: " + (bOn ? "§aON" : "§cOFF") + "\n§r§eClick to switch", "textures/ui/shop/x_recovery_compass", () => {
    if (!allow(player, "back")) return;
    const r = setBackOn(player, !bOn);
    try { player.sendMessage(oprMsg(player, r.err ? "§c[Operator] " + r.err : bAr ? "§a[Operator] أمر /back الآن " + (r.on ? "مفعّل." : "معطّل.") : "§a[Operator] /back is now " + (r.on ? "ON." : "OFF."))); } catch (e) { /* ignore */ }
    self();
  }, bOn ? "g" : "r");
});
// ---- Inventory category (new): the page is ready, the tools are added step by step (see the plan: view every member's inventory, take items)
const inventoryHubPage = (player, back) => { if (!guard(player, "inventory")) return; categoryPage(player, back, "Inventory", [], (f, self) => {
  // layout: row 0 = live card | rows 1-2 = the players online now (click = open his inventory, up to 14) | row 3 = all members + good to know
  const online_ = world.getAllPlayers().slice().sort((a, b) => a.name.localeCompare(b.name)), n = online_.length;
  set(f, 0 * COLS + 4, hdr(Math.min(99, Math.max(1, n)), "g") + "§d§lInventory\n§r§7Online now: §f" + n + "\n§r§7See what the players carry\n§r§7and take items from them", "textures/ui/shop/i3d_barrel", null);
  online_.slice(0, 14).forEach((t, i) => { const c = invCard(player, t, self); set(f, (1 + Math.floor(i / 7)) * COLS + 1 + (i % 7), hdr(1, c.zone) + c.text, c.icon, { run: c.run }); });
  set(f, 3 * COLS + 3, hdr(Math.min(99, Math.max(1, n)), "g") + "§a§lMembers' inventories\n§r§7Every item a member carries\n§r§7(backpack, hotbar, armor, off-hand)\n§r§7Take one item, a part, everything\n§r§7or his levels\n§r§7Online now: §f" + n + "\n§r§eClick to open", ICON.player, { run: () => invPlayersPage(player, self) });
  set(f, 3 * COLS + 5, hdr(1) + "§7§lGood to know\n§r§7Only players who are online can be read\n§r§7(Bedrock scripts can't open an offline\n§r§7player or an ender chest)\n§r§7Taking items needs the Admin role", ICON.paper, null);
}); };
// ---- Events category: events and temporary zones with their rules (permission "events"; the buttons and pages are in eventsmenu.js, the rules in events.js)
const eventsHubPage = (player, back) => { if (!guard(player, "events")) return; categoryPage(player, back, "Events", [[3 * COLS + 6, SLOT.broadcast]], (f, self) => hubButtons(f, player, self)); };
const teleportPage = (player, back) => categoryPage(player, back, "Teleport", [[2 * COLS + 3, SLOT.goto]], (f, self) => {
  perm(f, 2 * COLS + 4, player, "tphere", "§d§lBring a player\n§r§7Choose a player and bring him to you\n§r§7(he accepts first, or you teleport him now)", "textures/items/ender_eye", () => bringPage(player, self));
  perm(f, 2 * COLS + 5, player, "tpall", "§d§lBring all players\n§r§7Everybody online comes to you\n§r§7(ask first, or teleport everyone now)\n§r§8Operators and duel players are skipped", "textures/items/chorus_fruit", () => bringAllForm(player, self), "r");
});

// ---- the main page: only the categories (every button inside them is still the same as before)
export function opPage(player, back) {
  if (!guard(player)) return;
  const self = () => opPage(player, back);
  const m = opButtons(player, back, self);
  const role = roleOf(player), f = make(SYM + " Operator §8| " + ROLE_COLOR[role] + ROLE_NAME[role], 5); f.self = self;
  f.glass = true;                                                      // every empty slot = Black Stained Glass Pane (same as /shop and /menu)
  const nRep = listReports().length, nNew = unseenCount(player), nMod = nRep + nNew;
  // layout (6 rows): row 0 = info card | row 1 = 5 categories (Players, Moderation, Teleport, Inventory, Logs) | row 2 = 3 categories (Events, World, Server & staff) | row 3 = empty | row 4 = quick tools (Spectator, Owner, Ore vision + Vanish) | row 5 = button bar | everything else = glass
  { let nOn = 0, nBan = 0; try { nOn = world.getAllPlayers().length; } catch (e) { /* ignore */ } try { nBan = banMap().size; } catch (e) { /* ignore */ }
    set(f, 0 * COLS + 4, hdr(1) + SYM + " " + ROLE_COLOR[role] + "§l" + ROLE_NAME[role] + " panel\n§r§7Players online: §f" + nOn + "\n§r§7Open reports: " + (nRep ? "§e" : "§f") + nRep + " §7| New alerts: " + (nNew ? "§e" : "§f") + nNew + "\n§r§7Active bans: §f" + nBan, ICON.crown, null); }
  if (m.buttons[SLOT.players]) { f.buttons[1 * COLS + 2] = m.buttons[SLOT.players]; f.entries[1 * COLS + 2] = m.entries[SLOT.players]; }
  set(f, 1 * COLS + 3, hdr(Math.min(99, Math.max(1, nMod)), nMod ? "r" : "c") + "§c§lModeration\n§r§7Reports, punishments, bans, alerts,\n§r§7logs and the staff actions\n§r§7" + (nMod ? "§e" + nRep + " report" + (nRep === 1 ? "" : "s") + " §7| §e" + nNew + " new alert" + (nNew === 1 ? "" : "s") : "Nothing waiting"), "textures/ui/shop/ic_gavel", { run: () => moderationPage(player, self) });
  set(f, 1 * COLS + 4, hdr(1) + "§d§lTeleport\n§r§7Go to a player, bring a player,\n§r§7bring all players", "textures/items/ender_pearl", { run: () => teleportPage(player, self) });
  set(f, 2 * COLS + 3, hdr(1) + "§b§lWorld\n§r§7Area locks, clear lag,\n§r§7performance and all lands", ICON.map, { run: () => worldPage(player, self) });
  { const n = eventsRunning(); perm(f, 2 * COLS + 2, player, "events", "§6§lEvents\n§r§7Events and temporary zones:\n§r§7rules, area, time, players\n§r§7Running now: §f" + n + "\n§r§eClick to open", "textures/ui/shop/x_firework_star", () => eventsHubPage(player, self), n ? "g" : "c", n); }
  perm(f, 1 * COLS + 5, player, "inventory", "§d§lInventory\n§r§7See what the players carry\n§r§7and take items from them\n§r§eClick to open", "textures/ui/shop/i3d_barrel", () => inventoryHubPage(player, self));
  set(f, 2 * COLS + 5, hdr(1) + "§6§lServer & staff\n§r§7Protection bypass, X-ray, spawn,\n§r§7shop control, leaderboards, staff roles", "textures/ui/shop/ic_gear", { run: () => serverPage(player, self) });
  set(f, 1 * COLS + 6, hdr(1) + "§d§lLogs\n§r§7All the logs of the server:\n§r§7shop & money, staff actions, duels,\n§r§7Heart Logs, alerts\n§r§eClick to open", ICON.book, { run: () => logsHubPage(player, self) });
  if (isOwner(player)) set(f, 2 * COLS + 6, hdr(1, "g") + "§a§lBuilding\n§r§7Ready places built for you:\n§r§7a green Spawn (only the Owner\n§r§7can change it)\n§r§eClick to open", "textures/blocks/grass_side_carried", { run: () => buildingPage(player, self) });
  if (isOwner(player)) set(f, 2 * COLS + 4, hdr(1, "g") + "§5§lOwner\n§r§7Only you: decide what Helper, Mod\n§r§7and Admin may do, hand over the Owner", "textures/items/nether_star", { run: () => ownerPage(player, self) });
  perm(f, 3 * COLS + 3, player, "spectate", "§b§lSpectator\n§r§7Now: §f" + modeLabel(player) + "\n§r§7Here or on a player\n§r§eClick to open", "textures/items/spyglass", () => spectatorPage(player, self), isSpectator(player) ? "g" : "c");
  { const v = isVanished(player), vm = visionMode(player), need = can(player, "vanish") ? "vanish" : "orevision";
    perm(f, 3 * COLS + 5, player, need, "§3§lOre vision + Vanish\n§r§7Vanish: " + (v ? "§aON" : "§cOFF") + "\n§r§7Ore vision: " + (vm ? "§a" + (vm === "rare" ? "RARE ORES" : "ALL ORES") : "§cOFF") + "\n§r§eClick to open", "textures/ui/shop/i3d_diamond_ore", () => sightPage(player, self), v || vm ? "g" : "c"); }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- Spectator: two options (here / on a player)
function spectatorPage(player, back) {
  if (!guard(player, "spectate")) return;
  const self = () => spectatorPage(player, back), sp = isSpectator(player);
  const f = make("Operator: Spectator", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, sp ? "g" : "c") + "§b§lSpectator\n§r§7Now: §f" + modeLabel(player), "textures/items/spyglass", null);
  set(f, 2 * COLS + 3, hdr(1, sp ? "g" : "c") + "§b§lSpectator here\n§r§7Now: §f" + modeLabel(player) + "\n§r§7One click = fly through blocks,\n§r§7click again = back to your old mode\n§r§eClick to switch", "textures/items/spyglass", { run: () => {
    const r = toggleSpectator(player);
    say(player, r.err ? "§c[Operator] " + r.err : r.on ? "§b[Operator] Spectator mode §aON §7(click again to go back)" : "§b[Operator] Back to §f" + r.mode + " §bmode.");
    self();
  } });
  set(f, 2 * COLS + 5, hdr(1, "g") + "§b§lSpectator on player\n§r§7Pick an online player: you are moved\n§r§7to him in Spectator, straight away\n§r§eClick to open", ICON.compass, { run: () => spectateListPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function spectateListPage(player, back) {
  if (!guard(player, "spectate")) return;
  const again = () => spectateListPage(player, back);
  const items = world.getAllPlayers().filter((x) => x.id !== player.id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({
    zone: "g", icon: ICON.player, text: "§a§l" + x.name + "\n§r§7" + dimLabel(x.dimension.id) + "\n§r§7" + Math.floor(x.location.x) + ", " + Math.floor(x.location.y) + ", " + Math.floor(x.location.z) + "\n§r§eClick to spectate",
    run: () => spectateOn(player, x.id, x.name, again),
  }));
  listPage(player, "Spectator on player", items, 0, back, again);
}
function spectateOn(player, id, name, again) {
  if (!guard(player, "spectate")) return;
  const t = online(id);
  if (!t) { say(player, "§c[Operator] " + name + " went offline."); return again(); }
  const r = enterSpectator(player, name);                          // first Spectator (nothing can hurt him), then the jump
  if (r.err) { say(player, "§c[Operator] " + r.err); return; }
  try { teleportTo(player, { x: t.location.x, y: t.location.y, z: t.location.z }, t.dimension.id); }
  catch (e) { say(player, "§c[Operator] Teleport failed (the area may not be loaded)."); return; }
  say(player, "§b[Operator] Spectating §f" + name + " §7(open Spectator, then Spectator here, to go back)");
}

// ---- Ore vision + Vanish: one small page with both tools (each keeps its own page)
function sightPage(player, back) {
  if (!guard(player)) return;
  const self = () => sightPage(player, back), v = isVanished(player), vm = visionMode(player);
  const f = make("Operator: Ore vision + Vanish", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, v || vm ? "g" : "c") + "§3§lOre vision + Vanish\n§r§7Vanish: " + (v ? "§aON" : "§cOFF") + "\n§r§7Ore vision: " + (vm ? "§a" + (vm === "rare" ? "RARE ORES" : "ALL ORES") : "§cOFF"), "textures/ui/shop/pot_s_invisibility", null);
  perm(f, 2 * COLS + 3, player, "vanish", "§7§lVanish\n§r§7Now: " + (v ? "§aON" : "§cOFF") + "\n§r§7Invisible, can't be hit, no effects,\n§r§7hidden from lists\n§r§eClick to open", "textures/ui/shop/pot_s_invisibility", () => vanishPage(player, self), v ? "g" : "r");
  perm(f, 2 * COLS + 5, player, "orevision", "§3§lOre vision\n§r§7Now: " + (vm ? "§a" + (vm === "rare" ? "RARE ORES" : "ALL ORES") : "§cOFF") + "\n§r§7Coloured frames around ores near you\n§r§7(only you see them, use with Spectator)\n§r§eClick to open", "textures/ui/shop/i3d_diamond_ore", () => visionPage(player, self), vm ? "g" : "c");
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- ore vision (Admin): choose what to show
function visionPage(player, back) {
  if (!guard(player, "orevision")) return;
  const self = () => visionPage(player, back), cur = visionMode(player);
  const f = make("Operator: Ore vision", SHORT_ROWS); f.self = self;
  const pick = (mode) => { const r = setVision(player, mode); say(player, r.err ? "§c[Operator] " + r.err : mode ? "§3[Operator] Ore vision: §a" + (mode === "rare" ? "rare ores" : "all ores") + " §7(frames only you can see; fly in Spectator to see through rock)" : "§3[Operator] Ore vision §cOFF"); self(); };
  set(f, 1 * COLS + 2, hdr(1, cur === "all" ? "g" : "c") + "§b§lAll ores\n§r§7Diamond, emerald, gold, iron, lapis,\n§r§7redstone, coal, copper, debris...\n§r§eClick", "textures/ui/shop/i3d_iron_ore", { run: () => pick("all") });
  set(f, 1 * COLS + 4, hdr(1, cur === "rare" ? "g" : "c") + "§d§lRare ores only\n§r§7Diamond, emerald, gold, debris\n§r§eClick", "textures/ui/shop/i3d_diamond_ore", { run: () => pick("rare") });
  set(f, 1 * COLS + 6, hdr(1, cur ? "r" : "c") + "§c§lOff\n§r§7Hide all frames", ICON.barrier, { run: () => pick(null) });
  set(f, 3 * COLS + 4, hdr(1) + "§7Colours: §bdiamond §aemerald §egold §6copper §credstone §9lapis\n§r§7Frames: nearest 64 ores within 20 blocks", ICON.paper, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ players
export function playersPage(player, back, page = 0, q = "") {
  if (!guard(player)) return;
  const live = new Map(world.getAllPlayers().map((p) => [p.id, p])), bans = banMap();
  let all = knownPlayers().map((x) => ({ id: x.id, name: String(x.name) }));
  for (const p of live.values()) if (!all.some((x) => x.id === p.id)) all.push({ id: p.id, name: p.name });
  const ql = q.toLowerCase();
  if (ql) all = all.filter((x) => x.name.toLowerCase().includes(ql));
  all.sort((a, b) => (live.has(b.id) ? 1 : 0) - (live.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
  const again = (pg) => playersPage(player, back, pg, q);
  const items = all.map((x) => () => {
    const on = live.has(x.id), r = recordOf(x.id), banned = bans.has(x.id);
    return { zone: banned ? "r" : on ? "g" : "c", icon: ICON.player,
      text: (on ? "§a§l" : "§7§l") + x.name + "\n§r" + (on ? "§aOnline" : "§7Offline") + (banned ? " §c(banned)" : "") + "\n§r§7Money: §a" + money(r?.money ?? 0) + "\n§r§eClick to open",
      run: () => playerPage(player, x.id, x.name, () => playersPage(player, back, page, q)) };
  });
  const extras = [[7, hdr(1) + "§b§lSearch\n§r§7Find a player by name", ICON.search, () => {
    if (!guard(player)) return;
    const form = new OprForm().title("Search player");
    textField(form, "§fPart of the name", "e.g. steve");
    showModal(player, form, (v) => playersPage(player, back, 0, v ? String(v[0] ?? "").trim() : q));
  }]];
  if (q) extras.push([8, hdr(1) + "§c§lClear search\n§r§7Show everybody again", NAV.no, () => playersPage(player, back, 0, "")]);
  listPage(player, q ? "Players: " + q : "Players", items, page, back, again, extras);
}

/** one player: everything about him + the staff actions */
export function playerPage(player, id, name, back) {
  if (!guard(player)) return;
  const t = online(id), r = recordOf(id) ?? {}, bl = banMap().get(id) ?? [], self = () => playerPage(player, id, name, back);
  const homes = homesOf(id), lands = claimsOf(id);
  const f = make(name, SHORT_ROWS); f.self = self;
  const play = t ? playSeconds(t) : r.play ?? 0;
  set(f, 0 * COLS + 4, hdr(1, t ? "g" : "c") + "§e§l" + name + "\n§r" + (t ? "§aOnline §7- " + dimLabel(t.dimension.id) : "§7Offline") + "\n§r§7Money: §a" + money(r.money ?? 0) + " §8| §7Shards: §d" + num(r.shards ?? 0)
    + "\n§r§7Kills §f" + num(r.kills ?? 0) + " §7| Deaths §f" + num(r.deaths ?? 0) + "\n§r§7Playtime: §f" + playtime(play) + "\n§r§7Buyer Lv §f" + progress(r.bxp ?? 0).level + " §7| Seller Lv §f" + progress(r.sxp ?? 0).level + statusLine(id), ICON.player, null);

  if (t && t.id !== player.id) set(f, 1 * COLS + 1, hdr(1, "g") + "§a§lGo to " + name + "\n§r§7Teleport to him now", "textures/items/ender_pearl", { run: () => { const now = online(id); if (!now) { say(player, "§c[Operator] " + name + " went offline."); return self(); } tpTo(player, now.location, now.dimension.id, name); } });
  else set(f, 1 * COLS + 1, hdr(1, "r") + "§7§lGo to " + name + "\n§r§7" + (t ? "That is you" : "He is offline"), NAV.no, null);
  set(f, 1 * COLS + 3, hdr(Math.max(1, homes.length)) + "§b§lHomes §7(" + homes.length + ")\n§r§7See every home he saved\n§r§7and go to it", ICON.bed, { run: () => homesPage(player, id, name, self) });
  set(f, 1 * COLS + 5, hdr(Math.max(1, lands.length)) + "§a§lLands §7(" + lands.length + ")\n§r§7His protected lands\n§r§7and go to them", NAV.shield, { run: () => landsPage(player, name + "'s lands", () => claimsOf(id), self, false) });
  if (t) set(f, 1 * COLS + 7, hdr(1) + "§d§lInventory\n§r§7Everything he carries now\n§r§7(items, armor, off-hand)", "textures/ui/shop/i3d_barrel", { run: () => { if (guard(player, "inventory")) { slog(player, "inv", { id, name }); inventoryPage(player, id, name, self); } } });
  else set(f, 1 * COLS + 7, hdr(1, "r") + "§7§lInventory\n§r§7Only readable while he is online", NAV.no, null);

  set(f, 2 * COLS + 1, hdr(1, "g") + "§a§lGive money\n§r§7Add money to his balance", ICON.gold, { run: () => giveMoney(player, id, name, self) });
  set(f, 2 * COLS + 3, hdr(1, "r") + "§c§lReset money to $0\n§r§7Punishment: sets his balance to 0", "textures/ui/shop/ic_fire", { run: () => resetMoney(player, id, name, self) });
  if (bl.length) set(f, 2 * COLS + 5, hdr(1, "g") + "§a§lUnban\n§r§7Lift every ban he has", NAV.ok, { run: () => confirm(player, "Unban " + name, ["§f" + name, "§7Lifts all of his bans (" + bl.map((b) => SRC[b.src]).join(", ") + ")."], () => { if (!guard(player, "unban")) return; const n = liftAll(id); say(player, n ? "§a[Operator] §f" + name + " §aunbanned." : "§7[Operator] No ban found."); if (n) { opAlert("§f" + player.name + " §7unbanned §f" + name, { chat: false }); slog(player, "unban", { id, name }); } self(); }, self) });
  else if (t && isStaff(t)) set(f, 2 * COLS + 5, hdr(1, "r") + "§7§lBan\n§r§7Operators can't be banned", NAV.no, null);
  else set(f, 2 * COLS + 5, hdr(1, "r") + "§c§lBan\n§r§7Choose how long and why", "textures/ui/shop/ic_gavel", { run: () => banForm(player, id, name, self) });
  set(f, 2 * COLS + 7, hdr(1) + "§5§lEnder chest\n§r§7Bedrock scripts can't read\n§r§7an ender chest (game limit)", ICON.ender, null);

  if (bl.length) set(f, 3 * COLS + 4, hdr(1, "r") + "§c§lBANNED\n§r" + bl.map((b) => "§7" + SRC[b.src] + ": §e" + leftText(b.u) + (b.why ? "\n§r§7" + b.why : "")).join("\n§r"), NAV.no, null);
  // staff tools for this player
  perm(f, 3 * COLS + 1, player, "inspect", "§b§lInspector\n§r§7Everything about " + name + " on one page:\n§r§7position, punishments, notes", "textures/items/spyglass", () => inspectPage(player, id, name, self));
  perm(f, 3 * COLS + 3, player, "warn", "§e§lDiscipline\n§r§7Mute, kick, warn, freeze, TP here,\n§r§7notes, frozen money, staff role", "textures/items/iron_sword", () => disciplinePage(player, id, name, self), muteOf(id) || freezeOf(id) || econOf(id) ? "r" : "c");
  perm(f, 3 * COLS + 5, player, "shards", "§d§lGive & fix\n§r§7Shards, levels, an item, or give back\n§r§7his last inventory after a bug", "textures/ui/shop/ic_gift", () => givePage(player, id, name, self));
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- money
function parseAmount(raw) {
  const n = Number(String(raw ?? "").replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && n >= 1 && n <= 1e12 ? Math.floor(n) : 0;
}
function giveMoney(player, id, name, back) {
  if (!guard(player, "money")) return;
  const form = new OprForm().title("Give money to " + name);
  textField(form, "§fAmount §7(whole dollars)", "e.g. 5000");
  showModal(player, form, (v) => {
    if (!v || !guard(player, "money")) return back();
    const n = parseAmount(v[0]);
    if (!n) { say(player, "§c[Operator] Type a whole amount from 1 to 1,000,000,000,000."); return back(); }
    if (!addMoneyById(id, n)) { say(player, "§c[Operator] Could not find the data of " + name + "."); return back(); }
    const t = online(id); if (t) { try { touch(t); } catch (e) { /* ignore */ } say(t, "§a[Staff] You received §f" + money(n) + "§a."); }
    say(player, "§a[Operator] Gave §f" + money(n) + " §ato §f" + name + "§a.");
    opAlert("§f" + player.name + " §7gave §a" + money(n) + " §7to §f" + name, { chat: false }); slog(player, "money", { id, name }, "+" + money(n));
    back();
  });
}
function resetMoney(player, id, name, back) {
  if (!guard(player, "money")) return;
  const cur = Math.floor(recordOf(id)?.money ?? 0);
  confirm(player, "Reset money", ["§f" + name, "§7Now: §a" + money(cur), "§cHis balance becomes $0."], () => {
    if (!guard(player, "money")) return;
    const now = Math.floor(recordOf(id)?.money ?? 0);
    if (now !== 0 && !addMoneyById(id, -now)) { say(player, "§c[Operator] Could not find the data of " + name + "."); return back(); }
    const t = online(id); if (t) { try { touch(t); } catch (e) { /* ignore */ } say(t, "§c[Staff] Your money was reset to $0."); }
    say(player, "§a[Operator] §f" + name + "§a's money is now §f$0 §7(was " + money(now) + ")");
    opAlert("§f" + player.name + " §7reset the money of §f" + name + " §7to §c$0 §7(was " + money(now) + ")", { chat: false }); slog(player, "mreset", { id, name }, "was " + money(now));
    back();
  }, back);
}

// ---- ban (the method): choose a length + a reason. The player is kicked now (if online) and kicked on every join until the time ends / an operator unbans him.
function banForm(player, id, name, back) {
  if (!guard(player, "tempban")) return;
  const L = OPMENU.banLengths.filter((x) => x.hours > 0 || can(player, "permban")), form = new OprForm().title("Ban " + name);
  dropdown(form, "§fHow long?", L.map((x) => x.label));
  textField(form, "§fReason §7(required, shown to the player)", "e.g. hacking");
  showModal(player, form, (v) => {
    if (!v || !guard(player, "tempban")) return back();
    const len = L[Number(v[0])] ?? L[0], reason = String(v[1] ?? "").replace(/[§\r\n]/g, "").trim();
    if (len.hours === 0 && !guard(player, "permban")) return back();
    if (reason.length < Math.max(1, STAFF.reasonMin)) { say(player, "§c[Operator] A reason is required (at least " + Math.max(1, STAFF.reasonMin) + " letters)."); return back(); }
    const t = online(id);
    if (t && isStaff(t)) { say(player, "§c[Operator] You can't ban an operator."); return back(); }
    const doBan = () => {
      if (!guard(player, len.hours === 0 ? "permban" : "tempban")) return back();
      if (!addBan(id, name, len.hours * 3600000, reason, player.name)) { say(player, "§c[Operator] Could not save the ban."); return back(); }
      say(player, "§a[Operator] §f" + name + " §abanned §7(" + len.label + ")");
      opAlert("§f" + player.name + " §cbanned §f" + name + " §7- " + len.label + " - " + reason, { chat: false });
      slog(player, "ban", { id, name }, len.label + " - " + reason);
      const t2 = online(id); if (t2) enforceNow(t2);
      back();
    };
    if (len.hours === 0) confirm(player, "Permanent ban?", ["§f" + name, "§7" + reason, "§cOnly an Admin can lift it."], doBan, back); else doBan();
  });
}

// ================================================================ online players (quick teleport)
function onlinePage(player, back) {
  if (!guard(player)) return;
  const items = world.getAllPlayers().filter((x) => x.id !== player.id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({
    zone: "g", icon: ICON.player, text: "§a§l" + x.name + "\n§r§7" + dimLabel(x.dimension.id) + "\n§r§7" + Math.floor(x.location.x) + ", " + Math.floor(x.location.y) + ", " + Math.floor(x.location.z) + "\n§r§eClick to teleport",
    run: () => { const now = online(x.id); if (!now) { say(player, "§c[Operator] " + x.name + " went offline."); return onlinePage(player, back); } tpTo(player, now.location, now.dimension.id, now.name); },
  }));
  listPage(player, "Go to a player", items, 0, back, () => onlinePage(player, back));
}

// ================================================================ homes / lands
function homesPage(player, id, name, back) {
  if (!guard(player)) return;
  const items = homesOf(id).map((h) => ({
    zone: "g", icon: ICON.bed, text: "§a§l" + h.n + "\n§r§7" + dimLabel(h.d) + "\n§r§7" + Math.floor(h.x) + ", " + Math.floor(h.y) + ", " + Math.floor(h.z) + "\n§r§eClick to teleport",
    run: () => { tpTo(player, h, h.d, name + "'s home §7" + h.n); },
  }));
  listPage(player, name + "'s homes", items, 0, back, () => homesPage(player, id, name, back));
}
function landsPage(player, title, getClaims, back, showOwner) {
  if (!guard(player, "lands")) return;
  const items = getClaims().map((c) => {
    const sz = sizeOf(c.s), left = timeLeft(c);
    return { zone: "g", icon: ICON.shield, text: "§f§l" + c.n + (showOwner ? " §7- §e" + c.on : "") + "\n§r§7" + sz.w + "x" + sz.w + "x" + sz.h + " §8| §7" + dimLabel(c.d) + "\n§r§7Time left: §f" + dur(left) + "\n§r§7Allowed players: §f" + Object.keys(c.t ?? {}).length + "\n§r§eClick to teleport",
      run: () => { tpTo(player, spotOf(c), c.d, c.on + "'s land §7" + c.n); } };
  });
  listPage(player, title, items, 0, back, () => landsPage(player, title, getClaims, back, showOwner));
}

// ================================================================ inventory (online players only)
function inventoryPage(player, id, name, back) {
  if (!guard(player, "inventory")) return;
  const t = online(id);
  if (!t) { say(player, "§c[Operator] " + name + " is offline - the inventory can only be read while he is online."); return back(); }
  const f = make(name + " §8- Inventory", 9); f.self = () => inventoryPage(player, id, name, back);
  const cell = (slot, s) => {
    if (!s) return;
    let lines = "";
    try { if (s.nameTag) lines += "\n§r§7Name: §f" + s.nameTag; } catch (e) { /* ignore */ }
    try { const en = s.getComponent("enchantable")?.getEnchantments() ?? []; if (en.length) lines += "\n§r§b" + en.slice(0, 6).map((e) => pretty(e.type.id ?? e.type) + " " + e.level).join("§7, §b"); } catch (e) { /* ignore */ }
    try { const d = s.getComponent("durability"); if (d) lines += "\n§r§7Durability: §f" + (d.maxDurability - d.damage) + "§7/§f" + d.maxDurability; } catch (e) { /* ignore */ }
    const bare = s.typeId.replace("minecraft:", "");
    set(f, slot, hdr(s.amount) + "§f§l" + pretty(s.typeId) + "\n§r§7x" + s.amount + lines, ICONS.get(bare) ?? ICON.item, null);
  };
  try {
    const c = t.getComponent("inventory").container;
    for (let i = 9; i < c.size; i++) cell(i - 9, c.getItem(i));              // rows 1-3: the backpack (like in the game)
    for (let i = 0; i < Math.min(9, c.size); i++) cell(27 + i, c.getItem(i)); // row 4: the hotbar
  } catch (e) { say(player, "§c[Operator] Could not read the inventory."); }
  try {
    const eq = t.getComponent("equippable"), E = EquipmentSlot;
    [[1, E.Head], [2, E.Chest], [3, E.Legs], [4, E.Feet], [6, E.Offhand]].forEach(([col, slot]) => cell(5 * COLS + col, eq.getEquipment(slot)));
    set(f, 5 * COLS + 0, hdr(1) + "§e§lArmor + off-hand\n§r§7Helmet, chestplate, leggings,\n§r§7boots | off-hand", NAV.shield, null);
  } catch (e) { /* ignore */ }
  set(f, 7 * COLS + 4, hdr(1) + "§5§lEnder chest\n§r§7Bedrock scripts can't read an\n§r§7ender chest (game limit)", ICON.ender, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ INVENTORY category: see a member's whole inventory + take items / levels (online players only)
// A "spec" says where an item sits: { k: "c", i: slot } = inventory container slot, { k: "e", e: EquipmentSlot } = armor / off-hand.
const EQ = [["Head", EquipmentSlot.Head], ["Chest", EquipmentSlot.Chest], ["Legs", EquipmentSlot.Legs], ["Feet", EquipmentSlot.Feet], ["Offhand", EquipmentSlot.Offhand]];
const EQ_NAME = { Head: "Helmet", Chest: "Chestplate", Legs: "Leggings", Feet: "Boots", Offhand: "Off-hand" };
const readSpec = (t, sp) => (sp.k === "c" ? t.getComponent("inventory").container.getItem(sp.i) : t.getComponent("equippable").getEquipment(sp.e));
const writeSpec = (t, sp, item) => { if (sp.k === "c") t.getComponent("inventory").container.setItem(sp.i, item); else t.getComponent("equippable").setEquipment(sp.e, item); };
const allSpecs = (t) => {
  const out = [];
  try { const c = t.getComponent("inventory").container; for (let i = 0; i < c.size; i++) out.push({ k: "c", i, w: i }); } catch (e) { /* ignore */ }
  for (const [nm, e] of EQ) out.push({ k: "e", e, w: nm });
  return out;
};
/** may this operator take from this player?  returns an error text, or "" when yes */
function takeBlock(player, t) {
  if (!t) return "He is offline.";
  if (t.id === player.id) return "That is you.";
  try { if (isStaff(t) && !isOwner(player)) return "He is an operator - only the Owner can take from an operator."; } catch (e) { /* ignore */ }
  return "";
}
/** move (part of) the item at `sp` from the target to the operator.  want = a number or "all".  `seen` = typeId + amount the page showed (the item may have changed since). */
function takeStack(player, t, sp, want, seen) {
  if (!allow(player, "takeitem")) return { n: 0, err: "not allowed" };
  const why = takeBlock(player, t); if (why) return { n: 0, err: why };
  let cur; try { cur = readSpec(t, sp); } catch (e) { return { n: 0, err: "could not read the slot" }; }
  if (!cur || (seen && (cur.typeId !== seen.typeId))) return { n: 0, err: "the item is not there any more (it changed)" };
  const n = want === "all" ? cur.amount : Math.min(Math.max(1, Math.floor(Number(want) || 0)), cur.amount);
  if (n < 1) return { n: 0, err: "wrong amount" };
  let mine; try { mine = player.getComponent("inventory").container; } catch (e) { return { n: 0, err: "could not open your inventory" }; }
  const give = cur.clone(); give.amount = n;
  let left; try { left = mine.addItem(give); } catch (e) { return { n: 0, err: "could not add it to your inventory" }; }
  const got = n - (left ? left.amount : 0);
  if (got < 1) return { n: 0, err: "your inventory is full" };
  try {
    if (got >= cur.amount) writeSpec(t, sp, undefined);
    else { const rest = cur.clone(); rest.amount = cur.amount - got; writeSpec(t, sp, rest); }
  } catch (e) { console.warn("[invtake] could not remove from the target: " + e); return { n: got, err: "taken, but the member's slot could not be cleared - check both inventories" }; }
  slog(player, "take", { id: t.id, name: t.name }, got + "x " + pretty(cur.typeId));
  return { n: got, name: pretty(cur.typeId), full: got < n };
}

/** one member card (used by the Inventory category page and by the full list) */
function invCard(player, t, back) {
  let used = 0; try { const c = t.getComponent("inventory").container; for (let i = 0; i < c.size; i++) if (c.getItem(i)) used++; } catch (e) { /* ignore */ }
  const why = takeBlock(player, t);
  return { zone: why ? "c" : "g", icon: ICON.player, text: "§a§l" + t.name + "\n§r§7Stacks in inventory: §f" + used + "\n§r§7Level: §f" + (() => { try { return t.level; } catch (e) { return "?"; } })() + (why && t.id === player.id ? "\n§r§8(you)" : "") + "\n§r§eClick to open",
    run: () => invAdminPage(player, t.id, t.name, back) };
}
function invPlayersPage(player, back, page = 0) {
  if (!guard(player, "inventory")) return;
  const list = world.getAllPlayers().slice().sort((a, b) => a.name.localeCompare(b.name));
  const again = (pg) => invPlayersPage(player, back, pg);
  const items = list.map((t) => () => invCard(player, t, () => invPlayersPage(player, back, page)));
  listPage(player, "Members' inventories", items, page, back, again);
}

function invAdminPage(player, id, name, back) {
  if (!guard(player, "inventory")) return;
  const t = online(id);
  if (!t) { say(player, "§c[Operator] " + name + " is offline - the inventory can only be read while he is online."); return back(); }
  const self = () => invAdminPage(player, id, name, back);
  const block = takeBlock(player, t), canTake = !block && can(player, "takeitem");
  const f = make(name + " §8- Inventory", 9); f.self = self;
  f.glass = true;
  const cell = (slot, sp, label) => {
    let s; try { s = readSpec(t, sp); } catch (e) { return; }
    if (!s) return;
    let lines = "";
    try { if (s.nameTag) lines += "\n§r§7Name: §f" + s.nameTag; } catch (e) { /* ignore */ }
    try { const en = s.getComponent("enchantable")?.getEnchantments() ?? []; if (en.length) lines += "\n§r§b" + en.slice(0, 6).map((x) => pretty(x.type.id ?? x.type) + " " + x.level).join("§7, §b"); } catch (e) { /* ignore */ }
    try { const d = s.getComponent("durability"); if (d) lines += "\n§r§7Durability: §f" + (d.maxDurability - d.damage) + "§7/§f" + d.maxDurability; } catch (e) { /* ignore */ }
    const bare = s.typeId.replace("minecraft:", ""), seen = { typeId: s.typeId, amount: s.amount };
    set(f, slot, hdr(s.amount, canTake ? "g" : "c") + "§f§l" + pretty(s.typeId) + (label ? " §7(" + label + ")" : "") + "\n§r§7x" + s.amount + lines + (canTake ? "\n§r§eClick to take" : ""), ICONS.get(bare) ?? ICON.item,
      canTake ? { run: () => invItemPage(player, id, name, sp, seen, self) } : null);
  };
  try {
    const c = t.getComponent("inventory").container;
    for (let i = 9; i < c.size; i++) cell(i - 9, { k: "c", i }, "");                                    // rows 1-3: the backpack
    for (let i = 0; i < Math.min(9, c.size); i++) cell(27 + i, { k: "c", i }, "");                       // row 4: the hotbar
  } catch (e) { say(player, "§c[Operator] Could not read the inventory."); }
  set(f, 5 * COLS + 0, hdr(1) + "§e§lArmor + off-hand\n§r§7Helmet, chestplate, leggings,\n§r§7boots | off-hand", NAV.shield, null);
  [["Head", 1], ["Chest", 2], ["Legs", 3], ["Feet", 4], ["Offhand", 6]].forEach(([nm, col]) => cell(5 * COLS + col, { k: "e", e: EquipmentSlot[nm] }, EQ_NAME[nm]));
  let lvl = 0; try { lvl = t.level; } catch (e) { /* ignore */ }
  const nStacks = (() => { let n = 0; for (const sp of allSpecs(t)) { try { if (readSpec(t, sp)) n++; } catch (e) { /* ignore */ } } return n; })();
  if (canTake) {
    set(f, 7 * COLS + 1, hdr(Math.min(99, Math.max(1, nStacks)), "r") + "§c§lTake EVERYTHING\n§r§7All his items, armor and off-hand\n§r§7go to your inventory\n§r§7(what does not fit stays with him)\n§r§eClick", "textures/ui/shop/ic_fire", { run: () => confirm(player, "Take everything from " + name + "?", ["§7All " + nStacks + " stacks (armor + off-hand too)", "§7go to YOUR inventory."], () => {
      const tt = online(id); if (!tt) { say(player, "§c[Operator] " + name + " went offline."); return back(); }
      let got = 0, stacks = 0, err = "";
      for (const sp of allSpecs(tt)) { let cur = null; try { cur = readSpec(tt, sp); } catch (e) { /* ignore */ } if (!cur) continue; const r = takeStack(player, tt, sp, "all", { typeId: cur.typeId, amount: cur.amount }); if (r.n) { got += r.n; stacks++; } else if (r.err && !err) err = r.err; }
      say(player, got ? "§a[Operator] Took §f" + got + " §aitems (" + stacks + " stacks) from §f" + name + (err ? "§7. Some stayed: " + err : "") : "§c[Operator] Nothing taken: " + (err || "his inventory is empty"));
      invAdminPage(player, id, name, back);
    }, self) });
    set(f, 7 * COLS + 3, hdr(Math.min(99, Math.max(1, lvl)), "g") + "§d§lTake levels\n§r§7His level now: §f" + lvl + "\n§r§7Choose how many levels to take\n§r§eClick", "textures/items/experience_bottle", { run: () => invLevelsForm(player, id, name, self) });
    set(f, 7 * COLS + 5, hdr(Math.min(99, Math.max(1, lvl)), "r") + "§c§lTake ALL levels\n§r§7Sets his level to 0\n§r§7Now: §f" + lvl + "\n§r§eClick", "textures/items/experience_bottle", { run: () => confirm(player, "Take all levels of " + name + "?", ["§7His level " + lvl + " becomes 0."], () => { takeLevels(player, id, name, "all"); invAdminPage(player, id, name, back); }, self) });
  } else {
    set(f, 7 * COLS + 3, hdr(1, "r") + "§7§lTaking is locked\n§r§7" + (block ? block : lockText("takeitem", player)), ICON.barrier, { run: () => { if (!block) allow(player, "takeitem"); } });
  }
  set(f, 7 * COLS + 7, hdr(1) + "§5§lEnder chest\n§r§7Bedrock scripts can't read an\n§r§7ender chest (game limit)", ICON.ender, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

/** one item: take it all, a part, or half */
function invItemPage(player, id, name, sp, seen, back) {
  if (!guard(player, "takeitem")) return back();
  const t = online(id);
  let cur = null; try { if (t) cur = readSpec(t, sp); } catch (e) { /* ignore */ }
  if (!cur || cur.typeId !== seen.typeId) { say(player, "§c[Operator] That item is not there any more."); return back(); }
  const self = () => invItemPage(player, id, name, sp, { typeId: cur.typeId, amount: cur.amount }, back);
  const doTake = (want) => {
    const tt = online(id); if (!tt) { say(player, "§c[Operator] " + name + " went offline."); return back(); }
    const r = takeStack(player, tt, sp, want, { typeId: cur.typeId, amount: cur.amount });
    say(player, r.n ? "§a[Operator] Took §f" + r.n + "x " + r.name + " §afrom §f" + name + (r.err ? "§7 - " + r.err : r.full ? "§7 (your inventory had no room for the rest)" : "") : "§c[Operator] Nothing taken: " + r.err);
    back();                                                                                                  // back to his inventory (it refreshes)
  };
  const bare = cur.typeId.replace("minecraft:", "");
  const f = make(name + " §8- " + pretty(cur.typeId), SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(cur.amount) + "§f§l" + pretty(cur.typeId) + "\n§r§7x" + cur.amount + "\n§r§7From: §f" + name, ICONS.get(bare) ?? ICON.item, null);
  set(f, 1 * COLS + 2, hdr(cur.amount, "r") + "§c§lTake all\n§r§7" + cur.amount + "x goes to your inventory", ICON.chest, { run: () => doTake("all") });
  if (cur.amount > 1) {
    set(f, 1 * COLS + 4, hdr(Math.max(1, Math.floor(cur.amount / 2)), "g") + "§e§lTake half\n§r§7" + Math.floor(cur.amount / 2) + "x", ICON.chest, { run: () => doTake(Math.floor(cur.amount / 2)) });
    set(f, 1 * COLS + 6, hdr(1, "g") + "§b§lTake an amount\n§r§7Type how many (1-" + cur.amount + ")", ICON.search, { run: () => {
      const form = new OprForm().title("Take " + pretty(cur.typeId));
      textField(form, "§fHow many? §7(1-" + cur.amount + ")", "e.g. 5");
      showModal(player, form, (v) => {
        if (!v) return self();
        const n = Number(String(v[0] ?? "").replace(/[,\s]/g, ""));
        if (!Number.isInteger(n) || n < 1 || n > cur.amount) { say(player, "§c[Operator] Type a whole number from 1 to " + cur.amount + "."); return self(); }
        doTake(n);
      });
    } });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- levels (the normal game XP level of the player)
function invLevelsForm(player, id, name, back) {
  if (!guard(player, "takeitem")) return back();
  const t = online(id); let lvl = 0; try { lvl = t ? t.level : 0; } catch (e) { /* ignore */ }
  const form = new OprForm().title("Take levels from " + name);
  textField(form, "§fHow many levels? §7(his level now: " + lvl + ")", "e.g. 10");
  showModal(player, form, (v) => {
    if (!v) return back();
    const n = Number(String(v[0] ?? "").replace(/[,\s]/g, ""));
    if (!Number.isInteger(n) || n < 1) { say(player, "§c[Operator] Type a whole number, 1 or more."); return back(); }
    takeLevels(player, id, name, n);
    back();
  });
}
function takeLevels(player, id, name, want) {
  if (!allow(player, "takeitem")) return;
  const t = online(id), why = takeBlock(player, t);
  if (why) return say(player, "§c[Operator] " + why);
  try {
    const before = t.level; if (!(before > 0)) return say(player, "§c[Operator] " + name + " has no levels.");
    const n = want === "all" ? before : Math.min(before, want);
    if (want === "all") t.resetLevel(); else t.addLevels(-n);
    const after = t.level;
    say(player, "§a[Operator] Took §f" + (before - after) + " §alevels from §f" + name + " §7(" + before + " > " + after + ")");
    slog(player, "take", { id, name }, (before - after) + " levels (" + before + " > " + after + ")");
  } catch (e) { say(player, "§c[Operator] Could not take the levels."); console.warn("[invtake] levels: " + e); }
}

// ================================================================ bans
function bansPage(player, back) {
  if (!guard(player, "bans")) return;
  const items = [];
  for (const [id, rows] of banMap()) {
    const name = rows[0].name ?? id;
    items.push({ zone: "r", icon: NAV.no, text: "§c§l" + name + "\n§r" + rows.map((b) => "§7" + SRC[b.src] + ": §e" + leftText(b.u)).join("\n§r") + (rows[0].why ? "\n§r§7" + rows[0].why : "") + "\n§r§eClick to unban",
      run: () => confirm(player, "Unban " + name, ["§f" + name, "§7Lifts all of his bans."], () => { if (!guard(player, "unban")) return; const n = liftAll(id); say(player, n ? "§a[Operator] §f" + name + " §aunbanned." : "§7[Operator] No ban found."); if (n) { opAlert("§f" + player.name + " §7unbanned §f" + name, { chat: false }); slog(player, "unban", { id, name }); } bansPage(player, back); }, () => bansPage(player, back)) });
  }
  listPage(player, "Bans", items, 0, back, () => bansPage(player, back));
}

// ================================================================ alerts
function alertsPage(player, back) {
  if (!guard(player)) return;
  const seen = unseenCount(player), list = listAlerts();
  const items = list.map((a, i) => ({ zone: i < seen ? "g" : "c", icon: "textures/ui/shop/ic_mail", text: (i < seen ? "§e● NEW\n§r" : "") + a.x + "\n§r§8" + ago(a.t) }));
  markAlertsSeen(player);                                             // they were just shown
  listPage(player, "Alerts", items, 0, back, () => alertsPage(player, back));
}

// ================================================================ LOGS (data and detection: systems/oplog.js)
const MIN_MS = 60000;
const LOGCAT = {
  sus: { title: "Suspicious", col: "§c", icon: () => ICON.barrier, info: "Things that look wrong: same product\n§r§7again and again, buy + sell loops,\n§r§7fast money, payment chains..." },
  buy: { title: "Purchases", col: "§e", icon: () => ICON.chest, info: "Everything bought with money" },
  sell: { title: "Sales", col: "§a", icon: () => ICON.gold, info: "Everything sold for money" },
  spawner: { title: "Spawners & Eggs", col: "§d", icon: () => ICONS.get("mob_spawner") ?? ICON.item, info: "Spawner / egg purchases and sales" },
  pay: { title: "Transfers (/pay)", col: "§b", icon: () => ICON.book, info: "Money sent between players" },
  big: { title: "Big deals", col: "§6", icon: () => ICON.ender, info: "Single deals or payments above the limit\n§r§7(settings: OPLOG.big)" },
  shard: { title: "Shard shop", col: "§5", icon: () => ICON.item, info: "Everything bought with shards" },
  ah: { title: "Auction & Orders log", col: "§6", icon: () => ICONS.get("emerald") ?? ICON.gold, info: "Everything listed for sale in /ah\n§r§7every auction purchase and every /order\n§r§7(made, sold into, cancelled)" },
  ord: { title: "Orders", col: "§6", icon: () => ICONS.get("emerald") ?? ICON.gold, info: "Buy orders (/order)" },   // saved apart, but shown inside the Auction & Orders log
};
// the auction log and the order log are ONE list for the operators: both saved lists merged, newest first
const catEntries = (cat) => (cat === "ah" ? [...entries("ah"), ...entries("ord")].sort((a, b) => b.t - a.t) : entries(cat));
const catNew = (u, cat) => (cat === "ah" ? (u.ah ?? 0) + (u.ord ?? 0) : u[cat] ?? 0);
const isOrd = (e) => typeof e.k === "string" && e.k.startsWith("ord");
const FILTERS = [["All", 0], ["Last 10 min", 10 * MIN_MS], ["Last 30 min", 30 * MIN_MS], ["Last hour", 60 * MIN_MS], ["Last 24 hours", 24 * 60 * MIN_MS]];
const amountOf = (e) => (e.s ? num(e.a) + " shards" : money(e.a));
const wrap = (text, n = 30) => { const out = []; let line = ""; for (const w of String(text).split(" ")) { if ((line + " " + w).trim().length > n) { out.push(line); line = w; } else line = (line + " " + w).trim(); } if (line) out.push(line); return out; };

/** the text of one entry in a list */
function logLine(e, tag) {
  const t = tag ? "§8" + tag + " " : "";
  if (e.k === "sus") return (e.l > 1 ? "§c§l" : "§e§l") + (RULES[e.r] ?? "Suspicious") + "\n§r§f" + e.p + "\n§r§8" + ago(e.t);
  if (e.k === "pay") return "§e§l" + money(e.a) + " §r§7sent\n§r§f" + e.p + " §7-> §f" + e.o + "\n§r§8" + t + ago(e.t);
  if (e.k === "ahl") return "§6§lListed " + money(e.a) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §8" + t + "- " + ago(e.t);
  if (e.k === "ahb") return "§a§lAuction sale " + money(e.a) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §7<- §f" + e.o + "\n§r§8" + t + ago(e.t);
  if (e.k === "ord") return "§6§lOrder made " + money(e.a) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §8" + t + "- " + ago(e.t);
  if (e.k === "ordf") return "§a§lSold to order " + money(e.a) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §7-> §f" + e.o + "\n§r§8" + t + ago(e.t);
  if (e.k === "ordc") return "§c§lOrder cancelled " + money(e.a) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §8" + t + "- " + ago(e.t);
  return (e.k === "sell" ? "§a§l+" : "§c§l-") + amountOf(e) + "\n§r§f" + num(e.q) + "x " + e.n + "\n§r§7" + e.p + " §8" + t + "- " + ago(e.t);
}
const logIcon = (e) => (e.k === "sus" ? ICON.barrier : e.k === "pay" ? ICON.book : e.k === "ahl" || e.k === "ahb" || isOrd(e) ? (ICONS.get(e.x) ?? ICONS.get(String(e.x).replace("minecraft:", "")) ?? ahIcon(e.x) ?? ICON.item) : ICONS.get(e.x) ?? ICONS.get(String(e.x).replace("minecraft:", "")) ?? ICON.item);

// ================================================================ LOGS hub (main /opr page > Logs): every log of the server in one place
// The Heart Logs page lives in main.js (the shop); main.js hands it over with setHeartLogsHook() (this file can't import main.js).
let heartLogsHook = null;
export function setHeartLogsHook(fn) { heartLogsHook = fn; }
function logsHubPage(player, back) {
  if (!guard(player)) return;
  const self = () => logsHubPage(player, back), f = make(SYM + " Logs", 6); f.self = self;
  f.glass = true;
  // every log of the server as a shortcut (the originals stay where they are: Moderation, Server & staff, /shop ...)
  //   row 1: the 7 shop & money logs | row 2: by player + live feed + auction log | row 3: staff actions, duels, End events, Heart Logs | row 4: alerts
  const u = unseenCounts(player), nNew = unseenCount(player);
  const sus = u.sus, newLogs = CATS.reduce((a, c) => a + (c === "big" ? 0 : u[c]), 0);
  set(f, 0 * COLS + 4, hdr(1) + SYM + " §d§lLogs\n§r§7Every log of the server in one place\n§r§7(they also stay where they were)\n§r§7New in shop & money: " + (sus ? "§c" + sus + " suspicious" : newLogs ? "§e" + newLogs : "§fnothing"), ICON.book, null);
  ["sus", "buy", "sell", "spawner", "pay", "big", "shard"].forEach((cat, i) => {
    const c = LOGCAT[cat], total = entries(cat).length, n = u[cat];
    perm(f, 1 * COLS + 1 + i, player, "logs", c.col + "§l" + c.title + "\n§r" + (n ? "§e" + n + " new §8| " : "") + "§7Saved: §f" + total + "\n§r§7" + c.info + "\n§r§eClick to open", c.icon(), () => logCatPage(player, cat, self), n ? (cat === "sus" ? "r" : "g") : "c", Math.min(99, Math.max(1, n || total)));
  });
  perm(f, 2 * COLS + 3, player, "logs", "§f§lBy player\n§r§7Everything one player did,\n§r§7his reports first\n§r§eClick to open", ICON.player, () => logPlayersPage(player, self), "c", Math.min(99, Math.max(1, playersIndex().length)));
  { const on = liveOn(player);
    perm(f, 2 * COLS + 5, player, "logs", "§b§lLive feed\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§7ON = every purchase, sale and payment\n§r§7also shows in your chat\n§r§eClick to switch", ICON.paper, () => { toggleLive(player); say(player, "§b[Operator] Live feed: " + (liveOn(player) ? "§aON" : "§cOFF")); self(); }, on ? "g" : "r"); }
  { const c = LOGCAT.ah, total = catEntries("ah").length, n = catNew(u, "ah");
    perm(f, 2 * COLS + 7, player, "logs", c.col + "§l" + c.title + "\n§r" + (n ? "§e" + n + " new §8| " : "") + "§7Saved: §f" + total + "\n§r§7" + c.info + "\n§r§eClick to open", c.icon(), () => logCatPage(player, "ah", self), n ? "g" : "c", Math.min(99, Math.max(1, n || total))); }
  perm(f, 3 * COLS + 1, player, "stafflog", "§6§lStaff actions\n§r§7What every operator did: money,\n§r§7bans, bypass, mutes ... with time\n§r§eClick to open", ICON.paper, () => staffLogPage(player, self));
  set(f, 3 * COLS + 3, hdr(Math.max(1, Math.min(99, duelRecordCount()))) + "§c§lDuel log\n§r§7Who fought, who won and what\n§r§7the loser lost\n§r§7Saved fights: §f" + duelRecordCount() + "\n§r§eClick to open", "textures/items/book_writable", { run: () => { if (guard(player)) duelLogPage(player, self); } });
  perm(f, 3 * COLS + 5, player, "endgate", "§5§lEnd event log\n§r§7Every opening, closing, countdown\n§r§7and the first player in\n§r§7Saved: §f" + endLog().length + "\n§r§eClick to open", ICON.paper, () => endLogPage(player, self), "c", Math.min(99, Math.max(1, endLog().length)));
  set(f, 3 * COLS + 7, hdr(1) + "§b§lHeart Logs\n§r§7Buyers, purchases, pickups, uses,\n§r§7destroyed / repaired\n§r§eClick to open", "textures/ui/shop/ic_heart", { run: () => { if (!guard(player)) return; if (heartLogsHook) heartLogsHook(player, self); else say(player, "§c[Operator] Heart Logs are not ready yet."); } });
  { const nc = creativeEntries().length;
    perm(f, 4 * COLS + 2, player, "logs", "§d§lCreative log\n§r§7Who used Creative mode and\n§r§7which items they took\n§r§7Saved: §f" + nc + "\n§r§eClick to open", ICON.chest, () => creativeLogPage(player, self), "c", Math.min(99, Math.max(1, nc))); }
  set(f, 4 * COLS + 4, hdr(Math.min(99, Math.max(1, nNew)), nNew ? "g" : "c") + "§d§lAlerts\n§r" + (nNew ? "§e" + nNew + " new" : "§7No new alerts") + "\n§r§7Notices for the staff\n§r§eClick to open", "textures/ui/shop/ic_mail", { run: () => alertsPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

function logsPage(player, back) {
  if (!guard(player, "logs")) return;
  const u = unseenCounts(player), self = () => logsPage(player, back), f = make(SYM + " Logs", SHORT_ROWS); f.self = self;
  const cell = (cat, slot) => {
    const c = LOGCAT[cat], total = catEntries(cat).length, n = catNew(u, cat);
    set(f, slot, hdr(Math.min(99, Math.max(1, n || total)), n ? (cat === "sus" ? "r" : "g") : "c") + c.col + "§l" + c.title + "\n§r" + (n ? "§e" + n + " new §8| " : "") + "§7Saved: §f" + total + "\n§r§7" + c.info, c.icon(), { run: () => logCatPage(player, cat, self) });
  };
  cell("sus", 0 * COLS + 4); cell("ah", 0 * COLS + 6);
  cell("buy", 1 * COLS + 2); cell("sell", 1 * COLS + 4); cell("spawner", 1 * COLS + 6);
  cell("pay", 2 * COLS + 2); cell("big", 2 * COLS + 4); cell("shard", 2 * COLS + 6);
  const idx = playersIndex();
  set(f, 3 * COLS + 2, hdr(Math.min(99, Math.max(1, idx.length))) + "§f§lBy player\n§r§7Everything one player did,\n§r§7his reports first", ICON.player, { run: () => logPlayersPage(player, self) });
  set(f, 3 * COLS + 4, hdr(1) + "§d§l" + SYM + " Logs\n§r§7Saved for the operators only.\n§r§7Settings: OPLOG in config.js", ICON.book, null);
  const on = liveOn(player);
  set(f, 3 * COLS + 6, hdr(1, on ? "g" : "r") + "§b§lLive feed\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§7ON = every purchase, sale and payment\n§r§7also shows in your chat\n§r§eClick to switch", ICON.paper, { run: () => { if (!guard(player)) return; toggleLive(player); say(player, "§6[Operator] Logs live feed: " + (liveOn(player) ? "§aON" : "§cOFF")); self(); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}

function logCatPage(player, cat, back, st, pg = 0) {
  if (!guard(player, "logs")) return;
  if (!st) { st = { fi: 0, seen: seenAt(player, cat), seen2: cat === "ah" ? seenAt(player, "ord") : 0 }; markSeen(player, cat); if (cat === "ah") markSeen(player, "ord"); }          // "NEW" is remembered for this visit, then everything counts as seen
  const c = LOGCAT[cat], [fname, fms] = FILTERS[st.fi], cut = fms ? Date.now() - fms : 0;
  const list = catEntries(cat).filter((e) => e.t >= cut);
  const self = (n) => logCatPage(player, cat, back, st, n ?? 0);
  const items = list.map((e) => () => ({
    zone: e.k === "sus" && e.l > 1 ? "r" : e.t > (isOrd(e) ? st.seen2 : st.seen) && e.i !== player.id ? "g" : "c", icon: logIcon(e), text: logLine(e),
    run: () => entryPage(player, e, cat, () => logCatPage(player, cat, back, st, pg)),
  }));
  listPage(player, c.col + c.title + " §8- " + fname, items, pg, back, self, [
    [0, hdr(1) + "§b§lTime filter\n§r§7Now: §f" + fname + "\n§r§eClick to change", ICON.search, () => logCatPage(player, cat, back, { fi: (st.fi + 1) % FILTERS.length, seen: st.seen, seen2: st.seen2 }, 0)],
  ]);
}

function entryPage(player, e, cat, back) {
  if (!guard(player, "logs")) return;
  const self = () => entryPage(player, e, cat, back), f = make(SYM + " Log entry", SHORT_ROWS); f.self = self;
  const lines = [];
  if (e.k === "sus") { lines.push("§c§l" + (RULES[e.r] ?? "Suspicious")); lines.push("§r§7Level: " + (e.l > 1 ? "§cHIGH" : "§eWatch")); for (const l of wrap(e.d, 34)) lines.push("§r§f" + l); }
  else if (e.k === "pay") { lines.push("§e§lPayment " + money(e.a)); lines.push("§r§7From §f" + e.p); lines.push("§r§7To §f" + e.o); }
  else if (e.k === "ahl") { lines.push("§6§lAuction listing " + money(e.a)); lines.push("§r§f" + num(e.q) + "x " + e.n); if (e.q > 1) lines.push("§r§7Per item: §f" + money(Math.round(e.a / e.q))); lines.push("§r§7Seller: §f" + e.p); }
  else if (e.k === "ahb") { lines.push("§a§lAuction sale " + money(e.a)); lines.push("§r§f" + num(e.q) + "x " + e.n); if (e.q > 1) lines.push("§r§7Per item: §f" + money(Math.round(e.a / e.q))); lines.push("§r§7Buyer: §f" + e.p); lines.push("§r§7Seller: §f" + e.o); if (typeof e.g === "number" && e.g !== e.a) lines.push("§r§7Seller got: §f" + money(e.g)); }
  else if (e.k === "ord") { lines.push("§6§lOrder made " + money(e.a)); lines.push("§r§f" + num(e.q) + "x " + e.n); if (e.q > 1) lines.push("§r§7Per item: §f" + money(Math.round(e.a / e.q))); lines.push("§r§7Buyer: §f" + e.p); }
  else if (e.k === "ordf") { lines.push("§a§lSold to order " + money(e.a)); lines.push("§r§f" + num(e.q) + "x " + e.n); if (e.q > 1) lines.push("§r§7Per item: §f" + money(Math.round(e.a / e.q))); lines.push("§r§7Seller: §f" + e.p); lines.push("§r§7Order owner: §f" + e.o); }
  else if (e.k === "ordc") { lines.push("§c§lOrder cancelled " + money(e.a)); lines.push("§r§f" + num(e.q) + "x " + e.n + " §7(not filled)"); lines.push("§r§7Order owner: §f" + e.p); }
  else { lines.push((e.k === "sell" ? "§a§lSale " : "§c§lPurchase ") + amountOf(e)); lines.push("§r§f" + num(e.q) + "x " + e.n); if (e.q > 1) lines.push("§r§7Per item: §f" + (e.s ? num(e.a / e.q) + " shards" : money(Math.round(e.a / e.q)))); lines.push("§r§7Player: §f" + e.p); }
  set(f, 0 * COLS + 4, hdr(1, e.k === "sus" && e.l > 1 ? "r" : "c") + lines.join("\n"), logIcon(e), null);
  set(f, 1 * COLS + 2, hdr(1) + "§e§l" + (e.k === "ahl" || e.k === "ordf" ? "Seller" : e.k === "ahb" || e.k === "ord" ? "Buyer" : e.k === "ordc" ? "Order owner" : "Player") + ": " + e.p + "\n§r§7Open the operator profile\n§r§7(money, homes, ban...)", ICON.player, { run: () => playerPage(player, e.i, e.p, self) });
  set(f, 1 * COLS + 4, hdr(1) + "§b§lWhen\n§r§f" + ago(e.t) + "\n§r§8" + new Date(e.t).toISOString().replace("T", " ").slice(0, 19) + " UTC", ICON.compass, null);
  set(f, 1 * COLS + 6, hdr(1) + "§f§lAll logs of " + e.p + "\n§r§7Everything this player did", ICON.paper, { run: () => playerLogsPage(player, e.i, e.p, self) });
  if ((e.k === "pay" || e.k === "ahb" || e.k === "ordf") && e.oi) set(f, 2 * COLS + 4, hdr(1) + "§e§l" + (e.k === "ahb" ? "Seller" : e.k === "ordf" ? "Order owner" : "Receiver") + ": " + e.o + "\n§r§7Open the operator profile", ICON.player, { run: () => playerPage(player, e.oi, e.o, self) });
  if (isOwner(player)) set(f, 3 * COLS + 4, hdr(1, "r") + "§c§lDelete this record\n§r§7Removes only this one record\n§r§7from the log for good\n§r§7Only the Owner sees this button", ICON.barrier, { run: () => {
    if (!isOwner(player)) return self();                                                      // checked again
    confirm(player, "Delete this record?", ["§7" + lines[0].replace(/§./g, ""), "§7Player: §f" + e.p, "§cIt is removed for good", "§cand can't be brought back."], () => {
      if (!isOwner(player)) return back();                                                    // checked a third time, at the moment of deleting
      const n = deleteEntry(e);
      if (n) { try { slog(player, "dellog", { id: e.i, name: e.p }, "shop log: " + lines[0].replace(/§./g, "").slice(0, 60)); } catch (err) { /* ignore */ } }
      say(player, n ? "§a[Operator] The record was deleted." : "§7[Operator] The record was not found (already deleted).");
      back();
    }, self);
  } });
  backBtn(f, back); status(player, f);
  open(player, f);
}

function playerLogsPage(player, id, name, back, pg = 0) {
  if (!guard(player, "logs")) return;
  const list = entriesOfPlayer(id), self = (n) => playerLogsPage(player, id, name, back, n ?? 0);
  const items = list.map((e) => () => ({
    zone: e.k === "sus" && e.l > 1 ? "r" : "c", icon: logIcon(e), text: logLine(e, "[" + (LOGCAT[e.c]?.title ?? e.c) + "]"),
    run: () => entryPage(player, e, e.c, () => playerLogsPage(player, id, name, back, pg)),
  }));
  listPage(player, "§f" + name + " §8- logs", items, pg, back, self, [
    [0, hdr(1) + "§e§lPlayer profile\n§r§7Money, homes, lands, ban...", ICON.player, () => playerPage(player, id, name, () => playerLogsPage(player, id, name, back, pg))],
  ]);
}

function logPlayersPage(player, back, pg = 0) {
  if (!guard(player, "logs")) return;
  const idx = playersIndex(), self = (n) => logPlayersPage(player, back, n ?? 0);
  const items = idx.map((r) => () => ({
    zone: r.sus ? "r" : "c", icon: ICON.player, n: Math.min(99, r.n),
    text: "§f§l" + r.name + "\n§r" + (r.sus ? "§c" + r.sus + " suspicious §8| " : "") + "§7" + r.n + " entries\n§r§8Last: " + ago(r.last),
    run: () => playerLogsPage(player, r.id, r.name, () => logPlayersPage(player, back, pg)),
  }));
  listPage(player, "Logs by player", items, pg, back, self);
}

// the staff pages (staffmenu.js) open this page when an operator clicks a player
initStaffMenu({ openPlayer: (p, id, name, back) => playerPage(p, id, name, back) });
