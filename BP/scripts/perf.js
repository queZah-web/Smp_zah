// =====================================================================================================
// PERFORMANCE LAYER  (imported FIRST by main.js, before every other system)
//
// Nothing in the game changes: every function below returns exactly what the game would return.
// It only stops asking the game engine the same question many times:
//
//   1. World saved data (world dynamic properties)
//      Only THIS add-on can read / write its own world properties, so a copy kept in memory is always right.
//        * getDynamicProperty(key)  -> read from memory after the first time (no engine call, no string copy)
//        * setDynamicProperty(key, v) -> skipped when the value is EXACTLY the one already saved (no disk write)
//        * getDynamicPropertyIds()  -> kept up to date in memory (it was a full list of every key, many times a second)
//
//   2. Player lists
//      world.getAllPlayers() / world.getPlayers() / dimension.getPlayers()  (without options) were called
//      more than 100 times in the same tick by the different systems. The list is now made once per tick
//      (and again at once when a player joins / leaves). Every caller still gets its own copy of the array.
//
//   3. world.getDimension(id) -> the same dimension object, kept in memory.
//
// Everything is wrapped in try/catch: if the game does not allow a patch, the normal game function is used.
// =====================================================================================================
import { world, system, World, Dimension } from "@minecraft/server";

const patch = (proto, inst, name, make) => {
  try {
    const target = proto && typeof proto[name] === "function" ? proto : inst;
    const orig = target[name];
    if (typeof orig !== "function") return false;
    const fn = make(orig);
    try { target[name] = fn; } catch (e) { /* read only */ }
    if (target[name] !== fn) { try { Object.defineProperty(target, name, { value: fn, writable: true, configurable: true }); } catch (e) { /* ignore */ } }
    if (target[name] === fn) return true;
    if (target !== inst) {                                                       // the prototype refused: try the object itself
      try { Object.defineProperty(inst, name, { value: fn, writable: true, configurable: true }); } catch (e) { /* ignore */ }
      return inst[name] === fn;
    }
    return false;
  } catch (e) { return false; }
};
const WP = (() => { try { return World?.prototype ?? Object.getPrototypeOf(world); } catch (e) { return null; } })();

// ---------------------------------------------------------------- 1. world dynamic properties
const MISS = Symbol("miss");
const dp = new Map();                 // key -> value (undefined = known to be empty)
let ids = null;                       // Set of every key (null until the first getDynamicPropertyIds)
const isVec = (v) => v !== null && typeof v === "object";
const copyVec = (v) => (isVec(v) ? { x: v.x, y: v.y, z: v.z } : v);
const same = (a, b) => (a === b) || (isVec(a) && isVec(b) && a.x === b.x && a.y === b.y && a.z === b.z);

patch(WP, world, "getDynamicProperty", (orig) => function (key) {
  if (this !== world) return orig.call(this, key);
  const k = String(key);
  const c = dp.has(k) ? dp.get(k) : MISS;
  if (c !== MISS) return copyVec(c);
  const v = orig.call(this, key);                                                 // throws while the world is not loaded: nothing is kept then
  dp.set(k, copyVec(v));
  return v;
});
patch(WP, world, "setDynamicProperty", (orig) => function (key, value) {
  if (this !== world) return orig.call(this, key, value);
  const k = String(key);
  if (dp.has(k) && same(dp.get(k), value)) return;                                // exactly the same value is already saved: nothing to write
  try { orig.call(this, key, value); } catch (e) { dp.delete(k); throw e; }        // a failed write keeps the game's own behaviour (and error)
  dp.set(k, copyVec(value));
  if (ids) { if (value === undefined) ids.delete(k); else ids.add(k); }
});
patch(WP, world, "getDynamicPropertyIds", (orig) => function () {
  if (this !== world) return orig.call(this);
  if (!ids) ids = new Set(orig.call(this));
  return Array.from(ids);
});
patch(WP, world, "clearDynamicProperties", (orig) => function () {
  if (this !== world) return orig.call(this);
  try { return orig.call(this); } finally { dp.clear(); ids = null; }
});

// ---------------------------------------------------------------- 2. player lists (one list per tick)
let tickNow = () => { try { return system.currentTick; } catch (e) { return -1; } };
let allT = -2, allList = null;
const dimLists = new Map();           // dimension id -> { t, list }
const dropLists = () => { allT = -2; allList = null; dimLists.clear(); };

patch(WP, world, "getAllPlayers", (orig) => function () {
  if (this !== world) return orig.call(this);
  const t = tickNow();
  if (allList === null || allT !== t) { allList = orig.call(this); allT = t; }
  return allList.slice();
});
patch(WP, world, "getPlayers", (orig) => function (options) {
  if (this !== world || options !== undefined) return orig.call(this, options);
  return world.getAllPlayers();
});
try {
  const DP = Dimension?.prototype;
  if (DP && typeof DP.getPlayers === "function") {
    const orig = DP.getPlayers;
    DP.getPlayers = function (options) {
      if (options !== undefined) return orig.call(this, options);
      const id = this.id, t = tickNow(), c = dimLists.get(id);
      if (c && c.t === t) return c.list.slice();
      const list = orig.call(this);
      dimLists.set(id, { t, list });
      return list.slice();
    };
  }
} catch (e) { /* the normal function stays */ }
// a player joins / leaves / respawns: the next call makes a fresh list at once (same tick too)
try { world.beforeEvents.playerLeave.subscribe(dropLists); } catch (e) { /* ignore */ }
try { world.afterEvents.playerLeave.subscribe(dropLists); } catch (e) { /* ignore */ }
try { world.afterEvents.playerJoin.subscribe(dropLists); } catch (e) { /* ignore */ }
try { world.afterEvents.playerSpawn.subscribe(dropLists); } catch (e) { /* ignore */ }
try { world.afterEvents.playerDimensionChange.subscribe(dropLists); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- 3. dimensions
const dims = new Map();
patch(WP, world, "getDimension", (orig) => function (id) {
  if (this !== world) return orig.call(this, id);
  const k = String(id);
  let d = dims.get(k);
  if (d === undefined) { d = orig.call(this, id); dims.set(k, d); }
  return d;
});

export const perfOn = true;
