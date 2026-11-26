// ===================================================================================================================
// JAVA COMBAT (attack cooldown, like Minecraft Java 1.9+)  -  no spam clicking
//
//   Every weapon needs time to "charge" after a hit (or after you switch to it), like in Java:
//     swords 1.6 hits / s (0.65 s) | gold / diamond / netherite axe 1.0 (1 s) | iron axe 0.9 (1.1 s) | wood / stone / copper
//     axe 0.8 (1.25 s) | trident 1.1 | mace 0.6 | pickaxes 1.2 | shovels 1.0 | hoes 1 - 4 | spears 0.9 - 1.5 | hand 4 / s
//   The damage of a hit depends on how charged the weapon was (the Owner's rules):
//     charged 100 %      = the full damage
//     charged 80 - 99 %  = only 10 % of the damage
//     charged 50 - 79 %  = only 5 % of the damage
//     less than 50 %     = NO damage and NO knockback (the hit is shown, nothing else)
//   (Bedrock gives the full damage first, then the missing part is given back at once to the one who was hit, and the
//    knockback is taken back by putting him where he stood.  Only a hit that already killed can't be given back.)
//   The indicator under the crosshair (8 pieces) fills while the weapon charges and disappears when it is ready - like
//   the Java sword icon.  It works with every scoreboard style (right / left panel: inside the board text, bottom line:
//   its own title).  Nothing else of the SMP pack changes.
// No lag: one small loop (every 2 ticks) only for players whose weapon is charging.
// ===================================================================================================================
import { world, system, GameMode } from "@minecraft/server";
import { setCharge } from "../hud.js";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { isOwner, slog } from "./staffcore.js";
import { opAlert } from "./opcore.js";
import { wfOn, wfMace, wfMult, wfSet, WF_STEPS } from "./windfix.js";

// ---------------------------------------------------------------- settings (Owner: /opr > Server & staff > Combat)
const REACHES = [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8];
const getW = (k, d) => { try { const v = world.getDynamicProperty(k); return v === undefined ? d : v; } catch (e) { return d; } };
const setW = (k, v) => { try { world.setDynamicProperty(k, v); } catch (e) { /* ignore */ } };
export const reachMax = () => { const v = Number(getW("jc:reach", 4)); return Number.isFinite(v) && v >= 3 ? v : 4; };
export const cooldownOn = () => getW("jc:cd", true) !== false;
export const reachOn = () => getW("jc:reachOn", true) !== false;
// charge speed: the time a weapon needs to charge, in % of the Java time (100 = Java, 50 = twice as fast, 200 = twice as slow)
const SPEEDS = [50, 60, 75, 100, 125, 150, 200];
export const chargePct = () => { const v = Number(getW("jc:speed", 100)); return SPEEDS.includes(v) ? v : 100; };
const alertsOn = () => getW("jc:alert", true) !== false;

// ticks for a full charge (Java attack speed: 20 / speed)
const FIXED = {
  "minecraft:wooden_sword": 13, "minecraft:stone_sword": 13, "minecraft:copper_sword": 13, "minecraft:iron_sword": 13, "minecraft:golden_sword": 13, "minecraft:diamond_sword": 13, "minecraft:netherite_sword": 13,
  "minecraft:golden_axe": 20, "minecraft:diamond_axe": 20, "minecraft:netherite_axe": 20, "minecraft:iron_axe": 22, "minecraft:wooden_axe": 25, "minecraft:stone_axe": 25, "minecraft:copper_axe": 25,
  "minecraft:trident": 18, "minecraft:mace": 33,
  "minecraft:wooden_hoe": 20, "minecraft:golden_hoe": 20, "minecraft:stone_hoe": 10, "minecraft:copper_hoe": 10, "minecraft:iron_hoe": 7, "minecraft:diamond_hoe": 5, "minecraft:netherite_hoe": 5,
  "minecraft:wooden_spear": 13, "minecraft:stone_spear": 15, "minecraft:copper_spear": 17, "minecraft:iron_spear": 19, "minecraft:golden_spear": 19, "minecraft:diamond_spear": 21, "minecraft:netherite_spear": 23,
};
const HAND = 5;                                                   // empty hand / any other item: 4 hits a second
// the cooldown can be switched off for ONE kind of weapon (the Owner): [key, name, icon]
export const KINDS = [["sword", "Swords", "textures/items/diamond_sword"], ["axe", "Axes", "textures/items/diamond_axe"], ["mace", "Mace", "textures/items/mace"], ["spear", "Spears", "textures/items/spear/iron_spear"],
  ["trident", "Trident", "textures/items/trident"], ["pickaxe", "Pickaxes", "textures/items/diamond_pickaxe"], ["shovel", "Shovels", "textures/items/diamond_shovel"], ["hoe", "Hoes", "textures/items/diamond_hoe"], ["hand", "Hand / other", "textures/ui/shop/ic_player"]];
const kindOf = (id) => { if (!id) return "hand"; const n = String(id).replace(/^.*:/, ""); if (n === "mace" || n === "trident") return n; for (const k of ["pickaxe", "shovel", "sword", "spear", "hoe", "axe"]) if (n.endsWith("_" + k)) return k; return "hand"; };
let offCache = null, offAt = -1;
export const kindsOff = () => { if (offAt !== system.currentTick) { offAt = system.currentTick; const v = getW("jc:off", "[]"); try { offCache = new Set(JSON.parse(v)); } catch (e) { offCache = new Set(); } } return offCache; };
export const setKindOff = (k, off) => { const s = new Set(kindsOff()); if (off) s.add(k); else s.delete(k); setW("jc:off", JSON.stringify([...s])); offAt = -1; };
const freeOf = (id) => kindsOff().has(kindOf(id));                // no cooldown for this weapon
function cooldownOf(id) { if (freeOf(id)) return 0; return cooldownBase(id); }
function cooldownBase(id) { const base = javaTicks(id); return base <= HAND ? base : Math.max(HAND + 1, Math.round((base * chargePct()) / 100)); }
function javaTicks(id) {
  if (!id) return HAND;
  const f = FIXED[id]; if (f) return f;
  if (id.endsWith("_pickaxe")) return 17;
  if (id.endsWith("_shovel")) return 20;
  if (id.endsWith("_sword")) return 13;
  if (id.endsWith("_axe")) return 22;
  return HAND;
}
const held = (p) => { try { return p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex)?.typeId ?? null; } catch (e) { return null; } };
const S = new Map();            // player id -> { last: tick of the last swing, prev: the one before, cd: ticks, slot, item }
const st = (p) => { let s = S.get(p.id); if (!s) { s = { last: -999, prev: -999, cd: HAND, slot: -1, item: null }; S.set(p.id, s); } return s; };
/** a swing (a hit on anything): the charge starts again */
function swing(p) { const s = st(p), t = system.currentTick; if (s.last !== t) { s.prev = s.last; s.last = t; } s.cd = cooldownOf(held(p)); }
const chargeAt = (s, since) => Math.max(0, Math.min(1, (system.currentTick - since) / Math.max(1, s.cd)));

// hits: every hit restarts the charge (also hits that do no damage, like on a shield or during the hurt time)
world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: a }) => { try { if (a?.typeId === "minecraft:player") swing(a); } catch (e) { /* ignore */ } });
world.afterEvents.entityHitBlock.subscribe(({ damagingEntity: a }) => { try { if (a?.typeId === "minecraft:player") swing(a); } catch (e) { /* ignore */ } });

// the damage: a hit before the weapon was charged hurts less (the missing part is given back)
world.afterEvents.entityHurt.subscribe(({ hurtEntity: v, damage, damageSource }) => {
  try {
    const a = damageSource?.damagingEntity;
    if (!a || a.typeId !== "minecraft:player" || damageSource.cause !== "entityAttack" || !(damage > 0)) return;
    let gm; try { gm = a.getGameMode(); } catch (e) { gm = null; } if (gm === GameMode.Creative || gm === "Creative" || gm === "creative") return;
    const s = st(a), t = system.currentTick;
    const since = s.last === t ? s.prev : s.last;                  // the hit event of this same tick may already have started a new charge
    if (s.last !== t) swing(a);
    // REACH: a hit from farther than the allowed reach counts for nothing (no damage, no knockback) - hacked reach
    const far = reachOn() ? reachOf(a, v) : 0;
    if (far > reachMax()) {
      const h0 = v.getComponent("minecraft:health"); if (h0 && h0.currentValue > 0) h0.setCurrentValue(Math.min(h0.effectiveMax, h0.currentValue + damage));
      noKnockback(v); reachFlag(a, v, far); return;
    }
    if (!cooldownOn() || freeOf(held(a))) return;
    const c = chargeAt(s, since), mult = c >= 0.999 ? 1 : c >= 0.8 ? 0.1 : c >= 0.5 ? 0.05 : 0;
    if (mult >= 1) return;
    const h = v.getComponent("minecraft:health"); if (!h || h.currentValue <= 0) return;
    h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + damage * (1 - mult)));
    if (c < 0.5) noKnockback(v);
  } catch (e) { /* ignore */ }
});

// the indicator: only for players whose weapon charges (switching the item in the hand starts the charge too, like Java)
system.runInterval(() => {
  const t = system.currentTick;
  for (const p of world.getAllPlayers()) {
    try {
      const s = st(p), slot = p.selectedSlotIndex, item = held(p);
      if (slot !== s.slot || item !== s.item) { const first = s.slot === -1; s.slot = slot; s.item = item; s.cd = cooldownOf(item); if (!first) { s.prev = s.last; s.last = t; } }
      const c = chargeAt(s, s.last);
      setCharge(p, !cooldownOn() || c >= 1 || s.cd <= HAND ? null : Math.floor(c * 8));
    } catch (e) { /* ignore */ }
  }
}, 2);
world.afterEvents.playerLeave.subscribe(({ playerId }) => { S.delete(playerId); POS.delete(playerId); });

// ---- no knockback for a hit under 50 %: the one who was hit is put back where he stood (players) / stopped (mobs)
const POS = new Map();                                            // player id -> { x, y, z } of the last ticks (only while someone fights)
let fightUntil = 0;
world.afterEvents.entityHitEntity.subscribe(() => { fightUntil = system.currentTick + 200; });
system.runInterval(() => {
  if (system.currentTick > fightUntil) { if (POS.size) POS.clear(); return; }
  for (const p of world.getAllPlayers()) { try { const l = p.location; POS.set(p.id, { x: l.x, y: l.y, z: l.z }); } catch (e) { /* ignore */ } }
}, 1);
function noKnockback(v) {
  try {
    if (v.typeId === "minecraft:player") {
      const at = POS.get(v.id); if (!at) return;
      const put = () => { try { v.teleport(at, { keepVelocity: false }); } catch (e) { /* ignore */ } };
      put(); system.run(put);                                      // twice: the knockback push can arrive one tick later
    } else { v.clearVelocity(); system.run(() => { try { v.clearVelocity(); } catch (e) { /* ignore */ } }); }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- REACH: the distance from the attacker's eyes to the body of the one he hit
//   measured to the nearest point of the body (a box around him: 0.3 to the side, his height up), and the best of this tick
//   and the last tick for both of them (moving players and the server's small delay never count against an honest player)
const HEIGHT = { "minecraft:player": 1.8, "minecraft:zombie": 1.95, "minecraft:skeleton": 1.99, "minecraft:creeper": 1.7, "minecraft:spider": 0.9, "minecraft:enderman": 2.9, "minecraft:iron_golem": 2.7, "minecraft:cow": 1.4, "minecraft:pig": 0.9, "minecraft:sheep": 1.3, "minecraft:chicken": 0.8, "minecraft:villager_v2": 1.9, "minecraft:slime": 2, "minecraft:magma_cube": 2, "minecraft:ghast": 4, "minecraft:wither": 3.5, "minecraft:ender_dragon": 8, "minecraft:ravager": 2.2, "minecraft:warden": 2.9 };
const HALF = { "minecraft:player": 0.3, "minecraft:spider": 0.7, "minecraft:iron_golem": 0.7, "minecraft:ghast": 2, "minecraft:slime": 1, "minecraft:magma_cube": 1, "minecraft:ravager": 1, "minecraft:ender_dragon": 4, "minecraft:wither": 0.5, "minecraft:cow": 0.45, "minecraft:warden": 0.45 };
function boxDist(eye, feet, half, height) {
  const dx = Math.max(0, Math.abs(eye.x - feet.x) - half), dz = Math.max(0, Math.abs(eye.z - feet.z) - half);
  const dy = eye.y < feet.y ? feet.y - eye.y : eye.y > feet.y + height ? eye.y - feet.y - height : 0;
  return Math.hypot(dx, dy, dz);
}
function reachOf(a, v) {
  try {
    const half = HALF[v.typeId] ?? 0.4, height = HEIGHT[v.typeId] ?? 1.8;
    const eyes = [a.getHeadLocation()], feets = [v.location];
    const pa = POS.get(a.id); if (pa) eyes.push({ x: pa.x, y: pa.y + 1.62, z: pa.z });
    if (v.typeId === "minecraft:player") { const pv = POS.get(v.id); if (pv) feets.push(pv); }
    let best = Infinity;
    for (const e of eyes) for (const f of feets) best = Math.min(best, boxDist(e, f, half, height));
    return best;
  } catch (e) { return 0; }
}
const flags = new Map();                                          // player id -> { n, t } (far hits of the last minute)
function reachFlag(a, v, far) {
  try {
    const now = Date.now(), r = flags.get(a.id) ?? { n: 0, t: now, told: 0 };
    if (now - r.t > 60000) { r.n = 0; r.t = now; }
    r.n++; flags.set(a.id, r);
    if (alertsOn() && r.n >= 3 && now - r.told > 60000) {
      r.told = now;
      opAlert("§c[Anti-cheat] §f" + a.name + " §chit from too far: §f" + far.toFixed(1) + " §cblocks (allowed " + reachMax() + ") §7- " + r.n + " times this minute §8(target: " + (v.typeId === "minecraft:player" ? v.name : v.typeId.replace("minecraft:", "")) + ")");
    }
  } catch (e) { /* ignore */ }
}
world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: a, hitEntity: v }) => {       // the positions are kept only while somebody fights
  try { if (a?.typeId === "minecraft:player") { fightUntil = system.currentTick + 200; const l = a.location; if (!POS.has(a.id)) POS.set(a.id, { x: l.x, y: l.y, z: l.z }); } } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------- the Owner's page
function windPage(player, back) {
  if (!isOwner(player)) return back();
  const self = () => windPage(player, back), on = wfOn(), m = wfMult(), mace = wfMace();
  const f = makeOpr("Wind charge", SHORT_ROWS); f.self = self; f.glass = true;
  const log = (t) => { try { slog(player, "combat", null, t); } catch (e) { /* ignore */ } };
  set(f, 0 * COLS + 4, hdr(1, "g") + "§b§lNetherite wind fix\n§r§7Netherite armour is pushed much less\n§r§7by a wind charge (knockback resistance).\n§r§7This gives the push back: it flies\n§r§7like diamond (3+ netherite pieces,\n§r§7no Blast Protection)", "textures/items/wind_charge", null);
  set(f, 2 * COLS + 2, hdr(1, on ? "g" : "r") + "§b§lWind fix: " + (on ? "§aON" : "§cOFF") + "\n§r§7OFF = the normal game (netherite\n§r§7flies low)\n§r§eClick to turn " + (on ? "OFF" : "ON"), "textures/items/wind_charge", { run: () => { wfSet.on(!on); log("wind fix " + (on ? "off" : "on")); self(); } });
  const nx = WF_STEPS[(WF_STEPS.indexOf(m) + 1) % WF_STEPS.length], pv = WF_STEPS[(WF_STEPS.indexOf(m) + WF_STEPS.length - 1) % WF_STEPS.length];
  set(f, 2 * COLS + 4, hdr(Math.max(1, Math.round(m * 10)), on ? "g" : "c") + "§e§lLaunch height: §f" + Math.round(m * 100) + " %" + (m === 1 ? " §7(like diamond)" : m > 1 ? " §a(higher)" : " §c(lower)") + "\n§r§7How high netherite players fly\n§r§7with a wind charge\n§r§eClick: " + Math.round(nx * 100) + " %", "textures/ui/shop/ic_confirm", { run: () => { wfSet.mult(nx); log("wind height " + Math.round(nx * 100) + "%"); self(); } });
  set(f, 2 * COLS + 3, hdr(1) + "§7§lLower: " + Math.round(pv * 100) + " %\n§r§eClick", "textures/ui/shop/ic_cancel", { run: () => { wfSet.mult(pv); log("wind height " + Math.round(pv * 100) + "%"); self(); } });
  set(f, 2 * COLS + 6, hdr(1, mace ? "g" : "r") + "§d§lMace Wind Burst: " + (mace ? "§aON" : "§cOFF") + "\n§r§7A mace smash with Wind Burst throws\n§r§7the netherite player up like diamond\n§r§eClick to turn " + (mace ? "OFF" : "ON"), "textures/items/mace", { run: () => { wfSet.mace(!mace); log("wind mace " + (mace ? "off" : "on")); self(); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
export function combatPage(player, back) {
  if (!isOwner(player)) return back();
  const self = () => combatPage(player, back), r = reachMax(), ro = reachOn(), cd = cooldownOn(), al = alertsOn(), sp = chargePct();
  const f = makeOpr("Combat", SHORT_ROWS); f.self = self; f.glass = true;
  const log = (t) => { try { slog(player, "combat", null, t); } catch (e) { /* ignore */ } };
  set(f, 0 * COLS + 4, hdr(1, "g") + "§c§lCombat\n§r§7Hit reach (anti-cheat) and the\n§r§7Java attack cooldown\n§r§7Normal survival reach: 3 blocks", "textures/items/diamond_sword", null);
  // row 1: the REACH limit (on / off + the distance)
  set(f, 1 * COLS + 2, hdr(1, ro ? "g" : "r") + "§e§lReach limit: " + (ro ? "§aON" : "§cOFF") + "\n§r§7ON = a hit from farther than the\n§r§7max reach counts for nothing\n§r§7OFF = every hit counts (game normal)\n§r§eClick to turn " + (ro ? "OFF" : "ON"), "textures/items/spyglass", { run: () => { setW("jc:reachOn", !ro); log("reach limit " + (!ro ? "on" : "off")); self(); } });
  set(f, 1 * COLS + 3, hdr(Math.round(r), ro ? "g" : "c") + "§e§lMax hit reach: §f" + r + " blocks\n§r§7Measured from the eyes to the body\n§r§7(4 is a good choice)\n§r§eClick: " + REACHES[(REACHES.indexOf(r) + 1) % REACHES.length] + " blocks", "textures/items/spyglass", { run: () => { const n = REACHES[(REACHES.indexOf(r) + 1) % REACHES.length]; setW("jc:reach", n); log("max reach " + n); self(); } });
  set(f, 1 * COLS + 5, hdr(1, al ? "g" : "r") + "§c§lReach alerts: " + (al ? "§aON" : "§cOFF") + "\n§r§7The staff is told when a player hits\n§r§7from too far 3 times in a minute\n§r§eClick to turn " + (al ? "OFF" : "ON"), "textures/ui/shop/ic_shield", { run: () => { setW("jc:alert", !al); self(); } });
  // row 2: the attack COOLDOWN (on / off + the charge speed)
  set(f, 2 * COLS + 2, hdr(1, cd ? "g" : "r") + "§b§lAttack cooldown: " + (cd ? "§aON" : "§cOFF") + "\n§r§7100 % charge = full damage, 80 % = 10 %,\n§r§750 % = 5 %, less = nothing\n§r§7+ the charge bar under the crosshair\n§r§7OFF = every hit full (game normal)\n§r§eClick to turn " + (cd ? "OFF" : "ON"), "textures/items/clock_item", { run: () => { setW("jc:cd", !cd); log("cooldown " + (!cd ? "on" : "off")); self(); } });
  const sword = Math.max(HAND + 1, Math.round((13 * sp) / 100)), axe = Math.max(HAND + 1, Math.round((20 * sp) / 100));
  const next = SPEEDS[(SPEEDS.indexOf(sp) + 1) % SPEEDS.length];
  set(f, 2 * COLS + 3, hdr(1, cd ? "g" : "c") + "§b§lCharge time: §f" + sp + " %" + (sp === 100 ? " §7(Java)" : sp < 100 ? " §a(faster)" : " §c(slower)") + "\n§r§7Sword: §f" + (sword / 20).toFixed(2) + " s §7| diamond axe: §f" + (axe / 20).toFixed(2) + " s\n§r§7Less = charges faster, more = slower\n§r§eClick: " + next + " %", "textures/items/clock_item", { run: () => { setW("jc:speed", next); for (const v of S.values()) v.cd = cooldownOf(v.item); log("charge time " + next + "%"); self(); } });
  // row 3: the cooldown for each kind of weapon (on / off)
  const off = kindsOff();
  KINDS.forEach(([k, name, icon], i) => {
    const on = !off.has(k);
    set(f, 3 * COLS + i, hdr(1, on ? "g" : "r") + "§f§l" + name + ": " + (on ? "§aON" : "§cOFF") + "\n§r§7The attack cooldown for this\n§r§7weapon only" + (on ? "" : "\n§r§7OFF = every hit full, no charge bar") + "\n§r§eClick to turn " + (on ? "OFF" : "ON"), icon, { run: () => { setKindOff(k, on); for (const v of S.values()) v.cd = cooldownOf(v.item); log("cooldown " + k + " " + (on ? "off" : "on")); self(); } });
  });
  set(f, 0 * COLS + 8, hdr(1, wfOn() ? "g" : "r") + "§b§lWind charge (netherite)\n§r§7Netherite flies like diamond with\n§r§7a wind charge / mace: " + (wfOn() ? "§aON" : "§cOFF") + "\n§r§7Height: §f" + Math.round(wfMult() * 100) + " %\n§r§eClick to open", "textures/items/wind_charge", { run: () => windPage(player, self) });
  set(f, 2 * COLS + 5, hdr(1) + "§7§lGood to know\n§r§7Both switches work at once for\n§r§7everybody. The values are saved\n§r§7in the world (a restart keeps them).", "textures/items/book_writable", null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
