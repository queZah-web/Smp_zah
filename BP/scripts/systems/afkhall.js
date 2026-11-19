// ===================================================================================================================
// /opr > Building > AFK Hall  (OWNER ONLY)  -  "The Crimson Hall" (afkdesign.js)
//   * built around the Owner (45 x 46, 39 high), a little every tick (no lag), the land is saved first (Undo)
//   * when it is ready, the AFK AREA of afk.js becomes the inside of the hall and the arrival spot its middle:
//     /afk takes the players there and they get the AFK rewards (money / shards per minute, set in the AFK menu)
//   * the hall itself is protected: only the Owner can break / place / use blocks of it
//   * Undo: the land comes back and the AFK area that was set before comes back too
// ===================================================================================================================
import { world, system, BlockVolume, StructureSaveMode } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";
import { addZoneSource, spawnOverlaps, otherZoneOverlaps } from "./spawnzone.js";
import { perm, addAreas, removeAreas, waitLoaded, afkHook } from "./spawnbuild.js";
import { AFKHALL, afkHallGen } from "./afkdesign.js";
import { setAfkZoneExact, afkSettings } from "./afk.js";

const KEY = "afkhall:v1", PREFIX = "smp_afkhall_", PAD = 1, TILE = 51;
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const bar = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch (e) { /* ignore */ } };
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[afkhall] " + name + ": " + e); } };

let hall;                                         // undefined = not read, null = none
function get() {
  if (hall !== undefined) return hall;
  try { const raw = world.getDynamicProperty(KEY); hall = typeof raw === "string" ? JSON.parse(raw) : null; } catch (e) { return null; }
  return hall;
}
function put(h) { hall = h; try { world.setDynamicProperty(KEY, h ? JSON.stringify(h) : undefined); } catch (e) { console.warn("[afkhall] save: " + e); } }
addZoneSource(() => (get() ? [get()] : []));      // land protection / other builders keep away
const inHall = (h, d, x, y, z) => !!h && h.d === d && x >= h.x1 && x <= h.x2 && y >= h.y1 && y <= h.y2 && z >= h.z1 && z <= h.z2;

let busy = false;
function* buildJob(player, dim, h) {
  const t0 = Date.now(), R = AFKHALL.R, cx = h.cx, fy = h.cy, cz = h.cz;
  try {
    addAreas(dim, h, PREFIX);
    if (!(yield* waitLoaded(player, dim, h, "[AFK] Building:"))) { removeAreas(dim, PREFIX); say(player, "§c[AFK] The area could not be loaded. Stand in the middle and try again."); return; }
    h.tiles = []; h.backup = true;
    for (let x = h.x1; x <= h.x2; x += TILE) for (let z = h.z1; z <= h.z2; z += TILE) {
      const id = "smp:afkhall_" + h.tiles.length;
      try {
        try { world.structureManager.delete(id); } catch (e) { /* none */ }
        world.structureManager.createFromWorld(id, dim, { x, y: h.y1, z }, { x: Math.min(x + TILE - 1, h.x2), y: h.y2, z: Math.min(z + TILE - 1, h.z2) }, { saveMode: StructureSaveMode.World, includeEntities: false, includeBlocks: true });
        h.tiles.push({ id, x, y: h.y1, z });
      } catch (e) { h.backup = false; console.warn("[afkhall] backup: " + e); }
      yield;
    }
    put(h);                                                              // protected from now on
    const g = afkHallGen(); let r; while (!(r = g.next()).done) yield;
    const canvas = r.value, og = canvas.orderedGen(); while (!(r = og.next()).done) yield;
    const buckets = r.value, pal = canvas.pal.map((p) => perm(p.id, p.st));
    const total = canvas.size + (2 * R + 1) * 2;
    let n = 0, fails = 0, last = -1;
    const tick = () => { const pct = Math.floor((n / total) * 100); if (pct !== last) { last = pct; bar(player, "§a[AFK] §fBuilding the Crimson Hall... §e" + pct + "%"); } };
    const air = perm("air"), dirt = perm("dirt");
    for (let x = -R; x <= R; x++) {
      const zmax = Math.abs(x) <= 6 ? AFKHALL.FRONT : R;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy + 1, z: cz - R }, { x: cx + x, y: fy + AFKHALL.UP - 2, z: cz + zmax }), air); } catch (e) { fails++; }
      n++; tick(); yield;
      try { dim.fillBlocks(new BlockVolume({ x: cx + x, y: fy - 4, z: cz - R }, { x: cx + x, y: fy - 1, z: cz + zmax }), dirt); } catch (e) { fails++; }
      n++; tick(); yield;
    }
    let k = 0;
    for (const b of buckets) for (let i = 0; i < b.length; i += 4) {
      const p = pal[b[i + 3]];
      if (p) { try { dim.getBlock({ x: cx + b[i], y: fy + b[i + 1], z: cz + b[i + 2] })?.setPermutation(p); } catch (e) { fails++; } }
      n++; if (++k % 40 === 0) { tick(); yield; }
    }
    // the AFK area = the inside of the hall, arrival spot = the middle
    const I = AFKHALL.IN, S = AFKHALL.spot;
    const zone = { d: dim.id, x1: cx - I, x2: cx + I, y1: fy, y2: fy + AFKHALL.TOP, z1: cz - I, z2: cz + I, sx: cx + S.x + 0.5, sy: fy + S.y, sz: cz + S.z + 0.5 };
    const res = setAfkZoneExact(player, zone);
    if (res.ok) { h.prevAfk = res.old ?? null; h.afkSet = true; put(h); }
    removeAreas(dim, PREFIX);
    bar(player, "§a[AFK] §fDone!");
    const st = afkSettings();
    say(player, "§a[AFK] The Crimson Hall is ready! §7(" + Math.round((Date.now() - t0) / 1000) + " s" + (fails ? ", " + fails + " blocks skipped" : "") + ")");
    say(player, res.ok ? "§a[AFK] It is now the AFK area: §f/afk §agoes there. Rewards: §f$" + st.money + " §a+ §d" + st.shards + " shards §aevery minute (change them in the AFK menu)." : "§c[AFK] The AFK area could not be set: " + res.err);
    try { player.playSound("random.levelup"); } catch (e) { /* ignore */ }
  } catch (e) { console.warn("[afkhall] build: " + e); say(player, "§c[AFK] Building stopped: " + e); removeAreas(dim, PREFIX); }
  finally { busy = false; }
}
function buildHere(player) {
  if (!owner(player)) return say(player, "§c[AFK] Only the Owner can build the AFK Hall.");
  if (busy) return say(player, "§c[AFK] The hall is being built right now. Wait until it is done.");
  if (get()) return say(player, "§c[AFK] The AFK Hall already exists. Undo it first.");
  const dim = player.dimension, l = player.location, R = AFKHALL.R;
  const cx = Math.floor(l.x), cz = Math.floor(l.z), fy = Math.floor(l.y) - 1, hr = dim.heightRange;
  if (fy - AFKHALL.DOWN < hr.min || fy + AFKHALL.UP >= hr.max) return say(player, "§c[AFK] Too high or too low here. Stand on normal ground.");
  const h = { d: dim.id, cx, cy: fy, cz, x1: cx - R - PAD, y1: fy - AFKHALL.DOWN, z1: cz - R - PAD, x2: cx + R + PAD, y2: fy + AFKHALL.UP, z2: cz + AFKHALL.FRONT + PAD, t: Date.now() };
  if (spawnOverlaps(h.d, h) || otherZoneOverlaps(h.d, h)) return say(player, "§c[AFK] Too close to the spawn or an arena. Move away and try again.");
  busy = true;
  say(player, "§a[AFK] Building the Crimson Hall (45 x 46)... §7Stay here until it says it is ready (no lag).");
  try { slog(player, "afkhall", null, "AFK Hall built at " + cx + " " + fy + " " + cz); } catch (e) { /* ignore */ }
  system.runJob(buildJob(player, dim, h));
}
function* undoJob(player, dim, h) {
  try {
    addAreas(dim, h, PREFIX);
    if (!(yield* waitLoaded(player, dim, h, "[AFK] Undo:"))) { removeAreas(dim, PREFIX); say(player, "§c[AFK] The area could not be loaded. Go there and try again."); return; }
    let ok = 0;
    for (const t of h.tiles ?? []) { try { world.structureManager.place(t.id, dim, { x: t.x, y: t.y, z: t.z }); ok++; } catch (e) { console.warn("[afkhall] undo: " + e); } try { world.structureManager.delete(t.id); } catch (e) { /* ignore */ } yield; }
    if (h.afkSet) setAfkZoneExact(player, h.prevAfk ?? null);
    put(null);
    removeAreas(dim, PREFIX);
    say(player, ok && ok === (h.tiles ?? []).length ? "§a[AFK] The AFK Hall was removed: the land and the old AFK area are back." : "§e[AFK] The AFK Hall was removed (the backup was not complete, some blocks stay).");
  } finally { busy = false; }
}
function undo(player) {
  if (!owner(player) || busy) return;
  const h = get(); if (!h) return;
  let dim; try { dim = world.getDimension(h.d); } catch (e) { return; }
  busy = true;
  system.runJob(undoJob(player, dim, h));
}

// ---------------------------------------------------------------- the Owner page
export function afkHallPage(player, back) {
  if (!owner(player)) return say(player, "§c[Operator] Only the Owner can open this.");
  const self = () => afkHallPage(player, back), h = get();
  const f = makeOpr("Building: AFK Hall", SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1, h ? "g" : "c") + "§c§lThe Crimson Hall\n§r§7A red & white hall with a glass dome,\n§r§7pillars, banners, crystals, chandeliers\n§r§7and seats all around (45 x 46, no lag)\n§r§7It becomes the AFK area (§f/afk§7)" + (h ? "\n§r§7Place: §f" + h.cx + " " + h.cy + " " + h.cz : ""), "textures/items/clock_item", null);
  if (!h) {
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lBuild here\n§r§7Middle = where you stand\n§r§7The land is saved first (Undo)\n§r§eClick to build", "textures/ui/shop/ic_confirm",
      { run: () => confirm(player, "Build the AFK Hall here?", ["§7Middle: §f" + Math.floor(player.location.x) + " " + Math.floor(player.location.y) + " " + Math.floor(player.location.z), "§7Everything in 45 x 46 blocks around you", "§7is replaced (Undo puts it back).", "§7The AFK area moves into the hall."], () => buildHere(player), self) });
  } else {
    set(f, 2 * COLS + 3, hdr(1, "g") + "§b§lTeleport\n§r§7Go to the hall\n§r§eClick to go", "textures/items/ender_pearl", { run: () => { try { player.teleport({ x: h.cx + 0.5, y: h.cy + 1, z: h.cz + AFKHALL.spot.z + 0.5 }, { dimension: world.getDimension(h.d) }); } catch (e) { say(player, "§c[AFK] Teleport failed."); } } });
    set(f, 2 * COLS + 5, hdr(1, "r") + "§c§lUndo\n§r§7Remove the hall: the land and the\n§r§7old AFK area come back\n§r§eClick to undo", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Remove the AFK Hall?", ["§7The land comes back as it was.", "§7The old AFK area comes back."], () => undo(player), self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
afkHook.page = afkHallPage;

// ---------------------------------------------------------------- protection: only the Owner changes the hall
const told = new Map();
const deny = (p) => system.run(() => { try { const now = Date.now(); if (now - (told.get(p.id) ?? 0) < 2000) return; told.set(p.id, now); p.sendMessage(pick(p, "§c[AFK] The AFK Hall is protected. Only the Owner can change it.", "§c[AFK] قاعة الـ AFK محمية. فقط المالك يقدر يعدل عليها.")); } catch (e) { /* ignore */ } });
const FACE = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const h = get(), b = ev.block; if (!h || owner(ev.player)) return;
  if (inHall(h, b.dimension.id, b.x, b.y, b.z)) { ev.cancel = true; deny(ev.player); }
}));
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const h = get(); if (!h || owner(ev.player)) return;
  const b = ev.block, d = b.dimension.id, f = FACE[String(ev.blockFace)] ?? [0, 0, 0];
  if (inHall(h, d, b.x, b.y, b.z) || inHall(h, d, b.x + f[0], b.y + f[1], b.z + f[2])) { ev.cancel = true; if (ev.itemStack) deny(ev.player); }
}));
safe("placed", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  const h = get(); if (!h || owner(player) || !inHall(h, block.dimension.id, block.x, block.y, block.z)) return;
  system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } });
}));
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const h = get(); if (!h) return;
  const d = ev.dimension.id, all = ev.getImpactedBlocks(), keep = all.filter((b) => !inHall(h, d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => told.delete(playerId)));
export { buildHere as buildAfkHall, undo as undoAfkHall };
