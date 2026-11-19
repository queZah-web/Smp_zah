// LAND PROTECTION - the guard. Inside a protected area only the owner and the players the owner allowed can break, place, open or hit anything.
// Strangers cannot: break blocks, place blocks (also from outside onto the border), open chests / doors / use buttons, use buckets / fire / pistons near the border,
// touch armor stands / frames / animals / villagers / boats, blow things up (explosions never damage protected blocks), use Timber / Vein / Area mining into it,
// and they cannot hurt the owner or allowed players. The owner and allowed players CAN hit strangers.
// Several independent layers are used on purpose, so one missing game feature can never open a hole.
import { world, system } from "@minecraft/server";
import { allClaims, claimAt, isMember, bypass, isLocked, canEdit, canEditBlock, timeLeft, dur } from "./landcore.js";
import { luxProtect } from "../lux.js";
import { menuMsg } from "./menulang.js";

const FACE = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
const alive = (p) => { try { return typeof p.isValid === "function" ? p.isValid() : !!p.isValid; } catch (e) { return false; } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[land] " + name + " not started: " + e); } };
// a stranger = not the land owner, not allowed, and not allowed to bypass.  A land LOCKED by the Owner has no bypass for anybody except the Owner (not even Admins with "landadmin").
const stranger = (c, p) => !isMember(c, p) && !bypass(c, p);

// ---------------------------------------------------------------- "you can't do that here" message (max once per 2 s per player)
const lastMsg = new Map();
function deny(p, c, what) {
  system.run(() => {
    try {
      const now = Date.now(); if (now - (lastMsg.get(p.id) ?? 0) < 2000) return; lastMsg.set(p.id, now);
      p.sendMessage(menuMsg(p, "§c[Protection] " + what + " §7- protected land of §f" + c.on + " §7(" + c.n + ")"));
      luxProtect("deny", p.dimension, p.location, p);
    } catch (e) { /* ignore */ }
  });
}
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastMsg.delete(playerId); cur.delete(playerId); }));

// ---------------------------------------------------------------- blocks: break
safe("break", () => world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const b = ev.block, c = claimAt(b.dimension.id, b.x, b.y, b.z);
  if (c && stranger(c, ev.player)) { ev.cancel = true; deny(ev.player, c, "You can't break blocks here."); }
}));

// ---------------------------------------------------------------- blocks: place / open / use (+ dangerous items close to the border)
// liquids FLOW: water / lava placed OUTSIDE (and above, any height) runs into the land, so they are checked as a COLUMN (see nearStrangerColumn)
const LIQUID = /^(?!milk_bucket$)(.+_bucket|dispenser|dropper)$/;
const FLUID_OR_FIRE = /^(flint_and_steel|fire_charge|tnt|tnt_minecart)$/;
const PISTON = /^(piston|sticky_piston)$/;
const MARGIN = 8, PISTON_MARGIN = 13, FLOW_MARGIN = 10;          // water runs 7 blocks sideways, lava 3 (7 in the Nether)
function nearStranger(p, dimId, x, y, z, m) {                 // a claim (that p may not use) within m blocks of this spot
  for (const c of allClaims()) {
    if (c.d !== dimId || !stranger(c, p)) continue;
    if (x >= c.x1 - m && x <= c.x2 + m && y >= c.y1 - m && y <= c.y2 + m && z >= c.z1 - m && z <= c.z2 + m) return c;
  }
  return null;
}
/** a claim (that p may not use) whose COLUMN is under this spot: within m blocks sideways and at ANY height above its floor - a stream placed high above still falls in */
function nearStrangerColumn(p, dimId, x, y, z, m) {
  for (const c of allClaims()) {
    if (c.d !== dimId || !stranger(c, p)) continue;
    if (x >= c.x1 - m && x <= c.x2 + m && z >= c.z1 - m && z <= c.z2 + m && y >= c.y1 - 2) return c;
  }
  return null;
}
safe("interact", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player;
  const b = ev.block, d = b.dimension.id, f = FACE[String(ev.blockFace)] ?? [0, 0, 0];
  const px = b.x + f[0], py = b.y + f[1], pz = b.z + f[2];       // where a placed block / liquid / fire would go
  let c = claimAt(d, b.x, b.y, b.z) ?? claimAt(d, px, py, pz);
  if (c && stranger(c, p)) { ev.cancel = true; return deny(p, c, "You can't build or use things here."); }
  const item = ev.itemStack?.typeId?.replace("minecraft:", "");
  if (!item) return;
  if (LIQUID.test(item)) c = nearStrangerColumn(p, d, px, py, pz, FLOW_MARGIN);
  else if (FLUID_OR_FIRE.test(item)) c = nearStranger(p, d, px, py, pz, MARGIN);
  else if (PISTON.test(item)) c = nearStranger(p, d, px, py, pz, PISTON_MARGIN);
  else return;
  if (c) { ev.cancel = true; deny(p, c, "You can't use this item so close to protected land."); }
}));
// backup: if a block still got placed inside protected land (some other game version / feature), take it away again
safe("place backup", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    if (canEditBlock(player, block)) return;
    const c = claimAt(block.dimension.id, block.x, block.y, block.z);
    system.run(() => { try { block.setType("minecraft:air"); } catch (e) { /* ignore */ } });
    if (c) deny(player, c, "You can't build here.");
  } catch (e) { /* ignore */ }
}));
// beta/new game versions only: stop the placement itself
safe("place (new api)", () => { const ev = world.beforeEvents.playerPlaceBlock; if (!ev) return; ev.subscribe((e) => {
  const b = e.block, c = claimAt(b.dimension.id, b.x, b.y, b.z);
  if (c && stranger(c, e.player)) { e.cancel = true; deny(e.player, c, "You can't build here."); }
}); });

// ---------------------------------------------------------------- entities: armor stands, frames, animals, villagers, boats ...
safe("entity interact", () => world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target; if (!t || t.typeId === "minecraft:player") return;
  const l = t.location, c = claimAt(t.dimension.id, l.x, l.y, l.z);
  if (c && stranger(c, ev.player)) { ev.cancel = true; deny(ev.player, c, "You can't touch this here."); }
}));

// ---------------------------------------------------------------- explosions never destroy protected blocks
safe("explosion", () => world.beforeEvents.explosion.subscribe((ev) => {
  const all = ev.getImpactedBlocks(), d = ev.dimension.id, keep = all.filter((b) => !claimAt(d, b.x, b.y, b.z));
  if (keep.length !== all.length) ev.setImpactedBlocks(keep);
}));

// ---------------------------------------------------------------- hurting: strangers can't hurt the owner / allowed players / things inside protected land
function attackerOf(src) {
  try {
    const a = src?.damagingEntity;
    if (a?.typeId === "minecraft:player") return a;
    const o = src?.damagingProjectile?.getComponent("minecraft:projectile")?.owner;
    return o?.typeId === "minecraft:player" ? o : null;
  } catch (e) { return null; }
}
/** the claim that protects `victim` from `attacker`, or null */
function shield(victim, attacker) {
  if (!attacker || attacker.id === victim.id) return null;
  const l = victim.location, c = claimAt(victim.dimension.id, l.x, l.y, l.z);
  if (!c || !stranger(c, attacker)) return null;
  if (victim.typeId === "minecraft:player") return isMember(c, victim) ? c : null;      // owner / allowed players are protected, strangers vs strangers is normal PvP
  return c;                                                                              // animals, frames, stands, villagers... inside the land
}
safe("hurt (before)", () => { const ev = world.beforeEvents.entityHurt; if (!ev) return; ev.subscribe((e) => {
  const a = attackerOf(e.damageSource), c = shield(e.hurtEntity, a);
  if (c) { e.cancel = true; deny(a, c, "You can't hurt anything here."); }
}); });
safe("hurt (after)", () => world.afterEvents.entityHurt.subscribe((ev) => {      // backup: give the health back
  const a = attackerOf(ev.damageSource), v = ev.hurtEntity, c = shield(v, a);
  if (!c) return;
  try { const h = v.getComponent("minecraft:health"); if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + ev.damage)); } catch (e) { /* ignore */ }
  deny(a, c, "You can't hurt anything here.");
}));

// ---------------------------------------------------------------- 0.5-second loop: effects + "you entered" message
//  * a stranger inside protected land gets Weakness (his hits do no damage - also to animals / villagers)
//  * the owner / allowed players inside, while a stranger is inside or near the border, get full damage resistance (arrows from outside, etc.)
const cur = new Map();             // player id -> claim id they stand in
const enterAt = new Map();
const NEAR = 12;
function strangerNear(c, players) {
  for (const o of players) {
    if (o.dimension.id !== c.d || !stranger(c, o)) continue;
    const l = o.location;
    if (l.x >= c.x1 - NEAR && l.x <= c.x2 + 1 + NEAR && l.y >= c.y1 - NEAR && l.y <= c.y2 + 1 + NEAR && l.z >= c.z1 - NEAR && l.z <= c.z2 + 1 + NEAR) return true;
  }
  return false;
}
system.runInterval(() => {
  let players; try { players = world.getAllPlayers(); } catch (e) { return; }
  for (const p of players) {
    try {
      const l = p.location, c = claimAt(p.dimension.id, l.x, l.y + 0.1, l.z);
      const prev = cur.get(p.id) ?? null;
      if (!c) { if (prev) cur.delete(p.id); continue; }
      if (stranger(c, p)) p.addEffect("weakness", 40, { amplifier: 255, showParticles: false });
      else if (strangerNear(c, players)) p.addEffect("resistance", 40, { amplifier: 4, showParticles: false });
      if (prev !== c.id) {
        cur.set(p.id, c.id);
        const now = Date.now(); if (now - (enterAt.get(p.id) ?? 0) < 1500) continue; enterAt.set(p.id, now);
        if (c.o === p.id) p.sendMessage(menuMsg(p, "§a[Protection] §f" + c.n + " §7- your land §8| §7time left: §f" + dur(timeLeft(c))));
        else if (isMember(c, p)) p.sendMessage(menuMsg(p, "§a[Protection] You are allowed on §f" + c.on + "§a's land §7(" + c.n + ")"));
        else if (stranger(c, p)) p.sendMessage(menuMsg(p, "§c[Protection] Protected land of §f" + c.on + " §7(" + c.n + ") §8- §cyou can't build, break, open things or fight here." + (isLocked(c) ? " §6[Locked by the Owner]" : "")));
      }
    } catch (e) { /* ignore this player this time */ }
  }
}, 10);

// ---------------------------------------------------------------- border outline (only the viewer sees it)
/** draws the edges of a claim for `seconds` seconds, only for player p */
export function showBorders(p, c, seconds = 12) {
  const x1 = c.x1, y1 = c.y1, z1 = c.z1, x2 = c.x2 + 1, y2 = c.y2 + 1, z2 = c.z2 + 1, step = 2, pts = [];
  const line = (ax, ay, az, bx, by, bz) => {
    const n = Math.max(1, Math.round(Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az)) / step));
    for (let i = 0; i <= n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n, z: az + ((bz - az) * i) / n });
  };
  for (const y of [y1, y2]) { line(x1, y, z1, x2, y, z1); line(x2, y, z1, x2, y, z2); line(x2, y, z2, x1, y, z2); line(x1, y, z2, x1, y, z1); }
  for (const [x, z] of [[x1, z1], [x2, z1], [x2, z2], [x1, z2]]) line(x, y1, z, x, y2, z);
  let left = Math.ceil((seconds * 20) / 15);
  const h = system.runInterval(() => {
    try {
      if (left-- <= 0 || !alive(p)) return system.clearRun(h);
      if (p.dimension.id !== c.d) return;
      const l = p.location;
      for (const q of pts) if (Math.abs(q.x - l.x) < 56 && Math.abs(q.y - l.y) < 56 && Math.abs(q.z - l.z) < 56) p.spawnParticle("minecraft:endrod", q);
    } catch (e) { system.clearRun(h); }
  }, 15);
}
