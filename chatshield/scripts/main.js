// ===================================================================================================================
// CHAT SHIELD - a standalone swear filter for ANY world / server (needs "Beta APIs" in the world settings).
// Made by @Zahraiiq.  Arabic (Iraqi / Gulf / Levant / Egyptian), Franco-Arabic and English (filter.js).
//
//   * a message with a swear word is stopped (nobody sees it) and the player is MUTED for 1 hour
//   * the admins online see who swore, the word and the whole message;  everything is saved in a log
//   * admins = operators (or players with the tag "chat_admin").  Admins / tag "chat_bypass" are never filtered
//   * commands (admins):  /cs:log  (last 50)   /cs:unmute <name>   /cs:mute <name> <minutes>
//   Settings: the numbers below.  Data: world properties of this pack only ("cs:mutes", "cs:log", "cs:count").
// ===================================================================================================================
import { world, system, PlayerPermissionLevel, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { check } from "./filter.js";

const MUTE_MINUTES = 60;          // first offence
const ESCALATE = false;           // true = every next offence doubles the time (60, 120, 240 ...)
const LOG_MAX = 50;

const lang = (p) => { try { return String(p.clientSystemInfo?.language ?? p.locale ?? ""); } catch (e) { return ""; } };
const T = (p, en, ar) => { const l = lang(p); return /^ar/i.test(l) ? ar : /^en/i.test(l) ? en : ar + "\n" + en; };   // unknown language: both
const read = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const write = (k, v) => { try { world.setDynamicProperty(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
const isAdmin = (p) => { try { return p.hasTag("chat_admin") || p.playerPermissionLevel === PlayerPermissionLevel.Operator || p.commandPermissionLevel >= CommandPermissionLevel.Admin; } catch (e) { return false; } };
const exempt = (p) => { try { return isAdmin(p) || p.hasTag("chat_bypass"); } catch (e) { return false; } };
const left = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; };

function muteLeft(id) {
  const m = read("cs:mutes", {}), u = m[id];
  if (!u) return 0;
  if (u <= Date.now()) { delete m[id]; write("cs:mutes", m); return 0; }
  return u - Date.now();
}
function mute(id, minutes) { const m = read("cs:mutes", {}); m[id] = Math.max(m[id] ?? 0, Date.now() + minutes * 60000); write("cs:mutes", m); }
function unmute(id) { const m = read("cs:mutes", {}); delete m[id]; write("cs:mutes", m); }

const lastTold = new Map();
world.beforeEvents.chatSend.subscribe((e) => {
  try {
    const p = e.sender, msg = String(e.message ?? "");
    if (exempt(p)) return;
    const ml = muteLeft(p.id);
    if (ml > 0) {
      e.cancel = true;
      const now = Date.now();
      if (now - (lastTold.get(p.id) ?? 0) > 3000) { lastTold.set(p.id, now); system.run(() => p.sendMessage(T(p, "§c[Chat] You are muted for swearing. §7Time left: §f" + left(ml), "§c[الشات] أنت مكتوم بسبب السب. §7الوقت الباقي: §f" + left(ml)))); }
      return;
    }
    const r = check(msg);
    if (!r) return;
    e.cancel = true;
    const id = p.id, name = p.name;
    system.run(() => {
      const cnt = read("cs:count", {}); cnt[id] = (cnt[id] ?? 0) + 1; write("cs:count", cnt);
      const minutes = ESCALATE ? MUTE_MINUTES * 2 ** (cnt[id] - 1) : MUTE_MINUTES;
      mute(id, minutes);
      const log = read("cs:log", []); log.unshift({ t: Date.now(), n: name, w: r.word, m: msg.slice(0, 150), k: cnt[id] }); if (log.length > LOG_MAX) log.length = LOG_MAX; write("cs:log", log);
      try {
        p.sendMessage(T(p, "§c[Chat] Your message was blocked: swearing is not allowed. §fYou are muted for " + left(minutes * 60000) + ".", "§c[الشات] انمنعت رسالتك: السب ممنوع. §fانكتمت من الشات " + (minutes === 60 ? "ساعة كاملة" : left(minutes * 60000)) + "."));
        p.playSound("note.bass", { volume: 1, pitch: 0.5 });
      } catch (x) { /* ignore */ }
      const line = "§c§l[Chat Shield] §r§f" + name + " §7swore §8(#" + cnt[id] + ")§7: §c\"" + msg.replace(/§/g, "").slice(0, 150) + "\" §8- muted " + left(minutes * 60000);
      for (const a of world.getAllPlayers()) { try { if (a.id !== id && isAdmin(a)) a.sendMessage(line); } catch (x) { /* ignore */ } }
      console.warn("[ChatShield] " + name + " swore: " + msg.slice(0, 150));
    });
  } catch (err) { /* never break the chat */ }
});

// ---------------------------------------------------------------- admin commands
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const who = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);
  const byName = (n) => world.getAllPlayers().find((x) => x.name.toLowerCase() === String(n ?? "").toLowerCase());
  const reg = (def, fn) => { try { cr.registerCommand({ permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, ...def }, (o, ...a) => { const p = who(o); if (p) system.run(() => { if (!isAdmin(p)) return p.sendMessage("§c[Chat Shield] Admins only."); fn(p, ...a); }); return OK; }); } catch (e) { console.warn("[ChatShield] command " + def.name + ": " + e); } };
  reg({ name: "cs:log", description: "Chat Shield: who swore (last 50)" }, (p) => {
    const log = read("cs:log", []);
    p.sendMessage(log.length ? "§6§l[Chat Shield] last " + Math.min(20, log.length) + ":\n" + log.slice(0, 20).map((e) => "§e" + e.n + " §8(#" + e.k + ", " + left(Date.now() - e.t) + " ago)§7: §f\"" + e.m + "\"").join("\n") : "§7[Chat Shield] Nobody swore yet.");
  });
  reg({ name: "cs:unmute", description: "Chat Shield: unmute a player", mandatoryParameters: [{ name: "player", type: CustomCommandParamType.String }] }, (p, n) => {
    const t = byName(n); if (!t) return p.sendMessage("§c[Chat Shield] Player not online: " + n);
    unmute(t.id); p.sendMessage("§a[Chat Shield] " + t.name + " can chat again."); t.sendMessage(T(t, "§a[Chat] You can chat again.", "§a[الشات] تقدر تكتب في الشات مرة ثانية."));
  });
  reg({ name: "cs:mute", description: "Chat Shield: mute a player (minutes)", mandatoryParameters: [{ name: "player", type: CustomCommandParamType.String }, { name: "minutes", type: CustomCommandParamType.Integer }] }, (p, n, m) => {
    const t = byName(n); if (!t) return p.sendMessage("§c[Chat Shield] Player not online: " + n);
    mute(t.id, Math.max(1, m | 0)); p.sendMessage("§a[Chat Shield] " + t.name + " muted for " + Math.max(1, m | 0) + " min.");
  });
});
