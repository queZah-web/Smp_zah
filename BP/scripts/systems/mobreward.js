// MOB REWARDS: killing a mob pays a little money, scaled to how dangerous the mob is (a chicken pays $1, a Zombie $8, a Blaze $16, a Warden $500).
//   * Admins / Owner switch it ON / OFF (permission "mobmoney": Operator > Server & staff > Mob rewards, or /mobmoney on|off).  Default = ON.
//   * Only a PLAYER in Survival mode who kills the mob himself (sword, bow, trident ...) is paid. Pets, TNT, lava, fall damage, creative = nothing.
//   * No reward for: baby mobs, tamed pets, named mobs (name-tag farms), villagers, iron / snow golems, players.
//   * Anti farm: one player can earn at most HOURLY_CAP per hour from mobs (bosses are always paid in full).
// The numbers are in REWARDS below (money per kill) - edit them freely.
// Everything is wrapped in try/catch: a problem here can never stop the other systems.
import { world, system, GameMode } from "@minecraft/server";
import { addMoney } from "../data.js";
import { money } from "../format.js";
import { slog } from "./staffcore.js";

export const HOURLY_CAP = 6000;                  // most one player can earn from mobs in one hour
const BOSS_FROM = 150;                           // a reward this big ignores the hourly cap
const UNKNOWN_HOSTILE = 5;                       // a hostile mob that is not in the list below
const PROP = "mobrew:v1";

// id (without "minecraft:") -> [name, money per kill]
export const REWARDS = {
  // farm animals + small things
  chicken: ["Chicken", 1], rabbit: ["Rabbit", 1], cod: ["Cod", 1], salmon: ["Salmon", 1], tropical_fish: ["Tropical Fish", 1], bat: ["Bat", 1],
  cow: ["Cow", 2], pig: ["Pig", 2], sheep: ["Sheep", 2], squid: ["Squid", 2], pufferfish: ["Pufferfish", 2], turtle: ["Turtle", 2], fox: ["Fox", 2], frog: ["Frog", 2], bee: ["Bee", 2], armadillo: ["Armadillo", 2],
  mooshroom: ["Mooshroom", 3], horse: ["Horse", 3], donkey: ["Donkey", 3], mule: ["Mule", 3], llama: ["Llama", 3], trader_llama: ["Trader Llama", 3], panda: ["Panda", 3], goat: ["Goat", 3], glow_squid: ["Glow Squid", 3], axolotl: ["Axolotl", 3], dolphin: ["Dolphin", 3],
  camel: ["Camel", 4], wolf: ["Wolf", 4], strider: ["Strider", 4], polar_bear: ["Polar Bear", 6], sniffer: ["Sniffer", 8],
  // weak hostile
  slime: ["Slime", 3], magma_cube: ["Magma Cube", 4], silverfish: ["Silverfish", 5], endermite: ["Endermite", 6], vex: ["Vex", 6],
  zombie: ["Zombie", 8], skeleton: ["Skeleton", 8], spider: ["Spider", 8], husk: ["Husk", 9], drowned: ["Drowned", 9], stray: ["Stray", 9], cave_spider: ["Cave Spider", 9], zombie_villager: ["Zombie Villager", 9],
  creeper: ["Creeper", 10], bogged: ["Bogged", 10], zombie_pigman: ["Zombified Piglin", 10], zombified_piglin: ["Zombified Piglin", 10], piglin: ["Piglin", 10],
  // stronger hostile
  pillager: ["Pillager", 12], witch: ["Witch", 14], vindicator: ["Vindicator", 14], phantom: ["Phantom", 14], guardian: ["Guardian", 15],
  blaze: ["Blaze", 16], hoglin: ["Hoglin", 18], zoglin: ["Zoglin", 18], enderman: ["Enderman", 20], wither_skeleton: ["Wither Skeleton", 20], shulker: ["Shulker", 20],
  evoker: ["Evoker", 22], ghast: ["Ghast", 22], breeze: ["Breeze", 24], creaking: ["Creaking", 26], piglin_brute: ["Piglin Brute", 28], ravager: ["Ravager", 40],
  // bosses
  elder_guardian: ["Elder Guardian", 150], warden: ["Warden", 500], wither: ["Wither", 1500], ender_dragon: ["Ender Dragon", 2500],
};
const NEVER = new Set(["player", "villager", "villager_v2", "wandering_trader", "iron_golem", "snow_golem", "allay", "cat", "ocelot", "parrot", "skeleton_horse", "zombie_horse", "armor_stand", "npc", "agent", "shop:holo"]);

// ------------------------------------------------------------------ saved state { on, paid, kills }
let st = null;
function load() {
  if (st) return st;
  try {
    const raw = world.getDynamicProperty(PROP), o = typeof raw === "string" ? JSON.parse(raw) : {};
    st = { on: o.on !== false, paid: Number(o.paid) || 0, kills: Number(o.kills) || 0 };
  } catch (e) { return null; }
  return st;
}
let dirty = false;
const save = () => { try { world.setDynamicProperty(PROP, JSON.stringify(st)); dirty = false; return true; } catch (e) { console.warn("[mobreward] save failed: " + e); return false; } };
export const mobRewardOn = () => { const s = load(); return !!(s && s.on); };
export const mobRewardStats = () => { const s = load(); return s ? { ...s } : { on: true, paid: 0, kills: 0 }; };
/** Owner / Admin (checked by the caller with allow(p, "mobmoney")).  Returns { ok, on } or { err } */
export function setMobReward(actor, on) {
  try {
    const s = load(); if (!s) return { err: "Could not read the settings." };
    const old = s.on; s.on = !!on;
    if (!save()) { s.on = old; return { err: "Could not save." }; }
    slog(actor, "mobmoney", null, on ? "mob rewards ON" : "mob rewards OFF");
    try { world.sendMessage("§6[Mobs] §fMob kill rewards are now " + (on ? "§aON" : "§cOFF") + "§f."); } catch (e) { /* ignore */ }
    return { ok: true, on: s.on };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** the table for the menu: [{ id, name, money }] biggest first (one line per name) */
export function rewardTable() {
  const seen = new Set(), out = [];
  for (const [id, [name, m]] of Object.entries(REWARDS)) { if (seen.has(name)) continue; seen.add(name); out.push({ id, name, money: m }); }
  return out.sort((a, b) => b.money - a.money || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ paying
const hour = new Map();                                    // player id -> { start, total }
function rewardOf(dead) {
  const id = String(dead.typeId).replace("minecraft:", "");
  if (NEVER.has(id)) return 0;
  const r = REWARDS[id];
  if (r) return r[1];
  try { const f = dead.getComponent("minecraft:type_family"); if (f && f.hasTypeFamily("monster")) return UNKNOWN_HOSTILE; } catch (e) { /* ignore */ }
  return 0;
}
function pay(p, dead, amount) {
  const now = Date.now();
  let h = hour.get(p.id);
  if (!h || now - h.start > 3600000) { h = { start: now, total: 0 }; hour.set(p.id, h); }
  let give = amount;
  if (amount < BOSS_FROM) {
    if (h.total >= HOURLY_CAP) { if (!h.warned) { h.warned = true; try { p.sendMessage("§6[Mobs] §7You reached the mob reward limit for this hour (§f" + money(HOURLY_CAP) + "§7). It resets in §f" + Math.ceil((3600000 - (now - h.start)) / 60000) + " min§7."); } catch (e) { /* ignore */ } } return; }
    give = Math.min(amount, HOURLY_CAP - h.total);
    h.total += give;
  }
  addMoney(p, give);
  const s = load(); if (s) { s.paid += give; s.kills += 1; dirty = true; }
  const name = (REWARDS[String(dead.typeId).replace("minecraft:", "")] ?? [String(dead.typeId).replace("minecraft:", "").replace(/_/g, " ")])[0];
  try { p.onScreenDisplay.setActionBar("§a+" + money(give) + " §7" + name); } catch (e) { /* ignore */ }
  if (give >= BOSS_FROM) { try { p.sendMessage("§6[Mobs] §fYou killed a §e" + name + " §fand got §a" + money(give) + "§f!"); } catch (e) { /* ignore */ } }
}

try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      if (!mobRewardOn()) return;
      const dead = ev.deadEntity, killer = ev.damageSource?.damagingEntity;
      if (!killer || killer.typeId !== "minecraft:player" || dead.id === killer.id) return;
      if (killer.getGameMode() !== GameMode.Survival) return;
      const amount = rewardOf(dead); if (amount <= 0) return;
      try { if (dead.nameTag) return; } catch (e) { /* ignore */ }                         // named mobs
      try { if (dead.getComponent("minecraft:is_baby")) return; } catch (e) { /* ignore */ }
      try { if (dead.getComponent("minecraft:is_tamed")) return; } catch (e) { /* ignore */ }
      pay(killer, dead, amount);
    } catch (e) { console.warn("[mobreward] " + e); }
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { hour.delete(playerId); });
  system.runInterval(() => { if (dirty && st) save(); }, 1200);
} catch (e) { console.warn("[mobreward] not started: " + e); }
