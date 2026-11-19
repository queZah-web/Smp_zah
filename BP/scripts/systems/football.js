// ===================================================================================================================
// FOOTBALL (event)  -  /opr > Building > Stadium  or  /opr > Events > Football  (Owner)   and   /football (every player)
//
// The Owner builds the stadium (stadiumdesign.js) once, then runs matches:
//   * chooses the players (online players, or everybody standing on the pitch), the team size (1 - 10) and the time (5 - 60 min)
//   * Start: the teams are made at RANDOM.  BLUE team = blue diamond + white iron kit, defends the north goal.  RED team = black netherite + red kit,
//     defends the south goal.  Everybody is sent to the half of his team; his own armour waits in a locker (a hidden barrel
//     under the pitch) and comes back at the end; Adventure mode (nobody can break / place); nobody can be hurt.
//   * the BALL is a sulfur cube (smp:football: it looks like the sulfur cube, no AI, can't be hurt, can't despawn)
//       hit it (left click)             = kick where you look  (sprint = hard shot, sneak = soft touch, look up = high ball)
//       right-click it                  = short pass
//       walk into it                    = dribble (it rolls)
//     every player gets a wooden spear (longer reach) - any hit works.  The ball can NEVER leave the white line: it bounces back.
//   * a countdown, then kick-off.  GOAL: title with the name of the scorer + effects for everybody in the stadium, the point
//     goes to the team, the ball goes back to the middle, the players go back to their halves, and after 30 s ONLY the team
//     that conceded can touch the ball first (kick-off).  The clock stops during that pause.
//   * rules: no hitting players (a foul: 3 fouls = 30 s on the bench), no breaking, nobody leaves the pitch, spectators
//     who walk onto the pitch are sent to the stands.
//   * time over: the winner (or a draw) is shown, the goals of the match are listed, the stats are saved (/football).
//   * the 2 scoreboards in the stadium show the score and the time.
// No lag: one ball, one 1-tick loop only while a match runs (a few math lines), the rest every 0.5 s / 1 s.
// ===================================================================================================================
import { world, system, ItemStack, EquipmentSlot, ItemLockMode, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, stadiumHook } from "./spawnbuild.js";
import { STADIUM as S, stadiumGen, lockerAt, screenPx, screenPixels, SCR } from "./stadiumdesign.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "fb:std", MKEY = "fb:m", STAT_KEY = "fb:st", PEND_KEY = "fb:pend", CFG_KEY = "fb:cfg";
const BALL = "smp:football", KIT_LORE = "§8Football match item";
const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MINUTES = [5, 10, 15, 20, 32, 45, 60];
const KICKOFF_PAUSE = 30, START_COUNT = 10, FOULS_OUT = 3, BENCH_SECS = 30;
const TEAM = {
  // the two kits look completely different (not only a dye colour): BLUE = shiny blue diamond + white iron, RED = black netherite + red
  b: { name: "BLUE", ar: "الأزرق", col: "§9", side: -1, armor: ["minecraft:diamond_helmet", "minecraft:diamond_chestplate", "minecraft:iron_leggings", "minecraft:diamond_boots"], kit: [null, null, null, null] },
  r: { name: "RED", ar: "الأحمر", col: "§c", side: 1, armor: ["minecraft:netherite_helmet", "minecraft:netherite_chestplate", "minecraft:netherite_leggings", "minecraft:leather_boots"], kit: [null, null, null, [0.85, 0.1, 0.1]] },
};
const other = (t) => (t === "b" ? "r" : "b");
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[football] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const alive = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (x) { return false; } };
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[football] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);

// ---------------------------------------------------------------- the stadium record
let std;                     // { d, cx, cy, cz, x1..z2, tiles, t }
const stadium = () => { if (std === undefined) std = readJson(KEY, null); return std; };
const saveStd = () => writeJson(KEY, std);
addZoneSource(() => (stadium() ? [stadium()] : []));
const dimOf = (s) => { try { return world.getDimension(s.d); } catch (e) { return null; } };
const abs = (s, l) => ({ x: s.cx + l.x + 0.5, y: s.cy + l.y, z: s.cz + l.z + 0.5 });
const rel = (s, loc) => ({ u: loc.x - s.cx - 0.5, y: loc.y - s.cy, w: loc.z - s.cz - 0.5 });
export const stadiumAt = (d, x, y, z) => { const s = stadium(); return s && s.d === d && x >= s.x1 && x <= s.x2 && y >= s.y1 && y <= s.y2 && z >= s.z1 && z <= s.z2 ? s : null; };
const inStadium = (p) => { const s = stadium(); if (!s) return false; const l = p.location; return !!stadiumAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const onPitch = (s, loc, m = 0) => { const r = rel(s, loc); return Math.abs(r.u) <= 20.5 + m && Math.abs(r.w) <= 34.5 + m && r.y >= -1 && r.y <= 9; };

let cfg = null;
const conf = () => (cfg ??= { size: 5, min: 15, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());
let stats = null, statDirty = false;
const st = () => (stats ??= readJson(STAT_KEY, {}));
const statOf = (id, n) => { const s = st(); const v = (s[id] ??= { n, g: 0, m: 0, w: 0 }); if (n) v.n = n; return v; };
system.runInterval(() => { if (statDirty) { statDirty = false; writeJson(STAT_KEY, st()); } }, 200);

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, s) {
  const t0 = Date.now();
  try {
    addAreas(dim, s, "smp_stadium_");
    if (!(yield* waitLoaded(player, dim, s, "[Stadium] Building:"))) { removeAreas(dim, "smp_stadium_"); say(player, "§c[Stadium] The area could not be loaded. Stand in the middle and try again."); return; }
    s.tiles = [];
    const TILE = 51;
    for (let x = s.x1; x <= s.x2; x += TILE) for (let z = s.z1; z <= s.z2; z += TILE) {
      const id = "smp:stadium_" + s.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: s.y1, z }, { x: Math.min(x + TILE - 1, s.x2), y: s.y2, z: Math.min(z + TILE - 1, s.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        s.tiles.push({ id, x, y: s.y1, z });
      } catch (e) { console.warn("[football] backup: " + e); }
      bar(player, "§a[Stadium] §fSaving the land for Undo... §e" + s.tiles.length);
      yield;
    }
    std = s; saveStd();                                                 // protected from now on
    bar(player, "§a[Stadium] §fDesigning...");
    const g = stadiumGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const cols = S.HX * 2 + 1, total = canvas.size + cols * 2;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[Stadium] §fBuilding the stadium... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -S.HX; x <= S.HX; x++) {
      try { dim.fillBlocks(new BlockVolume({ x: s.cx + x, y: s.cy + 1, z: s.cz - S.HZ }, { x: s.cx + x, y: s.cy + S.UP, z: s.cz + S.HZ }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: s.cx + x, y: s.cy - S.DOWN, z: s.cz - S.HZ }, { x: s.cx + x, y: s.cy - 1, z: s.cz + S.HZ }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: s.cx + b[i], y: s.cy + b[i + 1], z: s.cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    removeAreas(dim, "smp_stadium_");
    shown.clear();
    bar(player, "§a[Stadium] §fDone!");
    say(player, "§a[Stadium] The stadium is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aStart a match in §f/opr > Events > Football§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[football] build: " + e); say(player, "§c[Stadium] Building stopped: " + e); removeAreas(dim, "smp_stadium_"); }
  finally { busy = false; }
}
export function buildStadium(player) {
  if (!owner(player)) return say(player, "§c[Stadium] Only the Owner can build the stadium.");
  if (busy) return say(player, "§c[Stadium] The stadium is being built right now.");
  if (stadium()) return say(player, "§c[Stadium] The stadium already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - S.DOWN < hr.min || cy + S.UP >= hr.max) return say(player, "§c[Stadium] Too high or too low here. Stand on normal ground.");
  const s = { d: dim.id, cx, cy, cz, x1: cx - S.HX - 1, y1: cy - S.DOWN, z1: cz - S.HZ - 1, x2: cx + S.HX + 1, y2: cy + S.UP, z2: cz + S.HZ + 1, t: Date.now() };
  let clash = false;
  try { clash = spawnOverlaps(s.d, s) || otherZoneOverlaps(s.d, s); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Stadium] Too close to the spawn, an arena or the AFK hall. Move away and try again.");
  busy = true;
  say(player, "§a[Stadium] Building the stadium (85 x 109)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "stadium", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, s));
}
function* undoJob(player, dim, s) {
  try {
    addAreas(dim, s, "smp_stadium_");
    if (!(yield* waitLoaded(player, dim, s, "[Stadium] Undo:"))) { removeAreas(dim, "smp_stadium_"); say(player, "§c[Stadium] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of s.tiles ?? []) {
      try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[football] undo: " + e); }
      try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ }
      yield;
    }
    std = null; saveStd();
    removeAreas(dim, "smp_stadium_");
    say(player, ok && ok === (s.tiles ?? []).length ? "§a[Stadium] Removed: the land is back as it was." : "§e[Stadium] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoStadium(player) {
  const s = stadium(); if (!owner(player) || busy || !s) return;
  if (M) return say(player, "§c[Stadium] Stop the match first.");
  const dim = dimOf(s); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, s));
}

// ---------------------------------------------------------------- the scoreboards (only the pixels that changed are set)
const shown = new Map();                 // "sz|c|r" -> on
function drawScreens(blue, red, secs) {
  const s = stadium(); if (!s) return;
  const dim = dimOf(s); if (!dim) return;
  const on = perm(SCR.on), off = perm(SCR.off);
  for (const sc of S.screens) for (const px of screenPixels(blue, red, secs)) {
    const k = sc.sz + "|" + px.c + "|" + px.r;
    if (shown.get(k) === px.on) continue;
    const p = screenPx(sc.sz, px.c, px.r);
    try { const b = dim.getBlock({ x: s.cx + p.x, y: s.cy + p.y, z: s.cz + p.z }); if (!b) continue; b.setPermutation(px.on ? on : off); shown.set(k, px.on); } catch (e) { /* not loaded */ }
  }
}

// ---------------------------------------------------------------- the match
let M = null;   // { teams: {b: [ids], r: [ids]}, pl: {id: {t, n, locker, gm, back, fouls, out}}, score: {b, r}, left, phase, until, kick, last, goals: [], ball }
const saveM = () => writeJson(MKEY, M ? { pl: M.pl } : null);   // only what is needed to give everything back after a restart
export const matchView = () => (M ? { phase: M.phase, score: { ...M.score }, left: M.left, teams: { b: [...M.teams.b], r: [...M.teams.r] }, goals: [...M.goals] } : null);

function kitItem(id, rgb, team) {
  const it = new ItemStack(id, 1);
  try { const d = it.getComponent("minecraft:dyeable"); if (d && rgb) d.color = { red: rgb[0], green: rgb[1], blue: rgb[2] }; } catch (e) { /* not dyeable */ }
  try { it.nameTag = TEAM[team].col + "§l" + TEAM[team].name + " TEAM"; } catch (e) { /* ignore */ }
  try { it.setLore([KIT_LORE]); } catch (e) { /* ignore */ }
  try { it.keepOnDeath = true; } catch (e) { /* ignore */ }
  try { it.lockMode = ItemLockMode.slot; } catch (e) { /* ignore */ }
  return it;
}
function spear(team) {
  let it = null;
  for (const id of ["minecraft:wooden_spear", "minecraft:wooden_sword"]) { try { it = new ItemStack(id, 1); break; } catch (e) { it = null; } }
  if (!it) return null;
  try { it.nameTag = TEAM[team].col + "§lMatch spear"; it.setLore([KIT_LORE, "§7Hit the ball to kick it"]); it.keepOnDeath = true; it.lockMode = ItemLockMode.inventory; } catch (e) { /* ignore */ }
  return it;
}
const SLOTS = () => [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const lockerBox = (n) => { const s = stadium(); if (!s) return null; try { const l = lockerAt(n); return dimOf(s).getBlock({ x: s.cx + l.x, y: s.cy + l.y, z: s.cz + l.z })?.getComponent("minecraft:inventory")?.container ?? null; } catch (e) { return null; } };
const mem = new Map();                    // fallback when a locker can not be used: player id -> ItemStack[] (kept in memory)

function equip(p, rec) {
  const eq = p.getComponent("minecraft:equippable"), box = lockerBox(rec.locker), keep = [];
  SLOTS().forEach((slot, i) => {
    let it; try { it = eq?.getEquipment(slot); } catch (e) { it = undefined; }
    if (!it) return;
    if (box) { try { box.setItem(i, it); } catch (e) { keep[i] = it; } } else keep[i] = it;
    try { eq.setEquipment(slot, undefined); } catch (e) { /* ignore */ }
  });
  if (keep.length) mem.set(p.id, keep);
  TEAM[rec.t].armor.forEach((id, i) => { try { eq?.setEquipment(SLOTS()[i], kitItem(id, TEAM[rec.t].kit[i], rec.t)); } catch (e) { /* ignore */ } });
  const sp = spear(rec.t); if (sp) { try { p.getComponent("minecraft:inventory")?.container?.addItem(sp); } catch (e) { /* ignore */ } }
  try { p.setGameMode(GameMode.Adventure ?? GameMode.adventure); } catch (e) { /* ignore */ }
}
const isKit = (it) => { try { return !!it && it.getLore().includes(KIT_LORE); } catch (e) { return false; } };
function unequip(p, rec) {
  const eq = p.getComponent("minecraft:equippable"), inv = p.getComponent("minecraft:inventory")?.container;
  SLOTS().forEach((slot) => { try { if (isKit(eq?.getEquipment(slot))) eq.setEquipment(slot, undefined); } catch (e) { /* ignore */ } });
  if (inv) for (let i = 0; i < inv.size; i++) { try { if (isKit(inv.getItem(i))) inv.setItem(i, undefined); } catch (e) { /* ignore */ } }
  const box = lockerBox(rec.locker), keep = mem.get(p.id) ?? [];
  SLOTS().forEach((slot, i) => {
    let it = keep[i];
    if (!it && box) { try { it = box.getItem(i); if (it) box.setItem(i, undefined); } catch (e) { it = undefined; } }
    if (!it) return;
    try { if (!eq.getEquipment(slot)) { eq.setEquipment(slot, it); return; } } catch (e) { /* ignore */ }
    try { const rest = inv ? inv.addItem(it) : it; if (rest) p.dimension.spawnItem(rest, p.location); } catch (e) { /* ignore */ }
  });
  mem.delete(p.id);
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  try { p.removeEffect("resistance"); } catch (e) { /* ignore */ }
}
// players that must still get their things back (left the game during a match / the server stopped)
const pend = () => readJson(PEND_KEY, {});
function restoreOrKeep(id, rec) {
  const p = online(id);
  if (p) { try { unequip(p, rec); } catch (e) { console.warn("[football] restore: " + e); } return; }
  const all = pend(); all[id] = rec; writeJson(PEND_KEY, all);
}
safe("join", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  const all = pend(), rec = all[player.id]; if (!rec) return;
  if (M?.pl[player.id]) return;
  delete all[player.id]; writeJson(PEND_KEY, Object.keys(all).length ? all : null);
  system.runTimeout(() => { try { unequip(player, rec); tell(player, "§a[Football] Your armour and game mode are back.", "§a[كرة القدم] رجعت لك عدتك ووضع اللعب."); } catch (e) { /* ignore */ } }, 20);
}));
// after a restart in the middle of a match: give everything back
system.runTimeout(() => {
  const old = readJson(MKEY, null); if (!old?.pl) return;
  writeJson(MKEY, null);
  for (const [id, rec] of Object.entries(old.pl)) restoreOrKeep(id, rec);
  removeBalls();
}, 60);

function spotOf(t, i) { const sd = TEAM[t].side; return { x: ((i % 5) - 2) * 6, y: 1, z: sd * (7 + Math.floor(i / 5) * 8) }; }
function toHalves() {
  const s = stadium(); if (!s || !M) return;
  for (const t of ["b", "r"]) M.teams[t].forEach((id, i) => {
    const p = online(id); if (!p) return;
    const sp = abs(s, spotOf(t, i));
    try { p.teleport(sp, { dimension: dimOf(s), facingLocation: abs(s, S.center) }); } catch (e) { /* ignore */ }
  });
}
const everyoneHere = () => world.getAllPlayers().filter((p) => inStadium(p));
const toAll = (fn) => { for (const p of everyoneHere()) { try { fn(p); } catch (e) { /* ignore */ } } };

export function startMatch(player) {
  if (!owner(player)) return { err: "Only the Owner can start a match." };
  const s = stadium(); if (!s) return { err: "Build the stadium first." };
  if (busy) return { err: "The stadium is being built." };
  if (M) return { err: "A match is already running." };
  const c = conf();
  const ids = c.roster.filter((id) => online(id)).slice(0, c.size * 2);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  M = { teams: { b: [], r: [] }, pl: {}, score: { b: 0, r: 0 }, left: c.min * 60, total: c.min * 60, phase: "count", until: system.currentTick + START_COUNT * 20, kick: null, last: null, goals: [], ball: null, rv: { x: 0, z: 0 }, vy: 0, by: player.name };
  ids.forEach((id, i) => {
    const p = online(id), t = i % 2 ? "r" : "b";
    M.teams[t].push(id);
    let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; }
    const l = p.location;
    M.pl[id] = { t, n: p.name, locker: i, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id }, fouls: 0, out: 0 };
  });
  saveM();
  for (const id of ids) { const p = online(id), rec = M.pl[id]; try { equip(p, rec); } catch (e) { console.warn("[football] equip: " + e); } }
  toHalves();
  spawnBall();
  drawScreens(0, 0, M.left);
  for (const id of ids) {
    const p = online(id), t = M.pl[id].t;
    try { p.onScreenDisplay.setTitle(TEAM[t].col + "§l" + pick(p, TEAM[t].name + " TEAM", "الفريق " + TEAM[t].ar), { subtitle: pick(p, "§7You defend the " + (t === "b" ? "north" : "south") + " goal", "§7تدافع عن مرمى " + (t === "b" ? "الشمال" : "الجنوب")), fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    tell(p, "§6[Football] §fYou are in the " + TEAM[t].col + "§l" + TEAM[t].name + "§r§f team. §7Hit the ball to kick (sprint = strong, sneak = soft, look up = high), right-click = pass. Don't hit players!",
      "§6[كرة القدم] §fأنت بالفريق " + TEAM[t].col + "§l" + TEAM[t].ar + "§r§f. §7اضرب الكرة حتى تشوتها (ركض = قوية، انحناء = خفيفة، تباوع فوق = عالية)، كليك يمين = تمريرة. ممنوع تضرب اللاعبين!");
  }
  const line = (t) => M.teams[t].map((id) => M.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§6§l[Football] §r§fA match starts! §9BLUE: §f" + line("b") + " §7vs §cRED: §f" + line("r") + " §7(" + c.min + " min) §e/football",
    "§6§l[كرة القدم] §r§fبدت مباراة! §9الأزرق: §f" + line("b") + " §7ضد §cالأحمر: §f" + line("r") + " §7(" + c.min + " دقيقة) §e/football");
  try { slog(player, "football", null, "match started: " + ids.length + " players, " + c.min + " min"); } catch (e) { /* ignore */ }
  return { ok: true };
}
export function stopMatch(reason = "stopped") {
  if (!M) return;
  const m = M; M = null; saveM();
  removeBalls();
  for (const [id, rec] of Object.entries(m.pl)) restoreOrKeep(id, rec);
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§6[Football] §7The match was stopped.", "§6[كرة القدم] §7انوقفت المباراة.");
}
function endMatch() {
  if (!M) return;
  const m = M; m.phase = "end"; m.until = system.currentTick + 160;
  const { b, r } = m.score, win = b > r ? "b" : r > b ? "r" : null;
  removeBalls();
  toAll((p) => {
    p.onScreenDisplay.setTitle(win ? TEAM[win].col + "§l" + pick(p, TEAM[win].name + " WINS!", "فاز " + TEAM[win].ar + "!") : "§e§l" + pick(p, "DRAW!", "تعادل!"), { subtitle: "§9" + b + " §f- §c" + r, fadeInDuration: 5, stayDuration: 100, fadeOutDuration: 20 });
    p.playSound("random.totem", { volume: 0.6 });
  });
  celebrate(0, -S.LZ + 8, 6); celebrate(0, S.LZ - 8, 6);
  const scorers = new Map(); for (const g of m.goals) if (!g.own) scorers.set(g.n, (scorers.get(g.n) ?? 0) + 1);
  const top = [...scorers].sort((a, c) => c[1] - a[1]);
  const list = m.goals.map((g) => "§7" + fmt(g.at) + " " + TEAM[g.t].col + "⚽ §f" + g.n + (g.own ? " §7(own goal)" : "")).join("\n");
  for (const p of world.getAllPlayers()) tell(p,
    "§6§l[Football] Full time! §r§9BLUE §f" + b + " - " + r + " §cRED" + (win ? " §7- " + TEAM[win].col + "§l" + TEAM[win].name + " wins!" : " §7- §eDraw") + (list ? "\n" + list : "") + (top.length ? "\n§6Best: §f" + top[0][0] + " §7(" + top[0][1] + ")" : ""),
    "§6§l[كرة القدم] انتهت المباراة! §r§9الأزرق §f" + b + " - " + r + " §cالأحمر" + (win ? " §7- فاز " + TEAM[win].col + "§l" + TEAM[win].ar + "!" : " §7- §eتعادل") + (list ? "\n" + list : "") + (top.length ? "\n§6الأفضل: §f" + top[0][0] + " §7(" + top[0][1] + ")" : ""));
  for (const [id, rec] of Object.entries(m.pl)) { const v = statOf(id, rec.n); v.m++; if (win && rec.t === win) v.w++; }
  statDirty = true;
}

// ---------------------------------------------------------------- the ball
function removeBalls() {
  const s = stadium(); if (!s) return;
  try { for (const e of dimOf(s).getEntities({ type: BALL })) { try { e.remove(); } catch (x) { /* ignore */ } } } catch (e) { /* ignore */ }
  if (M) M.ball = null;
}
function spawnBall() {
  const s = stadium(); if (!s || !M) return null;
  removeBalls();
  try { M.ball = dimOf(s).spawnEntity(BALL, abs(s, S.center)); M.ball.nameTag = ""; } catch (e) { console.warn("[football] ball: " + e); M.ball = null; }
  M.rv = { x: 0, z: 0 }; M.vy = 0;
  return M.ball;
}
function hold(ball) {                       // the ball waits in the middle
  const s = stadium();
  try { const c = abs(s, S.center), l = ball.location; if (Math.abs(l.x - c.x) > 0.05 || Math.abs(l.z - c.z) > 0.05 || l.y > c.y + 0.2) ball.teleport(c); ball.clearVelocity(); } catch (e) { /* ignore */ }
  M.rv = { x: 0, z: 0 };
}
function kick(p, power, lift) {
  const ball = M?.ball; if (!alive(ball)) return;
  const v = p.getViewDirection(), h = Math.hypot(v.x, v.z) || 1;
  const vx = (v.x / h) * power, vz = (v.z / h) * power, vy = lift + Math.max(0, v.y) * (power > 0.6 ? 0.9 : 0.4);
  try { ball.clearVelocity(); ball.applyImpulse({ x: vx, y: Math.min(1.1, vy), z: vz }); } catch (e) { return; }
  M.rv = { x: vx, z: vz }; M.last = p.id;
  try { p.dimension.playSound("mob.slime.big", ball.location, { volume: 0.8, pitch: 1.4 }); } catch (e) { /* ignore */ }
  try { p.dimension.spawnParticle("minecraft:critical_hit_emitter", ball.location); } catch (e) { /* ignore */ }
}
const lastKick = new Map();
function touch(p, mode) {
  if (!M || !alive(M.ball)) return;
  const rec = M.pl[p.id];
  if (!rec) return bar(p, pick(p, "§7You are not playing in this match.", "§7أنت مو لاعب بهذي المباراة."));
  if (rec.out > system.currentTick) return bar(p, pick(p, "§cYou are on the bench (fouls).", "§cأنت على الدكة (أخطاء)."));
  if (M.phase !== "play") return bar(p, pick(p, "§eWait for the kick-off!", "§eانتظر ضربة البداية!"));
  if (M.kick && rec.t !== M.kick) return bar(p, pick(p, "§eKick-off for " + TEAM[M.kick].col + TEAM[M.kick].name + "§e: wait until they touch the ball.", "§eضربة البداية لـ " + TEAM[M.kick].col + TEAM[M.kick].ar + "§e: انتظر لين يلمسون الكرة."));
  const t = system.currentTick; if (t - (lastKick.get(p.id) ?? -99) < 4) return; lastKick.set(p.id, t);
  if (M.kick) { M.kick = null; toAll((q) => bar(q, "§a§l" + pick(q, "PLAY!", "العب!"))); }
  if (mode === "pass") return kick(p, 0.55, 0.12);
  let sprint = false, sneak = false; try { sprint = p.isSprinting; sneak = p.isSneaking; } catch (e) { /* ignore */ }
  kick(p, sneak ? 0.4 : sprint ? 1.35 : 0.95, sneak ? 0.06 : 0.22);
}
safe("hit", () => world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: a, hitEntity: b }) => {
  if (!M || !a || a.typeId !== "minecraft:player" || !b) return;
  if (b.typeId === BALL) return touch(a, "kick");
  if (b.typeId === "minecraft:player" && M.pl[a.id] && M.pl[b.id] && M.phase !== "end") foul(a, b);
}));
safe("pass", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== BALL) return;
  ev.cancel = true;
  const p = ev.player; system.run(() => touch(p, "pass"));
}));
function foul(a, b) {
  const rec = M.pl[a.id]; rec.fouls++;
  if (rec.fouls < FOULS_OUT) {
    tell(a, "§e[Football] Foul! §7Don't hit players (" + rec.fouls + "/" + FOULS_OUT + ").", "§e[كرة القدم] خطأ! §7ممنوع تضرب اللاعبين (" + rec.fouls + "/" + FOULS_OUT + ").");
    toAll((q) => q.sendMessage("§e⚠ §f" + a.name + " §7" + pick(q, "fouled", "سوّى خطأ على") + " §f" + b.name));
    return;
  }
  rec.fouls = 0; rec.out = system.currentTick + BENCH_SECS * 20;
  const s = stadium(), dug = S.dug[rec.t === "b" ? "blue" : "red"];
  try { a.teleport(abs(s, dug), { dimension: dimOf(s), facingLocation: abs(s, S.center) }); } catch (e) { /* ignore */ }
  toAll((q) => q.sendMessage("§c🟥 §f" + a.name + " §7" + pick(q, "is on the bench for " + BENCH_SECS + " s (3 fouls)", "على الدكة " + BENCH_SECS + " ثانية (3 أخطاء)")));
}

// the ball can not leave the white line; rolling; goals
const LIM_U = S.LX + 0.5 - 0.5, LIM_W = S.LZ + 0.5 - 0.5, MOUTH = S.GW + 0.5 - 0.5;
function ballTick() {
  const s = stadium(), ball = M.ball;
  if (!alive(ball)) { spawnBall(); return; }
  if (M.phase !== "play" || M.kick) { hold(ball); return; }
  let l, v; try { l = ball.location; v = ball.getVelocity(); } catch (e) { return; }
  const r = rel(s, l);
  // goal: the whole ball is over the line, between the posts, under the crossbar
  if (Math.abs(r.w) > S.LZ + 1.0 && Math.abs(r.u) < MOUTH + 0.5 && r.y < 1 + S.GH) { goal(r.w < 0 ? "r" : "b"); return; }
  let nu = r.u, nw = r.w, bounce = false, vx = v.x, vz = v.z;
  if (Math.abs(nu) > LIM_U) { nu = Math.sign(nu) * (LIM_U - 0.05); vx = -vx * 0.5; M.rv.x = -M.rv.x * 0.5; bounce = true; }
  const inMouth = Math.abs(r.u) < MOUTH && r.y < 1 + S.GH;
  if (Math.abs(nw) > LIM_W && !inMouth) { nw = Math.sign(nw) * (LIM_W - 0.05); vz = -vz * 0.5; M.rv.z = -M.rv.z * 0.5; bounce = true; }
  if (Math.abs(nw) > S.LZ + 3.2) { nw = Math.sign(nw) * (S.LZ + 3.2); vz = 0; M.rv.z = 0; bounce = true; }   // in the net
  if (r.y > 14) { vx *= 0.5; vz *= 0.5; bounce = true; }
  if (r.y < 0.5) { bounce = true; }
  if (bounce) {
    try { ball.teleport({ x: s.cx + 0.5 + nu, y: Math.max(s.cy + 1, Math.min(l.y, s.cy + 14)), z: s.cz + 0.5 + nw }); ball.clearVelocity(); ball.applyImpulse({ x: vx, y: Math.min(0, v.y), z: vz }); } catch (e) { /* ignore */ }
    M.vy = 0; return;
  }
  // rolling: on the ground the ball keeps a part of its speed (it would stop at once otherwise); a hard landing bounces
  let ground = false; try { ground = ball.isOnGround; } catch (e) { ground = false; }
  const hs = Math.hypot(v.x, v.z), rs = Math.hypot(M.rv.x, M.rv.z);
  if (ground) {
    if (M.vy < -0.35) { try { ball.applyImpulse({ x: 0, y: -M.vy * 0.45, z: 0 }); } catch (e) { /* ignore */ } }
    if (hs > rs) M.rv = { x: v.x, z: v.z };                                   // pushed by a player (dribble)
    else if (rs > 0.04) {
      const blockedX = Math.abs(M.rv.x) > 0.08 && Math.abs(v.x) < 0.01, blockedZ = Math.abs(M.rv.z) > 0.08 && Math.abs(v.z) < 0.01;
      if (blockedX) M.rv.x = -M.rv.x * 0.5;                                    // hit a wall / a post: bounce back
      if (blockedZ) M.rv.z = -M.rv.z * 0.5;
      try { ball.applyImpulse({ x: M.rv.x - v.x, y: 0, z: M.rv.z - v.z }); } catch (e) { /* ignore */ }
    }
    M.rv = { x: M.rv.x * 0.93, z: M.rv.z * 0.93 };
    if (Math.hypot(M.rv.x, M.rv.z) < 0.04) M.rv = { x: 0, z: 0 };
  } else M.rv = { x: v.x, z: v.z };
  M.vy = v.y;
}
function celebrate(u, w, n = 4) {
  const s = stadium(), dim = dimOf(s); if (!dim) return;
  for (let i = 0; i < n; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) {
      const at = { x: s.cx + 0.5 + u + (Math.random() - 0.5) * 10, y: s.cy + 3 + Math.random() * 6, z: s.cz + 0.5 + w + (Math.random() - 0.5) * 6 };
      try { dim.spawnParticle("minecraft:totem_particle", at); dim.spawnParticle("minecraft:huge_explosion_emitter", at); } catch (e) { /* ignore */ }
    }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", abs(s, { x: u, y: 4, z: w }), { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
}
function goal(t) {
  const s = stadium(), lastRec = M.last ? M.pl[M.last] : null;
  const own = !!lastRec && lastRec.t !== t, name = lastRec ? lastRec.n : "?";
  M.score[t]++;
  M.goals.push({ t, n: name, own, at: M.total - M.left });
  if (lastRec && !own) { statOf(M.last, name).g++; statDirty = true; }
  M.phase = "goal"; M.until = system.currentTick + KICKOFF_PAUSE * 20; M.kick = other(t); M.moved = false;
  removeBalls(); spawnBall();
  drawScreens(M.score.b, M.score.r, M.left);
  celebrate(0, (t === "b" ? 1 : -1) * (S.LZ + 1), 5);
  toAll((p) => {
    p.onScreenDisplay.setTitle(TEAM[t].col + "§l" + pick(p, "GOAL!", "هدف!"), { subtitle: own ? "§f" + name + " §7" + pick(p, "own goal!", "هدف بالغلط!") : "§f" + name + " §7" + pick(p, "scores for ", "سجل لـ ") + TEAM[t].col + pick(p, TEAM[t].name, TEAM[t].ar), fadeInDuration: 3, stayDuration: 50, fadeOutDuration: 10 });
    p.playSound("random.levelup", { volume: 0.7 });
    p.sendMessage("§6⚽ " + TEAM[t].col + "§l" + pick(p, "GOAL", "هدف") + " §r§f" + name + (own ? " §7(" + pick(p, "own goal", "بالغلط") + ")" : "") + " §7| §9" + M.score.b + " §f- §c" + M.score.r);
  });
  system.runTimeout(() => { if (M && M.phase === "goal") toHalves(); }, 60);
}

// the 1-tick loop (only while a match runs) + the 0.5 s loop (players, spectators, display)
system.runInterval(() => {
  if (!M || !stadium()) return;
  try {
    const t = system.currentTick;
    if ((M.phase === "count" || M.phase === "goal") && t >= M.until) {
      M.phase = "play";
      toAll((p) => { p.onScreenDisplay.setTitle("§a§l" + pick(p, "KICK-OFF!", "ابدأ!"), { subtitle: M.kick ? TEAM[M.kick].col + pick(p, TEAM[M.kick].name + " kicks off", "ضربة البداية لـ " + TEAM[M.kick].ar) : "", fadeInDuration: 2, stayDuration: 25, fadeOutDuration: 8 }); p.playSound("note.pling", { pitch: 1.5 }); });
    }
    if (M.phase === "end") { if (t >= M.until) stopMatch("end"); return; }
    ballTick();
  } catch (e) { console.warn("[football] tick: " + e); }
}, 1);
let secAcc = 0;
system.runInterval(() => {
  if (!M) return;
  const s = stadium(); if (!s) { stopMatch(); return; }
  try {
    const t = system.currentTick;
    if (M.phase === "play" && !M.paused) { secAcc += 0.5; if (secAcc >= 1) { secAcc -= 1; M.left--; drawScreens(M.score.b, M.score.r, M.left); if (M.left <= 0) { endMatch(); return; } if (M.left === 60) toAll((p) => p.sendMessage("§e[Football] " + pick(p, "1 minute left!", "باقي دقيقة!"))); } }
    // the players: no damage, no hunger, on the pitch
    for (const [id, rec] of Object.entries(M.pl)) {
      const p = online(id); if (!p) continue;
      try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
      if (M.phase === "end") continue;
      const benched = rec.out > t, dug = abs(s, S.dug[rec.t === "b" ? "blue" : "red"]);
      if (benched) { const l = p.location; if (Math.hypot(l.x - dug.x, l.z - dug.z) > 4) try { p.teleport(dug, { dimension: dimOf(s) }); } catch (e) { /* ignore */ } continue; }
      if (rec.out && rec.out <= t) { rec.out = 0; tell(p, "§a[Football] You are back in the game.", "§a[كرة القدم] رجعت للعب."); try { p.teleport(abs(s, spotOf(rec.t, 0)), { dimension: dimOf(s) }); } catch (e) { /* ignore */ } continue; }
      if (p.dimension.id !== s.d || !onPitch(s, p.location)) { try { p.teleport(abs(s, spotOf(rec.t, M.teams[rec.t].indexOf(id))), { dimension: dimOf(s), facingLocation: abs(s, S.center) }); } catch (e) { /* ignore */ } bar(p, pick(p, "§cStay on the pitch!", "§cخليك داخل الملعب!")); }
    }
    // spectators: not on the pitch (the Owner may stay as the referee)
    const left = M.left, phase = M.phase, sc = M.score;
    for (const p of world.getAllPlayers()) {
      if (!inStadium(p)) continue;
      if (!M.pl[p.id]) {
        try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); } catch (e) { /* ignore */ }
        if (!owner(p) && onPitch(s, p.location, -0.5) && phase !== "end") { try { p.teleport(abs(s, S.view), { dimension: dimOf(s), facingLocation: abs(s, S.center) }); } catch (e) { /* ignore */ } tell(p, "§e[Football] A match is running: watch it from the stands.", "§e[كرة القدم] فيه مباراة: تابعها من المدرجات."); }
      }
      let extra = "";
      if (phase === "count" || phase === "goal") extra = " §7| §e" + pick(p, "kick-off in ", "البداية بعد ") + Math.max(0, Math.ceil((M.until - t) / 20)) + "s" + (M.kick ? " " + TEAM[M.kick].col + "(" + pick(p, TEAM[M.kick].name, TEAM[M.kick].ar) + ")" : "");
      else if (phase === "play" && M.kick) extra = " §7| " + TEAM[M.kick].col + pick(p, TEAM[M.kick].name + " kicks off", "ضربة البداية لـ " + TEAM[M.kick].ar);
      else if (M.paused) extra = " §7| §e" + pick(p, "PAUSED", "متوقفة");
      bar(p, "§9§l" + pick(p, "BLUE", "الأزرق") + " §r§f" + sc.b + " §7- §f" + sc.r + " §c§l" + pick(p, "RED", "الأحمر") + " §r§7| §e" + fmt(left) + extra);
    }
    // a team has nobody left online: the match ends
    if (M.phase !== "end" && (!M.teams.b.some((id) => online(id)) || !M.teams.r.some((id) => online(id)))) endMatch();
  } catch (e) { console.warn("[football] loop: " + e); }
}, 10);
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!M?.pl[player.id]) return;
  const rec = M.pl[player.id];
  const all = pend(); all[player.id] = rec;
  system.run(() => writeJson(PEND_KEY, all));
}));
export function pauseMatch(on) { if (!M || M.phase === "end") return; M.paused = !!on; if (on) { M.prev = M.phase; M.phase = "paused"; } else { M.phase = M.prev ?? "play"; } }
export function resetBall() { if (!M) return; spawnBall(); }

// ---------------------------------------------------------------- protection (only the Owner changes the stadium)
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const LIQUID = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper|flint_and_steel|fire_charge|tnt|end_crystal|respawn_anchor|piston|sticky_piston)$/;
const near = (d, x, z, m) => { const s = stadium(); return !!s && s.d === d && x >= s.x1 - m && x <= s.x2 + m && z >= s.z1 - m && z <= s.z2 + m; };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block; if (!stadiumAt(b.dimension.id, b.x, b.y, b.z) || owner(ev.player)) return;
  ev.cancel = true; deny(ev.player, "§c[Stadium] You can't break the stadium.", "§c[الملعب] ما تقدر تكسر الملعب.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && LIQUID.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[Stadium] You can't use this item at the stadium.", "§c[الملعب] ما تقدر تستخدم هذا الغرض عند الملعب."); }
  if (!stadiumAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item) deny(p, "§c[Stadium] Building is not allowed in the stadium.", "§c[الملعب] البناء ممنوع بالملعب.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!stadium()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !stadiumAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));
safe("drop", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => {   // a match item that falls out somehow is removed
  try { if (M && entity.typeId === "minecraft:item" && isKit(entity.getComponent("minecraft:item")?.itemStack)) entity.remove(); } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- Owner pages
const opr = (title) => { const f = makeOpr(title, SHORT_ROWS); f.glass = true; return f; };
export function footballPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => footballPage(player, back), s = stadium(), c = conf();
  const f = opr("Event: Football"); f.self = self;
  const live = M ? "§a" + (M.phase === "end" ? "full time" : "running") + " §9" + M.score.b + " §f- §c" + M.score.r + " §7(" + fmt(M.left) + ")" : "§fno match";
  set(f, 0 * COLS + 4, hdr(1, M ? "g" : "c") + "§a§lFootball\n§r§7The ball is a sulfur cube. Two teams\n§r§7(random), kits, goals, a timer.\n§r§7Stadium: " + (busy ? "§ebeing built" : s ? "§abuilt §7(" + s.cx + " " + s.cy + " " + s.cz + ")" : "§fnot built") + "\n§r§7Match: " + live + "\n§r§7Players: §f/football", "textures/items/slime_ball", null);
  if (!s) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the stadium here\n§r§7Pitch 35 x 59, stands, roof, locker\n§r§7rooms, scoreboards, floodlights\n§r§7(85 x 109). The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the stadium here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 85 x 109 blocks around you", "§7is replaced (Undo puts it back)."], () => buildStadium(player), self) });
  } else if (!M) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 2, hdr(Math.max(1, c.size)) + "§f§lPlayers per team\n§r§7Now: §e" + c.size + " vs " + c.size + "\n§r§eClick to change", "textures/ui/shop/ic_player", { run: () => { c.size = SIZES[(SIZES.indexOf(c.size) + 1) % SIZES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 4, hdr(Math.min(99, c.min)) + "§f§lMatch time\n§r§7Now: §e" + c.min + " minutes\n§r§eClick to change", "textures/items/clock_item", { run: () => { c.min = MINUTES[(MINUTES.indexOf(c.min) + 1) % MINUTES.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + c.size * 2 + "\n§r§7The teams are made at random\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the match\n§r§7" + Math.min(n, c.size * 2) + " players, " + c.min + " min\n§r§7Kits, teams, countdown " + START_COUNT + " s\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startMatch(player); if (r.err) say(player, "§c[Football] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the stands", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(s, S.view), { dimension: dimOf(s), facingLocation: abs(s, S.center) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the stadium\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the stadium?", ["§7The land comes back as it was."], () => undoStadium(player), self) });
  } else {
    set(f, 2 * COLS + 2, hdr(1, M.paused ? "r" : "g") + "§e§l" + (M.paused ? "Resume" : "Pause") + "\n§r§7The clock and the ball stop\n§r§eClick to " + (M.paused ? "resume" : "pause"), "textures/items/clock_item", { run: () => { pauseMatch(!M.paused); self(); } });
    set(f, 2 * COLS + 3, hdr(1) + "§b§lBall to the middle\n§r§7If the ball is stuck\n§r§eClick", "textures/items/slime_ball", { run: () => { resetBall(); self(); } });
    set(f, 2 * COLS + 5, hdr(1) + "§6§lEnd the match now\n§r§7Shows the winner", "textures/ui/shop/ic_trophy", { run: () => { if (M && M.phase !== "end") endMatch(); self(); } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the match\n§r§7No winner, everything goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the match?", ["§7Nobody wins; the players get their things back."], () => stopMatch(), self) });
    set(f, 1 * COLS + 4, hdr(1) + "§9BLUE: §f" + M.teams.b.map((id) => M.pl[id].n).join(", ") + "\n§r§cRED: §f" + M.teams.r.map((id) => M.pl[id].n).join(", "), "textures/ui/shop/ic_player", null);
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), s = stadium();
  const f = makeOpr("Football: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((a, b) => a.name.localeCompare(b.name)), per = 27, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + c.size * 2 + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/slime_ball" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < c.size * 2) c.roster.push(p.id); else say(player, "§c[Football] The teams are full (" + c.size + " vs " + c.size + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody on the pitch\n§r§7Adds the players standing on the pitch", "textures/blocks/grass_side_carried", { run: () => {
    if (s) for (const p of world.getAllPlayers()) if (p.dimension.id === s.d && onPitch(s, p.location) && !c.roster.includes(p.id) && c.roster.length < c.size * 2) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
stadiumHook.page = footballPage;

// ---------------------------------------------------------------- /football (every player)
export function footballMenu(player) {
  const f = makeOpr("Football", SHORT_ROWS); f.self = () => footballMenu(player); f.glass = true;
  const s = stadium(), top = Object.entries(st()).sort((a, b) => b[1].g - a[1].g || b[1].w - a[1].w).slice(0, 5);
  set(f, 0 * COLS + 4, hdr(1, "g") + "§a§lFootball\n§r§7Matches are started by the Owner.\n§r§6Top scorers:\n" + (top.length ? top.map(([, v], i) => "§r§e" + (i + 1) + ". §f" + v.n + " §7- §a" + v.g + " goals §7(" + v.w + " wins)").join("\n") : "§r§7(nobody yet)"), "textures/items/slime_ball", null);
  if (M) {
    const names = (t) => M.teams[t].map((id) => M.pl[id].n).join(", ");
    set(f, 2 * COLS + 3, hdr(1, "g") + "§f§lMatch now\n§r§9BLUE §f" + M.score.b + " - " + M.score.r + " §cRED\n§r§7Time left: §e" + fmt(M.left) + "\n§r§9" + names("b") + "\n§r§c" + names("r") + (M.goals.length ? "\n§r§7Goals: " + M.goals.map((g) => TEAM[g.t].col + g.n).join("§7, ") : ""), "textures/items/clock_item", null);
  } else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo match right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, s ? "g" : "c") + "§b§lGo to the stadium\n§r§7" + (s ? "The stands (watch the match)" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!s) return;
    if (!canTeleport(player, "football")) return;
    teleportWithFx(player, abs(s, S.view), s.d, "football", () => tell(player, "§a[Football] Welcome to the stadium!", "§a[كرة القدم] أهلاً بالملعب!"));
  } });
  const me = st()[player.id];
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Goals: §a" + (me?.g ?? 0) + "\n§r§7Matches: §f" + (me?.m ?? 0) + "\n§r§7Wins: §e" + (me?.w ?? 0), "textures/items/slime_ball", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:football", description: "Football: the match, the stadium, top scorers", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { footballMenu(p); } catch (e) { console.warn("[football] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[football] command: " + e); }
});
