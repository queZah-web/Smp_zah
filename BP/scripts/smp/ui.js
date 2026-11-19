// Chest-style UI helpers for the SMP pages. Same look and same title protocol as the shop (see RP/ui/server_form.json):
// every button text starts with a 3 character header  zone + 2 digit stack count   (zone c = normal, g = green slot, r = red slot).
import { wrapTip } from "./wrap.js";
import { system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { stats } from "../data.js";
import { money, num, short } from "../format.js";
import { progress } from "../xp.js";
import { formBusy } from "../state.js";
import { updateHud } from "../hud.js";
import { luxUi } from "../lux.js";
import { tidyBar } from "./bar.js";
import { getLang } from "./lang.js";
import { oprText, oprButton } from "../systems/oprlang.js";
import { shopText, shopButton } from "../systems/shoplang.js";
import { menuText, menuButton } from "../systems/menulang.js";

const TITLE_PREFIX = "__chest__", SHORT_MARK = (rows) => "__r" + rows + "__";
export const COLS = 9, TOTAL = 81, NAV_START = 72, PER_PAGE = 72;
export const NAV = {
  back: "textures/ui/shop/nav_back", page: "textures/ui/shop/nav_page", ok: "textures/ui/shop/ic_confirm", no: "textures/ui/shop/ic_cancel",
  bal: "textures/items/gold_ingot", player: "textures/ui/shop/hud_player", shield: "textures/ui/shop/ic_shield", chest: "textures/ui/shop/ic_chest",
};
export const SHORT_ROWS = 5;   // height (in rows) of the short chest used by the SMP system pages: rows 0-3 content, row 4 = button bar
export const hdr = (n, z = "c") => z + String(Math.max(0, Math.min(99, n))).padStart(2, "0");

// rows = 9 (default) -> the 9-row chest.  rows = N -> a SHORT chest of N rows (N must be 5, 6, 7 or 9: the "__rN__" marker in the title picks the window in RP/ui/server_form.json).
export function make(title, rows = 9) { return { title, rows, entries: new Array(TOTAL).fill(null), buttons: new Array(TOTAL).fill(null), self: null }; }
export function makeOpr(title, rows = 9) { const f = make(title, rows); f.opr = true; return f; }   // pages of the Operator menu (shown in Arabic for Arabic players)
export function makeShop(title, rows = 9) { const f = make(title, rows); f.shop = true; return f; }   // pages of the /shop menu (Land Protection, Table Passes) - Arabic for Arabic players
export function set(f, slot, text, icon, entry) { f.buttons[slot] = [text, icon]; f.entries[slot] = entry ?? null; }
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

// BLACK GLASS FILLER: a page with  f.glass = true  gets every still-empty slot filled with a Black Stained Glass Pane (same icon the shop uses).
// Header "c00" = no hover tooltip, no highlight, no stack count.  Clicking it does nothing (see open(): the same page simply comes back, no sound, no refresh).
export const GLASS_ICON = "textures/blocks/glass_black";
const GLASS_ENTRY = { glass: true };
function fillGlass(f) {
  if (!f.glass) return;
  const total = f.rows ? f.rows * COLS : TOTAL;
  for (let i = 0; i < total; i++) if (!f.buttons[i]) { f.buttons[i] = ["c00", GLASS_ICON]; f.entries[i] = GLASS_ENTRY; }
}

export function open(player, f, tries = 0) {
  if (tries === 0) { luxUi(player, "open"); addRefresh(f); tidyBar(f); fillGlass(f); }
  const total = f.rows ? f.rows * COLS : TOTAL;
  let shownTitle = f.title, ar = false;
  const T = f.shop ? [shopText, shopButton] : f.opr ? [oprText, oprButton] : [menuText, menuButton];   // /shop pages, /opr pages, and every other /menu page
  { try { ar = getLang(player) === "ar"; if (ar) shownTitle = T[0](player, f.title, 40); } catch (e) { ar = false; shownTitle = f.title; } }
  const form = new ActionFormData().title(TITLE_PREFIX + (f.rows ? SHORT_MARK(f.rows) : "") + shownTitle + "\n" + balanceLine(player));
  for (let i = 0; i < total; i++) { const b = f.buttons[i]; if (b) form.button(wrapTip(ar ? T[1](player, b[0]) : b[0]), b[1]); else form.button("c00"); }
  formBusy.add(player.id);
  form.show(player).then((res) => {
    if (res.canceled) {
      if (res.cancelationReason === FormCancelationReason.UserBusy && tries < 25) { system.runTimeout(() => open(player, f, tries + 1), 8); return; }
      formBusy.delete(player.id); updateHud(player); return;
    }
    formBusy.delete(player.id);
    const e = f.entries[res.selection];
    if (f.quietEmpty && !f.buttons[res.selection]) { open(player, f, 1); return; }   // plain empty slot (page opted in): nothing happens, same page comes straight back
    if (e && e.glass) { open(player, f, 1); return; }          // glass filler: nothing happens, the same page comes straight back (no sound, no refresh)
    if (e && e.run) e.run(); else if (f.self) f.self();      // info slots just refresh the page
  }).catch((err) => {
    formBusy.delete(player.id);
    try { console.warn("[menu] page error: " + err + (err && err.stack ? " " + String(err.stack).split("\n")[1] : "")); player.sendMessage("\u00a7c[Menu] This page hit an error: \u00a7f" + String(err).slice(0, 120)); } catch (e2) { /* ignore */ }
  });
}

export const status = (player, f, slot = f.rows ? (f.rows - 1) * COLS + 1 : NAV_START + 1) => {
  const s = stats(player), b = progress(s.bxp).level, l = progress(s.sxp).level;
  set(f, slot, hdr(1) + "§6Your Balance\n§r§7Money: §a" + money(s.money) + "\n§r§7Shards: §d" + num(s.shards) + "\n§r§7Buyer Lv §f" + b + " §7| Seller Lv §f" + l, NAV.bal, null);
};
export const backBtn = (f, fn) => set(f, f.rows ? (f.rows - 1) * COLS : NAV_START, hdr(1) + "§cBack", NAV.back, { run: fn });
