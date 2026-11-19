// MAGNET (FREE, ON for everybody by default; the player can switch it OFF in /menu -> Mining Tools -> Magnet): dropped items within MAGNET_RANGE (6) blocks gather UNDER the player and follow him.
//  * Nothing goes straight into the inventory: the items slide to the player's feet and the game picks them up as usual.
//    When the inventory is full they simply stay in a pile under the player.
//  * Each item is pulled only by the player it is closest to, so two players next to each other never steal each other's drops.
//  * Items the player THROWS himself (Q / dropping from the inventory) are never pulled back - they stay where he dropped them.
//  * The player can switch it ON / OFF any time (the time keeps running).  Spectators are ignored.
//  * Safety: the magnet PAUSES while another player (not a spectator) is within MAGNET_PAUSE (10) blocks, and comes back when he walks away.
//    It also does nothing when the player stands inside protected land or the AFK area, and never pulls an item that lies inside them.
//  * A short message tells the player when the Auto-Smelt time is over.
import { world, system } from "@minecraft/server";
import { MAGNET_RANGE, MAGNET_PAUSE } from "./config.js";
import { claimAt } from "./landcore.js";
import { pointInAfkZone } from "./afk.js";
import { activeOpts, timeLeft } from "./mining.js";
import { menuMsg } from "./menulang.js";

const STOP = 0.9;                     // closer than this (blocks) to the feet: leave it, the game picks it up
const thrown = new Map();             // item entity id -> forget time (ms): items the player dropped himself
const FORGET = 5 * 60 * 1000;         // dropped items disappear after 5 minutes anyway

// an item that appears right at the player's eye height (not at a block) was thrown by him
try {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    try {
      const e = ev.entity;
      if (!e || e.typeId !== "minecraft:item") return;
      const l = e.location, d = e.dimension.id;
      for (const p of world.getAllPlayers()) {
        if (p.dimension.id !== d) continue;
        const c = p.location, dy = l.y - c.y;
        if (Math.abs(l.x - c.x) < 0.45 && Math.abs(l.z - c.z) < 0.45 && dy > 0.9 && dy < 1.7) { thrown.set(e.id, Date.now() + FORGET); return; }
      }
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[magnet] cannot watch item spawns: " + e); }

const survivalLike = (p) => { try { return String(p.getGameMode()).toLowerCase() !== "spectator"; } catch (e) { return true; } };

let tick = 0;
system.runInterval(() => {
  tick++;
  try {
    const players = world.getAllPlayers();
    if (!players.length) return;
    if (tick % 100 === 0) { const now = Date.now(); for (const [k, t] of thrown) if (t < now) thrown.delete(k); }
    for (const p of players) {
      try {
        if (!activeOpts(p).magnet || !survivalLike(p)) continue;
        const c = p.location, dim = p.dimension;
        if (claimAt(dim.id, c.x, c.y, c.z) || pointInAfkZone(dim.id, c.x, c.y, c.z)) continue;   // inside protected land or the AFK area: no magnet
        let near = false;                                                        // another player close by: pause (protects his items)
        for (const q of players) {
          if (q.id === p.id || q.dimension.id !== dim.id || !survivalLike(q)) continue;
          const o = q.location;
          if (Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z) <= MAGNET_PAUSE) { near = true; break; }
        }
        if (near) continue;
        const items = dim.getEntities({ type: "minecraft:item", location: c, maxDistance: MAGNET_RANGE });
        for (const it of items) {
          try {
            if (thrown.has(it.id)) continue;
            const l = it.location;
            if (claimAt(dim.id, l.x, l.y, l.z) || pointInAfkZone(dim.id, l.x, l.y, l.z)) continue;   // an item inside protected land / the AFK area is never pulled out
            const dx = c.x - l.x, dy = c.y + 0.2 - l.y, dz = c.z - l.z, d = Math.hypot(dx, dy, dz);
            if (d < STOP || d > MAGNET_RANGE + 0.5) continue;
            let mine = true;                                                    // am I the closest player to this item?
            for (const q of players) {
              if (q.id === p.id || q.dimension.id !== dim.id) continue;
              const o = q.location;
              if (Math.hypot(o.x - l.x, o.y - l.y, o.z - l.z) < d) { mine = false; break; }
            }
            if (!mine) continue;
            const s = Math.min(0.45, 0.16 + d * 0.05);                           // a little faster when far away
            it.clearVelocity();
            it.applyImpulse({ x: (dx / d) * s, y: (dy / d) * s + 0.04, z: (dz / d) * s });
          } catch (err) { /* this item is gone */ }
        }
      } catch (err) { /* this player left */ }
    }
  } catch (e) { console.warn("[magnet] " + e); }
}, 2);

// "time is over" messages (checked once a second)
const had = new Map();                // player id -> { smelt }  (had time left at the last check)
const NAMES = { magnet: "Magnet", smelt: "Auto-Smelt" };
system.runInterval(() => {
  try {
    for (const p of world.getAllPlayers()) {
      try {
        const h = had.get(p.id) ?? (had.set(p.id, { smelt: false }), had.get(p.id));
        for (const key of ["smelt"]) {
          const now = timeLeft(p, key) > 0;
          if (h[key] && !now) p.sendMessage(menuMsg(p, "§e[Mining] §f" + NAMES[key] + " §etime is over. §7Buy more in /mining."));
          h[key] = now;
        }
      } catch (err) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}, 20);
try { world.afterEvents.playerLeave.subscribe((ev) => { had.delete(ev.playerId); }); } catch (e) { /* ignore */ }
