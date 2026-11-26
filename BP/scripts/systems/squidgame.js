// ===================================================================================================================
// RED LIGHT, GREEN LIGHT (event)  -  /opr > Building > Red Light  or  /opr > Events > Red Light  (Owner)   and   /redlight
//
// The Owner builds the arena (squiddesign.js) once, then runs games:
//   * chooses the players (2 - 30), the walking speed (normal / slow / slower / very slow), the time limit (3 - 15 min),
//     how many winners (1 / 3 / 5 / everybody who finishes) and the prize
//   * Start: everybody goes behind the START line, 10 s countdown, then GREEN LIGHT / RED LIGHT at random times:
//         stage (by the distance of the best runner)   green          red
//         1  (0 - 25 %)                              8 - 12 s       3 - 5 s
//         2  (25 - 50 %)                             5 - 9 s        4 - 7 s
//         3  (50 - 75 %)                             4 - 7 s        5 - 8 s
//         4  (75 - 100 %)                            3 - 6 s        6 - 10 s
//     a short warning sound comes a RANDOM moment before red (the exact time is never shown)
//   * the giant doll (smp:sg_doll) turns to the players at RED (red eyes) and away at GREEN; the 2 big lights on the gate change
//   * RED LIGHT: the movement of every player is watched the WHOLE time (not one position check):
//       - 0.35 s grace when red starts (reaction + network delay)
//       - then the place of the player is saved; a player still in the air from a jump may land (falling is not moving)
//       - moving more than 0.25 block on the ground (or jumping up) for 2 checks in a row, or more than 0.9 block at once = OUT
//         (one wrong position from the network that is corrected at once does not count)
//     OUT: "PLAYER ELIMINATED" message + effects, the player goes to the spectator balcony
//   * the first player(s) over the FINISH line (alive, in the game, not flying) win: prize + stats + announce
//   * time over: whoever has not finished is out.  After the game everybody goes back (place, game mode).
// No lag: a few lines per player per tick, only while a game runs; the lights are a few blocks.
// ===================================================================================================================
import { world, system, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, squidHook } from "./spawnbuild.js";
import { SQ, squidGen, lightCells, LIGHT } from "./squiddesign.js";
import { addFixedAt, removeFixed } from "./hologram.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "sq:arena", CFG_KEY = "sq:cfg", MKEY = "sq:m", PEND_KEY = "sq:pend", DOLL = "smp:sg_doll";
const SPEEDS = ["Normal", "Slow", "Slower", "Very slow"], SPEEDS_AR = ["عادي", "بطيء", "أبطأ", "بطيء جداً"];
const TIMES = [3, 5, 8, 10, 15], WINNERS = [1, 3, 5, 0], PRIZES = [0, 1000, 2500, 5000, 10000], MAX_PLAYERS = 30, COUNT = 10;
const STAGES = [[8, 12, 3, 5], [5, 9, 4, 7], [4, 7, 5, 8], [3, 6, 6, 10]];          // green min, max, red min, max (seconds)
const GRACE = 7, TOL = 0.25, JUMP_UP = 0.45, BIG = 0.9, STRIKES = 2;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[redlight] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const alive = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (x) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[redlight] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// ---------------------------------------------------------------- the arena record
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const squidAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!squidAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const onField = (a, loc) => Math.abs(loc.x - a.cx - 0.5) <= SQ.FX + 0.5 && Math.abs(loc.z - a.cz - 0.5) <= 70.5 && loc.y - a.cy < 13;
const relZ = (a, loc) => loc.z - a.cz - 0.5;
const progress = (a, loc) => Math.max(0, Math.min(1, (SQ.startZ - relZ(a, loc)) / (SQ.startZ - SQ.finishZ)));
let cfg = null;
const conf = () => (cfg ??= { speed: 2, min: 8, win: 1, prize: 2500, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());

// ---------------------------------------------------------------- the doll + the lights
function findDoll(a) { try { return dimOf(a).getEntities({ type: DOLL, location: abs(a, SQ.doll), maxDistance: 6 })[0] ?? null; } catch (e) { return null; } }
function doll(a) {
  let d = findDoll(a);
  if (!alive(d)) { try { d = dimOf(a).spawnEntity(DOLL, abs(a, SQ.doll)); } catch (e) { console.warn("[redlight] doll: " + e); return null; } }
  try { d.teleport(abs(a, SQ.doll), { rotation: { x: 0, y: 0 } }); } catch (e) { /* ignore */ }
  return d;
}
function setLight(a, color) {
  const dim = dimOf(a); if (!dim) return;
  for (const c of ["red", "green"]) {
    const p = perm(c === color ? LIGHT[c] : LIGHT.off);
    for (const b of lightCells(c)) { try { dim.getBlock({ x: a.cx + b.x, y: a.cy + b.y, z: a.cz + b.z })?.setPermutation(p); } catch (e) { /* not loaded */ } }
  }
  const d = G?.doll ?? findDoll(a);
  try { if (alive(d)) d.setProperty("smp:face", color === "red"); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, "smp_squid_");
    if (!(yield* waitLoaded(player, dim, a, "[Red Light] Building:"))) { removeAreas(dim, "smp_squid_"); say(player, "§c[Red Light] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:squid_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[redlight] backup: " + e); }
      bar(player, "§a[Red Light] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const g = squidGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + (SQ.HX * 2 + 1) * 2;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[Red Light] §fBuilding the arena... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -SQ.HX; x <= SQ.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz - SQ.HZ }, { x: a.cx + x, y: a.cy + SQ.UP, z: a.cz + SQ.HZ }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy - SQ.DOWN, z: a.cz - SQ.HZ }, { x: a.cx + x, y: a.cy - 1, z: a.cz + SQ.HZ }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    doll(a);
    try { const b = addFixedAt(dim.id, a.cx + SQ.board.x + 0.5, a.cy + SQ.board.y, a.cz + SQ.board.z + 0.5, "squid"); if (b && b !== "full") { a.board = b.id; saveA(); } } catch (e) { console.warn("[redlight] board: " + e); }
    removeAreas(dim, "smp_squid_");
    say(player, "§a[Red Light] The arena is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aStart a game in §f/opr > Events > Red Light§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[redlight] build: " + e); say(player, "§c[Red Light] Building stopped: " + e); removeAreas(dim, "smp_squid_"); }
  finally { busy = false; }
}
export function buildSquid(player) {
  if (!owner(player)) return say(player, "§c[Red Light] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[Red Light] The arena is being built right now.");
  if (arena()) return say(player, "§c[Red Light] The arena already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - SQ.DOWN < hr.min || cy + SQ.UP >= hr.max) return say(player, "§c[Red Light] Too high or too low here. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, x1: cx - SQ.HX - 1, y1: cy - SQ.DOWN, z1: cz - SQ.HZ - 1, x2: cx + SQ.HX + 1, y2: cy + SQ.UP, z2: cz + SQ.HZ + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Red Light] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Red Light] Building the arena (69 x 145)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "redlight", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, "smp_squid_");
    if (!(yield* waitLoaded(player, dim, a, "[Red Light] Undo:"))) { removeAreas(dim, "smp_squid_"); say(player, "§c[Red Light] The area could not be loaded. Go there and try again."); return; }
    try { for (const e of dim.getEntities({ type: DOLL })) if (squidAt(dim.id, Math.floor(e.location.x), Math.floor(e.location.y), Math.floor(e.location.z))) e.remove(); } catch (e) { /* ignore */ }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[redlight] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (a.board) { try { removeFixed(a.board); } catch (e) { /* ignore */ } }
    A = null; saveA();
    removeAreas(dim, "smp_squid_");
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Red Light] Removed: the land is back as it was." : "§e[Red Light] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoSquid(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Red Light] Stop the game first.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}

// ---------------------------------------------------------------- the game
let G = null;
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const squidView = () => (G ? { phase: G.phase, light: G.light, alive: [...G.alive], finished: [...G.finished], out: [...G.out] } : null);
const atArena = () => world.getAllPlayers().filter((p) => inArena(p));
/** a short coloured flash over the whole screen (green / red), so nobody can miss the light */
function flash(p, r, g, b) { try { p.camera.fade({ fadeColor: { red: r, green: g, blue: b }, fadeTime: { fadeInTime: 0.1, holdTime: 0.25, fadeOutTime: 0.5 } }); } catch (e) { /* not in this version */ } }
const toAll = (fn) => { for (const p of atArena()) { try { fn(p); } catch (e) { /* ignore */ } } };
const running = () => G.alive.filter((id) => !G.finished.includes(id));

function restorePlayer(p, rec) {
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  for (const fx of ["resistance", "weakness", "slowness"]) { try { p.removeEffect(fx); } catch (e) { /* ignore */ } }
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

const startSpot = (i, n) => { const cols = Math.min(12, Math.max(1, n)), row = Math.floor(i / cols), c = i % cols; return { x: Math.round((c - (cols - 1) / 2) * 4), y: 1, z: SQ.startArea.z1 + 1 + row * 3 }; };
const balcony = (i) => ({ x: (i % 2 ? 1 : -1) * 31, y: SQ.view.y, z: ((Math.floor(i / 2) % 15) - 7) * 4 });
const face = (a) => abs(a, { x: 0, y: 2, z: SQ.finishZ });

export function startSquid(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  const c = conf(), ids = c.roster.filter((id) => online(id)).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  const t = system.currentTick;
  G = { phase: "count", light: null, until: t + COUNT * 20, pl: {}, alive: [...ids], finished: [], out: [], endAt: 0, win: c.win, prize: c.prize, speed: c.speed, warnAt: 0, checkFrom: 0, doll: doll(a), lead: 0 };
  ids.forEach((id, i) => {
    const p = online(id), l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
    G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id } };
    try { p.teleport(abs(a, startSpot(i, ids.length)), { dimension: dimOf(a), facingLocation: face(a) }); } catch (e) { /* ignore */ }
    try { p.setGameMode(GameMode.Adventure); } catch (e) { /* ignore */ }
    tell(p, "§d[Red Light] §a§lGREEN LIGHT§r§f = run to the FINISH line. §c§lRED LIGHT§r§f = freeze! §7Any movement while the doll looks at you = OUT. Looking around is fine.",
      "§d[الضوء الأحمر] §a§lالأخضر§r§f = اركض لخط النهاية. §c§lالأحمر§r§f = وقّف! §7أي حركة والدمية تباوعك = تطلع. تلفت براسك عادي.");
  });
  saveG();
  setLight(a, "red");
  const names = ids.map((id) => G.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§d§l[Red Light, Green Light] §r§fA game starts! §7" + ids.length + " players: §f" + names + " §e/redlight", "§d§l[الضوء الأحمر، الضوء الأخضر] §r§fبدت لعبة! §7" + ids.length + " لاعب: §f" + names + " §e/redlight");
  try { slog(player, "redlight", null, "game started: " + ids.length + " players"); } catch (e) { /* ignore */ }
  return { ok: true };
}
function stageOf() { return G.lead < 0.25 ? 0 : G.lead < 0.5 ? 1 : G.lead < 0.75 ? 2 : 3; }
function green(a) {
  const st = STAGES[stageOf()], t = system.currentTick, len = Math.round(rnd(st[0], st[1]) * 20);
  G.phase = "play"; G.light = "green"; G.until = t + len; G.warnAt = G.until - Math.min(len - 20, Math.round(rnd(30, 50)));   // the "!!!" warning: 1.5 - 2.5 s before red
  setLight(a, "green");
  toAll((p) => { p.onScreenDisplay.setTitle("§a§l■ " + pick(p, "GREEN LIGHT", "الضوء الأخضر") + " ■", { subtitle: "§a§l" + pick(p, "RUN! MOVE!", "اركض! تحرك!"), fadeInDuration: 2, stayDuration: 45, fadeOutDuration: 8 }); flash(p, 0, 0.85, 0.15); });
  // the melody: played to EVERY player (not only near the doll)
  [0, 5, 10, 15, 22, 27, 32].forEach((d, i) => system.runTimeout(() => { if (G?.light === "green") toAll((p) => { try { p.playSound("note.harp", { volume: 1, pitch: [1, 1.2, 1.33, 1.2, 1, 1.33, 1.5][i] }); } catch (e) { /* ignore */ } }); }, d));
}
function red(a) {
  const st = STAGES[stageOf()], t = system.currentTick;
  G.light = "red"; G.until = t + Math.round(rnd(st[2], st[3]) * 20); G.checkFrom = t + GRACE;
  for (const id of G.alive) { const r = G.pl[id]; r.base = null; r.strike = 0; r.landed = false; }
  setLight(a, "red");
  const stay = Math.max(20, G.until - t);                                         // RED stays on the screen the whole red time
  toAll((p) => { p.onScreenDisplay.setTitle("§4§l■ " + pick(p, "RED LIGHT", "الضوء الأحمر") + " ■", { subtitle: "§c§l" + pick(p, "STOP! DON'T MOVE!", "وقف! لا تتحرك!"), fadeInDuration: 0, stayDuration: stay, fadeOutDuration: 4 }); flash(p, 0.9, 0, 0); });
  toAll((p) => { try { p.playSound("mob.elderguardian.curse", { volume: 0.9, pitch: 1.6 }); } catch (e) { /* ignore */ } });   // every player hears it
}
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.out.push(id);
  const a = arena(), rec = G.pl[id], p = online(id), left = running().length;
  if (p) {
    try { const at = p.location; p.dimension.spawnParticle("minecraft:huge_explosion_emitter", { x: at.x, y: at.y + 1, z: at.z }); p.dimension.playSound("firework.blast", at, { volume: 3 }); p.dimension.playSound("random.explode", at, { volume: 0.6, pitch: 1.8 }); } catch (e) { /* ignore */ }
    try { p.onScreenDisplay.setTitle("§4§l" + pick(p, "ELIMINATED", "انقصيت"), { subtitle: "§7" + (why === "time" ? pick(p, "Time is over", "خلص الوقت") : why === "left" ? "" : pick(p, "You moved during RED LIGHT", "تحركت بالضوء الأحمر")), fadeInDuration: 2, stayDuration: 50, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    system.runTimeout(() => { try { p.teleport(abs(a, balcony(G ? G.out.length : 0)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 1, z: 0 }) }); } catch (e) { /* ignore */ } }, 10);
    try { const s = stats(p); s.sl = (s.sl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ }
  }
  const reason = (q) => (why === "time" ? pick(q, "Eliminated: the time is over!", "انقصى: خلص الوقت!") : why === "left" ? pick(q, "Left the game.", "طلع من اللعبة.") : pick(q, "Eliminated for moving during RED LIGHT!", "انقصى لأنه تحرك أثناء الضوء الأحمر!"));
  for (const q of world.getAllPlayers()) {
    if (!inArena(q) && !G.pl[q.id]) continue;
    try { q.sendMessage("§4§l" + pick(q, "PLAYER ELIMINATED", "لاعب انقصى") + "\n§r§c☠ §f" + rec.n + "\n§7" + reason(q) + "\n§e" + pick(q, "PLAYERS REMAINING: ", "اللاعبين الباقين: ") + left); } catch (e) { /* ignore */ }
  }
  checkEnd();
}
function finish(id) {
  if (!G || !G.alive.includes(id) || G.finished.includes(id)) return;
  G.finished.push(id);
  const rec = G.pl[id], p = online(id), place = G.finished.length;
  if (p) {
    try { p.onScreenDisplay.setTitle("§a§l" + pick(p, "YOU MADE IT!", "وصلت!"), { subtitle: "§f#" + place, fadeInDuration: 3, stayDuration: 50, fadeOutDuration: 10 }); p.playSound("random.levelup"); } catch (e) { /* ignore */ }
    const isWinner = !G.win || place <= G.win;
    try { if (isWinner) { const s = stats(p); s.sw = (s.sw ?? 0) + 1; if (G.prize > 0) addMoney(p, G.prize); else touch(p); } } catch (e) { /* ignore */ }
  }
  for (const q of world.getAllPlayers()) if (inArena(q) || G.pl[q.id]) tell(q, "§a§l✔ §r§f" + rec.n + " §7crossed the FINISH line §e#" + place + (G.prize && (!G.win || place <= G.win) ? " §7(+" + money(G.prize) + ")" : ""), "§a§l✔ §r§f" + rec.n + " §7عبر خط النهاية §e#" + place + (G.prize && (!G.win || place <= G.win) ? " §7(+" + money(G.prize) + ")" : ""));
  checkEnd();
}
function checkEnd() {
  if (!G || G.phase === "end") return;
  if ((G.win && G.finished.length >= G.win) || running().length === 0) endGame();
}
function endGame() {
  if (!G) return;
  const a = arena();
  for (const id of running()) eliminateSilently(id);
  G.phase = "end"; G.until = system.currentTick + 140;
  setLight(a, "red");
  const win = G.finished.slice(0, G.win || G.finished.length).map((id) => G.pl[id].n);
  for (const q of world.getAllPlayers()) {
    tell(q, "§d§l[Red Light, Green Light] §r" + (win.length ? "§6" + pick(q, "Winner", "") + (win.length > 1 ? "s" : "") + ": §f§l" + win.join(", ") : "§7Nobody made it.") + (G.prize && win.length ? " §7(" + money(G.prize) + " each)" : ""),
      "§d§l[الضوء الأحمر، الضوء الأخضر] §r" + (win.length ? "§6الفائز: §f§l" + win.join(", ") : "§7محد وصل.") + (G.prize && win.length ? " §7(" + money(G.prize) + " لكل واحد)" : ""));
    if (inArena(q)) { try { q.onScreenDisplay.setTitle(win.length ? "§6§l" + win[0] : "§c§l" + pick(q, "NO WINNER", "ماكو فائز"), { subtitle: win.length ? "§a" + pick(q, "WINS RED LIGHT, GREEN LIGHT!", "فاز باللعبة!") : "", fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = abs(a, { x: 0, y: 4, z: SQ.finishZ - 3 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => { for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 16, y: at.y + Math.random() * 8, z: at.z + (Math.random() - 0.5) * 4 }); } catch (e) { /* ignore */ } } try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ } }, i * 8);
}
function eliminateSilently(id) {   // time over / the winners are found: the rest is out
  if (!G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.out.push(id);
  const p = online(id);
  if (p) {
    try { p.onScreenDisplay.setTitle("§4§l" + pick(p, "ELIMINATED", "انقصيت"), { subtitle: "§7" + pick(p, "The game is over", "انتهت اللعبة"), fadeInDuration: 2, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    try { const s = stats(p); s.sl = (s.sl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ }
  }
}
export function stopSquid(reason = "stopped") {
  if (!G) return;
  const g = G, a = arena(); G = null; saveG();
  for (const [id, rec] of Object.entries(g.pl)) restoreOrKeep(id, rec);
  if (a) setLight(a, "off");
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§d[Red Light] §7The game was stopped.", "§d[الضوء الأحمر] §7انوقفت اللعبة.");
}

// the 1-tick loop: lights + the movement check
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopSquid(); return; }
  try {
    const t = system.currentTick;
    if (G.phase === "end") { if (t >= G.until) stopSquid("end"); return; }
    if (G.phase === "count") {
      if ((G.until - t) % 20 === 0 && t < G.until) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + Math.ceil((G.until - t) / 20), { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
      for (const id of G.alive) { const p = online(id); if (!p) continue; if (relZ(a, p.location) < SQ.startZ + 2) { try { p.teleport({ x: p.location.x, y: a.cy + 1, z: a.cz + 0.5 + SQ.startZ + 3 }, { facingLocation: face(a) }); } catch (e) { /* ignore */ } bar(p, pick(p, "§cWait behind the START line!", "§cانتظر ورا خط البداية!")); } }
      if (t >= G.until) { G.endAt = t + conf().min * 1200; green(a); }
      return;
    }
    if (t >= G.endAt) { for (const id of running()) eliminate(id, "time"); if (G) checkEnd(); return; }
    if (G.light === "green") {
      if (t >= G.warnAt && t < G.until && (t - G.warnAt) % 10 === 0) {          // the warning: big "! ! !" on the screen until red + a beat every 0.5 s
        const first = t === G.warnAt;
        toAll((p) => { try { if (first) p.onScreenDisplay.setTitle("§6§l! ! !", { subtitle: "§e§l" + pick(p, "RED LIGHT IS COMING!", "الضوء الأحمر جاي!"), fadeInDuration: 0, stayDuration: G.until - t, fadeOutDuration: 0 }); p.playSound("note.bass", { pitch: 0.6, volume: 1 }); bar(p, "§6§l! ! !  " + pick(p, "GET READY TO STOP", "استعد توقف") + "  ! ! !"); } catch (e) { /* ignore */ } });
      }
      if (t >= G.until) red(a);
    } else if (G.light === "red" && t >= G.until) green(a);
    // every player: finish line, field, movement during red
    let lead = 0;
    for (const id of [...running()]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      const l = p.location;
      if (p.dimension.id !== a.d || !onField(a, l)) { eliminate(id, "left"); continue; }
      lead = Math.max(lead, progress(a, l));
      if (G.light === "red" && t >= G.checkFrom) {
        const r = G.pl[id];
        let ground = true; try { ground = p.isOnGround; } catch (e) { ground = true; }
        let flying = false; try { flying = p.isFlying; } catch (e) { flying = false; }
        if (!r.base || (!r.landed && !ground)) { r.base = { x: l.x, y: l.y, z: l.z }; if (ground) r.landed = true; continue; }   // still landing from a jump: that is allowed
        if (!r.landed && ground) { r.landed = true; r.base = { x: l.x, y: l.y, z: l.z }; continue; }
        const d = Math.hypot(l.x - r.base.x, l.z - r.base.z), up = l.y - r.base.y;
        if (up < -0.05) r.base.y = l.y;                                                     // falling down is not moving
        const bad = d > TOL || up > JUMP_UP || flying;
        if (d > BIG || (bad && ++r.strike >= STRIKES)) { eliminate(id, "move"); continue; }
        if (!bad) r.strike = 0;
      }
      if (relZ(a, l) < SQ.finishZ - 0.5) {
        let flying = false; try { flying = p.isFlying; } catch (e) { flying = false; }
        if (!flying) finish(id);
      }
    }
    if (G) G.lead = Math.max(G.lead, lead);
  } catch (e) { console.warn("[redlight] tick: " + e); }
}, 1);
// effects, spectators, the bar
system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) return;
  const t = system.currentTick, slow = G.speed;
  for (const id of Object.keys(G.pl)) {
    const p = online(id); if (!p) continue;
    try {
      p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("weakness", 30, { amplifier: 255, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false });
      if (slow > 0 && G.alive.includes(id) && G.phase !== "end") p.addEffect("slowness", 30, { amplifier: slow - 1, showParticles: false }); else p.removeEffect("slowness");
    } catch (e) { /* ignore */ }
  }
  const left = G.phase === "count" ? conf().min * 60 : Math.max(0, (G.endAt - t) / 20);
  for (const p of atArena()) {
    if (!G.pl[p.id] && !owner(p) && onField(a, p.location) && G.phase !== "end") { try { p.teleport(abs(a, SQ.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 1, z: 0 }) }); } catch (e) { /* ignore */ } tell(p, "§e[Red Light] A game is running: watch it from the balcony.", "§e[الضوء الأحمر] فيه لعبة: تابعها من البلكونة."); continue; }
    const me = G.alive.includes(p.id) && !G.finished.includes(p.id);
    const light = G.phase === "count" ? "§e" + pick(p, "GET READY", "استعد") : G.light === "green" ? "§a§l" + pick(p, "GREEN LIGHT", "الضوء الأخضر") : "§c§l" + pick(p, "RED LIGHT", "الضوء الأحمر");
    bar(p, light + " §r§7| §f" + pick(p, "Players", "اللاعبين") + ": §a" + running().length + " §7| §e" + fmt(left) + (me ? " §7| §b" + Math.floor(progress(a, p.location) * 100) + "%" : ""));
  }
}, 10);
safe("use", () => world.beforeEvents.itemUse.subscribe((ev) => { const p = ev.source; if (G && p && G.pl[p.id] && G.phase !== "end") ev.cancel = true; }));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id]) return;
  const all = pend(); all[player.id] = G.pl[player.id];
  system.run(() => writeJson(PEND_KEY, all));
}));

// ---------------------------------------------------------------- protection
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const DANGER = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper|flint_and_steel|fire_charge|tnt|end_crystal|respawn_anchor|piston|sticky_piston)$/;
const near = (d, x, z, m) => { const a = arena(); return !!a && a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!squidAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  ev.cancel = true; deny(ev.player, "§c[Red Light] You can't break the arena.", "§c[الضوء الأحمر] ما تقدر تكسر الساحة.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && DANGER.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[Red Light] You can't use this item here.", "§c[الضوء الأحمر] ما تقدر تستخدم هذا الغرض هنا."); }
  if (!squidAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item) deny(p, "§c[Red Light] Building is not allowed here.", "§c[الضوء الأحمر] البناء ممنوع هنا.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!arena()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !squidAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));
safe("doll", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => { if (ev.target?.typeId === DOLL && !owner(ev.player)) ev.cancel = true; }));

// ---------------------------------------------------------------- Owner pages
export function squidPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => squidPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: Red Light", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + (G.phase === "count" ? "countdown" : G.phase === "end" ? "finished" : G.light === "green" ? "GREEN" : "RED") + " §7(" + running().length + " running, " + G.finished.length + " finished)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§d§lRed Light, Green Light\n§r§7Run on green, freeze on red.\n§r§7The giant doll watches every move.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/redlight", "textures/items/dye_powder_pink", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the arena here\n§r§7A long field (55 x 141), sky walls,\n§r§7the finish gate, the giant doll,\n§r§7balconies (69 x 145). Undo possible\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the Red Light arena here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 69 x 145 blocks around you", "§7is replaced (Undo puts it back).", "§7The players run to the NORTH."], () => buildSquid(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 0, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 2, hdr(1) + "§f§lWalking speed\n§r§7Now: §e" + SPEEDS[c.speed] + "\n§r§7Slower = a longer game\n§r§eClick to change", "textures/items/feather", { run: () => { c.speed = (c.speed + 1) % SPEEDS.length; saveCfg(); self(); } });
    set(f, 1 * COLS + 4, hdr(Math.min(99, c.min)) + "§f§lTime limit\n§r§7Now: §e" + c.min + " minutes\n§r§7Who is not over the line = out\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.min = TIMES[(TIMES.indexOf(c.min) + 1) % TIMES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(Math.max(1, c.win)) + "§f§lWinners\n§r§7Now: §e" + (c.win ? "the first " + c.win : "everybody who finishes") + "\n§r§eClick to change", "textures/ui/shop/ic_trophy", { run: () => { c.win = WINNERS[(WINNERS.indexOf(c.win) + 1) % WINNERS.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 8, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for a winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, countdown " + COUNT + " s\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startSquid(player); if (r.err) say(player, "§c[Red Light] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the balcony", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, SQ.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 1, z: 0 }) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Red Light arena?", ["§7The land comes back as it was."], () => undoSquid(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, running().length), "g") + "§f§lRunning: §a" + running().length + "\n§r§7Finished: §e" + G.finished.map((id) => G.pl[id].n).join(", ") + "\n§r§7Out: §c" + G.out.length, "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody goes back."], () => stopSquid(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf();
  const f = makeOpr("Red Light: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/dye_powder_pink" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[Red Light] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody in the arena\n§r§7Adds the players who are at the arena", "textures/items/dye_powder_pink", { run: () => {
    for (const p of world.getAllPlayers()) if (inArena(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
squidHook.page = squidPage;

// ---------------------------------------------------------------- /redlight (every player)
export function squidMenu(player) {
  const f = makeOpr("Red Light, Green Light", SHORT_ROWS); f.self = () => squidMenu(player); f.glass = true;
  const a = arena();
  let top = []; try { top = ranking("squid").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§d§lRed Light, Green Light\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/dye_powder_pink", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, running().length), "g") + "§f§lGame now\n§r§7Light: " + (G.light === "green" ? "§aGREEN" : "§cRED") + "\n§r§7Running: §a" + running().length + "\n§r§7Finished: §e" + G.finished.length, "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lGo to the arena\n§r§7" + (a ? "The balcony (watch the game)" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, "redlight")) return;
    teleportWithFx(player, abs(a, SQ.view), a.d, "redlight", () => tell(player, "§a[Red Light] Welcome!", "§a[الضوء الأحمر] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.sw ?? 0) + "\n§r§7Losses: §c" + (s.sl ?? 0), "textures/items/dye_powder_pink", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:redlight", description: "Red Light, Green Light: the game, the arena, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { squidMenu(p); } catch (e) { console.warn("[redlight] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[redlight] command: " + e); }
});
