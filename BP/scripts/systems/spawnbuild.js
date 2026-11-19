// ===================================================================================================================
// /opr > Building   (OWNER ONLY)
//
//   * Grand Spawn  "The Ancient Sanctuary"  151 x 151  (see spawndesign.js): walls, towers, giant tree, moat, avenues,
//                  Crate Temple (the 3 crates are placed and working), Hall of Legends (10 TOP boards), cliff + waterfall, ruins
//   * Small Spawn  41 x 41 garden spawn
//
// No lag:
//   * the area is loaded with temporary ticking areas only while building (removed afterwards)
//   * the design is made and built a little every tick (system.runJob), never all at once
//   * only plain blocks: no redstone, no hoppers, still water (plus one waterfall that settles at once), leaves that never decay,
//     glow-berry vines that never grow, invisible light blocks so no mobs spawn anywhere in the spawn
//
// Undo: before building, the land is saved in structures (world save, 51 x 61 x 51 pieces) - Undo puts it all back,
//       removes the crates / boards that were placed and gives back the old spawn point.
// Protection: nobody but the Owner can break, place or use blocks inside (Admins too) - except opening the crates;
//       explosions don't touch it; no liquids / fire / TNT / pistons close to it; no land protection can be bought on it.
// ===================================================================================================================
import { world, system, BlockPermutation, BlockVolume, StructureSaveMode } from "@minecraft/server";
import { makeOpr as make, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { getZone, setZone, clearZone, inZone, inZoneColumn, otherZoneOverlaps } from "./spawnzone.js";
import { GRAND, SMALL, grandSpawnGen, smallSpawn, boardSpots } from "./spawndesign.js";
import { placeCrateAt, removeCrateAt, isCrateAt } from "./crates.js";
import { addFixedAt, removeFixed } from "./hologram.js";

const PAD = 1;
const TILE = 51;                   // backup pieces: 51 x (height) x 51
const SPAWN_KEY = "spawn:v1";      // the /spawn point (spawn.js)
const AREA = "smp_spawn_";         // temporary ticking areas
const KINDS = { grand: { D: GRAND, name: "Grand Spawn", size: "151 x 151" }, small: { D: SMALL, name: "Small Spawn", size: "41 x 41" } };
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- blocks
const permCache = new Map();
/** a block (with states). "a|b" = the first one this game version knows; a state the game does not know is dropped; unknown -> null */
export function perm(id, states) {
  const key = id + JSON.stringify(states ?? {});
  if (permCache.has(key)) return permCache.get(key);
  let p = null;
  for (const one of id.split("|")) {
    const name = one.startsWith("minecraft:") ? one : "minecraft:" + one;
    try { p = BlockPermutation.resolve(name, states); } catch (e) { try { p = BlockPermutation.resolve(name); } catch (x) { p = null; } }
    if (p) break;
  }
  permCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------- area loading (temporary ticking areas)
function areaBoxes(z) {                                    // at most 4 boxes (one ticking area may hold 100 chunks)
  const mx = Math.floor((z.x1 + z.x2) / 2), mz = Math.floor((z.z1 + z.z2) / 2);
  return [[z.x1, z.z1, mx, mz], [mx + 1, z.z1, z.x2, mz], [z.x1, mz + 1, mx, z.z2], [mx + 1, mz + 1, z.x2, z.z2]];
}
export function addAreas(dim, z, prefix = AREA) {
  areaBoxes(z).forEach(([a, b, c, d], i) => { try { dim.runCommand(`tickingarea add ${a} ${z.cy} ${b} ${c} ${z.cy} ${d} ${prefix}${i} true`); } catch (e) { /* limit reached / no permission: we wait for the players' view instead */ } });
}
export function removeAreas(dim, prefix = AREA) { for (let i = 0; i < 4; i++) { try { dim.runCommand(`tickingarea remove ${prefix}${i}`); } catch (e) { /* ignore */ } } }
function isLoaded(dim, z) {
  for (let x = z.x1; x <= z.x2 + 15; x += 16) for (let zz = z.z1; zz <= z.z2 + 15; zz += 16) {
    let b; try { b = dim.getBlock({ x: Math.min(x, z.x2), y: z.cy, z: Math.min(zz, z.z2) }); } catch (e) { b = undefined; }
    if (!b) return false;
  }
  return true;
}
/** generator: waits (max ~60 s) until the whole area is loaded. Returns true / false */
export function* waitLoaded(player, dim, z, what) {
  const t0 = system.currentTick;
  let last = -1;
  while (!isLoaded(dim, z)) {
    if (system.currentTick - t0 > 1200) return false;
    const s = Math.floor((system.currentTick - t0) / 20);
    if (s !== last) { last = s; bar(player, "§a" + what + " §7loading the area... " + s + "s"); }
    const until = system.currentTick + 10; while (system.currentTick < until) yield;
  }
  return true;
}

// ---------------------------------------------------------------- building
let busy = false;
function* buildJob(player, dim, zone, kind) {
  const { D } = KINDS[kind], R = D.R, cx = zone.cx, fy = zone.cy, cz = zone.cz;
  const t0 = Date.now();
  try {
    addAreas(dim, zone);
    if (!(yield* waitLoaded(player, dim, zone, "[Spawn] Building:"))) { removeAreas(dim); say(player, "§c[Spawn] The area could not be loaded. Stand in the middle and try again."); return; }
    // 1. save the land (Undo)
    zone.tiles = []; zone.backup = true;
    for (let x = zone.x1; x <= zone.x2; x += TILE) for (let z = zone.z1; z <= zone.z2; z += TILE) {
      const id = "smp:spawn_backup_" + zone.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none yet */ }
        world.structureManager.createFromWorld(id, dim, { x, y: zone.y1, z }, { x: Math.min(x + TILE - 1, zone.x2), y: zone.y2, z: Math.min(z + TILE - 1, zone.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        zone.tiles.push({ id, x, y: zone.y1, z });
      } catch (e) { zone.backup = false; console.warn("[spawnbuild] backup failed: " + e); }
      bar(player, "§a[Spawn] §fSaving the land for Undo... §e" + zone.tiles.length);
      yield;
    }
    setZone(zone);                                                       // protected from now on
    // 2. the design
    bar(player, "§a[Spawn] §fDesigning...");
    let canvas;
    if (kind === "grand") { const g = grandSpawnGen(); let r; while (!(r = g.next()).done) yield; canvas = r.value; }
    else canvas = smallSpawn();
    yield;
    const og = canvas.orderedGen(); let r; while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + (2 * R + 1) * 2;
    let n = 0, fails = 0, lastPct = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== lastPct) { lastPct = pct; bar(player, "§a[Spawn] §fBuilding " + KINDS[kind].name + "... §e" + pct + "%"); } };
    // 3. clear the area (air above the floor) and fill the ground under it
    const air = perm("air"), dirt = perm("dirt"), round = kind === "small";
    for (let x = -R; x <= R; x++) {
      const h = round ? Math.floor(Math.sqrt(Math.max(0, (R + 0.5) ** 2 - x * x))) : R;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy + 1, z: cz - h }, { x: cx + x, y: fy + D.UP - 2, z: cz + h }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy - 4, z: cz - h }, { x: cx + x, y: fy - 1, z: cz + h }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    // 4. every block (solid bottom-up, then hanging / standing things top-down, water last)
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: cx + b[i], y: fy + b[i + 1], z: cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    // 5. crates + TOP boards (grand)
    zone.crates = []; zone.boards = [];
    for (const c of D.crates ?? []) {
      try { const rec = placeCrateAt(dim, cx + c.x, fy + c.y, cz + c.z, c.type); if (rec) zone.crates.push({ x: rec.x, y: rec.y, z: rec.z }); } catch (e) { console.warn("[spawnbuild] crate: " + e); }
    }
    let full = false;
    if (kind === "grand") for (const s of boardSpots()) {
      try { const b = addFixedAt(dim.id, cx + s.x, fy + s.y, cz + s.z, s.key); if (b === "full") full = true; else if (b) zone.boards.push(b.id); } catch (e) { console.warn("[spawnbuild] board: " + e); }
      yield;
    }
    // 6. spawn point
    const sp = { x: cx + D.spawn.x, y: fy + D.spawn.y, z: cz + D.spawn.z, d: dim.id };
    try { world.setDynamicProperty(SPAWN_KEY, JSON.stringify(sp)); } catch (e) { /* ignore */ }
    if (dim.id === "minecraft:overworld") { try { world.setDefaultSpawnLocation({ x: sp.x, y: sp.y, z: sp.z }); } catch (e) { /* ignore */ } try { world.gameRules.spawnRadius = 0; } catch (e) { /* ignore */ } }
    setZone(zone);
    removeAreas(dim);
    bar(player, "§a[Spawn] §fDone!");
    say(player, "§a[Spawn] " + KINDS[kind].name + " is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aIt is now the /spawn point. Only you can change it.");
    if (kind === "grand") say(player, "§a[Spawn] §f" + zone.crates.length + " §acrates and §f" + zone.boards.length + " §aTOP boards placed." + (full ? " §c(Some boards were not placed: the limit of fixed boards is full - remove old ones in Operator > Holograms.)" : ""));
    if (!zone.backup) say(player, "§c[Spawn] (Part of the backup failed: Undo can not put everything back.)");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn("[spawnbuild] " + e);
    say(player, "§c[Spawn] Building stopped: " + e);
    removeAreas(dim);
  } finally { busy = false; }
}

export function buildHere(player, kind = "grand") {
  if (!isOwner(player)) return say(player, "§c[Spawn] Only the Owner can build the spawn.");
  if (busy) return say(player, "§c[Spawn] Something is being built right now. Wait until it is done.");
  if (getZone()) return say(player, "§c[Spawn] A spawn already exists. Undo it first (Building > Spawn > Undo).");
  const K = KINDS[kind]; if (!K) return;
  { const l0 = player.location, R0 = K.D.R + PAD, b0 = { x1: Math.floor(l0.x) - R0, z1: Math.floor(l0.z) - R0, x2: Math.floor(l0.x) + R0, z2: Math.floor(l0.z) + R0, y1: -999, y2: 999 };
    if (otherZoneOverlaps(player.dimension.id, b0)) return say(player, "§c[Spawn] Too close to an arena. Move away and try again."); }
  const D = K.D, dim = player.dimension, l = player.location;
  const cx = Math.floor(l.x), cz = Math.floor(l.z), fy = Math.floor(l.y) - 1;
  const hr = dim.heightRange;
  if (fy - D.DOWN < hr.min || fy + D.UP >= hr.max) return say(player, "§c[Spawn] Too high or too low here. Stand on normal ground.");
  const zone = { kind, d: dim.id, x1: cx - D.R - PAD, y1: fy - D.DOWN, z1: cz - D.R - PAD, x2: cx + D.R + PAD, y2: fy + D.UP, z2: cz + D.R + PAD, cx, cy: fy, cz, t: Date.now() };
  try { zone.prevSpawn = world.getDynamicProperty(SPAWN_KEY) ?? null; } catch (e) { zone.prevSpawn = null; }
  try { const s = world.getDefaultSpawnLocation(); zone.prevWorldSpawn = { x: s.x, y: s.y, z: s.z }; } catch (e) { zone.prevWorldSpawn = null; }
  busy = true;
  say(player, "§a[Spawn] Building the " + K.name + " (" + K.size + ")... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "spawnbuild", null, K.name + " built at " + cx + " " + fy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, zone, kind));
}

function* undoJob(player, dim, z) {
  try {
    addAreas(dim, z);
    if (!(yield* waitLoaded(player, dim, z, "[Spawn] Undo:"))) { removeAreas(dim); say(player, "§c[Spawn] The area could not be loaded. Go there and try again."); return; }
    for (const c of z.crates ?? []) { try { removeCrateAt(z.d, c.x, c.y, c.z); } catch (e) { /* ignore */ } }
    for (const id of z.boards ?? []) { try { removeFixed(id); } catch (e) { /* ignore */ } }
    const tiles = z.tiles ?? (z.backup ? [{ id: "smp:spawn_backup", x: z.x1, y: z.y1, z: z.z1 }] : []);
    let ok = 0;
    for (const t of tiles) {
      try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[spawnbuild] undo: " + e); }
      try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ }
      bar(player, "§a[Spawn] §fUndo... §e" + ok + "/" + tiles.length);
      yield;
    }
    const until = system.currentTick + 5; while (system.currentTick < until) yield;
    try { for (const it of dim.getEntities({ type: "minecraft:item" })) { const l = it.location; if (inZone(z.d, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z))) it.remove(); } } catch (e) { /* ignore */ }
    try { world.setDynamicProperty(SPAWN_KEY, typeof z.prevSpawn === "string" ? z.prevSpawn : undefined); } catch (e) { /* ignore */ }
    if (z.prevWorldSpawn) { try { world.setDefaultSpawnLocation(z.prevWorldSpawn); } catch (e) { /* ignore */ } }
    clearZone();
    removeAreas(dim);
    try { slog(player, "spawnbuild", null, "Spawn removed (undo)"); } catch (e) { /* ignore */ }
    say(player, tiles.length && ok === tiles.length ? "§a[Spawn] Undone: the land is back as it was, the old spawn point is back." : "§e[Spawn] Protection removed and the old spawn point is back (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
export function undoSpawn(player) {
  if (!isOwner(player)) return say(player, "§c[Spawn] Only the Owner can do this.");
  if (busy) return say(player, "§c[Spawn] Wait until the spawn is built.");
  const z = getZone(); if (!z) return say(player, "§c[Spawn] There is no built spawn.");
  let dim; try { dim = world.getDimension(z.d); } catch (e) { return say(player, "§c[Spawn] Dimension not found."); }
  busy = true;
  system.runJob(undoJob(player, dim, z));
}

function goTo(player, rel) {
  const z = getZone(); if (!z) return say(player, "§c[Spawn] There is no built spawn.");
  try { player.teleport({ x: z.cx + rel.x + 0.5, y: z.cy + rel.y, z: z.cz + rel.z + 0.5 }, { dimension: world.getDimension(z.d) }); } catch (e) { say(player, "§c[Spawn] Teleport failed."); }
}

// ---------------------------------------------------------------- menu pages (Owner only)
export function buildingPage(player, back) {
  if (!isOwner(player)) return say(player, "§c[Operator] Only the Owner can open Building.");
  const self = () => buildingPage(player, back), z = getZone();
  const f = make("Operator: Building", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, "g") + "§a§lBuilding\n§r§7Ready places that are built for you\n§r§7Only the Owner can use this", "textures/blocks/grass_side_carried", null);
  set(f, 2 * COLS + 4, hdr(1, z ? "g" : "c") + "§a§lSpawn\n§r§7Grand: walled sanctuary, giant tree,\n§r§7Crate Temple, Hall of Legends (TOP)\n§r§7Small: 41 x 41 garden\n§r§7Now: " + (busy ? "§ebeing built" : z ? "§abuilt" : "§fnot built") + "\n§r§eClick to open", "textures/blocks/sapling_oak", { run: () => spawnPage(player, self) });
  set(f, 2 * COLS + 2, hdr(1, "g") + "§d§lAFK Hall\n§r§7The Crimson Hall: red & white,\n§r§7glass dome, chandeliers, seats\n§r§7It becomes the AFK area (/afk)\n§r§eClick to open", "textures/items/clock_item", { run: () => { try { afkHook.page(player, self); } catch (e) { say(player, "§c[AFK] " + e); } } });
  set(f, 2 * COLS + 6, hdr(1, "g") + "§c§lArenas\n§r§7Two colosseums for fighting:\n§r§7Keep Inventory / No Keep\n§r§7You choose the rules of each one\n§r§eClick to open", "textures/items/diamond_sword", { run: () => { try { arenaHook.page(player, self); } catch (e) { say(player, "§c[Arena] " + e); } } });
  set(f, 1 * COLS + 2, hdr(1, "g") + "§6§lPillars\n§r§7Pillars of Fortune: 16 pillars\n§r§7in the sky, random items\n§r§7Games: Events > Pillars\n§r§eClick to open", "textures/items/gold_ingot", { run: () => { try { pillarsHook.page(player, self); } catch (e) { say(player, "§c[Pillars] " + e); } } });
  set(f, 1 * COLS + 6, hdr(1, "g") + "§e§lPillars 1x1\n§r§7Pillars of Fortune, hard: 16\n§r§7pillars of ONE block in the sky\n§r§7Games: Events > Pillars 1x1\n§r§eClick to open", "textures/items/gold_nugget", { run: () => { try { pillars1Hook.page(player, self); } catch (e) { say(player, "§c[Pillars 1x1] " + e); } } });
  set(f, 1 * COLS + 4, hdr(1, "g") + "§d§lDropper\n§r§7A giant tower with 7 drop shafts\n§r§7(80 - 120 high), water pools, a lobby\n§r§7Games: Events > Dropper\n§r§eClick to open", "textures/items/feather", { run: () => { try { dropperHook.page(player, self); } catch (e) { say(player, "§c[Dropper] " + e); } } });
  set(f, 3 * COLS + 6, hdr(1, "g") + "§d§lRed Light\n§r§7Red Light, Green Light: a long\n§r§7field, sky walls, a giant doll\n§r§7Games: Events > Red Light\n§r§eClick to open", "textures/items/dye_powder_pink", { run: () => { try { squidHook.page(player, self); } catch (e) { say(player, "§c[Red Light] " + e); } } });
  set(f, 3 * COLS + 2, hdr(1, "g") + "§c§lTNT Run\n§r§7An arena with 4 falling floors\n§r§7(sand / gravel on TNT), seats\n§r§7Games: Events > TNT Run\n§r§eClick to open", "textures/blocks/tnt_side", { run: () => { try { tntHook.page(player, self); } catch (e) { say(player, "§c[TNT Run] " + e); } } });
  set(f, 3 * COLS + 4, hdr(1, "g") + "§a§lStadium\n§r§7A football stadium: pitch, stands,\n§r§7roof, scoreboards, floodlights\n§r§7Matches: Events > Football\n§r§eClick to open", "textures/items/slime_ball", { run: () => { try { stadiumHook.page(player, self); } catch (e) { say(player, "§c[Stadium] " + e); } } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
/** set by arena.js (no import loop) */
export const arenaHook = { page: () => {} };
/** set by afkhall.js (no import loop) */
export const afkHook = { page: () => {} };
/** set by football.js (no import loop) */
export const stadiumHook = { page: () => {} };
/** set by tntrun.js (no import loop) */
export const tntHook = { page: () => {} };
/** set by squidgame.js (no import loop) */
export const squidHook = { page: () => {} };
/** set by dropper.js (no import loop) */
export const dropperHook = { page: () => {} };
/** set by pillars.js (no import loop) */
export const pillarsHook = { page: () => {} };
/** set by pillars.js (the 1 x 1 game) */
export const pillars1Hook = { page: () => {} };
function spawnPage(player, back) {
  if (!isOwner(player)) return;
  const self = () => spawnPage(player, back), z = getZone();
  const f = make("Building: Spawn", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, z ? "g" : "c") + "§a§lSpawn\n§r§7Built around you: you stand in the middle\n§r§7Only the Owner can break / build / use\n§r§7blocks there (Admins too can't)" + (z ? "\n§r§7Place: §f" + z.cx + " " + z.cy + " " + z.cz : ""), "textures/blocks/sapling_oak", null);
  const here = () => ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z)];
  if (!z) {
    set(f, 2 * COLS + 3, hdr(1, "g") + "§2§lGrand Spawn\n§r§7The Ancient Sanctuary: 151 x 151\n§r§7Walls, towers, giant tree of life,\n§r§7Crate Temple (3 crates placed),\n§r§7Hall of Legends (10 TOP boards),\n§r§7waterfall, ruins, gardens\n§r§7The land is saved first (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm", { run: () => confirm(player, "Build the Grand Spawn here?", [...here(), "§7Everything in 151 x 151 blocks around you", "§7is replaced (Undo puts it back).", "§7Takes about a minute. No lag."], () => buildHere(player, "grand"), self) });
    set(f, 2 * COLS + 5, hdr(1, "c") + "§a§lSmall Spawn\n§r§7Green garden spawn: 41 x 41\n§r§7Gazebo, fountain, trees, 4 paths\n§r§eClick to build", "textures/blocks/sapling_oak", { run: () => confirm(player, "Build the Small Spawn here?", [...here(), "§7Everything in 41 x 41 blocks around you", "§7is replaced (Undo puts it back)."], () => buildHere(player, "small"), self) });
  } else {
    const D = KINDS[z.kind ?? "small"].D;
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7Go to the spawn\n§r§eClick to go", "textures/items/ender_pearl", { run: () => goTo(player, D.spawn) });
    if (D.places?.crates) set(f, 2 * COLS + 3, hdr(1, "g") + "§d§lCrate Temple\n§r§7Go to the crates\n§r§eClick to go", "textures/ui/shop/i3d_barrel", { run: () => goTo(player, D.places.crates) });
    if (D.places?.top) set(f, 2 * COLS + 5, hdr(1, "g") + "§6§lHall of Legends\n§r§7Go to the TOP boards\n§r§eClick to go", "textures/items/gold_ingot", { run: () => goTo(player, D.places.top) });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo\n§r§7Remove the spawn: the land comes\n§r§7back as it was before\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the spawn?", ["§7The land comes back as it was.", "§7The old spawn point comes back."], () => undoSpawn(player), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- protection: only the Owner (players may still open the crates)
const told = new Map();
function deny(p) {
  system.run(() => {
    try {
      const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now);
      p.sendMessage(pick(p, "§c[Spawn] The spawn is protected. Only the Owner can change it.", "§c[السباون] السباون محمي. فقط المالك يقدر يعدل عليه."));
    } catch (e) { /* ignore */ }
  });
}
const free = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[spawnbuild] " + name + ": " + e); } };
const FACE = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
const LIQUID = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper)$/, DANGER = /^(flint_and_steel|fire_charge|tnt|tnt_minecart|end_crystal|respawn_anchor|bed|.+_bed)$/, PISTON = /^(piston|sticky_piston)$/;

safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (!getZone()) return;
  const b = ev.block;
  if (inZone(b.dimension.id, b.x, b.y, b.z) && !free(ev.player)) { ev.cancel = true; deny(ev.player); }
}));
safe("place", () => { const s = world.beforeEvents.playerPlaceBlock; if (!s) return; s.subscribe((ev) => {
  if (!getZone()) return;
  const b = ev.block;
  if (inZone(b.dimension.id, b.x, b.y, b.z) && !free(ev.player)) { ev.cancel = true; deny(ev.player); }
}); });
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!getZone() || free(ev.player)) return;
  const b = ev.block, d = b.dimension.id;
  if (isCrateAt(d, b.x, b.y, b.z)) return;                                       // crates: everybody may open them
  const f = FACE[String(ev.blockFace)] ?? [0, 0, 0];
  const px = b.x + f[0], py = b.y + f[1], pz = b.z + f[2];
  let hit = inZone(d, b.x, b.y, b.z) || inZone(d, px, py, pz);
  if (!hit) {
    const item = ev.itemStack?.typeId?.replace("minecraft:", "");
    if (item) hit = LIQUID.test(item) ? inZoneColumn(d, px, py, pz, 10) : DANGER.test(item) ? inZone(d, px, py, pz, 8) : PISTON.test(item) ? inZone(d, px, py, pz, 13) : false;
  }
  if (hit) { ev.cancel = true; deny(ev.player); }
}));
safe("entity", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (!getZone() || free(ev.player)) return;
  const t = ev.target; if (!t) return;
  const id = t.typeId;
  if (id !== "minecraft:armor_stand" && id !== "minecraft:painting" && !/item_frame$/.test(id)) return;    // NPCs / buttons of other systems keep working
  const l = t.location;
  if (inZone(t.dimension.id, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z))) { ev.cancel = true; deny(ev.player); }
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  if (!getZone()) return;
  const all = ev.getImpactedBlocks(), d = ev.dimension.id, keep = all.filter((b) => !inZone(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => told.delete(playerId)));
