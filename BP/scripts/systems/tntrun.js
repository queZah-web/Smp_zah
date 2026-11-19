// ===================================================================================================================
// TNT RUN (event)  -  /opr > Building > TNT Run  or  /opr > Events > TNT Run  (Owner)   and   /tntrun (every player)
//
// The Owner builds the arena (tntdesign.js) once, then runs games:
//   * chooses the players (2 - 16: online players, or everybody in the arena), the block delay (0.25 - 1.5 s, default 0.5 s),
//     the double jumps (0 - 5) and the prize for the winner
//   * Start: the 4 floors are put back as new, the players are sent onto layer 1, 10 s countdown, GO
//   * every block a player stands on (or jumps from) disappears after the delay (the sand / gravel AND the TNT under it,
//     no explosion) with a sound; standing still does not help.  Falling = the next layer, the game goes on.
//     Falling below layer 4 = OUT: announced to everybody, the player goes to the seats and watches.
//   * rules: no PvP (no damage, no knockback), no breaking / placing (Adventure mode), no items / tools - only the
//     Double Jump feather (right-click: a jump forward)
//   * the last player standing wins: announced, the prize, fireworks.  Wins / losses are saved
//     (/tntrun, and the TNT RUN leaderboard hologram in the arena).  After the game the floors are put back.
// No lag: the only work while a game runs = a few blocks under at most 16 players, every tick.
// ===================================================================================================================
import { world, system, ItemStack, ItemLockMode, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, tntHook } from "./spawnbuild.js";
import { TNTR as T, tntGen, floorBlock, MAIN, isFloorId } from "./tntdesign.js";
import { addFixedAt, removeFixed } from "./hologram.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "tr:arena", CFG_KEY = "tr:cfg", MKEY = "tr:m", PEND_KEY = "tr:pend";
const DELAYS = [5, 10, 15, 20, 30], JUMPS = [0, 1, 2, 3, 5], PRIZES = [0, 1000, 2500, 5000, 10000], MAX_PLAYERS = 16, COUNT = 10;
const ITEM_LORE = "§8TNT Run item";
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[tntrun] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[tntrun] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");

// ---------------------------------------------------------------- the arena record
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const tntAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!tntAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const inside = (a, loc) => Math.abs(loc.x - a.cx - 0.5) <= T.R + 1.5 && Math.abs(loc.z - a.cz - 0.5) <= T.R + 1.5 && loc.y - a.cy < T.layers[0] + 6;
let cfg = null;
const conf = () => (cfg ??= { delay: 10, jumps: 3, prize: 2500, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, "smp_tntrun_");
    if (!(yield* waitLoaded(player, dim, a, "[TNT Run] Building:"))) { removeAreas(dim, "smp_tntrun_"); say(player, "§c[TNT Run] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:tntrun_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[tntrun] backup: " + e); }
      bar(player, "§a[TNT Run] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const g = tntGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + (T.HX * 2 + 1) * 2;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[TNT Run] §fBuilding the arena... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -T.HX; x <= T.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz - T.HX }, { x: a.cx + x, y: a.cy + T.UP, z: a.cz + T.HX }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy - T.DOWN, z: a.cz - T.HX }, { x: a.cx + x, y: a.cy - 1, z: a.cz + T.HX }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    try { const b = addFixedAt(dim.id, a.cx + T.board.x + 0.5, a.cy + T.board.y, a.cz + T.board.z + 0.5, "tntrun"); if (b && b !== "full") { a.board = b.id; saveA(); } } catch (e) { console.warn("[tntrun] board: " + e); }
    removeAreas(dim, "smp_tntrun_");
    say(player, "§a[TNT Run] The arena is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aStart a game in §f/opr > Events > TNT Run§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[tntrun] build: " + e); say(player, "§c[TNT Run] Building stopped: " + e); removeAreas(dim, "smp_tntrun_"); }
  finally { busy = false; }
}
export function buildTnt(player) {
  if (!owner(player)) return say(player, "§c[TNT Run] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[TNT Run] The arena is being built right now.");
  if (arena()) return say(player, "§c[TNT Run] The arena already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - T.DOWN < hr.min || cy + T.UP >= hr.max) return say(player, "§c[TNT Run] Too high or too low here. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, x1: cx - T.HX - 1, y1: cy - T.DOWN, z1: cz - T.HX - 1, x2: cx + T.HX + 1, y2: cy + T.UP, z2: cz + T.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[TNT Run] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[TNT Run] Building the arena (63 x 63, 4 layers)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "tntrun", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, "smp_tntrun_");
    if (!(yield* waitLoaded(player, dim, a, "[TNT Run] Undo:"))) { removeAreas(dim, "smp_tntrun_"); say(player, "§c[TNT Run] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[tntrun] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (a.board) { try { removeFixed(a.board); } catch (e) { /* ignore */ } }
    A = null; saveA();
    removeAreas(dim, "smp_tntrun_");
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[TNT Run] Removed: the land is back as it was." : "§e[TNT Run] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoTnt(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[TNT Run] Stop the game first.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}

// ---------------------------------------------------------------- putting the floors back (fill the main block + the TNT, then the pattern)
function* resetJob() {
  const a = arena(); if (!a) return true;
  const dim = dimOf(a); if (!dim) return false;
  const R = T.R, tnt = perm("tnt");
  let ok = true;
  for (let n = 0; n < T.layers.length; n++) {
    const y = a.cy + T.layers[n], main = perm(MAIN[n]);
    try {
      dim.fillBlocks(new BlockVolume({ x: a.cx - R, y: y - 1, z: a.cz - R }, { x: a.cx + R, y: y - 1, z: a.cz + R }), tnt);
      dim.fillBlocks(new BlockVolume({ x: a.cx - R, y, z: a.cz - R }, { x: a.cx + R, y, z: a.cz + R }), main);
    } catch (e) { ok = false; continue; }
    yield;
    let k = 0;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      const id = floorBlock(n, x, z); if (id === MAIN[n]) continue;
      try { dim.getBlock({ x: a.cx + x, y, z: a.cz + z })?.setPermutation(perm(id)); } catch (e) { ok = false; }
      if (++k % 150 === 0) yield;
    }
    yield;
  }
  return ok;
}

// ---------------------------------------------------------------- the game
let G = null;     // { phase: "reset" | "count" | "run" | "end", until, pl: { id: { n, gm, back, out, jumps } }, alive: [ids], order: [], queue: Map, start }
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const gameView = () => (G ? { phase: G.phase, alive: [...G.alive], players: Object.keys(G.pl).length, order: [...G.order] } : null);
const atArena = () => world.getAllPlayers().filter((p) => inArena(p));
const toAll = (fn) => { for (const p of atArena()) { try { fn(p); } catch (e) { /* ignore */ } } };
function feather(n) {
  const it = new ItemStack("minecraft:feather", 1);
  try { it.nameTag = "§b§lDouble Jump §r§7(" + n + ")"; it.setLore([ITEM_LORE, "§7Right-click: jump forward"]); it.keepOnDeath = true; it.lockMode = ItemLockMode.inventory; } catch (e) { /* ignore */ }
  return it;
}
const isItem = (it) => { try { return !!it && it.getLore().includes(ITEM_LORE); } catch (e) { return false; } };
function clearItems(p) {
  const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return;
  for (let i = 0; i < inv.size; i++) { try { if (isItem(inv.getItem(i))) inv.setItem(i, undefined); } catch (e) { /* ignore */ } }
}
function restorePlayer(p, rec) {
  clearItems(p);
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  try { p.removeEffect("resistance"); p.removeEffect("weakness"); } catch (e) { /* ignore */ }
}
const pend = () => readJson(PEND_KEY, {});
function restoreOrKeep(id, rec) {
  const p = online(id); if (p) { try { restorePlayer(p, rec); } catch (e) { /* ignore */ } return; }
  const all = pend(); all[id] = rec; writeJson(PEND_KEY, all);
}
safe("join", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  const all = pend(), rec = all[player.id]; if (!rec || G?.pl[player.id]) return;
  delete all[player.id]; writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  system.runTimeout(() => { try { restorePlayer(player, rec); } catch (e) { /* ignore */ } }, 20);
}));
system.runTimeout(() => { const old = readJson(MKEY, null); if (!old?.pl) return; writeJson(MKEY, null); for (const [id, rec] of Object.entries(old.pl)) restoreOrKeep(id, rec); }, 60);

const spot = (i, n) => { const ang = (i / Math.max(1, n)) * Math.PI * 2, r = n <= 1 ? 0 : 12; return { x: Math.round(Math.cos(ang) * r), y: T.layers[0] + 1, z: Math.round(Math.sin(ang) * r) }; };
const seat = (i) => ({ x: ((i % 13) - 6) * 2, y: T.view.y, z: T.view.z });

export function startGame(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  const c = conf(), ids = c.roster.filter((id) => online(id)).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "reset", until: 0, pl: {}, alive: [...ids], order: [], queue: new Map(), delay: c.delay, prize: c.prize, start: 0, by: player.name };
  for (const id of ids) { const p = online(id), l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; } G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, out: 0, jumps: c.jumps, jt: 0 }; }
  saveG();
  ids.forEach((id, i) => { const p = online(id); try { p.teleport(abs(a, seat(i)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 30, z: 0 }) }); } catch (e) { /* ignore */ } });
  const names = ids.map((id) => G.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§c§l[TNT Run] §r§fA game starts! §7Players: §f" + names + " §e/tntrun", "§c§l[TNT Run] §r§fبدت لعبة! §7اللاعبين: §f" + names + " §e/tntrun");
  try { slog(player, "tntrun", null, "game started: " + ids.length + " players"); } catch (e) { /* ignore */ }
  system.runJob((function* () {
    yield* resetJob();
    if (!G || G.phase !== "reset") return;
    G.alive = G.alive.filter((id) => online(id));
    G.alive.forEach((id, i) => {
      const p = online(id), rec = G.pl[id];
      try { p.teleport(abs(a, spot(i, G.alive.length)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: T.layers[0] + 1, z: 0 }) }); } catch (e) { /* ignore */ }
      try { p.setGameMode(GameMode.Adventure); } catch (e) { /* ignore */ }
      if (rec.jumps > 0) { try { p.getComponent("minecraft:inventory")?.container?.addItem(feather(rec.jumps)); } catch (e) { /* ignore */ } }
      tell(p, "§c[TNT Run] §fRun! §7Every block you step on falls after " + G.delay / 20 + " s. Fall below layer 4 = out. Last one standing wins!" + (rec.jumps ? " §bFeather = double jump (" + rec.jumps + ")." : ""),
        "§c[TNT Run] §fاركض! §7كل بلوك تمشي عليه يختفي بعد " + G.delay / 20 + " ثانية. إذا طحت تحت الطبقة 4 تطلع. آخر واحد يبقى يفوز!" + (rec.jumps ? " §bالريشة = قفزة مزدوجة (" + rec.jumps + ")." : ""));
    });
    G.phase = "count"; G.until = system.currentTick + COUNT * 20;
  })());
  return { ok: true };
}
function out(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const rec = G.pl[id], a = arena(), p = online(id), left = G.alive.length;
  rec.out = system.currentTick;
  if (p) {
    clearItems(p);
    try { p.teleport(abs(a, seat(G.order.length)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 30, z: 0 }) }); } catch (e) { /* ignore */ }
    try { p.onScreenDisplay.setTitle("§c§l" + pick(p, "ELIMINATED", "خسرت"), { subtitle: "§7" + pick(p, "Place #" + (left + 1) + " - watch from the seats", "المركز #" + (left + 1) + " - تابع من المقاعد"), fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    try { p.playSound("mob.wither.hurt", { volume: 0.5, pitch: 1.2 }); } catch (e) { /* ignore */ }
  }
  if (p) { try { const s = stats(p); s.tl = (s.tl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } }
  for (const q of world.getAllPlayers()) {
    if (!inArena(q) && !G.pl[q.id]) continue;
    tell(q, "§c☠ §f" + rec.n + " §7" + (why === "left" ? "left the game" : "fell out") + "! §e" + left + " §7left", "§c☠ §f" + rec.n + " §7" + (why === "left" ? "طلع من اللعبة" : "طاح وطلع") + "! §eباقي " + left);
  }
  if (G.alive.length <= 1 && G.phase !== "end") win();
}
function win() {
  const a = arena(), wid = G.alive[0], rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 120;
  if (rec) {
    try { if (wp) { const s = stats(wp); s.tw = (s.tw ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } } catch (e) { /* ignore */ }
  }
  const order = [...G.order].reverse(), second = order[0] ? G.pl[order[0]].n : null, third = order[1] ? G.pl[order[1]].n : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§c§l[TNT Run] §r" + (rec ? "§6§l" + rec.n + " §r§awins!" + (G.prize ? " §7(prize: §a" + money(G.prize) + "§7)" : "") : "§7Nobody wins.") + (second ? " §72nd: §f" + second : "") + (third ? " §73rd: §f" + third : ""),
      "§c§l[TNT Run] §r" + (rec ? "§6§l" + rec.n + " §r§aفاز!" + (G.prize ? " §7(الجائزة: §a" + money(G.prize) + "§7)" : "") : "§7محد فاز.") + (second ? " §7الثاني: §f" + second : "") + (third ? " §7الثالث: §f" + third : ""));
    if (inArena(q)) { try { q.onScreenDisplay.setTitle("§6§l" + (rec ? rec.n : "-"), { subtitle: "§a" + pick(q, "WINS TNT RUN!", "فاز بـ TNT Run!"), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = wp ? wp.location : abs(a, { x: 0, y: T.layers[0] + 2, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
}
export function stopGame(reason = "stopped") {
  if (!G) return;
  const g = G; G = null; saveG();
  for (const [id, rec] of Object.entries(g.pl)) restoreOrKeep(id, rec);
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§c[TNT Run] §7The game was stopped.", "§c[TNT Run] §7انوقفت اللعبة.");
  system.runJob((function* () { yield* resetJob(); })());
}

// ---------------------------------------------------------------- the blocks under the players
const LAYER_Y = new Set(T.layers);
function mark(a, dim, x, y, z, due) {
  const ry = y - a.cy; if (!LAYER_Y.has(ry)) return;
  if (Math.abs(x - a.cx) > T.R || Math.abs(z - a.cz) > T.R) return;
  const k = x + "|" + y + "|" + z; if (G.queue.has(k)) return;
  let b; try { b = dim.getBlock({ x, y, z }); } catch (e) { return; }
  if (!b || !isFloorId(b.typeId)) return;
  G.queue.set(k, due);
}
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopGame(); return; }
  try {
    const t = system.currentTick, dim = dimOf(a);
    if (G.phase === "count") {
      if (t >= G.until) { G.phase = "run"; G.start = t; toAll((p) => { p.onScreenDisplay.setTitle("§a§l" + pick(p, "GO!", "اركض!"), { fadeInDuration: 2, stayDuration: 20, fadeOutDuration: 6 }); p.playSound("note.pling", { pitch: 1.6 }); }); }
      else if ((G.until - t) % 20 === 0) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + Math.ceil((G.until - t) / 20), { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
    }
    if (G.phase === "end") { if (t >= G.until) stopGame("end"); return; }
    if (G.phase !== "run" && G.phase !== "count") return;
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { out(id, "left"); continue; }
      const l = p.location;
      if (p.dimension.id !== a.d || !inside(a, l)) { out(id, "left"); continue; }
      if (l.y - a.cy < T.elimY) { out(id, "fell"); continue; }
      if (G.phase !== "run") continue;
      const due = t + G.delay;
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        const bx = Math.floor(l.x + dx), bz = Math.floor(l.z + dz);
        mark(a, dim, bx, Math.floor(l.y - 0.2), bz, due);
        mark(a, dim, bx, Math.floor(l.y - 1.2), bz, due);
      }
    }
    if (!G || G.phase !== "run") return;
    let snd = 0;
    for (const [k, due] of G.queue) {
      if (due > t) continue;
      G.queue.delete(k);
      const [x, y, z] = k.split("|").map(Number);
      try {
        const b = dim.getBlock({ x, y, z }); if (b && isFloorId(b.typeId)) b.setType("minecraft:air");
        const u = dim.getBlock({ x, y: y - 1, z }); if (u && u.typeId === "minecraft:tnt") u.setType("minecraft:air");
        if (snd++ < 3) dim.playSound("dig.sand", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { volume: 0.6, pitch: 1.3 });
      } catch (e) { /* not loaded */ }
    }
  } catch (e) { console.warn("[tntrun] tick: " + e); }
}, 1);
// no damage, no knockback, the bar
system.runInterval(() => {
  if (!G) return;
  const t = system.currentTick;
  for (const [id] of Object.entries(G.pl)) {
    const p = online(id); if (!p) continue;
    try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("weakness", 30, { amplifier: 255, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
  }
  const secs = G.phase === "run" ? Math.floor((t - G.start) / 20) : 0;
  toAll((p) => {
    const me = G.pl[p.id];
    bar(p, "§c§lTNT RUN §r§7| §f" + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §e" + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") + (me && G.alive.includes(p.id) && me.jumps >= 0 ? " §7| §b" + pick(p, "Double jumps", "قفزات") + ": " + me.jumps : ""));
  });
}, 10);
// the double jump feather, and nothing else may be used
safe("use", () => world.beforeEvents.itemUse.subscribe((ev) => {
  const p = ev.source; if (!G || !p || !G.pl[p.id]) return;
  if (!G.alive.includes(p.id) || G.phase === "end") { if (isItem(ev.itemStack)) ev.cancel = true; return; }
  ev.cancel = true;
  if (ev.itemStack?.typeId !== "minecraft:feather" || !isItem(ev.itemStack)) return;
  const rec = G.pl[p.id], t = system.currentTick;
  if (G.phase !== "run" || rec.jumps <= 0 || t - rec.jt < 15) return;
  rec.jumps--; rec.jt = t;
  system.run(() => {
    try {
      const v = p.getViewDirection(), h = Math.hypot(v.x, v.z) || 1;
      p.applyKnockback({ x: (v.x / h) * 0.9, z: (v.z / h) * 0.9 }, 0.75);
    } catch (e) { try { p.applyKnockback(0, 0, 0, 0.75); } catch (x) { /* ignore */ } }
    try { p.playSound("mob.bat.takeoff", { volume: 0.7 }); p.dimension.spawnParticle("minecraft:basic_smoke_particle", p.location); } catch (e) { /* ignore */ }
    try {
      const inv = p.getComponent("minecraft:inventory")?.container;
      for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (isItem(it)) { inv.setItem(i, rec.jumps > 0 ? feather(rec.jumps) : undefined); break; } }
    } catch (e) { /* ignore */ }
  });
}));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id]) return;
  const all = pend(); all[player.id] = G.pl[player.id];
  system.run(() => writeJson(PEND_KEY, all));
}));
safe("drop", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  try { if (G && entity.typeId === "minecraft:item" && isItem(entity.getComponent("minecraft:item")?.itemStack)) entity.remove(); } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- protection (only the Owner changes the arena)
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const DANGER = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper|flint_and_steel|fire_charge|tnt|end_crystal|respawn_anchor|piston|sticky_piston)$/;
const near = (d, x, z, m) => { const a = arena(); return !!a && a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!tntAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  ev.cancel = true; deny(ev.player, "§c[TNT Run] You can't break the arena.", "§c[TNT Run] ما تقدر تكسر الساحة.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && DANGER.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[TNT Run] You can't use this item here.", "§c[TNT Run] ما تقدر تستخدم هذا الغرض هنا."); }
  if (!tntAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item) deny(p, "§c[TNT Run] Building is not allowed here.", "§c[TNT Run] البناء ممنوع هنا.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!arena()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !tntAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function tntPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => tntPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: TNT Run", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§c§lTNT Run\n§r§7The blocks fall after you walk on them.\n§r§74 layers, the last one standing wins.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/tntrun", "textures/blocks/tnt_side", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the arena here\n§r§74 layers (sand, sand, gravel, sand)\n§r§7with TNT under them, seats around\n§r§7(63 x 63). The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the TNT Run arena here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 63 x 63 blocks around you", "§7is replaced (Undo puts it back)."], () => buildTnt(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 1, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 3, hdr(1) + "§f§lBlock delay\n§r§7The block falls after: §e" + c.delay / 20 + " s\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.delay = DELAYS[(DELAYS.indexOf(c.delay) + 1) % DELAYS.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 5, hdr(Math.max(1, c.jumps), c.jumps ? "g" : "r") + "§f§lDouble jump\n§r§7Feathers per player: §e" + (c.jumps || "OFF") + "\n§r§eClick to change", "textures/items/feather", { run: () => { c.jumps = JUMPS[(JUMPS.indexOf(c.jumps) + 1) % JUMPS.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 7, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, countdown " + COUNT + " s\n§r§7The floors are put back first\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startGame(player); if (r.err) say(player, "§c[TNT Run] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the seats", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, T.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 30, z: 0 }) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the TNT Run arena?", ["§7The land comes back as it was."], () => undoTnt(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; the floors are put back."], () => stopGame(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), a = arena();
  const f = makeOpr("TNT Run: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/blocks/tnt_side" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[TNT Run] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody in the arena\n§r§7Adds the players who are at the arena", "textures/blocks/tnt_side", { run: () => {
    if (a) for (const p of world.getAllPlayers()) if (inArena(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
tntHook.page = tntPage;

// ---------------------------------------------------------------- /tntrun (every player)
export function tntMenu(player) {
  const f = makeOpr("TNT Run", SHORT_ROWS); f.self = () => tntMenu(player); f.glass = true;
  const a = arena();
  let top = [];
  try { top = ranking("tntrun").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§c§lTNT Run\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/blocks/tnt_side", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lGo to the arena\n§r§7" + (a ? "The seats (watch the game)" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, "tntrun")) return;
    teleportWithFx(player, abs(a, T.view), a.d, "tntrun", () => tell(player, "§a[TNT Run] Welcome!", "§a[TNT Run] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.tw ?? 0) + "\n§r§7Losses: §c" + (s.tl ?? 0), "textures/blocks/tnt_side", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:tntrun", description: "TNT Run: the game, the arena, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { tntMenu(p); } catch (e) { console.warn("[tntrun] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[tntrun] command: " + e); }
});
