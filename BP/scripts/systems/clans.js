// Clans: create (costs money), invite ANY player who ever joined (online or offline, invitations are saved), join / decline, tag above the head + in chat,
// clan home (+ a second home), members (kick), leave, disband, clan chat (/cc), notifications in the middle-bottom of the screen, owner settings
// (friendly fire, notification colour, tag colour / style, description, rename every 3 days), top clans + daily shard rewards.
// No clan levels / missions: every clan has the same member limit (CLAN.maxMembers). Land Protection has nothing to do with clans.
// Every clan is stored in its own world dynamic property  "cl:<clan id>"  (nothing else in the world data is touched).
// Saved invitations: "ci:<player id>".  Last reward day: "cr:day".
import { world, system, GameMode } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { notify } from "../smp/notify.js";
import { UTC_OFFSET_HOURS } from "../smp/config.js";
import { stats, takeMoney, addTx, addShards, addShardsById, knownPlayers, statOf, recordOf, playSeconds } from "../data.js";
import { exOf } from "../smp/store.js";
import { SKILLS, KEYS, PERK, SPEED, TRADE_TIERS, info as skillLevelInfo } from "./skills.js";
import { claimsOf, sizeOf, timeLeft as landLeft, dur as landDur } from "./landcore.js";
import { sendTpaLand, tpOff } from "./tpa.js";
import { money, short, num, playtime, ago } from "../format.js";
import { CLAN } from "./config.js";
import { canTeleport, stamp, teleportTo, dimLabel, online, valid } from "./util.js";
import { showModal, textField, confirmShort as confirm } from "./forms.js";
import { clanView } from "./clanstate.js";
import { titleView } from "../smp/titlestate.js";
import { clanBanner } from "./clanbar.js";
import { mutedText } from "./staffcore.js";            // staff tools: a muted player can not use the clan chat
import { menuMsg, MenuForm } from "./menulang.js";

const PFX = "cl:", INV = "ci:", KICK = "ck:", DAY_KEY = "cr:day";      // ck:<player id> = a kick notice waiting for a player who was offline
const ICON = { tag: "textures/items/name_tag", bed: "textures/items/bed_red", book: "textures/items/book_writable", star: "textures/items/nether_star", paper: "textures/items/paper", sword: "textures/items/iron_sword", shard: "textures/ui/shop/hud_shards", prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next" };
const clans = new Map(), byPlayer = new Map();
let loaded = false;

// ---------------------------------------------------------------- looks: tag colours / styles, notification colours
// [code, name, wool icon]  -  every colour button shows a wool block of that colour AND its text in the same colour
const woolIcon = (n) => "textures/ui/shop/i3d_" + n + "_wool";
const TAG_COLORS = [["6", "Gold", "orange"], ["e", "Yellow", "yellow"], ["c", "Red", "red"], ["4", "Dark Red", "brown"], ["a", "Green", "lime"], ["2", "Dark Green", "green"], ["b", "Aqua", "light_blue"],
  ["3", "Dark Aqua", "cyan"], ["9", "Blue", "blue"], ["d", "Pink", "pink"], ["5", "Purple", "purple"], ["f", "White", "white"], ["7", "Gray", "light_gray"], ["8", "Dark Gray", "gray"]];
const NOTE_COLORS = [["b", "Aqua", "light_blue"], ["a", "Green", "lime"], ["e", "Yellow", "yellow"], ["c", "Red", "red"], ["d", "Pink", "pink"], ["6", "Gold", "orange"]];
const colorIcon = (list, ch) => woolIcon((list.find((x) => x[0] === ch) ?? list[0])[2]);
const STYLES = [["[", "]"], ["\u00AB", "\u00BB"], ["(", ")"], ["{", "}"], ["-", "-"]];
/** the clan tag the way it is shown (above the head, in chat): colour + brackets (+ bold) chosen by the owner */
export const tagText = (c) => { const s = STYLES[c.ts] ?? STYLES[0]; return "\u00a7" + c.tc + (c.tb ? "\u00a7l" : "") + s[0] + c.tag + s[1] + "\u00a7r"; };
const plainTag = (c, ch) => { const s = STYLES[c.ts] ?? STYLES[0]; return "\u00a7" + ch + s[0] + c.tag + s[1]; };

// ---------------------------------------------------------------- storage
function norm(c) {
  c.desc ??= ""; c.tc ??= "6"; c.ts ??= 0; c.tb ??= false; c.nc ??= "b"; c.ff ??= false; c.renamed ??= 0; c.joined ??= {}; c.home2 ??= null;
  delete c.lv; delete c.prog; delete c.dwl;                          // old clan levels / missions: gone
  for (const id of Object.keys(c.members)) c.joined[id] ??= c.created ?? 0;
  return c;
}
function reindex() { byPlayer.clear(); for (const c of clans.values()) for (const id of Object.keys(c.members)) byPlayer.set(id, c.id); }
function load() {                                                     // lazy: world data can't be read while the script starts
  if (loaded) return;
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(PFX)) continue;
      try { const c = JSON.parse(world.getDynamicProperty(k)); if (c && c.id && c.members) clans.set(c.id, norm(c)); } catch (e) { /* skip broken record */ }
    }
    reindex(); loaded = true;
  } catch (e) { console.warn("[clans] load failed: " + e); }
}
const save = (c) => { try { world.setDynamicProperty(PFX + c.id, JSON.stringify(c)); } catch (e) { console.warn("[clans] save failed: " + e); } };
function drop(c) { try { world.setDynamicProperty(PFX + c.id, undefined); } catch (e) { /* ignore */ } clans.delete(c.id); reindex(); }

export function clanOf(p) { load(); const id = byPlayer.get(p.id); return id ? clans.get(id) ?? null : null; }
const members = (c) => Object.keys(c.members);
const levelCap = () => CLAN.maxMembers ?? 5;                         // members allowed in every clan (CLAN.maxMembers in config.js)
const say = (id, msg) => { const p = online(id); if (p) { try { p.sendMessage(menuMsg(p, msg)); } catch (e) { /* ignore */ } } };
const tell = (c, msg, except) => { for (const id of members(c)) if (id !== except) say(id, msg); };
const owned = (p) => { const c = clanOf(p); return c && c.owner === p.id ? c : null; };
const cleanText = (t, max) => String(t ?? "").replace(/[\r\n]+/g, " ").replace(/\u00a7./g, "").replace(/\u00a7/g, "").replace(/\s+/g, " ").trim().slice(0, max);
/** the owner's notification colour: shown in the middle-bottom of the screen to the clan members (except `exceptId`) */
function banner(c, text, exceptId) { for (const id of members(c)) { if (id === exceptId) continue; const p = online(id); if (p) clanBanner(p, text, c.nc); } }

// ---------------------------------------------------------------- the bridge used by combat / kills (friendly fire)
clanView.same = (a, b) => { try { load(); const x = byPlayer.get(a); return !!x && x === byPlayer.get(b); } catch (e) { return false; } };
clanView.top = () => { try { return board().overall.map((r) => ({ id: r.c.id, name: r.c.name, tag: plainTag(r.c, r.c.tc), members: members(r.c).length, kills: r.kills, money: r.money })); } catch (e) { return []; } };
clanView.noteColor = (id) => { try { load(); const c = clans.get(byPlayer.get(id)); return c ? c.nc : "b"; } catch (e) { return "b"; } };
clanView.noHit = (a, b) => {
  try {
    load();
    if (!a || !b || a.id === b.id) return false;
    const id = byPlayer.get(a.id);
    if (!id || id !== byPlayer.get(b.id)) return false;
    const c = clans.get(id);
    return !!c && c.ff !== true;
  } catch (e) { return false; }
};

// ---------------------------------------------------------------- tag above the head
/** the money line under the name: green $ + white number  ->  "$83.7k", "$19.2m", "$950"  (cut, never rounded up; the unit letters are lower-case) */
function moneyLine(n) {
  n = Math.floor(Number(n));
  if (!(n >= 0)) n = 0;
  let txt = String(n);
  for (const [u, v] of [["b", 1e9], ["m", 1e6], ["k", 1e3]]) {
    if (n >= v) { const t = Math.floor((n * 10) / v); txt = Math.floor(t / 10) + (t % 10 ? "." + (t % 10) : "") + u; break; }
  }
  return "\u00a7a$\u00a7f" + txt;
}
export function applyTag(p) {
  try {
    const c = clanOf(p);
    let rt = ""; try { rt = clanView.rankTag(p.id) || ""; } catch (e) { rt = ""; }                  // e.g. "[Richest]" for the richest player (ranks.js)
    let ow = ""; try { ow = clanView.isOwner(p) ? "\u00a75\u00a7lOwner" : ""; } catch (e) { ow = ""; }  // the server Owner: dark purple "Owner" above everything
    let vb = ""; try { vb = clanView.vipBadge(p) || ""; } catch (e) { vb = ""; }                        // the server rank (crown + GOLD ...), viprank.js
    const top = [ow, vb, rt].filter(Boolean).join("\n");
    let mt = ""; try { mt = moneyLine(stats(p).money); } catch (e) { mt = ""; }                      // the player's money, under the name
    const nm = c ? "\u00a7" + c.tc + p.name : (top ? "\u00a7f" + p.name : p.name);
    const next = [top, c ? tagText(c) : "", nm, mt].filter(Boolean).join("\n");                     // Owner / [Richest] / [WOLF] (tag colour) / Reed (same colour) / $83.7k
    if (p.nameTag !== next) p.nameTag = next;
  } catch (e) { /* player not ready */ }
}
// keep the money line up to date (only writes when the text really changed)
system.runInterval(() => {
  try { for (const p of world.getAllPlayers()) { try { if (valid(p)) applyTag(p); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
}, 40);
clanView.applyTag = (p) => applyTag(p);
const refreshTags = (c) => { for (const id of members(c)) { const p = online(id); if (p) applyTag(p); } };

// ---------------------------------------------------------------- saved invitations  ("ci:<player id>" = [{ clan, from, exp }])
function readInv(id) {
  try { const r = world.getDynamicProperty(INV + id); if (typeof r === "string") { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) { /* ignore */ }
  return [];
}
function writeInv(id, list) {
  try { if (list.length) world.setDynamicProperty(INV + id, JSON.stringify(list)); else world.setDynamicProperty(INV + id, undefined); } catch (e) { console.warn("[clans] invitation save failed: " + e); }
}
function invitesById(id) {
  load();
  const raw = readInv(id), a = raw.filter((i) => i.exp > Date.now() && clans.has(i.clan));
  if (a.length !== raw.length) writeInv(id, a);                       // forget expired / dead invitations
  return a;
}
const invitesFor = (p) => invitesById(p.id);

// ---------------------------------------------------------------- actions (return an error text, or null when it worked)
function createClan(p, nameRaw, tagRaw) {
  load();
  if (clanOf(p)) return "You are already in a clan.";
  const name = cleanText(nameRaw, 40), tag = String(tagRaw ?? "").trim().toUpperCase();
  if (name.length < 3 || name.length > 16) return "The clan name must be 3-16 characters.";
  if (!/^[A-Z0-9]{2,5}$/.test(tag)) return "The tag must be 2-5 letters or numbers.";
  for (const c of clans.values()) {
    if (c.name.toLowerCase() === name.toLowerCase()) return "A clan with this name already exists.";
    if (c.tag === tag) return "This tag is already used by another clan.";
  }
  const bal = stats(p).money;
  if (bal < CLAN.createCost) return "Creating a clan costs " + money(CLAN.createCost) + ". You need " + money(CLAN.createCost - bal) + " more.";
  if (!takeMoney(p, CLAN.createCost)) return "Payment failed.";
  try { addTx(p, { type: "buy", id: "clan_create", name: "Clan created", qty: 1, total: CLAN.createCost }); } catch (e) { /* ignore */ }
  const now = Date.now();
  const c = norm({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, tag, owner: p.id, members: { [p.id]: p.name }, joined: { [p.id]: now }, home: null, created: now });
  clans.set(c.id, c); save(c); reindex(); applyTag(p);
  return null;
}
/** t = { id, name } - any player who joined this world at least once (online or offline) */
function invite(owner, t) {
  const c = owned(owner);
  if (!c) return "Only the clan owner can invite.";
  if (!t || t.id === owner.id) return "Choose another player.";
  if (byPlayer.has(t.id)) return t.name + " is already in a clan.";
  if (members(c).length >= levelCap(c)) return "Your clan is full (" + levelCap(c) + " members).";
  const list = invitesById(t.id);
  if (list.some((i) => i.clan === c.id)) return t.name + " already has an invitation from your clan.";
  list.push({ clan: c.id, from: owner.name, to: t.name, exp: Date.now() + CLAN.inviteDays * 86400000 });
  while (list.length > 10) list.shift();
  writeInv(t.id, list);
  const live = online(t.id);
  if (live) {
    const msg = "§6[Clan] §f" + owner.name + " §einvited you to the clan §6" + c.name + " §e[" + c.tag + "] §7- open §f/clan §7to accept (valid " + CLAN.inviteDays + " days)";
    live.sendMessage(menuMsg(live, msg)); notify(live, msg, { chat: false });
    try { live.playSound("random.orb"); } catch (e) { /* ignore */ }
  }
  return null;
}
/** every valid invitation this clan has sent: [{ id (target), to (name), from, exp }] */
function sentInvites(c) {
  const out = [];
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(INV)) continue;
      const id = k.slice(INV.length);
      for (const i of invitesById(id)) if (i.clan === c.id) out.push({ id, to: i.to ?? knownCached().find((r) => r.id === id)?.name ?? "Unknown", from: i.from, exp: i.exp });
    }
  } catch (e) { /* ignore */ }
  return out;
}
function cancelInvite(owner, targetId) {
  const c = owned(owner);
  if (!c) return "Only the clan owner can cancel invitations.";
  const list = invitesById(targetId);
  if (!list.some((i) => i.clan === c.id)) return "That invitation no longer exists.";
  writeInv(targetId, list.filter((i) => i.clan !== c.id));
  const live = online(targetId);
  if (live) live.sendMessage(menuMsg(live, "§7[Clan] The invitation from §f" + c.name + " §7was cancelled."));
  return null;
}
function join(p, clanId) {
  load();
  if (clanOf(p)) return "You are already in a clan.";
  const c = clans.get(clanId);
  if (!c || !invitesFor(p).some((i) => i.clan === clanId)) return "This invitation is no longer valid.";
  if (members(c).length >= levelCap(c)) return "This clan is full.";
  c.members[p.id] = p.name; c.joined[p.id] = Date.now(); save(c); writeInv(p.id, []); reindex(); applyTag(p);
  tell(c, "§6[Clan] §f" + p.name + " §ajoined the clan!", p.id);
  return null;
}
function leave(p) {
  const c = clanOf(p);
  if (!c) return "You are not in a clan.";
  if (c.owner === p.id) return "The owner can't leave - disband the clan instead.";
  delete c.members[p.id]; delete c.joined[p.id]; save(c); reindex(); applyTag(p);
  tell(c, "§6[Clan] §f" + p.name + " §cleft the clan.");
  return null;
}
function kick(owner, id) {
  const c = owned(owner);
  if (!c) return "Only the clan owner can kick.";
  if (id === owner.id || !c.members[id]) return "Invalid member.";
  const name = c.members[id];
  delete c.members[id]; delete c.joined[id]; save(c); reindex();
  const msg = "You were kicked from the clan by the owner of " + c.name;
  const t = online(id);
  if (t) { applyTag(t); t.sendMessage(menuMsg(t, "§c[Clan] " + msg)); clanBanner(t, msg, "c"); }          // red, middle-bottom of the screen
  else { try { world.setDynamicProperty(KICK + id, msg); } catch (e) { /* ignore */ } }        // offline: shown when he joins next
  tell(c, "§6[Clan] §f" + name + " §cwas kicked.");
  banner(c, name + " was kicked from the clan");                                               // the other members + the clan notifications
  return null;
}
function disband(owner) {
  const c = owned(owner);
  if (!c) return "Only the clan owner can disband.";
  const ids = members(c);
  drop(c);
  for (const id of ids) { const t = online(id); if (t) { applyTag(t); t.sendMessage(menuMsg(t, "§c[Clan] The clan §f" + c.name + " §cwas disbanded.")); } }
  return null;
}
function setHome(p) {
  const c = owned(p);
  if (!c) return "Only the clan owner can set the clan home.";
  c.home = { x: Math.round(p.location.x * 10) / 10, y: Math.round(p.location.y * 10) / 10, z: Math.round(p.location.z * 10) / 10, d: p.dimension.id };
  save(c); tell(c, "§6[Clan] §eThe clan home was set by §f" + p.name + "§e.");
  return null;
}
export function goClanHome(p) {
  const c = clanOf(p);
  if (!c) return p.sendMessage(menuMsg(p, "§c[Clan] You are not in a clan."));
  if (!c.home) return p.sendMessage(menuMsg(p, "§c[Clan] Your clan has no home yet."));
  if (!canTeleport(p, "clanhome")) return;
  try { teleportTo(p, c.home, c.home.d); } catch (e) { return p.sendMessage(menuMsg(p, "§c[Clan] Teleport failed.")); }
  stamp(p, "clanhome");
  p.sendMessage(menuMsg(p, "§a[Clan] Teleported to the clan home."));
}
// ---- owner settings
function toggleFF(p) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  c.ff = !c.ff; save(c);
  tell(c, c.ff ? "§6[Clan] §cFriendly fire is now ON §7- clan members can hurt each other (no kills, no shards between them)." : "§6[Clan] §aFriendly fire is now OFF §7- clan members can't hurt each other.");
  return null;
}
function setNoteColor(p, ch) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  if (!NOTE_COLORS.some((x) => x[0] === ch)) return "Invalid colour.";
  c.nc = ch; save(c); return null;
}
function setTagColor(p, ch) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  if (!TAG_COLORS.some((x) => x[0] === ch)) return "Invalid colour.";
  c.tc = ch; save(c); refreshTags(c); return null;
}
function nextStyle(p) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  c.ts = (c.ts + 1) % STYLES.length; save(c); refreshTags(c); return null;
}
function toggleBold(p) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  c.tb = !c.tb; save(c); refreshTags(c); return null;
}
function setDesc(p, raw) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  c.desc = cleanText(raw, CLAN.descMax); save(c); return null;
}
const renameLeft = (c) => Math.max(0, (c.renamed ?? 0) + CLAN.renameDays * 86400000 - Date.now());
function rename(p, raw) {
  const c = owned(p); if (!c) return "Only the clan owner can change this.";
  const left = renameLeft(c);
  if (left > 0) return "You can rename the clan again in " + playtime(left / 1000) + ".";
  const name = cleanText(raw, 40);
  if (name.length < 3 || name.length > 16) return "The clan name must be 3-16 characters.";
  if (name === c.name) return "That is already the clan name.";
  for (const o of clans.values()) if (o.id !== c.id && o.name.toLowerCase() === name.toLowerCase()) return "A clan with this name already exists.";
  const old = c.name;
  c.name = name; c.renamed = Date.now(); save(c);
  tell(c, "§6[Clan] §eThe clan was renamed: §f" + old + " §e-> §f" + name);
  return null;
}
const result = (p, err, ok) => { if (err) p.sendMessage(menuMsg(p, "§c[Clan] " + err)); else if (ok) p.sendMessage(menuMsg(p, "§a[Clan] " + ok)); return !err; };

function setHome2(p) {
  const c = owned(p);
  if (!c) return "Only the clan owner can set the clan home.";
  c.home2 = { x: Math.round(p.location.x * 10) / 10, y: Math.round(p.location.y * 10) / 10, z: Math.round(p.location.z * 10) / 10, d: p.dimension.id };
  save(c); tell(c, "§6[Clan] §eThe second clan home was set by §f" + p.name + "§e.");
  return null;
}
export function goClanHome2(p) {
  const c = clanOf(p);
  if (!c) return p.sendMessage(menuMsg(p, "§c[Clan] You are not in a clan."));
  if (!c.home2) return p.sendMessage(menuMsg(p, "§c[Clan] Your clan has no second home."));
  if (!canTeleport(p, "clanhome")) return;
  try { teleportTo(p, c.home2, c.home2.d); } catch (e) { return p.sendMessage(menuMsg(p, "§c[Clan] Teleport failed.")); }
  stamp(p, "clanhome");
  p.sendMessage(menuMsg(p, "§a[Clan] Teleported to the second clan home."));
}

// ---------------------------------------------------------------- clan chat:  /cc <message>
const ccLast = new Map();
export function clanChat(p, raw) {
  { const mt = mutedText(p); if (mt) return p.sendMessage(menuMsg(p, mt)); }
  const c = clanOf(p);
  if (!c) return p.sendMessage(menuMsg(p, "§c[Clan] You are not in a clan."));
  const msg = String(raw ?? "").replace(/\u00a7/g, "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!msg) return p.sendMessage(menuMsg(p, "§7[Clan] Use: §f/cc <message>"));
  const now = Date.now();
  if (now - (ccLast.get(p.id) ?? 0) < 700) return p.sendMessage(menuMsg(p, "§c[Clan] Slow down a little."));
  ccLast.set(p.id, now);
  const line = "§8[§bClan Chat§8] " + tagText(c) + " §f" + p.name + "§7: §f" + msg;
  for (const id of members(c)) say(id, line);
}

// ---------------------------------------------------------------- tag next to the name in normal chat (only if this game version lets scripts change chat)
try {
  const ev = world.beforeEvents.chatSend;
  if (ev) ev.subscribe((e) => {
    try {
      if (e.cancel) return;                                              // already stopped (a muted player): nothing to resend
      const p = e.sender, c = clanOf(p), tt = titleView.tag(p);
      if (mutedText(p)) return;                                          // muted: the staff hook cancels the message, do not send it again
      let nm = p.name; try { nm = titleView.name(p) || p.name; } catch (err) { nm = p.name; }            // the name in its chosen colour (Cosmetics)
      let owt = ""; try { owt = clanView.isOwner(p) ? "\u00a75\u00a7l[Owner]\u00a7r" : ""; } catch (err) { owt = ""; }
      let vc = ""; try { vc = clanView.vipChat(p) || ""; } catch (err) { vc = ""; }                     // the server rank (viprank.js)
      if (!c && !tt && !owt && !vc && nm === p.name) return;             // everybody else: the normal chat is not touched
      const msg = String(e.message ?? "").replace(/\u00a7/g, "");
      const prefix = [owt, vc, c ? tagText(c) : "", tt].filter(Boolean).join(" ");     // [Owner] RANK [CLAN] [Title]
      e.cancel = true;
      system.run(() => { try { world.sendMessage((prefix ? prefix + " §r" : "") + "<" + nm + (nm === p.name ? "" : "§r") + "> " + msg); } catch (err) { /* ignore */ } });
    } catch (err) { /* never block the chat */ }
  });
} catch (e) { console.warn("[clans] chat tag not available: " + e); }

// ---------------------------------------------------------------- notifications (middle-bottom of the screen, clan members only)
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    system.runTimeout(() => {
      try {
        if (!valid(player)) return;
        applyTag(player);
        if (!initialSpawn) return;
        const kn = world.getDynamicProperty(KICK + player.id);
        if (typeof kn === "string") { try { world.setDynamicProperty(KICK + player.id, undefined); } catch (e) { /* ignore */ } player.sendMessage(menuMsg(player, "§c[Clan] " + kn)); clanBanner(player, kn, "c"); }
        const c = clanOf(player);
        if (c) {
          if (c.members[player.id] !== player.name) { c.members[player.id] = player.name; save(c); }
          banner(c, player.name + " joined the server", player.id);
        } else {
          const n = invitesFor(player).length;
          if (n > 0) player.sendMessage(menuMsg(player, "§6[Clan] §fYou have §e" + n + " §fclan invitation" + (n > 1 ? "s" : "") + " §7- open §f/clan §7to answer."));
        }
      } catch (e) { /* player left */ }
    }, 30);
  });
} catch (e) { console.warn("[clans] spawn hook: " + e); }
try {
  world.afterEvents.playerLeave.subscribe(({ playerId, playerName }) => {
    try { load(); const id = byPlayer.get(playerId), c = id ? clans.get(id) : null; if (c) banner(c, playerName + " left the server", playerId); } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[clans] leave hook: " + e); }
try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      const dead = ev.deadEntity;
      if (dead?.typeId !== "minecraft:player") return;
      load();
      const k = ev.damageSource?.damagingEntity, killer = k && k.typeId === "minecraft:player" && k.id !== dead.id ? k : null;
      const vid = byPlayer.get(dead.id), vc = vid ? clans.get(vid) : null;
      if (vc) banner(vc, killer ? dead.name + " was killed by " + killer.name : dead.name + " died", dead.id);
      const kid = killer ? byPlayer.get(killer.id) : null, kc = kid ? clans.get(kid) : null;
      if (kc && kc !== vc) banner(kc, killer.name + " killed " + dead.name, killer.id);
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[clans] death hook: " + e); }

// ---------------------------------------------------------------- friendly fire (the owner turns it on / off; default OFF = clan mates can't hurt each other)
const attackerOf = (src) => { try { const a = src && src.damagingEntity; return a && a.typeId === "minecraft:player" ? a : null; } catch (e) { return null; } };
try {
  const ev = world.beforeEvents.entityHurt;
  if (ev) ev.subscribe((e) => {
    try { const v = e.hurtEntity; if (v && v.typeId === "minecraft:player" && clanView.noHit(attackerOf(e.damageSource), v)) e.cancel = true; } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[clans] hurt (before): " + e); }
try {
  world.afterEvents.entityHurt.subscribe((ev) => {                    // backup when the game has no "before" event: give the health back
    try {
      const v = ev.hurtEntity, a = attackerOf(ev.damageSource);
      if (!v || v.typeId !== "minecraft:player" || !a || !clanView.noHit(a, v)) return;
      const h = v.getComponent("minecraft:health");
      if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + ev.damage));
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[clans] hurt (after): " + e); }

// ---------------------------------------------------------------- top clans (kills + money of the members) and the daily shard reward
let boardAt = 0, boardCache = null;
function board(fresh) {
  load();
  if (!fresh && boardCache && Date.now() - boardAt < 10000) return boardCache;
  const rows = [];
  for (const c of clans.values()) {
    if (members(c).length < CLAN.topMinMembers) continue;
    let kills = 0, mon = 0;
    for (const id of members(c)) { const s = statOf(id); if (s) { kills += s.kills; mon += s.money; } }
    rows.push({ c, kills, money: mon });
  }
  const rank = (key) => { const m = new Map(); [...rows].sort((a, b) => b[key] - a[key]).forEach((r, i) => m.set(r.c.id, i + 1)); return m; };
  const rk = rank("kills"), rm = rank("money");
  for (const r of rows) r.score = rk.get(r.c.id) + rm.get(r.c.id);
  const overall = [...rows].sort((a, b) => a.score - b.score || b.kills - a.kills || b.money - a.money);
  boardCache = { overall, kills: [...rows].sort((a, b) => b.kills - a.kills || b.money - a.money), money: [...rows].sort((a, b) => b.money - a.money || b.kills - a.kills) };
  boardAt = Date.now();
  return boardCache;
}
const dayNum = () => Math.floor((Date.now() + UTC_OFFSET_HOURS * 3600000) / 86400000);
function giveShards(id, n) { const p = online(id); if (p) addShards(p, n); else addShardsById(id, n); }
function payDaily() {
  load();
  if (!loaded) return;
  const today = dayNum(), last = world.getDynamicProperty(DAY_KEY);
  if (typeof last !== "number") { world.setDynamicProperty(DAY_KEY, today); return; }       // first start of this version: rewards begin with the next day
  if (last >= today) return;
  world.setDynamicProperty(DAY_KEY, today);                                                  // marked FIRST, so it can never be paid twice
  const top = board(true).overall, need = CLAN.rewardMinHours * 3600000, now = Date.now();
  [CLAN.rewardFirst, CLAN.rewardSecond].forEach((amount, i) => {
    const r = top[i]; if (!r || !(amount > 0)) return;
    for (const id of members(r.c)) {
      if (now - (r.c.joined[id] ?? 0) >= need) {
        giveShards(id, amount);
        say(id, "§d[Clan] +" + amount + " Shards §7- your clan §6" + r.c.name + " §7is #" + (i + 1) + " today!");
      } else say(id, "§7[Clan] Your clan is #" + (i + 1) + " today, but you must be in it for " + CLAN.rewardMinHours + " hours to get the shards.");
    }
  });
}
system.runInterval(() => { try { payDaily(); } catch (e) { console.warn("[clans] daily reward failed: " + e); } }, 600);

// ---------------------------------------------------------------- pages
const wrap = (t, n) => { const out = []; let s = String(t); while (s.length > n && out.length < 1) { out.push(s.slice(0, n)); s = s.slice(n); } out.push(s); return out; };
function createPage(player, back) {
  if (stats(player).money < CLAN.createCost) { result(player, "Creating a clan costs " + money(CLAN.createCost) + ". You have " + money(stats(player).money) + "."); return clanPage(player, back); }
  const form = new MenuForm().title("Create Clan - " + money(CLAN.createCost));
  textField(form, "§fClan name §7(3-16 characters)", "e.g. Night Wolves");
  textField(form, "§fClan tag §7(2-5 letters/numbers, shown above your head and in chat)", "e.g. WOLF");
  showModal(player, form, (v) => {
    if (v) result(player, createClan(player, v[0], v[1]), "Clan created for " + money(CLAN.createCost) + "! Invite players from the clan menu.");
    clanPage(player, back);
  });
}
let knownAt = 0, knownList = [];
const knownCached = () => { if (Date.now() - knownAt > 15000) { try { knownList = knownPlayers(); } catch (e) { knownList = []; } knownAt = Date.now(); } return knownList; };
const dot = (on) => (on ? "§a●" : "§8●");
/** invite: ANY player who ever joined (same two lists as /pay: Online / Offline) - the invitation is saved */
function invitePage(player, back, st = { tab: null, page: 0 }) {
  const c = owned(player);
  if (!c) { result(player, "Only the clan owner can invite."); return clanPage(player, back); }
  const live = new Map(world.getAllPlayers().filter((x) => x.id !== player.id).map((x) => [x.id, x]));
  const on = [], off = [], seen = new Set();
  for (const r of knownCached()) {
    if (r.id === player.id || !r.name || seen.has(r.id)) continue;
    seen.add(r.id);
    if (byPlayer.has(r.id)) continue;                                  // already in a clan
    const o = live.get(r.id);
    if (o) on.push({ id: r.id, name: o.name }); else off.push({ id: r.id, name: r.name });
  }
  for (const [id, o] of live) if (!seen.has(id) && !byPlayer.has(id)) on.push({ id, name: o.name });
  const by = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  on.sort(by); off.sort(by);
  if (st.tab === null) st.tab = on.length ? "on" : "off";
  const isOn = st.tab === "on", list = isOn ? on : off, PER = 72, pages = Math.max(1, Math.ceil(list.length / PER));
  st.page = Math.max(0, Math.min(st.page, pages - 1));
  const f = make("Invite Player", 9); f.self = () => invitePage(player, back, st);
  list.slice(st.page * PER, (st.page + 1) * PER).forEach((t, i) => {
    const invited = invitesById(t.id).some((x) => x.clan === c.id);
    set(f, i, hdr(1, invited ? "g" : "c") + dot(isOn) + " §f" + t.name + "\n§r" + (isOn ? "§aOnline" : "§7Offline") + "\n§r" + (invited ? "§aInvited §7- §cclick to cancel" : "§eClick to invite"), NAV.player, {
      run: () => {
        if (invited) result(player, cancelInvite(player, t.id), "Invitation to " + t.name + " cancelled.");
        else result(player, invite(player, t), "Invitation sent to " + t.name + (isOn ? "." : " §7(saved - they see it when they join)"));
        invitePage(player, back, st);
      } });
  });
  if (list.length === 0) set(f, 3 * COLS + 4, hdr(1) + (isOn ? "§7No online players without a clan" : "§7No offline players without a clan") + "\n§r§8Players appear here after they join once", NAV.player, null);
  set(f, 8 * COLS + 3, hdr(1, isOn ? "g" : "c") + "§a● §f§lOnline\n§r§7" + on.length + " player" + (on.length === 1 ? "" : "s") + (isOn ? "\n§r§aShowing" : "\n§r§eClick to show"), NAV.player, { run: () => { st.tab = "on"; st.page = 0; invitePage(player, back, st); } });
  set(f, 8 * COLS + 4, hdr(1, isOn ? "c" : "g") + "§8● §f§lOffline\n§r§7" + off.length + " player" + (off.length === 1 ? "" : "s") + (isOn ? "\n§r§eClick to show" : "\n§r§aShowing"), NAV.player, { run: () => { st.tab = "off"; st.page = 0; invitePage(player, back, st); } });
  if (pages > 1) {
    if (st.page > 0) set(f, 8 * COLS + 6, hdr(1) + "§e§lPrevious page", ICON.prev, { run: () => { st.page--; invitePage(player, back, st); } });
    set(f, 8 * COLS + 7, hdr(1) + "§7Page §f" + (st.page + 1) + "§7/§f" + pages, NAV.page, null);
    if (st.page < pages - 1) set(f, 8 * COLS + 8, hdr(1) + "§e§lNext page", ICON.next, { run: () => { st.page++; invitePage(player, back, st); } });
  }
  backBtn(f, () => clanPage(player, back)); status(player, f);
  open(player, f);
}
function invitesPage(player, back) {
  const list = invitesFor(player), f = make("Clan Invitations", SHORT_ROWS); f.self = () => invitesPage(player, back);
  list.slice(0, 27).forEach((i, k) => {
    const c = clans.get(i.clan);
    set(f, k, hdr(1, "g") + "§6" + c.name + " §e[" + c.tag + "]\n§r§7Invited by §f" + i.from + "\n§r§7Members: §f" + members(c).length + "§7/§f" + levelCap(c) + "\n§r§eClick to answer", ICON.tag, { run: () => inviteDetail(player, i, back) });
  });
  if (list.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7No invitations", "textures/ui/shop/ic_mail", null);
  backBtn(f, () => clanPage(player, back)); status(player, f);
  open(player, f);
}
function inviteDetail(player, i, back) {
  const c = clans.get(i.clan), f = make("Invitation", SHORT_ROWS);
  if (!c) return invitesPage(player, back);
  f.self = () => inviteDetail(player, i, back);
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + c.name + " §e[" + c.tag + "]\n§r§7Owner: §f" + c.members[c.owner] + "\n§r§7Members: §f" + members(c).length + "§7/§f" + levelCap(c) + "\n§r§7Invited by: §f" + i.from + (c.desc ? "\n§r§8" + c.desc.slice(0, 30) : ""), ICON.tag, null);
  set(f, 2 * COLS + 2, hdr(1, "g") + "§a§lJOIN\n§r§7Join this clan", NAV.ok, { run: () => { result(player, join(player, i.clan), "You joined " + c.name + "!"); clanPage(player, back); } });
  set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lDECLINE\n§r§7Delete the invitation", NAV.no, {
    run: () => { writeInv(player.id, invitesFor(player).filter((x) => x.clan !== i.clan)); player.sendMessage(menuMsg(player, "§7[Clan] Invitation declined.")); invitesPage(player, back); } });
  backBtn(f, () => invitesPage(player, back)); status(player, f);
  open(player, f);
}
/** the invitations this clan has sent (still waiting): the owner can cancel each one */
function sentPage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const list = sentInvites(c), f = make("Sent Invitations", SHORT_ROWS); f.self = () => sentPage(player, back);
  list.slice(0, 27).forEach((i, k) => {
    set(f, k, hdr(1, "r") + "§f" + i.to + "\n§r§7Expires in §f" + playtime(Math.max(0, i.exp - Date.now()) / 1000) + "\n§r§cClick to cancel", NAV.player, {
      run: () => { result(player, cancelInvite(player, i.id), "Invitation to " + i.to + " cancelled."); sentPage(player, back); } });
  });
  if (list.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7No pending invitations", "textures/ui/shop/ic_mail", null);
  backBtn(f, () => clanPage(player, back)); status(player, f);
  open(player, f);
}
function membersPage(player, back) {
  const c = clanOf(player);
  if (!c) return clanPage(player, back);
  const f = make("Clan Members §8(" + members(c).length + "/" + levelCap(c) + ")", SHORT_ROWS); f.self = () => membersPage(player, back);
  members(c).forEach((id, k) => {
    const isOwner = id === c.owner, on = !!online(id), name = c.members[id];
    set(f, k, hdr(1) + (isOwner ? "§6§l" : "§f") + name + "\n§r" + (isOwner ? "§6Owner" : "§7Member") + "\n§r" + (on ? "§aOnline" : "§8Offline") + "\n§r§eClick to open the profile", NAV.player, { run: () => profilePage(player, id, back) });
  });
  backBtn(f, () => clanPage(player, back)); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- member profile (every member of the clan can open it): money, shards, kills, deaths, time, blocks, earned / spent, skills, land
const abilityText = (key, L) => {
  const steps = Math.min(PERK.max / PERK.step, Math.floor(L / PERK.every));
  if (key === "fly") return steps ? "§aElytra speed +" + steps * PERK.step + "%" : "§8Elytra speed: locked";
  if (key === "combat") return steps ? "§aDamage +" + steps * PERK.step + "%" : "§8Damage bonus: locked";
  if (key === "fish") return steps ? "§aDouble catch +" + steps * PERK.step + "%" : "§8Double catch: locked";
  if (key === "trade") { const t = TRADE_TIERS.filter((x) => x.lv <= L).pop(); return t ? "§aShop " + (t.buy ? "-" + t.buy + "%" : "") + (t.sell ? " / sell +" + t.sell + "%" : "") : "§8Shop perks: locked"; }
  const pts = Math.floor(L / SPEED.every);
  return pts ? "§aSpeed points earned: " + pts : "§8Speed points: none yet";
};
export function profilePage(viewer, id, back) {
  const c = clanOf(viewer);
  if (!c || !c.members[id]) return membersPage(viewer, back);        // only members of the SAME clan can look at a profile
  const s = recordOf(id), x = exOf(id), t = x.st ?? {}, name = c.members[id], live = online(id), isOwner = id === c.owner;
  const f = make("Profile §8- " + name, 7); f.self = () => profilePage(viewer, id, back);
  if (!s) { set(f, 0 * COLS + 4, hdr(1) + "§e§l" + name + "\n§r§7No data yet", NAV.player, null); backBtn(f, () => membersPage(viewer, back)); status(viewer, f); return open(viewer, f); }
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
  const secs = live ? playSeconds(live) : s.play;
  const cell = (row, col, icon, title, ...lines) => set(f, row * COLS + col, hdr(1) + "§e§l" + title + lines.map((l) => "\n§r" + l).join(""), icon, null);
  set(f, 0 * COLS + 4, hdr(1) + (isOwner ? "§6§l" : "§f§l") + name + "\n§r" + (isOwner ? "§6Clan owner" : "§7Clan member") + "\n§r" + (live ? "§aOnline" : "§8Offline") + (s.joined ? "\n§r§7First seen: §f" + ago(s.joined) : ""), NAV.player, null);
  cell(1, 2, NAV.bal, "Money", "§a" + money(s.money));
  cell(1, 4, ICON.shard, "Shards", "§d" + num(s.shards));
  cell(1, 6, ICON.book, "Playtime", "§f" + playtime(secs));
  cell(2, 2, ICON.sword, "Players Killed", "§f" + num(s.kills), "§7K/D ratio: §f" + kd);
  cell(2, 4, ICON.book, "Deaths", "§f" + num(s.deaths));
  cell(2, 6, "textures/items/diamond_pickaxe", "Blocks Broken", "§f" + num(t.broken ?? 0), "§7Placed: §f" + num(t.placed ?? 0));
  cell(3, 2, NAV.bal, "Earned", "§7From the shop", "§a" + money(s.earned ?? 0));
  cell(3, 4, NAV.bal, "Spent", "§7In the shop", "§c" + money(s.spent ?? 0));
  cell(3, 6, ICON.sword, "Mobs Killed", "§f" + num(t.mobs ?? 0));
  set(f, 4 * COLS + 2, hdr(1) + "§b§lSkills & Abilities\n§r§7Levels and what " + name + "\n§r§7has unlocked", "textures/items/iron_axe", { run: () => memberSkillsPage(viewer, id, back) });
  const lands = claimsOf(id).length;
  set(f, 4 * COLS + 6, hdr(Math.max(1, lands)) + "§a§lLand\n§r§7" + (lands ? lands + " protected land" + (lands > 1 ? "s" : "") : "No protected land") + (lands && id !== viewer.id ? "\n§r§eSend a tp request" : ""), NAV.shield, { run: () => memberLandPage(viewer, id, back) });
  if (c.owner === viewer.id && id !== viewer.id)
    set(f, 5 * COLS + 4, hdr(1, "r") + "§c§lKick from clan\n§r§7Works even when " + name + " is offline", "textures/ui/shop/x_exposed_copper_door", {
      run: () => confirm(viewer, "Kick member", ["§f" + name, "", "§cRemove this player from the clan?"], () => { result(viewer, kick(viewer, id), name + " was kicked."); membersPage(viewer, back); }, () => profilePage(viewer, id, back)) });
  backBtn(f, () => membersPage(viewer, back)); status(viewer, f);
  open(viewer, f);
}
function memberSkillsPage(viewer, id, back) {
  const c = clanOf(viewer);
  if (!c || !c.members[id]) return membersPage(viewer, back);
  const n = exOf(id).sk?.n ?? {}, name = c.members[id], f = make("Skills §8- " + name, SHORT_ROWS); f.self = () => memberSkillsPage(viewer, id, back);
  KEYS.forEach((key, i) => {
    const S = SKILLS[key], L = skillLevelInfo(Number(n[key]) || 0, !!exOf(id).sk?.lk?.[key]);
    set(f, (1 + Math.floor(i / 4)) * COLS + 1 + (i % 4) * 2, hdr(1) + S.color + "§l" + S.name + "\n§r§7Level §f" + L.level + (L.max ? " §6MAX" : " §8(" + L.pct + "%)") + "\n§r" + abilityText(key, L.level), S.icon, null);
  });
  backBtn(f, () => profilePage(viewer, id, back)); status(viewer, f);
  open(viewer, f);
}
/** his protected lands: a clan mate can send a teleport request to one of them (the owner gets "X sent you request tp for your land") */
function memberLandPage(viewer, id, back) {
  const c = clanOf(viewer);
  if (!c || !c.members[id]) return membersPage(viewer, back);
  const name = c.members[id], list = claimsOf(id), owner = online(id), me = id === viewer.id, f = make("Land §8- " + name, SHORT_ROWS); f.self = () => memberLandPage(viewer, id, back);
  list.slice(0, 27).forEach((l, k) => {
    const sz = sizeOf(l.s), can = !me && owner && !tpOff(owner);
    set(f, k, hdr(1, can ? "g" : "c") + "§a§l" + l.n + "\n§r§7" + sz.name + " " + sz.w + "x" + sz.w + " §8| §7" + dimLabel(l.d) + "\n§r§7Time left: §f" + landDur(landLeft(l)) +
      "\n§r" + (me ? "§8Your land" : !owner ? "§8" + name + " is offline" : tpOff(owner) ? "§c" + name + " closed teleport requests" : "§eClick to send a tp request"), NAV.shield, can ? {
      run: () => { sendTpaLand(viewer, owner, l); memberLandPage(viewer, id, back); } } : null);
  });
  if (list.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7No protected land", NAV.shield, null);
  backBtn(f, () => profilePage(viewer, id, back)); status(viewer, f);
  open(viewer, f);
}

/** top clans: Overall (kills + money together), Kills, Money */
export function topPage(player, back, tab = "o") {
  const b = board(), list = tab === "k" ? b.kills : tab === "m" ? b.money : b.overall, mine = clanOf(player);
  const f = make("Top Clans", SHORT_ROWS); f.self = () => topPage(player, back, tab);
  set(f, 0 * COLS + 0, hdr(1) + "§d§lDaily Rewards\n§r§7#1 clan: §d" + CLAN.rewardFirst + " shards §7per member\n§r§7#2 clan: §d" + CLAN.rewardSecond + " shards §7per member\n§r§8Members for " + CLAN.rewardMinHours + "h+ | clans with " + CLAN.topMinMembers + "+ players", ICON.shard, null);
  set(f, 0 * COLS + 8, hdr(1) + "\u00a7b\u00a7lShow as hologram\n\u00a7r\u00a77The top 10 clans float in front of you\n\u00a7r\u00a78/top clan", "textures/ui/shop/ic_trophy", { run: () => system.run(() => { try { clanView.showTop(player, "clan"); } catch (e) { /* ignore */ } }) });
  [["o", "Overall", "Kills + money together"], ["k", "Kills", "Most kills"], ["m", "Money", "Most money"]].forEach(([key, name, sub], i) => {
    set(f, 0 * COLS + 2 + i * 2, hdr(1, tab === key ? "g" : "c") + "§e§l" + name + "\n§r§7" + sub + (tab === key ? "\n§r§aShowing" : "\n§r§eClick to show"), ICON.star, { run: () => topPage(player, back, key) });
  });
  list.slice(0, 27).forEach((r, i) => {
    const own = mine && mine.id === r.c.id, ro = b.overall.indexOf(r) + 1;
    const reward = tab === "o" ? (i === 0 ? "\n§r§d+" + CLAN.rewardFirst + " shards/day per member" : i === 1 ? "\n§r§d+" + CLAN.rewardSecond + " shards/day per member" : "") : "";
    set(f, COLS + i, hdr(i + 1, own ? "g" : "c") + "§6§l#" + (i + 1) + " §f" + r.c.name + " " + plainTag(r.c, r.c.tc) + "\n§r§7Members: §f" + members(r.c).length + (tab !== "o" ? " §8| §7Overall #" + ro : "") + "\n§r§cKills: §f" + short(r.kills) + " §8| §aMoney: §f$" + short(r.money) + reward + (own ? "\n§r§aYour clan" : ""), ICON.tag, null);
  });
  if (list.length === 0) set(f, 2 * COLS + 4, hdr(1) + "§7No ranked clans yet\n§r§8A clan needs " + CLAN.topMinMembers + " members", ICON.paper, null);
  if (mine && members(mine).length < CLAN.topMinMembers) set(f, 3 * COLS + 8, hdr(1, "r") + "§c§lYour clan is not ranked\n§r§7It needs " + CLAN.topMinMembers + " members", NAV.no, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- owner settings
function settingsPage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const f = make("Clan Settings", SHORT_ROWS); f.self = () => settingsPage(player, back);
  const left = renameLeft(c), toClan = () => clanPage(player, back);
  const label = (row, title, sub, icon) => set(f, row * COLS, hdr(1) + title + "\n§r§8" + sub, icon, null);
  set(f, 0 * COLS + 4, hdr(1) + "§6§l" + c.name + " " + tagText(c) + "\n§r§7Settings only the owner can change", ICON.tag, null);
  // --- rules
  label(1, "§c§lRULES", "How members fight", ICON.sword);
  set(f, 1 * COLS + 2, hdr(1, c.ff ? "r" : "g") + "§e§lFriendly Fire\n§r" + (c.ff ? "§cON §7- members can hurt each other" : "§aOFF §7- members can't hurt each other") + "\n§r§eClick to turn " + (c.ff ? "OFF" : "ON"), ICON.sword, { run: () => { result(player, toggleFF(player)); settingsPage(player, back); } });
  // --- look
  label(2, "§d§lLOOK", "Colours", ICON.tag);
  set(f, 2 * COLS + 2, hdr(1) + "§" + c.nc + "§lNotification Colour\n§r§7Messages in the middle-bottom\n§r§7of the screen (clan only)\n§r§7Now: §" + c.nc + (NOTE_COLORS.find((x) => x[0] === c.nc)?.[1] ?? ""), colorIcon(NOTE_COLORS, c.nc), { run: () => noteColorPage(player, back) });
  set(f, 2 * COLS + 4, hdr(1) + "§" + c.tc + "§lTag Look\n§r§7Colour and shape of the tag\n§r§7and of the name above the head\n§r§7Now: " + tagText(c), colorIcon(TAG_COLORS, c.tc), { run: () => tagLookPage(player, back) });
  // --- info
  label(3, "§a§lINFO", "Name and text", ICON.book);
  set(f, 3 * COLS + 2, hdr(1) + "§a§lDescription\n§r§7" + (c.desc ? c.desc.slice(0, 30) : "No description yet") + "\n§r§eClick to change", ICON.book, { run: () => descPage(player, back) });
  set(f, 3 * COLS + 4, hdr(1, left > 0 ? "r" : "g") + "§b§lRename Clan\n§r§7Now: §f" + c.name + "\n§r" + (left > 0 ? "§cNext change in §f" + playtime(left / 1000) : "§aYou can rename now") + "\n§r§8Once every " + CLAN.renameDays + " days", ICON.tag, { run: () => renamePage(player, back) });
  backBtn(f, toClan); status(player, f);
  open(player, f);
}
function noteColorPage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const f = make("Notification Colour", SHORT_ROWS); f.self = () => noteColorPage(player, back);
  set(f, 0 * COLS + 4, hdr(1) + "§" + c.nc + "§lNotification Colour\n§r§7Join / death / kill messages show in the\n§r§7middle-bottom of the screen for your clan only.\n§r§7Click a colour to choose it (you see a preview).", colorIcon(NOTE_COLORS, c.nc), null);
  NOTE_COLORS.forEach(([ch, name, wool], k) => {
    const on = c.nc === ch;
    set(f, 1 * COLS + 1 + k, hdr(1, on ? "g" : "c") + "§" + ch + "§l" + name + "\n§r§" + ch + player.name + " joined\n§r§" + ch + "the server\n§r" + (on ? "§aSelected" : "§eClick to choose"), woolIcon(wool), {
      run: () => { if (result(player, setNoteColor(player, ch))) clanBanner(player, player.name + " joined the server", ch); noteColorPage(player, back); } });
  });
  backBtn(f, () => settingsPage(player, back)); status(player, f);
  open(player, f);
}
function tagLookPage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const f = make("Tag Look", SHORT_ROWS); f.self = () => tagLookPage(player, back);
  set(f, 0 * COLS + 4, hdr(1) + "§e§lAbove your head\n§r" + tagText(c) + "\n§r§" + c.tc + player.name + "\n§r§7The tag and the name use the clan colour.", colorIcon(TAG_COLORS, c.tc), null);
  TAG_COLORS.forEach(([ch, name, wool], k) => {
    const on = c.tc === ch;
    set(f, (1 + Math.floor(k / 7)) * COLS + 1 + (k % 7), hdr(1, on ? "g" : "c") + "§" + ch + "§l" + name + "\n§r" + plainTag(c, ch) + "\n§r" + (on ? "§aSelected" : "§eClick to choose"), woolIcon(wool), {
      run: () => { result(player, setTagColor(player, ch)); tagLookPage(player, back); } });
  });
  const st = STYLES[c.ts] ?? STYLES[0];
  set(f, 3 * COLS + 2, hdr(1) + "§b§lShape\n§r§7Now: §f" + st[0] + "TAG" + st[1] + "\n§r§eClick for the next shape", ICON.paper, { run: () => { result(player, nextStyle(player)); tagLookPage(player, back); } });
  set(f, 3 * COLS + 6, hdr(1, c.tb ? "g" : "c") + "§f§lBold\n§r" + (c.tb ? "§aON" : "§7OFF") + "\n§r§eClick to " + (c.tb ? "turn OFF" : "turn ON"), ICON.book, { run: () => { result(player, toggleBold(player)); tagLookPage(player, back); } });
  backBtn(f, () => settingsPage(player, back)); status(player, f);
  open(player, f);
}
function descPage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const form = new MenuForm().title("Clan Description");
  textField(form, "§fDescription §7(up to " + CLAN.descMax + " characters, leave empty to remove)", c.desc || "e.g. We play fair and farm together");
  showModal(player, form, (v) => {
    if (v) result(player, setDesc(player, v[0]), v[0] && String(v[0]).trim() ? "Description saved." : "Description removed.");
    settingsPage(player, back);
  });
}
function renamePage(player, back) {
  const c = owned(player);
  if (!c) return clanPage(player, back);
  const left = renameLeft(c);
  if (left > 0) { result(player, "You can rename the clan again in " + playtime(left / 1000) + "."); return settingsPage(player, back); }
  const form = new MenuForm().title("Rename Clan");
  textField(form, "§fNew clan name §7(3-16 characters)\n§cYou can change it again only after " + CLAN.renameDays + " days.", c.name);
  showModal(player, form, (v) => {
    if (v) result(player, rename(player, v[0]), "Clan renamed.");
    settingsPage(player, back);
  });
}

export function clanPage(player, back) {
  const c = clanOf(player), f = make(c ? "Clan §8- " + c.name : "Clans", c ? 7 : SHORT_ROWS); f.self = () => clanPage(player, back);
  // every row is ONE category: its name is in the first column, its buttons follow
  const label = (row, title, sub, icon) => set(f, row * COLS, hdr(1) + title + "\n§r§8" + sub, icon, null);
  if (!c) {
    const n = invitesFor(player).length;
    set(f, 0 * COLS + 4, hdr(1) + "§e§lClans\n§r§7Create a clan with your friends:\n§r§7a tag above your head and in chat,\n§r§7clan chat, a clan home\n§r§7and daily shards.", ICON.tag, null);
    label(1, "§a§lSTART", "Create or join", ICON.tag);
    set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lCreate Clan\n§r§7Cost: §a" + money(CLAN.createCost) + "\n§r§7Choose a name and a tag", NAV.ok, { run: () => createPage(player, back) });
    set(f, 1 * COLS + 4, hdr(Math.max(1, n)) + "§b§lInvitations\n§r" + (n > 0 ? "§e" + n + " waiting" : "§7No invitations"), "textures/ui/shop/ic_mail", { run: () => invitesPage(player, back) });
    label(2, "§d§lRANKING", "Best clans", ICON.shard);
    set(f, 2 * COLS + 2, hdr(1) + "§d§lTop Clans\n§r§7Kills and money\n§r§7#1 gets " + CLAN.rewardFirst + " shards a day", "textures/ui/shop/ic_trophy", { run: () => topPage(player, () => clanPage(player, back)) });
  } else {
    const mine = c.owner === player.id, d = wrap(c.desc, 30), cap = levelCap(c);
    set(f, 0 * COLS + 4, hdr(members(c).length) + "§6§l" + c.name + " " + tagText(c) + "\n§r§7Members: §f" + members(c).length + "§7/§f" + cap + "\n§r§7Owner: §f" + c.members[c.owner] + "\n§r§7Home: " + (c.home ? "§a" + dimLabel(c.home.d) + " " + Math.floor(c.home.x) + ", " + Math.floor(c.home.y) + ", " + Math.floor(c.home.z) : "§cnot set") + "\n§r§7Friendly fire: " + (c.ff ? "§cON" : "§aOFF") + (c.desc ? "\n§r§8" + d.join("\n§r§8") : ""), ICON.tag, null);
    set(f, 0 * COLS + 6, hdr(1) + "§b§lClan Chat\n§r§7Type §f/cc <message>\n§r§7Only your clan sees it", "textures/ui/shop/ic_chat", null);

    label(1, "§e§lCLAN", "Members, ranking", ICON.star);
    set(f, 1 * COLS + 2, hdr(1) + "§b§lMembers\n§r§7" + members(c).length + "/" + cap + " players\n§r§eOpen a profile", NAV.player, { run: () => membersPage(player, back) });
    set(f, 1 * COLS + 4, hdr(1) + "§d§lTop Clans\n§r§7Kills and money\n§r§7#1 gets " + CLAN.rewardFirst + " shards a day", "textures/ui/shop/ic_trophy", { run: () => topPage(player, () => clanPage(player, back)) });

    label(2, "§a§lTELEPORT", "Clan homes", ICON.bed);
    set(f, 2 * COLS + 2, hdr(1, c.home ? "g" : "c") + "§a§lClan Home\n§r" + (c.home ? "§7Click to teleport" : "§7Not set yet"), ICON.bed, { run: () => { goClanHome(player); } });
    set(f, 2 * COLS + 4, hdr(1, c.home2 ? "g" : "c") + "§a§lClan Home 2\n§r" + (c.home2 ? "§7Click to teleport" : "§7Not set yet"), ICON.bed, c.home2 ? { run: () => { goClanHome2(player); } } : null);

    if (mine) {
      const ns = sentInvites(c).length;
      label(3, "§d§lINVITES", "Bring players in", ICON.book);
      set(f, 3 * COLS + 2, hdr(1) + "§d§lInvite Player\n§r§7Any player, even offline", NAV.player, { run: () => invitePage(player, back) });
      set(f, 3 * COLS + 4, hdr(Math.max(1, ns)) + "§e§lSent Invitations\n§r" + (ns ? "§7" + ns + " waiting - click to cancel" : "§7None waiting"), "textures/ui/shop/ic_mail", { run: () => sentPage(player, back) });

      label(4, "§6§lMANAGE", "Owner only", NAV.shield);
      set(f, 4 * COLS + 2, hdr(1) + "§e§lSet Clan Home\n§r§7Use your current position", ICON.bed, { run: () => { result(player, setHome(player), "Clan home set."); clanPage(player, back); } });
      set(f, 4 * COLS + 4, hdr(1) + "§e§lSet Clan Home 2\n§r§7Use your current position", ICON.bed, { run: () => { result(player, setHome2(player), "Second clan home set."); clanPage(player, back); } });
      set(f, 4 * COLS + 6, hdr(1) + "§6§lSettings\n§r§7Friendly fire, colours, tag,\n§r§7description, rename", "textures/ui/shop/ic_gear", { run: () => settingsPage(player, back) });
      set(f, 4 * COLS + 8, hdr(1, "r") + "§c§lDisband Clan\n§r§7Delete the clan for everyone", "textures/ui/shop/i3d_tnt", {
        run: () => confirm(player, "Disband clan", ["§f" + c.name, "", "§cAll members are removed.", "§cThis cannot be undone."], () => { result(player, disband(player), "Clan disbanded."); clanPage(player, back); }, () => clanPage(player, back)) });
    } else {
      label(3, "§c§lACCOUNT", "Your place in the clan", NAV.no);
      set(f, 3 * COLS + 2, hdr(1, "r") + "§c§lLeave Clan\n§r§7Leave " + c.name, "textures/ui/shop/x_exposed_copper_door", {
        run: () => confirm(player, "Leave clan", ["§f" + c.name, "", "§cDo you want to leave?"], () => { result(player, leave(player), "You left the clan."); clanPage(player, back); }, () => clanPage(player, back)) });
    }
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
