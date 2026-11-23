import { stats, addMoney, takeMoney, takeShards, balance, addTx } from "./data.js";
import { money, num, countdown } from "./format.js";
import { container, isPlain, countPlain, spaceFor, removePlain, give } from "./inv.js";
import { addXp, xpPerUnit } from "./xp.js";
import { hasLimit, stamp, limitBlock } from "./limits.js";
import { SPAWNER_SHARDS, SPAWNER_MONEY, EGG_SHARDS, EGG_MONEY } from "./shards.js";
import { buyPrice, sellCommit, noBonusAdd } from "./priceperks.js";
import { econMsg, shopBlocked } from "./systems/staffcore.js";   // staff tools: frozen money account / shop item switched off
import { luxShop, luxDing } from "./lux.js";
import { saleFx, buyFx } from "./salefx.js";
import { PRICES, shardsOf } from "./spawner_data.js";
import { SPAWNERS } from "./mobs.js";
import { adminLoad, SP_SHARDS } from "./shopadmin.js";
import { shopMsg } from "./systems/shoplang.js";

const fail = (p, msg) => { p.sendMessage(shopMsg(p, msg)); return false; };
const ok = (p) => { luxDing(p); luxShop(p); return true; };

function limitCheck(p, key, label, qty = 1) {        // limits.js: "count units every N hours" for every shop entry
  adminLoad();
  const msg = limitBlock(p, key, label, qty);
  return msg ? fail(p, msg) : true;
}

// ---------------------------------------------------------------- money shop
export function buy(p, it, qty) {
  const [id, name, , price, sellPrice] = it;
  { const em = econMsg(p); if (em) return fail(p, em); }
  if (shopBlocked(id)) return fail(p, `§c[Shop] ${name} is temporarily unavailable.`);
  if (!limitCheck(p, id, name, qty)) return false;
  const unit = buyPrice(p, price, sellPrice), total = unit * qty, space = spaceFor(p, id, name);
  if (space < 0) return fail(p, `§c[Shop] "${name}" is not available in this game version (id: ${id}).`);
  if (balance(p) < total) return fail(p, `§c[Shop] Not enough money. Need §f${money(total)}§c, you have §f${money(balance(p))}§c.`);
  if (space < qty) return fail(p, `§c[Shop] Not enough inventory space for ${qty}x ${name}.`);
  if (!give(p, id, qty, name)) return fail(p, `§c[Shop] Could not deliver ${qty}x ${name}. You were not charged.`);      // deliver first, charge only if it worked
  takeMoney(p, total); stamp(p, id, qty); noBonusAdd(p, id, qty);
  addTx(p, { type: "buy", id, name, qty, total });
  buyFx(p, total); p.sendMessage(shopMsg(p, `§c+${num(qty)} ${name} (-${money(total)})` + (unit < price ? ` §8(saved ${money(price * qty - total)})` : "")));
  addXp(p, "b", qty * xpPerUnit(price));
  return ok(p);
}
export function sell(p, it, qty) {
  const [id, name, , price, sellPrice] = it;
  { const em = econMsg(p); if (em) return fail(p, em); }
  if (shopBlocked(id)) return fail(p, `§c[Shop] ${name} is temporarily unavailable.`);
  if (sellPrice <= 0) return fail(p, `§c[Shop] ${name} cannot be sold.`);
  const have = countPlain(p, id);
  if (have < qty) return fail(p, `§c[Shop] You only have ${have}x ${name} (unmodified).`);
  removePlain(p, id, qty); const { total, bonus } = sellCommit(p, id, sellPrice, qty); addMoney(p, total); saleFx(p, total);
  addTx(p, { type: "sell", id, name, qty, total, src: "shop", bonus, unit: sellPrice });
  p.sendMessage(shopMsg(p, `§a-${num(qty)} ${name} (+${money(total)})` + (bonus > 0 ? ` §8(+${money(bonus)} bonus)` : "")));
  addXp(p, "s", qty * xpPerUnit(price));
  return ok(p);
}
/** sells exactly what the player moved into the sell box (partial stacks allowed).
 *  picks = [{slot, typeId, amount}]   infoOf(stack) -> { it, unit, up } | null  (price is re-checked on the REAL stack) */
export function sellStacks(p, picks, infoOf, src = "sellbox") {
  { const em = econMsg(p); if (em) { p.sendMessage(shopMsg(p, em)); return 0; } }
  const c = container(p), sold = {};
  let bonusTotal = 0;
  for (const x of picks) {
    const s = c.getItem(x.slot);
    if (!s || s.typeId !== x.typeId || s.amount < x.amount || x.amount < 1) continue;
    const info = infoOf(s); if (!info) continue;
    if (shopBlocked(info.it[0])) continue;
    const qty = x.amount, plan = sellCommit(p, info.it[0], info.unit, qty), t = plan.total; bonusTotal += plan.bonus;
    if (s.amount === qty) c.setItem(x.slot, undefined); else { s.amount -= qty; c.setItem(x.slot, s); }
    const k = info.it[0] + (info.up ? "+" : "");
    sold[k] ??= { it: info.it, up: info.up, unit: info.unit, qty: 0, total: 0, bonus: 0 }; sold[k].qty += qty; sold[k].total += t; sold[k].bonus += plan.bonus;
  }
  let total = 0, n = 0, xp = 0;
  for (const k in sold) {
    const { it, up, qty, total: t, bonus: bn, unit } = sold[k]; total += t; n += qty; xp += qty * xpPerUnit(it[3]);
    addTx(p, { type: "sell", id: it[0], name: it[1] + (up ? " (enchanted)" : ""), qty, total: t, src, bonus: bn, unit });
  }
  if (total > 0) { addMoney(p, total); saleFx(p, total); const ks = Object.keys(sold), one = ks.length === 1 ? sold[ks[0]] : null; p.sendMessage(shopMsg(p, `§a-${num(n)} ${one ? one.it[1] + (one.up ? " (enchanted)" : "") : "Items"} (+${money(total)})` + (bonusTotal > 0 ? ` §8(+${money(bonusTotal)} bonus)` : ""))); addXp(p, "s", xp); ok(p); }
  else p.sendMessage(shopMsg(p, "§7[Shop] Nothing was sold (the items changed)."));
  return total;
}

// ---------------------------------------------------------------- shard shop
export function buyShardItem(p, e) {      // e = { id, name, qty, shards }
  { const em = econMsg(p); if (em) return fail(p, em); }
  if (!limitCheck(p, e.id, e.name, 1)) return false;           // a shard pack counts as ONE purchase
  const space = spaceFor(p, e.id, e.name);
  if (space < 0) return fail(p, `§c[Shards] "${e.name}" is not available in this game version.`);
  if (stats(p).shards < e.shards) return fail(p, `§c[Shards] Not enough shards. Need §d${num(e.shards)}§c, you have §d${num(stats(p).shards)}§c.`);
  if (space < e.qty) return fail(p, "§c[Shards] Not enough inventory space.");
  if (!give(p, e.id, e.qty, e.name)) return fail(p, `§c[Shards] Could not deliver ${e.name}. You were not charged.`);
  takeShards(p, e.shards); stamp(p, e.id); noBonusAdd(p, e.id, e.qty);
  addTx(p, { type: "buy", id: e.id, name: e.name, qty: e.qty, total: e.shards, cur: "shards" });
  p.sendMessage(shopMsg(p, `§c+${num(e.qty)} ${e.name} (-${num(e.shards)} shards)`));
  return ok(p);
}
// stacked spawners: every mob has its own price (spawner_data.js).  mob = null -> the cheapest one (used for the "from ..." texts)
const spawnerMoney = (mob) => (mob ? PRICES[mob.id] ?? SPAWNER_MONEY : Math.min(...Object.values(PRICES)));
const spawnerShards = (mob) => SP_SHARDS[mob.id] ?? shardsOf(spawnerMoney(mob));      // an admin can set the shards price by hand (shopadmin.js)
export const specialPrice = (kind, cur, mob, p) => {
  adminLoad();
  const base = kind === "spawner" ? (cur === "shards" ? (mob ? spawnerShards(mob) : Math.min(...SPAWNERS.map(spawnerShards))) : spawnerMoney(mob)) : (cur === "shards" ? mob.shards : mob.money);
  return cur === "money" && p ? buyPrice(p, base, 0) : base;        // only money prices get the Trading discount
};
export const specialKey = (kind, mob) => (kind === "spawner" ? "spawner" : mob?.key ?? "spawn_egg");   // an egg can have its own limit (villager)

/** kind: "spawner" | "egg"   cur: "shards" | "money" */
export function buySpecial(p, kind, mob, cur) {
  { const em = econMsg(p); if (em) return fail(p, em); }
  const key = specialKey(kind, mob), price = specialPrice(kind, cur, mob, p);
  const label = kind === "spawner" ? `${mob.name} Spawner` : `${mob.name} Spawn Egg`;
  if (!limitCheck(p, key, kind === "spawner" ? "Spawners" : "Spawn eggs")) return false;
  const have = cur === "shards" ? stats(p).shards : balance(p);
  if (have < price) return fail(p, `§c[Shop] Not enough ${cur}. Need §f${num(price)}§c.`);
  if (container(p).emptySlotsCount < 1) return fail(p, "§c[Shop] Your inventory is full - free a slot first.");
  // deliver first, charge only if delivery worked
  let delivered = false;
  if (kind === "egg") delivered = spaceFor(p, `${mob.id}_spawn_egg`) >= 1 && give(p, `${mob.id}_spawn_egg`, 1);
  else {
    try { delivered = p.runCommand(`give @s smp:spawner_${mob.id} 1`).successCount > 0; } catch (e) { delivered = false; }
  }
  if (!delivered) return fail(p, `§c[Shop] ${label} could not be delivered in this game version. You were not charged.`);
  if (cur === "shards") takeShards(p, price); else takeMoney(p, price);
  stamp(p, key);
  addTx(p, { type: "buy", id: kind === "egg" ? `${mob.id}_spawn_egg` : "mob_spawner", name: label, qty: 1, total: price, cur: cur === "shards" ? "shards" : undefined });
  if (cur !== "shards") buyFx(p, price);
  p.sendMessage(shopMsg(p, `§c+1 ${label} (-${cur === "shards" ? num(price) + " shards" : money(price)})`));
  return ok(p);
}
