// Timber + Vein Miner (both need SNEAK held, survival mode only).
//  Timber:     sneak + AXE on a log      -> the whole connected tree of the SAME wood in ONE hit (TIMBER_MAX is only a safety cap).  Logs that a PLAYER placed are never cut (placedlogs.js).
//  Vein Miner: sneak + PICKAXE on an ore -> every touching block of the SAME ore (max VEIN_MAX) - never other ores next to it.
//              Works on all ores, honours Fortune / Silk Touch / Unbreaking, gives the normal XP.
// The block you break yourself is handled by the game as usual; this only breaks the extra blocks.
//
// Paid extras (all switched from /menu -> Mining Tools):
//  (Timber x2 was removed: Timber now cuts the whole tree.  Time already bought for "t40" is counted as Timber time - see timeLeft.)
//  Auto-Smelt (key "smelt"): ore drops come out as ingots (raw iron -> iron ingot, raw gold -> gold ingot, raw copper -> copper ingot, ancient debris -> netherite scrap).
//      Works for the block you break, Vein Miner and Area Mining. Fortune still counts. Silk Touch keeps the ore block itself.
//  Magnet (key "magnet"): see magnet.js - dropped items gather under the player and follow him (MAGNET_RANGE blocks).
//  Magnet + Auto-Smelt are sold in ONE pack (30 minutes) and you can hold at most 30 minutes (config.js: packs / maxMin).
//
// NEW - every player can switch these from /menu -> Mining Tools (or /mining):
//  Timber, Vein Miner (default ON, exactly as before) and Area Mining 3x3 / 5x5 (default OFF).
//  Area Mining: PICKAXE on stone-type AND dirt-type blocks / SHOVEL on dirt-type blocks, NOT sneaking -> breaks a 3x3 or 5x5 square
//  around the block (the square faces you). Sneak while breaking = one block only.
//  PICKAXE looking DOWN or UP -> a narrow trench: a row of 3 (or 5) blocks left/right of the block under the crosshair, going 3 (or 5)
//  layers down (or up) (AREA_DEPTH, config.js): dirt, stone, ores... never wood. Sideways = the normal square.
import { world, system, ItemStack, GameMode } from "@minecraft/server";
import { TIMBER_MAX, TIMBER_MAX2, VEIN_MAX, MINING_MAX_HOURS, MINING_PASS, AREA_DEPTH } from "./config.js";
import { ex } from "../smp/store.js";
import { skillExtra } from "./skills.js";
import { atLimit } from "./specialtool.js";      // upgraded (special) tools never break
import { luxArea, luxVein, luxTimber } from "../lux.js";
import { realOf } from "./axrids.js";
import { isPlacedLog } from "./placedlogs.js";      // logs that players placed (houses ...) are never cut by Timber
import { canEditBlock } from "./landcore.js";
import { xryActive, xryReveal } from "./xrylink.js";     // Anti X-Ray (XryGuard): uncover hidden ores before extra blocks are broken          // land protection: extra blocks inside protected land are never broken

/** per-player switches (stored with the player's settings) */
export function miningOpts(p) {
  const s = ex(p).set;
  return { timber: s.timber !== false || s.tx === true, t40: false, vein: s.vein !== false, area: s.area === 3 || s.area === 5 ? s.area : 0, chest: s.chest === true, magnet: s.mag !== false, smelt: s.smelt !== false };
}
export function setMiningOpt(p, key, value) { ex(p).set[key] = value; }
/** Timber mode: 0 = off, 20 = normal Timber, 40 = Timber x2 (the two exclude each other) */
export function setTimberMode(p, mode) { const s = ex(p).set; s.timber = mode === 20; s.tx = mode === 40; }

// ---- paid time: Timber ("timber"), Timber x2 ("t40"), Area 3x3 ("a3"), Area 5x5 ("a5"), Chest Sell ("chest"), Magnet ("magnet"), Auto-Smelt ("smelt").
//      Saved as an absolute end date (real time, also runs while offline).
const HOUR = 3600000;
const mpass = (p) => (ex(p).mpass ??= {});
/** ms of paid time left for "timber" | "a3" | "a5" */
export function timeLeft(p, key) {
  const left = (k) => Math.max(0, (mpass(p)[k] ?? 0) - Date.now());
  return key === "timber" ? left("timber") + left("t40") : left(key);       // Timber x2 is gone (Timber cuts the whole tree now): time that was already bought for it counts as Timber time
}
/** how many whole hours can still be added without going over the maximum */
export function hoursFit(p, key) { return Math.max(0, Math.floor((MINING_MAX_HOURS * HOUR - timeLeft(p, key)) / HOUR)); }
/** adds `n` hours (the caller has already checked hoursFit and taken the money) */
export function addHours(p, key, n) { const d = mpass(p); d[key] = Math.max(Date.now(), d[key] ?? 0) + n * HOUR; }
// prices set by an admin (/mining -> Set prices): saved in ONE world property "miningprice" = { key: { price, p60, p360 } } (only what differs from config.js).
// Nothing saved = the prices in config.js.  Same price for every player.
const MP = "miningprice", MP_FIELD = { 30: "price", 60: "p60", 360: "p360" };
export const MINING_MAX_PRICE = 10000000;
const MP_BASE = {};
for (const k of Object.keys(MINING_PASS)) MP_BASE[k] = { price: MINING_PASS[k].price, p60: MINING_PASS[k].p60, p360: MINING_PASS[k].p360 };
let mpLoaded = false;
function priceLoad() {          // lazy: world data can't be read while the script is starting
  if (mpLoaded) return;
  try {
    const raw = world.getDynamicProperty(MP);
    mpLoaded = true;
    if (typeof raw !== "string") return;
    const v = JSON.parse(raw);
    for (const k of Object.keys(MINING_PASS)) for (const f of Object.values(MP_FIELD)) {
      if (MP_BASE[k][f] === undefined) continue;                      // this tool does not sell that pack
      const n = Math.floor(Number(v?.[k]?.[f]));
      if (Number.isFinite(n) && n >= 1 && n <= MINING_MAX_PRICE) MINING_PASS[k][f] = n;
    }
  } catch (e) { /* unreadable: normal prices */ }
}
function priceSave() {          // writes only the prices that differ from config.js; throws if the game refuses
  const out = {};
  for (const k of Object.keys(MINING_PASS)) for (const f of Object.values(MP_FIELD)) if (MP_BASE[k][f] !== undefined && MINING_PASS[k][f] !== MP_BASE[k][f]) (out[k] ??= {})[f] = MINING_PASS[k][f];
  world.setDynamicProperty(MP, Object.keys(out).length ? JSON.stringify(out) : undefined);
}
/** the normal price (config.js) of a pack */
export const basePriceOf = (key, min = 30) => MP_BASE[key][MP_FIELD[min]];
/** v = { 30, 60, 360 } (only the packs this tool sells) -> new prices.  Returns an error text, or null when saved. */
export function setPrices(key, v) {
  if (!MINING_PASS[key]) return "Unknown tool.";
  priceLoad();
  const next = {};
  for (const m of packsOf(key)) {
    const n = Math.floor(Number(v[m]));
    if (!Number.isFinite(n) || n < 1 || n > MINING_MAX_PRICE) return "Prices must be whole numbers from 1 to " + MINING_MAX_PRICE + ".";
    next[MP_FIELD[m]] = n;
  }
  const prev = { ...MINING_PASS[key] };
  Object.assign(MINING_PASS[key], next);
  try { priceSave(); } catch (e) { Object.assign(MINING_PASS[key], prev); return "Could not save it."; }
  return null;
}
/** back to the normal prices: one tool (key) or all of them (no key).  Returns an error text, or null when saved. */
export function resetPrices(key) {
  priceLoad();
  const keys = key ? [key] : Object.keys(MINING_PASS);
  if (key && !MINING_PASS[key]) return "Unknown tool.";
  const prev = {};
  for (const k of keys) { prev[k] = { ...MINING_PASS[k] }; for (const f of Object.values(MP_FIELD)) if (MP_BASE[k][f] !== undefined) MINING_PASS[k][f] = MP_BASE[k][f]; }
  try { priceSave(); } catch (e) { for (const k of keys) Object.assign(MINING_PASS[k], prev[k]); return "Could not save it."; }
  return null;
}
/** price of a pack: 30 (default), 60 or 360 minutes */
export const priceOf = (key, min = 30) => { priceLoad(); return min === 360 ? MINING_PASS[key].p360 : min === 60 ? MINING_PASS[key].p60 : MINING_PASS[key].price; };
/** the packs (minutes) that can be bought for this key: 30 / 60 / 360, or only 30 (Magnet, Auto-Smelt) */
export const packsOf = (key) => MINING_PASS[key].packs ?? [30, 60, 360];
/** most minutes a player can hold of this key (6 hours, or 30 minutes for Magnet / Auto-Smelt) */
export const maxMinOf = (key) => MINING_PASS[key].maxMin ?? MINING_MAX_HOURS * 60;
/** can `min` more minutes be added without going over the maximum?  (also false when the pack is not sold for this key) */
export const fitsMin = (p, key, min) => packsOf(key).includes(min) && timeLeft(p, key) + min * 60000 <= maxMinOf(key) * 60000;
export function addMinutes(p, key, min) { const d = mpass(p); d[key] = Math.max(Date.now(), d[key] ?? 0) + min * 60000; }
// ---- OWNER SWITCH: an ability switched OFF here stops working for EVERYBODY (the menu page for it is owner-only: miningmenu.js).
//      Saved in ONE world property "miningoff" = ["a5", "magnet", ...].  Paid time keeps running while an ability is off (nobody can buy it meanwhile).
export const ABILITY_KEYS = ["timber", "a3", "a5", "chest", "smelt", "vein", "magnet"];
const OFF_KEY = "miningoff";
let offSet = null;
function offLoad() {                                  // lazy: world data can't be read while the script is starting
  if (offSet) return offSet;
  try {
    const raw = world.getDynamicProperty(OFF_KEY), a = typeof raw === "string" ? JSON.parse(raw) : [];
    offSet = new Set(Array.isArray(a) ? a.filter((k) => ABILITY_KEYS.includes(k)) : []);
    return offSet;
  } catch (e) { return null; }                        // never overwrite what is saved when it could not be read
}
/** true = the Owner switched this ability off for everybody */
export const abilityOff = (key) => { const s = offLoad(); return !!s && s.has(key); };
/** switches an ability off / on for everybody (the caller has checked that he is the Owner).  Returns false when it could not be saved. */
export function setAbilityOff(key, off) {
  if (!ABILITY_KEYS.includes(key)) return false;
  const s = offLoad(); if (!s) return false;
  const had = s.has(key);
  if (off) s.add(key); else s.delete(key);
  try { world.setDynamicProperty(OFF_KEY, JSON.stringify([...s])); return true; } catch (e) { if (had) s.add(key); else s.delete(key); return false; }
}

/** what really works right now = the player's switches AND paid time left (Vein Miner and Magnet are free) AND the Owner has not switched it off */
export function activeOpts(p) {
  const o = miningOpts(p), off = (k) => abilityOff(k);
  const t40 = false, t20 = o.timber && !off("timber") && timeLeft(p, "timber") > 0;
  return {
    timber: t20,                              // Timber works (the whole tree)
    t20, t40, tmax: TIMBER_MAX,
    vein: o.vein && !off("vein"),
    area: o.area === 3 && !off("a3") && timeLeft(p, "a3") > 0 ? 3 : o.area === 5 && !off("a5") && timeLeft(p, "a5") > 0 ? 5 : 0,
    chest: o.chest && !off("chest") && timeLeft(p, "chest") > 0,
    magnet: o.magnet && !off("magnet"),       // Magnet is FREE: only the player's own switch (ON by default) and the Owner's switch
    smelt: o.smelt && !off("smelt") && timeLeft(p, "smelt") > 0,
  };
}

const idOf = (typeId) => realOf(typeId).replace("minecraft:", "");     // a hidden (Anti X-Ray) ore counts as the real ore
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const OFFS = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) OFFS.push([dx, dy, dz]);

// ---------------------------------------------------------------- tree species / ore families
const LOG = /^(?:stripped_)?(.+?)_(?:log|wood|stem|hyphae)$/;
const species = (id) => { const m = LOG.exec(id); return m ? m[1] : null; };

// tier = pickaxe tier needed (0 wood/gold, 1 stone, 2 iron, 3 diamond, 4 netherite)
const ORE = {
  coal_ore:          { tier: 0, drop: "coal", xp: [0, 2], fortune: "mult" },
  copper_ore:        { tier: 1, drop: "raw_copper", cnt: [2, 5], fortune: "mult" },
  iron_ore:          { tier: 1, drop: "raw_iron", fortune: "mult" },
  gold_ore:          { tier: 2, drop: "raw_gold", fortune: "mult" },
  lapis_ore:         { tier: 1, drop: "lapis_lazuli", cnt: [4, 9], xp: [2, 5], fortune: "mult" },
  redstone_ore:      { tier: 2, drop: "redstone", cnt: [4, 5], xp: [1, 5], fortune: "add" },
  diamond_ore:       { tier: 2, drop: "diamond", xp: [3, 7], fortune: "mult" },
  emerald_ore:       { tier: 2, drop: "emerald", xp: [3, 7], fortune: "mult" },
  nether_gold_ore:   { tier: 0, drop: "gold_nugget", cnt: [2, 6], xp: [0, 1], fortune: "mult" },
  quartz_ore:        { tier: 0, drop: "quartz", xp: [2, 5], fortune: "mult" },
  nether_quartz_ore: { tier: 0, drop: "quartz", xp: [2, 5], fortune: "mult" },
  ancient_debris:    { tier: 3, drop: "ancient_debris" },
};
// deepslate_coal_ore -> coal_ore,  lit_deepslate_redstone_ore -> redstone_ore  (same ore, different depth)
const family = (id) => id.replace(/^lit_/, "").replace(/^deepslate_/, "");
const oreOf = (id) => ORE[family(id)] ?? null;
// Auto-Smelt: what an ore drop becomes (the same count, Fortune already applied)
const SMELT = { raw_iron: "iron_ingot", raw_gold: "gold_ingot", raw_copper: "copper_ingot", ancient_debris: "netherite_scrap" };
/** the item an ore really drops: the ingot when Auto-Smelt is on, otherwise the normal drop */
const dropOf = (o, smelt) => (smelt && SMELT[o.drop]) || o.drop;
const TIER = { wooden: 0, golden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };
const toolTier = (tid) => TIER[tid.split("_")[0]] ?? -1;

// ---------------------------------------------------------------- tool helpers
const enchLevel = (item, name) => { try { return item.getComponent("enchantable")?.getEnchantment(name)?.level ?? 0; } catch (e) { return 0; } };

/** one block of durability (Unbreaking aware). returns false when the tool is gone (stop mining) */
function wear(player, toolId) {
  try {
    const c = player.getComponent("inventory").container, slot = player.selectedSlotIndex, item = c.getItem(slot);
    if (!item || item.typeId !== toolId) return false;
    if (atLimit(item, 1)) return false;                // special tool: stop before it could break
    const d = item.getComponent("durability");
    if (!d) return true;
    if (Math.random() < 1 / (enchLevel(item, "unbreaking") + 1)) {
      if (d.damage + 1 >= d.maxDurability) { c.setItem(slot, undefined); try { player.playSound("random.break"); } catch (e) { /* ignore */ } return false; }
      d.damage += 1; c.setItem(slot, item);
    }
    return true;
  } catch (e) { return false; }
}

function collect(dim, start, match, max) {
  const seen = new Set([start.x + "," + start.y + "," + start.z]), queue = [start], out = [];
  while (queue.length && out.length < max) {
    const c = queue.shift();
    for (const [dx, dy, dz] of OFFS) {
      const p = { x: c.x + dx, y: c.y + dy, z: c.z + dz }, k = p.x + "," + p.y + "," + p.z;
      if (seen.has(k)) continue;
      seen.add(k);
      let b; try { b = dim.getBlock(p); } catch (e) { continue; }
      if (!b || !match(b)) continue;
      out.push(b); queue.push(p);
      if (out.length >= max) break;
    }
  }
  return out;
}
/** drops pop out of the broken block like in vanilla (small random hop), then you absorb them when you get close.
 *  Before this, the extra blocks' drops (ores, silk touch, trees, veins) just fell dead at the block centre. Never throws. */
function pop(item) {
  try { item.applyImpulse({ x: (Math.random() - 0.5) * 0.16, y: 0.18 + Math.random() * 0.06, z: (Math.random() - 0.5) * 0.16 }); } catch (e) { /* ignore */ }
}
function spawn(dim, b, itemId, n) {
  const at = { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
  while (n > 0) { const k = Math.min(n, 64); try { pop(dim.spawnItem(new ItemStack(itemId.includes(":") ? itemId : "minecraft:" + itemId, k), at)); } catch (e) { /* ignore */ } n -= k; }
}

// ---------------------------------------------------------------- timber
function timber(player, block, brokenId, toolId, max = TIMBER_MAX) {
  const dim = block.dimension, sp = species(brokenId);
  const logs = collect(dim, block.location, (b) => species(idOf(b.typeId)) === sp && canEditBlock(player, b) && !isPlacedLog(dim, b.location), max - 1);
  for (const b of logs) {
    const id = idOf(b.typeId);
    if (!wear(player, toolId)) break;
    skillExtra(player, toolId, id, b);
    spawn(dim, b, id, 1);
    b.setType("minecraft:air");
  }
  if (logs.length) luxTimber(player, block, logs);
}

// ---------------------------------------------------------------- vein miner
function vein(player, block, brokenId, tool, smelt = false) {
  const dim = block.dimension, fam = family(brokenId), o = ORE[fam];
  const silk = enchLevel(tool, "silk_touch") > 0, fort = enchLevel(tool, "fortune");
  const blocks = collect(dim, block.location, (b) => family(idOf(b.typeId)) === fam && canEditBlock(player, b), VEIN_MAX - 1);
  let xp = 0;
  for (const b of blocks) {
    const id = idOf(b.typeId);
    if (!wear(player, tool.typeId)) break;
    skillExtra(player, tool.typeId, id, b);
    if (silk) spawn(dim, b, id.replace(/^lit_/, ""), 1);
    else {
      let n = o.cnt ? rnd(o.cnt[0], o.cnt[1]) : 1;
      if (o.fortune === "mult" && fort > 0) n *= Math.max(1, rnd(0, fort + 1));
      else if (o.fortune === "add" && fort > 0) n += rnd(0, fort);
      spawn(dim, b, dropOf(o, smelt), n);
      if (o.xp) xp += rnd(o.xp[0], o.xp[1]);
    }
    b.setType("minecraft:air");
  }
  if (xp > 0) { try { player.addExperience(xp); } catch (e) { /* ignore */ } }
  if (blocks.length) luxVein(player, block, blocks, brokenId);
}

// ---------------------------------------------------------------- area mining (3x3 / 5x5)
const NEVER = /^(bedrock|barrier|command_block|chain_command_block|repeating_command_block|structure_block|structure_void|jigsaw|end_portal|end_portal_frame|end_gateway|reinforced_deepslate|mob_spawner|trial_spawner|smp:spawner_[a-z_]+|vault|obsidian|crying_obsidian|respawn_anchor|light_block.*|allow|deny|border_block|water|lava|flowing_water|flowing_lava|portal|heavy_core)$/;
const PICK_RE = /(^|_)(stone|cobblestone|deepslate|andesite|diorite|granite|tuff|calcite|netherrack|basalt|blackstone|sandstone|terracotta|bricks|end_stone|prismarine|dripstone_block|ice)(_|$)|_ore$|^ancient_debris$|_concrete$/;
const SHOVEL_RE = /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|dirt_path|farmland|sand|red_sand|gravel|clay|mud|snow|snow_layer|soul_sand|soul_soil|suspicious_sand|suspicious_gravel|.*_concrete_powder)$/;

/** does this tool break this block the "right" way? (uses the game's block tags, plus a name list as backup) */
function suits(b, kind) {
  const id = idOf(b.typeId);
  if (NEVER.test(id) || b.isAir || b.isLiquid) return false;
  try { if (b.hasTag("minecraft:is_" + kind + "_item_destructible")) return true; } catch (e) { /* ignore */ }
  return kind === "pickaxe" ? PICK_RE.test(id) : SHOVEL_RE.test(id);
}
const hasInventory = (b) => { try { return !!b.getComponent("minecraft:inventory"); } catch (e) { return false; } };

function area(player, block, brokenId, tool, size, smelt = false) {
  const tid = idOf(tool.typeId), kind = tid.endsWith("_pickaxe") ? "pickaxe" : tid.endsWith("_shovel") ? "shovel" : null;
  if (!kind) return;
  // the block you broke must suit the tool: a pickaxe now takes stone-type, ores AND dirt-type blocks, a shovel only dirt-type
  const dirtType = SHOVEL_RE.test(brokenId);
  if (kind === "pickaxe" ? !(PICK_RE.test(brokenId) || oreOf(brokenId) || dirtType) : !dirtType) return;
  const dim = block.dimension, d = player.getViewDirection();
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  const axis = ay >= ax && ay >= az ? "y" : ax >= az ? "x" : "z";       // the face you are mining
  const shaft = kind === "pickaxe" && axis === "y";                     // pickaxe looking DOWN or UP -> a narrow trench straight down / up
  const dirY = d.y < 0 ? -1 : 1;
  const depth = shaft ? Math.max(1, Math.min(AREA_DEPTH[size] ?? size, 5)) : 1;
  let minY = -64, maxY = 320; try { minY = dim.heightRange.min; maxY = dim.heightRange.max; } catch (e) { /* ignore */ }
  const ok = (b) => (kind === "pickaxe" ? suits(b, "pickaxe") || suits(b, "shovel") : suits(b, "shovel"));   // never logs / planks / other wood
  const r = (size - 1) / 2, silk = enchLevel(tool, "silk_touch") > 0, fort = enchLevel(tool, "fortune");
  // cells to break.  Shaft: ONE row of `size` blocks left/right of the block under the crosshair, going `depth` layers down (or up when you look up).
  //                  Normal: the square around the block, facing you (as before).
  const cells = [];
  if (shaft) {
    const rowX = az >= ax;                                               // facing along z -> the row runs along x (your left/right), and the other way round
    for (let k = 0; k < depth; k++) for (let u = -r; u <= r; u++) {
      if (!k && !u) continue;                                            // the block you broke yourself
      cells.push(rowX ? { x: block.x + u, y: block.y + dirY * k, z: block.z } : { x: block.x, y: block.y + dirY * k, z: block.z + u });
    }
  } else {
    for (let u = -r; u <= r; u++) for (let v = -r; v <= r; v++) {
      if (!u && !v) continue;
      cells.push(axis === "y" ? { x: block.x + u, y: block.y, z: block.z + v } : axis === "x" ? { x: block.x, y: block.y + u, z: block.z + v } : { x: block.x + u, y: block.y + v, z: block.z });
    }
  }
  let xp = 0; const broke = [];
  for (const p of cells) {
    if (p.y < minY || p.y >= maxY) continue;
    let b; try { b = dim.getBlock(p); } catch (e) { continue; }
    if (!b || !ok(b) || hasInventory(b) || !canEditBlock(player, b)) continue;
    const id = idOf(b.typeId), o = oreOf(id);
    if (o && toolTier(tid) < o.tier) continue;                           // pickaxe too weak for this ore
    if (!wear(player, tool.typeId)) break;                               // tool broke -> stop everything
    skillExtra(player, tool.typeId, id, b);
    try {
      if (o) {
        if (silk) spawn(dim, b, id.replace(/^lit_/, ""), 1);
        else {
          let n = o.cnt ? rnd(o.cnt[0], o.cnt[1]) : 1;
          if (o.fortune === "mult" && fort > 0) n *= Math.max(1, rnd(0, fort + 1));
          else if (o.fortune === "add" && fort > 0) n += rnd(0, fort);
          spawn(dim, b, dropOf(o, smelt), n);
          if (o.xp) xp += rnd(o.xp[0], o.xp[1]);
        }
        b.setType("minecraft:air");
      } else if (silk) {
        const st = b.getItemStack(1, true);
        if (st) pop(dim.spawnItem(st, { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 }));
        b.setType("minecraft:air");
      } else dim.runCommand("setblock " + b.x + " " + b.y + " " + b.z + " air [] destroy");   // normal drops
      broke.push(b);
    } catch (e) { /* ignore this block */ }
  }
  if (xp > 0) { try { player.addExperience(xp); } catch (e) { /* ignore */ } }
  if (broke.length) {
    const step = Math.ceil(broke.length / 28), shown = step > 1 ? broke.filter((_, i) => i % step === 0) : broke;   // keep the particle show light for deep shafts
    luxArea(player, block, size, shown, axis, d[axis] > 0 ? -1 : 1);
  }
}

// ---------------------------------------------------------------- Auto-Smelt for the block you break yourself
// The game drops the raw ore by itself; one tick later the raw drops next to the broken block are swapped for the ingots (same count).
function smeltOwn(player, block, brokenId, tool) {
  const o = oreOf(brokenId), tid = idOf(tool.typeId);
  if (!o || !SMELT[o.drop] || !tid.endsWith("_pickaxe") || toolTier(tid) < o.tier || enchLevel(tool, "silk_touch") > 0) return;
  const dim = block.dimension, at = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }, raw = "minecraft:" + o.drop;
  system.run(() => {
    try {
      for (const e of dim.getEntities({ type: "minecraft:item", location: at, maxDistance: 1.6 })) {
        let st; try { st = e.getComponent("item")?.itemStack; } catch (err) { continue; }
        if (!st || st.typeId !== raw) continue;
        const n = st.amount, l = e.location;
        try { e.remove(); } catch (err) { continue; }
        spawn(dim, { x: l.x - 0.5, y: l.y - 0.5, z: l.z - 0.5 }, SMELT[o.drop], n);
      }
    } catch (err) { /* ignore */ }
  });
}

// ---------------------------------------------------------------- event
const busy = new Set();
/** with the Anti X-Ray (XryGuard) on: the hidden ores around are uncovered first, the extra blocks are broken 2 ticks later
 *  (so a hidden ore is never broken as stone).  Without it: at once, as before. */
function later(player, block, r, fn) {
  if (!xryActive()) return fn();
  xryReveal(block.dimension, block.location, r);
  system.runTimeout(() => {
    if (busy.has(player.id)) return;
    busy.add(player.id);
    try { if (player.isValid) fn(); } catch (e) { console.warn("[mining] " + e); }
    finally { busy.delete(player.id); }
  }, 2);
}
try {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    const { player, block, brokenBlockPermutation: perm, itemStackBeforeBreak: tool } = ev;
    if (!tool || busy.has(player.id)) return;
    const sneaking = player.isSneaking, opt = activeOpts(player);
    if (opt.smelt) { try { if (player.getGameMode() === GameMode.Survival) smeltOwn(player, block, idOf(perm.type.id), tool); } catch (e) { /* ignore */ } }
    if (sneaking ? !(opt.timber || opt.vein) : !opt.area) return;       // nothing switched on for this situation
    busy.add(player.id);
    try {
      if (player.getGameMode() !== GameMode.Survival) return;
      const id = idOf(perm.type.id), tid = idOf(tool.typeId);
      if (sneaking) {
        if (tid.endsWith("_axe") && species(id)) { if (opt.timber && !isPlacedLog(block.dimension, block.location)) timber(player, block, id, tool.typeId, opt.tmax); }
        else if (tid.endsWith("_pickaxe")) { if (opt.vein) { const o = oreOf(id); if (o && toolTier(tid) >= o.tier) later(player, block, 5, () => vein(player, block, id, tool, opt.smelt)); } }
      } else if (opt.area && (tid.endsWith("_pickaxe") || tid.endsWith("_shovel"))) later(player, block, opt.area + 1, () => area(player, block, id, tool, opt.area, opt.smelt));
    } catch (e) { console.warn("[mining] " + e); }
    finally { busy.delete(player.id); }
  });
} catch (e) { console.warn("[mining] cannot start: " + e); }
