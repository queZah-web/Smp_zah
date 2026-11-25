// ===================================================================================================================
// EGG WARS (event)  -  /opr > Building > Egg Wars  or  /opr > Events > Egg Wars  (Owner)   and   /eggwars (every player)
//
// The Owner builds the arena (eggwarsdesign.js) for 10 or 20 players: a ring of coloured islands in the sky, 4 diamond
// islands and a centre island.  Then he runs games:
//   * chooses the players (2 - 10 / 20), the time limit and the prize
//   * Start: the islands are built again as new.  Every player gets his OWN island and colour, with:
//       - his EGG (a dragon egg on the shrine) with a sign over it: his colour, his name, "egg alive" / "no egg" / "out"
//       - an IRON and a GOLD generator (the ingots come out on top; tap the block to UPGRADE it, levels 1 - 4)
//       - the SHOP villager: blocks (wool in your colour, end stone, obsidian ...), swords, armour sets (put on at
//         once), pickaxes, bows, food, potions, ender pearls, TNT (lights itself), fire charges ... paid with iron,
//         gold and diamonds (the diamonds come from the 4 middle islands and the centre)
//   * the OWN things of every player (inventory, armour, off hand) + his XP go into a hidden locker and into the LOOT
//     RECORD (same as Sky Wars: /opr can see it and give it back) -> everybody starts with NOTHING.  10 s countdown.
//   * the island blocks can NOT be broken: only the blocks the players placed (and TNT breaks only those too).
//     Every placed block stays exactly where it was placed until the game ends.
//   * dying (or falling into the void) while your egg is alive: you come back on your island after 5 s (with nothing,
//     like the real game).  Break the egg of the others (mine it, 1.5 s) - then they don't come back any more.
//     Your own egg can't be broken by you.  Dying without an egg = OUT: your own things + XP come back, you go home.
//   * the last one alive wins (prize, stats, fireworks).  Time over: SUDDEN DEATH (every egg breaks); 5 minutes later
//     the most kills wins.  Buying / selling (shop, /sell, auction, /pay ...) is OFF for the players of the game.
// No lag: the generators spawn at most a few stacks each (a full generator stops), one loop every 5 ticks.
// ===================================================================================================================
import { world, system, ItemStack, GameMode, BlockVolume, BlockPermutation, StructureSaveMode, EquipmentSlot, EnchantmentTypes, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog, econLocks } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, eggwarsHook } from "./spawnbuild.js";
import { TOP, COLORS, layout, lockerAt, eggGen, lockerBlocks } from "./eggwarsdesign.js";
import { storeInv, giveBack, addRecord, markRecord, lootGivers } from "./skywars.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { exOf } from "../smp/store.js";

const KEY = "egw:arena", CFG_KEY = "egw:cfg", MKEY = "egw:m", PEND_KEY = "egw:pend", AREA = "smp_egw_", HOLO = "shop:holo", TRADER = "smp:ew_trader", EGG = "smp:ew_egg";
const TAG = "egw", ITEM_TAG = "egw_item";
const PRIZES = [0, 2500, 5000, 10000, 25000, 50000], MINUTES = [15, 20, 30, 45, 60], COUNT = 10, RESPAWN = 5, SUDDEN_MIN = 5;
const LORE = ["§8Egg Wars item", "§7(disappears after the game)"];
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const title = (p, t, sub, stay = 40) => { try { p.onScreenDisplay.setTitle(t, { subtitle: sub ?? "", fadeInDuration: 2, stayDuration: stay, fadeOutDuration: 8 }); } catch (e) { /* ignore */ } };
const sound = (p, s, o) => { try { p.playSound(s, o); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[eggwars] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[eggwars] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const K = (x, y, z) => x + "," + y + "," + z;

// ---------------------------------------------------------------- the arena record { d, cx, cy, cz, n, x1..z2, tiles }
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
const absB = (a, l) => ({ x: a.cx + l.x, y: a.cy + Math.floor(l.y), z: a.cz + l.z });
export const eggAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!eggAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
let cfg = null;
const conf = () => (cfg ??= { prize: 10000, minutes: 30, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());
const L = () => layout(arena()?.n ?? 10);
const colOf = (i) => COLORS[i % COLORS.length];

// ---------------------------------------------------------------- building / rebuilding the islands
let busy = false, design = null;
function* getDesign(n) { if (design && design.L.n === n) return design; const g = eggGen(n); let r; while (!(r = g.next()).done) yield; design = r.value; return design; }
function* placeCanvas(a, dim, canvas, progress) {
  const og = canvas.orderedGen(); let r; while (!(r = og.next()).done) yield;
  const pal = canvas.pal.map((p) => perm(p.id, p.st)); let k = 0;
  for (const b of r.value) for (let i = 0; i < b.length; i += 4) {
    const p = pal[b[i + 3]];
    if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { /* ignore */ } }
    if (++k % 80 === 0) { if (progress) progress(k); yield; }
  }
}
const halfOf = (a) => Math.max(layout(a.n).HX, Number.isFinite(a.x2) ? a.x2 - a.cx - 1 : 0);
function* clearSky(a, dim, from, to) {
  const air = perm("air"), H = halfOf(a);
  for (let x = -H; x <= H; x++) { try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + from, z: a.cz - H }, { x: a.cx + x, y: a.cy + to, z: a.cz + H }), air); } catch (e) { /* not loaded */ } if (x % 3 === 0) yield; }
}
/** the holograms, villagers, items, arrows ... of the arena */
function clearEntities(a) {
  const dim = dimOf(a); if (!dim) return;
  try {
    for (const e of dim.getEntities({ location: abs(a, { x: 0, y: TOP, z: 0 }), maxDistance: halfOf(a) * 1.5 + 20 })) {
      let mine = false; try { mine = e.hasTag(TAG) || e.typeId === TRADER; } catch (x) { mine = false; }
      if (mine || ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:tnt", "minecraft:snowball", "minecraft:egg", "minecraft:ender_pearl", "minecraft:falling_block", "minecraft:fireball", "minecraft:small_fireball", "minecraft:wind_charge_projectile"].includes(e.typeId)) { try { e.remove(); } catch (x) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Egg Wars] Building:"))) { removeAreas(dim, AREA); say(player, "§c[Egg Wars] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:egw_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[eggwars] backup: " + e); }
      bar(player, "§a[Egg Wars] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    yield* clearSky(a, dim, 1, layout(a.n).UP);
    for (const b of lockerBlocks()) { try { dim.getBlock({ x: a.cx + b.x, y: a.cy + b.y, z: a.cz + b.z })?.setPermutation(perm(b.id, b.st)); } catch (e) { /* ignore */ } }
    const d = yield* getDesign(a.n);
    yield* placeCanvas(a, dim, d.canvas, (k) => bar(player, "§a[Egg Wars] §fBuilding the islands... §e" + k));
    removeAreas(dim, AREA);
    say(player, "§a[Egg Wars] The arena is ready (" + a.n + " islands)! §7(" + Math.round((Date.now() - t0) / 1000) + " s) §aStart a game in §f/opr > Events > Egg Wars§a.");
    sound(player, "random.levelup");
  } catch (e) { console.warn("[eggwars] build: " + e); say(player, "§c[Egg Wars] Building stopped: " + e); removeAreas(dim, AREA); }
  finally { busy = false; }
}
export function buildEgg(player, n) {
  if (!owner(player)) return say(player, "§c[Egg Wars] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[Egg Wars] The arena is being built right now.");
  if (arena()) return say(player, "§c[Egg Wars] The arena already exists. Undo it first.");
  const Ly = layout(n), dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - Ly.DOWN < hr.min || cy + Ly.UP >= hr.max) return say(player, "§c[Egg Wars] Too high here: the islands are " + TOP + " blocks over you. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, n, x1: cx - Ly.HX - 1, y1: cy - Ly.DOWN, z1: cz - Ly.HX - 1, x2: cx + Ly.HX + 1, y2: cy + Ly.UP, z2: cz + Ly.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Egg Wars] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Egg Wars] Building the arena for " + n + " players (" + (Ly.HX * 2 + 1) + " x " + (Ly.HX * 2 + 1) + ")... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "eggwars", null, "built (" + n + ") at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Egg Wars] Undo:"))) { removeAreas(dim, AREA); say(player, "§c[Egg Wars] The area could not be loaded. Go there and try again."); return; }
    clearEntities(a);
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[eggwars] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    A = null; saveA(); design = null;
    removeAreas(dim, AREA);
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Egg Wars] Removed: the land is back as it was." : "§e[Egg Wars] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoEgg(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Egg Wars] Stop the game first.");
  if (Object.keys(pend()).length) return say(player, "§c[Egg Wars] Some players still have their things in the lockers (they are offline). Wait until they join again.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}
/** the islands as new: the sky cleared (every placed block goes), every island built again, holograms / items removed */
function* resetJob(a) {
  const dim = dimOf(a); if (!dim) return;
  clearEntities(a);
  yield* clearSky(a, dim, 1, layout(a.n).UP);
  const d = yield* getDesign(a.n);
  yield* placeCanvas(a, dim, d.canvas);
  clearEntities(a);
}

// ---------------------------------------------------------------- the lockers (shared with Sky Wars) + pending give-backs
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
    if (giveBack(a, p, all[id])) { all[id].done = 1; if (G?.pl[id]) { G.pl[id].done = 1; saveG(); } delete all[id]; changed = true; tell(p, "§a[Egg Wars] Your own things and your XP are back.", "§a[حرب البيض] رجعت لك أغراضك والـ XP."); }
    else need = true;
  }
  if (changed) writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  try { const dim = dimOf(a), l = lockerAt(0); if (need) dim.runCommand(`tickingarea add circle ${a.cx + l.x} ${a.cy + l.y} ${a.cz + l.z} 2 ${AREA}lock true`); else if (!Object.keys(all).length) dim.runCommand(`tickingarea remove ${AREA}lock`); } catch (e) { /* ignore */ }
}, 40);
// the staff gives a record back from /opr (Loot records)
lootGivers.egg = (staff, r, now) => {
  if (G?.alive.includes(r.pid)) { say(staff, "§c[Egg Wars] He is playing right now - it comes back when he is out."); return false; }
  const all = pend(), rec = all[r.pid] ?? G?.pl[r.pid];
  if (rec && !rec.done && giveBack(arena(), now, rec)) { rec.done = 1; delete all[r.pid]; writeJson(PEND_KEY, Object.keys(all).length ? all : null); markRecord(r.id, "returned", staff.name); try { slog(staff, "eggwars", { id: r.pid, name: r.n }, "loot given back from the locker"); } catch (e) { /* ignore */ } return true; }
  say(staff, "§c[Egg Wars] Not in a locker any more (already given back?)."); return false;
};

// ---------------------------------------------------------------- the game state
// G = { phase: prep | count | run | end, until, pl: { id: rec }, alive: [ids], order: [ids], egg: { island: true/false },
//       owner: { island: id }, kills, hit, start, end, sudden, prize, minutes, gens: [...], placed: Set }
// rec = { n, gm, back, home, map, lv, xp, locker, hid, isl, resp (tick of the respawn, -1 = waiting to respawn), deaths, armor }
let G = null;
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const eggView = () => (G ? { phase: G.phase, alive: [...G.alive], order: [...G.order] } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inArena(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
system.runTimeout(() => {                              // a restart in the middle of a game: everything is given back
  const old = readJson(MKEY, null); if (!old?.pl) return;
  writeJson(MKEY, null);
  for (const [id, rec] of Object.entries(old.pl)) if (!rec.done) keepPending(id, rec);
}, 60);
const homeOf = (p) => { try { const h = (exOf(p.id).homes ?? [])[0]; return h ? { x: h.x, y: h.y, z: h.z, d: h.d } : null; } catch (e) { return null; } };
const isleOf = (id) => G?.pl[id]?.isl;
const nameCol = (id) => { const r = G?.pl[id]; return r ? colOf(r.isl)[2] + r.n : "?"; };
const eggsLeft = () => (G ? Object.values(G.egg).filter(Boolean).length : 0);

// ---------------------------------------------------------------- holograms (egg signs, generator signs)
function holo(a, at, text, key) {
  const dim = dimOf(a); if (!dim) return null;
  try { const e = dim.spawnEntity(HOLO, at); e.nameTag = text; e.addTag(TAG); if (key) e.addTag("egw_" + key); return e; } catch (e) { return null; }
}
function setHolo(a, key, text) {
  const dim = dimOf(a); if (!dim) return;
  try { for (const e of dim.getEntities({ tags: ["egw_" + key] })) e.nameTag = text; } catch (e) { /* ignore */ }
}
const eggText = (i) => {
  const c = colOf(i), id = G?.owner[i], r = id ? G.pl[id] : null;
  if (!r) return c[2] + "§l" + c[1].toUpperCase();
  const out = !G.alive.includes(id);
  return c[2] + "§l" + c[1].toUpperCase() + "\n§r§f" + r.n + "\n" + (out ? "§8✘ OUT" : G.egg[i] ? "§a✔ Egg alive" : "§c✘ Egg destroyed") + (out ? "" : " §7| §c" + (G.kills[id] ?? 0) + " ⚔");
};
const updEgg = (i) => { const a = arena(); if (a) setHolo(a, "egg" + i, eggText(i)); };

// ---------------------------------------------------------------- generators
// iron / gold on every island (levels 1-4, tap to upgrade), diamonds on the middle islands + the centre (fixed)
const GEN = {
  iron: { name: "Iron", col: "§f", item: "minecraft:iron_ingot", every: [0, 30, 20, 13, 8], cap: 64, up: [null, null, ["iron", 20], ["gold", 10], ["diamond", 5]] },
  gold: { name: "Gold", col: "§6", item: "minecraft:gold_ingot", every: [0, 160, 100, 65, 40], cap: 32, up: [null, null, ["iron", 32], ["gold", 16], ["diamond", 8]] },
  diamond: { name: "Diamond", col: "§b", item: "minecraft:diamond", every: [0, 400], cap: 8 },
  cdiamond: { name: "Diamond", col: "§b", item: "minecraft:diamond", every: [0, 260], cap: 12 },
  cgold: { name: "Gold", col: "§6", item: "minecraft:gold_ingot", every: [0, 100], cap: 32 },
};
const genText = (g) => { const d = GEN[g.k]; return d.col + "§l" + d.name + (d.up ? "\n§r§7Level §e" + g.lv + (g.lv < 4 ? " §8(tap to upgrade)" : " §a(MAX)") : "\n§r§7every " + Math.round(d.every[1] / 20) + " s"); };
function makeGens(a, Ly) {
  const gens = [];
  for (const [i] of Object.entries(G.owner)) {
    const is = Ly.islands[i];
    gens.push({ k: "iron", isl: +i, p: is.iron, lv: 1, next: 0 }, { k: "gold", isl: +i, p: is.gold, lv: 1, next: 0 });
  }
  for (const m of Ly.mids) gens.push({ k: "diamond", p: m.gen, lv: 1, next: 0 });
  for (const c of Ly.center.gens) gens.push({ k: c.k === "diamond" ? "cdiamond" : "cgold", p: c, lv: 1, next: 0 });
  gens.forEach((g, j) => { g.j = j; holo(a, abs(a, { x: g.p.x, y: g.p.y + 1.9, z: g.p.z }), genText(g), "gen" + j); });
  return gens;
}
function runGens(a, t) {
  const dim = dimOf(a); if (!dim) return;
  for (const g of G.gens) {
    if (t < g.next) continue;
    const d = GEN[g.k]; g.next = t + d.every[g.lv];
    if (g.isl !== undefined && !G.alive.includes(G.owner[g.isl])) continue;          // the island of a player who is out: stopped
    const at = abs(a, { x: g.p.x, y: g.p.y + 1, z: g.p.z });
    try {
      let n = 0; for (const e of dim.getEntities({ type: "minecraft:item", location: at, maxDistance: 1.6 })) { try { const it = e.getComponent("minecraft:item")?.itemStack; if (it?.typeId === d.item) n += it.amount; } catch (x) { /* ignore */ } }
      if (n >= d.cap) continue;
      const e = dim.spawnItem(new ItemStack(d.item, 1), at);
      try { e.clearVelocity(); e.addTag(ITEM_TAG); } catch (x) { /* ignore */ }
    } catch (e) { /* not loaded */ }
  }
}
function genPage(player, g) {
  const a = arena(), d = GEN[g.k]; if (!a || !G) return;
  const self = () => genPage(player, g), f = makeOpr("Egg Wars: generator", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(g.lv, "g") + d.col + "§l" + d.name + " generator\n§r§7Level: §e" + g.lv + " §7/ 4\n§r§7One " + d.name.toLowerCase() + " every §f" + (d.every[g.lv] / 20).toFixed(1) + " s" + (g.lv < 4 ? "\n§r§7Next level: §f" + (d.every[g.lv + 1] / 20).toFixed(1) + " s" : ""), d.item.replace("minecraft:", "textures/items/").replace("_ingot", "_ingot"), null);
  if (g.lv < 4) {
    const [cur, n] = d.up[g.lv + 1], has = countCur(player, cur) >= n;
    set(f, 2 * COLS + 4, hdr(n, has ? "g" : "r") + "§a§lUpgrade to level " + (g.lv + 1) + "\n§r§7Price: " + CUR[cur].col + n + " " + CUR[cur].name + "\n§r§7You have: §f" + countCur(player, cur) + "\n§r" + (has ? "§eClick to upgrade" : "§cNot enough"), CUR[cur].icon, { run: () => {
      if (!G || g.lv >= 4) return;
      if (!payCur(player, cur, n)) { tell(player, "§c[Egg Wars] Not enough " + CUR[cur].name.toLowerCase() + ".", "§c[حرب البيض] ما عندك " + CUR[cur].ar + " كافي."); sound(player, "note.bass"); return self(); }
      g.lv++; setHolo(a, "gen" + g.j, genText(g)); sound(player, "random.levelup", { pitch: 1.4 });
      tell(player, "§a[Egg Wars] " + d.name + " generator: level " + g.lv + "!", "§a[حرب البيض] مولّد " + (g.k === "iron" ? "الحديد" : "الذهب") + ": مستوى " + g.lv + "!");
      self();
    } });
  } else set(f, 2 * COLS + 4, hdr(4, "g") + "§a§lMAX LEVEL", d.item.replace("minecraft:", "textures/items/"), null);
  backBtn(f, () => {}); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- money of the game: iron, gold, diamonds
const CUR = {
  iron: { id: "minecraft:iron_ingot", name: "Iron", ar: "حديد", col: "§f", icon: "textures/items/iron_ingot" },
  gold: { id: "minecraft:gold_ingot", name: "Gold", ar: "ذهب", col: "§6", icon: "textures/items/gold_ingot" },
  diamond: { id: "minecraft:diamond", name: "Diamonds", ar: "دايموند", col: "§b", icon: "textures/items/diamond" },
};
function countCur(p, cur) {
  let n = 0; const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return 0;
  for (let i = 0; i < inv.size; i++) { try { const it = inv.getItem(i); if (it?.typeId === CUR[cur].id) n += it.amount; } catch (e) { /* ignore */ } }
  return n;
}
function payCur(p, cur, n) {
  if (countCur(p, cur) < n) return false;
  const inv = p.getComponent("minecraft:inventory")?.container; let left = n;
  for (let i = 0; i < inv.size && left > 0; i++) {
    let it; try { it = inv.getItem(i); } catch (e) { it = null; } if (!it || it.typeId !== CUR[cur].id) continue;
    if (it.amount <= left) { left -= it.amount; inv.setItem(i, undefined); } else { it.amount -= left; inv.setItem(i, it); left = 0; }
  }
  return true;
}

// ---------------------------------------------------------------- the SHOP (the villager of every island)
const WCOL = { red: "red", blue: "blue", lime: "lime", yellow: "yellow", cyan: "cyan", orange: "orange", purple: "purple", light_blue: "light_blue", pink: "pink", white: "white", green: "green", magenta: "magenta", gray: "gray", black: "black", brown: "brown", light_gray: "silver" };
const woolIcon = (wool) => "textures/blocks/wool_colored_" + (WCOL[wool.replace("_wool", "")] ?? "white");
const clayIcon = (wool) => "textures/blocks/hardened_clay_stained_" + (WCOL[wool.replace("_wool", "")] ?? "white");
// [row, name, arabic, id | fn(col), amount, [currency, price], icon | fn(col), enchants, special]
const SHOP = [
  [1, "Wool (your colour)", "صوف (لونك)", (c) => c[4], 16, ["iron", 4], (c) => woolIcon(c[4])],
  [1, "Sandstone", "حجر رملي", "sandstone", 16, ["iron", 6], "textures/blocks/sandstone_normal"],
  [1, "Terracotta (your colour)", "طين (لونك)", (c) => c[6], 12, ["iron", 12], (c) => clayIcon(c[4])],
  [1, "End stone", "حجر الإند", "end_stone", 8, ["iron", 12], "textures/blocks/end_stone"],
  [1, "Oak planks", "خشب", "oak_planks", 16, ["gold", 4], "textures/blocks/planks_oak"],
  [1, "Glass", "زجاج", "glass", 8, ["iron", 10], "textures/blocks/glass"],
  [1, "Ladders", "سلالم", "ladder", 8, ["iron", 6], "textures/blocks/ladder"],
  [1, "Cobweb", "شبكة عنكبوت", "web", 4, ["gold", 4], "textures/blocks/web"],
  [1, "Obsidian", "أوبسيديان", "obsidian", 4, ["diamond", 4], "textures/blocks/obsidian"],
  [2, "Stone sword", "سيف حجر", "stone_sword", 1, ["iron", 12], "textures/items/stone_sword"],
  [2, "Iron sword", "سيف حديد", "iron_sword", 1, ["gold", 8], "textures/items/iron_sword"],
  [2, "Iron sword Sharpness I", "سيف حديد حدة 1", "iron_sword", 1, ["gold", 14], "textures/items/iron_sword", [["sharpness", 1]]],
  [2, "Diamond sword", "سيف دايموند", "diamond_sword", 1, ["diamond", 5], "textures/items/diamond_sword"],
  [2, "Diamond sword Sharpness II", "سيف دايموند حدة 2", "diamond_sword", 1, ["diamond", 9], "textures/items/diamond_sword", [["sharpness", 2]]],
  [2, "Iron axe", "فأس حديد", "iron_axe", 1, ["gold", 6], "textures/items/iron_axe"],
  [2, "Knockback stick", "عصا الدفع", "stick", 1, ["gold", 6], "textures/items/stick", [["knockback", 2]]],
  [2, "Fire sword", "سيف النار", "golden_sword", 1, ["diamond", 4], "textures/items/gold_sword", [["fire_aspect", 1], ["sharpness", 1]]],
  [3, "Chainmail armour (set)", "درع سلاسل (طقم)", "#armor:chainmail:1", 1, ["iron", 32], "textures/items/chainmail_chestplate"],
  [3, "Iron armour (set)", "درع حديد (طقم)", "#armor:iron:2", 1, ["gold", 16], "textures/items/iron_chestplate"],
  [3, "Diamond armour (set)", "درع دايموند (طقم)", "#armor:diamond:3", 1, ["diamond", 8], "textures/items/diamond_chestplate"],
  [3, "Diamond armour Protection I", "درع دايموند حماية 1", "#armor:diamond:4", 1, ["diamond", 14], "textures/items/diamond_chestplate", [["protection", 1]]],
  [3, "Shield", "درع يدوي", "shield", 1, ["gold", 8], "textures/ui/shop/ic_shield"],
  [4, "Wooden pickaxe", "فأس خشب", "wooden_pickaxe", 1, ["iron", 8], "textures/items/wood_pickaxe"],
  [4, "Stone pickaxe", "فأس حجر", "stone_pickaxe", 1, ["iron", 16], "textures/items/stone_pickaxe", [["efficiency", 1]]],
  [4, "Iron pickaxe", "فأس حديد", "iron_pickaxe", 1, ["gold", 6], "textures/items/iron_pickaxe", [["efficiency", 2]]],
  [4, "Diamond pickaxe", "فأس دايموند", "diamond_pickaxe", 1, ["diamond", 4], "textures/items/diamond_pickaxe", [["efficiency", 3]]],
  [4, "Shears", "مقص", "shears", 1, ["iron", 20], "textures/items/shears"],
  [5, "Bow", "قوس", "bow", 1, ["gold", 10], "textures/items/bow_standby"],
  [5, "Bow Power I", "قوس قوة 1", "bow", 1, ["gold", 18], "textures/items/bow_standby", [["power", 1]]],
  [5, "Bow Power II Punch I", "قوس قوة 2 دفع 1", "bow", 1, ["diamond", 5], "textures/items/bow_standby", [["power", 2], ["punch", 1]]],
  [5, "Arrows", "أسهم", "arrow", 8, ["gold", 2], "textures/items/arrow"],
  [5, "Crossbow", "قوس نشاب", "crossbow", 1, ["gold", 12], "textures/items/crossbow_standby"],
  [6, "Steak", "ستيك", "cooked_beef", 3, ["iron", 4], "textures/items/beef_cooked"],
  [6, "Bread", "خبز", "bread", 4, ["iron", 3], "textures/items/bread"],
  [6, "Golden apple", "تفاحة ذهبية", "golden_apple", 1, ["gold", 3], "textures/items/apple_golden"],
  [6, "Speed II potion", "جرعة سرعة 2", "#potion:potion:16", 1, ["diamond", 2], "textures/items/potion_bottle_moveSpeed"],
  [6, "Healing II splash", "جرعة شفاء 2", "#potion:splash_potion:22", 1, ["gold", 3], "textures/items/potion_bottle_splash_heal"],
  [6, "Strength potion", "جرعة قوة", "#potion:potion:31", 1, ["diamond", 3], "textures/items/potion_bottle_damageBoost"],
  [6, "Jump potion", "جرعة قفز", "#potion:potion:9", 1, ["gold", 4], "textures/items/potion_bottle_jump"],
  [7, "Ender pearl", "لؤلؤة إندر", "ender_pearl", 1, ["diamond", 4], "textures/items/ender_pearl"],
  [7, "TNT (lights itself)", "TNT (يشتعل لحاله)", "tnt", 1, ["gold", 4], "textures/blocks/tnt_side"],
  [7, "Fire charge", "كرة نار", "fire_charge", 1, ["gold", 2], "textures/items/fireball"],
  [7, "Water bucket", "سطل ماي", "water_bucket", 1, ["gold", 4], "textures/items/bucket_water"],
  [7, "Wind charge", "شحنة رياح", "wind_charge", 2, ["gold", 3], "textures/items/wind_charge"],
  [7, "Snowballs", "كرات ثلج", "snowball", 8, ["iron", 4], "textures/items/snowball"],
  [7, "Fishing rod", "صنارة", "fishing_rod", 1, ["iron", 10], "textures/items/fishing_rod_uncast"],
  [7, "Totem of undying", "طوطم", "totem_of_undying", 1, ["diamond", 12], "textures/items/totem"],
];
const ROWS = { 1: ["Blocks", "بلوكات"], 2: ["Weapons", "أسلحة"], 3: ["Armour", "دروع"], 4: ["Tools", "أدوات"], 5: ["Bows", "أقواس"], 6: ["Food & potions", "أكل وجرعات"], 7: ["Special", "أشياء خاصة"] };
const ench = (it, list) => { try { const c = it.getComponent("minecraft:enchantable"); for (const [t, l] of list ?? []) c?.addEnchantment({ type: EnchantmentTypes.get(t), level: l }); } catch (e) { /* ignore */ } return it; };
const mark = (it) => { try { it.setLore(LORE); } catch (e) { /* ignore */ } return it; };
function give(p, it) { const inv = p.getComponent("minecraft:inventory")?.container; let rest = it; try { rest = inv?.addItem(it); } catch (e) { rest = it; } if (rest) { try { p.dimension.spawnItem(rest, p.location); } catch (e) { /* ignore */ } } }
const ARMOR = { chainmail: "chainmail", iron: "iron", diamond: "diamond" };
function buy(p, row) {
  const [, name, ar, idf, amount, [cur, price], , en] = row, c = colOf(isleOf(p.id) ?? 0), rec = G.pl[p.id];
  const id = typeof idf === "function" ? idf(c) : idf;
  if (id.startsWith("#armor:")) {
    const [, mat, tier] = id.split(":");
    if ((rec.armor ?? 0) >= +tier) { tell(p, "§c[Egg Wars] You already wear the same or better armour.", "§c[حرب البيض] لابس درع نفسه أو أحسن."); return false; }
    if (!payCur(p, cur, price)) return null;
    const eq = p.getComponent("minecraft:equippable");
    for (const [slot, part] of [[EquipmentSlot.Head, "helmet"], [EquipmentSlot.Chest, "chestplate"], [EquipmentSlot.Legs, "leggings"], [EquipmentSlot.Feet, "boots"]]) {
      try { const it = mark(ench(new ItemStack("minecraft:" + ARMOR[mat] + "_" + part, 1), en)); eq?.setEquipment(slot, it); } catch (e) { /* ignore */ }
    }
    rec.armor = +tier; return true;
  }
  if (id.startsWith("#potion:")) {
    if (!payCur(p, cur, price)) return null;
    const [, kind, aux] = id.split(":");
    try { p.runCommand(`give @s ${kind} 1 ${aux}`); } catch (e) { /* ignore */ }
    return true;
  }
  let it; try { it = new ItemStack("minecraft:" + id, amount); } catch (e) { tell(p, "§c[Egg Wars] This item is not in this game version.", "§c[حرب البيض] هالغرض مو موجود بهالنسخة."); return false; }
  if (!payCur(p, cur, price)) return null;
  give(p, mark(ench(it, en)));
  return true;
}
export function shopPage(player) {
  if (!G || !G.alive.includes(player.id) || G.phase !== "run" || G.pl[player.id]?.resp) return tell(player, "§c[Egg Wars] The shop works only for the players during a game.", "§c[حرب البيض] المتجر يشتغل بس للاعبين أثناء اللعبة.");
  const self = () => shopPage(player), c = colOf(isleOf(player.id) ?? 0);
  const f = makeOpr("Egg Wars: shop"); f.self = self; f.glass = true;
  const has = { iron: countCur(player, "iron"), gold: countCur(player, "gold"), diamond: countCur(player, "diamond") };
  set(f, 0 * COLS + 4, hdr(1, "g") + "§e§lEgg Wars shop\n§r§7You have: §f" + has.iron + " iron §7| §6" + has.gold + " gold §7| §b" + has.diamond + " diamonds\n§r§7Iron + gold: the generators of your island\n§r§7Diamonds: the middle islands + the centre", "textures/items/emerald", null);
  set(f, 0 * COLS + 2, hdr(Math.max(1, Math.min(99, has.iron))) + "§fIron: " + has.iron, CUR.iron.icon, null);
  set(f, 0 * COLS + 3, hdr(Math.max(1, Math.min(99, has.gold))) + "§6Gold: " + has.gold, CUR.gold.icon, null);
  set(f, 0 * COLS + 5, hdr(Math.max(1, Math.min(99, has.diamond))) + "§bDiamonds: " + has.diamond, CUR.diamond.icon, null);
  const col = {};
  for (const row of SHOP) {
    const [r, name, , idf, amount, [cur, price], icon, en] = row, k = col[r] ?? 0; col[r] = k + 1; if (k > 8) continue;
    const ok = has[cur] >= price, ic = typeof icon === "function" ? icon(c) : icon;
    set(f, r * COLS + k, hdr(Math.min(99, amount), ok ? (en?.length ? "x" : "g") : "r") + "§f§l" + name + (amount > 1 ? " §r§7x" + amount : "") + "\n§r§7" + ROWS[r][0] + "\n§r§7Price: " + CUR[cur].col + price + " " + CUR[cur].name + (en?.length ? "\n§r§b" + en.map(([e, l]) => e.replace(/_/g, " ") + " " + l).join(", ") : "") + "\n§r" + (ok ? "§eClick to buy" : "§cNot enough " + CUR[cur].name.toLowerCase()), ic, { run: () => {
      if (!G || !G.alive.includes(player.id) || G.phase !== "run") return;
      const r2 = buy(player, row);
      if (r2 === true) sound(player, "random.orb", { pitch: 1.2 });
      else if (r2 === null) { tell(player, "§c[Egg Wars] Not enough " + CUR[cur].name.toLowerCase() + ".", "§c[حرب البيض] ما عندك " + CUR[cur].ar + " كافي."); sound(player, "note.bass"); }
      self();
    } });
  }
  status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- start
export function startEgg(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  if (Object.keys(pend()).length) return { err: "Some players from the last game still wait for their things (offline). They get them when they join; then start again." };
  const c = conf(), Ly = layout(a.n), ids = c.roster.filter((id) => online(id)).slice(0, Ly.n);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "prep", until: 0, pl: {}, alive: [], order: [], egg: {}, owner: {}, prize: c.prize, minutes: c.minutes, start: 0, kills: {}, hit: {}, gens: [], placed: new Set(), sudden: 0, by: player.name };
  busy = true;
  const dim = dimOf(a);
  system.runJob((function* () {
    try {
      addAreas(dim, a, AREA);
      if (!(yield* waitLoaded(player, dim, a, "[Egg Wars] Getting the islands ready:"))) { say(player, "§c[Egg Wars] The arena could not be loaded."); G = null; removeAreas(dim, AREA); return; }
      for (const q of world.getAllPlayers()) tell(q, "§e§l[Egg Wars] §r§7The islands are being prepared...", "§e§l[حرب البيض] §r§7الجزر تتجهز...");
      yield* resetJob(a);
      // the islands of the players: spread around the ring (2 players = 2 opposite islands)
      const k = ids.length, slots = [...Array(k).keys()].map((j) => Math.floor((j * Ly.n) / k));
      const order = ids.slice().sort(() => Math.random() - 0.5);
      let n = 0;
      for (const id of order) {
        const p = online(id); if (!p) continue;
        const l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
        let lv = 0, xp = 0; try { lv = p.level; xp = p.xpEarnedAtCurrentLevel; } catch (e) { /* ignore */ }
        const st = storeInv(a, p, n);
        if (!st) { say(player, "§c[Egg Wars] A locker is missing or not empty: " + p.name + " can not play (his things were NOT touched)."); continue; }
        const hid = "h" + Date.now().toString(36) + "e" + n;
        addRecord({ id: hid, g: "egg", pid: id, n: p.name, t: Date.now(), lv, xp, items: st.items, st: "locked", w: Math.floor(l.x) + " " + Math.floor(l.y) + " " + Math.floor(l.z) + " " + p.dimension.id });
        const isl = slots[n];
        G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, home: homeOf(p), map: st.map, lv, xp, locker: n, hid, isl, resp: 0, deaths: 0, armor: 0 };
        G.owner[isl] = id; G.egg[isl] = true;
        G.alive.push(id); n++;
        saveG();
        try { econLocks.add(id); } catch (e) { /* ignore */ }
        const is = Ly.islands[isl];
        try { p.teleport(abs(a, is.spawn), { dimension: dim, facingLocation: abs(a, is.look) }); } catch (e) { /* ignore */ }
        try { p.setGameMode(GameMode.Survival); p.getComponent("minecraft:health")?.resetToMaxValue(); p.addEffect("saturation", 60, { amplifier: 10, showParticles: false }); } catch (e) { /* ignore */ }
        const cc = colOf(isl);
        tell(p, "§e§l[Egg Wars] §r§fYou are " + cc[2] + "§l" + cc[1].toUpperCase() + "§r§f! §7Protect your egg, collect iron / gold at your generators, buy at the villager, break the eggs of the others. While your egg lives you come back after dying. §8(Your own things are safe in a locker - buying / selling is off.)",
          "§e§l[حرب البيض] §r§fانت " + cc[2] + "§l" + cc[1].toUpperCase() + "§r§f! §7احمي بيضتك، اجمع الحديد والذهب من المولدات، اشتري من القروي، واكسر بيض الباقين. طول ما بيضتك عايشة ترجع بعد الموت. §8(أغراضك محفوظة بخزانة - الشراء والبيع مطفي.)");
        yield;
      }
      if (G.alive.length < 2) { say(player, "§c[Egg Wars] Not enough players."); for (const id of G.alive) giveBackOrKeep(id, G.pl[id]); G = null; saveG(); removeAreas(dim, AREA); return; }
      // eggs, villagers, signs, generators
      const egg = (() => { try { return BlockPermutation.resolve(EGG); } catch (e) { return perm("dragon_egg"); } })();
      for (const [i] of Object.entries(G.owner)) {
        const is = Ly.islands[i];
        try { dim.getBlock(absB(a, is.egg))?.setPermutation(egg); } catch (e) { /* ignore */ }
        holo(a, abs(a, is.eggHolo), eggText(+i), "egg" + i);
        try { const v = dim.spawnEntity(TRADER, abs(a, is.trader)); v.nameTag = "§e§lSHOP\n§r§7" + pick(online(G.owner[i]) ?? player, "tap me", "اضغط عليّ"); v.addTag(TAG); v.teleport(abs(a, is.trader), { facingLocation: abs(a, is.spawn) }); } catch (e) { console.warn("[eggwars] trader: " + e); }
      }
      G.gens = makeGens(a, Ly);
      G.phase = "count"; G.until = system.currentTick + COUNT * 20;
      const names = G.alive.map((id) => nameCol(id)).join("§7, ");
      for (const q of world.getAllPlayers()) tell(q, "§e§l[Egg Wars] §r§fA game starts! §7" + G.alive.length + " players: " + names + " §e/eggwars", "§e§l[حرب البيض] §r§fبدت لعبة! §7" + G.alive.length + " لاعب: " + names + " §e/eggwars");
      try { slog(player, "eggwars", null, "game started: " + G.alive.length + " players"); } catch (e) { /* ignore */ }
    } catch (e) { console.warn("[eggwars] start: " + e); }
    finally { busy = false; }
  })());
  return { ok: true };
}

// ---------------------------------------------------------------- eggs, deaths, respawns, out
function destroyEgg(i, by, why) {
  if (!G || !G.egg[i]) return;
  G.egg[i] = false;
  const a = arena(), dim = a && dimOf(a), is = L().islands[i], id = G.owner[i];
  if (dim && is) {
    try { dim.getBlock(absB(a, is.egg))?.setPermutation(perm("air")); } catch (e) { /* ignore */ }
    const at = abs(a, is.egg);
    for (let k = 0; k < 6; k++) { try { dim.spawnParticle("minecraft:dragon_breath_trail", { x: at.x + (Math.random() - 0.5), y: at.y + Math.random(), z: at.z + (Math.random() - 0.5) }); } catch (e) { /* ignore */ } }
    try { dim.playSound("random.explode", at, { volume: 1.5 }); } catch (e) { /* ignore */ }
  }
  updEgg(i);
  if (why === "sudden") return;
  const vic = online(id), who = by ? nameCol(by) : null;
  toAll((q) => { q.sendMessage("§e🥚 " + nameCol(id) + "§7" + pick(q, "'s egg was destroyed", " بيضته انكسرت") + (who ? pick(q, " by ", " على يد ") + who : "") + "§7! §e" + pick(q, "Eggs left: ", "البيض الباقي: ") + eggsLeft()); if (q.id !== id) sound(q, "mob.enderdragon.growl", { volume: 0.4, pitch: 1.4 }); });
  if (vic) { title(vic, "§c§l" + pick(vic, "EGG DESTROYED!", "بيضتك انكسرت!"), "§7" + pick(vic, "You will NOT come back if you die", "إذا متت ما ترجع"), 60); sound(vic, "mob.wither.spawn", { volume: 0.5 }); }
  if (by) { const bp = online(by); if (bp) { try { const s = stats(bp); s.ewe = (s.ewe ?? 0) + 1; touch(bp); } catch (e) { /* ignore */ } title(bp, "§a§l" + pick(bp, "EGG BROKEN!", "كسرت بيضة!"), nameCol(id), 30); sound(bp, "random.levelup", { pitch: 1.6 }); } }
}
function credit(id, why) {
  const rec = G.pl[id], h = G.hit[id];
  const killer = rec.killer && why === "died" ? rec.killer : h && system.currentTick - h[1] < 200 ? h[0] : null;
  rec.killer = null; G.hit[id] = null;
  if (!killer || !G.pl[killer] || killer === id) return null;
  G.kills[killer] = (G.kills[killer] ?? 0) + 1; updEgg(G.pl[killer].isl);
  const kp = online(killer); if (kp) { try { const s = stats(kp); s.ewk = (s.ewk ?? 0) + 1; touch(kp); } catch (e) { /* ignore */ } sound(kp, "random.orb", { pitch: 0.8 }); }
  return killer;
}
const reason = (q, why, kn) => (why === "void" ? (kn ? pick(q, "was knocked into the void by " + kn, "طيّحه " + kn + " بالفراغ") : pick(q, "fell into the void", "طاح بالفراغ")) : why === "died" ? (kn ? pick(q, "was killed by " + kn, "انقتل على يد " + kn) : pick(q, "died", "مات")) : why === "away" ? pick(q, "left the arena", "طلع من الساحة") : pick(q, "left the game", "طلع من اللعبة"));
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  const rec = G.pl[id], p = online(id);
  const killer = credit(id, why), kn = killer ? nameCol(killer) : null;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const left = G.alive.length;
  if (G.egg[rec.isl]) destroyEgg(rec.isl, null, "sudden");
  updEgg(rec.isl);
  if (why === "died") keepPending(id, rec);                                     // dead: given back after the respawn
  else if (p) {
    title(p, "§c§l" + pick(p, "ELIMINATED", "انقصيت"), "§7" + pick(p, "Place #" + (left + 1) + " - your things are back", "المركز #" + (left + 1) + " - رجعت أغراضك"), 40);
    try { if (p.getGameMode() === GameMode.Spectator || p.getGameMode() === "Spectator" || p.getGameMode() === "spectator") p.setGameMode(rec.gm ?? GameMode.Survival); } catch (e) { /* ignore */ }
    giveBackOrKeep(id, rec);
  } else keepPending(id, rec);
  if (p) { try { const s = stats(p); s.ewl = (s.ewl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } }
  toAll((q) => q.sendMessage("§c☠ " + nameCol(id) + " §7" + reason(q, why, kn) + "! §c§l" + pick(q, "OUT", "طلع") + " §r§e" + pick(q, "Players left: ", "اللاعبين الباقين: ") + left));
  if (G.alive.length <= 1 && G.phase !== "end") win(G.alive[0] ?? null);
}
/** died / fell with the egg alive: comes back after RESPAWN seconds */
function respawnLater(id, why) {
  const rec = G.pl[id]; rec.deaths = (rec.deaths ?? 0) + 1; rec.armor = 0;
  const killer = credit(id, why), kn = killer ? nameCol(killer) : null;
  toAll((q) => q.sendMessage("§7☠ " + nameCol(id) + " §7" + reason(q, why, kn) + ". §8(" + pick(q, "comes back - egg alive", "يرجع - بيضته عايشة") + ")"));
}
function toWatch(p, rec) {
  const a = arena(); if (!a) return;
  const is = L().islands[rec.isl];
  try { p.getComponent("minecraft:inventory")?.container?.clearAll(); } catch (e) { /* ignore */ }
  for (const s of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand]) { try { p.getComponent("minecraft:equippable")?.setEquipment(s, undefined); } catch (e) { /* ignore */ } }
  try { p.setGameMode(GameMode.Spectator); } catch (e) { /* ignore */ }
  try { p.teleport(abs(a, { x: is.x, y: TOP + 12, z: is.z }), { dimension: dimOf(a), facingLocation: abs(a, is.egg) }); } catch (e) { /* ignore */ }
  rec.resp = system.currentTick + RESPAWN * 20; rec.sec = -1;
}
function respawnNow(p, rec) {
  const a = arena(); if (!a) return;
  const is = L().islands[rec.isl];
  rec.resp = 0;
  try { p.setGameMode(GameMode.Survival); } catch (e) { /* ignore */ }
  try { p.teleport(abs(a, is.spawn), { dimension: dimOf(a), facingLocation: abs(a, is.look) }); } catch (e) { /* ignore */ }
  try { p.getComponent("minecraft:health")?.resetToMaxValue(); p.addEffect("resistance", 60, { amplifier: 4, showParticles: false }); p.addEffect("saturation", 20, { amplifier: 5, showParticles: false }); p.extinguishFire?.(); } catch (e) { /* ignore */ }
  title(p, "§a§l" + pick(p, "RESPAWNED", "رجعت"), "§7" + pick(p, "Protect your egg!", "احمي بيضتك!"), 20);
}
function win(wid) {
  const a = arena(), rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 160;
  if (wp && rec) { try { const s = stats(wp); s.eww = (s.eww ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } catch (e) { /* ignore */ } }
  const order = [...G.order].reverse(), second = order[0] ? nameCol(order[0]) : null, third = order[1] ? nameCol(order[1]) : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§e§l[Egg Wars] §r" + (rec ? nameCol(wid) + " §r§awins! §7(" + (G.kills[wid] ?? 0) + " kills" + (G.prize ? ", prize §a" + money(G.prize) : "") + "§7)" : "§7Nobody wins.") + (second ? " §72nd: " + second : "") + (third ? " §73rd: " + third : ""),
      "§e§l[حرب البيض] §r" + (rec ? nameCol(wid) + " §r§aفاز! §7(" + (G.kills[wid] ?? 0) + " قتلة" + (G.prize ? "، الجائزة §a" + money(G.prize) : "") + "§7)" : "§7محد فاز.") + (second ? " §7الثاني: " + second : "") + (third ? " §7الثالث: " + third : ""));
    if (inArena(q) || G.pl[q.id]) { title(q, rec ? nameCol(wid) : "§7-", "§e" + pick(q, "WINS EGG WARS!", "فاز بحرب البيض!"), 80); sound(q, "random.totem", { volume: 0.6 }); }
  }
  const dim = dimOf(a), at = wp ? wp.location : abs(a, { x: 0, y: TOP + 2, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
  if (rec) rec.win = 1;
}
export function stopEgg(reason = "stopped") {
  if (!G) return;
  const g = G; G = null;
  for (const [id, rec] of Object.entries(g.pl)) if (!rec.done) {
    const p = online(id);
    if (p && rec.resp) { try { p.setGameMode(rec.gm ?? GameMode.Survival); } catch (e) { /* ignore */ } }
    giveBackOrKeep(id, rec);
  }
  saveG();
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§e[Egg Wars] §7The game was stopped - everybody got his things back.", "§e[حرب البيض] §7انوقفت اللعبة - الكل رجعت له أغراضه.");
  const a = arena(); if (a) { busy = true; const dim = dimOf(a); system.runJob((function* () { try { yield* resetJob(a); } finally { busy = false; removeAreas(dim, AREA); } })()); }
}

// ---------------------------------------------------------------- every tick: generators, respawns, positions, time
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopEgg(); return; }
  try {
    const t = system.currentTick, Ly = layout(a.n);
    if (G.phase === "count") {
      for (const id of G.alive) { const p = online(id), rec = G.pl[id]; if (!p || !rec) continue; const is = Ly.islands[rec.isl], w = abs(a, is.spawn); if (Math.hypot(p.location.x - w.x, p.location.z - w.z) > 0.8) { try { p.teleport(w, { facingLocation: abs(a, is.look) }); } catch (e) { /* ignore */ } } }
      if (t >= G.until) { G.phase = "run"; G.start = t; G.end = t + G.minutes * 1200; toAll((p) => { title(p, "§e§l" + pick(p, "GO!", "يلا!"), "§7" + pick(p, "Protect your egg!", "احمي بيضتك!"), 20); sound(p, "note.pling", { pitch: 1.6 }); }); }
      else if (Math.ceil((G.until - t) / 20) !== G.sec) { G.sec = Math.ceil((G.until - t) / 20); toAll((p) => { title(p, "§e§l" + G.sec, null, 18); sound(p, "note.hat"); }); }
      return;
    }
    if (G.phase === "end") { if (t >= G.until) stopEgg("end"); return; }
    if (G.phase !== "run") return;
    runGens(a, t);
    const H = halfOf(a);
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      const rec = G.pl[id];
      if (rec.resp > 0) {                                                        // waiting to come back
        const s = Math.ceil((rec.resp - t) / 20);
        if (t >= rec.resp) respawnNow(p, rec);
        else if (s !== rec.sec) { rec.sec = s; title(p, "§c§l" + pick(p, "YOU DIED", "متت"), "§7" + pick(p, "Back in ", "ترجع بعد ") + "§e" + s, 22); }
        continue;
      }
      if (rec.resp === -1) continue;                                             // on the death screen
      const l = p.location;
      if (p.dimension.id !== a.d) { eliminate(id, "away"); continue; }
      const far = Math.abs(l.x - a.cx) > H + 3 || Math.abs(l.z - a.cz) > H + 3 || l.y - a.cy > Ly.UP + 8;
      if (far || l.y - a.cy < Ly.voidY) {                                        // the void / too far: a death
        const why = far ? "away" : "void";
        if (G.egg[rec.isl]) { respawnLater(id, why === "away" ? "void" : why); rec.resp = -2; toWatch(p, rec); }
        else eliminate(id, why);
      }
    }
    if (!G || G.phase !== "run") return;
    if (!G.sudden && t >= G.end) {                                               // time over: sudden death
      G.sudden = t + SUDDEN_MIN * 1200;
      for (const i of Object.keys(G.egg)) destroyEgg(+i, null, "sudden");
      toAll((q) => { q.sendMessage(pick(q, "§c§l[Egg Wars] SUDDEN DEATH! §r§7Every egg is broken - nobody comes back. " + SUDDEN_MIN + " minutes, then the most kills wins.", "§c§l[حرب البيض] الموت المفاجئ! §r§7كل البيض انكسر - محد يرجع. " + SUDDEN_MIN + " دقايق وبعدين اللي عنده أكثر قتلات يفوز.")); title(q, "§c§l" + pick(q, "SUDDEN DEATH", "الموت المفاجئ"), "§7" + pick(q, "every egg is broken", "كل البيض انكسر"), 50); sound(q, "mob.enderdragon.growl", { volume: 0.6 }); });
    }
    if (G.sudden && t >= G.sudden) {                                             // the end: the most kills wins
      let best = null, bk = -1, tie = false;
      for (const id of G.alive) { const k = G.kills[id] ?? 0; if (k > bk) { bk = k; best = id; tie = false; } else if (k === bk) tie = true; }
      for (const id of [...G.alive]) if (id !== best || tie) { G.alive = G.alive.filter((x) => x !== id); G.order.push(id); const p = online(id), rec = G.pl[id]; if (p && rec.resp) { try { p.setGameMode(rec.gm ?? GameMode.Survival); } catch (e) { /* ignore */ } } giveBackOrKeep(id, rec); }
      toAll((q) => q.sendMessage(pick(q, "§e[Egg Wars] Time is over!", "§e[حرب البيض] خلص الوقت!")));
      win(tie ? null : best);
    }
  } catch (e) { console.warn("[eggwars] tick: " + e); }
}, 5);
// the bar
system.runInterval(() => {
  if (!G || (G.phase !== "run" && G.phase !== "count")) return;
  const t = system.currentTick, left = G.phase === "run" ? Math.max(0, Math.ceil(((G.sudden || G.end) - t) / 20)) : G.minutes * 60;
  toAll((p) => {
    const rec = G.pl[p.id], mine = rec && G.alive.includes(p.id) ? (G.egg[rec.isl] ? "§a✔ " + pick(p, "your egg", "بيضتك") : "§c✘ " + pick(p, "no egg", "بلا بيضة")) + " §7| " : "";
    bar(p, "§e§lEGG WARS §r§7| " + mine + "§f🥚 " + eggsLeft() + " §7| " + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §c" + pick(p, "Kills", "قتلات") + ": §f" + (G.kills[p.id] ?? 0) + " §7| " + (G.sudden ? "§c" : "§e") + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0"));
  });
}, 10);

// deaths + who hit whom
safe("die", () => world.afterEvents.entityDie.subscribe(({ deadEntity, damageSource }) => {
  if (!G || deadEntity?.typeId !== "minecraft:player") return;
  const id = deadEntity.id; if (!G.alive.includes(id)) return;
  const rec = G.pl[id];
  const k = damageSource?.damagingEntity; if (k?.typeId === "minecraft:player") rec.killer = k.id;
  if (rec.resp) return;                                                          // already counted (void)
  if (G.phase === "run" && G.egg[rec.isl]) { respawnLater(id, "died"); rec.resp = -1; }
  else eliminate(id, "died");
}));
safe("respawn", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) { try { if (!G?.alive.includes(player.id)) econLocks.delete(player.id); } catch (e) { /* ignore */ } return; }
  const rec = G?.pl[player.id]; if (!rec || !G.alive.includes(player.id) || rec.resp !== -1) return;
  system.run(() => { try { if (G?.alive.includes(player.id)) toWatch(player, rec); } catch (e) { /* ignore */ } });
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

// ---------------------------------------------------------------- the arena rules
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const playing = (p) => !!(G && G.alive.includes(p.id) && G.phase === "run" && !G.pl[p.id]?.resp);
const eggIsle = (a, b) => { const Ly = layout(a.n); for (const [i] of Object.entries(G?.owner ?? {})) { const e = absB(a, Ly.islands[i].egg); if (e.x === b.x && e.y === b.y && e.z === b.z) return +i; } return -1; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, p = ev.player, a = eggAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
  if (b.typeId === EGG) {
    ev.cancel = true;
    if (!G) { if (owner(p)) system.run(() => { try { b.dimension.getBlock(b.location)?.setPermutation(perm("air")); } catch (e) { /* ignore */ } }); return; }
    const i = eggIsle(a, b); if (i < 0) return;
    if (!playing(p)) return;
    if (G.owner[i] === p.id) return deny(p, "§c[Egg Wars] This is YOUR egg - defend it!", "§c[حرب البيض] هذي بيضتك انت - دافع عنها!");
    system.run(() => destroyEgg(i, p.id));
    return;
  }
  if (!G) { if (owner(p)) return; ev.cancel = true; return deny(p, "§c[Egg Wars] You can't break the arena now.", "§c[حرب البيض] ما تقدر تكسر الساحة هسه."); }
  const k = K(b.x, b.y, b.z);
  if (playing(p) && G.placed.has(k)) { G.placed.delete(k); return; }               // a block a player placed: OK
  if (owner(p) && !G.pl[p.id]) return;
  ev.cancel = true;
  deny(p, "§c[Egg Wars] Only the blocks placed by the players can be broken.", "§c[حرب البيض] تقدر تكسر بس البلوكات اللي حطها اللاعبين.");
}));
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    const a = eggAt(block.dimension.id, block.x, block.y, block.z); if (!a) return;
    if (!G || !playing(player)) {
      if (owner(player) && !G?.pl[player.id]) return;
      system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } });
      return deny(player, "§c[Egg Wars] You can't build here now.", "§c[حرب البيض] ما تقدر تبني هنا هسه.");
    }
    if (block.typeId === "minecraft:tnt") {                                       // TNT lights itself at once
      const at = { x: block.x + 0.5, y: block.y, z: block.z + 0.5 }, dim = block.dimension;
      system.run(() => { try { dim.getBlock(block.location)?.setType("minecraft:air"); const e = dim.spawnEntity("minecraft:tnt", at); e.addTag(TAG); } catch (e) { /* ignore */ } });
      return;
    }
    G.placed.add(K(block.x, block.y, block.z));                                   // stays until the game ends (only players' blocks can be broken)
  } catch (e) { /* ignore */ }
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const a = arena(); if (!a) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks();
  const keep = all.filter((b) => !eggAt(d, b.x, b.y, b.z) || (G && G.phase === "run" && G.placed.has(K(b.x, b.y, b.z))));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
  if (G) system.run(() => { for (const b of keep) G?.placed.delete(K(b.x, b.y, b.z)); });
}));
// tap: the villager = the shop, a generator = upgrade, the egg = info
safe("trader", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== TRADER) return;
  ev.cancel = true;
  const p = ev.player; system.run(() => shopPage(p));
}));
safe("trader hit", () => world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: p, hitEntity: e }) => {
  try { if (e?.typeId === TRADER && p?.typeId === "minecraft:player") shopPage(p); } catch (x) { /* ignore */ }
}));
safe("use", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!G || ev.isFirstEvent === false) return;
  const b = ev.block, p = ev.player, a = eggAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
  if (p.isSneaking && ev.itemStack) return;                                       // placing a block next to it
  const id = b.typeId;
  if (id === "minecraft:iron_block" || id === "minecraft:gold_block" || id === "minecraft:diamond_block") {
    const g = G.gens.find((x) => { const w = absB(a, x.p); return w.x === b.x && w.y === b.y && w.z === b.z; }); if (!g) return;
    ev.cancel = true;
    system.run(() => {
      if (!GEN[g.k].up) return tell(p, "§b[Egg Wars] " + GEN[g.k].name + " generator: one every " + Math.round(GEN[g.k].every[1] / 20) + " s.", "§b[حرب البيض] مولد " + (g.k === "cgold" ? "ذهب" : "دايموند") + ": وحدة كل " + Math.round(GEN[g.k].every[1] / 20) + " ثانية.");
      if (!playing(p)) return;
      if (G.owner[g.isl] !== p.id) return tell(p, "§c[Egg Wars] This generator is not yours.", "§c[حرب البيض] هذا المولد مو مالتك.");
      genPage(p, g);
    });
    return;
  }
  if (id === EGG) {
    ev.cancel = true;
    const i = eggIsle(a, b); if (i < 0) return;
    system.run(() => tell(p, "§e🥚 " + nameCol(G.owner[i]) + (G.owner[i] === p.id ? " §7- your egg. Protect it with blocks!" : " §7- mine it to break it!"), "§e🥚 " + nameCol(G.owner[i]) + (G.owner[i] === p.id ? " §7- بيضتك. احميها بالبلوكات!" : " §7- اكسرها حتى ما يرجع!")));
  }
}));

// ---------------------------------------------------------------- Owner pages
export function eggPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => eggPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: Egg Wars", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive, " + eggsLeft() + " eggs)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§e§lEgg Wars\n§r§7Islands with eggs, generators and a\n§r§7shop. Break the eggs, last one wins.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.n + " islands, " + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/eggwars", "textures/items/egg", null);
  if (!a) {
    for (const [col, n] of [[3, 10], [5, 20]]) set(f, 2 * COLS + col, hdr(n, "g") + "§a§lBuild for " + n + " players\n§r§7" + n + " coloured islands with an egg,\n§r§7generators and a shop + 4 diamond\n§r§7islands + the centre (" + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + ")\n§r§7The land is saved\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build Egg Wars for " + n + "?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7The islands float " + TOP + " blocks over you", "§7Everything in " + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + " blocks is replaced (Undo puts it back)."], () => buildEgg(player, n), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length, max = layout(a.n).n;
    set(f, 1 * COLS + 2, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + max + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 4, hdr(c.minutes) + "§f§lTime limit\n§r§7Now: §e" + c.minutes + " min\n§r§7Then sudden death (" + SUDDEN_MIN + " min more),\n§r§7then the most kills wins\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.minutes = MINUTES[(MINUTES.indexOf(c.minutes) + 1) % MINUTES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, max) + " players, countdown " + COUNT + " s\n§r§7New islands, eggs, shops\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startEgg(player); if (r.err) say(player, "§c[Egg Wars] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the centre island", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, { x: 0, y: TOP + 2, z: 4 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Egg Wars arena?", ["§7The land comes back as it was."], () => undoEgg(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + " §7| Eggs: §e" + eggsLeft() + "\n§r" + G.alive.map((id) => nameCol(id) + " §7(" + (G.kills[id] ?? 0) + (G.egg[G.pl[id].isl] ? " §a✔" : " §c✘") + "§7)").join("§7, "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lWatch\n§r§7Teleport over the centre", "textures/items/ender_eye", { run: () => { try { player.teleport(abs(a, { x: 0, y: TOP + 14, z: 0 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody gets his\n§r§7things back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody gets his own things back."], () => stopEgg(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), max = L().n;
  const f = makeOpr("Egg Wars: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 36, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + max + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/egg" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < max) c.roster.push(p.id); else say(player, "§c[Egg Wars] The game is full (" + max + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody online\n§r§7Adds every online player", "textures/items/egg", { run: () => { for (const p of world.getAllPlayers()) if (!c.roster.includes(p.id) && c.roster.length < max) c.roster.push(p.id); saveCfg(); self(); } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 7, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
eggwarsHook.page = eggPage;

// ---------------------------------------------------------------- /eggwars (every player)
export function eggMenu(player) {
  const f = makeOpr("Egg Wars", SHORT_ROWS); f.self = () => eggMenu(player); f.glass = true;
  let top = []; try { top = ranking("eggwars").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§e§lEgg Wars\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/egg", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + " §7| Eggs: §e" + eggsLeft() + "\n§r" + G.alive.map((id) => nameCol(id)).join("§7, "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, "g") + "§e§lHow to play\n§r§7Iron + gold: your generators (tap to\n§r§7upgrade). Diamonds: the middle islands.\n§r§7Buy at the villager of your island.\n§r§7Egg alive = you come back after dying.\n§r§7Mine the eggs of the others!\n§r§7Only placed blocks can be broken.", "textures/items/book_writable", null);
  const s = stats(player);
  set(f, 3 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.eww ?? 0) + "\n§r§7Losses: §c" + (s.ewl ?? 0) + "\n§r§7Kills: §f" + (s.ewk ?? 0) + "\n§r§7Eggs broken: §e" + (s.ewe ?? 0), "textures/items/diamond_sword", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:eggwars", description: "Egg Wars: the game and the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { eggMenu(p); } catch (e) { console.warn("[eggwars] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[eggwars] command: " + e); }
});
