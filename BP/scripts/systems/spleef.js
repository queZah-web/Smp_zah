// ===================================================================================================================
// SPLEEF (event)  -  /opr > Building > Spleef  or  /opr > Events > Spleef  (Owner)   and   /spleef (every player)
//
// The Owner builds the arena (spleefdesign.js) once, then runs games:
//   * chooses the players (2 - 24: online players, or everybody at the arena), the prize, and "the floor melts" (after
//     2 / 3 / 5 minutes the snow floor shrinks ring by ring from the outside, so a game always ends) or OFF
//   * Start: the snow floor is made new, the players are sent onto it in a circle, each one gets the SPLEEF SHOVEL,
//     10 s countdown (no digging yet), GO
//   * dig the snow under the other players so they fall: falling below the floor = OUT at once (announced to everybody,
//     the player goes to the seats and can't come back into the game)
//   * rules (all enforced): only the Spleef Shovel works (it can break ONLY snow - Adventure mode), no other items (no
//     pearls, no food, no blocks), no placing / rebuilding, no flying, no leaving the arena (= out), no PvP damage /
//     knockback, snow breaks with no drops
//   * the last player on the floor wins: announced, the prize, fireworks.  Wins / losses are saved (/spleef and the
//     SPLEEF leaderboard hologram in the arena).  After the game the snow floor is put back.
//   (Teaming up can't be detected by a script - the Owner watches that.)
// No lag: while a game runs, only the players' positions are checked (every 2 ticks).
// ===================================================================================================================
import { world, system, ItemStack, ItemLockMode, GameMode, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus, EnchantmentTypes } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, spleefHook } from "./spawnbuild.js";
import { SPLEEF as T, spleefGen, inFloor } from "./spleefdesign.js";
import { addFixedAt, removeFixed } from "./hologram.js";
import { ranking } from "./ranks.js";
import { stats, addMoney, touch } from "../data.js";
import { canTeleport, teleportWithFx } from "./util.js";

const KEY = "sp:arena", CFG_KEY = "sp:cfg", MKEY = "sp:m", PEND_KEY = "sp:pend", AREA = "smp_spleef_";
const PRIZES = [0, 1000, 2500, 5000, 10000], MELT = [0, 2, 3, 5], MAX_PLAYERS = 24, COUNT = 10;
const ITEM_LORE = "§8Spleef item";
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[spleef] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { console.warn("[spleef] save " + k + ": " + e); } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");

// ---------------------------------------------------------------- the arena record
let A;
const arena = () => { if (A === undefined) A = readJson(KEY, null); return A; };
const saveA = () => writeJson(KEY, A);
addZoneSource(() => (arena() ? [arena()] : []));
const dimOf = (a) => { try { return world.getDimension(a.d); } catch (e) { return null; } };
const abs = (a, l) => ({ x: a.cx + l.x + 0.5, y: a.cy + l.y, z: a.cz + l.z + 0.5 });
export const spleefAt = (d, x, y, z) => { const a = arena(); return a && a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2 ? a : null; };
const inArena = (p) => { const l = p.location; return !!spleefAt(p.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)); };
const onField = (a, l) => Math.hypot(l.x - a.cx - 0.5, l.z - a.cz - 0.5) <= T.R + 1.6 && l.y - a.cy < T.floorY + 7;
let cfg = null;
const conf = () => (cfg ??= { prize: 2500, melt: 3, roster: [], ...readJson(CFG_KEY, {}) });
const saveCfg = () => writeJson(CFG_KEY, conf());

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Spleef] Building:"))) { removeAreas(dim, AREA); say(player, "§c[Spleef] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = [];
    for (let x = a.x1; x <= a.x2; x += 51) for (let z = a.z1; z <= a.z2; z += 51) {
      const id = "smp:spleef_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + 50, a.x2), y: a.y2, z: Math.min(z + 50, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { console.warn("[spleef] backup: " + e); }
      bar(player, "§a[Spleef] §fSaving the land for Undo... §e" + a.tiles.length); yield;
    }
    A = a; saveA();
    const g = spleefGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + (T.HX * 2 + 1) * 2;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[Spleef] §fBuilding the arena... §e" + pct + "%"); } };
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
    try { const b = addFixedAt(dim.id, a.cx + T.board.x + 0.5, a.cy + T.board.y, a.cz + T.board.z + 0.5, "spleef"); if (b && b !== "full") { a.board = b.id; saveA(); } } catch (e) { console.warn("[spleef] board: " + e); }
    removeAreas(dim, AREA);
    say(player, "§a[Spleef] The arena is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aStart a game in §f/opr > Events > Spleef§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[spleef] build: " + e); say(player, "§c[Spleef] Building stopped: " + e); removeAreas(dim, AREA); }
  finally { busy = false; }
}
export function buildSpleef(player) {
  if (!owner(player)) return say(player, "§c[Spleef] Only the Owner can build the arena.");
  if (busy) return say(player, "§c[Spleef] The arena is being built right now.");
  if (arena()) return say(player, "§c[Spleef] The arena already exists. Undo it first.");
  const dim = player.dimension, l = player.location, cx = Math.floor(l.x), cz = Math.floor(l.z), cy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (cy - T.DOWN < hr.min || cy + T.UP >= hr.max) return say(player, "§c[Spleef] Too high or too low here. Stand on normal ground.");
  const a = { d: dim.id, cx, cy, cz, x1: cx - T.HX - 1, y1: cy - T.DOWN, z1: cz - T.HX - 1, x2: cx + T.HX + 1, y2: cy + T.UP, z2: cz + T.HX + 1, t: Date.now() };
  let clash = false; try { clash = spawnOverlaps(a.d, a) || otherZoneOverlaps(a.d, a); } catch (e) { clash = false; }
  if (clash) return say(player, "§c[Spleef] Too close to the spawn or another building. Move away and try again.");
  busy = true;
  say(player, "§a[Spleef] Building the arena (65 x 65)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "spleef", null, "built at " + cx + " " + cy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, AREA);
    if (!(yield* waitLoaded(player, dim, a, "[Spleef] Undo:"))) { removeAreas(dim, AREA); say(player, "§c[Spleef] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[spleef] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (a.board) { try { removeFixed(a.board); } catch (e) { /* ignore */ } }
    A = null; saveA();
    removeAreas(dim, AREA);
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Spleef] Removed: the land is back as it was." : "§e[Spleef] Removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoSpleef(player) {
  const a = arena(); if (!owner(player) || busy || !a) return;
  if (G) return say(player, "§c[Spleef] Stop the game first.");
  const dim = dimOf(a); if (!dim) return;
  busy = true; system.runJob(undoJob(player, dim, a));
}

// ---------------------------------------------------------------- the snow floor back as new (one fill per row)
function* resetJob() {
  const a = arena(); if (!a) return true;
  const dim = dimOf(a); if (!dim) return false;
  const snow = perm("snow"), y = a.cy + T.floorY;
  for (let x = -T.R; x <= T.R; x++) {
    const h = Math.floor(Math.sqrt(Math.max(0, (T.R + 0.5) ** 2 - x * x)));
    try { dim.fillBlocks(new BlockVolume({ x: a.cx + x, y, z: a.cz - h }, { x: a.cx + x, y, z: a.cz + h }), snow); } catch (e) { /* not loaded */ }
    if (x % 6 === 0) yield;
  }
  try { for (const it of dim.getEntities({ type: "minecraft:item", location: abs(a, { x: 0, y: T.floorY, z: 0 }), maxDistance: T.R + 6 })) it.remove(); } catch (e) { /* ignore */ }
  return true;
}

// ---------------------------------------------------------------- the game
let G = null;     // { phase: "reset" | "count" | "run" | "end", until, pl: { id: { n, gm, back } }, alive: [ids], order: [], start, melt, ring }
const saveG = () => writeJson(MKEY, G ? { pl: G.pl } : null);
export const spleefView = () => (G ? { phase: G.phase, alive: [...G.alive], players: Object.keys(G.pl).length, order: [...G.order] } : null);
const atArena = () => world.getAllPlayers().filter((p) => inArena(p));
const toAll = (fn) => { for (const p of atArena()) { try { fn(p); } catch (e) { /* ignore */ } } };
function shovel() {
  const it = new ItemStack("minecraft:diamond_shovel", 1);
  try { it.nameTag = "§b§lSpleef Shovel"; it.setLore([ITEM_LORE, "§7Breaks only the snow of the arena"]); it.keepOnDeath = true; it.lockMode = ItemLockMode.inventory; } catch (e) { /* ignore */ }
  try { it.setCanDestroy(["minecraft:snow"]); } catch (e) { /* ignore */ }
  try { const en = it.getComponent("minecraft:enchantable"); en?.addEnchantment({ type: EnchantmentTypes.get("efficiency"), level: 5 }); en?.addEnchantment({ type: EnchantmentTypes.get("unbreaking"), level: 3 }); } catch (e) { /* ignore */ }
  return it;
}
const isItem = (it) => { try { return !!it && it.getLore().includes(ITEM_LORE); } catch (e) { return false; } };
function clearItems(p) {
  const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return;
  for (let i = 0; i < inv.size; i++) { try { if (isItem(inv.getItem(i))) inv.setItem(i, undefined); } catch (e) { /* ignore */ } }
}
function giveShovel(p) {
  const inv = p.getComponent("minecraft:inventory")?.container; if (!inv) return false;
  clearItems(p);
  const sel = p.selectedSlotIndex ?? 0;
  try {
    if (!inv.getItem(sel)) { inv.setItem(sel, shovel()); return true; }
    for (let i = 0; i < 9; i++) if (!inv.getItem(i)) { inv.setItem(i, shovel()); try { p.selectedSlotIndex = i; } catch (e) { /* ignore */ } return true; }
    const left = inv.addItem(shovel()); return !left;
  } catch (e) { return false; }
}
function restorePlayer(p, rec) {
  clearItems(p);
  try { if (rec.gm) p.setGameMode(rec.gm); } catch (e) { /* ignore */ }
  try { if (rec.back) p.teleport({ x: rec.back.x, y: rec.back.y, z: rec.back.z }, { dimension: world.getDimension(rec.back.d) }); } catch (e) { /* ignore */ }
  try { p.removeEffect("resistance"); p.removeEffect("weakness"); p.removeEffect("fire_resistance"); } catch (e) { /* ignore */ }
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

const spot = (i, n) => { const ang = (i / Math.max(1, n)) * Math.PI * 2, r = n <= 1 ? 0 : n <= 8 ? 11 : 15; return { x: Math.round(Math.cos(ang) * r), y: T.floorY + 1, z: Math.round(Math.sin(ang) * r) }; };
const seat = (i) => { const a = Math.PI / 2 + ((i % 25) - 12) * 0.06; return { x: Math.round(Math.cos(a) * 29), y: T.view.y, z: Math.round(Math.sin(a) * 29) }; };
const center = (a) => abs(a, { x: 0, y: T.floorY, z: 0 });

export function startGame(player) {
  if (!owner(player)) return { err: "Only the Owner can start a game." };
  const a = arena(); if (!a) return { err: "Build the arena first." };
  if (busy) return { err: "The arena is being built." };
  if (G) return { err: "A game is already running." };
  const c = conf(), ids = c.roster.filter((id) => online(id)).slice(0, MAX_PLAYERS);
  if (ids.length < 2) return { err: "Choose at least 2 online players." };
  G = { phase: "reset", until: 0, pl: {}, alive: [...ids], order: [], prize: c.prize, melt: c.melt, ring: T.R, start: 0, warned: false, by: player.name };
  for (const id of ids) { const p = online(id), l = p.location; let gm; try { gm = p.getGameMode(); } catch (e) { gm = undefined; } G.pl[id] = { n: p.name, gm, back: { x: l.x, y: l.y, z: l.z, d: p.dimension.id } }; }
  saveG();
  ids.forEach((id, i) => { const p = online(id); try { p.teleport(abs(a, seat(i)), { dimension: dimOf(a), facingLocation: center(a) }); } catch (e) { /* ignore */ } });
  const names = ids.map((id) => G.pl[id].n).join(", ");
  for (const p of world.getAllPlayers()) tell(p, "§b§l[Spleef] §r§fA game starts! §7Players: §f" + names + " §e/spleef", "§b§l[Spleef] §r§fبدت لعبة سبليف! §7اللاعبين: §f" + names + " §e/spleef");
  try { slog(player, "spleef", null, "game started: " + ids.length + " players"); } catch (e) { /* ignore */ }
  system.runJob((function* () {
    yield* resetJob();
    if (!G || G.phase !== "reset") return;
    G.alive = G.alive.filter((id) => online(id));
    G.alive.forEach((id, i) => {
      const p = online(id);
      try { p.setGameMode(GameMode.Adventure); } catch (e) { /* ignore */ }
      try { p.teleport(abs(a, spot(i, G.alive.length)), { dimension: dimOf(a), facingLocation: abs(a, { x: 0, y: T.floorY + 1, z: 0 }) }); } catch (e) { /* ignore */ }
      if (!giveShovel(p)) tell(p, "§c[Spleef] Your inventory is full - free a slot to get the shovel!", "§c[Spleef] حقيبتك مليانة - فضّي مكان حتى تاخذ المجرفة!");
      tell(p, "§b[Spleef] §fDig the snow under the others with your §bSpleef Shovel§f! Fall = out. Last one on the floor wins! §7(only the shovel works, no placing, stay in the arena)",
        "§b[Spleef] §fاحفر الثلج من تحت اللاعبين بـ§bمجرفة السبليف§f! اللي يطيح يطلع. آخر واحد يبقى على الأرضية يفوز! §7(بس المجرفة تشتغل، ممنوع البناء، لا تطلع من الساحة)");
    });
    G.phase = "count"; G.until = system.currentTick + COUNT * 20;
  })());
  return { ok: true };
}
function out(id, why) {
  if (!G || !G.alive.includes(id)) return;
  G.alive = G.alive.filter((x) => x !== id); G.order.push(id);
  const rec = G.pl[id], a = arena(), p = online(id), left = G.alive.length;
  if (p) {
    clearItems(p);
    try { p.teleport(abs(a, seat(G.order.length)), { dimension: dimOf(a), facingLocation: center(a) }); } catch (e) { /* ignore */ }
    try { p.onScreenDisplay.setTitle("§c§l" + pick(p, "ELIMINATED", "انقصيت"), { subtitle: "§7" + pick(p, "Place #" + (left + 1) + " - watch from the seats", "المركز #" + (left + 1) + " - تابع من المقاعد"), fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
    try { p.playSound("mob.wither.hurt", { volume: 0.5, pitch: 1.2 }); } catch (e) { /* ignore */ }
    try { const s = stats(p); s.spl = (s.spl ?? 0) + 1; touch(p); } catch (e) { /* ignore */ }
  }
  const whyEn = why === "left" ? "left the game" : why === "edge" ? "left the arena" : "fell", whyAr = why === "left" ? "طلع من اللعبة" : why === "edge" ? "طلع من حدود الساحة" : "طاح";
  for (const q of world.getAllPlayers()) {
    if (!inArena(q) && !G.pl[q.id]) continue;
    tell(q, "§b❄ §f" + rec.n + " §7" + whyEn + " - OUT! §e" + left + " §7left", "§b❄ §f" + rec.n + " §7" + whyAr + " - انقصى! §eباقي " + left);
  }
  if (G.alive.length <= 1 && G.phase !== "end") win();
}
function win() {
  const a = arena(), wid = G.alive[0], rec = wid ? G.pl[wid] : null, wp = wid ? online(wid) : null;
  G.phase = "end"; G.until = system.currentTick + 120;
  if (wp) { try { const s = stats(wp); s.spw = (s.spw ?? 0) + 1; if (G.prize > 0) addMoney(wp, G.prize); else touch(wp); } catch (e) { /* ignore */ } }
  const order = [...G.order].reverse(), second = order[0] ? G.pl[order[0]].n : null, third = order[1] ? G.pl[order[1]].n : null;
  for (const q of world.getAllPlayers()) {
    tell(q, "§b§l[Spleef] §r" + (rec ? "§6§l" + rec.n + " §r§awins!" + (G.prize ? " §7(prize: §a" + money(G.prize) + "§7)" : "") : "§7Nobody wins.") + (second ? " §72nd: §f" + second : "") + (third ? " §73rd: §f" + third : ""),
      "§b§l[Spleef] §r" + (rec ? "§6§l" + rec.n + " §r§aفاز!" + (G.prize ? " §7(الجائزة: §a" + money(G.prize) + "§7)" : "") : "§7محد فاز.") + (second ? " §7الثاني: §f" + second : "") + (third ? " §7الثالث: §f" + third : ""));
    if (inArena(q)) { try { q.onScreenDisplay.setTitle("§6§l" + (rec ? rec.n : "-"), { subtitle: "§b" + pick(q, "WINS SPLEEF!", "فاز بالسبليف!"), fadeInDuration: 5, stayDuration: 80, fadeOutDuration: 15 }); q.playSound("random.totem", { volume: 0.6 }); } catch (e) { /* ignore */ } }
  }
  const dim = dimOf(a), at = wp ? wp.location : center(a);
  for (let i = 0; i < 6; i++) system.runTimeout(() => {
    for (let k = 0; k < 4; k++) { try { dim.spawnParticle("minecraft:totem_particle", { x: at.x + (Math.random() - 0.5) * 6, y: at.y + 1 + Math.random() * 4, z: at.z + (Math.random() - 0.5) * 6 }); } catch (e) { /* ignore */ } }
    try { dim.playSound(i % 2 ? "firework.twinkle" : "firework.large_blast", at, { volume: 3 }); } catch (e) { /* ignore */ }
  }, i * 8);
}
export function stopGame(reason = "stopped") {
  if (!G) return;
  const g = G; G = null; saveG();
  for (const [id, rec] of Object.entries(g.pl)) restoreOrKeep(id, rec);
  if (reason === "stopped") for (const p of world.getAllPlayers()) tell(p, "§b[Spleef] §7The game was stopped.", "§b[Spleef] §7انوقفت اللعبة.");
  system.runJob((function* () { yield* resetJob(); })());
}
function snowAt(a, x, y, z) { return y === a.cy + T.floorY && inFloor(x - a.cx, z - a.cz); }
function digOut(dim, x, y, z) {
  try {
    const b = dim.getBlock({ x, y, z }); if (!b || b.typeId !== "minecraft:snow") return;
    b.setType("minecraft:air");
    dim.spawnParticle("minecraft:snowflake_particle", { x: x + 0.5, y: y + 0.6, z: z + 0.5 });
  } catch (e) { /* ignore */ }
}

system.runInterval(() => {
  if (!G) return;
  const a = arena(); if (!a) { stopGame(); return; }
  try {
    const t = system.currentTick, dim = dimOf(a);
    if (G.phase === "count") {
      if (t >= G.until) { G.phase = "run"; G.start = t; toAll((p) => { p.onScreenDisplay.setTitle("§b§l" + pick(p, "DIG!", "احفر!"), { fadeInDuration: 2, stayDuration: 20, fadeOutDuration: 6 }); p.playSound("note.pling", { pitch: 1.6 }); }); }
      else if (Math.ceil((G.until - t) / 20) !== G.sec && (G.sec = Math.ceil((G.until - t) / 20))) toAll((p) => { p.onScreenDisplay.setTitle("§e§l" + Math.ceil((G.until - t) / 20), { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 2 }); p.playSound("note.hat"); });
    }
    if (G.phase === "end") { if (t >= G.until) stopGame("end"); return; }
    if (G.phase !== "run" && G.phase !== "count") return;
    for (const id of [...G.alive]) {
      const p = online(id); if (!p) { out(id, "left"); continue; }
      const l = p.location;
      if (p.dimension.id !== a.d) { out(id, "left"); continue; }
      if (l.y - a.cy < T.elimY) { out(id, "fell"); continue; }
      if (!onField(a, l)) { out(id, "edge"); continue; }
      try { if (p.isFlying || p.isGliding) { p.teleport({ x: l.x, y: a.cy + T.floorY + 1, z: l.z }); } } catch (e) { /* ignore */ }
      if (G.phase === "count") { try { const sp = abs(a, spot(G.alive.indexOf(id), G.alive.length)); if (Math.hypot(l.x - sp.x, l.z - sp.z) > 1.5) p.teleport(sp, { facingLocation: abs(a, { x: 0, y: T.floorY + 1, z: 0 }) }); } catch (e) { /* ignore */ } }
    }
    // the floor melts (shrinks from the outside) after the chosen time
    if (G && G.phase === "run" && G.melt > 0 && t - G.start >= G.melt * 1200) {
      if (!G.warned) { G.warned = true; toAll((p) => { p.onScreenDisplay.setTitle("§c§l" + pick(p, "THE FLOOR MELTS!", "الأرضية تذوب!"), { subtitle: "§7" + pick(p, "Get to the middle!", "روح للنص!"), fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 10 }); p.playSound("random.fizz"); }); }
      if ((t - G.start) % 80 === 0 && G.ring > 2) {
        const r0 = G.ring, y = a.cy + T.floorY;
        for (let x = -r0 - 1; x <= r0 + 1; x++) for (let z = -r0 - 1; z <= r0 + 1; z++) { const r = Math.hypot(x, z); if (r > r0 - 0.5 && r <= r0 + 0.5) digOut(dim, a.cx + x, y, a.cz + z); }
        G.ring--;
      }
    }
  } catch (e) { console.warn("[spleef] tick: " + e); }
}, 2);
// no damage / knockback, no hunger, no fire; the bar
system.runInterval(() => {
  if (!G) return;
  const t = system.currentTick;
  for (const id of Object.keys(G.pl)) {
    const p = online(id); if (!p) continue;
    try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); p.addEffect("weakness", 30, { amplifier: 255, showParticles: false }); p.addEffect("saturation", 30, { amplifier: 0, showParticles: false }); p.addEffect("fire_resistance", 30, { amplifier: 0, showParticles: false }); } catch (e) { /* ignore */ }
  }
  const secs = G.phase === "run" ? Math.floor((t - G.start) / 20) : 0;
  toAll((p) => bar(p, "§b§lSPLEEF §r§7| §f" + pick(p, "Alive", "باقين") + ": §a" + G.alive.length + " §7| §e" + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") + (G.melt ? " §7| §c" + pick(p, "melts at", "تذوب عند") + " " + G.melt + ":00" : "")));
}, 10);

// digging: only snow of the floor, only players in the game, only after GO - the snow goes with no drop
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, p = ev.player, a = spleefAt(b.dimension.id, b.x, b.y, b.z); if (!a) return;
  const playing = G && G.pl[p.id];
  if (!playing) { if (owner(p) && !G) return; ev.cancel = true; return deny(p, "§c[Spleef] You can't break the arena.", "§c[Spleef] ما تقدر تكسر الساحة."); }
  ev.cancel = true;
  if (G.phase !== "run" || !G.alive.includes(p.id) || !snowAt(a, b.x, b.y, b.z) || !isItem(ev.itemStack)) return;
  const dim = b.dimension, x = b.x, y = b.y, z = b.z;
  system.run(() => { digOut(dim, x, y, z); try { dim.playSound("dig.snow", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { volume: 0.8 }); } catch (e) { /* ignore */ } });
}));
// no other item may be used by the players of the game (no pearls, no food, no blocks)
safe("use", () => world.beforeEvents.itemUse.subscribe((ev) => { const p = ev.source; if (G && p && G.pl[p.id]) ev.cancel = true; }));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  if (!G?.pl[player.id]) return;
  const all = pend(); all[player.id] = G.pl[player.id];
  system.run(() => writeJson(PEND_KEY, all));
}));
safe("drop", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  try {
    if (!G || entity.typeId !== "minecraft:item") return;
    const st = entity.getComponent("minecraft:item")?.itemStack, l = entity.location;
    if (isItem(st) || (st?.typeId === "minecraft:snowball" && spleefAt(entity.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)))) entity.remove();
  } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- protection (only the Owner changes the arena)
const told = new Map();
function deny(p, en, ar) { system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); }); }
const DANGER = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper|flint_and_steel|fire_charge|tnt|end_crystal|respawn_anchor|piston|sticky_piston)$/;
const near = (d, x, z, m) => { const a = arena(); return !!a && a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m; };
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p) && !(G && G.pl[p.id])) return;
  const b = ev.block, d = b.dimension.id, item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && DANGER.test(item) && near(d, b.x, b.z, 12)) { ev.cancel = true; return deny(p, "§c[Spleef] You can't use this item here.", "§c[Spleef] ما تقدر تستخدم هذا الغرض هنا."); }
  if (!spleefAt(d, b.x, b.y, b.z)) return;
  ev.cancel = true;
  if (item && !isItem(ev.itemStack)) deny(p, "§c[Spleef] Placing blocks is not allowed here.", "§c[Spleef] ممنوع تحط بلوكات هنا.");
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!arena()) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !spleefAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- Owner pages
export function spleefPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => spleefPage(player, back), a = arena(), c = conf();
  const f = makeOpr("Event: Spleef", SHORT_ROWS); f.self = self; f.glass = true;
  const live = G ? "§a" + G.phase + " §7(" + G.alive.length + " alive)" : "§fno game";
  set(f, 0 * COLS + 4, hdr(1, G ? "g" : "c") + "§b§lSpleef\n§r§7Dig the snow under the others with\n§r§7the shovel - fall = out, the last\n§r§7one on the floor wins.\n§r§7Arena: " + (busy ? "§ebeing built" : a ? "§abuilt §7(" + a.cx + " " + a.cy + " " + a.cz + ")" : "§fnot built") + "\n§r§7Game: " + live + "\n§r§7Players: §f/spleef", "textures/items/diamond_shovel", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild the arena here\n§r§7A round snow floor (41 across) over a\n§r§7lava pit, ice walls, seats around\n§r§7(65 x 65). The land is saved (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the Spleef arena here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 65 x 65 blocks around you", "§7is replaced (Undo puts it back)."], () => buildSpleef(player), self) });
  } else if (!G) {
    const n = c.roster.filter((id) => online(id)).length;
    set(f, 1 * COLS + 2, hdr(Math.max(1, Math.min(99, n)), n >= 2 ? "g" : "c") + "§f§lChoose the players\n§r§7Chosen (online): §e" + n + " §7/ " + MAX_PLAYERS + "\n§r§eClick to choose", "textures/ui/shop/ic_player", { run: () => rosterPage(player, self) });
    set(f, 1 * COLS + 4, hdr(Math.max(1, c.melt), c.melt ? "g" : "r") + "§f§lThe floor melts\n§r§7After: §e" + (c.melt ? c.melt + " min" : "OFF") + "\n§r§7Then the snow shrinks ring by ring\n§r§7from the outside (a game always ends)\n§r§eClick to change", "textures/blocks/snow", { run: () => { c.melt = MELT[(MELT.indexOf(c.melt) + 1) % MELT.length]; saveCfg(); self(); } });
    set(f, 1 * COLS + 6, hdr(1, c.prize ? "g" : "c") + "§f§lPrize for the winner\n§r§7Now: §a" + (c.prize ? money(c.prize) : "none") + "\n§r§eClick to change", "textures/items/gold_ingot", { run: () => { c.prize = PRIZES[(PRIZES.indexOf(c.prize) + 1) % PRIZES.length]; saveCfg(); self(); } });
    set(f, 2 * COLS + 4, hdr(1, n >= 2 ? "g" : "r") + "§a§lStart the game\n§r§7" + Math.min(n, MAX_PLAYERS) + " players, countdown " + COUNT + " s\n§r§7The snow floor is made new first\n§r§eClick to start", "textures/ui/shop/ic_confirm", { run: () => { const r = startGame(player); if (r.err) say(player, "§c[Spleef] " + r.err); else self(); } });
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7To the seats", "textures/items/ender_pearl", { run: () => { try { player.teleport(abs(a, T.view), { dimension: dimOf(a), facingLocation: center(a) }); } catch (e) { /* ignore */ } } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo the arena\n§r§7The land comes back as it was\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the Spleef arena?", ["§7The land comes back as it was."], () => undoSpleef(player), self) });
  } else {
    set(f, 1 * COLS + 4, hdr(Math.max(1, G.alive.length), "g") + "§f§lAlive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/ui/shop/ic_player", null);
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lStop the game\n§r§7No winner, everybody goes back", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Stop the game?", ["§7Nobody wins; the snow floor is put back."], () => stopGame(), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
function rosterPage(player, back, page = 0) {
  if (!owner(player)) return;
  const self = () => rosterPage(player, back, page), c = conf(), a = arena();
  const f = makeOpr("Spleef: players", 6); f.self = self; f.glass = true;
  const all = world.getAllPlayers().sort((x, y) => x.name.localeCompare(y.name)), per = 36, list = all.slice(page * per, page * per + per);
  c.roster = c.roster.filter((id) => all.some((p) => p.id === id));
  set(f, 0 * COLS + 4, hdr(Math.max(1, c.roster.length), "g") + "§a§lChoose the players\n§r§7Chosen: §e" + c.roster.length + " §7/ " + MAX_PLAYERS + "\n§r§7Click a name to add / remove", "textures/ui/shop/ic_player", null);
  list.forEach((p, i) => {
    const on = c.roster.includes(p.id);
    set(f, 1 * COLS + i, hdr(1, on ? "g" : "c") + (on ? "§a✔ " : "§7") + p.name + "\n§r§7" + (on ? "chosen - click to remove" : "click to add"), on ? "textures/items/diamond_shovel" : "textures/ui/shop/ic_player", { run: () => {
      if (on) c.roster = c.roster.filter((x) => x !== p.id); else if (c.roster.length < MAX_PLAYERS) c.roster.push(p.id); else say(player, "§c[Spleef] The game is full (" + MAX_PLAYERS + ").");
      saveCfg(); self();
    } });
  });
  set(f, 5 * COLS + 3, hdr(1, "g") + "§a§lEverybody at the arena\n§r§7Adds the players who are at the arena", "textures/blocks/snow", { run: () => {
    if (a) for (const p of world.getAllPlayers()) if (inArena(p) && !c.roster.includes(p.id) && c.roster.length < MAX_PLAYERS) c.roster.push(p.id);
    saveCfg(); self();
  } });
  set(f, 5 * COLS + 5, hdr(1, "r") + "§c§lClear\n§r§7Nobody chosen", "textures/ui/shop/ic_cancel", { run: () => { c.roster = []; saveCfg(); self(); } });
  if (all.length > (page + 1) * per) set(f, 5 * COLS + 8, hdr(1) + "Next page", "textures/ui/shop/nav_next", { run: () => rosterPage(player, back, page + 1) });
  if (page > 0) set(f, 5 * COLS + 0, hdr(1) + "Previous page", "textures/ui/shop/nav_prev", { run: () => rosterPage(player, back, page - 1) });
  backBtn(f, back);
  open(player, f);
}
spleefHook.page = spleefPage;

// ---------------------------------------------------------------- /spleef (every player)
export function spleefMenu(player) {
  const f = makeOpr("Spleef", SHORT_ROWS); f.self = () => spleefMenu(player); f.glass = true;
  const a = arena();
  let top = [];
  try { top = ranking("spleef").slice(0, 5); } catch (e) { top = []; }
  set(f, 0 * COLS + 4, hdr(1, "g") + "§b§lSpleef\n§r§7Games are started by the Owner.\n§r§6Best players:\n" + (top.length ? top.map((r, i) => "§r§e" + (i + 1) + ". §f" + r.name + " §7- §a" + r.v + " wins").join("\n") : "§r§7(nobody yet)"), "textures/items/diamond_shovel", null);
  if (G) set(f, 2 * COLS + 3, hdr(Math.max(1, G.alive.length), "g") + "§f§lGame now\n§r§7Alive: §a" + G.alive.length + "\n§r§f" + G.alive.map((id) => G.pl[id].n).join(", "), "textures/items/clock_item", null);
  else set(f, 2 * COLS + 3, hdr(1, "c") + "§f§lNo game right now\n§r§7Wait for the Owner to start one", "textures/items/clock_item", null);
  set(f, 2 * COLS + 5, hdr(1, a ? "g" : "c") + "§b§lGo to the arena\n§r§7" + (a ? "The seats (watch the game)" : "Not built yet") + "\n§r§eClick to go", "textures/items/ender_pearl", { run: () => {
    if (!a || !canTeleport(player, "spleef")) return;
    teleportWithFx(player, abs(a, T.view), a.d, "spleef", () => tell(player, "§b[Spleef] Welcome!", "§b[Spleef] أهلاً!"));
  } });
  const s = stats(player);
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Wins: §a" + (s.spw ?? 0) + "\n§r§7Losses: §c" + (s.spl ?? 0), "textures/items/diamond_shovel", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:spleef", description: "Spleef: the game, the arena, the best players", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { spleefMenu(p); } catch (e) { console.warn("[spleef] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[spleef] command: " + e); }
});
