// ===================================================================================================================
// COMBAT: REACH LIMIT (anti reach-hack)  +  the netherite wind fix page  (Owner: /opr > Server & staff > Combat)
//   * a melee hit from farther than the max reach (default 4 blocks, measured from the eyes to the nearest point of the
//     body, best of this tick and the last one) counts for NOTHING: the damage is given back, the knockback undone
//   * 3 far hits in a minute = an alert to the staff
//   (The Java attack cooldown was removed completely: every hit counts like normal Bedrock.)
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { isOwner, slog } from "./staffcore.js";
import { opAlert } from "./opcore.js";
import { wfOn, wfMace, wfMult, wfSet, WF_STEPS } from "./windfix.js";

// ---------------------------------------------------------------- settings (Owner: /opr > Server & staff > Combat)
const REACHES = [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8];
const getW = (k, d) => { try { const v = world.getDynamicProperty(k); return v === undefined ? d : v; } catch (e) { return d; } };
const setW = (k, v) => { try { world.setDynamicProperty(k, v); } catch (e) { /* ignore */ } };
export const reachMax = () => { const v = Number(getW("jc:reach", 4)); return Number.isFinite(v) && v >= 3 ? v : 4; };
export const reachOn = () => getW("jc:reachOn", true) !== false;
const alertsOn = () => getW("jc:alert", true) !== false;

// the hit: from too far = nothing
world.afterEvents.entityHurt.subscribe(({ hurtEntity: v, damage, damageSource }) => {
  try {
    const a = damageSource?.damagingEntity;
    if (!a || a.typeId !== "minecraft:player" || damageSource.cause !== "entityAttack" || !(damage > 0) || !reachOn()) return;
    let gm; try { gm = String(a.getGameMode()).toLowerCase(); } catch (e) { gm = null; } if (gm === "creative") return;
    const far = reachOf(a, v);
    if (far > reachMax()) {
      const h0 = v.getComponent("minecraft:health"); if (h0 && h0.currentValue > 0) h0.setCurrentValue(Math.min(h0.effectiveMax, h0.currentValue + damage));
      noKnockback(v); reachFlag(a, v, far);
    }
  } catch (e) { /* ignore */ }
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => { POS.delete(playerId); });

// ---- no knockback for a far hit: the one who was hit is put back where he stood (players) / stopped (mobs)
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
  const self = () => combatPage(player, back), r = reachMax(), ro = reachOn(), al = alertsOn();
  const f = makeOpr("Combat", SHORT_ROWS); f.self = self; f.glass = true;
  const log = (t) => { try { slog(player, "combat", null, t); } catch (e) { /* ignore */ } };
  set(f, 0 * COLS + 4, hdr(1, "g") + "§c§lCombat\n§r§7Hit reach (anti-cheat) and the\n§r§7netherite wind fix\n§r§7Normal survival reach: 3 blocks", "textures/items/diamond_sword", null);
  // row 1: the REACH limit (on / off + the distance)
  set(f, 1 * COLS + 2, hdr(1, ro ? "g" : "r") + "§e§lReach limit: " + (ro ? "§aON" : "§cOFF") + "\n§r§7ON = a hit from farther than the\n§r§7max reach counts for nothing\n§r§7OFF = every hit counts (game normal)\n§r§eClick to turn " + (ro ? "OFF" : "ON"), "textures/items/spyglass", { run: () => { setW("jc:reachOn", !ro); log("reach limit " + (!ro ? "on" : "off")); self(); } });
  set(f, 1 * COLS + 3, hdr(Math.round(r), ro ? "g" : "c") + "§e§lMax hit reach: §f" + r + " blocks\n§r§7Measured from the eyes to the body\n§r§7(4 is a good choice)\n§r§eClick: " + REACHES[(REACHES.indexOf(r) + 1) % REACHES.length] + " blocks", "textures/items/spyglass", { run: () => { const n = REACHES[(REACHES.indexOf(r) + 1) % REACHES.length]; setW("jc:reach", n); log("max reach " + n); self(); } });
  set(f, 1 * COLS + 5, hdr(1, al ? "g" : "r") + "§c§lReach alerts: " + (al ? "§aON" : "§cOFF") + "\n§r§7The staff is told when a player hits\n§r§7from too far 3 times in a minute\n§r§eClick to turn " + (al ? "OFF" : "ON"), "textures/ui/shop/ic_shield", { run: () => { setW("jc:alert", !al); self(); } });
  set(f, 0 * COLS + 8, hdr(1, wfOn() ? "g" : "r") + "§b§lWind charge (netherite)\n§r§7Netherite flies like diamond with\n§r§7a wind charge / mace: " + (wfOn() ? "§aON" : "§cOFF") + "\n§r§7Height: §f" + Math.round(wfMult() * 100) + " %\n§r§eClick to open", "textures/items/wind_charge", { run: () => windPage(player, self) });
  set(f, 2 * COLS + 4, hdr(1) + "§7§lGood to know\n§r§7The switches work at once for\n§r§7everybody. The values are saved\n§r§7in the world (a restart keeps them).", "textures/items/book_writable", null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
