// ===================================================================================================================
// SERVER RANKS (VIP):  Silver . Gold . Emerald . Diamond . Netherite . Master . Master II . Master III . Legend
//   Given by the Owner:  /opr > Ranks  (online or offline players; "No rank" takes it away).  Saved in the world.
//
//   Every rank gives:
//     * a BUY discount on everything that is bought with money: /shop items, spawn eggs, spawners, enchant books, potions,
//       /mining tools, Night Vision, Hearts, cosmetics, table passes, land protection ...
//     * a SELL bonus on the items you sell (/shop, /sell, chest sell, sell box)
//   (The Trading skill perks are ADDED to the rank: buy max -75 %, sell max +80 %.)
//
//   Anti-exploit (priceperks.js):
//     * an item that can also be SOLD is never cheaper than (what YOU would get for selling it, with your bonus) + 10 %
//       -> buying and selling again, or buying + crafting + selling, can never make money
//     * items bought from the shop never get the sell bonus (only things you mined, farmed, fished, got from mobs ...)
//     * shard prices are never discounted
//
//   The rank is shown ABOVE THE NAME (a crown in the rank's colours + the rank name) and before the name in the chat.
// ===================================================================================================================
import { world } from "@minecraft/server";
import { clanView } from "./clanstate.js";

// glyphs: RP/font/glyph_E1.png, row 1 (U+E110 .. U+E118): a crown for every rank
export const RANKS = [
  { key: "silver",    name: "SILVER",     color: "§7", buy: 5,  sell: 5,  glyph: "", icon: "textures/items/iron_ingot" },
  { key: "gold",      name: "GOLD",       color: "§6", buy: 10, sell: 10, glyph: "", icon: "textures/blocks/gold_ore" },
  { key: "emerald",   name: "EMERALD",    color: "§a", buy: 15, sell: 15, glyph: "", icon: "textures/blocks/emerald_ore" },
  { key: "diamond",   name: "DIAMOND",    color: "§b", buy: 20, sell: 20, glyph: "", icon: "textures/blocks/diamond_ore" },
  { key: "netherite", name: "NETHERITE",  color: "§c", buy: 25, sell: 25, glyph: "", icon: "textures/blocks/ancient_debris_side" },
  { key: "master",    name: "MASTER",     color: "§e", buy: 30, sell: 30, glyph: "", icon: "textures/blocks/sculk" },
  { key: "master2",   name: "MASTER II",  color: "§d", buy: 40, sell: 40, glyph: "", icon: "textures/blocks/sculk" },
  { key: "master3",   name: "MASTER III", color: "§3", buy: 50, sell: 50, glyph: "", icon: "textures/blocks/sculk" },
  { key: "legend",    name: "LEGEND",     color: "§5", buy: 70, sell: 70, glyph: "", icon: "textures/items/nether_star" },
];
const KEY = "vip:";
const cache = new Map();                          // player id -> index | -1
export function rankIndexOf(id) {
  if (cache.has(id)) return cache.get(id);
  let i = -1;
  try { const v = world.getDynamicProperty(KEY + id); if (typeof v === "number" && v >= 0 && v < RANKS.length) i = v; } catch (e) { i = -1; }
  cache.set(id, i);
  return i;
}
/** the rank of a player (or id): a RANKS entry, or null */
export const rankOf = (pOrId) => { const i = rankIndexOf(typeof pOrId === "string" ? pOrId : pOrId?.id); return i >= 0 ? RANKS[i] : null; };
/** sets (index 0..8) or removes (-1 / null) the rank of a player id */
export function setRank(id, idx) {
  const i = Number.isInteger(idx) && idx >= 0 && idx < RANKS.length ? idx : -1;
  try { world.setDynamicProperty(KEY + id, i >= 0 ? i : undefined); } catch (e) { return false; }
  cache.set(id, i);
  try { const p = world.getAllPlayers().find((q) => q.id === id); if (p) clanView.applyTag(p); } catch (e) { /* ignore */ }
  return true;
}
export const rankBuyPct = (p) => { try { return rankOf(p)?.buy ?? 0; } catch (e) { return 0; } };
export const rankSellPct = (p) => { try { return rankOf(p)?.sell ?? 0; } catch (e) { return 0; } };
/** the rank's name in its colours ("LEGEND" = gold + purple) */
export function rankLabel(r) {
  if (!r) return "§7No rank";
  if (r.key === "legend") return "§6§lLE§d§lGE§5§lND§r";
  return r.color + "§l" + r.name + "§r";
}
/** the line above the name: the crown + the rank */
export const rankBadge = (r) => (r ? "§f" + r.glyph + " " + rankLabel(r) : "");
/** every player who has a rank: [{ id, idx }] */
export function rankedIds() {
  const out = [];
  try { for (const k of world.getDynamicPropertyIds()) if (k.startsWith(KEY)) { const id = k.slice(KEY.length), i = rankIndexOf(id); if (i >= 0) out.push({ id, idx: i }); } } catch (e) { /* ignore */ }
  return out;
}
clanView.vipBadge = (p) => rankBadge(rankOf(p));
clanView.vipChat = (p) => { const r = rankOf(p); return r ? "§f" + r.glyph + rankLabel(r) : ""; };
