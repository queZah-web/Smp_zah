// ===================================================================================================================
// SKY WARS (event)  -  /opr > Building > Sky Wars  or  /opr > Events > Sky Wars  (Owner)   and   /skywars (every player)
//
// The Owner builds the arena (skywarsdesign.js) for 10 or 20 players: a centre island and a ring of player islands in the
// sky, 32 blocks apart.  Then he runs games:
//   * chooses the players (2 - 10 / 20), the time limit and the prize
//   * Start: the islands are built again as new and every chest gets NEW random loot (every game is different):
//       island chests: swords, axes, armour, blocks, food, bows, pearls, snowballs, eggs, buckets, TNT, splash potions...
//       centre chests (the best): diamond / enchanted gear, golden apples, power bows, knockback stick, more TNT, strong
//       potions, rarely an enchanted golden apple or a totem
//   * the OWN things of every player (inventory, armour, off hand) + his XP are put into a hidden locker (barrels buried
//     under the arena in barrier blocks) and written into the LOOT RECORD (/opr: the staff can see it and give it back)
//     -> everybody starts with NOTHING.  Every player gets an island, 10 s countdown (nobody moves), GO.
//   * everything is allowed: fight, break the islands, build bridges, place blocks.  TNT lights itself when it is placed.
//     Buying and selling (shop, /sell, auction, orders, /pay) is OFF for the players of the game.
//   * OUT = dying, falling into the void, leaving the arena / the game.  Everything from the game is gone at once, his own
//     things + XP come back EXACTLY and he goes to his HOME (his first saved /home; no home = where he was before).
//   * the last one alive wins (prize, stats, fireworks); his game things are gone too and he goes back to where he was.
//     Time over: the player with the most kills wins (a tie = nobody).  After the game the islands are put back.
//   * a player who leaves the server / a restart: his things are given back when he joins again.
// No lag: the islands are rebuilt with fills + a slow job; while a game runs only the players' positions are checked.
// ===================================================================================================================
import { world, system, ItemStack, GameMode, BlockVolume, StructureSaveMode, EquipmentSlot, EnchantmentTypes, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, roleOf, slog, econLocks } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, skywarsHook } from "./spawnbuild.js";
import { TOP, layout, lockerAt, skyGen, lockerBlocks } from "./skywarsdesign.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";
import { exOf } from "../smp/store.js";

const KEY = "skw:arena", CFG_KEY = "skw:cfg", MKEY = "skw:m", PEND_KEY = "skw:pend", HIDX = "skw:hidx", HREC = "skw:h:", AREA = "smp_skw_";
const PRIZES = [0, 2500, 5000, 10000, 25000], MINUTES = [10, 15, 20, 30], COUNT = 10, HIST_MAX = 120;
const LORE = ["§8Sky Wars item", "§7(disappears after the game)"];
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[skywars] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const staffAdmin = (p) => { try { const r = roleOf(p); return r === "owner" || r === "admin"; } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[skywars] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const rnd = (n) => Math.floor(Math.random() * n);
const pretty = (id) => String(id).replace(/^minecraft:/, "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

// ---------------------------------------------------------------- the arena record { d, cx, cy, cz, n, x1..z2, tiles }
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const skyAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!skyAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
let cfg = null;
const conf = () => (cfg ??= { prize: 10000, minutes: 15, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());
const L = () => layout(arena()?.n ?? 10);

// ---------------------------------------------------------------- building / rebuilding the islands
let busy = false;
let design = null;                                    // { canvas, chests, spawns, L } of the built layout (made once)
function* getDesign(n) { if (design && design.L.n === n) return design; const g = skyGen(n); let r; while (!(r = g.next()).done) yield; design = r.value; return design; }
function* placeCanvas(a, dim, canvas, progress) {
  const og = canvas.orderedGen(); let r; while (!(r = og.next()).done) yield;
  const pal = canvas.pal.map((p) => perm(p.id, p.st)); let k = 0;
  for (const b of r.value) for (let i = 0; i < b.length; i += 4) {
    const p = pal[b[i + 3]];
    if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { /* ignore */ } }
    if (++k % 80 === 0) { if (progress) progress(k); yield; }
  }
}
function* clearSky(a, dim, from, to) {
  const air = perm("air"), H = layout(a.n).HX;
  for (let x = -H; x <= H; x++) { try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + from, z: a.cz - H }, { x: a.cx + x, y: a.cy + to, z: a.cz + H }), air); } catch (e) { /* not loaded */ } if (x % 3 === 0) yield; }
}
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Sky Wars] Building:"))) { removeAreas(dim, AREA); say(player, "§c[Sky Wars] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:skw_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[skywars] backup: " + e); }
      bar(player, "§a[Sky Wars] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    yield* clearSky(a, dim, 1, layout(a.n).UP);
    for (const b of lockerBlocks()) { try { dim.getBlock({ x: a.cx + b.x, y: a.cy + b.y, z: a.cz + b.z })?.setPermutation(perm(b.id, b.st)); } catch (e) { /* ignore */ } }
    const d = yield* getDesign(a.n);
    yield* placeCanvas(a, dim, d.canvas, (k) => bar(player, "§a[Sky Wars] §fBuilding the islands... §e" + k));
    removeAreas(dim, AREA);
    say(player, "§a[Sky Wars] The arena is ready (" + a.n + " islands)! §7(" + Math.round((Date.now() - t0) / 1000) + " s) §aStart a game in §f/opr > Events > Sky Wars§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[skywars] build: " + e); say(player, "§c[Sky Wars] Building stopped: " + e); removeAreas(dim, AREA); }
  finally { busy = false; }
}
export function buildSky(player, n) {
  if (!owner(player)) return say(player, "§c[Sky Wars] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[Sky Wars] The arena is being built right now.");
  if (arena()) return say(player, "§c[Sky Wars] The arena already exists. Undo it first.");
  const Ly = layout(n), dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - Ly.DOWN < hr.min || cy + Ly.UP >= hr.max) return say(player, "§c[Sky Wars] Too high here: the islands are " + TOP + " blocks over you. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, n, x1: cx - Ly.HX - 1, y1: cy - Ly.DOWN, z1: cz - Ly.HX - 1, x2: cx + Ly.HX + 1, y2: cy + Ly.UP, z2: cz + Ly.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Sky Wars] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Sky Wars] Building the arena for " + n + " players (" + (Ly.HX * 2 + 1) + " x " + (Ly.HX * 2 + 1) + ")... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "skywars", null, "built (" + n + ") at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Sky Wars] Undo:"))) { removeAreas(dim, AREA); say(player, "§c[Sky Wars] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[skywars] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    A = null; saveA(); design = null;
    removeAreas(dim, AREA);
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Sky Wars] Removed: the land is back as it was." : "§e[Sky Wars] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoSky(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Sky Wars] Stop the game first.");
  if (Object.keys(pend()).length) return say(player, "§c[Sky Wars] Some players still have their things in the lockers (they are offline). Wait until they join again.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}
/** the islands as new: the sky over the arena cleared, every island built again, items / arrows removed */
function* resetJob(a) {
  const dim = dimOf(a); if (!dim) return;
  const Ly = layout(a.n);
  yield* clearSky(a, dim, Ly.voidY - 4, Ly.UP);
  const d = yield* getDesign(a.n);
  yield* placeCanvas(a, dim, d.canvas);
  try { for (const e of dim.getEntities({ location: abs(a, { x: 0, y: TOP, z: 0 }), maxDistance: Ly.HX + 20 })) { if (["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:tnt", "minecraft:snowball", "minecraft:egg", "minecraft:ender_pearl", "minecraft:falling_block"].includes(e.typeId)) { try { e.remove(); } catch (x) { /* ignore */ } } } } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- the random loot (new every game)
const ench = (it, list) => { try { const c = it.getComponent("minecraft:enchantable"); for (const [t, l] of list ?? []) c?.addEnchantment({ type: EnchantmentTypes.get(t), level: l }); } catch (e) { /* ignore */ } return it; };
// [id, min, max, enchants?, name?]   potions: ["#potion", aux, form]
const POOL = {
  weapon: [["stone_sword", 1, 1], ["iron_sword", 1, 1], ["stone_axe", 1, 1], ["wooden_sword", 1, 1, [["sharpness", 1]]], ["iron_axe", 1, 1], ["bow", 1, 1], ["golden_sword", 1, 1, [["sharpness", 2]]]],
  armor: [["leather_helmet", 1, 1], ["chainmail_chestplate", 1, 1], ["chainmail_leggings", 1, 1], ["iron_helmet", 1, 1], ["iron_boots", 1, 1], ["golden_chestplate", 1, 1], ["iron_leggings", 1, 1], ["chainmail_boots", 1, 1], ["leather_chestplate", 1, 1, [["protection", 2]]]],
  blocks: [["cobblestone", 24, 48], ["oak_planks", 24, 48], ["white_wool", 24, 48], ["stone", 16, 32], ["glass", 12, 24], ["oak_log", 6, 12], ["andesite", 16, 32], ["sandstone", 16, 32]],
  food: [["bread", 3, 6], ["cooked_beef", 2, 5], ["apple", 2, 5], ["golden_carrot", 2, 4], ["cooked_chicken", 2, 5], ["baked_potato", 3, 6]],
  util: [["ender_pearl", 1, 1], ["snowball", 8, 16], ["egg", 8, 16], ["water_bucket", 1, 1], ["lava_bucket", 1, 1], ["tnt", 2, 4], ["flint_and_steel", 1, 1], ["fishing_rod", 1, 1], ["web", 2, 4], ["fire_charge", 1, 3], ["arrow", 8, 16], ["shield", 1, 1], ["iron_pickaxe", 1, 1], ["ladder", 6, 12]],
  potion: [["#potion", 21, "splash_potion"], ["#potion", 14, "potion"], ["#potion", 31, "potion"], ["#potion", 12, "potion"], ["#potion", 28, "splash_potion"], ["#potion", 9, "potion"]],
  // the centre: better
  cweapon: [["diamond_sword", 1, 1, [["sharpness", 1]]], ["iron_sword", 1, 1, [["sharpness", 2]]], ["diamond_axe", 1, 1], ["bow", 1, 1, [["power", 2]]], ["stick", 1, 1, [["knockback", 2]], "§6§lKnockback Stick"], ["crossbow", 1, 1, [["quick_charge", 1]]], ["diamond_sword", 1, 1, [["fire_aspect", 1]]]],
  carmor: [["diamond_helmet", 1, 1, [["protection", 1]]], ["diamond_chestplate", 1, 1], ["diamond_leggings", 1, 1, [["protection", 1]]], ["diamond_boots", 1, 1, [["feather_falling", 2]]], ["iron_chestplate", 1, 1, [["protection", 2]]], ["iron_leggings", 1, 1, [["protection", 2]]]],
  cutil: [["ender_pearl", 2, 3], ["golden_apple", 2, 3], ["tnt", 4, 6], ["arrow", 16, 24], ["lava_bucket", 1, 1], ["diamond_pickaxe", 1, 1, [["efficiency", 3]]], ["wind_charge", 3, 5], ["obsidian", 4, 8], ["web", 4, 6]],
  cpotion: [["#potion", 22, "splash_potion"], ["#potion", 33, "potion"], ["#potion", 16, "potion"], ["#potion", 30, "splash_potion"], ["#potion", 24, "splash_potion"]],
  crare: [["enchanted_golden_apple", 1, 1], ["totem_of_undying", 1, 1], ["diamond_sword", 1, 1, [["sharpness", 3]]], ["bow", 1, 1, [["power", 3], ["punch", 1]]], ["ender_pearl", 4, 4]],
};
const pickFrom = (k) => POOL[k][rnd(POOL[k].length)];
function makeItem(spec) {
  const [id, a, b, en, name] = spec;
  let it; try { it = new ItemStack("minecraft:" + id, a + rnd(b - a + 1)); } catch (e) { return null; }
  ench(it, en);
  try { if (name) it.nameTag = name; it.setLore(LORE); } catch (e) { /* ignore */ }
  return it;
}
/** what goes into one chest: a list of specs */
function chestPlan(tier, first) {
  const out = [];
  if (tier === "island") {
    if (first) { out.push(pickFrom("weapon"), pickFrom("blocks"), pickFrom("armor"), pickFrom("food")); if (Math.random() < 0.6) out.push(pickFrom("armor")); }
    else { out.push(pickFrom("blocks"), pickFrom("util"), pickFrom("util")); if (Math.random() < 0.5) out.push(pickFrom("potion")); if (Math.random() < 0.6) out.push(pickFrom("armor")); if (Math.random() < 0.4) out.push(pickFrom("weapon")); if (Math.random() < 0.5) out.push(pickFrom("food")); }
  } else {
    out.push(pickFrom("cweapon"), pickFrom("carmor"), pickFrom("cutil"), pickFrom("cutil"));
    if (Math.random() < 0.7) out.push(pickFrom("cpotion"));
    if (Math.random() < 0.6) out.push(pickFrom("carmor"));
    if (Math.random() < 0.15) out.push(pickFrom("crare"));
  }
  return out;
}
function fillChests(a) {
  const d = design, dim = dimOf(a); if (!d || !dim) return;
  const firstOf = new Set();
  for (const c of d.chests) {
    try {
      const b = dim.getBlock({ x: a.cx + c.x, y: a.cy + c.y, z: a.cz + c.z }), box = b?.getComponent("minecraft:inventory")?.container; if (!box) continue;
      for (let i = 0; i < box.size; i++) box.setItem(i, undefined);
      const isle = Math.round(Math.atan2(c.z, c.x) * 100), first = c.tier === "island" && !firstOf.has(isle); if (first) firstOf.add(isle);
      const free = [...Array(box.size).keys()].sort(() => Math.random() - 0.5);
      for (const spec of chestPlan(c.tier, first)) {
        const slot = free.pop(); if (slot === undefined) break;
        if (spec[0] === "#potion") { try { dim.runCommand(`replaceitem block ${a.cx + c.x} ${a.cy + c.y} ${a.cz + c.z} slot.container ${slot} ${spec[2]} 1 ${spec[1]}`); } catch (e) { /* ignore */ } continue; }
        const it = makeItem(spec); if (it) box.setItem(slot, it);
      }
    } catch (e) { /* not loaded */ }
  }
}

// ---------------------------------------------------------------- the lockers (the real items of a player) + the LOOT RECORD
const SLOTS = () => [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const boxOf = (a, n) => { try { const l = lockerAt(n); return dimOf(a).getBlock({ x: a.cx + l.x, y: a.cy + l.y, z: a.cz + l.z })?.getComponent("minecraft:inventory")?.container ?? null; } catch (e) { return null; } };
const enchOf = (it) => { try { return (it.getComponent("minecraft:enchantable")?.getEnchantments() ?? []).map((e) => [e.type.id, e.level]); } catch (e) { return []; } };
const dmgOf = (it) => { try { return it.getComponent("minecraft:durability")?.damage ?? 0; } catch (e) { return 0; } };
const describe = (it) => [it.typeId, it.amount, it.nameTag ?? "", enchOf(it), dmgOf(it)];
/** moves everything of the player into lockers 2n / 2n+1 and writes the loot record. Returns { map, items } or null */
function storeInv(a, p, n) {
  const b = [boxOf(a, 2 * n), boxOf(a, 2 * n + 1)]; if (!b[0] || !b[1]) return null;
  for (const box of b) for (let i = 0; i < box.size; i++) { try { if (box.getItem(i)) return null; } catch (e) { return null; } }
  const inv = p.getComponent("minecraft:inventory")?.container, eq = p.getComponent("minecraft:equippable"), map = [], items = [];
  let k = 0;
  const put = (it) => { const bi = k < 27 ? 0 : 1, si = k % 27; b[bi].setItem(si, it); k++; return [2 * n + bi, si]; };
  if (inv) for (let i = 0; i < inv.size; i++) { let it; try { it = inv.getItem(i); } catch (e) { it = undefined; } if (!it) continue; items.push(["i", i, ...describe(it)]); const [bx, si] = put(it); inv.setItem(i, undefined); map.push(["i", i, bx, si]); }
  SLOTS().forEach((slot, j) => { let it; try { it = eq?.getEquipment(slot); } catch (e) { it = undefined; } if (!it) return; items.push(["e", j, ...describe(it)]); const [bx, si] = put(it); eq.setEquipment(slot, undefined); map.push(["e", j, bx, si]); });
  return { map, items };
}
// the loot record: one world property per entry + an index (newest first)
const hIndex = () => readJson(HIDX, []);
export const lootRecords = (pid) => hIndex().map((id) => readJson(HREC + id, null)).filter((r) => r && (!pid || r.pid === pid));
function addRecord(r) {
  writeJson(HREC + r.id, r);
  const idx = [r.id, ...hIndex().filter((x) => x !== r.id)];
  while (idx.length > HIST_MAX) { const old = idx.pop(); writeJson(HREC + old, null); }
  writeJson(HIDX, idx);
}
function markRecord(id, st, by) { const r = readJson(HREC + id, null); if (!r) return; r.st = st; r.when = Date.now(); if (by) r.by = by; writeJson(HREC + id, r); }

/** removes everything the player has now (all from the game) and gives his own things back. false = the locker is not loaded */
function giveBack(a, p, rec) {
  if (!a) return false;
  for (const [, , bx] of rec.map ?? []) if (!boxOf(a, bx)) return false;
  const inv = p.getComponent("minecraft:inventory")?.container, eq = p.getComponent("minecraft:equippable");
  try { if (inv) for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined); } catch (e) { /* ignore */ }
  SLOTS().forEach((slot) => { try { eq?.setEquipment(slot, undefined); } catch (e) { /* ignore */ } });
  try { p.getComponent("minecraft:cursor_inventory")?.clear?.(); } catch (e) { /* ignore */ }
  for (const [kind, slot, bx, si] of rec.map ?? []) {
    const box = boxOf(a, bx); let it; try { it = box.getItem(si); box.setItem(si, undefined); } catch (e) { it = undefined; }
    if (!it) continue;
    try { if (kind === "i") inv.setItem(slot, it); else eq.setEquipment(SLOTS()[slot], it); }
    catch (e) { try { const rest = inv?.addItem(it); if (rest) p.dimension.spawnItem(rest, p.location); } catch (x) { /* ignore */ } }
  }
  try { p.resetLevel(); if (rec.lv > 0) p.addLevels(rec.lv); if (rec.xp > 0) p.addExperience(rec.xp); } catch (e) { /* ignore */ }
  for (const fx of ["speed", "strength", "regeneration", "absorption", "resistance", "fire_resistance", "jump_boost", "slowness", "poison", "weakness", "invisibility"]) { try { p.removeEffect(fx); } catch (e) { /* ignore */ } }
  try { p.extinguishFire?.(); } catch (e) { /* ignore */ }
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  const to = rec.win ? rec.back : rec.home ?? rec.back;
  try { if (to) p.teleport({ x: to.x, y: to.y, z: to.z }, { dimension: world.getDimension(to.d) }); } catch (e) { /* ignore */ }
  try { econLocks.delete(p.id); } catch (e) { /* ignore */ }
  if (rec.hid) markRecord(rec.hid, "returned");
  return true;
}
const pend = () => readJson(PEND_KEY, {});
const keepPending = (id, rec) => { if (rec.done) return; const all = pend(); all[id] = rec; writeJson(PEND_KEY, all); };
const alivePl = (p) => { try { return (p.getComponent("minecraft:health")?.currentValue ?? 1) > 0; } catch (e) { return true; } };
function giveBackOrKeep(id, rec) {
  if (rec.done) return true;
  const p = online(id), a = arena();
  if (p && alivePl(p) && giveBack(a, p, rec)) { rec.done = 1; if (G?.pl[id]) saveG(); return true; }
  keepPending(id, rec); return false;
}
system.runInterval(() => {
  const all = pend(), ids = Object.keys(all); if (!ids.length) return;
  const a = arena(); if (!a) return;
  let changed = false, need = false;
  for (const id of ids) {
    if (G?.pl[id] && G.alive.includes(id)) continue;
    const p = online(id); if (!p || !alivePl(p)) continue;
    if (all[id].done) { delete all[id]; changed = true; continue; }
    if (giveBack(a, p, all[id])) { all[id].done = 1; if (G?.pl[id]) { G.pl[id].done = 1; saveG(); } delete all[id]; changed = true; tell(p, "§a[Sky Wars] Your own things and your XP are back.", "§a[سكاي وارز] رجعت لك أغراضك والـ XP."); }
    else need = true;
  }
  if (changed) writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  try { const dim = dimOf(a), l = lockerAt(0); if (need) dim.runCommand(`tickingarea add circle ${a.cx + l.x} ${a.cy + l.y} ${a.cz + l.z} 2 ${AREA}lock true`); else if (!Object.keys(all).length) dim.runCommand(`tickingarea remove ${AREA}lock`); } catch (e) { /* ignore */ }
}, 40);

// ---------------------------------------------------------------- the game
let G = null;    // { phase: prep | count | run | end, until, pl: { id: rec }, alive: [ids], order: [ids], start, end, prize, kills: {id: n}, hit: {id: [by, t]} }
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const skyView = () => (G ? { phase: G.phase, alive: [...G.alive], order: [...G.order] } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inArena(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
system.runTimeout(() => {                              // a restart in the middle of a game: everything is given back
  const old = readJson(MKEY, null); if (!old?.pl) return;
  writeJson(MKEY, null);
  for (const [id, rec] of Object.entries(old.pl)) if (!rec.done) keepPending(id, rec);
}, 60);
const homeOf = (p) => { try { const h = (exOf(p.id).homes ?? [])[0]; return h ? { x: h.x, y: h.y, z: h.z, d: h.d } : null; } catch (e) { return null; } };

export function startSky(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  if (Object.keys(pend()).length) return { err: "Some players from the last game still wait for their things (offline). They get them when they join; then start again." };
  const c = conf(), Ly = layout(a.n), ids = c.roster.filter((id) => online(id)).slice(0, Ly.n);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "prep", until: 0, pl: {}, alive: [], order: [], prize: c.prize, minutes: c.minutes, start: 0, kills: {}, hit: {}, by: player.name };
  busy = true;
  const dim = dimOf(a);
  system.runJob((function* () {
    try {
      addAreas(dim, a, AREA);
      if (!(yield* waitLoaded(player, dim, a, "[Sky Wars] Getting the islands ready:"))) { say(player, "§c[Sky Wars] The arena could not be loaded."); G = null; removeAreas(dim, AREA); return; }
      for (const q of world.getAllPlayers()) tell(q, "§b§l[Sky Wars] §r§7The islands are being prepared...", "§b§l[سكاي وارز] §r§7الجزر تتجهز...");
      yield* resetJob(a);
      fillChests(a);
      const spots = design.spawns.map((_, i) => i).sort(() => Math.random() - 0.5);
      let n = 0;
      for (const id of ids) {
        const p = online(id); if (!p) continue;
        const l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
        let lv = 0, xp = 0; try { lv = p.level; xp = p.xpEarnedAtCurrentLevel; } catch (e) { /* ignore */ }
        const st = storeInv(a, p, n);
        if (!st) { say(player, "§c[Sky Wars] A locker is missing or not empty: " + p.name + " can not play (his things were NOT touched)."); continue; }
        const hid = "h" + Date.now().toString(36) + n;
        addRecord({ id: hid, pid: id, n: p.name, t: Date.now(), lv, xp, items: st.items, st: "locked", w: Math.floor(l.x) + " " + Math.floor(l.y) + " " + Math.floor(l.z) + " " + p.dimension.id });
        const sp = design.spawns[spots[n % spots.length]];
        G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, home: homeOf(p), map: st.map, lv, xp, locker: n, sp, hid };
        G.alive.push(id); n++;
        saveG();
        try { econLocks.add(id); } catch (e) { /* ignore */ }
        try { p.teleport(abs(a, sp), { dimension: dim, facingLocation: abs(a, { x: 0, y: TOP + 1, z: 0 }) }); } catch (e) { /* ignore */ }
        try { p.setGameMode(GameMode.Survival); p.getComponent("minecraft:health")?.resetToMaxValue(); p.addEffect("saturation", 60, { amplifier: 10, showParticles: false }); } catch (e) { /* ignore */ }
        tell(p, "§b§l[Sky Wars] §r§fLoot the chests, build bridges, fight! §7Last one alive wins. Falling into the void = out. §8(Your own things are safe in a locker and come back after the game - buying / selling is off.)",
          "§b§l[سكاي وارز] §r§fافتح الصناديق، ابني جسور، وقاتل! §7آخر واحد يبقى عايش يفوز. اللي يطيح بالفراغ يطلع. §8(أغراضك محفوظة بخزانة وترجع بعد اللعبة - الشراء والبيع مطفي.)");
        yield;
      }
      if (G.alive.length < 2) { say(player, "§c[Sky Wars] Not enough players."); for (const id of G.alive) giveBackOrKeep(id, G.pl[id]); G = null; saveG(); return; }
      G.phase = "count"; G.until = system.currentTick + COUNT * 20;
      const names = G.alive.map((id) => G.pl[id].n).join(", ");
      for (const q of world.getAllPlayers()) tell(q, "§b§l[Sky Wars] §r§fA game starts! §7" + G.alive.length + " players: §f" + names + " §e/skywars", "§b§l[سكاي وارز] §r§fبدت لعبة! §7" + G.alive.length + " لاعب: §f" + names + " §e/skywars");
      try { slog(player, "skywars", null, "game started: " + G.alive.length + " players"); } catch (e) { /* ignore */ }
    } catch (e) { console.warn("[skywars] start: " + e); }
    finally { busy = false; }
  })());
  return { ok: true };
}
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const rec = G.pl[id], p = online(id), left = G.alive.length;
  // who gets the kill: the killer, or the last one who hit him (10 s) when he fell
  const h = G.hit[id], killer = why === "died" && rec.killer ? rec.killer : h && system.currentTick - h[1] < 200 ? h[0] : null;
  if (killer && G.pl[killer] && killer !== id) { G.kills[killer] = (G.kills[killer] ?? 0) + 1; const kp = online(killer); if (kp) { try { const s = stats(kp); s.skk = (s.skk ?? 0) + 1; touch(kp); } catch (e) { /* ignore */ } } }
  if (why === "died") keepPending(id, rec);                                     // dead: given back after the respawn
  else if (p) {
    try { p.onScreenDisplay.setTitle("§c§l" + pick(p, "ELIMINATED", "انقصيت"), { subtitle: "§7" + pick(p, "Place #" + (left + 1) + " - your things are back", "المركز #" + (left + 1) + " - رجعت أغراضك"), fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    giveBackOrKeep(id, rec);
  } else keepPending(id, rec);
  if (p) { try { const s = stats(p); s.skl = (s.skl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } }
  const kn = killer && G.pl[killer] ? G.pl[killer].n : null;
  const reason = (q) => (why === "void" ? (kn ? pick(q, "was knocked into the void by " + kn, "طيّحه " + kn + " بالفراغ") : pick(q, "fell into the void", "طاح بالفراغ")) : why === "died" ? (kn ? pick(q, "was killed by " + kn, "انقتل على يد " + kn) : pick(q, "died", "مات")) : why === "away" ? pick(q, "left the arena", "طلع من الساحة") : pick(q, "left the game", "طلع من اللعبة"));
  toAll((q) => q.sendMessage("§c☠ §f" + rec.n + " §7" + reason(q) + "! §e" + pick(q, "Players left: ", "اللاعبين الباقين: ") + left));
  if (G.alive.length <= 1 && G.phase !== "end") win(G.alive[0] ?? null);
}
function win(wid) {
  const a = arena(), rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 140;
  if (wp && rec) { try { const s = stats(wp); s.skw = (s.skw ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } catch (e) { /* ignore */ } }
  const order = [...G.order].reverse(), second = order[0] ? G.pl[order[0]].n : null, third = order[1] ? G.pl[order[1]].n : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§b§l[Sky Wars] §r" + (rec ? "§6§l" + rec.n + " §r§awins! §7(" + (G.kills[wid] ?? 0) + " kills" + (G.prize ? ", prize §a" + money(G.prize) : "") + "§7)" : "§7Nobody wins.") + (second ? " §72nd: §f" + second : "") + (third ? " §73rd: §f" + third : ""),
      "§b§l[سكاي وارز] §r" + (rec ? "§6§l" + rec.n + " §r§aفاز! §7(" + (G.kills[wid] ?? 0) + " قتلة" + (G.prize ? "، الجائزة §a" + money(G.prize) : "") + "§7)" : "§7محد فاز.") + (second ? " §7الثاني: §f" + second : "") + (third ? " §7الثالث: §f" + third : ""));
    if (inArena(q) || G.pl[q.id]) { try { q.onScreenDisplay.setTitle("§6§l" + (rec ? rec.n : "-"), { subtitle: "§b" + pick(q, "WINS SKY WARS!", "فاز بسكاي وارز!"), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = wp ? wp.location : abs(a, { x: 0, y: TOP + 2, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
  if (rec) rec.win = 1;
}
export function stopSky(reason = "stopped") {
  if (!G) return;
  const g = G; G = null;
  for (const [id, rec] of Object.entries(g.pl)) if (!rec.done) { if (g.alive.includes(id) && reason === "end") rec.win = rec.win ?? 0; giveBackOrKeep(id, rec); }
  saveG();
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§b[Sky Wars] §7The game was stopped - everybody got his things back.", "§b[سكاي وارز] §7انوقفت اللعبة - الكل رجعت له أغراضه.");
  const a = arena(); if (a) { busy = true; system.runJob((function* () { try { yield* resetJob(a); } finally { busy = false; } })()); }
}

// ---------------------------------------------------------------- every tick: positions, time
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopSky(); return; }
  try {
    const t = system.currentTick, Ly = layout(a.n);
    if (G.phase === "count") {
      for (const id of G.alive) { const p = online(id), sp = G.pl[id]?.sp; if (!p || !sp) continue; const w = abs(a, sp); if (Math.hypot(p.location.x - w.x, p.location.z - w.z) > 0.8) { try { p.teleport(w, { facingLocation: abs(a, { x: 0, y: TOP + 1, z: 0 }) }); } catch (e) { /* ignore */ } } }
      if (t >= G.until) { G.phase = "run"; G.start = t; G.end = t + G.minutes * 1200; toAll((p) => { p.onScreenDisplay.setTitle("§b§l" + pick(p, "FIGHT!", "قاتل!"), { fadeInDuration: 2, stayDuration: 20, fadeOutDuration: 6 }); p.playSound("note.pling", { pitch: 1.6 }); }); }
      else if (Math.ceil((G.until - t) / 20) !== G.sec) { G.sec = Math.ceil((G.until - t) / 20); toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + G.sec, { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); }); }
    }
    if (G.phase === "end") { if (t >= G.until) stopSky("end"); return; }
    if (G.phase !== "run" && G.phase !== "count") return;
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      const l = p.location;
      if (p.dimension.id !== a.d || Math.abs(l.x - a.cx) > Ly.HX + 3 || Math.abs(l.z - a.cz) > Ly.HX + 3 || l.y - a.cy > Ly.UP + 6) { eliminate(id, "away"); continue; }
      if (l.y - a.cy < Ly.voidY) { eliminate(id, "void"); continue; }
    }
    if (G && G.phase === "run" && t >= G.end) {                                  // time over: the most kills wins
      let best = null, bk = -1, tie = false;
      for (const id of G.alive) { const k = G.kills[id] ?? 0; if (k > bk) { bk = k; best = id; tie = false; } else if (k === bk) tie = true; }
      for (const id of [...G.alive]) if (id !== best || tie) { G.alive = G.alive.filter((x) => x !== id); G.order.push(id); giveBackOrKeep(id, G.pl[id]); }
      toAll((q) => q.sendMessage(pick(q, "§e[Sky Wars] Time is over!", "§e[سكاي وارز] خلص الوقت!")));
      win(tie ? null : best);
    }
  } catch (e) { console.warn("[skywars] tick: " + e); }
}, 2);
// the bar
system.runInterval(() => {
  if (!G || (G.phase !== "run" && G.phase !== "count")) return;
  const left = G.phase === "run" ? Math.max(0, Math.ceil((G.end - system.currentTick) / 20)) : G.minutes * 60;
  toAll((p) => bar(p, "§b§lSKY WARS §r§7| §f" + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §c" + pick(p, "Kills", "قتلات") + ": §f" + (G.kills[p.id] ?? 0) + " §7| §e" + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0")));
}, 10);

// deaths + who hit whom
safe("die", () => world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  if (!G || deadEntity?.typeId !== "minecraft:player") return;
  const id = deadEntity.id; if (!G.alive.includes(id)) return;
  const k = damageSource?.damagingEntity; if (k?.typeId === "minecraft:player") G.pl[id].killer = k.id;
  eliminate(id, "died");
}));
safe("hurt", () => world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  if (!G || hurtEntity?.typeId !== "minecraft:player") return;
  const k = damageSource?.damagingEntity; if (k?.typeId === "minecraft:player" && G.pl[k.id] && k.id !== hurtEntity.id) G.hit[hurtEntity.id] = [k.id, system.currentTick];
}));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id] || G.pl[player.id].done) return;
  const all = pend(); all[player.id] = G.pl[player.id];
  system.run(() => writeJson(PEND_KEY, all));
}));
safe("join", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  try { if (!G?.alive.includes(player.id)) econLocks.delete(player.id); } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- the arena rules: TNT lights itself; outside a game only the Owner changes the arena
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const playing = (p) => !!(G && G.alive.includes(p.id) && G.phase === "run");
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, a = skyAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
  if (playing(ev.player) && b.y - a.cy >= layout(a.n).voidY - 6) return;          // in the game: break anything on the islands
  if (owner(ev.player) && !G) return;
  ev.cancel = true; deny(ev.player, "§c[Sky Wars] You can't break the arena now.", "§c[سكاي وارز] ما تقدر تكسر الساحة هسه.");
}));
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    const a = skyAt(block.dimension.id, block.x, block.y, block.z); if (!a) return;
    if (!playing(player)) { if (owner(player) && !G) return; system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } }); return deny(player, "§c[Sky Wars] You can't build here now.", "§c[سكاي وارز] ما تقدر تبني هنا هسه."); }
    if (block.typeId === "minecraft:tnt") {                                       // TNT lights itself at once
      const at = { x: block.x + 0.5, y: block.y, z: block.z + 0.5 }, dim = block.dimension;
      system.run(() => { try { dim.getBlock(block.location)?.setType("minecraft:air"); dim.spawnEntity("minecraft:tnt", at); } catch (e) { /* ignore */ } });
    }
  } catch (e) { /* ignore */ }
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const a = arena(); if (!a) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks();
  const keep = all.filter((b) => !skyAt(d, b.x, b.y, b.z) || (G && G.phase === "run" && b.y - a.cy >= layout(a.n).voidY - 6));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function skyPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => skyPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: Sky Wars", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§b§lSky Wars\n§r§7Islands in the sky, random loot in\n§r§7the chests, last one alive wins.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.n + " islands, " + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/skywars", "textures/items/diamond_sword", null);
  set(f, 0 * COLS + 8, hdr(Math.min(99, Math.max(1, lootRecords().length))) + "§6§lLoot records\n§r§7What every player had BEFORE a\n§r§7game - give it back if needed\n§r§eClick to open", "textures/ui/shop/i3d_barrel", { run: () => lootListPage(player, self) });
  if (!a) {
    for (const [col, n] of [[3, 10], [5, 20]]) set(f, 2 * COLS + col, hdr(n, "g") + "§a§lBuild for " + n + " players\n§r§7A centre island + " + n + " islands\n§r§7around it, 32 blocks apart, in the\n§r§7sky (" + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + "). The land is saved\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build Sky Wars for " + n + "?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7The islands float " + TOP + " blocks over you", "§7Everything in " + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + " blocks is replaced (Undo puts it back)."], () => buildSky(player, n), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length, max = layout(a.n).n;
    set(f, 1 * COLS + 2, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + max + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 4, hdr(c.minutes) + "§f§lTime limit\n§r§7Now: §e" + c.minutes + " min\n§r§7Then the most kills wins\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.minutes = MINUTES[(MINUTES.indexOf(c.minutes) + 1) % MINUTES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, max) + " players, countdown " + COUNT + " s\n§r§7New islands + new random loot\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startSky(player); if (r.err) say(player, "§c[Sky Wars] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the centre island", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, { x: 0, y: TOP + 4, z: 0 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Sky Wars arena?", ["§7The land comes back as it was."], () => undoSky(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n + " §7(" + (G.kills[id] ?? 0) + ")§f").join(", "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody gets his\n§r§7things back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody gets his own things back."], () => stopSky(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), max = L().n;
  const f = makeOpr("Sky Wars: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 36, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + max + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/diamond_sword" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < max) c.roster.push(p.id); else say(player, "§c[Sky Wars] The game is full (" + max + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody online\n§r§7Adds every online player", "textures/items/diamond_sword", { run: () => { for (const p of world.getAllPlayers()) if (!c.roster.includes(p.id) && c.roster.length < max) c.roster.push(p.id); saveCfg(); self(); } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
skywarsHook.page = skyPage;

// ---------------------------------------------------------------- LOOT RECORDS (Admin / Owner): what a player had before a game, give it back
const ST = { locked: "§eIn the locker (game running / not given back yet)", returned: "§aGiven back", restored: "§bRecreated by the staff" };
export function lootListPage(player, back, pid = null, name = null, page = 0) {
  if (!staffAdmin(player)) return say(player, "§c[Operator] Admin / Owner only.");
  const self = () => lootListPage(player, back, pid, name, page);
  const recs = lootRecords(pid), per = 36, list = recs.slice(page * per, page * per + per);
  const f = makeOpr(name ? "Sky Wars loot: " + name : "Sky Wars loot records", 6); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(Math.max(1, Math.min(99, recs.length))) + "§6§lLoot records\n§r§7Everything a player had when he\n§r§7went into a Sky Wars game\n§r§7Records: §f" + recs.length, "textures/ui/shop/i3d_barrel", null);
  list.forEach((r, i) => {
    const d = new Date(r.t + 3 * 3600000), z = (n) => String(n).padStart(2, "0");
    set(f, 1 * COLS + i, hdr(Math.max(1, Math.min(99, r.items.length)), r.st === "locked" ? "r" : "c") + "§f§l" + r.n + "\n§r§7" + z(d.getUTCDate()) + "-" + z(d.getUTCMonth() + 1) + " " + z(d.getUTCHours()) + ":" + z(d.getUTCMinutes()) + " §8(Baghdad)\n§r§7Stacks: §f" + r.items.length + " §7| Levels: §f" + (r.lv ?? 0) + "\n§r" + (ST[r.st] ?? r.st) + "\n§r§eClick to see", "textures/ui/shop/i3d_barrel", { run: () => lootPage(player, r.id, self) });
  });
  if (recs.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => lootListPage(player, back, pid, name, page + 1) });
  if (page > 0) set(f, 5 * COLS + 7, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => lootListPage(player, back, pid, name, page - 1) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function lootPage(player, rid, back) {
  if (!staffAdmin(player)) return;
  const r = readJson(HREC + rid, null); if (!r) return back();
  const self = () => lootPage(player, rid, back);
  const f = makeOpr("Loot of " + r.n, 6); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, r.st === "locked" ? "r" : "g") + "§6§l" + r.n + " §r§7before Sky Wars\n§r§7" + new Date(r.t + 3 * 3600000).toISOString().replace("T", " ").slice(0, 16) + " §8(Baghdad)\n§r§7Levels: §f" + (r.lv ?? 0) + "\n§r" + (ST[r.st] ?? r.st) + (r.by ? "\n§r§7By: §f" + r.by : ""), "textures/ui/shop/i3d_barrel", null);
  r.items.slice(0, 36).forEach((it, i) => {
    const [kind, slot, id, n, nm, en, dmg] = it;
    set(f, 1 * COLS + i, hdr(Math.min(99, n), en?.length ? "x" : "c") + "§f" + (nm || pretty(id)) + "\n§r§7x" + n + " §8(" + (kind === "e" ? ["helmet", "chest", "legs", "boots", "off hand"][slot] : "slot " + slot) + ")" + (en?.length ? "\n§r§b" + en.slice(0, 5).map(([e, l]) => pretty(e) + " " + l).join("§7, §b") : "") + (dmg ? "\n§r§7Damage: §f" + dmg : ""), "textures/items/" + String(id).replace("minecraft:", ""), null);
  });
  const p = online(r.pid), a = arena();
  // 1) the real items, from the locker (safe: they are still there only if they were never given back)
  if (r.st === "locked") set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lGive back from the locker\n§r§7The REAL items (nothing is copied)\n§r§7" + (p ? "He is online" : "§cHe must be online") + "\n§r§eClick", "textures/ui/shop/ic_confirm", { run: () => {
    const now = online(r.pid); if (!now) { say(player, "§c[Sky Wars] " + r.n + " is offline - it is given back when he joins."); return self(); }
    if (G?.alive.includes(r.pid)) { say(player, "§c[Sky Wars] He is playing right now - it comes back when he is out."); return self(); }
    const all = pend(), rec = all[r.pid] ?? (G?.pl[r.pid]);
    if (rec && !rec.done && giveBack(a, now, rec)) { rec.done = 1; delete all[r.pid]; writeJson(PEND_KEY, Object.keys(all).length ? all : null); markRecord(r.id, "returned", player.name); try { slog(player, "skywars", { id: r.pid, name: r.n }, "loot given back from the locker"); } catch (e) { /* ignore */ } say(player, "§a[Sky Wars] Given back to " + r.n + "."); }
    else say(player, "§c[Sky Wars] Not in a locker any more (already given back?).");
    self();
  } });
  // 2) make the items again from the record (Owner): only when the real ones are lost
  if (owner(player)) set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lMake the items again\n§r§7From this record (same id, amount,\n§r§7name, enchantments, damage)\n§r§cOnly if his things are really LOST\n§r§c(it makes NEW items)\n§r§eClick", NAV_NO, { run: () => confirm(player, "Make the items again for " + r.n + "?", ["§cOnly if his own things are really lost!", "§7New items are made from the record and", "§7put into his inventory (the rest drops)."], () => {
    const now = online(r.pid); if (!now) { say(player, "§c[Sky Wars] " + r.n + " must be online."); return self(); }
    const inv = now.getComponent("minecraft:inventory")?.container; let made = 0;
    for (const [, , id, n, nm, en, dmg] of r.items) {
      try {
        const it = new ItemStack(id, n); if (nm) it.nameTag = nm; ench(it, en);
        try { const du = it.getComponent("minecraft:durability"); if (du && dmg) du.damage = dmg; } catch (e) { /* ignore */ }
        const rest = inv?.addItem(it); if (rest) now.dimension.spawnItem(rest, now.location); made++;
      } catch (e) { /* ignore */ }
    }
    try { if (r.lv > 0) now.addLevels(r.lv); } catch (e) { /* ignore */ }
    markRecord(r.id, "restored", player.name);
    try { slog(player, "skywars", { id: r.pid, name: r.n }, "loot made again from the record (" + made + " stacks)"); } catch (e) { /* ignore */ }
    say(player, "§a[Sky Wars] " + made + " stacks made again for " + r.n + ".");
    self();
  }, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const NAV_NO = "textures/ui/shop/ic_cancel";

// ---------------------------------------------------------------- /skywars (every player)
export function skyMenu(player) {
  const f = makeOpr("Sky Wars", SHORT_ROWS); f.self = () => skyMenu(player); f.glass = true;
  const a = arena();
  let top = []; try { top = ranking("skywars").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§b§lSky Wars\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/diamond_sword", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lRules\n§r§7Your own things are safe in a locker\n§r§7and come back after the game.\n§r§7Fall / die / leave = out.\n§r§7Buying and selling is off while you play.", "textures/items/book_writable", null);
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.skw ?? 0) + "\n§r§7Losses: §c" + (s.skl ?? 0) + "\n§r§7Kills: §f" + (s.skk ?? 0), "textures/items/diamond_sword", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:skywars", description: "Sky Wars: the game and the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { skyMenu(p); } catch (e) { console.warn("[skywars] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[skywars] command: " + e); }
});
