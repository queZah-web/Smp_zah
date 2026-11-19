// SPAWNER HOLOGRAMS: a small floating text above every stacked spawner (smp:spawner_<mob>) with all its information:
//   name + stack, owner, speed, storage (% and kills), time until it is full.
// The OWNER (or an admin) can close / open it for that spawner: Spawner page > "Hologram" button (saved in the spawner data as hh = 1).
// Text lines are the same invisible entities the other holograms use (shop:holo), tagged "spawner_holo" + "sh_<spawner>" + "shl<line>".
// Only spawners near a player are drawn / refreshed.  Nothing here can ever break another system.
import { world, system } from "@minecraft/server";
import { SPAWNERS } from "../mobs.js";
import * as D from "../spawner_data.js";

const TYPE = "shop:holo", TAG = "spawner_holo", GAP = 0.27, LINES = 5;
const RANGE = 24, RANGE_Y = 16, EVERY = 40, CLEAN_EVERY = 100;
const DIM = { o: "overworld", n: "nether", e: "the_end" };
const SHORT = { "minecraft:overworld": "o", "minecraft:nether": "n", "minecraft:the_end": "e" };
const NAMES = new Map(SPAWNERS.map((m) => [m.id, m.name]));
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (er) { return false; } };
const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const tagOf = (d, x, y, z) => ("sh_" + d + "_" + x + "_" + y + "_" + z).replace(/-/g, "m");

/** every saved spawner: [{ id: property id, d, x, y, z }] */
function allSpawners() {
  const out = [];
  let ids = []; try { ids = world.getDynamicPropertyIds(); } catch (e) { return out; }
  for (const id of ids) {
    if (!id.startsWith("sp:")) continue;
    const m = /^sp:([one]):(-?\d+),(-?\d+),(-?\d+)$/.exec(id); if (!m) continue;
    out.push({ id, d: m[1], x: +m[2], y: +m[3], z: +m[4] });
  }
  return out;
}
function readRec(id) { try { const v = world.getDynamicProperty(id); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } }

/** the 5 text lines (the record is NOT changed: the storage is estimated from the time that passed) */
function lines(mob, rec, now = Date.now()) {
  const name = NAMES.get(mob) ?? D.itemName(mob), rate = D.ratePerHour(mob) * rec.n, cap = Math.max(1, D.capKills(rec.n, mob));
  const add = (rec.f ?? 0) + (Math.max(0, now - (rec.t ?? now)) / 3600000) * rate;
  const kills = Math.min(cap, (rec.k ?? 0) + Math.floor(add)), pct = Math.min(100, Math.floor((kills / cap) * 100));
  const full = kills >= cap;
  const left = full ? "§c§lFULL - collect now" : "§7Full in: §f" + (((cap - kills) / rate) >= 1 ? ((cap - kills) / rate).toFixed(1) + "h" : Math.ceil(((cap - kills) / rate) * 60) + "m");
  return [
    "§c§l" + name + " Spawner §r§7x" + rec.n + "§8/" + D.MAX_STACK,
    "§7Owner: §f" + rec.on,
    "§7Speed: §f" + num(rate) + " kills/hour",
    "§7Storage: " + (full ? "§c" : pct >= 75 ? "§e" : "§a") + pct + "% §8(" + num(kills) + "/" + num(cap) + ")",
    left,
  ];
}

const holosOf = (dim, tag) => { try { return dim.getEntities({ type: TYPE, tags: [TAG, tag] }); } catch (e) { return []; } };
function removeAll(list) { for (const e of list) { try { e.remove(); } catch (er) { /* ignore */ } } }

function draw(dim, s, rec, mob) {
  const tag = tagOf(s.d, s.x, s.y, s.z), text = lines(mob, rec), found = holosOf(dim, tag);
  const byLine = new Map();
  for (const e of found) { try { const t = e.getTags().find((x) => x.startsWith("shl")); if (t) byLine.set(+t.slice(3), e); } catch (er) { /* ignore */ } }
  if (byLine.size !== LINES || found.length !== LINES) {              // missing / doubled lines: start again
    removeAll(found); byLine.clear();
    for (let i = 0; i < LINES; i++) {
      try {
        const e = dim.spawnEntity(TYPE, { x: s.x + 0.5, y: s.y + 1.3 + (LINES - 1 - i) * GAP, z: s.z + 0.5 });
        e.nameTag = text[i]; e.addTag(TAG); e.addTag(tag); e.addTag("shl" + i);
      } catch (e) { /* chunk not ready: the next scan tries again */ }
    }
    return;
  }
  for (let i = 0; i < LINES; i++) { const e = byLine.get(i); try { if (e && e.nameTag !== text[i]) e.nameTag = text[i]; } catch (er) { /* ignore */ } }
}

// ------------------------------------------------------------------ scan: spawners near players
system.runInterval(() => {
  try {
    const players = world.getAllPlayers(); if (!players.length) return;
    const near = players.map((p) => ({ d: SHORT[p.dimension.id], x: p.location.x, y: p.location.y, z: p.location.z, p }));
    for (const s of allSpawners()) {
      try {
        const q = near.find((n) => n.d === s.d && Math.abs(n.x - s.x) <= RANGE && Math.abs(n.z - s.z) <= RANGE && Math.abs(n.y - s.y) <= RANGE_Y);
        if (!q) continue;
        const dim = q.p.dimension, tag = tagOf(s.d, s.x, s.y, s.z);
        const b = dim.getBlock({ x: s.x, y: s.y, z: s.z });
        if (!b) continue;                                              // not loaded
        const mob = b.typeId.startsWith(D.TYPE_PREFIX) ? b.typeId.slice(D.TYPE_PREFIX.length) : null;
        const rec = readRec(s.id);
        if (!mob || !rec || rec.hh) { removeAll(holosOf(dim, tag)); continue; }      // gone / closed by the owner
        draw(dim, s, rec, mob);
      } catch (e) { /* next one */ }
    }
  } catch (e) { console.warn("[spawnerholo] " + e); }
}, EVERY);

// ------------------------------------------------------------------ cleaner: holograms of spawners that no longer exist or were closed
system.runInterval(() => {
  try {
    const valid = new Set();
    for (const s of allSpawners()) { const rec = readRec(s.id); if (rec && !rec.hh) valid.add(tagOf(s.d, s.x, s.y, s.z)); }
    for (const d of Object.values(DIM)) {
      let list = []; try { list = world.getDimension(d).getEntities({ type: TYPE, tags: [TAG] }); } catch (e) { continue; }
      for (const e of list) {
        try { const t = e.getTags().find((x) => x.startsWith("sh_")); if (!t || !valid.has(t)) e.remove(); } catch (er) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}, CLEAN_EVERY);
