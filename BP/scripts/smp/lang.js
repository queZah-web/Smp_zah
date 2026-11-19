// Player language (Arabic / English). For now only the choice is saved; the texts are translated later.
// Stored in the player's own SMP data:  ex(player).set.lang  =  "ar" | "en"   (default "ar" = Arabic; a player can switch to English in /menu > Language).
import { ex } from "./store.js";

export const LANGS = ["en", "ar"];
/** the language of every player who never chose one (new players and old players who never opened the language page) */
export const DEFAULT_LANG = "ar";

/** the language a player chose: "en" or "ar" */
export function getLang(player) {
  try { const l = ex(player).set.lang; return LANGS.includes(l) ? l : DEFAULT_LANG; } catch (e) { return DEFAULT_LANG; }
}
/** save the language of a player; returns the saved value */
export function setLang(player, lang) {
  if (!LANGS.includes(lang)) lang = DEFAULT_LANG;
  try { ex(player).set.lang = lang; } catch (e) { /* ignore */ }
  return lang;
}
