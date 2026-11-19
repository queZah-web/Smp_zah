// ===================================================================================================================
// CHAT BAN - the SMP side of the swear filter.  The filter itself is the small extra pack "SMP Chat Guard" (chatguard/),
// because reading / stopping chat needs Beta APIs and this pack must keep working without them.
//   * Chat Guard stopped a message  ->  /scriptevent smp:chatban { id, n, w (word), m (message) }
//       -> the player is muted for 1 HOUR (the normal mute of the staff tools, he sees why),
//       -> every online staff member gets a message with the name, the word and the whole message,
//       -> an alert for the staff that is offline (Operator > Alerts) + the staff log, + the chat ban log (/opr: 50 last)
//   * Chat Guard asks for a muted player  ->  /scriptevent smp:chatmuted { id }  ->  he is told why and for how long
//   * the tags Chat Guard reads are kept up to date every second: "smp_muted" (muted now), "smp_chat_exempt" (the Owner)
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { autoMute, muteOf, mutedText, isOwner } from "./staffcore.js";
import { isStaff, opAlert } from "./opcore.js";
import { pick } from "./arextra.js";

export const CHATBAN = { muteMs: 60 * 60 * 1000 };
const LOG = "cb:log", CNT = "cb:n";
const online = (id) => { try { return world.getAllPlayers().find((p) => p.id === id) ?? null; } catch (e) { return null; } };
const read = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const write = (k, v) => { try { world.setDynamicProperty(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
export const chatBanLog = () => read(LOG, []);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  try {
    if (ev.id === "smp:chatban") {
      const d = JSON.parse(ev.message || "{}"), p = online(d.id); if (!p) return;
      const counts = read(CNT, {}); counts[p.id] = (counts[p.id] ?? 0) + 1; write(CNT, counts);
      const nth = counts[p.id];
      const r = autoMute(p, CHATBAN.muteMs, "Swearing in chat (" + String(d.w ?? "").slice(0, 30) + ")");
      try { p.addTag("smp_muted"); } catch (e) { /* ignore */ }
      p.sendMessage(pick(p, "§c[Chat] Your message was blocked: swearing is not allowed. §fYou are muted for 1 hour.", "§c[الشات] انمنعت رسالتك: السب ممنوع. §fانكتمت من الشات ساعة كاملة."));
      try { p.playSound("note.bass", { volume: 1, pitch: 0.5 }); } catch (e) { /* ignore */ }
      const line = "§c§l[Chat Guard] §r§f" + p.name + " §7swore §8(#" + nth + ")§7: §c\"" + String(d.m ?? "").replace(/§/g, "") + "\" §8- muted 1 hour";
      for (const s of world.getAllPlayers()) { try { if (s.id !== p.id && (isStaff(s) || isOwner(s))) s.sendMessage(line); } catch (e) { /* ignore */ } }
      opAlert("§f" + p.name + " §7swore in chat §8(#" + nth + ")§7: §c\"" + String(d.m ?? "").replace(/§/g, "").slice(0, 80) + "\" §7- muted 1 hour", { chat: false });
      const log = read(LOG, []); log.unshift({ t: Date.now(), id: p.id, n: p.name, w: d.w, m: String(d.m ?? "").slice(0, 120), k: nth }); if (log.length > 50) log.length = 50; write(LOG, log);
      if (r.err) console.warn("[chatban] mute: " + r.err);
    } else if (ev.id === "smp:chatmuted") {
      const d = JSON.parse(ev.message || "{}"), p = online(d.id); if (!p) return;
      const t = mutedText(p);
      if (t) p.sendMessage(t); else { try { p.removeTag("smp_muted"); } catch (e) { /* ignore */ } }
    }
  } catch (e) { console.warn("[chatban] " + e); }
}, { namespaces: ["smp"] });

// the tags the Chat Guard pack reads
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const m = !!muteOf(p.id), has = p.hasTag("smp_muted");
      if (m && !has) p.addTag("smp_muted"); else if (!m && has) p.removeTag("smp_muted");
      const o = isOwner(p), ex = p.hasTag("smp_chat_exempt");
      if (o && !ex) p.addTag("smp_chat_exempt"); else if (!o && ex) p.removeTag("smp_chat_exempt");
    } catch (e) { /* ignore */ }
  }
}, 20);
