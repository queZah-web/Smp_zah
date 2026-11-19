// CRATES: a crate block (looks like a shulker box) that the staff place with /smp:crate place.
//   * right-click the crate            -> shows the possible rewards + their chances
//   * right-click it holding the key   -> uses ONE key and gives a random reward
//   * keys are normal stackable items (up to 64) and every player gets one every 30 REAL minutes spent on the server
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system, ItemStack, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { makeOpr as make, set, open, hdr, COLS, NAV, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { showModal, textField, dropdown, confirmOpr as confirm } from "./forms.js";
import { slog, allow, can } from "./staffcore.js";
import { addMoney } from "../data.js";
import { giveSpawner } from "./spawners.js";
import { CATEGORIES } from "../shop_data.js";
import { realId } from "../alias.js";
import { SPAWNERS } from "../mobs.js";
import { ex } from "../smp/store.js";
import { notice } from "../smp/fxprefs.js";
import { playOpening, } from "./crateanim.js";
import { oprMsg, OprForm } from "./oprlang.js";

// =============================================================== SETTINGS (edit here)
// keyEveryMin : a player gets one key of this crate for every this-many minutes spent ON the server (real time, stackable keys)
// chance      : relative numbers (they do not have to add up to 100)
// reward types: { type: "item", id, amount } | { type: "money", amount } | { type: "xp", levels } | { type: "spawner", count, mobs?: [ids] }
//               spawner = random spawner(s) of ANY mob (or only of the mobs listed in `mobs`)
// Epic: iron + diamond armor / weapons (5% each).  Legendary: netherite armor / weapons (2.5% each) + random spawners.
export const CRATES = {
  rare: {
    name: "Rare Crate", color: "§b", block: "minecraft:light_blue_shulker_box", keyEveryMin: 30,
    key: { item: "minecraft:tripwire_hook", name: "§eRare Crate Key", lore: ["§7Hold this key and right-click", "§7a §bRare Crate §7to open it."] },
    rewards: [
      { type: "item", id: "minecraft:iron_ingot", amount: 12, chance: 20 },
      { type: "item", id: "minecraft:gold_ingot", amount: 6, chance: 18 },
      { type: "item", id: "minecraft:diamond", amount: 1, chance: 8 },
      { type: "item", id: "minecraft:ender_pearl", amount: 4, chance: 15 },
      { type: "money", amount: 200, chance: 12 },
      { type: "item", id: "minecraft:experience_bottle", amount: 8, chance: 15 },
      { type: "xp", levels: 5, chance: 12 },
    ],
  },
  epic: {
    name: "Epic Crate", color: "§5", block: "minecraft:purple_shulker_box", keyEveryMin: 12 * 60, realClock: true,
    key: { item: "minecraft:amethyst_shard", name: "§dEpic Crate Key", lore: ["§7Hold this key and right-click", "§7an §5Epic Crate §7to open it."] },
    rewards: [
      { type: "item", id: "minecraft:iron_ingot", amount: 18, chance: 20 },
      { type: "item", id: "minecraft:diamond_helmet", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_chestplate", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_leggings", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_boots", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_sword", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_axe", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:diamond_pickaxe", amount: 1, chance: 5 },
      { type: "item", id: "minecraft:gold_ingot", amount: 9, chance: 10 },
      { type: "item", id: "minecraft:ender_pearl", amount: 6, chance: 8 },
      { type: "money", amount: 300, chance: 8 },
      { type: "item", id: "minecraft:experience_bottle", amount: 12, chance: 8 },
      { type: "item", id: "minecraft:diamond", amount: 2, chance: 5 },
      { type: "xp", levels: 8, chance: 6 },
    ],
  },
  legendary: {
    name: "Legendary Crate", color: "§c", block: "minecraft:red_shulker_box", keyEveryMin: 24 * 60, realClock: true,
    key: { item: "minecraft:nether_star", name: "§6Legendary Crate Key", lore: ["§7Hold this key and right-click", "§7a §cLegendary Crate §7to open it."] },
    rewards: [
      { type: "item", id: "minecraft:gold_ingot", amount: 14, chance: 20 },
      { type: "item", id: "minecraft:ender_pearl", amount: 9, chance: 16 },
      { type: "money", amount: 450, chance: 16 },
      { type: "xp", levels: 12, chance: 14 },
      { type: "item", id: "minecraft:diamond", amount: 3, chance: 12 },
      { type: "item", id: "minecraft:netherite_helmet", amount: 1, chance: 2.5 },
      { type: "item", id: "minecraft:netherite_chestplate", amount: 1, chance: 2.5 },
      { type: "item", id: "minecraft:netherite_leggings", amount: 1, chance: 2.5 },
      { type: "item", id: "minecraft:netherite_boots", amount: 1, chance: 2.5 },
      { type: "item", id: "minecraft:netherite_sword", amount: 1, chance: 2.5 },
      { type: "item", id: "minecraft:netherite_axe", amount: 1, chance: 2.5 },
      { type: "spawner", count: 1, chance: 5 },          // 1 random spawner (hard to get)
      { type: "spawner", count: 2, chance: 2 },          // 2 random spawners (very hard to get)
    ],
  },
};
// =============================================================================================

// =============================================================== ADMIN EDITING (saved in the world)
// The staff can change, IN GAME (crate > "Edit this crate", or Operator > World > Crates > Edit crates):
//   * the chance of every reward (relative numbers, the page shows the real % )     * add / change / delete rewards (item, money, XP, spawner)
//   * how often a player gets a key (minutes)                                       * reset a crate back to the settings written above
// Only crates that were changed are saved (world property "crates:cfg:v1"); everything else keeps the settings written above.
const CFG_KEY = "crates:cfg:v1", MAX_REWARDS = 27, TYPES = ["item", "money", "xp", "spawner"];
const clone = (o) => JSON.parse(JSON.stringify(o));
const DEFAULTS = Object.fromEntries(Object.entries(CRATES).map(([id, d]) => [id, clone({ keyEveryMin: d.keyEveryMin, rewards: d.rewards })]));
const shapeOk = (r) => !!r && typeof r === "object" && Number.isFinite(r.chance) && r.chance > 0 && (
  (r.type === "item" && typeof r.id === "string" && Number.isInteger(r.amount) && r.amount >= 1) ||
  (r.type === "money" && Number.isInteger(r.amount) && r.amount >= 1) ||
  (r.type === "xp" && Number.isInteger(r.levels) && r.levels >= 1) ||
  (r.type === "spawner" && Number.isInteger(r.count) && r.count >= 1 && (r.mobs === undefined || (Array.isArray(r.mobs) && r.mobs.length > 0))));
let cfgLoaded = false;
function ensureCfg() {
  if (cfgLoaded) return true;
  try {
    const raw = world.getDynamicProperty(CFG_KEY);
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      for (const [id, sv] of Object.entries(o ?? {})) {
        const def = CRATES[id]; if (!def || !sv) continue;
        if (Number.isFinite(sv.keyEveryMin) && sv.keyEveryMin >= 1) def.keyEveryMin = sv.keyEveryMin;
        if (Array.isArray(sv.rewards)) { const ok = sv.rewards.filter(shapeOk); if (ok.length) def.rewards = ok; }
      }
    }
    cfgLoaded = true;                                           // nothing saved = the settings written above
  } catch (e) { return false; }                                 // world not ready yet: try again later (never overwrite saved data)
  return true;
}
if (!ensureCfg()) {
  const rid = system.runInterval(() => { if (ensureCfg()) system.clearRun(rid); }, 20);
  try { world.afterEvents.worldLoad.subscribe(() => { ensureCfg(); }); } catch (e) { /* older versions */ }
}
function persistCfg() {
  try {
    const out = {};
    for (const [id, def] of Object.entries(CRATES)) {
      const d = DEFAULTS[id];
      if (def.keyEveryMin !== d.keyEveryMin || JSON.stringify(def.rewards) !== JSON.stringify(d.rewards)) out[id] = { keyEveryMin: def.keyEveryMin, rewards: def.rewards };
    }
    world.setDynamicProperty(CFG_KEY, Object.keys(out).length ? JSON.stringify(out) : undefined);
    return true;
  } catch (e) { console.warn("[crate] settings save failed: " + e); return false; }
}
/** applies a change to one crate and saves it; if the save fails the crate goes back to how it was. Returns { ok } or { err } */
function commit(typeId, change) {
  if (!ensureCfg()) return { err: "The crate settings are not ready yet. Try again in a moment." };
  const def = CRATES[typeId]; if (!def) return { err: "Unknown crate." };
  const before = { keyEveryMin: def.keyEveryMin, rewards: def.rewards };
  const undo = () => { def.keyEveryMin = before.keyEveryMin; def.rewards = before.rewards; };
  try { change(def); } catch (e) { undo(); return { err: "Could not apply the change." }; }
  if (!persistCfg()) { undo(); return { err: "Could not save the change." }; }
  refreshHolos(typeId);
  return { ok: true };
}
/** the "New key every ..." line over the crates of this type shows the new time at once */
function refreshHolos(typeId) {
  const def = CRATES[typeId]; if (!def) return;
  for (const c of load() ?? []) {
    if (c.id !== typeId) continue;
    try {
      const dim = dimOf(c.d); if (!dim) continue;
      const h = holosOf(dim, c); if (h.length !== HOLO_LINES) continue;
      h.sort((a, b) => b.location.y - a.location.y);
      h[1].nameTag = staticTimer(def); liveTimer.delete(c.d + "_" + c.x + "_" + c.y + "_" + c.z);
    } catch (e) { /* ignore: the next check fixes it */ }
  }
}
// =============================================================================================

const DATA_KEY = "crates:v1";
const HOLO = "shop:holo", HOLO_TAG = "crate_holo";
const DIMS = ["overworld", "nether", "the_end"];
const dimOf = (id) => { try { return world.getDimension(id); } catch (e) { return null; } };
const valid = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (er) { return false; } };
const pretty = (id) => String(id).replace("minecraft:", "").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(s % 60).padStart(2, "0"); };
const everyText = (def) => (def.keyEveryMin % 60 === 0 ? def.keyEveryMin / 60 + " hour" + (def.keyEveryMin === 60 ? "" : "s") : def.keyEveryMin + " minutes");
const keyMs = (def) => def.keyEveryMin * 60 * 1000;

// ------------------------------------------------------------------ saved crates
let crates = null;                                  // [{ id: crate type, d: dimension id, x, y, z }]
function load() {
  if (crates) return crates;
  try {
    const raw = world.getDynamicProperty(DATA_KEY);
    const a = typeof raw === "string" ? JSON.parse(raw) : [];
    crates = Array.isArray(a) ? a : [];
  } catch (e) { return null; }                      // world not ready: touch nothing
  return crates;
}
function save() { try { world.setDynamicProperty(DATA_KEY, JSON.stringify(crates)); } catch (e) { console.warn("[crate] save failed: " + e); } }
const crateAt = (dimId, x, y, z) => (load() ?? []).find((c) => c.d === dimId && c.x === x && c.y === y && c.z === z);

// ------------------------------------------------------------------ rewards
const rewardText = (r) => r.type === "item" ? "§e" + r.amount + "x " + pretty(r.id) : r.type === "money" ? "§a" + r.amount + " money" : r.type === "spawner" ? "§c" + r.count + "x Random Spawner" : "§b" + r.levels + " XP levels";
const totalChance = (def) => def.rewards.reduce((s, r) => s + r.chance, 0);
const pct = (def, r) => (Math.round((r.chance / totalChance(def)) * 1000) / 10).toFixed(1);
function roll(def) {
  let n = Math.random() * totalChance(def);
  for (const r of def.rewards) { n -= r.chance; if (n < 0) return r; }
  return def.rewards[def.rewards.length - 1];
}
function giveItem(p, item) {
  let left;
  try { left = p.getComponent("inventory").container.addItem(item); } catch (e) { left = item; }
  if (left) { try { p.dimension.spawnItem(left, p.location); p.sendMessage(oprMsg(p, "§e[Crate] §7Your inventory is full: the item was dropped at your feet.")); } catch (e) { /* ignore */ } }
}
/** gives the reward; returns the text to show the player (a spawner shows which mob it was) */
function giveReward(p, r) {
  if (r.type === "item") giveItem(p, new ItemStack(r.id, r.amount));
  else if (r.type === "money") addMoney(p, r.amount);
  else if (r.type === "xp") p.addLevels(r.levels);
  else if (r.type === "spawner") {
    const pool = (r.mobs ? SPAWNERS.filter((m) => r.mobs.includes(m.id)) : SPAWNERS), got = [];
    for (let i = 0; i < r.count; i++) { const m = pool[Math.floor(Math.random() * pool.length)]; giveSpawner(p, m.id, 1); got.push(m.name + " Spawner"); }
    return "§c" + got.join("§7, §c");
  }
  return rewardText(r);
}

// ------------------------------------------------------------------ keys
export function makeKey(typeId, amount = 1) {
  const k = CRATES[typeId].key, it = new ItemStack(k.item, Math.max(1, Math.min(64, amount)));
  it.nameTag = k.name; it.setLore([...k.lore, "§8crate:" + typeId]);       // same name + same lore = the keys stack
  return it;
}
export function keyType(item) {
  try {
    if (!item) return null;
    const lore = item.getLore();
    const mark = lore.find((l) => l.startsWith("§8crate:"));
    if (!mark) return null;
    const id = mark.slice(8), def = CRATES[id];
    return def && item.typeId === def.key.item && item.nameTag === def.key.name ? id : null;
  } catch (e) { return null; }
}
export function giveKeys(p, typeId, amount) {
  let left = Math.max(1, amount | 0);
  while (left > 0) { const n = Math.min(64, left); giveItem(p, makeKey(typeId, n)); left -= n; }
}

// ------------------------------------------------------------------ the crate page (same chest-style screen as every other page of the pack)
const timers = (p) => { const k = (ex(p).crate ??= {}); k.t ??= {}; if (typeof k.ms === "number") { k.t.rare = (k.t.rare ?? 0) + k.ms; delete k.ms; } return k.t; };      // old saves: one timer -> per crate timers
// realClock crates (12h / 24h): the clock starts at the player's first join and keeps running while he is OFFLINE; missed keys are given when he joins / is online.
const rclock = (p) => { const k = (ex(p).crate ??= {}); return (k.rc ??= {}); };
function nextKeyMs(p, typeId) {
  const def = CRATES[typeId];
  if (def.realClock) { const every = keyMs(def), st = rclock(p)[typeId]; if (typeof st !== "number") return every; return every - ((Date.now() - st) % every); }
  return keyMs(def) - (timers(p)[typeId] ?? 0);
}
function countKeys(p, typeId) {
  let n = 0;
  try { const cont = p.getComponent("inventory").container; for (let i = 0; i < cont.size; i++) { const it = cont.getItem(i); if (it && keyType(it) === typeId) n += it.amount; } } catch (e) { /* ignore */ }
  return n;
}
const SHOP_ICON = new Map();                                    // real game id -> the shop icon (blocks and items look right in the crate page)
try {
  for (const c of CATEGORIES) for (const it of c.items) {
    let real = null; try { real = String(realId(it[0], it[1])); } catch (e) { /* ignore */ }
    if (real && !SHOP_ICON.has(real)) SHOP_ICON.set(real, it[2]);
    const b = "minecraft:" + it[0]; if (!SHOP_ICON.has(b)) SHOP_ICON.set(b, it[2]);
  }
} catch (e) { console.warn("[crate] icons: " + e); }
const iconOf = (r) => r.icon ?? (r.type === "item" ? (SHOP_ICON.get(r.id) ?? "textures/items/" + r.id.replace("minecraft:", "")) : r.type === "money" ? "textures/items/emerald" : r.type === "spawner" ? "textures/ui/shop/ic_spawner" : "textures/items/book_enchanted");
function infoForm(p, typeId, c) {
  ensureCfg();
  const def = CRATES[typeId]; if (!def) return;
  const f = make(def.name, SHORT_ROWS); f.self = () => infoForm(p, typeId, c);
  const keyName = def.key.name;
  set(f, 0 * COLS + 4, hdr(1) + def.color + "§l" + def.name + "\n§r§7Requires key: " + keyName + "\n§r§7Hold the key and §aright-click §7the crate\n§r§7Your keys: §f" + countKeys(p, typeId) +
    "\n§r§7New key every §f" + everyText(def) + (def.realClock ? " §7(real time)" : " §7online") + "\n§r§7Next key in §f" + mmss(nextKeyMs(p, typeId)), NAV.chest, null);
  const n = def.rewards.length, nRows = n <= 9 ? 1 : n <= 18 ? 2 : 3, firstRow = nRows === 1 ? 2 : 1;
  const rowsOf = Array.from({ length: nRows }, (_, i) => Math.floor(n / nRows) + (i < n % nRows ? 1 : 0));
  let k = 0;
  rowsOf.forEach((cnt, ri) => {
    const start = Math.floor((9 - cnt) / 2);
    for (let i = 0; i < cnt; i++, k++) {
      const r = def.rewards[k], rare = r.chance / totalChance(def) <= 0.1;
      set(f, (firstRow + ri) * COLS + start + i, hdr(r.type === "item" ? r.amount : r.type === "spawner" ? r.count : 1, rare ? "g" : "c") + rewardText(r) + "\n§r§7Chance: §f" + pct(def, r) + "%" + (rare ? "\n§r§6Rare!" : ""), iconOf(r), null);
    }
  });
  set(f, 4 * COLS + 0, hdr(1) + "§cClose", NAV.no, { run: () => { } });
  if (can(p, "crates")) set(f, 4 * COLS + 8, hdr(1, "g") + "§e§lEdit this crate\n§r§7Change the chances, the rewards\n§r§7and the key time\n§r§8(Staff only)", "textures/ui/shop/ic_gear", { run: () => crateEditPage(p, typeId, () => infoForm(p, typeId, c)) });
  // staff shortcut: "X" removes THIS crate (the one that was just opened), after a confirm. Works for Rare / Epic / Legendary.
  if (c && can(p, "crates")) set(f, 4 * COLS + 7, hdr(1, "r") + "§c§lX  Remove this crate\n§r§7Removes this " + def.color + def.name + "\n§r§7from the world\n§r§8(Staff only)", NAV.no, { run: () => confirm(p, "Remove " + def.name, ["§7Removes THIS crate from the world", "§7(" + c.x + " " + c.y + " " + c.z + ")."], () => { if (allow(p, "crates")) removeCrate(p, c); }, () => infoForm(p, typeId, c)) });
  status(p, f);
  open(p, f);
}

// ------------------------------------------------------------------ opening
const lastUse = new Map();
function useCrate(p, c) {
  const def = CRATES[c.id]; if (!def) return;
  const now = Date.now();
  if (now - (lastUse.get(p.id) ?? 0) < 600) return;            // touch screens send several events for one tap
  lastUse.set(p.id, now);
  ensureCfg();
  if (p.isSneaking && can(p, "crates")) { crateEditPage(p, c.id, () => infoForm(p, c.id, c)); return; }      // staff: sneak + right-click = edit this crate (no key is used)
  const slot = p.getComponent("equippable")?.getEquipmentSlot("Mainhand");
  const held = slot?.getItem();
  if (keyType(held) !== c.id) { infoForm(p, c.id, c); return; }
  const ckey = c.d + ":" + c.x + ":" + c.y + ":" + c.z;
  if (busy.has(ckey)) { p.sendMessage(oprMsg(p, "§e[Crate] §7Someone is opening this crate right now - wait a moment.")); return; }
  if (animBy.has(p.id)) return;
  if (held.amount <= 1) slot.setItem(undefined); else { held.amount -= 1; slot.setItem(held); }
  const r = roll(def), idx = def.rewards.indexOf(r), rewards = def.rewards.slice();
  const pid = addPending(p.id, c.id, r);                         // saved BEFORE the show: if anything goes wrong the reward is still delivered
  const deliver = () => { if (removePending(p.id, pid)) payOut(p, c.id, r); };       // only gives it if it was still pending (never twice)
  busy.set(ckey, Date.now()); animBy.set(p.id, ckey);
  try {
    const h = playOpening({
      player: p, dim: p.dimension, pos: { x: c.x, y: c.y, z: c.z }, rewards, winner: idx >= 0 ? idx : 0,
      iconOf, labelOf: (x) => rewardText(x),
      onReward: () => { if (valid(p)) deliver(); },              // player gone: it stays pending and is delivered when he is back
      onClosed: () => { busy.delete(ckey); animBy.delete(p.id); },
    });
    if (busy.has(ckey)) busy.set(ckey, h);
  } catch (e) {
    console.warn("[crate] animation: " + e);
    busy.delete(ckey); animBy.delete(p.id); deliver();           // animation problem: old behaviour, the reward is given at once
  }
}
/** gives the reward + the chat messages */
function payOut(p, typeId, r) {
  const def = CRATES[typeId]; if (!def) return;
  const txt = giveReward(p, r);
  p.sendMessage(oprMsg(p, "§a[Crate] §fYou opened a " + def.color + def.name + "§f and got: " + txt + " §7(" + pct(def, r) + "%)"));
  if (r.chance / totalChance(def) <= 0.1) notice("crate", "§b[Crate] §f" + p.name + " §7won " + txt + " §7from a " + def.color + def.name + "§7!");
}
// ---- rewards that were rolled but not delivered yet (player left during the show / reload): saved in the world, delivered later
const PEND_KEY = "crates:pending:v1";
const busy = new Map(), animBy = new Map();                    // crate key -> show handle | player id -> crate key
function loadPending() { try { const raw = world.getDynamicProperty(PEND_KEY); return typeof raw === "string" ? JSON.parse(raw) : {}; } catch (e) { return {}; } }
function savePending(o) { try { world.setDynamicProperty(PEND_KEY, Object.keys(o).length ? JSON.stringify(o) : undefined); } catch (e) { console.warn("[crate] pending save failed: " + e); } }
function addPending(playerId, typeId, r) {
  const o = loadPending(), n = Date.now() + "" + Math.floor(Math.random() * 1000);
  (o[playerId] ??= []).push({ n, t: typeId, r: clone(r) }); savePending(o); return n;
}
function removePending(playerId, n) {
  const o = loadPending(), l = o[playerId]; if (!l) return false;
  const i = l.findIndex((x) => x.n === n); if (i < 0) return false;
  l.splice(i, 1); if (!l.length) delete o[playerId]; savePending(o); return true;
}
function claimPending(p) {
  try {
    if (animBy.has(p.id)) return;
    const l = loadPending()[p.id]; if (!l || !l.length) return;
    for (const x of [...l]) {
      if (!CRATES[x.t]) { removePending(p.id, x.n); continue; }
      if (removePending(p.id, x.n)) { p.sendMessage(oprMsg(p, "§e[Crate] §7A reward from a crate you opened was waiting for you:")); payOut(p, x.t, x.r); }
    }
  } catch (e) { console.warn("[crate] claim: " + e); }
}
system.runInterval(() => {
  try {
    const o = loadPending(); if (!Object.keys(o).length) return;
    for (const p of world.getAllPlayers()) if (o[p.id]) claimPending(p);
    const now = Date.now(); for (const [k, v] of [...busy]) if (now - (typeof v === "number" ? v : v?.t ?? now) > 40000) busy.delete(k);
  } catch (e) { /* ignore */ }
}, 200);
try { world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => { if (initialSpawn) system.runTimeout(() => { try { claimPending(player); } catch (e) { /* ignore */ } }, 80); }); } catch (e) { /* ignore */ }
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const b = ev.block, c = crateAt(b.dimension.id, b.x, b.y, b.z);
    if (!c) { if (keyType(ev.itemStack)) ev.cancel = true; return; }      // a key is never placed as a block
    ev.cancel = true;                                          // the shulker box never opens
    if (!ev.isFirstEvent) return;
    const p = ev.player;
    system.run(() => { try { useCrate(p, c); } catch (e) { console.warn("[crate] use: " + e); } });
  } catch (e) { /* ignore */ }
});

// ------------------------------------------------------------------ protection
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  try {
    const b = ev.block;
    if (!crateAt(b.dimension.id, b.x, b.y, b.z)) return;
    ev.cancel = true;
    const p = ev.player; system.run(() => { try { p.sendMessage(oprMsg(p, "§c[Crate] A crate can't be broken.")); } catch (e) { /* ignore */ } });
  } catch (e) { /* ignore */ }
});
try {
  world.beforeEvents.explosion.subscribe((ev) => {
    try { ev.setImpactedBlocks(ev.getImpactedBlocks().filter((b) => !crateAt(b.dimension.id, b.x, b.y, b.z))); } catch (e) { /* ignore */ }
  });
} catch (e) { /* not available */ }

// ------------------------------------------------------------------ crate block + floating name
const HOLO_LINES = 3, TIMER_RANGE = 12;
const staticTimer = (def) => "§7New key every §f" + everyText(def);          // shown when nobody is near the crate
const holosOf = (dim, c) => { try { return dim.getEntities({ type: HOLO, tags: [HOLO_TAG, "ch_" + c.x + "_" + c.y + "_" + c.z] }); } catch (e) { return []; } };
function spawnHolo(dim, c) {
  const def = CRATES[c.id]; if (!def) return;
  const lines = [def.color + "§l" + def.name, staticTimer(def), "§7Right-click to open"];       // line 2 = the key timer (updateTimers() below keeps it live)
  for (let i = 0; i < lines.length; i++) {
    try {
      const e = dim.spawnEntity(HOLO, { x: c.x + 0.5, y: c.y + 1.45 + (lines.length - 1 - i) * 0.27, z: c.z + 0.5 });
      e.nameTag = lines[i]; e.addTag(HOLO_TAG); e.addTag("ch_" + c.x + "_" + c.y + "_" + c.z);
    } catch (e) { /* chunk not ready: the next check tries again */ }
  }
}
function removeHolo(dim, c) { for (const e of holosOf(dim, c)) { try { e.remove(); } catch (er) { /* ignore */ } } }
function check() {
  const list = load(); if (!list) return;
  for (const c of list) {
    try {
      const dim = dimOf(c.d), def = CRATES[c.id]; if (!dim || !def) continue;
      const b = dim.getBlock({ x: c.x, y: c.y, z: c.z });
      if (!b) continue;                                       // chunk not loaded
      if (b.typeId !== def.block) b.setType(def.block);       // somebody moved / replaced it: put it back
      const h = holosOf(dim, c);
      if (h.length !== HOLO_LINES) { for (const e of h) { try { e.remove(); } catch (er) { /* ignore */ } } spawnHolo(dim, c); }      // (older crates with 2 lines are rebuilt with the timer line)
    } catch (e) { /* ignore */ }
  }
}
system.runInterval(check, 100);
system.runTimeout(check, 100);

// ---- the key timer line (under the crate name).  The key timers are PER PLAYER, so the line shows the time left for the player NEAREST to the crate
//      (within TIMER_RANGE blocks; "(name)" is added when a second player is in range). Nobody near = "New key every ...".
const liveTimer = new Set();                                   // crates whose timer line shows a countdown right now
function updateTimers() {
  const list = load(); if (!list) return;
  for (const c of list) {
    try {
      const def = CRATES[c.id], dim = dimOf(c.d); if (!def || !dim) continue;
      const key = c.d + "_" + c.x + "_" + c.y + "_" + c.z;
      let near = [];
      try { near = dim.getPlayers({ location: { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, maxDistance: TIMER_RANGE, closest: 2 }); } catch (e) { near = []; }
      if (!near.length && !liveTimer.has(key)) continue;       // nobody near and the line is already the plain text: nothing to do
      const text = near.length ? "§7Next key in §f" + mmss(nextKeyMs(near[0], c.id)) + (near.length > 1 ? " §8(" + near[0].name + ")" : "") : staticTimer(def);
      const h = holosOf(dim, c); if (h.length !== HOLO_LINES) continue;
      h.sort((a, b) => b.location.y - a.location.y);           // top = name, 2nd = timer, 3rd = right-click
      if (h[1].nameTag !== text) h[1].nameTag = text;
      if (near.length) liveTimer.add(key); else liveTimer.delete(key);
    } catch (e) { /* ignore: the next second tries again */ }
  }
}
system.runInterval(updateTimers, 20);

function place(p, typeId) {
  const def = CRATES[typeId]; if (!def) return p.sendMessage(oprMsg(p, "§c[Crate] Unknown crate type. Types: §f" + Object.keys(CRATES).join(", ")));
  const list = load(); if (!list) return p.sendMessage(oprMsg(p, "§c[Crate] Data not ready, try again."));
  // the block 2 steps in FRONT of the operator (the way he looks, on his own level; one up if that spot is taken)
  const v = p.getViewDirection(), alongX = Math.abs(v.x) >= Math.abs(v.z);
  const dx = alongX ? Math.sign(v.x) || 1 : 0, dz = alongX ? 0 : Math.sign(v.z) || 1;
  const bx = Math.floor(p.location.x) + dx * 2, by = Math.floor(p.location.y), bz = Math.floor(p.location.z) + dz * 2;
  let target = null;
  for (const y of [by, by + 1]) {
    const b = p.dimension.getBlock({ x: bx, y, z: bz });
    if (b && (b.isAir || b.isLiquid) && !crateAt(p.dimension.id, bx, y, bz)) { target = b; break; }
  }
  if (!target) return p.sendMessage(oprMsg(p, "§c[Crate] No free space in front of you. Move to an open spot."));
  target.setType(def.block);
  const c = { id: typeId, d: p.dimension.id, x: target.x, y: target.y, z: target.z };
  list.push(c); save();
  spawnHolo(p.dimension, c);
  slog(p, "crates", null, "placed " + def.name + " at " + c.x + " " + c.y + " " + c.z);
  p.sendMessage(oprMsg(p, "§a[Crate] " + def.color + def.name + " §aplaced in front of you at §f" + c.x + " " + c.y + " " + c.z + "§a."));
}
function removeNearest(p) {
  const list = load() ?? []; let best = null, bd = 1e9;
  for (const c of list) {
    if (c.d !== p.dimension.id) continue;
    const d = Math.hypot(c.x + 0.5 - p.location.x, c.y + 0.5 - p.location.y, c.z + 0.5 - p.location.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best || bd > 10) return p.sendMessage(oprMsg(p, "§c[Crate] No crate within 10 blocks."));
  crates = list.filter((c) => c !== best); save();
  removeHolo(p.dimension, best);
  try { p.dimension.getBlock({ x: best.x, y: best.y, z: best.z })?.setType("minecraft:air"); } catch (e) { /* ignore */ }
  slog(p, "crates", null, "removed a crate at " + best.x + " " + best.y + " " + best.z);
  p.sendMessage(oprMsg(p, "§a[Crate] Crate removed."));
}

/** removes ONE specific crate (the "X" button in the crate page). Same steps as removeNearest, but for the crate that was opened. */
function removeCrate(p, c) {
  const list = load() ?? [];
  const best = list.find((x) => x.d === c.d && x.x === c.x && x.y === c.y && x.z === c.z);
  if (!best) return p.sendMessage(oprMsg(p, "§c[Crate] This crate is already gone."));
  if (busy.has(best.d + ":" + best.x + ":" + best.y + ":" + best.z)) return p.sendMessage(oprMsg(p, "§e[Crate] §7Someone is opening this crate right now - try again in a moment."));
  crates = list.filter((x) => x !== best); save();
  const dim = world.getDimension(best.d);
  removeHolo(dim, best);
  try { dim.getBlock({ x: best.x, y: best.y, z: best.z })?.setType("minecraft:air"); } catch (e) { /* ignore */ }
  slog(p, "crates", null, "removed a crate at " + best.x + " " + best.y + " " + best.z);
  p.sendMessage(oprMsg(p, "§a[Crate] Crate removed."));
}

// ------------------------------------------------------------------ keys over time (real clock)
const seen = new Map();                                       // player id -> last check time (ms)
system.runInterval(() => {
  if (!ensureCfg()) return;                                   // wait for the saved crate settings
  const now = Date.now();
  for (const p of world.getAllPlayers()) {
    try {
      const last = seen.get(p.id) ?? now; seen.set(p.id, now);
      const dt = Math.min(Math.max(now - last, 0), 10000);    // a freeze / long lag does not give free time
      const t = timers(p);
      for (const [id, def] of Object.entries(CRATES)) {
        const every = keyMs(def);
        if (def.realClock) {                                          // REAL clock: counts even while the player is offline
          const rc = rclock(p);
          if (typeof rc[id] !== "number") { rc[id] = now; continue; }  // first time on the server: the clock starts now
          const n = Math.floor((now - rc[id]) / every);
          if (n < 1) continue;
          rc[id] += n * every;
          giveKeys(p, id, n);
          p.sendMessage(oprMsg(p, "§a[Crate] §fYou got " + n + "x " + def.key.name + " §7(a new one every " + everyText(def) + ", even when you are offline). §7Next in §f" + mmss(nextKeyMs(p, id)) + "§7."));
          try { p.playSound("random.orb", { volume: 0.8 }); } catch (e) { /* ignore */ }
          continue;
        }
        t[id] = (t[id] ?? 0) + dt;
        if (t[id] < every) continue;
        const n = 1; t[id] = Math.min(t[id] - every, every - 1);      // ONE key per time (if the staff made the time shorter, saved progress does not turn into a flood of keys)
        giveKeys(p, id, n);
        p.sendMessage(oprMsg(p, "§a[Crate] §fYou got " + n + "x " + def.key.name + " §7(a new one every " + everyText(def) + " online). §7Next in §f" + mmss(every - t[id]) + "§7."));
        try { p.playSound("random.orb", { volume: 0.8 }); } catch (e) { /* ignore */ }
      }
    } catch (e) { console.warn("[crate] timer: " + e); }
  }
}, 20);
world.afterEvents.playerLeave.subscribe(({ playerId }) => { seen.delete(playerId); lastUse.delete(playerId); });

// ------------------------------------------------------------------ commands (staff only)
//   /smp:crate place [type]  |  /smp:crate remove  |  /smp:crate list
//   /smp:crategive <player> [amount] [type]
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const staffOnly = (o, fn) => {
    const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
    if (p) system.run(() => {
      try { if (allow(p, "crates")) fn(p); } catch (e) { console.warn("[crate] command: " + e); }
    });
    return OK;
  };
  try {
    cr.registerCommand({
      name: "smp:crate", description: "Crates (staff): place [type] | remove | list",
      permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
      mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "type", type: CustomCommandParamType.String }],
    }, (o, action, type) => staffOnly(o, (p) => {
      const a = String(action ?? "").toLowerCase();
      if (a === "place") place(p, String(type ?? "rare").toLowerCase());
      else if (a === "remove") removeNearest(p);
      else if (a === "list") {
        const l = load() ?? [];
        p.sendMessage(oprMsg(p, "§6[Crate] §f" + l.length + " crate(s)" + l.map((c) => "\n§7- " + c.id + " §f" + c.x + " " + c.y + " " + c.z + " §8(" + c.d.replace("minecraft:", "") + ")").join("")));
      } else p.sendMessage(oprMsg(p, "§6[Crate] §7Use: §f/smp:crate place [type] §7| §fremove §7| §flist §7| §f/smp:crategive <player> [amount] [type]"));
    }));
  } catch (e) { console.warn("[crate] command not registered: " + e); }
  try {
    cr.registerCommand({
      name: "smp:crategive", description: "Give crate keys (staff): /smp:crategive <player> [amount] [type]",
      permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
      mandatoryParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
      optionalParameters: [{ name: "amount", type: CustomCommandParamType.Integer }, { name: "type", type: CustomCommandParamType.String }],
    }, (o, targets, amount, type) => staffOnly(o, (p) => {
      const t = targets?.[0]; if (!t) return p.sendMessage(oprMsg(p, "§c[Crate] Player not found."));
      const id = String(type ?? "rare").toLowerCase(); if (!CRATES[id]) return p.sendMessage(oprMsg(p, "§c[Crate] Unknown type. Types: §f" + Object.keys(CRATES).join(", ")));
      const n = Math.max(1, Math.min(640, amount || 1));
      giveKeys(t, id, n);
      p.sendMessage(oprMsg(p, "§a[Crate] Gave " + n + "x " + CRATES[id].key.name + " §ato " + t.name + "."));
      if (t.id !== p.id) t.sendMessage(oprMsg(t, "§a[Crate] You received " + n + "x " + CRATES[id].key.name + "§a."));
    }));
  } catch (e) { console.warn("[crate] command not registered: " + e); }
});

// ------------------------------------------------------------------ Operator menu page (Operator > World > Crates)
export function cratesAdminPage(player, back) {
  if (!allow(player, "crates")) return;
  ensureCfg();
  const self = () => cratesAdminPage(player, back);
  const f = make("Operator: Crates", SHORT_ROWS); f.self = self;
  const types = Object.keys(CRATES).slice(0, 4), cols = types.length === 1 ? [4] : types.length === 2 ? [3, 5] : types.length === 3 ? [2, 4, 6] : [1, 3, 5, 7];
  types.forEach((id, i) => {
    const d = CRATES[id];
    set(f, 1 * COLS + cols[i], hdr(1, "g") + d.color + "§lAdd " + d.name + "\n§r§7Builds the crate as a block\n§r§7§lin front of you\n§r§eClick to place", "textures/ui/shop/ic_chest", { run: () => { if (allow(player, "crates")) place(player, id); self(); } });
  });
  set(f, 2 * COLS + 4, hdr(1, "g") + "§e§lEdit crates\n§r§7Change the chances, the rewards\n§r§7and the key time of a crate\n§r§eClick to edit", "textures/ui/shop/ic_gear", { run: () => cratesEditPick(player, self) });
  set(f, 3 * COLS + 2, hdr(1, "r") + "§c§lRemove nearest crate\n§r§7Removes the crate closest to you\n§r§7(within 10 blocks)", NAV.no, { run: () => confirm(player, "Remove crate", ["§7Removes the nearest crate", "§7(within 10 blocks)."], () => { if (allow(player, "crates")) removeNearest(player); self(); }, self) });
  set(f, 3 * COLS + 4, hdr(1) + "§e§lGive keys\n§r§7Give crate keys to an\n§r§7online player", "textures/items/gold_ingot", { run: () => giveKeysForm(player, self) });
  const n = (load() ?? []).length;
  set(f, 3 * COLS + 6, hdr(Math.min(99, Math.max(1, n))) + "§b§lCrates in the world: §f" + n + "\n§r§7Keys come by playing time:\n§r" + Object.values(CRATES).map((d) => d.color + d.name.replace(" Crate", "") + " §7" + everyText(d)).join("\n§r"), NAV.page, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function giveKeysForm(player, back) {
  const ps = world.getAllPlayers(), ids = Object.keys(CRATES);
  const form = new OprForm().title("Give crate keys");
  dropdown(form, "Player", ps.map((x) => x.name));
  dropdown(form, "Key", ids.map((id) => CRATES[id].key.name.replace(/§./g, "")));
  textField(form, "Amount", "1");
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!allow(player, "crates")) return back();
      const t = ps[Number(v[0])], id = ids[Number(v[1])] ?? ids[0];
      const n = Math.max(1, Math.min(640, parseInt(String(v[2] ?? "").trim() || "1", 10) || 1));
      if (!t || !valid(t)) { player.sendMessage(oprMsg(player, "§c[Crate] That player is not online.")); return back(); }
      giveKeys(t, id, n);
      slog(player, "crates", null, "gave " + n + " " + id + " key(s) to " + t.name);
      player.sendMessage(oprMsg(player, "§a[Crate] Gave " + n + "x " + CRATES[id].key.name + " §ato " + t.name + "."));
      if (t.id !== player.id) t.sendMessage(oprMsg(t, "§a[Crate] You received " + n + "x " + CRATES[id].key.name + "§a."));
    } catch (e) { console.warn("[crate] give: " + e); }
    back();
  });
}

/** Operator > World > "Crate keys": the operator takes as many keys as he wants (to test the crates) */
export function takeKeysForm(player, back) {
  if (!allow(player, "crates")) return;
  const ids = Object.keys(CRATES), form = new OprForm().title("Take crate keys");
  dropdown(form, "Key", ids.map((id) => CRATES[id].key.name.replace(/§./g, "")));
  textField(form, "How many? (1 - 2000)", "64");
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!allow(player, "crates")) return back();
      const id = ids[Number(v[0])] ?? ids[0];
      const n = Math.max(1, Math.min(2000, parseInt(String(v[1] ?? "").trim() || "1", 10) || 1));
      giveKeys(player, id, n);
      slog(player, "crates", null, "took " + n + " " + id + " key(s)");
      player.sendMessage(oprMsg(player, "§a[Crate] You took " + n + "x " + CRATES[id].key.name + "§a."));
      try { player.playSound("random.orb", { volume: 0.8 }); } catch (e) { /* ignore */ }
    } catch (e) { console.warn("[crate] take: " + e); }
    back();
  });
}

// ------------------------------------------------------------------ ADMIN EDITOR PAGES
const fld = (form, label, ph, def) => { try { form.textField(label, ph, { defaultValue: String(def ?? "") }); } catch (e) { form.textField(label, ph); } };
const dd = (form, label, items, idx) => { try { form.dropdown(label, items, { defaultValueIndex: idx }); } catch (e) { form.dropdown(label, items, idx); } };
const tg = (form, label, def) => { try { form.toggle(label, { defaultValue: def }); } catch (e) { form.toggle(label, def); } };

/** Operator > World > Crates > Edit crates: pick the crate to edit */
export function cratesEditPick(player, back) {
  if (!allow(player, "crates")) return;
  ensureCfg();
  const self = () => cratesEditPick(player, back);
  const f = make("Operator: Edit crates", SHORT_ROWS); f.self = self;
  const types = Object.keys(CRATES).slice(0, 4), cols = types.length === 1 ? [4] : types.length === 2 ? [3, 5] : types.length === 3 ? [2, 4, 6] : [1, 3, 5, 7];
  types.forEach((id, i) => {
    const d = CRATES[id];
    set(f, 1 * COLS + cols[i], hdr(1, "g") + d.color + "§l" + d.name + "\n§r§7" + d.rewards.length + " rewards\n§r§7New key every §f" + everyText(d) + "\n§r§eClick to edit", "textures/ui/shop/ic_chest", { run: () => crateEditPage(player, id, self) });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}

/** the edit page of ONE crate: key time, add reward, reset, and every reward (click one to change / delete it) */
export function crateEditPage(player, typeId, back) {
  if (!allow(player, "crates")) return;
  ensureCfg();
  const def = CRATES[typeId]; if (!def) { if (back) back(); return; }
  const self = () => crateEditPage(player, typeId, back);
  const f = make("Edit " + def.name, SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 2, hdr(1, "g") + "§e§lKey time\n§r§7A new key every §f" + everyText(def) + "\n§r§7(" + def.keyEveryMin + " minutes) of playing\n§r§eClick to change", "textures/items/clock_item", { run: () => keyTimeForm(player, typeId, self) });
  set(f, 0 * COLS + 4, hdr(1, "g") + "§a§lAdd reward\n§r§7Rewards now: §f" + def.rewards.length + " §7(max " + MAX_REWARDS + ")\n§r§eClick to add", NAV.ok, { run: () => addRewardPage(player, typeId, self) });
  set(f, 0 * COLS + 6, hdr(1, "r") + "§c§lReset this crate\n§r§7Back to the original rewards\n§r§7and key time", NAV.no, { run: () => confirm(player, "Reset " + def.name, ["§7Puts this crate back to its", "§7original rewards, chances and key time."], () => {
    if (!allow(player, "crates")) return;
    const res = commit(typeId, (d) => { d.keyEveryMin = DEFAULTS[typeId].keyEveryMin; d.rewards = clone(DEFAULTS[typeId].rewards); });
    if (res.ok) { slog(player, "crates", null, "reset " + def.name + " to the default"); player.sendMessage(oprMsg(player, "§a[Crate] " + def.name + " was reset to the original settings.")); } else player.sendMessage(oprMsg(player, "§c[Crate] " + res.err));
    self();
  }, self) });
  def.rewards.slice(0, MAX_REWARDS).forEach((r, i) => {
    const rare = r.chance / totalChance(def) <= 0.1;
    set(f, 1 * COLS + i, hdr(r.type === "item" ? r.amount : r.type === "spawner" ? r.count : 1, rare ? "g" : "c") + rewardText(r) + "\n§r§7Chance: §f" + pct(def, r) + "% §8(weight " + r.chance + ")\n§r§eClick to edit / delete", iconOf(r), { run: () => rewardForm(player, typeId, i, self) });
  });
  backBtn(f, back ?? (() => { })); status(player, f);
  open(player, f);
}

function keyTimeForm(player, typeId, back) {
  if (!allow(player, "crates")) return;
  const def = CRATES[typeId]; if (!def) return back();
  const form = new OprForm().title("Key time - " + def.name);
  fld(form, "Minutes between keys (1 - 525600)\n30 = half an hour, 60 = 1 hour, 1440 = 1 day", "30", def.keyEveryMin);
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!allow(player, "crates")) return back();
      const n = Number(String(v[0] ?? "").trim());
      if (!Number.isInteger(n) || n < 1 || n > 525600) { player.sendMessage(oprMsg(player, "§c[Crate] The key time must be a whole number of minutes from 1 to 525600.")); return back(); }
      const res = commit(typeId, (d) => { d.keyEveryMin = n; });
      if (res.ok) { slog(player, "crates", null, def.name + ": key every " + n + " minutes"); player.sendMessage(oprMsg(player, "§a[Crate] " + def.name + ": a new key every §f" + everyText(def) + "§a.")); } else player.sendMessage(oprMsg(player, "§c[Crate] " + res.err));
    } catch (e) { console.warn("[crate] key time: " + e); }
    back();
  });
}

/** checks the values of the reward form. Returns { r } or { err } */
function parseReward(v, old, pick) {
  const type = TYPES[Number(v[0])] ?? "item";
  const chance = Number(String(v[3] ?? "").trim().replace(",", "."));
  if (!Number.isFinite(chance) || chance <= 0 || chance > 100000) return { err: "Chance must be a number above 0 (up to 100000). It is a weight: the page shows the real % of each reward." };
  const n = Number(String(v[2] ?? "").trim());
  if (!Number.isInteger(n) || n < 1) return { err: "Amount must be a whole number, 1 or more." };
  const r = { type, chance: Math.round(chance * 100) / 100 };
  if (type === "item") {
    let id = String(v[1] ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    if (!id) return { err: "Write the item id (for example minecraft:diamond)." };
    if (!id.includes(":")) id = "minecraft:" + id;
    let st; try { st = new ItemStack(id, 1); } catch (e) { return { err: "Unknown item: " + id }; }
    if (n > st.maxAmount) return { err: pretty(id) + " stacks to " + st.maxAmount + " at most. Use " + st.maxAmount + " or less." };
    r.id = id; r.amount = n;
  } else if (type === "money") { if (n > 10000000) return { err: "Money can be 10,000,000 at most." }; r.amount = n; }
  else if (type === "xp") { if (n > 1000) return { err: "XP levels can be 1000 at most." }; r.levels = n; }
  else {
    if (n > 16) return { err: "A crate can give 16 spawners at most." };
    r.count = n;
    const mobs = String(v[4] ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = mobs.find((m) => !SPAWNERS.some((s) => s.id === m));
    if (bad) return { err: "Unknown spawner mob: " + bad + ". Leave it empty for any mob." };
    if (mobs.length) r.mobs = mobs;
  }
  if (pick && pick.icon && type === "item" && pick.id === r.id) r.icon = pick.icon;
  else if (old && old.icon && old.type === type && (type !== "item" || old.id === r.id)) r.icon = old.icon;
  return { r };
}

// ------------------------------------------------------------------ ITEM PICKER (the same list as the shop: pick the item instead of typing its id)
const PK = { prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", search: "textures/ui/shop/key_search" };
function pickItem(player, it, onPick, back) {
  let id; try { id = String(realId(it[0], it[1])); } catch (e) { id = "minecraft:" + it[0]; }
  let st; try { st = new ItemStack(id, 1); } catch (e) { player.sendMessage(oprMsg(player, "§c[Crate] This game version does not have: §f" + it[1])); return back(); }
  onPick({ id, name: it[1], icon: it[2], max: st.maxAmount });
}
function pickerItems(player, title, items, onPick, back, page = 0) {
  if (!allow(player, "crates")) return;
  const pages = Math.max(1, Math.ceil(items.length / 72)), pg = Math.min(Math.max(0, page), pages - 1);
  const self = (n = pg) => pickerItems(player, title, items, onPick, back, n);
  const f = make(title + " §8(" + items.length + ")", 9); f.self = () => self(pg);
  items.slice(pg * 72, pg * 72 + 72).forEach((it, i) => set(f, i, hdr(1) + "§f§l" + it[1] + "\n§r§7Click to choose this item", it[2], { run: () => pickItem(player, it, onPick, () => self(pg)) }));
  if (!items.length) set(f, 3 * COLS + 4, hdr(1) + "§7Nothing found", NAV.page, null);
  const base = 8 * COLS;
  if (pg > 0) set(f, base + 3, hdr(1) + "§e§lPrevious page", PK.prev, { run: () => self(pg - 1) });
  if (pages > 1) set(f, base + 4, hdr(1) + "§fPage " + (pg + 1) + "§7/§f" + pages, NAV.page, null);
  if (pg < pages - 1) set(f, base + 5, hdr(1) + "§e§lNext page", PK.next, { run: () => self(pg + 1) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
/** opens the shop categories; onPick({ id, name, icon, max }) is called with the item the staff clicked */
function pickerCategories(player, onPick, back) {
  if (!allow(player, "crates")) return;
  const self = () => pickerCategories(player, onPick, back);
  const f = make("Choose an item", 9); f.self = self;
  CATEGORIES.slice(0, 54).forEach((c, i) => set(f, i, hdr(1) + "§6§l" + c.name + "\n§r§7Items: §f" + c.items.length + "\n§r§eClick to open", c.icon, { run: () => pickerItems(player, c.name, c.items, onPick, self) }));
  set(f, 8 * COLS + 6, hdr(1) + "§e§lSearch an item\n§r§7Type a part of the name", PK.search, { run: () => {
    const form = new OprForm().title("Search the item list"); textField(form, "§fPart of the item name or id", "e.g. elytra");
    showModal(player, form, (v) => {
      const q = String((v && v[0]) ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      if (!q) return self();
      const all = []; for (const c of CATEGORIES) for (const it of c.items) if (String(it[1]).toLowerCase().replace(/\s+/g, "_").includes(q) || String(it[0]).includes(q)) all.push(it);
      pickerItems(player, "Search: " + q, all.slice(0, 600), onPick, self);
    });
  } });
  backBtn(f, back); status(player, f);
  open(player, f);
}

/** "Add reward": what kind of reward? (an item is chosen from the shop list) */
function addRewardPage(player, typeId, back) {
  if (!allow(player, "crates")) return;
  const def = CRATES[typeId]; if (!def) return back();
  if (def.rewards.length >= MAX_REWARDS) { player.sendMessage(oprMsg(player, "§c[Crate] A crate can have " + MAX_REWARDS + " rewards at most.")); return back(); }
  const self = () => addRewardPage(player, typeId, back);
  const f = make("Add reward - " + def.name, SHORT_ROWS); f.self = self;
  set(f, 0 * COLS + 4, hdr(1) + "§e§lAdd a reward\n§r§7Pick what the player can win,\n§r§7then set the amount and the chance.", NAV.page, null);
  set(f, 2 * COLS + 1, hdr(1, "g") + "§a§lItem from the list\n§r§7Opens the shop list: pick any\n§r§7item (Elytra, tools, blocks...)\n§r§eClick to choose", "textures/ui/shop/ic_chest",
    { run: () => pickerCategories(player, (pick) => rewardForm(player, typeId, -1, back, { type: "item", id: pick.id, amount: 1, chance: 10, icon: pick.icon }, pick), self) });
  set(f, 2 * COLS + 3, hdr(1) + "§a§lMoney\n§r§7Gives money", "textures/items/emerald", { run: () => rewardForm(player, typeId, -1, back, { type: "money", amount: 1000, chance: 10 }) });
  set(f, 2 * COLS + 5, hdr(1) + "§b§lXP levels\n§r§7Gives experience levels", "textures/items/book_enchanted", { run: () => rewardForm(player, typeId, -1, back, { type: "xp", levels: 5, chance: 10 }) });
  set(f, 2 * COLS + 7, hdr(1) + "§c§lSpawner\n§r§7Gives a random mob spawner", "textures/ui/shop/ic_spawner", { run: () => rewardForm(player, typeId, -1, back, { type: "spawner", count: 1, chance: 5 }) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

/** idx = position of the reward, or -1 to add a new one.  preset = the starting values of a new reward, pick = the item chosen from the list */
function rewardForm(player, typeId, idx, back, preset = null, pick = null) {
  if (!allow(player, "crates")) return;
  const def = CRATES[typeId]; if (!def) return back();
  const old = idx >= 0 ? def.rewards[idx] : null;
  if (idx >= 0 && !old) return back();
  if (!old && def.rewards.length >= MAX_REWARDS) { player.sendMessage(oprMsg(player, "§c[Crate] A crate can have " + MAX_REWARDS + " rewards at most.")); return back(); }
  const cur = old ?? preset ?? { type: "item", id: "minecraft:diamond", amount: 1, chance: 10 };
  const form = new OprForm().title((old ? "Edit reward - " : "Add reward - ") + def.name);
  dd(form, "Type", ["Item", "Money", "XP levels", "Spawner"], Math.max(0, TYPES.indexOf(cur.type)));
  fld(form, "Item id (only for type Item)", "minecraft:diamond", cur.type === "item" ? cur.id : "");
  fld(form, "Amount (items / money / XP levels / spawners)", "1", cur.type === "item" ? cur.amount : cur.type === "money" ? cur.amount : cur.type === "xp" ? cur.levels : cur.count);
  fld(form, "Chance (weight, e.g. 10. Bigger = more often)", "10", cur.chance);
  fld(form, "Spawner mobs (only for type Spawner)\nexample: creeper,zombie  -  empty = any mob", "", cur.mobs ? cur.mobs.join(",") : "");
  tg(form, "§bChoose another item from the shop list", false);
  if (old) tg(form, "§cDelete this reward", false);
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!allow(player, "crates")) return back();
      if (old && v[6] === true) {
        if (def.rewards.length <= 1) { player.sendMessage(oprMsg(player, "§c[Crate] A crate needs at least one reward.")); return back(); }
        const res = commit(typeId, (d) => { d.rewards = d.rewards.filter((_, i) => i !== idx); });
        if (res.ok) { slog(player, "crates", null, def.name + ": deleted a reward"); player.sendMessage(oprMsg(player, "§a[Crate] Reward deleted.")); } else player.sendMessage(oprMsg(player, "§c[Crate] " + res.err));
        return back();
      }
      if (v[5] === true) {           // the staff wants to pick the item from the list: keep what he typed, only the item changes
        pickerCategories(player, (p2) => { const v2 = [...v]; v2[0] = 0; v2[1] = p2.id; saveReward(player, typeId, idx, old, v2, p2, back); }, () => rewardForm(player, typeId, idx, back, preset, pick));
        return;
      }
      saveReward(player, typeId, idx, old, v, pick, back);
    } catch (e) { console.warn("[crate] reward: " + e); back(); }
  });
}
function saveReward(player, typeId, idx, old, v, pick, back) {
  const def = CRATES[typeId]; if (!def) return back();
  try {
    if (!allow(player, "crates")) return back();
    const out = parseReward(v, old, pick);
    if (out.err) { player.sendMessage(oprMsg(player, "§c[Crate] " + out.err)); return back(); }
    const res = commit(typeId, (d) => { d.rewards = old ? d.rewards.map((r, i) => (i === idx ? out.r : r)) : [...d.rewards, out.r]; });
    if (res.ok) { slog(player, "crates", null, def.name + ": " + (old ? "changed" : "added") + " a reward"); player.sendMessage(oprMsg(player, "§a[Crate] Saved: " + rewardText(out.r) + " §7(" + pct(CRATES[typeId], out.r) + "%)")); } else player.sendMessage(oprMsg(player, "§c[Crate] " + res.err));
  } catch (e) { console.warn("[crate] save reward: " + e); }
  back();
}
