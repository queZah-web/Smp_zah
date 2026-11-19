// Notification center: stored per player, shown in the SMP menu.
import { ex } from "./store.js";
import { NOTES_MAX } from "./config.js";
import { menuMsg } from "../systems/menulang.js";

/** notify(p, "§aText", { key: "daily", chat: false })
 *  key  = only one UNREAD notification per key is kept (a new one replaces the old one)
 *  chat = false -> store only, no chat message (otherwise the player's "chat notifications" setting decides) */
/** where a notification leads when the player clicks it in the notification center (id of a DEST in menu.js).
 *  notify(p, text, { go: "orders" }) sets it by hand; otherwise it is guessed from the [Tag] at the start of the text
 *  (so every old notification that is already saved works too). */
export function inferGo(text) {
  const x = String(text ?? "").replace(/§./g, "");
  if (/\[Order\]/.test(x)) return "orders";
  if (/\[Auction\]/.test(x)) return "ah";
  if (/\[Clan\]/.test(x)) return "clan";
  if (/\[Skills\]/.test(x)) return "skills";
  if (/\[Top\]/.test(x)) return "ranks";
  if (/\[Daily\]/.test(x)) return "daily";
  if (/\[Mission\]/.test(x)) return "missions";
  if (/\[Title\]/.test(x)) return "profile";
  if (/\[Achievements?\]/.test(x)) return "ach";
  if (/ paid you /.test(x)) return "pay";
  return undefined;
}
export function notify(p, text, opts = {}) {
  const e = ex(p);
  if (opts.key) e.notes = e.notes.filter((n) => !(n.k === opts.key && !n.r));
  e.notes.unshift({ t: Date.now(), x: text, r: 0, k: opts.key, g: opts.go ?? inferGo(text) });
  if (e.notes.length > NOTES_MAX) e.notes.length = NOTES_MAX;
  if (opts.chat !== false && e.set.chat !== false) { try { p.sendMessage(menuMsg(p, text)); } catch (err) { /* ignore */ } }
}
export const notes = (p) => ex(p).notes;
export const unread = (p) => ex(p).notes.filter((n) => !n.r).length;
export const markAllRead = (p) => { for (const n of ex(p).notes) n.r = 1; };
export const markKeyRead = (p, key) => { for (const n of ex(p).notes) if (n.k === key) n.r = 1; };
export const clearNotes = (p) => { ex(p).notes = []; };
