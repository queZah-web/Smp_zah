// ===================================================================================================================
// COLOR RUSH (event)  -  /opr > Building > Color Rush  or  /opr > Events > Color Rush  (Owner)   and   /colors
//
// The Owner builds the hall (colordesign.js) once, then runs games:
//   * chooses the players (2 - 30), the FLOOR (mixed: every block its own colour / patches: 3 x 3 patches of one colour),
//     the time to find the colour (first round 6 / 5 / 4 / 3 s), how much faster every round gets (0 / 0.2 / 0.4 s, never under
//     1 s), how fast the other blocks vanish (at once / 0.5 s / 1 s) and the prize
//   * every round: a new floor -> a random colour is called (big title in its colour, the 4 wall panels turn that colour,
//     a countdown bar) -> time over: every block of another colour vanishes -> who is not on the right colour falls = OUT
//     (announced, he goes to the walkway and watches) -> the floor comes back, the next round is faster
//   * the last player wins (if the last players fall in the same round, they all win together)
//   * rules: no PvP (no damage, no knockback), Adventure mode, no items (no ender pearls)
// No lag: one floor (1089 blocks) is painted per round, spread over a few ticks; the vanishing is one fill + the kept blocks.
// ===================================================================================================================
import { world, system, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, colorHook } from "./spawnbuild.js";
import { CR, COLORS, colorGen, floorPattern, cellOf, FLOOR_N } from "./colordesign.js";
import { addFixedAt, removeFixed } from "./hologram.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "cr:hall", CFG_KEY = "cr:cfg", MKEY = "cr:m", PEND_KEY = "cr:pend";
const FIRST = [6, 5, 4, 3], STEP = [0, 0.2, 0.4], VANISH = [0, 10, 20], PRIZES = [0, 2500, 5000, 10000], MAX_PLAYERS = 30, COUNT = 10;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[colors] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[colors] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const cName = (p, ci) => COLORS[ci].c + "§l" + pick(p, COLORS[ci].en, COLORS[ci].ar);

// ---------------------------------------------------------------- the hall record
let A;
const hall = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (hall() ? [hall()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const colorAt = (d, x, y, z) => { const a = hall(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inHall = (p) => { const l = p.location; return !!colorAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const onFloorArea = (a, l) => Math.abs(l.x - a.cx - 0.5) <= CR.F + 1.5 && Math.abs(l.z - a.cz - 0.5) <= CR.F + 1.5;
let cfg = null;
const conf = () => (cfg ??= { mode: "mixed", first: 5, step: 0.2, vanish: 0, prize: 2500, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, "smp_colors_");
    if (!(yield* waitLoaded(player, dim, a, "[Color Rush] Building:"))) { removeAreas(dim, "smp_colors_"); say(player, "§c[Color Rush] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:colors_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[colors] backup: " + e); }
      bar(player, "§a[Color Rush] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -CR.HX; x <= CR.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy + 1, z: a.cz - CR.HX }, { x: a.cx + x, y: a.cy + CR.UP, z: a.cz + CR.HX }), air); } catch (e) { /* ignore */ }
      try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y: a.cy - CR.DOWN, z: a.cz - CR.HX }, { x: a.cx + x, y: a.cy - 1, z: a.cz + CR.HX }), dirt); } catch (e) { /* ignore */ }
      yield;
    }
    const g = colorGen(); let r; while (!(r = g.next()).done) yield;
    const og = r.value.orderedGen(); let q; while (!(q = og.next()).done) yield;
    const pal = r.value.pal.map((p) => perm(p.id, p.st)); let k = 0, total = r.value.size;
    for (const b of q.value) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: a.cx + b[i], y: a.cy + b[i + 1], z: a.cz + b[i + 2] })?.setPermutation(p); } catch (e) { /* ignore */ } }
      if (++k % 50 === 0) { bar(player, "§a[Color Rush] §fBuilding the hall... §e" + Math.floor((k / total) * 100) + "%"); yield; }
    }
    yield* paintFloor(a, floorPattern(conf().mode), conf().mode);
    try { const b = addFixedAt(dim.id, a.cx + 0.5, a.cy + CR.FY + 6.5, a.cz + 22.5, "colors"); if (b && b !== "full") { a.board = b.id; saveA(); } } catch (e) { console.warn("[colors] board: " + e); }
    removeAreas(dim, "smp_colors_");
    say(player, "§a[Color Rush] The hall is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s) §aStart a game in §f/opr > Events > Color Rush§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[colors] build: " + e); say(player, "§c[Color Rush] Building stopped: " + e); removeAreas(dim, "smp_colors_"); }
  finally { busy = false; }
}
export function buildColors(player) {
  if (!owner(player)) return say(player, "§c[Color Rush] Only the Owner can build the hall.");
  if (busy) return say(player, "§c[Color Rush] The hall is being built right now.");
  if (hall()) return say(player, "§c[Color Rush] The hall already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - CR.DOWN < hr.min || cy + CR.UP >= hr.max) return say(player, "§c[Color Rush] Too high or too low here. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, x1: cx - CR.HX - 1, y1: cy - CR.DOWN, z1: cz - CR.HX - 1, x2: cx + CR.HX + 1, y2: cy + CR.UP, z2: cz + CR.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Color Rush] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Color Rush] Building the hall (53 x 53)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "colors", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, "smp_colors_");
    if (!(yield* waitLoaded(player, dim, a, "[Color Rush] Undo:"))) { removeAreas(dim, "smp_colors_"); say(player, "§c[Color Rush] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[colors] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (a.board) { try { removeFixed(a.board); } catch (e) { /* ignore */ } }
    A = null; saveA();
    removeAreas(dim, "smp_colors_");
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Color Rush] Removed: the land is back as it was." : "§e[Color Rush] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoColors(player) {
  const a = hall(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Color Rush] Stop the game first.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}

// ---------------------------------------------------------------- the floor + the panels
const woolOf = (ci) => perm(COLORS[ci].id + "_wool");
/** paints a new floor (patches: 121 small fills, mixed: 1089 blocks in a few ticks) */
function* paintFloor(a, pat, mode) {
  const dim = dimOf(a); if (!dim) return;
  const y = a.cy + CR.FY;
  if (mode === "patches") {
    const T = (FLOOR_N / 3) | 0;
    for (let tx = 0; tx < T; tx++) {
      for (let tz = 0; tz < T; tz++) {
        const ci = pat[tx * 3 * FLOOR_N + tz * 3], x0 = tx * 3 - CR.F, z0 = tz * 3 - CR.F;
        try { dim.fillBlocks(new BlockVolume({ x: a.cx + x0, y, z: a.cz + z0 }, { x: a.cx + x0 + 2, y, z: a.cz + z0 + 2 }), woolOf(ci)); } catch (e) { /* ignore */ }
      }
      yield;
    }
    return;
  }
  for (let i = 0; i < pat.length; i++) {
    const c = cellOf(i);
    try { dim.getBlock({ x: a.cx + c.x, y, z: a.cz + c.z })?.setPermutation(woolOf(pat[i])); } catch (e) { /* ignore */ }
    if (i % 280 === 279) yield;
  }
}
function paintPanels(a, ci) {
  const dim = dimOf(a); if (!dim) return;
  const p = perm(ci === null ? "light_gray_wool" : COLORS[ci].id + "_wool");
  for (const pn of CR.panels) { try { dim.fillBlocks(new BlockVolume({ x: a.cx + pn.from.x, y: a.cy + pn.from.y, z: a.cz + pn.from.z }, { x: a.cx + pn.to.x, y: a.cy + pn.to.y, z: a.cz + pn.to.z }), p); } catch (e) { /* ignore */ } }
}
/** every block that is not colour ci vanishes: one fill + the kept blocks back (at once), or in random waves */
function* vanish(a, pat, ci, ticks) {
  const dim = dimOf(a); if (!dim) return;
  const y = a.cy + CR.FY, air = perm("air"), keep = woolOf(ci);
  if (!ticks) {
    try { dim.fillBlocks(new BlockVolume({ x: a.cx - CR.F, y, z: a.cz - CR.F }, { x: a.cx + CR.F, y, z: a.cz + CR.F }), air); } catch (e) { /* ignore */ }
    for (let i = 0; i < pat.length; i++) if (pat[i] === ci) { const c = cellOf(i); try { dim.getBlock({ x: a.cx + c.x, y, z: a.cz + c.z })?.setPermutation(keep); } catch (e) { /* ignore */ } }
    return;
  }
  const gone = []; for (let i = 0; i < pat.length; i++) if (pat[i] !== ci) gone.push(i);
  for (let i = gone.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [gone[i], gone[j]] = [gone[j], gone[i]]; }
  const per = Math.ceil(gone.length / ticks);
  for (let k = 0; k < gone.length; k++) {
    const c = cellOf(gone[k]);
    try { dim.getBlock({ x: a.cx + c.x, y, z: a.cz + c.z })?.setPermutation(air); } catch (e) { /* ignore */ }
    if (k % per === per - 1) yield;
  }
}

// ---------------------------------------------------------------- the game
let G = null;   // { phase, until, pl: { id: { n, gm, back } }, alive, round, ci, pat, roundStart: [ids], out: [ids] }
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const colorView = () => (G ? { phase: G.phase, alive: [...G.alive], round: G.round, color: G.ci, out: [...G.out] } : null);
const toAll = (fn) => { for (const p of world.getAllPlayers()) { if (!inHall(p) && !G?.pl[p.id]) continue; try { fn(p); } catch (e) { /* ignore */ } } };
function restorePlayer(p, rec) {
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  for (const fx of ["resistance", "weakness"]) { try { p.removeEffect(fx); } catch (e) { /* ignore */ } }
}
const pend = () => readJson(PEND_KEY, {});
function restoreOrKeep(id, rec) { const p = online(id); if (p) { try { restorePlayer(p, rec); } catch (e) { /* ignore */ } return; } const all = pend(); all[id] = rec; writeJson(PEND_KEY, all); }
safe("join", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  const all = pend(), rec = all[player.id]; if (!rec || G?.pl[player.id]) return;
  delete all[player.id]; writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  system.runTimeout(() => { try { restorePlayer(player, rec); } catch (e) { /* ignore */ } }, 20);
}));
system.runTimeout(() => { const old = readJson(MKEY, null); if (!old?.pl) return; writeJson(MKEY, null); for (const [id, rec] of Object.entries(old.pl)) restoreOrKeep(id, rec); }, 60);

const timeOf = () => Math.max(1, G.first - G.step * (G.round - 1));
const seat = (i) => ({ x: ((i % 13) - 6) * 3, y: CR.FY + 1, z: (i % 2 ? -1 : 1) * 21 });
export function startColors(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = hall(); if (!a) return { err: "Build the hall first." };
  if (busy) return { err: "The hall is being built." };
  if (G) return { err: "A game is already running." };
  const c = conf(), ids = c.roster.filter((id) => online(id)).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "count", until: system.currentTick + COUNT * 20, pl: {}, alive: [...ids], out: [], round: 0, ci: null, pat: null, mode: c.mode, first: c.first, step: c.step, vanish: c.vanish, prize: c.prize, roundStart: [], job: false };
  const dim = dimOf(a);
  ids.forEach((id, i) => {
    const p = online(id), l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
    G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id } };
    const ang = (i / ids.length) * Math.PI * 2, r = ids.length > 1 ? 9 : 0;
    try { p.teleport(abs(a, { x: Math.round(Math.cos(ang) * r), y: CR.FY + 1, z: Math.round(Math.sin(ang) * r) }), { dimension: dim, facingLocation: abs(a, { x: 0, y: CR.FY + 1, z: 0 }) }); } catch (e) { /* ignore */ }
    try { p.setGameMode(GameMode.Adventure); } catch (e) { /* ignore */ }
    tell(p, "§d[Color Rush] §fA colour is called - run onto that colour before the time is over! §7All the other blocks vanish. Fall = out. Every round is faster. Last one wins!",
      "§d[تحدي الألوان] §fيطلع اسم لون - اركض على هذا اللون قبل ما يخلص الوقت! §7باقي البلوكات تختفي. اللي يطيح يطلع. كل جولة أسرع. آخر واحد يفوز!");
  });
  saveG();
  G.job = true; const md = G.mode; system.runJob((function* () { yield* paintFloor(a, floorPattern(md), md); if (G) G.job = false; })());
  paintPanels(a, null);
  const names = ids.map((id) => G.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§d§l[Color Rush] §r§fA game starts! §7" + ids.length + " players: §f" + names + " §e/colors", "§d§l[تحدي الألوان] §r§fبدت لعبة! §7" + ids.length + " لاعب: §f" + names + " §e/colors");
  try { slog(player, "colors", null, "game started: " + ids.length + " players"); } catch (e) { /* ignore */ }
  return { ok: true };
}
function newRound(a) {
  G.round++; G.phase = "paint"; G.job = true; G.roundStart = [...G.alive];
  G.pat = floorPattern(G.mode);
  paintPanels(a, null);
  const md = G.mode, pat = G.pat; system.runJob((function* () { yield* paintFloor(a, pat, md); if (G) { G.job = false; callColor(a); } })());
}
function callColor(a) {
  if (!G) return;
  let ci = Math.floor(Math.random() * COLORS.length);
  if (ci === G.ci) ci = (ci + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length;     // never the same colour twice
  G.ci = ci; G.phase = "show"; G.dur = Math.round(timeOf() * 20); G.until = system.currentTick + G.dur;
  paintPanels(a, ci);
  toAll((p) => { p.onScreenDisplay.setTitle(cName(p, ci), { subtitle: "§7" + pick(p, "Round ", "الجولة ") + G.round + " §8| §f" + timeOf().toFixed(1) + " s", fadeInDuration: 0, stayDuration: Math.max(10, G.dur), fadeOutDuration: 5 }); p.playSound("note.pling", { pitch: 1.2 }); });
}
function eliminate(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.out.push(id);
  const a = hall(), rec = G.pl[id], p = online(id);
  if (p) {
    try { p.onScreenDisplay.setTitle("§c§l" + pick(p, "OUT!", "طلعت!"), { subtitle: "§7" + pick(p, "Round ", "الجولة ") + G.round, fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 8 }); p.playSound("mob.wither.hurt", { volume: 0.4, pitch: 1.4 }); } catch (e) { /* ignore */ }
    system.runTimeout(() => { try { p.teleport(abs(a, seat(G ? G.out.length : 0)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: CR.FY, z: 0 }) }); } catch (e) { /* ignore */ } }, 5);
  }
  toAll((q) => q.sendMessage("§c☠ §f" + rec.n + " §7" + (why === "left" ? pick(q, "left the game", "طلع من اللعبة") : pick(q, "fell", "طاح")) + "! §e" + pick(q, "Left: ", "الباقين: ") + G.alive.length));
}
function finish(winners) {
  const a = hall();
  G.phase = "end"; G.until = system.currentTick + 140;
  paintPanels(a, null);
  for (const id of G.pl ? Object.keys(G.pl) : []) {
    const p = online(id); if (!p) continue;
    try { const s = stats(p); if (winners.includes(id)) { s.cw = (s.cw ?? 0) + 1; if (G.prize) addMoney(p, Math.floor(G.prize / winners.length)); else touch(p); } else { s.cl = (s.cl ?? 0) + 1; touch(p); } } catch (e) { /* ignore */ }
  }
  const names = winners.map((id) => G.pl[id].n).join(", ");
  for (const q of world.getAllPlayers()) {
    tell(q, "§d§l[Color Rush] §r" + (winners.length ? "§6§l" + names + " §r§a" + (winners.length > 1 ? "win together" : "wins") + "! §7(" + G.round + " rounds" + (G.prize ? ", " + money(Math.floor(G.prize / Math.max(1, winners.length))) + (winners.length > 1 ? " each" : "") : "") + ")" : "§7Nobody wins."),
      "§d§l[تحدي الألوان] §r" + (winners.length ? "§6§l" + names + " §r§a" + (winners.length > 1 ? "فازوا سوا" : "فاز") + "! §7(" + G.round + " جولة" + (G.prize ? "، " + money(Math.floor(G.prize / Math.max(1, winners.length))) : "") + ")" : "§7محد فاز."));
    if (inHall(q) || G.pl[q.id]) { try { q.onScreenDisplay.setTitle("§6§l" + (names || "-"), { subtitle: "§d" + pick(q, "COLOR RUSH CHAMPION!", "بطل تحدي الألوان!"), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = abs(a, { x: 0, y: CR.FY + 3, z: 0 });
  for (let i = 0; i < 6; i++) system.runTimeout(() => { for (let k = 0; k < 5; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 20, y: at.y + Math.random() * 6, z: at.z + (Math.random() - 0.5) * 20 }); } catch (e) { /* ignore */ } } try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ } }, i * 8);
}
export function stopColors(reason = "stopped") {
  if (!G) return;
  const g = G, a = hall(); G = null; saveG();
  for (const [id, rec] of Object.entries(g.pl)) restoreOrKeep(id, rec);
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§d[Color Rush] §7The game was stopped.", "§d[تحدي الألوان] §7انوقفت اللعبة.");
  if (a) { paintPanels(a, null); const md = conf().mode; system.runJob((function* () { yield* paintFloor(a, floorPattern(md), md); })()); }
}

system.runInterval(() => {
  if (!G) return;
  const a = hall(); if (!a) { stopColors(); return; }
  try {
    const t = system.currentTick;
    if (G.phase === "end") { if (t >= G.until) stopColors("end"); return; }
    // the players: who falls is out (only after the floor is gone, or anywhere off the floor)
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { eliminate(id, "left"); continue; }
      const l = p.location, ry = l.y - a.cy;
      if (p.dimension.id !== a.d || !onFloorArea(a, l) && ry > CR.FY - 1) { try { p.teleport(abs(a, { x: 0, y: CR.FY + 1, z: 0 }), { dimension: dimOf(a) }); } catch (e) { /* ignore */ } continue; }
      if (ry < CR.OUT_Y) eliminate(id, "fell");
    }
    if (G.phase === "count") {
      if ((G.until - t) % 20 === 0 && t < G.until) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + Math.ceil((G.until - t) / 20), { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
      if (t >= G.until && !G.job) newRound(a);
      return;
    }
    if (G.phase === "show") {
      const left = G.until - t;
      if (left > 0 && left % 20 === 0) toAll((p) => p.playSound("note.hat", { pitch: 1.6 }));
      if (left <= 0) {
        G.phase = "drop"; G.job = true;
        toAll((p) => { p.playSound("random.explode", { volume: 0.4, pitch: 1.6 }); });
        system.runJob((function* () { yield* vanish(a, G.pat, G.ci, G.vanish); if (G) { G.job = false; G.until = system.currentTick + 50; } })());
      }
      return;
    }
    if (G.phase === "drop" && !G.job && t >= G.until) {
      if (G.alive.length === 0) { finish(G.roundStart.filter((id) => G.pl[id])); return; }     // the last ones fell together: they win together
      if (G.alive.length === 1) { finish([G.alive[0]]); return; }
      newRound(a);
    }
  } catch (e) { console.warn("[colors] tick: " + e); }
}, 1);
// effects, the bar, viewers off the floor
system.runInterval(() => {
  if (!G) return;
  const a = hall(); if (!a) return;
  const t = system.currentTick;
  for (const id of Object.keys(G.pl)) { const p = online(id); if (!p) continue; try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("weakness", 30, { amplifier: 255, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ } }
  for (const p of world.getAllPlayers()) {
    if (!inHall(p)) continue;
    const l = p.location;
    if (!G.alive.includes(p.id) && !owner(p) && onFloorArea(a, l) && l.y - a.cy > CR.FY - 1 && G.phase !== "end") { try { p.teleport(abs(a, CR.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: CR.FY, z: 0 }) }); } catch (e) { /* ignore */ } continue; }
    if (G.phase === "show" && G.ci !== null) {
      const frac = Math.max(0, (G.until - t) / G.dur), n = Math.ceil(frac * 20), col = COLORS[G.ci].c;
      bar(p, cName(p, G.ci) + " §r" + col + "█".repeat(n) + "§8" + "█".repeat(20 - n) + " §f" + Math.max(0, (G.until - t) / 20).toFixed(1) + "s");
    } else if (G.phase !== "count") bar(p, "§d§lCOLOR RUSH §r§7| §f" + pick(p, "Round ", "الجولة ") + G.round + " §7| §a" + G.alive.length + " " + pick(p, "left", "باقين"));
  }
}, 4);
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
const near = (d, x, z, m) => { const a = hall(); return !!a && a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!colorAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  ev.cancel = true; deny(ev.player, "§c[Color Rush] You can't break the hall.", "§c[تحدي الألوان] ما تقدر تكسر القاعة.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && DANGER.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[Color Rush] You can't use this item here.", "§c[تحدي الألوان] ما تقدر تستخدم هذا الغرض هنا."); }
  if (!colorAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item) deny(p, "§c[Color Rush] Building is not allowed here.", "§c[تحدي الألوان] البناء ممنوع هنا.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!hall()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !colorAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function colorsPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => colorsPage(player, back), a = hall(), c = conf();
  const f = makeOpr("Event: Color Rush", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(round " + G.round + ", " + G.alive.length + " left)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§d§lColor Rush\n§r§7A colour is called: run onto it!\n§r§7The rest of the floor vanishes.\n§r§7Hall: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/colors", "textures/blocks/wool_colored_magenta", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the hall here\n§r§7A 33 x 33 colour floor over a pit,\n§r§7glass, walkway, colour panels\n§r§7(53 x 53). The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the Color Rush hall here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 53 x 53 blocks around you", "§7is replaced (Undo puts it back)."], () => buildColors(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 0, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 2, hdr(1, "g") + "§f§lFloor\n§r§7Now: §e" + (c.mode === "mixed" ? "MIXED §7(every block its own colour)" : "PATCHES §7(3 x 3 of one colour)") + "\n§r§eClick to change", c.mode === "mixed" ? "textures/blocks/wool_colored_light_blue" : "textures/blocks/wool_colored_lime", { run: () => { c.mode = c.mode === "mixed" ? "patches" : "mixed"; saveCfg(); self(); } });
    set(f, 1 * COLS + 3, hdr(Math.max(1, c.first)) + "§f§lTime to find the colour\n§r§7First round: §e" + c.first + " s\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.first = FIRST[(FIRST.indexOf(c.first) + 1) % FIRST.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 5, hdr(1, c.step ? "g" : "c") + "§f§lFaster every round\n§r§7Now: §e" + (c.step ? "-" + c.step + " s per round" : "OFF (same time)") + "\n§r§7(never under 1 s)\n§r§eClick to change", "textures/items/sugar", { run: () => { c.step = STEP[(STEP.indexOf(c.step) + 1) % STEP.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(1) + "§f§lBlocks vanish\n§r§7Now: §e" + (c.vanish === 0 ? "at once" : c.vanish / 20 + " s (in waves)") + "\n§r§eClick to change", "textures/blocks/barrier", { run: () => { c.vanish = VANISH[(VANISH.indexOf(c.vanish) + 1) % VANISH.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 8, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, countdown " + COUNT + " s\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startColors(player); if (r.err) say(player, "§c[Color Rush] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the walkway", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, CR.view), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: CR.FY, z: 0 }) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the hall\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Color Rush hall?", ["§7The land comes back as it was."], () => undoColors(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lRound " + G.round + "\n§r§7Left: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; everybody goes back."], () => stopColors(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf();
  const f = makeOpr("Color Rush: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/blocks/wool_colored_lime" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[Color Rush] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody in the hall\n§r§7Adds the players who are in the hall", "textures/blocks/wool_colored_lime", { run: () => {
    for (const p of world.getAllPlayers()) if (inHall(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
colorHook.page = colorsPage;

// ---------------------------------------------------------------- /colors (every player)
export function colorsMenu(player) {
  const f = makeOpr("Color Rush", SHORT_ROWS); f.self = () => colorsMenu(player); f.glass = true;
  const a = hall();
  let top = []; try { top = ranking("colors").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§d§lColor Rush\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/blocks/wool_colored_magenta", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Round: §e" + G.round + "\n§r§7Left: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lGo to the hall\n§r§7" + (a ? "The walkway (watch the game)" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, "colors")) return;
    teleportWithFx(player, abs(a, CR.view), a.d, "colors", () => tell(player, "§a[Color Rush] Welcome!", "§a[تحدي الألوان] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.cw ?? 0) + "\n§r§7Losses: §c" + (s.cl ?? 0), "textures/blocks/wool_colored_magenta", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:colors", description: "Color Rush: the game, the hall, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { colorsMenu(p); } catch (e) { console.warn("[colors] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[colors] command: " + e); }
});
