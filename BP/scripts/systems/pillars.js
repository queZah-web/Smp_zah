// ===================================================================================================================
// PILLARS OF FORTUNE (event)  -  /opr > Building > Pillars  or  /opr > Events > Pillars  (Owner)   and   /pillars
//
// The last player standing on the pillars in the sky wins.
//   * the Owner chooses 2 - 16 players, how often an item comes (5 / 8 / 12 s), how often a pillar falls (25 / 40 / 60 s),
//     random events on / off and the prize
//   * Start: the arena is put back as new; the OWN things of every player (inventory, armour, off hand) go into a hidden
//     locker (barrels under the arena: the real items, with every enchantment / name) and his XP is noted -> he plays with
//     NOTHING of his own.  Everybody gets his own pillar, the rules are shown, 10 s countdown, GO.
//   * every few seconds every player gets a RANDOM item: common 55 % (blocks, food, snowballs ...), useful 25 % (ender pearl,
//     slime, bow, shield, fishing rod, wind charge ...), rare 15 % (iron gear, golden apples, knockback stick ...),
//     legendary 5 % (diamond sword, enchanted golden apple, knockback II, totem ...).  All of them are marked
//     "Pillars of Fortune item": they can not be sold, and they ALL disappear after the game.
//   * random events every 60 s: block rain (concrete powder falls from the sky), sudden night (darkness), lucky drop
//     (a rare item for everybody), low gravity, speed rush
//   * the arena shrinks: after 90 s the pillars fall one by one (outer ring first), each one with a 10 s warning
//     (its top flashes red); at the end only the centre platform is left and it breaks ring by ring
//   * OUT = falling 15 blocks under the tops, going too far away, dying, leaving: announced, the players left are counted,
//     everything from the game is removed, his own things + XP come back EXACTLY, and he goes back to where he was before
//     the game.  He can not come back into this game.  (Leaving the server: given back when he joins again.)
//   * the last one wins: announced, prize, stats.  After the game the arena is put back (no lag: big fills).
// ===================================================================================================================
import { world, system, ItemStack, GameMode, BlockVolume, StructureSaveMode, EquipmentSlot, EnchantmentTypes, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, pillarsHook, pillars1Hook } from "./spawnbuild.js";
import { BIG, SMALL } from "./pillarsdesign.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

/** one Pillars of Fortune game (one arena, its own data, lockers, settings and stats) */
function makeGame(V) {
const D = V.design, { POF, PILLARS, pillarFills, centerRings, lockerAt } = D, pillarsGen = D.gen;
const SELF = {};
const KEY = V.k + ":arena", CFG_KEY = V.k + ":cfg", MKEY = V.k + ":m", PEND_KEY = V.k + ":pend", AREA = "smp_" + V.p + "_";
const ITEM_EVERY = [5, 8, 12], PILLAR_EVERY = [25, 40, 60], PRIZES = [0, 2500, 5000, 10000, 20000], MAX_PLAYERS = 16, COUNT = 10;
const SHRINK_AFTER = 90, WARN = 10, EVENT_EVERY = 60;
const LORE = [V.lore, "§7(disappears after the game)"];
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[pillars] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[pillars] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const rnd = (n) => Math.floor(Math.random() * n);

// ---------------------------------------------------------------- the arena record
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
const pillarsAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!pillarsAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const relOf = (a, l) => ({ x: l.x - a.cx - 0.5, y: l.y - a.cy, z: l.z - a.cz - 0.5 });
let cfg = null;
const conf = () => (cfg ??= { item: 8, pillar: 40, events: 1, prize: 5000, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());
const fillRel = (a, dim, f, id) => dim.fillBlocks(new BlockVolume({ x: a.cx + f.from.x, y: a.cy + f.from.y, z: a.cz + f.from.z }, { x: a.cx + f.to.x, y: a.cy + f.to.y, z: a.cz + f.to.z }), perm(id ?? f.id));

// ---------------------------------------------------------------- building + putting the arena back
let busy = false;
function* placeAll(a, dim, canvas, progress) {
  for (const f of canvas.fills) { try { fillRel(a, dim, f); } catch (e) { /* not loaded */ } yield; }
  const og = canvas.orderedGen(); let r; while (!(r = og.next()).done) yield;
  const pal = canvas.pal.map((p) => perm(p.id, p.st)); let k = 0;
  for (const b of r.value) for (let i = 0; i < b.length; i += 4) {
    const p = pal[b[i + 3]];
    if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { /* ignore */ } }
    if (++k % 60 === 0) { if (progress) progress(k); yield; }
  }
}
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[" + V.tag + "] Building:"))) { removeAreas(dim, AREA); say(player, "§c[" + V.tag + "] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:" + V.p + "_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[pillars] backup: " + e); }
      bar(player, "§a[" + V.tag + "] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -POF.HX; x <= POF.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz - POF.HX }, { x: a.cx + x, y: a.cy + POF.UP, z: a.cz + POF.HX }), air); } catch (e) { /* ignore */ }
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy - POF.DOWN, z: a.cz - POF.HX }, { x: a.cx + x, y: a.cy - 1, z: a.cz + POF.HX }), dirt); } catch (e) { /* ignore */ }
      bar(player, "§a[" + V.tag + "] §fClearing the sky... §e" + Math.round(((x + POF.HX) / (POF.HX * 2)) * 100) + "%"); yield;
    }
    const g = pillarsGen(); let r; while (!(r = g.next()).done) yield;
    yield* placeAll(a, dim, r.value, (k) => bar(player, "§a[" + V.tag + "] §fBuilding the pillars... §e" + k));
    removeAreas(dim, AREA);
    say(player, "§a[" + V.tag + "] The arena is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s) §aStart a game in §f/opr > Events > Pillars§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[pillars] build: " + e); say(player, "§c[" + V.tag + "] Building stopped: " + e); removeAreas(dim, AREA); }
  finally { busy = false; }
}
function buildPillars(player) {
  if (!owner(player)) return say(player, "§c[" + V.tag + "] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[" + V.tag + "] The arena is being built right now.");
  if (arena()) return say(player, "§c[" + V.tag + "] The arena already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - POF.DOWN < hr.min || cy + POF.UP >= hr.max) return say(player, "§c[" + V.tag + "] Too high here: the arena is " + POF.UP + " blocks high. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, x1: cx - POF.HX - 1, y1: cy - POF.DOWN, z1: cz - POF.HX - 1, x2: cx + POF.HX + 1, y2: cy + POF.UP, z2: cz + POF.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[" + V.tag + "] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[" + V.tag + "] Building the arena (" + D.size + ", " + POF.UP + " high, 16 pillars)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "pillars", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[" + V.tag + "] Undo:"))) { removeAreas(dim, AREA); say(player, "§c[" + V.tag + "] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[pillars] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    A = null; saveA();
    removeAreas(dim, AREA);
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[" + V.tag + "] Removed: the land is back as it was." : "§e[" + V.tag + "] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
function undoPillars(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[" + V.tag + "] Stop the game first.");
  if (Object.keys(pend()).length) return say(player, "§c[" + V.tag + "] Some players still have their things in the lockers (they are offline). Wait until they join again.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}
/** the play area back as new: the sky cleared (placed blocks, water, sand), every pillar + the centre built again, items removed */
function* resetJob(a) {
  const dim = dimOf(a); if (!dim) return;
  const air = perm("air");
  for (let x = -POF.CLEAR; x <= POF.CLEAR; x++) { try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz - POF.CLEAR }, { x: a.cx + x, y: a.cy + POF.TOP + 7, z: a.cz + POF.CLEAR }), air); } catch (e) { /* ignore */ } if (x % 4 === 0) yield; }
  for (const k of placed) { const [x, y, z] = k.split("|").map(Number); try { dim.getBlock({ x, y, z })?.setPermutation(air); } catch (e) { /* ignore */ } }
  placed.clear();
  for (const p of PILLARS) for (const f of pillarFills(p)) { try { fillRel(a, dim, f); } catch (e) { /* ignore */ } }
  yield;
  const cp = D.centerParts();
  for (const f of cp.fills) { try { fillRel(a, dim, f); } catch (e) { /* ignore */ } }
  for (const b of cp.blocks) { try { dim.getBlock({ x: a.cx + b.x, y: a.cy + b.y, z: a.cz + b.z })?.setPermutation(perm(b.id)); } catch (e) { /* ignore */ } }
  try { for (const e of dim.getEntities({ location: abs(a, { x: 0, y: 60, z: 0 }), maxDistance: 70 })) { if (e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb" || e.typeId === "minecraft:arrow" || e.typeId === "minecraft:falling_block") { try { e.remove(); } catch (x) { /* ignore */ } } } } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- the lockers: the own things of a player wait here (the real items)
const SLOTS = () => [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const boxOf = (a, n) => { try { const l = lockerAt(n); return dimOf(a).getBlock({ x: a.cx + l.x, y: a.cy + l.y, z: a.cz + l.z })?.getComponent("minecraft:inventory")?.container ?? null; } catch (e) { return null; } };
/** moves everything of the player into lockers 2n / 2n+1. Returns the map [[kind, slot, box, boxSlot]] or null when a locker is not there */
function storeInv(a, p, n) {
  const b = [boxOf(a, 2 * n), boxOf(a, 2 * n + 1)]; if (!b[0] || !b[1]) return null;
  for (const box of b) for (let i = 0; i < box.size; i++) { try { if (box.getItem(i)) return null; } catch (e) { return null; } }   // must be empty (never mix two players)
  const inv = p.getComponent("minecraft:inventory")?.container, eq = p.getComponent("minecraft:equippable"), map = [];
  let k = 0;
  const put = (it) => { const bi = k < 27 ? 0 : 1, si = k % 27; b[bi].setItem(si, it); k++; return [2 * n + bi, si]; };
  if (inv) for (let i = 0; i < inv.size; i++) { let it; try { it = inv.getItem(i); } catch (e) { it = undefined; } if (!it) continue; const [bx, si] = put(it); inv.setItem(i, undefined); map.push(["i", i, bx, si]); }
  SLOTS().forEach((slot, j) => { let it; try { it = eq?.getEquipment(slot); } catch (e) { it = undefined; } if (!it) return; const [bx, si] = put(it); eq.setEquipment(slot, undefined); map.push(["e", j, bx, si]); });
  return map;
}
/** removes everything the player has now (all from the game) and gives his own things back. false = the locker is not loaded (try later) */
function giveBack(a, p, rec) {
  if (!a) return false;
  for (const [, , bx] of rec.map ?? []) if (!boxOf(a, bx)) return false;
  const inv = p.getComponent("minecraft:inventory")?.container, eq = p.getComponent("minecraft:equippable");
  try { if (inv) for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined); } catch (e) { /* ignore */ }
  SLOTS().forEach((slot) => { try { eq?.setEquipment(slot, undefined); } catch (e) { /* ignore */ } });
  try { const cur = p.getComponent("minecraft:cursor_inventory"); cur?.clear?.(); } catch (e) { /* ignore */ }
  for (const [kind, slot, bx, si] of rec.map ?? []) {
    const box = boxOf(a, bx); let it; try { it = box.getItem(si); box.setItem(si, undefined); } catch (e) { it = undefined; }
    if (!it) continue;
    try {
      if (kind === "i") inv.setItem(slot, it); else eq.setEquipment(SLOTS()[slot], it);
    } catch (e) { try { const rest = inv?.addItem(it); if (rest) p.dimension.spawnItem(rest, p.location); } catch (x) { /* ignore */ } }
  }
  try { p.resetLevel(); if (rec.lv > 0) p.addLevels(rec.lv); if (rec.xp > 0) p.addExperience(rec.xp); } catch (e) { /* ignore */ }
  for (const fx of ["darkness", "jump_boost", "slow_falling", "speed", "slowness", "resistance", "regeneration", "absorption", "strength"]) { try { p.removeEffect(fx); } catch (e) { /* ignore */ } }
  try { p.extinguishFire?.(); } catch (e) { /* ignore */ }
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  return true;
}
const pend = () => readJson(PEND_KEY, {});
const keepPending = (id, rec) => { if (rec.done) return; const all = pend(); all[id] = rec; writeJson(PEND_KEY, all); };
function giveBackOrKeep(id, rec) {
  if (rec.done) return true;                                   // already given back: never twice (that would empty his inventory)
  const p = online(id), a = arena();
  if (p && alivePl(p) && giveBack(a, p, rec)) { rec.done = 1; if (G?.pl[id]) saveG(); return true; }
  keepPending(id, rec); return false;
}
const alivePl = (p) => { try { return (p.getComponent("minecraft:health")?.currentValue ?? 1) > 0; } catch (e) { return true; } };
// a player who still has things in a locker (left the game / the server stopped): given back as soon as possible
system.runInterval(() => {
  const all = pend(), ids = Object.keys(all); if (!ids.length) return;
  const a = arena(); if (!a) return;
  let changed = false, need = false;
  for (const id of ids) {
    if (G?.pl[id] && G.alive.includes(id)) continue;
    const p = online(id); if (!p || !alivePl(p)) continue;
    if (all[id].done) { delete all[id]; changed = true; continue; }
    if (giveBack(a, p, all[id])) { all[id].done = 1; if (G?.pl[id]) { G.pl[id].done = 1; saveG(); } delete all[id]; changed = true; tell(p, "§a[" + V.tag + "] Your own things and your XP are back.", "§a[" + V.tagAr + "] رجعت لك أغراضك والـ XP."); }
    else need = true;
  }
  if (changed) writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  try { const dim = dimOf(a), l = lockerAt(0); if (need) dim.runCommand(`tickingarea add circle ${a.cx + l.x} ${a.cy + l.y} ${a.cz + l.z} 1 ${AREA}lock true`); else if (!Object.keys(all).length) dim.runCommand("tickingarea remove ${AREA}lock"); } catch (e) { /* ignore */ }
}, 40);

// ---------------------------------------------------------------- the random items
const ench = (it, list) => { try { const c = it.getComponent("minecraft:enchantable"); for (const [t, l] of list) c?.addEnchantment({ type: EnchantmentTypes.get(t), level: l }); } catch (e) { /* ignore */ } return it; };
const POOL = {
  common: [["cobblestone", 16], ["oak_planks", 16], ["glass", 12], ["ladder", 8], ["dirt", 16], ["white_wool", 16], ["sand", 8], ["scaffolding", 8], ["bread", 3], ["apple", 2], ["carrot", 4], ["cooked_beef", 2], ["snowball", 8], ["egg", 8], ["oak_stairs", 6]],
  useful: [["ender_pearl", 1], ["slime", 2], ["web", 2], ["bow", 1, [], [["arrow", 8]]], ["stone_sword", 1], ["chainmail_chestplate", 1], ["iron_helmet", 1], ["shield", 1], ["golden_carrot", 3], ["fishing_rod", 1], ["wind_charge", 3], ["water_bucket", 1], ["leather_boots", 1, [["feather_falling", 2]]]],
  rare: [["iron_sword", 1], ["iron_chestplate", 1], ["golden_apple", 2], ["ender_pearl", 2], ["stick", 1, [["knockback", 1]], [], "§bKnockback Stick"], ["bow", 1, [["punch", 1]], [["arrow", 16]]], ["crossbow", 1, [], [["arrow", 8]]], ["iron_axe", 1], ["cobblestone", 64], ["iron_leggings", 1]],
  legendary: [["enchanted_golden_apple", 1], ["diamond_sword", 1], ["stick", 1, [["knockback", 2]], [], "§6§lKnockback Stick II"], ["diamond_chestplate", 1], ["ender_pearl", 4], ["totem_of_undying", 1], ["trident", 1, [["loyalty", 1]]]],
};
const RAR = [["common", 55, "§f", "عادي"], ["useful", 25, "§a", "مفيد"], ["rare", 15, "§b", "نادر"], ["legendary", 5, "§6§l", "أسطوري"]];
function makeItem(id, n, en, name) {
  let it; try { it = new ItemStack("minecraft:" + id, n); } catch (e) { return null; }
  if (en?.length) ench(it, en);
  try { if (name) it.nameTag = name; it.setLore(LORE); } catch (e) { /* ignore */ }
  return it;
}
function roll(force) {
  let k = force ?? null;
  if (!k) { let r = Math.random() * 100; for (const [key, w] of RAR) { if ((r -= w) < 0) { k = key; break; } } k ??= "common"; }
  const list = POOL[k];
  for (let tries = 0; tries < 5; tries++) {
    const [id, n, en, extra, name] = list[rnd(list.length)];
    const main = makeItem(id, n, en, name); if (!main) continue;
    const more = (extra ?? []).map(([i2, n2]) => makeItem(i2, n2)).filter(Boolean);
    return { rarity: k, items: [main, ...more], label: name ?? id.replace(/_/g, " ") };
  }
  return null;
}
function giveRandom(p, force) {
  const r = roll(force); if (!r) return;
  const inv = p.getComponent("minecraft:inventory")?.container;
  for (const it of r.items) { try { const rest = inv ? inv.addItem(it) : it; if (rest) p.dimension.spawnItem(rest, p.location); } catch (e) { /* ignore */ } }
  const R = RAR.find((x) => x[0] === r.rarity);
  bar(p, R[2] + "+ " + r.label + " §7(" + pick(p, r.rarity, R[3]) + ")");
  try { p.playSound(r.rarity === "legendary" ? "random.totem" : r.rarity === "rare" ? "random.levelup" : "random.pop", { volume: r.rarity === "legendary" ? 0.5 : 0.8, pitch: 1.4 }); } catch (e) { /* ignore */ }
  if (r.rarity === "legendary") toAll((q) => q.sendMessage("§6✦ §f" + p.name + " §7" + pick(q, "got a LEGENDARY item: ", "حصل على غرض أسطوري: ") + "§6" + r.label));
}

// ---------------------------------------------------------------- the game
let G = null;    // { phase: prep | count | run | end, until, pl: { id: rec }, alive: [ids], order: [ids], gone: Set(pillar), next..., }
const placed = new Set();   // blocks the players placed during the game ("x|y|z" world)
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
const pillarsView = () => (G ? { phase: G.phase, alive: [...G.alive], order: [...G.order], gone: [...G.gone], center: G.center } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inArena(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
system.runTimeout(() => {                              // a restart in the middle of a game: everything is given back
  const old = readJson(MKEY, null); if (!old?.pl) return;
  writeJson(MKEY, null);
  for (const [id, rec] of Object.entries(old.pl)) if (!rec.done) keepPending(id, rec);
}, 60);

function startPillars(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  if (Object.keys(pend()).length) return { err: "Some players from the last game still wait for their things (offline). They get them when they join; then start again." };
  const c = conf(), ids = c.roster.filter((id) => online(id) && !GAMES.some((g) => g !== SELF && g.holds(id))).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players (not playing / waiting in the other Pillars game)." };
  G = { phase: "prep", until: 0, pl: {}, alive: [], order: [], gone: new Set(), center: 0, item: c.item, pillar: c.pillar, events: c.events, prize: c.prize, warn: null, start: 0, by: player.name };
  busy = true;
  const dim = dimOf(a);
  system.runJob((function* () {
    try {
      addAreas(dim, a, AREA);
      if (!(yield* waitLoaded(player, dim, a, "[" + V.tag + "] Getting the arena ready:"))) { say(player, "§c[" + V.tag + "] The arena could not be loaded."); G = null; removeAreas(dim, AREA); return; }
      yield* resetJob(a);
      const spots = PILLARS.map((_, i) => i).sort(() => Math.random() - 0.5);
      let n = 0;
      for (const id of ids) {
        const p = online(id); if (!p) continue;
        const l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
        const map = storeInv(a, p, n);
        if (!map) { say(player, "§c[" + V.tag + "] A locker is missing or not empty: " + p.name + " can not play (his things were NOT touched)."); continue; }
        const pil = spots[n % spots.length];
        G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, map, lv: p.level, xp: p.xpEarnedAtCurrentLevel, pil, locker: n };
        G.alive.push(id); n++;
        saveG();
        const pp = PILLARS[pil];
        try { p.teleport(abs(a, { x: pp.x, y: POF.TOP + 1, z: pp.z }), { dimension: dim, facingLocation: abs(a, { x: 0, y: POF.TOP, z: 0 }) }); } catch (e) { /* ignore */ }
        try { p.setGameMode(GameMode.Survival); p.addEffect("saturation", 40, { amplifier: 10, showParticles: false }); const h = p.getComponent("minecraft:health"); h?.resetToMaxValue(); } catch (e) { /* ignore */ }
        tell(p, "§6§l[" + V.name + "] §r§fStay on the pillars! §7You get a random item every " + G.item + " s. Push the others into the void. The pillars fall one by one. Last one standing wins! §8(Your own things are safe in a locker and come back after.)",
          "§6§l[" + V.nameAr + "] §r§fخليك فوق الأعمدة! §7تجيك أغراض عشوائية كل " + G.item + " ثانية. طيّح الباقين بالفراغ. الأعمدة تطيح وحدة ورا وحدة. آخر واحد صامد يفوز! §8(أغراضك محفوظة بخزانة وترجعلك بعدين.)");
        yield;
      }
      if (G.alive.length < 2) { say(player, "§c[" + V.tag + "] Not enough players."); for (const id of G.alive) giveBackOrKeep(id, G.pl[id]); G = null; saveG(); return; }
      G.phase = "count"; G.until = system.currentTick + COUNT * 20;
      const names = G.alive.map((id) => G.pl[id].n).join(", ");
      for (const q of world.getAllPlayers()) tell(q, "§6§l[" + V.name + "] §r§fA game starts! §7" + G.alive.length + " players: §f" + names + " §e/" + V.cmd + "", "§6§l[" + V.nameAr + "] §r§fبدت لعبة! §7" + G.alive.length + " لاعب: §f" + names + " §e/" + V.cmd + "");
      try { slog(player, "pillars", null, "game started: " + G.alive.length + " players"); } catch (e) { /* ignore */ }
    } catch (e) { console.warn("[pillars] start: " + e); }
    finally { busy = false; }
  })());
  return { ok: true };
}
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const rec = G.pl[id], p = online(id), left = G.alive.length;
  if (why === "died") keepPending(id, rec);                         // dead: given back when he has respawned (the 2 s loop)
  else if (p) {
    try { p.dimension.spawnParticle("minecraft:huge_explosion_emitter", p.location); } catch (e) { /* ignore */ }
    try { p.onScreenDisplay.setTitle("§c§l" + pick(p, "ELIMINATED", "انقصيت"), { subtitle: "§7" + pick(p, "Place #" + (left + 1) + " - your things are back", "المركز #" + (left + 1) + " - رجعت أغراضك"), fadeInDuration: 3, stayDuration: 50, fadeOutDuration: 10 }); p.playSound("mob.wither.hurt", { volume: 0.5, pitch: 1.2 }); } catch (e) { /* ignore */ }
    giveBackOrKeep(id, rec);
  } else keepPending(id, rec);
  if (p) { try { const s = stats(p); s[V.lose] = (s[V.lose] ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } }
  const reason = (q) => (why === "void" ? pick(q, "fell into the void", "طاح بالفراغ") : why === "died" ? pick(q, "was killed", "انقتل") : why === "away" ? pick(q, "left the arena", "طلع من الساحة") : pick(q, "left the game", "طلع من اللعبة"));
  toAll((q) => q.sendMessage("§c☠ §f" + rec.n + " §7" + reason(q) + "! §e" + pick(q, "Players left: ", "اللاعبين الباقين: ") + left));
  if (G.alive.length <= 1 && G.phase !== "end") win();
}
function win() {
  const a = arena(), wid = G.alive[0], rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 120;
  if (wp) { try { const s = stats(wp); s[V.win] = (s[V.win] ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } catch (e) { /* ignore */ } }
  const second = G.order.length ? G.pl[G.order[G.order.length - 1]].n : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§6§l[" + V.name + "] §r" + (rec ? "§e§l" + rec.n + " §r§awins!" + (G.prize ? " §7(prize: §a" + money(G.prize) + "§7)" : "") : "§7Nobody wins.") + (second ? " §72nd: §f" + second : ""),
      "§6§l[" + V.nameAr + "] §r" + (rec ? "§e§l" + rec.n + " §r§aفاز!" + (G.prize ? " §7(الجائزة: §a" + money(G.prize) + "§7)" : "") : "§7محد فاز.") + (second ? " §7الثاني: §f" + second : ""));
    if (inArena(q) || G.pl[q.id]) { try { q.onScreenDisplay.setTitle("§6§l" + (rec ? rec.n : "-"), { subtitle: "§e" + pick(q, "LAST ONE STANDING!", "آخر واحد صامد!"), fadeInDuration: 5, stayDuration: 70, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = wp ? wp.location : abs(a, { x: 0, y: POF.TOP + 2, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => { for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } } try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ } }, i * 8);
}
function stopPillars(reason = "stopped") {
  if (!G) return;
  const g = G, a = arena(); G = null;
  for (const id of g.alive) giveBackOrKeep(id, g.pl[id]);
  saveG();
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§6[" + V.tag + "] §7The game was stopped. Everybody got his things back.", "§6[" + V.tagAr + "] §7انوقفت اللعبة. الكل رجعت له أغراضه.");
  if (a) system.runJob((function* () { yield* resetJob(a); removeAreas(dimOf(a), AREA); })());
}

// the pillars fall (outer ring first), then the centre breaks ring by ring
function nextPillar() {
  const left = PILLARS.map((p, i) => i).filter((i) => !G.gone.has(i));
  if (!left.length) return null;
  const outer = left.filter((i) => PILLARS[i].ring === 0);
  const pool = outer.length ? outer : left.length > 1 || G.center >= 0 ? left : left;
  return pool[rnd(pool.length)];
}
function warnPillar(a, i, on) { const p = PILLARS[i]; try { fillRel(a, dimOf(a), { from: { x: p.x - POF.H, y: POF.TOP, z: p.z - POF.H }, to: { x: p.x + POF.H, y: POF.TOP, z: p.z + POF.H } }, on ? "redstone_block" : p.color + "_concrete"); } catch (e) { /* ignore */ } }
function dropPillar(a, i) {
  const p = PILLARS[i], dim = dimOf(a);
  try { fillRel(a, dim, { from: { x: p.x - POF.H, y: POF.BASE, z: p.z - POF.H }, to: { x: p.x + POF.H, y: POF.TOP, z: p.z + POF.H } }, "air"); } catch (e) { /* ignore */ }
  try { dim.playSound("random.explode", abs(a, { x: p.x, y: POF.TOP, z: p.z }), { volume: 4, pitch: 0.7 }); dim.spawnParticle("minecraft:huge_explosion_emitter", abs(a, { x: p.x, y: POF.TOP, z: p.z })); } catch (e) { /* ignore */ }
  G.gone.add(i);
}
function breakCenterRing(a) {
  const rings = centerRings(), r = rings[G.center]; if (!r) return false;
  const dim = dimOf(a);
  for (const c of r) { try { dim.getBlock({ x: a.cx + c.x, y: a.cy + c.y, z: a.cz + c.z })?.setType("minecraft:air"); } catch (e) { /* ignore */ } }
  if (G.center === Math.max(0, rings.length - 2)) { try { fillRel(a, dim, D.centerCore(), "air"); } catch (e) { /* ignore */ } }
  try { dim.playSound("random.anvil_land", abs(a, { x: 0, y: POF.TOP, z: 0 }), { volume: 3, pitch: 0.6 }); } catch (e) { /* ignore */ }
  G.center++;
  return true;
}
function randomEvent(a) {
  const list = ["rain", "night", "lucky", "gravity", "speed"], ev = list[rnd(list.length)];
  const T = { rain: ["§9§lBLOCK RAIN", "مطر بلوكات"], night: ["§8§lSUDDEN NIGHT", "ليل مفاجئ"], lucky: ["§6§lLUCKY DROP", "هدية الحظ"], gravity: ["§d§lLOW GRAVITY", "جاذبية خفيفة"], speed: ["§b§lSPEED RUSH", "سرعة"] }[ev];
  toAll((p) => { p.onScreenDisplay.setTitle(pick(p, T[0], T[0].slice(0, 4) + T[1]), { subtitle: "§7" + pick(p, "Random event!", "حدث عشوائي!"), fadeInDuration: 3, stayDuration: 35, fadeOutDuration: 8 }); p.playSound("mob.evocation_illager.prepare_summon", { volume: 0.6 }); });
  const dim = dimOf(a);
  for (const id of G.alive) {
    const p = online(id); if (!p) continue;
    try {
      if (ev === "night") { p.addEffect("darkness", 300, { amplifier: 0 }); p.addEffect("blindness", 60, { amplifier: 0 }); }
      if (ev === "gravity") { p.addEffect("jump_boost", 200, { amplifier: 2 }); p.addEffect("slow_falling", 120, { amplifier: 0 }); }
      if (ev === "speed") p.addEffect("speed", 240, { amplifier: 2 });
      if (ev === "lucky") giveRandom(p, Math.random() < 0.2 ? "legendary" : "rare");
    } catch (e) { /* ignore */ }
  }
  if (ev === "rain") {
    const kinds = ["white_concrete_powder", "orange_concrete_powder", "lime_concrete_powder", "light_blue_concrete_powder", "pink_concrete_powder", "yellow_concrete_powder", "sand", "gravel"];
    for (let k = 0; k < 18; k++) system.runTimeout(() => {
      try { const ang = Math.random() * Math.PI * 2, r = Math.random() * POF.RAIN_R, x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r); dim.getBlock({ x: a.cx + x, y: a.cy + POF.TOP + 18, z: a.cz + z })?.setPermutation(perm(kinds[rnd(kinds.length)])); } catch (e) { /* ignore */ }
    }, k * 3);
  }
}

// the 1-tick loop: out of the arena / the void; the 1 s loop: items, events, pillars
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopPillars(); return; }
  try {
    const t = system.currentTick;
    if (G.phase === "end") { if (t >= G.until) { const w = G.alive[0]; if (w) giveBackOrKeep(w, G.pl[w]); G.alive = []; stopPillars("end"); } return; }
    if (G.phase === "prep") return;
    if (G.phase === "count") {
      if ((G.until - t) % 20 === 0 && t < G.until) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + Math.ceil((G.until - t) / 20), { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
      if (t >= G.until) { G.phase = "run"; G.start = t; G.nextItem = t + 40; G.nextEvent = t + EVENT_EVERY * 20; G.nextPillar = t + SHRINK_AFTER * 20; toAll((p) => { p.onScreenDisplay.setTitle("§a§l" + pick(p, "GO!", "ابدأ!"), { subtitle: "§6" + pick(p, "Good luck!", "حظ موفق!"), fadeInDuration: 2, stayDuration: 20, fadeOutDuration: 6 }); p.playSound("note.pling", { pitch: 1.6 }); }); }
    }
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      if (p.dimension.id !== a.d) { eliminate(id, "away"); continue; }
      const r = relOf(a, p.location);
      if (r.y < POF.OUT_Y) { eliminate(id, "void"); continue; }
      if (Math.hypot(r.x, r.z) > POF.OUT_R || r.y > POF.TOP + 40) { eliminate(id, "away"); continue; }
      if (G.phase === "count") { const pp = PILLARS[G.pl[id].pil]; if (Math.abs(r.x - pp.x) > POF.H + 0.6 || Math.abs(r.z - pp.z) > POF.H + 0.6) { try { p.teleport(abs(a, { x: pp.x, y: POF.TOP + 1, z: pp.z }), { facingLocation: abs(a, { x: 0, y: POF.TOP, z: 0 }) }); } catch (e) { /* ignore */ } } }
    }
    if (!G || G.phase !== "run") return;
    if (t >= G.nextItem) { G.nextItem = t + G.item * 20; for (const id of G.alive) { const p = online(id); if (p) giveRandom(p); } }
    if (G.events && t >= G.nextEvent) { G.nextEvent = t + EVENT_EVERY * 20; randomEvent(a); }
    if (t >= G.nextPillar) {
      if (G.warn === null) {
        const i = nextPillar();
        if (i !== null && G.gone.size < PILLARS.length) {
          G.warn = i; G.warnEnd = t + WARN * 20;
          toAll((p) => p.sendMessage("§c⚠ " + pick(p, "A pillar falls in " + WARN + " s! §7(the red one)", "عمود يطيح بعد " + WARN + " ثواني! §7(الأحمر)")));
        } else {
          G.nextPillar = t + 200;
          if (breakCenterRing(a)) toAll((p) => p.sendMessage("§c⚠ " + pick(p, "The centre platform is breaking!", "المنصة الوسطية تتكسر!")));
          else {                                                       // nothing left: the built blocks vanish too (no endless game)
            const dim = dimOf(a), air = perm("air");
            for (const k of placed) { const [x, y, z] = k.split("|").map(Number); try { dim.getBlock({ x, y, z })?.setPermutation(air); } catch (e) { /* ignore */ } }
            placed.clear();
            toAll((p) => p.sendMessage("§c⚠ " + pick(p, "THE VOID: every built block disappears!", "الفراغ: كل البلوكات المبنية تختفي!")));
          }
        }
      } else if (t >= G.warnEnd) { dropPillar(a, G.warn); G.warn = null; G.nextPillar = t + G.pillar * 20; }
      else if ((G.warnEnd - t) % 10 === 0) warnPillar(a, G.warn, ((G.warnEnd - t) / 10) % 2 === 0);
    }
  } catch (e) { console.warn("[pillars] tick: " + e); }
}, 1);
system.runInterval(() => {
  if (!G || G.phase !== "run") return;
  const a = arena(); if (!a) return;
  const t = system.currentTick, left = PILLARS.length - G.gone.size;
  for (const p of world.getAllPlayers()) {
    if (!inArena(p)) continue;
    if (!G.alive.includes(p.id) && !owner(p)) {                     // a viewer who came into the play area: to the viewers' ring
      stripGameItems(p);
      const r = relOf(a, p.location); if (Math.hypot(r.x, r.z) < POF.OUT_R + 2 && r.y > POF.OUT_Y - 10 && r.y < POF.TOP + 7) { try { p.teleport(abs(a, POF.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: POF.TOP, z: 0 }) }); } catch (e) { /* ignore */ } }
      continue;
    }
    if (!G.alive.includes(p.id)) { stripGameItems(p); continue; }
    bar(p, "§6§l" + V.short + " §r§7| §f" + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §f" + pick(p, "Pillars", "الأعمدة") + ": §e" + left + " §7| §b" + pick(p, "item in ", "غرض بعد ") + Math.max(0, Math.ceil((G.nextItem - t) / 20)) + "s");
  }
}, 20);
function stripGameItems(p) {
  const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return;
  for (let i = 0; i < inv.size; i++) { try { const it = inv.getItem(i); if (it && it.getLore().includes(LORE[0])) inv.setItem(i, undefined); } catch (e) { /* ignore */ } }
}
safe("lostItem", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => {      // a game item thrown out of the play area: gone
  if (!G || entity.typeId !== "minecraft:item") return;
  system.runTimeout(() => { try { const a = arena(); if (!a || !entity.isValid) return; const r = relOf(a, entity.location); if (Math.hypot(r.x, r.z) > POF.OUT_R + 1 && entity.getComponent("minecraft:item")?.itemStack?.getLore().includes(LORE[0])) entity.remove(); } catch (e) { /* ignore */ } }, 40);
}));
// death in the game: the drops are removed (they were only game items), the player is out, everything comes back at respawn
const fresh = new Map();
safe("spawned", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => { try { if (G && (entity.typeId === "minecraft:item" || entity.typeId === "minecraft:xp_orb")) fresh.set(entity.id, system.currentTick); } catch (e) { /* ignore */ } }));
system.runInterval(() => { const t = system.currentTick; for (const [id, k] of fresh) if (t - k > 40) fresh.delete(id); }, 100);
safe("die", () => world.afterEvents.entityDie.subscribe(({ deadEntity: d }) => {
  if (!G || d?.typeId !== "minecraft:player" || !G.alive.includes(d.id)) return;
  const dim = d.dimension, at = { ...d.location }, t0 = system.currentTick;
  const clean = () => { try { for (const e of dim.getEntities({ location: at, maxDistance: 6 })) { const k = fresh.get(e.id); if (k !== undefined && k >= t0 - 2) { try { e.remove(); } catch (x) { /* ignore */ } } } } catch (e) { /* ignore */ } };
  clean(); system.run(clean); system.runTimeout(clean, 3);
  eliminate(d.id, "died");
}));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id] || !G.alive.includes(player.id)) return;
  const rec = G.pl[player.id];
  system.run(() => { keepPending(player.id, rec); eliminate(player.id, "left"); });
}));

// ---------------------------------------------------------------- protection + building rules
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const DANGER = /^(lava_bucket|flint_and_steel|fire_charge|tnt|tnt_minecart|end_crystal|respawn_anchor|piston|sticky_piston|bed|.+_bed)$/;
const FALLING = /(concrete_powder|^sand|^gravel|^red_sand)$/;
const playing = (p) => !!G && G.phase === "run" && G.alive.includes(p.id);
const bkey = (x, y, z) => x + "|" + y + "|" + z;
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!pillarsAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  if (playing(ev.player) && (placed.has(bkey(b.x, b.y, b.z)) || FALLING.test(b.typeId.replace("minecraft:", "")))) { placed.delete(bkey(b.x, b.y, b.z)); return; }
  ev.cancel = true; deny(ev.player, "§c[" + V.tag + "] You can only break blocks that players placed.", "§c[" + V.tagAr + "] تقدر تكسر بس البلوكات اللي حطوها اللاعبين.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id; if (!pillarsAt(d, b.x, b.y, b.z)) return;
  const item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (!playing(p)) { ev.cancel = true; return; }
  if (item && DANGER.test(item)) { ev.cancel = true; return deny(p, "§c[" + V.tag + "] Not allowed here.", "§c[" + V.tagAr + "] ممنوع هنا."); }
  if (/barrel|chest|shulker|hopper|dispenser|dropper|furnace|smoker/.test(b.typeId)) ev.cancel = true;       // no containers
}));
safe("placed", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  if (!G || !pillarsAt(block.dimension.id, block.x, block.y, block.z)) return;
  if (!playing(player) && !owner(player)) { system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } }); return; }
  placed.add(bkey(block.x, block.y, block.z));
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!arena()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !pillarsAt(d, b.x, b.y, b.z) || placed.has(bkey(b.x, b.y, b.z)));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
function pillarsPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => pillarsPage(player, back), a = arena(), c = conf();
  const f = makeOpr(V.title, SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§6§l" + V.name + "\n§r§7Random items, 16 pillars in the sky,\n§r§7the last one standing wins.\n§r§7Arena: " + (busy ? "§ebusy" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/" + V.cmd + "", "textures/blocks/quartz_block_lines", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the arena here\n§r§7" + V.desc + "\n§r§7The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the " + V.tag + " arena here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in " + D.size + " blocks around you,", "§7" + POF.UP + " blocks high, is replaced (Undo puts it back)."], () => buildPillars(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length, waiting = Object.keys(pend()).length;
    set(f, 1 * COLS + 1, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 3, hdr(Math.min(99, c.item)) + "§f§lRandom item every\n§r§7Now: §e" + c.item + " s\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.item = ITEM_EVERY[(ITEM_EVERY.indexOf(c.item) + 1) % ITEM_EVERY.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 4, hdr(Math.min(99, c.pillar)) + "§f§lA pillar falls every\n§r§7Now: §e" + c.pillar + " s §7(from 90 s)\n§r§eClick to change", "textures/blocks/stonebrick", { run: () => { c.pillar = PILLAR_EVERY[(PILLAR_EVERY.indexOf(c.pillar) + 1) % PILLAR_EVERY.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 5, hdr(1, c.events ? "g" : "r") + "§f§lRandom events\n§r§7Now: " + (c.events ? "§aON" : "§cOFF") + "\n§r§7Block rain, night, lucky drop,\n§r§7low gravity, speed (every 60 s)\n§r§eClick to switch", "textures/items/nether_star", { run: () => { c.events = c.events ? 0 : 1; saveCfg(); self(); } });
    set(f, 1 * COLS + 7, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 && !waiting ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, countdown " + COUNT + " s\n§r§7Their own things go into lockers\n§r§7and come back after the game" + (waiting ? "\n§r§c" + waiting + " player(s) still wait for their things" : "") + "\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startPillars(player); if (r.err) say(player, "§c[" + V.tag + "] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the viewers' ring", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, POF.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: POF.TOP, z: 0 }) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the " + V.tag + " arena?", ["§7The land comes back as it was."], () => undoPillars(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", ") + "\n§r§7Pillars left: §e" + (PILLARS.length - G.gone.size), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody gets his\n§r§7things back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody gets his own things back."], () => stopPillars(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf();
  const f = makeOpr(V.tag + ": players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/gold_ingot" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[" + V.tag + "] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody at the arena\n§r§7Adds the players who are at the arena", "textures/items/gold_ingot", { run: () => {
    for (const p of world.getAllPlayers()) if (inArena(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
V.hook.page = pillarsPage;

// ---------------------------------------------------------------- /pillars (every player)
function pillarsMenu(player) {
  const f = makeOpr(V.name, SHORT_ROWS); f.self = () => pillarsMenu(player); f.glass = true;
  const a = arena();
  let top = []; try { top = ranking(V.list).slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§6§l" + V.name + "\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/gold_ingot", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lWatch\n§r§7" + (a ? "The viewers' ring" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, V.p)) return;
    teleportWithFx(player, abs(a, POF.view), a.d, V.p, () => tell(player, "§a[" + V.tag + "] Welcome!", "§a[" + V.tagAr + "] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s[V.win] ?? 0) + "\n§r§7Losses: §c" + (s[V.lose] ?? 0), "textures/items/gold_ingot", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:" + V.cmd, description: V.name + ": the game, the arena, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { pillarsMenu(p); } catch (e) { console.warn("[pillars] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[pillars] command: " + e); }
});
Object.assign(SELF, { holds: (id) => !!(G && G.pl[id] && !G.pl[id].done) || !!pend()[id], buildPillars, undoPillars, startPillars, stopPillars, pillarsView, pillarsAt, pillarsPage, pillarsMenu });
GAMES.push(SELF);
return SELF;
}
const GAMES = [];
/** the classic game: 16 pillars 7 x 7 (all the old names and data stay the same) */
export const CLASSIC = makeGame({ design: BIG, k: "pf", p: "pillars", cmd: "pillars", tag: "Pillars", tagAr: "الأعمدة", name: "Pillars of Fortune", nameAr: "أعمدة الحظ", short: "PILLARS",
  title: "Event: Pillars", lore: "§8Pillars of Fortune item", win: "pw", lose: "pl", list: "pillars", hook: pillarsHook, desc: "16 pillars (7 x 7, 80 high) in a\n§r§7circle + a centre platform, 93 x 93" });
/** the hard game: 16 pillars of ONE block */
export const ONE = makeGame({ design: SMALL, k: "pq", p: "pillars1", cmd: "pillars1", tag: "Pillars 1x1", tagAr: "أعمدة 1×1", name: "Pillars of Fortune 1x1", nameAr: "أعمدة الحظ 1×1", short: "PILLARS 1x1",
  title: "Event: Pillars 1x1", lore: "§8Pillars of Fortune 1x1 item", win: "qw", lose: "ql", list: "pillars1", hook: pillars1Hook, desc: "16 pillars of ONE block (80 high)\n§r§7in a circle + a 1 x 1 centre, 77 x 77" });
export const { buildPillars, undoPillars, startPillars, stopPillars, pillarsView, pillarsAt, pillarsPage, pillarsMenu } = CLASSIC;
