// Heart use log (admin only data, shown in /shop > Hearts > Logs > "Heart Uses").
//
// WHO used a Heart (right-click: Heart, or Half Heart "Use it") and WHO BOUGHT that Heart (the hidden buyer tag on the item, see heartids.js).
// hearts.js calls logHeartUse(...) right after the item was consumed and the hearts were added.
// NOT recorded: buying, repairing a Half Heart, "Restore the missing half" in the shop page (no Heart item is used there),
//               the dark Heart of Malevolence turning into a Half Heart (nothing is added to the player).
//
// One record per USER, saved in a world property "smp_hu:<player id>" (works for offline players too):
//   { v, nm: last known name, c: Heart items used (all time), u: half hearts gained (all time),
//     l: [[time, type, amount, buyer id, buyer name, half hearts gained, active half hearts after, x, y, z, dim], ...] newest first (last 100) }
//   type: 0 Heart | 1 Half Heart      buyer id "-" = the item had no buyer tag (given by an admin / made before the tag existed)      dim: "o" | "n" | "e"
import { world } from "@minecraft/server";
import { HEART_ITEM, HALF_ITEM } from "./heartids.js";

const PFX = "smp_hu:", KEEP = 100;
const TYPES = [HEART_ITEM, HALF_ITEM];
export const TYPE_NAMES = ["Heart", "Half Heart"];
const cache = new Map();

const dimCode = (dimension) => {
  try { const d = String(dimension.id).replace("minecraft:", ""); return d === "overworld" ? "o" : d === "nether" ? "n" : d === "the_end" ? "e" : d; } catch (e) { return "o"; }
};

// ---------------------------------------------------------------- storage
function read(id) {
  let r = cache.get(id);
  if (r) return r;
  try { const raw = world.getDynamicProperty(PFX + id); if (typeof raw === "string") r = JSON.parse(raw); } catch (e) { r = null; }
  if (!r || typeof r !== "object") return null;
  r.l = Array.isArray(r.l) ? r.l : []; r.c = Number(r.c) || 0; r.u = Number(r.u) || 0;
  cache.set(id, r);
  return r;
}
function save(id, r) {
  cache.set(id, r);
  try { world.setDynamicProperty(PFX + id, JSON.stringify(r)); } catch (e) { console.warn("[heartuse] cannot save " + id + ": " + e); }
}

// ---------------------------------------------------------------- writing
/**
 * p = the player who used the item        typeId = HEART_ITEM | HALF_ITEM        units = half hearts gained (2 or 1)
 * tag = buyerOf(item) ({ id, name } or null)        after = his active half hearts after the use
 */
export function logHeartUse(p, typeId, units, tag, after) {
  try {
    const type = Math.max(0, TYPES.indexOf(typeId)), loc = p.location;
    const r = read(p.id) ?? { v: 1, nm: p.name ?? "?", c: 0, u: 0, l: [] };
    r.nm = p.name ?? r.nm; r.c += 1; r.u += units;
    r.l.unshift([Date.now(), type, 1, tag ? String(tag.id) : "-", tag ? String(tag.name ?? "").slice(0, 32) : "", units, Math.max(0, Math.floor(after ?? 0)),
      Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), dimCode(p.dimension)]);
    if (r.l.length > KEEP) r.l.length = KEEP;
    save(p.id, r);
  } catch (e) { console.warn("[heartuse] " + e); }
}

// ---------------------------------------------------------------- reading
const row = (x) => ({ t: x[0], type: x[1], amount: x[2], buyerId: x[3], buyerName: x[4], units: x[5], after: x[6], x: x[7], y: x[8], z: x[9], dim: x[10] });
/** "120 64 -300" + " (Nether)" / " (End)" */
export const usePlaceText = (x) => x.x + " " + x.y + " " + x.z + (x.dim === "n" ? " (Nether)" : x.dim === "e" ? " (End)" : "");

/** every user: [{ id, name, count, units, last }] - the latest user first */
export function usersList() {
  const out = [];
  try {
    for (const key of world.getDynamicPropertyIds()) {
      if (!key.startsWith(PFX)) continue;
      const id = key.slice(PFX.length), r = read(id); if (!r || r.c < 1) continue;
      out.push({ id, name: r.nm ?? "?", count: r.c, units: r.u, last: r.l[0]?.[0] ?? 0 });
    }
  } catch (e) { console.warn("[heartuse] list: " + e); }
  return out.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}
/** one user: his uses (newest first) + totals */
export function userInfo(id) {
  const r = read(id); if (!r) return null;
  return { id, name: r.nm ?? "?", count: r.c, units: r.u, list: r.l.map(row) };
}
/** every use of every player, newest first: [{ id, name, t, type, amount, buyerId, buyerName, units, after, x, y, z, dim }] */
export function allUses() {
  const out = [];
  for (const b of usersList()) { const info = userInfo(b.id); if (info) for (const x of info.list) out.push({ id: b.id, name: info.name, ...x }); }
  return out.sort((a, b) => b.t - a.t);
}
export function useTotals() {
  let users = 0, hearts = 0, own = 0;
  for (const b of usersList()) { users++; hearts += b.count; }
  try { for (const x of allUses()) if (x.buyerId === x.id) own++; } catch (e) { /* ignore */ }
  return { users, hearts, own };
}
