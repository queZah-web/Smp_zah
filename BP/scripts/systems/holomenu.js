// 👑 Operator > Leaderboards: place FIXED ranking boards (any list, any place), see them, go to them, remove them.
// Only operators: the page and every action check "is operator" again.  The boards themselves live in hologram.js.
import { system } from "@minecraft/server";
import { COLS, SHORT_ROWS, NAV, hdr, makeOpr as make, set, open, status, backBtn } from "../smp/ui.js";
import { confirmOpr as confirmShort } from "./forms.js";
import { isStaff } from "./opcore.js";
import { teleportTo } from "./util.js";
import { addFixed, removeFixed, listFixed, fixedLimit, boardClick } from "./hologram.js";
import { LISTS, TOP_KEYS } from "./ranks.js";
import { infoHubPage } from "./infohub.js";
import { boardAdminPage } from "./rankadmin.js";
import { can } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";

const ICON = {
  money: "textures/ui/shop/hud_money", clan: "textures/items/name_tag", duel: "textures/items/iron_sword", sell: "textures/items/emerald", buy: "textures/items/diamond",
  play: "textures/ui/shop/hud_time", kills: "textures/ui/shop/hud_kills", shards: "textures/ui/shop/hud_shards", skills: "textures/items/iron_axe", ach: "textures/items/nether_star",
  crown: "textures/ui/shop/ic_crown", compass: "textures/items/compass_item",
};
const guard = (p) => { if (isStaff(p)) return true; try { p.sendMessage(oprMsg(p, "§c[Operator] Operators only.")); } catch (e) { /* ignore */ } return false; };
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const where = (b) => Math.floor(b.x) + ", " + Math.round(b.y) + ", " + Math.floor(b.z) + " §7(" + String(b.d).replace("minecraft:", "") + ")";

/** main page: place a board of every list where you stand */
export function holoPage(player, back) {
  if (!guard(player)) return;
  const f = make("Leaderboards", SHORT_ROWS); f.self = () => holoPage(player, back);
  const n = listFixed().length;
  set(f, 0 * COLS + 4, hdr(Math.max(1, n)) + "§6§lFixed boards\n§r§7Placed: §f" + n + "§7/§f" + fixedLimit() + "\n§r§7Stand where the board should be and\n§r§7click a list: the board is placed at your feet.\n§r§7It stays for ever and updates every minute.", "textures/ui/shop/ic_trophy", null);
  TOP_KEYS.forEach((key, i) => {
    const slot = (1 + Math.floor(i / 5)) * COLS + (i % 5) * 2;
    set(f, slot, hdr(1) + "§e§l" + LISTS[key].label + "\n§r§7Place the §f" + LISTS[key].label + " §7board here\n§r§8" + LISTS[key].sub, ICON[key], {
      run: () => system.run(() => {
        if (!guard(player)) return;
        const b = addFixed(player, key);
        if (b === "full") say(player, "§c[Leaderboards] Too many fixed boards (max " + fixedLimit() + "). Remove one first.");
        else if (!b) say(player, "§c[Leaderboards] Could not place the board.");
        else say(player, "§a[Leaderboards] §f" + LISTS[key].label + " §aboard placed at §f" + where(b) + "§a. Step back to see it.");
        holoPage(player, back);
      }) });
  });
  set(f, 3 * COLS + 4, hdr(Math.max(1, n)) + "§c§lManage boards\n§r§7Go to a board or remove it", NAV.page, { run: () => manageHolos(player, () => holoPage(player, back)) });
  set(f, 3 * COLS + 6, hdr(1) + "§b§lInfo Hub\n§r§7A ring of info boards (name, IP,\n§r§7rules, top admins...) around a\n§r§7spinning centrepiece", "textures/items/nether_star", { run: () => infoHubPage(player, () => holoPage(player, back)) });
  if (can(player, "boards")) set(f, 3 * COLS + 2, hdr(1, "r") + "§c§lLeaderboard control\n§r§7Remove or ban players from\n§r§7any leaderboard", "textures/ui/shop/ic_gear", { run: () => boardAdminPage(player, () => holoPage(player, back)) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

/** the placed boards: click one to go there or remove it */
export function manageHolos(player, back) {
  if (!guard(player)) return;
  const f = make("Fixed Boards", SHORT_ROWS); f.self = () => manageHolos(player, back);
  const list = listFixed();
  list.slice(0, 27).forEach((b, i) => {
    set(f, i, hdr(1) + "§6§l" + (LISTS[b.t]?.label ?? b.t) + "\n§r§7" + where(b) + "\n§r§eClick to manage", ICON[b.t] ?? "textures/ui/shop/ic_trophy", { run: () => boardPage(player, b, () => manageHolos(player, back)) });
  });
  if (!list.length) set(f, 1 * COLS + 4, hdr(1) + "§7No fixed boards yet", "textures/ui/shop/ic_trophy", null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

function boardPage(player, b, back) {
  if (!guard(player)) return;
  const f = make("Board", SHORT_ROWS); f.self = () => boardPage(player, b, back);
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + (LISTS[b.t]?.label ?? b.t) + " board\n§r§7At: §f" + where(b), ICON[b.t] ?? "textures/ui/shop/ic_trophy", null);
  set(f, 1 * COLS + 2, hdr(1) + "§b§lGo there\n§r§7Teleport next to this board", "textures/items/ender_pearl", { run: () => system.run(() => {
    if (!guard(player)) return;
    try { teleportTo(player, { x: b.x, y: b.y, z: b.z + 3 }, b.d); say(player, "§a[Leaderboards] Teleported to the board."); } catch (e) { say(player, "§c[Leaderboards] Teleport failed (the area may not be loaded)."); }
  }) });
  set(f, 1 * COLS + 6, hdr(1, "r") + "§c§lRemove\n§r§7Delete this board", NAV.no, { run: () => confirmShort(player, "Remove this board?", ["§7" + (LISTS[b.t]?.label ?? b.t) + " board at §f" + where(b)], () => {
    if (!guard(player)) return;
    say(player, removeFixed(b.id) ? "§6[Leaderboards] Board removed." : "§c[Leaderboards] Board not found.");
    back();
  }, () => boardPage(player, b, back)) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// SNEAK + tap a fixed board (operators): hologram.js calls this to open the same board page (go there / remove)
boardClick.open = (player, b) => boardPage(player, b, () => { });
