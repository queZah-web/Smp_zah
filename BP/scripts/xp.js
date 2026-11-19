// Trade levels: separate Buyer and Seller tracks (1 -> 999). 1 xp per item (+1 per $1000 of item price).
import { stats, addMoney } from "./data.js";
import { give } from "./inv.js";
import { money } from "./format.js";

export const MAX_LEVEL = 999;
export const xpToReach = (L) => 100 * (L - 1) + 5 * (L - 1) * (L - 2);     // total xp needed to be at level L
export const needFor = (L) => 100 + 10 * (L - 1);                          // xp to go from L to L+1 (100, 110, 120, ...)
export function levelOf(xp) {
  const x = Math.floor((-95 + Math.sqrt(9025 + 20 * xp)) / 10);
  return Math.min(MAX_LEVEL, Math.max(1, x + 1));
}
export function progress(xp) {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, max: true };
  return { level, into: xp - xpToReach(level), need: needFor(level), max: false };
}
export const xpPerUnit = (price) => Math.min(50, 1 + Math.floor(price / 1000));

const BUY_GIFTS = [["cooked_beef", 16], ["iron_ingot", 16], ["gold_ingot", 16], ["diamond", 2], ["emerald", 8], ["ender_pearl", 8], ["golden_apple", 4], ["diamond", 8], ["netherite_scrap", 2], ["experience_bottle", 32], ["enchanted_golden_apple", 1], ["netherite_ingot", 1]];
const SELL_GIFTS = [["bread", 32], ["coal", 32], ["redstone", 32], ["lapis_lazuli", 32], ["gold_ingot", 8], ["diamond", 1], ["emerald", 4], ["obsidian", 16], ["blaze_rod", 8], ["ender_pearl", 8], ["diamond", 4], ["netherite_scrap", 1]];

/** reward for reaching level L on a track ("b" or "s"): money every level, an item gift every 10 levels (grows with level) */
export function reward(track, L) {
  const r = { money: 100 + 5 * L, gift: null };
  if (L % 10 === 0) {
    const list = track === "b" ? BUY_GIFTS : SELL_GIFTS, m = L / 10;
    const [id, base] = list[(m - 1) % list.length];
    r.gift = [id, base * (1 + Math.floor((m - 1) / list.length))];
  }
  return r;
}
export const rewardText = (r) => "§a" + money(r.money) + (r.gift ? " §7+ §f" + r.gift[1] + "x " + r.gift[0].split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : "");

export function addXp(p, track, amount) {
  if (amount <= 0) return;
  const s = stats(p), key = track === "b" ? "bxp" : "sxp";
  const before = levelOf(s[key]); s[key] += Math.floor(amount); const after = levelOf(s[key]);
  const name = track === "b" ? "Buyer" : "Seller";
  for (let L = before + 1; L <= after; L++) {
    const r = reward(track, L);
    addMoney(p, r.money); if (r.gift) give(p, r.gift[0], r.gift[1]);
    p.sendMessage(`§6§l[${name} Level ${L}] §r§7Reward: ${rewardText(r)}`);
    p.playSound("random.levelup");
  }
}
