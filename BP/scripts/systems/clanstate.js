// Tiny bridge so combat.js / data.js / skills.js can ask the clan system a question without importing clans.js (no import cycles).
// clans.js fills these in when it starts.
export const clanView = {
  same: (idA, idB) => false,       // true when both player ids are in the same clan
  noteColor: (playerId) => "b",   // the notification colour of the clan of this player
  rankTag: (id) => "",   // text shown above the name of a top-ranked player, e.g. "[Richest]" (filled by ranks.js)
  showTop: (player, type) => false,   // shows a top list as a hologram in front of the player (filled by hologram.js)
  top: () => [],   // ranked clans for /baltop clan: [{ name, tag, members, kills, money }] best first
  isOwner: (p) => false,   // true for the server Owner (filled by staffcore.js): "Owner" is shown above his name
  applyTag: (p) => {},   // rebuilds the text above a player's name (filled by clans.js)
  vipBadge: (p) => "",   // the server rank above the name, e.g. crown + "GOLD" (filled by viprank.js)
  vipChat: (p) => "",   // the server rank before the name in the chat (filled by viprank.js)
  noHit: (attacker, victim) => false,   // true when the attacker may NOT hurt the victim (same clan and the owner turned friendly fire off)
};
