// ---------------------------------------------------------------------------------------------
// SMP extra systems - settings you can edit safely
// ---------------------------------------------------------------------------------------------

// ---- Homes ----
export const HOME_MAX = 5;                         // max homes per player

// ---- Combat tag ----
export const COMBAT_SECONDS = 20;                  // timer after hitting / being hit by another player (blocks all teleports)

// ---- Clear Lag ----
export const CLEARLAG_SECONDS = 60;                // clear dropped items every 60 seconds
export const CLEARLAG_WARN_AT = [10, 5, 3, 2, 1];  // warning messages (seconds before clearing)

// ---- Timber / Vein Miner ----
export const TIMBER_MAX = 300;                     // Timber cuts the WHOLE tree in one hit: this is only a safety cap (logs per tree, including the one you broke)
export const TIMBER_MAX2 = 40;                     // Timber x2 upgrade (paid, see MINING_PASS.t40): max logs per tree
export const VEIN_MAX = 20;                        // safety cap for one ore vein (including the one you broke)
export const MAGNET_PAUSE = 10;                    // Magnet pauses for a player while ANOTHER player is within this many blocks (protects other players' items); it also never works inside protected land
export const MAGNET_RANGE = 6;                     // Magnet: dropped items within this many blocks gather under the player and follow him

// ---- Paid mining time (real time, per hour) ----
export const MINING_MAX_HOURS = 6;                 // most time a player can hold at once (per tool)
// time is sold in 3 packs: 30 minutes (price) | 1 hour (p60) | 6 hours (p360)   - all in $, real time
export const MINING_PASS = {
  timber: { name: "Timber",          price: 899,  p60: 1699, p360: 8999 },
  a3:     { name: "Area Mining 3x3", price: 1999, p60: 3799, p360: 19999 },
  a5:     { name: "Area Mining 5x5", price: 3499, p60: 6499, p360: 34999 },
  chest:  { name: "Chest Sell",      price: 1499, p60: 2799, p360: 14999 },   // axe: breaking a chest sells everything inside (the chest stays)
  t40:    { name: "Timber x2 (40 logs)", price: 1798, p60: 3398, p360: 17998 },   // exactly double the Timber prices: one hit cuts up to TIMBER_MAX2 logs
  // Magnet + Auto-Smelt: ONE pack only (30 minutes) and at most 30 minutes held at once  (packs = minutes that can be bought, maxMin = most minutes held)
  magnet: { name: "Magnet",          price: 0,    packs: [30], maxMin: 30 },     // FREE now (not sold any more, kept only so old data still loads) - dropped items gather under you and follow you (MAGNET_RANGE blocks)
  smelt:  { name: "Auto-Smelt",      price: 2499, packs: [30], maxMin: 30 },     // ores drop ingots instead of raw ore (iron / gold / copper / ancient debris)
};

// ---- Area Mining trench: pickaxe looking DOWN or UP breaks a row of 3 (or 5) blocks left/right of the block under the crosshair
//      and goes this many layers down / up (the block you hit is layer 1).  3x3 -> row of 3, 3 deep.  5x5 -> row of 5, 5 deep.
export const AREA_DEPTH = { 3: 3, 5: 5 };

// ---- Night Vision (/nv): paid time (real time, also runs while offline) ----
export const NV = { price: 799, p60: 1499, p360: 7999, maxHours: 12, giftHours: 2 };   // $ for 30 min | 1 hour | 6 hours | most hours a player can hold | free hours for NEW players only

// ---- RTP (overworld only) ----
export const RTP = { min: 300, max: 8000 };        // distance from 0,0
export const RTP_PRICE = { surface: 149, cave: 249 };   // money per teleport (charged when the search starts, refunded if it fails)

// ---- Spawn ----
// y = null -> finds the surface automatically at x,z (and moves to the nearest safe block if needed)
export const SPAWN = { x: 0, y: null, z: 0 };

// ---- Cooldowns (seconds) between teleports of the same kind ----
export const COOLDOWN = { home: 5, spawn: 5, rtp: 30, tpa: 10, clanhome: 10, afk: 5, warp: 5, back: 10 };

// ---- TPA ----
export const TPA_EXPIRE_SECONDS = 60;

// ---- Clans ----
export const CLAN = {
  maxMembers: 5,               // members of one clan (the owner counts). There are no clan levels any more
  inviteDays: 3,               // a saved invitation stays valid this many real days (online AND offline players)
  createCost: 4999,            // money to create a clan
  renameDays: 3,               // the owner can change the clan name once every 3 real days
  descMax: 60,                 // description length
  topMinMembers: 2,            // a clan needs this many members to appear in the top list / get the daily reward
  rewardFirst: 600,            // shards per member, every day, for the #1 clan
  rewardSecond: 60,            // shards per member, every day, for the #2 clan
  rewardMinHours: 24,          // a member must be in the clan this long to get the daily reward (stops join-collect-leave)
};

// ---- 👑 Operator menu (systems/opmenu.js): a page in /menu that ONLY operators see ----
export const OPMENU = {
  symbol: "👑",                                   // shown in the button text (if your game shows a square instead of the crown, change it to e.g. "[OP]")
  icon: "textures/ui/shop/ic_crown",              // the crown icon (RP/textures/ui/shop/ic_crown.png)
  banLengths: [                                   // choices in the Ban form (hours = 0 means permanent)
    { label: "1 hour", hours: 1 },
    { label: "6 hours", hours: 6 },
    { label: "1 day", hours: 24 },
    { label: "3 days", hours: 72 },
    { label: "7 days", hours: 168 },
    { label: "30 days", hours: 720 },
    { label: "Permanent", hours: 0 },
  ],
};

// ---- Operator Logs (systems/oplog.js, shown in  /menu > Operator > Logs) ----
// Everything players buy / sell / pay is saved for the operators; the system also marks what looks wrong ("Suspicious").
// These limits are only a starting point: look at the Logs for a few days, then raise / lower them to fit how your players really play.
export const OPLOG = {
  enabled: true,
  live: true,                          // default of the "Live feed" switch: every purchase / sale / payment is also shown in the operators' chat (each operator can switch it off in the Logs menu)
  watchStaff: false,                   // false = operators' own deals are saved but never marked suspicious (so you can test the shop)
  cooldownMin: 10,                     // the same player + same rule is reported once per this time
  big: { buy: 250000, sell: 250000, pay: 100000, shards: 5000 },      // one single deal at or above this goes to "Big deals"
  same: [                              // the same product bought (or sold) again and again by one player
    { min: 10, units: 1500, money: 500000 },
    { min: 30, units: 4000, money: 1500000 },
  ],
  loop: { min: 30, minUnits: 16 },     // bought AND sold the same product (at least this many each) within this time (red when he ends with a profit = price loop)
  earn: { min: 10, money: 600000 },    // earned from sales within this time
  rapid: { perMin: 25 },               // shop transactions in one minute (auto-clicker / macro)
  spawner: { min: 30, count: 4 },      // spawners / eggs bought within this time
  pay: {
    sameTarget: { min: 30, count: 3, money: 250000 },   // payments to the same player
    burst: { min: 10, money: 400000 },                  // total sent within this time
    newPlayerHours: 2, newPlayerMoney: 50000,           // a player with less play time than this sends / receives at least this much
    forward: { min: 10, money: 100000, share: 0.7 },    // sends on (almost) everything he just received
  },
};

// ---- 👑 Staff tools (systems/staffcore.js, staffworld.js, staffmenu.js): mute / kick / warn / notes / freeze / reports / roles / locks ... ----
export const STAFF = {
  owners: [],                                      // player names that are ALWAYS Admin (safety net: nobody can lock every operator out by changing roles). Example: ["Steve"]
  reasonMin: 3,                                    // every punishment needs a reason of at least this many letters
  warnLimit: 3, warnDays: 30,                      // warnings older than warnDays do not count; at warnLimit the operators get an alert (a temporary ban is suggested)
  logCap: 250,                                     // staff-action log: newest entries kept here, older ones go to the archive (the archive is trimmed when full, operators get a warning before)
  reportCooldownSec: 60, reportsCap: 50,           // /report: seconds between two reports of one player, and how many reports are kept
  broadcastCooldownSec: 5,
  muteChoices: [{ label: "5 minutes", ms: 300000 }, { label: "30 minutes", ms: 1800000 }, { label: "1 hour", ms: 3600000 }, { label: "6 hours", ms: 21600000 }, { label: "1 day", ms: 86400000 }, { label: "3 days", ms: 259200000 }, { label: "7 days", ms: 604800000 }],
  freezeChoices: [{ label: "1 minute", ms: 60000 }, { label: "5 minutes", ms: 300000 }, { label: "10 minutes", ms: 600000 }, { label: "30 minutes", ms: 1800000 }, { label: "1 hour", ms: 3600000 }],
  econChoices: [{ label: "1 hour", ms: 3600000 }, { label: "6 hours", ms: 21600000 }, { label: "1 day", ms: 86400000 }, { label: "3 days", ms: 259200000 }, { label: "7 days", ms: 604800000 }, { label: "Until an Admin lifts it", ms: 0 }],
  lockRadii: [10, 25, 50, 100], maxLocks: 5,       // area lock: square around the operator (blocks to each side), how many locks can exist at once
  lockChoices: [{ label: "10 minutes", ms: 600000 }, { label: "30 minutes", ms: 1800000 }, { label: "1 hour", ms: 3600000 }, { label: "3 hours", ms: 10800000 }, { label: "Until I unlock it", ms: 0 }],
  deathKeepHours: 168, deathKeepCount: 10, deathScanSec: 5,             // death backup: how long the last inventory of a dead player is kept, and how often the inventories are copied
  shopSellRatio: 0.24,                             // shop price editing: a sell price can never be more than this share of the buy price (keeps the shop free of buy/sell loops)
};
