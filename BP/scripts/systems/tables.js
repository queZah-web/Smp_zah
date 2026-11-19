// PAID TABLES - Anvil, Enchanting Table, Grindstone, Smithing Table.
// Right-click one without a pass and a small page asks you to pay ONCE for a single use, or to buy a 30-minute pass for that table (or the All-In-One pass).
// A pass runs in REAL time (saved end date), a countdown shows in the action bar, and while it is active the table opens normally with no questions.
// The game can't open a table's screen from a script, so after paying you simply right-click the table again.
// A single-use payment is ONE real use: the moment the table is really used (an item gets enchanted / merged / renamed / repaired / disenchanted / upgraded) the use is spent and the screen is closed by force, so it can NOT be used twice.
// If you pay and do NOT use it: a 30-second countdown (action bar) runs while the table is closed; opening it again stops the countdown, closing it again restarts it. When it reaches zero the exact money you paid is refunded.
// The paid use is saved with the player, so it is also settled (refunded when unused) if the player leaves the game.
import { world, system, BlockTypes } from "@minecraft/server";
import { sendBar } from "../barsend.js";
import { ex } from "../smp/store.js";
import { stats, takeMoney, addMoney } from "../data.js";
import { money } from "../format.js";
import { makeShop as make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { confirmShop as confirm } from "./forms.js";
import { luxShop, luxDing } from "../lux.js";
import { isAdmin, canEditBlock } from "./landcore.js";
import { combatBusy, skillBusy, passBusy, formBusy } from "../state.js";
import { duelView } from "./duelstate.js";
import { shopMsg } from "./shoplang.js";

// ---------------------------------------------------------------- prices (edit here)
export const PASS_MINUTES = 30;
export const TABLES = {
  anvil:   { name: "Anvil",           single: 299,  pass: 1399, icon: "textures/ui/shop/i3d_anvil", info: "Merge, repair and rename" },
  enchant: { name: "Enchanting Table", single: 500,  pass: 1899, icon: "textures/ui/shop/i3d_enchanting_table", info: "Enchant your gear" },
  grind:   { name: "Grindstone",       single: 25,   pass: 399,  icon: "textures/blocks/grindstone_side", info: "Remove enchants, get XP back" },
  smith:   { name: "Smithing Table",   single: 1399, pass: 4999, icon: "textures/ui/shop/i3d_smithing_table", info: "Netherite upgrades and armor trims" },
};
export const ALL_PASS = { name: "All-In-One Pass", pass: 8999, icon: "textures/items/nether_star", info: "Every table above, free" };
const REFUND_MS = 30000;                                // an unused paid single use is refunded this long after the table was closed
const BLOCK_TABLE = { "minecraft:anvil": "anvil", "minecraft:chipped_anvil": "anvil", "minecraft:damaged_anvil": "anvil", "minecraft:enchanting_table": "enchant", "minecraft:grindstone": "grind", "minecraft:smithing_table": "smith" };

// ---------------------------------------------------------------- pass data (absolute real-time end dates, saved with the player's extra data)
const passes = (p) => (ex(p).pass ??= {});
/** ms left of the pass that opens this table (its own pass or the All-In-One pass, whichever lasts longer) */
export function passLeft(p, key) { const d = passes(p), now = Date.now(); return Math.max(0, (d[key] ?? 0) - now, (d.all ?? 0) - now); }
function addPass(p, key) { const d = passes(p); d[key] = Math.max(Date.now(), d[key] ?? 0) + PASS_MINUTES * 60000; }
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const clockLong = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return (h ? h + ":" : "") + String(Math.floor((s % 3600) / 60)).padStart(2, h ? 2 : 1, "0") + ":" + String(s % 60).padStart(2, "0"); };

// ---------------------------------------------------------------- price of ONE use (the Anvil and Smithing Table cost more for valuable items in your hand)
const held = (p) => { try { const c = p.getComponent("minecraft:inventory").container; return c.getItem(p.selectedSlotIndex) ?? null; } catch (e) { return null; } };
function enchants(item) {
  try { const l = item?.getComponent("minecraft:enchantable")?.getEnchantments?.() ?? []; let tot = 0; for (const x of l) tot += x.level; return { tot, n: l.length }; } catch (e) { return { tot: 0, n: 0 }; }
}
/** { price, lines } - lines explain the price in the page */
/** the extra price (+/-) of an item for a table, and the reason shown in the page */
function calcExtra(key, id, tot) {
  let extra = 0, why = null;
  if (key === "anvil" && id) {
    const legend = /netherite|elytra|^mace$|trident|heavy_core/.test(id), score = tot + (legend ? 4 : 0);
    if (score >= 28 || (legend && tot >= 12)) { extra = 300; why = "Legendary item in your hand: +$300"; }
    else if (score >= 18) { extra = 150; why = "Highly enchanted item in your hand: +$150"; }
    else if (score >= 8) { extra = 100; why = "Enchanted item in your hand: +$100"; }
  } else if (key === "smith" && id) {
    if (id === "netherite_ingot" || id === "netherite_upgrade_smithing_template") { extra = 350; why = "Netherite upgrade: +$350"; }
    else if (/^(diamond|netherite)_(helmet|chestplate|leggings|boots|sword|axe|pickaxe|shovel|hoe)$/.test(id)) { extra = 200; why = "Diamond / netherite gear: +$200"; }
    else if (/_armor_trim_smithing_template$/.test(id)) { extra = 150; why = "Armor trim: +$150"; }
    else if (id === "diamond") { extra = 150; why = "Diamond trim colour: +$150"; }
    else if (id === "gold_ingot" || id === "emerald") { extra = 50; why = "Trim colour: +$50"; }
    else if (/^(lapis_lazuli|redstone|amethyst_shard|copper_ingot|quartz|iron_ingot|resin_brick)$/.test(id)) { extra = -100; why = "Simple trim colour: -$100"; }
  }
  return { extra, why };
}
/** { price, extra, lines } - lines explain the price in the page */
export function singlePrice(p, key) {
  const t = TABLES[key], item = held(p), id = item ? item.typeId.replace("minecraft:", "") : "";
  const { extra, why } = calcExtra(key, id, enchants(item).tot);
  return { price: t.single + extra, extra, lines: why ? [why] : [] };
}

// ---------------------------------------------------------------- paying
// The paid single use is saved in the player's extra data:  ex(p).tpay = { key, k, dim, pos, price, snap, lvl, open, closeAt }
//   open    = true while the table screen is (believed to be) open, closeAt = when the refund happens if it stays unused
const pay = (p) => ex(p).tpay ?? null;
const inv = (p) => { try { return p.getComponent("minecraft:inventory").container; } catch (e) { return null; } };
const cursorItem = (p) => { try { return p.getComponent("minecraft:cursor_inventory")?.item ?? null; } catch (e) { return null; } };
const SEP = "\u0001";
function identity(it) {
  let en = ""; try { en = (it.getComponent("minecraft:enchantable")?.getEnchantments?.() ?? []).map((x) => (x.type?.id ?? x.type) + ":" + x.level).sort().join(","); } catch (e) { /* ignore */ }
  let dm = 0; try { dm = it.getComponent("minecraft:durability")?.damage ?? 0; } catch (e) { /* ignore */ }
  return it.typeId + SEP + en + SEP + (it.nameTag ?? "") + SEP + dm;
}
const parseId = (k) => { const [t, e, n, d] = k.split(SEP); return { t, e, n, d: Number(d) || 0 }; };
const enchTot = (e) => { let n = 0; for (const x of String(e || "").split(",")) { const v = Number(x.slice(x.lastIndexOf(":") + 1)); if (v > 0) n += v; } return n; };
/** the player's items by identity (type + enchants + name + damage) -> how many stacks. Amounts and slots are ignored. The item on the mouse cursor counts too. */
function snapshot(p) {
  const m = {}, c = inv(p);
  if (c) for (let i = 0; i < c.size; i++) { try { const it = c.getItem(i); if (it) { const k = identity(it); m[k] = (m[k] ?? 0) + 1; } } catch (e) { /* ignore slot */ } }
  try { const it = cursorItem(p); if (it) { const k = identity(it); m[k] = (m[k] ?? 0) + 1; } } catch (e) { /* ignore */ }
  return m;
}
const lvl = (p) => { try { return p.level ?? 0; } catch (e) { return 0; } };
/** what changed since the snapshot: M = items that are gone / changed, G = items that appeared. A tool or armor that just got MORE damaged (normal wear: mining, a hit) is not a change. */
function diffItems(snap, now) {
  const M = [], G = [];
  for (const k in snap) for (let i = now[k] ?? 0; i < snap[k]; i++) M.push(parseId(k));
  for (const k in now) for (let i = snap[k] ?? 0; i < now[k]; i++) G.push(parseId(k));
  for (let i = M.length - 1; i >= 0; i--) {
    const j = G.findIndex((g) => g.t === M[i].t && g.e === M[i].e && g.n === M[i].n && g.d > M[i].d);
    if (j >= 0) { G.splice(j, 1); M.splice(i, 1); }
  }
  return { M, G };
}
/** true when the table was REALLY used since the snapshot: something of the player is gone/changed AND a new item showed up (the result) or the XP level dropped (anvil / enchanting).
 *  Only putting items into the table slots is NOT a use (items are just missing, nothing new appeared). strict = anything gone counts (used when a drop was seen). */
function looksUsed(p, tk, strict = false) {
  if (!tk.snap) return false;
  const { M, G } = diffItems(tk.snap, snapshot(p));
  const levelDrop = (tk.key === "anvil" || tk.key === "enchant") && lvl(p) < (tk.lvl ?? 0);
  // a RESULT of a table has the type of something that went in (an enchanted book becomes a book at the grindstone, a diamond item becomes netherite at the smithing table);
  // anything else that shows up (a crafted item, a picked-up item) is not a table result
  const rel = (g) => M.some((m) => m.t === g.t || (m.t === "minecraft:enchanted_book" && g.t === "minecraft:book")) || (tk.key === "smith" && /netherite_/.test(g.t));
  return levelDrop || (M.length > 0 && (strict || G.some(rel)));
}
/** the real extra price of what was used (the most valuable item that went in) */
function usedExtra(tk, snap, now) {
  const { M } = diffItems(snap, now); let best = null;
  for (const m of M) { const x = calcExtra(tk.key, m.t.replace("minecraft:", ""), enchTot(m.e)).extra; if (best === null || x > best) best = x; }
  return best ?? 0;
}
const posKey = (b) => b.dimension.id + ":" + b.x + "," + b.y + "," + b.z;
const needMore = (p, cost) => { p.sendMessage(shopMsg(p, "§c[Tables] You don't have enough money! You need §f" + money(cost - stats(p).money) + " §cmore.")); return false; };
function charge(p, cost) { if (stats(p).money < cost) return needMore(p, cost); return takeMoney(p, cost); }

/** forces the open table screen to close: the screen shuts when the player is far from the table, so the player is lifted a few blocks for 3 ticks and put back exactly where he was.
 *  Safe: only when there is free air above, slow falling protects against any fall, and nothing is done to a player who is riding something. Returns true when the lift was done. */
function closeScreen(p) {
  try {
    if (p.getComponent("minecraft:riding")?.entityRidingOn) return false;
    const dim = p.dimension, l = p.location, loc = { x: l.x, y: l.y, z: l.z }, rot = p.getRotation(), max = dim.heightRange.max;
    let up = null;
    for (const off of [12, 16, 24]) {
      const y = Math.floor(loc.y) + off; if (y + 2 >= max) break;
      const a = dim.getBlock({ x: Math.floor(loc.x), y, z: Math.floor(loc.z) }), b = dim.getBlock({ x: Math.floor(loc.x), y: y + 1, z: Math.floor(loc.z) });
      if (a?.isAir && b?.isAir) { up = { x: loc.x, y: loc.y + off, z: loc.z }; break; }
    }
    if (!up) return false;
    p.addEffect("slow_falling", 100, { showParticles: false });
    p.teleport(up, { dimension: dim, rotation: rot });
    system.runTimeout(() => { try { p.teleport(loc, { dimension: dim, rotation: rot }); } catch (e) { /* player left */ } }, 3);
    return true;
  } catch (e) { return false; }
}

/** the paid use is over: delete it FIRST (so it can never be settled twice), then refund when it was not used. why = "time" | "leave" | "new" */
function settle(p, why) {
  const tk = pay(p); if (!tk) return;
  delete ex(p).tpay;
  let used = true;
  try { used = tk.verified ? false : looksUsed(p, tk, !!tk.suspect); } catch (e) { used = true; }      // verified = checked when the table was closed; on any doubt: no refund (never free money)
  if (used) return;
  addMoney(p, tk.price);
  p.sendMessage(shopMsg(p, "§a[Tables] You did not use the §f" + TABLES[tk.key].name + "§a - your §e" + money(tk.price) + " §ahas been refunded."));
  luxDing(p);
}
/** the single use was really used: spent, the screen is closed so it can't be used again.
 *  If the item that went in is worth more than the item that was in the hand when paying, the difference is charged (may go below zero).
 *  A guard then watches for a second use on the same open screen (if the screen could not be closed): each one is charged again. */
function spent(p, tk) {
  delete ex(p).tpay;
  try {
    const diff = usedExtra(tk, tk.snap, snapshot(p)) - (tk.extra ?? 0);
    if (diff > 0) { addMoney(p, -diff); p.sendMessage(shopMsg(p, "§e[Tables] The item you used is worth more than the one in your hand when you paid: §c+" + money(diff) + " §echarged.")); }
  } catch (e) { /* ignore */ }
  const closed = closeScreen(p);
  p.sendMessage(shopMsg(p, "§7[Tables] Used. The next use costs again." + (closed ? "" : " §eClose the table now.")));
  ex(p).tguard = { key: tk.key, dim: tk.dim, pos: tk.pos, snap: snapshot(p), lvl: lvl(p), until: Date.now() + 120000, t: Date.now() + 500, grace: Date.now() + 800 };
}

function buyUse(p, key, block) {
  if (pay(p)) settle(p, "new");                      // an older unused paid use is refunded first (never lose or double count money)
  const { price, extra } = singlePrice(p, key);
  if (!charge(p, price)) return;
  ex(p).tpay = { key, k: posKey(block), dim: block.dimension.id, pos: [block.x, block.y, block.z], price, extra, snap: null, lvl: 0, open: false, closeAt: Date.now() + REFUND_MS, t: Date.now() };
  p.sendMessage(shopMsg(p, "§a[Tables] Paid §e" + money(price) + " §afor one use of the §f" + TABLES[key].name + "§a. §fRight-click it again now §7(if you don't use it, you get your money back " + (REFUND_MS / 1000) + "s after you close it)"));
  luxDing(p); luxShop(p);
}
function buyPass(p, key) {
  const cost = key === "all" ? ALL_PASS.pass : TABLES[key].pass, name = key === "all" ? ALL_PASS.name : TABLES[key].name + " pass";
  if (!charge(p, cost)) return false;
  addPass(p, key);
  p.sendMessage(shopMsg(p, "§a[Tables] §f" + name + " §abought for §e" + money(cost) + " §a- §f" + PASS_MINUTES + " minutes §7(" + (key === "all" ? "all tables" : "this table") + " open freely now)"));
  luxDing(p); luxShop(p);
  return true;
}

// ---------------------------------------------------------------- the page you get when you click a table without a pass
function tablePage(p, key, block) {
  const t = TABLES[key], { price, lines } = singlePrice(p, key);
  const f = make(t.name); f.self = () => tablePage(p, key, block);
  const bal = stats(p).money;
  set(f, 1 * COLS + 4, hdr(1) + "§e§l" + t.name + "\n§r§7" + t.info + "\n§r§7Your balance: §a" + money(bal) + "\n§r§7One use: §a" + money(price) + lines.map((l) => "\n§r§8" + l).join("") + "\n§r§7" + PASS_MINUTES + "-minute pass: §a" + money(t.pass), t.icon, null);
  set(f, 4 * COLS + 2, hdr(1, bal >= price ? "g" : "r") + "§a§lPay & use once\n§r§7Cost: §a" + money(price) + "\n§r" + (bal >= price ? "§eClick to pay" : "§cNeed " + money(price - bal) + " more"), NAV.ok, { run: () => { buyUse(p, key, block); } });
  set(f, 4 * COLS + 4, hdr(1, bal >= t.pass ? "g" : "r") + "§b§l" + PASS_MINUTES + "-minute pass\n§r§7" + t.name + " only\n§r§7Cost: §a" + money(t.pass) + "\n§r" + (bal >= t.pass ? "§eClick to buy" : "§cNeed " + money(t.pass - bal) + " more"), t.icon, { run: () => { buyPass(p, key); } });
  set(f, 4 * COLS + 6, hdr(1, bal >= ALL_PASS.pass ? "g" : "r") + "§d§lAll-In-One pass\n§r§7All 4 tables, " + PASS_MINUTES + " minutes\n§r§7Cost: §a" + money(ALL_PASS.pass) + "\n§r" + (bal >= ALL_PASS.pass ? "§eClick to buy" : "§cNeed " + money(ALL_PASS.pass - bal) + " more"), ALL_PASS.icon, { run: () => { buyPass(p, "all"); } });
  set(f, 7 * COLS + 4, hdr(1, "r") + "§c§lCancel\n§r§7Close", NAV.no, { run: () => {} });
  open(p, f);
}

// ---------------------------------------------------------------- "Table Passes" page (shop -> Enchanted Books, or /pass)
export function passesPage(p, back) {
  const f = make("Table Passes"); f.self = () => passesPage(p, back);
  set(f, 1 * COLS + 4, hdr(1) + "§e§lTable Passes\n§r§7Use a table as often as you like\n§r§7for " + PASS_MINUTES + " real minutes.\n§r§7Buying again adds " + PASS_MINUTES + " more minutes.\n§r§7Without a pass: pay per use.", NAV.page, null);
  const card = (slot, key, t, price) => {
    const left = passLeft(p, key === "all" ? "none" : key) , own = Math.max(0, (passes(p)[key] ?? 0) - Date.now());
    const st = own > 0 ? "§aActive: §f" + clockLong(own) : key !== "all" && left > 0 ? "§aOpen via All-In-One: §f" + clockLong(left) : "§7Not active";
    set(f, slot, hdr(1, own > 0 ? "g" : "c") + "§f§l" + t.name + "\n§r§7" + t.info + "\n§r§7" + PASS_MINUTES + " min: §a" + money(price) + "\n§r" + st + "\n§r§eClick to buy", t.icon, {
      run: () => confirm(p, "Buy pass", ["§f" + t.name + (key === "all" ? "" : " pass"), "§7Duration: §f" + PASS_MINUTES + " minutes (real time)", "§7Cost: §a" + money(price), "§7Your balance: §a" + money(stats(p).money)], () => { buyPass(p, key); passesPage(p, back); }, () => passesPage(p, back)) });
  };
  card(3 * COLS + 1, "anvil", TABLES.anvil, TABLES.anvil.pass);
  card(3 * COLS + 3, "enchant", TABLES.enchant, TABLES.enchant.pass);
  card(3 * COLS + 5, "grind", TABLES.grind, TABLES.grind.pass);
  card(3 * COLS + 7, "smith", TABLES.smith, TABLES.smith.pass);
  card(5 * COLS + 4, "all", ALL_PASS, ALL_PASS.pass);
  if (back) backBtn(f, back);
  status(p, f);
  open(p, f);
}

// ---------------------------------------------------------------- guard: right-clicking a table
const placeable = (item) => { try { return !!item && !!BlockTypes.get(item.typeId); } catch (e) { return false; } };
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    const p = ev.player, b = ev.block, key = BLOCK_TABLE[b.typeId];
    if (!key || isAdmin(p)) return;
    if (!canEditBlock(p, b)) return;                                         // protected land: the land guard answers
    if (p.isSneaking && placeable(ev.itemStack)) return;                     // sneaking with a block = building next to the table
    if (passLeft(p, key) > 0) return;                                        // pass active: opens normally
    const tk = pay(p);
    if (tk && tk.key === key && tk.k === posKey(b)) {                        // paid single use for THIS table: it opens now, the countdown stops
      tk.open = true; tk.closeAt = null; tk.snap = snapshot(p); tk.lvl = lvl(p); tk.verified = false; tk.suspect = false; tk.t = Date.now() + 500; look.delete(p.id);
      return;
    }
    ev.cancel = true;
    if (formBusy.has(p.id)) return;
    system.run(() => { try { tablePage(p, key, b); } catch (e) { console.warn("[tables] page: " + e); } });
  });
} catch (e) { console.warn("[tables] guard not started: " + e); }
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { shown.delete(playerId); look.delete(playerId); look.delete("g" + playerId); freeAt.delete(playerId); passBusy.delete(playerId); }); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- countdown in the action bar
const shown = new Map();        // player id -> Set of keys that were active last time (to say "pass ended")
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const keys = ["anvil", "enchant", "grind", "smith", "all"], act = keys.filter((k) => (passes(p)[k] ?? 0) > Date.now());
      const tk = pay(p), tkLeft = tk && !tk.open && tk.closeAt ? tk.closeAt - Date.now() : 0, dTxt = (stats(p).hud ?? "panel") !== "bar" ? null : duelView.bar(p);      // side panel already shows the duel countdown (Duel row): re-sending the action bar every 0.5 s made the panel flicker
      const prev = shown.get(p.id) ?? new Set();
      for (const k of prev) if (!act.includes(k)) p.sendMessage(shopMsg(p, "§e[Tables] Your §f" + (k === "all" ? ALL_PASS.name : TABLES[k].name + " pass") + " §ehas ended."));
      shown.set(p.id, new Set(act));
      if (!act.length && !(tkLeft > 0) && !dTxt) { if (passBusy.delete(p.id)) { try { p.onScreenDisplay.setActionBar(""); } catch (e) { /* ignore */ } } continue; }
      if (combatBusy.has(p.id) || skillBusy.has(p.id)) { passBusy.delete(p.id); continue; }      // the combat timer / skill bar own the action bar
      passBusy.add(p.id);
      const now = Date.now(), parts = act.slice(0, 3 - (tkLeft > 0 ? 1 : 0) - (dTxt ? 1 : 0)).map((k) => "§6⏳ " + (k === "all" ? "All tables" : TABLES[k].name) + ": §f" + clock((passes(p)[k] ?? 0) - now));
      if (dTxt) parts.unshift(dTxt);
      if (tkLeft > 0) parts.push("§e⏳ " + TABLES[tk.key].name + " refund in: §f" + clock(tkLeft));
      sendBar(p, parts.join(" §8| "));
    } catch (e) { /* player not ready */ }
  }
}, 10);

// ---------------------------------------------------------------- the paid single use: spent when really used, refunded 30 s after the table is closed unused
const look = new Map();         // key -> { x, y, slot }  (camera + hotbar slot while the table is open: they can't change while a screen is open, so a change = the screen was closed)
const freeAt = new Map();       // player id -> last time he did something that needs a closed screen (break / place / hit / use an item)
const ang = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function seemsClosed(p, o, key) {
  if (p.dimension.id !== o.dim) return true;
  const [x, y, z] = o.pos, dx = p.location.x - (x + 0.5), dy = p.location.y - y, dz = p.location.z - (z + 0.5);
  if (Date.now() > (o.grace ?? 0) && dx * dx + dy * dy + dz * dz > 49) return true;      // 7+ blocks away: the screen closes by itself (not during the short lift that closes it)
  if ((freeAt.get(p.id) ?? 0) > (o.t ?? 0)) return true;                  // he broke / placed / hit / used something: no screen is open
  const r = p.getRotation(), cur = { x: r.x, y: r.y, slot: p.selectedSlotIndex }, old = look.get(key);
  look.set(key, cur);
  if (!old) return false;
  return Math.abs(cur.x - old.x) > 0.5 || ang(cur.y, old.y) > 0.5 || cur.slot !== old.slot;
}
const markFree = (p) => { if (p) freeAt.set(p.id, Date.now()); };
try { world.afterEvents.playerBreakBlock.subscribe((ev) => markFree(ev.player)); } catch (e) { /* ignore */ }
try { world.afterEvents.playerPlaceBlock.subscribe((ev) => markFree(ev.player)); } catch (e) { /* ignore */ }
try { world.afterEvents.itemUse.subscribe((ev) => markFree(ev.source)); } catch (e) { /* ignore */ }
try { world.afterEvents.entityHitEntity.subscribe((ev) => { if (ev.damagingEntity?.typeId === "minecraft:player") markFree(ev.damagingEntity); }); } catch (e) { /* ignore */ }
// an item dropped near a player whose table is open = he may be hiding the result: if he closes it, ANY missing item counts as used
try {
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try {
      if (entity.typeId !== "minecraft:item") return;
      for (const p of world.getAllPlayers()) {
        const tk = pay(p); if (!tk?.open || p.dimension.id !== entity.dimension.id) continue;
        const dx = p.location.x - entity.location.x, dy = p.location.y - entity.location.y, dz = p.location.z - entity.location.z;
        if (dx * dx + dy * dy + dz * dz < 49) tk.suspect = true;
      }
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

system.runInterval(() => {
  const now = Date.now();
  for (const p of world.getAllPlayers()) {
    try {
      const tk = pay(p);
      if (tk) {
        if (tk.open) {
          const closed = seemsClosed(p, tk, p.id);
          if (looksUsed(p, tk, closed && !!tk.suspect)) { spent(p, tk); continue; }       // really used: spent + screen closed
          if (closed) { tk.open = false; tk.verified = true; tk.closeAt = now + REFUND_MS; look.delete(p.id); }   // closed and checked: the 30 s countdown starts
        } else if (tk.closeAt && now >= tk.closeAt) settle(p, "time");
      } else look.delete(p.id);
      const g = ex(p).tguard;                                                              // after a use: a second use on the same open screen is charged again
      if (g) {
        if (now > g.until || seemsClosed(p, g, "g" + p.id)) { delete ex(p).tguard; look.delete("g" + p.id); }
        else if (looksUsed(p, g)) {
          const price = TABLES[g.key].single + Math.max(0, usedExtra(g, g.snap, snapshot(p)));
          addMoney(p, -price);
          p.sendMessage(shopMsg(p, "§c[Tables] A second use on the same screen: §f" + money(price) + " §ccharged again."));
          closeScreen(p);
          g.snap = snapshot(p); g.lvl = lvl(p); g.until = now + 120000; g.t = now + 500; g.grace = now + 800;
        }
      }
    } catch (e) { /* ignore */ }
  }
}, 1);
// a paid use that was left behind (the player left the game with it) is settled when he comes back
try { world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => { if (initialSpawn) system.runTimeout(() => { try { if (pay(player)) settle(player, "leave"); } catch (e) { /* ignore */ } }, 40); }); } catch (e) { /* ignore */ }
