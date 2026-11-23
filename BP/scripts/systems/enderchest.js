// ===================================================================================================================
// ENDER CHEST of a player (/opr > Players > a player > Inventory > Ender chest)  -  ADMIN / OWNER only, online players only
//
//   * see every item of his ender chest (icons, amounts, names, enchantments, durability)
//   * take an item (all / half / 1) -> the REAL item goes into the admin's inventory (with all its data)
//   * clear the whole ender chest (for cheaters)
// The SMP pack runs on script API 2.0.0, which can not read an ender chest (that came in 2.8.0).  So a tiny helper pack
// "SMP Ender View" (folder enderview/, script API 2.8.0) does the reading / moving and answers by script event.
// If the helper pack is not there (or the game is too old for it): the page says so, and "Clear" still works with the
// game's own command (replaceitem ... slot.enderchest), which every version has.
// An operator's ender chest: only the Owner may take / clear (like the inventory tools).  Everything is in the staff log.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { makeOpr as make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, roleOf, slog } from "./staffcore.js";
import { isStaff } from "./opcore.js";
import { oprMsg } from "./oprlang.js";
import { CATEGORIES } from "../shop_data.js";
import { realId } from "../alias.js";

const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const pretty = (id) => String(id).replace(/^minecraft:/, "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
export const isAdminRole = (p) => { try { const r = roleOf(p); return r === "admin" || r === "owner"; } catch (e) { return false; } };
const ICONS = new Map();
try { for (const c of CATEGORIES) for (const it of c.items) { if (!ICONS.has(it[0])) ICONS.set(it[0], it[2]); try { const r = String(realId(it[0], it[1])).replace("minecraft:", ""); if (!ICONS.has(r)) ICONS.set(r, it[2]); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
const iconOf = (id) => { const k = String(id).replace(/^minecraft:/, ""); return ICONS.get(k) ?? "textures/items/" + k; };

// ---------------------------------------------------------------- talking to the helper pack
let seq = 0;
const waiting = new Map();                     // req -> { done, t }
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "smp:ec_r") return;
  let r; try { r = JSON.parse(ev.message); } catch (e) { return; }
  const w = waiting.get(r.req); if (!w) return;
  waiting.delete(r.req); w.done(r);
});
system.runInterval(() => { const t = system.currentTick; for (const [k, w] of waiting) if (t - w.t > 40) { waiting.delete(k); w.done(null); } }, 5);
/** asks the helper; cb(answer) - answer = null when the helper did not answer within 2 s */
function ask(op, data, cb) {
  const req = "ec" + ++seq + "_" + system.currentTick;
  waiting.set(req, { done: cb, t: system.currentTick });
  try { system.sendScriptEvent("smp:ec", JSON.stringify({ req, op, ...data })); } catch (e) { waiting.delete(req); cb(null); }
}
/** clear without the helper: the game's command, slot by slot */
function clearByCommand(t) {
  let n = 0;
  for (let i = 0; i < 27; i++) { try { const r = t.runCommand(`replaceitem entity @s slot.enderchest ${i} air`); if (r.successCount > 0) n++; } catch (e) { /* ignore */ } }
  return n;
}
function blocked(player, t) {
  if (!isAdminRole(player)) return "Only an Admin or the Owner can open ender chests.";
  if (!t) return "He is offline - an ender chest can only be read while he is online.";
  try { if (t.id !== player.id && isStaff(t) && !isOwner(player)) return "He is an operator - only the Owner can do this to an operator."; } catch (e) { /* ignore */ }
  return "";
}

// ---------------------------------------------------------------- the page
export function enderPage(player, id, name, back) {
  const t = online(id), why = blocked(player, t);
  if (why) { say(player, "§c[Operator] " + why); return back(); }
  const self = () => enderPage(player, id, name, back);
  ask("get", { target: id }, (r) => system.run(() => {
    const f = make(name + " §8- Ender chest", 6); f.self = self; f.glass = true;
    if (!r || !r.ok) {
      const noHelper = !r || r.err === "noapi";
      set(f, 1 * COLS + 4, hdr(1, "r") + "§5§lEnder chest\n§r§7" + (noHelper ? "The helper pack §fSMP Ender View§7 is not\n§r§7active (or the game is too old for it).\n§r§7Turn it on in the world's behavior packs\n§r§7to SEE and TAKE items." : "Could not read it: §f" + r.err), "textures/blocks/ender_chest_front", null);
      clearBtn(f, player, id, name, self, true);
      backBtn(f, back); status(player, f);
      return open(player, f);
    }
    const items = r.items ?? [];
    set(f, 0 * COLS + 4, hdr(Math.max(1, Math.min(99, items.length)), "g") + "§5§l" + name + "'s ender chest\n§r§7Stacks: §f" + items.length + "§7/§f" + (r.size ?? 27) + "\n§r§eClick an item to take it", "textures/blocks/ender_chest_front", null);
    for (const it of items) {
      if (it.slot < 0 || it.slot > 26) continue;
      let lines = "";
      if (it.name) lines += "\n§r§7Name: §f" + it.name;
      if (it.ench?.length) lines += "\n§r§b" + it.ench.slice(0, 6).map(([e, l]) => pretty(e) + " " + l).join("§7, §b");
      if (it.dur) lines += "\n§r§7Durability: §f" + it.dur[0] + "§7/§f" + it.dur[1];
      set(f, 1 * COLS + it.slot, hdr(it.n, it.ench?.length ? "x" : "c") + "§f§l" + pretty(it.id) + "\n§r§7x" + it.n + lines + "\n§r§eClick to take", iconOf(it.id), { run: () => takePage(player, id, name, it, self) });
    }
    clearBtn(f, player, id, name, self, false, items.length);
    backBtn(f, back); status(player, f);
    open(player, f);
  }));
}
function clearBtn(f, player, id, name, self, byCommand, n) {
  set(f, 4 * COLS + 4, hdr(Math.max(1, Math.min(99, n ?? 1)), "r") + "§c§lClear the ender chest\n§r§7Deletes EVERYTHING in it\n§r§7(for cheaters - can't be undone)\n§r§eClick", "textures/ui/shop/ic_fire", { run: () => confirm(player, "Clear " + name + "'s ender chest?", ["§cEverything in it is deleted.", "§7This can not be undone."], () => {
    const t = online(id), why = blocked(player, t); if (why) { say(player, "§c[Operator] " + why); return self(); }
    const done = (cnt, how) => { slog(player, "enderclear", { id, name }, "ender chest cleared (" + cnt + " stacks, " + how + ")"); say(player, "§a[Operator] " + name + "'s ender chest was cleared §7(" + cnt + " stacks)."); system.run(self); };
    if (byCommand) return done(clearByCommand(t), "command");
    ask("clear", { target: id }, (r) => { if (r && r.ok) done(r.n, "helper"); else done(clearByCommand(t), "command"); });
  }, self) });
}
function takePage(player, id, name, it, back) {
  const f = make("Take from the ender chest", 5); f.self = () => takePage(player, id, name, it, back); f.glass = true;
  set(f, 0 * COLS + 4, hdr(it.n, it.ench?.length ? "x" : "c") + "§f§l" + pretty(it.id) + "\n§r§7In his ender chest: §fx" + it.n + "\n§r§7It goes into YOUR inventory", iconOf(it.id), null);
  const opts = [[2, 0, "§a§lTake all", "x" + it.n]]; if (it.n > 1) { opts.push([4, Math.max(1, Math.floor(it.n / 2)), "§e§lTake half", "x" + Math.max(1, Math.floor(it.n / 2))]); opts.push([6, 1, "§f§lTake 1", "x1"]); }
  for (const [col, n, label, sub] of opts) set(f, 2 * COLS + col, hdr(1, "g") + label + "\n§r§7" + sub, NAV.ok, { run: () => {
    const t = online(id), why = blocked(player, t); if (why) { say(player, "§c[Operator] " + why); return back(); }
    ask("take", { target: id, admin: player.id, slot: it.slot, id: it.id, n }, (r) => system.run(() => {
      if (r && r.ok) { slog(player, "take", { id, name }, "ender chest: " + r.n + "x " + pretty(r.id)); say(player, "§a[Operator] Took §f" + r.n + "x " + pretty(r.id) + " §afrom " + name + "'s ender chest."); }
      else say(player, "§c[Operator] Not taken: " + (r ? (r.err === "full" ? "your inventory is full" : r.err === "changed" ? "the item changed - look again" : r.err) : "the helper pack did not answer"));
      back();
    }));
  } });
  backBtn(f, back);
  open(player, f);
}

// ===================================================================================================================
// EVERYTHING HE OWNS (/opr > Players > a player > Everything he owns)  -  Admin / Owner
//   one page: the backpack (3 rows) + the hotbar + armour + off hand + his levels + his ENDER CHEST (3 rows)
//   * online  = live (the ender chest through the helper pack SMP Ender View)
//   * offline = the last saved copy (inventory: saved every 30 s and when he leaves; ender chest: saved by the helper pack)
//   click an ender chest item (online) = take it; "Take items" opens the take page of the inventory
// ===================================================================================================================
const INVS = "invs:";
const desc = (s) => { let ench = [], dur = null; try { ench = (s.getComponent("minecraft:enchantable")?.getEnchantments() ?? []).map((e) => [e.type.id ?? String(e.type), e.level]); } catch (e) { /* ignore */ } try { const d = s.getComponent("minecraft:durability"); if (d) dur = [d.maxDurability - d.damage, d.maxDurability]; } catch (e) { /* ignore */ } return { id: s.typeId, n: s.amount, name: s.nameTag ?? "", ench, dur }; };
const EQ = ["Head", "Chest", "Legs", "Feet", "Offhand"];
function invSnap(p) {
  const out = { t: Date.now(), n: p.name, inv: [], eq: [], lv: 0 };
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it) out.inv.push({ slot: i, ...desc(it) }); } } catch (e) { /* ignore */ }
  try { const eq = p.getComponent("minecraft:equippable"); EQ.forEach((k, j) => { const it = eq?.getEquipment(k); if (it) out.eq.push({ slot: j, ...desc(it) }); }); } catch (e) { /* ignore */ }
  try { out.lv = p.level; } catch (e) { /* ignore */ }
  return out;
}
const lastInv = new Map();
function saveInv(id, snap) { try { const txt = JSON.stringify(snap); const key = txt.slice(txt.indexOf(',"inv"')); if (lastInv.get(id) === key) return; lastInv.set(id, key); world.setDynamicProperty(INVS + id, txt.length < 30000 ? txt : JSON.stringify({ ...snap, inv: snap.inv.slice(0, 30) })); } catch (e) { /* ignore */ } }
const readInv = (id) => { try { const v = world.getDynamicProperty(INVS + id); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } };
system.runInterval(() => { for (const p of world.getAllPlayers()) { try { saveInv(p.id, invSnap(p)); } catch (e) { /* ignore */ } } }, 600);
try { world.beforeEvents.playerLeave.subscribe(({ player }) => { try { const s = invSnap(player), id = player.id; system.run(() => saveInv(id, s)); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }

const agoTxt = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " days ago"; };
function itemText(it, tail) {
  let lines = "";
  if (it.name) lines += "\n§r§7Name: §f" + it.name;
  if (it.ench?.length) lines += "\n§r§b" + it.ench.slice(0, 6).map(([e, l]) => pretty(e) + " " + l).join("§7, §b");
  if (it.dur) lines += "\n§r§7Durability: §f" + it.dur[0] + "§7/§f" + it.dur[1];
  return hdr(Math.max(1, Math.min(99, it.n)), it.ench?.length ? "x" : "c") + "§f§l" + pretty(it.id) + "\n§r§7x" + it.n + lines + (tail ?? "");
}
export function ownsPage(player, id, name, back, takeInv) {
  if (!isAdminRole(player)) { say(player, "§c[Operator] Only an Admin or the Owner can see this."); return back(); }
  const self = () => ownsPage(player, id, name, back, takeInv), t = online(id);
  const inv = t ? invSnap(t) : readInv(id);
  if (t) saveInv(id, inv);
  ask(t ? "get" : "snap", { target: id }, (r) => system.run(() => {
    const f = make(name + " §8- everything he owns", 9); f.self = self; f.glass = true;
    if (inv) {
      for (const it of inv.inv ?? []) { const slot = it.slot >= 9 ? it.slot - 9 : 27 + it.slot; if (slot >= 0 && slot < 36) set(f, slot, itemText(it, it.slot < 9 ? "\n§r§8hotbar " + (it.slot + 1) : ""), iconOf(it.id), null); }
      for (const it of inv.eq ?? []) set(f, 4 * COLS + [1, 2, 3, 4, 6][it.slot], itemText(it, "\n§r§8" + ["helmet", "chestplate", "leggings", "boots", "off hand"][it.slot]), iconOf(it.id), null);
    }
    set(f, 4 * COLS + 0, hdr(1) + "§e§lArmour + off hand\n§r§7Rows 1-4 above: backpack + hotbar\n§r§7Rows 6-8 below: ENDER CHEST", NAV.shield, null);
    set(f, 4 * COLS + 8, hdr(Math.max(1, Math.min(99, inv?.lv ?? 0)), "g") + "§a§lLevels: §f" + (inv?.lv ?? 0) + "\n§r" + (t ? "§aOnline - live" : inv ? "§7Offline - saved §f" + agoTxt(inv.t) : "§cOffline - nothing saved yet"), "textures/items/experience_bottle", null);
    const ok = r && r.ok, items = ok ? r.items ?? [] : [];
    for (const it of items) { if (it.slot < 0 || it.slot > 26) continue; set(f, 5 * COLS + it.slot, itemText(it, t && !r.saved ? "\n§r§eClick to take" : "\n§r§8ender chest"), iconOf(it.id), t && !r.saved ? { run: () => takePage(player, id, name, it, self) } : null); }
    const ecInfo = !r ? "§cThe helper pack SMP Ender View\n§r§cdid not answer: turn it on in the\n§r§cworld's behavior packs" : !ok ? (r.err === "offline" || r.err === "nosnap" ? "§7No saved copy yet (it is saved\n§r§7every 30 s while he plays)" : "§cCould not read: " + r.err) : r.saved ? "§7Saved copy: §f" + agoTxt(r.t) : "§aLive §7- " + items.length + " stacks";
    set(f, 4 * COLS + 7, hdr(Math.max(1, Math.min(99, items.length)), ok ? "g" : "r") + "§5§lEnder chest\n§r" + ecInfo, "textures/blocks/ender_chest_front", null);
    if (!items.length) set(f, 6 * COLS + 4, hdr(1) + "§5Ender chest\n§r" + (ok ? "§7Empty" : ecInfo), "textures/blocks/ender_chest_front", null);
    if (t) {
      if (takeInv) set(f, 8 * COLS + 6, hdr(1, "g") + "§a§lTake items\n§r§7Take from his inventory / armour\n§r§7or his levels\n§r§eClick to open", NAV.chest, { run: () => takeInv(self) });
      clearBtn2(f, player, id, name, self, items.length);
    }
    backBtn(f, back); status(player, f);
    open(player, f);
  }));
}
function clearBtn2(f, player, id, name, self, n) {
  set(f, 8 * COLS + 7, hdr(Math.max(1, Math.min(99, n || 1)), "r") + "§c§lClear the ender chest\n§r§7Deletes EVERYTHING in it\n§r§eClick", "textures/ui/shop/ic_fire", { run: () => confirm(player, "Clear " + name + "'s ender chest?", ["§cEverything in it is deleted.", "§7This can not be undone."], () => {
    const t = online(id), why = blocked(player, t); if (why) { say(player, "§c[Operator] " + why); return self(); }
    const done = (cnt, how) => { slog(player, "enderclear", { id, name }, "ender chest cleared (" + cnt + " stacks, " + how + ")"); say(player, "§a[Operator] " + name + "'s ender chest was cleared §7(" + cnt + " stacks)."); system.run(self); };
    ask("clear", { target: id }, (r) => { if (r && r.ok) done(r.n, "helper"); else done(clearByCommand(t), "command"); });
  }, self) });
}
