// Action bar sender that does NOT re-send the same text over and over.
// Re-sending the identical action bar text every 0.25 - 0.5 s makes the side-panel scoreboard flicker
// (it happens when a clan mate joins, a timer / pay notice / combat tag is shown, ...).
// The text is only sent again when it changed, or after KEEP ticks so it never fades out early.
import { world, system } from "@minecraft/server";
import { menuBar } from "./systems/menulang.js";

const KEEP = 30;                      // ticks (1.5 s): the action bar stays visible longer than this
const last = new Map();               // player id -> { text, t }

export function sendBar(p, text) {
  const now = system.currentTick, l = last.get(p.id);
  if (l && l.text === text && now - l.t < KEEP) return;
  p.onScreenDisplay.setActionBar(menuBar(p, text));          // may throw if the player is gone: callers already handle that
  last.set(p.id, { text, t: now });
}

try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { last.delete(playerId); }); } catch (e) { /* ignore */ }
