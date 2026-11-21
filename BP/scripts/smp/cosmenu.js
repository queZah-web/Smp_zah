// /menu -> Cosmetics : everything that only changes how you LOOK or what you SEE, in one place.
//   Titles | Name Colors | Particle Trails | Effects & Sounds (on/off switches, scoreboard style, pop-ups)
//
// HOW TO ADD THINGS LATER (nothing else needs to change, every page lays itself out):
//   * a new section on the hub         -> one line in SECTIONS below
//   * a new on/off switch              -> one line in TOGGLES (cosmetics.js)  [ON = the flag is not set]  or in EXTRA_SWITCHES below
//   * a new name colour / new trail    -> one line in COLORS / TRAILS (cosdata.js): price in money and in shards
//   * a new title                      -> one line in TITLES (achievements.js)
import { system } from "@minecraft/server";
import { stats } from "../data.js";
import { money, num } from "../format.js";
import { buyPrice } from "../priceperks.js";
import { setHud, hudMode } from "../hud.js";
import { ex } from "./store.js";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "./ui.js";
import { COLORS, TRAILS, paint, colorById, trailById } from "./cosdata.js";
import { owns, worn, wear, buy, TOGGLES, toggleOn, flip, puff, colorOf, trailOf } from "./cosmetics.js";
import { TITLES, titleOwned, selectTitle, titleById, titleTag } from "./achievements.js";
import { menuMsg } from "../systems/menulang.js";
import { GROUPS, PART_NAME, isMuted, setMuted } from "./fxprefs.js";
import { isAr, pick } from "../systems/arextra.js";

const ICON = { title: "textures/items/name_tag", color: "textures/ui/shop/i3d_magenta_wool", trail: "textures/ui/shop/x_firework_star", fx: "textures/ui/shop/i3d_noteblock",
  star: "textures/items/nether_star", paper: "textures/items/paper", hud: NAV.player };
const ON = "§aON", OFF = "§cOFF";
const PER_PAGE = 9;            // 3 x 3 on a page (titles, colours and trails are 9 each = one neat square)

// ---------------------------------------------------------------- layout helpers
const CENTER = { 1: [4], 2: [3, 5], 3: [2, 4, 6], 4: [1, 3, 5, 7], 5: [0, 2, 4, 6, 8] };
/** slots for n items, `per` per row (3 = a neat block, 5 = a wide row), each row centred.  rows = the rows to use (default 1, 2, 3) */
export function gridSlots(n, rows = [1, 2, 3], per = 3) {
  const out = [];
  for (let r = 0, left = n; left > 0 && r < rows.length; r++) {
    const k = Math.min(per, left); left -= k;
    for (const c of CENTER[k]) out.push(rows[r] * COLS + c);
  }
  return out;
}
const pageOf = (list, page) => { const pages = Math.max(1, Math.ceil(list.length / PER_PAGE)), p = Math.max(0, Math.min(page, pages - 1)); return { p, pages, items: list.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE) }; };
/** previous / next page buttons (the global button bar puts them in their place) */
function pager(f, p, pages, go) {
  if (pages <= 1) return;
  const bar = (f.rows - 1) * COLS;
  if (p > 0) set(f, bar + 0, hdr(1) + "§aPrevious page", "textures/items/arrow", { run: () => go(p - 1) });
  if (p < pages - 1) set(f, bar + 8, hdr(1) + "§aNext page", "textures/items/arrow", { run: () => go(p + 1) });
  set(f, bar + 3, hdr(1) + "§ePage " + (p + 1) + "/" + pages, NAV.page, null);
}
const fail = (player, msg) => player.sendMessage(menuMsg(player, "§c[Cosmetics] " + msg));

// ---------------------------------------------------------------- the hub
const owned = (p, kind) => (kind === "color" ? COLORS : TRAILS).filter((i) => owns(p, kind, i.id)).length;
export const SECTIONS = [
  { id: "titles", name: "Titles", color: "§e", icon: ICON.title, count: (p) => TITLES.filter((t) => titleOwned(p, t)).length, text: ["The title next to your name", "in chat (from achievements)"], open: (p, back) => titlesPage(p, 0, back) },
  { id: "colors", name: "Name Colors", color: "§d", icon: ICON.color, count: (p) => owned(p, "color"), text: ["Colour of your name in chat", "Buy with money or shards"], open: (p, back) => colorsPage(p, 0, back) },
  { id: "trails", name: "Particle Trails", color: "§b", icon: ICON.trail, count: (p) => owned(p, "trail"), text: ["Particles that follow you", "as you walk"], open: (p, back) => trailsPage(p, 0, back) },
  { id: "fx", name: "Effects & Sounds", color: "§a", icon: ICON.fx, count: () => 0, text: ["Turn particles and sounds on or off,", "scoreboard style and pop-ups"], open: (p, back) => fxPage(p, back) },
];

export function cosmeticsPage(player, back) {
  const f = make("Cosmetics", SHORT_ROWS); f.self = () => cosmeticsPage(player, back);
  const c = colorOf(player), t = trailOf(player), tag = titleTag(player);
  set(f, 0 * COLS + 4, hdr(1) + "§d§l" + (c ? paint(c, player.name) : player.name) + (tag ? " " + tag : "") + "\n§r§7Title: " + (tag || "§8none") + "\n§r§7Name color: " + (c ? "§f" + c.name : "§8none") + "\n§r§7Trail: " + (t ? "§f" + t.name : "§8none"), ICON.star, null);
  const slots = gridSlots(SECTIONS.length, [2], 4);
  SECTIONS.forEach((s, i) => {
    const n = s.count(player);
    set(f, slots[i], hdr(Math.max(1, n)) + s.color + "§l" + s.name + "\n§r§7" + s.text.join("\n§r§7") + (n > 0 ? "\n§r§7You own: §f" + n : "") + "\n§r§eClick to open", s.icon, { run: () => s.open(player, () => cosmeticsPage(player, back)) });
  });
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- titles
export function titlesPage(player, page, back) {
  const f = make("Titles", SHORT_ROWS), cur = ex(player).title || "newcomer";
  const { p, pages, items } = pageOf(TITLES, page);
  f.self = () => titlesPage(player, p, back);
  const tag = titleTag(player);
  set(f, 0 * COLS + 4, hdr(1) + "§e§lYour title\n§r" + (tag || "§8none") + "\n§r§7Shown next to your name in chat.\n§r§7Titles come from achievements.", ICON.title, null);
  const slots = gridSlots(items.length);
  items.forEach((t, i) => {
    const own = titleOwned(player, t), isWorn = cur === t.id;
    if (own) set(f, slots[i], hdr(1, isWorn ? "g" : "c") + t.color + "§l" + t.name + "\n§r" + (isWorn ? "§aShown now" : "§eClick to show this title") + "\n§r§7" + t.need, ICON.title, { run: () => { selectTitle(player, t.id); titlesPage(player, p, back); } });
    else set(f, slots[i], hdr(1, "r") + "§8§l" + t.name + "\n§r§cLocked\n§r§7How: " + t.need, ICON.paper, null);
  });
  pager(f, p, pages, (n) => titlesPage(player, n, back));
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- name colours / trails (same page, different list)
const KIND = {
  color: { title: "Name Colors", list: COLORS, byId: colorById, label: (i) => (i.rainbow ? paint(i, i.name) : i.code + i.name), icon: ICON.color },
  trail: { title: "Particle Trails", list: TRAILS, byId: trailById, label: (i) => "§f" + i.name, icon: ICON.trail },
};
const shopPage = (kind) => function page(player, pg, back) {
  const K = KIND[kind], f = make(K.title, SHORT_ROWS), { p, pages, items } = pageOf(K.list, pg);
  f.self = () => page(player, p, back);
  const w = worn(player, kind) && owns(player, kind, worn(player, kind)) ? K.byId(worn(player, kind)) : null;
  set(f, 0 * COLS + 4, hdr(1) + "§e§l" + K.title + "\n§r§7Wearing: " + (w ? K.label(w) : "§8none") + "\n§r§7You own: §f" + owned(player, kind) + "§7/§f" + K.list.length + "\n§r§7Bought once = yours forever.\n§r§7Click an item you own to wear / take off.", K.icon, null);
  const slots = gridSlots(items.length);
  items.forEach((it, i) => {
    const own = owns(player, kind, it.id), isWorn = w && w.id === it.id;
    const price = "\n§r§7Price: §a" + money(buyPrice(player, it.money, 0)) + " §7or §d" + num(it.shards) + " shards";
    if (own) set(f, slots[i], hdr(1, isWorn ? "g" : "c") + K.label(it) + "\n§r" + (isWorn ? "§aWearing - click to take off" : "§eOwned - click to wear"), it.icon, { run: () => { wear(player, kind, isWorn ? "" : it.id); page(player, p, back); } });
    else set(f, slots[i], hdr(1) + K.label(it) + price + "\n§r§eClick to see more", it.icon, { run: () => itemPage(player, kind, it, p, back) });
  });
  pager(f, p, pages, (n) => page(player, n, back));
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
};
export const colorsPage = shopPage("color");
export const trailsPage = shopPage("trail");

/** one item that is not owned yet: buy with money or shards (+ a preview for trails) */
function itemPage(player, kind, it, listPage, back) {
  const K = KIND[kind], f = make(it.name, SHORT_ROWS), me = stats(player);
  const here = () => itemPage(player, kind, it, listPage, back), list = () => (kind === "color" ? colorsPage : trailsPage)(player, listPage, back);
  f.self = here;
  if (owns(player, kind, it.id)) return list();
  const sample = kind === "color" ? "\n§r§7Your name: " + paint(it, player.name) : "";
  set(f, 0 * COLS + 4, hdr(1) + K.label(it) + "\n§r§7" + K.title.replace(/s$/, "") + sample + "\n§r§7Money: §a" + money(me.money) + "\n§r§7Shards: §d" + num(me.shards), it.icon, null);
  const done = (cur) => { const r = buy(player, kind, it, cur); if (r.err) { fail(player, r.err); return here(); } wear(player, kind, it.id); player.sendMessage(menuMsg(player, "§a[Cosmetics] You bought §f" + it.name + " §afor " + (cur === "shards" ? "§d" + num(r.price) + " shards" : "§e" + money(r.price)) + "§a - now wearing it.")); list(); };
  const myM = buyPrice(player, it.money, 0), okM = me.money >= myM, okS = me.shards >= it.shards;
  set(f, 2 * COLS + 2, hdr(1, okM ? "g" : "r") + "§a§lBuy with money\n§r§7Price: §a" + money(myM) + "\n§r" + (okM ? "§eClick to buy" : "§cNeed " + money(myM - me.money) + " more"), NAV.ok, { run: () => (okM ? done("money") : (fail(player, "Not enough money."), here())) });
  set(f, 2 * COLS + 6, hdr(1, okS ? "g" : "r") + "§d§lBuy with shards\n§r§7Price: §d" + num(it.shards) + " shards\n§r" + (okS ? "§eClick to buy" : "§cNeed " + num(it.shards - me.shards) + " more"), NAV.ok, { run: () => (okS ? done("shards") : (fail(player, "Not enough shards."), here())) });
  if (kind === "trail") set(f, 2 * COLS + 4, hdr(1) + "§b§lPreview\n§r§7See it around you\n§r§7for a few seconds", ICON.trail, { run: () => { preview(player, it); here(); } });
  backBtn(f, list);
  status(player, f);
  open(player, f);
}
function preview(player, t) {
  if (ex(player).set.fxOff === true) { fail(player, "Particles are turned off for you (Cosmetics > Effects & Sounds)."); return; }
  for (let i = 0; i < 10; i++) system.runTimeout(() => { try { if (player.isValid) puff(player, t, [player]); } catch (e) { /* ignore */ } }, 10 + i * 4);
}

// ---------------------------------------------------------------- effects & sounds (+ the display switches that used to be in Settings)
// the three scoreboard styles - three plain buttons, the chosen one is green
const BOARDS = [
  { mode: "left",  name: "Left panel",  lines: ["Board on the far left", "of the screen"] },
  { mode: "bar",   name: "Bottom line", lines: ["One line in the bottom", "centre of the screen"] },
  { mode: "panel", name: "Right panel", lines: ["Board on the far right", "of the screen (the normal one)"] },
];
/** Fine control, as plain buttons right on the Effects & Sounds page: one click button for every kind of effect / sound / notice (fxprefs.js).
 *  Green = ON, red = OFF.  Only what YOU see and hear changes.  New groups added to GROUPS in fxprefs.js appear here by themselves. */
const PART_ICON = { msg: ICON.paper, sfx: ICON.fx, fx: ICON.trail };
const FINE = () => {
  const out = [];
  for (const g of GROUPS) for (const part of g.parts) out.push({ key: g.id + "." + part, group: g, part });
  return out;
};

export const EXTRA_SWITCHES = [
  { name: "Achievement pop-up", icon: ICON.star, lines: ["Big title in the middle of the", "screen when you unlock one"], on: (p) => ex(p).set.achTitle !== false, click: (p) => { ex(p).set.achTitle = ex(p).set.achTitle === false; } },
];
const SWITCHES = () => [
  ...TOGGLES.map((t) => ({ name: t.name, icon: t.icon, lines: t.lines, on: (p) => toggleOn(p, t), click: (p) => flip(p, t) })),
  ...EXTRA_SWITCHES,
];
export function fxPage(player, back) {
  const f = make("Effects & Sounds", 6); f.self = () => fxPage(player, back);
  const list = SWITCHES(), fine = FINE(), ar = isAr(player), cur = hudMode(player);
  set(f, 0 * COLS + 4, hdr(1) + "§a§lEffects & Sounds\n§r§7Green = ON, red = OFF.\n§r§7These only change what YOU see and hear.", ICON.fx, null);
  // row 1: the main switches (Particles, Sounds, My Trail, Achievement pop-up)
  const slots = gridSlots(list.length, [1], 5);
  list.forEach((s, i) => {
    const on = s.on(player);
    set(f, slots[i], hdr(1, on ? "g" : "r") + "§b§l" + s.name + "\n§r§7Now: " + (on ? ON : OFF) + "\n§r§7" + s.lines.join("\n§r§7") + "\n§r§eClick to switch", s.icon,
      { run: () => { s.click(player); fxPage(player, back); } });
  });
  // row 2: scoreboard style - left panel | bottom line | right panel (the chosen one is green)
  BOARDS.forEach((b, i) => {
    const on = cur === b.mode;
    set(f, 2 * COLS + [2, 4, 6][i], hdr(1, on ? "g" : "r") + "§6§l" + b.name + "\n§r§7" + b.lines.join("\n§r§7") + "\n§r" + (on ? "§aShown now" : "§eClick to use this style"), ICON.hud,
      { run: () => { if (!on) system.run(() => { setHud(player, b.mode); fxPage(player, back); }); else fxPage(player, back); } });
  });
  // rows 3-4: fine control - one button per effect / sound / notice, straight on this page
  fine.forEach((x, i) => {
    if (i >= 2 * COLS) return;
    const on = !isMuted(player, x.key), slot = 3 * COLS + i;
    const name = ar ? pick(player, "", x.group.ar, 24) : x.group.name, kind = ar ? pick(player, "", PART_NAME[x.part][1], 24) : PART_NAME[x.part][0];
    set(f, slot, hdr(1, on ? "g" : "r") + "§e§l" + name + "\n§r§f" + kind + "\n§r§7Now: " + (on ? ON : OFF) + "\n§r§eClick to switch", PART_ICON[x.part],
      { run: () => { setMuted(player, x.key, on); fxPage(player, back); } });
  });
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}
