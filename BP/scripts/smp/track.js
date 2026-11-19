// Statistics tracking: blocks broken / placed, mobs killed, shop transactions.
import { world, GameMode } from "@minecraft/server";
import { ex } from "./store.js";
import { onTx } from "../data.js";
import { realOf } from "../systems/axrids.js";

const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[smp] cannot track " + name + ": " + e); } };

// anti-farm: a block you placed yourself does not count as "broken" when you break it again
// (remembers the last PLACED_CAP blocks per player)
const PLACED_CAP = 400;
const recent = new Map();                                    // player id -> Set of "dim,x,y,z"
const keyOf = (b) => b.dimension.id + "," + b.x + "," + b.y + "," + b.z;

/** counts a natural ore (also the extra blocks of Vein Miner, see skills.js skillExtra); hidden Anti X-Ray ores count as the real ore */
export function countOre(player, typeId) {
  const id = realOf(typeId ?? "").replace("minecraft:", "");
  if (!/(?:_ore|^ancient_debris)$/.test(id)) return;
  const st = ex(player).st;
  st.ores += 1;
  if (id.endsWith("diamond_ore")) st.diamond += 1;
  else if (id.endsWith("emerald_ore")) st.emerald += 1;
  else if (id === "ancient_debris") st.debris += 1;
}

safe("blocks placed", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  ex(player).st.placed += 1;
  let set = recent.get(player.id); if (!set) { set = new Set(); recent.set(player.id, set); }
  set.add(keyOf(block));
  if (set.size > PLACED_CAP) set.delete(set.values().next().value);
}));

safe("blocks broken", () => world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation }) => {
  const set = recent.get(player.id), k = keyOf(block);
  if (set && set.has(k)) { set.delete(k); return; }
  ex(player).st.broken += 1;
  safe("ores", () => { if (player.getGameMode() === GameMode.Survival) countOre(player, brokenBlockPermutation.type.id); });
}));

safe("player leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => recent.delete(playerId)));

// mobs killed by players (player vs player is already counted by the shop system as "kills")
const NOT_A_MOB = /armor_stand|minecart|boat|painting|item_frame|ender_crystal|npc|agent|balloon|leash|xp_orb|tripod/;
safe("mob kills", () => world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  if (dead.typeId === "minecraft:player" || NOT_A_MOB.test(dead.typeId)) return;
  const killer = ev.damageSource?.damagingEntity;
  if (!killer || killer.typeId !== "minecraft:player") return;
  ex(killer).st.mobs += 1;
}));

// shop transactions (data.js calls these hooks from addTx)
onTx((p, rec) => {
  const st = ex(p).st;
  st.trades += 1;
  if (rec.type === "buy") st.bought += rec.qty; else if (rec.type === "sell") st.sold += rec.qty;
});
