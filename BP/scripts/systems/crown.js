// CROWNS  (entity smp:crown is only the old, removed version)
//  1) DUEL ARENA CROWN
//   - The player who is #1 in the Kills top (the same "Kills" number as /top kills and the scoreboard) owns this crown, BUT only once he has at least
//     CROWN.minKills kills (10 by default).  Before that nobody has it.
//   - When somebody else passes him (more kills), the crown moves to the new #1 right away.  A tie keeps the crown with the player who already has it.
//   - The holder is saved in the world, so a restart keeps the crown on the same player.  The crown is only SEEN while the holder is online.
//  2) FROST CROWN = the RICHEST player (needs at least FROST.minMoney, default $100,000; admin can set $10,000 - $5,000,000 in /menu > Crowns > Admin).
//     The first to reach the money gets it; anyone who becomes richer takes it and the old holder loses it at once.  (Old notes below.)
//  2b) FROST CROWN look
//   - A second crown (silver + ice blue, ice spikes, turning snowflakes / ice shards, cold sparks).  Every player owns it (FROST.minKills = 0);
//     set FROST.minKills to a number of kills if it should be earned instead.
//  Choosing: /menu > Crowns.  A player wears ONE crown at a time: Duel Arena Crown, Frost Crown or none.  The choice is saved in the world.
//   The #1 player wears the Duel Arena Crown automatically when he takes it (he can change to the Frost Crown or take it off in /menu > Crowns).
//  - Each crown is a real worn item (smp:duel_crown_off / smp:frost_crown_off = OFF HAND by default, see CROWN.slot; attachables in the resource pack): it is PART of the
//    player's head, so it is 100% fixed.  The item is locked, kept on death, and removed from anybody who must not wear it.  Slow orbit of tiny gems + pulsing gems
//    are animations in the resource pack; tiny sparks and short arcs are particles from this script (gold / red for the Duel crown, ice blue / white for the Frost crown).
//  - Not shown for: spectator, invisibility, vanished staff, dead players (sparks stop; the invisible player hides the item himself).
// Everything is wrapped in try/catch: a problem here can never break another system.
import { world, system, ItemStack, ItemLockMode, EquipmentSlot } from "@minecraft/server";
import { allRecords, stats } from "../data.js";
import { money } from "../format.js";
import { fx } from "../lux.js";
import { notice } from "../smp/fxprefs.js";
import { isVanishedId, can, slog } from "./staffcore.js";
import { menuMsg } from "./menulang.js";

// ---------------------------------------------------------------- settings (edit here)
export const CROWN = {
  slot: "off",         // where the crown is worn: "off" (OFF HAND, default: the player may take it off, e.g. to hold a shield; he can never drop it) | "feet" | "legs" | "head" (these three are locked in the slot and push the old piece to the inventory)
  minKills: 10,        // kills needed before the #1 player gets the Duel Arena Crown
  checkSeconds: 30,    // safety check of the top (it is also checked 5 ticks after every player kill)
  sparkEvery: 6,       // ticks between two spark bursts (bigger = fewer particles)
  arcEvery: [50, 110], // ticks between two arcs (random between these two numbers)
};
export const FROST = {
  minMoney: 100000,    // money the richest player needs before he gets the Frost Crown (admin can change it: MONEY_MIN .. MONEY_MAX)
};
export const MONEY_MIN = 10000, MONEY_MAX = 5000000;

/** the two crowns: name, colour code and menu icon */
export const KINDS = {
  duel: { name: "Duel Arena Crown", color: "§6", icon: "textures/ui/shop/ic_crown" },
  frost: { name: "Frost Crown", color: "§b", icon: "textures/ui/shop/ic_frost_crown" },
};

const TYPE = "smp:crown", PROP = "crown:holder", FPROP = "crown:frost", PICKS = "crown:picks";
const SLOTS = {
  head: { items: { duel: "smp:duel_crown", frost: "smp:frost_crown" }, eq: EquipmentSlot.Head, name: "helmet" },
  legs: { items: { duel: "smp:duel_crown_legs", frost: "smp:frost_crown_legs" }, eq: EquipmentSlot.Legs, name: "leggings" },
  feet: { items: { duel: "smp:duel_crown_feet", frost: "smp:frost_crown_feet" }, eq: EquipmentSlot.Feet, name: "boots" },
  off:  { items: { duel: "smp:duel_crown_off", frost: "smp:frost_crown_off" }, eq: EquipmentSlot.Offhand, name: "off hand item", free: true },
};
const SL = SLOTS[CROWN.slot] ?? SLOTS.off, ITEM_OF = SL.items;
const ALL_ITEMS = Object.values(SLOTS).flatMap((x) => Object.values(x.items));
const valid = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (err) { return false; } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[crown] " + name + ": " + e); } };

// ---------------------------------------------------------------- holder of the Duel Arena Crown (saved in the world)
let holder = null;                       // { id, name } or null
try { const raw = world.getDynamicProperty(PROP); if (typeof raw === "string") holder = JSON.parse(raw); } catch (e) { holder = null; }
function saveHolder() { try { world.setDynamicProperty(PROP, holder ? JSON.stringify(holder) : undefined); } catch (e) { /* ignore */ } }
let frostHolder = null;                  // { id, name } = the richest player (owns the Frost Crown) or null
try { const raw = world.getDynamicProperty(FPROP); if (typeof raw === "string") frostHolder = JSON.parse(raw); } catch (e) { frostHolder = null; }
function saveFrost() { try { world.setDynamicProperty(FPROP, frostHolder ? JSON.stringify(frostHolder) : undefined); } catch (e) { /* ignore */ } }
const find = (id) => { try { return world.getAllPlayers().find((p) => p.id === id) ?? null; } catch (e) { return null; } };

// ---------------------------------------------------------------- the crown each player chose (saved in the world): { playerId: "duel" | "frost" | "none" }
let picks = {};
try { const raw = world.getDynamicProperty(PICKS); if (typeof raw === "string") { const o = JSON.parse(raw); if (o && typeof o === "object") picks = o; } } catch (e) { picks = {}; }
function savePicks() { try { world.setDynamicProperty(PICKS, Object.keys(picks).length ? JSON.stringify(picks) : undefined); } catch (e) { /* ignore */ } }

/** who is the holder now, or null */
export const crownHolder = () => holder;
export const frostCrownHolder = () => frostHolder;

// ---------------------------------------------------------------- ADMIN SETTINGS (/menu > Crowns > Admin, permission "duelset", saved in the world)
//  per crown: on (false = the crown was deleted: nobody wears it), name (custom name), min (kills needed), fx (effects given to EVERY player who wears the crown)
//  The effects belong to the crown, not to a player: whoever takes the crown (e.g. the new #1 in kills) gets them at once, and the old holder loses them at once.
const CFG = "crown:cfg";
export const MAX_FX = 14, MAX_LEVEL = 10;
/** the effects an admin can choose: [effect id, name] */
export const EFFECTS = [
  ["speed", "Speed"], ["haste", "Haste"], ["strength", "Strength"], ["jump_boost", "Jump Boost"], ["regeneration", "Regeneration"], ["resistance", "Resistance"],
  ["fire_resistance", "Fire Resistance"], ["water_breathing", "Water Breathing"], ["night_vision", "Night Vision"], ["absorption", "Absorption"], ["health_boost", "Health Boost"],
  ["saturation", "Saturation"], ["slow_falling", "Slow Falling"], ["luck", "Luck"], ["conduit_power", "Conduit Power"], ["dolphins_grace", "Dolphin's Grace"],
];
const fxName = (id) => (EFFECTS.find((e) => e[0] === id) ?? [id, id])[1];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const effectLabel = (e) => fxName(e.id) + " " + (ROMAN[e.lvl] ?? e.lvl);
let cfg = {};
try { const raw = world.getDynamicProperty(CFG); if (typeof raw === "string") { const o = JSON.parse(raw); if (o && typeof o === "object") cfg = o; } } catch (e) { cfg = {}; }
function saveCfg() { try { world.setDynamicProperty(CFG, Object.keys(cfg).length ? JSON.stringify(cfg) : undefined); return true; } catch (e) { console.warn("[crown] save failed: " + e); return false; } }
/** the settings of one crown (always a full object) */
export function crownCfg(kind) {
  const c = cfg[kind] ?? {};
  return {
    on: c.on !== false,
    name: typeof c.name === "string" && c.name ? c.name : null,
    min: Number.isFinite(c.min) ? c.min : null,
    fx: Array.isArray(c.fx) ? c.fx.filter((x) => x && EFFECTS.some((e) => e[0] === x.id)).map((x) => ({ id: x.id, lvl: Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(x.lvl)) || 1)) })) : [],
  };
}
const edit = (kind, fn) => { const c = crownCfg(kind); fn(c); const o = { on: c.on, fx: c.fx }; if (c.name) o.name = c.name; if (c.min !== null) o.min = c.min; cfg[kind] = o; if (c.on && !c.name && c.min === null && !c.fx.length) delete cfg[kind]; return saveCfg(); };
export const kindName = (kind) => crownCfg(kind).name ?? KINDS[kind].name;
/** duel: kills the #1 needs.  frost: MONEY the richest player needs. */
export const minKillsOf = (kind) => {
  const m = crownCfg(kind).min;
  if (kind === "frost") return Math.max(MONEY_MIN, Math.min(MONEY_MAX, Number.isFinite(m) ? m : FROST.minMoney));
  return m ?? CROWN.minKills;
};
const isOn = (kind) => crownCfg(kind).on;
/** every change: checks the permission again, writes the staff log, and makes everybody get the new crown / effects at once */
function change(actor, kind, detail, fn) {
  if (!actor || !can(actor, "duelset")) return { err: "You are not allowed to edit the crowns." };
  if (!(kind in KINDS)) return { err: "Unknown crown." };
  const r = fn(crownCfg(kind));
  if (r && r.err) return r;
  if (!edit(kind, (c) => { if (r && r.apply) r.apply(c); })) return { err: "Could not save (world data is full or unreadable)." };
  slog(actor, "crown", null, KINDS[kind].name + ": " + detail);
  regive = true;
  system.run(() => { safe("refresh", refresh); safe("sync", syncWorn); });
  return { ok: true };
}
/** add an effect, or change its level when the crown already has it */
export function setCrownEffect(actor, kind, id, lvl) {
  lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(lvl)) || 1));
  if (!EFFECTS.some((e) => e[0] === id)) return { err: "Unknown effect." };
  return change(actor, kind, "effect " + fxName(id) + " " + lvl, (c) => {
    const had = c.fx.some((x) => x.id === id);
    if (!had && c.fx.length >= MAX_FX) return { err: "A crown can have at most " + MAX_FX + " effects." };
    return { apply: (n) => { const f = n.fx.find((x) => x.id === id); if (f) f.lvl = lvl; else n.fx.push({ id, lvl }); } };
  });
}
export const removeCrownEffect = (actor, kind, id) => change(actor, kind, "removed effect " + fxName(id), () => ({ apply: (n) => { n.fx = n.fx.filter((x) => x.id !== id); } }));
export const clearCrownEffects = (actor, kind) => change(actor, kind, "removed all effects", () => ({ apply: (n) => { n.fx = []; } }));
/** an empty name = back to the normal name */
export function renameCrown(actor, kind, name) {
  name = String(name ?? "").replace(/§./g, "").replace(/[\r\n]/g, " ").trim().slice(0, 24);
  return change(actor, kind, name ? "renamed to " + name : "name reset", () => ({ apply: (n) => { n.name = name || null; } }));
}
export function setCrownMin(actor, kind, kills) {
  kills = Math.floor(Number(kills));
  if (kind === "frost") {
    if (!Number.isFinite(kills) || kills < MONEY_MIN || kills > MONEY_MAX) return { err: "Enter an amount between " + money(MONEY_MIN) + " and " + money(MONEY_MAX) + "." };
    return change(actor, kind, "money needed = " + money(kills), () => ({ apply: (n) => { n.min = kills; } }));
  }
  if (!Number.isFinite(kills) || kills < 0 || kills > 100000) return { err: "Enter a whole number of kills (0 - 100000)." };
  return change(actor, kind, "kills needed = " + kills, () => ({ apply: (n) => { n.min = kills; } }));
}
/** false = "delete" the crown (nobody wears it, no effects); true = bring it back */
export const setCrownEnabled = (actor, kind, on) => change(actor, kind, on ? "restored" : "deleted", () => ({ apply: (n) => { n.on = !!on; } }));
/** back to the original crown: no custom name, no effects, normal kills needed, ON */
export const resetCrown = (actor, kind) => change(actor, kind, "reset to default", () => ({ apply: (n) => { n.on = true; n.name = null; n.min = null; n.fx = []; } }));

function refreshDuel() {
  const recs = allRecords();
  let max = 0;
  for (const r of recs) if (r.kills > max) max = r.kills;
  let next = null;
  if (max >= minKillsOf("duel")) {
    const tops = recs.filter((r) => r.kills === max);
    const keep = holder ? tops.find((r) => r.id === holder.id) : null;      // a tie keeps the crown where it is
    const win = keep ?? tops.sort((a, b) => (b.dw ?? 0) - (a.dw ?? 0) || String(a.name).localeCompare(String(b.name)))[0];
    next = { id: win.id, name: win.name, kills: win.kills };
  }
  if ((next?.id ?? null) === (holder?.id ?? null)) { if (holder && next) holder.name = next.name; return; }
  const old = holder;
  holder = next ? { id: next.id, name: next.name } : null;
  saveHolder();
  if (next && picks[next.id] !== undefined) { delete picks[next.id]; savePicks(); }   // the new #1 wears the Duel Arena Crown at once (he can change it in /menu > Crowns)
  safe("sync", syncWorn);
  if (!next || !isOn("duel")) return;                                         // nobody has enough kills any more (kills were reset) / the crown was deleted by an admin: no announcement
  try {
    if (!old) notice("crown", "§6§l[Crown] §r§e" + next.name + " §funlocked the §6Duel Arena Crown §fwith §c" + next.kills + " kills§f!");
    else notice("crown", "§6§l[Crown] §r§e" + next.name + " §ftook the §6Duel Arena Crown §ffrom §c" + old.name + " §f(§c" + next.kills + " kills§f)!");
  } catch (e) { /* ignore */ }
  const p = find(next.id);
  if (p) {
    try { p.onScreenDisplay.setTitle(old ? "§6§lYOU TOOK THE CROWN!" : "§6§lDUEL ARENA CROWN UNLOCKED!", { subtitle: old ? "§fYou are now §e#1 §fin kills" : "§fYou got §c" + next.kills + " KILLS§f!", fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20 }); } catch (e) { /* ignore */ }
    try { p.playSound("random.levelup", { volume: 1, pitch: 0.8 }); } catch (e) { /* ignore */ }
  }
  const lost = old ? find(old.id) : null;
  if (lost) { try { lost.sendMessage(menuMsg(lost, "§c[Crown] §f" + next.name + " took your crown. Get more kills to win it back!")); } catch (e) { /* ignore */ } }
}

/** FROST CROWN: belongs to the RICHEST player, once he has at least the minimum money.  Whoever passes him takes it; the old holder loses it at once. */
function refreshFrost() {
  const recs = allRecords(), need = minKillsOf("frost");
  let max = -1;
  for (const r of recs) if (r.money > max) max = r.money;
  let next = null;
  if (max >= need) {
    const tops = recs.filter((r) => r.money === max);
    const keep = frostHolder ? tops.find((r) => r.id === frostHolder.id) : null;   // a tie keeps the crown where it is
    const win = keep ?? tops.sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];
    next = { id: win.id, name: win.name, money: win.money };
  }
  if ((next?.id ?? null) === (frostHolder?.id ?? null)) { if (frostHolder && next && frostHolder.name !== next.name) { frostHolder.name = next.name; saveFrost(); } return; }
  const old = frostHolder;
  frostHolder = next ? { id: next.id, name: next.name } : null;
  saveFrost();
  if (next && picks[next.id] !== undefined) { delete picks[next.id]; savePicks(); }
  safe("sync", syncWorn);
  if (!next || !isOn("frost")) return;
  try {
    if (!old) notice("crown", "§b§l[Crown] §r§e" + next.name + " §funlocked the §bFrost Crown §fas the richest player (§a" + money(next.money) + "§f)!");
    else notice("crown", "§b§l[Crown] §r§e" + next.name + " §ftook the §bFrost Crown §ffrom §c" + old.name + " §fand is now the richest (§a" + money(next.money) + "§f)!");
  } catch (e) { /* ignore */ }
  const p = find(next.id);
  if (p) {
    try { p.onScreenDisplay.setTitle("§b§lYOU ARE THE RICHEST!", { subtitle: "§fYou got the §bFrost Crown", fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20 }); } catch (e) { /* ignore */ }
    try { p.playSound("random.levelup", { volume: 1, pitch: 1.2 }); } catch (e) { /* ignore */ }
  }
  const lost = old ? find(old.id) : null;
  if (lost) { try { lost.sendMessage(menuMsg(lost, "§c[Crown] §f" + next.name + " became richer than you and took the Frost Crown.")); } catch (e) { /* ignore */ } }
}
function refresh() { safe("duel top", refreshDuel); safe("frost top", refreshFrost); }

// ---------------------------------------------------------------- which crown does a player own / wear
const testers = new Set();               // /crown (admin test): these players own the Duel Arena Crown until they use /crown again
const hasDuel = (id) => isOn("duel") && (testers.has(id) || holder?.id === id);
const killsOf = (p) => { try { return Number(stats(p)?.kills) || 0; } catch (e) { return 0; } };

/** the crowns this player owns: "duel" (the #1 in kills / admin test) and "frost" (the richest player) */
function owned(p) {
  const out = [];
  if (hasDuel(p.id)) out.push("duel");
  if (isOn("frost") && frostHolder?.id === p.id) out.push("frost");
  return out;
}
/** the crown this player wears now: his choice (if he still owns it), else the Duel Arena Crown for its holder, else none */
function kindFor(p) {
  const own = owned(p), pick = picks[p.id];
  if (pick === "none") return null;
  if (pick) return own.includes(pick) ? pick : null;
  return own.includes("duel") ? "duel" : own.includes("frost") ? "frost" : null;
}

/** for the /menu > Crowns page */
export function crownInfo(p) {
  return { owned: owned(p), current: kindFor(p), holder, kills: killsOf(p), duelMin: minKillsOf("duel"), frostMin: minKillsOf("frost"), frostHolder, on: { duel: isOn("duel"), frost: isOn("frost") } };
}
/** /menu > Crowns: wear "duel", "frost" or "none".  Returns false when the player does not own that crown. */
export function pickCrown(p, kind) {
  if (kind !== "none" && !(kind in KINDS)) return false;
  if (kind !== "none" && !owned(p).includes(kind)) return false;
  picks[p.id] = kind;
  savePicks();
  system.run(() => safe("sync", syncWorn));
  return true;
}

/** /crown (Owner / Admin): put the Duel Arena Crown on yourself to test it, or take it off again.  Returns true when it is ON now. */
export function toggleTestCrown(p) {
  const on = !testers.has(p.id);
  if (on) { testers.add(p.id); if (picks[p.id] !== undefined) { delete picks[p.id]; savePicks(); } } else testers.delete(p.id);
  system.run(() => safe("sync", syncWorn));
  return on;
}

// ---------------------------------------------------------------- the crown on the head (a worn item)
const shown = new Map();                 // player id -> the crown he wears now ("duel" / "frost" / null), refreshed by syncWorn

function wear(p, eq, old, kind) {
  if (old) {                                                    // the helmet he had on goes to the inventory (or to the floor when it is full)
    let left = old;
    try { const inv = p.getComponent("minecraft:inventory")?.container; if (inv) left = inv.addItem(old); } catch (e) { /* ignore */ }
    if (left) { try { p.dimension.spawnItem(left, p.location); } catch (e) { /* ignore */ } }
    try { p.sendMessage(menuMsg(p, "§6[Crown] §7Your " + SL.name + " was moved to your inventory while you wear the crown.")); } catch (e) { /* ignore */ }
  }
  eq.setEquipment(SL.eq, makeCrown(kind));
}
function makeCrown(kind) {
  const crown = new ItemStack(ITEM_OF[kind], 1);
  crown.lockMode = SL.free ? ItemLockMode.inventory : ItemLockMode.slot;   // never dropped; "off hand" mode: it may move inside the inventory (so a shield fits), the other modes lock it in its slot
  crown.keepOnDeath = true;                                                // the same crown is back after respawning
  try {
    const c = crownCfg(kind), min = minKillsOf(kind);
    if (c.name) crown.nameTag = KINDS[kind].color + c.name;
    const lore = kind === "frost"
      ? ["§7Worn by the §brichest §7player", "§7(" + money(min) + "+)"]
      : ["§7Worn by the §e#1 §7in kills", "§7(" + min + "+ kills)"];
    if (c.fx.length) { lore.push("§7Effects:"); for (const e of c.fx) lore.push("§8- §f" + effectLabel(e)); }
    crown.setLore(lore);
  } catch (e) { /* ignore */ }
  return crown;
}
const lastWarn = new Map();
/** off hand mode: gives the crown (off hand when it is free, else the inventory) - only when the player has NO crown of the wanted kind */
function giveFree(p, eq, inv, inSlot, kind) {
  if (!inSlot) { eq.setEquipment(SL.eq, makeCrown(kind)); return; }
  const left = inv ? inv.addItem(makeCrown(kind)) : makeCrown(kind);
  if (!left) { p.sendMessage(menuMsg(p, "§6[Crown] §fThe crown is in your inventory. Move it to your §eoff hand §fto wear it.")); return; }
  if (Date.now() - (lastWarn.get(p.id) ?? 0) > 15000) { lastWarn.set(p.id, Date.now()); p.sendMessage(menuMsg(p, "§c[Crown] §fYour inventory is full: make a free slot to get the crown.")); }
}

/** makes sure every player wears the crown he chose (or the one he owns by default) and nobody else wears one */
let regive = false;                      // an admin changed a crown (name / effects / kills): every worn crown is replaced by the new version
function syncWorn() {
  shown.clear();
  const redo = regive; regive = false;
  for (const p of world.getAllPlayers()) {
    safe("sync " + p.name, () => {
      const eq = p.getComponent("minecraft:equippable");
      if (!eq) return;
      if (redo) {
        const x = eq.getEquipment(SL.eq); if (x && ALL_ITEMS.includes(x.typeId)) eq.setEquipment(SL.eq, undefined);
        const iv = p.getComponent("minecraft:inventory")?.container;
        if (iv) for (let i = 0; i < iv.size; i++) { const it = iv.getItem(i); if (it && ALL_ITEMS.includes(it.typeId)) iv.setItem(i, undefined); }
      }
      const kind = kindFor(p), want = kind ? ITEM_OF[kind] : null;
      shown.set(p.id, kind);
      const cur = eq.getEquipment(SL.eq), curCrown = !!cur && ALL_ITEMS.includes(cur.typeId);
      for (const o of Object.values(SLOTS)) { if (o.eq !== SL.eq) { const x = eq.getEquipment(o.eq); if (x && ALL_ITEMS.includes(x.typeId)) eq.setEquipment(o.eq, undefined); } }   // a crown left in another slot (after a setting change)
      const inv = p.getComponent("minecraft:inventory")?.container;
      if (SL.free) {                                          // off hand mode: the player may keep the crown in his inventory (e.g. a shield in the off hand): never give a second one
        let head = cur;
        if (curCrown && cur.typeId !== want) { eq.setEquipment(SL.eq, undefined); head = undefined; }   // the other crown (he changed it) or not allowed any more: gone
        let n = head && head.typeId === want ? 1 : 0;
        if (inv) for (let i = 0; i < inv.size; i++) {
          const it = inv.getItem(i);
          if (!it || !ALL_ITEMS.includes(it.typeId)) continue;
          if (it.typeId === want && n === 0) n = 1; else inv.setItem(i, undefined);   // not the wanted crown / a second crown / an old kind: gone
        }
        if (want && n === 0) giveFree(p, eq, inv, head, kind);
        return;
      }
      const curId = curCrown ? cur.typeId : null;
      if (want) { if (curId !== want) { if (curId) eq.setEquipment(SL.eq, makeCrown(kind)); else wear(p, eq, cur, kind); } }   // the slot already holds the other crown: swap it, nothing to move
      else if (curId) eq.setEquipment(SL.eq, undefined);
      if (inv) for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && ALL_ITEMS.includes(it.typeId)) inv.setItem(i, undefined); }      // a crown must never sit anywhere else
    });
  }
  safe("effects", applyFx);
}

// ---------------------------------------------------------------- the effects of the crown (set by the admin): given to everybody who wears it, taken away from everybody who does not
const given = new Map();                 // player id -> Set of effect ids this script gave him (so only those are removed again)
function applyFx() {
  const ids = new Set();
  for (const p of world.getAllPlayers()) {
    ids.add(p.id);
    safe("fx " + p.name, () => {
      const kind = shown.get(p.id), want = kind && isOn(kind) ? crownCfg(kind).fx : [];
      const prev = given.get(p.id) ?? new Set(), now = new Set();
      let alive = true;
      try { const h = p.getComponent("minecraft:health"); alive = !h || h.currentValue > 0; } catch (e) { alive = true; }
      if (alive) for (const e of want) {
        try { p.addEffect(e.id, 220, { amplifier: e.lvl - 1, showParticles: false }); now.add(e.id); } catch (er) { /* effect not available in this version */ }
      }
      for (const id of prev) if (!now.has(id)) { try { p.removeEffect(id); } catch (er) { /* ignore */ } }
      if (now.size) given.set(p.id, now); else given.delete(p.id);
    });
  }
  for (const id of [...given.keys()]) if (!ids.has(id)) given.delete(id);
}
system.runInterval(() => safe("syncWorn", syncWorn), 20);
world.afterEvents.playerSpawn.subscribe(() => system.runTimeout(() => safe("syncWorn", syncWorn), 10));
world.afterEvents.playerLeave.subscribe(({ playerId }) => { testers.delete(playerId); shown.delete(playerId); given.delete(playerId); });

function visible(p) {
  try {
    if (!valid(p) || isVanishedId(p.id)) return false;
    if (p.getGameMode() === "spectator") return false;
    const h = p.getComponent("minecraft:health");
    if (h && h.currentValue <= 0) return false;
    if (p.getEffect("invisibility")) return false;
  } catch (e) { return false; }
  return true;
}

// sparks + arcs around the head of every crown wearer (Duel: gold / red + red lightning, Frost: ice blue / white + cold glints)
const nextArc = new Map();
function sparks(p, tick, kind) {
  const frost = kind === "frost";
  const dim = p.dimension, head = p.getHeadLocation(), base = { x: head.x, y: head.y + 0.15, z: head.z };
  if (tick % CROWN.sparkEvery === 0) {
    const a = Math.random() < (frost ? 0.6 : 0.55);
    const col = frost ? { r: a ? 0.55 : 0.95, g: a ? 0.9 : 0.98, b: 1.0 } : { r: 1.0, g: a ? 0.8 : 0.15, b: a ? 0.3 : 0.2 };
    fx(dim, "lux:spark", { x: base.x, y: base.y + 0.2, z: base.z }, { count: 1, radius: 0.4, speed: frost ? 0.28 : 0.35, life: frost ? 1.1 : 0.9, size: 0.08, ...col });
  }
  if (tick >= (nextArc.get(p.id) ?? 0)) {                 // short arc that orbits the crown
    nextArc.set(p.id, tick + CROWN.arcEvery[0] + Math.floor(Math.random() * (CROWN.arcEvery[1] - CROWN.arcEvery[0])));
    const a0 = Math.random() * Math.PI * 2, span = 0.9 + Math.random() * 0.6, y0 = base.y + 0.05 + Math.random() * 0.3;
    for (let i = 0; i < 7; i++) {
      const a = a0 + (span * i) / 6, r = 0.42 + (Math.random() - 0.5) * 0.1;
      const col = frost ? { r: i % 3 === 0 ? 0.95 : 0.45, g: i % 3 === 0 ? 0.98 : 0.85, b: 1.0 } : { r: 1.0, g: i % 3 === 0 ? 0.75 : 0.2, b: 0.25 };
      fx(dim, "lux:pixelglow", { x: base.x + Math.cos(a) * r, y: y0 + (Math.random() - 0.5) * 0.12, z: base.z + Math.sin(a) * r }, { count: 1, half: 0.01, speed: 0.02, life: frost ? 0.4 : 0.3, size: 0.07, ...col });
    }
  }
}
system.runInterval(() => safe("sparks", () => {
  const tick = system.currentTick;
  for (const p of world.getAllPlayers()) { const kind = shown.get(p.id); if (kind && visible(p)) safe("sparks", () => sparks(p, tick, kind)); }
}), 2);

// ---------------------------------------------------------------- the top changes
world.afterEvents.entityDie.subscribe((ev) => safe("kill", () => {
  const dead = ev.deadEntity, k = ev.damageSource?.damagingEntity;
  if (dead?.typeId === "minecraft:player" && k?.typeId === "minecraft:player") system.runTimeout(() => safe("refresh", refresh), 5);   // data.js adds the kill first
}));
system.runInterval(() => safe("check", refresh), CROWN.checkSeconds * 20);
system.runInterval(() => safe("frost check", refreshFrost), 200);       // money changes all the time: the richest is checked every 10 seconds
system.runTimeout(() => safe("start", refresh), 100);

// ---------------------------------------------------------------- clean up: old crown entities (earlier version) and crown items lying on the ground
system.runInterval(() => safe("sweep", () => {
  for (const dn of ["overworld", "nether", "the_end"]) {
    let dim; try { dim = world.getDimension(dn); } catch (e) { continue; }
    try { for (const e of dim.getEntities({ type: TYPE })) { try { e.remove(); } catch (er) { /* ignore */ } } } catch (e) { /* ignore */ }
    try { for (const e of dim.getEntities({ type: "minecraft:item" })) { try { if (e.getComponent("minecraft:item")?.itemStack?.typeId && ALL_ITEMS.includes(e.getComponent("minecraft:item").itemStack.typeId)) e.remove(); } catch (er) { /* ignore */ } } } catch (e) { /* ignore */ }
  }
}), 100);
