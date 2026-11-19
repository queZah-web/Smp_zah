import { econMsg } from "./systems/staffcore.js";   // staff tools: frozen money account
import { wrapTip } from "./smp/wrap.js";
import { tidyBar } from "./smp/bar.js";
import { system, world, ItemStack, EnchantmentTypes, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { CATEGORIES } from "./shop_data.js";
import { buyFx } from "./salefx.js";
import { BOOKS_CATEGORY, ENCHANTS, ROMAN, bookPrice } from "./books.js";
import { stats, balance, addMoney, takeMoney, addTx, allRecords } from "./data.js";
import { money, num, short, ago, countdown } from "./format.js";
import { buy, sell, sellStacks, buyShardItem, buySpecial, specialPrice, specialKey } from "./economy.js";
import { sellSlotOn, toggleSellSlot, isMark } from "./systems/sellslot.js";
import { container, countPlain } from "./inv.js";
import { addAliases, registerCheck } from "./alias.js";
import { stackValue, UPGRADABLE } from "./value.js";
import { progress, reward, rewardText, xpPerUnit, addXp, MAX_LEVEL } from "./xp.js";
import { hasLimit, remaining, unitsLeft, resetIn, hoursOf, countOf, limitText, hoursTxt, limitSource, limitBlock, stamp, WINDOW_CHOICES, MAX_COUNT, CAT_LIM } from "./limits.js";
import { SPAWNERS, EGGS } from "./mobs.js";
import { SHARD_ITEMS, SPAWNER_SHARDS, SPAWNER_MONEY, EGG_SHARDS, EGG_MONEY } from "./shards.js";
import { formBusy } from "./state.js";
import { updateHud } from "./hud.js";
import { dashboard, setShopOpener, smpButtonText, smpButtonIcon } from "./smp/index.js";
import { landPage } from "./systems/landmenu.js";
import { setHeartLogsHook } from "./systems/opmenu.js";
import { passesPage } from "./systems/tables.js";
import { buyPrice, sellPlan, discountPct, sellBonusPct } from "./priceperks.js";
import { enchantsFor, enchantCost, cycle, quote, buyEnchanted } from "./enchantshop.js";
import { luxCmd, luxUi, luxShop, luxDing } from "./lux.js";
import "./pricelore.js";
import { isAdmin } from "./systems/landcore.js";
import { can } from "./systems/staffcore.js";
import { showModal, textField, dropdown } from "./systems/forms.js";
import "./heartfx.js";
import { isHeart, buyerOf } from "./heartids.js";
import { buyersList, buyerInfo, allPurchases, logTotals, stamp as logStamp } from "./heartlog.js";
import { pickerInfo, allPickups, pickupTotals, TYPE_NAMES as PICK_TYPES, sourceText, placeText } from "./heartpickup.js";
import { usersList, userInfo, allUses, useTotals, TYPE_NAMES as USE_TYPES, usePlaceText } from "./heartuse.js";
import { lossInfo, allLosses, lossTotals, TYPE_NAMES as LOSS_TYPES, KIND_HALVED, KIND_REPAIRED, causeText, lossPlaceText, secText } from "./heartloss.js";
import { sendBar } from "./barsend.js";
import { heartsCfg, heartsStatus, pauseLeftMs, heartsOf, heartsRec, nextPrice, buyBlock, buyHeart, heldUnits, heartsTxt, restoreHalf, countItem, heartOwners, removeHearts, setHeartsPrice, setHeartsRules, setHeartsStatus, setHeartsProtection, setHeartsCountdown } from "./hearts.js";
import { adminLoad, SP_SHARDS, LIMIT_KEYS, LIMIT_NAMES, MAX_MONEY, MAX_SHARDS, MAX_HOURS, baseSpawner, baseEgg, baseItem, baseLimit, baseItemPrice, canRemoveLimit, setSpawner, setEgg, setItem, setLimit, setCategoryLimit, setItemPrice, setBookPrice, setPotionPrice, baseBook, basePotion, POTIONS, bookKey, resetOne } from "./shopadmin.js";
import { PRICES, shardsOf } from "./spawner_data.js";
import { MAX_FAV, favList, isFav, toggleFav, recentList, pushRecent, clearRecent, total, ranking, categoryTops, orderedItems, countEnchants, enchantLevelTag, enchantTag } from "./shopmeta.js";
import { POTIONS_CATEGORY, EFFECTS, FORMS, VARIANT_COUNT, SELL_CAP, potionPrice, potionName, potionIcon, potionKey, cheapest, ALL_POTIONS, potionOwned, buyPotion, sellPotion, sellLeft, sellResetIn } from "./potions.js";
import { shopMsg, shopText, shopButton, ShopForm, catN } from "./systems/shoplang.js";
import { getLang } from "./smp/lang.js";

const SHARDS_CATEGORY = { id: "shards", name: "Shards Shop", icon: "textures/ui/shop/hud_shards", type: "shards", items: [] };
const ALL = [...CATEGORIES, BOOKS_CATEGORY, POTIONS_CATEGORY, SHARDS_CATEGORY];
const TITLE_PREFIX = "__chest__";
const COLS = 9, ROWS = 9, TOTAL = COLS * ROWS, NAV_START = TOTAL - COLS, PER_PAGE = NAV_START;
const NAV = {
  prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", back: "textures/ui/shop/nav_back",
  page: "textures/ui/shop/nav_page", chest: "textures/ui/shop/ic_chest", ok: "textures/ui/shop/ic_confirm", no: "textures/ui/shop/ic_cancel",
  bal: "textures/items/gold_ingot", hist: "textures/items/book_writable", book: "textures/items/book_enchanted", xp: "textures/items/experience_bottle",
  shard: "textures/ui/shop/hud_shards", spawner: "textures/ui/shop/ic_spawner",
};
const MENU_COLS = [1, 2, 3, 4, 5, 6, 7], MENU_ROWS = [2, 3, 4], MENU_SHORT = 7;     // main menu = 7-row chest: row 0 quick buttons, row 1 glass, rows 2-4 categories (7 x 3, framed by glass), row 5 Land Protection, row 6 = button bar
const GLASS_ICON = "textures/blocks/glass_black", GLASS_ENTRY = { glass: true };      // Black Stained Glass Pane (same icon as /shop > Colored Blocks)
function fillGlass(f) {                                                                  // a page with f.glass = true: every still-empty slot becomes a glass pane (no tooltip, click does nothing)
  if (!f.glass) return;
  const total = f.rows ? f.rows * COLS : TOTAL;
  for (let i = 0; i < total; i++) if (!f.buttons[i]) { f.buttons[i] = ["c00", GLASS_ICON]; f.entries[i] = GLASS_ENTRY; }
}
const hdr = (n, z = "c") => z + String(Math.max(0, Math.min(99, n))).padStart(2, "0");   // zone c/r/g + 2-digit stack count
const pretty = (id) => id.replace("minecraft:", "").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const BY_TYPE = new Map();
for (const c of CATEGORIES) for (const it of c.items) if (!BY_TYPE.has(it[0])) BY_TYPE.set(it[0], it);
try { registerCheck(CATEGORIES); } catch (e) { /* ignore */ }      // /scriptevent shop:check lists items this game version does not have
try { system.runTimeout(() => { try { adminLoad(); } catch (e) { /* ignore */ } }, 5); } catch (e) { /* ignore */ }
try { system.runTimeout(() => { try { addAliases(BY_TYPE); } catch (e) { /* ignore */ } }, 20); } catch (e) { /* ignore */ }   // also find items by their real game id (sugar cane)
// Icons inside the texts: a custom font page (RP/font/glyph_E2.png).  Write  "§f" + icon  first so the icon keeps its own colors.
const G = { star: "\uE200", clock: "\uE201", fire: "\uE202", bag: "\uE203", buy: "\uE204", coin: "\uE205", chest: "\uE206", xp: "\uE207", hour: "\uE208" };
// which category an item belongs to (the first one) -> its "Most purchased" / "Best seller" rank INSIDE that category (shopmeta.js)
const CAT_OF = new Map();
CATEGORIES.forEach((c, ci) => { for (const it of c.items) if (!CAT_OF.has(it[0])) CAT_OF.set(it[0], ci); });
const tagsOf = (id) => {
  const ci = CAT_OF.get(id); if (ci === undefined) return {};
  const t = categoryTops("c" + ci, ALL[ci].items);
  return { b: t.b.get(id), s: t.s.get(id) };
};
const badgeLines = (id) => {
  const t = tagsOf(id); let out = "";
  if (t.s) out += "\n§r§f" + G.bag + " §6§lBest seller §r§8#" + t.s.rank + " in category §7(" + num(t.s.n) + " sold)";
  if (t.b) out += "\n§r§f" + G.fire + " §c§lMost purchased §r§8#" + t.b.rank + " in category §7(" + num(t.b.n) + " bought)";
  return out;
};
// "Most purchased" badge for enchantments (books and enchanted gear): t = { rank, n } from shopmeta.js, or null
const enchBadge = (t) => t ? "\n§r§f" + G.fire + " §c§lMost purchased §r§8#" + t.rank + " in category §7(" + num(t.n) + " bought)" : "";
// Items that glow in the game (enchanted look): their icon gets the purple shine. Zone letters: x = plain slot, y = red slot, z = green slot (+ shine)
const GLINT_IDS = new Set([]);      // the purple shine was removed from the Enchanted Golden Apple icon (the icon itself is unchanged); put "enchanted_golden_apple" back here to get the shine again
const glintOf = (id, z) => (GLINT_IDS.has(id) ? { c: "x", r: "y", g: "z" }[z] ?? z : z);
// Shulker Boxes: the 16 colored ones are no longer listed in Colored Blocks. The "Shulker Box" button in The End opens a page with all of them (prices, limits, selling: unchanged)
const isColorShulker = (id) => /_shulker_box$/.test(id);
const shownIn = (cat) => (cat.id === "colored" ? cat.items.filter((it) => !isColorShulker(it[0])) : cat.items);
const zoneOf = (id) => { const t = tagsOf(id); return glintOf(id, t.s ? "g" : t.b ? "r" : "c"); };      // green slot = best seller, red slot = most purchased
const priceLines = (it, p) => {
  const b = p ? buyPrice(p, it[3], it[4]) : it[3], sl = p && it[4] > 0 ? sellPlan(p, it[0], it[4], 1).total : it[4];
  return "\n§r§f" + G.buy + " §7Buy: §a" + money(b) + (b < it[3] ? " §8(-" + discountPct(p) + "%)" : "") + "\n§r" + (it[4] > 0 ? "§f" + G.coin + " §7Sell: §c" + money(sl) + (sl > it[4] ? " §8(+" + sellBonusPct(p) + "%)" : "") : "§8Not sellable") + badgeLines(it[0]);
};
// the text of one item slot (category / search / favorites / recent lists)
const itemText = (it, p) => hdr(1, zoneOf(it[0])) + "§f" + (p && isFav(p, it[0]) ? G.star + " " : "") + it[1] + priceLines(it, p);

// ================================================================ form helpers
function make(title, rows = ROWS) { return { title, rows, entries: new Array(TOTAL).fill(null), buttons: new Array(TOTAL).fill(null), self: null }; }
function set(f, slot, text, icon, entry) { f.buttons[slot] = [text, icon]; f.entries[slot] = entry ?? null; }
const moneyTxt = (n) => (n < 10000000 ? money(n) : "$" + short(n));
const shardTxt = (n) => (n < 100000 ? num(n) : short(n, 1));
const balanceLine = (p) => { const s = stats(p); return "§2" + moneyTxt(s.money) + " §8| §5" + shardTxt(s.shards) + " shards"; };
// "Refresh" button on every page: it rebuilds the page (the screen closes and opens again very fast) so the balance, prices and times are fresh.
// A page can opt out with  f.noRefresh = true  (confirmation pages do).
function addRefresh(f) {
  if (!f.self || f.noRefresh || f.title === "Confirm") return;
  const base = (f.rows ? f.rows : 9) * COLS - COLS;                 // first slot of the button row
  for (const k of [2, 6, 3, 5, 7, 4]) {
    if (f.buttons[base + k]) continue;
    set(f, base + k, hdr(1) + "\u00a7b\u00a7lRefresh\n\u00a7r\u00a77Update the balance, prices\n\u00a7r\u00a77and times on this page", "textures/ui/shop/key_refresh", { run: () => f.self() });
    return;
  }
}

function open(player, f, tries = 0) {
  if (tries === 0) { try { adminLoad(); } catch (e) { /* ignore */ } luxUi(player, "item"); addRefresh(f); tidyBar(f); fillGlass(f); }
  let shownTitle = f.title, ar = false;
  try { ar = getLang(player) === "ar"; if (ar) shownTitle = shopText(player, f.title, 40); } catch (e) { ar = false; shownTitle = f.title; }      // Arabic players: texts of the page in Arabic (item names stay English)
  const form = new ActionFormData().title(TITLE_PREFIX + (f.rows ? "__r" + f.rows + "__" : "") + shownTitle + "\n" + balanceLine(player));
  for (let i = 0; i < (f.rows ? f.rows * COLS : TOTAL); i++) { const b = f.buttons[i]; if (b) form.button(wrapTip(ar && !(f.arDone && f.arDone.has(i)) ? shopButton(player, b[0]) : b[0]), b[1]); else form.button("c00"); }
  formBusy.add(player.id);
  form.show(player).then((res) => {
    if (res.canceled) {
      if (res.cancelationReason === FormCancelationReason.UserBusy && tries < 25) { system.runTimeout(() => open(player, f, tries + 1), 8); return; }
      formBusy.delete(player.id); updateHud(player); return;
    }
    formBusy.delete(player.id);
    const e = f.entries[res.selection];
    if (e && e.glass) { open(player, f, 1); return; }          // glass pane: nothing happens, the same page comes straight back
    if (e && e.run) e.run(); else if (f.self) f.self();      // info slots just refresh the page
  }).catch(() => formBusy.delete(player.id));
}
const status = (player, f) => {
  const s = stats(player), b = progress(s.bxp).level, l = progress(s.sxp).level;
  set(f, (f.rows ? (f.rows - 1) * COLS : NAV_START) + 1, hdr(1) + "§6Your Balance\n§r§7Money: §a" + money(s.money) + "\n§r§7Shards: §d" + num(s.shards) + "\n§r§7Buyer Lv §f" + b + " §7| Seller Lv §f" + l, NAV.bal, null);
};
const sellButton = (player, f) => set(f, f.rows ? f.rows * COLS - 1 : TOTAL - 1, hdr(1) + "§a§lSell Items\n§r§7Move items to the sell box", NAV.chest, { run: () => sellPage(player) });
const backBtn = (f, fn) => set(f, NAV_START, hdr(1) + "§cBack", NAV.back, { run: fn });

// ================================================================ confirmation page
function confirmPage(player, title, lines, onYes, onNo) {
  const f = make("Confirm"); f.self = () => confirmPage(player, title, lines, onYes, onNo);
  set(f, 1 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 4 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 4 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}

// ================================================================ main menu
function mainMenu(player) {
  try { adminLoad(); } catch (e) { /* ignore */ }                     // admin prices / limits (shopadmin.js)
  const f = make("Shop", MENU_SHORT); f.self = () => mainMenu(player);
  f.glass = true;                                                        // every empty slot = Black Stained Glass Pane around the categories
  const BAR = (MENU_SHORT - 1) * COLS;                                   // first slot of the button bar
  let n = 0;
  for (const r of MENU_ROWS) for (const c of MENU_COLS) {
    const cat = ALL[n++]; if (!cat) continue;
    const sub = cat.type === "book" ? cat.items.length + " enchantments" : cat.type === "potion" ? VARIANT_COUNT + " potions" : cat.type === "shards" ? "Spawners, eggs & items" : shownIn(cat).length + " items";
    set(f, r * COLS + c, hdr(1) + (cat.type === "shards" ? "§d" : "§f") + catN(player, cat.name) + "\n§r§7" + sub + "\n§r§eClick to open", cat.icon, { run: () => categoryPage(player, ALL.indexOf(cat), 0) });
  }
  // Hearts: the featured entry, centered in the glass row between the quick buttons and the categories (red slot)
  { const hp = nextPrice(player), hb = buyBlock(player);
    set(f, 1 * COLS + 4, hdr(1, "r") + "§c§lHearts\n§r§7Buy permanent extra hearts\n§r§7" + (hb ? "§c" + hb : "Next heart: §a" + money(hp)) + "\n§r§eClick to open", "textures/ui/shop/ic_heart", { run: () => heartsPage(player, () => mainMenu(player)) }); }
  // Land Protection: alone in the middle of row 5, right under the categories
  set(f, 5 * COLS + 4, hdr(1) + "§a§lLand Protection\n§r§7Protect your base from griefers\n§r§7Paid by the hour, max 24h\n§r§eClick to open", "textures/ui/shop/ic_shield", { run: () => landPage(player, () => mainMenu(player)) });
  // first row: Favorites + Recent (yours), Most purchased + Best sellers (everybody)
  const back = () => mainMenu(player);
  set(f, 0 * COLS + 1, hdr(1) + "§e§lFavorites\n§r§7Your starred items\n§r§7" + favList(player).length + " saved\n§r§eClick to open", "textures/ui/shop/ic_fav", { run: () => itemsPage(player, "fav", 0, back) });
  set(f, 0 * COLS + 3, hdr(1) + "§b§lRecent\n§r§7Items you looked at lately\n§r§eClick to open", "textures/ui/shop/ic_recent", { run: () => itemsPage(player, "recent", 0, back) });
  set(f, 0 * COLS + 5, hdr(1, "r") + "§c§lMost purchased\n§r§7What everyone buys the most\n§r§eClick to open", "textures/ui/shop/ic_fire", { run: () => itemsPage(player, "bought", 0, back) });
  set(f, 0 * COLS + 7, hdr(1, "g") + "§6§lBest sellers\n§r§7What everyone sells the most\n§r§eClick to open", "textures/ui/shop/ic_bag", { run: () => itemsPage(player, "sold", 0, back) });
  status(player, f);
  set(f, BAR + 3, smpButtonText(player), smpButtonIcon, { run: () => dashboard(player) });
  f.arDone = new Set([BAR + 3]);                                        // this text is already Arabic (shaped by smp/i18n.js): the shop must not translate it a 2nd time
  set(f, BAR + 5, hdr(1) + "§bTrade Levels\n§r§7Buyer & Seller progress", NAV.xp, { run: () => levelsPage(player) });
  set(f, BAR + 7, hdr(1) + "§eTransactions\n§r§7What you bought and sold", NAV.hist, { run: () => historyPage(player) });
  set(f, BAR + 0, hdr(1) + "§b§lSearch\n§r§7Tap letters - the list narrows\n§r§7to names that start with them", "textures/ui/shop/key_search", { run: () => searchPage(player, "", 0, () => mainMenu(player)) });
  sellButton(player, f);
  open(player, f);
}

// ================================================================ category pages
function categoryPage(player, ci, page) {
  const cat = ALL[ci];
  if (cat.type === "shards") return shardsMenu(player);
  const items = cat.type === "potion" || cat.type === "book" ? cat.items : orderedItems("c" + ci, shownIn(cat));       // best sellers / most purchased come first
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const f = make(`${catN(player, cat.name)} §8(${page + 1}/${pages})`); f.self = () => categoryPage(player, ci, page);
  for (let i = 0; i < PER_PAGE; i++) {
    const it = items[page * PER_PAGE + i]; if (!it) break;
    if (cat.type === "potion") {
      const eff = EFFECTS.find((x) => x.id === it[0]);
      set(f, i, hdr(1) + "§d" + eff.name + "\n§r§7" + eff.variants.length + " level" + (eff.variants.length > 1 ? "s" : "") + " §8x §73 types\n§r§7From: §a" + money(cheapest(eff)) + "\n§r§eClick to choose", it[2],
        { run: () => potionPage(player, eff, () => categoryPage(player, ci, page)) });
    } else if (cat.type === "book") {
      const e = ENCHANTS.find((x) => x.id === it[0]);
      const bt = enchantTag(e.id);
      set(f, i, hdr(1, bt ? "r" : "c") + "§d" + e.name + "\n§r§7Max level: §f" + ROMAN[e.max] + "\n§r§7From: §a" + money(buyPrice(player, bookPrice(e, 1), 0)) + enchBadge(bt) + "\n§r§eClick to choose a level", NAV.book,
        { run: () => bookPage(player, e, () => categoryPage(player, ci, page)) });
    } else if (cat.id === "end" && it[0] === "shulker_box") {
      set(f, i, hdr(1) + "§d§lShulker Boxes\n§r§7All 17 colors\n§r§7From: §a" + money(buyPrice(player, it[3], it[4])) + "\n§r§eClick to choose a color", it[2], { run: () => shulkerPage(player, () => categoryPage(player, ci, page)) });
    } else set(f, i, itemText(it, player), it[2], { run: () => detailPage(player, it, () => categoryPage(player, ci, page)) });
  }
  backBtn(f, () => mainMenu(player));
  status(player, f);
  if (canShop(player)) set(f, NAV_START + (cat.type === "book" ? 1 : 7), hdr(1) + "§6§lEdit this category\n§r§7Change the prices of its items\n§r§7and set the purchase limits\n§r§eAdmins only - click to open", "textures/ui/shop/hud_money", { run: () => catAdminHub(player, ci, () => categoryPage(player, ci, page)) });
  if (cat.type === "book") set(f, NAV_START + 7, hdr(1) + "§6§lTable Passes\n§r§730-minute passes for the Anvil,\n§r§7Enchanting Table, Grindstone\n§r§7and Smithing Table", "textures/ui/shop/i3d_anvil", { run: () => passesPage(player, () => categoryPage(player, ci, page)) });
  set(f, NAV_START + 2, hdr(1) + "§b§lSearch\n§r§7Tap letters - the list narrows\n§r§7to names that start with them", "textures/ui/shop/key_search", { run: () => searchPage(player, "", 0, () => categoryPage(player, ci, page)) });
  if (page > 0) set(f, NAV_START + 3, hdr(1) + "§aPrevious page\n§r§7Page " + page + "/" + pages, NAV.prev, { run: () => categoryPage(player, ci, page - 1) });
  set(f, NAV_START + 4, hdr(1) + "§ePage " + (page + 1) + "/" + pages + "\n§r§7" + shownIn(cat).length + " entries", NAV.page, null);
  if (page < pages - 1) set(f, NAV_START + 5, hdr(1) + "§aNext page\n§r§7Page " + (page + 2) + "/" + pages, NAV.next, { run: () => categoryPage(player, ci, page + 1) });
  sellButton(player, f);
  open(player, f);
}

// ================================================================ Shulker Boxes (opened from "Shulker Box" in The End): the plain one + all 16 colors
function shulkerPage(player, back) {
  const list = [...CATEGORIES.filter((c) => c.id === "end").flatMap((c) => c.items.filter((it) => it[0] === "shulker_box")), ...CATEGORIES.filter((c) => c.id === "colored").flatMap((c) => c.items.filter((it) => isColorShulker(it[0])))];
  const f = make("Shulker Boxes"); f.self = () => shulkerPage(player, back);
  list.slice(0, PER_PAGE).forEach((it, i) => set(f, i, itemText(it, player), it[2], { run: () => detailPage(player, it, () => shulkerPage(player, back)) }));
  backBtn(f, back);
  status(player, f);
  set(f, NAV_START + 4, hdr(1) + "§e" + list.length + " Shulker Boxes\n§r§7Pick a color", NAV.page, null);
  sellButton(player, f);
  open(player, f);
}

// ================================================================ item page (buy / sell)
function detailPage(player, it, back) {
  const [id, name, tex, basePrice, sellPrice] = it;
  pushRecent(player, id);
  const price = buyPrice(player, basePrice, sellPrice), sellTotal = (n) => sellPlan(player, id, sellPrice, n).total;
  const owned = countPlain(player, id), lim = hasLimit(id), left = lim ? remaining(player, id) : 0, uLeft = lim ? unitsLeft(player, id) : 0;
  const f = make(name); const refresh = () => detailPage(player, it, back); f.self = refresh;
  const ENCH = lim ? 0 : enchantsFor(id).length;
  let tip = hdr(1, glintOf(id, "c")) + "§f" + name + priceLines(it, player);
  if (sellPrice > 0) tip += `\n§r§f${G.chest} §7You own: §f${num(owned)}\n§r§f${G.coin} §7Worth: §a${money(sellTotal(owned))}`;
  tip += `\n§r§f${G.xp} §7XP per item: §b+${xpPerUnit(basePrice)}`;
  const nBought = total("b", id), nSold = total("s", id);
  if (nBought || nSold) tip += `\n§r§f${G.fire} §7Bought by everyone: §f${num(nBought)}\n§r§f${G.bag} §7Sold by everyone: §f${num(nSold)}`;
  if (sellPrice > 0 && UPGRADABLE.test(id)) tip += "\n§r§bEnchanted versions sell for more\n§r§7(use Sell Items - price depends on enchants)";
  if (lim) tip += `\n§r§f${G.hour} §cLimit: ${limitText(id)} per player` + (left > 0 ? `\n§r§f${G.clock} §cNext purchase in: §f${countdown(left)}` : `\n§r§aYou can still buy: §f${num(uLeft)}` + (uLeft < countOf(id) ? `\n§r§f${G.clock} §7Resets in: §f${countdown(resetIn(player, id))}` : ""));
  set(f, 1 * COLS + 4, tip, tex, null);
  set(f, 0 * COLS + 8, isFav(player, id) ? hdr(1, "g") + "§e§lIn your favorites\n§r§7Click to remove" : hdr(1) + "§e§lAdd to favorites\n§r§7Quick access from the Shop menu", "textures/ui/shop/ic_fav", {
    run: () => { if (toggleFav(player, id) === null) player.sendMessage(shopMsg(player, "§c[Shop] Your favorites list is full (" + MAX_FAV + ").")); refresh(); } });
  if (canShop(player)) {
    set(f, 0 * COLS + 0, hdr(1) + "§6§lEdit price\n§r§7Buy / sell price\n§r§eAdmins only", "textures/ui/shop/hud_money", { run: () => priceItemForm(player, it, refresh) });
    set(f, 0 * COLS + 1, hdr(1) + "§6§lEdit limit\n§r§7How many each player can buy\n§r§7and how often (1-48 hours)\n§r§7Now: §f" + limitText(id) + (limitSource(id) === "category" ? " §8(category)" : "") + "\n§r§eAdmins only", "textures/items/clock_item", { run: () => timeForm(player, id, refresh) });
  }
  if (lim && uLeft <= 0) set(f, 3 * COLS + 4, hdr(1) + "§c§lLOCKED\n§r§7Limit reached (" + limitText(id) + ")\n§r§7Available in §f" + countdown(left), NAV.no, null);
  else {
    const qs = lim ? [...new Set([1, 16, 64].map((q) => Math.min(q, uLeft)))] : ENCH ? [1] : [1, 16, 64];
    qs.forEach((q, k) => {
      const total = price * q, go = () => { buy(player, it, q); refresh(); };
      const warn = lim ? [`§7Cost: §a${money(total)}`, "", `§c⚠ Limit: ${limitText(id)} per player.`, `§7After this you can buy §f${num(uLeft - q)}§7 more in this period.`] : [`§7Cost: §a${money(total)}`];
      set(f, 3 * COLS + 2 + k * 2, hdr(q) + "§aBuy x" + q + "\n§r§7Total: §a" + money(total), tex,
        { run: lim || total >= 100000 ? () => confirmPage(player, lim ? "Limited purchase" : "Confirm purchase", [`§f${q}x ${name}`, ...warn], go, refresh) : go });
    });
    if (ENCH) set(f, 3 * COLS + 5, hdr(1, "g") + "§d§lEnchant with books\n§r§7Pick the enchantments you want\n§r§7The price grows with each one\n§r§7(" + ENCH + " enchantments available)\n§r§eClick to choose", NAV.book, { run: () => enchantPage(player, it, new Map(), refresh) });
  }
  if (sellPrice > 0) {
    (ENCH ? [] : [1, 16, 64]).forEach((q, k) => set(f, 5 * COLS + 2 + k * 2, hdr(q) + "§cSell x" + q + "\n§r§7Total: §c" + money(sellTotal(q)), tex, { run: () => { sell(player, it, q); refresh(); } }));
    if (owned > 0) set(f, 7 * COLS + 4, hdr(Math.min(owned, 99)) + "§c§lSell ALL of this item\n§r§7You own: §f" + num(owned) + "\n§r§7You get: §a" + money(sellTotal(owned)), tex, {
      run: () => confirmPage(player, "Sell all " + name, [`§7Amount: §f${num(owned)}`, `§7You receive: §a${money(sellTotal(owned))}`], () => { sell(player, it, countPlain(player, id)); refresh(); }, refresh) });
  }
  if (sellPrice > 0 && owned > 1) set(f, 7 * COLS + 6, hdr(1) + "§c§lSell custom amount\n§r§7Choose with a slider\n§r§7or type a number", tex, {
    run: () => askAmount(player, "Sell " + name, `§f${name} §7- you own §f${num(owned)}§7. How many to sell?`, owned, Math.min(owned, 16), (n) => {
      if (!n) return refresh();
      const t = sellTotal(n), go = () => { sell(player, it, n); refresh(); };
      if (t >= 100000) confirmPage(player, "Sell " + name, [`§7Amount: §f${num(n)}`, `§7You receive: §a${money(t)}`], go, refresh); else go();
    }) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ enchant picker for tools / armor (logic: enchantshop.js)
function enchantPage(player, it, sel, back) {
  const [id, name, tex] = it, list = enchantsFor(id), q = quote(player, it, sel);
  const f = make(name); f.self = () => enchantPage(player, it, sel, back);
  let tip = hdr(1, sel.size ? "z" : "c") + "§f" + name + "\n§r§7Item: §a" + money(q.base);
  for (const x of q.parts) tip += "\n§r§d" + x.e.name + " " + ROMAN[x.lv] + " §7+§a" + money(x.price);
  if (!q.parts.length) tip += "\n§r§7No enchantments chosen yet";
  set(f, 0 * COLS + 4, tip + "\n§r§6Total: §a" + money(q.total), tex, null);
  list.forEach((e, i) => {
    const lv = sel.get(e.id) ?? 0, nxt = lv + 1 <= e.max ? lv + 1 : 0, bt = enchantTag(e.id);
    set(f, (2 + Math.floor(i / COLS)) * COLS + (i % COLS), hdr(lv || 1, lv ? "g" : bt ? "r" : "c") + "§d" + e.name + (lv ? " " + ROMAN[lv] : "") + "\n§r§7Max level: §f" + ROMAN[e.max] + enchBadge(bt)
      + (nxt ? "\n§r§7Next: §f" + ROMAN[nxt] + " §7(+§a" + money(buyPrice(player, enchantCost(e, nxt), 0)) + "§7)\n§r§eClick to " + (lv ? "raise the level" : "add") : "\n§r§eClick to remove"), NAV.book,
      { run: () => { cycle(sel, e); enchantPage(player, it, sel, back); } });
  });
  if (sel.size) set(f, 6 * COLS + 2, hdr(1) + "§c§lClear\n§r§7Remove all enchantments", NAV.no, { run: () => enchantPage(player, it, new Map(), back) });
  set(f, 6 * COLS + 4, sel.size ? hdr(1, "g") + "§a§lBUY\n§r§7Total: §a" + money(q.total) + "\n§r§7Balance: §a" + money(balance(player)) : hdr(1) + "§7Choose at least one enchantment", sel.size ? NAV.ok : NAV.no,
    sel.size ? { run: () => confirmPage(player, "Buy enchanted item", [`§f${name}`, ...q.parts.map((x) => `§d${x.e.name} ${ROMAN[x.lv]} §7(+${money(x.price)})`), `§7Total: §a${money(q.total)}`],
      () => { if (buyEnchanted(player, it, sel)) enchantPage(player, it, new Map(), back); else enchantPage(player, it, sel, back); }, () => enchantPage(player, it, sel, back)) } : null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ Favorites / Recent (yours)  +  Most purchased / Best sellers (everybody)
const ITEMS_PAGE = {
  fav: { title: "Favorites", icon: "textures/ui/shop/ic_fav", empty: "No favorites yet", hint: "Open an item and press the star button" },
  recent: { title: "Recent", icon: "textures/ui/shop/ic_recent", empty: "Nothing here yet", hint: "Items you open appear here" },
  bought: { title: "Most purchased", icon: "textures/ui/shop/ic_fire", empty: "Nobody bought anything yet", hint: "The most bought items show up here" },
  sold: { title: "Best sellers", icon: "textures/ui/shop/ic_bag", empty: "Nobody sold anything yet", hint: "The most sold items show up here" },
};
function itemsPage(player, kind, page, back) {
  const meta = ITEMS_PAGE[kind];
  let rows;
  if (kind === "fav") rows = favList(player).map((id) => ({ it: BY_TYPE.get(id) }));
  else if (kind === "recent") rows = recentList(player).map((id) => ({ it: BY_TYPE.get(id) }));
  else rows = ranking(kind === "bought" ? "b" : "s").map(([id, n], i) => ({ it: BY_TYPE.get(id), n, rank: i + 1 }));
  rows = rows.filter((r) => r.it);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const again = () => itemsPage(player, kind, page, back);
  const f = make(meta.title + (pages > 1 ? ` §8(${page + 1}/${pages})` : "")); f.self = again;
  rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach((r, i) => {
    let text;
    if (r.rank) {
      const col = r.rank === 1 ? "§6" : r.rank === 2 ? "§f" : r.rank === 3 ? "§c" : "§7";          // 1st gold, 2nd white, 3rd red
      text = hdr(1, kind === "sold" ? "g" : "r") + col + "#" + r.rank + " §f" + (isFav(player, r.it[0]) ? G.star + " " : "") + r.it[1]
        + "\n§r§f" + (kind === "sold" ? G.bag + " §6Sold: §f" : G.fire + " §cBought: §f") + num(r.n) + priceLines(r.it, player);
    } else text = itemText(r.it, player);
    set(f, i, text, r.it[2], { run: () => detailPage(player, r.it, again) });
  });
  if (rows.length === 0) set(f, 3 * COLS + 4, hdr(1) + "§7" + meta.empty + "\n§r§8" + meta.hint, meta.icon, null);
  backBtn(f, back); status(player, f);
  if (kind === "recent" && rows.length) set(f, NAV_START + 6, hdr(1) + "§c§lClear recent\n§r§7Remove all of them", NAV.no, { run: () => { clearRecent(player); itemsPage(player, kind, 0, back); } });
  if (page > 0) set(f, NAV_START + 3, hdr(1) + "§aPrevious page\n§r§7Page " + page + "/" + pages, NAV.prev, { run: () => itemsPage(player, kind, page - 1, back) });
  set(f, NAV_START + 4, hdr(1) + "§ePage " + (page + 1) + "/" + pages + "\n§r§7" + rows.length + " items", NAV.page, null);
  if (page < pages - 1) set(f, NAV_START + 5, hdr(1) + "§aNext page\n§r§7Page " + (page + 2) + "/" + pages, NAV.next, { run: () => itemsPage(player, kind, page + 1, back) });
  sellButton(player, f);
  open(player, f);
}

// ================================================================ search: tap letters, the list narrows at once (names that START with the letters)
let SEARCH_LIST = null;
const searchList = () => {
  if (SEARCH_LIST) return SEARCH_LIST;
  const seen = new Set(), list = [];
  for (const cat of ALL) {
    if (cat.type === "shards") continue;
    for (const it of cat.items) {
      if (cat.type === "potion") { const eff = EFFECTS.find((x) => x.id === it[0]); if (eff) list.push({ name: eff.name, kind: "potion", eff, tex: it[2] }); }
      else if (cat.type === "book") { const e = ENCHANTS.find((x) => x.id === it[0]); if (e) list.push({ name: e.name, kind: "book", e, tex: NAV.book }); }
      else if (!seen.has(it[0])) { seen.add(it[0]); list.push({ name: it[1], kind: "item", it, tex: it[2] }); }
    }
  }
  for (const x of list) x.lc = x.name.toLowerCase();
  list.sort((a, b) => (a.lc < b.lc ? -1 : a.lc > b.lc ? 1 : 0));
  return (SEARCH_LIST = list);
};
const KEY_ROWS = 5, KEY_SLOT = 45, SEARCH_PER = 36, SEARCH_MAX = 30;       // rows 0-3 results, row 4 info, rows 5-7 letter keys, row 8 buttons
const cleanQuery = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9' \-]/g, "").replace(/\s+/g, " ").replace(/^ /, "").slice(0, SEARCH_MAX);

function searchPage(player, q, page, back) {
  q = cleanQuery(q);
  const all = searchList(), base = q ? all.filter((x) => x.lc.startsWith(q)) : all;
  const hits = q ? base : [];
  const pages = Math.max(1, Math.ceil(hits.length / SEARCH_PER));
  page = Math.min(Math.max(page, 0), pages - 1);
  const again = () => searchPage(player, q, page, back);
  const f = make("Search: §f" + (q ? q.toUpperCase() : "§8...")); f.self = again;
  hits.slice(page * SEARCH_PER, (page + 1) * SEARCH_PER).forEach((h, i) => {
    if (h.kind === "potion") set(f, i, hdr(1) + "§d" + h.eff.name + "\n§r§7" + h.eff.variants.length + " level" + (h.eff.variants.length > 1 ? "s" : "") + "\n§r§eClick to choose", h.tex, { run: () => potionPage(player, h.eff, again) });
    else if (h.kind === "book") { const bt = enchantTag(h.e.id); set(f, i, hdr(1, bt ? "r" : "c") + "§d" + h.e.name + "\n§r§7Max level: §f" + ROMAN[h.e.max] + enchBadge(bt) + "\n§r§eClick to choose a level", h.tex, { run: () => bookPage(player, h.e, again) }); }
    else set(f, i, itemText(h.it, player), h.tex, { run: () => detailPage(player, h.it, again) });
  });
  // row 4: what is going on
  const info = !q ? hdr(1) + "§b§lSearch\n§r§7Tap letters below.\n§r§7Only items that START with\n§r§7your letters stay in the list."
    : hits.length ? hdr(Math.min(hits.length, 99)) + "§a§l" + hits.length + " result" + (hits.length === 1 ? "" : "s") + "\n§r§7Starting with: §f" + q.toUpperCase()
    : hdr(1, "r") + "§c§lNothing found\n§r§7No item starts with §f" + q.toUpperCase() + "\n§r§7Tap Delete to go back a letter";
  set(f, 4 * COLS + 4, info, "textures/ui/shop/key_search", null);
  // rows 5-7: letter keys. The number on a key = how many results you would get. Red = nothing starts with that.
  const next = new Map();
  for (const x of base) { const ch = x.lc[q.length]; if (ch !== undefined) next.set(ch, (next.get(ch) ?? 0) + 1); }
  const keys = "abcdefghijklmnopqrstuvwxyz ".split("");
  keys.forEach((ch, i) => {
    const n = next.get(ch) ?? 0, slot = KEY_SLOT + i, name = ch === " " ? "Space" : ch.toUpperCase(), icon = "textures/ui/shop/key_" + (ch === " " ? "space" : ch);
    const ok = n > 0 && q.length < SEARCH_MAX && !(ch === " " && (q === "" || q.endsWith(" ")));
    if (ok) set(f, slot, hdr(n) + "§a§l" + name + "\n§r§7" + n + " item" + (n === 1 ? "" : "s") + " start with §f" + (q + ch).toUpperCase().replace(/ $/, "_"), icon, { run: () => searchPage(player, q + ch, 0, back) });
    else set(f, slot, hdr(0, "r"), icon, null);
  });
  // row 8: buttons
  backBtn(f, back); status(player, f);
  set(f, NAV_START + 2, hdr(1) + "§bType the start\n§r§7Write letters with the keyboard", "textures/ui/shop/key_search", {
    run: () => {
      const form = new ShopForm().title("Search");
      try { form.textField("§7Type the start of the name", "e.g. dia", { defaultValue: q }); } catch (e) { form.textField("§7Type the start of the name", "e.g. dia"); }
      formBusy.add(player.id);
      const go = (tries) => form.show(player).then((res) => {
        if (res.canceled) { if (res.cancelationReason === FormCancelationReason.UserBusy && tries < 25) { system.runTimeout(() => go(tries + 1), 8); return; } formBusy.delete(player.id); updateHud(player); return; }
        formBusy.delete(player.id);
        searchPage(player, (res.formValues ?? [])[0], 0, back);
      }).catch(() => formBusy.delete(player.id));
      go(0);
    } });
  if (q) {
    set(f, NAV_START + 3, hdr(1) + "§e§lDelete\n§r§7Remove the last letter", "textures/ui/shop/key_del", { run: () => searchPage(player, q.slice(0, -1), 0, back) });
    set(f, NAV_START + 4, hdr(1) + "§c§lClear\n§r§7Start again", NAV.no, { run: () => searchPage(player, "", 0, back) });
  }
  if (page > 0) set(f, NAV_START + 6, hdr(1) + "§aPrevious page\n§r§7Page " + page + "/" + pages, NAV.prev, { run: () => searchPage(player, q, page - 1, back) });
  if (pages > 1) set(f, NAV_START + 7, hdr(1) + "§ePage " + (page + 1) + "/" + pages, NAV.page, null);
  if (page < pages - 1) set(f, NAV_START + 8, hdr(1) + "§aNext page\n§r§7Page " + (page + 2) + "/" + pages, NAV.next, { run: () => searchPage(player, q, page + 1, back) });
  open(player, f);
}

// ================================================================ enchanted books
function bookPage(player, e, back) {
  const key = bookKey(e.id), lim = hasLimit(key), uLeft = lim ? unitsLeft(player, key) : 0;
  const f = make(e.name); f.self = () => bookPage(player, e, back);
  set(f, 1 * COLS + 4, hdr(1) + "§d" + e.name + "\n§r§7Max level: §f" + ROMAN[e.max] + "\n§r§7Choose the level you want" + (lim ? `\n§r§f${G.hour} §cLimit: ${limitText(key)} per player\n§r§7You can still buy: §f${num(uLeft)}` + (uLeft < countOf(key) ? `\n§r§f${G.clock} §7Resets in: §f${countdown(resetIn(player, key))}` : "") : ""), NAV.book, null);
  if (canShop(player)) {
    set(f, 0 * COLS + 0, hdr(1) + "§6§lEdit price\n§r§7Price of level I\n§r§7(each level doubles it)\n§r§eAdmins only", "textures/ui/shop/hud_money", { run: () => bookPriceForm(player, e, () => bookPage(player, e, back)) });
    set(f, 0 * COLS + 1, hdr(1) + "§6§lEdit limit\n§r§7How many each player can buy\n§r§7and how often (1-48 hours)\n§r§7Now: §f" + limitText(key) + (limitSource(key) === "category" ? " §8(category)" : "") + "\n§r§eAdmins only", "textures/items/clock_item", { run: () => timeForm(player, key, () => bookPage(player, e, back)) });
  }
  const start = Math.floor((COLS - e.max) / 2);
  if (lim && uLeft <= 0) set(f, 3 * COLS + 4, hdr(1) + "§c§lLOCKED\n§r§7Limit reached (" + limitText(key) + ")\n§r§7Available in §f" + countdown(resetIn(player, key)), NAV.no, null);
  else for (let lv = 1; lv <= e.max; lv++) {
    const price = buyPrice(player, bookPrice(e, lv), 0);
    const lt = enchantLevelTag(e.id, lv);
    set(f, 3 * COLS + start + lv - 1, hdr(lv, lt ? "r" : "c") + "§d" + e.name + " " + ROMAN[lv] + "\n§r§7Price: §a" + money(price) + enchBadge(lt) + "\n§r§eClick to buy", NAV.book,
      { run: () => confirmPage(player, "Buy enchanted book", [`§d${e.name} ${ROMAN[lv]}`, `§7Cost: §a${money(price)}`, ...(lim ? ["", `§c⚠ Limit: ${limitText(key)} per player.`] : [])], () => { buyBook(player, e, lv); bookPage(player, e, back); }, () => bookPage(player, e, back)) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function buyBook(p, e, level) {
  { const em = econMsg(p); if (em) return p.sendMessage(shopMsg(p, em)); }
  const basePrice = bookPrice(e, level), price = buyPrice(p, basePrice, 0), key = bookKey(e.id);
  adminLoad();
  { const lb = limitBlock(p, key, e.name + " books", 1); if (lb) return p.sendMessage(shopMsg(p, lb)); }
  if (balance(p) < price) return p.sendMessage(shopMsg(p, `§c[Shop] Not enough money. Need §f${money(price)}§c.`));
  if (container(p).emptySlotsCount < 1) return p.sendMessage(shopMsg(p, "§c[Shop] Your inventory is full."));
  let book;
  try {
    book = new ItemStack("minecraft:enchanted_book", 1);
    const type = EnchantmentTypes.get(e.id); if (!type) throw new Error("unknown enchantment");
    book.getComponent("enchantable").addEnchantment({ type, level });
  } catch (err) { return p.sendMessage(shopMsg(p, `§c[Shop] ${e.name} is not available in this game version.`)); }
  takeMoney(p, price); container(p).addItem(book); stamp(p, key, 1);
  addTx(p, { type: "buy", id: "enchanted_book", name: `${e.name} ${ROMAN[level]} (book)`, qty: 1, total: price });
  try { countEnchants([[e.id, level]]); } catch (err) { /* ignore */ }
  buyFx(p, price); p.sendMessage(shopMsg(p, `§c+1 ${e.name} ${ROMAN[level]} (-${money(price)})`)); luxDing(p); luxShop(p);
  addXp(p, "b", xpPerUnit(basePrice));
}

// ================================================================ potions (data, prices and delivery: potions.js)
function potionPage(player, eff, back) {
  const f = make(eff.name); f.self = () => potionPage(player, eff, back);
  set(f, 1 * COLS + 4, hdr(1) + "§d" + eff.name + "\n§r§7Pick the type and the level\n§r§7Buying is expensive, selling pays little", potionIcon(eff, FORMS[0]), null);
  FORMS.forEach((form, r) => {
    const row = 2 + r * 2;
    set(f, row * COLS + 1, hdr(1) + form.color + form.label + "\n§r§7" + form.desc, potionIcon(eff, form), null);
    eff.variants.forEach((v, k) => {
      const pr = potionPrice(eff, form, v);
      set(f, row * COLS + 3 + k * 2, hdr(1) + form.color + potionName(eff, form, v) + "\n§r§7Buy: §a" + money(pr.buy) + "\n§r§7Sell: §c" + (pr.sell > 0 ? money(pr.sell) : "can not be sold") + (hasLimit(potionKey(eff, form, v)) ? "\n§r§cLimit: " + limitText(potionKey(eff, form, v)) : "") + "\n§r§eClick to open", potionIcon(eff, form),
        { run: () => potionBuyPage(player, eff, form, v, () => potionPage(player, eff, back)) });
    });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function potionBuyPage(player, eff, form, v, back) {
  const name = potionName(eff, form, v), pr = potionPrice(eff, form, v), icon = potionIcon(eff, form), key = potionKey(eff, form, v);
  const owned = potionOwned(player, eff, form, v), left = sellLeft(player), lim = hasLimit(key), uLeft = lim ? unitsLeft(player, key) : 0;
  const f = make(name); const refresh = () => potionBuyPage(player, eff, form, v, back); f.self = refresh;
  let tip = hdr(1) + form.color + name + "\n§r§7Buy: §a" + money(pr.buy) + "\n§r§7Sell: §c" + (pr.sell > 0 ? money(pr.sell) : "can not be sold");
  if (owned >= 0) tip += "\n§r§7You own: §f" + num(owned);
  tip += "\n§r§8Sell limit: " + left + "/" + SELL_CAP + " potions per hour\n§r§8Potions do not stack - one slot each";
  if (lim) tip += `\n§r§f${G.hour} §cBuy limit: ${limitText(key)} per player\n§r§7You can still buy: §f${num(uLeft)}` + (uLeft < countOf(key) ? `\n§r§f${G.clock} §7Resets in: §f${countdown(resetIn(player, key))}` : "");
  set(f, 1 * COLS + 4, tip, icon, null);
  if (canShop(player)) {
    set(f, 0 * COLS + 0, hdr(1) + "§6§lEdit price\n§r§7Buy / sell price\n§r§eAdmins only", "textures/ui/shop/hud_money", { run: () => potionPriceForm(player, eff, form, v, refresh) });
    set(f, 0 * COLS + 1, hdr(1) + "§6§lEdit limit\n§r§7How many each player can buy\n§r§7and how often (1-48 hours)\n§r§7Now: §f" + limitText(key) + (limitSource(key) === "category" ? " §8(category)" : "") + "\n§r§eAdmins only", "textures/items/clock_item", { run: () => timeForm(player, key, refresh) });
  }
  if (lim && uLeft <= 0) set(f, 3 * COLS + 4, hdr(1) + "§c§lLOCKED\n§r§7Limit reached (" + limitText(key) + ")\n§r§7Available in §f" + countdown(resetIn(player, key)), NAV.no, null);
  else [...new Set([1, 5].map((q) => Math.min(q, lim ? uLeft : q)))].forEach((q, k) => {
    const total = pr.buy * q;
    set(f, 3 * COLS + 3 + k * 2, hdr(q) + "§aBuy x" + q + "\n§r§7Total: §a" + money(total), icon,
      { run: () => confirmPage(player, lim ? "Limited purchase" : "Confirm purchase", [`§f${q}x ${name}`, `§7Cost: §a${money(total)}`, ...(lim ? ["", `§c⚠ Limit: ${limitText(key)} per player.`] : [])], () => { buyPotion(player, eff, form, v, q); refresh(); }, refresh) });
  });
  if (pr.sell < 1) set(f, 5 * COLS + 4, hdr(1) + "§8Can not sell\n§r§7The admin turned selling\n§r§7of this potion off", NAV.no, null);
  else if (owned < 0) set(f, 5 * COLS + 4, hdr(1) + "§8Can not sell\n§r§7This game version can not tell\n§r§7potions apart", NAV.no, null);
  else if (owned < 1) set(f, 5 * COLS + 4, hdr(1) + "§8Nothing to sell\n§r§7You carry no unmodified\n§r§7" + name, NAV.no, null);
  else if (left < 1) set(f, 5 * COLS + 4, hdr(1) + "§c§lSELL LIMIT\n§r§7Next sale possible in §f" + countdown(sellResetIn(player)), NAV.no, null);
  else {
    const all = Math.min(owned, left);
    set(f, 5 * COLS + 3, hdr(1) + "§cSell x1\n§r§7You get: §a" + money(pr.sell), icon, { run: () => { sellPotion(player, eff, form, v, 1); refresh(); } });
    set(f, 5 * COLS + 5, hdr(Math.min(all, 99)) + "§c§lSell " + (all > 1 ? "x" + all : "x1") + "\n§r§7You get: §a" + money(pr.sell * all), icon, { run: () => { sellPotion(player, eff, form, v, all); refresh(); } });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ SELL: move items into the red box, then sell
const SEL = new Map();         // player id -> [{slot, typeId, amount}]   (amount = how many of that stack go into the box)
const getSel = (p) => { let a = SEL.get(p.id); if (!a) { a = []; SEL.set(p.id, a); } return a; };
/** { it, unit, up } for a REAL stack (enchants / damage counted), or null when it can't be sold */
const sellInfo = (st) => {
  const it = BY_TYPE.get(st.typeId.replace("minecraft:", "")); if (!it) return null;
  const v = stackValue(st, it); return v.unit > 0 ? { it, unit: v.unit, up: v.up } : null;
};
function addToBox(p, slot, typeId, n) {
  const sel = getSel(p), x = sel.find((y) => y.slot === slot);
  if (x) x.amount += n;
  else if (sel.length >= 36) p.sendMessage(shopMsg(p, "§7[Sell] The sell box is full (36 stacks) - sell first."));
  else sel.push({ slot, typeId, amount: n });
}

/** slider (the "line") + optional typed number -> done(n) with 1..max, or done(null) if cancelled */
function askAmount(player, title, label, max, def, done, tries = 0) {
  const form = new ShopForm().title(title);
  def = Math.max(1, Math.min(def, max));
  try { form.slider(label, 1, max, { valueStep: 1, defaultValue: def }); } catch (e) { form.slider(label, 1, max, 1, def); }
  let hasText = true;
  try { form.textField("§7...or type an exact number (optional)", "e.g. 25", { defaultValue: "" }); }
  catch (e) { try { form.textField("§7...or type an exact number (optional)", "e.g. 25"); } catch (e2) { hasText = false; } }
  formBusy.add(player.id);
  form.show(player).then((res) => {
    if (res.canceled) {
      if (res.cancelationReason === FormCancelationReason.UserBusy && tries < 25) { system.runTimeout(() => askAmount(player, title, label, max, def, done, tries + 1), 8); return; }
      formBusy.delete(player.id); updateHud(player); done(null); return;
    }
    formBusy.delete(player.id);
    const v = res.formValues ?? [];
    let n = Math.round(Number(v[0]));
    const typed = hasText ? String(v[1] ?? "").trim() : "";
    if (typed) {
      if (/^\d+$/.test(typed)) n = parseInt(typed, 10);
      else player.sendMessage(shopMsg(player, `§7[Shop] "${typed}" is not a number - using the slider value.`));
    }
    if (!(n >= 1)) n = 1;
    if (n > max) { n = max; player.sendMessage(shopMsg(player, `§7[Shop] You only have ${num(max)} - using ${num(max)}.`)); }
    done(n);
  }).catch((e) => { formBusy.delete(player.id); console.warn("amount form failed: " + e); });
}

function sellPage(player) {
  const c = container(player);
  const sel = getSel(player).filter((x) => { const st = c.getItem(x.slot); return st && st.typeId === x.typeId && st.amount >= x.amount && sellInfo(st); });
  SEL.set(player.id, sel);
  const f = make("Sell Items"); f.self = () => sellPage(player);
  const chosen = new Map(sel.map((x) => [x.slot, x.amount]));
  let total = 0, count = 0;
  const used = new Map(), bonusOn = sellBonusPct(player) > 0;
  // red box (slots 0-35)
  for (let i = 0; i < 36; i++) {
    const x = sel[i];
    if (!x) { f.buttons[i] = ["r00", undefined]; continue; }
    const info = sellInfo(c.getItem(x.slot)), val = sellPlan(player, info.it[0], info.unit, x.amount, used).total; total += val; count += x.amount;
    set(f, i, hdr(x.amount, "r") + "§f" + info.it[1] + (info.up ? " §b(enchanted)" : "") + `\n§r§7Amount: §f${num(x.amount)}\n§r§7Sell each: §c${money(info.unit)}\n§r§7Value: §a${money(val)}\n§r§eClick to move back`, info.it[2],
      { run: () => { SEL.set(player.id, getSel(player).filter((y) => y.slot !== x.slot)); sellPage(player); } });
  }
  set(f, NAV_START + 4, hdr(1) + "§e§lSELL BOX (red, top)   INVENTORY (green, below)\n§r§7Tap an item below, then choose HOW MANY to move\n§r§7(slider or typed number).\n§r§7Nothing is sold until you press §aSELL§7.", NAV.page, null);
  // green inventory (main rows 4-6, hotbar row 7)
  const invSlots = [];
  for (let s = 9; s < 36; s++) invSlots.push([s, 36 + (s - 9)]);
  for (let s = 0; s < 9; s++) invSlots.push([s, 63 + s]);
  for (const [s, pos] of invSlots) {
    const st0 = c.getItem(s), st = isMark(st0) ? undefined : st0, rem = st ? st.amount - (chosen.get(s) ?? 0) : 0;      // the red sell-slot block is not an item to sell
    if (!st || rem <= 0) { f.buttons[pos] = ["g00", undefined]; continue; }
    const id = st.typeId.replace("minecraft:", ""), info = sellInfo(st);
    if (info) {
      const name = info.it[1];
      set(f, pos, hdr(rem, "g") + "§f" + name + (info.up ? " §b(enchanted)" : "") + `\n§r§7Amount: §f${num(rem)}\n§r§7Sell each: §c${money(info.unit)}\n§r§7Total value: §a${money(sellPlan(player, info.it[0], info.unit, rem).total)}\n§r§e` + (rem > 1 ? "Click to choose how many" : "Click to move to the sell box"), info.it[2], {
        run: () => {
          if (rem <= 1) { addToBox(player, s, st.typeId, 1); sellPage(player); return; }
          askAmount(player, "Sell " + name, `§f${name} §7- you have §f${num(rem)}§7. How many to sell?`, rem, rem, (n) => { if (n) addToBox(player, s, st.typeId, n); sellPage(player); });
        } });
    } else {
      const known = BY_TYPE.get(id), why = known && known[4] > 0 ? "Renamed / custom item - cannot be sold" : "Not sellable";
      set(f, pos, hdr(rem, "g") + "§f" + (st.nameTag ?? (known ? known[1] : pretty(id))) + "\n§r§8" + why, known ? known[2] : "textures/items/" + id, { run: () => { player.sendMessage(shopMsg(player, `§7[Sell] ${why}.`)); sellPage(player); } });
    }
  }
  backBtn(f, () => mainMenu(player)); status(player, f);
  set(f, NAV_START + 2, hdr(1) + "§cClear box\n§r§7Return everything", NAV.no, { run: () => { SEL.set(player.id, []); sellPage(player); } });
  set(f, NAV_START + 3, hdr(1) + "§eSelect all sellable\n§r§7Fills the box (nothing is sold yet)", NAV.chest, {
    run: () => { for (const [s] of invSlots) { const st = c.getItem(s); if (!st || !sellInfo(st)) continue; const rem = st.amount - (chosen.get(s) ?? 0); if (rem > 0) addToBox(player, s, st.typeId, rem); } sellPage(player); } });
  set(f, NAV_START + 5, hdr(1) + "§a§lSELL NOW\n§r§7Items: §f" + num(count) + "\n§r§7You get: §a" + money(total) + (bonusOn ? "\n§r§8Sell bonus: +" + sellBonusPct(player) + "% (not on items\n§r§8bought from the shop / villagers)" : ""), NAV.ok, {
    run: () => { if (total <= 0) player.sendMessage(shopMsg(player, "§7[Sell] The sell box is empty.")); else { sellStacks(player, sel, sellInfo); SEL.set(player.id, []); } sellPage(player); } });
  { const on = sellSlotOn(player);   // the red sell slot switch (top-right slot of the backpack)
    set(f, NAV_START + 7, hdr(1, on ? "g" : "r") + "§c§lRed sell slot: " + (on ? "§aON" : "§cOFF") + "\n§r§7Top-right slot of your backpack\n§r§7Move an item into it = sold at once\n§r§7OFF = a normal slot\n§r§eClick to turn " + (on ? "OFF" : "ON"), "textures/items/redstone_dust", { run: () => { toggleSellSlot(player); sellPage(player); } }); }
  open(player, f);
}

// ================================================================ shards shop
function listPage(player, title, entries, back, page = 0, extra = null) {
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE)); page = Math.min(Math.max(page, 0), pages - 1);
  const f = make(`${title} §8(${page + 1}/${pages})`); f.self = () => listPage(player, title, entries, back, page, extra);
  entries.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach((e, i) => set(f, i, e.text, e.icon, { run: e.run }));
  backBtn(f, back); status(player, f);
  if (extra) { try { extra(f); } catch (e) { /* ignore */ } }
  if (page > 0) set(f, NAV_START + 3, hdr(1) + "§aPrevious page", NAV.prev, { run: () => listPage(player, title, entries, back, page - 1, extra) });
  set(f, NAV_START + 4, hdr(1) + "§ePage " + (page + 1) + "/" + pages, NAV.page, null);
  if (page < pages - 1) set(f, NAV_START + 5, hdr(1) + "§aNext page", NAV.next, { run: () => listPage(player, title, entries, back, page + 1, extra) });
  open(player, f);
}
function spawnerList(player, back) {
  const again = () => spawnerList(player, back);
  listPage(player, "Spawners", SPAWNERS.map((m) => ({ icon: NAV.spawner, run: () => specialPage(player, "spawner", m, again),
    text: hdr(1) + "§f" + m.name + " Spawner\n§r§7Shards: §d" + num(specialPrice("spawner", "shards", m, player)) + "\n§r§7Money: §a" + money(specialPrice("spawner", "money", m, player)) + "\n§r§eClick to buy" })), back, 0, (f) => adminBtns(player, f, { prices: () => adminList(player, "spawner", again), time: () => timeForm(player, "spawner", again) }));
}
function eggList(player, back) {
  const again = () => eggList(player, back);
  listPage(player, "Spawn Eggs", EGGS.map((m) => ({ icon: "textures/ui/shop/egg_" + m.id, run: () => specialPage(player, "egg", m, again),
    text: hdr(1) + "§f" + m.name + " Spawn Egg\n§r§7Shards: §d" + num(m.shards) + "\n§r§7Money: §a" + money(specialPrice("egg", "money", m, player)) + "\n§r§eClick to buy" })), back, 0, (f) => adminBtns(player, f, { prices: () => adminList(player, "egg", again), time: () => timeForm(player, "spawn_egg", again) }));
}
function shardsMenu(player) {
  const f = make("Shards Shop"); f.self = () => shardsMenu(player);
  const s = stats(player), back = () => shardsMenu(player);
  set(f, 1 * COLS + 4, hdr(1) + "§d§lYour Shards\n§r§7Balance: §d" + num(s.shards) + "\n§r§8Earn 1 shard per kill (40 in a 1 vs 1 duel)", NAV.shard, null);
  set(f, 4 * COLS + 2, hdr(1) + "§fSpawners\n§r§7" + SPAWNERS.length + " mobs\n§r§7From §d" + num(specialPrice("spawner", "shards", null, player)) + " shards §7or §a" + money(specialPrice("spawner", "money", null, player)), NAV.spawner, { run: () => spawnerList(player, back) });
  set(f, 4 * COLS + 4, hdr(1) + "§fSpawn Eggs\n§r§7" + EGGS.length + " mobs\n§r§7From §d" + num(Math.min(...EGGS.map((e) => e.shards))) + " shards §7or §a" + money(buyPrice(player, Math.min(...EGGS.map((e) => e.money)), 0)), "textures/ui/shop/egg_pig", { run: () => eggList(player, back) });
  const items = SHARD_ITEMS.filter(([id]) => BY_TYPE.has(id));
  set(f, 4 * COLS + 6, hdr(1) + "§fItems for shards\n§r§7" + items.length + " items", BY_TYPE.get("diamond")[2], { run: () => shardItems(player, back) });
  set(f, 7 * COLS + 4, hdr(1) + `§ePurchase limits (per player)\n§r§7Spawner: ${limitText("spawner")}\n§r§7Spawn egg: ${limitText("spawn_egg")}\n§r§7Elytra: ${limitText("elytra")}`, "textures/ui/shop/ic_help", null);
  if (canShop(player)) set(f, 7 * COLS + 6, hdr(1) + "§6§lEdit limits\n§r§7How many each player can buy\n§r§7and how often (spawner, egg, elytra ...)\n§r§eAdmins only - click to change", "textures/items/clock_item", { run: () => adminList(player, "limit", back) });
  backBtn(f, () => mainMenu(player)); status(player, f);
  open(player, f);
}
function shardItems(player, back) {
  const entries = SHARD_ITEMS.filter(([id]) => BY_TYPE.has(id)).map(([id, qty, shards]) => {
    const it = BY_TYPE.get(id), e = { id, name: it[1], qty, shards }, lim = hasLimit(id), left = lim ? remaining(player, id) : 0, uLeft = lim ? unitsLeft(player, id) : 0;
    const go = () => { buyShardItem(player, e); shardItems(player, back); };
    return {
      icon: it[2],
      text: hdr(Math.min(qty, 99), glintOf(id, "c")) + "§f" + it[1] + " §7x" + qty + "\n§r§7Price: §d" + num(shards) + " shards" + (lim ? `\n§r§cLimit: ${limitText(id)}` + (left > 0 ? `\n§r§cNext in: §f${countdown(left)}` : `\n§r§7Left: §f${num(uLeft)}`) : "") + "\n§r§eClick to buy",
      run: shards >= 100 || lim ? () => confirmPage(player, "Confirm purchase", [`§f${qty}x ${it[1]}`, `§7Cost: §d${num(shards)} shards`, ...(lim ? ["", `§c⚠ Limit: ${limitText(id)} per player.`] : [])], go, () => shardItems(player, back)) : go,
    };
  });
  listPage(player, "Shard Items", entries, back, 0, (f) => adminBtns(player, f, { prices: () => adminList(player, "item", () => shardItems(player, back)), time: () => adminList(player, "shardlimit", () => shardItems(player, back)) }));
}
function specialPage(player, kind, mob, back) {
  const key = specialKey(kind), left = remaining(player, key), hours = hoursOf(key), uLeft = unitsLeft(player, key);
  const label = kind === "spawner" ? `${mob.name} Spawner` : `${mob.name} Spawn Egg`, icon = kind === "spawner" ? NAV.spawner : "textures/ui/shop/egg_" + mob.id;
  const f = make(label); const refresh = () => specialPage(player, kind, mob, back); f.self = refresh;
  set(f, 1 * COLS + 4, hdr(1) + "§f" + label + "\n§r§7Shards: §d" + num(specialPrice(kind, "shards", mob, player)) + "\n§r§7Money: §a" + money(specialPrice(kind, "money", mob, player)) +
    `\n§r§cLimit: ${limitText(key)} per player` + (left > 0 ? `\n§r§cNext purchase in: §f${countdown(left)}` : `\n§r§aYou can still buy: §f${num(uLeft)}`), icon, null);
  for (const [cur, col, tex, color] of [["shards", 3, NAV.shard, "§d"], ["money", 5, NAV.bal, "§a"]]) {
    const price = specialPrice(kind, cur, mob, player), txt = cur === "shards" ? num(price) + " shards" : money(price);
    if (left > 0) set(f, 3 * COLS + col, hdr(1) + "§c§lLOCKED\n§r§7Available in §f" + countdown(left), NAV.no, null);
    else set(f, 3 * COLS + col, hdr(1) + color + "Buy with " + (cur === "shards" ? "Shards" : "Money") + "\n§r§7Price: " + color + txt, tex, {
      run: () => confirmPage(player, "⚠ WARNING ⚠", [`§f${label}`, `§7Price: ${color}${txt}`, "", `§cLimit: ${limitText(key)} per player (${kind === "spawner" ? "spawners" : "spawn eggs"}).`, `§7You can still buy §f${num(uLeft)}§7 in this period.`, "", "§eMake sure you picked the right mob!"],
        () => { buySpecial(player, kind, mob, cur); refresh(); }, refresh) });
  }
  if (canShop(player)) {
    set(f, 6 * COLS + 3, hdr(1) + "§6§lEdit price\n§r§7Change the money / shards price\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => priceForm(player, kind, mob, refresh) });
    set(f, 6 * COLS + 5, hdr(1) + "§6§lEdit limit\n§r§7How many each player can buy\n§r§7and how often (1-48 hours)\n§r§7Now: §f" + limitText(key) + "\n§r§eAdmins only - click to change", "textures/items/clock_item", { run: () => timeForm(player, key, refresh) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ admin: prices and times of the shards shop (admins only, same rule as the mining prices)
const canShop = (p) => { try { return isAdmin(p) || can(p, "landlimit"); } catch (e) { return false; } };
function adminBtns(player, f, a) {
  if (!canShop(player)) return;
  set(f, NAV_START + 7, hdr(1) + "§6§lEdit prices\n§r§7Change the price of an entry\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: a.prices });
  if (a.time) set(f, NAV_START + 8, hdr(1) + "§6§lEdit limits\n§r§7How many each player can buy\n§r§7and how often (1-48 hours)\n§r§eAdmins only - click to change", "textures/items/clock_item", { run: a.time });
}
const spawnerShardsNow = (m) => SP_SHARDS[m.id] ?? shardsOf(PRICES[m.id]);
function adminList(player, kind, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const again = () => adminList(player, kind, back);
  let entries = [], title = "";
  if (kind === "spawner") {
    title = "Edit spawner prices";
    entries = SPAWNERS.map((m) => ({ icon: NAV.spawner, run: () => priceForm(player, "spawner", m, again),
      text: hdr(1) + "§f" + m.name + " Spawner\n§r§7Shards: §d" + num(spawnerShardsNow(m)) + "\n§r§7Money: §a" + money(PRICES[m.id]) + (PRICES[m.id] !== baseSpawner(m.id) || SP_SHARDS[m.id] ? "\n§r§6Changed" : "\n§r§8Normal price") + "\n§r§eClick to change" }));
  } else if (kind === "egg") {
    title = "Edit egg prices";
    entries = EGGS.map((m) => ({ icon: "textures/ui/shop/egg_" + m.id, run: () => priceForm(player, "egg", m, again),
      text: hdr(1) + "§f" + m.name + " Spawn Egg\n§r§7Shards: §d" + num(m.shards) + "\n§r§7Money: §a" + money(m.money) + (m.money !== baseEgg(m.id).m || m.shards !== baseEgg(m.id).s ? "\n§r§6Changed" : "\n§r§8Normal price") + "\n§r§eClick to change" }));
  } else if (kind === "item") {
    title = "Edit item prices";
    entries = SHARD_ITEMS.filter(([id]) => BY_TYPE.has(id)).map((x) => ({ icon: BY_TYPE.get(x[0])[2], run: () => priceForm(player, "item", x, again),
      text: hdr(Math.min(x[1], 99)) + "§f" + BY_TYPE.get(x[0])[1] + " §7x" + x[1] + "\n§r§7Price: §d" + num(x[2]) + " shards" + (x[2] !== baseItem(x[0]) ? "\n§r§6Changed - normal: §d" + num(baseItem(x[0])) : "\n§r§8Normal price") + "\n§r§eClick to change" }));
  } else if (kind === "shardlimit") {
    title = "Edit limits - shard items";
    entries = SHARD_ITEMS.filter(([id]) => BY_TYPE.has(id)).map((x) => ({ icon: BY_TYPE.get(x[0])[2], run: () => timeForm(player, x[0], again),
      text: hdr(Math.min(x[1], 99)) + "§f" + BY_TYPE.get(x[0])[1] + " §7x" + x[1] + "\n§r§7Limit: §f" + limitText(x[0]) + "\n§r§eClick to change" }));
  } else {
    title = "Edit limits";
    entries = LIMIT_KEYS.map((k) => ({ icon: "textures/items/clock_item", run: () => timeForm(player, k, again),
      text: hdr(1) + "§f" + LIMIT_NAMES[k] + "\n§r§7" + limitText(k) + (hoursOf(k) !== baseLimit(k) || countOf(k) !== 1 ? "\n§r§6Changed - normal: §f1 every " + hoursTxt(baseLimit(k)) : "\n§r§8Normal limit") + "\n§r§eClick to change" }));
  }
  listPage(player, title, entries, back);
}
const numOf = (raw) => (/^[0-9]{1,9}$/.test(raw) ? Number(raw) : NaN);
const toggleDef = (form, label) => { try { form.toggle(label, { defaultValue: false }); } catch (e) { form.toggle(label, false); } };
function priceForm(player, kind, ent, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const form = new ShopForm();
  let name, id;
  if (kind === "spawner") {
    name = ent.name + " Spawner"; id = ent.id;
    form.title(name + " price");
    textField(form, "§fMoney price\n§7Now: §a" + money(PRICES[id]) + " §7| normal: §f" + money(baseSpawner(id)) + "\n§7Whole number, 1 to " + MAX_MONEY, String(PRICES[id]));
    textField(form, "§fShards price\n§7Now: §d" + num(spawnerShardsNow(ent)) + (SP_SHARDS[id] ? "" : " §8(automatic)") + " §7| normal: §f" + num(shardsOf(baseSpawner(id))) + "\n§7Whole number, 1 to " + MAX_SHARDS, String(spawnerShardsNow(ent)));
    toggleDef(form, "§eShards price automatic (follows the money price)");
  } else if (kind === "egg") {
    name = ent.name + " Spawn Egg"; id = ent.id;
    form.title(name + " price");
    textField(form, "§fMoney price\n§7Now: §a" + money(ent.money) + " §7| normal: §f" + money(baseEgg(id).m) + "\n§7Whole number, 1 to " + MAX_MONEY, String(ent.money));
    textField(form, "§fShards price\n§7Now: §d" + num(ent.shards) + " §7| normal: §f" + num(baseEgg(id).s) + "\n§7Whole number, 1 to " + MAX_SHARDS, String(ent.shards));
  } else {
    id = ent[0]; name = BY_TYPE.get(id)[1];
    form.title(name + " price");
    textField(form, "§fShards price\n§7Now: §d" + num(ent[2]) + " §7| normal: §f" + num(baseItem(id)) + "\n§7Whole number, 1 to " + MAX_SHARDS, String(ent[2]));
  }
  const nf = kind === "item" ? 1 : 2, extraToggles = kind === "spawner" ? 1 : 0;
  toggleDef(form, "§cReset to the normal price");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const reset = v[nf + extraToggles] === true, auto = kind === "spawner" && v[nf] === true;
    let err = null;
    if (reset) err = resetOne(kind, id);
    else {
      const a = String(v[0] ?? "").trim(), b = String(v[1] ?? "").trim();
      if (kind === "item") { if (a === "") return back(); err = setItem(id, numOf(a)); }
      else {
        if (a === "" && b === "" && !auto) return back();
        const m = a === "" ? (kind === "spawner" ? PRICES[id] : ent.money) : numOf(a);
        if (kind === "spawner") { const s = auto ? null : b === "" ? (SP_SHARDS[id] ?? null) : numOf(b); err = setSpawner(id, m, s); }
        else err = setEgg(id, m, b === "" ? ent.shards : numOf(b));
      }
    }
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : reset ? "§a[Shop] " + name + " is back to the normal price." : "§a[Shop] " + name + " price saved."));
    back();
  });
}
function keyName(key) {
  if (LIMIT_NAMES[key]) return LIMIT_NAMES[key];
  if (key.startsWith("book:")) { const e = ENCHANTS.find((x) => bookKey(x.id) === key); return e ? e.name + " (book)" : key; }
  const x = POTIONS.get(key); if (x) return potionName(x.eff, x.form, x.v);
  return BY_TYPE.get(key) ? BY_TYPE.get(key)[1] : key;
}
const dropdownDef = (form, label, items) => { try { form.dropdown(label, items, { defaultValueIndex: 0 }); } catch (e) { form.dropdown(label, items, 0); } };
const WINDOW_NAMES = WINDOW_CHOICES.map((h) => "Every " + h + (h === 1 ? " hour" : " hours"));
/** the two fields of a limit form: [0] = how often (dropdown), [1] = how many units per time (text) */
function limitFields(form, nowH, nowC) {
  dropdownDef(form, "§fHow often can a player buy again?\n§7Now: §f" + (nowH > 0 ? "every " + hoursTxt(nowH) : "no limit") + "\n§7The time starts at the player's first purchase", ["Keep as it is", ...WINDOW_NAMES]);
  textField(form, "§fHow many can each player buy in that time?\n§7Now: §f" + (nowH > 0 ? num(nowC) : "-") + "\n§7Whole number, 1 = once, 1000 = a thousand times (max " + MAX_COUNT + ")\n§7Leave empty to keep it", nowH > 0 ? String(nowC) : "1");
}
/** reads limitFields: { h, c } or { none: true } (nothing to change) or { err } */
function limitChoice(v, nowH, nowC) {
  const idx = Number(v[0] ?? 0), raw = String(v[1] ?? "").trim();
  const h = idx > 0 && idx <= WINDOW_CHOICES.length ? WINDOW_CHOICES[idx - 1] : nowH;
  if (h <= 0) return raw === "" && idx === 0 ? { none: true } : { err: "Pick how often (1 / 6 / 12 / 24 / 48 hours) first." };
  const c = raw === "" ? nowC : numOf(raw);
  return { h, c };
}
function timeForm(player, key, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const name = keyName(key), canRm = canRemoveLimit(key), nowH = hoursOf(key), nowC = countOf(key);
  const form = new ShopForm().title(name + " limit");
  limitFields(form, nowH, nowC);
  if (canRm) toggleDef(form, "§cRemove the limit (no limit)");
  toggleDef(form, "§cReset to the normal limit");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const rm = canRm && v[2] === true, reset = v[canRm ? 3 : 2] === true;
    let err = null;
    if (reset) err = resetOne("limit", key);
    else if (rm) err = setLimit(key, null);
    else { const ch = limitChoice(v, nowH, nowC); if (ch.none) return back(); err = ch.err ?? setLimit(key, ch.h, ch.c); }
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : hasLimit(key) ? "§a[Shop] " + name + ": limit " + limitText(key) + " per player." : "§a[Shop] " + name + ": no limit."));
    back();
  });
}
/** a limit for a whole category: applies to every entry that has no limit of its own */
function catLimitForm(player, ci, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const cat = ALL[ci], now = CAT_LIM[cat.id], nowH = now?.h ?? 0, nowC = now?.c ?? 1;
  const form = new ShopForm().title(catN(player, cat.name) + " limit");
  limitFields(form, nowH, nowC);
  toggleDef(form, "§cRemove the category limit");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    let err = null;
    if (v[2] === true) err = setCategoryLimit(cat.id, null);
    else { const ch = limitChoice(v, nowH, nowC); if (ch.none) return back(); err = ch.err ?? setCategoryLimit(cat.id, ch.h, ch.c); }
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : CAT_LIM[cat.id] ? "§a[Shop] " + catN(player, cat.name) + ": every item can be bought " + CAT_LIM[cat.id].c + " per " + CAT_LIM[cat.id].h + "h per player (unless it has its own limit)." : "§a[Shop] " + cat.name + ": category limit removed."));
    back();
  });
}
function bookPriceForm(player, e, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const form = new ShopForm().title(e.name + " price");
  textField(form, "§fPrice of level I\n§7Now: §a" + money(e.base) + " §7| normal: §f" + money(baseBook(e.id)) + "\n§7Level II costs double, III four times ... (max " + ROMAN[e.max] + ")\n§7Whole number, 1 to " + MAX_MONEY + "\n§7Leave empty to keep it", String(e.base));
  toggleDef(form, "§cReset to the normal price");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    let err = null;
    if (v[1] === true) err = resetOne("book", e.id);
    else { const x = String(v[0] ?? "").trim(); if (x === "") return back(); err = setBookPrice(e.id, numOf(x)); }
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : v[1] === true ? "§a[Shop] " + e.name + " is back to the normal price." : "§a[Shop] " + e.name + ": level I costs " + money(e.base) + "."));
    back();
  });
}
function potionPriceForm(player, eff, form0, v0, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const key = potionKey(eff, form0, v0), name = potionName(eff, form0, v0), pr = potionPrice(eff, form0, v0), b = basePotion(POTIONS.get(key));
  const form = new ShopForm().title(name + " price");
  textField(form, "§fBuy price\n§7Now: §a" + money(pr.buy) + " §7| normal: §f" + money(b.buy) + "\n§7Whole number, 1 to " + MAX_MONEY + "\n§7Leave empty to keep it", String(pr.buy));
  textField(form, "§fSell price\n§7Now: §c" + (pr.sell > 0 ? money(pr.sell) : "can not be sold") + " §7| normal: §f" + money(b.sell) + "\n§7From 0 (can not be sold) up to the buy price\n§7Leave empty to keep it", String(pr.sell));
  toggleDef(form, "§cReset to the normal prices");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    let err = null;
    if (v[2] === true) err = resetOne("potion", key);
    else {
      const x = String(v[0] ?? "").trim(), y = String(v[1] ?? "").trim();
      if (x === "" && y === "") return back();
      err = setPotionPrice(key, x === "" ? pr.buy : numOf(x), y === "" ? pr.sell : numOf(y));
    }
    const now = potionPrice(eff, form0, v0);
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : v[2] === true ? "§a[Shop] " + name + " is back to the normal prices." : "§a[Shop] " + name + ": buy " + money(now.buy) + " / sell " + (now.sell > 0 ? money(now.sell) : "no") + " saved."));
    back();
  });
}
// ---- money shop categories: an admin who opens a category can change the buy / sell price and put or remove the time of its items
function catAdminHub(player, ci, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const cat = ALL[ci], again = () => catAdminHub(player, ci, back), cl = CAT_LIM[cat.id];
  const f = make("Edit " + catN(player, cat.name)); f.self = again;
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + catN(player, cat.name) + "\n§r§7" + cat.items.length + " entries\n§r§8Only admins see this page", cat.icon, null);
  set(f, 2 * COLS + 2, hdr(1) + "§6§lEdit prices\n§r§7Change the price of an item\n§r§7of this category\n§r§eClick to choose an item", "textures/ui/shop/hud_money", { run: () => catItemList(player, ci, "price", again) });
  set(f, 2 * COLS + 6, hdr(1) + "§6§lEdit limits\n§r§7Set how many each player can buy\n§r§7and how often, one item at a time\n§r§eClick to choose an item", "textures/items/clock_item", { run: () => catItemList(player, ci, "time", again) });
  set(f, 4 * COLS + 4, hdr(1) + "§6§lLimit for ALL items\n§r§7One limit for the whole category\n§r§7(items with their own limit keep it)\n§r§7Now: §f" + (cl ? cl.c + " every " + cl.h + "h" : "no category limit") + "\n§r§eClick to change", "textures/items/clock_item", { run: () => catLimitForm(player, ci, again) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const limitLine = (key) => "§r§7Limit: §f" + limitText(key) + (limitSource(key) === "category" ? " §8(category)" : "");
function catItemList(player, ci, mode, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const cat = ALL[ci], again = () => catItemList(player, ci, mode, back);
  const entries = cat.items.map((it) => {
    const id = it[0];
    if (cat.type === "book") {
      const e = ENCHANTS.find((x) => x.id === id), key = bookKey(id);
      return mode === "price"
        ? { icon: NAV.book, run: () => bookPriceForm(player, e, again), text: hdr(1) + "§d" + e.name + "\n§r§7Level I: §a" + money(e.base) + (e.base !== baseBook(id) ? "\n§r§6Changed - normal: §a" + money(baseBook(id)) : "\n§r§8Normal price") + "\n§r§eClick to change" }
        : { icon: NAV.book, run: () => timeForm(player, key, again), text: hdr(1) + "§d" + e.name + "\n" + limitLine(key) + "\n§r§eClick to change the limit" };
    }
    if (cat.type === "potion") {
      const eff = EFFECTS.find((x) => x.id === id);
      return { icon: it[2], run: () => potionVariantList(player, eff, mode, again),
        text: hdr(1) + "§d" + eff.name + "\n§r§7" + eff.variants.length * FORMS.length + " potions\n§r§eClick to choose the potion" };
    }
    const b = baseItemPrice(it);
    return mode === "price"
      ? { icon: it[2], run: () => priceItemForm(player, it, again),
          text: hdr(1) + "§f" + it[1] + "\n§r§7Buy: §a" + money(it[3]) + " §7| Sell: §c" + (it[4] > 0 ? money(it[4]) : "no") + (it[3] !== b.b || it[4] !== b.s ? "\n§r§6Changed - normal: §a" + money(b.b) + " §7/ §c" + money(b.s) : "\n§r§8Normal price") + "\n§r§eClick to change" }
      : { icon: it[2], run: () => timeForm(player, id, again), text: hdr(1) + "§f" + it[1] + "\n" + limitLine(id) + "\n§r§eClick to change the limit" };
  });
  if (mode === "time") entries.unshift({ icon: "textures/items/clock_item", run: () => catLimitForm(player, ci, again),
    text: hdr(1) + "§6§lALL items of " + catN(player, cat.name) + "\n§r§7Now: §f" + (CAT_LIM[cat.id] ? CAT_LIM[cat.id].c + " every " + CAT_LIM[cat.id].h + "h" : "no category limit") + "\n§r§eClick to set one limit for all" });
  listPage(player, mode === "price" ? "Edit prices - " + catN(player, cat.name) : "Edit limits - " + catN(player, cat.name), entries, back);
}
/** every potion (3 types x levels) of one effect */
function potionVariantList(player, eff, mode, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const again = () => potionVariantList(player, eff, mode, back), entries = [];
  for (const form of FORMS) for (const v of eff.variants) {
    const key = potionKey(eff, form, v), pr = potionPrice(eff, form, v), b = basePotion(POTIONS.get(key)), nm = potionName(eff, form, v);
    entries.push(mode === "price"
      ? { icon: potionIcon(eff, form), run: () => potionPriceForm(player, eff, form, v, again),
          text: hdr(1) + form.color + nm + "\n§r§7Buy: §a" + money(pr.buy) + " §7| Sell: §c" + (pr.sell > 0 ? money(pr.sell) : "no") + (pr.buy !== b.buy || pr.sell !== b.sell ? "\n§r§6Changed" : "\n§r§8Normal price") + "\n§r§eClick to change" }
      : { icon: potionIcon(eff, form), run: () => timeForm(player, key, again), text: hdr(1) + form.color + nm + "\n" + limitLine(key) + "\n§r§eClick to change the limit" });
  }
  listPage(player, (mode === "price" ? "Edit prices - " : "Edit limits - ") + eff.name, entries, back);
}
function priceItemForm(player, it, back) {
  if (!canShop(player)) return back();
  adminLoad();
  const b = baseItemPrice(it), id = it[0], name = it[1];
  const form = new ShopForm().title(name + " price");
  textField(form, "§fBuy price\n§7Now: §a" + money(it[3]) + " §7| normal: §f" + money(b.b) + "\n§7Whole number, 1 to " + MAX_MONEY + "\n§7Leave empty to keep it", String(it[3]));
  textField(form, "§fSell price\n§7Now: §c" + (it[4] > 0 ? money(it[4]) : "can not be sold") + " §7| normal: §f" + money(b.s) + "\n§7From 0 (can not be sold) up to the buy price\n§7Leave empty to keep it", String(it[4]));
  toggleDef(form, "§cReset to the normal prices");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    let err = null;
    if (v[2] === true) err = resetOne("itemprice", id);
    else {
      const x = String(v[0] ?? "").trim(), y = String(v[1] ?? "").trim();
      if (x === "" && y === "") return back();
      err = setItemPrice(id, x === "" ? it[3] : numOf(x), y === "" ? it[4] : numOf(y));
    }
    player.sendMessage(shopMsg(player, err ? "§c[Shop] " + err : v[2] === true ? "§a[Shop] " + name + " is back to the normal prices." : "§a[Shop] " + name + ": buy " + money(it[3]) + " / sell " + (it[4] > 0 ? money(it[4]) : "no") + " saved."));
    back();
  });
}

// ================================================================ trade levels
function bar(into, need) { const n = Math.round((into / need) * 20); return "[" + "=".repeat(n) + ".".repeat(20 - n) + "]"; }
function levelsPage(player) {
  const s = stats(player), f = make("Trade Levels"); f.self = () => levelsPage(player);
  [["b", "Buyer", s.bxp, 3, "§a"], ["s", "Seller", s.sxp, 5, "§c"]].forEach(([tr, name, xp, col, c]) => {
    const p = progress(xp);
    let t = hdr(Math.min(p.level, 99)) + c + "§l" + name + " Level " + p.level + "\n§r§7Total XP: §f" + num(xp);
    if (p.max) t += "\n§r§6MAX LEVEL reached!";
    else {
      t += `\n§r§7Progress: §f${num(p.into)}§7/§f${num(p.need)}\n§r§7${bar(p.into, p.need)}\n§r§7XP left: §f${num(p.need - p.into)}\n§r§7Next level reward: ${rewardText(reward(tr, p.level + 1))}`;
      const nextGift = (() => { for (let L = p.level + 1; L <= MAX_LEVEL; L++) if (L % 10 === 0) return L; return null; })();
      if (nextGift) t += `\n§r§7Next gift at level §f${nextGift}§7: ${rewardText(reward(tr, nextGift))}`;
    }
    set(f, 2 * COLS + col - 1, t, NAV.xp, null);
    // next 9 level rewards
    for (let k = 1; k <= 9 && p.level + k <= MAX_LEVEL; k++) {
      const L = p.level + k, r = reward(tr, L);
      set(f, (tr === "b" ? 4 : 6) * COLS + k - 1, hdr(1) + c + name + " Lv " + L + "\n§r§7Reward: " + rewardText(r), r.gift ? "textures/items/diamond" : "textures/items/gold_nugget", null);
    }
  });
  set(f, 3 * COLS + 4, hdr(1) + "§eHow it works\n§r§7Every item you buy or sell gives XP.\n§r§7Cheap items = 1 XP, +1 per $1,000 of price.\n§r§7Level 1 needs 100 XP, then +10 more each level.\n§r§7Max level: 999", "textures/ui/shop/ic_help", null);
  backBtn(f, () => mainMenu(player)); status(player, f);
  open(player, f);
}

// ================================================================ transactions
function historyPage(player) {
  const s = stats(player), f = make("Transactions"); f.self = () => historyPage(player);
  s.tx.slice(0, PER_PAGE).forEach((t, i) => {
    const it = BY_TYPE.get(t.id), icon = t.icon ? t.icon : t.id === "enchanted_book" ? NAV.book : t.id === "smp:heart" ? "textures/ui/shop/ic_heart" : t.id === "mob_spawner" ? NAV.spawner : t.id.endsWith("_spawn_egg") ? "textures/ui/shop/egg_" + t.id.replace("_spawn_egg", "") : it ? it[2] : "textures/items/" + t.id;
    const amt = t.cur === "shards" ? "§d" + num(t.total) + " shards" : money(t.total);
    set(f, i, hdr(Math.min(t.qty, 99)) + (t.type === "buy" ? "§cBought" : "§aSold") + " §f" + t.name + "\n§r§7Amount: §f" + num(t.qty) + "\n§r§7" + (t.type === "buy" ? "Paid: §c" : "Received: §a") + amt + "\n§r§8" + ago(t.t), icon, null);
  });
  const net = s.earned - s.spent;
  set(f, NAV_START + 4, hdr(1) + "§6Summary (money)\n§r§7Spent: §c" + money(s.spent) + "\n§r§7Earned: §a" + money(s.earned) + "\n§r" + (net >= 0 ? "§aProfit: +" + money(net) : "§cLoss: -" + money(-net)), NAV.bal, null);
  backBtn(f, () => mainMenu(player));
  open(player, f);
}

// ================================================================ Heart Shop (hearts.js): permanent extra hearts, bought with money
const HEART_ICON = "textures/ui/shop/ic_heart";
const heartStatusTxt = () => { const s = heartsStatus(); return s === "on" ? "§aOpen" : s === "paused" ? "§ePaused" + (pauseLeftMs() > 0 ? " §7(back in " + countdown(pauseLeftMs()) + ")" : "") : "§cClosed"; };
function heartsPage(player, back) {
  const f = make("Hearts"); f.self = () => heartsPage(player, back);
  const c = heartsCfg(), r = heartsOf(player), price = nextPrice(player), block = buyBlock(player), held = heldUnits(player), apples = countItem(player, "minecraft:enchanted_golden_apple");
  set(f, 1 * COLS + 4, hdr(1, "r") + "§c§lExtra Heart\n§r§7A permanent heart above your normal ones.\n§r§7It stays after death - forever.\n§r§7Status: " + heartStatusTxt() + "\n§r§7Your hearts: §f" + heartsTxt(r.n) + "§7/§f" + c.max + (held > 0 ? " §7(+§e" + heartsTxt(held) + " §7in your inventory)" : ""), HEART_ICON, null);
  if (block) set(f, 3 * COLS + 4, hdr(1) + "§c§lLOCKED\n§r§7" + block, NAV.no, null);
  else set(f, 3 * COLS + 4, hdr(1, "g") + "§a§lBuy 1 Heart\n§r§7Price: §a" + money(price) + "\n§r§7Next one: §a" + money(Math.min(100000000, price + c.step)) + "\n§r§eClick to buy", HEART_ICON, {
    run: () => confirmPage(player, "Confirm purchase", ["§f1x Heart (permanent)", "§7Cost: §a" + money(price), "", "§7You get a Heart item in your inventory.", "§7Right-click it to use it - the heart", "§7appears right away.", "", "§cHearts are bought with money only", "§cand no discount applies."], () => { buyHeart(player); heartsPage(player, back); }, () => heartsPage(player, back)),
  });
  if (r.n % 2 === 1) set(f, 3 * COLS + 6, hdr(1) + "§6§lRestore the missing half\n§r§7You have half a heart (" + heartsTxt(r.n) + ").\n§r§7Cost: §f1 Enchanted Golden Apple §7(you have §f" + apples + "§7)\n§r§7Buy it in the shop: Food\n§r§eClick to restore", NAV.chest, { run: () => { restoreHalf(player); heartsPage(player, back); } });
  set(f, 5 * COLS + 4, hdr(1) + "§e§lRules\n§r§7- Permanent: death never removes it\n§r§7- Max §f" + c.max + "§7 extra hearts per player\n§r§7- Each next heart costs more\n§r§7- If you die the Heart item drops:\n§r§7  whoever picks it up can use it\n§r§7- On the ground it spoils after 1 min\n§r§7  (picked up = Half Heart) and\n§r§7  explodes after 3 min\n§r§7- Repair a Half Heart: 1 Ench. Golden Apple\n§r§7- Can't be used in combat or a duel" + (c.cd > 0 ? "\n§r§7- Wait §f" + c.cd + "h §7between purchases" : "") + (c.npOn ? "\n§r§7- New players: wait §f" + c.np + "h §7after joining" : ""), "textures/ui/shop/ic_help", null);
  if (canShop(player)) {
    set(f, 7 * COLS + 1, hdr(1) + "§6§lEdit price\n§r§7First heart: §a" + money(c.price) + "\n§r§7Each next: §a+" + money(c.step) + "\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => heartPriceForm(player, () => heartsPage(player, back)) });
    set(f, 7 * COLS + 3, hdr(1) + "§6§lSale status\n§r§7Now: " + heartStatusTxt() + "\n§r§7Open / pause (temporary) / close\n§r§eAdmins only - click to change", "textures/items/clock_item", { run: () => heartStatusForm(player, () => heartsPage(player, back)) });
    set(f, 7 * COLS + 5, hdr(1) + "§6§lRules\n§r§7Max hearts: §f" + c.max + "\n§r§7Cooldown: §f" + (c.cd > 0 ? c.cd + "h" : "none") + "\n§r§7Opening countdown: " + (c.cdFx ? "§aOn" : "§cOff") + "\n§r§eAdmins only - click to change", NAV.page, { run: () => heartRulesForm(player, () => heartsPage(player, back)) });
    set(f, 7 * COLS + 7, hdr(1) + "§6§lMembers' hearts\n§r§7See who owns hearts and\n§r§7remove them if needed\n§r§eAdmins only - click to open", HEART_ICON, { run: () => heartOwnersPage(player, () => heartsPage(player, back)) });
    set(f, 5 * COLS + 7, hdr(1) + "§a§lNew player protection\n§r§7Status: " + (c.npOn ? "§aOn §7(" + c.np + "h after joining)" : "§cOff") + "\n§r§7New players can't buy hearts\n§r§7until the time has passed\n§r§eAdmins only - click to change", NAV.page, { run: () => heartProtectionForm(player, () => heartsPage(player, back)) });
    set(f, 1 * COLS + 7, hdr(1) + "§b§lLogs\n§r§7Heart records: purchases,\n§r§7who bought, picked up, used,\n§r§7destroyed or repaired a Heart\n§r§eAdmins only - click to open", NAV.book, { run: () => heartLogsPage(player, () => heartsPage(player, back)) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
// Heart Logs (admins only): the life of a Heart in the order it happens - bought -> picked up -> used -> destroyed / repaired.
//   Row 1: summary | Row 3: Buyers, Purchases, Pickups | Row 5: Uses, Destroyed / Repaired | Row 7: "Heart in my hand"
const HEART_LOG_CATS = [
  { id: "buyers", name: "Heart Buyers", color: "§c", icon: "textures/ui/shop/ic_heart", info: "Every player who bought a Heart", slot: 3 * COLS + 2 },
  { id: "buy", name: "Purchases", color: "§a", icon: "textures/ui/shop/hud_money", info: "Every purchase: who, price, time", slot: 3 * COLS + 4 },
  { id: "pickup", name: "Heart Pickups", color: "§d", icon: "textures/ui/shop/ic_heart", info: "Who picked a Heart up: ground / chest", slot: 3 * COLS + 6 },
  { id: "use", name: "Heart Uses", color: "§5", icon: "textures/ui/shop/ic_heart", info: "Who used a Heart + who bought it (owner)", slot: 5 * COLS + 3 },
  { id: "loss", name: "Destroyed / Repaired", color: "§4", icon: "textures/ui/shop/ic_heart", info: "Heart destroyed / full -> half / repaired", slot: 5 * COLS + 5 },
];
function heartLogsPage(player, back) {
  if (!canShop(player)) return back();
  const f = make("Heart Logs"); f.self = () => heartLogsPage(player, back);
  const t = logTotals(), pk = pickupTotals(), ls = lossTotals(), us = useTotals();
  set(f, 1 * COLS + 4, hdr(1, "r") + "§b§lHeart Logs\n§r§7Bought: §f" + t.hearts + " §7by §f" + t.buyers + " §7players §8(" + money(t.spent) + ")\n§r§7Picked up: §f" + pk.hearts + " §7| Used: §f" + us.hearts + "\n§r§7Destroyed: §c" + ls.destroyed + " §7| Full -> half: §6" + ls.halved + " §7| Repaired: §a" + ls.repaired, "textures/ui/shop/ic_heart", null);
  HEART_LOG_CATS.forEach((c) => {
    const n = c.id === "buyers" ? t.buyers : c.id === "buy" ? t.hearts : c.id === "pickup" ? pk.hearts : c.id === "use" ? us.hearts : ls.destroyed + ls.halved + ls.repaired;
    set(f, c.slot, hdr(1) + c.color + "§l" + c.name + "\n§r§7" + c.info + "\n§r§7Records: §f" + n + "\n§r§eClick to open", c.icon, { run: () => heartLogCatPage(player, c, () => heartLogsPage(player, back)) });
  });
  set(f, 7 * COLS + 4, hdr(1) + "§d§lHeart in my hand\n§r§7Hold a Heart, then click:\n§r§7shows who bought it (hidden tag,\n§r§7only admins can read it)\n§r§eClick to check", NAV.book, { run: () => { inspectHeld(player); heartLogsPage(player, back); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
setHeartLogsHook((p, back) => heartLogsPage(p, back));        // /opr > Logs > Heart Logs
function heartLogCatPage(player, cat, back) {
  if (!canShop(player)) return back();
  const again = () => heartLogCatPage(player, cat, back);
  if (cat.id === "buyers") return heartBuyersPage(player, back);
  if (cat.id === "pickup") return heartPickupsPage(player, back);
  if (cat.id === "loss") return heartLossPage(player, back);
  if (cat.id === "use") return heartUsesPage(player, back);
  if (cat.id === "buy") {
    const all = allPurchases(), shown = all.slice(0, 500);
    const entries = shown.map((x) => ({ icon: HEART_ICON, run: () => heartBuyerPage(player, x.id, again),
      text: hdr(1) + "§f" + x.name + "\n§r§7Bought Heart §f#" + x.n + "\n§r§7Price: §a" + money(x.price) + "\n§r§7Date: §f" + logStamp(x.t) + " §8(" + ago(x.t) + ")\n§r§eClick to open the buyer" }));
    if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No purchases yet" });
    return listPage(player, "Heart Logs: " + cat.name, entries, back, 0, all.length > shown.length ? (f) => set(f, NAV_START + 7, hdr(1) + "§7Showing the latest §f" + shown.length + "§7 of §f" + all.length + "\n§r§7Open a buyer to see all of his purchases", NAV.page, null) : null);
  }
  listPage(player, "Heart Logs: " + cat.name, [{ icon: NAV.no, run: again, text: hdr(1) + "§7No records yet" }], back);
}
/** category "Heart Buyers": one entry per player who bought a Heart (latest buyer first) */
function heartBuyersPage(player, back) {
  const again = () => heartBuyersPage(player, back);
  const entries = buyersList().map((b) => ({ icon: HEART_ICON, run: () => heartBuyerPage(player, b.id, again),
    text: hdr(Math.min(Math.max(b.count, 1), 99)) + "§f" + b.name + "\n§r§7Hearts bought: §c" + b.count + "\n§r§7Money spent: §a" + money(b.spent) + "\n§r§7Last purchase: §f" + logStamp(b.last) + " §8(" + ago(b.last) + ")" + (b.bf ? "\n§r§8(old purchases: from his shop history)" : "") + "\n§r§eClick to open" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7Nobody bought a Heart yet" });
  listPage(player, "Heart Buyers", entries, back);
}
/** one buyer: every purchase (newest first) + his totals */
function heartBuyerPage(player, id, back) {
  if (!canShop(player)) return back();
  const info = buyerInfo(id), again = () => heartBuyerPage(player, id, back);
  if (!info) { player.sendMessage(shopMsg(player, "§c[Hearts] No purchase records for this player.")); return back(); }
  const entries = info.list.map((x) => ({ icon: HEART_ICON, run: again,
    text: hdr(1) + "§c§lHeart #" + x.n + "\n§r§7Price: §a" + money(x.price) + "\n§r§7Date: §f" + logStamp(x.t) + "\n§r§8(" + ago(x.t) + ")" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No purchases" });
  const r = heartsRec(id, info.name);
  listPage(player, info.name + ": Heart purchases", entries, back, 0, (f) => {
    set(f, NAV_START + 7, hdr(1) + "§f" + info.name + "\n§r§7Hearts bought: §c" + info.count + "\n§r§7Money spent: §a" + money(info.spent) + "\n§r§7Active hearts now: §c" + heartsTxt(r.n) + (info.bf ? "\n§r§8Older purchases come from his shop history" : "") + (info.count > info.list.length ? "\n§r§8List shows the latest " + info.list.length : ""), HEART_ICON, null);
    set(f, NAV_START + 6, hdr(1) + "§6§lManage his hearts\n§r§7Remove hearts (works offline)\n§r§eClick to open", NAV.page, { run: () => heartPlayerPage(player, id, info.name, again) });
  });
}
/** category "Heart Pickups": every time somebody picked a Heart up (ground / chest / other), newest first */
const pickBuyer = (x) => buyerInfo(x.buyerId)?.name ?? (x.buyerName || "no buyer tag");
function heartPickupsPage(player, back) {
  if (!canShop(player)) return back();
  const again = () => heartPickupsPage(player, back);
  const all = allPickups(), shown = all.slice(0, 500);
  const entries = shown.map((x) => ({ icon: HEART_ICON, run: () => heartPickerPage(player, x.id, again),
    text: hdr(Math.min(Math.max(x.amount, 1), 99)) + "§f" + x.name + "\n§r§7Picked up: §c" + PICK_TYPES[x.type] + (x.amount > 1 ? " x" + x.amount : "") + "\n§r§7Bought by: §f" + pickBuyer(x) + (x.buyerId === x.id ? " §8(own)" : "") + "\n§r§7From: §e" + sourceText(x) + " §8" + placeText(x) + "\n§r§7Date: §f" + logStamp(x.t) + " §8(" + ago(x.t) + ")\n§r§eClick to open the player" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7Nobody picked up a Heart yet" });
  listPage(player, "Heart Logs: Heart Pickups", entries, back, 0, all.length > shown.length ? (f) => set(f, NAV_START + 7, hdr(1) + "§7Showing the latest §f" + shown.length + "§7 of §f" + all.length + "\n§r§7Open a player to see all of his pickups", NAV.page, null) : null);
}
/** one player: every Heart he picked up (newest first) + his total */
function heartPickerPage(player, id, back) {
  if (!canShop(player)) return back();
  const info = pickerInfo(id), again = () => heartPickerPage(player, id, back);
  if (!info) { player.sendMessage(shopMsg(player, "§c[Hearts] No pickup records for this player.")); return back(); }
  const entries = info.list.map((x) => ({ icon: HEART_ICON, run: again,
    text: hdr(Math.min(Math.max(x.amount, 1), 99)) + "§c§l" + PICK_TYPES[x.type] + (x.amount > 1 ? " x" + x.amount : "") + "\n§r§7Bought by: §f" + pickBuyer({ ...x, id }) + (x.buyerId === id ? " §8(own)" : "") + "\n§r§7From: §e" + sourceText(x) + "\n§r§7Place: §f" + placeText(x) + "\n§r§7Date: §f" + logStamp(x.t) + "\n§r§8(" + ago(x.t) + ")" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No pickups" });
  const r = heartsRec(id, info.name);
  listPage(player, info.name + ": Heart pickups", entries, back, 0, (f) => {
    set(f, NAV_START + 7, hdr(1) + "§f" + info.name + "\n§r§7Hearts picked up: §c" + info.count + "\n§r§7Active hearts now: §c" + heartsTxt(r.n) + (info.count > info.list.length ? "\n§r§8List shows the latest " + info.list.length : ""), HEART_ICON, null);
    set(f, NAV_START + 6, hdr(1) + "§6§lManage his hearts\n§r§7Remove hearts (works offline)\n§r§eClick to open", NAV.page, { run: () => heartPlayerPage(player, id, info.name, again) });
  });
}
/** category "Heart Uses": every time somebody USED a Heart (right-click) + the player who BOUGHT that Heart (the owner), newest first */
const useBuyer = (x) => (x.buyerId && x.buyerId !== "-" ? buyerInfo(x.buyerId)?.name ?? (x.buyerName || "?") : "no buyer tag");
const useOwn = (x, uid) => (x.buyerId && x.buyerId !== "-" && x.buyerId === uid ? " §8(used his own Heart)" : x.buyerId && x.buyerId !== "-" ? " §8(someone else's Heart)" : "");
function heartUsesPage(player, back) {
  if (!canShop(player)) return back();
  const again = () => heartUsesPage(player, back);
  const all = allUses(), shown = all.slice(0, 500);
  const entries = shown.map((x) => ({ icon: HEART_ICON, run: () => heartUserPage(player, x.id, again),
    text: hdr(1) + "§f" + x.name + "\n§r§7Used: §c" + USE_TYPES[x.type] + " §7(+§f" + heartsTxt(x.units) + "§7 heart)\n§r§7Owner (bought by): §f" + useBuyer(x) + useOwn(x, x.id) + "\n§r§7His hearts after: §c" + heartsTxt(x.after) + "\n§r§7Place: §f" + usePlaceText(x) + "\n§r§7Date: §f" + logStamp(x.t) + " §8(" + ago(x.t) + ")\n§r§eClick to open the player" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7Nobody used a Heart yet" });
  listPage(player, "Heart Logs: Heart Uses", entries, back, 0, all.length > shown.length ? (f) => set(f, NAV_START + 7, hdr(1) + "§7Showing the latest §f" + shown.length + "§7 of §f" + all.length + "\n§r§7Open a player to see all of his uses", NAV.page, null) : null);
}
/** one player: every Heart he used (newest first) + his totals */
function heartUserPage(player, id, back) {
  if (!canShop(player)) return back();
  const info = userInfo(id), again = () => heartUserPage(player, id, back);
  if (!info) { player.sendMessage(shopMsg(player, "§c[Hearts] No use records for this player.")); return back(); }
  const entries = info.list.map((x) => ({ icon: HEART_ICON, run: again,
    text: hdr(1) + "§c§l" + USE_TYPES[x.type] + " §r§7(+§f" + heartsTxt(x.units) + "§7 heart)\n§r§7Owner (bought by): §f" + useBuyer(x) + useOwn(x, id) + "\n§r§7His hearts after: §c" + heartsTxt(x.after) + "\n§r§7Place: §f" + usePlaceText(x) + "\n§r§7Date: §f" + logStamp(x.t) + "\n§r§8(" + ago(x.t) + ")" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No uses" });
  const r = heartsRec(id, info.name), own = info.list.filter((x) => x.buyerId === id).length;
  listPage(player, info.name + ": Heart uses", entries, back, 0, (f) => {
    set(f, NAV_START + 7, hdr(1) + "§f" + info.name + "\n§r§7Hearts used: §c" + info.count + " §7(+§f" + heartsTxt(info.units) + "§7 heart)\n§r§7Own Hearts: §f" + own + " §7| Others': §f" + (info.list.length - own) + "\n§r§7Active hearts now: §c" + heartsTxt(r.n) + (info.count > info.list.length ? "\n§r§8List shows the latest " + info.list.length : ""), HEART_ICON, null);
    set(f, NAV_START + 6, hdr(1) + "§6§lManage his hearts\n§r§7Remove hearts (works offline)\n§r§eClick to open", NAV.page, { run: () => heartPlayerPage(player, id, info.name, again) });
  });
}
/** category "Hearts Destroyed": a Heart that a player BOUGHT was destroyed, or his bought full Heart became a Half Heart (newest first) */
const lossName = (x) => buyerInfo(x.id)?.name ?? x.name;
function lossLines(x, buyerId) {                              // the details of one record (buyerId: to mark when the holder is the buyer himself)
  const halved = x.kind === KIND_HALVED, fixed = x.kind === KIND_REPAIRED, n = x.amount > 1 ? " x" + x.amount : "";
  const out = [fixed ? "§a§lRepaired: Half Heart -> Heart§r§7" + n : halved ? "§6§lFull Heart -> Half Heart§r§7" + n : "§c§lDestroyed: §f" + LOSS_TYPES[x.type] + n];
  out.push("§7Cause: §e" + causeText(x));
  if (x.cause === "admin") out.push("§7Taken from: §f" + (x.holderName || "?") + (x.note ? " §7by admin §f" + x.note : ""));
  else if (fixed) out.push("§7Repaired by: §f" + (x.holderName || "?") + (x.holderId && x.holderId === buyerId ? " §8(the buyer)" : " §8(not the buyer)"));
  else if (halved) out.push("§7In the inventory of: §f" + (x.holderName || "?") + (x.holderId && x.holderId === buyerId ? " §8(the buyer)" : ""));
  out.push("§7Place: §f" + lossPlaceText(x));
  if (!halved && !fixed && x.cause !== "admin" && x.age > 0) out.push("§7Seen on the ground for: §f" + secText(x.age));
  out.push("§7Date: §f" + logStamp(x.t) + " §8(" + ago(x.t) + ")");
  return out;
}
function heartLossPage(player, back) {
  if (!canShop(player)) return back();
  const again = () => heartLossPage(player, back);
  const all = allLosses(), shown = all.slice(0, 500);
  const entries = shown.map((x) => ({ icon: HEART_ICON, run: () => heartLossBuyerPage(player, x.id, again),
    text: hdr(Math.min(Math.max(x.amount, 1), 99)) + "§f" + lossName(x) + "\n§r" + lossLines(x, x.id).join("\n§r") + "\n§r§eClick to open the buyer" }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No bought Heart was destroyed or repaired yet" });
  listPage(player, "Heart Logs: Destroyed / Repaired", entries, back, 0, all.length > shown.length ? (f) => set(f, NAV_START + 7, hdr(1) + "§7Showing the latest §f" + shown.length + "§7 of §f" + all.length + "\n§r§7Open a buyer to see all of his records", NAV.page, null) : null);
}
/** one buyer: every time a Heart he bought was destroyed / became a Half Heart (newest first) + his totals */
function heartLossBuyerPage(player, id, back) {
  if (!canShop(player)) return back();
  const info = lossInfo(id), again = () => heartLossBuyerPage(player, id, back);
  if (!info) { player.sendMessage(shopMsg(player, "§c[Hearts] No destroyed-Heart records for this player.")); return back(); }
  const nm = buyerInfo(id)?.name ?? info.name;
  const entries = info.list.map((x) => ({ icon: HEART_ICON, run: again,
    text: hdr(Math.min(Math.max(x.amount, 1), 99)) + lossLines(x, id).join("\n§r") }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7No records" });
  const r = heartsRec(id, nm);
  listPage(player, nm + ": Destroyed / Repaired", entries, back, 0, (f) => {
    set(f, NAV_START + 7, hdr(1) + "§f" + nm + "\n§r§7Hearts destroyed: §c" + info.destroyed + "\n§r§7Full -> half: §6" + info.halved + "\n§r§7Repaired: §a" + info.repaired + "\n§r§7Active hearts now: §c" + heartsTxt(r.n) + (info.destroyed + info.halved + info.repaired > info.list.length ? "\n§r§8List shows the latest " + info.list.length : ""), HEART_ICON, null);
    set(f, NAV_START + 6, hdr(1) + "§6§lManage his hearts\n§r§7Remove hearts (works offline)\n§r§eClick to open", NAV.page, { run: () => heartPlayerPage(player, id, nm, again) });
  });
}
/** the Heart in the admin's hand: who bought it (hidden tag on the item) */
function inspectHeld(player) {
  try {
    const st = container(player).getItem(player.selectedSlotIndex);
    if (!st || !isHeart(st.typeId)) return player.sendMessage(shopMsg(player, "§c[Hearts] Hold a Heart (or Half Heart) in your hand first."));
    const tag = buyerOf(st);
    if (!tag) return player.sendMessage(shopMsg(player, "§e[Hearts] This item has no buyer tag (made before tags existed, or given by an admin)."));
    const info = buyerInfo(tag.id), nm = info?.name ?? tag.name, now = tag.name !== nm ? " §7(was §f" + tag.name + "§7 when he bought it)" : "";
    player.sendMessage(shopMsg(player, "§b[Hearts] Bought by §f" + nm + now + "§7 | id §f" + tag.id + (info ? "§7 | hearts bought: §f" + info.count + "§7, last: §f" + logStamp(info.list[0]?.t ?? 0) : "§7 | no purchase record") + (st.amount > 1 ? "§7 | stack x" + st.amount : "")));
  } catch (e) { player.sendMessage(shopMsg(player, "§c[Hearts] Could not read the item.")); }
}
// admins who HOLD a Heart see its buyer in the action bar (nobody else: the tag is hidden data, not lore)
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      if (!canShop(p)) continue;
      const st = container(p).getItem(p.selectedSlotIndex);
      if (!st || !isHeart(st.typeId)) continue;
      const tag = buyerOf(st);
      sendBar(p, tag ? "§c♥ §7Bought by §f" + (buyerInfo(tag.id)?.name ?? tag.name) : "§c♥ §8No buyer tag");
    } catch (e) { /* ignore */ }
  }
}, 10);
function heartPriceForm(player, back) {
  if (!canShop(player)) return back();
  const c = heartsCfg(), form = new ShopForm().title("Heart price");
  textField(form, "§fFirst heart price\n§7Now: §a" + money(c.price) + "\n§7Whole number, 1 to 100000000", String(c.price));
  textField(form, "§fIncrease for each next heart\n§7Now: §a" + money(c.step) + " §7(0 = the same price every time)", String(c.step));
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const a = String(v[0] ?? "").trim(), b = String(v[1] ?? "").trim();
    const err = setHeartsPrice(a === "" ? c.price : numOf(a), b === "" ? c.step : numOf(b));
    player.sendMessage(shopMsg(player, err ? "§c[Hearts] " + err : "§a[Hearts] Price saved: " + money(heartsCfg().price) + " (+" + money(heartsCfg().step) + " each)."));
    back();
  });
}
function heartStatusForm(player, back) {
  if (!canShop(player)) return back();
  const form = new ShopForm().title("Heart sale");
  dropdown(form, "§fSale status\n§7Closed = cancelled until you open it again.\n§7Paused = temporary. Hearts already bought stay.", ["Open", "Paused (temporary)", "Closed (cancelled)"]);
  textField(form, "§fPause length in hours\n§7Only for 'Paused'. Empty / 0 = until you open it again.", "0");
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const st = ["on", "paused", "off"][Number(v[0]) || 0], raw = String(v[1] ?? "").trim(), hrs = raw === "" ? 0 : numOf(raw);
    if (st === "paused" && Number.isNaN(hrs)) { player.sendMessage(shopMsg(player, "§c[Hearts] The hours must be a whole number.")); return back(); }
    const err = setHeartsStatus(st, st === "paused" ? hrs : 0);
    player.sendMessage(shopMsg(player, err ? "§c[Hearts] " + err : "§a[Hearts] Sale status: " + heartStatusTxt().replace(/§[0-9a-f]/g, "")));
    back();
  });
}
function heartProtectionForm(player, back) {
  if (!canShop(player)) return back();
  const c = heartsCfg(), form = new ShopForm().title("New player protection");
  dropdown(form, "§fProtection\n§7On: players who joined less than the time below ago can't buy hearts.\n§7Off: cancelled (everybody can buy).\n§7Now: " + (c.npOn ? "§aOn" : "§cOff"), c.npOn ? ["On", "Off (cancelled)"] : ["Off (cancelled)", "On"]);       // the first choice is the one that is active now, so saving without a change keeps it
  textField(form, "§fProtection time in hours (after the first join)\n§7Now: §f" + c.np + "§7 (1 to 720, 24 = one day)", String(c.np));
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const raw = String(v[1] ?? "").trim(), on = ((Number(v[0]) || 0) === 0) === c.npOn;
    const err = setHeartsProtection(on, raw === "" ? c.np : numOf(raw));
    player.sendMessage(shopMsg(player, err ? "§c[Hearts] " + err : "§a[Hearts] New player protection: " + (heartsCfg().npOn ? "on, " + heartsCfg().np + " hours." : "off (cancelled).")));
    back();
  });
}
function heartRulesForm(player, back) {
  if (!canShop(player)) return back();
  const c = heartsCfg(), form = new ShopForm().title("Heart rules");
  textField(form, "§fMax extra hearts per player\n§7Now: §f" + c.max + " §7(1 to 100)", String(c.max));
  textField(form, "§fHours between two purchases\n§7Now: §f" + c.cd + " §7(0 = no waiting, max 720)", String(c.cd));
  dropdown(form, "§fOpening countdown (last 10 seconds)\n§7On: a big countdown on the screen when a sale pause or a purchase\n§7cooldown is about to end (like The End event).  Now: " + (c.cdFx ? "§aOn" : "§cOff"), c.cdFx ? ["On", "Off"] : ["Off", "On"]);       // the first choice is the one that is active now
  showModal(player, form, (v) => {
    if (!v || !canShop(player)) return back();
    const a = String(v[0] ?? "").trim(), b = String(v[1] ?? "").trim();
    const err = setHeartsRules(a === "" ? c.max : numOf(a), b === "" ? c.cd : numOf(b));
    if (!err) setHeartsCountdown(((Number(v[2]) || 0) === 0) === c.cdFx);
    player.sendMessage(shopMsg(player, err ? "§c[Hearts] " + err : "§a[Hearts] Rules saved: max " + heartsCfg().max + " hearts, cooldown " + heartsCfg().cd + "h, countdown " + (heartsCfg().cdFx ? "on" : "off") + "."));
    back();
  });
}
function heartOwnersPage(player, back) {
  if (!canShop(player)) return back();
  const again = () => heartOwnersPage(player, back);
  const entries = heartOwners().map((o) => ({
    icon: HEART_ICON, run: () => heartPlayerPage(player, o.id, o.name, again),
    text: hdr(Math.min(Math.max(Math.ceil(o.n / 2), 1), 99)) + "§f" + o.name + "\n§r§7Hearts: §c" + heartsTxt(o.n) + "\n§r§eClick to manage",
  }));
  if (!entries.length) entries.push({ icon: NAV.no, run: again, text: hdr(1) + "§7Nobody owns hearts yet" });
  listPage(player, "Members' hearts", entries, back);
}
function heartPlayerPage(player, id, name, back) {
  if (!canShop(player)) return back();
  const f = make(name + "'s hearts"); f.self = () => heartPlayerPage(player, id, name, back);
  const r = heartsRec(id, name), again = () => heartPlayerPage(player, id, name, back);
  set(f, 1 * COLS + 4, hdr(Math.min(Math.max(Math.ceil(r.n / 2), 1), 99)) + "§f" + name + "\n§r§7Active hearts: §c" + heartsTxt(r.n) + "\n§r§8Works for offline players too", HEART_ICON, null);
  set(f, 4 * COLS + 3, hdr(1) + "§c§lRemove 1 heart\n§r§7Takes one heart away\n§r§eClick to remove", NAV.no, { run: () => { const n = removeHearts(id, 1, player.name); player.sendMessage(shopMsg(player, "§a[Hearts] Removed " + heartsTxt(n) + " heart from " + name + ".")); again(); } });
  set(f, 4 * COLS + 5, hdr(1) + "§4§lRemove ALL hearts\n§r§7Takes every heart of " + name + "\n§r§eClick to remove", NAV.no, {
    run: () => confirmPage(player, "⚠ Remove all hearts", ["§f" + name, "§7Hearts: §c" + heartsTxt(r.n), "", "§cThis cannot be undone."], () => { const n = removeHearts(id, "all", player.name); player.sendMessage(shopMsg(player, "§a[Hearts] Removed " + heartsTxt(n) + " heart(s) from " + name + ".")); again(); }, again) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ commands
const say = (p, msg) => system.run(() => p.sendMessage(shopMsg(p, msg)));
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const Any = CommandPermissionLevel.Any, OK = { status: CustomCommandStatus.Success };
  const reg = (def, fn) => { try { cr.registerCommand({ permissionLevel: Any, cheatsRequired: false, ...def }, fn); } catch (e) { console.warn("[shop] command " + def.name + " not registered: " + e); } };
  const player = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);

  reg({ name: "eco:bal", description: "Show your balance" }, (o) => { const p = player(o); if (p) { const s = stats(p); say(p, `§6[Balance] §aMoney: ${money(s.money)} §7| §dShards: ${num(s.shards)}`); } return OK; });
  reg({ name: "eco:pay", description: "Pay money to another player", mandatoryParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }, { name: "amount", type: CustomCommandParamType.Integer }] }, (o, targets, amount) => {
    const p = player(o); if (!p) return OK;
    system.run(() => {
      { const em = econMsg(p); if (em) return p.sendMessage(shopMsg(p, em)); }
      const t = targets?.[0];
      if (!t) return p.sendMessage(shopMsg(p, "§c[Pay] Player not found."));
      if (t.id === p.id) return p.sendMessage(shopMsg(p, "§c[Pay] You cannot pay yourself."));
      if (amount <= 0) return p.sendMessage(shopMsg(p, "§c[Pay] Amount must be positive."));
      if (!takeMoney(p, amount)) return p.sendMessage(shopMsg(p, `§c[Pay] Not enough money (you have ${money(balance(p))}).`));
      addMoney(t, amount);
      p.sendMessage(shopMsg(p, `§a[Pay] You sent §e${money(amount)} §ato §f${t.name}`)); t.sendMessage(shopMsg(t, `§a[Pay] §f${p.name} §asent you §e${money(amount)}`));
    });
    return OK;
  });
  reg({ name: "eco:baltop", description: "Richest players" }, (o) => {
    const p = player(o); if (!p) return OK;
    const top = allRecords().sort((a, b) => b.money - a.money).slice(0, 10), medal = ["§6", "§7", "§c"];
    say(p, "§6§l=== Richest Players ===\n" + top.map((r, i) => `${medal[i] ?? "§f"}#${i + 1} §f${r.name} §7- §a${money(r.money)}`).join("\n"));
    return OK;
  });
});

// /shop and /sell - registered in their OWN startup handler (same style as /rtp /home /spawn, which work)
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const player = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);
  const reg = (name, description, fn) => {
    try {
      cr.registerCommand({ name, description, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
        const p = player(o);
        if (p) system.run(() => { luxCmd(p, name); try { fn(p); } catch (e) { console.warn("[shop] /" + name + " failed: " + e); } });
        return OK;
      });
    } catch (e) { console.warn("[shop] command " + name + " not registered: " + e); }
  };
  reg("smp:shop", "Open the shop", mainMenu);
  reg("smp:sell", "Open the sell box", sellPage);
});

// Worlds with cheats OFF can't use custom commands in single-player: right-click a Clock instead.
const CLOCK_OPENS_SHOP = true;
setShopOpener(mainMenu);      // the SMP menu can open the shop
world.afterEvents.itemUse.subscribe((ev) => {
  if (!CLOCK_OPENS_SHOP || ev.itemStack?.typeId !== "minecraft:clock") return;
  const sneak = ev.source.isSneaking;         // sneak + Clock = SMP menu, Clock = shop (as before)
  system.run(() => (sneak ? dashboard(ev.source) : mainMenu(ev.source)));
});
