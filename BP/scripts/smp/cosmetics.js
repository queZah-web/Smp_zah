// COSMETICS - logic (ownership, buying, name colour, particle trail, the on/off switches).  Menus: cosmenu.js.   Catalogue + prices: cosdata.js.
//  * what a player owns / wears:  ex(p).cos = { own: { "color:red": time, "trail:gold": time }, color: "red", trail: "gold" }
//  * switches (ex(p).set):  fxOff = no particles / effects for me,  sfxOff = no luxury sounds for me,  trailOff = nobody sees MY trail
//  * the name colour is used by the chat code (clans.js) through titleView.name; titles stay in achievements.js (Cosmetics -> Titles)
import { isVanishedId } from "../systems/staffcore.js";   // staff tools: no trail for a vanished operator
import { world, system, MolangVariableMap } from "@minecraft/server";
import { ex } from "./store.js";
import { takeMoney, addMoney, takeShards, addShards, stats, addTx } from "../data.js";
import { buyPrice } from "../priceperks.js";
import { titleView } from "./titlestate.js";
import { luxPrefs } from "../lux.js";
import { isMuted } from "./fxprefs.js";
import { COLORS, TRAILS, colorById, trailById, paint } from "./cosdata.js";

const cos = (p) => { const d = ex(p); d.cos ??= {}; d.cos.own ??= {}; d.cos.color ??= ""; d.cos.trail ??= ""; return d.cos; };
export const owns = (p, kind, id) => !!cos(p).own[kind + ":" + id];
export const worn = (p, kind) => cos(p)[kind];
export const colorOf = (p) => { const c = cos(p); return c.color && owns(p, "color", c.color) ? colorById(c.color) : null; };
export const trailOf = (p) => { const c = cos(p); return c.trail && owns(p, "trail", c.trail) ? trailById(c.trail) : null; };

/** equip an owned item ("" = take it off). returns true when it worked */
export function wear(p, kind, id) {
  const c = cos(p);
  if (id && !owns(p, kind, id)) return false;
  c[kind] = id;
  return true;
}
/** buy with "money" or "shards". The money is taken first and given back if anything fails.  -> { ok } | { err } */
export function buy(p, kind, item, currency) {
  const list = kind === "color" ? COLORS : TRAILS;
  if (!list.includes(item)) return { err: "Unknown item." };
  if (owns(p, kind, item.id)) return { err: "You already own this." };
  const price = currency === "shards" ? item.shards : buyPrice(p, item.money, 0);      // money: with the rank / Trading discount
  if (!(price > 0)) return { err: "This item cannot be bought." };
  if ((currency === "shards" ? stats(p).shards : stats(p).money) < price) return { err: "Not enough " + (currency === "shards" ? "shards" : "money") + "." };
  if (!(currency === "shards" ? takeShards(p, price) : takeMoney(p, price))) return { err: "Not enough " + (currency === "shards" ? "shards" : "money") + "." };
  try { addTx(p, { type: "buy", id: "cosmetic_" + kind + "_" + item.id, name: "Cosmetic: " + String(item.name ?? item.id).replace(/§./g, ""), qty: 1, total: price, cur: currency === "shards" ? "shards" : undefined }); } catch (e) { /* the log never stops a purchase */ }
  try { cos(p).own[kind + ":" + item.id] = Date.now(); }
  catch (e) { if (currency === "shards") addShards(p, price); else addMoney(p, price); return { err: "Could not save - you were not charged." }; }
  return { ok: true, price };
}

// ---------------------------------------------------------------- on / off switches (a new switch = one line here, the page lays it out by itself)
export const TOGGLES = [
  { key: "fxOff",    name: "Particles", icon: "textures/ui/shop/x_firework_star", lines: ["See particles and effects:", "trails, mining, shop..."] },
  { key: "sfxOff",   name: "Sounds",    icon: "textures/ui/shop/i3d_noteblock",   lines: ["Hear the luxury sounds of", "mining, shop, teleport..."] },
  { key: "trailOff", name: "My Trail",  icon: "textures/ui/shop/i3d_glowstone",   lines: ["Show YOUR particle trail", "to other players"] },
];
export const toggleOn = (p, t) => ex(p).set[t.key] !== true;
export const flip = (p, t) => { ex(p).set[t.key] = toggleOn(p, t); };

// the luxury effects / sounds (lux.js) ask these two questions before they show / play anything
luxPrefs.fx = (p) => { try { return ex(p).set.fxOff !== true; } catch (e) { return true; } };
luxPrefs.sfx = (p) => { try { return ex(p).set.sfxOff !== true; } catch (e) { return true; } };
luxPrefs.mute = (p, key) => isMuted(p, key);               // the fine switches (fxprefs.js): one group's sounds / particles off

// the chat shows the name in its colour
titleView.name = (p) => { try { const c = colorOf(p); return c ? paint(c, p.name) : p.name; } catch (e) { return p.name; } };

// ---------------------------------------------------------------- particle trail
const TRAIL_EVERY = 4, VIEW = 40, MOVE_MIN2 = 0.04;
const last = new Map();                                  // player id -> last position
let perPlayerApi = true;                                 // false = this game version has no Player.spawnParticle (then the particle is shown to everybody)
function emit(viewer, dim, t, loc) {
  const vars = new MolangVariableMap();
  let id;
  if (t.lux) { id = "lux:spark"; const v = { count: 2, radius: 0.25, speed: 0.35, life: 0.9, size: 0.13, r: t.lux[0], g: t.lux[1], b: t.lux[2] }; for (const k in v) vars.setFloat("variable." + k, v[k]); }
  else if (t.pixel) { id = "lux:pixel"; const v = { count: 4, half: 0.25, speed: 0.3, life: 0.9, size: 0.07, r: t.pixel[0], g: t.pixel[1], b: t.pixel[2] }; for (const k in v) vars.setFloat("variable." + k, v[k]); }
  else id = t.vanilla;
  if (viewer && perPlayerApi) {
    if (typeof viewer.spawnParticle === "function") { viewer.spawnParticle(id, loc, t.vanilla ? undefined : vars); return; }
    perPlayerApi = false;
  }
  dim.spawnParticle(id, loc, t.vanilla ? undefined : vars);
}
/** one small burst of a trail at a position, shown to `viewers` (used by the loop and by the preview) */
export function puff(owner, t, viewers) {
  const l = owner.location, loc = { x: l.x, y: l.y + 0.15, z: l.z };
  if (!perPlayerApi) { try { emit(null, owner.dimension, t, loc); } catch (e) { /* ignore */ } return; }
  for (const v of viewers) { try { emit(v, owner.dimension, t, loc); } catch (e) { /* ignore */ } }
}
const viewersOf = (owner) => {
  const l = owner.location, out = [];
  for (const q of world.getAllPlayers()) {
    try {
      if (q.dimension.id !== owner.dimension.id) continue;
      const dx = q.location.x - l.x, dz = q.location.z - l.z;
      if (dx * dx + dz * dz > VIEW * VIEW) continue;
      if (q.id !== owner.id && ex(q).set.fxOff === true) continue;      // that player turned particles off
      if (q.id === owner.id && ex(q).set.fxOff === true) continue;
      out.push(q);
    } catch (e) { /* skip */ }
  }
  return out;
};
system.runInterval(() => {
  try {
    for (const p of world.getAllPlayers()) {
      try {
        const t = trailOf(p); if (!t || isVanishedId(p.id)) { last.delete(p.id); continue; }
        if (ex(p).set.trailOff === true) continue;
        const g = String(p.getGameMode()).toLowerCase(); if (g === "spectator") continue;
        const l = p.location, o = last.get(p.id);
        last.set(p.id, { x: l.x, y: l.y, z: l.z });
        if (!o) continue;
        const dx = l.x - o.x, dy = l.y - o.y, dz = l.z - o.z;
        if (dx * dx + dy * dy + dz * dz < MOVE_MIN2) continue;               // standing still: no trail
        puff(p, t, viewersOf(p));
      } catch (e) { /* skip this player */ }
    }
  } catch (e) { console.warn("[cosmetics] trail: " + e); }
}, TRAIL_EVERY);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { last.delete(playerId); }); } catch (e) { /* ignore */ }
