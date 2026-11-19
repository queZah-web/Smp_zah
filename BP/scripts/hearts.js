// Heart Shop: players buy PERMANENT extra hearts in /shop (money).  An extra heart looks exactly like a normal heart (second row above the normal ones).
//
// Units: everything inside this file is counted in HALF hearts (1 half heart = 1 HP).  A Heart item = 2 units, a Half Heart item = 1 unit.
//
// How it works
//   * BP/entities/player.json has the events  smp:hearts_clear  and  smp:hearts_0 ... smp:hearts_200.  Event L gives the player 20 + L max health.
//   * The player's active hearts are saved in one world property per player ("smp_h:<id>", field n = half hearts).
//   * A Heart (or Half Heart) is a normal item: right-click = use it.  It is NOT bound to anybody - whoever picks it up can use it.
//   * A Heart that lies on the ground goes bad (heartfx.js): picked up in its dark form it becomes a HALF Heart.  A Half Heart can be repaired into a
//     full Heart with 1 Enchanted Golden Apple (right-click it), and a player who used a half heart can restore the missing half in the shop page.
//   * Hearts are never lost: death, relog and respawn re-apply them (playerSpawn + a light check every 5 seconds).
//
// Rules against cheating (all enforced here, on the server)
//   * price of the next heart = base price + step * hearts you already own (active + the ones in your inventory)
//   * max hearts per player (default 10, an admin can raise it to 100); cooldown between purchases (default none)
//   * hearts can't be used while in combat or inside a duel (the combat tag)
//   * the sale can be paused / closed by an admin at any time; closing the sale does NOT take back hearts that were already bought
//   * new players are protected: for the first N hours (default 24, admins can change it or switch it off) after they first joined they can't buy hearts
//   * no Trading-level discount and no other discount applies to hearts
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { stats, takeMoney, addTx, knownPlayers } from "./data.js";
import { econMsg } from "./systems/staffcore.js";
import { combatLeft } from "./systems/combat.js";
import { container } from "./inv.js";
import { buyFx } from "./salefx.js";
import { HEART_ITEM, HALF_ITEM, CURSED_ITEM, REPAIR_ITEM, isHeart, unitsOfItem, makeHeartStack, makeHalfStack, tagBuyer, copyBuyer, buyerOf, needsLoreTag } from "./heartids.js";
import { logLoss, dimCodeOf, KIND_DESTROYED, KIND_HALVED, KIND_REPAIRED } from "./heartloss.js";
import { logHeartBuy } from "./heartlog.js";
import { syncHeartPickups } from "./heartpickup.js";
import { logHeartUse } from "./heartuse.js";
import { useBurst, buyTotem } from "./heartfx.js";
import { shopMsg } from "./systems/shoplang.js";
export { HEART_ITEM };

export const HARD_MAX = 100;                                  // hearts (the player.json events go up to 2 * HARD_MAX half hearts)
export const LIMITS = { money: 100000000, step: 100000000, hours: 720 };
const CFG_KEY = "smp_hearts_cfg", REC_KEY = "smp_h:", REC_VER = 2;
const DEFAULTS = { price: 500000, step: 250000, max: 10, cd: 0, st: "on", until: 0, np: 24, npOn: true, cdFx: true };
const fmt = (n) => "$" + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || 0));
/** half hearts -> text in hearts: 5 -> "2.5" */
export const heartsTxt = (units) => String(units / 2);

// ------------------------------------------------------------------ settings (admin)
let cfg = null;
export function heartsCfg() {
  if (cfg) return cfg;
  let saved = {};
  try { const raw = world.getDynamicProperty(CFG_KEY); if (typeof raw === "string") saved = JSON.parse(raw); } catch (e) { saved = {}; }
  cfg = { ...DEFAULTS, ...saved };
  cfg.price = clamp(cfg.price, 1, LIMITS.money); cfg.step = clamp(cfg.step, 0, LIMITS.step);
  cfg.max = clamp(cfg.max, 1, HARD_MAX); cfg.cd = clamp(cfg.cd, 0, LIMITS.hours);
  cfg.np = clamp(cfg.np, 0, LIMITS.hours); cfg.npOn = cfg.npOn !== false; cfg.cdFx = cfg.cdFx !== false;
  if (!["on", "paused", "off"].includes(cfg.st)) cfg.st = "on";
  return cfg;
}
function saveCfg() { try { world.setDynamicProperty(CFG_KEY, JSON.stringify(cfg)); } catch (e) { console.warn("[hearts] cannot save settings: " + e); } }
/** "on" | "paused" | "off" - a pause with a timer ends by itself */
export function heartsStatus() {
  const c = heartsCfg();
  if (c.st === "paused" && c.until > 0 && Date.now() >= c.until) { c.st = "on"; c.until = 0; saveCfg(); }
  return c.st;
}
export const pauseLeftMs = () => { const c = heartsCfg(); return c.st === "paused" && c.until > 0 ? Math.max(0, c.until - Date.now()) : 0; };
export function setHeartsPrice(price, step) {
  const c = heartsCfg();
  if (!Number.isFinite(price) || price < 1 || price > LIMITS.money) return "The price must be a whole number from 1 to " + LIMITS.money + ".";
  if (!Number.isFinite(step) || step < 0 || step > LIMITS.step) return "The step must be a whole number from 0 to " + LIMITS.step + ".";
  c.price = Math.floor(price); c.step = Math.floor(step); saveCfg(); return null;
}
export function setHeartsRules(max, cdHours) {
  const c = heartsCfg();
  if (!Number.isFinite(max) || max < 1 || max > HARD_MAX) return "Max hearts must be from 1 to " + HARD_MAX + ".";
  if (!Number.isFinite(cdHours) || cdHours < 0 || cdHours > LIMITS.hours) return "The cooldown must be from 0 to " + LIMITS.hours + " hours.";
  c.max = Math.floor(max); c.cd = Math.floor(cdHours); saveCfg(); return null;
}
/** st: "on" | "paused" | "off"   hours: pause length (0 = until an admin opens the sale again) */
export function setHeartsStatus(st, hours = 0) {
  const c = heartsCfg();
  if (!["on", "paused", "off"].includes(st)) return "Unknown status.";
  c.st = st; c.until = st === "paused" && hours > 0 ? Date.now() + clamp(hours, 1, LIMITS.hours) * 3600000 : 0; saveCfg(); return null;
}
/** the opening countdown (last 10 seconds on the screen): on / off */
export function setHeartsCountdown(on) { const c = heartsCfg(); c.cdFx = !!on; saveCfg(); }
/** new player protection: on = enforced, hours = how long after the first join (1 to 720) */
export function setHeartsProtection(on, hours) {
  const c = heartsCfg();
  if (!Number.isFinite(hours) || hours < 1 || hours > LIMITS.hours) return "The protection time must be from 1 to " + LIMITS.hours + " hours.";
  c.npOn = !!on; c.np = Math.floor(hours); saveCfg(); return null;
}
/** ms until this player may buy hearts (0 = he can).  Players whose record has no first-join time (they joined before the pack saved it) are not new. */
export function protectionLeftMs(p) {
  const c = heartsCfg(); if (!c.npOn || c.np < 1) return 0;
  const joined = Number(stats(p).joined); if (!(joined > 0)) return 0;
  return Math.max(0, joined + c.np * 3600000 - Date.now());
}
/** 90000000 -> "1d 1h" / "5h 12m" / "40m" */
export function leftText(ms) {
  const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + mm + "m" : mm + "m";
}
const capUnits = () => heartsCfg().max * 2;

// ------------------------------------------------------------------ record of every player (online or offline): n = active half hearts
const recs = new Map();
export function heartsRec(id, name) {
  let r = recs.get(id);
  if (!r) {
    let saved = null;
    try { const raw = world.getDynamicProperty(REC_KEY + id); if (typeof raw === "string") saved = JSON.parse(raw); } catch (e) { saved = null; }
    const old = saved && saved.v !== REC_VER;                                  // the first version counted whole hearts
    r = { v: REC_VER, n: clamp((saved?.n ?? 0) * (old ? 2 : 1), 0, HARD_MAX * 2), t: Number(saved?.t) || 0, nm: saved?.nm ?? name ?? "?" };
    recs.set(id, r);
    if (old) saveRec(id);
  }
  if (name && r.nm !== name) r.nm = name;
  return r;
}
function saveRec(id) {
  const r = recs.get(id); if (!r) return;
  try { world.setDynamicProperty(REC_KEY + id, r.n === 0 && !r.t ? undefined : JSON.stringify(r)); } catch (e) { console.warn("[hearts] cannot save " + id + ": " + e); }
}
export const heartsOf = (p) => heartsRec(p.id, p.name);

/** half hearts in the player's inventory (Heart = 2, Half Heart = 1; a cursed one counts as a Half Heart: it turns into one when picked up) */
export function heldUnits(p) {
  let n = 0; const c = container(p);
  for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s && isHeart(s.typeId)) n += unitsOfItem(s.typeId) * s.amount; }
  return n;
}
export const ownedUnits = (p) => heartsOf(p).n + heldUnits(p);
export const nextPrice = (p) => { const c = heartsCfg(); return Math.min(LIMITS.money, Math.floor(c.price + c.step * (ownedUnits(p) / 2))); };

// ------------------------------------------------------------------ the extra health itself
const applied = new Map();                   // player id -> the level that was applied in this session
function health(p) { try { return p.getComponent("minecraft:health"); } catch (e) { return null; } }
/** put the player on level n (n extra half hearts).  heal: "keep" = same health as before | a number = that much more health | "full" */
export function applyHearts(p, n, heal = "keep") {
  n = clamp(n, 0, HARD_MAX * 2);
  const h = health(p), before = h ? h.currentValue : 20;
  // level 0 is a normal 20 HP group, so the player is never left without a health component
  try { p.triggerEvent("smp:hearts_clear"); p.triggerEvent("smp:hearts_" + n); } catch (e) { console.warn("[hearts] event smp:hearts_" + n + " failed: " + e); return; }
  applied.set(p.id, n);
  system.runTimeout(() => {
    try {
      const h2 = health(p); if (!h2) return;
      if (heal === "full") h2.resetToMaxValue();
      else h2.setCurrentValue(Math.max(1, Math.min(h2.effectiveMax, typeof heal === "number" ? before + heal : before)));
    } catch (e) { /* ignore */ }
  }, 2);
}
const byId = (id) => { for (const p of world.getAllPlayers()) if (p.id === id) return p; return null; };

// every 5 seconds: is every online player on the level of his record?  (a respawn / relog could have reset it)
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const r = heartsOf(p), want = Math.min(r.n, HARD_MAX * 2), h = health(p);
      const low = h && want > 0 && h.effectiveMax < 20 + want - 0.01;
      if (applied.get(p.id) !== want || low) applyHearts(p, want, "keep");
    } catch (e) { /* ignore */ }
  }
}, 100);
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    applied.delete(player.id);
    system.runTimeout(() => { try { const r = heartsOf(player); applyHearts(player, r.n, initialSpawn ? "keep" : "full"); } catch (e) { /* ignore */ } }, initialSpawn ? 40 : 5);
  });
  world.afterEvents.playerLeave.subscribe((ev) => { applied.delete(ev.playerId); recs.delete(ev.playerId); });
} catch (e) { console.warn("[hearts] events: " + e); }

// Hearts bought before the invisible lore code existed (see heartids.js) only have the item property, which is lost on the ground: while the owner
// holds them they get the lore code too (once per Heart stack, every 2 seconds).
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const c = container(p);
      for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i); if (!s || !isHeart(s.typeId) || !needsLoreTag(s)) continue;
        const t = buyerOf(s); if (!t) continue;
        c.setItem(i, tagBuyer(s, t.id, t.name));
      }
    } catch (e) { /* ignore */ }
  }
}, 40);

// ------------------------------------------------------------------ opening countdown (like The End event): the last 10 seconds of
//   * a temporary PAUSE of the sale (all players see it)           * the cooldown between two purchases of a player (only that player sees it)
// are shown on the screen: a big number, a "pling" that gets higher, and "the sale is open" / "you can buy again" at the end.  Admins can switch it off.
const FINAL = 10;
let globalLast = 0; const playerLast = new Map();
function bigTitle(p, text, sub, stay, pitch, sound = "note.pling") {
  try { p.onScreenDisplay.setTitle(text, { stayDuration: stay, fadeInDuration: 2, fadeOutDuration: 6, subtitle: sub }); } catch (e) { /* ignore */ }
  try { p.playSound(sound, { volume: 1, pitch }); } catch (e) { /* ignore */ }
}
system.runInterval(() => {
  try {
    const c = heartsCfg(), now = Date.now(), wasPaused = c.st === "paused";
    heartsStatus();                                                                  // a pause that ended opens the sale here (also when nobody looks at the shop)
    const players = world.getAllPlayers();
    if (c.cdFx) {
      if (c.st === "paused" && c.until > 0) {
        const sec = Math.ceil((c.until - now) / 1000);
        if (sec >= 1 && sec <= FINAL && sec !== globalLast) { globalLast = sec; for (const p of players) bigTitle(p, "§c§l" + sec, "§7The Heart sale opens in", 14, 0.8 + (FINAL - sec) * 0.08); }
      } else if (wasPaused && c.st === "on") {
        globalLast = 0; for (const p of players) bigTitle(p, "§a§lHEART SALE IS OPEN", "§7You can buy Hearts now: /shop", 60, 1.6, "random.levelup");
      }
    }
    if (c.st !== "paused") globalLast = 0;
    for (const p of players) {
      try {
        const r = heartsOf(p), left = c.cdFx && c.cd > 0 && r.t ? r.t + c.cd * 3600000 - now : 0, sec = Math.ceil(left / 1000), last = playerLast.get(p.id);
        if (sec >= 1 && sec <= FINAL) {
          if (last !== sec) { playerLast.set(p.id, sec); bigTitle(p, "§c§l" + sec, "§7You can buy a Heart again in", 14, 0.8 + (FINAL - sec) * 0.08); }
        } else if (last != null) {
          playerLast.delete(p.id);
          if (left <= 0 && last === 1 && c.cdFx) bigTitle(p, "§a§lHEART READY", "§7You can buy a Heart again: /shop", 50, 1.6, "random.levelup");
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}, 4);
try { world.afterEvents.playerLeave.subscribe((ev) => { playerLast.delete(ev.playerId); }); } catch (e) { /* ignore */ }

// ------------------------------------------------------------------ inventory helpers
function giveStack(p, stack) {                    // false = no room (nothing was given)
  const c = container(p);
  if (c.emptySlotsCount < 1) {
    let room = 0; for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s && s.typeId === stack.typeId) room += s.maxAmount - s.amount; }
    if (room < stack.amount) return false;
  }
  try { return !c.addItem(stack); } catch (e) { return false; }
}
function takeOne(p, typeId) {                     // removes one item of this type from the inventory
  const c = container(p);
  for (let i = 0; i < c.size; i++) {
    const s = c.getItem(i); if (!s || s.typeId !== typeId) continue;
    if (s.amount > 1) { s.amount -= 1; c.setItem(i, s); } else c.setItem(i, undefined);
    return true;
  }
  return false;
}
export const countItem = (p, typeId) => { let n = 0; const c = container(p); for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s && s.typeId === typeId) n += s.amount; } return n; };
/** removes `units` half hearts worth of Heart items from the inventory (Half Hearts first); returns how many units were removed */
function takeUnits(p, units, by) {
  let left = units; const c = container(p);
  const note = (kind, type, amount, tag) => {            // heart loss log: an admin removed Hearts from this player's inventory
    try { if (tag && amount > 0) logLoss({ kind, type, amount, cause: "admin", bid: tag.id, bnm: tag.name, loc: p.location, dim: dimCodeOf(p.dimension), hid: p.id, hnm: p.name, note: by }); } catch (e) { /* ignore */ }
  };
  for (const [type, per] of [[HALF_ITEM, 1], [CURSED_ITEM, 1], [HEART_ITEM, 2]]) {
    for (let i = 0; i < c.size && left > 0; i++) {
      const s = c.getItem(i); if (!s || s.typeId !== type) continue;
      const k = Math.min(s.amount, Math.ceil(left / per)), tag = buyerOf(s);
      if (s.amount === k) c.setItem(i, undefined); else { s.amount -= k; c.setItem(i, s); }
      left -= k * per;
      let halved = 0;
      if (left < 0) { if (giveStack(p, copyBuyer(s, makeHalfStack(-left)))) halved = -left; left = 0; }       // a full Heart was removed for 1 unit: the other half stays as a Half Heart
      note(KIND_DESTROYED, type, k - halved, tag);
      note(KIND_HALVED, type, halved, tag);
    }
  }
  return units - left;
}

// ------------------------------------------------------------------ buying
/** why this player can't buy now (null = he can) */
export function buyBlock(p) {
  const c = heartsCfg(), r = heartsOf(p), st = heartsStatus();
  if (st === "off") return "The heart sale is closed.";
  if (st === "paused") { const left = pauseLeftMs(); return "The heart sale is paused" + (left > 0 ? " (back in " + Math.ceil(left / 60000) + " min)." : "."); }
  { const left = protectionLeftMs(p); if (left > 0) return "New player protection: you can buy hearts in " + leftText(left) + "."; }
  if (r.n + heldUnits(p) + 2 > capUnits()) return "You own the maximum of " + c.max + " extra hearts.";
  if (c.cd > 0 && r.t) { const left = r.t + c.cd * 3600000 - Date.now(); if (left > 0) return "Next heart in " + Math.ceil(left / 60000) + " min."; }
  return null;
}
export function buyHeart(p) {
  const fail = (m) => { p.sendMessage(shopMsg(p, "§c[Hearts] " + m)); return false; };
  { const em = econMsg(p); if (em) { p.sendMessage(shopMsg(p, em)); return false; } }
  const block = buyBlock(p); if (block) return fail(block);
  const r = heartsOf(p), price = nextPrice(p), s = stats(p);
  if (s.money < price) return fail("Not enough money. Need §f" + fmt(price) + "§c, you have §f" + fmt(s.money) + "§c.");
  if (!giveStack(p, tagBuyer(makeHeartStack(1), p.id, p.name))) return fail("Your inventory is full - free a slot first. You were not charged.");
  if (!takeMoney(p, price)) { takeOne(p, HEART_ITEM); return fail("Not enough money."); }        // money was checked above; this is only a safety net
  r.t = Date.now(); saveRec(p.id);
  try { logHeartBuy(p.id, p.name, price); } catch (e) { console.warn("[hearts] purchase log: " + e); }       // before addTx: the first run copies the old history from the transactions
  addTx(p, { type: "buy", id: HEART_ITEM, name: "Heart", qty: 1, total: price });
  try { syncHeartPickups(p); } catch (e) { /* ignore */ }                       // a purchase is not a pickup
  try { buyFx(p, price); } catch (e) { /* ignore */ }
  try { buyTotem(p); } catch (e) { /* ignore */ }                               // totem of undying particles + sound
  p.sendMessage(shopMsg(p, "§c+1 Heart §7(-" + fmt(price) + ")§a  Right-click the Heart in your inventory to use it."));
  return true;
}

// ------------------------------------------------------------------ using
const busy = new Set();
function addUnits(p, r, units, used) {            // active hearts +units (checked before).  used = { typeId, tag } of the Heart item that was used (Heart use log); none = no item (restore in the shop page)
  r.n += units; saveRec(p.id);
  if (used) logHeartUse(p, used.typeId, units, used.tag, r.n);
  applyHearts(p, r.n, units);
  useBurst(p);
  try { p.playSound("random.levelup", { volume: 0.7, pitch: units === 1 ? 1.1 : 1.4 }); } catch (e) { /* ignore */ }
  p.sendMessage(shopMsg(p, (units === 1 ? "§c+½ Heart! " : "§c+1 Heart! ") + "§7You now have §f" + heartsTxt(r.n) + "§7 extra heart" + (r.n > 2 ? "s" : "") + " (permanent)."));
}
function useHeart(p) {
  if (busy.has(p.id)) return; busy.add(p.id);
  system.run(() => {
    let reopen = null;
    try {
      const say = (m) => p.sendMessage(shopMsg(p, "§c[Hearts] " + m));
      const c = container(p), slot = p.selectedSlotIndex, st = c.getItem(slot);
      if (!st || !isHeart(st.typeId)) return;                              // already used (double click)
      if (st.typeId === CURSED_ITEM) {
        const tg = buyerOf(st), amount = st.amount;
        c.setItem(slot, copyBuyer(st, makeHalfStack(st.amount)));
        if (tg) logLoss({ kind: KIND_HALVED, type: CURSED_ITEM, amount, cause: "use", bid: tg.id, bnm: tg.name, loc: p.location, dim: dimCodeOf(p.dimension), hid: p.id, hnm: p.name });       // loss log: a full Heart became a Half Heart
        return say("The dark Heart broke: it is a Half Heart now.");
      }
      const r = heartsOf(p), units = unitsOfItem(st.typeId);
      if (st.typeId === HALF_ITEM) { reopen = () => halfMenu(p); return; }   // a Half Heart: use it or repair it (menu below)
      if (r.n + units > capUnits()) return say("You already have the maximum of §f" + heartsTxt(r.n) + "§c extra hearts. Keep the Heart for later.");
      if (combatLeft(p) > 0) return say("You can't use a Heart while in combat.");
      const used = { typeId: st.typeId, tag: buyerOf(st) };                 // the hidden buyer tag of the Heart that is being used (read before it is consumed)
      if (st.amount > 1) { st.amount -= 1; c.setItem(slot, st); } else c.setItem(slot, undefined);       // consume first, then give
      addUnits(p, r, units, used);
    } catch (e) { console.warn("[hearts] use failed: " + e); } finally { busy.delete(p.id); if (reopen) reopen(); }
  });
}
/** right-click on a Half Heart: use it (+1 HP) or repair it into a full Heart with 1 Enchanted Golden Apple */
function halfMenu(p) {
  const apples = countItem(p, REPAIR_ITEM);
  const f = new ActionFormData().title("Half Heart")
    .body("§7A Half Heart gives §f½ heart§7.\n§7To restore the missing half, repair it with §f1 Enchanted Golden Apple§7 (you have §f" + apples + "§7) and you get a full Heart.")
    .button("Use it (+½ heart)").button(apples > 0 ? "Repair with an Enchanted Golden Apple" : "§8Repair (needs an Enchanted Golden Apple)");
  f.show(p).then((res) => {
    if (res.canceled) return;
    system.run(() => {
      try {
        const c = container(p), st = c.getItem(p.selectedSlotIndex), r = heartsOf(p);
        if (!st || st.typeId !== HALF_ITEM) return;
        if (res.selection === 0) {
          if (r.n + 1 > capUnits()) return p.sendMessage(shopMsg(p, "§c[Hearts] You already have the maximum of §f" + heartsTxt(r.n) + "§c extra hearts."));
          if (combatLeft(p) > 0) return p.sendMessage(shopMsg(p, "§c[Hearts] You can't use a Heart while in combat."));
          const used = { typeId: st.typeId, tag: buyerOf(st) };
          if (st.amount > 1) { st.amount -= 1; c.setItem(p.selectedSlotIndex, st); } else c.setItem(p.selectedSlotIndex, undefined);
          addUnits(p, r, 1, used);
        } else {
          if (!takeOne(p, REPAIR_ITEM)) return p.sendMessage(shopMsg(p, "§c[Hearts] You need an Enchanted Golden Apple. Buy one in the shop (Food)."));
          const now = c.getItem(p.selectedSlotIndex);
          if (now && now.typeId === HALF_ITEM) { if (now.amount > 1) { now.amount -= 1; c.setItem(p.selectedSlotIndex, now); } else c.setItem(p.selectedSlotIndex, undefined); }
          const fixed = copyBuyer(st, makeHeartStack(1));                     // the repaired Heart keeps the buyer tag of the Half Heart
          { const tg = buyerOf(st); if (tg) logLoss({ kind: KIND_REPAIRED, type: HALF_ITEM, amount: 1, cause: "repair", bid: tg.id, bnm: tg.name, loc: p.location, dim: dimCodeOf(p.dimension), hid: p.id, hnm: p.name }); }       // loss log: a Half Heart was repaired
          if (!giveStack(p, fixed)) p.dimension.spawnItem(fixed, p.location);
          try { syncHeartPickups(p); } catch (e) { /* ignore */ }                 // a repair is not a pickup
          try { p.playSound("random.anvil_use", { volume: 0.5, pitch: 1.3 }); } catch (e) { /* ignore */ }
          p.sendMessage(shopMsg(p, "§a[Hearts] Repaired! The Half Heart is a full Heart again."));
        }
      } catch (e) { console.warn("[hearts] half menu: " + e); }
    });
  }).catch(() => {});
}
/** the player used a Half Heart earlier and has an odd number of half hearts: 1 Enchanted Golden Apple restores the missing half (shop page button) */
export function restoreHalf(p) {
  const r = heartsOf(p), say = (m) => p.sendMessage(shopMsg(p, m));
  if (r.n % 2 === 0) return say("§7[Hearts] You have no missing half.");
  if (combatLeft(p) > 0) return say("§c[Hearts] You can't do this while in combat.");
  if (!takeOne(p, REPAIR_ITEM)) return say("§c[Hearts] You need an Enchanted Golden Apple. Buy one in the shop (Food).");
  addUnits(p, r, 1);
}
try { world.afterEvents.itemUse.subscribe((ev) => { if (isHeart(ev.itemStack?.typeId) && ev.source?.typeId === "minecraft:player") useHeart(ev.source); }); } catch (e) { console.warn("[hearts] itemUse: " + e); }

// ------------------------------------------------------------------ admin: look at / remove the hearts of members (online or offline)
/** everybody who has active hearts: [{ id, name, n }]  (n in half hearts) */
export function heartOwners() {
  const out = [];
  for (const k of knownPlayers()) { const r = heartsRec(k.id, k.name); if (r.n > 0) out.push({ id: k.id, name: k.name, n: r.n }); }
  return out.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
/** count = hearts to remove (active ones first, then Heart items in his inventory when he is online) or "all".  Returns the removed amount in half hearts. */
export function removeHearts(id, count, by) {
  const r = heartsRec(id), p = byId(id); let left = count === "all" ? 100000 : clamp(count, 0, 100000) * 2, removed = 0;
  const dn = Math.min(r.n, left); r.n -= dn; left -= dn; removed += dn;
  saveRec(id);
  if (p) {
    if (left > 0) removed += takeUnits(p, left, by);
    applyHearts(p, r.n, "keep");
    if (removed > 0) p.sendMessage(shopMsg(p, "§c[Hearts] An admin removed §f" + heartsTxt(removed) + "§c of your hearts."));
  }
  return removed;
}
