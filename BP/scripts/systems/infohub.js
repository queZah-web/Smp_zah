// INFO HUB - a ring of floating info boards around a spinning centerpiece (👑 Operator > Leaderboards > Info Hub).
//   * The operator chooses what to place: ALL (island + the 7 boards in a ring), the ISLAND alone, or ONE board alone (any of the 7, as many times as wanted).
//     Every placed item is its own entry in the saved list (h.k = "all" | "core" | "board", h.n = board number; old saved hubs have no k = "all").
//   * ALL: ONE click places the whole hub where the operator stands: the centerpiece + 7 boards (Server name, IP, Features, Why join, Rules, Join now, Top admins)
//     all appear together, at the same height, in a circle around the centre.  The boards face the player (that is how name tags work).
//   * The TEXT is shared: every hub shows the same content, and the operators edit it from the menu (no re-upload of the pack).
//     Colour codes can be typed with & (for example  &cActive Admins  = red).
//   * "Top admins" builds itself: the staff (Owner / Admin / Mod / Helper) ranked by their total time on the server.
//   * The centerpiece is the entity smp:hub_core (RP: a floating island + castle + spinning crystal and halo, 360 degrees) + glow rings.
// Text lines are the same invisible entities the other holograms use (shop:holo), tagged "info_holo" + "ih_<hub id>" + "ihp_<hub id>_<board>".
// Nothing here can break another system: every part is wrapped in try/catch.
import { world, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { COLS, SHORT_ROWS, NAV, hdr, make, set, open, status, backBtn } from "../smp/ui.js";
import { confirmShort, showModal } from "./forms.js";
import { isStaff } from "./opcore.js";
import { teleportTo } from "./util.js";
import { ranking } from "./ranks.js";
import { listRoles, ownerInfo, ROLE_COLOR } from "./staffcore.js";
import { playtime } from "../format.js";
import { fx } from "../lux.js";

const KEY = "ihub:v1";
const TYPE = "shop:holo", CORE = "smp:hub_dragon", OLD_CORE = "smp:hub_core", HOLE = "smp:hub_blackhole", STATUE = "smp:hub_statue", CASTLE = "smp:hub_castle", TAG = "info_holo", CORE_TAG = "info_hub_core";
const SCALE_MIN = 0.2, SCALE_MAX = 8;       // Dark Angel statue: the size the operators can choose (1 = about 4.4 blocks tall)
const clampScale = (s) => { s = Number(s); return Number.isFinite(s) ? Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) * 100) / 100 : 1; };
const statueScale = (h) => clampScale(h.s ?? 1);
const GAP = 0.27;                         // vertical space between two lines
const RADIUS = 5.2;                       // blocks from the centre to the boards
const MID = 1.1;                          // height of the middle of every board above the operator's feet (boards are not high)
const BOARDS = 7;
const MAX_HUBS = 27;                      // placed items (full hubs, islands and single boards together)
const NEAR = 64;                          // only hubs with a player this close are drawn / refreshed (the area is loaded then)
const EVERY = 1200;                       // ticks (60 s): refresh the texts
const SEP = "§8-------------------";
const RANK = ["§6", "§b", "§e"];

// ---------------------------------------------------------------- saved data
// hubs: [{ id, d: dimension id, x, y, z (the centre, at the operator's feet), a: angle of board 1 }]   cfg: the shared texts
const DEFAULTS = {
  name: "SMP", tagline: "Play • Build • Survive • Together",
  ip: "", version: "",
  features: ["&cActive Admins", "Duel", "ECONOMY"],
  why: [],
  rules: ["Be Respectful", "No Griefing", "No Hacking / Cheating", "No Spam", "Have Fun!"],
  join: ["Be Part Of Our Community", "We're Waiting For You!"],
};
const LIMIT = { name: 18, tagline: 30, ip: 30, version: 20, line: 30 };
const MAXLINES = { features: 8, why: 8, rules: 8, join: 3 };
let db = null;
const strs = (a, fallback) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : fallback);
function load() {
  if (db) return db;
  try {
    const raw = world.getDynamicProperty(KEY);
    const o = typeof raw === "string" ? JSON.parse(raw) : {}, c = o.cfg ?? {};
    db = {
      hubs: Array.isArray(o.hubs) ? o.hubs.filter((h) => h && h.id && h.d && typeof h.x === "number" && typeof h.y === "number" && typeof h.z === "number") : [],
      cfg: {
        name: typeof c.name === "string" ? c.name : DEFAULTS.name, tagline: typeof c.tagline === "string" ? c.tagline : DEFAULTS.tagline,
        ip: typeof c.ip === "string" ? c.ip : "", version: typeof c.version === "string" ? c.version : "",
        features: strs(c.features, DEFAULTS.features), why: strs(c.why, DEFAULTS.why), rules: strs(c.rules, DEFAULTS.rules), join: strs(c.join, DEFAULTS.join),
      },
    };
  } catch (e) { return null; }            // world not ready: do nothing (never overwrite saved data)
  return db;
}
function save() { try { world.setDynamicProperty(KEY, JSON.stringify(db)); return true; } catch (e) { console.warn("[infohub] save failed: " + e); return false; } }

// ---------------------------------------------------------------- text helpers
const CODE = /[0-9a-fk-or]/i;
/** "&c" -> "§c" */
const fmt = (s) => String(s ?? "").replace(/&([0-9a-fk-or])/gi, "§$1");
/** cuts a text to n visible characters (colour codes do not count) */
function cap(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  let out = "", vis = 0;
  for (let i = 0; i < s.length; i++) {
    if ((s[i] === "&" || s[i] === "§") && i + 1 < s.length && CODE.test(s[i + 1])) { out += s[i] + s[i + 1]; i++; continue; }
    if (vis >= n) break;
    out += s[i]; vis++;
  }
  return out;
}
const row = (t) => "§8» §f" + fmt(t);

// ---------------------------------------------------------------- the boards (7 lists of lines)
function adminLines() {
  const L = ["§c§lTOP ADMINS", SEP, "§7Activity on the server"];
  try {
    const staff = new Map();
    const o = ownerInfo(); if (o && o.id) staff.set(o.id, { name: o.n, role: "owner" });
    for (const s of listRoles()) if (!staff.has(s.id)) staff.set(s.id, { name: s.n, role: s.r });
    const online = new Set(world.getAllPlayers().map((p) => p.id));
    const play = new Map(ranking("play").map((r) => [r.id, r]));
    const rows = [...staff.entries()].map(([id, s]) => ({ name: String(play.get(id)?.name ?? s.name ?? "?"), role: s.role, v: play.get(id)?.v ?? 0, on: online.has(id) }))
      .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name)).slice(0, 5);
    if (!rows.length) L.push("§8No staff yet");
    rows.forEach((r, i) => L.push((RANK[i] ?? "§3") + "§l#" + (i + 1) + " " + (ROLE_COLOR[r.role] ?? "§c") + r.name.slice(0, 14) + " §8» §f" + playtime(r.v) + (r.on ? " §a•" : " §8•")));
  } catch (e) { L.push("§8Not available"); }
  return L;
}
function boards() {
  const c = db.cfg, ip = c.ip ? "§b§l" + fmt(c.ip) : "§8Not set yet";
  const join = c.join.map((t, i) => (i === 0 ? "§f" : "§7") + fmt(t));
  if (c.ip) join.splice(Math.min(1, join.length), 0, "§b§l" + fmt(c.ip));
  return [
    ["§b§lSERVER NAME", SEP, "§6§l" + fmt(c.name || "SMP"), c.tagline ? "§7" + fmt(c.tagline) : null],
    ["§b§lSERVER IP", SEP, ip, c.version ? "§7Version: §f" + fmt(c.version) : null],
    ["§e§lFEATURES", SEP, ...(c.features.length ? c.features.map(row) : ["§8Nothing yet"])],
    ["§d§lWHY JOIN?", SEP, ...(c.why.length ? c.why.map(row) : ["§8Not set yet"])],
    ["§c§lRULES", SEP, ...(c.rules.length ? c.rules.map((t, i) => "§e§l" + (i + 1) + " §f" + fmt(t)) : ["§8No rules yet"])],
    ["§a§lJOIN NOW", SEP, ...(join.length ? join : ["§8Not set yet"])],
    adminLines(),
  ].map((l) => l.filter((x) => x !== null));
}

// ---------------------------------------------------------------- drawing
const dimOf = (h) => { try { return world.getDimension(h.d); } catch (e) { return null; } };
const nearPlayer = (h) => { try { return world.getAllPlayers().some((p) => p.dimension.id === h.d && Math.hypot(p.location.x - h.x, p.location.z - h.z) < NEAR); } catch (e) { return false; } };
const BOARD_NAMES = ["Server name", "Server IP", "Features", "Why join?", "Rules", "Join now", "Top admins"];
const kindOf = (h) => ((h.k ?? "all") === "castle" ? "Floating Castle (size " + statueScale(h) + ")" : (h.k ?? "all") === "statue" ? "Dark Angel statue (size " + statueScale(h) + ")" : (h.k ?? "all") === "hole" ? "Black hole" : (h.k ?? "all") === "core" ? "Dragon only" : (h.k ?? "all") === "board" ? "Board: " + (BOARD_NAMES[h.n] ?? "?") : "Dragon + 7 boards");
/** the statue looks back at the operator who placed it (he looks at a spot, steps back and sees its front); h.r = extra turns of 45 degrees */
const statueYaw = (h) => { const vx = Math.cos(h.a ?? 0), vz = Math.sin(h.a ?? 0); return ((Math.atan2(vx, -vz) * 180) / Math.PI + (h.r ?? 0) * 45 + 540) % 360 - 180; };
/** size + facing of a hologram entity (dragon, black hole): the saved size h.s and turn h.r (x 45 degrees) are kept in step with the entity */
function syncLook(e, h) {
  try { const s = statueScale(h); if (Math.abs((Number(e.getProperty("smp:scale")) || 0) - s) > 0.001) e.setProperty("smp:scale", s); } catch (er) { /* property missing: old pack, nothing to do */ }
  try { const yaw = (((h.r ?? 0) * 45 + 540) % 360) - 180; const dy = Math.abs((((e.getRotation().y - yaw) % 360) + 540) % 360 - 180); if (dy > 1) e.setRotation({ x: 0, y: yaw }); } catch (er) { /* ignore */ }
}
const boardPos = (h, k) => { const a = h.a + (k * 2 * Math.PI) / BOARDS; return { x: h.x + RADIUS * Math.cos(a), z: h.z + RADIUS * Math.sin(a) }; };

/** the boards one placed item shows: all 7 in a ring, one single board at its spot, or none (island only) */
function boardsFor(h) {
  const all = boards(), kind = h.k ?? "all";
  if (kind === "all") return all.map((lines, k) => ({ lines, k, pos: boardPos(h, k) }));
  if (kind === "board" && Number.isInteger(h.n) && all[h.n]) return [{ lines: all[h.n], k: h.n, pos: { x: h.x, z: h.z } }];
  return [];
}
/** makes / updates the boards and/or the centrepiece of one placed item. Only call it when the area is loaded (a player is near). */
function renderHub(h, burst = false) {
  const dim = dimOf(h); if (!dim) return;
  const kind = h.k ?? "all";
  boardsFor(h).forEach(({ lines, k, pos }) => {
    const tag = "ihp_" + h.id + "_" + k, n = lines.length;
    let ents = []; try { ents = dim.getEntities({ type: TYPE, tags: [tag] }); } catch (e) { ents = []; }
    if (ents.length === n) {
      ents.sort((p, q) => q.location.y - p.location.y);                                          // top line first
      ents.forEach((e, i) => { try { if (e.nameTag !== lines[i]) e.nameTag = lines[i]; } catch (er) { /* ignore */ } });
      return;
    }
    for (const e of ents) { try { e.remove(); } catch (er) { /* ignore */ } }                    // wrong number of lines: build it again
    lines.forEach((text, i) => {
      try {
        const e = dim.spawnEntity(TYPE, { x: pos.x, y: h.y + MID + ((n - 1) / 2 - i) * GAP, z: pos.z });
        e.nameTag = text; e.addTag(TAG); e.addTag("ih_" + h.id); e.addTag(tag);
      } catch (er) { /* try again at the next refresh */ }
    });
    if (burst) fx(dim, "lux:column", { x: pos.x, y: h.y + 0.2, z: pos.z }, { count: 14, radius: 0.7, speed: 2.0, life: 1.1, size: 0.15, r: 0.45, g: 0.9, b: 1 });
  });
  try {                                                                                          // the spinning centrepiece
    for (const o of dim.getEntities({ type: OLD_CORE, tags: ["ih_" + h.id] })) { try { o.remove(); } catch (er) { /* ignore */ } }   // the old island is replaced by the dragon
    const cores = dim.getEntities({ type: CORE, tags: ["ih_" + h.id] });
    for (let i = 1; i < cores.length; i++) { try { cores[i].remove(); } catch (er) { /* ignore */ } }
    let ce = cores[0];
    if (!ce && (kind === "all" || kind === "core")) { ce = dim.spawnEntity(CORE, { x: h.x, y: h.y, z: h.z }); ce.addTag(CORE_TAG); ce.addTag("ih_" + h.id); }
    if (ce && (kind === "all" || kind === "core")) syncLook(ce, h);
  } catch (e) { /* try again at the next refresh */ }
  try {                                                                                          // the Dark Angel statue (size + facing are kept in step with the saved values)
    if (kind === "statue") {
      const s = statueScale(h), yaw = statueYaw(h);
      const list = dim.getEntities({ type: STATUE, tags: ["ih_" + h.id] });
      for (let i = 1; i < list.length; i++) { try { list[i].remove(); } catch (er) { /* ignore */ } }
      let e = list[0];
      if (!e) { e = dim.spawnEntity(STATUE, { x: h.x, y: h.y, z: h.z }); e.addTag(CORE_TAG); e.addTag("ih_" + h.id); }
      try { if (Math.abs((Number(e.getProperty("smp:scale")) || 0) - s) > 0.001) e.setProperty("smp:scale", s); } catch (er) { /* property missing: old pack, nothing to do */ }
      try { let dy = Math.abs((((e.getRotation().y - yaw) % 360) + 540) % 360 - 180); if (dy > 1) e.setRotation({ x: 0, y: yaw }); } catch (er) { /* ignore */ }
      return;
    }
  } catch (e) { /* try again at the next refresh */ }
  try {                                                                                          // the floating castle on its clouds (size + facing are kept in step with the saved values)
    if (kind === "castle") {
      const s = statueScale(h), yaw = statueYaw(h);
      const list = dim.getEntities({ type: CASTLE, tags: ["ih_" + h.id] });
      for (let i = 1; i < list.length; i++) { try { list[i].remove(); } catch (er) { /* ignore */ } }
      let e = list[0];
      if (!e) { e = dim.spawnEntity(CASTLE, { x: h.x, y: h.y, z: h.z }); e.addTag(CORE_TAG); e.addTag("ih_" + h.id); }
      try { if (Math.abs((Number(e.getProperty("smp:scale")) || 0) - s) > 0.001) e.setProperty("smp:scale", s); } catch (er) { /* property missing: old pack, nothing to do */ }
      try { let dy = Math.abs((((e.getRotation().y - yaw) % 360) + 540) % 360 - 180); if (dy > 1) e.setRotation({ x: 0, y: yaw }); } catch (er) { /* ignore */ }
      return;
    }
  } catch (e) { /* try again at the next refresh */ }
  try {                                                                                          // the holographic black hole
    if (kind !== "hole") return;
    const holes = dim.getEntities({ type: HOLE, tags: ["ih_" + h.id] });
    for (let i = 1; i < holes.length; i++) { try { holes[i].remove(); } catch (er) { /* ignore */ } }
    let he = holes[0];
    if (!he) { he = dim.spawnEntity(HOLE, { x: h.x, y: h.y, z: h.z }); he.addTag(CORE_TAG); he.addTag("ih_" + h.id); }
    syncLook(he, h);
  } catch (e) { /* try again at the next refresh */ }
}
function renderAll(burst = false) {
  const d = load(); if (!d) return;
  for (const h of d.hubs) { try { if (nearPlayer(h)) renderHub(h, burst); } catch (e) { console.warn("[infohub] refresh: " + e); } }
}
function removeEntities(h) {
  const dim = dimOf(h); if (!dim) return;
  try { for (const e of dim.getEntities({ tags: ["ih_" + h.id] })) { try { e.remove(); } catch (er) { /* ignore */ } } } catch (e) { /* ignore */ }
}
system.runTimeout(() => { try { renderAll(); } catch (e) { /* ignore */ } }, 220);
system.runInterval(() => { try { renderAll(); } catch (e) { /* ignore */ } }, EVERY);

// a soft glow: a ring on the floor + a little light column, only while somebody is near
let beat = 0;
system.runInterval(() => {
  try {
    const d = load(); if (!d || !d.hubs.length) return;
    beat++;
    for (const h of d.hubs) {
      if ((h.k ?? "all") === "board" || (h.k ?? "all") === "hole" || (h.k ?? "all") === "statue" || (h.k ?? "all") === "castle") continue;                     // a single board has no island, so no glow
      if (!world.getAllPlayers().some((p) => p.dimension.id === h.d && Math.hypot(p.location.x - h.x, p.location.z - h.z) < 40)) continue;
      const dim = dimOf(h); if (!dim) continue;
      const rs = (h.k ?? "all") === "core" ? Math.min(4, Math.max(0.4, statueScale(h))) : 1;
      fx(dim, "lux:ring_y", { x: h.x, y: h.y + 0.15, z: h.z }, { size: 3.6 * rs, life: 1.7, r: 0.35, g: 0.85, b: 1 });
      if (beat % 3 === 0) fx(dim, "lux:column", { x: h.x, y: h.y + 0.1, z: h.z }, { count: 8, radius: 0.9, speed: 1.6, life: 1.4, size: 0.14, r: 0.4, g: 0.9, b: 1 });
    }
  } catch (e) { /* ignore */ }
}, 30);

// the DARK AURA around every Dark Angel statue: a few violet embers (the thick black smoke was removed: it hid the statue up close), all scaled with the statue's size.
// (The slow black flames that circle the statue are part of its model in the resource pack.)  Only while somebody is near.
const AURA_RANGE = 48;
system.runInterval(() => {
  try {
    const d = load(); if (!d || !d.hubs.length) return;
    for (const h of d.hubs) {
      if ((h.k ?? "all") !== "statue") continue;
      if (!world.getAllPlayers().some((p) => p.dimension.id === h.d && Math.hypot(p.location.x - h.x, p.location.z - h.z) < AURA_RANGE && Math.abs(p.location.y - h.y) < AURA_RANGE)) continue;
      const dim = dimOf(h); if (!dim) continue;
      const s = statueScale(h), r = Math.sqrt(s);
      const cy = h.y + 2.2 * s;
      fx(dim, "smp:dark_ember", { x: h.x, y: cy, z: h.z }, { count: Math.min(10, Math.round(2 + 1.5 * s)), rx: 1.6 * s, ry: 2.2 * s, rz: 1.3 * s, speed: 0.5 * r, rise: 0.5, size: 0.1 * Math.max(0.6, s), life: 2.0, r: 0.5, g: 0.12, b: 0.8 });
    }
  } catch (e) { /* ignore */ }
}, 6);

// leftovers: lines / centrepieces of a hub that was removed while its area was not loaded
system.runInterval(() => {
  try {
    const d = load(); if (!d) return;
    const ids = new Set(d.hubs.map((h) => "ih_" + h.id));
    for (const dn of ["overworld", "nether", "the_end"]) {
      let dim; try { dim = world.getDimension(dn); } catch (e) { continue; }
      for (const type of [TYPE, CORE, OLD_CORE, HOLE, STATUE, CASTLE]) {
        let list = []; try { list = dim.getEntities({ type, tags: [type === TYPE ? TAG : CORE_TAG] }); } catch (e) { continue; }
        for (const e of list) { try { if (!e.getTags().some((t) => ids.has(t))) e.remove(); } catch (er) { /* ignore */ } }
      }
    }
  } catch (e) { /* ignore */ }
}, 200);

// ---------------------------------------------------------------- staff: SNEAK + tap the island / a board -> its page (go there / remove), like the fixed leaderboards
// Same trick as hologram.js: the island and the text lines have no hit box, so while an operator SNEAKS near an Info Hub item an invisible
// "shop:holo_hit" box is placed on the island and on every board of it. Tapping a box (while sneaking) opens the page of that item.
// The boxes are removed again as soon as no sneaking operator is near. They carry the tag "ih_hit" (hologram.js leaves those alone).
const HIT = "shop:holo_hit", HIT_TAG = "ih_hit", HIT_RANGE = 10;
function hitSpots(h) {
  const kind = h.k ?? "all", out = [];
  if (kind === "all") {
    out.push({ key: h.id + "_c", x: h.x, z: h.z });
    for (let k = 0; k < BOARDS; k++) { const p = boardPos(h, k); out.push({ key: h.id + "_" + k, x: p.x, z: p.z }); }
  } else if (kind === "core" || kind === "hole" || kind === "statue" || kind === "castle") out.push({ key: h.id + "_c", x: h.x, z: h.z });
  else out.push({ key: h.id + "_" + h.n, x: h.x, z: h.z });
  return out;
}
system.runInterval(() => {
  try {
    const d = load(), wanted = new Set();
    if (d && d.hubs.length) for (const p of world.getAllPlayers()) {
      try {
        if (!p.isSneaking || !isStaff(p)) continue;
        const l = p.location;
        for (const h of d.hubs) {
          if (h.d !== p.dimension.id || Math.abs(l.y - h.y) > 8) continue;
          for (const sp of hitSpots(h)) {
            if (Math.hypot(l.x - sp.x, l.z - sp.z) > HIT_RANGE) continue;
            wanted.add(sp.key);
            let have = 0; try { have = p.dimension.getEntities({ type: HIT, tags: [HIT_TAG, "ihh_" + sp.key] }).length; } catch (e) { have = 1; }
            if (!have) { const e = p.dimension.spawnEntity(HIT, { x: sp.x, y: h.y - 0.2, z: sp.z }); e.addTag(HIT_TAG); e.addTag("ihh_" + sp.key); }
          }
        }
      } catch (e) { /* ignore */ }
    }
    for (const dn of ["overworld", "nether", "the_end"]) {
      let hits = []; try { hits = world.getDimension(dn).getEntities({ type: HIT, tags: [HIT_TAG] }); } catch (e) { continue; }
      for (const e of hits) { try { const t = e.getTags().find((x) => x.startsWith("ihh_")); if (!t || !wanted.has(t.slice(4))) e.remove(); } catch (er) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}, 5);
const lastTap = new Map();
function tapped(player, ent) {
  try {
    if (!ent || ent.typeId !== HIT || !ent.hasTag(HIT_TAG) || player?.typeId !== "minecraft:player") return;
    if (!player.isSneaking || !isStaff(player)) return;
    const now = Date.now(); if (now - (lastTap.get(player.id) ?? 0) < 600) return;          // touch screens send several events for one tap
    lastTap.set(player.id, now);
    const t = ent.getTags().find((x) => x.startsWith("ihh_")); if (!t) return;
    const d = load(); if (!d) return;
    const id = t.slice(4).split("_")[0], i = d.hubs.findIndex((x) => x.id === id);
    if (i >= 0) hubPage(player, d.hubs[i], i, () => { });
  } catch (e) { console.warn("[infohub] tap: " + e); }
}
try { world.beforeEvents.playerInteractWithEntity.subscribe((ev) => { const t = ev.target; if (t?.typeId !== HIT || !t.hasTag(HIT_TAG)) return; ev.cancel = true; const p = ev.player; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[infohub] interact hook: " + e); }
try { world.afterEvents.entityHitEntity.subscribe((ev) => { const t = ev.hitEntity; if (t?.typeId !== HIT || !t.hasTag(HIT_TAG)) return; const p = ev.damagingEntity; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[infohub] hit hook: " + e); }
world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastTap.delete(playerId); });

// ---------------------------------------------------------------- menu
const guard = (p) => { if (isStaff(p)) return true; try { p.sendMessage("§c[Operator] Operators only."); } catch (e) { /* ignore */ } return false; };
const say = (p, m) => { try { p.sendMessage(m); } catch (e) { /* ignore */ } };
const where = (h) => Math.floor(h.x) + ", " + Math.round(h.y) + ", " + Math.floor(h.z) + " §7(" + String(h.d).replace("minecraft:", "") + ")";
const fld = (form, label, ph, def) => { try { form.textField(label, ph, { defaultValue: String(def ?? "") }); } catch (e) { form.textField(label, ph); } };
const note = (form, text) => { try { form.label(text); } catch (e) { /* older game: no label */ } };
const HINT = "§7Colours: type & and a letter, e.g. §c&c§7 = red, §a&a§7 = green, §e&e§7 = yellow, §b&b§7 = aqua, §f&f§7 = white.";

export function infoHubPage(player, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) { say(player, "§c[Info Hub] Data not ready, try again."); return; }
  const self = () => infoHubPage(player, back);
  const f = make("Info Hub", SHORT_ROWS); f.self = self;
  const n = d.hubs.length;
  set(f, 0 * COLS + 4, hdr(Math.max(1, n)) + "§b§lInfo Hub\n§r§7Placed: §f" + n + "§7/§f" + MAX_HUBS + "\n§r§7Place everything, the island alone, or\n§r§7one board at a time. Boards share the\n§r§7same texts: edit them below.", "textures/items/nether_star", null);
  set(f, 1 * COLS + 1, hdr(1) + "§6§lName & tagline\n§r§7Now: §f" + fmt(d.cfg.name) + "\n§r§eClick to edit", "textures/items/name_tag", { run: () => editNameForm(player, self) });
  set(f, 1 * COLS + 3, hdr(1) + "§b§lServer IP & version\n§r§7Now: §f" + (d.cfg.ip ? fmt(d.cfg.ip) : "§8not set") + "\n§r§eClick to edit", "textures/items/compass_item", { run: () => editIpForm(player, self) });
  set(f, 1 * COLS + 5, hdr(1) + "§e§lFeatures\n§r§7" + d.cfg.features.length + " lines\n§r§eClick to edit", "textures/items/book_writable", { run: () => editList(player, "features", "Features", self) });
  set(f, 1 * COLS + 7, hdr(1) + "§d§lWhy join?\n§r§7" + d.cfg.why.length + " lines\n§r§eClick to edit", "textures/items/book_writable", { run: () => editList(player, "why", "Why join?", self) });
  set(f, 2 * COLS + 2, hdr(1) + "§c§lRules\n§r§7" + d.cfg.rules.length + " lines\n§r§eClick to edit", "textures/items/paper", { run: () => editList(player, "rules", "Rules", self) });
  set(f, 2 * COLS + 4, hdr(1) + "§a§lJoin now text\n§r§7" + d.cfg.join.length + " lines\n§r§eClick to edit", "textures/items/emerald", { run: () => editList(player, "join", "Join now", self) });
  set(f, 2 * COLS + 6, hdr(1) + "§7§lTop admins\n§r§7Builds itself: the staff ranked\n§r§7by their time on the server", "textures/ui/shop/hud_time", null);
  set(f, 3 * COLS + 1, hdr(1, "g") + "§a§lPlace ALL\n§r§7Island + the 7 boards in a ring\n§r§7Stand where the CENTRE should be", NAV.ok, { run: () => system.run(() => placeHub(player, self, "all")) });
  set(f, 3 * COLS + 3, hdr(1, "g") + "§b§lPlace dragon only\n§r§7Just the holographic ice dragon", "textures/items/nether_star", { run: () => system.run(() => placeHub(player, self, "core")) });
  set(f, 0 * COLS + 7, hdr(1, "g") + "§6§lPlace black hole\n§r§7A holographic black hole with\n§r§7golden tendrils (10 blocks)", "textures/items/ender_eye", { run: () => system.run(() => placeHub(player, self, "hole")) });
  set(f, 0 * COLS + 1, hdr(1, "g") + "§8§lPlace Dark Angel statue\n§r§7A hooded stone angel with a black\n§r§7aura. Size is set by you afterwards", "textures/items/netherite_ingot", { run: () => system.run(() => placeHub(player, self, "statue")) });
  set(f, 0 * COLS + 5, hdr(1, "g") + "§b§lPlace Floating Castle\n§r§7A gothic castle with 7 spires on a\n§r§7floating island above the clouds.\n§r§7Size is set by you afterwards", "textures/items/nether_star", { run: () => system.run(() => placeHub(player, self, "castle")) });
  set(f, 3 * COLS + 5, hdr(1, "g") + "§e§lPlace one board\n§r§7Pick a board, it appears in front\n§r§7of you. Repeat for more boards", "textures/items/paper", { run: () => boardPicker(player, self) });
  set(f, 3 * COLS + 7, hdr(Math.max(1, n)) + "§c§lManage\n§r§7Go to or remove placed items", NAV.page, { run: () => manageHubs(player, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

const BOARD_ICONS = ["textures/items/name_tag", "textures/items/compass_item", "textures/items/book_writable", "textures/items/book_writable", "textures/items/paper", "textures/items/emerald", "textures/ui/shop/hud_time"];
function boardPicker(player, back) {
  if (!guard(player)) return;
  const f = make("Place one board", SHORT_ROWS); f.self = () => boardPicker(player, back);
  set(f, 0 * COLS + 4, hdr(1) + "§e§lPlace one board\n§r§7It appears 2-3 blocks in front of you.\n§r§7Click again for another board.", "textures/items/paper", null);
  const slots = [1 * COLS + 1, 1 * COLS + 3, 1 * COLS + 5, 1 * COLS + 7, 2 * COLS + 2, 2 * COLS + 4, 2 * COLS + 6];
  BOARD_NAMES.forEach((nm, k) => set(f, slots[k], hdr(1, "g") + "§b§l" + nm + "\n§r§eClick to place", BOARD_ICONS[k], { run: () => system.run(() => placeHub(player, () => boardPicker(player, back), "board", k)) }));
  backBtn(f, back); status(player, f);
  open(player, f);
}

function placeHub(player, back, kind = "all", num = 0) {
  if (!guard(player)) return;
  const d = load(); if (!d) { say(player, "§c[Info Hub] Data not ready, try again."); return back(); }
  if (d.hubs.length >= MAX_HUBS) { say(player, "§c[Info Hub] Too many placed items (max " + MAX_HUBS + "). Remove one first."); return back(); }
  const l = player.location, v = player.getViewDirection(), r2 = (x) => Math.round(x * 100) / 100;
  let px = l.x, pz = l.z;
  if (kind === "board") { const m = Math.hypot(v.x, v.z) || 1; px = l.x + (v.x / m) * 2.5; pz = l.z + (v.z / m) * 2.5; }   // a single board goes a little in front of the operator
  const h = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), d: player.dimension.id, x: r2(px), y: r2(l.y), z: r2(pz), a: r2(Math.atan2(v.z, v.x)), k: kind, n: kind === "board" ? num : 0 };
  if (kind === "statue" || kind === "core" || kind === "hole" || kind === "all") { h.s = 1; h.r = 0; }
  if (kind === "castle") { h.s = 0.5; h.r = 0; }
  d.hubs.push(h);
  if (!save()) { d.hubs.pop(); say(player, "§c[Info Hub] Could not save."); return back(); }
  try { renderHub(h, true); } catch (e) { console.warn("[infohub] render failed: " + e); }
  try { player.playSound("random.levelup", { volume: 1, pitch: 1.1 }); } catch (e) { /* ignore */ }
  say(player, "§a[Info Hub] " + kindOf(h) + " placed at §f" + where(h) + "§a." + (kind === "all" ? " Step away from the centre to see everything." : kind === "statue" ? " Step back to see it. Change its size in Manage > this statue > Size." : kind === "castle" ? " Step back to see it. Change its size in Manage > this castle > Size." : ""));
  back();
}

function manageHubs(player, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) return back();
  const f = make("Info Hubs", SHORT_ROWS); f.self = () => manageHubs(player, back);
  d.hubs.slice(0, 27).forEach((h, i) => set(f, i, hdr(1) + "§b§lInfo Hub #" + (i + 1) + "\n§r§7" + kindOf(h) + "\n§r§7" + where(h) + "\n§r§eClick to manage", (h.k ?? "all") === "board" ? "textures/items/paper" : (h.k ?? "all") === "statue" ? "textures/items/netherite_ingot" : "textures/items/nether_star", { run: () => hubPage(player, h, i, () => manageHubs(player, back)) }));
  if (!d.hubs.length) set(f, 1 * COLS + 4, hdr(1) + "§7No Info Hub yet", "textures/items/nether_star", null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function hubPage(player, h, i, back) {
  if (!guard(player)) return;
  const f = make("Info Hub", SHORT_ROWS); f.self = () => hubPage(player, h, i, back);
  set(f, 0 * COLS + 4, hdr(1) + "§b§lInfo Hub #" + (i + 1) + "\n§r§7" + kindOf(h) + "\n§r§7At: §f" + where(h), "textures/items/nether_star", null);
  set(f, 1 * COLS + 2, hdr(1) + "§b§lGo there\n§r§7Teleport next to this hub", "textures/items/ender_pearl", { run: () => system.run(() => {
    if (!guard(player)) return;
    try { teleportTo(player, { x: h.x, y: h.y, z: h.z + ((h.k ?? "all") === "all" ? RADIUS + 2 : (h.k ?? "all") === "castle" ? 3 + 4.5 * statueScale(h) : 3) }, h.d); say(player, "§a[Info Hub] Teleported."); } catch (e) { say(player, "§c[Info Hub] Teleport failed (the area may not be loaded)."); }
  }) });
  if ((h.k ?? "all") !== "board") {
    const hk = h.k ?? "all", nm = hk === "castle" ? "castle" : hk === "statue" ? "statue" : hk === "hole" ? "black hole" : "dragon";
    set(f, 2 * COLS + 2, hdr(1) + "§e§lSize: §f" + statueScale(h) + "\n§r§7Make the " + nm + " bigger or smaller\n§r§7(" + SCALE_MIN + " to " + SCALE_MAX + ", 1 = normal)\n§r§eClick to change", "textures/items/nether_star", { run: () => statueSizeForm(player, h, () => hubPage(player, h, i, back)) });
    set(f, 2 * COLS + 6, hdr(1) + "§b§lTurn 45°\n§r§7Rotate the " + nm + " a little", "textures/items/compass_item", { run: () => system.run(() => {
      if (!guard(player)) return;
      const d = load(); const x = d?.hubs.find((q) => q.id === h.id); if (!x) { say(player, "§c[Info Hub] Item not found."); return; }
      x.r = ((x.r ?? 0) + 1) % 8; h.r = x.r;
      if (save()) { renderAll(); say(player, "§a[Info Hub] Turned."); }
      hubPage(player, h, i, back);
    }) });
  }
  set(f, 1 * COLS + 6, hdr(1, "r") + "§c§lRemove\n§r§7Delete this item", NAV.no, { run: () => confirmShort(player, "Remove this Info Hub?", ["§7Info Hub at §f" + where(h)], () => {
    if (!guard(player)) return;
    const d = load();
    if (d) { const k = d.hubs.findIndex((x) => x.id === h.id); if (k >= 0) { d.hubs.splice(k, 1); save(); removeEntities(h); say(player, "§6[Info Hub] Hub removed."); } else say(player, "§c[Info Hub] Hub not found."); }
    back();
  }, () => hubPage(player, h, i, back)) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- Dark Angel statue + floating castle: size
const sliderS = (form, label, min, max, step, def) => { try { form.slider(label, min, max, { defaultValue: def, valueStep: step }); } catch (e) { form.slider(label, min, max, step, def); } };
/** the operator picks the size with a slider, or types an exact number (the typed number wins) */
function statueSizeForm(player, h, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) return back();
  const cur = statueScale(h);
  const castle = (h.k ?? "all") === "castle";
  const form = new ModalFormData().title(castle ? "Castle size" : (h.k ?? "all") === "statue" ? "Statue size" : "Size");
  note(form, "§7Now: §f" + cur + "§7.  1 = normal (" + (castle ? "about 11 blocks tall, 9 wide" : (h.k ?? "all") === "statue" ? "about 4.4 blocks tall, 7 wide" : "the size it has now") + ").  2 = twice as big, 0.5 = half.");
  sliderS(form, "§fSize (slider)", SCALE_MIN, 4, 0.1, Math.min(4, cur));
  fld(form, "§fOr type an exact size (" + SCALE_MIN + " - " + SCALE_MAX + "), empty = use the slider", "for example 6", "");
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!guard(player)) return;
      const o = v.length > 2 ? v.slice(v.length - 2) : v;                       // the label (if the game has one) is not in the values: take the last 2
      const typed = String(o[1] ?? "").trim().replace(",", ".");
      let s = typed !== "" ? Number(typed) : Number(o[0]);
      if (!Number.isFinite(s) || s <= 0) { say(player, "§c[Info Hub] That is not a valid size."); return back(); }
      s = clampScale(s);
      const x = d.hubs.find((q) => q.id === h.id); if (!x) { say(player, "§c[Info Hub] Item not found."); return back(); }
      x.s = s; h.s = s;
      if (save()) { renderAll(); say(player, "§a[Info Hub] Size set to §f" + s + "§a."); }
    } catch (e) { console.warn("[infohub] size: " + e); }
    back();
  });
}

// ---- editing
function editNameForm(player, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) return back();
  const form = new ModalFormData().title("Name & tagline");
  note(form, HINT);
  fld(form, "Server name (max " + LIMIT.name + ")", "SMP", d.cfg.name);
  fld(form, "Tagline under the name (max " + LIMIT.tagline + ")", "Play • Build • Survive • Together", d.cfg.tagline);
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!guard(player)) return;
      const o = v.length > 2 ? v.slice(v.length - 2) : v;                       // the label (if the game has one) is not in the values: take the last 2
      d.cfg.name = cap(o[0], LIMIT.name) || "SMP"; d.cfg.tagline = cap(o[1], LIMIT.tagline);
      if (save()) { say(player, "§a[Info Hub] Saved."); renderAll(); }
    } catch (e) { console.warn("[infohub] name: " + e); }
    back();
  });
}
function editIpForm(player, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) return back();
  const form = new ModalFormData().title("Server IP & version");
  fld(form, "Server IP / address (max " + LIMIT.ip + ")", "play.example.net", d.cfg.ip);
  fld(form, "Version (max " + LIMIT.version + ", optional)", "Bedrock 1.21+", d.cfg.version);
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!guard(player)) return;
      d.cfg.ip = cap(v[0], LIMIT.ip); d.cfg.version = cap(v[1], LIMIT.version);
      if (save()) { say(player, "§a[Info Hub] Saved."); renderAll(); }
    } catch (e) { console.warn("[infohub] ip: " + e); }
    back();
  });
}
/** one line per field; an empty field = no line */
function editList(player, key, title, back) {
  if (!guard(player)) return;
  const d = load(); if (!d) return back();
  const max = MAXLINES[key], cur = d.cfg[key];
  const form = new ModalFormData().title(title);
  note(form, HINT + "\n§7One line per field (max " + LIMIT.line + " letters). Leave a field empty = no line.");
  for (let i = 0; i < max; i++) fld(form, "Line " + (i + 1), "", cur[i] ?? "");
  showModal(player, form, (v) => {
    if (!v) return back();
    try {
      if (!guard(player)) return;
      const vals = v.slice(Math.max(0, v.length - max));                        // the label (if any) is not in the values; take the last `max`
      d.cfg[key] = vals.map((x) => cap(x, LIMIT.line)).filter((x) => x.length > 0);
      if (save()) { say(player, "§a[Info Hub] " + title + " saved (" + d.cfg[key].length + " lines)."); renderAll(); }
    } catch (e) { console.warn("[infohub] list: " + e); }
    back();
  });
}
