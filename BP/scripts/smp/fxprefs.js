// FINE CONTROL of effects, sounds and notices - one switch per kind, for ONE player (only changes what HE sees and hears).
//   * everything is ON until the player turns it off (except the kinds in DEFAULT_OFF below, e.g. the ClearLag sound, which the player turns ON himself).
//     Only the OFF ones are saved:  ex(p).set.mute = { "clearlag.msg": true, ... }   (a default-OFF kind that was turned ON is saved as false)
//   * the old switches (Particles / Sounds / My Trail in Cosmetics > Effects & Sounds) still work exactly as before and stay the master switches.
//   * lux.js asks  luxPrefs.mute(player, "<group>.sfx" | "<group>.fx")  before a sound / particle of that group;
//     notice("<key>", text) sends a world-wide text only to the players who did not turn that notice off.
import { world } from "@minecraft/server";
import { ex } from "./store.js";

/** the groups.  msg = chat notice,  sfx = sound,  fx = particles.  (key = id + "." + part)  `ar` = Arabic name for the form. */
export const GROUPS = [
  { id: "clearlag", name: "ClearLag",              ar: "تنظيف العناصر (ClearLag)", parts: ["msg", "sfx", "fx"] },
  { id: "mining",   name: "Mining",                ar: "التعدين",                   parts: ["sfx", "fx"] },
  { id: "tp",       name: "Teleport & RTP",        ar: "الانتقال و RTP",            parts: ["sfx", "fx"] },
  { id: "shop",     name: "Shop & payments",       ar: "المتجر والدفع",             parts: ["sfx", "fx"] },
  { id: "protect",  name: "Land protection",       ar: "حماية الأرض",               parts: ["sfx", "fx"] },
  { id: "menu",     name: "Menu & commands",       ar: "القوائم والأوامر",          parts: ["sfx", "fx"] },
  { id: "crate",    name: "Crate wins (chat)",     ar: "فوز الصناديق (الشات)",      parts: ["msg"] },
  { id: "duel",     name: "Duel announcements",    ar: "إعلانات المبارزة",          parts: ["msg"] },
  { id: "crown",    name: "Crown announcements",   ar: "إعلانات التاج",             parts: ["msg"] },
  { id: "ach",      name: "Achievement announcements", ar: "إعلانات الإنجازات",     parts: ["msg"] },
  { id: "end",      name: "The End event notices", ar: "إشعارات فعالية الإند",      parts: ["msg"] },
];
export const PART_NAME = { msg: ["Chat messages", "رسائل الشات"], sfx: ["Sounds", "الأصوات"], fx: ["Particles", "الجزيئات"] };

const muteOf = (p) => { const s = ex(p).set; if (!s.mute || typeof s.mute !== "object") s.mute = {}; return s.mute; };
// Kinds that are OFF by default: the player must turn them ON himself (Cosmetics > Effects & Sounds).
// The ClearLag SOUND is here: the particles and the chat notice stay as they were, only the sound is silent until a player switches it on.
// Saved as  mute[key] = false  (= the player turned it ON);  nothing saved = the default (OFF).
const DEFAULT_OFF = new Set(["clearlag.sfx"]);
/** true = this kind is OFF for that player (turned off by him, or off by default and never turned on) */
export const isMuted = (p, key) => {
  try {
    const v = muteOf(p)[key];
    if (v === true) return true;
    if (v === false) return false;
    return DEFAULT_OFF.has(key);
  } catch (e) { return DEFAULT_OFF.has(key); }
};
/** off = true switches it OFF, off = false switches it ON.  Normal kinds: only the OFF ones are saved.  Default-OFF kinds: only the ON ones are saved. */
export function setMuted(p, key, off) {
  try {
    const m = muteOf(p);
    if (DEFAULT_OFF.has(key)) { if (off) delete m[key]; else m[key] = false; }
    else if (off) m[key] = true; else delete m[key];
  } catch (e) { /* ignore */ }
}

/** a world-wide text that a player may have turned off.  Same as world.sendMessage(text) for everybody who did not. */
export function notice(id, text) {
  const key = id + ".msg";
  let players = [];
  try { players = world.getAllPlayers(); } catch (e) { return; }
  for (const p of players) { try { if (!isMuted(p, key)) p.sendMessage(text); } catch (e) { /* next player */ } }
}
