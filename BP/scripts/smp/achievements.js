// ---------------------------------------------------------------------------------------------
// Achievements  (categories, 4 tiers, Achievement Points, titles, "first on the server")
//
//  * Every achievement has a DIFFICULTY.  The difficulty alone decides the reward (see DIFF below), so rewards are always fair:
//      easy  $100             normal  $3,500 + 5 shards        hard  $10,000 + 20 shards
//      rare  $30,000 + 50 sh   legendary  $100,000 + 150 shards
//    For comparison: a diamond sells for $699, a small land costs $999 per hour.
//  * AP (achievement points) are NOT stored: they are the sum of the unlocked achievements, so they can never get out of sync.
//    Monthly AP = the AP of the achievements unlocked this month (so the monthly board resets by itself on the 1st).
//  * Ids never change (they are what is saved for each player).  Old ids are kept; their reward now follows the difficulty.
//  * Nothing here can be transferred between players (no "have $X" goals): wealth goals use money EARNED from shop sales.
//  * "first" achievements use counters that start at zero with this update, so nobody can get a fake "first".
// ---------------------------------------------------------------------------------------------
import { world } from "@minecraft/server";
import { stats, playSeconds, addMoney, addShards } from "../data.js";
import { progress } from "../xp.js";
import { money, num } from "../format.js";
import { skillInfo } from "../systems/skills.js";
import { claimsOf, timeLeft as landLeft } from "../systems/landcore.js";
import { clanOf } from "../systems/clans.js";
import { ex } from "./store.js";
import { notice } from "./fxprefs.js";
import { notify } from "./notify.js";
import { UTC_OFFSET_HOURS } from "./config.js";
import { titleView } from "./titlestate.js";

export const DIFF = {
  easy:      { name: "Easy",      color: "§a", ap: 5,   money: 100,   shards: 0 },
  normal:    { name: "Normal",    color: "§e", ap: 15,  money: 3500,   shards: 5 },
  hard:      { name: "Hard",      color: "§6", ap: 30,  money: 10000,  shards: 20 },
  rare:      { name: "Rare",      color: "§b", ap: 60,  money: 30000,  shards: 50 },
  legendary: { name: "Legendary", color: "§d", ap: 100, money: 100000, shards: 150 },
};
export const TIERS = [{ name: "Bronze", color: "§6" }, { name: "Silver", color: "§7" }, { name: "Gold", color: "§e" }, { name: "Diamond", color: "§b" }];

export const CATEGORIES = [
  { id: "mining",  name: "Mining & Building", color: "§b", icon: "textures/items/diamond_pickaxe", text: "Ores, blocks, depth" },
  { id: "skills",  name: "Skills",            color: "§a", icon: "textures/items/iron_axe",        text: "Skill levels" },
  { id: "land",    name: "Land",              color: "§2", icon: "textures/ui/shop/ic_shield",     text: "Protect and grow your land" },
  { id: "economy", name: "Economy",           color: "§6", icon: "textures/items/emerald",         text: "Shop, sales, trade levels" },
  { id: "clan",    name: "Clans",             color: "§c", icon: "textures/items/name_tag",        text: "Create and grow a clan" },
  { id: "explore", name: "Exploration",       color: "§3", icon: "textures/items/ender_pearl",     text: "Travel the world" },
  { id: "combat",  name: "Combat",            color: "§4", icon: "textures/items/iron_sword",      text: "Mobs and players" },
  { id: "general", name: "General",           color: "§d", icon: "textures/items/nether_star",     text: "Playtime, streaks, collections" },
];
export const catOf = (id) => CATEGORIES.find((c) => c.id === id);

const I = {
  buy: "textures/items/diamond", sell: "textures/items/emerald", book: "textures/items/book_writable", gold: "textures/items/gold_ingot",
  pick: "textures/items/iron_pickaxe", block: "textures/ui/shop/i3d_cobblestone", sword: "textures/items/iron_sword", star: "textures/items/nether_star",
  kills: "textures/ui/shop/hud_kills", deaths: "textures/ui/shop/hud_deaths", time: "textures/ui/shop/hud_time", xp: "textures/items/experience_bottle",
  money: "textures/ui/shop/hud_money", dia: "textures/items/diamond", debris: "textures/ui/shop/i3d_ancient_debris",
  emerald: "textures/items/emerald", shield: "textures/ui/shop/ic_shield", tag: "textures/items/name_tag", pearl: "textures/items/ender_pearl",
  eye: "textures/items/ender_eye", bed: "textures/items/bed_red", compass: "textures/items/compass_item",
  elytra: "textures/items/elytra", rod: "textures/items/fishing_rod_uncast", hoe: "textures/items/iron_hoe",
  axe: "textures/items/iron_axe", shovel: "textures/items/iron_shovel", ore: "textures/items/iron_ingot",
};

const st = (p) => ex(p).st, hours = (p) => playSeconds(p) / 3600, S = (k) => (p) => st(p)[k], ST = (k) => (p) => stats(p)[k];
const A = (o) => ({ unit: "", ...o, reward: { money: DIFF[o.diff].money, shards: DIFF[o.diff].shards } });
// chain: steps = [goal, difficulty, name, (id), (extra options)]
const chain = (cat, base, icon, steps, val, descFn, opt = {}) => steps.map(([goal, diff, name, id, extra], i) =>
  A({ id: id ?? base + "_" + (i + 1), cat, name, desc: descFn(goal), icon, goal, val, diff, tier: i, chain: base, ...opt, ...(extra ?? {}) }));

const SK = { mining: "Mining", wood: "Woodcutting", dig: "Excavation", farm: "Farming", fly: "Flying", combat: "Combat", fish: "Fishing", trade: "Trading" };
const SK_ICON = { mining: "textures/items/diamond_pickaxe", wood: I.axe, dig: I.shovel, farm: I.hoe, fly: I.elytra, combat: "textures/items/diamond_sword", fish: I.rod, trade: I.emerald };
const SK_RANK = ["Apprentice", "Adept", "Expert", "Master"];
const lvl = (k) => (p) => { try { return skillInfo(p, k).level; } catch (e) { return 0; } };
const allSkills = (cap) => (p) => Math.min(cap, ...Object.keys(SK).map((k) => lvl(k)(p)));
const maxSkill = (p) => Math.max(0, ...Object.keys(SK).map((k) => lvl(k)(p)));
const claimMemo = new Map();                                       // land claims are looked up many times per check: keep the answer for 1.5 s
const claims = (p) => {
  const m = claimMemo.get(p.id), now = Date.now();
  if (m && now - m.t < 1500) return m.v;
  let v = []; try { v = claimsOf(p.id); } catch (e) { /* ignore */ }
  claimMemo.set(p.id, { t: now, v });
  return v;
};
const sizeRank = (p) => Math.max(0, ...claims(p).map((c) => ({ s: 1, m: 2, l: 3 }[c.s] ?? 1)));
const trusted = (p) => Math.max(0, ...claims(p).map((c) => Object.keys(c.t ?? {}).length));
const clan = (p) => { try { return clanOf(p); } catch (e) { return null; } };
const homes = (p) => (Array.isArray(ex(p).homes) ? ex(p).homes.length : 0);

export const ACHIEVEMENTS = [
  // ============================================================== mining & building
  ...chain("mining", "ore", I.ore, [[100, "easy", "Prospector"], [1000, "normal", "Ore Hunter"], [10000, "hard", "Ore Baron", null, { first: true }], [50000, "rare", "Ore Emperor"]], S("ores"), (g) => `Mine ${num(g)} natural ores`, { unit: "ores" }),
  ...chain("mining", "diamond", I.dia, [[1, "easy", "First Diamond"], [25, "normal", "Diamond Digger"], [100, "hard", "Diamond Hunter"], [500, "rare", "Diamond Tycoon"]], S("diamond"), (g) => `Mine ${num(g)} diamond ore${g > 1 ? "s" : ""}`, { unit: "diamonds" }),
  ...chain("mining", "debris", I.debris, [[1, "normal", "Debris Finder"], [16, "hard", "Debris Hunter"], [64, "rare", "Netherite Seeker"]], S("debris"), (g) => `Mine ${num(g)} Ancient Debris`, { unit: "debris" }),
  ...chain("mining", "emerald", I.emerald, [[1, "easy", "Green Gleam"], [10, "normal", "Emerald Digger"], [50, "hard", "Emerald Baron"]], S("emerald"), (g) => `Mine ${num(g)} emerald ore${g > 1 ? "s" : ""}`, { unit: "emeralds" }),
  ...chain("mining", "miner", I.pick, [[1000, "easy", "Apprentice Miner", "miner_1"], [10000, "normal", "Skilled Miner", "miner_2"], [50000, "hard", "Master Miner", "miner_3"], [250000, "rare", "Legendary Miner", "miner_4"]], S("broken"), (g) => `Break ${num(g)} blocks`, { unit: "blocks" }),
  ...chain("mining", "builder", I.block, [[1000, "easy", "Builder", "builder_1"], [10000, "normal", "Architect", "builder_2"], [50000, "hard", "Master Builder", "builder_3"], [250000, "rare", "Grand Architect", "builder_4"]], S("placed"), (g) => `Place ${num(g)} blocks`, { unit: "blocks" }),
  A({ id: "deep_diver", cat: "mining", name: "Deep Diver", desc: "Go down to Y -50 in the Overworld", icon: I.pick, goal: 1, val: S("deep"), diff: "easy" }),

  // ============================================================== skills
  ...Object.keys(SK).flatMap((k) => chain("skills", k, SK_ICON[k], [[10, "easy", `${SK[k]} ${SK_RANK[0]}`, `${k}_lv10`], [25, "normal", `${SK[k]} ${SK_RANK[1]}`, `${k}_lv25`], [50, "hard", `${SK[k]} ${SK_RANK[2]}`, `${k}_lv50`], [100, "rare", `${SK[k]} ${SK_RANK[3]}`, `${k}_lv100`]], lvl(k), (g) => `Reach ${SK[k]} level ${g}`, { unit: "level" })),
  A({ id: "all_rounder", cat: "skills", name: "All-Rounder", desc: "Reach level 10 in all 8 skills", icon: I.star, goal: 10, val: allSkills(10), diff: "normal", unit: "level (lowest skill)" }),
  A({ id: "grand_master", cat: "skills", name: "Grand Master", desc: "Reach level 50 in all 8 skills", icon: I.star, goal: 50, val: allSkills(50), diff: "legendary", unit: "level (lowest skill)" }),
  A({ id: "skill_legend", cat: "skills", name: "Skill Legend", desc: "Reach level 250 in any skill", icon: I.star, goal: 250, val: maxSkill, diff: "legendary", unit: "level" }),

  // ============================================================== land
  A({ id: "land_first", cat: "land", name: "Home Owner", desc: "Protect your first land", icon: I.shield, goal: 1, val: (p) => claims(p).length, diff: "easy", unit: "lands" }),
  A({ id: "land_trust", cat: "land", name: "Open Doors", desc: "Allow another player inside your land", icon: I.shield, goal: 1, val: trusted, diff: "easy", unit: "players" }),
  A({ id: "land_trust5", cat: "land", name: "Community Host", desc: "Allow 5 players inside one land", icon: I.shield, goal: 5, val: trusted, diff: "normal", unit: "players" }),
  A({ id: "land_med", cat: "land", name: "Growing Estate", desc: "Protect a Medium (or bigger) land", icon: I.shield, goal: 2, val: sizeRank, diff: "normal", kind: "size" }),
  A({ id: "land_large", cat: "land", name: "Territory Lord", desc: "Protect a Large land", icon: I.shield, goal: 3, val: sizeRank, diff: "hard", kind: "size" }),
  A({ id: "land_time", cat: "land", name: "Long Lease", desc: "Hold a land with 23+ hours of protection left", icon: I.shield, goal: 23, val: (p) => Math.floor(Math.max(0, ...claims(p).map((c) => landLeft(c))) / 3600000), diff: "normal", unit: "hours" }),
  A({ id: "land_3", cat: "land", name: "Landlord", desc: "Own 3 protected lands at the same time", icon: I.shield, goal: 3, val: (p) => claims(p).length, diff: "normal", unit: "lands" }),
  A({ id: "land_5", cat: "land", name: "Land Baron", desc: "Own 5 protected lands at the same time", icon: I.shield, goal: 5, val: (p) => claims(p).length, diff: "hard", unit: "lands" }),
  A({ id: "land_10", cat: "land", name: "Land Magnate", desc: "Own 10 protected lands at the same time", icon: I.shield, goal: 10, val: (p) => claims(p).length, diff: "rare", unit: "lands" }),

  // ============================================================== economy
  A({ id: "first_buy", cat: "economy", name: "First Purchase", desc: "Buy an item from the shop", icon: I.buy, goal: 1, val: S("bought"), diff: "easy", unit: "items" }),
  A({ id: "first_sale", cat: "economy", name: "First Sale", desc: "Sell an item to the shop", icon: I.sell, goal: 1, val: S("sold"), diff: "easy", unit: "items" }),
  ...chain("economy", "deals", I.book, [[100, "normal", "Trader", "trader"], [1000, "hard", "Merchant", "merchant"], [10000, "rare", "Market Titan", "trade_10000"]], S("trades"), (g) => `Complete ${num(g)} shop transactions`, { unit: "transactions" }),
  ...chain("economy", "sold", I.sell, [[1000, "easy", "Wholesaler", "sold_1000"], [10000, "normal", "Bulk Seller", "sold_10000"], [100000, "hard", "Mass Exporter", "sold_100000"]], S("sold"), (g) => `Sell ${num(g)} items to the shop`, { unit: "items" }),
  ...chain("economy", "earned", I.money, [[100000, "easy", "Seller", "earn_100k"], [1000000, "normal", "Rich", "rich"], [10000000, "hard", "Wealthy", "earn_10m"], [100000000, "rare", "Tycoon", "tycoon"], [1000000000, "legendary", "Mogul", "mogul"]], ST("earned"), (g) => `Earn ${money(g)} from shop sales`, { kind: "money" }),
  ...chain("economy", "spent", I.gold, [[1000000, "normal", "Big Spender", "big_spender"], [25000000, "hard", "Shopaholic", "spender_2"]], ST("spent"), (g) => `Spend ${money(g)} in the shop`, { kind: "money" }),
  ...["buyer", "seller"].flatMap((t) => chain("economy", t, I.xp, [[10, "easy", t === "buyer" ? "Regular Customer" : "Reliable Supplier", t + "_10"], [25, "normal", t === "buyer" ? "Loyal Customer" : "Trusted Supplier", t + "_25"], [50, "hard", t === "buyer" ? "VIP Customer" : "Master Supplier", t + "_50"], [100, "rare", t === "buyer" ? "Platinum Customer" : "Supply Tycoon", t + "_100"]],
    (p) => progress(stats(p)[t === "buyer" ? "bxp" : "sxp"]).level, (g) => `Reach ${t === "buyer" ? "Buyer" : "Seller"} Level ${g}`, { unit: "level" })),

  // ============================================================== clans
  A({ id: "clan_join", cat: "clan", name: "Clan Member", desc: "Be a member of a clan", icon: I.tag, goal: 1, val: (p) => (clan(p) ? 1 : 0), diff: "easy" }),
  A({ id: "clan_found", cat: "clan", name: "Founder", desc: "Create your own clan", icon: I.tag, goal: 1, val: (p) => { const c = clan(p); return c && c.owner === p.id ? 1 : 0; }, diff: "normal" }),
  A({ id: "clan_full", cat: "clan", name: "Full House", desc: "Be in a clan with 4 or more members", icon: I.tag, goal: 4, val: (p) => { const c = clan(p); return c ? Object.keys(c.members).length : 0; }, diff: "normal", unit: "members" }),

  // ============================================================== exploration
  ...chain("explore", "rtp", I.pearl, [[1, "easy", "First Jump"], [25, "normal", "Wanderer"], [100, "hard", "Globetrotter"], [500, "rare", "Nomad King"]], S("rtp"), (g) => `Use random teleport ${num(g)} time${g > 1 ? "s" : ""}`, { unit: "teleports" }),
  A({ id: "nether_visit", cat: "explore", name: "Into the Fire", desc: "Enter the Nether", icon: "textures/items/flint_and_steel", goal: 1, val: S("nether"), diff: "easy" }),
  A({ id: "end_visit", cat: "explore", name: "The End Awaits", desc: "Enter the End", icon: I.eye, goal: 1, val: S("end"), diff: "hard", first: true }),
  A({ id: "world_traveler", cat: "explore", name: "World Traveler", desc: "Visit the Nether and the End, and use random teleport 50 times", icon: I.compass, goal: 3, val: (p) => (st(p).nether ? 1 : 0) + (st(p).end ? 1 : 0) + (st(p).rtp >= 50 ? 1 : 0), diff: "hard", unit: "of 3 parts" }),
  A({ id: "home_1", cat: "explore", name: "Settled Down", desc: "Set your first home", icon: I.bed, goal: 1, val: homes, diff: "easy", unit: "homes" }),
  A({ id: "home_5", cat: "explore", name: "Home Network", desc: "Have 5 homes at the same time", icon: I.bed, goal: 5, val: homes, diff: "normal", unit: "homes" }),

  // ============================================================== combat
  ...chain("combat", "hunter", I.sword, [[100, "easy", "Monster Hunter", "hunter_1"], [1000, "normal", "Monster Slayer", "hunter_2"], [10000, "hard", "Monster Bane", "hunter_3"], [50000, "rare", "Doom of Monsters", "hunter_4"]], S("mobs"), (g) => `Kill ${num(g)} mobs`, { unit: "mobs" }),
  ...chain("combat", "pvp", I.kills, [[1, "easy", "First Blood", "first_blood"], [25, "normal", "Warrior", "warrior"], [100, "hard", "Executioner", "kills_100"], [500, "rare", "Warlord", "kills_500"]], ST("kills"), (g) => `Kill ${num(g)} player${g > 1 ? "s" : ""}`, { unit: "kills" }),
  A({ id: "unlucky", cat: "combat", name: "Unlucky", desc: "Die 10 times", icon: I.deaths, goal: 10, val: ST("deaths"), diff: "easy", unit: "deaths" }),

  // ============================================================== general
  ...chain("general", "play", I.time, [[10, "easy", "Regular", "regular"], [50, "normal", "Committed Player", "play_50"], [100, "hard", "Veteran", "veteran"], [500, "rare", "Legend", "legend"], [1000, "legendary", "Eternal", "eternal"]], hours, (g) => `Play for ${num(g)} hours`, { unit: "hours" }),
  ...chain("general", "streak", I.star, [[7, "normal", "Dedicated", "streak_7"], [30, "hard", "Committed", "streak_30"], [100, "legendary", "Unbreakable", "streak_100"]], (p) => ex(p).daily.best, (g) => `Reach a ${g} day daily reward streak`, { unit: "days" }),
  ...chain("general", "collector", I.book, [[25, "normal", "Collector", "collector_25"], [60, "hard", "Completionist", "collector_60"], [110, "rare", "Achievement Master", "collector_110"]], (p) => count(p), (g) => `Unlock ${g} achievements`, { unit: "achievements" }),
];

// ---------------------------------------------------------------- lookups
const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const byId = (id) => BY_ID.get(id);
export const rewardText = (r) => [r.money ? "§a" + money(r.money) : "", r.shards ? "§d" + num(r.shards) + " shards" : ""].filter(Boolean).join("§7 + ") || "§7-";
export const fmtVal = (a, v) => (a.kind === "money" ? money(v) : a.kind === "size" ? ["none", "Small", "Medium", "Large"][Math.min(3, Math.floor(v))] : num(v) + (a.unit ? " " + a.unit : ""));
export const isDone = (p, a) => !!ex(p).ach[a.id];
function count(p) { const d = ex(p).ach; let n = 0; for (const a of ACHIEVEMENTS) if (d[a.id]) n++; return n; }
export const achievementCount = (p) => count(p);
export const apOfAch = (a) => DIFF[a.diff].ap;
export const MAX_AP = ACHIEVEMENTS.reduce((s, a) => s + apOfAch(a), 0);

// ---------------------------------------------------------------- AP (computed from the saved data of ANY player, online or offline)
const OFF = UTC_OFFSET_HOURS * 3600000;
const monthKey = (t) => { const d = new Date(t + OFF); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export const monthLabel = (t = Date.now()) => { const d = new Date(t + OFF); return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()] + " " + d.getUTCFullYear(); };
export const apOfData = (d) => { let n = 0; for (const a of ACHIEVEMENTS) if (d.ach?.[a.id]) n += apOfAch(a); return n; };
export const monthApOfData = (d) => { const m = monthKey(Date.now()); let n = 0; for (const a of ACHIEVEMENTS) { const t = d.ach?.[a.id]; if (t && monthKey(t) === m) n += apOfAch(a); } return n; };
export const catDoneOfData = (d, cat) => { let n = 0; for (const a of ACHIEVEMENTS) if (a.cat === cat && d.ach?.[a.id]) n++; return n; };
export const catTotal = (cat) => ACHIEVEMENTS.filter((a) => a.cat === cat).length;
export const apOf = (p) => apOfData(ex(p));

// ---------------------------------------------------------------- titles (once unlocked they are never taken away)
const topCount = (d) => ACHIEVEMENTS.filter((a) => (a.diff === "rare" || a.diff === "legendary") && d.ach?.[a.id]).length;
export const TITLES = [
  { id: "newcomer",       name: "Newcomer",       color: "§7", need: "Everybody has it",                         test: () => true },
  { id: "adventurer",     name: "Adventurer",     color: "§a", need: "Reach 100 AP",                            test: (d) => apOfData(d) >= 100 },
  { id: "veteran_t",      name: "Veteran",        color: "§e", need: "Reach 400 AP",                            test: (d) => apOfData(d) >= 400 },
  { id: "champion",       name: "Champion",       color: "§6", need: "Reach 1,000 AP",                          test: (d) => apOfData(d) >= 1000 },
  { id: "diamond_hunter", name: "Diamond Hunter", color: "§b", need: "Achievement: Diamond Hunter",             test: (d) => !!d.ach?.diamond_3 },
  { id: "pro_trader",     name: "Pro Trader",     color: "§6", need: "Achievement: Rich (earn $1,000,000)",     test: (d) => !!d.ach?.rich },
  { id: "world_explorer", name: "World Explorer", color: "§3", need: "Achievement: World Traveler",             test: (d) => !!d.ach?.world_traveler },
  { id: "land_guardian",  name: "Land Guardian",  color: "§2", need: "Achievement: Territory Lord",             test: (d) => !!d.ach?.land_large },
  { id: "server_legend",  name: "Server Legend",  color: "§d", need: "Unlock 8 Rare or Legendary achievements", test: (d) => topCount(d) >= 8 },
];
export const titleById = (id) => TITLES.find((t) => t.id === id);
export const titleOwned = (p, t) => !!ex(p).titles[t.id];
/** the text of the title the player chose, e.g. "§b[Diamond Hunter]§r"  (empty when none is chosen) */
export function titleTag(p) {
  try { const t = titleById(ex(p).title); return t && ex(p).titles[t.id] && t.id !== "newcomer" ? t.color + "[" + t.name + "]§r" : ""; } catch (e) { return ""; }
}
titleView.tag = titleTag;                                         // the chat code (clans.js) reads it through this bridge
export function selectTitle(p, id) { if (ex(p).titles[id]) ex(p).title = id === "newcomer" ? "" : id; }
function checkTitles(p) {
  const d = ex(p);
  for (const t of TITLES) {
    if (d.titles[t.id] || !t.test(d)) continue;
    d.titles[t.id] = Date.now();
    if (t.id !== "newcomer") notify(p, `§d§l[Title] §r§fNew title unlocked: ${t.color}${t.name} §7(SMP menu > Achievements > Profile)`);
  }
}

// ---------------------------------------------------------------- "first on the server" (saved in the world, never overwritten)
let firstCache = null;
const loadFirst = () => {
  if (firstCache) return firstCache;
  try { const r = world.getDynamicProperty("ach:first"); firstCache = typeof r === "string" ? JSON.parse(r) : {}; } catch (e) { firstCache = {}; }
  return firstCache;
};
export const firstOf = (id) => loadFirst()[id] ?? null;
export const allFirsts = () => loadFirst();
function claimFirst(p, a) {
  const f = loadFirst();
  if (f[a.id]) return false;                                  // somebody was faster
  f[a.id] = { p: p.id, n: p.name, t: Date.now() };
  try { world.setDynamicProperty("ach:first", JSON.stringify(f)); } catch (e) { console.warn("[smp] cannot save first record " + e); }
  return true;
}

// ---------------------------------------------------------------- unlocking
function pay(p, a) { if (a.reward.money) addMoney(p, a.reward.money); if (a.reward.shards) addShards(p, a.reward.shards); }
function unlock(p, a) {
  ex(p).ach[a.id] = Date.now();
  pay(p, a);
  const d = DIFF[a.diff], first = a.first ? claimFirst(p, a) : false, cat = catOf(a.cat);
  notify(p, `§6§l[Achievement] §r${d.color}${a.name} §7- ${rewardText(a.reward)} §7(+${d.ap} AP)` + (first ? " §e★ FIRST ON THE SERVER" : ""));
  try { p.playSound(first || d.ap >= 60 ? "random.toast" : "random.levelup"); } catch (e) { /* ignore */ }
  if (ex(p).set.achTitle !== false) { try { p.onScreenDisplay.setTitle("§6Achievement unlocked", { subtitle: d.color + a.name, fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15 }); } catch (e) { /* ignore */ } }
  try {
    if (first) notice("ach", `§e§l★ [FIRST] §r§f${p.name} §7was the first on the server to unlock §e${a.name}§7 (${cat.name})!`);
    else if (a.diff === "rare" || a.diff === "legendary") notice("ach", `§6[Achievement] §f${p.name} §7unlocked ${d.color}${a.name} §7(${d.name})`);
  } catch (e) { /* ignore */ }
}

/** unlocks finished achievements. A player seen for the first time after this system was installed gets everything he already earned
 *  in one quiet step (one summary message); later unlocks are announced one by one (max 2 per call). */
export function checkAchievements(p, max = 2) {
  const e = ex(p);
  const ready = (a) => { if (e.ach[a.id]) return false; try { return a.val(p) >= a.goal; } catch (err) { return false; } };
  if (!e.achv) {
    let n = 0, m = 0, sh = 0;
    for (let pass = 0; pass < 4; pass++) {                    // several passes: the "collector" achievements depend on the others
      let any = false;
      for (const a of ACHIEVEMENTS) { if (!ready(a)) continue; e.ach[a.id] = Date.now(); pay(p, a); n++; m += a.reward.money; sh += a.reward.shards; any = true; }
      if (!any) break;
    }
    e.achv = 1; checkTitles(p);
    if (n > 0) notify(p, `§6§l[Achievements] §r§fNew achievement system! You had already earned §a${n} §fachievements: §a${money(m)}§7 + §d${num(sh)} shards`);
    return;
  }
  let n = 0;
  for (const a of ACHIEVEMENTS) {
    if (!ready(a)) continue;
    unlock(p, a);
    if (++n >= max) break;
  }
  checkTitles(p);
}

/** very cheap checks done every couple of seconds (depth, dimensions) */
export function sampleWorld(p) {
  const s = ex(p).st;
  try {
    const dim = p.dimension.id;
    if (dim === "minecraft:nether") s.nether = 1;
    else if (dim === "minecraft:the_end") s.end = 1;
    else if (dim === "minecraft:overworld" && p.location.y <= -50) s.deep = 1;
  } catch (e) { /* ignore */ }
}
