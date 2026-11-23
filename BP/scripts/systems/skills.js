// Skill levels (Mining, Woodcutting, Excavation, Farming) - level 0 -> 999.
//
//  * Every real block you break (survival mode) counts as 1 "break" for a skill:
//      Mining      NATURAL hard blocks broken with a pickaxe (stone, ores, deepslate, netherrack, end stone ...) - NOT leaves / grass / plants
//      Woodcutting logs / wood / stems / hyphae (stripped too) - with ANY tool, also by hand
//      Excavation  dirt / grass / sand / gravel / clay / mud / snow ... - with ANY tool, also by hand
//      Farming     FULLY GROWN wheat / carrots / potatoes / beetroot / nether wart / cocoa, melon / pumpkin / sugar cane,
//                  and FEEDING animals (cow, sheep, pig, chicken, horse ... the food must really be used up)
//    Blocks you placed yourself never count (anti farm). Every block broken by Vein Miner / Timber / Area Mining counts one by one.
//  * Level 1 = 20 breaks, level 2 = 40 more, 3 = 60, 4 = 80, 5 = 100, then +10 per level (L6 = 110, L7 = 120, L8 = 130 ...).
//  * Every level gives money: $10 at level 1, growing evenly to $100 at level 100, then $100 per level up to 250 (see levelMoney / rewardFor).
//  * Every skill has TWO stages:  stage 1 = level 0 -> 125,  stage 2 = level 126 -> 250 (the maximum).
//    At level 125 the skill stops (xp is frozen) until the player pays UNLOCK_COST ($300,000) for THAT skill in /menu -> Skills.
//  * Every 25 levels you earn 1 speed point. Hold a tool of that skill and spend it (/menu -> Skills):
//    that ONE tool gets +5% mining speed (max +25% per tool, stacks with Efficiency). It is written on the tool as a lore line.
//    Stage 1 (5 points) = ONE tool up to +25%.  After paying, stage 2 (5 more points, levels 150 -> 250) = a SECOND tool up to +25%.
//    Real speed = the Haste effect pulsed on/off while the tool is in your hand (Bedrock cannot change vanilla tool speed).
//  * Flying (elytra): 1 point per 20 blocks flown while gliding. Every 50 levels you unlock +5% elytra speed (max +25%).
//    From level 50 the Skills menu has an Elytra Speed button: turn it on/off and pick any unlocked speed.
//  * Combat: killing monsters gives 1 - 10 points (stronger / armed / armoured monsters give more).
//    Every 50 levels = +5% damage (max +25%).
//  * Fishing: every fish / junk / treasure you reel in = 1 point (treasure = 3). Every 50 levels +5% chance of a DOUBLE catch (fish only), max +25%.
//  * Trading: trades with villagers (1 - 5 points, bigger emerald trades give more). Perks only for those who reached the level:
//      level 50 = shop prices -5%,  level 100 = -10% (max)   |   level 150 = sell prices +5%,  level 200 = +10% (max).
//    Safety: prices only change for money, shop buy/sell can never loop into profit (see priceperks.js).
//  * The skill bar shows in the action bar ONLY while you are gaining skill xp.
import { world, system, GameMode, ItemStack } from "@minecraft/server";
import { addMoney, addShards, takeMoney, stats, addTx } from "../data.js";
import { num, money } from "../format.js";
import { ex } from "../smp/store.js";
import { countOre } from "../smp/track.js";
import { notify } from "../smp/notify.js";
import { updateHud } from "../hud.js";
import { formBusy, combatBusy, skillBusy } from "../state.js";
import { clanView } from "./clanstate.js";
import { menuMsg } from "./menulang.js";
import { VALUE_RE, valueLine } from "../value.js";

// ---------------------------------------------------------------- settings you can edit
export const MAX_LEVEL = 250;
export const GATE_LEVEL = 125;                            // every skill stops here until the player pays (stage 1 ends)
export const UNLOCK_COST = 300000;                        // $ to unlock levels 126 -> 250 of ONE skill
export const UNLOCK_COSTS = {};                           // optional price per skill, e.g. { fly: 500000 }  (anything not listed uses UNLOCK_COST)
export const unlockCost = (key) => UNLOCK_COSTS[key] ?? UNLOCK_COST;
export const SPEED = { every: 25, step: 5, max: 25 };     // every 25 levels -> 1 point -> +5% on one tool, max +25% per tool
export const TOOL_SLOTS = { base: 1, unlocked: 2 };       // tools per skill that may get upgrades: 1 in stage 1, 2 after paying
const BAR_SECONDS = 3;                                    // the bar stays this long after your last break
const BAR_WIDTH = 16;

export const SKILLS = {
  mining: { name: "Mining",      color: "§b", tool: "pickaxe", icon: "textures/items/diamond_pickaxe", what: "Break natural stone, ores, nether & end blocks with a pickaxe" },
  wood:   { name: "Woodcutting", color: "§6", tool: "axe",     icon: "textures/items/iron_axe",        what: "Chop logs (axe or by hand)" },
  dig:    { name: "Excavation",  color: "§e", tool: "shovel",  icon: "textures/items/iron_shovel",     what: "Dig dirt, sand, gravel, clay (any tool)" },
  farm:   { name: "Farming",     color: "§a", tool: "hoe",     icon: "textures/items/iron_hoe",        what: "Harvest crops, feed animals" },
  fly:    { name: "Flying",      color: "§d", tool: null,      icon: "textures/items/elytra",          what: "Glide with an Elytra (1 point / 20 blocks)" },
  combat: { name: "Combat",      color: "§c", tool: null,      icon: "textures/items/diamond_sword",   what: "Kill monsters (stronger = more points)" },
  fish:   { name: "Fishing",     color: "§3", tool: null,      icon: "textures/items/fishing_rod_uncast", what: "Reel in catches with a fishing rod" },
  trade:  { name: "Trading",     color: "§2", tool: null,      icon: "textures/items/emerald",         what: "Trade with villagers (shop discounts)" },
};
export const KEYS = Object.keys(SKILLS);
export const aTool = (t) => (/^[aeiou]/.test(t) ? "an " : "a ") + t;           // "an axe", "a pickaxe"
export const TOOL_KEYS = KEYS.filter((k) => SKILLS[k].tool);       // skills that give tool speed points
// Flying + Combat: every 50 levels -> +5%  (Flying = elytra speed, Combat = damage), max +25%
export const PERK = { every: 50, step: 5, max: 25 };
export const isPerkSkill = (key) => key === "fly" || key === "combat" || key === "fish" || key === "trade";
// Trading perks: level -> what you get. buy = % cheaper shop prices (money), sell = % higher sell prices
export const TRADE_TIERS = [
  { lv: 50, buy: 5, sell: 0, text: "-5% shop prices" },
  { lv: 100, buy: 10, sell: 0, text: "-10% shop prices" },
  { lv: 150, buy: 10, sell: 5, text: "+5% sell prices" },
  { lv: 200, buy: 10, sell: 10, text: "+10% sell prices" },
];
export const perkText = (key, L) => {
  if (key === "fly") return "+" + PERK.step + "% elytra speed";
  if (key === "fish") return "+" + PERK.step + "% double catch";
  if (key === "trade") { const t = TRADE_TIERS.find((x) => x.lv === L); return t ? t.text : ""; }
  return "+" + PERK.step + "% damage";
};

/** money for reaching level L (every skill): level 1 = $10, rising evenly to $100 at level 100, then $100 for every level up to 250 */
export const LEVEL_MONEY = { min: 10, max: 100, capLevel: 100 };
export const levelMoney = (L) => L >= LEVEL_MONEY.capLevel ? LEVEL_MONEY.max
  : L <= 1 ? LEVEL_MONEY.min
  : LEVEL_MONEY.min + Math.round((LEVEL_MONEY.max - LEVEL_MONEY.min) * (L - 1) / (LEVEL_MONEY.capLevel - 1));
/** reward for reaching level L: money (see levelMoney) + shards / speed points */
export function rewardFor(L, key) {
  const perk = key === "trade" ? TRADE_TIERS.some((t) => t.lv === L)
    : isPerkSkill(key) ? L % PERK.every === 0 && L / PERK.every <= PERK.max / PERK.step : L % SPEED.every === 0;
  const r = { money: levelMoney(L), shards: 0, speed: perk, milestone: L % 100 === 0 };
  if (L % 5 === 0) r.shards += 1 + Math.floor(L / 100);
  if (r.milestone) r.shards += 10 * (L / 100);                                       // milestone = shards only (money per level never goes above $100)
  return r;
}
export function rewardText(L, key) {
  const r = rewardFor(L, key);
  return "§a" + money(r.money) + (r.shards ? " §7+ §d" + r.shards + " shards" : "") + (r.speed ? " §7+ §b" + (isPerkSkill(key) ? perkText(key, L) : "1 speed point") : "");
}

// ---------------------------------------------------------------- level maths (exact)
// breaks needed for level n (from level n-1):  20, 40, 60, 80, 100, then 110, 120, 130 ...
export const need = (n) => (n <= 5 ? 20 * n : 100 + 10 * (n - 5));
const CUM = [0];                                          // CUM[L] = total breaks needed to be level L
for (let n = 1; n <= MAX_LEVEL; n++) CUM[n] = CUM[n - 1] + need(n);
export const TOTAL_MAX = CUM[MAX_LEVEL];
export const GATE_TOTAL = CUM[GATE_LEVEL];                 // breaks needed for level 125 = where a locked skill stops

export function levelOf(total) {
  let lo = 0, hi = MAX_LEVEL;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (CUM[mid] <= total) lo = mid; else hi = mid - 1; }
  return lo;
}
/** { level, into, next, pct, max }   into = breaks done in this level, next = breaks this level needs */
export function info(total, unlocked = true) {
  const level = levelOf(total);
  if (!unlocked && level >= GATE_LEVEL) return { level: GATE_LEVEL, into: 0, next: 0, pct: 100, max: false, locked: true };
  if (level >= MAX_LEVEL) return { level, into: 0, next: 0, pct: 100, max: true };
  const into = total - CUM[level], next = need(level + 1);
  return { level, into, next, pct: Math.floor((into / next) * 100), max: false };
}

// ---------------------------------------------------------------- player data  (ex(p).sk = { n: breaks per skill, u: speed points spent per skill })
function data(p) {
  const e = ex(p);
  if (!e.sk || typeof e.sk !== "object") e.sk = {};
  const s = e.sk;
  if (!s.n || typeof s.n !== "object") s.n = {};
  if (!s.u || typeof s.u !== "object") s.u = {};
  if (!s.lk || typeof s.lk !== "object") s.lk = {};          // lk = skills whose levels 126-250 were unlocked (paid)
  if (!s.tc || typeof s.tc !== "object") s.tc = {};          // tc = how many different tools of that skill got a speed upgrade
  if (!s.nb || typeof s.nb !== "object") s.nb = {};          // nb = items bought from the shop / given by villagers: they never get the sell bonus (anti loop)
  if (s.fs !== undefined && !(typeof s.fs === "number" && s.fs >= 0 && s.fs <= PERK.max && s.fs % PERK.step === 0)) delete s.fs;      // fs = chosen elytra speed (undefined = auto / best unlocked, 0 = off)
  for (const k of KEYS) {
    if (typeof s.n[k] !== "number" || !(s.n[k] >= 0)) s.n[k] = 0;
    if (typeof s.u[k] !== "number" || !(s.u[k] >= 0)) s.u[k] = 0;
    if (typeof s.tc[k] !== "number" || !(s.tc[k] >= 0)) s.tc[k] = s.u[k] > 0 ? Math.ceil(s.u[k] / (SPEED.max / SPEED.step)) : 0;
    if (s.lk[k] !== true) s.lk[k] = false;
    if (!s.lk[k] && s.n[k] > GATE_TOTAL) s.n[k] = GATE_TOTAL;          // not paid: nobody stays above level 125
    else if (s.n[k] > TOTAL_MAX) s.n[k] = TOTAL_MAX;
  }
  return s;
}
export const skillData = data;
export const breaksOf = (p, key) => data(p).n[key];
export const skillInfo = (p, key) => { const d = data(p); return info(d.n[key], d.lk[key] === true); };
export const isUnlocked = (p, key) => data(p).lk[key] === true;
export const toolSlots = (p, key) => (isUnlocked(p, key) ? TOOL_SLOTS.unlocked : TOOL_SLOTS.base);
export const toolsStarted = (p, key) => data(p).tc[key];
export const pointsOf = (p, key) => Math.max(0, Math.floor(skillInfo(p, key).level / SPEED.every) - data(p).u[key]);
export const pointsEarned = (p, key) => Math.floor(skillInfo(p, key).level / SPEED.every);

// ---------------------------------------------------------------- what counts
const idOf = (t) => t.replace("minecraft:", "");
const LOG = /^(?:stripped_)?(.+?)_(?:log|wood|stem|hyphae)$/;
const BAMBOO_BLOCK = /^(?:stripped_)?bamboo_block$/;
const DIG = /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|dirt_path|grass_path|farmland|sand|red_sand|gravel|clay|mud|soul_sand|soul_soil|snow|snow_layer|suspicious_sand|suspicious_gravel|.*_concrete_powder)$/;
// Mining only counts NATURAL hard blocks (stone, ores, deepslate, nether, end ...). Leaves, grass, plants, flowers, planks, glass, wool ... never count.
const MINEABLE = /^(?:stone|cobblestone|mossy_cobblestone|granite|diorite|andesite|tuff|deepslate|cobbled_deepslate|calcite|dripstone_block|pointed_dripstone|amethyst_block|budding_amethyst|small_amethyst_bud|medium_amethyst_bud|large_amethyst_bud|amethyst_cluster|sandstone|red_sandstone|(?!.*glazed).+_terracotta|terracotta|hardened_clay|netherrack|basalt|smooth_basalt|blackstone|gilded_blackstone|magma|glowstone|obsidian|crying_obsidian|end_stone|ice|packed_ice|blue_ice|prismarine|bone_block|mob_spawner|monster_egg|infested_[a-z_]+|crimson_nylium|warped_nylium|ancient_debris|[a-z_]+_ore)$/;
const CROPS = { wheat: ["growth", 7], carrots: ["growth", 7], potatoes: ["growth", 7], beetroot: ["growth", 7], nether_wart: ["age", 3], cocoa: ["age", 2] };
const OTHER_CROPS = new Set(["melon_block", "pumpkin", "reeds"]);      // reeds = sugar cane

export const kindOf = (typeId) => {
  const id = idOf(typeId ?? "");
  return id.endsWith("_pickaxe") ? "pickaxe" : id.endsWith("_axe") ? "axe" : id.endsWith("_shovel") ? "shovel" : id.endsWith("_hoe") ? "hoe" : null;
};

/** -> { skill, free }  or null.  free = true when the block does not need the "placed by the player" check (growing crops).
 *  Crops, wood and dirt-type blocks count with ANY tool (also by hand); natural stone / ore / nether / end blocks count for Mining when a pickaxe broke it. */
function classify(toolId, blockId, perm) {
  const c = CROPS[blockId];
  if (c) {
    if (!perm) return null;
    let v; try { v = perm.getState(c[0]); } catch (e) { return null; }
    return typeof v === "number" && v >= c[1] ? { skill: "farm", free: true } : null;      // only FULLY GROWN crops
  }
  if (OTHER_CROPS.has(blockId)) return { skill: "farm", free: false };
  if (LOG.test(blockId) || BAMBOO_BLOCK.test(blockId)) return { skill: "wood", free: false };
  if (DIG.test(blockId)) return { skill: "dig", free: false };
  if (kindOf(toolId) === "pickaxe" && MINEABLE.test(blockId)) return { skill: "mining", free: false };
  return null;
}

// anti farm: blocks the player placed themselves do not count (last 400 per player)
const PLACED_CAP = 400;
const placed = new Map();
const keyOf = (dim, x, y, z) => dim + "," + x + "," + y + "," + z;
function takePlaced(p, k) {
  const set = placed.get(p.id);
  if (set && set.has(k)) { set.delete(k); return true; }
  return false;
}

// ---------------------------------------------------------------- gaining skill
const overlay = new Map();     // player id -> { key, until, sent, gain, flash, flashUntil }
const now = () => system.currentTick;

function levelUp(p, key, L) {
  const S = SKILLS[key], r = rewardFor(L, key);
  try {
    addMoney(p, r.money);
    if (r.shards) addShards(p, r.shards);
  } catch (e) { console.warn("[skills] reward failed: " + e); }
  let text = "§a[Skills] " + S.color + "§l" + S.name + " §r§7level §e" + L + "§7:  §a+" + money(r.money) + (r.shards ? "  §d+" + r.shards + " shards" : "") +
    (!r.speed ? "" : key === "fly" ? "\n§b[Skills] §fElytra speed unlocked: §a+" + L / PERK.every * PERK.step + "%§f! §7Open §f/menu §7> Skills to choose it."
      : key === "combat" ? "\n§b[Skills] §fDamage bonus is now §a+" + L / PERK.every * PERK.step + "%§f!"
      : key === "fish" ? "\n§b[Skills] §fDouble catch chance is now §a+" + L / PERK.every * PERK.step + "%§f!"
      : key === "trade" ? "\n§b[Skills] §fTrading perk unlocked: §a" + perkText(key, L) + "§f!"
      : "\n§b[Skills] §fNew speed point! §7Open §f/menu §7> Skills, hold " + aTool(S.tool) + " and upgrade it (+" + SPEED.step + "% speed).");
  if (L === GATE_LEVEL && !isUnlocked(p, key)) text += "\n§6[Skills] §fStage 1 complete! Open §f/menu §f> Skills and pay §a" + money(unlockCost(key)) + " §fto go on to level §e" + MAX_LEVEL + "§f.";
  try {
    if (r.speed || r.milestone) notify(p, text, { key: "skill-" + key + "-" + L });
    else p.sendMessage(menuMsg(p, text));
    p.playSound(r.speed || r.milestone ? "random.totem" : "random.levelup");
  } catch (e) { /* ignore */ }
  const o = overlay.get(p.id);
  if (o) { o.flash = L; o.flashUntil = now() + 60; }
}

function gain(p, key, n) {
  const d = data(p), before = levelOf(d.n[key]);
  if (d.n[key] >= TOTAL_MAX) { show(p, key, 0); return; }
  const cap = d.lk[key] ? TOTAL_MAX : GATE_TOTAL;                    // a locked skill stops at level 125 (xp is frozen, nothing is lost or stored)
  let o = overlay.get(p.id);
  if (!o || o.key !== key) { o = { key, until: 0, sent: -999, gain: 0, flash: 0, flashUntil: 0 }; overlay.set(p.id, o); }
  if (d.n[key] >= cap) { o.gain = 0; show(p, key, 0); return; }
  d.n[key] = Math.min(cap, d.n[key] + n);
  const after = levelOf(d.n[key]);
  o.gain = n;
  for (let L = before + 1; L <= after; L++) levelUp(p, key, L);
  show(p, key, n);
}

const bar = (pct) => {
  const f = Math.max(0, Math.min(BAR_WIDTH, Math.floor((pct / 100) * BAR_WIDTH)));
  return "§a" + "|".repeat(f) + "§8" + "|".repeat(BAR_WIDTH - f);
};
function render(p, o) {
  const S = SKILLS[o.key], i = skillInfo(p, o.key);
  if (o.flash && now() < o.flashUntil) return "§6§l>> LEVEL UP <<  §r" + S.color + "§l" + S.name + " §r§7Lv §e" + o.flash;
  if (i.locked) return S.color + "§l" + S.name + " §r§7Lv §6" + i.level + " §c§lLOCKED §r§8| §7/menu > Skills: pay " + money(unlockCost(o.key));
  if (i.max) return S.color + "§l" + S.name + " §r§7Lv §6" + i.level + " §6§lMAX §r§8[§a" + "|".repeat(BAR_WIDTH) + "§8]";
  return S.color + "§l" + S.name + " §r§7Lv §f" + i.level + " §8[" + bar(i.pct) + "§8] §f" + i.pct + "% §8| §7" + num(i.into) + "/" + num(i.next) + (o.gain ? " §a+" + o.gain : "");
}
function send(p, o) {
  if (combatBusy.has(p.id) || formBusy.has(p.id)) return;          // combat timer / open menus have priority
  skillBusy.add(p.id);
  o.sent = now();
  try { p.onScreenDisplay.setActionBar(render(p, o)); } catch (e) { /* ignore */ }
}
function show(p, key, n) {
  const o = overlay.get(p.id);
  if (!o) return;
  o.until = now() + BAR_SECONDS * 20;
  send(p, o);
}

function finish(p, id) {
  overlay.delete(id); skillBusy.delete(id);
  if (!p) return;
  try {
    if (combatBusy.has(id)) return;
    if ((stats(p).hud ?? "panel") === "bar") updateHud(p, true);
    else p.onScreenDisplay.setActionBar("");
  } catch (e) { /* ignore */ }
}

system.runInterval(() => {
  if (overlay.size === 0) return;
  const t = now(), byId = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [id, o] of [...overlay]) {
    const p = byId.get(id);
    if (!p) { overlay.delete(id); skillBusy.delete(id); continue; }
    if (t >= o.until) { finish(p, id); continue; }
    if (t - o.sent >= 20) send(p, o);
  }
}, 10);

// ---------------------------------------------------------------- events
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[skills] cannot start " + name + ": " + e); } };

safe("place tracking", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  let set = placed.get(player.id);
  if (!set) { set = new Set(); placed.set(player.id, set); }
  set.add(keyOf(block.dimension.id, block.x, block.y, block.z));
  if (set.size > PLACED_CAP) set.delete(set.values().next().value);
}));
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { sessions.delete(playerId); lastCatch.delete(playerId); placed.delete(playerId); overlay.delete(playerId); skillBusy.delete(playerId); haste.delete(playerId); feedLast.delete(playerId); flyLast.delete(playerId); pvpLast.delete(playerId); }));

safe("block break", () => world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    const { player, block, brokenBlockPermutation: perm } = ev;
    const k = keyOf(block.dimension.id, block.x, block.y, block.z), wasPlaced = takePlaced(player, k);
    if (player.getGameMode() !== GameMode.Survival) return;
    const c = classify(ev.itemStackBeforeBreak?.typeId ?? "", idOf(perm.type.id), perm);
    if (!c || (wasPlaced && !c.free)) return;
    gain(player, c.skill, 1);
  } catch (e) { console.warn("[skills] " + e); }
}));

// ---------------------------------------------------------------- feeding animals (Farming)
// animal -> items that count. A feeding only counts when the item was really used up (so a full / baby-already-fed animal gives nothing).
const SEEDS = ["wheat_seeds", "beetroot_seeds", "melon_seeds", "pumpkin_seeds", "torchflower_seeds", "pitcher_pod"];
const MEAT = ["beef", "cooked_beef", "porkchop", "cooked_porkchop", "chicken", "cooked_chicken", "mutton", "cooked_mutton", "rabbit", "cooked_rabbit", "rotten_flesh", "bone"];
const HORSE = ["wheat", "apple", "sugar", "hay_block", "golden_apple", "golden_carrot", "enchanted_golden_apple"];
const FLOWERS = ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "torchflower", "sunflower", "lilac", "rose_bush", "peony", "pink_petals", "open_eyeblossom", "closed_eyeblossom"];
const FEED = {};
const feeds = (animals, items) => { for (const a of animals) FEED[a] = new Set(items); };
feeds(["cow", "mooshroom", "sheep", "goat"], ["wheat"]);
feeds(["pig"], ["carrot", "potato", "beetroot"]);
feeds(["chicken"], SEEDS);
feeds(["horse", "donkey", "mule"], HORSE);
feeds(["llama", "trader_llama"], ["hay_block", "wheat"]);
feeds(["rabbit"], ["carrot", "golden_carrot", "dandelion"]);
feeds(["cat", "ocelot"], ["cod", "salmon"]);
feeds(["wolf"], MEAT);
feeds(["fox"], ["sweet_berries", "glow_berries"]);
feeds(["bee"], FLOWERS);
feeds(["turtle"], ["seagrass"]);
feeds(["panda"], ["bamboo"]);
feeds(["camel"], ["cactus"]);
feeds(["sniffer"], ["torchflower_seeds"]);
feeds(["armadillo"], ["spider_eye"]);
feeds(["strider"], ["warped_fungus"]);
feeds(["hoglin"], ["crimson_fungus"]);
feeds(["frog"], ["slime_ball"]);
feeds(["parrot"], ["wheat_seeds", "beetroot_seeds", "melon_seeds", "pumpkin_seeds", "torchflower_seeds", "pitcher_pod"]);
const feedLast = new Map();     // player id -> { slot, type, amount, t }   (stops double counting when you click very fast)

safe("feeding animals", () => world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  try {
    const player = ev.player, target = ev.target, before = ev.beforeItemStack ?? ev.itemStack;
    if (!before || !target) return;
    const foods = FEED[idOf(target.typeId)];
    if (!foods || !foods.has(idOf(before.typeId))) return;
    if (player.getGameMode() !== GameMode.Survival) return;
    const slot = player.selectedSlotIndex, type = before.typeId, amount = before.amount;
    system.runTimeout(() => {
      try {
        const cur = player.getComponent("inventory").container.getItem(slot);
        let ref = amount;
        const lf = feedLast.get(player.id);
        if (lf && lf.slot === slot && lf.type === type && now() - lf.t < 40) ref = Math.min(ref, lf.amount);
        if (cur && cur.typeId === type && cur.amount >= ref) return;          // nothing was used up -> not fed
        feedLast.set(player.id, { slot, type, amount: cur && cur.typeId === type ? cur.amount : 0, t: now() });
        gain(player, "farm", 1);
      } catch (e) { /* player left */ }
    }, 2);
  } catch (e) { console.warn("[skills] " + e); }
}));

/** called by mining.js for every EXTRA block that Timber / Vein Miner / Area Mining breaks (call it BEFORE the block is removed) */
export function skillExtra(player, toolTypeId, blockTypeId, block) {
  try {
    const k = keyOf(block.dimension.id, block.x, block.y, block.z), wasPlaced = takePlaced(player, k);
    if (!wasPlaced) countOre(player, blockTypeId);
    const c = classify(toolTypeId ?? "", idOf(blockTypeId), null);
    if (!c || wasPlaced) return;
    gain(player, c.skill, 1);
  } catch (e) { console.warn("[skills] " + e); }
}

// ---------------------------------------------------------------- tool speed boost (stored on the tool as a lore line)
const strip = (s) => String(s).replace(/§./g, "");
const LORE_RE = /^Speed Boost \+(\d+)%$/;
const loreLine = (pct) => "§r§bSpeed Boost §a+" + pct + "%";

/** 0, 5, 10 ... 25  for an item stack */
export function boostOf(item) {
  try {
    if (!item || !kindOf(item.typeId)) return 0;
    for (const l of item.getLore()) { const m = LORE_RE.exec(strip(l)); if (m) return Math.min(SPEED.max, parseInt(m[1], 10) || 0); }
  } catch (e) { /* ignore */ }
  return 0;
}
export function heldItem(p) {
  try { return p.getComponent("inventory").container.getItem(p.selectedSlotIndex) ?? null; } catch (e) { return null; }
}
export const prettyId = (typeId) => idOf(typeId).split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** spend 1 point of `key` on the tool in the player's hand. returns { ok, text } */
export function upgradeHeld(p, key) {
  const S = SKILLS[key];
  if (!S || !S.tool) return { ok: false, text: "§cThis skill has no tool upgrades." };
  try {
    const inv = p.getComponent("inventory").container, slot = p.selectedSlotIndex, item = inv.getItem(slot);
    if (!item || kindOf(item.typeId) !== S.tool) return { ok: false, text: "§cHold " + aTool(S.tool) + " in your hand first." };
    const cur = boostOf(item), d = data(p);
    if (cur === 0 && d.tc[key] >= toolSlots(p, key)) return { ok: false, text: isUnlocked(p, key) ? "§cBoth tools are already started." : "§cYou can only upgrade ONE tool for now. Unlock levels " + (GATE_LEVEL + 1) + "+ to upgrade a second one." };
    if (cur >= SPEED.max) return { ok: false, text: "§cThis " + S.tool + " is already at the maximum (+" + SPEED.max + "%)." };
    if (pointsOf(p, key) < 1) return { ok: false, text: "§cNo " + S.name + " speed points left. You get 1 every " + SPEED.every + " levels." };
    const next = cur + SPEED.step, old = item.getLore();
    // price: every +5% adds a random 7% - 15% (compounding). A tool upgraded before prices existed gets its missing rolls now.
    let total = 1, hasValue = false;
    for (const l of old) { const m = VALUE_RE.exec(strip(l)); if (m) { total = 1 + (parseFloat(m[1]) || 0) / 100; hasValue = true; } }
    const rolls = (!hasValue && cur > 0) ? cur / SPEED.step : 0;
    for (let i = 0; i < rolls; i++) total *= 1 + (7 + Math.floor(Math.random() * 9)) / 100;
    const roll = 7 + Math.floor(Math.random() * 9);                       // 7 .. 15 %  (everyone has their own luck)
    total *= 1 + roll / 100;
    const pct = Math.round((total - 1) * 1000) / 10;
    const lines = old.filter((l) => !LORE_RE.test(strip(l)) && !VALUE_RE.test(strip(l)));
    lines.push(loreLine(next), valueLine(pct));
    item.setLore(lines);
    inv.setItem(slot, item);
    d.u[key] += 1;
    if (cur === 0) d.tc[key] += 1;
    try { p.playSound("random.anvil_use"); } catch (e) { /* ignore */ }
    return { ok: true, text: "§a" + prettyId(item.typeId) + " is now §b+" + next + "% §aspeed. §6Value +" + roll + "% §7(total +" + pct + "%)" + (next >= SPEED.max ? " §6(MAX)" : "") };
  } catch (e) {
    console.warn("[skills] upgrade failed: " + e);
    return { ok: false, text: "§cCould not upgrade this item." };
  }
}

/** pay to unlock levels 126 -> 250 of a skill (and the second tool upgrade). returns { ok, text } */
export function unlockSkill(p, key) {
  const S = SKILLS[key];
  if (!S) return { ok: false, text: "§cUnknown skill." };
  const d = data(p);
  if (d.lk[key]) return { ok: false, text: "§cAlready unlocked." };
  if (d.n[key] < GATE_TOTAL) return { ok: false, text: "§c" + S.name + " must be at least level " + GATE_LEVEL + "." };
  const cost = unlockCost(key);
  if (!takeMoney(p, cost)) return { ok: false, text: "§cNot enough money. You need " + money(cost) + "." };
  try { addTx(p, { type: "buy", id: "skill_unlock", name: "Skill unlock: " + S.name, qty: 1, total: cost }); } catch (e) { /* ignore */ }
  d.lk[key] = true;
  try { p.playSound("random.totem"); } catch (e) { /* ignore */ }
  try { p.sendMessage(menuMsg(p, "§6[Skills] " + S.color + S.name + " §aunlocked! Levels §f" + (GATE_LEVEL + 1) + "-" + MAX_LEVEL + " §aare open." + (S.tool ? " §aA 2nd tool can now be upgraded." : ""))); } catch (e) { /* ignore */ }
  return { ok: true, text: "§a" + S.name + " §aunlocked! Levels §f" + (GATE_LEVEL + 1) + "-" + MAX_LEVEL + " §aare open." + (S.tool ? " §aA 2nd tool can now be upgraded." : "") };
}

// Real speed: Haste I = +20% mining speed, Haste II = +40%. We pulse it on/off in 5 tick slots over a 40 tick period so the
// AVERAGE speed is exactly the boost:  +5% = 10 of 40 ticks Haste I, +10% = 20, +15% = 30, +20% = 40 (always), +25% = 25 of 40 ticks Haste II.
const PERIOD_SLOTS = 8;                                   // 8 slots x 5 ticks = 40 ticks
const haste = new Map();                                  // player id -> true while we are applying haste to them
let slotNo = 0;
system.runInterval(() => {
  const slot = slotNo++ % PERIOD_SLOTS;
  for (const p of world.getAllPlayers()) {
    try {
      const b = boostOf(heldItem(p));
      if (b <= 0) {
        if (haste.has(p.id)) { haste.delete(p.id); p.removeEffect("haste"); }
        continue;
      }
      const amp = b > 20 ? 1 : 0, on = Math.round((PERIOD_SLOTS * b) / (20 * (amp + 1)));      // slots that are ON (of 8)
      haste.set(p.id, true);
      if (slot < on) p.addEffect("haste", slot === on - 1 && on < PERIOD_SLOTS ? 5 : 6, { amplifier: amp, showParticles: false });
    } catch (e) { /* player not ready */ }
  }
}, 5);

// ================================================================ perks of Flying and Combat
const steps = (p, key) => Math.min(PERK.max / PERK.step, Math.floor(skillInfo(p, key).level / PERK.every));
/** elytra speed unlocked by the Flying level: 0, 5, 10, 15, 20, 25 */
export const flyUnlocked = (p) => steps(p, "fly") * PERK.step;
/** elytra speed that is really applied now (respects the on/off + chosen speed in the menu) */
export function flyActive(p) {
  const u = flyUnlocked(p);
  if (u <= 0) return 0;
  const fs = data(p).fs;
  return fs === undefined ? u : Math.min(fs, u);
}
export const flyChosen = (p) => data(p).fs;                                  // undefined = auto
export function setFlySpeed(p, pct) {                                       // pct: undefined (auto), 0 (off), 5 ... 25
  const d = data(p);
  if (pct === undefined) { delete d.fs; return true; }
  if (typeof pct !== "number" || pct < 0 || pct > flyUnlocked(p) || pct % PERK.step !== 0) return false;
  d.fs = pct;
  return true;
}
/** damage bonus unlocked by the Combat level: 0, 5, 10, 15, 20, 25 (percent) */
export const combatBonus = (p) => steps(p, "combat") * PERK.step;
export const nextPerkLevel = (p, key) => {
  const st = steps(p, key);
  return st >= PERK.max / PERK.step ? 0 : (st + 1) * PERK.every;
};

// ================================================================ Flying: xp from distance glided + elytra speed
const FLY_BLOCKS = 20;                // 1 point per 20 blocks flown while gliding (survival)
const FLY_MAX_STEP = 40;              // a bigger jump in 5 ticks = teleport, ignored
const flyLast = new Map();            // player id -> { x, y, z, dim, acc }
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      let st = flyLast.get(p.id);
      if (p.isGliding !== true) { if (st) { st.dim = null; } continue; }          // keep the leftover distance, restart the position
      const loc = p.location, dim = p.dimension.id;
      if (!st) { st = { x: loc.x, y: loc.y, z: loc.z, dim, acc: 0 }; flyLast.set(p.id, st); continue; }
      if (st.dim !== dim) { st.x = loc.x; st.y = loc.y; st.z = loc.z; st.dim = dim; continue; }
      const d = Math.hypot(loc.x - st.x, loc.y - st.y, loc.z - st.z);
      st.x = loc.x; st.y = loc.y; st.z = loc.z;
      if (d > FLY_MAX_STEP || p.getGameMode() !== GameMode.Survival) continue;
      st.acc += d;
      if (st.acc >= FLY_BLOCKS) { const n = Math.floor(st.acc / FLY_BLOCKS); st.acc -= n * FLY_BLOCKS; gain(p, "fly", n); }
    } catch (e) { /* player not ready */ }
  }
}, 5);

// Elytra speed: Bedrock has no "glide speed" setting, so we give the glide a tiny push along the current direction every 2 ticks.
// It works like less air drag: final speed = normal speed x (1 + pct). The push is  v * c  with  c = 0.01 * (1 - 1/(1+pct)) / 0.99  per tick
// (elytra loses ~1% speed per tick; this cancels exactly the part that gives +pct at the speed the glide settles on).
const FLY_SPEED_CAP = 3.5;            // blocks per tick (70 b/s): never push above this
let impulseBroken = false;
const flyPush = (pct) => (0.01 * (1 - 1 / (1 + pct / 100))) / 0.99;
system.runInterval(() => {
  if (impulseBroken) return;
  for (const p of world.getAllPlayers()) {
    try {
      if (p.isGliding !== true) continue;
      const pct = flyActive(p);
      if (pct <= 0) continue;
      const v = p.getVelocity(), sp = Math.hypot(v.x, v.y, v.z);
      if (!(sp > 0.2) || sp > FLY_SPEED_CAP) continue;
      const c = flyPush(pct) * 2;
      p.applyImpulse({ x: v.x * c, y: v.y * c, z: v.z * c });
    } catch (e) {
      if (/impulse|support|function/i.test(String(e))) { impulseBroken = true; console.warn("[skills] elytra speed disabled, applyImpulse is not available for players here: " + e); return; }
    }
  }
}, 2);
export const flyPushFor = flyPush;

// ================================================================ Combat: xp from kills + damage bonus
// points of a monster = the best of: its own value, or what it carries (armour 3, weapon 4, both 7, + up to 3 for diamond / netherite / enchanted / full set) - max 10
const MOB = {
  // 1 point: weak monsters
  zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombie_villager_v2: 1, skeleton: 1, stray: 1, bogged: 1, creeper: 1, spider: 1, cave_spider: 1,
  silverfish: 1, endermite: 1, slime: 1, magma_cube: 1, zombie_pigman: 1, zombified_piglin: 1, piglin: 1, parched: 1, zombie_horse: 1, skeleton_horse: 1,
  // 2 - 6 points: stronger monsters
  phantom: 2, vex: 2, witch: 3, enderman: 3, blaze: 3, ghast: 3, guardian: 3, shulker: 3, pillager: 3, hoglin: 3, creaking: 3,
  breeze: 4, piglin_brute: 4, wither_skeleton: 4, vindicator: 4, zoglin: 4, evoker: 5, evocation_illager: 5, illusioner: 5, ravager: 6,
  // bosses and the strongest: 8 - 10 points
  elder_guardian: 8, warden: 10, wither: 10, ender_dragon: 10,
  // animals and the rest: 1 point (a few bigger ones give more)
  cow: 1, mooshroom: 1, pig: 1, sheep: 1, chicken: 1, rabbit: 1, horse: 1, donkey: 1, mule: 1, llama: 1, trader_llama: 1, camel: 2, camel_husk: 2,
  cat: 1, ocelot: 1, fox: 1, parrot: 1, bat: 1, bee: 1, goat: 1, frog: 1, tadpole: 1, axolotl: 1, turtle: 1, armadillo: 1, allay: 1, strider: 1,
  sniffer: 3, panda: 2, polar_bear: 3, wolf: 2, dolphin: 1, squid: 1, glow_squid: 1, cod: 1, salmon: 1, pufferfish: 1, tropicalfish: 1, nautilus: 1, zombie_nautilus: 2,
  snow_golem: 1, copper_golem: 1, iron_golem: 5, happy_ghast: 3, villager: 1, villager_v2: 1, wandering_trader: 1,
};
const PLAYER_BASE = 3;                // killing another player
const COMBAT_BONUS_VS_PLAYERS = true; // set false to keep the +damage bonus for monsters only
const PVP_REPEAT_TICKS = 6000;        // the same victim only counts once per 5 minutes
const MAX_POINTS = 10;
const ARMOR_SLOTS = ["Head", "Chest", "Legs", "Feet"];
const WEAPON = /(?:_sword|_axe|trident|mace)$/;
const STRONG_TIER = /(?:diamond|netherite)_/;
const pvpLast = new Map();            // killer id -> Map(victim id -> tick)
const gearCache = new Map();          // victim entity id -> { pts, t }

function basePoints(typeId) {
  const id = idOf(typeId ?? "");
  return id === "player" ? PLAYER_BASE : MOB[id] ?? 0;
}
function gearPoints(entity) {
  let eq;
  try { eq = entity.getComponent("equippable"); } catch (e) { return 0; }
  if (!eq) return 0;
  let pieces = 0, strong = false, ench = false, weapon = false;
  const look = (it) => {
    if (STRONG_TIER.test(it.typeId)) strong = true;
    try { const en = it.getComponent("enchantable"); if (en && en.getEnchantments().length > 0) ench = true; } catch (e) { /* no enchants */ }
  };
  for (const sl of ARMOR_SLOTS) {
    let it; try { it = eq.getEquipment(sl); } catch (e) { it = undefined; }
    if (it) { pieces++; look(it); }
  }
  let main; try { main = eq.getEquipment("Mainhand"); } catch (e) { main = undefined; }
  if (main && WEAPON.test(idOf(main.typeId))) { weapon = true; look(main); }
  const gear = (pieces > 0 ? 3 : 0) + (weapon ? 4 : 0);
  if (gear === 0) return 0;
  return gear + (strong ? 1 : 0) + (ench ? 1 : 0) + (pieces === 4 ? 1 : 0);
}
/** kill points for a victim (0 = does not count) */
export function killPoints(entity, typeId) {
  const base = basePoints(typeId);
  if (base <= 0) return 0;
  try { if (entity && entity.hasComponent("is_tamed")) return 0; } catch (e) { /* ignore */ }      // tamed pets give nothing
  return Math.max(1, Math.min(MAX_POINTS, Math.max(base, entity ? gearPoints(entity) : 0)));
}

const attackerOf = (src) => {
  try { const a = src && src.damagingEntity; return a && a.typeId === "minecraft:player" ? a : null; } catch (e) { return null; }
};

safe("combat hits", () => world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const player = attackerOf(ev.damageSource), victim = ev.hurtEntity;
    if (!player || !victim || victim.id === player.id) return;
    if (victim.typeId === "minecraft:player" && clanView.noHit(player, victim)) return;      // clan mate protected by the owner: no bonus damage
    // remember what the victim wears / holds NOW (it is gone when it dies)
    const t = now(), g = gearCache.get(victim.id);
    if (!g || t - g.t > 100) gearCache.set(victim.id, { pts: killPoints(victim, victim.typeId), t });
    if (gearCache.size > 300) gearCache.delete(gearCache.keys().next().value);
    // +damage bonus (Combat level): extra health is removed after the hit; it never makes the killing blow, so kills still count for the player
    const pct = combatBonus(player);
    if (pct <= 0 || player.getGameMode() !== GameMode.Survival) return;
    const cause = ev.damageSource.cause;
    if (cause !== "entityAttack" && cause !== "projectile") return;
    if (victim.typeId === "minecraft:player" && !COMBAT_BONUS_VS_PLAYERS) return;
    const extra = (ev.damage * pct) / 100;
    if (!(extra > 0)) return;
    const h = victim.getComponent("health");
    if (!h || !(h.currentValue - extra > 0.5)) return;
    h.setCurrentValue(h.currentValue - extra);
  } catch (e) { /* victim vanished */ }
}));

safe("combat kills", () => world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const dead = ev.deadEntity, player = attackerOf(ev.damageSource);
    const g = gearCache.get(dead.id);
    gearCache.delete(dead.id);
    if (!player || dead.id === player.id) return;
    if (dead.typeId === "minecraft:player" && clanView.same(player.id, dead.id)) return;      // clan mates give no combat points
    if (player.getGameMode() !== GameMode.Survival) return;
    let pts = g ? g.pts : 0;
    if (!pts) { try { pts = killPoints(dead, dead.typeId); } catch (e) { pts = killPoints(null, dead.typeId); } }
    if (pts <= 0) return;
    if (dead.typeId === "minecraft:player") {                                   // anti farm: same victim once per 5 minutes
      let m = pvpLast.get(player.id);
      if (!m) { m = new Map(); pvpLast.set(player.id, m); }
      if (m.has(dead.id) && now() - m.get(dead.id) < PVP_REPEAT_TICKS) return;
      m.set(dead.id, now());
    }
    gain(player, "combat", pts);
  } catch (e) { console.warn("[skills] " + e); }
}));

// ================================================================ Trading perks (used by priceperks.js)
export const tradeBuyDiscount = (p) => { const L = skillInfo(p, "trade").level; return L >= 100 ? 10 : L >= 50 ? 5 : 0; };
export const tradeSellBonus = (p) => { const L = skillInfo(p, "trade").level; return L >= 200 ? 10 : L >= 150 ? 5 : 0; };
export const tradeNext = (p) => { const L = skillInfo(p, "trade").level; return TRADE_TIERS.find((t) => t.lv > L) ?? null; };
/** Fishing: chance (percent) of a double catch: 0, 5 ... 25 */
export const fishDouble = (p) => steps(p, "fish") * PERK.step;

// ================================================================ item spawns (shared by Fishing + Trading checks)
const itemSpawns = [];                // { t, x, y, z, dim, id, done }
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
safe("item spawns", () => world.afterEvents.entitySpawn.subscribe((ev) => {
  try {
    const e = ev.entity;
    if (!e || e.typeId !== "minecraft:item") return;
    const l = e.location;
    let id = "";
    try { id = idOf(e.getComponent("item").itemStack.typeId); } catch (err) { /* ignore */ }
    itemSpawns.push({ t: now(), x: l.x, y: l.y, z: l.z, dim: e.dimension.id, id, done: false });
    if (itemSpawns.length > 80) itemSpawns.splice(0, itemSpawns.length - 80);
    fishMatch();
  } catch (e) { /* ignore */ }
}));

// ================================================================ Fishing
// A catch = a fishing hook is removed AND a fishing loot item appears at the hook's last position in the same moment.
// Anti cheat: the hook must have been in water for 30+ ticks, a dropped item next to the player is ignored, max 1 catch per second.
const FISH_ITEMS = new Set(["cod", "salmon", "pufferfish", "tropical_fish"]);
const TREASURE = new Set(["name_tag", "saddle", "nautilus_shell", "enchanted_book", "bow"]);
const JUNK = new Set(["fishing_rod", "bone", "bowl", "leather", "string", "stick", "ink_sac", "waterlily", "lily_pad", "rotten_flesh", "tripwire_hook", "leather_boots", "bamboo", "potion"]);
export const isCatchItem = (id) => FISH_ITEMS.has(id) || TREASURE.has(id) || JUNK.has(id);
const FISH_MIN_TICKS = 30, FISH_GAP_TICKS = 20, FISH_MATCH_DIST = 2.0, FISH_NEAR_PLAYER = 1.2;
const hooks = new Map();              // hook entity id -> { pid, x, y, z, dim, t0 }
const hooksGone = [];                 // { rec, t, done }
const lastCatch = new Map();          // player id -> tick

const holdsRod = (p) => {
  try {
    if (idOf(heldItem(p)?.typeId ?? "") === "fishing_rod") return true;
    const off = p.getComponent("equippable")?.getEquipment("Offhand");
    return !!off && idOf(off.typeId) === "fishing_rod";
  } catch (e) { return false; }
};

safe("fishing hooks", () => world.afterEvents.entitySpawn.subscribe((ev) => {
  try {
    const e = ev.entity;
    if (!e || e.typeId !== "minecraft:fishing_hook") return;
    const l = e.location, dim = e.dimension.id;
    let owner = null;
    try { owner = e.getComponent("projectile")?.owner ?? null; } catch (err) { owner = null; }
    if (!owner || owner.typeId !== "minecraft:player") {
      owner = null; let best = 8;
      for (const p of world.getAllPlayers()) {
        if (p.dimension.id !== dim || !holdsRod(p)) continue;
        const d = dist3(p.location, l);
        if (d < best) { best = d; owner = p; }
      }
    }
    if (!owner) return;
    hooks.set(e.id, { pid: owner.id, x: l.x, y: l.y, z: l.z, dim, t0: now() });
    if (hooks.size > 200) hooks.delete(hooks.keys().next().value);
  } catch (e) { /* ignore */ }
}));

safe("fishing hook removal", () => world.afterEvents.entityRemove.subscribe((ev) => {
  try {
    if (ev.typeId !== "minecraft:fishing_hook") return;
    const rec = hooks.get(ev.removedEntityId);
    if (!rec) return;
    hooks.delete(ev.removedEntityId);
    hooksGone.push({ rec, t: now(), done: false });
    if (hooksGone.length > 60) hooksGone.splice(0, hooksGone.length - 60);
    fishMatch();
  } catch (e) { /* ignore */ }
}));

// keep the hook positions fresh (they sit still in the water, so every 4 ticks is plenty)
system.runInterval(() => {
  if (hooks.size === 0) return;
  const t = now();
  for (const [id, h] of [...hooks]) {
    if (t - h.t0 > 12000) { hooks.delete(id); continue; }
    try {
      const e = world.getEntity(id);
      if (!e) continue;
      const l = e.location; h.x = l.x; h.y = l.y; h.z = l.z;
    } catch (err) { /* ignore */ }
  }
}, 4);

function inWater(rec) {
  try {
    const dim = world.getDimension(rec.dim), x = Math.floor(rec.x), y = Math.floor(rec.y), z = Math.floor(rec.z);
    const a = dim.getBlock({ x, y, z }), b = dim.getBlock({ x, y: y - 1, z });
    if (!a && !b) return true;                                     // chunk not readable: do not block a real catch
    return !!((a && a.isLiquid) || (b && b.isLiquid));
  } catch (e) { return true; }
}

function fishMatch() {
  const t = now();
  for (const h of hooksGone) {
    if (h.done) continue;
    for (const it of itemSpawns) {
      if (it.done || it.dim !== h.rec.dim || Math.abs(it.t - h.t) > 6 || !isCatchItem(it.id)) continue;
      if (dist3(it, h.rec) > FISH_MATCH_DIST) continue;
      it.done = true; h.done = true;
      caught(h.rec, it);
      break;
    }
  }
  for (let i = hooksGone.length - 1; i >= 0; i--) if (hooksGone[i].done || t - hooksGone[i].t > 12) hooksGone.splice(i, 1);
  for (let i = itemSpawns.length - 1; i >= 0; i--) if (itemSpawns[i].done || t - itemSpawns[i].t > 40) itemSpawns.splice(i, 1);
}

function caught(rec, item) {
  try {
    const t = now();
    const p = world.getAllPlayers().find((x) => x.id === rec.pid);
    if (!p || p.getGameMode() !== GameMode.Survival) return;
    if (t - rec.t0 < FISH_MIN_TICKS) return;                              // a hook that was never really fishing
    if (!inWater(rec)) return;
    const lc = lastCatch.get(p.id);
    if (lc !== undefined && t - lc < FISH_GAP_TICKS) return;
    const eye = { x: p.location.x, y: p.location.y + 1.5, z: p.location.z };
    if (dist3(eye, item) < FISH_NEAR_PLAYER) return;                       // that was an item the player dropped
    lastCatch.set(p.id, t);
    gain(p, "fish", TREASURE.has(item.id) ? 3 : 1);
    // double catch (fish only: never treasure / junk)
    const chance = fishDouble(p);
    if (chance > 0 && FISH_ITEMS.has(item.id) && Math.random() * 100 < chance) {
      p.dimension.spawnItem(new ItemStack("minecraft:" + item.id, 1), { x: item.x, y: item.y, z: item.z });
      p.sendMessage(menuMsg(p, "§3[Fishing] §bDouble catch!"));
    }
  } catch (e) { console.warn("[skills] " + e); }
}

// ================================================================ Trading (villagers)
// Bedrock has no "trade" event. So: right-click a villager -> trade session. While it is open (and you stay within 10 blocks) we
// watch your inventory: something paid (items gone) + something received (items gained) at the same moment = 1 trade.
// Dropped items are ignored. Points 1 - 5 by the emerald value of the trade. What you receive can never get the sell bonus.
const TRADERS = new Set(["villager", "villager_v2", "wandering_trader"]);
const TRADE_IDLE = 3600, TRADE_RANGE = 10;
const sessions = new Map();           // player id -> { vid, last, snap }

function snapshot(p) {
  const c = p.getComponent("inventory").container, m = new Map();
  for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it) m.set(it.typeId, (m.get(it.typeId) ?? 0) + it.amount); }
  return m;
}
export const emeraldValue = (removed, added) => {
  const v = (m) => (m.get("minecraft:emerald") ?? 0) + 9 * (m.get("minecraft:emerald_block") ?? 0);
  return v(removed) + v(added);
};
export const tradePoints = (emeralds) => 1 + (emeralds >= 8 ? 1 : 0) + (emeralds >= 16 ? 1 : 0) + (emeralds >= 32 ? 1 : 0) + (emeralds >= 64 ? 1 : 0);

safe("trade sessions", () => world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  try {
    const p = ev.player, tg = ev.target;
    if (!tg || !TRADERS.has(idOf(tg.typeId)) || p.getGameMode() !== GameMode.Survival) return;
    const old = sessions.get(p.id);
    sessions.set(p.id, { vid: tg.id, last: now(), snap: old && old.vid === tg.id ? old.snap : snapshot(p) });
  } catch (e) { /* ignore */ }
}));

/** one check of a session. returns the number of trades counted (0 or 1) */
function checkTrade(p, s) {
  const snap = snapshot(p), removed = new Map(), added = new Map();
  for (const [id, n] of s.snap) { const now2 = snap.get(id) ?? 0; if (now2 < n) removed.set(id, n - now2); }
  for (const [id, n] of snap) { const was = s.snap.get(id) ?? 0; if (n > was) added.set(id, n - was); }
  s.snap = snap;
  if (removed.size === 0 || added.size === 0) return 0;
  // something dropped by the player at the same moment is not a trade
  const t = now(), pl = p.location;
  for (const it of itemSpawns) {
    if (t - it.t > 6 || it.dim !== p.dimension.id) continue;
    if (dist3(it, pl) <= 4 && removed.has("minecraft:" + it.id)) return 0;
  }
  for (const [id, n] of added) noBonusAdd(p, idOf(id), n);
  s.last = t;
  gain(p, "trade", tradePoints(emeraldValue(removed, added)));
  return 1;
}

system.runInterval(() => {
  if (sessions.size === 0) return;
  const t = now(), byId = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [pid, s] of [...sessions]) {
    const p = byId.get(pid);
    if (!p) { sessions.delete(pid); continue; }
    try {
      if (t - s.last > TRADE_IDLE) { sessions.delete(pid); continue; }
      const v = world.getEntity(s.vid);
      if (!v || p.dimension.id !== v.dimension.id || dist3(p.location, v.location) > TRADE_RANGE) { sessions.delete(pid); continue; }
      if (p.getGameMode() !== GameMode.Survival) { sessions.delete(pid); continue; }
      checkTrade(p, s);
    } catch (e) { sessions.delete(pid); }
  }
}, 2);

// ---------------------------------------------------------------- items that never get the sell bonus
/** remember that these items came from the shop / a villager (the sell bonus is never paid on them) */
export function noBonusAdd(p, id, qty) {
  try {
    const nb = data(p).nb;
    if (!(qty > 0)) return;
    if (nb[id] === undefined && Object.keys(nb).length >= 300) delete nb[Object.keys(nb)[0]];
    nb[id] = Math.min(1000000, (nb[id] ?? 0) + Math.floor(qty));
  } catch (e) { /* ignore */ }
}
