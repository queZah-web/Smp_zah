// END PORTAL HOLOGRAMS: floating text on every End portal that players walk up to (any number of portals).
//   closed:     THE END / CLOSED
//   countdown:  THE END / Opens in 04:59
//   open:       THE END / OPEN / Closes in 14:32  (15:00 when it was just activated) + the name of the first player who reached it
// The text lines are the same invisible entities the other holograms use (shop:holo), tagged "end_gate" + "eg_<portal>" + "egl<line>".
// Owner / Admin can switch them off, remove the nearest one or bring them back (menu: Operator > World > End event).
// Nothing here can ever break another system.
import { world, system, BlockVolume } from "@minecraft/server";
import { eventView, mmss, skipGate } from "./endgate.js";
import { isAr, pick } from "./arextra.js";
import { stats } from "../data.js";

const TYPE = "shop:holo", TAG = "end_gate", GAP = 0.27, LINES = 4;
const SCAN_EVERY = 20, PER_RUN = 3;                         // ticks between scans, players scanned each time (round robin)
const RAD = 14, RAD_Y = 6, SPAWN_RANGE = 12, CHECK_RANGE = 10;
const DIMS = ["overworld", "nether"];
const PORTAL = "minecraft:end_portal";
const short = (id) => (String(id).includes("nether") ? "n" : String(id).includes("end") ? "e" : "o");

function textLines(v, now = Date.now()) {
  const head = "§5§l✦ THE END ✦";
  if (v.open) {
    return [head, "§a§lOPEN", v.openUntil ? "§eCloses in §f" + mmss(v.openUntil - now) : "§eOpen until the staff close it", v.first ? "§dFirst in: §f" + v.first.n : "§7Be the first one in!"];
  }
  if (v.openAt) return [head, "§e§lOpens in §f" + mmss(v.openAt - now), "§7Get ready!", ""];
  return [head, "§c§lCLOSED", "§7It opens during a staff event", ""];
}

// ------------------------------------------------------------------ finding portals
function portalBlocks(dim, x0, y0, z0) {
  const out = [];
  try {
    const vol = new BlockVolume({ x: x0 - RAD, y: Math.max(-64, y0 - RAD_Y), z: z0 - RAD }, { x: x0 + RAD, y: y0 + RAD_Y, z: z0 + RAD });
    const res = dim.getBlocks(vol, { includeTypes: [PORTAL] }, true);
    const it = res && typeof res.getBlockLocationIterator === "function" ? res.getBlockLocationIterator() : res;
    for (const l of it) { out.push({ x: l.x, y: l.y, z: l.z }); if (out.length > 600) break; }
    return out;
  } catch (e) { /* getBlocks not available here: smaller manual scan */ }
  try {
    for (let x = x0 - 10; x <= x0 + 10; x++) for (let z = z0 - 10; z <= z0 + 10; z++) for (let y = y0 - 5; y <= y0 + 5; y++) {
      const b = dim.getBlock({ x, y, z }); if (b && b.typeId === PORTAL) out.push({ x, y, z });
    }
  } catch (e) { /* unloaded: nothing */ }
  return out;
}
/** [{ key, x, y, z }]: the portals found (blocks that touch are one portal) */
function gatesAround(dim, p) {
  const l = p.location, pts = portalBlocks(dim, Math.floor(l.x), Math.floor(l.y), Math.floor(l.z));
  const seen = new Array(pts.length).fill(false), gates = [];
  for (let i = 0; i < pts.length; i++) {
    if (seen[i]) continue;
    const group = [pts[i]]; seen[i] = true;
    for (let g = 0; g < group.length; g++) for (let j = 0; j < pts.length; j++) {
      if (!seen[j] && Math.abs(pts[j].x - group[g].x) <= 1 && Math.abs(pts[j].y - group[g].y) <= 1 && Math.abs(pts[j].z - group[g].z) <= 1) { seen[j] = true; group.push(pts[j]); }
    }
    const xs = group.map((b) => b.x), ys = group.map((b) => b.y), zs = group.map((b) => b.z);
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2), cz = Math.round((Math.min(...zs) + Math.max(...zs)) / 2), cy = Math.max(...ys);
    gates.push({ key: (short(dim.id) + "_" + cx + "_" + cy + "_" + cz).replace(/-/g, "m"), x: (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5, y: cy, z: (Math.min(...zs) + Math.max(...zs)) / 2 + 0.5 });
  }
  return gates;
}

// ------------------------------------------------------------------ the entities
const byKey = (dim, key) => { try { return dim.getEntities({ type: TYPE, tags: [TAG, "eg_" + key] }); } catch (e) { return []; } };
const allHolos = (dim) => { try { return dim.getEntities({ type: TYPE, tags: [TAG] }); } catch (e) { return []; } };
const keyOf = (e) => { try { const t = e.getTags().find((x) => x.startsWith("eg_")); return t ? t.slice(3) : null; } catch (er) { return null; } };
function spawnGate(dim, g, lines) {
  const base = g.y + 1.45;
  for (let i = 0; i < LINES; i++) {
    try {
      const e = dim.spawnEntity(TYPE, { x: g.x, y: base + (LINES - 1 - i) * GAP, z: g.z });
      e.nameTag = lines[i] ?? ""; e.addTag(TAG); e.addTag("eg_" + g.key); e.addTag("egl" + i);
    } catch (er) { /* chunk not ready: the next scan tries again */ }
  }
}
function removeKey(dim, key) { for (const e of byKey(dim, key)) { try { e.remove(); } catch (er) { /* ignore */ } } }

/** Owner / Admin: removes the hologram of the portal nearest to the actor (within 20 blocks) and keeps it removed */
export function removeNearest(actor) {
  try {
    let best = null;
    for (const e of allHolos(actor.dimension)) {
      const k = keyOf(e); if (!k) continue;
      const d = Math.hypot(e.location.x - actor.location.x, e.location.z - actor.location.z);
      if (d <= 20 && (!best || d < best.d)) best = { k, d };
    }
    if (!best) return { err: "No End hologram within 20 blocks of you." };
    const r = skipGate(actor, best.k); if (r.err) return r;
    removeKey(actor.dimension, best.k);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

let rr = 0;
function scan() {
  try {
    const v = eventView(); if (!v.holo) return;
    const lines = textLines(v), players = world.getAllPlayers().filter((p) => { try { return DIMS.includes(p.dimension.id.replace("minecraft:", "")); } catch (e) { return false; } });
    if (!players.length) return;
    for (let n = 0; n < Math.min(PER_RUN, players.length); n++) {
      const p = players[(rr++) % players.length];
      try {
        const dim = p.dimension, gates = gatesAround(dim, p), keys = new Set(gates.map((g) => g.key));
        for (const g of gates) {
          if (v.skip.includes(g.key)) continue;
          if (Math.hypot(g.x - p.location.x, g.z - p.location.z) > SPAWN_RANGE) continue;     // only complete portals near him (the whole portal was scanned)
          if (!byKey(dim, g.key).length) spawnGate(dim, g, lines);
        }
        for (const e of allHolos(dim)) {                                                     // a hologram whose portal is gone
          if (!e.hasTag("egl0")) continue;
          if (Math.hypot(e.location.x - p.location.x, e.location.z - p.location.z) > CHECK_RANGE) continue;
          const k = keyOf(e); if (k && !keys.has(k)) removeKey(dim, k);
        }
      } catch (e) { /* next player */ }
    }
  } catch (e) { /* ignore */ }
}

let lastPhase = null;
function update() {
  try {
    const v = eventView(), now = Date.now(), lines = textLines(v, now);
    const phase = v.open ? "open" : v.openAt ? "count" : "closed";
    for (const d of DIMS) {
      let dim; try { dim = world.getDimension(d); } catch (e) { continue; }
      for (const e of allHolos(dim)) {
        try {
          const k = keyOf(e);
          if (!v.holo || (k && v.skip.includes(k))) { e.remove(); continue; }
          const idx = Number((e.getTags().find((t) => /^egl\d$/.test(t)) ?? "egl0").slice(3));
          const txt = lines[idx] ?? "";
          if (e.nameTag !== txt) e.nameTag = txt;
          // particles on the portal during the last seconds and when it opens
          if (idx === 0 && ((phase === "count" && v.openAt - now <= 30000) || (phase === "open" && lastPhase !== "open"))) {
            const big = phase === "open";
            for (let i = 0; i < (big ? 14 : 6); i++) { try { dim.spawnParticle("minecraft:endrod", { x: e.location.x + (Math.random() - 0.5) * 3, y: e.location.y - 1.2 - Math.random() * 1.4, z: e.location.z + (Math.random() - 0.5) * 3 }); } catch (er) { break; } }
          }
        } catch (er) { /* next entity */ }
      }
    }
    lastPhase = phase;
  } catch (e) { /* ignore */ }
}
try { system.runInterval(scan, SCAN_EVERY); system.runInterval(update, 20); } catch (e) { console.warn("[endholo] not started: " + e); }

// ------------------------------------------------------------------ Arabic for the holograms
// A hologram is ONE shared entity: everybody sees the same text, so it stays English.  Players whose language is Arabic and who stand
// near a portal hologram also get the same information in Arabic on the action bar (not when their scoreboard style is "action bar").
function arLine(v, now = Date.now()) {
  if (v.open) return "§5✦ الإند ✦ §a§lمفتوح §r§7| " + (v.openUntil ? "§eيُغلق بعد §f" + mmss(v.openUntil - now) : "§eمفتوح حتى يغلقه الإداريون") + (v.first ? " §7| §dأول من دخل: §f" + v.first.n : " §7| §7كن أول الداخلين!");
  if (v.openAt) return "§5✦ الإند ✦ §e§lيفتح بعد §f" + mmss(v.openAt - now) + " §7| §7استعد!";
  return "§5✦ الإند ✦ §c§lمغلق §r§7| §7يفتح خلال فعالية للإداريين";
}
function arBars() {
  try {
    const v = eventView(); if (!v.holo) return;
    const now = Date.now();
    for (const p of world.getAllPlayers()) {
      try {
        if (!isAr(p) || !DIMS.includes(p.dimension.id.replace("minecraft:", ""))) continue;
        let mode = "panel"; try { mode = stats(p).hud ?? "panel"; } catch (e) { /* ignore */ }
        if (mode === "bar") continue;
        const near = p.dimension.getEntities({ type: TYPE, tags: [TAG, "egl0"], location: p.location, maxDistance: 7 });
        if (near.length) p.onScreenDisplay.setActionBar(pick(p, "", arLine(v, now), 60));
      } catch (e) { /* next player */ }
    }
  } catch (e) { /* ignore */ }
}
try { system.runInterval(arBars, 20); } catch (e) { /* ignore */ }
