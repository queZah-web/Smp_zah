// BUY ORDER pages (/order). The rules and the data are in systems/orders.js.
// Main page (9-row chest): rows 1-7 = 63 orders of the page, row 8 = New order / My orders / Sort / Category / Search, row 9 = Back / balance / Refresh / pages.
import { system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { COLS, SHORT_ROWS, NAV, hdr, make, set, open, status, backBtn } from "./ui.js";

const ARROW = "textures/items/arrow";                    // the arrow of the game: Back and the page buttons
function arrowBack(f, fn, slot = (f.rows - 1) * COLS) { set(f, slot, hdr(1) + "§c§lBack", ARROW, { run: fn }); }
import { money } from "../format.js";
import { CATEGORIES } from "../shop_data.js";
import { showModal, textField, confirmShort } from "../systems/forms.js";
import { parseAmount } from "../systems/pay.js";
import {
  setCatalog, catalogCats, itemInfo, allItems, SORTS, browse, mine, getOrder, isOpen, left, canSell, createOrder, fillOrder, collect, collectAll, cancelOrder, waiting,
  DURATION_HOURS, MAX_PER_PLAYER, MAX_QTY, MAX_EACH, MAX_COST,
} from "../systems/orders.js";
import { menuMsg, MenuForm } from "../systems/menulang.js";

setCatalog(CATEGORIES);

const PER_PAGE = 45;                       // 5 rows of orders, the 6th row = the buttons (like DonutSMP)
const BAR = 5 * COLS;
const say = (p, t) => { try { p.sendMessage(menuMsg(p, t)); } catch (e) { /* ignore */ } };
const iconOf = (id) => (itemInfo(id) ? itemInfo(id).icon : "textures/items/" + String(id).replace(/^minecraft:/, ""));
const newState = () => ({ page: 0, sort: "high", cat: "all", q: "" });
function leftText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
  return h >= 24 ? Math.floor(h / 24) + "d " + (h % 24) + "h" : h > 0 ? h + "h " + (m % 60) + "m" : Math.max(1, m) + "m";
}

// ================================================================ main page
// bottom row:  < previous | Back | Category | Sort | Refresh | Search | My orders | New order | next >
export function orderPage(player, back, st) {
  st = st ?? newState();
  const list = browse(st.sort, st.cat, st.q);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  st.page = Math.max(0, Math.min(st.page, pages - 1));
  const f = make("Orders", 6); f.self = () => orderPage(player, back, st); f.noRefresh = true;
  const have = new Map();                                              // how many of each item the player carries (counted once per item)
  list.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE).forEach((r, i) => {
    const own = r.b === player.id;
    if (!have.has(r.t)) have.set(r.t, own ? 0 : canSell(player, r));
    const c = have.get(r.t);
    set(f, i, hdr(Math.min(99, left(r)), "c") + "§f" + r.nm + (own ? " §e(yours)" : "") + "\n§r§7Wants: §f" + left(r) + " §7more §8(of " + r.q + ")" +
      "\n§r§7Pays: §a" + money(r.p) + " §7each\n§r§7Buyer: §f" + r.n + "\n§r§7Ends in: §f" + leftText(r.e - Date.now()) +
      (own ? "\n§r§eClick to open My orders" : c > 0 ? "\n§r§aYou carry " + c + " - click to sell" : "\n§r§cYou carry none"), iconOf(r.t),
      { run: () => (own ? minePage(player, back, st) : fillPage(player, r.i, back, st)) });
  });
  if (!list.length) set(f, 2 * COLS + 4, hdr(1) + "§7No orders here\n§r§7" + (st.q || st.cat !== "all" ? "Change the search or the category." : "Click the gold ingot and ask for what you need."), NAV.chest, null);

  const mineAll = mine(player.id), wait = waiting(player.id);
  const info = "\n§r§7Page §f" + (st.page + 1) + "§7/§f" + pages + " §8(" + list.length + " order" + (list.length === 1 ? "" : "s") + ")";
  if (st.page > 0) set(f, BAR + 0, hdr(1) + "§a§l< Previous page" + info, ARROW, { run: () => { st.page--; orderPage(player, back, st); } });
  arrowBack(f, back ?? (() => { }), BAR + 1);
  const cname = st.cat === "all" ? "All items" : (catalogCats().find((c) => c.id === st.cat) ?? { name: st.cat }).name;
  set(f, BAR + 2, hdr(1) + "§d§lCategory\n§r§7Now: §f" + cname + "\n§r§eClick to choose", "textures/items/cauldron", { run: () => catPage(player, back, st) });
  const so = SORTS.find((s) => s.key === st.sort) ?? SORTS[0];
  set(f, BAR + 3, hdr(1) + "§b§lSort\n§r§7Now: §f" + so.label + "\n§r§eClick to change", "textures/ui/shop/i3d_hopper", { run: () => { st.sort = SORTS[(SORTS.indexOf(so) + 1) % SORTS.length].key; st.page = 0; orderPage(player, back, st); } });
  set(f, BAR + 4, hdr(1) + "§b§lRefresh\n§r§7Update the orders and times", "textures/ui/shop/i3d_anvil", { run: () => orderPage(player, back, st) });
  set(f, BAR + 5, hdr(1, st.q ? "g" : "c") + "§6§lSearch\n§r§7" + (st.q ? "Now: §f" + st.q + "\n§r§eClick to change or clear" : "Find an item or a buyer by name"), "textures/items/sign", { run: () => system.run(() => searchPage(player, back, st)) });
  set(f, BAR + 6, hdr(mineAll.length) + "§e§lMy orders\n§r§7" + mineAll.length + "/" + MAX_PER_PLAYER + " orders" + (wait ? "\n§r§a" + wait + " item" + (wait > 1 ? "s" : "") + " to collect" : ""), NAV.chest, { run: () => minePage(player, back, st) });
  set(f, BAR + 7, hdr(1, "g") + "§a§lNew order\n§r§7Ask for an item, you pay for it\n§r§7at once, players sell it to you\n§r§7Lasts " + DURATION_HOURS + " hours\n§r§8/order", "textures/items/gold_ingot", { run: () => newPage(player, back, st) });
  if (st.page < pages - 1) set(f, BAR + 8, hdr(1) + "§a§lNext page >" + info, ARROW, { run: () => { st.page++; orderPage(player, back, st); } });
  open(player, f);
}

// ================================================================ sell to an order
function fillPage(player, id, back, st) {
  const r = getOrder(id);
  if (!r || !isOpen(r)) { say(player, "§c[Order] This order is closed or already full."); return orderPage(player, back, st); }
  const max = Math.min(left(r), canSell(player, r));
  if (max < 1) { say(player, r.t === "smp:heart" ? "§c[Order] You do not carry any Heart." : "§c[Order] You do not carry any plain " + r.nm + " (no name, enchantments or damage)."); return orderPage(player, back, st); }
  const done = (k) => system.run(() => {
    const res = fillOrder(player, id, k);
    if (res.ok) { say(player, "§a[Order] You sold §f" + res.k + "x " + r.nm + " §afor " + money(res.paid) + "."); try { player.playSound("random.levelup", { volume: 0.8, pitch: 1.3 }); } catch (e) { /* ignore */ } }
    else say(player, "§c[Order] " + res.err);
    orderPage(player, back, st);
  });
  if (max === 1) return confirmShort(player, "Sell 1x " + r.nm + "?", ["§7You get §a" + money(r.p), "§7Buyer: §f" + r.n], () => done(1), () => orderPage(player, back, st));
  const form = new MenuForm().title("Sell " + r.nm);
  try { form.slider("How many to sell (" + money(r.p) + " each, the order wants " + left(r) + ")", 1, max, { valueStep: 1, defaultValue: max }); } catch (e) { form.slider("How many to sell (" + money(r.p) + " each, the order wants " + left(r) + ")", 1, max, 1, max); }
  showModal(player, form, (v) => { if (!v) return system.run(() => orderPage(player, back, st)); done(Number(v[0])); });
}

// ================================================================ new order: category -> item -> amount + price
function newPage(player, back, st) {
  const f = make("New Order - Category", 7); f.self = () => newPage(player, back, st);
  catalogCats().filter((c) => c.items.length).slice(0, 54).forEach((c, i) => set(f, i, hdr(1) + "§f§l" + c.name + "\n§r§7" + c.items.length + " items\n§r§eClick to open", c.icon, { run: () => itemsPage(player, c.id, 0, back, st) }));
  set(f, 6 * COLS - 1, hdr(1, "g") + "§6§lFind by name\n§r§7Type part of the item name", "textures/items/name_tag", { run: () => system.run(() => findPage(player, back, st)) });
  arrowBack(f, () => orderPage(player, back, st)); status(player, f);
  open(player, f);
}
function itemsPage(player, catId, page, back, st, list, title) {
  const cat = catalogCats().find((c) => c.id === catId);
  const items = list ?? (cat ? cat.items : []);
  const per = 45, pages = Math.max(1, Math.ceil(items.length / per));
  page = Math.max(0, Math.min(page, pages - 1));
  const f = make(title ?? (cat ? cat.name : "Items"), 7); f.self = () => itemsPage(player, catId, page, back, st, list, title);
  items.slice(page * per, (page + 1) * per).forEach((it, i) => set(f, i, hdr(1) + "§f" + it.name + "\n§r§eClick to order it", it.icon, { run: () => system.run(() => amountPage(player, it.id, back, st)) }));
  if (!items.length) set(f, 2 * COLS + 4, hdr(1) + "§7Nothing found", NAV.chest, null);
  const base = 6 * COLS, pinfo = "\n§r§7Page §f" + (page + 1) + "§7/§f" + pages;
  if (page > 0) set(f, base + 0, hdr(1) + "§a§l< Previous page" + pinfo, ARROW, { run: () => itemsPage(player, catId, page - 1, back, st, list, title) });
  arrowBack(f, () => newPage(player, back, st), base + 1);
  if (page < pages - 1) set(f, base + 8, hdr(1) + "§a§lNext page >" + pinfo, ARROW, { run: () => itemsPage(player, catId, page + 1, back, st, list, title) });
  open(player, f);
}
function findPage(player, back, st) {
  const form = new MenuForm().title("Find an item");
  textField(form, "Part of the item name (example: diamond)", "diamond");
  showModal(player, form, (v) => system.run(() => {
    const q = v ? String(v[0] ?? "").trim().toLowerCase() : "";
    if (!q) return newPage(player, back, st);
    const found = allItems().filter((it) => it.name.toLowerCase().includes(q) || it.id.replace(/_/g, " ").includes(q)).slice(0, 135);
    itemsPage(player, "", 0, back, st, found, "Found: " + q.slice(0, 20));
  }));
}
function amountPage(player, shopId, back, st) {
  const it = itemInfo(shopId);
  if (!it) return orderPage(player, back, st);
  const form = new MenuForm().title("Order " + it.name);
  textField(form, "How many do you want? (1 - " + MAX_QTY + ")", "64");
  textField(form, "Price for EACH item (example: 100, 1.5k)", "100");
  showModal(player, form, (v) => system.run(() => {
    if (!v) return newPage(player, back, st);
    const qty = parseAmount(v[0]), each = parseAmount(v[1]);
    if (qty === null || qty > MAX_QTY) { say(player, "§c[Order] Write how many you want, from 1 to " + MAX_QTY + "."); return newPage(player, back, st); }
    if (each === null || each > MAX_EACH) { say(player, "§c[Order] Write the price of one item, like 100 or 1.5k."); return newPage(player, back, st); }
    const total = qty * each;
    if (total > MAX_COST) { say(player, "§c[Order] The whole order can not cost more than " + money(MAX_COST) + "."); return newPage(player, back, st); }
    confirmShort(player, "Order " + qty + "x " + it.name + "?", ["§7Each: §a" + money(each), "§7You pay now: §a" + money(total), "§7Not filled after " + DURATION_HOURS + "h = money back"], () => system.run(() => {
      const res = createOrder(player, shopId, qty, each);
      say(player, res.ok ? "§a[Order] Your order for §f" + qty + "x " + it.name + " §ais open. You paid " + money(res.total) + "." : "§c[Order] " + res.err);
      orderPage(player, back, st);
    }), () => orderPage(player, back, st));
  }));
}

// ================================================================ my orders
function minePage(player, back, st) {
  const f = make("My Orders", SHORT_ROWS); f.self = () => minePage(player, back, st);
  const rows = mine(player.id);
  rows.slice(0, 27).forEach((r, i) => {
    const open_ = isOpen(r);
    const act = r.h > 0 ? "§aClick to collect " + r.h + " item" + (r.h > 1 ? "s" : "") : open_ ? "§eClick to cancel (money back: " + money(left(r) * r.p) + ")" : "§7Finished";
    set(f, i, hdr(Math.min(99, r.h || left(r) || 1), r.h > 0 ? "g" : "c") + "§f" + r.nm + "\n§r§7Filled: §f" + r.f + "§7/§f" + r.q + "\n§r§7Pays: §a" + money(r.p) + " §7each" +
      (r.h > 0 ? "\n§r§aWaiting for you: " + r.h : "") + (open_ ? "\n§r§7Ends in: §f" + leftText(r.e - Date.now()) : "\n§r§7Closed") + "\n§r" + act, iconOf(r.t), {
      run: () => {
        if (r.h > 0) return system.run(() => { const res = collect(player, r.i); say(player, res.ok ? "§a[Order] You collected §f" + res.n + "x " + r.nm + "§a." : "§c[Order] " + res.err); minePage(player, back, st); });
        if (!open_) return minePage(player, back, st);
        confirmShort(player, "Cancel the order for " + r.nm + "?", ["§7You get §a" + money(left(r) * r.p) + " §7back", "§7Items already bought stay yours."], () => system.run(() => {
          const res = cancelOrder(player, r.i);
          say(player, res.ok ? "§a[Order] Order cancelled. " + money(res.refund) + " came back to you." + (res.n ? " You collected " + res.n + " items." : "") : "§c[Order] " + res.err);
          minePage(player, back, st);
        }), () => minePage(player, back, st));
      },
    });
  });
  if (!rows.length) set(f, 1 * COLS + 4, hdr(1) + "§7You have no orders", NAV.chest, null);
  const wait = waiting(player.id);
  if (wait) set(f, 4 * COLS + 4, hdr(Math.min(99, wait), "g") + "§a§lCollect everything\n§r§7" + wait + " item" + (wait > 1 ? "s" : ""), NAV.ok, { run: () => system.run(() => { const n = collectAll(player); say(player, "§a[Order] You collected " + n + " item" + (n === 1 ? "" : "s") + "."); minePage(player, back, st); }) });
  arrowBack(f, () => orderPage(player, back, st)); status(player, f);
  open(player, f);
}

// ================================================================ category + search
function catPage(player, back, st) {
  const f = make("Categories", 7); f.self = () => catPage(player, back, st);
  const all = [{ id: "all", name: "All items", icon: "textures/items/gold_ingot" }, ...catalogCats().filter((c) => c.items.length)];
  all.slice(0, 54).forEach((c, i) => set(f, i, hdr(1, c.id === st.cat ? "g" : "c") + "§f§l" + c.name + (c.id === st.cat ? "\n§r§aSelected" : "\n§r§eClick to choose"), c.icon, { run: () => { st.cat = c.id; st.page = 0; orderPage(player, back, st); } }));
  arrowBack(f, () => orderPage(player, back, st)); status(player, f);
  open(player, f);
}
function searchPage(player, back, st) {
  const form = new MenuForm().title("Search the orders");
  textField(form, "Item or buyer name (empty = show everything)", "diamond");
  showModal(player, form, (v) => system.run(() => { if (v) { st.q = String(v[0] ?? "").trim().slice(0, 40); st.page = 0; } orderPage(player, back, st); }));
}

// ================================================================ the /order command
export function orderCommand(p, action, back) {
  try {
    const a = String(action ?? "").toLowerCase();
    if (a === "list" || a === "mine") return minePage(p, back, newState());
    if (a && a !== "browse") return orderPage(p, back, { ...newState(), q: String(action).slice(0, 40) });   // /order diamond  -> search
    orderPage(p, back);
  } catch (e) { console.warn("[order] command failed: " + e); say(p, "§c[Order] Error: §f" + String(e).slice(0, 150)); }
}
