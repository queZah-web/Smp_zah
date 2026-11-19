// ===================================================================================================================
// ARENAS (two colosseums for fighting)  -  /opr > Building > Arenas (Owner)   and   /arena (every player)
//
//   "Arena of Valor"  (teal + white)       default rules: Keep Inventory ON,  building OFF,          ender pearls OFF
//   "Blood Pit"       (red + blackstone)   default rules: Keep Inventory OFF, temporary building ON,  ender pearls ON
//
// The Owner changes the rules of each arena at any time (Building > Arenas > the arena):
//   Open / Closed  |  Keep Inventory ON / OFF  |  Building: OFF / ON (blocks stay) / TEMPORARY (blocks vanish after 30 s - 10 min)
//   Ender pearls allowed / not  |  Clear the placed blocks now  |  Teleport  |  Undo (the land comes back)
//
// The rules work in the PIT only (the round fighting floor). Everywhere else in the arena (lobby, halls, stands, plaza)
// nobody takes damage, so the spectators are safe.  The building itself: only the Owner can change it.
//
// Keep Inventory works with the normal game API (no beta): when a player dies in the pit, everything he dropped
// (items + XP orbs) is taken from the ground at once and given back when he respawns (armor is put on again);
// he comes back to the arena lobby.  If he leaves the game while dead, his items are dropped where he died.
// Kills in the pits are counted (/arena shows the best fighters).
// No lag: plain blocks, one light 0.5 s loop, the temporary blocks are checked once a second.
// ===================================================================================================================
import { world, system, BlockTypes, EquipmentSlot, BlockVolume, StructureSaveMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, arenaHook } from "./spawnbuild.js";
import { ARENA, arenaGen } from "./arenadesign.js";
import { canTeleport, teleportWithFx } from "./util.js";

export const KINDS = {
  keep: { name: "Arena of Valor", style: "valor", col: "§b", rules: { open: 1, keepinv: 1, build: 0, temp: 60, pearls: 0 } },
  nokeep: { name: "Blood Pit", style: "blood", col: "§c", rules: { open: 1, keepinv: 0, build: 2, temp: 60, pearls: 1 } },
};
const TEMPS = [30, 60, 120, 300, 600];
const KEY = "arena:v1", STAT_KEY = "arena:st", PB_KEY = "arena:pb";
const PAD = 1, TILE = 51, ZBACK = 44, ZFRONT = 46;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[arena] " + name + ": " + e); } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (x) { return false; } };

// ---------------------------------------------------------------- saved data
let data = null;            // { a: { keep: arena, nokeep: arena } }
function load() {
  if (data) return data;
  try { const raw = world.getDynamicProperty(KEY); data = typeof raw === "string" ? JSON.parse(raw) : { a: {} }; data.a ??= {}; } catch (e) { return null; }
  return data;
}
const save = () => { try { world.setDynamicProperty(KEY, JSON.stringify(data)); } catch (e) { console.warn("[arena] save: " + e); } };
export const arenas = () => Object.values(load()?.a ?? {});
export const arenaOf = (kind) => load()?.a?.[kind] ?? null;
addZoneSource(() => arenas());                                                   // land protection / the spawn builder keep away from the arenas

let stats = null;           // player id -> { n: name, k: kills, d: deaths }
function st() { if (stats) return stats; try { const raw = world.getDynamicProperty(STAT_KEY); stats = typeof raw === "string" ? JSON.parse(raw) : {}; } catch (e) { return {}; } return stats; }
let statDirty = false;
const statOf = (p) => { const s = st(); return (s[p.id] ??= { n: p.name, k: 0, d: 0 }); };

// blocks placed by players in the pits: "dim|x|y|z" -> { a: kind, t: time, tmp: 1 if temporary, ty: type }
const placed = new Map(); let pbLoaded = false, pbDirty = false;
function pb() {
  if (pbLoaded) return placed;
  try { const raw = world.getDynamicProperty(PB_KEY); if (typeof raw === "string") for (const [k, v] of JSON.parse(raw)) placed.set(k, v); pbLoaded = true; } catch (e) { /* not ready */ }
  return placed;
}
system.runInterval(() => {
  try {
    if (pbDirty) { pbDirty = false; const arr = [...pb()].slice(-1500); world.setDynamicProperty(PB_KEY, arr.length ? JSON.stringify(arr) : undefined); }
    if (statDirty) { statDirty = false; world.setDynamicProperty(STAT_KEY, JSON.stringify(st())); }
  } catch (e) { /* ignore */ }
}, 100);

// ---------------------------------------------------------------- where is what
const inBox = (a, d, x, y, z) => a.d === d && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2 && z >= a.z1 && z <= a.z2;
export function arenaAt(d, x, y, z) { for (const a of arenas()) if (inBox(a, d, x, y, z)) return a; return null; }
const inPit = (a, x, y, z) => Math.hypot(x - a.cx, z - a.cz) <= ARENA.PIT && y >= a.cy && y <= a.cy + 24;
const bkey = (d, x, y, z) => d + "|" + x + "|" + y + "|" + z;
const fl = (l) => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
function pitOf(p) {
  const l = fl(p.location), a = arenaAt(p.dimension.id, l.x, l.y, l.z);
  return a && inPit(a, l.x, l.y, l.z) ? a : null;
}
const lobbyOf = (a) => ({ x: a.cx + ARENA.lobby.x + 0.5, y: a.cy + ARENA.lobby.y, z: a.cz + ARENA.lobby.z + 0.5 });
const ruleText = (a) => {
  const r = a.rules;
  return ["§7Keep Inventory: " + (r.keepinv ? "§aON" : "§cOFF"), "§7Building: " + (r.build === 0 ? "§cOFF" : r.build === 1 ? "§aON" : "§eTEMPORARY §7(" + fmtSec(r.temp) + ")"), "§7Ender pearls: " + (r.pearls ? "§aallowed" : "§cnot allowed")];
};
const fmtSec = (s) => (s < 60 ? s + "s" : s / 60 + " min");

// ---------------------------------------------------------------- building an arena
let busy = false;
function* buildJob(player, dim, a) {
  const t0 = Date.now();
  try {
    addAreas(dim, a, "smp_arena_");
    if (!(yield* waitLoaded(player, dim, a, "[Arena] Building:"))) { removeAreas(dim, "smp_arena_"); say(player, "§c[Arena] The area could not be loaded. Stand in the middle and try again."); return; }
    a.tiles = []; a.backup = true;
    for (let x = a.x1; x <= a.x2; x += TILE) for (let z = a.z1; z <= a.z2; z += TILE) {
      const id = "smp:arena_" + a.kind + "_" + a.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: a.y1, z }, { x: Math.min(x + TILE - 1, a.x2), y: a.y2, z: Math.min(z + TILE - 1, a.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        a.tiles.push({ id, x, y: a.y1, z });
      } catch (e) { a.backup = false; console.warn("[arena] backup: " + e); }
      bar(player, "§a[Arena] §fSaving the land for Undo... §e" + a.tiles.length);
      yield;
    }
    load().a[a.kind] = a; save();                                       // protected from now on
    bar(player, "§a[Arena] §fDesigning...");
    const g = arenaGen(KINDS[a.kind].style); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value;
    const og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + 89 * 2, cx = a.cx, fy = a.cy, cz = a.cz;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[Arena] §fBuilding " + a.name + "... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -ZBACK; x <= ZBACK; x++) {
      const h = Math.floor(Math.sqrt(Math.max(0, 42.5 ** 2 - x * x))), zmax = Math.abs(x) <= 10 ? ZFRONT : h;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy + 1, z: cz - h }, { x: cx + x, y: fy + ARENA.UP - 2, z: cz + zmax }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy - 4, z: cz - h }, { x: cx + x, y: fy - 1, z: cz + zmax }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: cx + b[i], y: fy + b[i + 1], z: cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    removeAreas(dim, "smp_arena_");
    bar(player, "§a[Arena] §fDone!");
    say(player, "§a[Arena] " + a.name + " is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aPlayers can go there with §f/arena§a.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[arena] build: " + e); say(player, "§c[Arena] Building stopped: " + e); removeAreas(dim, "smp_arena_"); }
  finally { busy = false; }
}
function buildHere(player, kind) {
  if (!owner(player)) return say(player, "§c[Arena] Only the Owner can build arenas.");
  if (busy) return say(player, "§c[Arena] An arena is being built right now. Wait until it is done.");
  if (arenaOf(kind)) return say(player, "§c[Arena] This arena already exists. Undo it first.");
  const K = KINDS[kind], dim = player.dimension, l = player.location;
  const cx = Math.floor(l.x), cz = Math.floor(l.z), fy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (fy - ARENA.DOWN < hr.min || fy + ARENA.UP >= hr.max) return say(player, "§c[Arena] Too high or too low here. Stand on normal ground.");
  const a = { kind, name: K.name, d: dim.id, cx, cy: fy, cz, x1: cx - ZBACK - PAD, y1: fy - ARENA.DOWN, z1: cz - ZBACK - PAD, x2: cx + ZBACK + PAD, y2: fy + ARENA.UP, z2: cz + ZFRONT + PAD, rules: { ...K.rules }, t: Date.now() };
  if (spawnOverlaps(a.d, a) || arenas().some((o) => o.d === a.d && a.x1 <= o.x2 && a.x2 >= o.x1 && a.z1 <= o.z2 && a.z2 >= o.z1)) return say(player, "§c[Arena] Too close to the spawn or to the other arena. Move away and try again.");
  busy = true;
  say(player, "§a[Arena] Building " + K.name + " (89 x 91)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "arena", null, K.name + " built at " + cx + " " + fy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, a));
}
function* undoJob(player, dim, a) {
  try {
    addAreas(dim, a, "smp_arena_");
    if (!(yield* waitLoaded(player, dim, a, "[Arena] Undo:"))) { removeAreas(dim, "smp_arena_"); say(player, "§c[Arena] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of a.tiles ?? []) {
      try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[arena] undo: " + e); }
      try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ }
      yield;
    }
    for (const [k, v] of pb()) if (v.a === a.kind) placed.delete(k);
    pbDirty = true;
    delete load().a[a.kind]; save();
    removeAreas(dim, "smp_arena_");
    say(player, ok && ok === (a.tiles ?? []).length ? "§a[Arena] " + a.name + " removed: the land is back as it was." : "§e[Arena] " + a.name + " removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
function undo(player, kind) {
  if (!owner(player) || busy) return;
  const a = arenaOf(kind); if (!a) return;
  let dim; try { dim = world.getDimension(a.d); } catch (e) { return; }
  busy = true;
  system.runJob(undoJob(player, dim, a));
}
function clearPlaced(kind) {
  let n = 0;
  for (const [k, v] of pb()) {
    if (v.a !== kind) continue;
    const [d, x, y, z] = k.split("|");
    try { const b = world.getDimension(d).getBlock({ x: +x, y: +y, z: +z }); if (b && b.typeId === v.ty) b.setType("minecraft:air"); n++; } catch (e) { /* not loaded: removed later */ continue; }
    placed.delete(k);
  }
  pbDirty = true;
  return n;
}
function setRule(player, kind, key, val) {
  if (!owner(player)) return;
  const a = arenaOf(kind); if (!a) return;
  a.rules[key] = val; save();
  if (key === "build" && val === 0) clearPlaced(kind);
  try { slog(player, "arena", null, a.name + ": " + key + " = " + val); } catch (e) { /* ignore */ }
}
const goTo = (p, a, spot = ARENA.lobby) => { try { p.teleport({ x: a.cx + spot.x + 0.5, y: a.cy + spot.y, z: a.cz + spot.z + 0.5 }, { dimension: world.getDimension(a.d) }); } catch (e) { say(p, "§c[Arena] Teleport failed."); } };

// ---------------------------------------------------------------- Owner pages (/opr > Building > Arenas)
export function arenaAdminPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => arenaAdminPage(player, back);
  const f = makeOpr("Building: Arenas", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, "g") + "§c§lArenas\n§r§7Two colosseums (89 x 91, no lag)\n§r§7The rules work in the PIT; the rest of\n§r§7the arena is safe (no damage)\n§r§7Players: §f/arena", "textures/items/diamond_sword", null);
  [["keep", 3], ["nokeep", 5]].forEach(([kind, col]) => {
    const K = KINDS[kind], a = arenaOf(kind);
    set(f, 2 * COLS + col, hdr(1, a ? "g" : "c") + K.col + "§l" + K.name + "\n§r§7" + (kind === "keep" ? "Keep Inventory arena" : "No Keep arena") + "\n§r§7Now: " + (a ? "§abuilt" + (a.rules.open ? "" : " §c(closed)") : "§fnot built") + (a ? "\n" + ruleText(a).map((x) => "§r" + x).join("\n") : "") + "\n§r§eClick to open", kind === "keep" ? "textures/items/iron_sword" : "textures/items/netherite_sword", { run: () => arenaPage(player, kind, self) });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function arenaPage(player, kind, back) {
  if (!owner(player)) return;
  const self = () => arenaPage(player, kind, back), K = KINDS[kind], a = arenaOf(kind);
  const f = makeOpr("Arena: " + K.name, SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, a ? "g" : "c") + K.col + "§l" + K.name + "\n§r§7" + (a ? "Place: §f" + a.cx + " " + a.cy + " " + a.cz : "Built around you: you stand in the middle"), kind === "keep" ? "textures/items/iron_sword" : "textures/items/netherite_sword", null);
  if (!a) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild here\n§r§7A colosseum: skull gate, 3 tiers of\n§r§7arches, furnished halls, stands,\n§r§7royal box and the fighting pit\n§r§7The land is saved first (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build " + K.name + " here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 89 x 91 blocks around you", "§7is replaced (Undo puts it back)."], () => buildHere(player, kind), self) });
  } else {
    const r = a.rules, on = (v) => (v ? "§aON" : "§cOFF"), zone = (v) => (v ? "g" : "r");
    set(f, 1 * COLS + 1, hdr(1, zone(r.open)) + "§f§lOpen / Closed\n§r§7Now: " + (r.open ? "§aOPEN" : "§cCLOSED") + "\n§r§7Closed = players are sent out\n§r§7of the pit\n§r§eClick to switch", "textures/ui/shop/ic_shield", { run: () => { setRule(player, kind, "open", r.open ? 0 : 1); self(); } });
    set(f, 1 * COLS + 3, hdr(1, zone(r.keepinv)) + "§f§lKeep Inventory\n§r§7Now: " + on(r.keepinv) + "\n§r§7ON = players keep their items\n§r§7and XP when they die in the pit\n§r§eClick to switch", "textures/ui/shop/ic_chest", { run: () => { setRule(player, kind, "keepinv", r.keepinv ? 0 : 1); self(); } });
    set(f, 1 * COLS + 5, hdr(1, r.build ? "g" : "r") + "§f§lBuilding in the pit\n§r§7Now: " + (r.build === 0 ? "§cOFF" : r.build === 1 ? "§aON §7(blocks stay)" : "§eTEMPORARY") + "\n§r§7OFF -> ON -> TEMPORARY\n§r§7Max " + (ARENA.BUILD_MAX) + " blocks high, no lava / TNT\n§r§eClick to change", "textures/items/iron_pickaxe", { run: () => { setRule(player, kind, "build", (r.build + 1) % 3); self(); } });
    set(f, 1 * COLS + 7, hdr(1, r.build === 2 ? "g" : "c") + "§f§lTemporary blocks\n§r§7They vanish after: §e" + fmtSec(r.temp) + "\n§r§7(only when Building = TEMPORARY)\n§r§eClick to change", "textures/items/clock_item", { run: () => { setRule(player, kind, "temp", TEMPS[(TEMPS.indexOf(r.temp) + 1) % TEMPS.length]); self(); } });
    set(f, 2 * COLS + 1, hdr(1, zone(r.pearls)) + "§f§lEnder pearls\n§r§7Now: " + (r.pearls ? "§aallowed" : "§cnot allowed") + "\n§r§eClick to switch", "textures/items/ender_pearl", { run: () => { setRule(player, kind, "pearls", r.pearls ? 0 : 1); self(); } });
    let nPb = 0; for (const v of pb().values()) if (v.a === kind) nPb++;
    set(f, 2 * COLS + 3, hdr(Math.min(99, Math.max(1, nPb)), "c") + "§f§lClear placed blocks\n§r§7Blocks players placed in the pit: §f" + nPb + "\n§r§eClick to remove them now", "textures/blocks/barrier", { run: () => { const n = clearPlaced(kind); say(player, "§a[Arena] " + n + " placed blocks removed."); self(); } });
    set(f, 2 * COLS + 5, hdr(1, "g") + "§b§lTeleport\n§r§7Lobby / royal box\n§r§eClick = lobby", "textures/items/ender_pearl", { run: () => goTo(player, a) });
    set(f, 2 * COLS + 7, hdr(1, "r") + "§c§lUndo\n§r§7Remove the arena: the land comes\n§r§7back as it was before\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove " + K.name + "?", ["§7The land comes back as it was."], () => undo(player, kind), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
arenaHook.page = arenaAdminPage;

// ---------------------------------------------------------------- the player menu: /arena
export function arenaMenu(player, back) {
  const f = makeOpr("Arenas", SHORT_ROWS); f.self = () => arenaMenu(player, back); f.glass = true;
  if (back) backBtn(f, back);
  const s = st(), top = Object.entries(s).sort((a, b) => b[1].k - a[1].k).slice(0, 5);
  set(f, 0 * COLS + 4, hdr(1, "g") + "§c§lArenas\n§r§7Fight other players in the pit.\n§r§7Outside the pit nobody takes damage.\n§r§6Best fighters:\n" + (top.length ? top.map(([id, v], i) => "§r§e" + (i + 1) + ". §f" + v.n + " §7- §c" + v.k + " kills").join("\n") : "§r§7(nobody yet)"), "textures/items/diamond_sword", null);
  [["keep", 3], ["nokeep", 5]].forEach(([kind, col]) => {
    const K = KINDS[kind], a = arenaOf(kind);
    if (!a) { set(f, 2 * COLS + col, hdr(1, "c") + K.col + "§l" + K.name + "\n§r§7Not built yet", "textures/blocks/barrier", null); return; }
    set(f, 2 * COLS + col, hdr(1, a.rules.open ? "g" : "r") + K.col + "§l" + K.name + "\n§r" + (a.rules.open ? "§aOPEN" : "§cCLOSED") + "\n" + ruleText(a).map((x) => "§r" + x).join("\n") + "\n§r§eClick to go there", kind === "keep" ? "textures/items/iron_sword" : "textures/items/netherite_sword", { run: () => {
      if (!canTeleport(player, "arena")) return;
      teleportWithFx(player, lobbyOf(a), a.d, "arena", () => tell(player, "§a[Arena] Welcome to " + K.name + "! §7Walk into the pit to fight.", "§a[الحلبة] أهلاً في " + K.name + "! §7ادخل الساحة عشان تقاتل."));
    } });
  });
  const me = s[player.id];
  set(f, 4 * COLS + 4, hdr(1) + "§f§lYou\n§r§7Kills: §c" + (me?.k ?? 0) + "\n§r§7Deaths: §7" + (me?.d ?? 0), "textures/items/iron_sword", null);
  open(player, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:arena", description: "Open the arenas (go to the fighting arenas)", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { arenaMenu(p); } catch (e) { console.warn("[arena] menu: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[arena] command: " + e); }
});

// ---------------------------------------------------------------- protection + building rules
const told = new Map();
function deny(p, en, ar) {
  system.run(() => { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); tell(p, en, ar); });
}
const FACE = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
const LIQUID = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper)$/, DANGER = /^(flint_and_steel|fire_charge|tnt|tnt_minecart|end_crystal|respawn_anchor|bed|.+_bed|lava|fire)$/, PISTON = /^(piston|sticky_piston)$/;
const near = (d, x, y, z, m) => arenas().some((a) => a.d === d && x >= a.x1 - m && x <= a.x2 + m && z >= a.z1 - m && z <= a.z2 + m && y >= a.y1 - 2);
const canPlaceAt = (a, x, y, z) => a.rules.build > 0 && inPit(a, x, y, z) && y <= a.cy + ARENA.BUILD_MAX && y >= a.cy + 1;

safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, d = b.dimension.id, a = arenaAt(d, b.x, b.y, b.z);
  if (!a || owner(ev.player)) return;
  const k = bkey(d, b.x, b.y, b.z);
  if (a.rules.build > 0 && pb().has(k)) { placed.delete(k); pbDirty = true; return; }       // a block a player placed in the pit
  ev.cancel = true; deny(ev.player, "§c[Arena] You can't break the arena.", "§c[الحلبة] ما تقدر تكسر الحلبة.");
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player; if (owner(p)) return;
  const b = ev.block, d = b.dimension.id, f = FACE[String(ev.blockFace)] ?? [0, 0, 0];
  const px = b.x + f[0], py = b.y + f[1], pz = b.z + f[2];
  const item = ev.itemStack?.typeId?.replace("minecraft:", "") ?? "";
  if (item && (LIQUID.test(item) ? near(d, px, py, pz, 10) : DANGER.test(item) ? near(d, px, py, pz, 8) : PISTON.test(item) ? near(d, px, py, pz, 13) : false)) {
    ev.cancel = true; return deny(p, "§c[Arena] You can't use this item at the arena.", "§c[الحلبة] ما تقدر تستخدم هذا الغرض عند الحلبة.");
  }
  const a = arenaAt(d, b.x, b.y, b.z) ?? arenaAt(d, px, py, pz); if (!a) return;
  const inside = inPit(a, b.x, b.y, b.z) || inPit(a, px, py, pz);
  if (inside) {
    let isBlock = false; try { isBlock = !!item && !!BlockTypes.get("minecraft:" + item); } catch (e) { isBlock = false; }
    if (!isBlock) return;                                                                   // swords, bows, food...: normal
    if (canPlaceAt(a, px, py, pz)) return;                                                  // building in the pit (when allowed)
  }
  ev.cancel = true;
  if (item) deny(p, a.rules.build === 0 ? "§c[Arena] Building is not allowed here." : "§c[Arena] You can only build in the pit (max " + ARENA.BUILD_MAX + " blocks high).", a.rules.build === 0 ? "§c[الحلبة] البناء ممنوع هنا." : "§c[الحلبة] تقدر تبني بس داخل الساحة (بحد أقصى " + ARENA.BUILD_MAX + " بلوكات ارتفاع).");
}));
safe("placed", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  const d = block.dimension.id, a = arenaAt(d, block.x, block.y, block.z); if (!a || owner(player)) return;
  if (!canPlaceAt(a, block.x, block.y, block.z)) { system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } }); return; }
  pb().set(bkey(d, block.x, block.y, block.z), { a: a.kind, t: Date.now(), tmp: a.rules.build === 2 ? 1 : 0, ty: block.typeId });
  pbDirty = true;
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const d = ev.dimension.id, all = ev.getImpactedBlocks();
  if (!arenas().length) return;
  const keep = all.filter((b) => { const a = arenaAt(d, b.x, b.y, b.z); return !a || pb().has(bkey(d, b.x, b.y, b.z)); });
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));
safe("entity", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target; if (!t || owner(ev.player)) return;
  const id = t.typeId; if (id !== "minecraft:armor_stand" && id !== "minecraft:painting" && !/item_frame$/.test(id)) return;
  const l = fl(t.location); if (arenaAt(t.dimension.id, l.x, l.y, l.z)) ev.cancel = true;
}));
safe("pearls", () => world.beforeEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId !== "minecraft:ender_pearl") return;
  const p = ev.source; if (!p || owner(p)) return;
  const a = pitOf(p); if (!a || a.rules.pearls) return;
  ev.cancel = true; deny(p, "§c[Arena] Ender pearls are not allowed in this arena.", "§c[الحلبة] الإندر بيرل ممنوع في هذي الحلبة.");
}));
// temporary blocks vanish
system.runInterval(() => {
  if (!arenas().length) return;
  const now = Date.now();
  for (const [k, v] of pb()) {
    if (!v.tmp) continue;
    const a = arenaOf(v.a); if (!a) { placed.delete(k); pbDirty = true; continue; }
    if (now - v.t < (a.rules.temp ?? 60) * 1000) continue;
    const [d, x, y, z] = k.split("|");
    try { const b = world.getDimension(d).getBlock({ x: +x, y: +y, z: +z }); if (!b) continue; if (b.typeId === v.ty) b.setType("minecraft:air"); } catch (e) { continue; }
    placed.delete(k); pbDirty = true;
  }
}, 20);

// ---------------------------------------------------------------- the players: safe outside the pit, rules in the pit
const where = new Map();                 // player id -> arena kind of the pit he is in
const xpSnap = new Map();                // player id -> { lv, xp } while he is in a Keep Inventory pit
system.runInterval(() => {
  if (!arenas().length) return;
  for (const p of world.getAllPlayers()) {
    try {
      const l = fl(p.location), a = arenaAt(p.dimension.id, l.x, l.y, l.z);
      if (!a) { if (where.delete(p.id)) xpSnap.delete(p.id); continue; }
      const pit = inPit(a, l.x, l.y, l.z);
      if (!pit) {                                                              // lobby / halls / stands / plaza: nobody is hurt
        try { p.addEffect("resistance", 30, { amplifier: 4, showParticles: false }); } catch (e) { /* ignore */ }
        if (where.delete(p.id)) xpSnap.delete(p.id);
        continue;
      }
      if (!a.rules.open && !owner(p)) { goTo(p, a); tell(p, "§c[Arena] This arena is closed right now.", "§c[الحلبة] هذي الحلبة مقفلة الحين."); continue; }
      if (where.get(p.id) !== a.kind) {
        where.set(p.id, a.kind);
        try { p.removeEffect("resistance"); } catch (e) { /* ignore */ }
        try { p.onScreenDisplay.setTitle(KINDS[a.kind].col + "§l" + a.name, { subtitle: a.rules.keepinv ? "§aKeep Inventory: ON" : "§cKeep Inventory: OFF - you drop everything!", fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch (e) { /* ignore */ }
        tell(p, "§6[Arena] " + a.name + "\n" + ruleText(a).join("\n"), "§6[الحلبة] " + a.name + "\n§7حفظ الأغراض: " + (a.rules.keepinv ? "§aمفعل" : "§cمو مفعل") + "\n§7البناء: " + (a.rules.build === 0 ? "§cممنوع" : a.rules.build === 1 ? "§aمسموح" : "§eمؤقت (" + fmtSec(a.rules.temp) + ")") + "\n§7الإندر بيرل: " + (a.rules.pearls ? "§aمسموح" : "§cممنوع"));
        try { p.playSound("raid.horn", { volume: 0.4, pitch: 1.4 }); } catch (e) { /* ignore */ }
      }
      if (a.rules.keepinv) xpSnap.set(p.id, { lv: p.level, xp: p.xpEarnedAtCurrentLevel });
    } catch (e) { /* ignore this player */ }
  }
}, 10);

// ---------------------------------------------------------------- deaths in the pit: kill counter + Keep Inventory
const spawnTick = new Map();             // item / xp orb entity id -> tick it appeared (to find the drops of a death)
safe("drops", () => world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  try { if (arenas().length && (entity.typeId === "minecraft:item" || entity.typeId === "minecraft:xp_orb")) spawnTick.set(entity.id, system.currentTick); } catch (e) { /* ignore */ }
}));
system.runInterval(() => { const t = system.currentTick; for (const [id, k] of spawnTick) if (t - k > 40) spawnTick.delete(id); }, 100);
const pending = new Map();               // player id -> { items: ItemStack[], lv, xp, d, at, kind }
safe("death", () => world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity; if (!dead || dead.typeId !== "minecraft:player" || !arenas().length) return;
  const l = dead.location, d = dead.dimension.id, b = fl(l), a = arenaAt(d, b.x, b.y, b.z);
  if (!a || !inPit(a, b.x, b.y, b.z)) return;
  const killer = ev.damageSource?.damagingEntity;
  const s = statOf(dead); s.n = dead.name; s.d++;
  if (killer?.typeId === "minecraft:player" && killer.id !== dead.id) { const k = statOf(killer); k.n = killer.name; k.k++; }
  statDirty = true;
  const msg = killer?.typeId === "minecraft:player" && killer.id !== dead.id ? "§c⚔ §f" + killer.name + " §7defeated §f" + dead.name : "§7☠ §f" + dead.name + " §7fell in the arena";
  for (const p of world.getAllPlayers()) { try { const q = fl(p.location); if (arenaAt(p.dimension.id, q.x, q.y, q.z) === a) p.sendMessage(msg); } catch (e) { /* ignore */ } }
  if (!a.rules.keepinv) return;
  const snap = xpSnap.get(dead.id), pid = dead.id, dim = dead.dimension, at = { x: l.x, y: l.y, z: l.z }, t0 = system.currentTick;
  const rec = { items: [], lv: snap?.lv ?? 0, xp: snap?.xp ?? 0, d, at, kind: a.kind };
  pending.set(pid, rec);
  const grab = () => {                                                         // everything he dropped: taken off the ground
    try {
      for (const e of dim.getEntities({ location: at, maxDistance: 5 })) {
        try {
          if (e.typeId !== "minecraft:item" && e.typeId !== "minecraft:xp_orb") continue;
          const t = spawnTick.get(e.id); if (t === undefined || t < t0 - 2) continue;
          if (e.typeId === "minecraft:item") { const it = e.getComponent("minecraft:item")?.itemStack; if (it) rec.items.push(it.clone()); }
          e.remove();
        } catch (x) { /* ignore */ }
      }
    } catch (x) { /* ignore */ }
  };
  grab(); system.run(grab); system.runTimeout(grab, 2);
}));
const ARMOR = [[/_helmet$|^minecraft:turtle_helmet$/, EquipmentSlot.Head], [/_chestplate$|^minecraft:elytra$/, EquipmentSlot.Chest], [/_leggings$/, EquipmentSlot.Legs], [/_boots$/, EquipmentSlot.Feet]];
function giveBack(p, rec) {
  const inv = p.getComponent("minecraft:inventory")?.container, eq = p.getComponent("minecraft:equippable");
  for (const it of rec.items) {
    try {
      const slot = ARMOR.find(([re]) => re.test(it.typeId))?.[1];
      if (slot && eq && !eq.getEquipment(slot)) { eq.setEquipment(slot, it); continue; }
      const rest = inv ? inv.addItem(it) : it;
      if (rest) p.dimension.spawnItem(rest, p.location);
    } catch (e) { try { p.dimension.spawnItem(it, p.location); } catch (x) { /* ignore */ } }
  }
  try { if (rec.lv > p.level) p.addLevels(rec.lv - p.level); if (rec.xp > 0) p.addExperience(rec.xp); } catch (e) { /* ignore */ }
}
safe("respawn", () => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  const rec = pending.get(player.id); if (!rec || initialSpawn) return;
  pending.delete(player.id);
  system.runTimeout(() => {
    try {
      giveBack(player, rec);
      const a = arenaOf(rec.kind); if (a) goTo(player, a);
      tell(player, "§a[Arena] Keep Inventory: your items and XP are back.", "§a[الحلبة] حفظ الأغراض: رجعت لك أغراضك والـ XP.");
    } catch (e) { console.warn("[arena] give back: " + e); }
  }, 5);
}));
safe("leave", () => world.beforeEvents.playerLeave.subscribe(({ player }) => {
  const rec = pending.get(player.id); if (!rec) return;
  pending.delete(player.id);
  system.run(() => { try { const dim = world.getDimension(rec.d); for (const it of rec.items) dim.spawnItem(it, rec.at); } catch (e) { /* ignore */ } });
}));
safe("leave2", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { where.delete(playerId); xpSnap.delete(playerId); told.delete(playerId); }));
// (used by the tests and by other systems)
export { buildHere as buildArena, undo as undoArena, setRule as setArenaRule };
