// /menu -> Mining Tools : ONE tidy page for every mining tool.  7 rows, everything centred and grouped:
//
//   row 0   [ Enable ALL ]   [ Your Mining Kit = status ]   [ Disable ALL ]
//   row 1   PAID:  Timber | Area 3x3 | Area 5x5 | Chest Sell | Auto-Smelt
//   row 2   Buy time button under each paid tool
//   row 3   (empty - keeps the two groups apart)
//   row 4   FREE:  Vein Miner | Magnet
//   row 5   (admins: Set prices)
//   row 6   bar: Back | Refresh | How to use | Balance
//
// Colours: green slot = ON, red slot = OFF or locked (no time left).  Click a tool = switch it; no time left = the buy page opens.
import { make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { miningOpts, activeOpts, setMiningOpt, setTimberMode, timeLeft, fitsMin, addMinutes, priceOf, packsOf, maxMinOf, basePriceOf, setPrices, resetPrices, MINING_MAX_PRICE, abilityOff, setAbilityOff, ABILITY_KEYS } from "./mining.js";
import { VEIN_MAX, MINING_PASS, AREA_DEPTH, MAGNET_RANGE, MAGNET_PAUSE } from "./config.js";
import { stats, takeMoney } from "../data.js";
import { buyPrice } from "../priceperks.js";
const myPrice = (p, key, m) => buyPrice(p, priceOf(key, m), 0);        // the rank / Trading discount of this player
import { money } from "../format.js";
import { confirmShort as confirm } from "./forms.js";
import { luxDing, luxShop } from "../lux.js";
import { ModalFormData } from "@minecraft/server-ui";
import { isAdmin } from "./landcore.js";
import { can, isOwner, slog } from "./staffcore.js";
import { world } from "@minecraft/server";
import { showModal, textField } from "./forms.js";
import { menuMsg, MenuForm } from "./menulang.js";

const ROWS = 7;
const ON = "§aON", OFF = "§cOFF";
const clock = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600); return h + ":" + String(Math.floor((t % 3600) / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
const timeLine = (p, key) => (timeLeft(p, key) > 0 ? "§7Time left: §f" + clock(timeLeft(p, key)) : "§cNo time - buy below");
const minLabel = (m) => (m >= 60 && m % 60 === 0 ? (m / 60 === 1 ? "1 hour" : m / 60 + " hours") : m + " minutes");
const ICON = {
  timber: "textures/items/iron_axe", t40: "textures/items/netherite_axe",
  a3: "textures/items/diamond_pickaxe", a5: "textures/items/netherite_pickaxe",
  chest: "textures/items/diamond_axe", vein: "textures/ui/shop/i3d_diamond_ore",
  magnet: "textures/items/ender_eye", smelt: "textures/ui/shop/i3d_furnace",
};

/** switches a tool ON right after its time was bought (a tool that still had time keeps the player's own ON / OFF choice) */
function autoOn(p, key) {
  try {
    if (key === "timber" || key === "t40") setTimberMode(p, 20);
    else if (key === "a3") setMiningOpt(p, "area", 3);
    else if (key === "a5") setMiningOpt(p, "area", 5);
    else if (key === "chest") setMiningOpt(p, "chest", true);
    else if (key === "smelt") setMiningOpt(p, "smelt", true);
    else if (key === "magnet") setMiningOpt(p, "mag", true);
    else return false;
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- buying time (real time).  Normal tools: 30 min / 1 h / 6 h packs.  Magnet + Auto-Smelt: ONE pack of 30 minutes (max 30 minutes held).
const offMsg = (p, name) => { try { p.sendMessage(menuMsg(p, "§c[Mining] §f" + name + " §cis switched off by the Owner for now.")); } catch (e) { /* ignore */ } };
function buy(p, key, min) {
  const cost = myPrice(p, key, min), name = MINING_PASS[key].name;
  if (abilityOff(key)) { offMsg(p, name); return false; }                  // nobody can buy time for an ability the Owner switched off
  if (!fitsMin(p, key, min)) { p.sendMessage(menuMsg(p, "§c[Mining] You can hold at most " + minLabel(maxMinOf(key)) + " of " + name + (maxMinOf(key) <= 30 ? ". Wait until the time is over." : "."))); return false; }
  if (stats(p).money < cost) { p.sendMessage(menuMsg(p, "§c[Mining] You don't have enough money! You need §f" + money(cost - stats(p).money) + " §cmore.")); return false; }
  if (!takeMoney(p, cost)) return false;
  const wasLocked = timeLeft(p, key) <= 0;              // no time before = it was switched off / locked
  addMinutes(p, key, min);
  const turnedOn = wasLocked && autoOn(p, key);         // bought it -> it works right away, no need to switch it on again
  p.sendMessage(menuMsg(p, "§a[Mining] §f" + name + " §a+" + minLabel(min) + " for §e" + money(cost) + " §a- time left: §f" + clock(timeLeft(p, key)) + (turnedOn ? " §a(turned ON)" : "")));
  luxDing(p); luxShop(p);
  return true;
}
const packsText = (key, p) => packsOf(key).map((m) => "§7" + minLabel(m) + ": §a" + money(p ? myPrice(p, key, m) : priceOf(key, m))).join("\n§r");

export function buyPage(p, key, back) {
  const t = MINING_PASS[key], bal = stats(p).money, packs = packsOf(key), maxMin = maxMinOf(key);
  const f = make(t.name, 5); f.self = () => buyPage(p, key, back);
  const again = () => buyPage(p, key, back), leave = () => miningPage(p, back);
  set(f, 0 * COLS + 4, hdr(1) + "§e§l" + t.name + "\n§r" + packsText(key, p) + "\n§r§7Maximum: §f" + minLabel(maxMin) + (packs.length === 1 ? "\n§r§7Only one pack: " + minLabel(packs[0]) : "") + "\n§r§7Your balance: §a" + money(bal) + "\n§r" + timeLine(p, key), ICON[key] ?? NAV.page, null);
  const cols = packs.length === 1 ? [4] : [1, 4, 7];
  packs.forEach((min, i) => {
    const price = myPrice(p, key, min), fit = fitsMin(p, key, min), okb = fit && bal >= price, label = minLabel(min);
    set(f, 2 * COLS + cols[i], hdr(1, okb ? "g" : "r") + "§a§l+" + label + "\n§r§7Cost: §a" + money(price) + "\n§r" + (!fit ? "§cWould go over " + minLabel(maxMin) : bal >= price ? "§eClick to buy" : "§cNeed " + money(price - bal) + " more"), NAV.ok,
      { run: () => { if (!fit) return again(); confirm(p, "Buy time", ["§f" + t.name, "§7Time: §f" + label + " (real time)", "§7Cost: §a" + money(price), "§7Your balance: §a" + money(bal)], () => { buy(p, key, min); again(); }, again); } });
  });
  set(f, 4 * COLS + 0, hdr(1) + "§cBack", NAV.back, { run: leave });
  open(p, f);
}

// ---------------------------------------------------------------- the page
export function miningPage(player, back) {
  const o = miningOpts(player), a = activeOpts(player), f = make("Mining Tools", ROWS);
  f.self = () => miningPage(player, back);
  const again = () => miningPage(player, back);
  const zone = (on) => hdr(1, on ? "g" : "r");
  const paid = (key, on) => (abilityOff(key) ? "§4OFF BY OWNER" : on ? ON : timeLeft(player, key) > 0 ? OFF : "§cLOCKED");
  const click = (key, fn) => () => (abilityOff(key) ? (offMsg(player, MINING_PASS[key].name), again()) : timeLeft(player, key) > 0 ? (fn(), again()) : buyPage(player, key, back));
  const toggle = (key, value) => () => setMiningOpt(player, key, value);
  const SW = "\n§r§eClick to switch";

  // ---- row 0: Enable ALL | Your Mining Kit | Disable ALL
  const all = () => { setTimberMode(player, 20); setMiningOpt(player, "vein", true); if (!o.area) setMiningOpt(player, "area", 3); setMiningOpt(player, "mag", true); setMiningOpt(player, "smelt", true); again(); };
  const none = () => { setTimberMode(player, 0); setMiningOpt(player, "vein", false); setMiningOpt(player, "area", 0); setMiningOpt(player, "chest", false); setMiningOpt(player, "mag", false); setMiningOpt(player, "smelt", false); again(); };
  set(f, 0 * COLS + 2, hdr(1) + "§a§lEnable ALL\n§r§7Timber, Vein, Area 3x3,\n§r§7Magnet, Auto-Smelt\n§r§8(Chest Sell stays as it is)", NAV.ok, { run: all });
  set(f, 0 * COLS + 6, hdr(1) + "§c§lDisable ALL\n§r§7Everything off - normal mining", NAV.no, { run: none });
  const line = (name, on, key) => "\n§r§7" + name + ": " + (on ? ON : OFF) + (key && timeLeft(player, key) > 0 ? " §8" + clock(timeLeft(player, key)) : "");
  set(f, 0 * COLS + 4, hdr(1) + "§e§lYour Mining Kit" + line("Timber", a.t20, "timber") +
    line("Area" + (a.area ? " " + a.area + "x" + a.area : ""), !!a.area, a.area === 5 ? "a5" : "a3") + line("Chest Sell", a.chest, "chest") + line("Auto-Smelt", a.smelt, "smelt") + line("Vein Miner", a.vein, null) + line("Magnet", a.magnet, null), "textures/items/paper", null);

  // ---- rows 1-2: PAID tools (5 across), the buy button sits right under each one
  const C = [0, 2, 4, 6, 8];
  set(f, 1 * COLS + C[0], zone(a.t20) + "§b§lTimber\n§r§7Now: " + paid("timber", a.t20) + "\n§r§7Sneak + axe on a log cuts the\n§r§7whole tree in ONE hit\n§r" + timeLine(player, "timber") + SW, ICON.timber, { run: click("timber", () => setTimberMode(player, o.timber ? 0 : 20)) });
  set(f, 1 * COLS + C[1], zone(a.area === 3) + "§b§lArea Mining 3x3\n§r§7Now: " + paid("a3", a.area === 3) + "\n§r§7Pickaxe looking down / up digs a\n§r§7row of 3, " + AREA_DEPTH[3] + " deep (sneak = 1 block)\n§r" + timeLine(player, "a3") + SW, ICON.a3, { run: click("a3", toggle("area", o.area === 3 ? 0 : 3)) });
  set(f, 1 * COLS + C[2], zone(a.area === 5) + "§b§lArea Mining 5x5\n§r§7Now: " + paid("a5", a.area === 5) + "\n§r§7Pickaxe looking down / up digs a\n§r§7row of 5, " + AREA_DEPTH[5] + " deep (sneak = 1 block)\n§r" + timeLine(player, "a5") + SW, ICON.a5, { run: click("a5", toggle("area", o.area === 5 ? 0 : 5)) });
  set(f, 1 * COLS + C[3], zone(a.chest) + "§b§lChest Sell\n§r§7Now: " + paid("chest", a.chest) + "\n§r§7AXE: break a chest = everything inside\n§r§7is sold - the chest stays in place\n§r" + timeLine(player, "chest") + SW, ICON.chest, { run: click("chest", toggle("chest", !o.chest)) });
  set(f, 1 * COLS + C[4], zone(a.smelt) + "§6§lAuto-Smelt\n§r§7Now: " + paid("smelt", a.smelt) + "\n§r§7Ores drop ingots: iron, gold,\n§r§7copper, ancient debris (scrap)\n§r§8Works with Vein + Area. Silk Touch = ore\n§r" + timeLine(player, "smelt") + SW, ICON.smelt, { run: click("smelt", toggle("smelt", !o.smelt)) });
  const buyBtn = (col, key) => set(f, 2 * COLS + col, hdr(1, timeLeft(player, key) > 0 ? "c" : "g") + "§6§lBuy time\n§r§7" + MINING_PASS[key].name + "\n§r§7" + packsOf(key).map((m) => minLabel(m) + " §a" + money(myPrice(player, key, m))).join("\n§r§7") + (packsOf(key).length === 1 ? "\n§r§8Max " + minLabel(maxMinOf(key)) : ""), "textures/ui/shop/ic_info", { run: () => (abilityOff(key) ? (offMsg(player, MINING_PASS[key].name), again()) : buyPage(player, key, back)) });
  ["timber", "a3", "a5", "chest", "smelt"].forEach((k, i) => buyBtn(C[i], k));

  // ---- row 4: FREE tools (nothing to buy)
  set(f, 4 * COLS + 3, zone(a.vein) + "§b§lVein Miner §a(FREE)\n§r§7Now: " + (abilityOff("vein") ? "§4OFF BY OWNER" : o.vein ? ON : OFF) + "\n§r§7Sneak + pickaxe on an ore mines\n§r§7the whole vein (max " + VEIN_MAX + " blocks)" + SW, ICON.vein, { run: () => { if (abilityOff("vein")) { offMsg(player, "Vein Miner"); return again(); } toggle("vein", !o.vein)(); again(); } });
  set(f, 4 * COLS + 5, zone(a.magnet) + "§d§lMagnet §a(FREE)\n§r§7Now: " + (abilityOff("magnet") ? "§4OFF BY OWNER" : a.magnet ? ON : OFF) + "\n§r§7Dropped items within " + MAGNET_RANGE + " blocks gather\n§r§7under you and follow you\n§r§8Items you throw are left alone\n§r§8Pauses when a player is within " + MAGNET_PAUSE + " blocks\n§r§8in protected land and the AFK area" + SW, ICON.magnet, { run: () => { if (abilityOff("magnet")) { offMsg(player, "Magnet"); return again(); } toggle("mag", !o.magnet)(); again(); } });

  // ---- admin only: change the price of every paid tool
  if (canPrice(player)) set(f, 5 * COLS + 4, hdr(1) + "§6§lSet prices\n§r§7Price of every paid tool\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => pricesPage(player, back) });

  // ---- Owner only: switch any mining ability off / on for everybody
  if (isOwner(player)) set(f, 5 * COLS + 6, hdr(1, "r") + "§4§lOwner: switch abilities\n§r§7Turn any mining ability OFF or ON\n§r§7for every player (3x3, 5x5, Magnet...)\n§r§7Off now: §f" + ABILITY_KEYS.filter((k) => abilityOff(k)).length + "\n§r§eOnly the Owner sees this - click", "textures/ui/shop/ic_cancel", { run: () => ownerAbilitiesPage(player, back) });

  // ---- button bar: Back | Refresh | How to use | Balance
  set(f, (ROWS - 1) * COLS + 5, hdr(1) + "§eHow to use\n§r§7Timber / Vein Miner: hold SNEAK while breaking.\n§r§7Area Mining: look down or up and break - it digs\n§r§7a narrow trench. Sideways: a square. Sneak = 1 block.\n§r§7Magnet: just walk - items come to your feet.\n§r§7Auto-Smelt: break an ore, get the ingot.\n§r§7Chest Sell: axe on a chest sells its contents.\n§r§7Survival only. Tools lose durability per block.", "textures/ui/shop/ic_help", null);
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- admin: prices of the paid tools (same price for everybody)
const canPrice = (p) => { try { return isAdmin(p) || can(p, "landlimit"); } catch (e) { return false; } };
const PRICE_SLOTS = [["timber", 1, 0], ["a3", 1, 2], ["a5", 1, 4], ["chest", 1, 6], ["smelt", 1, 8]];   // [key, row, col]

function pricesPage(p, back) {
  if (!canPrice(p)) return miningPage(p, back);
  const f = make("Mining prices", 5); f.self = () => pricesPage(p, back);
  const again = () => pricesPage(p, back);
  set(f, 0 * COLS + 4, hdr(1) + "§6§lSet prices\n§r§7Click a tool to change its price.\n§r§7Same price for every player.\n§r§8Only admins see this page", "textures/ui/shop/hud_money", null);
  PRICE_SLOTS.forEach(([key, row, col]) => {
    const changed = packsOf(key).some((m) => priceOf(key, m) !== basePriceOf(key, m));
    set(f, row * COLS + col, hdr(1) + "§e§l" + MINING_PASS[key].name + "\n§r" + packsText(key) + (changed ? "\n§r§6Changed - normal: §f" + packsOf(key).map((m) => money(basePriceOf(key, m))).join("§7, §f") : "\n§r§8Normal prices") + "\n§r§eClick to change", ICON[key] ?? NAV.page, { run: () => priceForm(p, key, back) });
  });
  set(f, 2 * COLS + 6, hdr(1) + "§c§lReset ALL\n§r§7Every tool back to its normal price", NAV.no, { run: () => confirm(p, "Reset prices", ["§fAll mining tools", "§7Back to the normal prices"], () => {
    if (!canPrice(p)) return miningPage(p, back);
    const err = resetPrices();
    p.sendMessage(menuMsg(p, err ? "§c[Mining] " + err : "§a[Mining] All mining prices are back to the normal prices."));
    again();
  }, again) });
  set(f, 4 * COLS + 0, hdr(1) + "§cBack", NAV.back, { run: () => miningPage(p, back) });
  open(p, f);
}

function priceForm(p, key, back) {
  if (!canPrice(p)) return miningPage(p, back);
  const packs = packsOf(key), name = MINING_PASS[key].name;
  const form = new MenuForm().title(name + " prices");
  packs.forEach((m) => textField(form, "§f" + minLabel(m) + " §7- price\n§7Now: §a" + money(priceOf(key, m)) + " §7| normal: §f" + money(basePriceOf(key, m)) + "\n§7Whole number, 1 to " + MINING_MAX_PRICE, String(priceOf(key, m))));
  try { form.toggle("§eReset to the normal prices", { defaultValue: false }); } catch (e) { form.toggle("§eReset to the normal prices", false); }
  showModal(p, form, (v) => {
    if (!v || !canPrice(p)) return pricesPage(p, back);
    if (v[packs.length] === true) {
      const err = resetPrices(key);
      p.sendMessage(menuMsg(p, err ? "§c[Mining] " + err : "§a[Mining] " + name + " is back to the normal prices."));
      return pricesPage(p, back);
    }
    const next = {};
    let any = false;
    packs.forEach((m, i) => { const raw = String(v[i] ?? "").trim(); next[m] = raw === "" ? priceOf(key, m) : raw; if (raw !== "") any = true; });
    if (!any) return pricesPage(p, back);
    for (const m of packs) if (!/^[0-9]{1,8}$/.test(String(next[m]))) { p.sendMessage(menuMsg(p, "§c[Mining] Prices must be whole numbers from 1 to " + MINING_MAX_PRICE + ".")); return pricesPage(p, back); }
    const err = setPrices(key, next);
    p.sendMessage(menuMsg(p, err ? "§c[Mining] " + err : "§a[Mining] " + name + " prices: " + packs.map((m) => "§f" + minLabel(m) + " §a" + money(priceOf(key, m))).join("§7, ") + "§a."));
    pricesPage(p, back);
  });
}

// ---------------------------------------------------------------- OWNER: switch any ability off / on for EVERYBODY (data: mining.js abilityOff / setAbilityOff)
const ABIL_NAME = { timber: "Timber", a3: "Area Mining 3x3", a5: "Area Mining 5x5", chest: "Chest Sell", smelt: "Auto-Smelt", vein: "Vein Miner", magnet: "Magnet" };
const ABIL_SLOT = { timber: 1 * COLS + 0, a3: 1 * COLS + 2, a5: 1 * COLS + 4, chest: 1 * COLS + 6, smelt: 1 * COLS + 8, vein: 2 * COLS + 3, magnet: 2 * COLS + 5 };

/** the Owner switches one ability (or all of them).  Everything is checked again here; the players online are told. */
function ownerSet(p, keys, off) {
  if (!isOwner(p)) return false;
  const changed = [];
  for (const k of keys) { if (abilityOff(k) === off) continue; if (setAbilityOff(k, off)) changed.push(k); }
  if (!changed.length) return false;
  const names = changed.map((k) => ABIL_NAME[k]).join(", ");
  try { slog(p, "minoff", null, (off ? "OFF: " : "ON: ") + names); } catch (e) { /* ignore */ }
  for (const pl of world.getAllPlayers()) { try { pl.sendMessage(menuMsg(pl, off ? "§6[Mining] §fThe Owner switched off: §c" + names : "§6[Mining] §fThe Owner switched on again: §a" + names)); } catch (e) { /* ignore */ } }
  return true;
}

function ownerAbilitiesPage(p, back) {
  if (!isOwner(p)) return miningPage(p, back);
  const f = make("Mining: Owner switches", 5); f.self = () => ownerAbilitiesPage(p, back);
  const again = () => ownerAbilitiesPage(p, back);
  const offCount = ABILITY_KEYS.filter((k) => abilityOff(k)).length;
  set(f, 0 * COLS + 4, hdr(1) + "§6§lOwner: mining abilities\n§r§7Click an ability to switch it OFF or ON\n§r§7for EVERY player (also the ones already paid)\n§r§7Paid time keeps running while it is off,\n§r§7and nobody can buy time for it\n§r§7Off now: §f" + offCount, ICON.timber, null);
  for (const k of ABILITY_KEYS) {
    const off = abilityOff(k);
    set(f, ABIL_SLOT[k], hdr(1, off ? "r" : "g") + (off ? "§4§l" : "§a§l") + ABIL_NAME[k] + "\n§r§7For everybody: " + (off ? "§4OFF" : "§aON") + "\n§r§eClick to switch " + (off ? "ON" : "OFF"), ICON[k] ?? NAV.page, { run: () => {
      if (!isOwner(p)) return miningPage(p, back);                                           // checked again
      if (!off) return confirm(p, "Switch OFF for everybody?", ["§f" + ABIL_NAME[k], "§7Nobody can use it until you", "§7switch it ON again."], () => { ownerSet(p, [k], true); again(); }, again);
      ownerSet(p, [k], false); again();
    } });
  }
  set(f, 3 * COLS + 2, hdr(1, "g") + "§a§lSwitch ALL on\n§r§7Every ability works again", NAV.ok, { run: () => { ownerSet(p, ABILITY_KEYS, false); again(); } });
  set(f, 3 * COLS + 6, hdr(1, "r") + "§c§lSwitch ALL off\n§r§7No mining ability works for anybody", NAV.no, { run: () => {
    if (!isOwner(p)) return miningPage(p, back);
    confirm(p, "Switch ALL abilities off?", ["§7Timber, Area 3x3 / 5x5, Chest Sell,", "§7Auto-Smelt, Vein Miner and Magnet", "§7stop for every player."], () => { ownerSet(p, ABILITY_KEYS, true); again(); }, again);
  } });
  set(f, 4 * COLS + 0, hdr(1) + "§cBack", NAV.back, { run: () => miningPage(p, back) });
  open(p, f);
}
