// STACKED SPAWNERS (DonutSMP style).  Rules and numbers live in ../spawner_data.js - this file is only the game side.
//  * Every mob has its own custom block  smp:spawner_<mob>  (BP/blocks).  It spawns NOTHING; no mobs, no timers, no loaded chunks needed.
//  * Placing it registers it to you.  Right-click (not sneaking) opens its page: items + XP of the time that passed, collect / sell.
//  * Right-click it holding the SAME spawner = stack one more into it (max MAX_STACK).  Sneak = normal vanilla behaviour (build next to it).
//  * Breaking it (owner or admin only, and the land rules still apply) returns the whole stack as items and pays out the loot.
//  * Old vanilla mob spawners are removed near players (set OLD_SPAWNERS = "keep" in spawner_data.js to switch that off).
// Data: one world dynamic property per spawner  "sp:<dim>:<x>,<y>,<z>"  (nothing else in the world data is touched).
import { econMsg, roleOf } from "./staffcore.js";   // staff tools: frozen money account + roles
import { world, system, ItemStack } from "@minecraft/server";
import { addMoney, addTx } from "../data.js";
import { saleFx } from "../salefx.js";
import { money, num } from "../format.js";
import { container, give, spaceFor } from "../inv.js";
import { formBusy } from "../state.js";
import { isAdmin, canEditBlock } from "./landcore.js";
import { make, set, open, hdr, NAV, COLS, status } from "../smp/ui.js";
import { CATEGORIES } from "../shop_data.js";
import { SPAWNERS } from "../mobs.js";
import * as D from "../spawner_data.js";
import { giveXp } from "../xprepair.js";
import { menuMsg } from "./menulang.js";
import { ModalFormData } from "@minecraft/server-ui";
import { showModal } from "./forms.js";
import { pick } from "./arextra.js";

const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[spawners] " + name + " not started: " + e); } };
const say = (p, msg) => { try { p.sendMessage(menuMsg(p, msg)); } catch (e) { /* ignore */ } };
const snd = (p, id, vol = 1, pitch = 1) => { try { p.playSound(id, { volume: vol, pitch }); } catch (e) { /* ignore */ } };

const NAMES = new Map(SPAWNERS.map((m) => [m.id, m.name]));
const nameOf = (mob) => NAMES.get(mob) ?? D.itemName(mob);
const mobOf = (typeId) => (typeId.startsWith(D.TYPE_PREFIX) ? typeId.slice(D.TYPE_PREFIX.length) : null);
const typeOf = (mob) => D.TYPE_PREFIX + mob;

// shop catalogue: sell prices + icons of the loot
const SELL = new Map(), ICON = new Map();
for (const c of CATEGORIES) for (const x of c.items) { SELL.set(x[0], x[4]); ICON.set(x[0], x[2]); }
const iconOf = (id) => ICON.get(id) ?? NAV.chest;

// ---------------------------------------------------------------- storage
const dimShort = (b) => { const d = b.dimension.id; return d === "minecraft:overworld" ? "o" : d === "minecraft:nether" ? "n" : d === "minecraft:the_end" ? "e" : d; };
const keyOf = (b) => "sp:" + dimShort(b) + ":" + b.x + "," + b.y + "," + b.z;
function load(b) { try { const v = world.getDynamicProperty(keyOf(b)); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } }
function save(b, rec) { try { world.setDynamicProperty(keyOf(b), JSON.stringify(rec)); return true; } catch (e) { console.warn("[spawners] save failed: " + e); return false; } }
function forget(b) { try { world.setDynamicProperty(keyOf(b), undefined); } catch (e) { /* ignore */ } }
// ---------------------------------------------------------------- who may do what
//   owner of the spawner, and staff with the Admin / Owner role (or the land admin tag): everything ("like the owner")
//   friends (rec.fr = { playerId: { n: name, s: sell, t: take, b: break, a: add friends } }): open + stack, the rest only with that permission
export const FRIEND_PERMS = [["t", "Take items + XP", "أخذ الأغراض والـ XP"], ["s", "Sell items", "بيع الأغراض"], ["b", "Break / pick up the spawner", "تكسير وأخذ السبونر"], ["a", "Add / remove friends", "إضافة وإزالة أصدقاء"]];
const MAX_FRIENDS = 20;
const staffFull = (p) => { try { const r = roleOf(p); return r === "owner" || r === "admin" || isAdmin(p); } catch (e) { return isAdmin(p); } };
const ownerLike = (p, rec) => rec.o === p.id || staffFull(p);
/** what = "open" | "t" (take) | "s" (sell) | "b" (break) | "a" (add friends) */
function allowed(p, rec, what) {
  if (!rec) return false;
  if (ownerLike(p, rec)) return true;
  const f = rec.fr?.[p.id]; if (!f) return false;
  if (what === "open") return true;
  return !!f[what];
}
const mine = (p, rec) => allowed(p, rec, "open");
const stillThere = (b, mob) => { try { return b.typeId === typeOf(mob); } catch (e) { return false; } };

// ---------------------------------------------------------------- the page
// SHORT chest: SP_ROWS rows (must match the "spawner_window" height in RP/ui/server_form.json).  Rows above the last = loot, last row = buttons.
const SP_ROWS = 5, SP_LOOT = (SP_ROWS - 1) * COLS, SP_BAR = SP_LOOT;
function page(p, b, mob) {
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec) return say(p, "§c[Spawners] This spawner has no data (it was moved or reset). Break it and place it again.");
  if (!mine(p, rec)) return say(p, "§c[Spawners] This spawner belongs to §f" + rec.on + "§c.");
  if (D.settle(rec, mob) > 0) save(b, rec);
  const canTake = allowed(p, rec, "t"), canSell = allowed(p, rec, "s"), canFriends = allowed(p, rec, "a"), boss = ownerLike(p, rec);
  const f = make(nameOf(mob) + " Spawner x" + rec.n, SP_ROWS); f.self = () => page(p, b, mob);
  const ids = Object.keys(rec.l).filter((k) => rec.l[k] > 0).sort((a, c) => rec.l[c] - rec.l[a]);
  let worth = 0;
  ids.slice(0, SP_LOOT).forEach((id, i) => {
    const q = rec.l[id], price = SELL.get(id) ?? 0; worth += price * q;
    set(f, i, hdr(Math.min(q, 99)) + "§f" + D.itemName(id) + "\n§r§7Amount: §f" + num(q) + "\n§r§7" + (price > 0 ? "Worth: §a" + money(price * q) : "§8Not sellable") + "\n§r" + (canTake ? "§eClick to collect" : "§8(you can't take items)"), iconOf(id), { run: () => { if (!canTake) return; collect(p, b, mob, id); page(p, b, mob); } });
  });
  if (!ids.length) set(f, 4, hdr(1) + "§7Nothing stored yet\n§r§8Come back later", NAV.page, null);
  const rate = D.ratePerHour(mob) * rec.n, cap = D.capKills(rec.n, mob), k = rec.k ?? 0, pct = Math.min(100, Math.floor((k / Math.max(1, cap)) * 100));
  const left = k >= cap ? "§cFULL - collect now" : "§7Full in: §f" + (((cap - k) / rate) >= 1 ? ((cap - k) / rate).toFixed(1) + "h" : Math.ceil(((cap - k) / rate) * 60) + "m");
  set(f, SP_BAR, hdr(1) + "§cClose", NAV.back, { run: () => {} });
  status(p, f, SP_BAR + 6);
  set(f, SP_BAR + 2, hdr(1) + "§e" + nameOf(mob) + " Spawner\n§r§7Owner: §f" + rec.on + "\n§r§7Stack: §f" + rec.n + "§7/" + D.MAX_STACK + "\n§r§7Speed: §f" + num(rate) + " kills/hour\n§r§7Storage: §f" + pct + "%\n§r" + left + "\n§r§8Hold the same spawner + click = stack", NAV.page, null);
  if (canFriends) set(f, SP_BAR + 7, hdr(Math.max(1, Math.min(99, Object.keys(rec.fr ?? {}).length))) + "§a§lFriends\n§r§7People who can use this spawner: §f" + Object.keys(rec.fr ?? {}).length + "\n§r§7Add a friend and choose what\n§r§7he may do (take, sell, break, add)\n§r§eClick to open", NAV.player ?? NAV.page, { run: () => friendsPage(p, b, mob) });
  if (!boss) set(f, SP_BAR + 1, hdr(1) + "§b§lYou are a friend\n§r§7Owner: §f" + rec.on + "\n" + FRIEND_PERMS.map(([k, en]) => "§r" + (rec.fr?.[p.id]?.[k] ? "§a+ " : "§c- ") + "§7" + en).join("\n"), NAV.page, null);
  else if (rec.o !== p.id) set(f, SP_BAR + 1, hdr(1, "r") + "§c§lStaff access\n§r§7You open this spawner like its owner\n§r§7Owner: §f" + rec.on, NAV.page, null);
  set(f, SP_BAR + 3, hdr(1) + "§d§lXP\n§r§7Stored: §f" + num(rec.x ?? 0) + "\n§r§eClick to collect", iconOf("experience_bottle"), { run: () => { if (!canTake) return say(p, "§c[Spawners] You are not allowed to take from this spawner."); collectXp(p, b, mob); page(p, b, mob); } });
  set(f, SP_BAR + 4, hdr(1) + "§a§lCollect all\n§r§7Items go to your inventory\n§r§7(what does not fit stays here)", NAV.ok, { run: () => { if (!canTake) return say(p, "§c[Spawners] You are not allowed to take from this spawner."); collect(p, b, mob, null); page(p, b, mob); } });
  set(f, SP_BAR + 5, hdr(1) + "§6§lSell all\n§r§7Value: §a" + money(worth) + "\n§r§8Shop sell prices", NAV.bal, { run: () => { if (!canSell) return say(p, "§c[Spawners] You are not allowed to sell from this spawner."); sellAll(p, b, mob); page(p, b, mob); } });
  set(f, SP_BAR + 8, hdr(1, rec.hh ? "r" : "g") + "§b§lHologram: " + (rec.hh ? "§cCLOSED" : "§aOPEN") + "\n§r§7The floating info text above\n§r§7this spawner\n§r§eClick to " + (rec.hh ? "show it" : "close it"), NAV.page, { run: () => { if (!boss && !canFriends) return; const r2 = load(b); if (r2) { r2.hh = r2.hh ? 0 : 1; save(b, r2); say(p, r2.hh ? "§7[Spawners] Hologram closed." : "§a[Spawners] Hologram opened."); } page(p, b, mob); } });
  open(p, f);
}

// ---------------------------------------------------------------- friends (owner, staff, or a friend with "add friends")
const permText = (p, fr) => FRIEND_PERMS.map(([k, en, ar]) => (fr[k] ? "§a+ " : "§c- ") + "§7" + pick(p, en, ar)).join("\n§r");
function friendsPage(p, b, mob) {
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec || !allowed(p, rec, "a")) return;
  const fr = rec.fr ?? {}, ids = Object.keys(fr);
  const f = make(nameOf(mob) + " Spawner: Friends", SP_ROWS); f.self = () => friendsPage(p, b, mob);
  ids.slice(0, SP_LOOT).forEach((id, i) => {
    const x = fr[id];
    set(f, i, hdr(1, "g") + "§a§l" + x.n + "\n§r" + permText(p, x) + "\n§r§eClick to change / remove", NAV.player ?? NAV.page, { run: () => editFriend(p, b, mob, id) });
  });
  if (!ids.length) set(f, 4, hdr(1) + "§7No friends yet\n§r§8Click \"Add friend\" below", NAV.page, null);
  set(f, SP_BAR, hdr(1) + "§cBack", NAV.back, { run: () => page(p, b, mob) });
  set(f, SP_BAR + 4, hdr(1, "g") + "§a§lAdd friend\n§r§7An online player: choose what\n§r§7he may do with this spawner\n§r§7(" + ids.length + "/" + MAX_FRIENDS + ")\n§r§eClick to add", NAV.ok, { run: () => addFriend(p, b, mob) });
  set(f, SP_BAR + 2, hdr(1) + "§e§lFriends\n§r§7Owner: §f" + rec.on + "\n§r§7A friend can always open the\n§r§7spawner and stack more into it", NAV.page, null);
  open(p, f);
}
const toggle = (form, label, on) => { try { form.toggle(label, { defaultValue: !!on }); } catch (e) { form.toggle(label, !!on); } };
function addFriend(p, b, mob) {
  const rec = load(b); if (!rec || !allowed(p, rec, "a")) return;
  if (Object.keys(rec.fr ?? {}).length >= MAX_FRIENDS) return say(p, "§c[Spawners] This spawner already has " + MAX_FRIENDS + " friends.");
  const list = world.getAllPlayers().filter((x) => x.id !== rec.o && !(rec.fr ?? {})[x.id]);
  if (!list.length) return say(p, "§c[Spawners] No online player to add.");
  const form = new ModalFormData().title(pick(p, "Add a friend", "إضافة صديق"));
  try { form.dropdown(pick(p, "Player", "اللاعب"), list.map((x) => x.name), { defaultValueIndex: 0 }); } catch (e) { form.dropdown(pick(p, "Player", "اللاعب"), list.map((x) => x.name), 0); }
  for (const [k, en, ar] of FRIEND_PERMS) toggle(form, pick(p, en, ar), k === "t");
  showModal(p, form, (v) => {
    if (!v) return friendsPage(p, b, mob);
    const r2 = load(b); if (!r2 || !allowed(p, r2, "a")) return;
    const who = list[v[0]]; if (!who) return friendsPage(p, b, mob);
    r2.fr ??= {}; r2.fr[who.id] = { n: who.name, t: v[1] ? 1 : 0, s: v[2] ? 1 : 0, b: v[3] ? 1 : 0, a: v[4] ? 1 : 0 };
    save(b, r2);
    say(p, "§a[Spawners] §f" + who.name + " §ais now a friend of this spawner.");
    try { who.sendMessage(menuMsg(who, "§a[Spawners] §f" + p.name + " §aadded you as a friend of a §f" + nameOf(mob) + " Spawner §7(" + b.x + " " + b.y + " " + b.z + ")")); } catch (e) { /* ignore */ }
    friendsPage(p, b, mob);
  });
}
function editFriend(p, b, mob, id) {
  const rec = load(b); if (!rec || !allowed(p, rec, "a")) return;
  const x = rec.fr?.[id]; if (!x) return friendsPage(p, b, mob);
  const form = new ModalFormData().title(x.n);
  for (const [k, en, ar] of FRIEND_PERMS) toggle(form, pick(p, en, ar), x[k]);
  toggle(form, pick(p, "§cRemove this friend", "§cإزالة هذا الصديق"), false);
  showModal(p, form, (v) => {
    if (!v) return friendsPage(p, b, mob);
    const r2 = load(b); if (!r2 || !allowed(p, r2, "a") || !r2.fr?.[id]) return friendsPage(p, b, mob);
    if (v[4]) { delete r2.fr[id]; if (!Object.keys(r2.fr).length) delete r2.fr; say(p, "§e[Spawners] §f" + x.n + " §eis no longer a friend of this spawner."); }
    else { Object.assign(r2.fr[id], { t: v[0] ? 1 : 0, s: v[1] ? 1 : 0, b: v[2] ? 1 : 0, a: v[3] ? 1 : 0 }); say(p, "§a[Spawners] Permissions of §f" + x.n + " §asaved."); }
    save(b, r2);
    friendsPage(p, b, mob);
  });
}

// ---------------------------------------------------------------- actions
/** moves loot into the inventory. only = one item id, or null = everything. Whatever does not fit stays stored. */
function collect(p, b, mob, only) {
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec || !allowed(p, rec, "t")) return;
  D.settle(rec, mob);
  const w0 = D.weight(rec); let moved = 0, full = false;
  for (const id of only ? [only] : Object.keys(rec.l)) {
    const q = rec.l[id] ?? 0; if (q <= 0) continue;
    const space = spaceFor(p, id);
    if (space < 0) { delete rec.l[id]; continue; }              // an item this game version does not know: drop it so it can never block the storage
    const take = Math.min(q, space);
    if (take <= 0) { full = true; continue; }
    if (!give(p, id, take)) continue;
    rec.l[id] = q - take; if (rec.l[id] <= 0) delete rec.l[id];
    moved += take; if (take < q) full = true;
  }
  D.shrink(rec, w0); save(b, rec);
  if (moved > 0) { say(p, "§a[Spawners] Collected §f" + num(moved) + " items" + (full ? " §c(inventory full - the rest stays here)" : "")); snd(p, "random.pop", 0.8, 1.1); }
  else say(p, full ? "§c[Spawners] Your inventory is full." : "§7[Spawners] Nothing to collect.");
}
function collectXp(p, b, mob) {
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec || !allowed(p, rec, "t")) return;
  D.settle(rec, mob);
  const xp = Math.floor(rec.x ?? 0); if (xp <= 0) return say(p, "§7[Spawners] No XP stored.");
  const w0 = D.weight(rec);
  const r = giveXp(p, xp); if (!r) return say(p, "§c[Spawners] Could not give the XP.");
  rec.x = 0; D.shrink(rec, w0); save(b, rec);
  say(p, "§a[Spawners] Collected §d" + num(xp) + " XP" + (r.points > 0 ? " §8(§b" + num(r.points) + " §8durability repaired on " + r.items + " item" + (r.items > 1 ? "s" : "") + ", §d" + num(r.left) + " §8XP to your level)" : "")); snd(p, "random.orb", 0.9, 1);
}
/** sells every sellable item at the plain shop sell price (no Seller-level bonus, no Seller XP - on purpose, see the economy notes) */
function sellAll(p, b, mob) {
  { const em = econMsg(p); if (em) return p.sendMessage(menuMsg(p, em)); }
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec || !allowed(p, rec, "s")) return;
  D.settle(rec, mob);
  const w0 = D.weight(rec); let total = 0, n = 0;
  for (const id of Object.keys(rec.l)) {
    const q = rec.l[id] ?? 0, price = SELL.get(id) ?? 0;
    if (q <= 0 || price <= 0) continue;
    total += price * q; n += q; delete rec.l[id];
    addTx(p, { type: "sell", id, name: D.itemName(id) + " (spawner)", qty: q, total: price * q });
  }
  if (total <= 0) return say(p, "§7[Spawners] Nothing sellable stored.");
  addMoney(p, total); saleFx(p, total); D.shrink(rec, w0); save(b, rec);
  say(p, "§a-" + num(n) + " Items (+" + money(total) + ")"); snd(p, "random.levelup", 0.6, 1.4);
}
function stackAdd(p, b, mob) {
  if (!stillThere(b, mob)) return;
  const rec = load(b); if (!rec) return say(p, "§c[Spawners] This spawner has no data. Break it and place it again.");
  if (!mine(p, rec)) return say(p, "§c[Spawners] This spawner belongs to §f" + rec.on + "§c.");
  if (rec.n >= D.MAX_STACK) return say(p, "§c[Spawners] The maximum stack is " + D.MAX_STACK + ".");
  const c = container(p), slot = p.selectedSlotIndex, it = c.getItem(slot);
  if (!it || it.typeId !== typeOf(mob)) return;
  D.settle(rec, mob);                                              // loot made so far is rolled with the OLD size
  rec.n += 1;
  if (it.amount > 1) { it.amount -= 1; c.setItem(slot, it); } else c.setItem(slot, undefined);
  save(b, rec);
  say(p, "§a[Spawners] Stacked! §f" + nameOf(mob) + " Spawner x" + rec.n); snd(p, "random.anvil_use", 0.5, 1.6);
}
/** gives the spawner item back. Own function on purpose: inv.give() puts "minecraft:" in front of every id, which is wrong for our custom blocks (smp:...) */
export function giveSpawner(p, mob, qty) {
  const id = typeOf(mob), c = container(p);
  let left = qty;
  while (left > 0) {
    let max = 64; try { max = new ItemStack(id, 1).maxAmount; } catch (e) { /* default */ }
    const n = Math.min(max, left);
    const rest = c.addItem(new ItemStack(id, n));
    if (rest) p.dimension.spawnItem(rest, p.location);               // full inventory -> drops at your feet, never lost
    left -= n;
  }
}
/** owner / admin breaks the block: everything stored is paid out first (nothing is ever lost or dropped as a pile of entities) */
function breakSpawner(p, b, mob, tool) {
  if (!stillThere(b, mob)) return;
  const rec = load(b);
  if (!(rec && rec.fr?.[p.id]?.b) && !staffFull(p) && !canEditBlock(p, b)) return;   // protected land (a friend with "break" / staff may still pick it up)
  let n = 1;
  if (rec && !allowed(p, rec, "b")) return say(p, mine(p, rec) ? "§c[Spawners] The owner did not allow you to break this spawner." : "§c[Spawners] This spawner belongs to §f" + rec.on + "§c.");   // checked FIRST: nobody can destroy someone else's spawner
  {                                                                // tool rule - applies to EVERYONE, admins too
    const name = String(tool ?? "").replace(/^minecraft:/, "");
    if (D.WEAK_PICKS.includes(name)) {                             // too weak: the spawner is destroyed
      b.setType("minecraft:air"); forget(b);
      say(p, "§c[Spawners] Your pickaxe was too weak - the spawner was destroyed! §7Only a §bDiamond §7or §5Netherite §7pickaxe can pick it up."); snd(p, "random.break", 0.8, 0.8);
      return;
    }
    if (!D.STRONG_PICKS.includes(name)) return say(p, "§c[Spawners] You need a §bDiamond §cor §5Netherite §cpickaxe to pick up a spawner.");
  }
  if (rec) {
    D.settle(rec, mob); n = Math.max(1, rec.n);
    for (const id of Object.keys(rec.l)) {                          // check first: everything must fit, or nothing happens
      const q = rec.l[id] ?? 0, space = spaceFor(p, id);
      if (q > 0 && space >= 0 && q > space) return say(p, "§c[Spawners] Collect the loot first - your inventory cannot hold all of it.");
    }
    for (const id of Object.keys(rec.l)) if ((rec.l[id] ?? 0) > 0 && spaceFor(p, id) >= 0) give(p, id, rec.l[id]);
    const xp = Math.floor(rec.x ?? 0); if (xp > 0) { try { giveXp(p, xp); } catch (e) { /* ignore */ } }
  }
  b.setType("minecraft:air"); forget(b);
  giveSpawner(p, mob, n);
  say(p, "§a[Spawners] Picked up §f" + nameOf(mob) + " Spawner x" + n); snd(p, "random.pop", 0.8, 0.9);
}

// ---------------------------------------------------------------- events
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    if (block.typeId === "minecraft:mob_spawner") {                // an old vanilla spawner item
      if (D.OLD_SPAWNERS !== "remove") return;
      system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } });
      say(player, "§c[Spawners] Old spawners are disabled. Buy the new stacked spawners in §f/shop §c(Shards Shop).");
      return;
    }
    const mob = mobOf(block.typeId); if (!mob) return;
    if (!canEditBlock(player, block)) return;                       // the land guard removes it
    save(block, D.newRec(player.id, player.name));
    say(player, "§a[Spawners] §f" + nameOf(mob) + " Spawner §aplaced. §7Right-click to open it. Hold another one and click to stack.");
    snd(player, "random.anvil_use", 0.4, 1.4);
  } catch (e) { console.warn("[spawners] place: " + e); }
}));
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, mob = mobOf(b.typeId); if (!mob) return;
  const p = ev.player; ev.cancel = true;                            // handled below, in one place, with the data
  const tool = ev.itemStack?.typeId;
  system.run(() => { try { breakSpawner(p, b, mob, tool); } catch (e) { console.warn("[spawners] break: " + e); } });
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const b = ev.block, mob = mobOf(b.typeId); if (!mob) return;
  const p = ev.player;
  if (p.isSneaking) return;                                         // sneaking = vanilla (build next to it)
  let friendOk = false; try { friendOk = allowed(p, load(b), "open"); } catch (e) { friendOk = false; }
  if (!friendOk && !canEditBlock(p, b)) return;                     // protected land: the land guard answers (friends / staff may still open it)
  ev.cancel = true;
  if (ev.isFirstEvent === false || formBusy.has(p.id)) return;
  const held = ev.itemStack?.typeId;
  system.run(() => { try { if (held === typeOf(mob)) stackAdd(p, b, mob); else page(p, b, mob); } catch (e) { console.warn("[spawners] interact: " + e); } });
}));

// ---------------------------------------------------------------- old vanilla spawners: removed near players (one fill command per player, no drops, never throws)
const told = new Map();
safe("old spawner cleanup", () => system.runInterval(() => {
  if (D.OLD_SPAWNERS !== "remove") return;
  for (const p of world.getAllPlayers()) {
    try {
      const hr = p.dimension.heightRange, y = Math.floor(p.location.y);
      const lo = Math.max(-15, hr.min - y), hi = Math.min(15, hr.max - 1 - y);
      if (hi < lo) continue;
      const r = p.runCommand("fill ~-15 ~" + lo + " ~-15 ~15 ~" + hi + " ~15 air replace mob_spawner");
      if (r && r.successCount > 0) {
        const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 60000) continue; told.set(p.id, now);
        say(p, "§c[Spawners] Old spawners are disabled. Buy the new stacked spawners in §f/shop §c(Shards Shop).");
      }
    } catch (e) { /* nothing matched, or the area is not loaded */ }
  }
}, 200));
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => told.delete(playerId)));
