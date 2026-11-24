// ===================================================================================================================
// JAVA COMBAT (attack cooldown, like Minecraft Java 1.9+)  -  no spam clicking
//
//   Every weapon needs time to "charge" after a hit (or after you switch to it), like in Java:
//     swords 1.6 hits / s (0.65 s) | gold / diamond / netherite axe 1.0 (1 s) | iron axe 0.9 (1.1 s) | wood / stone / copper
//     axe 0.8 (1.25 s) | trident 1.1 | mace 0.6 | pickaxes 1.2 | shovels 1.0 | hoes 1 - 4 | spears 0.9 - 1.5 | hand 4 / s
//   The damage of a hit depends on how charged the weapon was (Java formula):  damage x (0.2 + 0.8 x charge²)
//     full = 100 %,  half = 40 %,  spam clicking = 20 %.  (Bedrock gives the full damage first, then the missing part
//     is given back at once to the one who was hit.  Only a hit that already killed can't be given back.)
//   The indicator under the crosshair (8 pieces) fills while the weapon charges and disappears when it is ready - like
//   the Java sword icon.  It works with every scoreboard style (right / left panel: inside the board text, bottom line:
//   its own title).  Nothing else of the SMP pack changes.
// No lag: one small loop (every 2 ticks) only for players whose weapon is charging.
// ===================================================================================================================
import { world, system, GameMode } from "@minecraft/server";
import { setCharge } from "../hud.js";

// ticks for a full charge (Java attack speed: 20 / speed)
const FIXED = {
  "minecraft:wooden_sword": 13, "minecraft:stone_sword": 13, "minecraft:copper_sword": 13, "minecraft:iron_sword": 13, "minecraft:golden_sword": 13, "minecraft:diamond_sword": 13, "minecraft:netherite_sword": 13,
  "minecraft:golden_axe": 20, "minecraft:diamond_axe": 20, "minecraft:netherite_axe": 20, "minecraft:iron_axe": 22, "minecraft:wooden_axe": 25, "minecraft:stone_axe": 25, "minecraft:copper_axe": 25,
  "minecraft:trident": 18, "minecraft:mace": 33,
  "minecraft:wooden_hoe": 20, "minecraft:golden_hoe": 20, "minecraft:stone_hoe": 10, "minecraft:copper_hoe": 10, "minecraft:iron_hoe": 7, "minecraft:diamond_hoe": 5, "minecraft:netherite_hoe": 5,
  "minecraft:wooden_spear": 13, "minecraft:stone_spear": 15, "minecraft:copper_spear": 17, "minecraft:iron_spear": 19, "minecraft:golden_spear": 19, "minecraft:diamond_spear": 21, "minecraft:netherite_spear": 23,
};
const HAND = 5;                                                   // empty hand / any other item: 4 hits a second
function cooldownOf(id) {
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
    const c = chargeAt(s, since), mult = 0.2 + 0.8 * c * c;
    if (s.last !== t) swing(a);
    if (mult >= 0.999) return;
    const h = v.getComponent("minecraft:health"); if (!h || h.currentValue <= 0) return;
    h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + damage * (1 - mult)));
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
      setCharge(p, c >= 1 || s.cd <= HAND ? null : Math.floor(c * 8));
    } catch (e) { /* ignore */ }
  }
}, 2);
world.afterEvents.playerLeave.subscribe(({ playerId }) => S.delete(playerId));
