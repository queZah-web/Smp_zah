// LUX - luxury sound + particle effects (all custom: sounds/lux/*.ogg + particles/lux_*.json in the resource pack).
// Purely cosmetic: every call is wrapped in try/catch, so a problem here can never break any other system.
import { nearVanished, isVanishedId } from "./systems/staffcore.js";   // staff tools: vanished operators leave no effects
import { system, world, MolangVariableMap } from "@minecraft/server";

// ---------------------------------------------------------------- player switches (set by smp/cosmetics.js: Cosmetics -> Effects & Sounds)
export const luxPrefs = { fx: (p) => true, sfx: (p) => true, mute: (p, key) => false };
// effect group of what is playing right now ("clearlag", "mining", "tp", "shop", "protect", "menu"; null = no group).  A player can switch one
// group's sounds / particles off on its own (Cosmetics > Effects & Sounds > Fine control) without touching the others.
let cat = null;
const inCat = (c, fn) => { const prev = cat; cat = c; try { return fn(); } finally { cat = prev; } };
const grouped = (c, fn) => (...a) => inCat(c, () => fn(...a));                         // an exported effect function that belongs to a group
const bindCat = (fn) => { const c = cat; return (...a) => inCat(c, () => fn(...a)); };   // a callback that runs later keeps the group it was made in
const groupOff = (p, kind) => { try { return !!cat && luxPrefs.mute(p, cat + "." + kind) === true; } catch (e) { return false; } };
const sfxOn = (p) => { try { return !p || (luxPrefs.sfx(p) !== false && !groupOff(p, "sfx")); } catch (e) { return true; } };
// particles are normally seen by everybody close by.  When some player near the effect turned them off (all particles, or this group),
// the effect is shown only to the nearby players who still want it (null = everybody wants it: the normal world particle).
function fxViewers(dim, loc) {
  try {
    const near = world.getAllPlayers().filter((q) => { try { return q.dimension.id === dim.id && Math.abs(q.location.x - loc.x) < 14 && Math.abs(q.location.z - loc.z) < 14 && Math.abs(q.location.y - loc.y) < 14; } catch (e) { return false; } });
    if (near.length === 0) return null;
    const want = near.filter((q) => luxPrefs.fx(q) !== false && !groupOff(q, "fx"));
    return want.length === near.length ? null : want;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- tiny helpers
export function lux(p, key, volume = 1, pitch = 1) {
  if (!sfxOn(p)) return;
  try { p.playSound("lux." + key, { volume, pitch }); } catch (e) { /* ignore */ }
}
// Sound that comes FROM A PLACE IN THE WORLD (like Java): everybody standing near `at` hears it, not only `p`.
// `soundId` is the full id (e.g. "lux.break" or "random.orb"). Falls back to the old private sound if anything fails.
function playIn(dim, soundId, loc, volume, pitch) {      // true when the world sound was played
  try { dim.playSound(soundId, loc, { volume, pitch }); return true; } catch (e1) { /* older API: try the command below */ }
  try { dim.runCommand(`playsound ${soundId} @a ${loc.x.toFixed(2)} ${loc.y.toFixed(2)} ${loc.z.toFixed(2)} ${volume} ${pitch}`); return true; } catch (e2) { /* fall through */ }
  return false;
}
export function soundAt(p, soundId, at, volume = 1, pitch = 1) {
  if (!sfxOn(p)) return;
  if (isVanishedId(p.id)) { try { p.playSound(soundId, { volume, pitch }); } catch (e) { /* ignore */ } return; }      // vanished: only he hears it
  try {
    const l = at ?? p.location;
    if (!playIn(p.dimension, soundId, { x: l.x, y: l.y, z: l.z }, volume, pitch)) p.playSound(soundId, { volume, pitch });
  } catch (e) { /* ignore */ }
}
export function luxAt(p, key, at, volume = 1, pitch = 1) { soundAt(p, "lux." + key, at, volume, pitch); }
/** vanilla confirm "ding" for a shop purchase, audible to players standing close by */
function _luxDing(p) { soundAt(p, "random.orb", undefined, 1, 1); }
const PAL = {
  gold: [1.0, 0.82, 0.42], ice: [0.55, 0.9, 1.0], rose: [1.0, 0.62, 0.85], violet: [0.78, 0.6, 1.0],
  green: [0.5, 1.0, 0.65], amethyst: [0.78, 0.48, 1.0], lilac: [0.92, 0.75, 1.0], red: [1.0, 0.4, 0.4], blue: [0.45, 0.6, 1.0], white: [1, 1, 1], wood: [1.0, 0.88, 0.55],
};
export function fx(dim, id, loc, v) {
  const viewers = fxViewers(dim, loc);
  if (viewers && viewers.length === 0) return;          // everybody near switched it off
  if (nearVanished(dim.id, loc)) return;                // a vanished operator: no effect may show where he is
  try {
    const m = new MolangVariableMap();
    for (const k in v) m.setFloat("variable." + k, v[k]);
    if (viewers && typeof viewers[0].spawnParticle === "function") { for (const q of viewers) { try { q.spawnParticle(id, loc, m); } catch (e) { /* ignore */ } } return; }
    dim.spawnParticle(id, loc, m);
  } catch (e) { /* ignore */ }
}
const sparks = (dim, loc, col, count, o = {}) => {
  const c = PAL[col] ?? PAL.gold;
  fx(dim, "lux:spark", loc, { count, radius: o.radius ?? 0.35, speed: o.speed ?? 1.6, life: o.life ?? 0.8, size: o.size ?? 0.16, r: c[0], g: c[1], b: c[2] });
};
const column = (dim, loc, col, count, o = {}) => {
  const c = PAL[col] ?? PAL.gold;
  fx(dim, "lux:column", loc, { count, radius: o.radius ?? 0.55, speed: o.speed ?? 2.2, life: o.life ?? 1.0, size: o.size ?? 0.16, r: c[0], g: c[1], b: c[2] });
};
// tiny pixelated amethyst dust: dark purple + bright violet + light lilac, a few soft glowing ones
const PIX = { dark: [0.36, 0.12, 0.6], violet: [0.68, 0.32, 1.0], light: [0.88, 0.66, 1.0], glow: [0.78, 0.42, 1.0] };
const pixels = (dim, loc, n, o = {}) => {
  const base = { half: o.half ?? 0.55, speed: o.speed ?? 0.9, life: o.life ?? 0.9 };
  const put = (id, c, cnt, size) => { if (cnt >= 1) fx(dim, id, loc, { ...base, count: Math.round(cnt), size, r: c[0], g: c[1], b: c[2] }); };
  const pal = o.pal ?? PIX;
  put("lux:pixel", pal.dark, n * 0.4, 0.07);
  put("lux:pixel", pal.violet ?? pal.mid, n * 0.4, 0.06);
  put("lux:pixel", pal.light, n * 0.2, 0.05);
  if (pal.glow && Math.random() < (o.glow ?? 0.5)) put("lux:pixelglow", pal.glow, Math.max(1, n * 0.12), 0.09);
};
const shards = (dim, loc, col, count, o = {}) => {
  const c = PAL[col] ?? PAL.amethyst;
  fx(dim, "lux:shard", loc, { count, radius: o.radius ?? 0.4, speed: o.speed ?? 0.9, life: o.life ?? 1.3, size: o.size ?? 0.26, r: c[0], g: c[1], b: c[2] });
};
const ring = (dim, axis, loc, col, size, life = 0.7) => {
  const c = PAL[col] ?? PAL.gold;
  fx(dim, "lux:ring_" + axis, loc, { size, life, r: c[0], g: c[1], b: c[2] });
};
const later = (ticks, fn) => { const run = bindCat(fn); system.runTimeout(() => { try { run(); } catch (e) { /* ignore */ } }, ticks); };
const idOf = (t) => t.replace("minecraft:", "");
const centre = (b) => ({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
const pick = (arr, n) => { if (arr.length <= n) return arr; const out = [], step = arr.length / n; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]); return out; };

// ---------------------------------------------------------------- break combo (pitch climbs a pentatonic run while you keep mining)
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const combo = new Map(), special = new Map();
function comboPitch(p) {
  const now = Date.now(), c = combo.get(p.id) ?? { n: 0, t: 0 };
  c.n = now - c.t < 1800 ? c.n + 1 : 0; c.t = now; combo.set(p.id, c);
  return Math.pow(2, SCALE[c.n % SCALE.length] / 12) * (c.n >= SCALE.length ? 1.0 : 1.0);
}
const markSpecial = (p) => special.set(p.id, system.currentTick);

const ORE_COL = [[/diamond/, "ice"], [/emerald/, "green"], [/gold/, "gold"], [/redstone/, "red"], [/lapis/, "blue"], [/copper/, "green"], [/quartz|debris/, "rose"], [/amethyst/, "violet"]];
const oreColour = (id) => { for (const [re, c] of ORE_COL) if (re.test(id)) return c; return "gold"; };
// pixel colours per ore (dark / mid / light [/ glow]) - same style as the amethyst dust, in the colour of the resource
const ORE_PIX = [
  [/coal/,            { dark: [0.04, 0.04, 0.05], mid: [0.16, 0.16, 0.18], light: [0.34, 0.34, 0.37] }],
  [/nether_gold/,     { dark: [0.78, 0.55, 0.08], mid: [1.0, 0.82, 0.18], light: [1.0, 0.94, 0.55], glow: [1.0, 0.85, 0.3] }],
  [/gold/,            { dark: [0.78, 0.55, 0.08], mid: [1.0, 0.84, 0.2], light: [1.0, 0.95, 0.6], glow: [1.0, 0.88, 0.35] }],
  [/iron/,            { dark: [0.55, 0.38, 0.3], mid: [0.82, 0.62, 0.5], light: [0.95, 0.85, 0.78] }],
  [/copper/,          { dark: [0.62, 0.3, 0.16], mid: [0.9, 0.52, 0.28], light: [0.45, 0.88, 0.72], glow: [0.95, 0.6, 0.35] }],
  [/redstone/,        { dark: [0.45, 0.0, 0.0], mid: [0.88, 0.08, 0.08], light: [1.0, 0.42, 0.32], glow: [1.0, 0.2, 0.15] }],
  [/lapis/,           { dark: [0.08, 0.17, 0.55], mid: [0.2, 0.36, 0.9], light: [0.5, 0.66, 1.0], glow: [0.35, 0.5, 1.0] }],
  [/diamond/,         { dark: [0.08, 0.55, 0.62], mid: [0.28, 0.9, 0.95], light: [0.78, 1.0, 1.0], glow: [0.5, 1.0, 1.0] }],
  [/emerald/,         { dark: [0.04, 0.45, 0.18], mid: [0.18, 0.85, 0.4], light: [0.65, 1.0, 0.78], glow: [0.35, 1.0, 0.55] }],
  [/quartz/,          { dark: [0.72, 0.66, 0.62], mid: [0.95, 0.92, 0.9], light: [1.0, 1.0, 1.0], glow: [1.0, 0.97, 0.95] }],
  [/debris/,          { dark: [0.28, 0.14, 0.1], mid: [0.52, 0.32, 0.26], light: [0.8, 0.6, 0.5], glow: [0.9, 0.55, 0.35] }],
  [/amethyst/,        PIX],
];
// which signature melody belongs to which ore (order matters: nether_gold before gold)
const ORE_SND = [[/nether_gold/, "nether_gold"], [/gold/, "gold"], [/coal/, "coal"], [/iron/, "iron"], [/copper/, "copper"], [/redstone/, "redstone"], [/lapis/, "lapis"],
  [/diamond/, "diamond"], [/emerald/, "emerald"], [/quartz/, "quartz"], [/debris/, "debris"], [/amethyst/, "amethyst"]];
const oreSound = (id) => { for (const [re, k] of ORE_SND) if (re.test(id)) return k; return "iron"; };
const orePix = (id) => { for (const [re, c] of ORE_PIX) if (re.test(id)) return c; return { dark: [0.3, 0.3, 0.33], mid: [0.5, 0.5, 0.55], light: [0.75, 0.75, 0.8] }; };
const isOre = (id) => /_ore$|^ancient_debris$|^amethyst_cluster$/.test(id);

try {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    const { player, block, brokenBlockPermutation: perm } = ev, tick = system.currentTick;
    let id = "", dim, loc;
    try { id = idOf(perm.type.id); dim = block.dimension; loc = centre(block); } catch (e) { return; }
    system.run(() => inCat("mining", () => {
      try {
        if ((special.get(player.id) ?? -1) >= tick) return;          // area / vein / timber already played its own bigger effect
        const pitch = comboPitch(player);
        if (isOre(id)) {
          luxAt(player, "ore_" + oreSound(id), loc, 1, 1);                              // the ore's own quiet melody (heard by players nearby)
          pixels(dim, loc, 14, { speed: 0.9, glow: 0.6, pal: orePix(id) });
        } else {
          luxAt(player, "break", loc, 0.65, pitch);
          pixels(dim, loc, 7, { speed: 0.8, glow: 0.4 });
        }
      } catch (e) { /* ignore */ }
    }));
  });
} catch (e) { console.warn("[lux] break fx not started: " + e); }

// ---------------------------------------------------------------- area mining 3x3 / 5x5
/** locs = broken blocks (Block objects), axis = face being mined ("x" | "y" | "z"), sign = which side the player stands on */
function _luxArea(player, block, size, blocks, axis, sign) {
  try {
    markSpecial(player);
    const dim = block.dimension, big = size >= 5, c = centre(block);
    luxAt(player, big ? "area5" : "area3", c, 0.6, 1);
    const per = big ? 11 : 10, opt = big ? { speed: 1.1, half: 0.6, life: 1.0, glow: 0.7 } : { speed: 1.0, half: 0.58, life: 0.95, glow: 0.6 };
    pixels(dim, c, per, opt);                                           // the block you broke
    for (const b of blocks) later(Math.round(Math.hypot(b.x - block.x, b.y - block.y, b.z - block.z) * 1.2), () => pixels(dim, centre(b), per, opt));
  } catch (e) { /* ignore */ }
}
// vein miner / timber
function _luxVein(player, block, blocks, oreId) {
  try {
    markSpecial(player);
    const dim = block.dimension, pal = orePix(oreId), gc = pal.glow ?? pal.light, c = centre(block);
    const o = { speed: 1.0, glow: 0.7, half: 0.6, life: 1.0, pal };
    luxAt(player, "vein", c, 1, 1);                                           // very luxury: harp sweep + glass bells + shimmer
    luxAt(player, "ore_" + oreSound(oreId), c, 0.8, 1);                       // + this ore's own melody
    // centre: pixel burst, star sparkles, rising glow column
    pixels(dim, c, 18, o);
    fx(dim, "lux:spark", c, { count: 10, radius: 0.5, speed: 2.0, life: 0.9, size: 0.18, r: gc[0], g: gc[1], b: gc[2] });
    fx(dim, "lux:column", { x: c.x, y: c.y - 0.5, z: c.z }, { count: 16, radius: 0.9, speed: 1.5, life: 1.2, size: 0.15, r: gc[0], g: gc[1], b: gc[2] });
    // a wave of coloured pixels travels through the vein, nearest ore first
    const dist = (b) => Math.hypot(b.x - block.x, b.y - block.y, b.z - block.z);
    const wave = pick([...blocks].sort((a, b) => dist(a) - dist(b)), 40);
    let last = 0;
    for (const b of wave) {
      const t = Math.round(dist(b) * 1.6) + 2; last = Math.max(last, t);
      later(t, () => {
        const l = centre(b);
        pixels(dim, l, 12, o);
        fx(dim, "lux:spark", l, { count: 2, radius: 0.3, speed: 1.0, life: 0.8, size: 0.13, r: gc[0], g: gc[1], b: gc[2] });
      });
    }
    later(last + 3, () => fx(dim, "lux:column", { x: c.x, y: c.y - 0.5, z: c.z }, { count: 12, radius: 0.7, speed: 1.2, life: 1.1, size: 0.13, r: gc[0], g: gc[1], b: gc[2] }));
  } catch (e) { /* ignore */ }
}
function _luxTimber(player, block, blocks) {
  try {
    markSpecial(player);
    const dim = block.dimension;
    luxAt(player, "timber", centre(block), 1, 1);
    sparks(dim, centre(block), "wood", 12, { speed: 2.0, size: 0.18 });
    for (const b of pick(blocks, 16)) sparks(dim, centre(b), "green", 4, { speed: 1.2, size: 0.14, life: 0.8 });
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- teleport (home / spawn / rtp / tpa / clan home)
/** call right AFTER player.teleport(); `from` = location + dimension before the jump */
function _luxTeleport(player, from) {
  try {
    luxAt(player, "tp", undefined, 1, 1);                               // where you arrive
    if (from?.dim && from?.loc) {
      try {
        const n = player.location, far = from.dim !== player.dimension || Math.hypot(from.loc.x - n.x, from.loc.y - n.y, from.loc.z - n.z) > 24;
        if (far) playIn(from.dim, "lux.tp", { x: from.loc.x, y: from.loc.y, z: from.loc.z }, 1, 1);   // where you left (others there hear it)
      } catch (e) { /* ignore */ }
      ring(from.dim, "y", { x: from.loc.x, y: from.loc.y + 0.1, z: from.loc.z }, "violet", 3.2, 0.8);
      column(from.dim, { x: from.loc.x, y: from.loc.y, z: from.loc.z }, "violet", 22, { radius: 0.6, speed: 2.4 });
    }
    const dim = player.dimension;
    later(4, () => {
      const l = player.location;
      ring(dim, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "gold", 3.6, 0.9);
      later(5, () => ring(dim, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "ice", 5.2, 1.1));
      column(dim, { x: l.x, y: l.y, z: l.z }, "gold", 26, { radius: 0.7, speed: 2.0, life: 1.1 });
      sparks(dim, { x: l.x, y: l.y + 1, z: l.z }, "white", 12, { speed: 2.2, radius: 0.5, size: 0.18 });
    });
  } catch (e) { /* ignore */ }
}
export const here = (p) => { try { return { loc: { x: p.location.x, y: p.location.y, z: p.location.z }, dim: p.dimension }; } catch (e) { return null; } };

// ---------------------------------------------------------------- commands
// command -> sound. null = the command plays its own sound (teleports, sethome, nv).
const CMD = {
  "smp:home": "menu", "smp:top": null, "smp:spawn": null, "smp:sethome": null, "smp:nv": null,
  "smp:tpaccept": "accept", "smp:tpdeny": "off", "smp:tpa": "accept", "smp:tphere": "accept", "smp:clanhome": null, "smp:rtp": "menu",
};
const cmdTick = new Map(), fxTick = new Map(), uiTick = new Map();       // per-player "last time" (for the soft UI sound rules below)
function _luxCmd(p, name, arg) {
  try {
    cmdTick.set(p.id, system.currentTick);
    if (name === "smp:home" && arg) return;                 // /home <name> teleports: the teleport effect plays
    const k = name in CMD ? CMD[name] : "menu";
    if (k) { lux(p, k, 1, 1); try { const l = p.location; sparks(p.dimension, { x: l.x, y: l.y + 1.0, z: l.z }, "gold", 5, { speed: 0.9, radius: 0.5, size: 0.11, life: 0.7 }); } catch (e) { /* ignore */ } }
  } catch (e) { /* ignore */ }
}
function _luxSave(p) {
  lux(p, "save", 1, 1);
  try { const l = p.location; ring(p.dimension, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "gold", 2.4, 0.7); column(p.dimension, { x: l.x, y: l.y, z: l.z }, "gold", 12, { radius: 0.45, speed: 1.6 }); } catch (e) { /* ignore */ }
}
function _luxToggle(p, on) {
  lux(p, on ? "save" : "off", 1, 1);
  try { const l = p.location; sparks(p.dimension, { x: l.x, y: l.y + 1.0, z: l.z }, on ? "ice" : "violet", 10, { speed: 1.4, radius: 0.5, size: 0.14 }); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- teleport requests closed / open (menu -> Tp request)
/** TP Cancel: a low, muted two-note "lock" + a small red ring and red sparks falling around the player */
function _luxTpOff(p) {
  lux(p, "tp_off", 1, 1);
  try {
    const l = p.location, d = p.dimension;
    ring(d, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "red", 2.2, 0.7);
    sparks(d, { x: l.x, y: l.y + 1.0, z: l.z }, "red", 12, { speed: 1.0, radius: 0.5, size: 0.13, life: 0.8 });
  } catch (e) { /* ignore */ }
}
/** TP Enable: a bright rising chime + a green ring, a soft column and green / ice sparks */
function _luxTpOn(p) {
  lux(p, "tp_on", 1, 1);
  try {
    const l = p.location, d = p.dimension;
    ring(d, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "green", 2.4, 0.75);
    column(d, { x: l.x, y: l.y, z: l.z }, "green", 12, { radius: 0.45, speed: 1.8 });
    later(6, () => sparks(d, { x: l.x, y: l.y + 1.1, z: l.z }, "ice", 10, { speed: 1.4, radius: 0.5, size: 0.13, life: 0.9 }));
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- land protection (buy / renew / ended / blocked)
/** kind: "buy" | "renew" | "end" (protection time is over) | "deny" (somebody tried to break protected land - only `p` hears it) */
function _luxProtect(kind, dim, loc, p) {
  try {
    const l = { x: loc.x, y: loc.y, z: loc.z };
    if (kind === "buy" || kind === "renew") {
      playIn(dim, "lux." + (kind === "buy" ? "save" : "accept"), l, 1, 1);
      ring(dim, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "gold", kind === "buy" ? 4.0 : 2.6, 0.9);
      column(dim, { x: l.x, y: l.y, z: l.z }, "gold", kind === "buy" ? 26 : 14, { radius: 0.7, speed: 1.8, life: 1.2 });
      sparks(dim, { x: l.x, y: l.y + 1, z: l.z }, "white", 10, { speed: 1.8, radius: 0.5, size: 0.16 });
    } else if (kind === "end") {
      playIn(dim, "lux.off", l, 1.2, 0.8);
      ring(dim, "y", l, "red", 5.0, 1.0);
      column(dim, l, "red", 24, { radius: 1.2, speed: 1.4, life: 1.3 });
      shards(dim, l, "lilac", 8, { speed: 0.9, radius: 1.2, size: 0.26, life: 1.4 });
    } else if (kind === "deny" && p) {
      lux(p, "off", 0.6, 1.4);
      sparks(dim, { x: l.x, y: l.y + 1.0, z: l.z }, "red", 6, { speed: 1.2, radius: 0.4, size: 0.12, life: 0.7 });
    }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- clear lag (calm, quiet sounds + soft particles around every player)
/** a warning at `secs` seconds left (10, 5, 3, 2, 1 ...) */
function _luxClearWarn(secs) {
  try {
    for (const p of world.getAllPlayers()) {
      if (secs <= 3) lux(p, "cltick", 1, 1 + (3 - secs) * 0.12); else lux(p, "clwarn", 1, 1);
      try {
        const l = p.location, d = p.dimension;
        ring(d, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "amethyst", 1.6 + (secs <= 3 ? (4 - secs) * 0.8 : 0.4), 0.8);
        column(d, { x: l.x, y: l.y, z: l.z }, "lilac", secs <= 3 ? 8 : 5, { radius: 0.7, speed: 1.1, size: 0.12 });
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}
/** items = [{ dim, loc }] that were just removed */
function _luxClearDone(items) {
  try {
    const spots = pick(items, 90);
    for (const it of spots) {
      const l = { x: it.loc.x, y: it.loc.y + 0.2, z: it.loc.z };
      sparks(it.dim, l, "amethyst", 3, { speed: 0.9, radius: 0.15, size: 0.12, life: 0.8 });
      if (Math.random() < 0.35) shards(it.dim, l, "lilac", 1, { speed: 0.6, radius: 0.1, size: 0.22, life: 1.1 });
    }
    for (const p of world.getAllPlayers()) {
      lux(p, "clclear", 1, 1);
      try {
        const l = p.location, d = p.dimension;
        ring(d, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "amethyst", 3.2, 0.9);
        later(5, () => ring(d, "y", { x: l.x, y: l.y + 0.1, z: l.z }, "lilac", 5.0, 1.1));
        column(d, { x: l.x, y: l.y, z: l.z }, "amethyst", 18, { radius: 0.8, speed: 1.6, life: 1.2, size: 0.15 });
        shards(d, { x: l.x, y: l.y + 1, z: l.z }, "lilac", 6, { speed: 0.8, radius: 0.9, size: 0.26, life: 1.5 });
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- soft UI sound (every /menu page, every /shop page)
/** kind: "open" = /menu pages (two light notes)   "item" = /shop pages (one soft note). Very quiet on purpose. */
function _luxUi(p, kind) {
  try {
    const t = system.currentTick;
    if (t - (cmdTick.get(p.id) ?? -99) < 6) return;      // the command that opened this page already played its own sound
    if (t - (fxTick.get(p.id) ?? -99) < 8) return;       // a buy / sell just happened: the page refresh stays quiet
    if (t - (uiTick.get(p.id) ?? -99) < 3) return;       // never twice at once
    uiTick.set(p.id, t);
    lux(p, kind === "item" ? "ui_item" : "ui_open", 0.55, 1);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- shop buy / sell: a few tiny golden pixels rise in a small arc + two diamond glints
const GOLD = { gold: [1.0, 0.82, 0.3], amber: [1.0, 0.6, 0.16], pale: [1.0, 0.94, 0.6] };
function _luxShop(p) {
  try {
    const t = system.currentTick;
    if (t - (fxTick.get(p.id) ?? -99) < 5) return;       // clicking fast never stacks effects
    fxTick.set(p.id, t);
    const dim = p.dimension, l = p.location;
    let ox = 0, oz = 0;
    try { const v = p.getViewDirection(), h = Math.hypot(v.x, v.z) || 1; ox = (v.x / h) * 0.3; oz = (v.z / h) * 0.3; } catch (e) { /* ignore */ }
    const c = { x: l.x + ox, y: l.y + 0.9, z: l.z + oz };
    const dust = (col, count, size) => fx(dim, "lux:coin", c, { count, radius: 0.4, speed: 0.45, life: 1.0, size, r: col[0], g: col[1], b: col[2] });
    dust(GOLD.gold, 3, 0.065); dust(GOLD.amber, 2, 0.055); dust(GOLD.pale, 1, 0.05);
    later(3, () => fx(dim, "lux:glint", c, { count: 2, radius: 0.38, speed: 0.22, life: 0.6, size: 0.16, r: GOLD.pale[0], g: GOLD.pale[1], b: GOLD.pale[2] }));
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- /rtp: violet vortex + luxury sound
// Swirls around the player from the ground up for RTP_WARM ticks (tiny pixels: deep purple, violet, magenta, a few bright blue, plus random star glints),
// pulled inward and collapsing right before you go. rtp_go is built to peak exactly when the warm-up ends. Purely cosmetic.
const VX = { dark: [0.36, 0.1, 0.62], violet: [0.66, 0.3, 1.0], magenta: [0.86, 0.28, 0.82], blue: [0.35, 0.72, 1.0] };
const RTP_WARM = 22;                                   // ticks (1.1 s) between pressing Surface/Cave RTP and the teleport
const alive = (p) => { try { return typeof p.isValid === "function" ? p.isValid() : !!p.isValid; } catch (e) { return false; } };
function vortex(dim, c, o = {}) {
  const base = { ring: o.ring ?? 0.95, life: o.life ?? 0.9, rise: o.rise ?? 0.55, shrink: o.shrink ?? 0.75, spin: o.spin ?? 480, hmax: o.hmax ?? 1.45, tb: o.tb ?? 0, size: o.size ?? 0.07 };
  const k = o.k ?? 1;
  const put = (id, col, n, mul, a) => { n = Math.round(n * k); if (n >= 1) fx(dim, id, c, { ...base, size: base.size * mul, alpha: a, count: n, r: col[0], g: col[1], b: col[2] }); };
  put("lux:vortex", VX.dark, 4, 1, 1); put("lux:vortex", VX.violet, 4, 1, 1); put("lux:vortex", VX.magenta, 3, 0.9, 1); put("lux:vortex", VX.blue, 1, 0.85, 1);
  put("lux:vortex_glow", VX.violet, 1, 1.9, 0.7);       // one soft glowing pixel per batch
}
function vstar(dim, c, blue) {                          // a tiny star-like sparkle at a random spot around the spiral
  const a = Math.random() * Math.PI * 2, r = 0.45 + Math.random() * 0.5, col = blue ?? Math.random() < 0.4 ? [0.55, 0.85, 1.0] : [0.92, 0.8, 1.0];
  fx(dim, "lux:glint", { x: c.x + Math.cos(a) * r, y: c.y + 0.15 + Math.random() * 1.5, z: c.z + Math.sin(a) * r }, { count: 1, radius: 0.04, speed: 0.1, life: 0.5, size: 0.13, r: col[0], g: col[1], b: col[2] });
}
/** plays the vortex around the player, then calls done() ONCE (also if the player left or anything fails - the teleport must never get stuck) */
function _luxRtpGo(p, done) {
  let finished = false, started = false;
  const fin = () => { if (finished) return; finished = true; done(); };
  try {
    const t0 = system.currentTick; let burst = false;
    luxAt(p, "rtp_go", undefined, 0.8, 1);
    const spawn = bindCat((e) => {
      const l = p.location, dim = p.dimension, c = { x: l.x, y: l.y + 0.05, z: l.z };
      if (e < RTP_WARM - 4) { vortex(dim, c, { tb: e / 20, k: 0.8 + 0.6 * (e / RTP_WARM) }); if (e % 4 === 0) vstar(dim, c); }
      else if (!burst) { burst = true; vortex(dim, c, { tb: e / 20, life: 0.4, shrink: 1.0, rise: 0.3, spin: 700, k: 2.2 }); for (let i = 0; i < 3; i++) vstar(dim, c); }   // collapse into the centre
    });
    spawn(0);
    const h = system.runInterval(() => {
      let end = false;
      try { const e = system.currentTick - t0; if (!alive(p)) end = true; else { spawn(e); if (e >= RTP_WARM) end = true; } } catch (err) { end = true; }
      if (end) { system.clearRun(h); fin(); }
    }, 2);
    started = true;
  } catch (e) { /* ignore */ }
  if (!started) fin();
}
/** right after the teleport: a short, soft vortex rising around you where you land */
function _luxRtpLand(p) {
  try {
    luxAt(p, "rtp_land", undefined, 0.75, 1);
    later(2, () => {
      const l = p.location, dim = p.dimension, c = { x: l.x, y: l.y + 0.05, z: l.z };
      [0, 2, 4, 6].forEach((d, i) => later(d, () => { vortex(dim, c, { tb: d / 20, life: 0.7, k: 1.1, shrink: 0.85 }); if (i % 2 === 0) vstar(dim, c, i === 2); }));
    });
  } catch (e) { /* ignore */ }
}

export const luxArea = grouped("mining", _luxArea);
export const luxVein = grouped("mining", _luxVein);
export const luxTimber = grouped("mining", _luxTimber);
export const luxTeleport = grouped("tp", _luxTeleport);
export const luxTpOff = grouped("tp", _luxTpOff);
export const luxTpOn = grouped("tp", _luxTpOn);
export const luxRtpGo = grouped("tp", _luxRtpGo);
export const luxRtpLand = grouped("tp", _luxRtpLand);
export const luxProtect = grouped("protect", _luxProtect);
export const luxClearWarn = grouped("clearlag", _luxClearWarn);
export const luxClearDone = grouped("clearlag", _luxClearDone);
export const luxUi = grouped("menu", _luxUi);
export const luxCmd = grouped("menu", _luxCmd);
export const luxSave = grouped("menu", _luxSave);
export const luxToggle = grouped("menu", _luxToggle);
export const luxShop = grouped("shop", _luxShop);
export const luxDing = grouped("shop", _luxDing);