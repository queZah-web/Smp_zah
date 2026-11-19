// 🛡 LAND INFO HOLOGRAM: a floating board in the middle of every protected land that describes it:
//   name, owner, size + dimension, time left (live), allowed players, fast growth, and the Shift tip.
// The OWNER can hide it, show it again, move it to where he stands, raise / lower it, or put it back in the middle (/land -> the land -> Hologram).
// Every line is its own invisible text entity (shop:holo).  Lines are tagged "land_info" + "landholo_<land id>".
// Only boards with a player near them are touched (the area is loaded then); boards of ended / deleted / hidden lands are removed by the cleaner.
// Settings are saved in the land itself:  c.hl = { off?: true, x, y, z }.   Nothing here can break another system.
import { world, system } from "@minecraft/server";
import { allClaims, claimById, sizeOf, timeLeft, dur, HOUR, MAX_TRUSTED, growLevel, growLeft, growOf, setHolo } from "./landcore.js";
import { dimLabel } from "./util.js";

const TYPE = "shop:holo", TAG = "land_info", PFX = "landholo_";
const GAP = 0.27;                 // space between two lines
const RANGE = 40;                 // a board is refreshed only while a player is this close (blocks)
const EVERY = 20;                 // refresh every second (the time left counts down live)
const CLEAN_EVERY = 100;          // remove boards that must not exist any more
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (er) { return false; } };
const timeCol = (ms) => (ms < HOUR ? "§c" : ms < 6 * HOUR ? "§e" : "§a");

// ---------------------------------------------------------------- where the board stands
/** the middle of the board: saved position, or the middle of the land (about 2 blocks above where it was bought) */
export function anchor(c) {
  const h = c.hl;
  if (h && typeof h.x === "number") return { x: h.x, y: h.y, z: h.z };
  const sp = c.sp, y = sp && sp.y >= c.y1 && sp.y <= c.y2 ? sp.y + 2 : (c.y1 + c.y2 + 1) / 2;
  return { x: (c.x1 + c.x2 + 1) / 2, y, z: (c.z1 + c.z2 + 1) / 2 };
}
export const isOff = (c) => !!(c.hl && c.hl.off);

// ---------------------------------------------------------------- the text
export function linesOf(c) {
  const sz = sizeOf(c.s), left = timeLeft(c), ids = Object.keys(c.t), lv = growLevel(c);
  const L = [
    "§8« §a§l" + c.n + " §r§8»",
    "§7Owner: §f" + c.on,
    "§7Size: §f" + sz.name + " §8(§f" + sz.w + "x" + sz.w + "x" + sz.h + "§8) §7- §f" + dimLabel(c.d),
    "§7Protection: §aActive §8| §7Time left: " + timeCol(left) + dur(left),
    "§7Allowed players: §f" + ids.length + "§7/§f" + MAX_TRUSTED,
  ];
  if (ids.length) { const names = ids.slice(0, 3).map((i) => c.t[i]).join("§7, §f"); L.push("§f" + names + (ids.length > 3 ? " §7+" + (ids.length - 3) : "")); }
  L.push(lv ? "§7Fast Growth: §a" + growOf(lv).name + " §7x" + growOf(lv).x + " §8(§e" + dur(growLeft(c)) + "§8)" : "§7Fast Growth: §cOff");
  L.push("§8Crouch 3 times on the ground: grows nearby plants");
  return L;
}

// ---------------------------------------------------------------- entities of one board
const dimOf = (c) => { try { return world.getDimension(c.d); } catch (e) { return null; } };
const find = (dim, c) => { try { return dim.getEntities({ type: TYPE, tags: [PFX + c.id] }); } catch (e) { return []; } };
function remove(dim, c) { for (const e of find(dim, c)) { try { e.remove(); } catch (er) { /* ignore */ } } }
function build(dim, c, lines) {
  const a = anchor(c), n = lines.length, bottom = a.y - ((n - 1) * GAP) / 2;
  lines.forEach((text, i) => {
    try {
      const e = dim.spawnEntity(TYPE, { x: a.x, y: bottom + (n - 1 - i) * GAP, z: a.z });
      e.nameTag = text; e.addTag(TAG); e.addTag(PFX + c.id);
    } catch (er) { /* try again at the next refresh */ }
  });
}
/** make the board of this land match its data (create / update / remove) - only call while a player is near */
function sync(c, forceBuild = false) {
  const dim = dimOf(c); if (!dim) return;
  if (isOff(c)) { remove(dim, c); return; }
  const lines = linesOf(c), ents = find(dim, c);
  if (!forceBuild && ents.length === lines.length) {
    ents.sort((p, q) => q.location.y - p.location.y);                                // top line first
    ents.forEach((e, i) => { try { if (e.nameTag !== lines[i]) e.nameTag = lines[i]; } catch (er) { /* ignore */ } });
    return;
  }
  for (const e of ents) { try { e.remove(); } catch (er) { /* ignore */ } }          // wrong number of lines / moved: build it again
  build(dim, c, lines);
}
const near = (c, players) => {
  const a = anchor(c);
  return players.some((p) => { try { return p.dimension.id === c.d && Math.abs(p.location.x - a.x) <= RANGE && Math.abs(p.location.z - a.z) <= RANGE; } catch (e) { return false; } });
};

// ---------------------------------------------------------------- owner actions (used by the land menu)
const r2 = (n) => Math.round(n * 100) / 100;
const redraw = (c) => { try { sync(c, true); } catch (e) { /* ignore */ } };
/** hide (false) / show (true) the board */
export function setShown(c, on) {
  const old = c.hl ? { ...c.hl } : null, hl = { ...(c.hl ?? {}) };
  if (on) delete hl.off; else hl.off = true;
  if (!setHolo(c, Object.keys(hl).length ? hl : null)) { setHolo(c, old); return false; }
  if (on) redraw(c); else { const d = dimOf(c); if (d) remove(d, c); }
  return true;
}
/** move the middle of the board to the player (must be inside the land). Returns an error text or null */
export function moveHere(c, p) {
  const l = p.location;
  if (p.dimension.id !== c.d || l.x < c.x1 || l.x > c.x2 + 1 || l.z < c.z1 || l.z > c.z2 + 1 || l.y < c.y1 || l.y > c.y2 + 1) return "Stand inside the land to place the hologram here.";
  const y = Math.min(c.y2 + 0.5, l.y + 1.8);
  setHolo(c, { x: r2(l.x), y: r2(y), z: r2(l.z) }); redraw(c); return null;
}
/** raise (+) / lower (-) the board by `dy` blocks, kept inside the land */
export function nudge(c, dy) {
  const a = anchor(c), hl = { ...(c.hl ?? {}), x: r2(a.x), z: r2(a.z), y: r2(Math.max(c.y1 + 0.5, Math.min(c.y2 + 0.5, a.y + dy))) };
  setHolo(c, hl); redraw(c);
}
/** back to the middle of the land (stays hidden / shown as it was) */
export function recentre(c) { setHolo(c, c.hl && c.hl.off ? { off: true } : null); redraw(c); }
/** the land was deleted: take its board away now */
export function dropBoard(c) { try { const d = dimOf(c); if (d) remove(d, c); } catch (e) { /* the cleaner will do it */ } }

// ---------------------------------------------------------------- loops
system.runInterval(() => {
  try {
    const players = world.getAllPlayers(); if (!players.length) return;
    for (const c of allClaims()) { try { if (near(c, players)) sync(c); } catch (e) { /* skip this land */ } }
  } catch (e) { console.warn("[landholo] " + e); }
}, EVERY);

// cleaner: boards whose land ended / was deleted / is hidden (also after a crash or when the area was not loaded at that time)
system.runInterval(() => {
  try {
    for (const d of ["overworld", "nether", "the_end"]) {
      let list = []; try { list = world.getDimension(d).getEntities({ type: TYPE, tags: [TAG] }); } catch (e) { continue; }
      for (const e of list) {
        try {
          const t = e.getTags().find((x) => x.startsWith(PFX)), c = t ? claimById(t.slice(PFX.length)) : null;
          if (!c || isOff(c)) e.remove();
        } catch (er) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}, CLEAN_EVERY);
