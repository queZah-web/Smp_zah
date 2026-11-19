// AUCTION HOUSE (/ah) - the data and the rules. The pages are in smp/ahmenu.js.
//   * a player puts the item in his hand up for a price; everybody can buy it (money goes to the seller at once, even when he is offline)
//   * a listing lasts DURATION_HOURS; when it ends the item waits in "My listings" until the seller takes it back (nothing is ever lost)
//   * the seller can take an active listing back at any time
// Safety rules (nothing here touches the shop, the stats or any other system):
//   * the item is taken out of the inventory FIRST and only then saved; when saving fails the item is given back
//   * a purchase = check -> build the item -> take the money -> delete the listing -> pay the seller -> give the item (the listing is deleted
//     before anybody is paid, so the same listing can never be bought twice)
//   * items that can not be saved without losing data (shulker boxes, bundles, books, maps, banners, ...) can not be listed, and every item is
//     checked by building it again from the saved data before it is accepted
//   * one world property per listing ("ah:l:<id>") - one broken record can never damage the others
import { econMsg } from "./staffcore.js";   // staff tools: frozen money account
import { world, system, ItemStack, EnchantmentTypes } from "@minecraft/server";
import * as MC from "@minecraft/server";
import { addMoney, takeMoney, addMoneyById, recordOf } from "../data.js";
import { container, customLore } from "../inv.js";
import { notify } from "../smp/notify.js";
import { money } from "../format.js";
import { logAh } from "./oplog.js";   // Operator > Logs > Auction log
import { isHeart, buyerOf, tagBuyer } from "../heartids.js";   // Hearts can be sold here: the buyer tag travels inside the item lore

// ---------------------------------------------------------------- settings
export const DURATION_HOURS = 48;          // how long a listing stays on sale
export const MAX_PER_PLAYER = 10;          // listings (active + waiting to be taken back) per player
export const MAX_TOTAL = 3000;             // listings in the whole world
export const MIN_PRICE = 1;
export const MAX_PRICE = 1e10;
export const TAX_PERCENT = 0;              // % of the price the seller does NOT get (0 = no tax). 5 would give the seller 95%.
const EXPIRE_CHECK_TICKS = 200;            // the end-of-time check runs every 10 seconds
const NOTICE_DELAY_TICKS = 100;            // sale notices of an offline seller come 5 seconds after he joins
const MAX_NOTICES = 30;
const LKEY = "ah:l:", NKEY = "ah:n:";

// items that must never be listed: their content can not be read / restored with the script API (it would be lost)
const BLOCKED = /shulker_box|bundle|written_book|writable_book|filled_map|banner|goat_horn|firework|decorated_pot|command_block|structure_block|jigsaw|barrier|light_block|debug_stick|knowledge_book|suspicious_stew|tipped_arrow|ominous_bottle|lodestone_compass|(axolotl|tadpole|cod|salmon|pufferfish|tropical_fish)_bucket/;
const POTION_API = { "minecraft:potion": "Consume", "minecraft:splash_potion": "ThrownSplash", "minecraft:lingering_potion": "ThrownLingering" };

// ---------------------------------------------------------------- item <-> saved data
const short = (id) => String(id).replace(/^minecraft:/, "");
const enchOf = (s) => {
  try {
    const c = s.getComponent("enchantable");
    if (!c) return [];
    return c.getEnchantments().map((e) => [short(e.type && typeof e.type === "object" ? e.type.id : e.type), e.level]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  } catch (e) { return []; }
};
const colorOf = (s) => {
  try { const c = s.getComponent("dyeable"); const v = c && c.color; return v ? [Math.round(v.red * 255), Math.round(v.green * 255), Math.round(v.blue * 255)] : null; } catch (e) { return null; }
};
const potionEffect = (s) => {
  try {
    const c = s.getComponent("minecraft:potion") ?? s.getComponent("potion");
    if (!c) return null;
    const t = c.potionEffectType;
    const id = t && typeof t === "object" ? t.id : t;
    return id ? String(id) : null;
  } catch (e) { return null; }
};

/** the item as plain data, or a text with the reason when it can not be listed */
function readItem(s) {
  try {
    const t = s.typeId;
    if (BLOCKED.test(short(t))) return "this kind of item can not be sold here";
    try { if (s.getComponent("inventory")) return "items with an inventory can not be sold here"; } catch (e) { /* no such component */ }
    // a Heart only has the hidden buyer property; the same tag is also stored in its (invisible) lore code, which is saved with the listing
    if (!isHeart(t)) { try { if (s.getDynamicPropertyIds().length) return "this item has special data and can not be sold here"; } catch (e) { /* ignore */ } }
    try { if (s.lockMode && String(s.lockMode).toLowerCase() !== "none") return "locked items can not be sold here"; } catch (e) { /* ignore */ }
    try { if (s.keepOnDeath) return "this item can not be sold here"; } catch (e) { /* ignore */ }
    try { if ((s.getCanPlaceOn() ?? []).length || (s.getCanDestroy() ?? []).length) return "this item can not be sold here"; } catch (e) { /* ignore */ }
    const it = { t, a: s.amount };
    if (s.nameTag) it.n = s.nameTag;
    const lore = customLore(s); if (lore.length) it.l = lore;
    const en = enchOf(s); if (en.length) it.en = en;
    try { const d = s.getComponent("durability"); if (d && d.damage > 0) it.d = d.damage; } catch (e) { /* ignore */ }
    const col = colorOf(s); if (col) it.c = col;
    if (POTION_API[t]) {
      const pe = potionEffect(s);
      if (!pe) return "this potion can not be sold here";
      it.pe = pe;
    }
    return it;
  } catch (e) { return "this item can not be sold here"; }
}

/** builds the item from the saved data (null when it can not be built) */
export function makeItem(it) {
  try {
    let s = null;
    if (POTION_API[it.t]) {
      const P = MC.Potions;
      if (!P || typeof P.resolve !== "function" || !it.pe) return null;
      s = P.resolve(it.pe, POTION_API[it.t]);
      if (!s || s.typeId !== it.t) return null;
      s.amount = it.a;
    } else s = new ItemStack(it.t, it.a);
    if (it.n) s.nameTag = it.n;
    if (it.l) s.setLore(it.l);
    if (isHeart(it.t)) { try { const b = buyerOf(s); if (b) tagBuyer(s, b.id, b.name); } catch (e) { /* ignore */ } }   // buyer tag back on the item (property + lore code)
    if (it.d) { const d = s.getComponent("durability"); if (d) d.damage = Math.min(it.d, d.maxDurability); }
    if (it.c) { const c = s.getComponent("dyeable"); if (c) c.color = { red: it.c[0] / 255, green: it.c[1] / 255, blue: it.c[2] / 255 }; }
    if (it.en) {
      const c = s.getComponent("enchantable");
      if (!c) return null;
      for (const [id, level] of it.en) {
        const type = EnchantmentTypes.get(id) ?? EnchantmentTypes.get("minecraft:" + id);
        if (!type) return null;
        c.addEnchantment({ type, level });
      }
    }
    return s;
  } catch (e) { return null; }
}

/** item stack -> saved data, checked by building it again. Returns { it } or { err: "reason" } */
export function packItem(s) {
  const it = readItem(s);
  if (typeof it === "string") return { err: it };
  const back = makeItem(it);
  if (!back) return { err: "this item can not be saved safely, so it can not be sold here" };
  const again = readItem(back);
  if (typeof again === "string" || JSON.stringify(again) !== JSON.stringify(it)) return { err: "this item can not be saved safely, so it can not be sold here" };
  return { it };
}

// ---------------------------------------------------------------- the listings (kept in memory, saved one by one)
let all = null;                            // Map id -> record { i, s: seller id, n: seller name, p: price, c: created, e: ends, x: 0 on sale | 1 waiting to be taken back, it }
let ver = 0;                               // grows with every change (the page lists are cached per version)
const views = new Map();

const stripRec = (r) => ({ i: r.i, s: r.s, n: r.n, p: r.p, c: r.c, e: r.e, x: r.x, it: r.it });
const save = (r) => { try { world.setDynamicProperty(LKEY + r.i, JSON.stringify(stripRec(r))); return true; } catch (e) { console.warn("[ah] save failed: " + e); return false; } };
const drop = (r) => { try { world.setDynamicProperty(LKEY + r.i, undefined); return true; } catch (e) { console.warn("[ah] delete failed: " + e); return false; } };
const changed = () => { ver++; views.clear(); };

function load() {
  if (all) return all;
  const m = new Map();
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(LKEY)) continue;
      try {
        const r = JSON.parse(world.getDynamicProperty(k));
        if (r && r.i && r.s && r.it && typeof r.p === "number" && typeof r.it.t === "string") m.set(r.i, r);
      } catch (e) { console.warn("[ah] unreadable listing " + k); }
    }
  } catch (e) { return null; }             // world not ready: try again later (never overwrite anything)
  all = m;
  return all;
}
const nowOk = () => Date.now();
export const isLive = (r) => r.x === 0 && r.e > nowOk();

export const getListing = (id) => (load() ?? new Map()).get(id) ?? null;
export const countOf = (sellerId) => { let n = 0; for (const r of (load() ?? new Map()).values()) if (r.s === sellerId) n++; return n; };
/** the listings of one seller: waiting ones first, then by end time */
export function mine(sellerId) {
  const out = [];
  for (const r of (load() ?? new Map()).values()) if (r.s === sellerId) out.push(r);
  return out.sort((a, b) => (isLive(a) === isLive(b) ? a.e - b.e : isLive(a) ? 1 : -1));
}

// ---- search text / category / name of an item (built from the shop catalog on first use)
let META = null;
export function setCatalog(categories, realId) {
  try {
    META = { icon: new Map(), name: new Map(), cat: new Map(), cats: [] };
    for (const c of categories) {
      META.cats.push({ id: c.id, name: c.name, icon: c.icon });
      for (const it of c.items) {
        const keys = [short(it[0])];
        try { keys.push(short(realId(it[0], it[1]))); } catch (e) { /* ignore */ }
        for (const k of keys) {
          if (!META.icon.has(k)) META.icon.set(k, it[2]);
          if (!META.name.has(k)) META.name.set(k, it[1]);
          if (!META.cat.has(k)) META.cat.set(k, c.id);
        }
      }
    }
  } catch (e) { console.warn("[ah] catalog: " + e); }
}
export const categories = () => (META ? META.cats : []);
// our own items (the Hearts): the texture is in the resource pack (textures/items/smp_heart ...), the game path "textures/items/smp:heart" does not exist
const CUSTOM = { "smp:heart": ["Heart", "textures/items/smp_heart"], "smp:heart_half": ["Half Heart", "textures/items/smp_heart_half"], "smp:heart_cursed": ["Heart of Malevolence", "textures/items/smp_heart_cursed"] };
export const HEARTS_CAT = { id: "hearts", name: "Hearts", icon: "textures/items/smp_heart" };
export const iconOf = (typeId) => {
  if (CUSTOM[typeId]) return CUSTOM[typeId][1];
  const k = short(typeId);
  if (META && META.icon.has(k)) return META.icon.get(k);
  if (POTION_API[typeId]) return "textures/items/potion_bottle_" + (typeId.includes("splash") ? "splash" : typeId.includes("lingering") ? "lingering" : "drinkable");
  return "textures/items/" + k;
};
const prettyId = (id) => short(id).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
export const nameOf = (typeId) => (CUSTOM[typeId] ? CUSTOM[typeId][0] : (META && META.name.get(short(typeId))) || prettyId(typeId));
export const catOf = (typeId) => {
  if (CUSTOM[typeId]) return "hearts";
  const k = short(typeId);
  if (META && META.cat.has(k)) return META.cat.get(k);
  return POTION_API[typeId] ? "potions" : "other";
};
const haystack = (r) => {
  if (!r._h) r._h = (nameOf(r.it.t) + " " + short(r.it.t).replace(/_/g, " ") + " " + (r.it.n ?? "") + " " + r.n + " " + (r.it.en ?? []).map((e) => e[0].replace(/_/g, " ")).join(" ")).replace(/§./g, "").toLowerCase();
  return r._h;
};

export const SORTS = [
  { key: "new", label: "Newest first", fn: (a, b) => b.c - a.c },
  { key: "low", label: "Lowest price", fn: (a, b) => a.p - b.p || b.c - a.c },
  { key: "high", label: "Highest price", fn: (a, b) => b.p - a.p || b.c - a.c },
  { key: "end", label: "Ending soon", fn: (a, b) => a.e - b.e },
];
/** the listings on sale for a page: filtered + sorted, cached until something changes */
export function browse(sortKey, cat, q) {
  const list = load();
  if (!list) return [];
  const key = sortKey + "|" + cat + "|" + q + "|" + ver;
  let v = views.get(key);
  if (v) return v;
  const now = nowOk(), words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  v = [];
  for (const r of list.values()) {
    if (r.x !== 0 || r.e <= now) continue;
    if (cat && cat !== "all" && catOf(r.it.t) !== cat) continue;
    if (words.length) { const h = haystack(r); if (!words.every((w) => h.includes(w))) continue; }
    v.push(r);
  }
  v.sort((SORTS.find((s) => s.key === sortKey) ?? SORTS[0]).fn);
  if (views.size > 12) views.clear();
  views.set(key, v);
  return v;
}
export const liveCount = () => { let n = 0; for (const r of (load() ?? new Map()).values()) if (isLive(r)) n++; return n; };

// ---------------------------------------------------------------- giving an item back
/** puts the item in the inventory, what does not fit is dropped at the feet. false = it could not be delivered at all */
function deliver(p, stack) {
  try {
    const rest = container(p).addItem(stack);
    if (rest) p.dimension.spawnItem(rest, p.location);
    return true;
  } catch (e) {
    try { p.dimension.spawnItem(stack, p.location); return true; } catch (er) { return false; }
  }
}
export const itemTitle = (r) => (r.it.n ? "§o" + r.it.n + "§r" : nameOf(r.it.t) + (r.it.pe ? " (" + prettyId(r.it.pe.replace(/([a-z])([A-Z])/g, "$1_$2")) + ")" : "")) + (r.it.a > 1 ? " x" + r.it.a : "");
const idStamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------- selling
/** puts the item in the main hand up for sale. Returns { ok: true, rec } or { err: "text" } */
export function sellHeld(p, price, amount, expectIt, slotIndex) {
  { const em = econMsg(p); if (em) return { err: em.replace(/§./g, "") }; }
  try {
    const list = load();
    if (!list) return { err: "The auction house is not ready yet, try again in a moment." };
    if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) return { err: "The price must be between " + money(MIN_PRICE) + " and " + money(MAX_PRICE) + "." };
    price = Math.floor(price);
    if (countOf(p.id) >= MAX_PER_PLAYER) return { err: "You already have " + MAX_PER_PLAYER + " listings. Take back or wait for one to end (Auction > My listings)." };
    if (list.size >= MAX_TOTAL) return { err: "The auction house is full right now." };
    const c = container(p), slot = Number.isInteger(slotIndex) ? slotIndex : p.selectedSlotIndex;
    const s = c.getItem(slot);
    if (!s) return { err: "There is no item in that slot." };
    const full = packItem(s);
    if (full.err) return { err: "You can not sell this: " + full.err + "." };
    if (expectIt && JSON.stringify({ ...full.it, a: 0 }) !== JSON.stringify({ ...expectIt, a: 0 })) return { err: "The item in your hand changed. Try again." };
    let n = Math.floor(Number(amount) || s.amount);
    if (n < 1 || n > s.amount) n = s.amount;
    const it = { ...full.it, a: n };
    const r = { i: idStamp(), s: p.id, n: p.name, p: price, c: nowOk(), e: nowOk() + DURATION_HOURS * 3600000, x: 0, it };
    while (list.has(r.i)) r.i = idStamp();
    // take the item out of the hand first, save, and give it back when saving failed
    const before = s.clone();
    if (n === s.amount) c.setItem(slot, undefined);
    else { s.amount -= n; c.setItem(slot, s); }
    if (!save(r)) {
      try { c.setItem(slot, before); } catch (e) { deliver(p, before); }
      return { err: "The listing could not be saved. Your item was given back." };
    }
    list.set(r.i, r); changed();
    try { logAh({ k: "ahl", actor: p, typeId: it.t, name: itemTitle({ it }).replace(/§./g, "").replace(/ x\d+$/, ""), qty: n, price }); } catch (e) { /* the log can never break a listing */ }
    return { ok: true, rec: r };
  } catch (e) { console.warn("[ah] sell failed: " + e); return { err: "Something went wrong. Check your inventory." }; }
}

// ---------------------------------------------------------------- buying
/** Returns { ok: true, rec } or { err: "text" } */
export function buy(p, id) {
  { const em = econMsg(p); if (em) return { err: em.replace(/§./g, "") }; }
  try {
    const list = load(), r = list ? list.get(id) : null;
    if (!r || r.x !== 0) return { err: "This item was already sold or taken back." };
    if (r.e <= nowOk()) return { err: "This listing has ended." };
    if (r.s === p.id) return { err: "This is your own listing." };
    if (!recordOf(r.s)) return { err: "The seller could not be found." };
    const bal = recordOf(p.id);
    if (!bal || (Number(bal.money) || 0) < r.p) return { err: "Not enough money. You need " + money(r.p) + "." };
    if (container(p).emptySlotsCount < 1) return { err: "Free one inventory slot first." };
    const stack = makeItem(r.it);
    if (!stack) return { err: "This item can not be delivered in this game version. You were not charged." };
    if (!takeMoney(p, r.p)) return { err: "Not enough money. You need " + money(r.p) + "." };
    list.delete(r.i);                                                   // in memory first: from here on nobody else can buy it
    if (!drop(r)) { list.set(r.i, r); addMoney(p, r.p); return { err: "The purchase could not be saved. You were not charged." }; }
    changed();
    const gain = Math.floor(r.p * (100 - TAX_PERCENT) / 100);
    if (!addMoneyById(r.s, gain)) { console.warn("[ah] seller could not be paid: " + r.s + " " + gain); }
    if (!deliver(p, stack)) {                                           // really could not hand it over: put the listing back and refund
      list.set(r.i, r); save(r); changed(); addMoneyById(r.s, -gain); addMoney(p, r.p);
      return { err: "The item could not be delivered. You were not charged." };
    }
    tellSeller(r, p.name, gain);
    try { logAh({ k: "ahb", actor: p, sellerId: r.s, sellerName: r.n, typeId: r.it.t, name: itemTitle({ it: r.it }).replace(/§./g, "").replace(/ x\d+$/, ""), qty: r.it.a, price: r.p, gain }); } catch (e) { /* the log can never break a purchase */ }
    return { ok: true, rec: r, gain };
  } catch (e) { console.warn("[ah] buy failed: " + e); return { err: "Something went wrong. Check your balance and inventory." }; }
}

// ---------------------------------------------------------------- taking back (cancel an active listing / claim an ended one)
export function takeBack(p, id) {
  try {
    const list = load(), r = list ? list.get(id) : null;
    if (!r) return { err: "This listing is gone (maybe it was just sold)." };
    if (r.s !== p.id) return { err: "This is not your listing." };
    const stack = makeItem(r.it);
    if (!stack) return { err: "This item can not be built in this game version. Ask an operator." };
    list.delete(r.i);
    if (!drop(r)) { list.set(r.i, r); return { err: "Could not save. Try again." }; }
    changed();
    if (!deliver(p, stack)) { list.set(r.i, r); save(r); changed(); return { err: "The item could not be delivered. It stays in your listings." }; }
    return { ok: true, rec: r };
  } catch (e) { console.warn("[ah] take back failed: " + e); return { err: "Something went wrong." }; }
}
/** takes back every ended listing of the player. Returns how many items came back */
export function takeAllEnded(p) {
  let n = 0;
  for (const r of mine(p.id)) { if (r.x === 1 || r.e <= nowOk()) { const res = takeBack(p, r.i); if (res.ok) n++; else break; } }
  return n;
}
export const endedCount = (id) => { let n = 0; const now = nowOk(); for (const r of (load() ?? new Map()).values()) if (r.s === id && (r.x === 1 || r.e <= now)) n++; return n; };

/** an operator ends a listing: the item goes back to its seller's "waiting" list */
export function staffEnd(id) {
  try {
    const list = load(), r = list ? list.get(id) : null;
    if (!r || r.x !== 0) return false;
    r.x = 1; r.e = Math.min(r.e, nowOk());
    if (!save(r)) { r.x = 0; return false; }
    changed();
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- notices for the seller
const online = (id) => { try { return world.getAllPlayers().find((x) => x.id === id) ?? null; } catch (e) { return null; } };
const readQ = (id) => { try { const v = world.getDynamicProperty(NKEY + id); if (typeof v === "string") { const a = JSON.parse(v); if (Array.isArray(a)) return a; } } catch (e) { /* ignore */ } return []; };
const writeQ = (id, q) => { try { world.setDynamicProperty(NKEY + id, q.length ? JSON.stringify(q) : undefined); } catch (e) { /* ignore */ } };
const soldText = (n) => "§6[Auction] §a" + n.b + " §7bought §f" + n.i + " §7for §a" + money(n.p) + (n.g !== n.p ? " §7(you got §a" + money(n.g) + "§7)" : "");
function tellSeller(r, buyerName, gain) {
  const n = { b: buyerName, i: itemTitle(r).replace(/§./g, ""), p: r.p, g: gain };
  const sp = online(r.s);
  if (sp) { try { notify(sp, soldText(n), { key: undefined }); try { sp.playSound("random.levelup", { volume: 0.7, pitch: 1.2 }); } catch (e) { /* ignore */ } } catch (e) { /* ignore */ } return; }
  const q = readQ(r.s); q.push(n); if (q.length > MAX_NOTICES) q.splice(0, q.length - MAX_NOTICES);
  writeQ(r.s, q);
}
function deliverNotices(p) {
  const q = readQ(p.id);
  if (q.length) { writeQ(p.id, []); for (const n of q) { try { notify(p, soldText(n)); } catch (e) { /* ignore */ } } }
  const ended = endedCount(p.id);
  if (ended > 0) { try { notify(p, "§6[Auction] §7" + ended + " of your listing" + (ended > 1 ? "s" : "") + " ended. Take " + (ended > 1 ? "them" : "it") + " back with §f/ah §7> My listings.", { key: "ah_ended" }); } catch (e) { /* ignore */ } }
}
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => { try { if (player.isValid === false) return; deliverNotices(player); } catch (e) { /* ignore */ } }, NOTICE_DELAY_TICKS);
});

// ---------------------------------------------------------------- end of time
function expireJob() {
  const list = load();
  if (!list) return;
  const now = nowOk();
  let any = false;
  for (const r of list.values()) {
    if (r.x !== 0 || r.e > now) continue;
    r.x = 1;
    if (save(r)) {
      any = true;
      const sp = online(r.s);
      if (sp) { try { notify(sp, "§6[Auction] §7Your listing §f" + itemTitle(r).replace(/§./g, "") + " §7ended. Take it back with §f/ah §7> My listings.", { key: "ah_ended" }); } catch (e) { /* ignore */ } }
    } else r.x = 0;                                                      // not saved: try again at the next check
  }
  if (any) changed();
}
system.runInterval(() => { try { expireJob(); } catch (e) { console.warn("[ah] expire: " + e); } }, EXPIRE_CHECK_TICKS);
system.runTimeout(() => { try { load(); } catch (e) { /* ignore */ } }, 100);
