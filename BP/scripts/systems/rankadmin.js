// ADMIN: control of ALL the leaderboards   (/menu > Ranks > "Admin: leaderboards"  and  Operator > Leaderboards > "Leaderboard control")
// Permission "boards" (Owner / Admin by default); every action checks it again in ranks.js and is written to the staff log.
//   REMOVE = the player (or clan) disappears from ONE list.   BAN = the player disappears from EVERY list (no weekly shards, no [Richest] tag).   Both can be undone.
// Pages:  home (the 10 lists + banned players + find a player)  >  one list (its top 10: click a name)  >  that player (remove / ban)
import { ModalFormData } from "@minecraft/server-ui";
import { make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { showModal, confirmShort } from "./forms.js";
import { can } from "./staffcore.js";
import { allRecords } from "../data.js";
import { LISTS, TOP_KEYS, topRows, hiddenList, hiddenCount, bannedList, hideFrom, restoreTo, banPlayer, unbanPlayer } from "./ranks.js";

const ICON = {
  money: "textures/ui/shop/hud_money", clan: "textures/items/name_tag", duel: "textures/items/iron_sword", sell: "textures/items/emerald", buy: "textures/items/diamond",
  play: "textures/ui/shop/hud_time", kills: "textures/ui/shop/hud_kills", shards: "textures/ui/shop/hud_shards", skills: "textures/items/iron_axe", ach: "textures/items/nether_star",
};
const COLOR = { money: "§a", clan: "§6", duel: "§c", sell: "§b", buy: "§d", play: "§f", kills: "§4", shards: "§5", skills: "§3", ach: "§e" };
const PLAYER_KEYS = TOP_KEYS.filter((k) => k !== "clan");
const res = (r, ok) => (r && r.err ? "§c" + r.err : "§a" + ok);

// ================================================================ home
export function boardAdminPage(player, back, msg) {
  if (!can(player, "boards")) { try { player.sendMessage("§c[Leaderboards] You are not allowed to do this."); } catch (e) { /* ignore */ } return back && back(); }
  const f = make("Leaderboard control", 5);
  f.self = () => boardAdminPage(player, back);
  const banned = bannedList().length;
  set(f, 0 * COLS + 4, hdr(Math.max(1, banned)) + (msg ? msg + "\n§r§8" : "§c§lLeaderboard control\n§r") + "§7Pick a list to remove players from it.\n§r§7Banned from all lists: §f" + banned, "textures/ui/shop/ic_gear", null);
  TOP_KEYS.forEach((key, i) => {
    const n = hiddenCount(key);
    set(f, (1 + Math.floor(i / 5)) * COLS + (i % 5) * 2, hdr(Math.max(1, n), n ? "r" : "c") + (COLOR[key] ?? "§e") + "§lTop " + LISTS[key].label + "\n§r§7Removed from this list: §f" + n + "\n§r§eClick to manage", ICON[key], { run: () => listPage(player, key, () => boardAdminPage(player, back)) });
  });
  set(f, 3 * COLS + 2, hdr(Math.max(1, banned), banned ? "r" : "c") + "§c§lBanned players\n§r§7Hidden from every list: §f" + banned + "\n§r§eClick to see / unban", NAV.no, { run: () => bannedPage(player, () => boardAdminPage(player, back)) });
  set(f, 3 * COLS + 4, hdr(1) + "§e§lFind a player\n§r§7Type a name: remove him from a\n§r§7list or ban him (online or offline)", "textures/items/name_tag", { run: () => findForm(player, null, () => boardAdminPage(player, back)) });
  set(f, 3 * COLS + 6, hdr(1) + "§7§lHow it works\n§r§7Remove = hidden from one list.\n§r§7Ban = hidden from all lists, no weekly\n§r§7shards. Both can be undone here.", "textures/ui/shop/ic_help", null);
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ one list: its top 10
const ROW_SLOTS = [11, 12, 13, 14, 15, 20, 21, 22, 23, 24];
function listPage(player, key, back, msg) {
  if (!can(player, "boards")) return back();
  const L = LISTS[key], f = make("Control: " + L.label, 5);
  f.self = () => listPage(player, key, back);
  const again = (m) => listPage(player, key, back, m);
  const rows = topRows(key, 10), n = hiddenCount(key);
  set(f, 0 * COLS + 4, hdr(1) + (msg ? msg + "\n§r§8" : (COLOR[key] ?? "§e") + "§lTop " + L.label + "\n§r") + "§7Click a name to remove or ban him.\n§r§7Removed from this list: §f" + n, ICON[key], null);
  rows.forEach((r, i) => {
    set(f, ROW_SLOTS[i], hdr(i + 1) + (["§6", "§b", "§e"][i] ?? "§3") + "§l#" + (i + 1) + " §f" + r.name + "\n§r" + r.text + "\n§r§eClick to manage", NAV.player, { run: () => playerPage(player, key, r, again) });
  });
  if (!rows.length) set(f, 1 * COLS + 4, hdr(1) + "§7Nobody is ranked yet", "textures/ui/shop/ic_trophy", null);
  set(f, 3 * COLS + 3, hdr(Math.max(1, n), n ? "g" : "c") + "§a§lRemoved here (" + n + ")\n§r§7Put somebody back in this list", NAV.ok, { run: () => hiddenPage(player, key, again) });
  set(f, 3 * COLS + 5, hdr(1) + "§e§lFind by name\n§r§7Remove somebody who is not\n§r§7in the top 10", "textures/items/name_tag", { run: () => findForm(player, key, again) });
  backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ one player (or clan) of a list
function playerPage(player, key, row, back) {
  if (!can(player, "boards")) return back();
  const L = LISTS[key], f = make("Remove or ban", 5), clan = key === "clan";
  f.self = () => playerPage(player, key, row, back);
  set(f, 0 * COLS + 4, hdr(1) + "§f§l" + row.name + "\n§r§7" + L.label + ": " + row.text, clan ? ICON.clan : NAV.player, null);
  set(f, 2 * COLS + (clan ? 3 : 2), hdr(1, "r") + "§c§lRemove from " + L.label + "\n§r§7He disappears from this list only.\n§r§7You can put him back later.", NAV.no, {
    run: () => confirmShort(player, "Remove from the list?", ["§f" + row.name, "§7Hidden from the §f" + L.label + " §7list only."],
      () => back(res(hideFrom(player, key, row.id, row.name), row.name + " was removed from the " + L.label + " list.")), () => playerPage(player, key, row, back)),
  });
  if (!clan) set(f, 2 * COLS + 6, hdr(1, "r") + "§4§lBAN from all lists\n§r§7Hidden from EVERY leaderboard,\n§r§7no weekly shards. Undo in 'Banned'.", "textures/ui/shop/ic_gavel", {
    run: () => confirmShort(player, "Ban from all leaderboards?", ["§f" + row.name, "§7Hidden from all 9 player lists", "§7and no weekly shards."],
      () => back(res(banPlayer(player, row.id, row.name), row.name + " is banned from all leaderboards.")), () => playerPage(player, key, row, back)),
  });
  else set(f, 2 * COLS + 5, hdr(1) + "§7Clans can only be removed\n§r§7from the clan list", "textures/ui/shop/ic_help", null);
  backBtn(f, () => back());
  status(player, f);
  open(player, f);
}

// ================================================================ lists of people (banned / removed): click = put back
function entriesPage(player, title, head, getEntries, onClick, back, msg) {
  const f = make(title, 5), entries = getEntries();
  f.self = () => entriesPage(player, title, head, getEntries, onClick, back);
  entries.slice(0, 27).forEach((e, i) => set(f, 9 + i, hdr(1) + "§f§l" + e.name + "\n§r§aClick to put back", NAV.player, { run: () => onClick(e) }));
  if (!entries.length) set(f, 1 * COLS + 4, hdr(1) + "§7Nobody here", NAV.ok, null);
  set(f, 0 * COLS + 4, hdr(Math.max(1, entries.length)) + (msg ? msg + "\n§r§8" : "") + head + "\n§r§7" + entries.length + " listed" + (entries.length > 27 ? " (first 27 shown)" : ""), "textures/ui/shop/ic_gear", null);
  backBtn(f, back);
  status(player, f);
  open(player, f);
}
function bannedPage(player, back, msg) {
  if (!can(player, "boards")) return back();
  entriesPage(player, "Banned players", "§c§lBanned from all lists", bannedList, (e) => confirmShort(player, "Unban?", ["§f" + e.name, "§7He appears on the lists again."],
    () => bannedPage(player, back, res(unbanPlayer(player, e.id, e.name), e.name + " was unbanned.")), () => bannedPage(player, back)), back, msg);
}
function hiddenPage(player, key, back, msg) {
  if (!can(player, "boards")) return back();
  entriesPage(player, "Removed: " + LISTS[key].label, "§e§lRemoved from " + LISTS[key].label, () => hiddenList(key), (e) => confirmShort(player, "Put back?", ["§f" + e.name, "§7He appears in the §f" + LISTS[key].label + " §7list again."],
    () => hiddenPage(player, key, back, res(restoreTo(player, key, e.id, e.name), e.name + " is back in the list.")), () => hiddenPage(player, key, back)), back, msg);
}

// ================================================================ find a player (or clan) by name
function lookup(key, text) {
  const q = String(text ?? "").trim().toLowerCase();
  if (!q) return { err: "Type a name." };
  const all = key === "clan" ? topRows("clan", 999).map((r) => ({ id: r.id, name: r.name })) : allRecords().map((r) => ({ id: r.id, name: String(r.name ?? "?") }));
  const exact = all.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return { hit: exact[0] };
  const part = all.filter((r) => r.name.toLowerCase().includes(q));
  if (exact.length > 1 || part.length > 1) return { err: "More than one match for '" + text + "': type the full name." };
  return part.length ? { hit: part[0] } : { err: "No " + (key === "clan" ? "clan" : "player") + " found called '" + text + "'." };
}
function findForm(player, key, back) {
  const form = new ModalFormData().title(key ? "Find in " + LISTS[key].label : "Find a player");
  try { form.textField(key === "clan" ? "§fClan name" : "§fPlayer name", "name", { defaultValue: "" }); } catch (e) { form.textField("§fName", "name"); }
  const acts = key === "clan" ? ["Remove from the clan list"] : key ? ["Remove from " + LISTS[key].label, "BAN from all leaderboards"] : ["BAN from all leaderboards", ...PLAYER_KEYS.map((k) => "Remove from " + LISTS[k].label)];
  try { form.dropdown("§fWhat to do", acts, { defaultValueIndex: 0 }); } catch (e) { form.dropdown("§fWhat to do", acts, 0); }
  showModal(player, form, (v) => {
    if (!v) return back();
    const k = key ?? (Number(v[1]) === 0 ? null : PLAYER_KEYS[Number(v[1]) - 1]);       // null = ban
    const ban = key ? key !== "clan" && Number(v[1]) === 1 : Number(v[1]) === 0;
    const f = lookup(key === "clan" ? "clan" : null, v[0]);
    if (f.err) { player.sendMessage("§c[Leaderboards] " + f.err); return back(); }
    const r = ban ? banPlayer(player, f.hit.id, f.hit.name) : hideFrom(player, k, f.hit.id, f.hit.name);
    player.sendMessage(r.err ? "§c[Leaderboards] " + r.err : "§6[Leaderboards] §a" + f.hit.name + (ban ? " is banned from all leaderboards." : " was removed from the " + LISTS[k].label + " list."));
    back();
  });
}
