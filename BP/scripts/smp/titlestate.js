// Tiny bridge (no imports) so the chat code in clans.js can read a player's chosen title without importing the achievements module.
export const titleView = { tag: (p) => "", name: (p) => p.name };      // name = the player name in its chat colour (cosmetics.js)
