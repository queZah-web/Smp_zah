// Persistent per-player data, stored in WORLD dynamic properties keyed by player id
// (so it also works for offline players: /baltop, etc).
import { world, system } from "@minecraft/server";
import { duelView } from "./systems/duelstate.js";
import { clanView } from "./systems/clanstate.js";

export const STARTER_MONEY = 0;          // money a NEW player starts with
const PFX = "p:";
const MAX_TX = 120;
const cache = new Map();           // id -> { s: stats, session: ms timestamp }
const listeners = [];
export const onChange = (fn) => listeners.push(fn);
const txListeners = [];
export const onTx = (fn) => txListeners.push(fn);      // called after every shop transaction (used by the SMP statistics)

const blank = (name) => ({ name, money: STARTER_MONEY, shards: 0, kills: 0, deaths: 0, dw: 0, play: 0, spent: 0, earned: 0, bxp: 0, sxp: 0, tx: [], lim: {}, joined: Date.now() });

// A saved record is NEVER replaced by an empty one because of a read problem:
//   * the read failed (world not ready yet, engine busy)  -> the player gets a temporary record that is NOT saved; the real one
//     is read again every 5 s and then used (nothing is overwritten)
//   * the saved text is broken (not JSON)                 -> it is copied to "pbad:<id>" first, then a new record starts
let readFailed = false;
function readRaw(id) {
  readFailed = false;
  let raw;
  try { raw = world.getDynamicProperty(PFX + id); } catch (e) { readFailed = true; return null; }
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch (e) { try { world.setDynamicProperty("pbad:" + id, raw); } catch (x) { /* ignore */ } console.warn("[data] broken record of " + id + " kept in pbad:" + id); return null; }
}
const MAX_LEN = 30000;                     // a world property holds at most 32767 characters
function write(id, s) {
  let txt = JSON.stringify(s);
  if (txt.length > MAX_LEN && Array.isArray(s.tx)) { s.tx.length = Math.min(s.tx.length, 40); txt = JSON.stringify(s); }   // too long: keep fewer transactions, never lose the money
  try { world.setDynamicProperty(PFX + id, txt); } catch (e) { console.warn("save failed " + id + " " + e); }
}
function entry(id, name) {
  let e = cache.get(id);
  if (!e) {
    const got = readRaw(id), unsafe = readFailed;
    const s = got ?? blank(name);
    s.tx ??= []; s.lim ??= {}; s.spent ??= 0; s.earned ??= 0; s.bxp ??= 0; s.sxp ??= 0; s.dw ??= 0; s.hud ??= "panel";
    e = { s, session: Date.now(), unsafe };
    cache.set(id, e);
  }
  if (name) e.s.name = name;
  return e;
}
function settle(e) {                      // fold the running session into stored playtime
  const now = Date.now();
  e.s.play += (now - e.session) / 1000;
  e.session = now;
}

export const stats = (p) => entry(p.id, p.name).s;
export function playSeconds(p) { const e = entry(p.id, p.name); return e.s.play + (Date.now() - e.session) / 1000; }
export function touch(p) { for (const fn of listeners) fn(p); }

export function addTx(p, rec) {
  const s = stats(p);
  s.tx.unshift({ t: Date.now(), ...rec });
  if (s.tx.length > MAX_TX) s.tx.length = MAX_TX;
  if (!rec.cur) { if (rec.type === "buy") s.spent += rec.total; else if (rec.type === "sell") s.earned += rec.total; }
  for (const fn of txListeners) { try { fn(p, rec); } catch (e) { /* a hook must never break a purchase */ } }
}

// ---- money / shards -------------------------------------------------------
export const balance = (p) => stats(p).money;
export function addMoney(p, n) { stats(p).money += Math.floor(n); touch(p); }
export function takeMoney(p, n) { const s = stats(p); n = Math.floor(n); if (s.money < n) return false; s.money -= n; touch(p); return true; }
export function addShards(p, n) { stats(p).shards += Math.floor(n); touch(p); }
export function takeShards(p, n) { const s = stats(p); n = Math.floor(n); if (s.shards < n) return false; s.shards -= n; touch(p); return true; }

// ---- limits (real timers, wall-clock) -----------------------------------------
export const limitLeft = (p, key, cooldownMs) => Math.max(0, (stats(p).lim[key] ?? 0) + cooldownMs - Date.now());
export function stampLimit(p, key) { stats(p).lim[key] = Date.now(); }

// ---- all records (for /baltop) ------------------------------------------------
export function allRecords() {
  const out = [];
  for (const id of world.getDynamicPropertyIds()) {
    if (!id.startsWith(PFX)) continue;
    const pid = id.slice(PFX.length);
    const live = cache.get(pid);
    const s = live ? live.s : readRaw(pid);
    if (s) out.push({ id: pid, name: s.name, money: s.money, shards: s.shards, kills: s.kills ?? 0, dw: s.dw ?? 0, tw: s.tw ?? 0, sw: s.sw ?? 0, dr: s.dr ?? 0, pw: s.pw ?? 0, qw: s.qw ?? 0, cw: s.cw ?? 0, spw: s.spw ?? 0, earned: s.earned ?? 0, spent: s.spent ?? 0, play: s.play ?? 0 });
  }
  return out;
}

// ---- persistence ----------------------------------------------------------------
system.runInterval(() => {
  for (const [id, e] of cache) {
    if (e.unsafe) {                                                // the first read failed: try again, never write over the saved record
      const got = readRaw(id);
      if (readFailed) continue;
      if (got) { got.tx ??= []; got.lim ??= {}; got.spent ??= 0; got.earned ??= 0; got.bxp ??= 0; got.sxp ??= 0; got.dw ??= 0; got.hud ??= "panel"; if (e.s.name) got.name = e.s.name; e.s = got; }
      e.unsafe = false; e.session = Date.now();
    }
    settle(e); write(id, e.s);
  }
}, 100);   // every 5 s

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) { const e = entry(player.id, player.name); e.session = Date.now(); if (!e.unsafe) write(player.id, e.s); touch(player); }
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => {          // exact final playtime, then forget
  const e = cache.get(playerId);
  if (!e) return;
  if (!e.unsafe) { settle(e); write(playerId, e.s); } cache.delete(playerId);
});

// ---- PvP: kills / deaths / shards ------------------------------------------------
export const SHARDS_PER_KILL = 1;           // normal PvP kill
export const SHARDS_PER_DUEL_KILL = 40;     // kill inside a 1 vs 1 duel fight (a draw / time up gives nothing to anybody)
const REPEAT_COOLDOWN_MS = 5 * 60 * 1000;     // same victim again within 5 min gives nothing (anti shard-farm)
const lastKill = new Map();
world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  if (dead.typeId !== "minecraft:player") return;
  stats(dead).deaths += 1; touch(dead);
  const killer = ev.damageSource?.damagingEntity;
  if (!killer || killer.typeId !== "minecraft:player" || killer.id === dead.id) return;
  if (clanView.same(killer.id, dead.id)) { killer.sendMessage("§7[Clan] Killing a clan mate gives no kill and no shards."); return; }     // no farming inside a clan
  const key = killer.id + ">" + dead.id;
  const inDuel = duelView.fighting(killer.id, dead.id);
  if (!inDuel && Date.now() - (lastKill.get(key) ?? 0) < REPEAT_COOLDOWN_MS) { killer.sendMessage("§7[PvP] Same victim again too soon - no reward."); return; }
  lastKill.set(key, Date.now());
  const reward = inDuel ? SHARDS_PER_DUEL_KILL : SHARDS_PER_KILL;
  stats(killer).kills += 1; stats(killer).shards += reward; touch(killer);
  killer.sendMessage(`§d+${reward} Shards §7for killing §f${dead.name}`);
});

// ---- /pay support: works for players that are online AND offline --------------------------------------
// Adds money to a player by id. Online players use the live cache, offline players are read / written straight from the world data.
export function addMoneyById(id, n) {
  n = Math.floor(n);
  const live = cache.get(id);
  if (live) { live.s.money += n; return true; }
  const s = readRaw(id);
  if (!s) return false;                              // never joined -> nothing to pay
  s.money = (s.money ?? 0) + n;
  write(id, s);
  return true;
}
// Everybody who ever joined: [{ id, name }] (from the saved player records)
export const knownPlayers = () => allRecords().map((r) => ({ id: r.id, name: r.name }));

// ---- clans support: stats of a player by id (online or offline) and shards by id
export function statOf(id) {
  const live = cache.get(id), s = live ? live.s : readRaw(id);
  return s ? { money: Number(s.money) || 0, kills: Number(s.kills) || 0 } : null;
}
export function addShardsById(id, n) {
  n = Math.floor(n);
  const live = cache.get(id);
  if (live) { live.s.shards += n; return true; }
  const s = readRaw(id);
  if (!s) return false;
  s.shards = (s.shards ?? 0) + n;
  write(id, s);
  return true;
}

// ---- clan member profiles: the whole record of any player by id (online or offline), read only
export function recordOf(id) {
  const live = cache.get(id);
  return live ? live.s : readRaw(id);
}

// ---- account recovery: a player came back with a NEW id (new account / the server forgot him) -> the Owner moves his old
//      record onto the new one (/opr > Players > the player > "Old account").  Numbers are ADDED, the old record is removed.
const SUM_KEYS = ["money", "shards", "kills", "deaths", "dw", "play", "spent", "earned", "bxp", "sxp", "tw", "tl", "sw", "sl", "dr", "pw", "pl", "qw", "ql", "cw", "cl", "spw", "spl"];
/** other saved records with the same name (not this id): [{ id, name, money }] */
export function sameNameRecords(id, name) {
  const n = String(name ?? "").toLowerCase(), out = [];
  for (const r of allRecords()) if (r.id !== id && String(r.name ?? "").toLowerCase() === n) out.push(r);
  return out;
}
export function mergeRecord(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return { err: "Wrong accounts." };
  const from = cache.get(fromId)?.s ?? readRaw(fromId); if (!from) return { err: "The old record was not found." };
  const live = cache.get(toId), to = live ? live.s : readRaw(toId); if (!to) return { err: "The new player has no record yet (he must join once)." };
  for (const k of SUM_KEYS) if (typeof from[k] === "number") to[k] = (Number(to[k]) || 0) + from[k];
  if (Array.isArray(from.tx)) to.tx = [...(to.tx ?? []), ...from.tx].sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, MAX_TX);
  if (from.joined && (!to.joined || from.joined < to.joined)) to.joined = from.joined;
  if (!live) write(toId, to);
  try { world.setDynamicProperty("pold:" + fromId, JSON.stringify(from)); } catch (e) { /* backup of the old record */ }
  cache.delete(fromId);
  try { world.setDynamicProperty(PFX + fromId, undefined); } catch (e) { /* ignore */ }
  return { ok: true, money: Number(from.money) || 0 };
}
