// Potions category for /shop.  Self-contained: data, prices, delivery and selling live here;
// main.js only draws the pages.  Nothing else in the shop is touched by this file.
//
// Prices (fixed, no Trading discount / sell bonus - so the ranges below always hold):
//   BUY   $999 .. $3,999         SELL   $29 .. $59        (sell is never above 6% of the cheapest buy price)
// Both grow with "power" = effect tier + level bonus (Extended / Level II) + type bonus (Drinkable < Splash < Lingering).
//
// Anti-exploit:
//   * only untouched potions (no name / lore) can be sold, and only the exact potion that was chosen
//   * at most SELL_CAP potions can be sold per player per hour (so brewing farms can not become an income)
//   * the potion is removed first, the money is paid after - and a purchase is charged only for what was delivered
import { econMsg } from "./systems/staffcore.js";   // staff tools: frozen money account
import * as MC from "@minecraft/server";
import { stats, balance, addMoney, takeMoney, addTx } from "./data.js";
import { buyPrice } from "./priceperks.js";
import { saleFx, buyFx } from "./salefx.js";
import { money } from "./format.js";
import { container, isPlain } from "./inv.js";
import { addXp, xpPerUnit } from "./xp.js";
import { luxDing, luxShop } from "./lux.js";
import { limitBlock, stamp } from "./limits.js";
import { shopMsg } from "./systems/shoplang.js";

export const BUY_MIN = 999, BUY_MAX = 3999, SELL_MIN = 29, SELL_MAX = 59;      // medium prices (were 4999..11999 / 99..299)
export const SELL_CAP = 12, SELL_WINDOW = 3600000;            // 12 potions per hour

export const FORMS = [
  { key: "d", label: "Drinkable", short: "Potion", item: "potion", api: "Consume", bonus: 0, color: "§b", desc: "Drink it yourself" },
  { key: "s", label: "Splash", short: "Splash Potion", item: "splash_potion", api: "ThrownSplash", bonus: 0.5, color: "§e", desc: "Throw it - hits everyone nearby" },
  { key: "l", label: "Lingering", short: "Lingering Potion", item: "lingering_potion", api: "ThrownLingering", bonus: 1, color: "§d", desc: "Throw it - leaves an effect cloud" },
];

// variant: [level, label, [accepted effect ids], bedrock data value]
const V = (lv, label, ids, aux) => ({ lv, label, ids, aux });
const BASE = (ids, aux, label = "I") => V("base", label, ids, aux);
const LONG = (ids, aux) => V("long", "Extended", ids, aux);
const STRONG = (ids, aux, label = "II") => V("strong", label, ids, aux);

// [id, name, tier(1-4), liquid colour, variants]
const RAW = [
  ["night_vision", "Night Vision", 1, [60, 70, 220], [BASE(["NightVision"], 5), LONG(["LongNightVision"], 6)]],
  ["invisibility", "Invisibility", 2, [150, 155, 175], [BASE(["Invisibility"], 7), LONG(["LongInvisibility"], 8)]],
  ["leaping", "Leaping", 1, [34, 255, 76], [BASE(["Leaping"], 9), LONG(["LongLeaping"], 10), STRONG(["StrongLeaping"], 11)]],
  ["fire_resistance", "Fire Resistance", 2, [228, 154, 58], [BASE(["FireResistance"], 12), LONG(["LongFireResistance"], 13)]],
  ["swiftness", "Swiftness", 1, [124, 175, 198], [BASE(["Swiftness"], 14), LONG(["LongSwiftness"], 15), STRONG(["StrongSwiftness"], 16)]],
  ["slowness", "Slowness", 1, [100, 120, 150], [BASE(["Slowness"], 17), LONG(["LongSlowness"], 18), STRONG(["StrongSlowness"], 42, "IV")]],
  ["water_breathing", "Water Breathing", 1, [60, 110, 200], [BASE(["WaterBreath", "WaterBreathing"], 19), LONG(["LongWaterBreath", "LongWaterBreathing"], 20)]],
  ["healing", "Healing", 2, [248, 36, 35], [BASE(["Healing"], 21), STRONG(["StrongHealing"], 22)]],
  ["harming", "Harming", 2, [150, 30, 30], [BASE(["Harming"], 23), STRONG(["StrongHarming"], 24)]],
  ["poison", "Poison", 2, [78, 160, 49], [BASE(["Poison"], 25), LONG(["LongPoison"], 26), STRONG(["StrongPoison"], 27)]],
  ["regeneration", "Regeneration", 3, [205, 92, 171], [BASE(["Regeneration"], 28), LONG(["LongRegeneration"], 29), STRONG(["StrongRegeneration"], 30)]],
  ["strength", "Strength", 3, [190, 60, 50], [BASE(["Strength"], 31), LONG(["LongStrength"], 32), STRONG(["StrongStrength"], 33)]],
  ["weakness", "Weakness", 1, [120, 130, 120], [BASE(["Weakness"], 34), LONG(["LongWeakness"], 35)]],
  ["decay", "Decay (Wither)", 4, [95, 75, 65], [BASE(["Wither", "Decay"], 36)]],
  ["turtle_master", "Turtle Master", 3, [118, 100, 160], [BASE(["TurtleMaster"], 37, "IV"), LONG(["LongTurtleMaster"], 38), STRONG(["StrongTurtleMaster"], 39, "VI")]],
  ["slow_falling", "Slow Falling", 2, [243, 207, 185], [BASE(["SlowFalling"], 40), LONG(["LongSlowFalling"], 41)]],
  ["wind_charged", "Wind Charged", 3, [189, 201, 255], [BASE(["WindCharged"], 43)]],
  ["weaving", "Weaving", 3, [140, 120, 130], [BASE(["Weaving"], 44)]],
  ["oozing", "Oozing", 3, [153, 255, 163], [BASE(["Oozing"], 45)]],
  ["infested", "Infested", 3, [150, 165, 150], [BASE(["Infested"], 46)]],
];
export const EFFECTS = RAW.map(([id, name, tier, rgb, variants]) => ({ id, name, tier, rgb, variants }));

const LEVEL_BONUS = { base: 0, long: 0.5, strong: 1 };
const MAX_POWER = 5;                                              // tier 4 + 0 + lingering 1  (also tier 3 + strong 1 + lingering 1)
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** normal { buy, sell } of one potion (effect + type + level) from the formula above.  Always inside the ranges above. */
export function basePotionPrice(eff, form, v) {
  const t = clamp01((eff.tier + LEVEL_BONUS[v.lv] + form.bonus - 1) / (MAX_POWER - 1));
  const buy = Math.max(BUY_MIN, Math.min(BUY_MAX, Math.round((BUY_MIN + (BUY_MAX - BUY_MIN) * t + 1) / 100) * 100 - 1));
  const sell = Math.max(SELL_MIN, Math.min(SELL_MAX, Math.round((SELL_MIN + (SELL_MAX - SELL_MIN) * t - 9) / 10) * 10 + 9));
  return { buy, sell };
}
/** key of one exact potion: used for the admin price (shopadmin.js) and for the purchase limit (limits.js) */
export const potionKey = (eff, form, v) => `pot:${eff.id}:${form.key}:${v.lv}`;
export const POTION_OVERRIDE = new Map();            // potionKey -> { buy, sell }  set by an admin (shopadmin.js).  Nothing here = the formula.
/** { buy, sell } for one potion.  The admin can change both (shopadmin.js); the formula is used otherwise. */
export function potionPrice(eff, form, v, p) {
  const o = POTION_OVERRIDE.get(potionKey(eff, form, v));
  const r = o ? { buy: o.buy, sell: o.sell } : basePotionPrice(eff, form, v);
  return p ? { buy: buyPrice(p, r.buy, r.sell), sell: r.sell } : r;           // p given: this player's price (rank / Trading discount)
}
export const potionName = (eff, form, v) => `${form.short} of ${eff.name}` + (v.lv === "long" ? " (Extended)" : v.label !== "I" ? " " + v.label : "");
export const potionIcon = (eff, form) => `textures/ui/shop/pot_${form.key}_${eff.id}`;
export const cheapest = (eff) => Math.min(...eff.variants.map((v) => potionPrice(eff, FORMS[0], v).buy));
export const ALL_POTIONS = EFFECTS.flatMap((eff) => FORMS.flatMap((form) => eff.variants.map((v) => ({ eff, form, v, key: potionKey(eff, form, v) }))));
export const VARIANT_COUNT = EFFECTS.reduce((n, e) => n + e.variants.length, 0) * FORMS.length;

export const POTIONS_CATEGORY = {
  id: "potions", name: "Potions", icon: potionIcon(EFFECTS[7], FORMS[0]), type: "potion",
  items: EFFECTS.map((e) => [e.id, e.name, potionIcon(e, FORMS[0]), cheapest(e), 0]),
};

// ---------------------------------------------------------------- helpers
const fail = (p, msg) => { p.sendMessage(shopMsg(p, msg)); return false; };
const norm = (s) => String(s ?? "").replace(/^minecraft:/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const isThis = (v, id) => v.ids.some((x) => norm(x) === id);

/** normalised effect id of a potion stack, or null when this game version does not tell us */
function effectOf(s) {
  try {
    const c = s.getComponent("minecraft:potion") ?? s.getComponent("potion");
    if (!c) return null;
    const t = c.potionEffectType;
    const id = norm(t && typeof t === "object" ? t.id : t);
    return id || null;
  } catch (e) { return null; }
}

/** how many untouched potions of exactly this kind the player carries (-1 = this game version can not tell potions apart) */
export function potionOwned(p, eff, form, v) {
  const c = container(p), typeId = "minecraft:" + form.item; let n = 0, unknown = false;
  for (let i = 0; i < c.size; i++) {
    const s = c.getItem(i);
    if (!s || s.typeId !== typeId) continue;
    const e = effectOf(s);
    if (e === null) { unknown = true; continue; }
    if (isThis(v, e) && isPlain(s)) n += s.amount;
  }
  return n === 0 && unknown ? -1 : n;
}

// ---------------------------------------------------------------- selling limit
function capState(p) {
  const s = stats(p), now = Date.now();
  if (!s.pot || typeof s.pot.t !== "number") s.pot = { t: now, n: 0 };
  if (now - s.pot.t >= SELL_WINDOW) { s.pot.t = now; s.pot.n = 0; }
  return s.pot;
}
export const sellLeft = (p) => Math.max(0, SELL_CAP - capState(p).n);
export const sellResetIn = (p) => { const c = capState(p); return c.n > 0 ? Math.max(0, c.t + SELL_WINDOW - Date.now()) : 0; };

// ---------------------------------------------------------------- buying
function makeStack(form, v) {
  try {
    const P = MC.Potions;                                         // exact way (only exists in newer script API versions)
    if (P && typeof P.resolve === "function") {
      for (const id of v.ids) {
        try { const s = P.resolve(id, form.api); if (s && s.typeId === "minecraft:" + form.item) return s; } catch (e) { /* try next id */ }
      }
    }
  } catch (e) { /* fall back to the give command */ }
  return null;
}
function deliverOne(p, form, v) {
  const s = makeStack(form, v);
  if (s) { try { return !container(p).addItem(s); } catch (e) { return false; } }
  try { return p.runCommand(`give @s ${form.item} 1 ${v.aux}`).successCount > 0; } catch (e) { return false; }
}

export function buyPotion(p, eff, form, v, qty) {
  { const em = econMsg(p); if (em) return fail(p, em); }
  const name = potionName(eff, form, v), unit = potionPrice(eff, form, v, p).buy, total = unit * qty, key = potionKey(eff, form, v);
  { const lb = limitBlock(p, key, name, qty); if (lb) return fail(p, lb); }
  if (balance(p) < total) return fail(p, `§c[Shop] Not enough money. Need §f${money(total)}§c, you have §f${money(balance(p))}§c.`);
  if (container(p).emptySlotsCount < qty) return fail(p, `§c[Shop] Not enough free inventory slots (${qty} needed - potions do not stack).`);
  let n = 0;
  for (let i = 0; i < qty; i++) { if (deliverOne(p, form, v)) n++; else break; }
  if (n < 1) return fail(p, `§c[Shop] ${name} could not be delivered in this game version. You were not charged.`);
  const cost = unit * n; takeMoney(p, cost); stamp(p, key, n);       // deliver first, charge only for what arrived
  addTx(p, { type: "buy", id: form.item, name, qty: n, total: cost, icon: potionIcon(eff, form) });
  buyFx(p, cost); p.sendMessage(shopMsg(p, `§c+${n} ${name} (-${money(cost)})` + (n < qty ? " §7(only " + n + " could be delivered)" : "")));
  addXp(p, "b", n * xpPerUnit(unit));
  luxDing(p); luxShop(p);
  return true;
}

// ---------------------------------------------------------------- selling
export function sellPotion(p, eff, form, v, qty) {
  { const em = econMsg(p); if (em) return fail(p, em); }
  const name = potionName(eff, form, v), unit = potionPrice(eff, form, v).sell;
  if (unit < 1) return fail(p, `§c[Shop] ${name} can not be sold.`);
  const left = sellLeft(p);
  if (left <= 0) return fail(p, `§c[Shop] Potion sell limit reached (${SELL_CAP} per hour). Try again later.`);
  const have = potionOwned(p, eff, form, v);
  if (have < 0) return fail(p, "§c[Shop] This game version can not tell potions apart, so potions can not be sold here.");
  if (have < 1) return fail(p, `§c[Shop] You do not have an unmodified ${name}.`);
  qty = Math.min(qty, have, left);
  const c = container(p), typeId = "minecraft:" + form.item; let rest = qty;
  for (let i = 0; i < c.size && rest > 0; i++) {
    const s = c.getItem(i);
    if (!s || s.typeId !== typeId || !isPlain(s)) continue;
    const e = effectOf(s); if (e === null || !isThis(v, e)) continue;
    const take = Math.min(rest, s.amount);
    if (take === s.amount) c.setItem(i, undefined); else { s.amount -= take; c.setItem(i, s); }
    rest -= take;
  }
  const sold = qty - rest;
  if (sold < 1) return fail(p, "§c[Shop] Nothing was sold (the items changed).");
  const total = unit * sold, cap = capState(p);
  if (cap.n === 0) cap.t = Date.now();
  cap.n += sold;
  addMoney(p, total); saleFx(p, total);
  addTx(p, { type: "sell", id: form.item, name, qty: sold, total, icon: potionIcon(eff, form) });
  p.sendMessage(shopMsg(p, `§a-${sold} ${name} (+${money(total)}) §8(${Math.max(0, SELL_CAP - cap.n)} left)`));
  addXp(p, "s", sold * xpPerUnit(unit));
  luxDing(p); luxShop(p);
  return true;
}
