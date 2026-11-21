// ===================================================================================================================
// RANK STATUES - a statue of a player who has a server rank (Owner: /opr > Ranks > Rank statues)
//   * player size, on a small dark pedestal with a gold rim; the outfit, the shoulder pads, the chest gem, the cape and the
//     crown are in the colours of his rank (Silver ... Legend) - entity smp:rank_statue (model + 9 textures in the RP)
//   * above it: the crown + the RANK, his NAME, his money and kills, online / offline - kept up to date by itself
//     (a new rank -> the statue changes its colours at once; rank taken away -> the statue disappears)
//   * Bedrock does not let an add-on read a player's real skin, so the statue wears the rank outfit, not his skin
//   * it can't be hit, pushed or moved; if it is removed by a command it comes back by itself; it turns to stand as placed
// No lag: the statues are looked at every 2 seconds, only where the world is loaded.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { RANKS, rankIndexOf, rankBadge } from "./viprank.js";
import { recordOf } from "../data.js";

const TYPE = "smp:rank_statue", KEY = "vs:list", TAG = "rank_statue", MAX = 60;
let list = null;
function load() { if (list) return list; try { const r = world.getDynamicProperty(KEY); list = typeof r === "string" ? JSON.parse(r) : []; } catch (e) { list = []; } if (!Array.isArray(list)) list = []; return list; }
function save() { try { world.setDynamicProperty(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }
export const statues = () => load().slice();
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (x) { return false; } };
const short = (n) => { n = Math.floor(Number(n) || 0); for (const [u, v] of [["b", 1e9], ["m", 1e6], ["k", 1e3]]) if (n >= v) { const t = Math.floor((n * 10) / v); return Math.floor(t / 10) + (t % 10 ? "." + (t % 10) : "") + u; } return String(n); };

function label(s) {
  const r = RANKS[rankIndexOf(s.pid)], rec = recordOf(s.pid) ?? {}, on = world.getAllPlayers().some((p) => p.id === s.pid);
  const name = String(rec.name ?? s.name ?? "?");
  return [rankBadge(r), "§f§l" + name, "§a$" + short(rec.money) + " §8| §cKills §f" + (rec.kills ?? 0), on ? "§aOnline" : "§7Offline"].join("\n");
}
function find(dim, s) {
  try { return dim.getEntities({ type: TYPE, location: { x: s.x, y: s.y + 1, z: s.z }, maxDistance: 2.5 }).filter((e) => { try { return e.getDynamicProperty("vs") === s.k; } catch (x) { return false; } }); } catch (e) { return null; }
}
function spawn(dim, s) {
  try {
    const e = dim.spawnEntity(TYPE, { x: s.x, y: s.y, z: s.z });
    e.setDynamicProperty("vs", s.k); e.addTag(TAG);
    try { e.setRotation({ x: 0, y: s.yaw }); } catch (x) { /* ignore */ }
    return e;
  } catch (e) { return null; }
}
function refresh(s, fx) {
  let dim; try { dim = world.getDimension(s.d); } catch (e) { return; }
  try { if (!dim.getBlock({ x: Math.floor(s.x), y: Math.floor(s.y), z: Math.floor(s.z) })) return; } catch (e) { return; }      // not loaded now
  const idx = rankIndexOf(s.pid);
  let ents = find(dim, s); if (!ents) return;
  if (idx < 0) { for (const e of ents) { try { e.remove(); } catch (x) { /* ignore */ } } list = load().filter((t) => t.k !== s.k); save(); return; }   // rank taken away
  for (let i = 1; i < ents.length; i++) { try { ents[i].remove(); } catch (x) { /* ignore */ } }
  let e = ents[0] ?? spawn(dim, s); if (!e) return;
  try { if (e.getProperty("smp:rank") !== idx) e.setProperty("smp:rank", idx); } catch (x) { /* ignore */ }
  const txt = label(s); try { if (e.nameTag !== txt) e.nameTag = txt; } catch (x) { /* ignore */ }
  try { const l = e.location; if (Math.abs(l.x - s.x) + Math.abs(l.y - s.y) + Math.abs(l.z - s.z) > 0.05) e.teleport({ x: s.x, y: s.y, z: s.z }, { rotation: { x: 0, y: s.yaw } }); else if (Math.abs((e.getRotation().y - s.yaw + 540) % 360 - 180) > 1) e.setRotation({ x: 0, y: s.yaw }); } catch (x) { /* ignore */ }
  if (fx) {                                                    // a few sparkles while somebody is close
    try { if (world.getAllPlayers().some((p) => p.dimension.id === s.d && (p.location.x - s.x) ** 2 + (p.location.z - s.z) ** 2 < 576)) { const a = Math.random() * Math.PI * 2; dim.spawnParticle("minecraft:end_rod", { x: s.x + Math.cos(a) * 0.7, y: s.y + 0.4 + Math.random() * 2, z: s.z + Math.sin(a) * 0.7 }); } } catch (x) { /* ignore */ }
  }
}
let tick = 0;
system.runInterval(() => { tick++; for (const s of load().slice()) refresh(s, true); }, 40);

/** a statue of player id `pid` at the place of `owner`, looking at the owner (or at `at` / `yaw`) -> { ok } | { err } */
export function placeStatue(owner, pid, name, at, yaw) {
  load();
  if (rankIndexOf(pid) < 0) return { err: "This player has no rank." };
  if (list.length >= MAX) return { err: "There are already " + MAX + " statues. Remove some first." };
  const l = at ?? owner.location;
  const s = { k: "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), pid, name, d: owner.dimension.id, x: Math.floor(l.x) + 0.5, y: Math.floor(l.y), z: Math.floor(l.z) + 0.5, yaw: yaw ?? ((owner.getRotation().y + 180) % 360) };
  list.push(s); save();
  refresh(s, false);
  return { ok: true, s };
}
/** every ranked player (best rank first) in a row in front of the owner, all looking at him */
export function placeAll(owner, players) {
  const r = owner.getRotation().y * Math.PI / 180, fx = -Math.sin(r), fz = Math.cos(r), rx = -fz, rz = fx;      // forward / right of the owner
  const n = players.length; let made = 0, err = "";
  players.forEach((pl, i) => {
    const off = (i - (n - 1) / 2) * 3, l = owner.location;
    const at = { x: l.x + fx * 4 + rx * off, y: l.y, z: l.z + fz * 4 + rz * off };
    const res = placeStatue(owner, pl.id, pl.name, at, (owner.getRotation().y + 180) % 360);
    if (res.ok) made++; else err = res.err;
  });
  return { made, err };
}
export function removeStatue(k) {
  load(); const s = list.find((t) => t.k === k); if (!s) return false;
  try { const dim = world.getDimension(s.d); for (const e of find(dim, s) ?? []) e.remove(); } catch (e) { /* ignore */ }
  list = list.filter((t) => t.k !== k); save(); return true;
}
export function removeAllStatues() {
  for (const s of load().slice()) removeStatue(s.k);
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) { try { for (const e of world.getDimension(id).getEntities({ type: TYPE })) e.remove(); } catch (e) { /* ignore */ } }
  list = []; save();
}
// a statue entity that is not in the list any more (old / removed while far away) is cleaned when it is seen
system.runInterval(() => {
  const ks = new Set(load().map((s) => s.k));
  for (const p of world.getAllPlayers()) {
    try { for (const e of p.dimension.getEntities({ type: TYPE, location: p.location, maxDistance: 48 })) { let k; try { k = e.getDynamicProperty("vs"); } catch (x) { k = null; } if (!ks.has(k)) e.remove(); } } catch (e) { /* ignore */ }
  }
}, 200);
