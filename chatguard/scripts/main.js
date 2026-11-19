// SMP CHAT GUARD (needs "Beta APIs" in the world settings - the chat event only exists there).
// A small extra pack next to the SMP pack, so the SMP pack never depends on Beta APIs:
//   * a message with a swear word is stopped (nobody sees it) and the SMP pack is told:  /scriptevent smp:chatban {...}
//     -> the SMP pack mutes the player for 1 hour and tells the staff (chatban.js)
//   * a muted player (tag "smp_muted", set by the SMP pack) can not chat;  the Owner (tag "smp_chat_exempt") is never filtered
import { world, system } from "@minecraft/server";
import { check } from "./filter.js";

const lastTry = new Map();
world.beforeEvents.chatSend.subscribe((e) => {
  try {
    const p = e.sender, msg = String(e.message ?? "");
    if (p.hasTag("smp_chat_exempt")) return;
    if (p.hasTag("smp_muted")) {
      e.cancel = true;
      const now = Date.now();
      if (now - (lastTry.get(p.id) ?? 0) > 3000) { lastTry.set(p.id, now); system.run(() => { try { system.sendScriptEvent("smp:chatmuted", JSON.stringify({ id: p.id })); } catch (x) { /* ignore */ } }); }
      return;
    }
    const r = check(msg);
    if (!r) return;
    e.cancel = true;
    system.run(() => {
      try { p.addTag("smp_muted"); } catch (x) { /* ignore */ }
      try { system.sendScriptEvent("smp:chatban", JSON.stringify({ id: p.id, n: p.name, w: String(r.word).slice(0, 40), m: msg.slice(0, 200) })); } catch (x) { /* ignore */ }
    });
  } catch (err) { /* never break the chat */ }
});
