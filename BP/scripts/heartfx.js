// Heart effects (visual only - nothing here hurts anybody).  The Heart item looks normal, but
//   * it glows red when it is USED                                     (useBurst)
//   * it leaves a trail of red energy while it FLIES (thrown / dropped)
//   * lying on the GROUND it slowly turns evil, in 3 stages:
//       0 - first 20 s : a red heartbeat glint  ("Heart Energy")
//       1 - 20 - 50 s  : black smoke + sinister particles + a red shockwave every few seconds ("Cursed Aura", "Dark Pulse")
//       2 - after 60 s : the Heart SPOILS: the item becomes the "Heart of Malevolence" (dark cracked heart), a ring of corruption is drawn around it,
//                        dark tendrils creep over the ground and grow with time ("Shadow Thorns", "Corruption Ring")
//   * a small countdown (m:ss) floats above it: the time left until it explodes (yellow, orange under 1:30, red under 0:30)
//   * after 3 minutes on the ground it EXPLODES (no damage, no block damage) and disappears
//   * a spoiled (dark) Heart that is picked up becomes a HALF Heart (heartids.js)
//   * when it DISAPPEARS (nobody picked it up) it ends with a final burst and leaves a dark mark that lingers a few seconds ("Lingering Curse")
//   * a normal Heart that is picked up stays a Heart; a dark Heart in a player's inventory turns into a Half Heart
//   * Heart loss log (heartloss.js): a Heart with a buyer tag that is DESTROYED (explodes / burns / vanishes without a player taking it), and a full Heart of
//     a buyer that becomes a Half Heart, are written to /shop > Hearts > Logs > Hearts Destroyed.  Nothing about the effects or the rules changes.
import { world, system, ItemStack } from "@minecraft/server";
import { invWatch } from "./systems/invwatch.js";
import { fx } from "./lux.js";
import { HEART_ITEM, HALF_ITEM, CURSED_ITEM, isHeart, makeHalfStack, copyBuyer, buyerOf } from "./heartids.js";
import { logLoss, dimCodeOf, KIND_DESTROYED, KIND_HALVED } from "./heartloss.js";
import { takePickupCredit, settlingNear } from "./heartpickup.js";

const RED = { r: 1, g: 0.12, b: 0.12 }, DARK = { r: 0.16, g: 0.02, b: 0.06 }, BLOOD = { r: 0.7, g: 0.04, b: 0.1 };
const STAGE1 = 20, STAGE2 = 60, EXPLODE = 180;                // seconds on the ground: aura / the Heart spoils (dark form) / it explodes and disappears
const DIMS = ["overworld", "nether", "the_end"];
const sfx = (dim, id, loc, volume, pitch) => { try { dim.playSound(id, loc, { volume, pitch }); } catch (e) { /* ignore */ } };
const ember = (dim, loc, o) => fx(dim, "smp:dark_ember", loc, { count: 4, rx: 0.4, ry: 0.4, rz: 0.4, speed: 0.4, rise: 0.4, size: 0.1, life: 1.4, ...DARK, ...o });
const ring = (dim, loc, size, life, c) => fx(dim, "lux:ring_y", { x: loc.x, y: loc.y + 0.08, z: loc.z }, { size, life, ...c });
const glint = (dim, loc, n, c, o = {}) => fx(dim, "lux:spark", loc, { count: n, radius: o.radius ?? 0.25, speed: o.speed ?? 0.8, life: o.life ?? 0.9, size: o.size ?? 0.12, ...c });

/** the player USES a Heart: a red energy wave */
export function useBurst(p) {
  try {
    const l = p.location, dim = p.dimension;
    ring(dim, { x: l.x, y: l.y, z: l.z }, 4.5, 1.1, RED);
    system.runTimeout(() => ring(dim, { x: l.x, y: l.y, z: l.z }, 6.5, 1.3, BLOOD), 4);
    fx(dim, "lux:column", { x: l.x, y: l.y + 0.1, z: l.z }, { count: 22, radius: 0.6, speed: 2.4, life: 1.0, size: 0.16, ...RED });
    glint(dim, { x: l.x, y: l.y + 1, z: l.z }, 16, RED, { radius: 0.5, speed: 1.6, size: 0.14 });
    sfx(dim, "mob.warden.heartbeat", l, 0.7, 1.0);
  } catch (e) { /* ignore */ }
}

/** the player BUYS a Heart: the Totem of Undying effect (the green / yellow totem particles swirling up around him + the totem sound) */
export function buyTotem(p) {
  try {
    const dim = p.dimension, l = p.location;
    sfx(dim, "random.totem", l, 1, 1);
    for (let wave = 0; wave < 6; wave++) {
      system.runTimeout(() => {
        try {
          const pl = p.location;
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 0.9;
            dim.spawnParticle("minecraft:totem_particle", { x: pl.x + Math.cos(a) * r, y: pl.y + 0.2 + Math.random() * 1.7, z: pl.z + Math.sin(a) * r });
          }
        } catch (e) { /* ignore */ }
      }, wave * 3);
    }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- items on the ground
const items = new Map();        // entity id -> { dim, loc, t0, cursed, n (loop counter), tendrils: [angle ...] }
// when each Heart on the ground was first seen (saved, so a restart / unloaded chunk does not give it a new life)
const T0_KEY = "smp_hfx_t0";
let saved = null, dirty = false;
function loadT0() {
  if (saved) return saved;
  saved = {}; try { const raw = world.getDynamicProperty(T0_KEY); if (typeof raw === "string") saved = JSON.parse(raw); } catch (e) { saved = {}; }
  const now = Date.now(); for (const k in saved) if (now - saved[k] > 900000) { delete saved[k]; dirty = true; }
  return saved;
}
function flushT0() { if (!dirty) return; dirty = false; try { world.setDynamicProperty(T0_KEY, Object.keys(saved).length ? JSON.stringify(saved) : undefined); } catch (e) { /* ignore */ } }
const marks = [];               // lingering dark marks: { dim, loc, until }
const at = (e) => { const l = e.location; return { x: l.x, y: l.y, z: l.z }; };

// ---------------------------------------------------------------- Heart loss log (heartloss.js)
// A Heart item that is gone is NOT always destroyed: a player may have picked it up, it may have merged into a bigger stack next to it, or a hopper /
// portal / fox may have taken it.  Only when none of these is the case it is written to the log - and only about 1.5 s after it vanished, so the pickup
// log (heartpickup.js, checks every 4 ticks) has time to see a pickup.
const SETTLE_MS = 1500;
const hints = new Map();          // item entity id -> { cause, t }: what hurt the item entity last (entityHurt)
const pending = [];               // vanished Hearts waiting for the verdict
const HURT = { lava: "lava", fire: "fire", fireTick: "fire", campfire: "fire", soulCampfire: "fire", contact: "cactus", blockExplosion: "boom", entityExplosion: "boom", void: "void", lightning: "lightning" };
try {
  world.afterEvents.entityHurt.subscribe((ev) => {
    try {
      const e = ev.hurtEntity; if (!e || e.typeId !== "minecraft:item") return;
      const cause = HURT[ev.damageSource?.cause]; if (cause) hints.set(e.id, { cause, t: Date.now() });
    } catch (x) { /* ignore */ }
  });
} catch (e) { console.warn("[heartfx] cannot watch item damage: " + e); }

const typeAt = (dim, x, y, z) => { try { const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); return b ? b.typeId : ""; } catch (e) { return ""; } };
/** true when the item was taken by something that is not a destruction: a portal, a hopper, a hopper minecart, a fox / allay */
function takenAway(dim, loc) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (/portal|end_gateway/.test(typeAt(dim, loc.x + dx, loc.y + dy, loc.z + dz))) return true;
  }
  for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 0; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (typeAt(dim, loc.x + dx, loc.y + dy, loc.z + dz) === "minecraft:hopper") return true;
  }
  try { for (const m of dim.getEntities({ location: loc, maxDistance: 2.5 })) if (/hopper_minecart|:fox$|:allay$/.test(m.typeId)) return true; } catch (e) { /* ignore */ }
  return false;
}
/** why the item was destroyed: a code of heartloss.js CAUSES ("gone" = nobody picked it up and the cause can't be told) */
function causeOf(id, st, now) {
  const hint = hints.get(id); hints.delete(id);
  if (hint && now - hint.t < 15000) return hint.cause;
  const dim = st.dim, l = st.loc, here = typeAt(dim, l.x, l.y, l.z), below = typeAt(dim, l.x, l.y - 1, l.z);
  if (/lava/.test(here) || /lava/.test(below)) return "lava";
  if (/^minecraft:(soul_)?fire$/.test(here)) return "fire";
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (typeAt(dim, l.x + dx, l.y, l.z + dz) === "minecraft:cactus") return "cactus";
  if ((st.vy ?? 0) < -0.15) {                                 // it was falling: into lava, or out of the world?
    let minY = -64; try { minY = dim.heightRange.min; } catch (e) { /* ignore */ }
    const bottom = Math.max(minY - 4, Math.floor(l.y) - 60);
    for (let y = Math.floor(l.y) - 1; y >= bottom; y--) {
      let b = null; try { b = dim.getBlock({ x: Math.floor(l.x), y, z: Math.floor(l.z) }); } catch (e) { return "gone"; }
      if (!b) return "gone";
      try { if (b.isAir) continue; return /lava/.test(b.typeId) ? "lava" : "gone"; } catch (e) { return "gone"; }
    }
    return bottom <= minY - 4 ? "void" : "gone";
  }
  return "gone";
}
/** a Heart item with a buyer tag vanished from the ground */
function noteGone(id, st, grown, now) {
  try {
    if (!st.bid || st.bid === "-" || !(st.amt > 0)) return;      // no buyer tag: it can't be linked to a buyer
    let amt = st.amt;
    for (const g of grown) {                                      // merged into a bigger stack lying next to it
      if (amt <= 0) break;
      if (g.inc <= 0 || g.bid !== st.bid || g.dn !== st.dn) continue;
      if (Math.hypot(g.loc.x - st.loc.x, g.loc.y - st.loc.y, g.loc.z - st.loc.z) > 4) continue;
      const k = Math.min(amt, g.inc); amt -= k; g.inc -= k;
    }
    if (amt <= 0 || takenAway(st.dim, st.loc)) return;
    pending.push({ st: { bid: st.bid, bnm: st.bnm, type: st.type, loc: st.loc, dim: st.dim, t0: st.t0, seenAt: st.seenAt }, amt, cause: causeOf(id, st, now), due: now + SETTLE_MS });
  } catch (e) { console.warn("[heartfx] gone: " + e); }
}
/** the verdict about the vanished Hearts: a pickup that the pickup log saw is not a loss; the rest is written to the log */
function settle(now) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const q = pending[i]; if (now < q.due) continue;
    pending.splice(i, 1);
    try {
      const dim = dimCodeOf(q.st.dim);
      const amt = q.amt - takePickupCredit(q.st.bid, dim, q.st.loc, q.st.seenAt - 300, q.amt, now);
      if (amt <= 0) continue;                                      // a player took it
      if (q.cause === "gone" && settlingNear(dim, q.st.loc, q.st.seenAt)) continue;       // a player who had just joined / respawned stood next to it: a pickup may not have been seen
      logLoss({ kind: KIND_DESTROYED, type: q.st.type, amount: amt, cause: q.cause, bid: q.st.bid, bnm: q.st.bnm, loc: q.st.loc, dim, age: Math.round((q.st.seenAt - q.st.t0) / 1000) });
    } catch (e) { console.warn("[heartfx] loss: " + e); }
  }
  for (const [k, h] of hints) if (now - h.t > 30000) hints.delete(k);
}

// ---------------------------------------------------------------- the heartbeat of a Heart lying on the ground
// Starts when the Heart begins to turn evil (STAGE1) and gets LOUDER and FASTER the closer it is to exploding (EXPLODE):
//   volume 1.0 -> 2.5 (it was 0.35 / 0.5)      time between two beats 3.0 s -> 0.55 s      pitch 0.9 -> 1.2
const BEAT_SLOW = 3.0, BEAT_FAST = 0.55, BEAT_VOL0 = 1.0, BEAT_VOL1 = 2.5;
system.runInterval(() => {
  const now = Date.now();
  for (const st of items.values()) {
    try {
      if (st.moving || !st.loc || !st.dim) continue;
      const age = (now - st.t0) / 1000; if (age < STAGE1 || age >= EXPLODE) continue;
      if (st.nextBeat != null && now < st.nextBeat) continue;
      const k = Math.min(1, (age - STAGE1) / (EXPLODE - STAGE1));        // 0 = just started, 1 = about to explode
      sfx(st.dim, "mob.warden.heartbeat", st.loc, BEAT_VOL0 + (BEAT_VOL1 - BEAT_VOL0) * k, 0.9 + 0.3 * k);
      st.nextBeat = now + (BEAT_SLOW + (BEAT_FAST - BEAT_SLOW) * k) * 1000;
    } catch (e) { /* ignore */ }
  }
}, 2);

// ---------------------------------------------------------------- countdown above the Heart (floating text: time left until it explodes)
// The text is an invisible "shop:holo" entity (always shows its name, same one the holograms use) that FOLLOWS the Heart item every tick,
// so the timer stays fixed above it wherever the item goes (thrown, falling, pushed by water ...).  A name tag on the item itself is not always drawn.
const LABEL_TYPE = "shop:holo", LABEL_TAG = "heart_cd", LABEL_UP = 0.35;
const okEnt = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (x) { return false; } };
/** 135 -> "2:15" */
const clock = (sec) => Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
function dropLabel(st) {
  try { if (st && st.label && okEnt(st.label)) st.label.remove(); } catch (x) { /* ignore */ }
  if (st) { st.label = null; st.tagText = null; }
}
function countdown(e, st, age) {
  try {
    const left = Math.max(0, Math.ceil(EXPLODE - age));
    const text = (left <= 30 ? "\u00a7c\u00a7l" : left <= 90 ? "\u00a76\u00a7l" : "\u00a7e\u00a7l") + clock(left);
    st.ent = e;
    if (!okEnt(st.label)) {                                  // first time (or the label was lost): make it
      const l = e.location;
      st.label = e.dimension.spawnEntity(LABEL_TYPE, { x: l.x, y: l.y + LABEL_UP, z: l.z });
      try { st.label.addTag(LABEL_TAG); } catch (x) { /* ignore */ }
      st.tagText = null;
    }
    if (st.tagText !== text) { st.label.nameTag = text; st.tagText = text; }
  } catch (x) { /* ignore */ }
}
// the label follows its item every tick
system.runInterval(() => {
  for (const st of items.values()) {
    try {
      if (!st.label || !st.ent) continue;
      if (!okEnt(st.ent)) continue;
      if (!okEnt(st.label)) { st.label = null; continue; }
      const l = st.ent.location;
      st.label.teleport({ x: l.x, y: l.y + LABEL_UP, z: l.z });
    } catch (x) { /* ignore */ }
  }
}, 1);
// leftover labels (server stopped / chunk was unloaded while one existed) are removed; a Heart that is still there gets a new one
const sweepLabels = () => {
  for (const dn of DIMS) {
    try { for (const e of world.getDimension(dn).getEntities({ type: LABEL_TYPE, tags: [LABEL_TAG] })) { let mine = false; for (const st of items.values()) if (st.label === e) mine = true; if (!mine) e.remove(); } } catch (x) { /* ignore */ }
  }
};
try { system.runTimeout(sweepLabels, 40); } catch (x) { /* ignore */ }
try { system.runInterval(sweepLabels, 1200); } catch (x) { /* ignore */ }
try { world.afterEvents.entityLoad.subscribe((ev) => { try { const e = ev.entity; if (e.typeId === LABEL_TYPE && e.hasTag(LABEL_TAG)) { for (const st of items.values()) if (st.label === e) return; e.remove(); } } catch (x) { /* ignore */ } }); } catch (x) { /* ignore */ }

function stageOf(age) { return age >= STAGE2 ? 2 : age >= STAGE1 ? 1 : 0; }

function explode(e, st, loc) {                               // 3 minutes on the ground: it blows up (effects only) and is gone
  const dim = e.dimension;
  try { if (st.bid && st.bid !== "-" && st.amt > 0) logLoss({ kind: KIND_DESTROYED, type: st.type, amount: st.amt, cause: "ex", bid: st.bid, bnm: st.bnm, loc, dim: dimCodeOf(dim), age: Math.round((Date.now() - st.t0) / 1000) }); } catch (x) { /* ignore */ }
  dropLabel(st);
  items.delete(e.id); if (saved) { delete saved[e.id]; dirty = true; }
  try { e.remove(); } catch (x) { /* ignore */ }
  ring(dim, loc, 8, 1.3, RED);
  system.runTimeout(() => ring(dim, loc, 11, 1.6, BLOOD), 3);
  fx(dim, "lux:column", { x: loc.x, y: loc.y + 0.1, z: loc.z }, { count: 40, radius: 0.7, speed: 3.2, life: 1.2, size: 0.2, ...RED });
  glint(dim, { x: loc.x, y: loc.y + 0.4, z: loc.z }, 30, RED, { radius: 0.6, speed: 2.6, size: 0.16 });
  ember(dim, { x: loc.x, y: loc.y + 0.4, z: loc.z }, { count: 24, rx: 0.8, ry: 0.6, rz: 0.8, speed: 1.2, rise: 0.8, size: 0.16, life: 2.0 });
  try { dim.spawnParticle("minecraft:huge_explosion_emitter", loc); } catch (x) { /* not in this version */ }
  sfx(dim, "random.explode", loc, 0.8, 1.2);
  marks.push({ dim, loc, until: Date.now() + 8000, r: 2.4 });
}

function curse(e, st) {                                      // the item turns into the Heart of Malevolence (same item count, same use)
  try {
    const it = e.getComponent("minecraft:item")?.itemStack; if (!it || it.typeId !== HEART_ITEM) return e;
    const dim = e.dimension, loc = at(e), n = new ItemStack(CURSED_ITEM, it.amount);
    n.setLore(it.getLore()); copyBuyer(it, n);                   // the buyer tag goes with it
    items.delete(e.id); if (saved) { delete saved[e.id]; }
    const ne = dim.spawnItem(n, loc);
    if (saved) { saved[ne.id] = st.t0; dirty = true; }
    try { ne.clearVelocity(); } catch (x) { /* ignore */ }
    e.remove();
    items.set(ne.id, { ...st, cursed: true, type: CURSED_ITEM, ent: ne });
    ring(dim, loc, 7, 1.4, BLOOD); sfx(dim, "mob.wither.spawn", loc, 0.25, 1.6);
    return ne;
  } catch (x) { return e; }
}

function tendrils(dim, st, loc, age) {                       // dark roots creeping over the ground, longer with time
  const reach = Math.min(4.5, 1.2 + (age - STAGE2) / 18);
  if (st.tendrils.length < 6 && Math.random() < 0.35) st.tendrils.push(Math.random() * Math.PI * 2);
  for (const a0 of st.tendrils) {
    let a = a0;
    for (let d = 0.35, k = 0; d <= reach; d += 0.45, k++) {
      a += (Math.sin(k * 1.7 + a0 * 3) * 0.28);                // the root bends
      const x = loc.x + Math.cos(a) * d, z = loc.z + Math.sin(a) * d, p = { x, y: loc.y + 0.06, z };
      ember(dim, p, { count: 1, rx: 0.06, ry: 0.02, rz: 0.06, speed: 0.05, rise: 0.05, size: 0.09, life: 1.6 });
      if (k % 3 === 2) glint(dim, p, 1, BLOOD, { radius: 0.05, speed: 0.1, size: 0.07, life: 1.0 });       // glowing cracks in the roots
    }
  }
}

function tick() {
  const seen = new Set(), now = Date.now(), grown = [];     // grown: stacks that got bigger since the last look (something merged into them)
  for (const dn of DIMS) {
    let dim; try { dim = world.getDimension(dn); } catch (e) { continue; }
    let list = []; try { list = dim.getEntities({ type: "minecraft:item" }); } catch (e) { continue; }
    for (let e of list) {
      let id, stack; try { stack = e.getComponent("minecraft:item")?.itemStack; id = stack?.typeId; } catch (x) { continue; }
      if (!isHeart(id)) continue;
      let st = items.get(e.id);
      if (!st) {
        const sv = loadT0(); let t0 = sv[e.id];
        if (!t0) { t0 = id === CURSED_ITEM ? now - STAGE2 * 1000 : now; sv[e.id] = t0; dirty = true; }
        st = { dim, loc: at(e), t0, cursed: id === CURSED_ITEM, n: 0, tendrils: [] }; items.set(e.id, st);
      }
      seen.add(e.id); st.dim = dim; st.n++;
      let loc = at(e); st.loc = loc;
      try {                                                                 // what the loss log needs to know about this item (buyer tag, amount, type)
        const tg = buyerOf(stack), amt = stack.amount;
        if (st.amt != null && amt > st.amt) grown.push({ bid: tg ? tg.id : "-", dn, inc: amt - st.amt, loc });
        st.bid = tg ? tg.id : "-"; st.bnm = tg ? tg.name : ""; st.amt = amt; st.type = id; st.seenAt = now; st.dn = dn;
      } catch (x) { /* ignore */ }
      const age = (now - st.t0) / 1000, stage = id === HALF_ITEM ? Math.min(stageOf(age), 1) : stageOf(age);
      if (age >= EXPLODE) { explode(e, st, loc); continue; }
      countdown(e, st, age);
      let v = { x: 0, y: 0, z: 0 }; try { v = e.getVelocity(); } catch (x) { /* ignore */ }
      st.vy = v.y; st.moving = Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.12;
      if (st.moving) {          // flying: a trail of red energy
        glint(dim, loc, 3, RED, { radius: 0.12, speed: 0.3, size: 0.1, life: 0.7 });
        ember(dim, loc, { count: 2, rx: 0.1, ry: 0.1, rz: 0.1, speed: 0.1, rise: 0.1, size: 0.08, life: 1.0, ...BLOOD });
        continue;
      }
      if (stage >= 2 && !st.cursed && id === HEART_ITEM) { e = curse(e, st); if (!seen.has(e.id)) seen.add(e.id); st = items.get(e.id) ?? st; st.cursed = true; loc = at(e); }
      const c = { x: loc.x, y: loc.y + 0.3, z: loc.z };
      if (stage === 0) {                                                    // Heart Energy: a slow red heartbeat
        if (st.n % 2 === 0) glint(dim, c, 2, RED, { radius: 0.2, speed: 0.5, size: 0.1 });
        if (st.n % 6 === 0) ring(dim, loc, 1.4, 0.9, RED);
      } else if (stage === 1) {                                             // Cursed Aura + Dark Pulse
        ember(dim, c, { count: 5, rx: 0.35, ry: 0.3, rz: 0.35, speed: 0.35, rise: 0.5, size: 0.12, life: 1.7 });
        glint(dim, c, 2, BLOOD, { radius: 0.3, speed: 0.6, size: 0.11 });
        if (st.n % 6 === 0) ring(dim, loc, 3.4, 1.2, RED);
      } else {                                                              // Corruption Ring + Shadow Thorns + stronger pulse
        ember(dim, c, { count: 8, rx: 0.45, ry: 0.4, rz: 0.45, speed: 0.45, rise: 0.7, size: 0.14, life: 2.0 });
        glint(dim, c, 3, RED, { radius: 0.35, speed: 0.7, size: 0.12 });
        if (st.n % 2 === 0) for (let i = 0; i < 14; i++) {                  // the ring of corruption: a circle of glowing points
          const a = (i / 14) * Math.PI * 2 + st.n * 0.05, R = 2.4;
          glint(dim, { x: loc.x + Math.cos(a) * R, y: loc.y + 0.08, z: loc.z + Math.sin(a) * R }, 1, BLOOD, { radius: 0.04, speed: 0.1, size: 0.09, life: 1.0 });
        }
        if (st.n % 4 === 0) tendrils(dim, st, loc, age);
        if (st.n % 5 === 0) ring(dim, loc, 5.2, 1.4, RED);
      }
    }
  }
  // items that are gone: picked up (a player stood next to it) or vanished (despawn) -> final burst + lingering mark
  for (const [id, st] of items) {
    if (seen.has(id)) continue;
    let loaded = true; try { loaded = !!st.dim.getBlock(st.loc); } catch (e) { loaded = false; }
    if (!loaded) continue;                                   // its chunk is just not loaded: it still exists, keep its age
    dropLabel(st);
    items.delete(id); if (saved) { delete saved[id]; dirty = true; }
    noteGone(id, st, grown, now);                            // a destroyed Heart goes to the loss log (a pickup / merge / hopper does not)
    let picked = false;
    try { for (const p of st.dim.getPlayers({ location: st.loc, maxDistance: 3.5 })) { picked = true; break; } } catch (e) { /* ignore */ }
    if (picked) { glint(st.dim, st.loc, 8, RED, { radius: 0.3, speed: 1.2 }); continue; }
    const age = (now - st.t0) / 1000;
    ring(st.dim, st.loc, 6, 1.2, RED);
    fx(st.dim, "lux:column", { x: st.loc.x, y: st.loc.y + 0.1, z: st.loc.z }, { count: 26, radius: 0.5, speed: 2.4, life: 1.1, size: 0.16, ...RED });
    glint(st.dim, st.loc, 18, RED, { radius: 0.4, speed: 1.8 });
    sfx(st.dim, "mob.wither.break_block", st.loc, 0.4, 1.4);
    if (age >= STAGE1) marks.push({ dim: st.dim, loc: st.loc, until: now + 8000, r: age >= STAGE2 ? 2.4 : 1.4 });      // Lingering Curse
  }
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]; if (now >= m.until) { marks.splice(i, 1); continue; }
    for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * m.r; ember(m.dim, { x: m.loc.x + Math.cos(a) * d, y: m.loc.y + 0.1, z: m.loc.z + Math.sin(a) * d }, { count: 1, rx: 0.05, ry: 0.05, rz: 0.05, speed: 0.1, rise: 0.4, size: 0.1, life: 1.4 }); }
  }
  settle(now);
}
system.runInterval(() => { try { tick(); flushT0(); } catch (e) { console.warn("[heartfx] " + e); } }, 10);

// a dark Heart in a player's inventory (picked up) has spoiled: it becomes a Half Heart
const spoilWatch = invWatch(3);     // performance: only inventories that changed (and every inventory at least every 3 s)
system.runInterval(() => {
  spoilWatch.next();
  const list = world.getAllPlayers();
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    try {
      if (!spoilWatch.need(p, k)) continue;
      const c = p.getComponent("inventory").container;
      for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i); if (!s || s.typeId !== CURSED_ITEM) continue;
        const tg = buyerOf(s), amount = s.amount;
        c.setItem(i, copyBuyer(s, makeHalfStack(s.amount)));
        // a full Heart of its buyer became a Half Heart (loss log)
        if (tg) logLoss({ kind: KIND_HALVED, type: CURSED_ITEM, amount, cause: "spoil", bid: tg.id, bnm: tg.name, loc: p.location, dim: dimCodeOf(p.dimension), hid: p.id, hnm: p.name });
      }
    } catch (e) { /* ignore */ }
  }
}, 20);
