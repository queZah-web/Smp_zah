// STACKED SPAWNERS - data and rules (pure: no game imports, so it can be tested outside Minecraft).
// Every number you may want to tune is in this file.
//
// How it works: a spawner is one custom block per mob (smp:spawner_<mob>). It spawns NOTHING. It only remembers how many are stacked
// and when it was last opened; the loot of the elapsed time is rolled when the owner opens it (so no timers, no loaded chunks, no lag).

export const TYPE_PREFIX = "smp:spawner_";
// The 4 numbers below + the per-mob speeds can be changed IN GAME by the Owner (Operator > Server & staff > Spawner settings, see systems/spawnercfg.js).
// They are "let" on purpose: other files read them as D.MAX_STACK etc. and always see the current value.
export const DEFAULTS = { rate: 150, storage: 12, stack: 100, animal: 0.5 };
export let RATE_PER_HOUR = DEFAULTS.rate;      // kills per hour for ONE spawner (a stack of 10 makes 10x)
export let STORAGE_HOURS = DEFAULTS.storage;   // a spawner stops producing once it holds this many hours of loot - the owner must come and collect
export let MAX_STACK = DEFAULTS.stack;         // most spawners one block can hold
export let ANIMAL_FACTOR = DEFAULTS.animal;    // animals (see SLOW) make this share of RATE_PER_HOUR
export const OVERRIDE = {};                    // { mob id: kills per hour for ONE spawner }  - beats RATE_PER_HOUR / ANIMAL_FACTOR for that mob
export const LIMITS = { rate: [1, 100000], storage: [1, 720], stack: [1, 10000], animal: [0.01, 10], mob: [1, 100000] };
export const OLD_SPAWNERS = "remove";  // vanilla mob spawners already in the world: "remove" = deleted when found near a player, "keep" = leave them alone
// Breaking a spawner needs a DIAMOND or NETHERITE pickaxe. With one of the WEAK pickaxes the spawner is destroyed (the whole stack + its stored loot are lost) and the player is told.
// Any other item (hand, axe ...) simply does nothing but show a message - nothing is lost.
export const STRONG_PICKS = ["diamond_pickaxe", "netherite_pickaxe"];
export const WEAK_PICKS = ["wooden_pickaxe", "stone_pickaxe", "copper_pickaxe", "iron_pickaxe", "golden_pickaxe"];

// ---------------------------------------------------------------- prices (money). Shards price is derived (same ratio as before: 80,000 money = 2,500 shards)
export const PRICES = {
  // animals (cheapest: few people buy them)
  chicken: 50000, pig: 55000, sheep: 55000, cow: 60000, rabbit: 60000, mooshroom: 65000, wolf: 40000,
  // xp-only / weak
  silverfish: 65000, endermite: 65000,
  // normal hostile mobs
  zombie: 85000, cave_spider: 85000, husk: 90000, spider: 90000, slime: 95000,
  skeleton: 100000, creeper: 100000, stray: 105000, magma_cube: 105000, zombie_pigman: 110000,
  // premium
  witch: 125000, phantom: 125000, vindicator: 130000, guardian: 130000,
  enderman: 140000, blaze: 150000, wither_skeleton: 125000, ghast: 160000, ravager: 180000,
};
// animals produce slower (their drops sell well in the shop, and they are the cheapest spawners)
export const SLOW = { chicken: 1, pig: 1, sheep: 1, cow: 1, rabbit: 1, mooshroom: 1, wolf: 1 };   // 1 = "this mob is an animal" (the real factor is ANIMAL_FACTOR)
export const ratePerHour = (mobId) => (OVERRIDE[mobId] > 0 ? OVERRIDE[mobId] : RATE_PER_HOUR * (SLOW[mobId] ? ANIMAL_FACTOR : 1));
/** applies saved / new settings (clamped to LIMITS).  c = { rate, storage, stack, animal, mobs: { id: kills/h } }.  Only the keys that are given change. */
export function configure(c) {
  const ok = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!c || typeof c !== "object") return;
  if (ok(c.rate, LIMITS.rate)) RATE_PER_HOUR = Math.round(c.rate);
  if (ok(c.storage, LIMITS.storage)) STORAGE_HOURS = Math.round(c.storage);
  if (ok(c.stack, LIMITS.stack)) MAX_STACK = Math.round(c.stack);
  if (ok(c.animal, LIMITS.animal)) ANIMAL_FACTOR = Math.round(c.animal * 100) / 100;
  if (c.mobs && typeof c.mobs === "object") {
    for (const k of Object.keys(OVERRIDE)) delete OVERRIDE[k];
    for (const k of Object.keys(c.mobs)) if (LOOT[k] && ok(Number(c.mobs[k]), LIMITS.mob)) OVERRIDE[k] = Math.round(Number(c.mobs[k]));
  }
}
/** the current settings (same shape configure() takes) */
export const current = () => ({ rate: RATE_PER_HOUR, storage: STORAGE_HOURS, stack: MAX_STACK, animal: ANIMAL_FACTOR, mobs: { ...OVERRIDE } });
export const shardsOf = (money) => Math.max(50, Math.round(money / 32 / 50) * 50);

// ---------------------------------------------------------------- loot per kill (vanilla-like). xp: [min,max].  drops: { i: item id, lo, hi, p } = with chance p drop lo..hi items.
// { pick: [ids], p } = with chance p drop ONE item of the list.   A few valuable drops are rarer than vanilla on purpose (marked "rarer") because everything here is instant and automatic.
const RARE3 = { pick: ["iron_ingot", "carrot", "potato"], p: 0.025 };           // zombie / husk: 2.5% one of these (same as the game)
export const LOOT = {
  pig: { xp: [1, 3], drops: [{ i: "porkchop", lo: 1, hi: 3 }] },
  cow: { xp: [1, 3], drops: [{ i: "leather", lo: 0, hi: 2 }, { i: "beef", lo: 1, hi: 3 }] },
  chicken: { xp: [1, 3], drops: [{ i: "feather", lo: 0, hi: 2 }, { i: "chicken", lo: 1, hi: 1 }] },
  sheep: { xp: [1, 3], drops: [{ i: "mutton", lo: 1, hi: 2 }, { i: "white_wool", lo: 1, hi: 1 }] },
  wolf: { xp: [1, 3], drops: [] },
  mooshroom: { xp: [1, 3], drops: [{ i: "leather", lo: 0, hi: 2 }, { i: "beef", lo: 1, hi: 3 }] },
  rabbit: { xp: [1, 3], drops: [{ i: "rabbit_hide", lo: 0, hi: 1 }, { i: "rabbit", lo: 0, hi: 1 }, { i: "rabbit_foot", lo: 1, hi: 1, p: 0.1 }] },
  zombie: { xp: [5, 5], drops: [{ i: "rotten_flesh", lo: 0, hi: 2 }, RARE3] },
  husk: { xp: [5, 5], drops: [{ i: "rotten_flesh", lo: 0, hi: 2 }, RARE3] },
  creeper: { xp: [5, 5], drops: [{ i: "gunpowder", lo: 0, hi: 2 }] },
  skeleton: { xp: [5, 5], drops: [{ i: "bone", lo: 0, hi: 2 }, { i: "arrow", lo: 0, hi: 2 }] },
  stray: { xp: [5, 5], drops: [{ i: "bone", lo: 0, hi: 2 }, { i: "arrow", lo: 0, hi: 2 }] },
  spider: { xp: [5, 5], drops: [{ i: "string", lo: 0, hi: 2 }, { i: "spider_eye", lo: 1, hi: 1, p: 0.33 }] },
  cave_spider: { xp: [5, 5], drops: [{ i: "string", lo: 0, hi: 2 }, { i: "spider_eye", lo: 1, hi: 1, p: 0.33 }] },
  zombie_pigman: { xp: [5, 5], drops: [{ i: "rotten_flesh", lo: 0, hi: 1 }, { i: "gold_nugget", lo: 0, hi: 1 }, { i: "gold_ingot", lo: 1, hi: 1, p: 0.025 }] },
  slime: { xp: [1, 2], drops: [{ i: "slime_ball", lo: 0, hi: 2 }] },
  magma_cube: { xp: [1, 2], drops: [{ i: "magma_cream", lo: 1, hi: 1, p: 0.25 }] },
  enderman: { xp: [5, 5], drops: [{ i: "ender_pearl", lo: 1, hi: 1, p: 0.5 }] },
  silverfish: { xp: [5, 5], drops: [] },
  endermite: { xp: [3, 3], drops: [] },
  ghast: { xp: [5, 5], drops: [{ i: "ghast_tear", lo: 1, hi: 1, p: 0.25 }, { i: "gunpowder", lo: 0, hi: 2 }] },          // tear rarer (vanilla 50%)
  blaze: { xp: [10, 10], drops: [{ i: "blaze_rod", lo: 1, hi: 1, p: 0.5 }] },
  witch: { xp: [5, 5], drops: ["glass_bottle", "glowstone_dust", "gunpowder", "redstone", "spider_eye", "sugar", "stick"].map((i) => ({ i, lo: 1, hi: 2, p: 0.3 })) },
  wither_skeleton: { xp: [5, 5], drops: [{ i: "coal", lo: 1, hi: 1, p: 0.5 }, { i: "bone", lo: 0, hi: 2 }] },
  guardian: { xp: [10, 10], drops: [{ i: "prismarine_shard", lo: 0, hi: 2 }, { i: "cod", lo: 1, hi: 1, p: 0.4 }, { i: "prismarine_crystals", lo: 1, hi: 1, p: 0.33 }] },
  vindicator: { xp: [5, 5], drops: [{ i: "emerald", lo: 1, hi: 1, p: 0.1 }] },                                              // rarer (vanilla 50%)
  phantom: { xp: [5, 5], drops: [{ i: "phantom_membrane", lo: 1, hi: 1, p: 0.5 }] },
  ravager: { xp: [20, 20], drops: [{ i: "saddle", lo: 1, hi: 1, p: 0.05 }] },                                               // rarer (vanilla 100%)
};

// ---------------------------------------------------------------- rolling (fast even for 100 spawners x 12 hours: big batches use a normal approximation)
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
/** total amount dropped by `kills` kills: each kill drops lo..hi (uniform) with chance p */
export function sample(kills, p, lo, hi) {
  if (kills <= 0 || p <= 0) return 0;
  if (kills <= 48) {
    let t = 0;
    for (let i = 0; i < kills; i++) if (p >= 1 || Math.random() < p) t += lo + Math.floor(Math.random() * (hi - lo + 1));
    return t;
  }
  const mu = (lo + hi) / 2, varU = ((hi - lo + 1) ** 2 - 1) / 12, e = p * mu, v = Math.max(0, p * (varU + mu * mu) - e * e);
  return Math.max(0, Math.round(kills * e + Math.sqrt(kills * v) * gauss()));
}
/** adds the loot of `kills` kills of this mob to rec.l (items) and rec.x (xp) */
export function roll(mobId, kills, rec) {
  const t = LOOT[mobId]; if (!t || kills <= 0) return;
  rec.x = (rec.x ?? 0) + sample(kills, 1, t.xp[0], t.xp[1]);
  rec.l ??= {};
  for (const d of t.drops) {
    if (d.pick) {
      let left = sample(kills, d.p, 1, 1);
      for (let j = 0; j < d.pick.length && left > 0; j++) {
        const q = j === d.pick.length - 1 ? left : sample(left, 1 / (d.pick.length - j), 1, 1);
        if (q > 0) rec.l[d.pick[j]] = (rec.l[d.pick[j]] ?? 0) + q;
        left -= q;
      }
    } else {
      const q = sample(kills, d.p ?? 1, d.lo, d.hi);
      if (q > 0) rec.l[d.i] = (rec.l[d.i] ?? 0) + q;
    }
  }
}

// ---------------------------------------------------------------- record  { o: owner id, on: owner name, n: stack, t: last time (ms), f: fraction of a kill, k: kills stored, x: xp stored, l: { item: amount } }
export const capKills = (n, mobId) => Math.floor(ratePerHour(mobId) * STORAGE_HOURS * n);
export const newRec = (id, name, now = Date.now()) => ({ o: id, on: name, n: 1, t: now, f: 0, k: 0, x: 0, l: {} });
/** brings the record up to date (call BEFORE changing the stack size). Returns how many kills were added. */
export function settle(rec, mobId, now = Date.now()) {
  const dt = Math.max(0, now - (rec.t ?? now)); rec.t = now;
  rec.f = (rec.f ?? 0) + (dt / 3600000) * ratePerHour(mobId) * rec.n;
  const whole = Math.floor(rec.f), room = Math.max(0, capKills(rec.n, mobId) - (rec.k ?? 0)), take = Math.min(whole, room);
  rec.f = take < whole ? 0 : rec.f - whole;                 // storage full -> production stops, nothing is banked in secret
  if (take > 0) { roll(mobId, take, rec); rec.k = (rec.k ?? 0) + take; }
  return take;
}
export const itemCount = (rec) => { let n = 0; for (const k in rec.l) n += rec.l[k]; return n; };
/** after the owner took part of the loot, free the same share of the storage (so a half-emptied spawner produces again) */
export function shrink(rec, weightBefore) {
  const after = itemCount(rec) + (rec.x ?? 0);
  if (weightBefore <= 0) return;
  rec.k = after <= 0 ? 0 : Math.floor((rec.k ?? 0) * Math.min(1, after / weightBefore));
}
export const weight = (rec) => itemCount(rec) + (rec.x ?? 0);
export const itemName = (id) => id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
