// Tiny bridge so the scoreboard (hud.js) and the action bar (tables.js) can read the 1 vs 1 duel state without importing duel.js (no import cycles).
// duel.js fills these two functions in when it starts.
export const duelView = {
  field: (p) => "",          // short text for the scoreboard row "Duel" (max 10 characters)
  bar: (p) => null,          // action bar text while the player is in a duel round (or null)
  banner: (p) => null,       // markers for the big centered message (new player immunity) while it is shown, else null
  fighting: (a, b) => false, // true when these two player ids are in the same running fight
  afkLock: (p) => 0,         // > 0 (ms until the fight, or 1) when this player may NOT enter the AFK area right now (5 minutes before the duel, and during it), else 0
};
// while a duel is running (and during the winner's loot time) the Clear Lag system must NOT wipe the dropped items (the loot of the loser)
export const duelHold = { until: 0 };
