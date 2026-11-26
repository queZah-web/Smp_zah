// ===================================================================================================================
// LUCKY BLOCK WARS (event)  -  /opr > Building / Events > Lucky Wars  (Owner)   and   /luckywars (every player)
//
// The Sky Wars islands in gold (luckydesign.js), for 10 or 20 players, full of LUCKY BLOCKS (luckyfx.js):
//   * every player island 5, every middle island 3, the centre 8 + the MEGA LUCKY BLOCK (27 blocks with the best luck)
//   * ONE HIT on a lucky block opens it (hand or anything): LUCKY (weapons, armour sets, the Lucky Sword / Bow, totems,
//     elytra, mace, pets, treasure chests, loot rain, power effects ...), UNLUCKY (mobs, lightning, TNT / anvil / arrow
//     rain, cages, cobwebs, bad effects, teleports, trolls ...) or FUN.  Rare finds are told to everybody.
//   * some surprises give LUCKY BLOCK items: place one anywhere in the arena and hit it - it is a lucky block too
//   * every 3 minutes the lucky blocks of the middle islands and the centre come back ("LUCKY REFILL")
//   * golden sparkles over the lucky blocks (a few particles a second, no lag)
// Like Sky Wars: own things + XP into a locker + the loot record, everybody starts with nothing, 10 s countdown, break and
// build anything, TNT lights itself, the void / death / leaving = OUT (own things back, home), last one alive wins (time
// over: the most kills), buying / selling is off for the players.  After the game the islands are built again.
// ===================================================================================================================
import { world, system, GameMode, BlockVolume, StructureSaveMode, EquipmentSlot, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog, econLocks } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, luckyHook } from "./spawnbuild.js";
import { TOP, LUCKY, layout, lockerAt, luckyGen, lockerBlocks } from "./luckydesign.js";
import { openLucky, LORE, LUCKY_TAG, item } from "./luckyfx.js";
import { storeInv, giveBack, addRecord, markRecord, lootGivers } from "./skywars.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { exOf } from "../smp/store.js";

const KEY = "lbw:arena", CFG_KEY = "lbw:cfg", MKEY = "lbw:m", PEND_KEY = "lbw:pend", AREA = "smp_lbw_";
const PRIZES = [0, 2500, 5000, 10000, 25000, 50000], MINUTES = [10, 15, 20, 30], COUNT = 10, REFILL = 3 * 1200;
const LUCKY_ID = "minecraft:" + LUCKY;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const title = (p, t, sub, stay = 40) => { try { p.onScreenDisplay.setTitle(t, { subtitle: sub ?? "", fadeInDuration: 2, stayDuration: stay, fadeOutDuration: 8 }); } catch (e) { /* ignore */ } };
const sound = (p, s, o) => { try { p.playSound(s, o); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[luckywars] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[luckywars] save " + k + ": " + e); } };
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
export const luckyAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!luckyAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
let cfg = null;
const conf = () => (cfg ??= { prize: 10000, minutes: 15, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());
const L = () => layout(arena()?.n ?? 10);

// ---------------------------------------------------------------- building / rebuilding the islands
let busy = false, design = null;
function* getDesign(n) { if (design && design.L.n === n) return design; const g = luckyGen(n); let r; while (!(r = g.next()).done) yield; design = r.value; return design; }
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
const JUNK = ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:tnt", "minecraft:snowball", "minecraft:egg", "minecraft:ender_pearl", "minecraft:falling_block", "minecraft:fireball", "minecraft:small_fireball", "minecraft:wind_charge_projectile", "minecraft:fireworks_rocket", "minecraft:thrown_trident", "minecraft:splash_potion"];
function clearEntities(a) {
  const dim = dimOf(a); if (!dim) return;
  try {
    for (const e of dim.getEntities({ location: abs(a, { x: 0, y: TOP, z: 0 }), maxDistance: halfOf(a) * 1.5 + 20 })) {
      let mine = false; try { mine = e.hasTag(LUCKY_TAG); } catch (x) { mine = false; }
      if (mine || JUNK.includes(e.typeId)) { try { e.remove(); } catch (x) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Lucky Wars] Building:"))) { removeAreas(dim, AREA); say(player, "§c[Lucky Wars] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:lbw_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[luckywars] backup: " + e); }
      bar(player, "§e[Lucky Wars] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    yield* clearSky(a, dim, 1, layout(a.n).UP);
    for (const b of lockerBlocks()) { try { dim.getBlock({ x: a.cx + b.x, y: a.cy + b.y, z: a.cz + b.z })?.setPermutation(perm(b.id, b.st)); } catch (e) { /* ignore */ } }
    const d = yield* getDesign(a.n);
    yield* placeCanvas(a, dim, d.canvas, (k) => bar(player, "§e[Lucky Wars] §fBuilding the islands... §e" + k));
    removeAreas(dim, AREA);
    say(player, "§e[Lucky Wars] The arena is ready (" + a.n + " islands, " + d.lucky.length + " lucky blocks)! §7(" + Math.round((Date.now() - t0) / 1000) + " s) §eStart a game in §f/opr > Events > Lucky Wars§e.");
    sound(player, "random.levelup");
  } catch (e) { console.warn("[luckywars] build: " + e); say(player, "§c[Lucky Wars] Building stopped: " + e); removeAreas(dim, AREA); }
  finally { busy = false; }
}
export function buildLucky(player, n) {
  if (!owner(player)) return say(player, "§c[Lucky Wars] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[Lucky Wars] The arena is being built right now.");
  if (arena()) return say(player, "§c[Lucky Wars] The arena already exists. Undo it first.");
  const Ly = layout(n), dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - Ly.DOWN < hr.min || cy + Ly.UP >= hr.max) return say(player, "§c[Lucky Wars] Too high here: the islands are " + TOP + " blocks over you. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, n, x1: cx - Ly.HX - 1, y1: cy - Ly.DOWN, z1: cz - Ly.HX - 1, x2: cx + Ly.HX + 1, y2: cy + Ly.UP, z2: cz + Ly.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Lucky Wars] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§e[Lucky Wars] Building the arena for " + n + " players (" + (Ly.HX * 2 + 1) + " x " + (Ly.HX * 2 + 1) + ")... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "luckywars", null, "built (" + n + ") at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Lucky Wars] Undo:"))) { removeAreas(dim, AREA); say(player, "§c[Lucky Wars] The area could not be loaded. Go there and try again."); return; }
    clearEntities(a);
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[luckywars] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    A = null; saveA(); design = null;
    removeAreas(dim, AREA);
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Lucky Wars] Removed: the land is back as it was." : "§e[Lucky Wars] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoLucky(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Lucky Wars] Stop the game first.");
  if (Object.keys(pend()).length) return say(player, "§c[Lucky Wars] Some players still have their things in the lockers (they are offline). Wait until they join again.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}
function* resetJob(a) {
  const dim = dimOf(a); if (!dim) return;
  clearEntities(a);
  yield* clearSky(a, dim, 1, layout(a.n).UP);
  const d = yield* getDesign(a.n);
  yield* placeCanvas(a, dim, d.canvas);
  clearEntities(a);
}

// ---------------------------------------------------------------- lockers (shared with Sky Wars) + pending give-backs
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
    if (giveBack(a, p, all[id])) { all[id].done = 1; if (G?.pl[id]) { G.pl[id].done = 1; saveG(); } delete all[id]; changed = true; tell(p, "§a[Lucky Wars] Your own things and your XP are back.", "§a[حرب اللوكي بلوك] رجعت لك أغراضك والـ XP."); }
    else need = true;
  }
  if (changed) writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  try { const dim = dimOf(a), l = lockerAt(0); if (need) dim.runCommand(`tickingarea add circle ${a.cx + l.x} ${a.cy + l.y} ${a.cz + l.z} 2 ${AREA}lock true`); else if (!Object.keys(all).length) dim.runCommand(`tickingarea remove ${AREA}lock`); } catch (e) { /* ignore */ }
}, 40);
lootGivers.lucky = (staff, r, now) => {
  if (G?.alive.includes(r.pid)) { say(staff, "§c[Lucky Wars] He is playing right now - it comes back when he is out."); return false; }
  const all = pend(), rec = all[r.pid] ?? G?.pl[r.pid];
  if (rec && !rec.done && giveBack(arena(), now, rec)) { rec.done = 1; delete all[r.pid]; writeJson(PEND_KEY, Object.keys(all).length ? all : null); markRecord(r.id, "returned", staff.name); try { slog(staff, "luckywars", { id: r.pid, name: r.n }, "loot given back from the locker"); } catch (e) { /* ignore */ } return true; }
  say(staff, "§c[Lucky Wars] Not in a locker any more (already given back?)."); return false;
};

// ---------------------------------------------------------------- the game
// G = { phase, until, pl: { id: rec }, alive, order, prize, minutes, start, end, kills, hit, lucky: Map(abs key -> tier), opened, refill }
let G = null;
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const luckyView = () => (G ? { phase: G.phase, alive: [...G.alive], order: [...G.order], left: G.lucky.size } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inArena(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
system.runTimeout(() => {
  const old = readJson(MKEY, null); if (!old?.pl) return;
  writeJson(MKEY, null);
  for (const [id, rec] of Object.entries(old.pl)) if (!rec.done) keepPending(id, rec);
}, 60);
const homeOf = (p) => { try { const h = (exOf(p.id).homes ?? [])[0]; return h ? { x: h.x, y: h.y, z: h.z, d: h.d } : null; } catch (e) { return null; } };
const playing = (p) => !!(G && G.alive.includes(p.id) && G.phase === "run");

/** the lucky blocks of the design, in world positions */
function loadLucky(a, onlyMiddle) {
  const d = design; if (!d) return 0;
  const dim = dimOf(a); let n = 0;
  for (const l of d.lucky) {
    if (onlyMiddle && l.t === "island") continue;
    const k = K(a.cx + l.x, a.cy + l.y, a.cz + l.z);
    if (onlyMiddle) {                                                            // the refill: only where the place is empty again
      if (G.lucky.has(k)) continue;
      let b; try { b = dim.getBlock({ x: a.cx + l.x, y: a.cy + l.y, z: a.cz + l.z }); } catch (e) { b = null; }
      if (!b || !b.isAir) continue;
      try { b.setPermutation(perm(LUCKY)); } catch (e) { continue; }
    }
    G.lucky.set(k, l.t); n++;
  }
  return n;
}
/** a lucky block is opened */
function openAt(p, a, b, k) {
  const tier = G.lucky.get(k); if (!tier) return;
  G.lucky.delete(k);
  const dim = b.dimension, at = { x: b.x + 0.5, y: b.y + 0.2, z: b.z + 0.5 };
  try { b.setPermutation(perm("air")); } catch (e) { /* ignore */ }
  G.opened[p.id] = (G.opened[p.id] ?? 0) + 1;
  try { const s = stats(p); s.lbo = (s.lbo ?? 0) + 1; touch(p); } catch (e) { /* ignore */ }
  const c = {
    p, dim, at,
    drop: (list, up = 0) => { for (const it of list) { if (!it) continue; try { const e = dim.spawnItem(it, { x: at.x, y: at.y + 0.3 + up * Math.random(), z: at.z }); if (up) e.applyImpulse({ x: (Math.random() - 0.5) * 0.4, y: 0.1, z: (Math.random() - 0.5) * 0.4 }); } catch (e) { /* ignore */ } } },
    mob: (id, n) => { const out = []; for (let i = 0; i < n; i++) { try { const e = dim.spawnEntity(id, { x: at.x + (Math.random() - 0.5) * 2, y: at.y + 0.2, z: at.z + (Math.random() - 0.5) * 2 }); e.addTag(LUCKY_TAG); try { e.addEffect("fire_resistance", 20000000, { showParticles: false }); } catch (x) { /* ignore */ } out.push(e); } catch (e) { /* ignore */ } } return out; },
    spots: () => (design?.spawns ?? []).map((s) => abs(a, s)),
  };
  const r = openLucky(c, tier);
  for (let i = 0; i < 10; i++) { try { dim.spawnParticle(r.kind === "B" ? "minecraft:villager_angry" : "minecraft:villager_happy", { x: at.x + (Math.random() - 0.5) * 1.2, y: at.y + Math.random() * 1.2, z: at.z + (Math.random() - 0.5) * 1.2 }); } catch (e) { /* ignore */ } }
  if (r.kind === "G") { title(p, "§a§l" + pick(p, "LUCKY!", "محظوظ!"), "§f" + pick(p, r.en, r.ar), 30); sound(p, "random.levelup", { pitch: 1.5 }); }
  else if (r.kind === "B") { title(p, "§c§l" + pick(p, "UNLUCKY!", "منحوس!"), "§f" + pick(p, r.en, r.ar), 30); sound(p, "mob.wither.shoot", { volume: 0.5, pitch: 1.3 }); }
  else { title(p, "§d§l" + pick(p, "SURPRISE!", "مفاجأة!"), "§f" + pick(p, r.en, r.ar), 30); sound(p, "random.pop"); }
  if (r.rare || tier === "mega") toAll((q) => q.sendMessage("§6✦ §e" + G.pl[p.id]?.n + " §7" + pick(q, "opened", "فتح") + (tier === "mega" ? " §6§l" + pick(q, "the MEGA lucky block", "اللوكي بلوك العملاق") + "§r§7" : " §7" + pick(q, "a lucky block", "لوكي بلوك")) + ": " + (r.kind === "B" ? "§c" : "§a") + pick(q, r.en, r.ar)));
}

export function startLucky(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  if (Object.keys(pend()).length) return { err: "Some players from the last game still wait for their things (offline). They get them when they join; then start again." };
  const c = conf(), Ly = layout(a.n), ids = c.roster.filter((id) => online(id)).slice(0, Ly.n);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "prep", until: 0, pl: {}, alive: [], order: [], prize: c.prize, minutes: c.minutes, start: 0, kills: {}, hit: {}, lucky: new Map(), opened: {}, refill: 0, by: player.name };
  busy = true;
  const dim = dimOf(a);
  system.runJob((function* () {
    try {
      addAreas(dim, a, AREA);
      if (!(yield* waitLoaded(player, dim, a, "[Lucky Wars] Getting the islands ready:"))) { say(player, "§c[Lucky Wars] The arena could not be loaded."); G = null; removeAreas(dim, AREA); return; }
      for (const q of world.getAllPlayers()) tell(q, "§e§l[Lucky Wars] §r§7The lucky islands are being prepared...", "§e§l[حرب اللوكي بلوك] §r§7الجزر تتجهز...");
      yield* resetJob(a);
      loadLucky(a, false);
      const k = ids.length, spots = [...Array(k).keys()].map((j) => Math.floor((j * design.spawns.length) / k));
      let n = 0;
      for (const id of ids.slice().sort(() => Math.random() - 0.5)) {
        const p = online(id); if (!p) continue;
        const l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
        let lv = 0, xp = 0; try { lv = p.level; xp = p.xpEarnedAtCurrentLevel; } catch (e) { /* ignore */ }
        const st = storeInv(a, p, n);
        if (!st) { say(player, "§c[Lucky Wars] A locker is missing or not empty: " + p.name + " can not play (his things were NOT touched)."); continue; }
        const hid = "h" + Date.now().toString(36) + "l" + n;
        addRecord({ id: hid, g: "lucky", pid: id, n: p.name, t: Date.now(), lv, xp, items: st.items, st: "locked", w: Math.floor(l.x) + " " + Math.floor(l.y) + " " + Math.floor(l.z) + " " + p.dimension.id });
        const sp = design.spawns[spots[n]];
        G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, home: homeOf(p), map: st.map, lv, xp, locker: n, sp, hid };
        G.alive.push(id); n++;
        saveG();
        try { econLocks.add(id); } catch (e) { /* ignore */ }
        try { p.teleport(abs(a, sp), { dimension: dim, facingLocation: abs(a, { x: 0, y: TOP + 1, z: 0 }) }); } catch (e) { /* ignore */ }
        try { p.setGameMode(GameMode.Survival); p.getComponent("minecraft:health")?.resetToMaxValue(); p.addEffect("saturation", 60, { amplifier: 10, showParticles: false }); } catch (e) { /* ignore */ }
        tell(p, "§e§l[Lucky Wars] §r§fHit the §eLUCKY BLOCKS §f(the yellow blocks) - one hit opens one! §7Lucky or unlucky, who knows... The MEGA lucky block waits in the centre. Last one alive wins. §8(Your own things are safe in a locker - buying / selling is off.)",
          "§e§l[حرب اللوكي بلوك] §r§fاضرب §eاللوكي بلوك §f(البلوكات الصفرة) - ضربة وحدة تفتحها! §7حظ حلو أو نحس، محد يدري... اللوكي بلوك العملاق بالنص. آخر واحد يبقى يفوز. §8(أغراضك محفوظة بخزانة - البيع والشراء مطفي.)");
        yield;
      }
      if (G.alive.length < 2) { say(player, "§c[Lucky Wars] Not enough players."); for (const id of G.alive) giveBackOrKeep(id, G.pl[id]); G = null; saveG(); removeAreas(dim, AREA); return; }
      G.phase = "count"; G.until = system.currentTick + COUNT * 20;
      const names = G.alive.map((id) => G.pl[id].n).join(", ");
      for (const q of world.getAllPlayers()) tell(q, "§e§l[Lucky Wars] §r§fA game starts! §7" + G.alive.length + " players: §f" + names + " §e/luckywars", "§e§l[حرب اللوكي بلوك] §r§fبدت لعبة! §7" + G.alive.length + " لاعب: §f" + names + " §e/luckywars");
      try { slog(player, "luckywars", null, "game started: " + G.alive.length + " players"); } catch (e) { /* ignore */ }
    } catch (e) { console.warn("[luckywars] start: " + e); }
    finally { busy = false; }
  })());
  return { ok: true };
}
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const rec = G.pl[id], p = online(id), left = G.alive.length;
  const h = G.hit[id], killer = why === "died" && rec.killer ? rec.killer : h && system.currentTick - h[1] < 200 ? h[0] : null;
  if (killer && G.pl[killer] && killer !== id) { G.kills[killer] = (G.kills[killer] ?? 0) + 1; const kp = online(killer); if (kp) { try { const s = stats(kp); s.lbk = (s.lbk ?? 0) + 1; touch(kp); } catch (e) { /* ignore */ } } }
  if (why === "died") keepPending(id, rec);
  else if (p) { title(p, "§c§l" + pick(p, "ELIMINATED", "انقصيت"), "§7" + pick(p, "Place #" + (left + 1) + " - your things are back", "المركز #" + (left + 1) + " - رجعت أغراضك"), 40); giveBackOrKeep(id, rec); }
  else keepPending(id, rec);
  if (p) { try { const s = stats(p); s.lbl = (s.lbl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } }
  const kn = killer && G.pl[killer] ? G.pl[killer].n : null;
  const reason = (q) => (why === "void" ? (kn ? pick(q, "was knocked into the void by " + kn, "طيّحه " + kn + " بالفراغ") : pick(q, "fell into the void", "طاح بالفراغ")) : why === "died" ? (kn ? pick(q, "was killed by " + kn, "انقتل على يد " + kn) : pick(q, "died", "مات")) : why === "away" ? pick(q, "left the arena", "طلع من الساحة") : pick(q, "left the game", "طلع من اللعبة"));
  toAll((q) => q.sendMessage("§c☠ §f" + rec.n + " §7" + reason(q) + "! §e" + pick(q, "Players left: ", "اللاعبين الباقين: ") + left));
  if (G.alive.length <= 1 && G.phase !== "end") win(G.alive[0] ?? null);
}
function win(wid) {
  const a = arena(), rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 140;
  if (wp && rec) { try { const s = stats(wp); s.lbw = (s.lbw ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } catch (e) { /* ignore */ } }
  const order = [...G.order].reverse(), second = order[0] ? G.pl[order[0]].n : null, third = order[1] ? G.pl[order[1]].n : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§e§l[Lucky Wars] §r" + (rec ? "§6§l" + rec.n + " §r§awins! §7(" + (G.kills[wid] ?? 0) + " kills, " + (G.opened[wid] ?? 0) + " lucky blocks" + (G.prize ? ", prize §a" + money(G.prize) : "") + "§7)" : "§7Nobody wins.") + (second ? " §72nd: §f" + second : "") + (third ? " §73rd: §f" + third : ""),
      "§e§l[حرب اللوكي بلوك] §r" + (rec ? "§6§l" + rec.n + " §r§aفاز! §7(" + (G.kills[wid] ?? 0) + " قتلة، " + (G.opened[wid] ?? 0) + " لوكي بلوك" + (G.prize ? "، الجائزة §a" + money(G.prize) : "") + "§7)" : "§7محد فاز.") + (second ? " §7الثاني: §f" + second : "") + (third ? " §7الثالث: §f" + third : ""));
    if (inArena(q) || G.pl[q.id]) { title(q, "§6§l" + (rec ? rec.n : "-"), "§e" + pick(q, "WINS LUCKY BLOCK WARS!", "فاز بحرب اللوكي بلوك!"), 80); sound(q, "random.totem", { volume: 0.6 }); }
  }
  const dim = dimOf(a), at = wp ? wp.location : abs(a, { x: 0, y: TOP + 2, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
  if (rec) rec.win = 1;
}
export function stopLucky(reason = "stopped") {
  if (!G) return;
  const g = G; G = null;
  for (const [id, rec] of Object.entries(g.pl)) if (!rec.done) giveBackOrKeep(id, rec);
  saveG();
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§e[Lucky Wars] §7The game was stopped - everybody got his things back.", "§e[حرب اللوكي بلوك] §7انوقفت اللعبة - الكل رجعت له أغراضه.");
  const a = arena(); if (a) { busy = true; const dim = dimOf(a); system.runJob((function* () { try { yield* resetJob(a); } finally { busy = false; removeAreas(dim, AREA); } })()); }
}

// ---------------------------------------------------------------- every tick: positions, time, refill
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopLucky(); return; }
  try {
    const t = system.currentTick, Ly = layout(a.n);
    if (G.phase === "count") {
      for (const id of G.alive) { const p = online(id), sp = G.pl[id]?.sp; if (!p || !sp) continue; const w = abs(a, sp); if (Math.hypot(p.location.x - w.x, p.location.z - w.z) > 0.8) { try { p.teleport(w, { facingLocation: abs(a, { x: 0, y: TOP + 1, z: 0 }) }); } catch (e) { /* ignore */ } } }
      if (t >= G.until) { G.phase = "run"; G.start = t; G.end = t + G.minutes * 1200; G.refill = t + REFILL; toAll((p) => { title(p, "§e§l" + pick(p, "GO!", "يلا!"), "§7" + pick(p, "Hit the lucky blocks!", "اضرب اللوكي بلوك!"), 20); sound(p, "note.pling", { pitch: 1.6 }); }); }
      else if (Math.ceil((G.until - t) / 20) !== G.sec) { G.sec = Math.ceil((G.until - t) / 20); toAll((p) => { title(p, "§e§l" + G.sec, null, 18); sound(p, "note.hat"); }); }
    }
    if (G.phase === "end") { if (t >= G.until) stopLucky("end"); return; }
    if (G.phase !== "run" && G.phase !== "count") return;
    const H = halfOf(a);
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      const l = p.location;
      if (p.dimension.id !== a.d || Math.abs(l.x - a.cx) > H + 3 || Math.abs(l.z - a.cz) > H + 3 || l.y - a.cy > Ly.UP + 6) { eliminate(id, "away"); continue; }
      if (l.y - a.cy < Ly.voidY) { eliminate(id, "void"); continue; }
    }
    if (!G || G.phase !== "run") return;
    if (t >= G.refill) {                                                         // the middle islands + the centre get their lucky blocks back
      G.refill = t + REFILL;
      const n = loadLucky(a, true);
      if (n) toAll((q) => { q.sendMessage(pick(q, "§e§l[Lucky Wars] LUCKY REFILL! §r§f" + n + " new lucky blocks on the middle islands and the centre!", "§e§l[حرب اللوكي بلوك] تعبئة! §r§f" + n + " لوكي بلوك جديدة بالجزر الوسطية والنص!")); sound(q, "random.levelup", { pitch: 0.8 }); });
    }
    if (t >= G.end) {
      let best = null, bk = -1, tie = false;
      for (const id of G.alive) { const k = G.kills[id] ?? 0; if (k > bk) { bk = k; best = id; tie = false; } else if (k === bk) tie = true; }
      for (const id of [...G.alive]) if (id !== best || tie) { G.alive = G.alive.filter((x) => x !== id); G.order.push(id); giveBackOrKeep(id, G.pl[id]); }
      toAll((q) => q.sendMessage(pick(q, "§e[Lucky Wars] Time is over!", "§e[حرب اللوكي بلوك] خلص الوقت!")));
      win(tie ? null : best);
    }
  } catch (e) { console.warn("[luckywars] tick: " + e); }
}, 2);
// the bar + the golden sparkles over the lucky blocks
system.runInterval(() => {
  if (!G || (G.phase !== "run" && G.phase !== "count")) return;
  const left = G.phase === "run" ? Math.max(0, Math.ceil((G.end - system.currentTick) / 20)) : G.minutes * 60;
  toAll((p) => bar(p, "§e§lLUCKY WARS §r§7| §f" + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §c" + pick(p, "Kills", "قتلات") + ": §f" + (G.kills[p.id] ?? 0) + " §7| §e" + pick(p, "Lucky", "لوكي") + ": §f" + (G.opened[p.id] ?? 0) + " §7| §e" + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0")));
  const a = arena(), dim = a && dimOf(a); if (!dim) return;
  const keys = [...G.lucky.keys()];
  for (let i = 0; i < Math.min(18, keys.length); i++) {
    const k = keys[Math.floor(Math.random() * keys.length)], [x, y, z] = k.split(",").map(Number);
    try {
      const b = dim.getBlock({ x, y, z }); if (!b) continue;
      if (b.typeId !== LUCKY_ID) { G.lucky.delete(k); continue; }                 // gone some other way
      dim.spawnParticle("minecraft:villager_happy", { x: x + 0.2 + Math.random() * 0.6, y: y + 1.1, z: z + 0.2 + Math.random() * 0.6 });
    } catch (e) { /* not loaded */ }
  }
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
// the game things never stay with anybody who is not playing (and they can't be sold: they carry the lore)
const isGameItem = (it) => { try { return !!it && it.getLore().some((l) => l === LORE[0]); } catch (e) { return false; } };
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      if (G?.alive.includes(p.id)) continue;
      const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) continue;
      for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (isGameItem(it)) inv.setItem(i, undefined); }
      const eq = p.getComponent("minecraft:equippable");
      for (const sl of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand]) { try { if (isGameItem(eq?.getEquipment(sl))) eq.setEquipment(sl, undefined); } catch (e) { /* ignore */ } }
    } catch (e) { /* one player never stops the others */ }
  }
}, 200);

// ---------------------------------------------------------------- the arena rules
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
// ONE HIT opens a lucky block
safe("lucky hit", () => world.afterEvents.entityHitBlock.subscribe(({ damagingEntity: p, hitBlock: b }) => {
  try {
    if (!G || p?.typeId !== "minecraft:player" || !b) return;
    const k = K(b.x, b.y, b.z); if (!G.lucky.has(k)) return;
    const a = luckyAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
    if (!playing(p)) return;
    openAt(p, a, b, k);
  } catch (e) { console.warn("[luckywars] open: " + e); }
}));
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, a = luckyAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
  const k = K(b.x, b.y, b.z);
  if (G?.lucky.has(k)) { ev.cancel = true; const p = ev.player; if (playing(p)) system.run(() => { try { const bb = b.dimension.getBlock({ x: b.x, y: b.y, z: b.z }); if (bb && G?.lucky.has(k)) openAt(p, a, bb, k); } catch (e) { /* ignore */ } }); return; }
  if (G && (G.pl[ev.player.id] || owner(ev.player))) return;                      // in a game: break anything (the arena is rebuilt after the game)
  if (owner(ev.player) && !G) return;
  ev.cancel = true; deny(ev.player, "§c[Lucky Wars] You can't break the arena now.", "§c[حرب اللوكي بلوك] ما تقدر تكسر الساحة هسه.");
}));
safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    const a = luckyAt(block.dimension.id, block.x, block.y, block.z); if (!a) return;
    if (!G) { if (owner(player)) return; system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } }); return deny(player, "§c[Lucky Wars] You can't build here when no game runs.", "§c[حرب اللوكي بلوك] ما تقدر تبني هنا وماكو لعبة."); }
    if (block.typeId === LUCKY_ID && playing(player)) { G.lucky.set(K(block.x, block.y, block.z), "placed"); return; }      // a lucky block item: a new lucky block
    if (block.typeId === "minecraft:tnt") {
      const at = { x: block.x + 0.5, y: block.y, z: block.z + 0.5 }, dim = block.dimension;
      system.run(() => { try { dim.getBlock(block.location)?.setType("minecraft:air"); const t = dim.spawnEntity("minecraft:tnt", at); t.addTag(LUCKY_TAG); } catch (e) { /* ignore */ } });
    }
  } catch (e) { /* ignore */ }
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const a = arena(); if (!a) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks();
  const keep = all.filter((b) => !luckyAt(d, b.x, b.y, b.z) || (G && G.phase === "run" && b.y - a.cy >= 1 && !G.lucky.has(K(b.x, b.y, b.z))));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function luckyPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => luckyPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: Lucky Wars", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive, " + G.lucky.size + " lucky blocks left)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§e§lLucky Block Wars\n§r§7Golden islands full of lucky blocks:\n§r§7one hit = a surprise (lucky or not!).\n§r§7Last one alive wins.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.n + " islands, " + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/luckywars", "textures/blocks/glazed_terracotta_yellow", null);
  if (!a) {
    for (const [col, n] of [[3, 10], [5, 20]]) set(f, 2 * COLS + col, hdr(n, "g") + "§a§lBuild for " + n + " players\n§r§7Golden islands, 5 lucky blocks each,\n§r§74 middle islands, the centre with\n§r§7the MEGA lucky block (" + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + ")\n§r§7The land is saved\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build Lucky Wars for " + n + "?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7The islands float " + TOP + " blocks over you", "§7Everything in " + (layout(n).HX * 2 + 1) + " x " + (layout(n).HX * 2 + 1) + " blocks is replaced (Undo puts it back)."], () => buildLucky(player, n), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length, max = layout(a.n).n;
    set(f, 1 * COLS + 2, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + max + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 4, hdr(c.minutes) + "§f§lTime limit\n§r§7Now: §e" + c.minutes + " min\n§r§7Then the most kills wins\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.minutes = MINUTES[(MINUTES.indexOf(c.minutes) + 1) % MINUTES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, max) + " players, countdown " + COUNT + " s\n§r§7New islands + every lucky block\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startLucky(player); if (r.err) say(player, "§c[Lucky Wars] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the centre island", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, { x: 4, y: TOP + 2, z: 4 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Lucky Wars arena?", ["§7The land comes back as it was."], () => undoLucky(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n + " §7(" + (G.kills[id] ?? 0) + " ⚔, " + (G.opened[id] ?? 0) + " ?)§f").join(", "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lWatch\n§r§7Teleport over the centre", "textures/items/ender_eye", { run: () => { try { player.teleport(abs(a, { x: 0, y: TOP + 14, z: 0 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody gets his\n§r§7things back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody gets his own things back."], () => stopLucky(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), max = L().n;
  const f = makeOpr("Lucky Wars: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 36, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + max + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/blocks/glazed_terracotta_yellow" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < max) c.roster.push(p.id); else say(player, "§c[Lucky Wars] The game is full (" + max + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody online\n§r§7Adds every online player", "textures/blocks/glazed_terracotta_yellow", { run: () => { for (const p of world.getAllPlayers()) if (!c.roster.includes(p.id) && c.roster.length < max) c.roster.push(p.id); saveCfg(); self(); } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 7, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
luckyHook.page = luckyPage;

// ---------------------------------------------------------------- /luckywars (every player)
export function luckyMenu(player) {
  const f = makeOpr("Lucky Wars", SHORT_ROWS); f.self = () => luckyMenu(player); f.glass = true;
  let top = []; try { top = ranking("luckywars").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§e§lLucky Block Wars\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/blocks/glazed_terracotta_yellow", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, "g") + "§e§lHow to play\n§r§7Hit a yellow LUCKY BLOCK once: it opens.\n§r§7Lucky: weapons, armour, legendary\n§r§7items, pets... Unlucky: mobs, TNT,\n§r§7lightning, traps... The MEGA lucky block\n§r§7is in the centre. Last one alive wins.", "textures/items/book_writable", null);
  const s = stats(player);
  set(f, 3 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.lbw ?? 0) + "\n§r§7Losses: §c" + (s.lbl ?? 0) + "\n§r§7Kills: §f" + (s.lbk ?? 0) + "\n§r§7Lucky blocks opened: §e" + (s.lbo ?? 0), "textures/items/diamond_sword", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:luckywars", description: "Lucky Block Wars: the game and the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { luckyMenu(p); } catch (e) { console.warn("[luckywars] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[luckywars] command: " + e); }
});
export const luckyGiveItem = item;
