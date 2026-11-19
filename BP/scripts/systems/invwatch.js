// Performance helper: "did this player's inventory change since I last looked?"
// The game tells us every change (playerInventoryItemChange). A system that scans inventories asks need(p, k) and only scans
// when something changed - and in any case every `every` rounds (safety net; k spreads the players over different rounds).
// If the game has no such event, need() is always true (= exactly the old behaviour).
import { world } from "@minecraft/server";

const ver = new Map();             // player id -> change counter
let on = false;
const bump = (id) => ver.set(id, (ver.get(id) ?? 0) + 1);
const watchers = [];
try { world.afterEvents.playerInventoryItemChange.subscribe((ev) => { try { bump(ev.player.id); } catch (e) { /* ignore */ } }); on = true; } catch (e) { on = false; }
try { world.afterEvents.playerSpawn.subscribe(({ player }) => { try { bump(player.id); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { ver.delete(playerId); for (const w of watchers) w.delete(playerId); }); } catch (e) { /* ignore */ }

/** every = safety-net rounds (a player is always scanned at least once every `every` calls of next()) */
export function invWatch(every) {
  const seen = new Map(); watchers.push(seen);
  let round = 0;
  return {
    next() { round++; },
    /** true = scan this player now.  k = position of the player in the list (spreads the safety-net scans) */
    need(p, k = 0) {
      if (!on) return true;
      const v = ver.get(p.id) ?? 0;
      if (seen.get(p.id) !== v || (round + k) % every === 0) { seen.set(p.id, v); return true; }
      return false;
    },
  };
}
export const invWatchOn = () => on;
