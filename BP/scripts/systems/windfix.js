// ===================================================================================================================
// NETHERITE WIND FIX  (Owner: /opr > Server & staff > Combat > Wind charge)
//
// Netherite armour has knockback resistance, so a Wind Charge (and the Wind Burst of a mace) throws a player in
// netherite much LOWER than a player in diamond.  This gives the missing push back, so netherite flies like diamond.
// (Based on the idea of the "Netherite Armor Fix" pack: 3+ netherite pieces and no Blast Protection = the extra push.)
//   * ON / OFF
//   * Launch height: 50 % .. 300 % of the push (100 % = like diamond; more = higher, less = lower)
//   * Mace Wind Burst fix ON / OFF (the mace smash throws the netherite player up like diamond too)
// Saved in the world (a restart keeps it).  No lag: wind charges only when one explodes; the mace part follows the
// fall of the players (a few numbers per player) only while it is switched on.
// ===================================================================================================================
import { world, system, EquipmentSlot } from "@minecraft/server";

export const WF_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const getW = (k, d) => { try { const v = world.getDynamicProperty(k); return v === undefined ? d : v; } catch (e) { return d; } };
const setW = (k, v) => { try { world.setDynamicProperty(k, v); } catch (e) { /* ignore */ } };
export const wfOn = () => getW("wf:on", true) !== false;
export const wfMace = () => getW("wf:mace", true) !== false;
export const wfMult = () => { const v = Number(getW("wf:mult", 1)); return WF_STEPS.includes(v) ? v : 1; };
export const wfSet = { on: (v) => setW("wf:on", !!v), mace: (v) => setW("wf:mace", !!v), mult: (v) => setW("wf:mult", v) };

const SMASH_MIN_FALL = 1.5, WIND_BURST = [0, 1.47, 1.81, 2.15], GLIDE_MULT = 0.55, GLIDE_FALL_TICK = 0.5, GLIDE_GRACE = 2;
const WC_RADIUS = 2.45, WC_SIDE = 0.35, WC_UNDER = 0.6, SMASH_REACH = 5, STALE = 6, SCAN = 3, WATER_GRACE = 3, BURST_BONUS = 0.35;
const ARMOR = [[EquipmentSlot.Head, "minecraft:netherite_helmet"], [EquipmentSlot.Chest, "minecraft:netherite_chestplate"], [EquipmentSlot.Legs, "minecraft:netherite_leggings"], [EquipmentSlot.Feet, "minecraft:netherite_boots"]];
const fall = new Map(), targets = new Map();
let tick = 0;

const enchOf = (it) => { try { return it.getComponent("minecraft:enchantable")?.getEnchantments() ?? []; } catch (e) { return []; } };
/** 3+ netherite pieces and no Blast Protection */
function needsFix(p) {
  try {
    const eq = p.getComponent("minecraft:equippable"); if (!eq) return false;
    let n = 0;
    for (const [slot, id] of ARMOR) {
      const it = eq.getEquipment(slot); if (!it) continue;
      if (it.typeId === id) n++;
      if (enchOf(it).some((e) => e.type?.id === "blast_protection")) return false;
    }
    return n >= 3;
  } catch (e) { return false; }
}
const glide = (p, v) => (p.isGliding ? v * GLIDE_MULT : v);
function maceLevel(p) {
  try { const it = p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand); if (it?.typeId !== "minecraft:mace") return 0; return enchOf(it).find((e) => e.type?.id === "wind_burst")?.level ?? 0; } catch (e) { return 0; }
}
function smashLevel(p, tr) {
  if (!wfOn() || !wfMace() || p.isOnGround || !tr || tr.d < SMASH_MIN_FALL) return 0;
  const lv = maceLevel(p); if (!lv || !needsFix(p)) return 0;
  return lv;
}
function launch(p, lv) {
  const tr = fall.get(p.id); if (tr) { tr.d = 0; tr.slow = 0; }
  try {
    const v = p.getVelocity(); if (v.y !== 0) p.applyImpulse({ x: 0, y: -v.y, z: 0 });
    p.applyImpulse({ x: 0, y: glide(p, WIND_BURST[Math.min(3, lv)]) * (1 + (wfMult() - 1) * BURST_BONUS), z: 0 });
  } catch (e) { /* ignore */ }
}
function windCharge(dim, at, src) {
  if (!wfOn()) return;
  const m = wfMult();
  for (const p of dim.getEntities({ type: "minecraft:player", location: at, maxDistance: WC_RADIUS })) {
    try {
      if (!needsFix(p)) continue;
      const dx = p.location.x - at.x, dy = p.location.y - at.y, dz = p.location.z - at.z, dist = Math.hypot(dx, dy, dz);
      const fo = Math.max(0, 1 - dist / WC_RADIUS); if (fo <= 0) continue;
      const jump = p.isOnGround ? 0 : p.isInWater ? 0.14 : 0.19;
      const up = glide(p, (0.49 + jump) * fo) * m, side = up * WC_SIDE, hd = Math.hypot(dx, dz);
      let x = 0, z = 0;
      if (p.isSprinting || hd >= WC_UNDER) {
        if (p.isSprinting || src?.id === p.id) { const yaw = (p.getRotation().y * Math.PI) / 180; x = -Math.sin(yaw); z = Math.cos(yaw); }
        else if (hd > 0.1) { x = dx / hd; z = dz / hd; }
      }
      p.applyImpulse({ x: x * side, y: up, z: z * side });
    } catch (e) { /* ignore */ }
  }
}
const isWind = (e) => { try { return e?.typeId === "minecraft:wind_charge_projectile"; } catch (x) { return false; } };
world.afterEvents.projectileHitBlock.subscribe((ev) => { try { if (isWind(ev.projectile)) windCharge(ev.dimension, ev.location, ev.source); } catch (e) { /* ignore */ } });
world.afterEvents.projectileHitEntity.subscribe((ev) => { try { if (isWind(ev.projectile)) windCharge(ev.dimension, ev.location, ev.source); } catch (e) { /* ignore */ } });

// ---- the mace: follow the fall of every player (only while the fix + the mace part are on)
system.runInterval(() => {
  tick++;
  if (!wfOn() || !wfMace()) { if (fall.size) { fall.clear(); targets.clear(); } return; }
  try {
    for (const p of world.getAllPlayers()) {
      try {
        const y = p.location.y; let tr = fall.get(p.id);
        if (!tr) { fall.set(p.id, { y, d: 0, slow: 0, water: 0 }); continue; }
        if (p.isOnGround || p.isClimbing) { tr.d = 0; tr.slow = 0; tr.water = 0; }
        else if (p.isInWater) { if (++tr.water > WATER_GRACE) { tr.d = 0; tr.slow = 0; } }
        else if (p.isGliding) { tr.water = 0; const dr = tr.y - y; if (dr >= GLIDE_FALL_TICK) { tr.d += dr; tr.slow = 0; } else if (++tr.slow >= GLIDE_GRACE) tr.d = 1; }
        else { tr.water = 0; const dr = tr.y - y; if (dr > 0) tr.d += dr; tr.slow = 0; }
        tr.y = y;
        if (tick % SCAN === 0 && smashLevel(p, tr)) {
          for (const e of p.dimension.getEntities({ location: p.location, maxDistance: SMASH_REACH })) {
            const t = e.typeId; if (t === "minecraft:armor_stand" || t.includes("_boat") || t.includes("_raft") || t.includes("minecart")) targets.set(e.id, { l: e.location, t: tick });
          }
        }
      } catch (e) { /* one player never stops the others */ }
    }
    for (const [id, v] of targets) if (tick - v.t > STALE) targets.delete(id);
  } catch (e) { /* ignore */ }
}, 1);
world.afterEvents.playerLeave.subscribe(({ playerId }) => { fall.delete(playerId); });
// a smash that connects (also on a shield) throws the netherite player up
world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: p }) => {
  try { if (p?.typeId !== "minecraft:player") return; const lv = smashLevel(p, fall.get(p.id)); if (lv) launch(p, lv); } catch (e) { /* ignore */ }
});
// a smash that breaks an armour stand / boat / minecart at once
world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  try {
    const tr = targets.get(removedEntityId); targets.delete(removedEntityId);
    if (!tr || tick - tr.t > STALE) return;
    let best = null, bl = 0, bd = Infinity;
    for (const p of world.getAllPlayers()) {
      const lv = smashLevel(p, fall.get(p.id)); if (!lv) continue;
      const d = (p.location.x - tr.l.x) ** 2 + (p.location.y - tr.l.y) ** 2 + (p.location.z - tr.l.z) ** 2;
      if (d > SMASH_REACH * SMASH_REACH || d >= bd) continue;
      best = p; bl = lv; bd = d;
    }
    if (best) launch(best, bl);
  } catch (e) { /* ignore */ }
});
