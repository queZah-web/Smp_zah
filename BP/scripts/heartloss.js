// Heart loss log (admin only data, shown in /shop > Hearts > Logs > "Hearts Destroyed").
//
// It records what happens to a Heart that somebody BOUGHT (the hidden buyer tag on the item, see heartids.js).  Two kinds of records:
//   0  DESTROYED   the Heart item is gone for good (exploded after 3 minutes on the ground, burned in lava / fire, cactus, explosion, the void,
//                  it vanished, or an admin removed it)
//   1  HALVED      a full Heart of the buyer became a Half Heart (a spoiled Heart of Malevolence was picked up / used, or an admin removed
//                  only half of it)
//   2  REPAIRED    a Half Heart of the buyer was repaired into a full Heart (1 Enchanted Golden Apple); holder = the player who repaired it
// Hearts without a buyer tag (given by an admin / made before the tag existed) can't be linked to a buyer, so they are not recorded.
//
// One record per BUYER, saved in a world property "smp_hl:<buyer id>" (works for offline players too):
//   { v, nm: last known buyer name, d: Hearts destroyed (all time), h: Hearts halved (all time), r: Half Hearts repaired (all time),
//     l: [[time, kind, type, amount, cause, x, y, z, dim, holder id, holder name, seconds on the ground, note], ...] newest first (last 100) }
//   type: 0 Heart | 1 Half Heart | 2 Heart of Malevolence      dim: "o" overworld | "n" nether | "e" end
//   holder: the player whose inventory it was in (HALVED, admin removal)      note: the admin's name (admin removal)
import { world } from "@minecraft/server";
import { HEART_ITEM, HALF_ITEM, CURSED_ITEM } from "./heartids.js";

const PFX = "smp_hl:", KEEP = 100;
const TYPES = [HEART_ITEM, HALF_ITEM, CURSED_ITEM];
export const TYPE_NAMES = ["Heart", "Half Heart", "Heart of Malevolence"];
export const KIND_DESTROYED = 0, KIND_HALVED = 1, KIND_REPAIRED = 2;
/** cause code -> text shown to the admin */
export const CAUSES = {
  ex: "Exploded (3 minutes on the ground)",
  lava: "Burned in lava",
  fire: "Burned in fire",
  cactus: "Destroyed by a cactus",
  boom: "Destroyed by an explosion",
  void: "Fell into the void",
  lightning: "Struck by lightning",
  gone: "Vanished (nobody picked it up, cause unknown)",
  spoil: "Spoiled Heart picked up (Heart of Malevolence)",
  use: "Spoiled Heart used (Heart of Malevolence)",
  admin: "Removed by an admin",
  repair: "Repaired with an Enchanted Golden Apple (Half Heart -> Heart)",
};
const cache = new Map();

/** "o" | "n" | "e" for a Dimension object */
export function dimCodeOf(dimension) {
  try { const d = String(dimension.id).replace("minecraft:", ""); return d === "overworld" ? "o" : d === "nether" ? "n" : d === "the_end" ? "e" : d; } catch (e) { return "o"; }
}

// ---------------------------------------------------------------- storage
function read(id) {
  let r = cache.get(id);
  if (r) return r;
  try { const raw = world.getDynamicProperty(PFX + id); if (typeof raw === "string") r = JSON.parse(raw); } catch (e) { r = null; }
  if (!r || typeof r !== "object") return null;
  r.l = Array.isArray(r.l) ? r.l : []; r.d = Number(r.d) || 0; r.h = Number(r.h) || 0; r.r = Number(r.r) || 0;
  cache.set(id, r);
  return r;
}
function save(id, r) {
  cache.set(id, r);
  try { world.setDynamicProperty(PFX + id, JSON.stringify(r)); } catch (e) { console.warn("[heartloss] cannot save " + id + ": " + e); }
}

/**
 * Writes one record.  o = { kind, type (item id), amount, cause (a key of CAUSES), bid + bnm (the buyer from the tag), loc {x,y,z}, dim ("o"/"n"/"e"),
 *                          hid + hnm (holder, optional), age (seconds on the ground, optional), note (optional) }
 */
export function logLoss(o) {
  try {
    if (!o || !o.bid || o.bid === "-" || !(o.amount > 0) || !o.loc) return;
    const id = String(o.bid), amount = Math.floor(o.amount);
    const r = read(id) ?? { v: 1, nm: o.bnm || "?", d: 0, h: 0, r: 0, l: [] };
    if (o.bnm) r.nm = String(o.bnm);
    const kind = o.kind === KIND_HALVED ? KIND_HALVED : o.kind === KIND_REPAIRED ? KIND_REPAIRED : KIND_DESTROYED;
    if (kind === KIND_HALVED) r.h += amount; else if (kind === KIND_REPAIRED) r.r += amount; else r.d += amount;
    r.l.unshift([Date.now(), kind, Math.max(0, TYPES.indexOf(o.type)), amount, CAUSES[o.cause] ? o.cause : "gone",
      Math.floor(o.loc.x), Math.floor(o.loc.y), Math.floor(o.loc.z), o.dim ?? "o",
      String(o.hid ?? ""), String(o.hnm ?? "").slice(0, 32), Math.max(0, Math.floor(o.age ?? 0)), String(o.note ?? "").slice(0, 32)]);
    if (r.l.length > KEEP) r.l.length = KEEP;
    save(id, r);
  } catch (e) { console.warn("[heartloss] " + e); }
}

// ---------------------------------------------------------------- reading
const row = (x) => ({ t: x[0], kind: x[1], type: x[2], amount: x[3], cause: x[4], x: x[5], y: x[6], z: x[7], dim: x[8], holderId: x[9], holderName: x[10], age: x[11], note: x[12] });
export const causeText = (x) => CAUSES[x.cause] ?? CAUSES.gone;
/** "120 64 -300" + " (Nether)" / " (End)" */
export const lossPlaceText = (x) => x.x + " " + x.y + " " + x.z + (x.dim === "n" ? " (Nether)" : x.dim === "e" ? " (End)" : "");
/** 75 -> "1m 15s" */
export const secText = (s) => (s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s");

/** every buyer who lost a Heart: [{ id, name, destroyed, halved, last }] - the latest first */
export function lossBuyers() {
  const out = [];
  try {
    for (const key of world.getDynamicPropertyIds()) {
      if (!key.startsWith(PFX)) continue;
      const id = key.slice(PFX.length), r = read(id); if (!r || r.d + r.h + r.r < 1) continue;
      out.push({ id, name: r.nm ?? "?", destroyed: r.d, halved: r.h, repaired: r.r, last: r.l[0]?.[0] ?? 0 });
    }
  } catch (e) { console.warn("[heartloss] list: " + e); }
  return out.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}
/** one buyer: the records (newest first) + his totals */
export function lossInfo(id) {
  const r = read(id); if (!r) return null;
  return { id, name: r.nm ?? "?", destroyed: r.d, halved: r.h, repaired: r.r, list: r.l.map(row) };
}
/** every record of every buyer, newest first: [{ id, name, ...row }] */
export function allLosses() {
  const out = [];
  for (const b of lossBuyers()) { const info = lossInfo(b.id); if (info) for (const x of info.list) out.push({ id: b.id, name: info.name, ...x }); }
  return out.sort((a, b) => b.t - a.t);
}
export function lossTotals() {
  let buyers = 0, destroyed = 0, halved = 0, repaired = 0;
  for (const b of lossBuyers()) { buyers++; destroyed += b.destroyed; halved += b.halved; repaired += b.repaired; }
  return { buyers, destroyed, halved, repaired };
}
