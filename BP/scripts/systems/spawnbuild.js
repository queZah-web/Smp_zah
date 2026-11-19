// ===================================================================================================================
// /opr > Building > Spawn   (OWNER ONLY)
//
// Builds a green, tidy spawn around the Owner (41 x 41 blocks, about 17 blocks high):
//   * a garden circle with low azalea hedges, flowers, 4 big leafy trees with hanging lanterns
//   * a round stone plaza with lights in the floor and 4 paths (benches, lamp posts, leafy arches at the exits)
//   * in the middle: a white pillar gazebo with a green copper dome, hanging lanterns, glow-berry vines and a fountain
//
// No lag:
//   * it is built a little every tick (system.runJob), never all at once
//   * only plain blocks: no entities, no redstone, no hoppers, still water only (closed basin), leaves that never decay
//     (persistent), glow-berry vines that never grow, invisible light blocks so no mobs spawn in the garden
//
// Undo: before building, the land is saved in a structure (world save) - "Undo" puts it back exactly as it was.
// Protection: nobody but the Owner can break, place or use blocks inside the spawn (Admins too), explosions don't touch it,
// and no liquids / fire / TNT / pistons can be used close to it.
// ===================================================================================================================
import { world, system, BlockPermutation, BlockVolume, StructureSaveMode } from "@minecraft/server";
import { makeOpr as make, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { getZone, setZone, clearZone, inZone, inZoneColumn } from "./spawnzone.js";

const R = 20;                      // radius of the spawn circle (41 blocks across)
const PAD = 1;                     // protected border around it
const UP = 24, DOWN = 4;           // protected / saved height above and below the floor
const BACKUP = "smp:spawn_backup";
const SPAWN_KEY = "spawn:v1";      // the /spawn point (spawn.js)
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- blocks
const permCache = new Map();
/** a block (with states); a state the game does not know is dropped; an unknown block -> null (skipped) */
function perm(id, states) {
  const key = id + JSON.stringify(states ?? {});
  if (permCache.has(key)) return permCache.get(key);
  let p = null;
  for (const one of id.split("|")) {                     // "a|b": the first block this game version knows
    const name = one.startsWith("minecraft:") ? one : "minecraft:" + one;
    try { p = BlockPermutation.resolve(name, states); } catch (e) { try { p = BlockPermutation.resolve(name); } catch (x) { p = null; } }
    if (p) break;
  }
  permCache.set(key, p);
  return p;
}
const M = (n) => "minecraft:" + n;
const LEAF = { persistent_bit: true };
// stairs: the high side looks towards dir  (0 = +x east, 1 = -x west, 2 = +z south, 3 = -z north)
const dirOf = (vx, vz) => (Math.abs(vx) >= Math.abs(vz) ? (vx > 0 ? 0 : 1) : (vz > 0 ? 2 : 3));
const rnd = (v) => Math.sign(v) * Math.round(Math.abs(v));

// ---------------------------------------------------------------- the design (relative to the centre: dx, dy, dz; dy 0 = floor)
export function spawnDesign() {
  let seed = 20251119;
  const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cells = new Map();                                   // "x,y,z" -> { id, st, late }
  const put = (x, y, z, id, st, late = false) => cells.set(x + "," + y + "," + z, { x, y, z, id, st, late });
  const has = (x, y, z) => cells.has(x + "," + y + "," + z);
  const pathMinor = (x, z) => (Math.abs(z) <= 2 ? Math.abs(z) : Math.abs(x) <= 2 ? Math.abs(x) : 99);    // distance from the middle line of a path
  const inCircle = (x, z) => Math.hypot(x, z) <= R + 0.5;

  // floor
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    if (!inCircle(x, z)) continue;
    const r = Math.hypot(x, z), pm = pathMinor(x, z);
    let b;
    if (r < 2.6) b = null;                                                   // fountain water (later)
    else if (r < 3.6) b = "polished_diorite";                                // fountain rim
    else if (r < 5.5) b = (Math.abs(r - 4.5) < 0.5 && Math.abs(((Math.atan2(z, x) * 180 / Math.PI) + 382.5) % 45 - 22.5) < 7) ? "verdant_froglight" : (Math.abs(x) + Math.abs(z)) % 2 ? "calcite" : "polished_diorite";
    else if (r < 7.5) b = rng() < 0.35 ? "mossy_stone_bricks" : "stone_bricks";
    else if (r < 11.5) {
      const ang = ((Math.atan2(z, x) * 180 / Math.PI) + 360) % 30;
      if (Math.abs(r - 9.8) < 0.5) b = ang < 6 ? "verdant_froglight" : "calcite";
      else { const q = rng(); b = q < 0.12 ? "cracked_deepslate_tiles" : q < 0.25 ? "polished_deepslate" : "deepslate_tiles"; }
    } else if (pm <= 2) {                                                    // the 4 paths
      if (pm === 2) b = "polished_andesite";
      else { const q = rng(); b = q < 0.25 ? "mossy_stone_bricks" : q < 0.35 ? "cracked_stone_bricks" : "stone_bricks"; }
    } else if (r < 12.5) b = "mossy_stone_bricks";                           // plaza border
    else b = "grass_block";
    if (b) put(x, 0, z, b);
  }
  // fountain: basin, water, lights under the water, the statue in the middle
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const r = Math.hypot(x, z);
    if (r < 2.6) {
      put(x, -1, z, Math.abs(x) + Math.abs(z) === 1 ? "sea_lantern" : "prismarine_bricks");
      if (x || z) put(x, 0, z, "water", { liquid_depth: 0 }, true);
    } else if (r < 3.6) put(x, 1, z, "smooth_quartz_slab", { "minecraft:vertical_half": "bottom" });
  }
  ["chiseled_stone_bricks", "chiseled_stone_bricks", "mossy_stone_bricks", "chiseled_stone_bricks", "sea_lantern", "moss_block"].forEach((b, i) => put(0, i, 0, b));
  put(0, 6, 0, "flowering_azalea", undefined, true);

  // gazebo: 8 pillars, beam ring, mossy eaves with vines, copper dome, lanterns
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, px = rnd(6.5 * Math.cos(a)), pz = rnd(6.5 * Math.sin(a));
    put(px, 1, pz, "chiseled_stone_bricks");
    for (let y = 2; y <= 6; y++) put(px, y, pz, "quartz_pillar", { pillar_axis: "y" });
    put(px, 7, pz, "chiseled_stone_bricks");
    const b = a + Math.PI / 8, lx = rnd(6 * Math.cos(b)), lz = rnd(6 * Math.sin(b));
    put(lx, 7, lz, "waxed_oxidized_copper_lantern|lantern", { hanging: true }, true);
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    const r = Math.hypot(x, z);
    if (r >= 5.6 && r < 7.6) put(x, 8, z, "stone_bricks");
    else if (r >= 7.6 && r < 8.5) {
      put(x, 8, z, "mossy_stone_bricks");
      put(x, 9, z, rng() < 0.3 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF);
      if (rng() < 0.4) {                                                     // glow berries hanging from the eaves (never grow)
        const two = rng() < 0.45;
        if (two) { put(x, 7, z, "cave_vines_body_with_berries", { growing_plant_age: 25 }, true); put(x, 6, z, "cave_vines_head_with_berries", { growing_plant_age: 25 }, true); }
        else put(x, 7, z, "cave_vines_head_with_berries", { growing_plant_age: 25 }, true);
      }
    }
  }
  const RINGS = [7.6, 6.43, 5.26, 4.09, 2.92, 1.75, 0.58, -1];
  for (let k = 0; k < 7; k++) for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    const r = Math.hypot(x, z);
    if (r >= RINGS[k] || r < RINGS[k + 1]) continue;
    if (k === 6 || Math.abs(Math.abs(x) - Math.abs(z)) === 0) put(x, 9 + k, z, k === 6 ? "waxed_oxidized_copper" : "waxed_oxidized_cut_copper");
    else put(x, 9 + k, z, "waxed_oxidized_cut_copper_stairs", { weirdo_direction: dirOf(-x, -z), upside_down_bit: false });
  }
  put(0, 16, 0, "end_rod", { facing_direction: 1 }, true);
  for (let y = 11; y <= 14; y++) put(0, y, 0, "waxed_oxidized_copper_chain|iron_chain|chain", { pillar_axis: "y" }, true);
  put(0, 10, 0, "waxed_oxidized_copper_lantern|lantern", { hanging: true }, true);

  // low hedge around the plaza (open at the paths)
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
    const r = Math.hypot(x, z);
    if (r >= 12.6 && r < 13.4 && pathMinor(x, z) > 3) put(x, 1, z, rng() < 0.25 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF);
  }
  // outer hedge (open at the paths)
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const r = Math.hypot(x, z);
    if (r >= R - 0.5 && r <= R + 0.5 && pathMinor(x, z) > 2) put(x, 1, z, rng() < 0.2 ? "azalea_leaves_flowered" : "oak_leaves", LEAF);
  }

  // the 4 paths: lamp posts, benches, leafy arch at the exit  (built for the +x path, then turned 90 degrees 3 times)
  const turn = (k, x, z) => { for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; };
  const turnDir = (k, d) => { const v = [[1, 0], [-1, 0], [0, 1], [0, -1]][d]; const [a, b] = turn(k, v[0], v[1]); return dirOf(a, b); };
  for (let k = 0; k < 4; k++) {
    const P = (x, y, z, id, st, late) => { const [a, b] = turn(k, x, z); put(a, y, b, id, st, late); };
    for (const s of [-1, 1]) {
      for (const lx of [13, 18]) { P(lx, 1, 3 * s, "dark_oak_fence"); P(lx, 2, 3 * s, "dark_oak_fence"); P(lx, 3, 3 * s, "lantern", { hanging: false }, true); }
      for (const bx of [15, 16]) P(bx, 1, 3 * s, "dark_oak_stairs", { weirdo_direction: turnDir(k, s > 0 ? 2 : 3), upside_down_bit: false });
      for (let y = 1; y <= 4; y++) P(19, y, 3 * s, y === 1 || y === 4 ? "chiseled_stone_bricks" : "mossy_stone_bricks");
    }
    for (let z = -3; z <= 3; z++) { P(19, 5, z, z === 0 ? "chiseled_stone_bricks" : "stone_bricks"); P(19, 6, z, rng() < 0.35 ? "azalea_leaves_flowered" : "azalea_leaves", LEAF); }
    P(19, 4, 0, "lantern", { hanging: true }, true);
  }

  // 4 big trees (diagonals) with lanterns and vines under the leaves
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tx = 11 * sx, tz = 11 * sz;
    for (let y = 1; y <= 7; y++) put(tx, y, tz, "dark_oak_log", { pillar_axis: "y" });
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(tx + ox, 1, tz + oz, "dark_oak_log", { pillar_axis: ox ? "x" : "z" });
    const low = new Map();
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = -4; z <= 4; z++) {
      const d = Math.hypot(x, y * 1.15, z);
      if (d > 3.4 - rng() * 0.7 || (x === 0 && z === 0 && y <= 0)) continue;
      const q = rng();
      put(tx + x, 7 + y, tz + z, q < 0.55 ? "oak_leaves" : q < 0.82 ? "azalea_leaves" : "azalea_leaves_flowered", LEAF);
      const key = x + "," + z; if (!low.has(key) || low.get(key) > 7 + y) low.set(key, 7 + y);
    }
    for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const y = low.get(ox + "," + oz); if (y && y - 1 >= 3) put(tx + ox, y - 1, tz + oz, "lantern", { hanging: true }, true); }
    for (const [key, y] of low) {
      const [x, z] = key.split(",").map(Number);
      if ((Math.abs(x) === 2 && z === 0) || (Math.abs(z) === 2 && x === 0) || (x === 0 && z === 0) || y - 1 < 3 || rng() > 0.22) continue;
      put(tx + x, y - 1, tz + z, "cave_vines_head_with_berries", { growing_plant_age: 25 }, true);
    }
  }

  // garden: invisible lights (no mobs), then grass and flowers on what is still free
  const FLOWERS = ["cornflower", "allium", "oxeye_daisy", "lily_of_the_valley", "azure_bluet", "pink_tulip", "white_tulip", "blue_orchid", "dandelion", "poppy"];
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const g = cells.get(x + ",0," + z); if (!g || g.id !== "grass_block" || has(x, 1, z)) continue;
    if (((x % 5) + 5) % 5 === 0 && ((z % 5) + 5) % 5 === 0) { put(x, 1, z, "light_block_14", undefined, true); continue; }
    const q = rng();
    if (q < 0.28) put(x, 1, z, "short_grass", undefined, true);
    else if (q < 0.46) put(x, 1, z, FLOWERS[Math.floor(rng() * FLOWERS.length)], undefined, true);
    else if (q < 0.5) put(x, 1, z, "pink_petals", { growth: 3, "minecraft:cardinal_direction": ["north", "south", "east", "west"][Math.floor(rng() * 4)] }, true);
    else if (q < 0.525) put(x, 1, z, rng() < 0.5 ? "azalea" : "flowering_azalea", undefined, true);
  }
  return [...cells.values()];
}

// ---------------------------------------------------------------- building (a little every tick)
let busy = false;
function* buildJob(player, dim, cx, fy, cz, done) {
  const list = spawnDesign();
  const total = list.length + (2 * R + 1) * 2;
  let n = 0, lastPct = -1, fails = 0;
  const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; try { player.onScreenDisplay.setActionBar("§a[Spawn] §fBuilding... §e" + pct + "%"); } catch (e) { /* ignore */ } } };
  const air = perm(M("air")), dirt = perm(M("dirt"));
  // 1. clear the circle (air above the floor) and fill the ground under it (no holes, no caves under the spawn)
  for (let x = -R; x <= R; x++) {
    const h = Math.floor(Math.sqrt(Math.max(0, (R + 0.5) ** 2 - x * x)));
    try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy + 1, z: cz - h }, { x: cx + x, y: fy + 22, z: cz + h }), air); } catch (e) { fails++; }
    n++; tick(); yield;
    try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy - 3, z: cz - h }, { x: cx + x, y: fy - 1, z: cz + h }), dirt); } catch (e) { fails++; }
    n++; tick(); yield;
  }
  // 2. solid blocks from the bottom up, 3. things that hang / stand on other blocks (top down), water last
  const solid = list.filter((c) => !c.late).sort((a, b) => a.y - b.y);
  const late = list.filter((c) => c.late).sort((a, b) => (a.id === "water") - (b.id === "water") || b.y - a.y);
  let k = 0;
  for (const c of [...solid, ...late]) {
    const p = perm(c.id, c.st);
    if (p) { try { dim.getBlock({ x: cx + c.x, y: fy + c.y, z: cz + c.z })?.setPermutation(p); } catch (e) { fails++; } }
    n++; if (++k % 24 === 0) { tick(); yield; }
  }
  done(fails);
}

export function buildHere(player) {
  if (!isOwner(player)) return say(player, "§c[Spawn] Only the Owner can build the spawn.");
  if (busy) return say(player, "§c[Spawn] A spawn is being built right now. Wait until it is done.");
  if (getZone()) return say(player, "§c[Spawn] A spawn already exists. Undo it first (Building > Spawn > Undo).");
  const dim = player.dimension, l = player.location;
  const cx = Math.floor(l.x), cz = Math.floor(l.z), fy = Math.floor(l.y) - 1;
  const hr = dim.heightRange;
  if (fy - DOWN < hr.min || fy + UP >= hr.max) return say(player, "§c[Spawn] Too high or too low here. Stand on normal ground.");
  for (const [x, z] of [[-R - PAD, -R - PAD], [R + PAD, -R - PAD], [-R - PAD, R + PAD], [R + PAD, R + PAD], [0, 0]]) {
    let b; try { b = dim.getBlock({ x: cx + x, y: fy, z: cz + z }); } catch (e) { b = undefined; }
    if (!b) return say(player, "§c[Spawn] The area is not loaded. Stand in the middle of the place and try again.");
  }
  const zone = { d: dim.id, x1: cx - R - PAD, y1: fy - DOWN, z1: cz - R - PAD, x2: cx + R + PAD, y2: fy + UP, z2: cz + R + PAD, cx, cy: fy, cz, t: Date.now() };
  // save the land as it is now (Undo)
  try {
    try { world.structureManager.delete(BACKUP); } catch (e) { /* none yet */ }
    world.structureManager.createFromWorld(BACKUP, dim, { x: zone.x1, y: zone.y1, z: zone.z1 }, { x: zone.x2, y: zone.y2, z: zone.z2 }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
    zone.backup = true;
  } catch (e) { zone.backup = false; console.warn("[spawnbuild] backup failed: " + e); }
  try { zone.prevSpawn = world.getDynamicProperty(SPAWN_KEY) ?? null; } catch (e) { zone.prevSpawn = null; }
  try { const s = world.getDefaultSpawnLocation(); zone.prevWorldSpawn = { x: s.x, y: s.y, z: s.z }; } catch (e) { zone.prevWorldSpawn = null; }
  setZone(zone);                                                           // protected from now on (also while it is being built)
  busy = true;
  const t0 = Date.now();
  say(player, "§a[Spawn] Building the spawn... §7(a few seconds, no lag)" + (zone.backup ? "" : " §c(no backup: Undo will not be possible)"));
  try { slog(player, "spawnbuild", null, "Spawn built at " + cx + " " + fy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, cx, fy, cz, (fails) => {
    busy = false;
    const sp = { x: cx, y: fy + 1, z: cz + 9, d: dim.id };
    try { world.setDynamicProperty(SPAWN_KEY, JSON.stringify(sp)); } catch (e) { /* ignore */ }
    if (dim.id === "minecraft:overworld") { try { world.setDefaultSpawnLocation({ x: sp.x, y: sp.y, z: sp.z }); } catch (e) { /* ignore */ } try { world.gameRules.spawnRadius = 0; } catch (e) { /* ignore */ } }
    try { player.onScreenDisplay.setActionBar("§a[Spawn] §fDone!"); } catch (e) { /* ignore */ }
    say(player, "§a[Spawn] The spawn is ready! §7(" + Math.round((Date.now() - t0) / 100) / 10 + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ") §aIt is now the /spawn point. Only you can change it.");
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  }));
}

export function undoSpawn(player) {
  if (!isOwner(player)) return say(player, "§c[Spawn] Only the Owner can do this.");
  if (busy) return say(player, "§c[Spawn] Wait until the spawn is built.");
  const z = getZone(); if (!z) return say(player, "§c[Spawn] There is no built spawn.");
  let dim; try { dim = world.getDimension(z.d); } catch (e) { return say(player, "§c[Spawn] Dimension not found."); }
  if (z.backup) {
    try { world.structureManager.place(BACKUP, dim, { x: z.x1, y: z.y1, z: z.z1 }); }
    catch (e) { return say(player, "§c[Spawn] Could not put the land back (go there so the area is loaded): " + e); }
    try { world.structureManager.delete(BACKUP); } catch (e) { /* ignore */ }
    system.runTimeout(() => {                                                   // items that dropped while the blocks changed
      try { for (const it of dim.getEntities({ type: "minecraft:item" })) { const l = it.location; if (inZone(z.d, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z))) it.remove(); } } catch (e) { /* ignore */ }
    }, 5);
  }
  try { world.setDynamicProperty(SPAWN_KEY, typeof z.prevSpawn === "string" ? z.prevSpawn : undefined); } catch (e) { /* ignore */ }
  if (z.prevWorldSpawn) { try { world.setDefaultSpawnLocation(z.prevWorldSpawn); } catch (e) { /* ignore */ } }
  clearZone();
  try { slog(player, "spawnbuild", null, "Spawn removed (undo)"); } catch (e) { /* ignore */ }
  say(player, z.backup ? "§a[Spawn] Undone: the land is back as it was, the old spawn point is back." : "§e[Spawn] Protection removed and the old spawn point is back (there was no backup, the blocks stay).");
}

function goThere(player) {
  const z = getZone(); if (!z) return say(player, "§c[Spawn] There is no built spawn.");
  try { player.teleport({ x: z.cx + 0.5, y: z.cy + 1, z: z.cz + 9.5 }, { dimension: world.getDimension(z.d) }); } catch (e) { say(player, "§c[Spawn] Teleport failed."); }
}

// ---------------------------------------------------------------- menu pages (Owner only)
export function buildingPage(player, back) {
  if (!isOwner(player)) return say(player, "§c[Operator] Only the Owner can open Building.");
  const self = () => buildingPage(player, back), z = getZone();
  const f = make("Operator: Building", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, "g") + "§a§lBuilding\n§r§7Ready places that are built for you\n§r§7Only the Owner can use this", "textures/blocks/grass_side_carried", null);
  set(f, 2 * COLS + 4, hdr(1, z ? "g" : "c") + "§a§lSpawn\n§r§7Green garden spawn with a gazebo,\n§r§7fountain, trees and 4 paths\n§r§7Size: 41 x 41 (no lag)\n§r§7Now: " + (busy ? "§ebeing built" : z ? "§abuilt" : "§fnot built") + "\n§r§eClick to open", "textures/blocks/sapling_oak", { run: () => spawnPage(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function spawnPage(player, back) {
  if (!isOwner(player)) return;
  const self = () => spawnPage(player, back), z = getZone();
  const f = make("Building: Spawn", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, z ? "g" : "c") + "§a§lSpawn\n§r§7Built around you: you stand in the middle\n§r§7Only the Owner can break / build / use\n§r§7blocks there (Admins too can't)" + (z ? "\n§r§7Place: §f" + z.cx + " " + z.cy + " " + z.cz : ""), "textures/blocks/sapling_oak", null);
  if (!z) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild here\n§r§7Middle = where you stand\n§r§7The land is saved first (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm", { run: () => confirm(player, "Build the spawn here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 41 x 41 blocks around you", "§7is replaced (Undo puts it back)."], () => buildHere(player), self) });
  } else {
    set(f, 2 * COLS + 2, hdr(1, "g") + "§b§lTeleport\n§r§7Go to the spawn\n§r§eClick to go", "textures/items/ender_pearl", { run: () => goThere(player) });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lUndo\n§r§7Remove the spawn: the land comes\n§r§7back as it was before\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the spawn?", ["§7The land comes back as it was.", "§7The old spawn point comes back."], () => undoSpawn(player), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- protection: only the Owner
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
  const b = ev.block, d = b.dimension.id, f = FACE[String(ev.blockFace)] ?? [0, 0, 0];
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
