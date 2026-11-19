// AUCTION HOUSE pages (/ah). The rules and the data are in systems/auction.js.
// Main page (9-row chest): rows 1-7 = 63 listings of the page, row 8 = Sell / My listings / Sort / Category / Search, row 9 = Back / balance / Refresh / pages.
import { system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { COLS, SHORT_ROWS, NAV, hdr, make, set, open, status, backBtn } from "./ui.js";

const ARROW = "textures/items/arrow";                    // the arrow of the game: Back and the page buttons
function arrowBack(f, fn, slot = (f.rows - 1) * COLS) { set(f, slot, hdr(1) + "§c§lBack", ARROW, { run: fn }); }
import { money } from "../format.js";
import { CATEGORIES } from "../shop_data.js";
import { realId } from "../alias.js";
import { container } from "../inv.js";
import { isStaff } from "../systems/opcore.js";
import { showModal, textField, confirmShort } from "../systems/forms.js";
import { parseAmount } from "../systems/pay.js";
import {
  setCatalog, categories, HEARTS_CAT, iconOf, nameOf, itemTitle, SORTS, browse, mine, getListing, isLive, endedCount, packItem, sellHeld, buy, takeBack, takeAllEnded, staffEnd,
  DURATION_HOURS, MAX_PER_PLAYER, TAX_PERCENT, MAX_PRICE,
} from "../systems/auction.js";
import { menuMsg, MenuForm } from "../systems/menulang.js";

setCatalog(CATEGORIES, realId);

const PER_PAGE = 45;                       // 5 rows of listings, the 6th row = the buttons (like DonutSMP)
const BAR = 5 * COLS;
const clean = (t) => String(t).replace(/§./g, "");
const say = (p, t) => { try { p.sendMessage(menuMsg(p, t)); } catch (e) { /* ignore */ } };

function leftText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
  return h >= 24 ? Math.floor(h / 24) + "d " + (h % 24) + "h" : h > 0 ? h + "h " + (m % 60) + "m" : Math.max(1, m) + "m";
}
const unitText = (r) => (r.it.a > 1 ? " §8(" + money(Math.max(1, Math.round(r.p / r.it.a))) + " each)" : "");

/** the tooltip lines of an item (enchantments, lore, damage) */
function detail(it) {
  let t = "";
  if (it.n) t += "\n§r§7Named: §f" + clean(it.n);
  if (it.en) {
    t += it.en.slice(0, 6).map((e) => "\n§r§b" + e[0].replace(/_/g, " ") + " " + e[1]).join("");
    if (it.en.length > 6) t += "\n§r§7+" + (it.en.length - 6) + " more enchantments";
  }
  if (it.d) t += "\n§r§7Damaged: §f" + it.d;
  if (it.l) t += it.l.slice(0, 3).map((l) => "\n§r§8" + clean(l)).join("");
  return t;
}
function listingText(p, r, mod) {
  const own = r.s === p.id;
  return hdr(r.it.a, own ? "g" : "c") + "§f" + itemTitle(r).replace(/ x\d+$/, "") + (own ? " §e(yours)" : "") + detail(r.it) +
    "\n§r§7Seller: §f" + r.n + "\n§r§7Price: §a" + money(r.p) + unitText(r) + "\n§r§7Ends in: §f" + leftText(r.e - Date.now()) +
    "\n§r" + (mod ? "§cClick to remove (staff)" : own ? "§eClick to take it back" : "§eClick to buy");
}

// ================================================================ main page
// bottom row:  < previous | Back | Category | Sort | Refresh | Search | My listings | Sell | next >
export function ahPage(player, back, st) {
  st = st ?? { page: 0, sort: "new", cat: "all", q: "", mod: false };
  const list = browse(st.sort, st.cat, st.q);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  st.page = Math.max(0, Math.min(st.page, pages - 1));
  const f = make("Auction House", 6); f.self = () => ahPage(player, back, st); f.noRefresh = true;
  const mod = st.mod && isStaff(player);
  list.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE).forEach((r, i) => {
    set(f, i, listingText(player, r, mod), iconOf(r.it.t), { run: () => (mod ? staffRemove(player, r.i, back, st) : r.s === player.id ? ownClick(player, r.i, back, st) : buyPage(player, r.i, back, st)) });
  });
  if (!list.length) set(f, 2 * COLS + 4, hdr(1) + "§7Nothing for sale here\n§r§7" + (st.q || st.cat !== "all" ? "Change the search or the category." : "Be the first: click the gold ingot to sell."), NAV.chest, null);

  const mineAll = mine(player.id), ended = endedCount(player.id);
  const info = "\n§r§7Page §f" + (st.page + 1) + "§7/§f" + pages + " §8(" + list.length + " item" + (list.length === 1 ? "" : "s") + ")";
  if (st.page > 0) set(f, BAR + 0, hdr(1) + "§a§l< Previous page" + info, ARROW, { run: () => { st.page--; ahPage(player, back, st); } });
  arrowBack(f, back ?? (() => { }), BAR + 1);
  const cname = st.cat === "all" ? "All items" : st.cat === "other" ? "Other" : st.cat === "potions" ? "Potions" : (categories().find((c) => c.id === st.cat) ?? { name: st.cat }).name;
  set(f, BAR + 2, hdr(1) + "§d§lCategory\n§r§7Now: §f" + cname + "\n§r§eClick to choose", "textures/items/cauldron", { run: () => catPage(player, back, st) });
  const so = SORTS.find((s) => s.key === st.sort) ?? SORTS[0];
  set(f, BAR + 3, hdr(1) + "§b§lSort\n§r§7Now: §f" + so.label + "\n§r§eClick to change", "textures/ui/shop/i3d_hopper", { run: () => { st.sort = SORTS[(SORTS.indexOf(so) + 1) % SORTS.length].key; st.page = 0; ahPage(player, back, st); } });
  set(f, BAR + 4, hdr(1) + "§b§lRefresh\n§r§7Update the prices and times", "textures/ui/shop/i3d_anvil", { run: () => ahPage(player, back, st) });
  set(f, BAR + 5, hdr(1, st.q ? "g" : "c") + "§6§lSearch\n§r§7" + (st.q ? "Now: §f" + st.q + "\n§r§eClick to change or clear" : "Find an item, enchantment\n§r§7or seller by name"), "textures/items/sign", { run: () => system.run(() => searchPage(player, back, st)) });
  set(f, BAR + 6, hdr(mineAll.length) + "§e§lMy listings\n§r§7" + mineAll.length + "/" + MAX_PER_PLAYER + " listings" + (ended ? "\n§r§a" + ended + " ended - take back" : ""), NAV.chest, { run: () => minePage(player, back, st) });
  set(f, BAR + 7, hdr(1, "g") + "§a§lSell an item\n§r§7Pick it from your inventory, choose a price\n§r§7Lasts " + DURATION_HOURS + " hours\n§r§8/ah sell <price>", "textures/items/gold_ingot", { run: () => system.run(() => sellPicker(player, back, st)) });
  if (st.page < pages - 1) set(f, BAR + 8, hdr(1) + "§a§lNext page >" + info, ARROW, { run: () => { st.page++; ahPage(player, back, st); } });
  open(player, f);
}

// ================================================================ buy
function buyPage(player, id, back, st) {
  const r = getListing(id);
  if (!r || !isLive(r)) { say(player, "§c[Auction] This item was already sold or taken back."); return ahPage(player, back, st); }
  confirmShort(player, "Buy " + clean(itemTitle(r)) + "?", ["§7Price: §a" + money(r.p) + unitText(r), "§7Seller: §f" + r.n, "§7You pay the full price at once."], () => system.run(() => {
    const res = buy(player, id);
    if (res.ok) { say(player, "§a[Auction] You bought §f" + clean(itemTitle(res.rec)) + " §afor " + money(res.rec.p) + "."); try { player.playSound("random.levelup", { volume: 0.8, pitch: 1.3 }); } catch (e) { /* ignore */ } }
    else say(player, "§c[Auction] " + res.err);
    ahPage(player, back, st);
  }), () => ahPage(player, back, st));
}
function ownClick(player, id, back, st) {
  const r = getListing(id);
  if (!r) return ahPage(player, back, st);
  confirmShort(player, "Take back " + clean(itemTitle(r)) + "?", ["§7The listing ends and the item", "§7comes back to your inventory."], () => system.run(() => {
    const res = takeBack(player, id);
    say(player, res.ok ? "§a[Auction] You took back §f" + clean(itemTitle(res.rec)) + "§a." : "§c[Auction] " + res.err);
    ahPage(player, back, st);
  }), () => ahPage(player, back, st));
}
function staffRemove(player, id, back, st) {
  const r = getListing(id);
  if (!r || !isStaff(player)) return ahPage(player, back, st);
  confirmShort(player, "Remove " + clean(itemTitle(r)) + "?", ["§7Seller: §f" + r.n, "§7The item goes back to the seller", "§7(My listings > take back)."], () => system.run(() => {
    say(player, staffEnd(id) ? "§a[Auction] Listing removed. The seller can take the item back." : "§c[Auction] Could not remove it.");
    ahPage(player, back, st);
  }), () => ahPage(player, back, st));
}

// ================================================================ sell
function heldInfo(player) {
  try { const s = container(player).getItem(player.selectedSlotIndex); return s ?? null; } catch (e) { return null; }
}
/** the page where the player picks the item to sell from his own inventory (backpack rows 1-3, hotbar row 4) */
function sellPicker(player, back, st) {
  const f = make("Sell an Item", SHORT_ROWS); f.self = () => sellPicker(player, back, st);
  let c = null; try { c = container(player); } catch (e) { /* ignore */ }
  const cell = (slot, at) => {
    const s = c && c.getItem(slot);
    if (!s) return;
    const pk = packItem(s), icon = iconOf(s.typeId);
    if (pk.err) set(f, at, hdr(s.amount, "r") + "§f" + nameOf(s.typeId) + "\n§r§cCan not be sold here\n§r§7" + pk.err, icon, null);
    else set(f, at, hdr(s.amount, "g") + "§f" + itemTitle({ it: pk.it }).replace(/ x\d+$/, "") + detail(pk.it) + "\n§r§eClick to sell it", icon, { run: () => system.run(() => sellPage(player, back, st, slot)) });
  };
  if (c) { for (let i = 9; i < Math.min(36, c.size); i++) cell(i, i - 9); for (let i = 0; i < Math.min(9, c.size); i++) cell(i, 27 + i); }
  set(f, 4 * COLS + 4, hdr(1) + "§e§lPick the item\n§r§7Green = can be sold\n§r§7Red = can not be sold here", NAV.page, null);
  arrowBack(f, () => ahPage(player, back, st)); status(player, f);
  open(player, f);
}
function sellPage(player, back, st, slot) {
  const s = (() => { try { return container(player).getItem(slot) ?? null; } catch (e) { return null; } })();
  if (!s) { say(player, "§c[Auction] That slot is empty now."); return ahPage(player, back, st); }
  const pk = packItem(s);
  if (pk.err) { say(player, "§c[Auction] You can not sell this: " + pk.err + "."); return ahPage(player, back, st); }
  const form = new MenuForm().title("Sell on the Auction House");
  textField(form, "Price for " + (s.amount > 1 ? "all items you choose below" : "this item") + " (example: 5000, 50k, 1.5m)", "price");
  if (s.amount > 1) { try { form.slider("How many to sell (you hold " + s.amount + ")", 1, s.amount, { valueStep: 1, defaultValue: s.amount }); } catch (e) { form.slider("How many to sell (you hold " + s.amount + ")", 1, s.amount, 1, s.amount); } }
  showModal(player, form, (v) => system.run(() => {
    if (!v) return ahPage(player, back, st);
    const price = parseAmount(v[0]);
    if (price === null || price > MAX_PRICE) { say(player, "§c[Auction] Write a price like 5000, 50k or 1.5m (up to " + money(MAX_PRICE) + ")."); return ahPage(player, back, st); }
    const res = sellHeld(player, price, s.amount > 1 ? v[1] : 1, pk.it, slot);
    if (res.ok) say(player, "§a[Auction] Listed §f" + clean(itemTitle(res.rec)) + " §afor " + money(price) + " (" + DURATION_HOURS + " hours)." + (TAX_PERCENT ? " §7You get " + (100 - TAX_PERCENT) + "% when it sells." : ""));
    else say(player, "§c[Auction] " + res.err);
    ahPage(player, back, st);
  }));
}

// ================================================================ my listings
function minePage(player, back, st) {
  const f = make("My Listings", SHORT_ROWS); f.self = () => minePage(player, back, st);
  const rows = mine(player.id);
  rows.slice(0, 27).forEach((r, i) => {
    const live = isLive(r);
    set(f, i, hdr(r.it.a, live ? "c" : "g") + "§f" + itemTitle(r).replace(/ x\d+$/, "") + detail(r.it) + "\n§r§7Price: §a" + money(r.p) + "\n§r" + (live ? "§7Ends in: §f" + leftText(r.e - Date.now()) + "\n§r§eClick to take it back" : "§aEnded - click to take it back"), iconOf(r.it.t), {
      run: () => system.run(() => { const res = takeBack(player, r.i); say(player, res.ok ? "§a[Auction] You took back §f" + clean(itemTitle(res.rec)) + "§a." : "§c[Auction] " + res.err); minePage(player, back, st); }),
    });
  });
  if (!rows.length) set(f, 1 * COLS + 4, hdr(1) + "§7You have no listings", NAV.chest, null);
  const ended = endedCount(player.id);
  if (ended) set(f, 4 * COLS + 4, hdr(ended, "g") + "§a§lTake back all ended\n§r§7" + ended + " item" + (ended > 1 ? "s" : ""), NAV.ok, { run: () => system.run(() => { const n = takeAllEnded(player); say(player, "§a[Auction] " + n + " item" + (n === 1 ? "" : "s") + " came back to you."); minePage(player, back, st); }) });
  if (isStaff(player)) set(f, 3 * COLS + 8, hdr(1, st.mod ? "r" : "c") + "§c§lStaff remove mode\n§r§7Now: " + (st.mod ? "§aON" : "§cOFF") + "\n§r§7When ON, clicking a listing in the\n§r§7Auction House removes it", NAV.shield, { run: () => { st.mod = !st.mod; minePage(player, back, st); } });
  arrowBack(f, () => ahPage(player, back, st)); status(player, f);
  open(player, f);
}

// ================================================================ category + search
function catPage(player, back, st) {
  const f = make("Categories", 7); f.self = () => catPage(player, back, st);
  const all = [{ id: "all", name: "All items", icon: "textures/items/gold_ingot" }, ...categories(), HEARTS_CAT, { id: "potions", name: "Potions", icon: iconOf("minecraft:potion") }, { id: "other", name: "Other", icon: "textures/items/book_normal" }];
  all.slice(0, 54).forEach((c, i) => set(f, i, hdr(1, c.id === st.cat ? "g" : "c") + "§f§l" + c.name + (c.id === st.cat ? "\n§r§aSelected" : "\n§r§eClick to choose"), c.icon, { run: () => { st.cat = c.id; st.page = 0; ahPage(player, back, st); } }));
  arrowBack(f, () => ahPage(player, back, st)); status(player, f);
  open(player, f);
}
function searchPage(player, back, st) {
  const form = new MenuForm().title("Search the Auction House");
  textField(form, "Item, enchantment or seller (empty = show everything)", "diamond sword");
  showModal(player, form, (v) => system.run(() => {
    if (v) { st.q = String(v[0] ?? "").trim().slice(0, 40); st.page = 0; }
    ahPage(player, back, st);
  }));
}

// ================================================================ the /ah command
export function ahCommand(p, action, arg, back) {
  try { return runCommand(p, action, arg, back); } catch (e) { console.warn("[ah] command failed: " + e); say(p, "§c[Auction] Error: §f" + String(e).slice(0, 150)); }
}
function runCommand(p, action, arg, back) {
  const a = String(action ?? "").toLowerCase();
  if (!a) return ahPage(p, back);
  if (a === "sell") {
    const s = heldInfo(p);
    if (!arg) return sellPicker(p, back, { page: 0, sort: "new", cat: "all", q: "", mod: false });   // /ah sell  -> pick the item
    if (!s) return say(p, "§c[Auction] Hold the item you want to sell in your hand.");
    const price = parseAmount(arg);
    if (price === null || price > MAX_PRICE) return say(p, "§c[Auction] Use: /ah sell <price>  (example: /ah sell 50k)");
    const res = sellHeld(p, price, s.amount);
    return say(p, res.ok ? "§a[Auction] Listed §f" + clean(itemTitle(res.rec)) + " §afor " + money(price) + " (" + DURATION_HOURS + " hours)." : "§c[Auction] " + res.err);
  }
  if (a === "list" || a === "mine") return minePage(p, back, { page: 0, sort: "new", cat: "all", q: "", mod: false });
  if (a === "search" && arg) return ahPage(p, back, { page: 0, sort: "new", cat: "all", q: String(arg).slice(0, 40), mod: false });
  say(p, "§6[Auction] §7Use: §f/ah §7| §f/ah sell <price> §7| §f/ah list §7| §f/ah search <text>");
}
