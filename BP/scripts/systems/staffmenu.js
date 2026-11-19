// STAFF PAGES (chest style, same look as the Operator menu).  The data and the rules are in staffcore.js / staffworld.js; every action there checks the
// role again, so an old open screen can never do more than the operator is allowed to.  opmenu.js links to these pages and calls initStaffMenu().
import { clearMobsOn } from "./clearlag.js";
import { world } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { makeOpr as make, set, open, hdr, COLS, NAV, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { showModal, textField, dropdown, confirmOpr as confirm } from "./forms.js";
import { recordOf, playSeconds } from "../data.js";
import { money, num, playtime, ago } from "../format.js";
import { progress } from "../xp.js";
import { isStaff, banOfId, leftText } from "./opcore.js";
import { dimLabel } from "./util.js";
import { sendTphere } from "./tpa.js";
import { entriesOfPlayer } from "./oplog.js";
import { STAFF as C } from "./config.js";
import {
  allow, can, roleOf, roleOfId, listRoles, setRole, removeStaff, hasStaffRole, lockText, isOwner, isOwnerId, ownerInfo, setOwner, PERM_INFO, PERM_ROLES, roleAllows, roleDefault, permCount, setRolePerm, resetRolePerms, ROLES, ROLE_NAME, ROLE_COLOR, PERM_MIN, slog, logEntries, logCounts, logText, ACT_GROUPS, ACTS,
  addReport, muteOf, freezeOf, econOf, listMutes, listFreezes, listEcon, mute, unmute, freeze, unfreeze, econFreeze, econUnfreeze, kickPlayer,
  warnsOf, warn, removeWarn, warnedPlayers, notesOf, addNote, removeNote, notedPlayers, tpHereForce, tpAllForce, listReports, closeReport, positionOf, broadcast, BROADCAST_SECONDS,
} from "./staffcore.js";
import {
  isVanished, toggleVanish, listLocks, addLock, removeLock, perfReport, runClearLag, giveShards, giveLevels, giveItem, deathLog, restoreDeath, deathPreview,
  shopCategories, shopInfo, shopItems, setShopPrice, resetShopPrice, setShopBlocked, shopChangedCount,
} from "./staffworld.js";

import { setHudName, resetHudName, hudNameNow, NAME_COLORS, HUD_NAME_MAX } from "../hud.js";
import { eventView, startEvent, stopEvent, setHoloOn, clearSkips, endLog, mmss, nice } from "./endgate.js";
import { removeNearest } from "./endholo.js";
import { mobRewardOn, mobRewardStats, setMobReward, rewardTable, HOURLY_CAP } from "./mobreward.js";
import { afkSettings, zoneSize, setAfkRewards, setAfkZone, setAfkSpot, clearAfkZone, gotoAfkZone, inAfkZone, AFK_LIMITS, AFK_RULES, afkRules, setAfkRule, setAfkRulesAll } from "./afk.js";
import { spawnerSettings, setSpawnerMain, setSpawnerMob, resetSpawnerSettings } from "./spawnercfg.js";
import * as SP from "../spawner_data.js";
import { SPAWNERS } from "../mobs.js";
import { creativeEntries, creativeActiveIds, creativeBlocked, isCreativeBlocked, setCreativeBlock, deleteCreativeEntry, forceState, setForceSurvival } from "./creativelog.js";
import { oprMsg, OprForm } from "./oprlang.js";
import { isAr } from "./arextra.js";
import { allClaims, afkLocked, allLandsLocked, isLocked, setClaimLock, setAllLandsLock, setAfkLock, lockedLandCount, sizeOf as landSizeOf, dur as landDur, timeLeft as landLeft } from "./landcore.js";
const ICON = {
  player: NAV.player, paper: "textures/items/paper", compass: "textures/items/compass_item", book: "textures/items/book_writable", barrier: "textures/ui/shop/ic_cancel",
  shield: NAV.shield, chest: NAV.chest, gold: "textures/items/gold_ingot", map: "textures/items/map_filled", bell: "textures/items/bell", item: NAV.page, ok: NAV.ok,
  prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", search: "textures/ui/shop/key_search", crown: "textures/items/gold_ingot",
  feather: "textures/items/feather", ice: "textures/blocks/ice", sign: "textures/items/sign", clock: "textures/items/clock_item", tnt: "textures/blocks/tnt_side",
};
const ROWS = 6;                                                     // short chest: rows 0-4 content, row 5 = button bar
let OPEN_PLAYER = null;                                             // set by opmenu.js: (id, name, back) => player page
export { perm };
export function initStaffMenu(o) { OPEN_PLAYER = o && o.openPlayer ? o.openPlayer : null; }
const openPlayer = (player, id, name, back) => { if (OPEN_PLAYER) OPEN_PLAYER(player, id, name, back); else back(); };

const say = (p, msg) => { try { p.sendMessage(oprMsg(p, msg)); } catch (e) { /* ignore */ } };
const online = (id) => world.getAllPlayers().find((x) => x.id === id);
const tgt = (id, name) => ({ id, name });
const guard = (p) => { if (isStaff(p)) return true; say(p, "§c[Operator] Operators only."); return false; };
const reply = (p, r, okMsg) => say(p, r && r.ok ? "§a[Operator] " + okMsg : "§c[Operator] " + ((r && r.err) || "That did not work."));
const badge = (n, zone) => hdr(Math.min(99, Math.max(1, n)), n ? zone : "c");
const leftOf = (u) => (u ? leftText(u) : "until lifted");
const pretty = (id) => String(id).replace("minecraft:", "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
/** a button that needs a role: shows a locked look (and the needed role) when the operator is below it; the action checks the role again anyway */
function perm(f, slot, player, need, text, icon, run, zone = "c", n = 1) {
  if (can(player, need)) set(f, slot, hdr(n, zone) + text, icon, run ? { run } : null);
  else set(f, slot, hdr(1, "r") + "§7§l" + text.replace(/§./g, "").split("\n")[0] + "\n§r" + lockText(need, player), ICON.barrier, { run: () => allow(player, need) });
}
function textDef(form, label, placeholder, def) {
  try { form.textField(label, placeholder, { defaultValue: String(def ?? "") }); } catch (e) { form.textField(label, placeholder, String(def ?? "")); }
}

// ---- list page (9 rows: 8 rows of buttons + the button bar) - same behaviour as the list pages of the Operator menu
function lister(player, title, items, page, back, self, extras = []) {
  const PER = 72, pages = Math.max(1, Math.ceil(items.length / PER)), pg = Math.min(Math.max(0, page), pages - 1);
  const f = make(title + " §8(" + items.length + ")", 9); f.self = () => self(pg);
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

// ================================================================ PUNISHMENTS hub
export function punishPage(player, back) {
  if (!guard(player)) return;
  const self = () => punishPage(player, back);
  const f = make("Punishments", ROWS); f.self = self;
  const nm = listMutes().length, nf = listFreezes().length, nw = warnedPlayers().length, nn = notedPlayers().length, ne = listEcon().length;
  set(f, 1 * COLS + 1, badge(nm, "r") + "§e§lMuted players\n§r§7Who can't chat right now\n§r§7Click one to manage", ICON.feather, { run: () => mutesPage(player, self) });
  set(f, 1 * COLS + 3, badge(nf, "r") + "§b§lFrozen players\n§r§7Who is frozen for an inspection\n§r§7Click one to manage", ICON.ice, { run: () => freezesPage(player, self) });
  set(f, 1 * COLS + 5, badge(nw, "r") + "§c§lWarnings\n§r§7Players with active warnings\n§r§7(" + C.warnLimit + " = suggest a temp ban)", "textures/ui/shop/ic_report", { run: () => warnedPage(player, self) });
  set(f, 1 * COLS + 7, badge(nn, "g") + "§d§lPlayer notes\n§r§7Private notes about players\n§r§7(only operators see them)", ICON.book, { run: () => notedPage(player, self) });
  set(f, 3 * COLS + 4, badge(ne, "r") + "§6§lFrozen money accounts\n§r§7No buying, selling or paying\n§r§7Click one to manage", "textures/ui/shop/x_chain", { run: () => ecoPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const punItem = (self, player, m, color, what) => () => ({
  zone: "r", icon: ICON.player,
  text: color + "§l" + m.n + "\n§r§7" + what + ": §f" + leftOf(m.u) + "\n§r§7Reason: §f" + m.r + "\n§r§7By: §f" + m.by + " §7(" + ago(m.t) + ")\n§r§eClick to manage",
  run: () => disciplinePage(player, m.id, m.n, self),
});
export function mutesPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => mutesPage(player, back, pg);
  lister(player, "Muted players", listMutes().map((m) => punItem(() => self(page), player, m, "§e", "Mute ends")), page, back, self);
}
export function freezesPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => freezesPage(player, back, pg);
  lister(player, "Frozen players", listFreezes().map((m) => punItem(() => self(page), player, m, "§b", "Freeze ends")), page, back, self);
}
export function ecoPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => ecoPage(player, back, pg);
  lister(player, "Frozen money accounts", listEcon().map((m) => punItem(() => self(page), player, m, "§6", "Account frozen")), page, back, self);
}
export function warnedPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => warnedPage(player, back, pg);
  lister(player, "Warnings", warnedPlayers().map((w) => () => ({
    n: w.count, zone: w.count >= C.warnLimit ? "r" : "g", icon: "textures/ui/shop/ic_report",
    text: "§c§l" + w.n + "\n§r§7Active warnings: §f" + w.count + "§7/§f" + C.warnLimit + (w.count >= C.warnLimit ? "\n§r§cLimit reached - consider a temp ban" : "") + "\n§r§eClick to see them",
    run: () => warnsOfPage(player, w.id, w.n, () => self(page)),
  })), page, back, self);
}
export function notedPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => notedPage(player, back, pg);
  lister(player, "Player notes", notedPlayers().map((w) => () => ({
    n: w.count, zone: "g", icon: ICON.book, text: "§d§l" + w.n + "\n§r§7Notes: §f" + w.count + "\n§r§eClick to read",
    run: () => notesOfPage(player, w.id, w.n, () => self(page)),
  })), page, back, self);
}

// ================================================================ DISCIPLINE page of one player
export function disciplinePage(player, id, name, back) {
  if (!guard(player)) return;
  const self = () => disciplinePage(player, id, name, back);
  const f = make("Discipline: " + name, ROWS); f.self = self;
  const t = online(id), isOp = !!(t && isStaff(t));
  const mu = muteOf(id), fr = freezeOf(id), ec = econOf(id), nw = warnsOf(id).length, nn = notesOf(id).length;
  set(f, 0 * COLS + 4, hdr(1, isOp ? "g" : mu || fr || ec ? "r" : "c") + "§6§l" + name + "\n§r" + (t ? "§aOnline" : "§7Offline") + (isOp ? " §d(operator: can't be punished)" : "")
    + "\n§r§7Muted: " + (mu ? "§c" + leftOf(mu.u) : "§anot muted") + "\n§r§7Frozen: " + (fr ? "§c" + leftOf(fr.u) : "§anot frozen") + "\n§r§7Money: " + (ec ? "§cfrozen (" + leftOf(ec.u) + ")" : "§aactive")
    + "\n§r§7Warnings: §f" + nw + "§7/§f" + C.warnLimit + "  §7Notes: §f" + nn, ICON.player, null);

  // row 1
  perm(f, 1 * COLS + 1, player, "mute", mu ? "§a§lUnmute\n§r§7He can chat again\n§r§eClick" : "§e§lMute\n§r§7He can't chat for a time\n§r§7(a reason is required)", "textures/ui/shop/ic_mute",
    () => (mu ? (reply(player, unmute(player, tgt(id, name)), name + " unmuted."), self()) : muteForm(player, id, name, self)), mu ? "g" : "c");
  perm(f, 1 * COLS + 3, player, "kick", t ? "§c§lKick\n§r§7Removes him from the server\n§r§7and shows him the reason" : "§7§lKick\n§r§7He is offline", "textures/ui/shop/x_exposed_copper_door",
    () => (t ? kickForm(player, id, name, self) : (say(player, "§c[Operator] He is offline."), self())), "r");
  perm(f, 1 * COLS + 5, player, "warn", "§e§lWarn\n§r§7Adds a warning (" + nw + "/" + C.warnLimit + ")\n§r§7At " + C.warnLimit + " the operators get an alert", "textures/ui/shop/ic_report",
    () => warnForm(player, id, name, self), nw >= C.warnLimit ? "r" : "c");
  set(f, 1 * COLS + 7, hdr(Math.min(99, Math.max(1, nw))) + "§6§lWarnings list\n§r§7" + nw + " active\n§r§eClick to see them", ICON.paper, { run: () => warnsOfPage(player, id, name, self) });
  // row 2
  perm(f, 2 * COLS + 1, player, "freeze", fr ? "§a§lUnfreeze\n§r§7He can move again\n§r§eClick" : t ? "§b§lFreeze\n§r§7He can't move, build or hit\n§r§7(for an inspection)" : "§7§lFreeze\n§r§7He is offline", ICON.ice,
    () => (fr ? (reply(player, unfreeze(player, tgt(id, name)), name + " unfrozen."), self()) : t ? freezeForm(player, id, name, self) : (say(player, "§c[Operator] He is offline."), self())), fr ? "g" : "c");
  perm(f, 2 * COLS + 3, player, "econ", ec ? "§a§lUnfreeze money\n§r§7He can trade and pay again\n§r§eClick" : "§6§lFreeze money\n§r§7No buying, selling or paying\n§r§7(for a suspected exploit)", "textures/ui/shop/x_chain",
    () => (ec ? (reply(player, econUnfreeze(player, tgt(id, name)), name + "'s money is active again."), self()) : econForm(player, id, name, self)), ec ? "g" : "c");
  perm(f, 2 * COLS + 5, player, "tphere", t ? "§d§lTP here\n§r§7Bring him to you\n§r§7(ask first, or teleport now)" : "§7§lTP here\n§r§7He is offline", "textures/items/ender_eye",
    () => (t ? tpHereForm(player, id, name, self) : (say(player, "§c[Operator] He is offline."), self())));
  set(f, 2 * COLS + 7, hdr(Math.min(99, Math.max(1, nn)), nn ? "g" : "c") + "§d§lNotes\n§r§7" + nn + " private note" + (nn === 1 ? "" : "s") + "\n§r§eClick to read / add", ICON.book, { run: () => notesOfPage(player, id, name, self) });
  // row 3
  perm(f, 3 * COLS + 4, player, "roles", "§d§lStaff role\n§r§7Now: " + (hasStaffRole(id) || isOp ? ROLE_COLOR[roleOfId(id)] + ROLE_NAME[roleOfId(id)] : "§7none") + "\n§r§7Helper / Mod / Admin\n§r§7(gives him the Operator menu)", "textures/ui/shop/ic_badge", () => roleForm(player, id, name, self));
  backBtn(f, back); status(player, f);
  open(player, f);
}
function muteForm(player, id, name, back) {
  if (!allow(player, "mute")) return back();
  const L = C.muteChoices, form = new OprForm().title("Mute " + name);
  dropdown(form, "§fHow long?", L.map((x) => x.label)); textField(form, "§fReason §7(required, shown to him)", "e.g. spam, insults");
  showModal(player, form, (v) => { if (!v) return back(); const len = L[Number(v[0])] ?? L[0]; reply(player, mute(player, tgt(id, name), len.ms, String(v[1] ?? "")), name + " muted."); back(); });
}
function kickForm(player, id, name, back) {
  if (!allow(player, "kick")) return back();
  const form = new OprForm().title("Kick " + name);
  textField(form, "§fReason §7(required, shown to him)", "e.g. AFK farm, griefing");
  showModal(player, form, (v) => { if (!v) return back(); reply(player, kickPlayer(player, tgt(id, name), String(v[0] ?? "")), name + " kicked."); back(); });
}
function warnForm(player, id, name, back) {
  if (!allow(player, "warn")) return back();
  const form = new OprForm().title("Warn " + name);
  textField(form, "§fReason §7(required, shown to him)", "e.g. spamming the shop");
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = warn(player, tgt(id, name), String(v[0] ?? ""));
    reply(player, r, name + " warned (" + (r.count ?? "?") + "/" + C.warnLimit + ")." + (r.ok && r.count >= r.limit ? " §eHe reached the limit: think about a temporary ban." : ""));
    back();
  });
}
function freezeForm(player, id, name, back) {
  if (!allow(player, "freeze")) return back();
  const L = C.freezeChoices, form = new OprForm().title("Freeze " + name);
  dropdown(form, "§fHow long?", L.map((x) => x.label)); textField(form, "§fReason §7(required)", "e.g. checking for fly hacks");
  showModal(player, form, (v) => { if (!v) return back(); const len = L[Number(v[0])] ?? L[0]; reply(player, freeze(player, tgt(id, name), len.ms, String(v[1] ?? "")), name + " frozen."); back(); });
}
function econForm(player, id, name, back) {
  if (!allow(player, "econ")) return back();
  const L = C.econChoices, form = new OprForm().title("Freeze the money of " + name);
  dropdown(form, "§fHow long?", L.map((x) => x.label)); textField(form, "§fReason §7(required)", "e.g. suspected duplication");
  showModal(player, form, (v) => { if (!v) return back(); const len = L[Number(v[0])] ?? L[0]; reply(player, econFreeze(player, tgt(id, name), len.ms, String(v[1] ?? "")), name + "'s money is frozen."); back(); });
}
function tpHereForm(player, id, name, back) {
  if (!allow(player, "tphere")) return back();
  const form = new OprForm().title("TP here: " + name);
  dropdown(form, "§fHow?", ["Ask first (he accepts or denies)", "Teleport him now"]);
  showModal(player, form, (v) => {
    if (!v) return back();
    const t = online(id);
    if (!t) { say(player, "§c[Operator] He is offline."); return back(); }
    if (Number(v[0]) === 0) { sendTphere(player, t); slog(player, "tphere", tgt(id, name), "request"); }
    else reply(player, tpHereForce(player, tgt(id, name)), name + " was teleported to you.");
    back();
  });
}
function roleForm(player, id, name, back) {
  if (!allow(player, "roles")) return back();
  if (isOwnerId(id)) { say(player, "§c[Operator] The Owner's role can't be changed."); return back(); }
  const t = online(id), saved = hasStaffRole(id), staff = saved || !!(t && isStaff(t)), cur = staff ? roleOfId(id) : null;
  const names = ROLES.map((r) => ROLE_NAME[r]); if (saved) names.push("Remove staff access");
  const form = new OprForm().title("Staff role: " + name);
  dropdown(form, "§fHelper: mute, kick, warn, TP here, notes, reports\nMod: + freeze, temp ban, logs, broadcast, locks...\nAdmin: everything (money, permanent ban, bypass...)\n\nA player with a role gets the Operator menu.\n\n§fNow: " + (cur ? ROLE_NAME[cur] : "no staff role"), names, cur ? ROLES.indexOf(cur) : 0);
  showModal(player, form, (v) => {
    if (!v) return back();
    const pick = Number(v[0]);
    if (pick >= ROLES.length) return confirm(player, "Remove staff access?", ["§f" + name, "§7He will not see the Operator menu any more"], () => { reply(player, removeStaff(player, tgt(id, name)), name + " is no longer staff."); back(); }, back);
    const role = ROLES[pick] ?? cur;
    if (staff && role === cur && saved) return back();
    confirm(player, staff ? "Change the role?" : "Give a staff role?", ["§f" + name, "§7" + (cur ? ROLE_NAME[cur] : "No role") + " §f> " + ROLE_COLOR[role] + ROLE_NAME[role]], () => { reply(player, setRole(player, tgt(id, name), role), name + " is now " + ROLE_NAME[role] + "."); back(); }, back);
  });
}

// ---- warnings / notes of one player
export function warnsOfPage(player, id, name, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => warnsOfPage(player, id, name, back, pg);
  const list = warnsOf(id).map((w, i) => ({ w, i })).reverse();
  const extras = can(player, "warn") ? [[6, hdr(1) + "§e§lWarn " + name + "\n§r§7Add a warning (a reason is required)", ICON.bell, () => warnForm(player, id, name, () => self(page))]] : [];
  lister(player, "Warnings: " + name, list.map(({ w, i }) => ({
    zone: "r", icon: "textures/ui/shop/ic_report", text: "§c§lWarning\n§r§7Reason: §f" + w.r + "\n§r§7By: §f" + w.by + " §7(" + ago(w.t) + ")" + (can(player, "unwarn") ? "\n§r§eClick to remove" : "\n§r§7(only an Admin can remove)"),
    run: () => { if (!allow(player, "unwarn")) return self(page); confirm(player, "Remove this warning?", ["§f" + name, "§7" + w.r], () => { reply(player, removeWarn(player, tgt(id, name), i), "Warning removed."); self(page); }, () => self(page)); },
  })), page, back, self, extras);
}
function noteForm(player, id, name, back) {
  if (!allow(player, "notes")) return back();
  const form = new OprForm().title("Note about " + name);
  textField(form, "§fNote §7(only operators see it)", "e.g. suspected of x-ray, trusted player");
  showModal(player, form, (v) => { if (!v) return back(); reply(player, addNote(player, tgt(id, name), String(v[0] ?? "")), "Note saved."); back(); });
}
export function notesOfPage(player, id, name, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => notesOfPage(player, id, name, back, pg);
  const list = notesOf(id).map((n, i) => ({ n, i })).reverse();
  const extras = can(player, "notes") ? [[6, hdr(1) + "§d§lAdd a note\n§r§7Only operators see it", ICON.book, () => noteForm(player, id, name, () => self(page))]] : [];
  lister(player, "Notes: " + name, list.map(({ n, i }) => ({
    zone: "g", icon: ICON.book, text: "§d§l" + n.x + "\n§r§7By: §f" + n.by + " §7(" + ago(n.t) + ")" + (can(player, "unwarn") || n.bi === player.id ? "\n§r§eClick to delete" : ""),
    run: () => { if (!(can(player, "unwarn") || n.bi === player.id)) { say(player, "§c[Operator] Only an Admin or the author can delete a note."); return self(page); } confirm(player, "Delete this note?", ["§7" + n.x], () => { reply(player, removeNote(player, tgt(id, name), i), "Note deleted."); self(page); }, () => self(page)); },
  })), page, back, self, extras);
}

// ================================================================ GIVE & FIX page of one player (admin tools)
export function givePage(player, id, name, back) {
  if (!guard(player)) return;
  const self = () => givePage(player, id, name, back);
  const f = make("Give & fix: " + name, ROWS); f.self = self;
  const t = online(id);
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + name + "\n§r" + (t ? "§aOnline" : "§7Offline") + "\n§r§7Everything here is saved in the staff log", ICON.player, null);
  perm(f, 1 * COLS + 1, player, "shards", "§d§lGive shards\n§r§7For compensation or rewards\n§r§7(works offline too)", "textures/ui/shop/hud_shards", () => shardsForm(player, id, name, self));
  perm(f, 1 * COLS + 3, player, "levels", t ? "§d§lGive Buyer levels\n§r§7Adds whole levels\n§r§7(no level rewards are paid)" : "§7§lGive Buyer levels\n§r§7He must be online", "textures/items/diamond", () => (t ? levelsForm(player, id, name, "b", self) : (say(player, "§c[Operator] He must be online."), self())));
  perm(f, 1 * COLS + 5, player, "levels", t ? "§d§lGive Seller levels\n§r§7Adds whole levels\n§r§7(no level rewards are paid)" : "§7§lGive Seller levels\n§r§7He must be online", "textures/items/emerald", () => (t ? levelsForm(player, id, name, "s", self) : (say(player, "§c[Operator] He must be online."), self())));
  perm(f, 1 * COLS + 7, player, "giveitem", t ? "§b§lGive an item\n§r§7Type the item id and the amount" : "§7§lGive an item\n§r§7He must be online", ICON.chest, () => (t ? itemForm(player, id, name, self) : (say(player, "§c[Operator] He must be online."), self())));
  const log = deathLog(id), ar = isAr(player);
  const dTxt = log.length
    ? (ar ? "§6§lسجل الموتات\n§r§7الموتات المحفوظة: §f" + log.length + "\n§r§7آخر موتة: §f" + ago(log[0].d.t) + "\n§r§7اختر أي موتة لرؤية أغراضها وتعويضه بها\n§r§eاضغط لفتح السجل"
        : "§6§lDeath log\n§r§7Saved deaths: §f" + log.length + "\n§r§7Last death: §f" + ago(log[0].d.t) + "\n§r§7Pick ANY death to see its items and restore it\n§r§eClick to open the log")
    : (ar ? "§7§lسجل الموتات\n§r§7لا توجد موتات محفوظة (تُحفظ " + C.deathKeepHours + " ساعة)" : "§7§lDeath log\n§r§7No saved death (kept " + C.deathKeepHours + "h)");
  perm(f, 3 * COLS + 4, player, "restore", dTxt, "textures/ui/shop/ic_recent", () => {
    if (!log.length) { say(player, "§c[Operator] No saved death for him."); return self(); }
    deathsPage(player, id, name, self);                                    // the whole log: pick a death, SEE what he had, then restore from there
  }, "r");
  backBtn(f, back); status(player, f);
  open(player, f);
}
// ================================================================ SAVED INVENTORY: what the player had when he died (view first, restore after)
const GEAR_COL = { Head: 0, Chest: 1, Legs: 2, Feet: 3, Offhand: 5 };
const GEAR_NAME = { Head: "Helmet", Chest: "Chestplate", Legs: "Leggings", Feet: "Boots", Offhand: "Off hand" };
const CAUSE_AR = { entityAttack: "هجوم مخلوق", projectile: "مقذوف", fall: "سقوط", lava: "لافا", fire: "حريق", fireTick: "حريق", drowning: "غرق", void: "الفراغ", suffocation: "اختناق", starvation: "جوع", contact: "ملامسة", entityExplosion: "انفجار", blockExplosion: "انفجار", magic: "سحر", lightning: "صاعقة", freezing: "تجمد", wither: "ويذر", anvil: "سندان", fallingBlock: "سقوط بلوك", flyIntoWall: "اصطدام", suicide: "انتحار", override: "أمر" };
const causeOf = (d, ar) => (ar && CAUSE_AR[d.c]) || String(d.c ?? "?").replace(/([A-Z])/g, " $1").toLowerCase().trim();
const dimShort = (id) => (String(id).includes("nether") ? "Nether" : String(id).includes("end") ? "End" : "Overworld");
const dimShortAr = (id) => (String(id).includes("nether") ? "النذر" : String(id).includes("end") ? "الإند" : "العالم العادي");
// ================================================================ DEATH LOG of one player: every saved death (newest first). Click one = see its items, then restore it.
function deathsPage(player, id, name, back, page = 0) {
  if (!allow(player, "restore")) return back();
  const self = (pg = 0) => deathsPage(player, id, name, back, pg);
  const ar = isAr(player), t = online(id);
  const rows = deathLog(id).map(({ key, d }, i) => {
    const place = d.x + " " + d.y + " " + d.z;
    return {
      zone: d.used ? "r" : "g", icon: "textures/ui/shop/ic_recent", n: Math.min(99, Math.max(1, d.items.length)),
      text: ar
        ? "§6§l#" + (i + 1) + " §r§f" + ago(d.t) + "\n§r§7السبب: §f" + causeOf(d, true) + (d.k ? " §7(بواسطة " + d.k + ")" : "") + "\n§r§7المكان: §f" + place + " §7(" + dimShortAr(d.d) + ")\n§r§7الأغراض: §f" + d.items.length + (d.skipped.length ? " §7(لم تُنسخ: §e" + d.skipped.length + "§7)" : "") + "\n§r" + (d.used ? "§cتم التعويض بها" : t ? "§eاضغط لرؤية الأغراض" : "§eاضغط للعرض (يجب أن يكون متصلاً للتعويض)")
        : "§6§l#" + (i + 1) + " §r§f" + ago(d.t) + "\n§r§7Cause: §f" + causeOf(d, false) + (d.k ? " §7(by " + d.k + ")" : "") + "\n§r§7Place: §f" + place + " §7(" + dimShort(d.d) + ")\n§r§7Stacks: §f" + d.items.length + (d.skipped.length ? " §7(not copied: §e" + d.skipped.length + "§7)" : "") + "\n§r" + (d.used ? "§cAlready restored" : t ? "§eClick to see the items" : "§eClick to view (he must be online to restore)"),
      run: () => savedInvPage(player, id, name, () => self(page), key),
    };
  });
  lister(player, (ar ? "سجل الموتات: " : "Death log: ") + name, rows, page, back, self);
}
function savedInvPage(player, id, name, back, key) {
  if (!allow(player, "restore")) return back();
  const self = () => savedInvPage(player, id, name, back, key);
  const pv = deathPreview(id, key);
  if (!pv) { say(player, "§c[Operator] No saved death for him."); return back(); }
  const d = pv.d, t = online(id);
  const f = make("Saved inventory: " + name, ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + name + "\n§r§7Died: §f" + ago(d.t) + " §7(" + String(d.c ?? "?").replace(/([A-Z])/g, " $1").toLowerCase().trim() + (d.k ? ", by " + d.k : "") + ")\n§r§7Stacks: §f" + pv.rows.length + " §7| Enchanted: §d" + pv.enchanted
    + "\n§r§7Sell value: §a" + money(pv.sellTotal) + "\n§r§7Shop value: §f" + money(pv.shopTotal) + "\n§r§8Green frame = enchanted item", ICON.player, null);
  for (const r of pv.rows) {
    const gear = r.w in GEAR_COL, m = /^i(\d+)$/.exec(r.w);
    let slot = -1;
    if (gear) slot = GEAR_COL[r.w]; else if (m) { const n = Number(m[1]); slot = n < 9 ? 4 * COLS + n : n < 36 ? (1 + Math.floor((n - 9) / 9)) * COLS + ((n - 9) % 9) : -1; }
    if (slot < 0) continue;
    const low = r.pct !== null && r.pct < 25;
    f.buttons[slot] = [hdr(r.n, r.ench.length ? "g" : low ? "r" : "c") + "§b§l" + r.name + (gear ? " §7(" + GEAR_NAME[r.w] + ")" : "") + (r.n > 1 ? " §r§7x" + r.n : "")
      + (r.nm ? "\n§r§7Named: §f" + r.nm : "")
      + (r.ench.length ? "\n§r§d" + r.ench.join("§7, §d") : "")
      + (r.pct !== null ? "\n§r§7Durability: " + (low ? "§c" : "§a") + r.pct + "%" : "")
      + (r.unit > 0 ? "\n§r§7Sell: §a" + money(r.unit) + (r.n > 1 ? " §7each = §a" + money(r.unit * r.n) : "") : "\n§r§8Cannot be sold")
      + (r.buy > 0 ? "\n§r§7Shop price: §f" + money(r.buy) : ""), r.icon ?? "textures/ui/shop/ic_bag"];
    f.entries[slot] = null;
  }
  if (d.skipped.length) set(f, 0 * COLS + 8, hdr(Math.min(99, d.skipped.length), "r") + "§e§lNot shown / not copied\n§r§7Contents or special data:\n§r§f" + d.skipped.slice(0, 5).join("§7, §f") + (d.skipped.length > 5 ? "§7, ..." : "") + "\n§r§cThese will NOT be restored", ICON.barrier, null);
  set(f, 5 * COLS + 4, hdr(1, d.used || !t ? "r" : "g") + (d.used ? "§c§lAlready restored" : t ? "§a§lRestore now\n§r§7Give all of this back to him\n§r§eClick" : "§c§lHe must be online\n§r§7You can only view it for now"), NAV.ok, { run: () => {
    if (d.used || !t) { say(player, d.used ? "§c[Operator] This death was already restored." : "§c[Operator] He must be online."); return self(); }
    confirm(player, "Restore this inventory?", ["§f" + name + " §7died " + ago(d.t), "§7" + d.items.length + " stacks will be given.", "§cIf he already picked his items up", "§cagain, this DUPLICATES them.", "§7Can be done only once per death."], () => {
      const r = restoreDeath(player, tgt(id, name), key);
      reply(player, r, "Restored " + (r.given ?? 0) + " stacks" + (r.failed ? " (" + r.failed + " failed)" : "") + (r.skipped ? ", " + r.skipped + " not copied" : "") + ".");
      back();
    }, self);
  } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function shardsForm(player, id, name, back) {
  if (!allow(player, "shards")) return back();
  const form = new OprForm().title("Give shards to " + name);
  textField(form, "§fHow many shards?", "e.g. 500"); textField(form, "§fNote §7(optional, goes to the staff log)", "e.g. lost items to a bug");
  showModal(player, form, (v) => { if (!v) return back(); reply(player, giveShards(player, tgt(id, name), String(v[0] ?? "").replace(/[,\s]/g, ""), String(v[1] ?? "")), "Shards given to " + name + "."); back(); });
}
function levelsForm(player, id, name, track, back) {
  if (!allow(player, "levels")) return back();
  const form = new OprForm().title("Give " + (track === "b" ? "Buyer" : "Seller") + " levels to " + name);
  textField(form, "§fHow many levels? (1-100)", "e.g. 2"); textField(form, "§fNote §7(optional)", "e.g. compensation");
  showModal(player, form, (v) => { if (!v) return back(); const r = giveLevels(player, tgt(id, name), track, String(v[0] ?? "").replace(/[,\s]/g, ""), String(v[1] ?? "")); reply(player, r, "Levels given: " + (r.before ?? "?") + " > " + (r.after ?? "?") + "."); back(); });
}
function itemForm(player, id, name, back) {
  if (!allow(player, "giveitem")) return back();
  const form = new OprForm().title("Give an item to " + name);
  textField(form, "§fItem id", "e.g. diamond_sword"); textField(form, "§fAmount (1-2304)", "1"); textField(form, "§fNote §7(optional)", "e.g. compensation");
  showModal(player, form, (v) => { if (!v) return back(); reply(player, giveItem(player, tgt(id, name), String(v[0] ?? ""), String(v[1] ?? "") || "1", String(v[2] ?? "")), "Item given to " + name + "."); back(); });
}

// ================================================================ INSPECTOR (read only, one page with everything about a player)
export function inspectPage(player, id, name, back) {
  if (!allow(player, "inspect")) return back();
  const self = () => inspectPage(player, id, name, back);
  const f = make("Inspector: " + name, ROWS); f.self = self;
  const t = online(id), r = recordOf(id), pos = positionOf(id), bans = banOfId(id);
  const mu = muteOf(id), fr = freezeOf(id), ec = econOf(id), nw = warnsOf(id).length, notes = notesOf(id), logs = entriesOfPlayer(id);
  const sus = logs.filter((e) => e.c === "sus").length;
  set(f, 0 * COLS + 4, hdr(1, t ? "g" : "c") + "§6§l" + name + "\n§r" + (t ? "§aOnline" : "§7Offline" + (pos ? " - last seen " + ago(pos.t) : "")) + (t && isStaff(t) ? "\n§r§dOperator (" + ROLE_NAME[roleOf(t)] + ")" : ""), ICON.player, null);
  set(f, 1 * COLS + 1, hdr(1, pos ? "g" : "c") + "§b§lPosition\n§r" + (pos ? "§f" + pos.x + ", " + pos.y + ", " + pos.z + "\n§r§7" + dimLabel(pos.d) + (pos.online ? " §a(now)" : " §7(last known)") + "\n§r§eClick to go there" : "§7Unknown (he never left since the tools were installed)"), ICON.compass, pos ? {
    run: () => {
      if (!allow(player, "goto")) return self();
      const q = positionOf(id); if (!q) return self();
      try { player.teleport({ x: q.x + 0.5, y: q.y, z: q.z + 0.5 }, { dimension: world.getDimension(q.d) }); say(player, "§a[Operator] Teleported to the " + (q.online ? "player" : "last known position of " + name) + "."); slog(player, "goto", tgt(id, name), q.online ? "" : "last position"); }
      catch (e) { say(player, "§c[Operator] The teleport failed (the area may not be loaded)."); }
      self();
    } } : null);
  set(f, 1 * COLS + 3, hdr(1) + "§a§lAccount\n§r§7Money: §a" + money(r ? r.money : 0) + "\n§r§7Shards: §d" + num(r ? r.shards : 0) + "\n§r§7Buyer Lv §f" + (r ? progress(r.bxp).level : 0) + " §7| Seller Lv §f" + (r ? progress(r.sxp).level : 0)
    + "\n§r§7Kills / deaths: §f" + (r ? (r.kills ?? 0) + "§7/§f" + (r.deaths ?? 0) : "0/0") + "\n§r§7Played: §f" + playtime(t ? playSeconds(t) : (r ? r.play ?? 0 : 0)), "textures/ui/shop/hud_money", null);
  set(f, 1 * COLS + 5, hdr(1, bans ? "r" : "g") + "§c§lBan\n§r§7Staff ban: " + (bans ? "§c" + leftOf(bans.u) : "§anone"), "textures/ui/shop/ic_gavel", null);
  set(f, 1 * COLS + 7, hdr(1, mu || fr || ec || nw ? "r" : "g") + "§e§lPunishments\n§r§7Muted: " + (mu ? "§c" + leftOf(mu.u) : "§ano") + "\n§r§7Frozen: " + (fr ? "§c" + leftOf(fr.u) : "§ano") + "\n§r§7Money frozen: " + (ec ? "§c" + leftOf(ec.u) : "§ano") + "\n§r§7Warnings: §f" + nw + "§7/§f" + C.warnLimit + "\n§r§eClick for the discipline page", "textures/items/iron_sword", { run: () => disciplinePage(player, id, name, self) });
  set(f, 2 * COLS + 1, hdr(Math.min(99, Math.max(1, notes.length)), notes.length ? "g" : "c") + "§d§lNotes\n§r" + (notes.length ? notes.slice(-3).reverse().map((n) => "§7- §f" + n.x).join("\n§r") : "§7No notes") + "\n§r§eClick to read / add", ICON.book, { run: () => notesOfPage(player, id, name, self) });
  set(f, 2 * COLS + 3, hdr(Math.min(99, Math.max(1, sus)), sus ? "r" : "c") + "§d§lShop logs\n§r§7Entries: §f" + logs.length + "\n§r§7Suspicious: " + (sus ? "§c" + sus : "§a0"), "textures/ui/shop/ic_bag", null);
  set(f, 2 * COLS + 5, hdr(1) + "§6§lOpen the player page\n§r§7Money, homes, lands, inventory, ban", ICON.player, { run: () => openPlayer(player, id, name, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ REPORTS
export function reportsPage(player, back, page = 0) {
  if (!allow(player, "reports")) return back();
  const self = (pg = 0) => reportsPage(player, back, pg);
  lister(player, "Reports", listReports().map((rp) => () => ({
    zone: "r", icon: "textures/ui/shop/ic_report", text: "§d§l" + rp.tn + "\n§r§7Reported by: §f" + rp.rn + " §7(" + ago(rp.t) + ")\n§r§7Reason: §f" + rp.r + "\n§r§eClick to open",
    run: () => reportPage(player, rp, () => self(page)),
  })), page, back, self);
}
function reportPage(player, rp, back) {
  if (!guard(player)) return;
  const self = () => reportPage(player, rp, back);
  const f = make("Report #" + rp.i, ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, "r") + "§d§lReport on " + rp.tn + "\n§r§7Reported by: §f" + rp.rn + "\n§r§7Reason: §f" + rp.r + "\n§r§7" + ago(rp.t), "textures/ui/shop/ic_report", null);
  set(f, 1 * COLS + 2, hdr(1) + "§6§lReported player\n§r§7" + rp.tn + (online(rp.ti) ? " §a(online)" : " §7(offline)") + "\n§r§eInspect him", ICON.player, { run: () => inspectPage(player, rp.ti, rp.tn, self) });
  set(f, 1 * COLS + 4, hdr(1) + "§e§lDiscipline\n§r§7Warn, mute, kick, freeze ...", "textures/items/iron_sword", { run: () => disciplinePage(player, rp.ti, rp.tn, self) });
  set(f, 1 * COLS + 6, hdr(1) + "§b§lThe reporter\n§r§7" + rp.rn + "\n§r§eInspect him", ICON.player, { run: () => inspectPage(player, rp.ri, rp.rn, self) });
  perm(f, 3 * COLS + 4, player, "handle", "§a§lClose the report\n§r§7It was handled\n§r§7(removed from the list)", ICON.ok, () => confirm(player, "Close this report?", ["§f" + rp.tn + " §7- " + rp.r], () => { reply(player, closeReport(player, rp.i), "Report closed."); back(); }, self), "g");
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ STAFF ACTION LOG
export function staffLogPage(player, back, group = "all", archived = false, page = 0) {
  if (!allow(player, "stafflog")) return back();
  const self = (pg = 0) => staffLogPage(player, back, group, archived, pg);
  const gi = Math.max(0, ACT_GROUPS.findIndex((g) => g[0] === group)), nextG = ACT_GROUPS[(gi + 1) % ACT_GROUPS.length][0], cn = logCounts();
  const ICONS = { pun: ICON.bell, money: ICON.gold, access: ICON.compass, sys: ICON.crown };
  const items = logEntries(group, archived).map((e) => ({
    zone: "c", icon: ICONS[ACTS[e.a]?.[2]] ?? ICON.paper,
    text: logText(e) + "\n§r§8" + ago(e.t) + " - " + new Date(e.t).toISOString().slice(0, 16).replace("T", " ") + " UTC",
    run: e.pi ? () => openPlayer(player, e.pi, e.p, () => self(page)) : null,
  }));
  lister(player, (archived ? "Staff log (archive)" : "Staff log"), items, page, back, (pg = 0) => self(pg), [
    [2, hdr(1) + "§e§lFilter: §f" + ACT_GROUPS[gi][1] + "\n§r§7Click to change", ICON.search, () => staffLogPage(player, back, nextG, archived, 0)],
    [6, hdr(1) + (archived ? "§a§lShow the recent log" : "§6§lShow the archive") + "\n§r§7Recent: §f" + cn.log + "§7/§f" + cn.cap + " §7Archive: §f" + cn.archive + "\n§r§7Older entries move to the archive\n§r§7automatically (nothing is lost)", ICON.clock, () => staffLogPage(player, back, group, !archived, 0)],
  ]);
}

// ================================================================ /report (for every player)
export function reportCommand(p, targets, reason) {
  try {
    const list = Array.isArray(targets) ? targets.filter((x) => x && x.typeId === "minecraft:player" && x.id !== p.id) : [];
    const send = (t, why) => { const r = addReport(p, { id: t.id, name: t.name }, why); say(p, r.ok ? "§a[Report] Sent to the staff. Thank you." : "§c[Report] " + (r.err ?? "It could not be sent.")); };
    if (list.length === 1 && reason && String(reason).trim()) return send(list[0], reason);
    const pool = (list.length ? list : world.getAllPlayers().filter((x) => x.id !== p.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (!pool.length) return say(p, "§c[Report] There is nobody to report. §7Use: §f/report <player> <reason>");
    const form = new OprForm().title("Report a player");
    dropdown(form, "§fWho do you want to report?", pool.map((x) => x.name)); textField(form, "§fWhat happened? §7(short reason)", "e.g. cheating, griefing, insults");
    showModal(p, form, (v) => { if (!v) return; const t = pool[Number(v[0])]; if (t) send(t, String(v[1] ?? (reason ?? ""))); });
  } catch (e) { console.warn("[report] " + e); }
}

// ================================================================ BROADCAST
export function broadcastForm(player, back) {
  if (!allow(player, "broadcast")) return back();
  const form = new OprForm().title("Broadcast to everyone");
  textField(form, "§fBig title §7(optional)", "e.g. Restart in 5 minutes"); textField(form, "§fMessage §7(chat, required)", "e.g. The server restarts at 20:00");
  const tl = "§fTime on screen §7(seconds, " + BROADCAST_SECONDS.min + "-" + BROADCAST_SECONDS.max + ")";
  try { form.textField(tl, "whole number, e.g. 10", { defaultValue: String(BROADCAST_SECONDS.def) }); } catch (e) { form.textField(tl, "whole number, e.g. 10", String(BROADCAST_SECONDS.def)); }
  showModal(player, form, (v) => { if (!v) return back(); reply(player, broadcast(player, String(v[0] ?? ""), String(v[1] ?? ""), String(v[2] ?? "")), "Broadcast sent."); back(); });
}

// ================================================================ VANISH
export function vanishToggle(player, back) {
  const r = toggleVanish(player);
  say(player, r.ok ? (r.on ? "§a[Operator] Vanish ON §7- nobody can see you, hit you or notice your effects. It ends when you leave the game." : "§6[Operator] Vanish OFF - you are visible again.") : "§c[Operator] " + r.err);
  back();
}
/** the Vanish page: one switch + what it covers */
export function vanishPage(player, back) {
  if (!allow(player, "vanish")) return back();
  const self = () => vanishPage(player, back);
  const f = make("Vanish", ROWS); f.self = self;
  const on = isVanished(player), z = on ? "g" : "c", tick = on ? "§a✔ " : "§7✘ ";
  set(f, 1 * COLS + 4, hdr(1, on ? "g" : "r") + "§7§lVanish: " + (on ? "§aON" : "§cOFF") + "\n§r§7Click to switch " + (on ? "§coff" : "§aon") + "\n§r§7It ends by itself when you leave the game", ICON.player, { run: () => vanishToggle(player, self) });
  set(f, 3 * COLS + 1, hdr(1, z) + tick + "§f§lInvisible\n§r§7Players can't see you\n§r§8(armor or a held item may still show)", ICON.feather, null);
  set(f, 3 * COLS + 3, hdr(1, z) + tick + "§f§lCan't be hit\n§r§7Players and mobs can't hurt you\n§r§7or push you with a hit", ICON.shield, null);
  set(f, 3 * COLS + 5, hdr(1, z) + tick + "§f§lNo effects\n§r§7No particles, trail or world sounds\n§r§7around you (clear lag, shop, teleport)", ICON.bell, null);
  set(f, 3 * COLS + 7, hdr(1, z) + tick + "§f§lHidden from lists\n§r§7Not in the /tpa and pay lists\n§r§8(the tab list can't be hidden)", ICON.book, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ TELEPORT category: bring one player / bring everybody  (go to a player is in opmenu.js)
export function bringPage(player, back, page = 0) {
  if (!allow(player, "tphere")) return back();
  const self = (pg = 0) => bringPage(player, back, pg);
  const list = world.getAllPlayers().filter((x) => x.id !== player.id && !isStaff(x)).sort((a, b) => a.name.localeCompare(b.name));
  lister(player, "Bring a player", list.map((t) => ({
    zone: "c", icon: ICON.player, text: "§d§l" + t.name + "\n§r§7Online\n§r§eClick: ask him first or teleport him now",
    run: () => tpHereForm(player, t.id, t.name, () => self(page)),
  })), page, back, self);
}
export function bringAllForm(player, back) {
  if (!allow(player, "tpall")) return back();
  const targets = world.getAllPlayers().filter((x) => x.id !== player.id && !isStaff(x));
  if (!targets.length) { say(player, "§c[Operator] There are no other players online."); return back(); }
  const form = new OprForm().title("Bring all players");
  dropdown(form, "§f" + targets.length + " player" + (targets.length === 1 ? " is" : "s are") + " online. How?", ["Ask first (each one accepts or denies)", "Teleport everyone now"]);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (Number(v[0]) === 0) {
      let n = 0; for (const t of targets) { try { sendTphere(player, t); n++; } catch (e) { /* ignore */ } }
      slog(player, "tphere", null, "all players: request to " + n);
      return back();
    }
    confirm(player, "Teleport EVERYONE to you?", ["§f" + targets.length + " player" + (targets.length === 1 ? "" : "s") + " will be moved to your position.", "§7Operators and players in a duel round are skipped."],
      () => { const r = tpAllForce(player); reply(player, r, "Teleported " + (r.moved ?? 0) + " player" + (r.moved === 1 ? "" : "s") + (r.skipped ? " (" + r.skipped + " skipped)" : "") + "."); back(); }, back);
  });
}

// ================================================================ AREA LOCKS
export function locksPage(player, back, page = 0) {
  if (!allow(player, "lock")) return back();
  const self = (pg = 0) => locksPage(player, back, pg);
  lister(player, "Area locks", listLocks().map((z) => ({
    zone: "r", icon: ICON.barrier, text: "§c§l" + dimLabel(z.d) + " " + Math.floor((z.x1 + z.x2) / 2) + ", " + Math.floor((z.z1 + z.z2) / 2) + "\n§r§7Size: §f" + (z.x2 - z.x1 + 1) + "x" + (z.z2 - z.z1 + 1) + "\n§r§7Ends: §f" + leftOf(z.u) + "\n§r§7Reason: §f" + z.r + "\n§r§7By: §f" + z.by + "\n§r§eClick to unlock",
    run: () => confirm(player, "Unlock this area?", ["§7" + z.r], () => { reply(player, removeLock(player, z.i), "Area unlocked."); self(page); }, () => self(page)),
  })), page, back, self, [[6, hdr(1) + "§c§lLock the area around me\n§r§7Normal players can't enter it.\n§r§7Operators are never blocked.", ICON.barrier, () => lockForm(player, () => self(page))]]);
}
function lockForm(player, back) {
  if (!allow(player, "lock")) return back();
  const R = C.lockRadii, L = C.lockChoices, form = new OprForm().title("Lock the area around you");
  dropdown(form, "§fSize (a square around you)", R.map((r) => r * 2 + " x " + r * 2 + " blocks")); dropdown(form, "§fHow long?", L.map((x) => x.label)); textField(form, "§fReason §7(required, shown to players)", "e.g. event preparation");
  showModal(player, form, (v) => { if (!v) return back(); const r = R[Number(v[0])] ?? R[0], len = L[Number(v[1])] ?? L[0]; reply(player, addLock(player, r, len.ms, String(v[2] ?? "")), "Area locked."); back(); });
}

// ================================================================ PERFORMANCE
export function perfPage(player, back) {
  if (!allow(player, "perf")) return back();
  const self = () => perfPage(player, back);
  const f = make("Performance", ROWS); f.self = self;
  const r = perfReport();
  set(f, 0 * COLS + 4, hdr(1) + "§6§lServer load\n§r§7Players online: §f" + r.players + (r.sampled ? "\n§r§eVery many entities: only the first 6000\n§r§eof each dimension were counted" : "") + "\n§r§7Click Refresh to measure again", ICON.clock, null);
  const dl = r.dims.length ? r.dims : [];
  dl.slice(0, 3).forEach((d, i) => set(f, 1 * COLS + [1, 4, 7][i], hdr(1, d.total > 800 ? "r" : d.total > 400 ? "g" : "c") + "§b§l" + pretty(d.id) + "\n§r§7Entities: §f" + d.total + "\n§r§7Dropped items: §f" + d.items + "\n§r§7Mobs / other: §f" + d.mobs, ICON.map, null));
  set(f, 2 * COLS + 2, hdr(1) + "§e§lMost common entities\n§r" + (r.top.length ? r.top.map((x) => "§7" + pretty(x.t) + ": §f" + x.c).join("\n§r") : "§7-"), ICON.paper, null);
  set(f, 2 * COLS + 6, hdr(1, r.hot.length && r.hot[0].c >= 40 ? "r" : "c") + "§c§lCrowded spots\n§r" + (r.hot.length ? r.hot.map((h) => "§7" + pretty(h.d) + " " + h.x + ", " + h.z + ": §f" + h.c).join("\n§r") : "§7-") + "\n§r§7Many mobs or items in one chunk\n§r§7slow the server down", ICON.compass, null);
  perm(f, 3 * COLS + 4, player, "clearlag", "§a§lClear dropped items now\n§r§7Runs Clear Lag once\n§r§7(the normal timer restarts)", ICON.tnt, () => confirm(player, "Clear all dropped items now?", clearMobsOn() ? ["§7Every item lying on the ground", "§7and every mob without a name tag", "§7will disappear."] : ["§7Every item lying on the ground", "§7will disappear."], () => { const x = runClearLag(player); reply(player, x, x.mobs ? "Cleared " + (x.n ?? 0) + " dropped items and " + (x.m ?? 0) + " mobs." : "Cleared " + (x.n ?? 0) + " dropped items."); self(); }, self), "g");
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ SHOP CONTROL (prices + availability)
export function shopPage(player, back, page = 0) {
  if (!allow(player, "shop")) return back();
  const self = (pg = 0) => shopPage(player, back, pg);
  const cats = shopCategories();
  lister(player, "Shop control", cats.map((c) => {
    const changed = c.items.filter((id) => { const i = shopInfo(id); return i && (i.changed || i.blocked); }).length;
    return { n: changed, zone: changed ? "g" : "c", icon: c.icon, text: "§6§l" + c.name + "\n§r§7Items: §f" + c.items.length + (changed ? "\n§r§eChanged or off: §f" + changed : "") + "\n§r§eClick to open", run: () => shopListPage(player, c.name, c.items, () => self(page)) };
  }), page, back, self, [
    [6, hdr(1) + "§e§lSearch an item\n§r§7Type a part of the name", ICON.search, () => {
      const form = new OprForm().title("Search the shop"); textField(form, "§fPart of the item name or id", "e.g. diamond");
      showModal(player, form, (v) => {
        const q = String((v && v[0]) ?? "").trim().toLowerCase();
        if (!q) return self(page);
        const ids = shopItems().filter((x) => x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q)).map((x) => x.id);
        shopListPage(player, "Search: " + q, ids, () => self(page));
      });
    }],
    [2, hdr(Math.min(99, Math.max(1, shopChangedCount())), shopChangedCount() ? "g" : "c") + "§6§lChanged / switched off\n§r§7Everything that is different\n§r§7from the original shop", ICON.paper, () => shopListPage(player, "Changed items", shopItems().map((x) => x.id).filter((id) => { const i = shopInfo(id); return i && (i.changed || i.blocked); }), () => self(page))],
  ]);
}
function shopListPage(player, title, ids, back, page = 0) {
  if (!allow(player, "shop")) return back();
  const self = (pg = 0) => shopListPage(player, title, ids, back, pg);
  lister(player, title, ids.slice(0, 600).map((id) => () => {
    const i = shopInfo(id);
    return { zone: i.blocked ? "r" : i.changed ? "g" : "c", icon: i.icon, text: "§f§l" + i.name + "\n§r§7Buy: §a" + money(i.buy) + (i.buy !== i.origBuy ? " §8(was " + money(i.origBuy) + ")" : "") + "\n§r§7Sell: §e" + money(i.sell) + (i.sell !== i.origSell ? " §8(was " + money(i.origSell) + ")" : "") + (i.blocked ? "\n§r§cSwitched OFF" : "") + "\n§r§eClick to edit", run: () => shopItemPage(player, id, () => self(page)) };
  }), page, back, self);
}
function shopItemPage(player, id, back) {
  if (!allow(player, "shop")) return back();
  const self = () => shopItemPage(player, id, back);
  const i = shopInfo(id); if (!i) return back();
  const f = make("Shop: " + i.name, ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, i.blocked ? "r" : i.changed ? "g" : "c") + "§6§l" + i.name + "\n§r§7Buy: §a" + money(i.buy) + " §8(original " + money(i.origBuy) + ")\n§r§7Sell: §e" + money(i.sell) + " §8(original " + money(i.origSell) + ")\n§r§7Status: " + (i.blocked ? "§cSwitched OFF (no buying or selling)" : "§aOn sale"), i.icon, null);
  set(f, 2 * COLS + 1, hdr(1) + "§a§lChange the price\n§r§7The sell price can be at most " + Math.round(C.shopSellRatio * 100) + "%\n§r§7of the buy price", "textures/ui/shop/hud_money", { run: () => priceForm(player, id, self) });
  if (i.changed) set(f, 2 * COLS + 4, hdr(1) + "§e§lReset the price\n§r§7Back to " + money(i.origBuy) + " / " + money(i.origSell), ICON.paper, { run: () => { reply(player, resetShopPrice(player, id), "Price reset."); self(); } });
  set(f, 2 * COLS + 7, hdr(1, i.blocked ? "g" : "r") + (i.blocked ? "§a§lSwitch ON\n§r§7Players can buy and sell it again" : "§c§lSwitch OFF\n§r§7Nobody can buy or sell it\n§r§7until you switch it on"), i.blocked ? ICON.ok : ICON.barrier,
    { run: () => confirm(player, i.blocked ? "Switch it on?" : "Switch it off?", ["§f" + i.name], () => { reply(player, setShopBlocked(player, id, !i.blocked), i.name + (i.blocked ? " is on sale again." : " is switched off.")); self(); }, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function priceForm(player, id, back) {
  if (!allow(player, "shop")) return back();
  const i = shopInfo(id); if (!i) return back();
  const form = new OprForm().title("Price: " + i.name);
  textDef(form, "§fBuy price", "whole number", i.buy); textDef(form, "§fSell price §7(max " + Math.round(C.shopSellRatio * 100) + "% of the buy price)", "whole number", i.sell);
  showModal(player, form, (v) => { if (!v) return back(); reply(player, setShopPrice(player, id, String(v[0] ?? "").replace(/[,\s$]/g, ""), String(v[1] ?? "").replace(/[,\s$]/g, "")), "Price changed."); back(); });
}

// ================================================================ STAFF ROLES
export function rolesPage(player, back, page = 0) {
  if (!guard(player)) return;
  const self = (pg = 0) => rolesPage(player, back, pg);
  const m = new Map();
  for (const p of world.getAllPlayers()) if (isStaff(p)) m.set(p.id, { id: p.id, name: p.name, on: true });
  for (const r of listRoles()) if (!m.has(r.id)) m.set(r.id, { id: r.id, name: r.n, on: !!online(r.id) });
  lister(player, "Staff roles", [...m.values()].map((s) => {
    const role = roleOfId(s.id);
    return { zone: role === "admin" ? "c" : "g", icon: ({ helper: "textures/ui/shop/ic_badge", mod: "textures/ui/shop/ic_gavel", admin: "textures/ui/shop/ic_gear" })[role] ?? "textures/ui/shop/ic_crown", text: "§f§l" + s.name + "\n§r§7Role: " + ROLE_COLOR[role] + ROLE_NAME[role] + "\n§r" + (s.on ? "§aOnline" : "§7Offline") + (can(player, "roles") ? "\n§r§eClick to change" : ""), run: () => (can(player, "roles") ? roleForm(player, s.id, s.name, () => self(page)) : (allow(player, "roles"), self(page))) };
  }), page, back, self);
}


// ================================================================ OWNER PANEL (only the Owner): what every role may do + hand over the Owner
export function ownerPage(player, back) {
  if (!isOwner(player)) { say(player, "§c[Operator] Only the Owner can open this."); return back(); }
  const self = () => ownerPage(player, back);
  const f = make("Owner panel", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§5§lOwner panel\n§r§7You are the Owner: nobody can punish you\n§r§7or change your role.\n§r§7Here you decide what Helper, Mod and Admin\n§r§7may do in the Operator menu.", ICON.crown, null);
  set(f, 1 * COLS + 2, hdr(1) + "§d§lRole permissions\n§r§7Allow or block every action\n§r§7for Helper, Mod and Admin\n§r§eClick to open", "textures/ui/shop/ic_badge", { run: () => permRolesPage(player, self) });
  set(f, 1 * COLS + 6, hdr(1, "r") + "§c§lTransfer ownership\n§r§7Give the Owner to another player\n§r§7(you become a normal Admin)", "textures/ui/shop/ic_crown", { run: () => transferPage(player, self) });
  set(f, 3 * COLS + 4, hdr(1, "g") + "§6§lSupreme lock\n§r§7Lock the AFK area and the lands:\n§r§7nobody can break or remove them,\n§r§7not even Admins. Only YOU can.\n§r§eClick to open", ICON.shield, { run: () => lockPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
// ================================================================ SUPREME LOCK (Owner only)
// A locked protection (a land, ALL lands, or the AFK area) can't be broken, bypassed, changed or deleted by anybody except the Owner - Admins and the "landadmin" bypass included.
export function lockPage(player, back) {
  if (!isOwner(player)) { say(player, "§c[Operator] Only the Owner can open this."); return back(); }
  const self = () => lockPage(player, back);
  const afk = afkLocked(), all = allLandsLocked(), n = lockedLandCount(), f = make("Supreme lock", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, "g") + "§6§lSupreme lock\n§r§7A LOCKED protection can't be broken,\n§r§7changed or removed by anybody:\n§r§7not players, not Helpers/Mods/Admins,\n§r§7not even the protection bypass.\n§r§7Only the Owner passes and unlocks.", ICON.shield, null);
  set(f, 2 * COLS + 2, hdr(1, afk ? "g" : "r") + "§e§lAFK area\n§r§7Now: " + (afk ? "§aLOCKED" : "§cnot locked") + "\n§r§7Locks every AFK protection, the area,\n§r§7the arrival spot and the blocks inside.\n§r§7Locking also switches the AFK\n§r§7protections ON.\n§r§eClick to " + (afk ? "unlock" : "lock"), ICON.clock, { run: () => {
    if (!isOwner(player)) return back();
    if (!afk) { for (const x of AFK_RULES) if (x.def) setAfkRule(player, x.k, true); }
    reply(player, setAfkLock(player, !afk), afk ? "AFK area unlocked." : "AFK area LOCKED. Nobody but you can change or break it."); self();
  } });
  set(f, 2 * COLS + 4, hdr(1, all ? "g" : "r") + "§b§lALL lands\n§r§7Now: " + (all ? "§aLOCKED" : "§cnot locked") + "\n§r§7Every land, also the ones bought later.\n§r§7Nobody can break, build in, hit in,\n§r§7delete or bypass them. Land owners and\n§r§7allowed players still use their land.\n§r§eClick to " + (all ? "unlock" : "lock"), ICON.map, { run: () => {
    if (!isOwner(player)) return back();
    reply(player, setAllLandsLock(player, !all), all ? "All lands unlocked." : "ALL lands are LOCKED."); self();
  } });
  set(f, 2 * COLS + 6, hdr(Math.min(99, Math.max(1, n)), n ? "g" : "c") + "§d§lOne land at a time\n§r§7Locked on its own: §f" + n + "\n§r§7Pick a land to lock or unlock\n§r§eClick to open", ICON.shield, { run: () => lockLandsPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function lockLandsPage(player, back, page = 0) {
  if (!isOwner(player)) return back();
  const self = (pg = 0) => lockLandsPage(player, back, pg);
  const items = allClaims().sort((a, b) => String(a.on).localeCompare(String(b.on)) || (a.ord ?? 0) - (b.ord ?? 0)).map((c) => () => {
    const own = c.k === true, lk = isLocked(c), sz = landSizeOf(c.s);
    return {
      zone: lk ? "g" : "r", icon: lk ? ICON.ok : ICON.shield,
      text: "§f§l" + c.n + " §7- §e" + c.on + "\n§r§7" + sz.w + "x" + sz.w + "x" + sz.h + " §8| §7" + dimLabel(c.d) + " §8| §7" + landDur(landLeft(c)) + "\n§r§7Now: " + (own ? "§aLOCKED" : allLandsLocked() ? "§aLOCKED §7(all lands)" : "§cnot locked") + "\n§r§eClick to " + (own ? "unlock" : "lock"),
      run: () => { if (!isOwner(player)) return back(); reply(player, setClaimLock(player, c, !own), c.n + (own ? " unlocked." : " LOCKED.")); self(page); },
    };
  });
  lister(player, "Lock a land", items, page, back, self);
}
function permRolesPage(player, back) {
  if (!isOwner(player)) return back();
  const self = () => permRolesPage(player, back);
  const f = make("Role permissions", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§5§lRole permissions\n§r§7Pick a role, then click an action to\n§r§7allow (green) or block (red) it for that role.\n§r§7Game operators without a saved role count as Admin.", ICON.paper, null);
  PERM_ROLES.forEach((r, i) => {
    const c = permCount(r);
    set(f, 2 * COLS + 2 + i * 2, hdr(1) + ROLE_COLOR[r] + "§l" + ROLE_NAME[r] + "\n§r§7Allowed: §f" + c.on + "§7/§f" + c.total + "\n§r§eClick to edit", ({ helper: "textures/ui/shop/ic_badge", mod: "textures/ui/shop/ic_gavel", admin: "textures/ui/shop/ic_gear" })[r] ?? "textures/ui/shop/ic_crown", { run: () => permsPage(player, r, self) });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function permsPage(player, role, back, page = 0) {
  if (!isOwner(player)) return back();
  const self = (pg = 0) => permsPage(player, role, back, pg);
  const items = PERM_INFO.map(([key, label, desc]) => () => {
    const on = roleAllows(role, key), def = roleDefault(role, key);
    return {
      zone: on ? "g" : "r", icon: on ? ICON.ok : ICON.barrier,
      text: (on ? "§a§l" : "§c§l") + label + "\n§r§7" + desc + "\n§r§7Now: " + (on ? "§aAllowed" : "§cBlocked") + (on === def ? " §8(default)" : " §d(changed)") + "\n§r§eClick to " + (on ? "block" : "allow"),
      run: () => { const r = setRolePerm(player, role, key, !on); if (!r.ok) say(player, "§c[Operator] " + (r.err ?? "That did not work.")); self(page); },
    };
  });
  lister(player, ROLE_NAME[role] + " permissions", items, page, back, self, [[7, hdr(1, "r") + "§d§lReset to default\n§r§7Back to the normal permissions\n§r§7of this role", ICON.paper, () => confirm(player, "Reset " + ROLE_NAME[role] + "?", ["§7Every permission of §f" + ROLE_NAME[role], "§7goes back to the default."], () => { reply(player, resetRolePerms(player, role), ROLE_NAME[role] + " permissions reset."); self(page); }, () => self(page))]]);
}
function transferPage(player, back, page = 0) {
  if (!isOwner(player)) return back();
  const self = (pg = 0) => transferPage(player, back, pg);
  const list = world.getAllPlayers().filter((x) => x.id !== player.id).sort((a, b) => a.name.localeCompare(b.name));
  lister(player, "Transfer ownership", list.map((t) => ({
    zone: "r", icon: ICON.player, text: "§f§l" + t.name + "\n§r§7Online\n§r§cClick: make him the Owner",
    run: () => confirm(player, "Transfer the ownership?", ["§f" + t.name + " §7becomes the §5Owner", "§7You become a normal §cAdmin§7.", "§cYou can not undo this yourself."], () => {
      if (!isOwner(player)) return back();
      if (setOwner({ id: t.id, name: t.name })) { say(player, "§5[Owner] §f" + t.name + " §dis now the Owner."); say(t, "§5§l[Owner] §r§dYou are now the Owner of this server."); try { slog(player, "role", { id: t.id, name: t.name }, "Owner transferred"); } catch (e) { /* ignore */ } back(); }
      else { say(player, "§c[Operator] Could not transfer the ownership."); self(page); }
    }, () => self(page)),
  })), page, back, self);
}

// ================================================================ SCOREBOARD NAME (the Owner; an Admin only when the Owner allowed "Scoreboard name" in Role permissions)
//   The name is the title of the side-panel scoreboard (hud.js). Every action checks the permission again.
const HUD_ORIGINAL = "§c§lS§6§lM§e§lP";
export function hudNamePage(player, back) {
  if (!allow(player, "hudname")) return back();
  const self = () => hudNamePage(player, back);
  const cur = hudNameNow();
  const f = make("Scoreboard name", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§6§lScoreboard name\n§r§7Now: " + (cur ? NAME_COLORS[cur.c][1] + "§l" + cur.n : HUD_ORIGINAL + " §r§8(original)") + "\n§r§7The title at the top of the side panel\n§r§7that every player sees", "textures/items/name_tag", null);
  set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lChange the name\n§r§7Type a name (max " + HUD_NAME_MAX + " characters, English)\n§r§7and choose its colour\n§r§eClick", ICON.book, { run: () => hudNameForm(player, self) });
  set(f, 1 * COLS + 6, hdr(1, "r") + "§c§lBack to the original\n§r§7The coloured " + HUD_ORIGINAL + " §r§7again", ICON.barrier, {
    run: () => confirm(player, "Back to the original name?", ["§7The scoreboard shows the coloured", "§7SMP name again."], () => {
      if (!allow(player, "hudname")) return back();
      const r = resetHudName();
      if (r.ok) slog(player, "hudname", null, "Back to the original name");
      reply(player, r, "The scoreboard name is the original SMP again."); self();
    }, self),
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function hudNameForm(player, back) {
  if (!allow(player, "hudname")) return back();
  const cur = hudNameNow();
  const form = new OprForm().title("Scoreboard name");
  textDef(form, "§fServer name §7(max " + HUD_NAME_MAX + " characters: English letters, numbers, symbols)", "e.g. MyServer", cur ? cur.n : "");
  const names = NAME_COLORS.map((c) => c[1] + c[0]);
  try { form.dropdown("§fColour", names, { defaultValueIndex: cur ? cur.c : 1 }); } catch (e) { form.dropdown("§fColour", names, cur ? cur.c : 1); }
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!allow(player, "hudname")) return back();                                                // checked again: the Owner may have blocked it meanwhile
    const r = setHudName(String(v[0] ?? ""), Number(v[1]));
    if (r.ok) slog(player, "hudname", null, "Name: " + r.name);
    reply(player, r, "Scoreboard name changed to " + (r.name ?? "") + ".");
    back();
  });
}

// ================================================================ THE END EVENT (Owner / Admin)
const END_DELAYS = [["10 seconds", 10000], ["Right now (no countdown)", 0], ["1 minute", 60000], ["5 minutes", 300000], ["10 minutes", 600000], ["30 minutes", 1800000], ["1 hour", 3600000]];
const END_OPEN_FOR = [["15 minutes", 900000], ["30 minutes", 1800000], ["1 hour", 3600000], ["2 hours", 7200000], ["Until a staff member closes it", 0]];
const END_LOG = { open: ["Opened", "§a"], close: ["Closed", "§c"], auto: ["Closed (timer)", "§c"], start: ["Countdown started", "§e"], cancel: ["Countdown cancelled", "§7"], first: ["First player in", "§6"] };
export function endPage(player, back) {
  if (!allow(player, "endgate")) return back();
  const self = () => endPage(player, back);
  const v = eventView(), now = Date.now(), f = make("The End event", ROWS); f.self = self;
  const state = v.open ? "§aOPEN" : v.openAt ? "§eOPENS IN §f" + mmss(v.openAt - now) : "§cCLOSED";
  set(f, 0 * COLS + 4, hdr(1, v.open ? "g" : v.openAt ? "g" : "r") + "§5§lThe End: " + state + "\n§r" + (v.open ? (v.openUntil ? "§7Closes in §f" + mmss(v.openUntil - now) : "§7Open until a staff member closes it") + "\n§r" + (v.first ? "§7First in: §d" + v.first.n : "§7Nobody has gone in yet") : v.openAt ? "§7Then open for §f" + (v.dur ? nice(v.dur) : "until closed") : "§7Nobody can enter, however they try") + "\n§r§8Click Refresh below to update the timer", ICON.ice, null);
  if (!v.open && !v.openAt) {
    set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lStart the event\n§r§7Choose when The End opens and\n§r§7for how long (default 15 minutes).\n§r§7Everybody gets a notice + a countdown\n§r§eClick to choose", ICON.bell, { run: () => startForm(player, self) });
  } else {
    set(f, 1 * COLS + 2, hdr(1, "r") + (v.open ? "§c§lClose The End now\n§r§7Players inside are sent back at once" : "§c§lCancel the countdown\n§r§7The End stays closed") + "\n§r§eClick", ICON.barrier, {
      run: () => confirm(player, v.open ? "Close The End now?" : "Cancel the countdown?", [v.open ? "§7Everybody inside is sent back." : "§7Everybody gets a cancel notice."], () => { reply(player, stopEvent(player), v.open ? "The End is closed." : "Countdown cancelled."); self(); }, self) });
  }
  set(f, 1 * COLS + 4, hdr(1) + "§e§lEvent log\n§r§7Every opening, closing, countdown\n§r§7and the first player in\n§r§7Saved: §f" + endLog().length, ICON.paper, { run: () => endLogPage(player, self) });
  set(f, 1 * COLS + 6, hdr(1, "c") + "§7§lRefresh\n§r§7Update this page", "textures/ui/shop/key_refresh", { run: self });
  set(f, 3 * COLS + 2, hdr(1, v.holo ? "g" : "r") + "§d§lPortal holograms: " + (v.holo ? "§aON" : "§cOFF") + "\n§r§7Floating text on every End portal\n§r§7with the state and the timer\n§r§eClick to switch " + (v.holo ? "off (removes them all)" : "on"), ICON.sign, { run: () => { reply(player, setHoloOn(player, !v.holo), "Holograms " + (v.holo ? "OFF." : "ON.")); self(); } });
  set(f, 3 * COLS + 4, hdr(1, "r") + "§c§lRemove the nearest hologram\n§r§7Stand next to the portal (20 blocks)\n§r§7It stays removed until you bring it back", ICON.tnt, { run: () => { reply(player, removeNearest(player), "Hologram removed."); self(); } });
  if (v.skip.length) set(f, 3 * COLS + 6, hdr(v.skip.length, "g") + "§a§lBring removed holograms back\n§r§7Portals with a removed hologram: §f" + v.skip.length, ICON.ok, { run: () => { reply(player, clearSkips(player), "Holograms are back."); self(); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function startForm(player, back) {
  if (!allow(player, "endgate")) return back();
  const form = new OprForm().title("Start The End event");
  dropdown(form, "§fThe End opens in", END_DELAYS.map((x) => x[0])); dropdown(form, "§fStays open for", END_OPEN_FOR.map((x) => x[0]));
  showModal(player, form, (val) => {
    if (!val) return back();
    const d = END_DELAYS[Number(val[0])] ?? END_DELAYS[0], o = END_OPEN_FOR[Number(val[1])] ?? END_OPEN_FOR[0];
    reply(player, startEvent(player, d[1], o[1]), d[1] ? "Countdown started: The End opens in " + d[0] + "." : "The End is open.");
    back();
  });
}
export function endLogPage(player, back, page = 0) {
  if (!allow(player, "endgate")) return back();
  const self = (pg = 0) => endLogPage(player, back, pg);
  lister(player, "End events", endLog().map((e) => {
    const a = END_LOG[e.a] ?? [e.a, "§f"];
    return { zone: e.a === "open" || e.a === "first" ? "g" : e.a === "close" || e.a === "auto" ? "r" : "c", icon: e.a === "first" ? ICON.crown : e.a === "open" ? ICON.ok : e.a === "start" ? ICON.bell : ICON.barrier,
      text: a[1] + "§l" + a[0] + "\n§r§7By: §f" + e.by + "\n§r§7" + ago(e.t) + "\n§r§7" + (e.d || ""), run: null };
  }), page, back, self);
}

// ================================================================ CREATIVE LOG (data: creativelog.js)  Operator > Logs > Creative log
//   one entry per time somebody was in Creative: who (role), how long, and every item that appeared in his inventory meanwhile
const CRE_ROLE = { owner: "Owner", admin: "Admin", mod: "Mod", helper: "Helper" };
const creRole = (e) => CRE_ROLE[e.r] ?? "Member";
const CRE_DANGER = /command_block|structure_block|structure_void|jigsaw|barrier|bedrock|spawn_egg|allow$|deny$|border_block|light_block|debug_stick|mob_spawner|trial_spawner|vault|reinforced_deepslate|tnt|dragon_egg|end_portal|knowledge_book|petrified|chain_command/;
const creDur = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return h ? h + "h " + m + "m" : m ? m + "m " + x + "s" : x + "s"; };
const creKinds = (e) => Object.entries(e.it ?? {}).sort((a, b) => b[1] - a[1]);
function creSummary(e) {
  const k = creKinds(e); if (!k.length) return "§r§7Took: §fnothing";
  const shown = k.slice(0, 2).map(([id, n]) => (CRE_DANGER.test(id) ? "§c" : "§f") + n + "x " + pretty(id)).join("§7, ");
  return "§r§7Took: " + shown + (k.length > 2 ? " §7(+" + (k.length - 2) + " other items)" : "");
}
export function creativeLogPage(player, back, page = 0) {
  if (!allow(player, "logs")) return back();
  const self = (pg = 0) => creativeLogPage(player, back, pg), live = creativeActiveIds();
  const items = creativeEntries().map((e) => {
    const on = e.e === 0 && live.has(e.i), end = on ? Date.now() : e.e > 0 ? e.e : e.t, danger = creKinds(e).some(([id]) => CRE_DANGER.test(id));
    const head = (e.r ? "§c§l" : "§d§l") + e.p + " §r§8(" + creRole(e) + ")\n";
    return {
      zone: e.k ? "r" : on ? "g" : danger ? "r" : "c", icon: e.k ? ICON.barrier : ICON.player,
      text: e.k ? head + "§r§c§lBlocked: tried to use Creative\n§r§8" + ago(e.t) : head + "§r§7Creative: §f" + creDur(end - e.t) + (on ? " §a(NOW)" : "") + "\n" + creSummary(e) + "\n§r§8" + ago(e.t),
      run: () => creativeEntryPage(player, e, () => self(page)),
    };
  });
  const extras = isOwner(player) ? [[6, hdr(Math.min(99, Math.max(1, creativeBlocked().length)), creativeBlocked().length ? "r" : "c") + "§c§lBlocked from Creative\n§r§7Players: §f" + creativeBlocked().length + "\n§r§7Only the Owner sees this\n§r§eClick to open", ICON.barrier, () => creativeBlockedPage(player, () => self(page))]] : [];
  if (isOwner(player)) {                                                // Owner only: the two Force Survival switches (players / operators)
    const fs = forceState();
    const sw = (k, which, on, name, who) => [k, hdr(1, on ? "g" : "r") + (on ? "§a§l" : "§c§l") + "Force Survival: " + name + "\n§r§7" + who + "\n§r§7Creative is not allowed, even if he joins in it\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§7Only the Owner sees this\n§r§eClick to turn " + (on ? "OFF" : "ON"), ICON.shield,
      () => {
        const turn = () => { reply(player, setForceSurvival(player, which, !on), "Force Survival for " + name.toLowerCase() + " is now " + (!on ? "ON." : "OFF.")); self(page); };
        if (on) return turn();
        confirm(player, "Force Survival for " + name.toLowerCase() + "?", ["§7" + who, "§7Nobody there can stay in Creative.", "§7Anybody in Creative is sent to Survival now."], turn, () => self(page));
      }];
    extras.push(sw(7, "players", fs.players, "Players", "Every normal player (not operators)"), sw(8, "admins", fs.admins, "Operators", "Helpers, mods and admins (not the Owner)"));
  }
  lister(player, "Creative log", items, page, back, self, extras);
}
// one entry: the hub with the three views (inventory before / items he took / inventory after) and, for the Owner only, the Creative block
function creativeEntryPage(player, e, back) {
  if (!allow(player, "logs")) return back();
  const self = () => creativeEntryPage(player, e, back), on = e.e === 0 && creativeActiveIds().has(e.i);
  const end = on ? Date.now() : e.e > 0 ? e.e : e.t, kinds = creKinds(e), f = make("Creative: " + e.p, SHORT_ROWS); f.self = self;
  const when = "§r§7Started: §f" + ago(e.t) + "\n§r§8" + new Date(e.t).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const info = e.k
    ? "§c§l" + e.p + "\n§r§7Role: §f" + creRole(e) + "\n§r§c§lBlocked: tried to use Creative\n" + when
    : (e.r ? "§c§l" : "§d§l") + e.p + "\n§r§7Role: §f" + creRole(e) + "\n§r§7Mode before: §f" + (e.f ? e.f : "was already Creative (joined)") + "\n§r§7Creative: §f" + creDur(end - e.t) + (on ? " §a(NOW)" : e.l ? " §7(left the game in Creative)" : e.e === -1 ? " §7(end unknown)" : "") + "\n" + when;
  set(f, 0 * COLS + 4, hdr(1, on ? "g" : e.k ? "r" : "c") + info + "\n§r§eClick: operator profile", ICON.player, { run: () => openPlayer(player, e.i, e.p, self) });
  if (!e.k) {
    const nb = e.b ? Object.keys(e.b).length : 0, na = Object.keys(e.a ?? e.b ?? {}).length;
    set(f, 1 * COLS + 2, hdr(Math.min(99, Math.max(1, nb))) + "§e§lInventory BEFORE\n§r§7What he carried the moment\n§r§7he switched to Creative\n§r§7Kinds: §f" + nb + "\n§r§eClick to open", ICON.chest, { run: () => creativeInvPage(player, e, "b", self) });
    set(f, 1 * COLS + 4, hdr(Math.min(99, Math.max(1, kinds.length)), kinds.some(([id]) => CRE_DANGER.test(id)) ? "r" : "g") + "§a§lItems he TOOK\n§r§7What appeared in his inventory\n§r§7while he was in Creative\n§r§7Kinds: §f" + kinds.length + "\n§r§eClick to open", ICON.item, { run: () => creativeInvPage(player, e, "t", self) });
    set(f, 1 * COLS + 6, hdr(Math.min(99, Math.max(1, na))) + "§b§lInventory AFTER\n§r§7What he carried at the last change\n§r§7(or when he left Creative)\n§r§7Kinds: §f" + na + "\n§r§eClick to open", ICON.chest, { run: () => creativeInvPage(player, e, "a", self) });
  }
  if (isOwner(player) && !isOwnerId(e.i)) {
    const blocked = isCreativeBlocked(e.i);
    set(f, 3 * COLS + 4, hdr(1, blocked ? "g" : "r") + (blocked ? "§a§lAllow Creative again\n§r§7He is blocked now\n§r§eClick to allow" : "§c§lBlock Creative\n§r§7He will be sent back to Survival\n§r§7every time he uses Creative\n§r§eClick to block"), blocked ? ICON.ok : ICON.barrier, {
      run: () => {
        if (!isOwner(player)) return self();                                                    // checked again
        if (blocked) { reply(player, setCreativeBlock(player, e.i, e.p, false), e.p + " can use Creative again."); return self(); }
        confirm(player, "Block this player from Creative?", ["§7Player: §f" + e.p, "§7Every time he is in Creative he is", "§7sent back to Survival at once."], () => { reply(player, setCreativeBlock(player, e.i, e.p, true), e.p + " is blocked from Creative."); self(); }, self);
      },
    });
  }
  if (isOwner(player) && !on) {
    set(f, 3 * COLS + 6, hdr(1, "r") + "§c§lDelete this record\n§r§7Removes only this one entry\n§r§7from the Creative log for good\n§r§7Only the Owner sees this button", ICON.barrier, { run: () => {
      if (!isOwner(player)) return self();                                                    // checked again
      confirm(player, "Delete this record?", ["§7Player: §f" + e.p, "§cIt is removed for good", "§cand can't be brought back."], () => {
        if (!isOwner(player)) return back();                                                  // checked a third time, at the moment of deleting
        const ok = deleteCreativeEntry(e);
        if (ok) { try { slog(player, "dellog", { id: e.i, name: e.p }, "creative log"); } catch (err) { /* ignore */ } }
        say(player, ok ? "§a[Operator] The record was deleted." : "§7[Operator] The record was not deleted (he is in Creative now, or it was already deleted).");
        back();
      }, self);
    } });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
/** the items of one view: "b" inventory before, "t" items he took, "a" inventory after */
function creativeInvPage(player, e, which, back, page = 0) {
  if (!allow(player, "logs")) return back();
  const self = (pg = 0) => creativeInvPage(player, e, which, back, pg);
  const src = which === "t" ? e.it : which === "b" ? e.b : e.a ?? e.b;
  const title = (which === "t" ? "Items taken: " : which === "b" ? "Inventory before: " : "Inventory after: ") + e.p;
  const rows = Object.entries(src ?? {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const bad = CRE_DANGER.test(id);
    return { zone: bad ? "r" : "c", icon: ICON.item, text: (bad ? "§c§l! " : "§f§l") + pretty(id) + "\n§r§7Amount: §f" + num(n) + "\n§r§8" + id, run: null };
  });
  if (which === "t" && e.x > 0) rows.push({ zone: "c", icon: ICON.paper, text: "§7§lMore items\n§r§7" + num(e.x) + " more items of other kinds\n§r§7(only the first " + Object.keys(e.it ?? {}).length + " kinds are saved)", run: null });
  if (!rows.length) rows.push({ zone: "c", icon: ICON.paper, text: which === "t" ? "§7Took nothing in Creative" : "§7Nothing saved here", run: null });
  lister(player, title, rows, page, back, self);
}
// Owner only: the players blocked from Creative (click one to allow him again)
function creativeBlockedPage(player, back, page = 0) {
  if (!isOwner(player)) return back();
  const self = (pg = 0) => creativeBlockedPage(player, back, pg);
  const rows = creativeBlocked().map((b) => ({ zone: "r", icon: ICON.player, text: "§c§l" + b.name + "\n§r§7Blocked from Creative\n§r§eClick to allow again", run: () => { if (!isOwner(player)) return back(); reply(player, setCreativeBlock(player, b.id, b.name, false), b.name + " can use Creative again."); self(page); } }));
  lister(player, "Blocked from Creative", rows, page, back, self);
}

// ================================================================ MOB REWARDS (Owner / Admin)
const EGG_ICON = new Set("allay armadillo axolotl bat bee blaze bogged breeze camel cat cave_spider chicken cod cow creaking creeper dolphin donkey drowned elder_guardian enderman endermite evoker fox frog ghast glow_squid goat guardian hoglin horse husk iron_golem llama magma_cube mooshroom mule ocelot panda parrot phantom pig piglin piglin_brute pillager polar_bear pufferfish rabbit ravager salmon sheep shulker silverfish skeleton skeleton_horse slime sniffer spider squid stray strider trader_llama tropical_fish turtle vex villager vindicator wandering_trader warden witch wither_skeleton wolf zoglin zombie zombie_horse zombie_pigman zombie_villager".split(" "));
export function mobRewardPage(player, back) {
  if (!allow(player, "mobmoney")) return back();
  const self = () => mobRewardPage(player, back);
  const on = mobRewardOn(), s = mobRewardStats(), f = make("Mob rewards", ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, on ? "g" : "r") + "§6§lMob rewards: " + (on ? "§aON" : "§cOFF") + "\n§r§7Killing a mob pays money, more for\n§r§7stronger mobs.\n§r§7Paid so far: §f" + money(s.paid) + " §7(" + num(s.kills) + " kills)", "textures/ui/shop/skull_zombie", null);
  set(f, 2 * COLS + 2, hdr(1, on ? "r" : "g") + "§e§lSwitch " + (on ? "OFF" : "ON") + "\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§eClick to switch", ICON.shield, { run: () => { reply(player, setMobReward(player, !on), "Mob rewards " + (on ? "OFF." : "ON.")); self(); } });
  set(f, 2 * COLS + 4, hdr(1) + "§b§lReward table\n§r§7What every mob pays", ICON.book, { run: () => mobTablePage(player, self) });
  set(f, 2 * COLS + 6, hdr(1) + "§7§lRules\n§r§7Survival players only, own kills\n§r§7No babies, pets, named mobs, villagers\n§r§7Limit: §f" + money(HOURLY_CAP) + " §7per player per hour\n§r§7(bosses are always paid in full)", ICON.paper, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function mobTablePage(player, back, page = 0) {
  if (!allow(player, "mobmoney")) return back();
  const self = (pg = 0) => mobTablePage(player, back, pg);
  lister(player, "Mob rewards", rewardTable().map((r) => {
    const egg = r.id === "zombified_piglin" ? "zombie_pigman" : r.id;
    return { zone: r.money >= 150 ? "r" : r.money >= 14 ? "g" : "c", icon: EGG_ICON.has(egg) ? "textures/ui/shop/egg_" + egg : ICON.item, text: "§f§l" + r.name + "\n§r§aPays: §f" + money(r.money), run: null };
  }), page, back, self);
}

// ================================================================ SPAWNER SETTINGS (the Owner; an Admin only when the Owner allowed "Spawner settings" in Role permissions)
//   kills per hour, storage hours, max stack, animal speed and the speed of single mobs.  Every action checks the permission again.
export function spawnerSettingsPage(player, back) {
  if (!allow(player, "spawnerset")) return back();
  const self = () => spawnerSettingsPage(player, back);
  const c = spawnerSettings(), d = SP.DEFAULTS, f = make("Spawner settings", SHORT_ROWS); f.self = self;
  const mark = (v, def) => (v === def ? " §8(default)" : " §d(changed)");
  set(f, 0 * COLS + 4, hdr(1) + "§6§lSpawner settings\n§r§7Kills per hour: §f" + num(c.rate) + mark(c.rate, d.rate) + "\n§r§7Storage: §f" + c.storage + " hours" + mark(c.storage, d.storage) + "\n§r§7Max stack: §f" + c.stack + mark(c.stack, d.stack) + "\n§r§7Animal speed: §fx" + c.animal + mark(c.animal, d.animal) + "\n§r§7Single mobs changed: §f" + Object.keys(c.mobs).length, "textures/ui/shop/ic_spawner", null);
  set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lMain settings\n§r§7Kills per hour, storage hours,\n§r§7max stack, animal speed\n§r§eClick to change", ICON.book, { run: () => spawnerMainForm(player, self) });
  set(f, 1 * COLS + 4, hdr(Math.max(1, Object.keys(c.mobs).length), "c") + "§b§lSpeed of one mob\n§r§7Give a single mob its own\n§r§7kills per hour (zombie, blaze ...)\n§r§eClick to open", ICON.chest, { run: () => spawnerMobsPage(player, self) });
  set(f, 1 * COLS + 6, hdr(1, "r") + "§c§lBack to the defaults\n§r§7All numbers and all single mobs\n§r§7return to the normal values", ICON.barrier, {
    run: () => confirm(player, "Reset the spawner settings?", ["§7Every number and every single-mob", "§7speed goes back to the default."], () => { reply(player, resetSpawnerSettings(player), "Spawner settings reset."); self(); }, self),
  });
  set(f, 3 * COLS + 4, hdr(1) + "§7§lGood to know\n§r§7Changes work at once for every spawner.\n§r§7Spawners that already exist keep their\n§r§7stack and loot; the new speed counts\n§r§7from now on and also for time not yet\n§r§7collected.", ICON.paper, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function spawnerMainForm(player, back) {
  if (!allow(player, "spawnerset")) return back();
  const c = spawnerSettings(), [r0, r1] = SP.LIMITS.rate, [s0, s1] = SP.LIMITS.storage, [k0, k1] = SP.LIMITS.stack, [a0, a1] = SP.LIMITS.animal;
  const form = new OprForm().title("Spawner settings");
  textDef(form, "§fKills per hour of ONE spawner §7(" + r0 + "-" + r1 + ", a stack of 10 makes 10x)", "whole number", c.rate);
  textDef(form, "§fStorage hours §7(" + s0 + "-" + s1 + "): a spawner stops when it holds this much loot", "whole number", c.storage);
  textDef(form, "§fMax stack per block §7(" + k0 + "-" + k1 + ")", "whole number", c.stack);
  textDef(form, "§fAnimal speed §7(" + a0 + "-" + a1 + "): pig, cow, chicken, sheep, rabbit, mooshroom, wolf. 1 = same as the others, 0.5 = half", "e.g. 0.5", c.animal);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!allow(player, "spawnerset")) return back();                                            // checked again: the Owner may have blocked it meanwhile
    const n = (i) => { const t = String(v[i] ?? "").trim().replace(",", "."); return t === "" ? NaN : Number(t); };
    reply(player, setSpawnerMain(player, { rate: n(0), storage: n(1), stack: n(2), animal: n(3) }), "Spawner settings saved.");
    back();
  });
}
function spawnerMobsPage(player, back, page = 0) {
  if (!allow(player, "spawnerset")) return back();
  const self = (pg = 0) => spawnerMobsPage(player, back, pg);
  lister(player, "Speed of one mob", SPAWNERS.map((m) => () => {
    const own = spawnerSettings().mobs[m.id], eff = SP.ratePerHour(m.id);
    return {
      zone: own ? "g" : "c", icon: EGG_ICON.has(m.id) ? "textures/ui/shop/egg_" + m.id : ICON.item,
      text: "§f§l" + m.name + "\n§r§7Kills per hour (1 spawner): §f" + num(eff) + (own ? " §d(own value)" : " §8(normal)") + "\n§r§eClick to change",
      run: () => spawnerMobForm(player, m, () => self(page)),
    };
  }), page, back, self);
}
function spawnerMobForm(player, m, back) {
  if (!allow(player, "spawnerset")) return back();
  const own = spawnerSettings().mobs[m.id], [k0, k1] = SP.LIMITS.mob;
  const form = new OprForm().title(m.name + " spawner");
  textDef(form, "§fKills per hour of ONE " + m.name + " spawner §7(" + k0 + "-" + k1 + ").\n§7Normal speed now: §f" + num(SP.ratePerHour(m.id)) + "§7.  Type §f0 §7for the normal speed.", "whole number, 0 = normal", own ?? 0);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!allow(player, "spawnerset")) return back();
    const t = String(v[0] ?? "").trim(), x = t === "" ? NaN : Number(t);
    reply(player, setSpawnerMob(player, m.id, x), m.name + " spawner: " + (x ? num(x) + " kills per hour." : "normal speed."));
    back();
  });
}

// ================================================================ AFK AREA (Owner / Admin; the Owner can block it for Admin in Role permissions)
//   money + shards per minute, and the area (width, length, height around the operator, like a land) + the arrival spot of /afk
export function afkSettingsPage(player, back) {
  if (!allow(player, "afkset")) return back();
  const self = () => afkSettingsPage(player, back);
  const c = afkSettings(), z = c.zone, f = make("AFK area", SHORT_ROWS); f.self = self;
  const zt = z ? "§r§7Size: §f" + zoneSize(z).w + " §7x §f" + zoneSize(z).l + " §7x §f" + zoneSize(z).h + " §8(width x length x height)\n§r§7From §f" + z.x1 + ", " + z.y1 + ", " + z.z1 + "\n§r§7To §f" + z.x2 + ", " + z.y2 + ", " + z.z2 + " §8(" + dimLabel(z.d) + ")" : "§r§cNo AFK area yet";
  set(f, 0 * COLS + 4, hdr(1, z ? "g" : "r") + "§6§lAFK area\n§r§7Every minute inside: §a" + money(c.money) + " §7+ §d" + num(c.shards) + " shards\n" + zt, ICON.clock, null);
  set(f, 1 * COLS + 1, hdr(1, "g") + "§a§lRewards per minute\n§r§7Money and shards a player gets\n§r§7for every full minute in the area\n§r§eClick to change", ICON.gold, { run: () => afkRewardForm(player, self) });
  set(f, 1 * COLS + 3, hdr(1, "g") + "§b§lSet the area here\n§r§7You stand in the middle. Choose the\n§r§7width, length and height.\n§r§7Your spot becomes the arrival spot.\n§r§eClick", ICON.map, { run: () => afkZoneForm(player, self) });
  set(f, 1 * COLS + 5, hdr(1, "c") + "§d§lMove the arrival spot\n§r§7Stand inside the area where /afk\n§r§7should put the players, then click", ICON.compass, { run: () => { reply(player, setAfkSpot(player), "Arrival spot moved to where you stand."); self(); } });
  set(f, 1 * COLS + 7, hdr(1, "r") + "§c§lRemove the area\n§r§7/afk stops working until a new\n§r§7area is set", ICON.barrier, {
    run: () => confirm(player, "Remove the AFK area?", ["§7Nobody earns AFK rewards until", "§7a new area is set."], () => { reply(player, clearAfkZone(player), "AFK area removed."); self(); }, self),
  });
  const ro = afkRules(), onN = AFK_RULES.filter((x) => ro[x.k]).length;
  set(f, 3 * COLS + 2, hdr(1, onN ? "g" : "r") + "§c§lProtection\n§r§7What players can NOT do in the area\n§r§7(break, place, hit, fire, explosions)\n§r§7Now: §f" + onN + " §7of §f" + AFK_RULES.length + " §7switched ON\n§r§eClick to change", ICON.shield, { run: () => afkProtectionPage(player, self) });
  if (z) set(f, 3 * COLS + 4, hdr(1) + "§e§lGo there now\n§r§7Teleport to the arrival spot\n§r§7(" + (inAfkZone(player) ? "§ayou are inside" : "§7you are outside") + "§7)", ICON.compass, { run: () => { reply(player, gotoAfkZone(player), "Teleported to the AFK area."); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
// ---- AFK protection: every rule ON / OFF (Owner / Admin with the "afkset" permission).  Operators are never stopped by these rules.
const AFK_RULE_ICON = { nobreak: "textures/items/diamond_pickaxe", noplace: "textures/blocks/stone", nopvp: "textures/items/diamond_sword", nomob: "textures/items/armor_stand", nofire: "textures/items/flint_and_steel", noboom: ICON.tnt, nouse: ICON.chest };
const AFK_RULE_SLOT = { nobreak: 1 * COLS + 1, noplace: 1 * COLS + 3, nopvp: 1 * COLS + 5, nomob: 1 * COLS + 7, nofire: 2 * COLS + 2, noboom: 2 * COLS + 4, nouse: 2 * COLS + 6 };
export function afkProtectionPage(player, back) {
  if (!allow(player, "afkset")) return back();
  const self = () => afkProtectionPage(player, back);
  const ro = afkRules(), onN = AFK_RULES.filter((x) => ro[x.k]).length, f = make("AFK protection", SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1, onN ? "g" : "r") + "§6§lAFK protection\n§r§7Switch each protection ON or OFF.\n§r§7" + (afkLocked() ? "§6LOCKED by the Owner: only he can change it." : "Operators are never stopped.") + "\n§r§7ON now: §f" + onN + " §7of §f" + AFK_RULES.length, ICON.shield, null);
  for (const x of AFK_RULES) {
    const on = !!ro[x.k];
    set(f, AFK_RULE_SLOT[x.k], hdr(1, on ? "g" : "r") + (on ? "§a§l" : "§c§l") + x.name + "\n§r§7" + x.info + "\n§r§7Now: " + (on ? "§aON" : "§cOFF") + "\n§r§eClick to switch " + (on ? "OFF" : "ON"), AFK_RULE_ICON[x.k] ?? ICON.shield,
      { run: () => { reply(player, setAfkRule(player, x.k, !on), x.name + (on ? " is now OFF." : " is now ON.")); self(); } });
  }
  set(f, 3 * COLS + 3, hdr(1, "g") + "§a§lAll ON\n§r§7Switch every protection ON", ICON.ok, { run: () => { reply(player, setAfkRulesAll(player, true), "Every AFK protection is ON."); self(); } });
  set(f, 3 * COLS + 5, hdr(1, "r") + "§c§lAll OFF\n§r§7Switch every protection OFF", ICON.barrier, { run: () => { reply(player, setAfkRulesAll(player, false), "Every AFK protection is OFF."); self(); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function afkRewardForm(player, back) {
  if (!allow(player, "afkset")) return back();
  const c = afkSettings();
  const form = new OprForm().title("AFK rewards");
  textDef(form, "§fMoney per minute §7(0-" + num(AFK_LIMITS.money[1]) + ", 0 = none)", "whole number", c.money);
  textDef(form, "§fShards per minute §7(0-" + num(AFK_LIMITS.shards[1]) + ", 0 = none)", "whole number", c.shards);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!allow(player, "afkset")) return back();                                                // checked again
    const n = (i) => { const t = String(v[i] ?? "").trim(); return t === "" || !/^\d+$/.test(t) ? NaN : Number(t); };
    reply(player, setAfkRewards(player, n(0), n(1)), "AFK rewards saved.");
    back();
  });
}
function afkZoneForm(player, back) {
  if (!allow(player, "afkset")) return back();
  const z = afkSettings().zone, s = z ? zoneSize(z) : { w: 20, l: 20, h: 10 };
  const form = new OprForm().title("AFK area");
  textDef(form, "§fWidth §7(X direction, " + AFK_LIMITS.w[0] + "-" + AFK_LIMITS.w[1] + "). You are in the middle.", "whole number", s.w);
  textDef(form, "§fLength §7(Z direction, " + AFK_LIMITS.l[0] + "-" + AFK_LIMITS.l[1] + ")", "whole number", s.l);
  textDef(form, "§fHeight §7(" + AFK_LIMITS.h[0] + "-" + AFK_LIMITS.h[1] + "). A quarter goes below your feet.", "whole number", s.h);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!allow(player, "afkset")) return back();
    const n = (i) => { const t = String(v[i] ?? "").trim(); return t === "" || !/^\d+$/.test(t) ? NaN : Number(t); };
    reply(player, setAfkZone(player, n(0), n(1), n(2)), "AFK area set around you. Arrival spot = where you stand.");
    back();
  });
}
