// HOLOGRAMS - floating text boards (used by /top, the Ranks page of /menu and the fixed boards of the operators).
// Every line is its own invisible text entity (shop:holo, always shows its name tag).
//   * a board a player asks for: stands 3.4 blocks in front of him, the lines appear one after the other with a leaderboard sound,
//     it disappears by itself after HOLO_SECONDS, and he has to wait COOLDOWN_SECONDS before he can open one again (operators have no wait)
//   * a FIXED board: placed by an operator (👑 Operator > Holograms), stays for ever, refreshes itself every minute
// showHolo() returns false when the board could not be made (the caller then uses the chat message), and nothing here can ever break another system.
import { world, system } from "@minecraft/server";
import { isStaff } from "./opcore.js";
import { topKey, tempLines, fixedLines, chatText, TOP_USAGE, LISTS, boardHooks } from "./ranks.js";
import { clanView } from "./clanstate.js";
import { menuMsg } from "./menulang.js";

const HOLO_SECONDS = 15;                  // how long a requested board stays
const COOLDOWN_SECONDS = 30;              // wait after a board has closed, before the same player can open one again
const REVEAL_TICKS = 2;                   // the next line appears after this many ticks
const LINE_GAP = 0.27;                    // vertical space between two lines
const DISTANCE = 3.4;                     // blocks in front of the player
const TYPE = "shop:holo";
const FIXED_TAG = "shop_fixed";           // every line of a fixed board has this tag + "hf_<board id>"
const MAX_FIXED = 20;
const FIXED_EVERY = 1200;                 // ticks (60 s): refresh the fixed boards
const FIXED_RANGE = 96;                   // only boards with a player this close are refreshed (the area is loaded then)
const active = new Map();                 // player id -> { parts, dim, until, run, stop, timers }
const cooldown = new Map();               // player id -> time (ms) when he may open a board again

// ================================================================ boards that players ask for
function removeAll(entry) {
  try { system.clearRun(entry.run); } catch (e) { /* ignore */ }
  try { system.clearRun(entry.stop); } catch (e) { /* ignore */ }
  for (const t of entry.timers ?? []) { try { system.clearRun(t); } catch (e) { /* ignore */ } }
  for (const part of entry.parts) { try { if (part.ent && part.ent.isValid) part.ent.remove(); } catch (er) { /* ignore */ } }
}
function clear(pid) {
  const en = active.get(pid);
  if (en) { removeAll(en); active.delete(pid); }
}

/** how far in front of the player the board can stand: nearer when a wall is in the way */
function boardDistance(player, dx, dz) {
  try {
    const l = player.location, hit = player.dimension.getBlockFromRay({ x: l.x, y: l.y + 1.5, z: l.z }, { x: dx, y: 0, z: dz }, { maxDistance: DISTANCE + 0.5 });
    if (hit && hit.faceLocation) {
      const d = Math.hypot(hit.faceLocation.x - l.x, hit.faceLocation.z - l.z);
      return Math.max(1.3, Math.min(DISTANCE, d - 0.5));
    }
  } catch (e) { /* no raycast: use the normal distance */ }
  return DISTANCE;
}
function spawnPart(dim, part) {
  const e = dim.spawnEntity(TYPE, part.pos);
  e.nameTag = part.text;
  part.ent = e; part.live = true;
}

/** lines: array of strings (top to bottom). Returns true when shown. */
export function showHolo(player, lines) {
  try {
    clear(player.id);
    const dim = player.dimension, loc = player.location, v = player.getViewDirection();
    let dx = v.x, dz = v.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;       // looking direction, flat
    const dist = boardDistance(player, dx, dz);
    const cx = loc.x + dx * dist, cz = loc.z + dz * dist;
    const top = loc.y + 0.4 + (lines.length - 1) * LINE_GAP;
    const parts = lines.map((text, i) => ({ text, pos: { x: cx, y: top - i * LINE_GAP, z: cz }, ent: null, live: false }));
    if (!parts.length) return false;
    spawnPart(dim, parts[0]);                                                                 // the first line now (throws when the entity is missing -> chat fallback)

    const entry = { parts, dim, until: Date.now() + HOLO_SECONDS * 1000, timers: [] };
    active.set(player.id, entry);
    for (let i = 1; i < parts.length; i++) {                                                  // the other lines appear one after the other
      entry.timers.push(system.runTimeout(() => {
        if (active.get(player.id) !== entry) return;
        try { spawnPart(dim, parts[i]); } catch (e) { /* the insurance below tries again */ }
      }, i * REVEAL_TICKS));
    }
    // the board must stay for its whole time: a line that vanished (hit, killed, ...) is made again at the same place
    entry.run = system.runInterval(() => {
      if (Date.now() >= entry.until) return;
      for (const part of entry.parts) {
        if (!part.live) continue;
        let ok = false; try { ok = !!part.ent && part.ent.isValid; } catch (e) { ok = false; }
        if (ok) continue;
        try { spawnPart(entry.dim, part); } catch (e) { /* chunk not loaded: try again later */ }
      }
    }, 5);
    entry.stop = system.runTimeout(() => clear(player.id), HOLO_SECONDS * 20);
    return true;
  } catch (e) {
    clear(player.id);                                                                         // half built: take it away again
    return false;
  }
}

/** shows a top list as a hologram in front of the player (chat message when that is not possible).
 *  false = this is not a list name (the caller shows the usage) */
export function showTop(player, raw) {
  const key = topKey(raw);
  if (!key) return false;
  try {
    const staff = isStaff(player);
    if (!staff) {
      const left = (cooldown.get(player.id) ?? 0) - Date.now();
      if (left > 0) { player.sendMessage(menuMsg(player, "§c[Top] Please wait §f" + Math.ceil(left / 1000) + "s §cbefore you open a ranking again.")); return true; }
    }
    const lines = tempLines(key, player);
    const shown = showHolo(player, lines);
    if (shown) { try { player.playSound("lux.leaderboard", { volume: 1, pitch: 1 }); } catch (e) { /* ignore */ } }
    else player.sendMessage(menuMsg(player, chatText(key, player)));
    if (!staff) cooldown.set(player.id, Date.now() + (shown ? HOLO_SECONDS * 1000 : 0) + COOLDOWN_SECONDS * 1000);
  } catch (e) { console.warn("[top] failed: " + e); try { player.sendMessage(menuMsg(player, "§c[Top] Something went wrong.")); } catch (er) { /* ignore */ } }
  return true;
}
export { TOP_USAGE };
clanView.showTop = (player, type) => showTop(player, type);          // the "Top Clans" page of the clan menu uses this

// ================================================================ fixed boards (operators)
const FKEY = "hf:v1";
let fixed = null;                          // [{ id, t: list key, d: dimension id, x, y (bottom line), z }]
function loadFixed() {
  if (fixed) return fixed;
  try {
    const raw = world.getDynamicProperty(FKEY);
    const a = typeof raw === "string" ? JSON.parse(raw) : [];
    fixed = Array.isArray(a) ? a.filter((b) => b && b.id && LISTS[b.t]) : [];
  } catch (e) { return null; }             // world not ready: do nothing (never overwrite saved data)
  return fixed;
}
const saveFixed = () => { try { world.setDynamicProperty(FKEY, JSON.stringify(fixed)); return true; } catch (e) { console.warn("[holo] save failed: " + e); return false; } };
export const listFixed = () => (loadFixed() ?? []).slice();
export const fixedLimit = () => MAX_FIXED;

const dimOf = (b) => { try { return world.getDimension(b.d); } catch (e) { return null; } };
const linesOfBoard = (dim, b) => { try { return dim.getEntities({ type: TYPE, tags: ["hf_" + b.id] }); } catch (e) { return []; } };

/** makes / updates the lines of one fixed board. Only call it when the area is loaded (a player is near). */
function renderFixed(b) {
  const dim = dimOf(b), lines = fixedLines(b.t);
  if (!dim || !lines) return;
  const n = lines.length;
  let ents = linesOfBoard(dim, b);
  if (ents.length === n) {
    ents.sort((p, q) => q.location.y - p.location.y);                                          // top line first
    ents.forEach((e, i) => { try { if (e.nameTag !== lines[i]) e.nameTag = lines[i]; } catch (er) { /* ignore */ } });
    return;
  }
  for (const e of ents) { try { e.remove(); } catch (er) { /* ignore */ } }                    // wrong number of lines: build it again
  lines.forEach((text, i) => {
    try {
      const e = dim.spawnEntity(TYPE, { x: b.x, y: b.y + (n - 1 - i) * LINE_GAP, z: b.z });
      e.nameTag = text; e.addTag(FIXED_TAG); e.addTag("hf_" + b.id);
    } catch (er) { /* try again at the next refresh */ }
  });
}
const nearPlayer = (b) => { try { return world.getAllPlayers().some((p) => p.dimension.id === b.d && Math.hypot(p.location.x - b.x, p.location.z - b.z) < FIXED_RANGE); } catch (e) { return false; } };

/** places a fixed board of list `key` where the player stands. Returns the board, "full" or null */
export function addFixed(player, key) {
  const list = loadFixed();
  if (!list || !LISTS[key]) return null;
  if (list.length >= MAX_FIXED) return "full";
  const l = player.location, r2 = (n) => Math.round(n * 100) / 100;
  const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: key, d: player.dimension.id, x: r2(l.x), y: r2(l.y + 0.5), z: r2(l.z) };
  list.push(b);
  if (!saveFixed()) { list.pop(); return null; }
  try { renderFixed(b); } catch (e) { console.warn("[holo] render failed: " + e); }
  return b;
}
export function removeFixed(id) {
  const list = loadFixed();
  if (!list) return false;
  const i = list.findIndex((b) => b.id === id);
  if (i < 0) return false;
  const [b] = list.splice(i, 1);
  saveFixed();
  const dim = dimOf(b);
  if (dim) for (const e of linesOfBoard(dim, b)) { try { e.remove(); } catch (er) { /* ignore */ } }
  return true;
}

function refreshFixed() {
  const list = loadFixed();
  if (!list) return;
  for (const b of list) { try { if (nearPlayer(b)) renderFixed(b); } catch (e) { console.warn("[holo] refresh: " + e); } }
}
boardHooks.changed = refreshFixed;            // an admin removed / put back somebody: the fixed boards change at once, not after a minute
system.runTimeout(() => { try { refreshFixed(); } catch (e) { /* ignore */ } }, 200);
system.runInterval(() => { try { refreshFixed(); } catch (e) { /* ignore */ } }, FIXED_EVERY);

// ================================================================ leftovers
// a reload / crash while a board was showing, or a fixed board that was removed while its area was not loaded: remove every shop:holo that is not ours
system.runInterval(() => {
  try {
    const mine = new Set(), ids = new Set((loadFixed() ?? []).map((b) => "hf_" + b.id));
    for (const en of active.values()) for (const part of en.parts) { try { if (part.ent && part.ent.isValid) mine.add(part.ent.id); } catch (er) { /* ignore */ } }
    for (const d of ["overworld", "nether", "the_end"]) {
      let list = []; try { list = world.getDimension(d).getEntities({ type: TYPE }); } catch (e) { /* ignore */ }
      for (const e of list) {
        try {
          if (mine.has(e.id)) continue;
          if (e.hasTag("land_info") || e.hasTag("crop_pct") || e.hasTag("end_gate") || e.hasTag("crate_holo") || e.hasTag("spawner_holo") || e.hasTag("info_holo") || e.hasTag("item_cd") || e.hasTag("tp_holo")) continue;                               // land info boards + growth percents have their own cleaner
          if (e.hasTag(FIXED_TAG) && loadFixed() && e.getTags().some((t) => ids.has(t))) continue;     // a line of a fixed board that still exists
          if (e.hasTag(FIXED_TAG) && !loadFixed()) continue;                                           // saved boards not readable yet: touch nothing
          e.remove();
        } catch (er) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}, 100);
world.afterEvents.playerLeave.subscribe(({ playerId }) => { try { clear(playerId); } catch (e) { /* ignore */ } });

// ================================================================ staff: SNEAK + tap a fixed board -> its menu (go there / remove it)
// The board lines have no hit box (a player can not click them), so while an operator SNEAKS near a fixed board an invisible "shop:holo_hit"
// box is placed around it. Tapping that box (while sneaking) opens the board page of holomenu.js. The box is removed again as soon as no
// sneaking operator is near, so normal players never meet it. Nothing here touches the boards themselves.
const HIT_TYPE = "shop:holo_hit";
const HIT_RANGE = 10;                                  // blocks: an operator this close (and sneaking) gets the box
export const boardClick = { open: null };              // holomenu.js sets it: (player, board) => opens the board page
const hitsOf = (dim, id) => { try { return dim.getEntities({ type: HIT_TYPE, tags: ["hf_" + id] }); } catch (e) { return []; } };
system.runInterval(() => {
  try {
    const list = loadFixed() ?? [], wanted = new Set();
    if (list.length) for (const p of world.getAllPlayers()) {
      try {
        if (!p.isSneaking || !isStaff(p)) continue;
        const l = p.location;
        for (const b of list) {
          if (b.d !== p.dimension.id || Math.hypot(l.x - b.x, l.z - b.z) > HIT_RANGE || Math.abs(l.y - b.y) > 8) continue;
          wanted.add(b.id);
          if (!hitsOf(p.dimension, b.id).length) p.dimension.spawnEntity(HIT_TYPE, { x: b.x, y: b.y - 0.2, z: b.z }).addTag("hf_" + b.id);
        }
      } catch (e) { /* ignore */ }
    }
    for (const d of ["overworld", "nether", "the_end"]) {
      let hits = []; try { hits = world.getDimension(d).getEntities({ type: HIT_TYPE }); } catch (e) { continue; }
      for (const e of hits) { try { if (e.hasTag("ih_hit")) continue; const t = e.getTags().find((x) => x.startsWith("hf_")); if (!t || !wanted.has(t.slice(3))) e.remove(); } catch (er) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}, 5);
const lastTap = new Map();
function tapped(player, ent) {
  try {
    if (!ent || ent.typeId !== HIT_TYPE || player?.typeId !== "minecraft:player") return;
    if (!player.isSneaking || !isStaff(player)) return;
    const now = Date.now(); if (now - (lastTap.get(player.id) ?? 0) < 600) return;       // touch screens send several events for one tap
    lastTap.set(player.id, now);
    const t = ent.getTags().find((x) => x.startsWith("hf_")), b = t && (loadFixed() ?? []).find((x) => x.id === t.slice(3));
    if (b && boardClick.open) boardClick.open(player, b);
  } catch (e) { console.warn("[holo] tap: " + e); }
}
try { world.beforeEvents.playerInteractWithEntity.subscribe((ev) => { if (ev.target?.typeId !== HIT_TYPE) return; ev.cancel = true; const p = ev.player, t = ev.target; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[holo] interact hook: " + e); }
try { world.afterEvents.entityHitEntity.subscribe((ev) => { if (ev.hitEntity?.typeId !== HIT_TYPE) return; const p = ev.damagingEntity, t = ev.hitEntity; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[holo] hit hook: " + e); }
world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastTap.delete(playerId); });
