// ===================================================================================================================
// DROPPER (event)  -  /opr > Building > Dropper  or  /opr > Events > Dropper  (Owner)   and   /dropper (every player)
//
// The Owner builds the tower (dropperdesign.js) once, then runs games:
//   * chooses the players (2 - 16), the attempts per stage (3 / 5 / unlimited), what happens when the attempts are used up
//     (back one stage = to the checkpoint before / only wait 10 s), the waiting time (15 / 30 / 60 s), the time limit and the prize
//   * Start: everybody waits in the LOBBY (countdown), then goes onto the ledge of STAGE 1 at the top of the tower
//   * jump in, fall, steer left / right, go through the openings, land in the WATER at the bottom = stage done:
//     water particles, sound, a message with the time, the others are told; 5 s later the player is on the next stage
//     (his checkpoint is saved).  Every player plays his own way: the others stay in their stage until they pass it.
//   * touching anything on the way down (a plate, a wall ledge, a rotating arm, the floor, lava) = a failed attempt:
//     back to the top of the same stage.  No attempts left = back one stage (or 10 s wait), the attempts start again.
//   * the first 3 players who finish stage 7 are 1st / 2nd / 3rd (by finishing time): prizes, stats, announce.
//     Time over: the rest is ranked by stage and time.  After the game everybody goes back (place, game mode).
//   * rules: no ender pearls (a message), no other items, no water / building / breaking (Adventure + protection), no PvP,
//     no fall damage (the fall itself decides).
//   * stage 4 (ROTATION) and stage 7 (THE IMPOSSIBLE) have arms that turn; they only move while a player is in that stage.
// No lag: a few lines per player per tick, a handful of blocks for the arms.
// ===================================================================================================================
import { world, system, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, dropperHook } from "./spawnbuild.js";
import { DROP, dropperGen, stageCenter, ledgeOf, poolY, rotorList } from "./dropperdesign.js";
import { addFixedAt, removeFixed } from "./hologram.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "dr:tower", CFG_KEY = "dr:cfg", MKEY = "dr:m", PEND_KEY = "dr:pend";
const ATTEMPTS = [3, 5, 0], WAITS = [15, 30, 60], TIMES = [10, 15, 20, 30], PRIZES = [0, 2500, 5000, 10000, 20000], MAX_PLAYERS = 16;
const N = DROP.stages.length, TRANS = 100, DROP_MAX = 600, ROTOR_EVERY = 6;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[dropper] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[dropper] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const fmt = (ticks) => { const s = Math.max(0, Math.floor(ticks / 20)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const stName = (p, n) => DROP.stages[n].col + "§l" + (n + 1) + " - " + pick(p, DROP.stages[n].name, DROP.stages[n].ar);
const PLACES = ["§6§l1st", "§f§l2nd", "§c§l3rd"], PLACES_AR = ["§6§lالأول", "§f§lالثاني", "§c§lالثالث"];

// ---------------------------------------------------------------- the tower record
let A;
const tower = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (tower() ? [tower()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const dropperAt = (d, x, y, z) => { const a = tower(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inTower = (p) => { const l = p.location; return !!dropperAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
let cfg = null;
const conf = () => (cfg ??= { att: 3, back: 1, wait: 30, min: 15, prize: 5000, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());

// ---------------------------------------------------------------- building (fills first, then the single blocks)
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, "smp_dropper_");
    if (!(yield* waitLoaded(player, dim, a, "[Dropper] Building:"))) { removeAreas(dim, "smp_dropper_"); say(player, "§c[Dropper] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:dropper_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[dropper] backup: " + e); }
      bar(player, "§a[Dropper] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const g = dropperGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const cols = DROP.HX * 2 + 1, total = canvas.size + cols * 2 + canvas.fills.length;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[Dropper] §fBuilding the tower... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -DROP.HX; x <= DROP.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz + DROP.ZS }, { x: a.cx + x, y: a.cy + Math.min(DROP.UP, 120), z: a.cz + DROP.ZN }), air); } catch (e) { fails++; }
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 121, z: a.cz + DROP.ZS }, { x: a.cx + x, y: a.cy + DROP.UP, z: a.cz + DROP.ZN }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy - DROP.DOWN, z: a.cz + DROP.ZS }, { x: a.cx + x, y: a.cy - 1, z: a.cz + DROP.ZN }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    for (const f of canvas.fills) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + f.from.x, y: a.cy + f.from.y, z: a.cz + f.from.z }, { x: a.cx + f.to.x, y: a.cy + f.to.y, z: a.cz + f.to.z }), perm(f.id)); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    try { const b = addFixedAt(dim.id, a.cx + DROP.board.x + 0.5, a.cy + DROP.board.y, a.cz + DROP.board.z + 0.5, "dropper"); if (b && b !== "full") { a.board = b.id; saveA(); } } catch (e) { console.warn("[dropper] board: " + e); }
    removeAreas(dim, "smp_dropper_");
    say(player, "§a[Dropper] The tower is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aStart a game in §f/opr > Events > Dropper§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[dropper] build: " + e); say(player, "§c[Dropper] Building stopped: " + e); removeAreas(dim, "smp_dropper_"); }
  finally { busy = false; }
}
export function buildDropper(player) {
  if (!owner(player)) return say(player, "§c[Dropper] Only the Owner can build the tower.");
  if (busy) return say(player, "§c[Dropper] The tower is being built right now.");
  if (tower()) return say(player, "§c[Dropper] The tower already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - DROP.DOWN < hr.min || cy + DROP.UP >= hr.max) return say(player, "§c[Dropper] Too high here: the tower is " + DROP.UP + " blocks high. Stand lower (normal ground).");
  const a = { d: dim.id, cx, cy, cz, x1: cx - DROP.HX - 1, y1: cy - DROP.DOWN, z1: cz + DROP.ZS - 1, x2: cx + DROP.HX + 1, y2: cy + DROP.UP, z2: cz + DROP.ZN + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Dropper] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Dropper] Building the tower (53 x 73, " + DROP.UP + " high, 7 stages)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "dropper", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, "smp_dropper_");
    if (!(yield* waitLoaded(player, dim, a, "[Dropper] Undo:"))) { removeAreas(dim, "smp_dropper_"); say(player, "§c[Dropper] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[dropper] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (a.board) { try { removeFixed(a.board); } catch (e) { /* ignore */ } }
    A = null; saveA();
    removeAreas(dim, "smp_dropper_");
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Dropper] Removed: the land is back as it was." : "§e[Dropper] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoDropper(player) {
  const a = tower(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Dropper] Stop the game first.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}

// ---------------------------------------------------------------- the rotating arms (stage 4 + 7)
const rotorCells = (ro, step) => {
  const out = [];
  for (const k of [step % 8, (step + 4) % 8]) {
    const ang = (k * Math.PI) / 4;
    for (let i = 1; i <= ro.len; i++) {
      const dx = Math.round(Math.cos(ang) * i), dz = Math.round(Math.sin(ang) * i);
      if (Math.abs(dx) > DROP.IN || Math.abs(dz) > DROP.IN || (dx === 0 && dz === 0)) continue;
      out.push({ x: ro.x + dx, y: ro.y, z: ro.z + dz });
    }
  }
  return out;
};
const rotorState = new Map();            // rotor index -> { step, cells }
const ROTORS = rotorList();
const allArmCells = (ro) => { const out = []; for (let k = 0; k < 4; k++) out.push(...rotorCells(ro, k)); return out; };
function turnRotors(a, stagesInUse) {
  const dim = dimOf(a); if (!dim) return;
  const air = perm("air");
  ROTORS.forEach((ro, i) => {
    if (!stagesInUse.has(ro.stage)) return;
    const s = rotorState.get(i) ?? { step: i * 2, cells: allArmCells(ro) };     // first turn after a restart: every old arm block is cleared
    const next = rotorCells(ro, s.step + 1), keys = new Set(next.map((c) => c.x + "|" + c.z)), p = perm(ro.id);
    for (const c of s.cells) if (!keys.has(c.x + "|" + c.z)) { try { dim.getBlock({ x: a.cx + c.x, y: a.cy + c.y, z: a.cz + c.z })?.setPermutation(air); } catch (e) { /* not loaded */ } }
    for (const c of next) { try { dim.getBlock({ x: a.cx + c.x, y: a.cy + c.y, z: a.cz + c.z })?.setPermutation(p); } catch (e) { /* not loaded */ } }
    rotorState.set(i, { step: s.step + 1, cells: next });
  });
}

// ---------------------------------------------------------------- the game
let G = null;    // { phase: wait | run | end, until, start, pl: { id: { n, gm, back, st, att, state, t0, tr, times: [] } }, fin: [ids] }
const saveG = () => writeJson(MKEY, G ? { pl: Object.fromEntries(Object.entries(G.pl).map(([id, r]) => [id, { n: r.n, gm: r.gm, back: r.back }])) } : null);
export const dropView = () => (G ? { phase: G.phase, fin: [...G.fin], pl: Object.fromEntries(Object.entries(G.pl).map(([id, r]) => [id, { st: r.st, att: r.att, state: r.state }])) } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inTower(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
function restorePlayer(p, rec) {
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  for (const fx of ["resistance", "weakness"]) { try { p.removeEffect(fx); } catch (e) { /* ignore */ } }
}
const pend = () => readJson(PEND_KEY, {});
function restoreOrKeep(id, rec) {
  const p = online(id); if (p) { try { restorePlayer(p, rec); } catch (e) { /* ignore */ } return; }
  const all = pend(); all[id] = { n: rec.n, gm: rec.gm, back: rec.back }; writeJson(PEND_KEY, all);
}
safe("join", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  const all = pend(), rec = all[player.id]; if (!rec || G?.pl[player.id]) return;
  delete all[player.id]; writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  system.runTimeout(() => { try { restorePlayer(player, rec); } catch (e) { /* ignore */ } }, 20);
}));
system.runTimeout(() => { const old = readJson(MKEY, null); if (!old?.pl) return; writeJson(MKEY, null); for (const [id, rec] of Object.entries(old.pl)) restoreOrKeep(id, rec); }, 60);

const lobbySpot = (i) => ({ x: ((i % 9) - 4) * 4, y: DROP.lobby.y, z: DROP.lobby.z + Math.floor(i / 9) * 3 });
function toLedge(a, id, i = 0) {
  const p = online(id), r = G.pl[id]; if (!p) return;
  try { p.teleport(abs(a, ledgeOf(r.st, i)), { dimension: dimOf(a), facingLocation: abs(a, { ...stageCenter(r.st), y: DROP.TOP - 10 }) }); } catch (e) { /* ignore */ }
  r.state = "ledge"; r.t0 = 0;
  try { p.onScreenDisplay.setTitle(stName(p, r.st), { subtitle: "§7" + pick(p, "Jump in and land in the water!", "انزل ونزّل بالماي!") + (G.att ? " §f(" + r.att + "/" + G.att + ")" : ""), fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
}
export function startDropper(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = tower(); if (!a) return { err: "Build the tower first." };
  if (busy) return { err: "The tower is being built." };
  if (G) return { err: "A game is already running." };
  const c = conf(), ids = c.roster.filter((id) => online(id)).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  const t = system.currentTick;
  G = { phase: "wait", until: t + c.wait * 20, start: 0, endAt: 0, pl: {}, fin: [], att: c.att, back: c.back, prize: c.prize, min: c.min };
  ids.forEach((id, i) => {
    const p = online(id), l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
    G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, st: 0, att: c.att, state: "lobby", t0: 0, tr: 0, times: [], best: 0, bestT: 0 };
    try { p.teleport(abs(a, lobbySpot(i)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 20, z: 0 }) }); } catch (e) { /* ignore */ }
    try { p.setGameMode(GameMode.Adventure); } catch (e) { /* ignore */ }
    tell(p, "§d[Dropper] §fFall down the tower and land in the WATER. 7 stages, " + (c.att ? c.att + " attempts per stage" : "unlimited attempts") + ". Steer with your movement keys. §cNo ender pearls!",
      "§d[الدروبر] §fانزل من البرج ونزّل بالماي. 7 مراحل، " + (c.att ? c.att + " محاولات لكل مرحلة" : "محاولات بلا حد") + ". توجه بأزرار الحركة. §cممنوع الإندر بيرل!");
  });
  saveG();
  const names = ids.map((id) => G.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§d§l[Dropper] §r§fA game starts in " + c.wait + " s! §7Players: §f" + names + " §e/dropper", "§d§l[الدروبر] §r§fتبدأ لعبة بعد " + c.wait + " ثانية! §7اللاعبين: §f" + names + " §e/dropper");
  try { slog(player, "dropper", null, "game started: " + ids.length + " players"); } catch (e) { /* ignore */ }
  return { ok: true };
}
function fail(a, id, why) {
  const r = G.pl[id], p = online(id); if (!r || r.state !== "fall") return;
  r.state = "trans"; r.tr = system.currentTick + 25;
  if (G.att) r.att--;
  let msg = "";
  if (G.att && r.att <= 0) {
    r.att = G.att;
    if (G.back && r.st > 0) { r.st--; msg = "back"; } else { r.tr = system.currentTick + 200; msg = "wait"; }
  }
  if (!p) return;
  try { p.dimension.spawnParticle("minecraft:huge_explosion_emitter", p.location); p.playSound("mob.wither.hurt", { volume: 0.4, pitch: 1.5 }); } catch (e) { /* ignore */ }
  const why1 = why === "lava" ? pick(p, "Lava!", "حمم!") : why === "time" ? pick(p, "Too slow", "بطيء هواي") : pick(p, "You hit something", "صدمت بشي");
  try {
    p.onScreenDisplay.setTitle("§c§l" + pick(p, "FAILED", "فشلت"), { subtitle: "§7" + why1 + (msg === "back" ? " §c- " + pick(p, "no attempts left: back to stage ", "خلصت المحاولات: ترجع للمرحلة ") + (r.st + 1) : msg === "wait" ? " §c- " + pick(p, "no attempts left: wait 10 s", "خلصت المحاولات: انتظر 10 ثواني") : G.att ? " §f(" + r.att + "/" + G.att + ")" : ""), fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 8 });
  } catch (e) { /* ignore */ }
}
function success(a, id) {
  const r = G.pl[id], p = online(id), t = system.currentTick; if (!r || r.state !== "fall") return;
  const took = t - (r.t0 || t), total = t - G.start;
  r.times[r.st] = took; r.state = "trans"; r.tr = t + TRANS;
  const done = r.st;
  r.best = done + 1; r.bestT = total;
  if (p) {
    try {
      const at = p.location;
      for (let k = 0; k < 6; k++) p.dimension.spawnParticle("minecraft:water_splash_particle_manual", { x: at.x + (Math.random() - 0.5) * 2, y: at.y + 1, z: at.z + (Math.random() - 0.5) * 2 });
      p.dimension.spawnParticle("minecraft:totem_particle", { x: at.x, y: at.y + 1.5, z: at.z });
      p.playSound("random.levelup"); p.playSound("random.splash", { volume: 0.8 });
      p.onScreenDisplay.setTitle("§a§l" + pick(p, "STAGE " + (done + 1) + " CLEAR!", "المرحلة " + (done + 1) + " خلصت!"), { subtitle: "§f" + fmt(took) + (done + 1 < N ? " §7- " + pick(p, "next: ", "التالية: ") + stName(p, done + 1) : ""), fadeInDuration: 3, stayDuration: 60, fadeOutDuration: 10 });
    } catch (e) { /* ignore */ }
  }
  r.st = Math.min(N, done + 1); r.att = G.att;
  if (r.st >= N) { finished(a, id, total); return; }
  toAll((q) => { if (q.id !== id) q.sendMessage(pick(q, "§d[Dropper] §f" + r.n + " §7passed " + stName(q, done) + " §r§7(" + fmt(took) + ")", "§d[الدروبر] §f" + r.n + " §7عبر " + stName(q, done) + " §r§7(" + fmt(took) + ")")); });
}
function finished(a, id, total) {
  const r = G.pl[id], p = online(id), place = G.fin.length; G.fin.push(id);
  r.state = "done"; r.total = total;
  const prize = place < 3 && G.prize ? Math.floor(G.prize / [1, 2, 4][place]) : 0;
  if (p) {
    try { if (place === 0) { const s = stats(p); s.dr = (s.dr ?? 0) + 1; } if (prize) addMoney(p, prize); else touch(p); } catch (e) { /* ignore */ }
    system.runTimeout(() => { try { p.teleport(abs(a, lobbySpot(place)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 20, z: 0 }) }); } catch (e) { /* ignore */ } }, 60);
  }
  toAll((q) => {
    const pl = place < 3 ? pick(q, PLACES[place], PLACES_AR[place]) : "§7#" + (place + 1);
    q.sendMessage("§d§l[Dropper] §r" + pl + " §r§f" + r.n + " §7" + pick(q, "finished all 7 stages", "خلص المراحل السبعة") + " §f(" + fmt(total) + ")" + (prize ? " §a+" + money(prize) : ""));
    if (q.id === id) q.onScreenDisplay.setTitle(pl, { subtitle: "§a" + pick(q, "You finished the DROPPER!", "خلصت الدروبر!") + " §f" + fmt(total), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 });
  });
  const left = Object.values(G.pl).filter((x) => x.state !== "done").length;
  if (G.fin.length >= 3 || left === 0) endGame();
}
function endGame() {
  if (!G || G.phase === "end") return;
  G.phase = "end"; G.until = system.currentTick + 160;
  const a = tower();
  // ranking: finishers by time, then the others by the stage they reached and when
  const rest = Object.entries(G.pl).filter(([id]) => !G.fin.includes(id)).sort((x, y) => y[1].best - x[1].best || x[1].bestT - y[1].bestT).map(([id]) => id);
  const order = [...G.fin, ...rest];
  order.slice(G.fin.length, 3).forEach((id, k) => {                  // places 1-3 not taken by finishers: the best of the rest (prize too)
    const place = G.fin.length + k, r = G.pl[id], p = online(id), prize = G.prize ? Math.floor(G.prize / [1, 2, 4][place]) : 0;
    if (p && r.best > 0) { try { if (place === 0) { const s = stats(p); s.dr = (s.dr ?? 0) + 1; } if (prize) addMoney(p, prize); else touch(p); } catch (e) { /* ignore */ } r.prize = prize; }
  });
  for (const id of order.slice(3)) { const p = online(id); if (p) { try { const s = stats(p); s.dl = (s.dl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ } } }
  const line = (q) => order.slice(0, 3).map((id, k) => pick(q, PLACES[k], PLACES_AR[k]) + " §r§f" + G.pl[id].n + " §7(" + (G.pl[id].state === "done" ? fmt(G.pl[id].total) : pick(q, "stage ", "مرحلة ") + G.pl[id].best + "/" + N) + ")").join("\n");
  for (const q of world.getAllPlayers()) {
    try { q.sendMessage("§d§l[Dropper] " + pick(q, "Game over!", "انتهت اللعبة!") + "\n§r" + line(q)); } catch (e) { /* ignore */ }
    if (G.pl[q.id] || inTower(q)) { try { q.onScreenDisplay.setTitle("§6§l" + (order[0] ? G.pl[order[0]].n : "-"), { subtitle: "§d" + pick(q, "WINS THE DROPPER!", "فاز بالدروبر!"), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = abs(a, { x: 0, y: 3, z: DROP.lobby.z });
  for (let i = 0; i < 6; i++) system.runTimeout(() => { for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 20, y: at.y + Math.random() * 6, z: at.z + (Math.random() - 0.5) * 8 }); } catch (e) { /* ignore */ } } try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ } }, i * 8);
}
export function stopDropper(reason = "stopped") {
  if (!G) return;
  const g = G; G = null; saveG();
  for (const [id, rec] of Object.entries(g.pl)) restoreOrKeep(id, rec);
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§d[Dropper] §7The game was stopped.", "§d[الدروبر] §7انوقفت اللعبة.");
}

// the 1-tick loop
system.runInterval(() => {
  if (!G) return;
  const a = tower(); if (!a) { stopDropper(); return; }
  try {
    const t = system.currentTick;
    if (G.phase === "end") { if (t >= G.until) stopDropper("end"); return; }
    if (G.phase === "wait") {
      const left = Math.ceil((G.until - t) / 20);
      if ((G.until - t) % 20 === 0 && left <= 10 && left > 0) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + left, { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
      if (t >= G.until) { G.phase = "run"; G.start = t; G.endAt = t + G.min * 1200; Object.keys(G.pl).forEach((id, i) => toLedge(a, id, i)); }
      return;
    }
    if (t >= G.endAt) { toAll((p) => p.sendMessage(pick(p, "§d[Dropper] §eTime is over!", "§d[الدروبر] §eخلص الوقت!"))); endGame(); return; }
    const inUse = new Set();
    for (const [id, r] of Object.entries(G.pl)) {
      const p = online(id); if (!p) continue;
      if (r.state === "done" || r.state === "lobby") continue;
      if (r.state === "trans") { if (t >= r.tr) toLedge(a, id, Object.keys(G.pl).indexOf(id)); continue; }
      inUse.add(r.st);
      const c = stageCenter(r.st), l = p.location, ry = l.y - a.cy, dx = l.x - a.cx - 0.5 - c.x, dz = l.z - a.cz - 0.5 - c.z;
      if (p.dimension.id !== a.d || Math.abs(dx) > 8.6 || Math.abs(dz) > 8.6 || ry > DROP.TOP + 6 || ry < poolY(r.st) - 6) { toLedge(a, id, 0); continue; }   // out of the shaft somehow: back on the ledge (no attempt lost)
      if (r.state === "ledge") { if (ry < DROP.TOP - 1.5) { r.state = "fall"; r.t0 = t; } continue; }
      // falling
      let water = false, ground = false; try { water = p.isInWater; ground = p.isOnGround; } catch (e) { /* ignore */ }
      if (water && ry < poolY(r.st) + 3) { success(a, id); continue; }
      let lava = false; try { const b = p.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) }); lava = !!b && /lava$/.test(b.typeId); } catch (e) { /* ignore */ }
      if (lava) { fail(a, id, "lava"); continue; }
      if (ground && !water) { fail(a, id, "hit"); continue; }
      if (t - r.t0 > DROP_MAX) { fail(a, id, "time"); continue; }
    }
    if (inUse.has(3) || inUse.has(6)) { if (t % ROTOR_EVERY === 0) turnRotors(a, inUse); }
  } catch (e) { console.warn("[dropper] tick: " + e); }
}, 1);
// effects + the bar
system.runInterval(() => {
  if (!G) return;
  const t = system.currentTick;
  for (const [id, r] of Object.entries(G.pl)) {
    const p = online(id); if (!p) continue;
    try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("weakness", 30, { amplifier: 255, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
    if (G.phase === "wait") { bar(p, "§d§lDROPPER §r§7| §e" + pick(p, "Starting in ", "تبدأ بعد ") + Math.max(0, Math.ceil((G.until - t) / 20)) + "s"); continue; }
    if (G.phase !== "run") continue;
    const st = Math.min(r.st, N - 1);
    bar(p, r.state === "done" ? "§a§l" + pick(p, "FINISHED", "خلصت") + " §r§7| §f" + fmt(r.total) : stName(p, st) + " §r§7| " + (G.att ? "§f" + pick(p, "Attempts", "المحاولات") + ": §e" + r.att + "/" + G.att + " §7| " : "") + "§b" + fmt(Math.max(0, G.endAt - t)));
  }
}, 10);
// no ender pearls (and no other items)
safe("use", () => world.beforeEvents.itemUse.subscribe((ev) => {
  const p = ev.source; if (!G || !p || !G.pl[p.id] || G.phase === "end") return;
  ev.cancel = true;
  if (ev.itemStack?.typeId === "minecraft:ender_pearl") system.run(() => { try { p.onScreenDisplay.setActionBar(pick(p, "§c§lEnder pearls are NOT allowed in the Dropper!", "§c§lالإندر بيرل ممنوع بالدروبر!")); p.playSound("note.bass", { pitch: 0.5 }); } catch (e) { /* ignore */ } });
}));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id]) return;
  const r = G.pl[player.id], all = pend(); all[player.id] = { n: r.n, gm: r.gm, back: r.back };
  system.run(() => writeJson(PEND_KEY, all));
}));

// ---------------------------------------------------------------- protection
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const DANGER = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper|flint_and_steel|fire_charge|tnt|end_crystal|respawn_anchor|piston|sticky_piston)$/;
const near = (d, x, z, m) => { const a = tower(); return !!a && a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!dropperAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  ev.cancel = true; deny(ev.player, "§c[Dropper] You can't break the tower.", "§c[الدروبر] ما تقدر تكسر البرج.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && DANGER.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[Dropper] You can't use this item here (no water / lava).", "§c[الدروبر] ما تقدر تستخدم هذا الغرض هنا (ممنوع الماي والحمم)."); }
  if (!dropperAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item) deny(p, "§c[Dropper] Building is not allowed here.", "§c[الدروبر] البناء ممنوع هنا.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!tower()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !dropperAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function dropperPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => dropperPage(player, back), a = tower(), c = conf();
  const f = makeOpr("Event: Dropper", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.fin.length + " finished)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§d§lDropper\n§r§7Fall down the tower, land in the water.\n§r§77 stages, each one different.\n§r§7Tower: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/dropper", "textures/items/feather", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the tower here\n§r§77 drop shafts (80 - 120 high),\n§r§7a lobby. 53 x 73, " + DROP.UP + " high\n§r§7The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the Dropper tower here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 53 x 73 blocks around you,", "§7" + DROP.UP + " blocks high, is replaced (Undo puts it back)."], () => buildDropper(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 0, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 2, hdr(Math.max(1, c.att)) + "§f§lAttempts per stage\n§r§7Now: §e" + (c.att || "unlimited") + "\n§r§eClick to change", "textures/items/feather", { run: () => { c.att = ATTEMPTS[(ATTEMPTS.indexOf(c.att) + 1) % ATTEMPTS.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 3, hdr(1, c.back ? "r" : "c") + "§f§lNo attempts left\n§r§7Now: §e" + (c.back ? "back one stage" : "wait 10 s, try again") + "\n§r§eClick to change", "textures/items/arrow", { run: () => { c.back = c.back ? 0 : 1; saveCfg(); self(); } });
    set(f, 1 * COLS + 5, hdr(Math.min(99, c.wait)) + "§f§lWaiting time\n§r§7In the lobby: §e" + c.wait + " s\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.wait = WAITS[(WAITS.indexOf(c.wait) + 1) % WAITS.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(Math.min(99, c.min)) + "§f§lTime limit\n§r§7Now: §e" + c.min + " minutes\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.min = TIMES[(TIMES.indexOf(c.min) + 1) % TIMES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 8, hdr(1, c.prize ? "g" : "c") + "§f§lPrize\n§r§71st: §a" + money(c.prize) + "\n§r§72nd: §a" + money(Math.floor(c.prize / 2)) + "\n§r§73rd: §a" + money(Math.floor(c.prize / 4)) + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, lobby " + c.wait + " s\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startDropper(player); if (r.err) say(player, "§c[Dropper] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the lobby", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, DROP.lobby), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: 20, z: 0 }) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the tower\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Dropper tower?", ["§7The land comes back as it was."], () => undoDropper(player), self) });
  } else {
    const rows = Object.values(G.pl).map((r) => "§f" + r.n + " §7- " + (r.state === "done" ? "§aFINISHED" : "stage " + (Math.min(r.st, N - 1) + 1))).slice(0, 10).join("\n§r");
    set(f, 1 * COLS + 4, hdr(Math.max(1, Object.keys(G.pl).length), "g") + "§f§lPlayers\n§r" + rows, "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 5, hdr(1) + "§6§lEnd the game now\n§r§7Shows the ranking", "textures/ui/shop/ic_trophy", { run: () => { if (G && G.phase === "run") endGame(); self(); } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody goes back."], () => stopDropper(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf();
  const f = makeOpr("Dropper: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/feather" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[Dropper] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody at the tower\n§r§7Adds the players who are at the tower", "textures/items/feather", { run: () => {
    for (const p of world.getAllPlayers()) if (inTower(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
dropperHook.page = dropperPage;

// ---------------------------------------------------------------- /dropper (every player)
export function dropperMenu(player) {
  const f = makeOpr("Dropper", SHORT_ROWS); f.self = () => dropperMenu(player); f.glass = true;
  const a = tower();
  let top = []; try { top = ranking("dropper").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§d§lDropper\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/feather", null);
  if (G) {
    const rows = Object.values(G.pl).sort((x, y) => (y.state === "done") - (x.state === "done") || y.st - x.st).slice(0, 8).map((r) => "§f" + r.n + " §7- " + (r.state === "done" ? "§aFINISHED" : "stage " + (Math.min(r.st, N - 1) + 1))).join("\n§r");
    set(f, 2 * COLS + 3, hdr(1, "g") + "§f§lGame now\n§r" + rows, "textures/items/clock_item", null);
  } else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lGo to the tower\n§r§7" + (a ? "The lobby" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, "dropper")) return;
    teleportWithFx(player, abs(a, DROP.lobby), a.d, "dropper", () => tell(player, "§a[Dropper] Welcome!", "§a[الدروبر] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.dr ?? 0), "textures/items/feather", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:dropper", description: "Dropper: the game, the tower, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { dropperMenu(p); } catch (e) { console.warn("[dropper] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[dropper] command: " + e); }
});
