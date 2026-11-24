// LAND PROTECTION - menus (same chest style as the shop):
//   Land Protection  ->  buy a new protection (size -> time) / your protections / protections shared with you
//   a protection     ->  buy time, allowed players, rename, show borders, go there, move up / down in the list, delete
import { world } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { balance } from "../data.js";
import { buyPrice } from "../priceperks.js";
import { money } from "../format.js";
import { SHORT_ROWS, makeShop as make, set, open, hdr, COLS, NAV, NAV_START, backBtn, status } from "../smp/ui.js";
import { showModal, textField, confirmShopShort as confirm } from "./forms.js";
import { canTeleport, stamp, teleportTo, teleportWithFx, dimLabel } from "./util.js";
import { luxProtect } from "../lux.js";
import { SIZES, HOUR, MAX_HOURS, defaultLimit, setDefaultLimit, defaultRate, setSizePrices, resetSizePrices, MAX_LAND_PRICE, MAX_CLAIM_LIMIT, claimLimit, setClaimLimit, customLimits, isAdmin, MAX_TRUSTED, sizeOf, claimsOf, sharedWith, claimById, claimAt, isMember, timeLeft, dur, addMs, priceFor, checkSpot, boxAt, createClaim, renew, GROW, GROW_PACK_H, GROW_MAX_H, growLeft, growLevel, growOf, growPrice, growBlock, buyGrow, deleteClaim, isLocked, rename, move, addTrusted, removeTrusted, findPlayer } from "./landcore.js";
import { showBorders } from "./landguard.js";
import { anchor, isOff, setShown, moveHere, nudge, recentre, dropBoard } from "./landholo.js";
import { can } from "./staffcore.js";           // admins (staff role) can change how many protections a player may own
import { shopMsg, ShopForm } from "./shoplang.js";

const ICON = { s: "textures/ui/shop/i3d_iron_block", m: "textures/ui/shop/i3d_gold_block", l: "textures/ui/shop/i3d_diamond_block", x: "textures/blocks/netherite_block", shield: "textures/ui/shop/ic_shield", player: NAV.player,
  paper: "textures/items/paper", tag: "textures/items/name_tag", compass: "textures/items/compass_item", book: "textures/items/book_writable", star: "textures/items/nether_star", eye: "textures/items/ender_eye" };
const dimOf = (id) => dimLabel(id);
const size = (c) => sizeOf(c.s);
const dims = (c) => size(c).w + "x" + size(c).w + "x" + size(c).h;
const colour = (ms) => (ms < HOUR ? "§c" : ms < 6 * HOUR ? "§e" : "§a");
const where = (c) => ((c.x1 + c.x2) >> 1) + ", " + ((c.y1 + c.y2) >> 1) + ", " + ((c.z1 + c.z2) >> 1);
const rangeTxt = (c) => "X " + c.x1 + " to " + c.x2 + "\n§r§7Y " + c.y1 + " to " + c.y2 + "\n§r§7Z " + c.z1 + " to " + c.z2;
const fail = (p, msg) => p.sendMessage(shopMsg(p, "§c[Protection] " + msg));

// ================================================================ main page
export function landPage(player, back) {
  const mine = claimsOf(player.id), shared = sharedWith(player.id), lim = claimLimit(player.id);
  const f = make("Land Protection", SHORT_ROWS); f.self = () => landPage(player, back);

  set(f, 0 * COLS + 2, hdr(1) + "§b§lWhere am I?\n§r§7Who owns the land you\n§r§7are standing on", ICON.eye, { run: () => { here(player); landPage(player, back); } });
  set(f, 0 * COLS + 4, hdr(1) + "§a§lLand Protection\n§r§7Nobody can break, build, open\n§r§7chests or hit you inside your land.\n§r§7You pay per real hour (max " + MAX_HOURS + "h).\n§r§7You own §f" + mine.length + "§7/§f" + lim + " §7protections", ICON.shield, null);
  set(f, 0 * COLS + 6, hdr(1) + "§e§lHow it works\n§r§71) Stand in the middle of your base\n§r§72) Pick a size and how many hours\n§r§73) Add friends from 'Allowed players'\n§r§7Time runs in REAL time, even offline.\n§r§7When it ends the protection disappears.", "textures/ui/shop/ic_help", null);

  SIZES.forEach((s, i) => {
    set(f, 1 * COLS + [1, 3, 5, 7][i], hdr(1) + "§" + ["f", "6", "b", "d"][i] + "§l" + s.name + " §r§7" + s.w + "x" + s.w + "x" + s.h + "\n§r§7Price: §a" + money(Math.ceil(s.rate)) + " §7per hour\n§r§7Full " + MAX_HOURS + "h: §a" + money(Math.ceil(s.rate * MAX_HOURS)) + "\n§r§eClick to buy", ICON[s.key], { run: () => durationPage(player, s, back) });
  });

  set(f, 4 * COLS + 3, hdr(1) + "§f§lYour protections §7(" + mine.length + "/" + lim + ")\n§r§7" + (mine.length ? "Click one to manage it" : "You have none yet - buy one above"), NAV.shield, null);
  mine.slice(0, MAX_CLAIM_LIMIT).forEach((c, i) => {
    const left = timeLeft(c);
    set(f, 2 * COLS + i, hdr(1, left < HOUR ? "r" : "g") + "§f§l" + c.n + "\n§r§7" + dims(c) + " §8| §7" + dimOf(c.d) + "\n§r§7Time left: " + colour(left) + dur(left) + "\n§r§7Centre: §f" + where(c) + (c.o && Object.keys(c.t).length ? "\n§r§7Allowed players: §f" + Object.keys(c.t).length : "") + "\n§r§eClick to manage", ICON[c.s], { run: () => managePage(player, c.id, back) });
  });
  if (shared.length) {
    if (mine.length > 9) set(f, 4 * COLS + 5, hdr(Math.min(99, shared.length)) + "§f§lShared with you\n§r§7Land where you are allowed\n§r§eClick to open the list", NAV.player, { run: () => sharedPage(player, back) });
    else {
      set(f, 4 * COLS + 5, hdr(1) + "§f§lShared with you\n§r§7Land where you are allowed", NAV.player, null);
      shared.slice(0, 9).forEach((c, i) => set(f, 3 * COLS + i, hdr(1) + "§f§l" + c.n + "\n§r§7Owner: §f" + c.on + "\n§r§7" + dims(c) + "\n§r§7Time left: " + colour(timeLeft(c)) + dur(timeLeft(c)) + "\n§r§eClick for details", ICON[c.s], { run: () => managePage(player, c.id, back) }));
    }
  }
  if (canSetLimits(player)) set(f, 0 * COLS + 0, hdr(1) + "§6§lLand prices\n§r§7Small: §a" + money(Math.ceil(SIZES[0].rate)) + "\n§r§7Medium: §a" + money(Math.ceil(SIZES[1].rate)) + "\n§r§7Large: §a" + money(Math.ceil(SIZES[2].rate)) + "\n§r§7Huge: §a" + money(Math.ceil(SIZES[3].rate)) + "\n§r§7(per hour, for ALL lands)\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => priceForm(player, back) });
  if (canSetLimits(player)) set(f, 0 * COLS + 8, hdr(1) + "§6§lProtection limits\n§r§7How many protections each\n§r§7player can own (now: §f" + defaultLimit() + " §7for everybody)\n§r§eAdmins only - click to open", ICON.star, { run: () => limitsPage(player, back) });
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}
/** chat answer for "Where am I?" */
function here(p) {
  const l = p.location, c = claimAt(p.dimension.id, l.x, l.y + 0.1, l.z);
  if (!c) return p.sendMessage(shopMsg(p, "§7[Protection] This land is §fnot protected§7."));
  p.sendMessage(shopMsg(p, "§e[Protection] §f" + c.n + " §7- owner §f" + c.on + " §7- " + dims(c) + " §7- time left §f" + dur(timeLeft(c)) + (isMember(c, p) ? " §a(you can build here)" : " §c(you can't build here)")));
  showBorders(p, c, 8);
}

// ================================================================ buy a new protection: how long?
function durationPage(player, sz, back) {
  const f = make("Buy " + sz.name + " Protection", SHORT_ROWS); f.self = () => durationPage(player, sz, back);
  const err = checkSpot(player, sz), b = boxAt(sz, player.location);
  set(f, 0 * COLS + 4, hdr(1) + "§" + (err ? "c" : "a") + "§l" + sz.name + " §r§7" + sz.w + "x" + sz.w + "x" + sz.h + "\n§r§7Price: §a" + money(Math.ceil(sz.rate)) + " §7per hour\n§r" +
    (err ? "§c" + err : "§7It will be centred on your position:\n§r§7X " + b.x1 + " to " + b.x2 + "\n§r§7Y " + b.y1 + " to " + b.y2 + "\n§r§7Z " + b.z1 + " to " + b.z2), ICON[sz.key], null);
  if (!err) {
    [["1", "1 hour"], ["12", "12 hours"], ["24", "24 hours"]].forEach(([mode, label], i) => {
      const cost = buyPrice(player, priceFor(sz, addMs(0, mode)), 0);
      set(f, 1 * COLS + 2 + i * 2, hdr(Number(mode)) + "§a§l" + label + "\n§r§7Cost: §a" + money(cost) + "\n§r" + (balance(player) >= cost ? "§eClick to buy" : "§cNot enough money"), ICON[sz.key], { run: () => buyConfirm(player, sz, mode, label, cost, back) });
    });
    set(f, 3 * COLS + 4, hdr(1) + "§b§lPreview the area\n§r§7Shows the borders around you\n§r§7for a few seconds", ICON.eye, { run: () => { showBorders(player, { ...b, d: player.dimension.id }, 10); durationPage(player, sz, back); } });
  }
  backBtn(f, () => landPage(player, back));
  status(player, f);
  open(player, f);
}
function buyConfirm(player, sz, mode, label, cost, back) {
  if (balance(player) < cost) { fail(player, "Not enough money. You need " + money(cost) + "."); return durationPage(player, sz, back); }
  const b = boxAt(sz, player.location);
  confirm(player, "Buy protection", [
    "§f" + sz.name + " " + sz.w + "x" + sz.w + "x" + sz.h + " §7for §f" + label,
    "§7Cost: §a" + money(cost),
    "§7Centred on you: X " + b.x1 + "-" + b.x2 + "  Z " + b.z1 + "-" + b.z2,
    "§7Stand exactly where you want it!",
  ], () => {
    const r = createClaim(player, sz.key, mode);
    if (r.err) { fail(player, r.err); return durationPage(player, sz, back); }
    player.sendMessage(shopMsg(player, "§a[Protection] §f" + r.claim.n + " §ais now protected for §f" + dur(r.ms) + " §a(paid " + money(r.cost) + "). Open §f/protect §ato manage it."));
    luxProtect("buy", player.dimension, player.location);
    showBorders(player, r.claim, 10);
    managePage(player, r.claim.id, back);
  }, () => durationPage(player, sz, back));
}

// ================================================================ one protection
export function managePage(player, id, back) {
  const c = claimById(id);
  if (!c) { fail(player, "This protection no longer exists."); return landPage(player, back); }
  const owner = c.o === player.id, left = timeLeft(c), sz = size(c), self = () => managePage(player, id, back);
  const f = make(c.n, SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§f§l" + c.n + "\n§r§7Owner: §f" + c.on + "\n§r§7" + sz.name + " " + dims(c) + " §8| §7" + dimOf(c.d) + "\n§r§7" + rangeTxt(c) + "\n§r§7Time left: " + colour(left) + dur(left) + " §8(max " + MAX_HOURS + "h)\n§r§7Allowed players: §f" + Object.keys(c.t).length + (growLevel(c) ? "\n§r§7Fast growth: §a" + growOf(growLevel(c)).name + " §7x" + growOf(growLevel(c)).x + " §8(" + dur(growLeft(c)) + ")" : ""), ICON[c.s], null);

  if (owner) {
    // buy time - exact price: you only pay for the time you really get
    [["1", "+1 hour", "Adds 1 hour"], ["12", "Up to 12 hours", "Fills the time up to 12h"], ["24", "Up to 24 hours", "Fills the time up to 24h (max)"]].forEach(([mode, label, tip], i) => {
      const add = addMs(left, mode), cost = buyPrice(player, priceFor(sz, add), 0), slot = 1 * COLS + 2 + i * 2;
      if (add <= 0) set(f, slot, hdr(1, "r") + "§c§l" + label + "\n§r§7" + (mode === "1" || mode === "24" ? "Already at the maximum (" + MAX_HOURS + "h)" : "You already have 12h or more"), NAV.no, null);
      else set(f, slot, hdr(Number(mode)) + "§a§l" + label + "\n§r§7" + tip + "\n§r§7You get: §f+" + dur(add) + "\n§r§7Cost: §a" + money(cost) + "\n§r" + (balance(player) >= cost ? "§eClick to buy" : "§cNot enough money"), ICON[c.s], {
        run: () => { const r = renew(player, c, mode); if (r.err) fail(player, r.err); else { player.sendMessage(shopMsg(player, "§a[Protection] §f" + c.n + " §a+" + dur(r.ms) + " for " + money(r.cost) + " §7- time left §f" + dur(timeLeft(c)))); luxProtect("renew", player.dimension, player.location); } self(); } });
    });
    set(f, 2 * COLS + 1, hdr(Object.keys(c.t).length) + "§b§lAllowed players\n§r§7Friends who can build, open\n§r§7and fight here", ICON.player, { run: () => trustedPage(player, id, back) });
    set(f, 2 * COLS + 3, hdr(1) + "§e§lRename\n§r§7Give it a name", ICON.tag, { run: () => renamePage(player, id, back) });
    set(f, 2 * COLS + 5, hdr(1) + "§d§lShow borders\n§r§7See the edges for a few seconds", ICON.eye, { run: () => { showBorders(player, c, 15); player.sendMessage(shopMsg(player, "§7[Protection] Showing the borders of §f" + c.n + "§7.")); self(); } });
    set(f, 2 * COLS + 7, hdr(1) + "§a§lGo there\n§r§7Teleport to where you bought it", "textures/items/ender_pearl", { run: () => go(player, c) });
    set(f, 3 * COLS + 4, hdr(1) + "§a§lFast Growth\n§r§7Crops in this land grow faster\n§r§7Now: " + (growLevel(c) ? "§a" + growOf(growLevel(c)).name + " §7(" + dur(growLeft(c)) + ")" : "§cOff") + "\n§r§eClick to open", "textures/items/wheat", { run: () => growPage(player, id, back) });
    set(f, 3 * COLS + 8, hdr(1) + "§b§lHologram\n§r§7The info board in the middle\n§r§7Now: " + (isOff(c) ? "§cHidden" : "§aShown") + "\n§r§eClick to open", ICON.paper, { run: () => holoPage(player, id, back) });
    const list = claimsOf(c.o), i = list.indexOf(c);
    if (i > 0) set(f, 3 * COLS + 0, hdr(1) + "§7§lMove up\n§r§7Higher in your list", "textures/ui/shop/nav_prev", { run: () => { move(c, -1); self(); } });
    if (i >= 0 && i < list.length - 1) set(f, 3 * COLS + 2, hdr(1) + "§7§lMove down\n§r§7Lower in your list", "textures/ui/shop/nav_next", { run: () => { move(c, 1); self(); } });
    if (isLocked(c)) set(f, 3 * COLS + 6, hdr(1, "r") + "§6§lLocked by the Owner\n§r§7This protection can't be deleted\n§r§7or broken by anybody.\n§r§7Only the Owner can unlock it.", NAV.no, null);
    else set(f, 3 * COLS + 6, hdr(1, "r") + "§c§lDelete protection\n§r§7Removes it for good\n§r§7(no refund)", "textures/ui/shop/i3d_tnt", { run: () => confirm(player, "Delete protection", ["§f" + c.n + " §7(" + dims(c) + ")", "§cThe land will be unprotected at once.", "§cYour remaining time is lost - no refund."], () => { if (isLocked(c)) { fail(player, "This protection is locked by the Owner."); return self(); } dropBoard(c); deleteClaim(c); player.sendMessage(shopMsg(player, "§c[Protection] §f" + c.n + " §cwas deleted.")); landPage(player, back); }, self) });
  } else {
    set(f, 1 * COLS + 4, hdr(1) + "§a§lYou are allowed here\n§r§7You can build, open and fight\n§r§7on this land, like the owner.", NAV.ok, null);
    set(f, 2 * COLS + 3, hdr(1) + "§d§lShow borders\n§r§7See the edges for a few seconds", ICON.eye, { run: () => { showBorders(player, c, 15); self(); } });
    set(f, 2 * COLS + 5, hdr(1) + "§a§lGo there\n§r§7Teleport to the land", "textures/items/ender_pearl", { run: () => go(player, c) });
  }
  backBtn(f, () => landPage(player, back));
  status(player, f);
  open(player, f);
}
// ================================================================ info hologram
function holoPage(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const f = make("Hologram", SHORT_ROWS); f.self = () => holoPage(player, id, back);
  const again = () => holoPage(player, id, back), off = isOff(c), a = anchor(c);
  set(f, 0 * COLS + 4, hdr(1) + "§b§lInfo hologram - " + c.n + "\n§r§7A floating board in the middle of your land:\n§r§7name, owner, size, time left, allowed players\n§r§7and fast growth.\n§r§7Now: " + (off ? "§cHidden" : "§aShown") + "\n§r§7Position: §f" + Math.round(a.x) + ", " + Math.round(a.y) + ", " + Math.round(a.z), ICON.paper, null);
  set(f, 2 * COLS + 1, hdr(1) + "§a§lMove here\n§r§7Put it where you stand now\n§r§7(you must be inside the land)", "textures/items/ender_pearl", { run: () => { const err = moveHere(c, player); if (err) fail(player, err); else player.sendMessage(shopMsg(player, "§a[Protection] §fHologram moved here.")); again(); } });
  set(f, 2 * COLS + 3, hdr(1) + "§e§lRaise\n§r§7Half a block up", "textures/ui/shop/nav_prev", { run: () => { nudge(c, 0.5); again(); } });
  set(f, 2 * COLS + 5, hdr(1) + "§e§lLower\n§r§7Half a block down", "textures/ui/shop/nav_next", { run: () => { nudge(c, -0.5); again(); } });
  set(f, 2 * COLS + 7, hdr(1) + "§7§lMiddle of the land\n§r§7Back to the first place", ICON.shield, { run: () => { recentre(c); player.sendMessage(shopMsg(player, "§a[Protection] §fHologram is back in the middle.")); again(); } });
  if (off) set(f, 3 * COLS + 4, hdr(1, "g") + "§a§lShow hologram\n§r§7Put the board back", NAV.ok, { run: () => { setShown(c, true); player.sendMessage(shopMsg(player, "§a[Protection] §fHologram is shown.")); again(); } });
  else set(f, 3 * COLS + 4, hdr(1, "r") + "§c§lRemove hologram\n§r§7Hide the board (you can\n§r§7show it again here)", NAV.no, { run: () => { setShown(c, false); player.sendMessage(shopMsg(player, "§e[Protection] §fHologram hidden.")); again(); } });
  backBtn(f, () => managePage(player, id, back));
  status(player, f);
  open(player, f);
}
// ================================================================ fast growth
function growPage(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const f = make("Fast Growth", SHORT_ROWS); f.self = () => growPage(player, id, back);
  const again = () => growPage(player, id, back), left = growLeft(c), cur = growLevel(c), bal = balance(player);
  set(f, 0 * COLS + 4, hdr(1) + "§a§lFast Growth - " + c.n + "\n§r§7Only crops inside THIS land grow faster.\n§r§7Crops, saplings (grow into trees), sugar cane,\n§r§7cactus, bamboo, cocoa, nether wart, stems.\n§r§7Baby animals here grow up faster too.\n§r§7Now: " + (cur ? "§a" + growOf(cur).name + " §7x" + growOf(cur).x + " - " + dur(left) + " left" : "§cOff") + "\n§r§7Each purchase = +" + GROW_PACK_H + " hours (max " + GROW_MAX_H + "h)", "textures/items/wheat", null);
  const icons = ["textures/items/carrot", "textures/items/potato", "textures/items/wheat", "textures/items/bread", "textures/items/emerald"];
  GROW.forEach((g, i) => {
    const price = buyPrice(player, growPrice(c, g.lv), 0), why = growBlock(c, g.lv), slot = 2 * COLS + i * 2;
    if (why) set(f, slot, hdr(1, "r") + "§c§l" + g.name + " §7x" + g.x + "\n§r§7Price: §a" + money(price) + " §7for " + GROW_PACK_H + "h\n§r§c" + why, NAV.no, null);
    else set(f, slot, hdr(g.lv, bal >= price ? "g" : "r") + "§a§l" + g.name + " §7x" + g.x + " speed\n§r§7Plants and baby animals grow\n§r§7about " + g.x + " times faster\n§r§7+" + GROW_PACK_H + " hours for §a" + money(price) + "\n§r§7(" + money(growPrice(c, g.lv) / GROW_PACK_H) + " per hour)\n§r" + (bal >= price ? "§eClick to buy" : "§cNot enough money"), icons[i], {
      run: () => confirm(player, "Buy Fast Growth", ["§f" + g.name + " §7x" + g.x + " - " + c.n, "§7Time: §f+" + GROW_PACK_H + " hours (real time)", "§7Cost: §a" + money(price), "§7Your balance: §a" + money(bal)],
        () => { const r = buyGrow(player, c, g.lv); if (r.err) fail(player, r.err); else player.sendMessage(shopMsg(player, "§a[Growth] §f" + g.name + " §a+" + GROW_PACK_H + "h on §f" + c.n + " §afor " + money(r.cost) + " §7- time left §f" + dur(growLeft(c)))); again(); }, again) });
  });
  backBtn(f, () => managePage(player, id, back));
  status(player, f);
  open(player, f);
}

function go(p, c) {
  if (!canTeleport(p, "home")) return;
  teleportWithFx(p, c.sp, c.d, "home",                           // same swirl + sounds as /rtp
    () => p.sendMessage(shopMsg(p, "§a[Protection] Teleported to §f" + c.n + "§a.")),
    () => fail(p, "Teleport failed."));
}

// ================================================================ rename
function renamePage(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const form = new ShopForm().title("Rename protection");
  textField(form, "§fNew name §7(2-20 characters)", c.n);
  showModal(player, form, (v) => {
    if (v && String(v[0] ?? "").trim()) { const err = rename(c, v[0]); if (err) fail(player, err); else player.sendMessage(shopMsg(player, "§a[Protection] Renamed to §f" + c.n + "§a.")); }
    managePage(player, id, back);
  });
}

// ================================================================ allowed players
function trustedPage(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const f = make("Allowed players", SHORT_ROWS); f.self = () => trustedPage(player, id, back);
  const ids = Object.keys(c.t);
  ids.forEach((pid, i) => set(f, i, hdr(1) + "§f§l" + c.t[pid] + "\n§r§7Can build, open and fight here\n§r§cClick to remove", NAV.player, {
    run: () => { removeTrusted(c, pid); player.sendMessage(shopMsg(player, "§e[Protection] §f" + c.t[pid] + " §ewas removed from the allowed players.")); trustedPage(player, id, back); } }));
  if (!ids.length) set(f, 4, hdr(1) + "§7§lNobody yet\n§r§7Add friends below", NAV.page, null);
  set(f, 3 * COLS + 2, hdr(1) + "§a§lAdd online player\n§r§7Pick from the players\n§r§7who are online now", NAV.ok, { run: () => addOnlinePage(player, id, back) });
  set(f, 3 * COLS + 6, hdr(1) + "§b§lAdd by name\n§r§7Type the name (works for\n§r§7players who are offline)", ICON.tag, { run: () => addByName(player, id, back) });
  set(f, 2 * COLS + 4, hdr(1) + "§e§lAllowed: §f" + ids.length + "§7/§f" + MAX_TRUSTED + "\n§r§7Allowed players have the same rights\n§r§7as you on this land, except buying,\n§r§7renaming and deleting it.", NAV.page, null);
  backBtn(f, () => managePage(player, id, back));
  status(player, f);
  open(player, f);
}
function addOnlinePage(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const f = make("Add player", SHORT_ROWS); f.self = () => addOnlinePage(player, id, back);
  const list = world.getAllPlayers().filter((x) => x.id !== player.id && !c.t[x.id]);
  list.slice(0, 36).forEach((x, i) => set(f, i, hdr(1) + "§f§l" + x.name + "\n§r§aClick to allow", NAV.player, { run: () => {
    const err = addTrusted(c, x.id, x.name);
    if (err) fail(player, err); else { player.sendMessage(shopMsg(player, "§a[Protection] §f" + x.name + " §ais now allowed on §f" + c.n + "§a.")); try { x.sendMessage(shopMsg(x, "§a[Protection] §f" + player.name + " §aallowed you on their land §f" + c.n + "§a.")); } catch (e) { /* ignore */ } }
    trustedPage(player, id, back);
  } }));
  if (!list.length) set(f, 1 * COLS + 4, hdr(1) + "§7§lNo one to add\n§r§7Nobody else is online.\n§r§7Use 'Add by name' instead.", NAV.page, null);
  backBtn(f, () => trustedPage(player, id, back));
  open(player, f);
}
function addByName(player, id, back) {
  const c = claimById(id); if (!c || c.o !== player.id) return landPage(player, back);
  const form = new ShopForm().title("Add by name");
  textField(form, "§fPlayer name §7(exactly as in game)", "e.g. Steve");
  showModal(player, form, (v) => {
    if (v && String(v[0] ?? "").trim()) {
      const t = findPlayer(v[0]);
      if (!t) fail(player, "I don't know a player called \"" + String(v[0]).trim() + "\" (they must have joined this world once).");
      else { const err = addTrusted(c, t.id, t.name); if (err) fail(player, err); else player.sendMessage(shopMsg(player, "§a[Protection] §f" + t.name + " §ais now allowed on §f" + c.n + "§a.")); }
    }
    trustedPage(player, id, back);
  });
}

// ================================================================ the protections of other players that you may use (when you own 10 or more)
function sharedPage(player, back) {
  const f = make("Shared with you", SHORT_ROWS); f.self = () => sharedPage(player, back);
  const list = sharedWith(player.id);
  list.slice(0, 36).forEach((c, i) => set(f, i, hdr(1) + "§f§l" + c.n + "\n§r§7Owner: §f" + c.on + "\n§r§7" + dims(c) + "\n§r§7Time left: " + colour(timeLeft(c)) + dur(timeLeft(c)) + "\n§r§eClick for details", ICON[c.s], { run: () => managePage(player, c.id, () => sharedPage(player, back)) }));
  if (!list.length) set(f, 1 * COLS + 4, hdr(1) + "§7§lNothing shared with you", NAV.page, null);
  backBtn(f, () => landPage(player, back));
  status(player, f);
  open(player, f);
}

// ================================================================ admin: how many protections each player may own
// Everybody can own defaultLimit() (landcore.js).  Here an admin (staff role Admin / Owner, or the Land admin tag) changes it for one player.
const canSetLimits = (p) => { try { return isAdmin(p) || can(p, "landlimit"); } catch (e) { return false; } };
function limitsPage(player, back) {
  if (!canSetLimits(player)) return landPage(player, back);
  const f = make("Protection limits", SHORT_ROWS); f.self = () => limitsPage(player, back);
  const list = customLimits();
  set(f, 0 * COLS + 4, hdr(1) + "§6§lProtections per player\n§r§7Everybody can own §f" + defaultLimit() + " §7protections.\n§r§7Give a player more (or fewer) here.\n§r§7Most you can give: §f" + MAX_CLAIM_LIMIT, ICON.shield, null);
  set(f, 1 * COLS + 4, hdr(1) + "§e§lALL players\n§r§7One limit for every player\n§r§7(now: §f" + defaultLimit() + "§7)\n§r§eClick to change", ICON.star, { run: () => allLimitForm(player, back) });
  set(f, 1 * COLS + 2, hdr(1) + "§a§lOnline player\n§r§7Pick a player who is online", ICON.player, { run: () => limitPickPage(player, back) });
  set(f, 1 * COLS + 6, hdr(1) + "§b§lBy name\n§r§7Type the name (works for\n§r§7players who are offline)", ICON.tag, { run: () => limitByName(player, back) });
  list.slice(0, 18).forEach((x, i) => set(f, 2 * COLS + i, hdr(Math.min(99, Math.max(1, x.n))) + "§f§l" + x.name + "\n§r§7Limit: §a" + x.n + " §8(normal " + defaultLimit() + ")\n§r§7Owns now: §f" + claimsOf(x.id).length + "\n§r§eClick to change", ICON.player, { run: () => limitForm(player, x.id, x.name, back) }));
  if (!list.length) set(f, 2 * COLS + 4, hdr(1) + "§7§lNo special limits\n§r§7Every player has " + defaultLimit(), NAV.page, null);
  backBtn(f, () => landPage(player, back));
  status(player, f);
  open(player, f);
}
function limitPickPage(player, back) {
  if (!canSetLimits(player)) return landPage(player, back);
  const f = make("Pick a player", SHORT_ROWS); f.self = () => limitPickPage(player, back);
  world.getAllPlayers().slice(0, 36).forEach((x, i) => set(f, i, hdr(1) + "§f§l" + x.name + "\n§r§7Limit: §a" + claimLimit(x.id) + " §7| owns §f" + claimsOf(x.id).length + "\n§r§eClick to change", NAV.player, { run: () => limitForm(player, x.id, x.name, back) }));
  backBtn(f, () => limitsPage(player, back));
  status(player, f);
  open(player, f);
}
function limitByName(player, back) {
  const form = new ShopForm().title("Protections: by name");
  textField(form, "§fPlayer name §7(exactly as in game)", "e.g. Steve");
  showModal(player, form, (v) => {
    if (v && String(v[0] ?? "").trim()) {
      const t = findPlayer(v[0]);
      if (!t) { fail(player, "I don't know a player called \"" + String(v[0]).trim() + "\" (they must have joined this world once)."); return limitsPage(player, back); }
      return limitForm(player, t.id, t.name, back);
    }
    limitsPage(player, back);
  });
}
function limitForm(player, id, name, back) {
  if (!canSetLimits(player)) return landPage(player, back);
  const form = new ShopForm().title("Protections: " + name);
  textField(form, "§fHow many protections can §e" + name + " §fown?\n§7Now: §f" + claimLimit(id) + " §7| owns: §f" + claimsOf(id).length + " §7| normal: §f" + defaultLimit() + "\n§7Write a number from 0 to " + MAX_CLAIM_LIMIT, String(claimLimit(id)));
  showModal(player, form, (v) => {
    const raw = v ? String(v[0] ?? "").trim() : "";
    if (raw) {
      if (!/^[0-9]{1,3}$/.test(raw)) fail(player, "Write a number from 0 to " + MAX_CLAIM_LIMIT + ".");
      else {
        const err = setClaimLimit(id, name, Number(raw));
        if (err) fail(player, err);
        else {
          const n = claimLimit(id);
          player.sendMessage(shopMsg(player, "§a[Protection] §f" + name + " §acan now own §f" + n + " §aprotections" + (n === defaultLimit() ? " §7(normal)" : "") + "§a."));
          for (const x of world.getAllPlayers()) if (x.id === id && x.id !== player.id) { try { x.sendMessage(shopMsg(x, "§a[Protection] You can now own §f" + n + " §aprotections.")); } catch (e) { /* ignore */ } }
        }
      }
    }
    limitsPage(player, back);
  });
}

// ---- the same limit for EVERY player (e.g. 1 = everybody can own only one land)
function allLimitForm(player, back) {
  if (!canSetLimits(player)) return landPage(player, back);
  const form = new ShopForm().title("Protections: ALL players");
  textField(form, "§fHow many protections can §eEVERY player §fown?\n§7Now: §f" + defaultLimit() + "\n§7Write a number from 0 to " + MAX_CLAIM_LIMIT + "\n§7This also replaces the special limits of single players.\n§7Lands players already own are not removed.", String(defaultLimit()));
  showModal(player, form, (v) => {
    const raw = v ? String(v[0] ?? "").trim() : "";
    if (raw) {
      if (!/^[0-9]{1,3}$/.test(raw)) fail(player, "Write a number from 0 to " + MAX_CLAIM_LIMIT + ".");
      else {
        const err = setDefaultLimit(Number(raw));
        if (err) fail(player, err);
        else {
          const n = defaultLimit();
          player.sendMessage(shopMsg(player, "§a[Protection] §fEvery player §acan now own §f" + n + " §aprotection" + (n === 1 ? "" : "s") + "§a."));
          for (const x of world.getAllPlayers()) if (x.id !== player.id) { try { x.sendMessage(shopMsg(x, "§a[Protection] Every player can now own §f" + n + " §aprotection" + (n === 1 ? "" : "s") + "§a.")); } catch (e) { /* ignore */ } }
        }
      }
    }
    limitsPage(player, back);
  });
}

// ================================================================ admin: price of the lands (per hour, the same for every land of a size)
function priceForm(player, back) {
  if (!canSetLimits(player)) return landPage(player, back);
  const form = new ShopForm().title("Land prices");
  SIZES.forEach((z) => textField(form, "§f" + z.name + " " + z.w + "x" + z.w + "x" + z.h + " §7- price per hour\n§7Now: §a" + money(Math.ceil(z.rate)) + " §7| normal: §f" + money(defaultRate(z.key)) + "\n§7Whole number, 1 to " + MAX_LAND_PRICE, String(z.rate)));
  try { form.toggle("§eReset all three to the normal prices", { defaultValue: false }); } catch (e) { form.toggle("§eReset all three to the normal prices", false); }
  showModal(player, form, (v) => {
    if (!v) return landPage(player, back);
    if (v[SIZES.length] === true) {
      const err = resetSizePrices();
      if (err) fail(player, err); else player.sendMessage(shopMsg(player, "§a[Protection] Land prices are back to the normal prices."));
      return landPage(player, back);
    }
    const next = {};
    let any = false;
    SIZES.forEach((z, i) => { const raw = String(v[i] ?? "").trim(); next[z.key] = raw === "" ? z.rate : raw; if (raw !== "") any = true; });
    if (!any) return landPage(player, back);
    for (const z of SIZES) if (!/^[0-9]{1,8}$/.test(String(next[z.key]))) { fail(player, "Prices must be whole numbers from 1 to " + MAX_LAND_PRICE + "."); return landPage(player, back); }
    const err = setSizePrices(next);
    if (err) fail(player, err);
    else player.sendMessage(shopMsg(player, "§a[Protection] New land prices (per hour): " + SIZES.map((z) => "§f" + z.name + " §a" + money(Math.ceil(z.rate))).join("§7, ") + "§a."));
    landPage(player, back);
  });
}
