// STAFF CORE (no menus here - the pages are in staffmenu.js).  Everything below is only usable by operators (isStaff) and is checked AGAIN on every action:
//   roles (Helper / Mod / Admin)      staff-action log (+ archive)      mute / kick / warn / notes      freeze / economy freeze
//   tp here                           reports (/report)                 last known positions            broadcast + staff chat
// Settings: STAFF in systems/config.js.  Every public function returns { ok: true, ... } or { err: "text" } and never throws:
// a problem in here can never stop the shop, the chat or the other systems.
import { world, system } from "@minecraft/server";
import { isStaff, opAlert, leftText, staffHook } from "./opcore.js";
import { duelView } from "./duelstate.js";
import { STAFF as C } from "./config.js";
import { clanView } from "./clanstate.js";
import { allRecords } from "../data.js";
import { oprMsg } from "./oprlang.js";
import { pick } from "./arextra.js";

const MIN = 60000, DAY = 86400000;
const clean = (s, n = 80) => String(s ?? "").replace(/[§\r\n"\\]/g, "").trim().slice(0, n);
const online = (id) => { try { return world.getAllPlayers().find((x) => x.id === id) ?? null; } catch (e) { return null; } };
const say = (p, msg) => { try { p.sendMessage(oprMsg(p, msg)); } catch (e) { /* ignore */ } };
const left = (u) => (u ? leftText(u) : "until lifted");
export const cleanText = clean;
export { online, say };

// ---------------------------------------------------------------- small saved stores (one JSON text per world property, lazy, never overwrites unreadable data)
export function makeStore(key, init, maxLen = 24000) {
  let data = null;
  return {
    get() {
      if (data) return data;
      try {
        const raw = world.getDynamicProperty(key);
        const d = typeof raw === "string" ? JSON.parse(raw) : init();
        data = d && typeof d === "object" ? d : init();
      } catch (e) { return null; }                                 // world not ready / unreadable: do nothing (the saved data stays as it is)
      return data;
    },
    save() {
      if (!data) return false;
      try {
        const s = JSON.stringify(data);
        if (s.length > maxLen) return false;
        world.setDynamicProperty(key, s);
        return true;
      } catch (e) { console.warn("[staff] save failed (" + key + "): " + e); return false; }
    },
  };
}
/** one saved JSON per player: object | null (nothing saved) | undefined (unreadable) */
export function readOf(key) { try { const raw = world.getDynamicProperty(key); return typeof raw === "string" ? JSON.parse(raw) : null; } catch (e) { return undefined; } }
export function writeOf(key, v) { try { world.setDynamicProperty(key, v === null ? undefined : JSON.stringify(v)); return true; } catch (e) { console.warn("[staff] save failed (" + key + "): " + e); return false; } }

// ---------------------------------------------------------------- roles
export const ROLES = ["helper", "mod", "admin"];
const RANK = { helper: 1, mod: 2, admin: 3, owner: 4 };
export const ROLE_NAME = { helper: "Helper", mod: "Mod", admin: "Admin", owner: "Owner" };
export const ROLE_COLOR = { helper: "§a", mod: "§e", admin: "§c", owner: "§5" };       // Owner = dark purple (nobody else has it)
/** the lowest role that may do each thing.  Existing operators have no saved role = Admin (nothing changes for them until an Admin lowers somebody). */
export const PERM_MIN = {
  // Helper
  goto: "helper", notes: "helper", mute: "helper", kick: "helper", warn: "helper", tphere: "helper", reports: "helper", inspect: "helper", alerts: "helper", staffchat: "helper",
  // Mod
  freeze: "mod", tempban: "mod", logs: "mod", stafflog: "mod", broadcast: "mod", lands: "mod", inventory: "mod", handle: "mod", perf: "mod", vanish: "mod", lock: "mod", bans: "mod", clearlag: "mod", tpall: "mod",
  // Admin
  money: "admin", shards: "admin", levels: "admin", giveitem: "admin", permban: "admin", unban: "admin", bypass: "admin", landlimit: "admin", spawn: "admin", boards: "admin", spectate: "admin", orevision: "admin",
  takeitem: "admin", econ: "admin", shop: "admin", roles: "admin", restore: "admin", unwarn: "admin", endgate: "admin", mobmoney: "admin", back: "admin", crates: "admin", afkset: "admin", duelset: "admin", warps: "admin", tpbtn: "admin", events: "admin",
  // Owner only (default) - the Owner can allow it for Admin (or any role) in Owner panel > Role permissions
  hudname: "owner",
  spawnerset: "owner",
};
const roleStore = makeStore("stf:role", () => ({}));
/** a saved staff role = staff (the Operator menu opens for him even when he is not a game operator) */
export const hasStaffRole = (id) => { try { const m = roleStore.get(); return !!(m && m[id] && ["helper", "mod", "admin"].includes(m[id].r)); } catch (e) { return false; } };

// ---------------------------------------------------------------- the OWNER: the first player who ever joins.  Saved in the world ("stf:owner" = { id, n }).
//   Nobody can punish / change the Owner.  Only the Owner decides what Helper / Mod / Admin may do (see "role permissions" below).
//   Recovery (wrong player joined first): from the SERVER CONSOLE only:  scriptevent shop:owner <player name>   or   scriptevent shop:owner reset
const OWNER_KEY = "stf:owner";
let ownerCache;                                                      // undefined = not read yet, null = no owner yet, { id, n }
function readOwner() {
  if (ownerCache !== undefined) return ownerCache;
  try { const raw = world.getDynamicProperty(OWNER_KEY); ownerCache = typeof raw === "string" ? JSON.parse(raw) : null; }
  catch (e) { return undefined; }                                    // unreadable: never hand out the Owner by mistake
  return ownerCache;
}
function writeOwner(o) {
  try { world.setDynamicProperty(OWNER_KEY, o ? JSON.stringify(o) : undefined); ownerCache = o; return true; } catch (e) { console.warn("[staff] owner save failed: " + e); return false; }
}
export const isOwnerId = (id) => { const o = readOwner(); return !!o && o.id === id; };
export const isOwner = (p) => { try { return !!p && isOwnerId(p.id); } catch (e) { return false; } };
export const ownerInfo = () => readOwner() ?? null;
const refreshTag = (p) => { try { system.runTimeout(() => { try { if (clanView.applyTag) clanView.applyTag(p); } catch (e) { /* ignore */ } }, 10); } catch (e) { /* ignore */ } };
/** hands the Owner to a player (the old Owner becomes a normal Admin) */
export function setOwner(target) {
  const old = readOwner(); if (old === undefined) return false;
  if (!writeOwner({ id: target.id, n: String(target.name).slice(0, 32) })) return false;
  const m = roleStore.get(); if (m && m[target.id]) { delete m[target.id]; roleStore.save(); }     // the Owner needs no saved role
  if (old && old.id !== target.id) { const mm = roleStore.get(); if (mm) { mm[old.id] = { n: old.n, r: "admin" }; roleStore.save(); } const po = online(old.id); if (po) refreshTag(po); }
  const pt = online(target.id); if (pt) refreshTag(pt);
  return true;
}
clanView.isOwner = (p) => isOwner(p);
staffHook.has = (id) => hasStaffRole(id) || isOwnerId(id);
staffHook.owner = (id) => isOwnerId(id);
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    try {
      const o = readOwner();
      if (o === null) {                                              // nobody is the Owner yet: the first player who joins
        if (setOwner({ id: player.id, name: player.name })) {
          system.runTimeout(() => { try { player.sendMessage(pick(player, "§5§l[Owner] §r§dYou are the Owner of this server. §7Only you can set what Helper, Mod and Admin may do: §fMenu > Operator > Owner.", "§5§l[Owner] §r§dأنت مالك هذا السيرفر.\n§7فقط أنت تحدد ما يستطيع فعله المساعد والمراقب والأدمن:\n§fالقائمة > المشرف > المالك.")); } catch (e) { /* ignore */ } }, 80);
        }
      } else if (o && o.id === player.id) { if (o.n !== player.name) writeOwner({ id: o.id, n: player.name.slice(0, 32) }); refreshTag(player); }
    } catch (e) { console.warn("[staff] owner check: " + e); }
  });
  // the pack was just installed while players are already online: if exactly one player is online he becomes the Owner
  system.runTimeout(() => { try { if (readOwner() === null) { const ps = world.getAllPlayers(); if (ps.length === 1) { if (setOwner({ id: ps[0].id, name: ps[0].name })) try { ps[0].sendMessage(pick(ps[0], "§5§l[Owner] §r§dYou are the Owner of this server. §7Menu > Operator > Owner.", "§5§l[Owner] §r§dأنت مالك هذا السيرفر.\n§7القائمة > المشرف > المالك.")); } catch (e) { /* ignore */ } } } } catch (e) { /* ignore */ } }, 200);
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    try {
      if (ev.id !== "shop:owner" || String(ev.sourceType) !== "Server") return;
      const arg = String(ev.message ?? "").trim();
      if (!arg) { console.warn("[staff] owner = " + (readOwner()?.n ?? "nobody")); return; }
      if (arg.toLowerCase() === "reset") { writeOwner(null); console.warn("[staff] owner cleared: the next player who joins becomes the Owner"); return; }
      const low = arg.toLowerCase();
      let t = world.getAllPlayers().find((x) => x.name.toLowerCase() === low); if (t) t = { id: t.id, name: t.name };
      if (!t) { const r = allRecords().find((x) => String(x.name).toLowerCase() === low); if (r) t = { id: r.id, name: r.name }; }
      if (!t) { console.warn("[staff] owner: player not found: " + arg); return; }
      console.warn(setOwner(t) ? "[staff] owner is now " + t.name : "[staff] owner change failed");
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[staff] owner system not started: " + e); }

export function roleOf(p) {
  try {
    if (!p) return null;
    if (isOwner(p)) return "owner";
    if (!isStaff(p)) return null;
    if (Array.isArray(C.owners) && C.owners.includes(p.name)) return "admin";
    const m = roleStore.get();
    if (!m) return "helper";                                       // roles unreadable: never hand out Admin by mistake
    const r = m[p.id]?.r;
    return ["helper", "mod", "admin"].includes(r) ? r : "admin";
  } catch (e) { return null; }
}
/** the saved role of any player id (online or not): "owner" | "helper" | "mod" | "admin" (default) */
export function roleOfId(id) { try { if (isOwnerId(id)) return "owner"; const m = roleStore.get(); const r = m ? m[id]?.r : null; return ["helper", "mod", "admin"].includes(r) ? r : "admin"; } catch (e) { return "admin"; } }

// ---------------------------------------------------------------- ROLE PERMISSIONS: PERM_MIN is only the DEFAULT.  The Owner can allow / block any permission for any role.
//   saved: { helper: { mute: false, money: true }, mod: {...}, admin: {...} }  (only the differences from the default are stored)
const permStore = makeStore("stf:perm", () => ({}));
export const PERM_ROLES = ["helper", "mod", "admin"];
const defaultAllows = (role, perm) => RANK[role] >= RANK[PERM_MIN[perm]];
export function roleAllows(role, perm) {
  if (role === "owner") return !!PERM_MIN[perm];
  const o = permStore.get()?.[role]?.[perm];
  return typeof o === "boolean" ? o : defaultAllows(role, perm);
}
export const roleDefault = (role, perm) => defaultAllows(role, perm);
export function permCount(role) { const keys = Object.keys(PERM_MIN); return { on: keys.filter((k) => roleAllows(role, k)).length, total: keys.length }; }
export function can(p, perm) {
  const r = roleOf(p);
  if (!r || !PERM_MIN[perm]) return false;
  return r === "owner" ? true : roleAllows(r, perm);
}
/** why a button is locked for this operator (short coloured text) */
export function lockText(perm, p) {
  const r = roleOf(p);
  if (r && defaultAllows(r, perm)) return "§cBlocked by the Owner";
  return "§cNeeds the §f" + ROLE_NAME[PERM_MIN[perm]] + " §crole";
}
/** true when allowed; otherwise tells the operator why and returns false */
export function allow(p, perm) {
  if (can(p, perm)) return true;
  if (!isStaff(p)) say(p, "§c[Operator] Operators only.");
  else {
    const r = roleOf(p);
    say(p, defaultAllows(r, perm) ? "§c[Operator] The §5Owner §chas blocked this for your role (§f" + ROLE_NAME[r] + "§c)." : "§c[Operator] This needs the §f" + ROLE_NAME[PERM_MIN[perm]] + " §crole or higher. Your role: §f" + ROLE_NAME[r] + "§c. §7(The Owner can give your role this permission.)");
  }
  return false;
}
/** Owner only: allow (true) / block (false) one permission for one role.  Same as the default = the entry is removed. */
export function setRolePerm(actor, role, perm, value) {
  try {
    if (!isOwner(actor)) return { err: "Only the Owner can do this." };
    if (!PERM_ROLES.includes(role) || !PERM_MIN[perm]) return { err: "Unknown role or permission." };
    const m = permStore.get(); if (!m) return { err: "Could not read the permissions." };
    const had = m[role]?.[perm];
    m[role] ??= {};
    if (value === defaultAllows(role, perm)) delete m[role][perm]; else m[role][perm] = !!value;
    if (!Object.keys(m[role]).length) delete m[role];
    if (!permStore.save()) { m[role] ??= {}; if (had === undefined) delete m[role][perm]; else m[role][perm] = had; return { err: "Could not save." }; }
    slog(actor, "permset", null, ROLE_NAME[role] + ": " + perm + " " + (value ? "allowed" : "blocked"));
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** Owner only: back to the default permissions of one role */
export function resetRolePerms(actor, role) {
  try {
    if (!isOwner(actor)) return { err: "Only the Owner can do this." };
    const m = permStore.get(); if (!m) return { err: "Could not read the permissions." };
    if (!PERM_ROLES.includes(role)) return { err: "Unknown role." };
    delete m[role];
    if (!permStore.save()) return { err: "Could not save." };
    slog(actor, "permset", null, ROLE_NAME[role] + ": back to default");
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** the permissions in display order: [key, label, what it does] */
export const PERM_INFO = [
  ["goto", "Go to a player", "Teleport to a player"], ["tphere", "Bring a player", "Teleport a player to you (TP here)"], ["tpall", "Bring everybody", "Teleport every player to you"],
  ["mute", "Mute / Unmute", "Stop a player from chatting"], ["kick", "Kick", "Remove a player from the server"], ["warn", "Warnings", "Give a warning"], ["unwarn", "Remove warnings", "Delete a warning"],
  ["notes", "Notes", "Private notes about players"], ["reports", "Reports", "Read and close /report"], ["inspect", "Inspector", "Everything about one player"], ["alerts", "Alerts", "The operator alert inbox"], ["staffchat", "Staff chat", "Chat only operators see"],
  ["freeze", "Freeze players", "Stop a player moving / building"], ["tempban", "Temporary ban", "Ban a player for some time"], ["permban", "Permanent ban", "Ban a player for ever"], ["unban", "Unban", "Remove a ban"], ["bans", "Ban list", "See all bans"],
  ["logs", "Logs", "Server logs"], ["stafflog", "Staff actions", "What every operator did"], ["broadcast", "Broadcast", "Announcement for everybody"], ["lands", "All lands", "See and manage every land"],
  ["inventory", "Inventories", "See what a player carries"], ["handle", "Handle", "Handle player data"], ["perf", "Performance", "Entities and lag spots"], ["vanish", "Vanish", "Invisible mode"], ["lock", "Area locks", "Close an area"], ["clearlag", "Clear lag", "Remove dropped items"],
  ["money", "Money", "Give / reset money"], ["shards", "Shards", "Give shards"], ["levels", "Levels", "Give levels"], ["giveitem", "Give items", "Give an item"], ["econ", "Freeze money", "Freeze a money account"], ["restore", "Restore inventory", "Give back a death inventory"], ["takeitem", "Take from inventories", "Take items / levels from a member"],
  ["events", "Events & zones", "Create events with temporary rules (Keep Inventory, no PvP, time...)"],
  ["bypass", "Protection bypass", "Build inside any land"], ["landlimit", "Land limits", "Set how many protections each player may own"], ["spawn", "Set spawn", "Change the spawn point"], ["boards", "Leaderboards", "Place ranking boards"],
  ["spectate", "Spectator", "Fly through blocks"], ["orevision", "Ore vision", "See ores through blocks"], ["shop", "Shop control", "Change prices / items"], ["endgate", "End gate", "Open / close The End"], ["mobmoney", "Mob rewards", "Switch money for mob kills on / off"], ["back", "/back command", "Switch /back (return to where you died) on / off"], ["crates", "Crates", "Place / remove crates, give keys"], ["roles", "Staff roles", "Give / change staff roles"], ["hudname", "Scoreboard name", "Change the server name on the scoreboard (Owner by default)"], ["spawnerset", "Spawner settings", "Change kills per hour, storage and stack of spawners (Owner by default)"], ["afkset", "AFK area", "Set the AFK area and what players earn per minute"], ["duelset", "1 vs 1 Duel", "Turn the hourly 1 vs 1 duel on / off"], ["warps", "Warps", "Create and delete server warps (/setwarp, /deletewarp)"], ["tpbtn", "Teleport buttons", "Place / edit / remove teleport buttons (hologram name + coordinates)"],
];
export function listRoles() {
  const m = roleStore.get(); if (!m) return [];
  return Object.keys(m).map((id) => ({ id, n: m[id].n, r: m[id].r }));
}
export function setRole(actor, target, role) {
  try {
    if (!allow(actor, "roles")) return { err: "No permission." };
    if (!RANK[role]) return { err: "Unknown role." };
    if (!target || !target.id) return { err: "Player not found." };
    if (target.id === actor.id) return { err: "You can't change your own role." };
    if (isOwnerId(target.id)) return { err: "The Owner's role can't be changed." };
    const m = roleStore.get(); if (!m) return { err: "Could not read the roles." };
    const before = roleOfId(target.id);
    m[target.id] = { n: String(target.name).slice(0, 32), r: role };                 // always saved (also Admin): this is what makes a normal player staff
    if (!roleStore.save()) return { err: "Could not save the role." };
    slog(actor, "role", target, ROLE_NAME[before] + " > " + ROLE_NAME[role]);
    opAlert("§f" + actor.name + " §7set the role of §f" + target.name + " §7to " + ROLE_COLOR[role] + ROLE_NAME[role], { chat: false });
    const t = online(target.id); if (t) say(t, "§d[Staff] Your staff role is now " + ROLE_COLOR[role] + ROLE_NAME[role] + "§d. §7Open the menu: the §6Operator §7button is there now.");
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** takes the saved staff role away (a game operator stays operator, as Admin) */
export function removeStaff(actor, target) {
  try {
    if (!allow(actor, "roles")) return { err: "No permission." };
    if (!target || !target.id) return { err: "Player not found." };
    if (target.id === actor.id) return { err: "You can't change your own role." };
    if (isOwnerId(target.id)) return { err: "The Owner's role can't be changed." };
    const m = roleStore.get(); if (!m || !m[target.id]) return { err: "He has no saved staff role." };
    const before = m[target.id].r; delete m[target.id];
    if (!roleStore.save()) { m[target.id] = { n: String(target.name).slice(0, 32), r: before }; return { err: "Could not save." }; }
    slog(actor, "role", target, ROLE_NAME[before] + " > removed");
    opAlert("§f" + actor.name + " §7removed the staff role of §f" + target.name, { chat: false });
    const t = online(target.id); if (t) say(t, "§d[Staff] Your staff role was removed.");
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- staff-action log (newest first) + archive
export const ACTS = {
  mute: ["Muted", "§e", "pun"], unmute: ["Unmuted", "§a", "pun"], kick: ["Kicked", "§c", "pun"], warn: ["Warned", "§e", "pun"], unwarn: ["Removed a warning of", "§a", "pun"],
  note: ["Added a note on", "§b", "pun"], unnote: ["Deleted a note of", "§7", "pun"], freeze: ["Froze", "§b", "pun"], unfreeze: ["Unfroze", "§a", "pun"],
  ban: ["Banned", "§c", "pun"], unban: ["Unbanned", "§a", "pun"], report: ["Closed a report on", "§d", "pun"],
  efreeze: ["Froze the money of", "§6", "money"], eunfreeze: ["Unfroze the money of", "§a", "money"],
  money: ["Gave money to", "§a", "money"], mreset: ["Reset the money of", "§c", "money"], shards: ["Gave shards to", "§d", "money"], levels: ["Gave levels to", "§d", "money"],
  item: ["Gave an item to", "§b", "money"], restore: ["Restored the last inventory of", "§6", "money"], price: ["Changed a shop price", "§6", "money"], block: ["Changed shop availability", "§6", "money"],
  bypass: ["Protection bypass", "§6", "access"], goto: ["Teleported to", "§7", "access"], tphere: ["Teleported here", "§7", "access"], inv: ["Opened the inventory of", "§7", "access"], take: ["Took from the inventory of", "§c", "money"], vanish: ["Vanish", "§7", "access"], dellog: ["Deleted a log record", "§c", "sys"], minoff: ["Mining ability", "§6", "sys"],
  broadcast: ["Broadcast", "§e", "sys"], crown: ["Edited a crown", "§6", "sys"], board: ["Edited the leaderboards:", "§6", "sys"], clearlag: ["Cleared the dropped items", "§7", "sys"], lock: ["Locked an area", "§c", "sys"], unlock: ["Unlocked an area", "§a", "sys"],
  landlimit: ["Land limit", "§a", "sys"], spectate: ["Spectator mode", "§b", "access"], orevision: ["Ore vision", "§b", "access"], spawn: ["Spawn point", "§a", "sys"], endgate: ["End gate", "§5", "sys"], crelock: ["Creative block", "§c", "access"], hudname: ["Scoreboard name", "§6", "sys"], spawnerset: ["Spawner settings", "§6", "sys"], afkset: ["AFK area", "§6", "sys"], mobmoney: ["Mob rewards", "§6", "sys"], back: ["/back command", "§6", "sys"], bundle: ["Bundle removed from", "§c", "sys"], duelset: ["1 vs 1 duel", "§c", "sys"], crates: ["Crates", "§b", "sys"], warps: ["Warps", "§b", "sys"], tpbtn: ["Teleport buttons", "§d", "sys"], role: ["Changed the staff role of", "§d", "sys"], permset: ["Role permissions", "§5", "sys"],
};
export const ACT_GROUPS = [["all", "All"], ["pun", "Punishments"], ["money", "Money & items"], ["access", "Access"], ["sys", "System"]];
const logStore = makeStore("stf:log", () => ({ l: [] }));
const archStore = makeStore("stf:arch", () => ({ l: [] }));
const LOG_MAX = 24000;
let archWarned = false;
function archive(old) {
  if (!old.length) return;
  const a = archStore.get(); if (!a) return;
  a.l = [...old, ...a.l].sort((x, y) => y.t - x.t);
  let n = JSON.stringify(a).length;
  while (n > LOG_MAX && a.l.length > 1) { a.l.length = Math.floor(a.l.length * 0.9); n = JSON.stringify(a).length; }       // only the OLDEST archived entries are dropped
  archStore.save();
  if (n > LOG_MAX * 0.9) {
    if (!archWarned) { archWarned = true; opAlert("§e[Staff log] The archive is almost full - the oldest archived entries will start to be deleted soon.", { chat: true }); }
  } else if (n < LOG_MAX * 0.75) archWarned = false;
}
/** records what an operator did.  target = { id, name } or null */
export function slog(actor, action, target, detail) {
  try {
    const st = logStore.get(); if (!st) return;
    const e = { t: Date.now(), by: actor ? String(actor.name).slice(0, 32) : "system", bi: actor ? String(actor.id) : "", a: String(action) };
    if (target) { e.p = String(target.name ?? "").slice(0, 32); e.pi = String(target.id ?? ""); }
    if (detail) e.d = clean(detail, 100);
    st.l.unshift(e);
    let moved = [];
    if (st.l.length > Math.max(20, C.logCap)) moved = st.l.splice(Math.max(20, C.logCap));
    let n = JSON.stringify(st).length;
    while (n > LOG_MAX && st.l.length > 20) { moved = moved.concat(st.l.splice(Math.floor(st.l.length * 0.85))); n = JSON.stringify(st).length; }
    logStore.save();
    archive(moved);
  } catch (err) { console.warn("[staff] log failed: " + err); }
}
export function logEntries(group = "all", archived = false) {
  const st = (archived ? archStore : logStore).get(); if (!st) return [];
  return group === "all" ? st.l : st.l.filter((e) => (ACTS[e.a]?.[2] ?? "sys") === group);
}
export const logCounts = () => ({ log: logStore.get()?.l.length ?? 0, archive: archStore.get()?.l.length ?? 0, cap: Math.max(20, C.logCap) });
export function logText(e) {
  const a = ACTS[e.a] ?? [e.a, "§7", "sys"];
  return a[1] + "§l" + e.by + " §r" + a[1] + a[0] + (e.p ? " §f" + e.p : "") + (e.d ? " §7- " + e.d : "");
}

// ---------------------------------------------------------------- timed punishments: mute / freeze / economy freeze  (id -> { n, u (until, 0 = until lifted), r, by, t })
const stores = { mute: makeStore("stf:mute", () => ({})), frz: makeStore("stf:frz", () => ({})), eco: makeStore("stf:eco", () => ({})) };
const MAX_PUN = 60;
function activeOf(kind, id) {
  const m = stores[kind].get(); if (!m) return null;
  const r = m[id]; if (!r) return null;
  if (r.u && r.u <= Date.now()) { delete m[id]; stores[kind].save(); return null; }
  return r;
}
function listOf(kind) {
  const m = stores[kind].get(); if (!m) return [];
  const now = Date.now(); let ch = false; const out = [];
  for (const id of Object.keys(m)) { if (m[id].u && m[id].u <= now) { delete m[id]; ch = true; continue; } out.push({ id, ...m[id] }); }
  if (ch) stores[kind].save();
  return out;
}
export const muteOf = (id) => activeOf("mute", id), freezeOf = (id) => activeOf("frz", id), econOf = (id) => activeOf("eco", id);
export const listMutes = () => listOf("mute"), listFreezes = () => listOf("frz"), listEcon = () => listOf("eco");

function checkTarget(actor, target) {
  if (!target || !target.id) return "Player not found.";
  if (target.id === actor.id) return "You can't do that to yourself.";
  if (isOwnerId(target.id)) return "You can't do that to the Owner.";
  const on = online(target.id);
  if (on && isStaff(on)) return "You can't do that to an operator.";
  return null;
}
const checkReason = (r) => { const t = clean(r, 80); return t.length >= Math.max(1, C.reasonMin) ? t : null; };
const NEED_REASON = "A reason is required (at least " + Math.max(1, C.reasonMin) + " letters).";
const flags = new Map();                                            // player id -> { m, f, e }: what was active at the last check (to tell the player when it ends)

function setPun(kind, perm, act, actor, target, ms, reason, noteTxt) {
  try {
    if (!allow(actor, perm)) return { err: "No permission." };
    const bad = checkTarget(actor, target); if (bad) return { err: bad };
    const why = checkReason(reason); if (!why) return { err: NEED_REASON };
    const m = stores[kind].get(); if (!m) return { err: "Could not read the data." };
    if (!m[target.id] && Object.keys(m).length >= MAX_PUN) return { err: "Too many active entries. Lift some first." };
    m[target.id] = { n: String(target.name).slice(0, 32), u: ms > 0 ? Date.now() + ms : 0, r: why, by: String(actor.name).slice(0, 32), t: Date.now() };
    if (!stores[kind].save()) { delete m[target.id]; return { err: "Could not save (storage full)." }; }
    slog(actor, act, target, (ms > 0 ? leftText(Date.now() + ms) : "until lifted") + " - " + why);
    opAlert("§f" + actor.name + " §7" + noteTxt + " §f" + target.name + " §7- " + left(m[target.id].u) + " - " + why, { chat: false });
    return { ok: true, rec: m[target.id] };
  } catch (e) { return { err: "Something went wrong." }; }
}
function liftPun(kind, perm, act, actor, target) {
  try {
    if (!allow(actor, perm)) return { err: "No permission." };
    const m = stores[kind].get(); if (!m || !m[target.id]) return { err: "Nothing to lift." };
    delete m[target.id];
    if (!stores[kind].save()) return { err: "Could not save." };
    const f = flags.get(target.id); if (f) f[kind === "mute" ? "m" : kind === "frz" ? "f" : "e"] = false;
    slog(actor, act, target);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---- mute
export function mute(actor, target, ms, reason) {
  const r = setPun("mute", "mute", "mute", actor, target, ms, reason, "muted");
  if (r.ok && !chatGuard.active) say(actor, "§e[Mute] Saved, but this game version does not give the pack the chat event, so the message can not be blocked. Turn on §fBeta APIs §ein the world settings (see the content log: [staff] mute hook).");
  if (r.ok) { const t0 = online(target.id); if (t0) abilityMute(t0, true); }
  if (r.ok) { const t = online(target.id); if (t) say(t, "§c[Mute] You were muted by the staff. Reason: §f" + r.rec.r + " §7(" + left(r.rec.u) + ")"); }
  return r;
}
export function unmute(actor, target) {
  const r = liftPun("mute", "mute", "unmute", actor, target);
  if (r.ok) { const t = online(target.id); if (t) { abilityMute(t, false); say(t, "§a[Mute] You can chat again."); } }
  return r;
}
/** text for a muted player (null = not muted).  Used by the chat hook below and by the clan chat. */
export function mutedText(p) {
  try { const r = activeOf("mute", p.id); return r ? "§c[Mute] You are muted. Reason: §f" + r.r + " §7(" + left(r.u) + ")" : null; } catch (e) { return null; }
}
const noticeAt = new Map();
/** active = the chat hook is running (scripts can stop a muted player's message).  If it is false the game version / settings do not give the pack the chat event. */
export const chatGuard = { active: false };
try {
  const ev = world.beforeEvents.chatSend;
  if (!ev || typeof ev.subscribe !== "function") throw new Error("chatSend is not available in this API version (it needs the Beta APIs)");
  ev.subscribe((e) => {
    try {
      const s = e.sender, txt = mutedText(s);
      if (!txt) return;
      e.cancel = true;
      const now = Date.now();
      if (now - (noticeAt.get(s.id) ?? 0) > 3000) { noticeAt.set(s.id, now); system.run(() => say(s, txt)); }
    } catch (err) { /* never block the chat because of an error here */ }
  });
  chatGuard.active = true;
} catch (e) { console.warn("[staff] mute hook not started: " + e); }

/** extra layer: the game's own /ability mute (only works when Education Edition features are on; silently ignored otherwise) */
function abilityMute(p, on) { try { p.runCommand("ability @s mute " + (on ? "true" : "false")); } catch (e) { /* not available */ } }
try {
  world.afterEvents.playerSpawn.subscribe(({ player }) => { system.runTimeout(() => { try { if (mutedText(player)) abilityMute(player, true); } catch (e) { /* ignore */ } }, 40); });
} catch (e) { /* ignore */ }

// ---- freeze (movement + building + hitting are stopped; the player stays frozen after a re-join until the time ends)
export function freeze(actor, target, ms, reason) {
  if (!(ms > 0)) return { err: "Choose a time." };
  const r = setPun("frz", "freeze", "freeze", actor, target, ms, reason, "froze");
  if (r.ok) { const t = online(target.id); if (t) { say(t, "§b[Freeze] You were frozen by the staff. Do NOT log out. Reason: §f" + r.rec.r + " §7(" + left(r.rec.u) + ")"); try { t.onScreenDisplay.setTitle("§b§lFROZEN", { subtitle: "§7Wait for the staff", fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 10 }); } catch (e) { /* ignore */ } } }
  return r;
}
export function unfreeze(actor, target) {
  const r = liftPun("frz", "freeze", "unfreeze", actor, target);
  if (r.ok) { anchors.delete(target.id); const t = online(target.id); if (t) { thaw(t); say(t, "§a[Freeze] You can move again."); } }
  return r;
}
const anchors = new Map();
function thaw(p) { try { p.removeEffect("slowness"); } catch (e) { /* ignore */ } }
let frzTick = 0;
system.runInterval(() => {
  try {
    frzTick++;
    const m = stores.frz.get(); if (!m) return;
    const ids = Object.keys(m);
    if (!ids.length) { if (anchors.size) anchors.clear(); return; }
    for (const id of ids) {
      const r = activeOf("frz", id), p = online(id);
      if (!r) { anchors.delete(id); if (p) { thaw(p); say(p, "§a[Freeze] You can move again."); } continue; }
      if (!p) continue;
      let a = anchors.get(id);
      if (!a || a.d !== p.dimension.id) { a = { x: p.location.x, z: p.location.z, d: p.dimension.id }; anchors.set(id, a); }
      const dx = p.location.x - a.x, dz = p.location.z - a.z;
      if (dx * dx + dz * dz > 0.5) { try { p.teleport({ x: a.x, y: p.location.y, z: a.z }, { dimension: p.dimension }); } catch (e) { /* ignore */ } }
      try { p.addEffect("slowness", 30, { amplifier: 255, showParticles: false }); } catch (e) { /* ignore */ }
      if (frzTick % 8 === 0) { try { p.onScreenDisplay.setActionBar("§b§lFROZEN §r§7- staff is checking you (" + left(r.u) + ")"); } catch (e) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}, 4);
const stopFrozen = (e) => { try { if (e.player && activeOf("frz", e.player.id)) e.cancel = true; } catch (err) { /* ignore */ } };
try { world.beforeEvents.playerBreakBlock?.subscribe(stopFrozen); } catch (e) { /* not available */ }
try { world.beforeEvents.playerPlaceBlock?.subscribe(stopFrozen); } catch (e) { /* not available */ }
try {
  world.beforeEvents.entityHurt?.subscribe((e) => {
    try { const a = e.damageSource?.damagingEntity; if (a && a.typeId === "minecraft:player" && activeOf("frz", a.id)) e.cancel = true; } catch (err) { /* ignore */ }
  });
} catch (e) { /* not available */ }
try { world.afterEvents.playerLeave.subscribe(({ playerId, playerName }) => { try { if (activeOf("frz", playerId)) opAlert("§c[Freeze] §f" + playerName + " §cleft the game while frozen.", { chat: true }); anchors.delete(playerId); flags.delete(playerId); noticeAt.delete(playerId); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }

// "your mute ended" / "your economy freeze ended" (a lift by an operator already told him)
system.runInterval(() => {
  try {
    for (const p of world.getAllPlayers()) {
      const now = { m: !!activeOf("mute", p.id), f: false, e: !!activeOf("eco", p.id) }, was = flags.get(p.id);
      if (was) {
        if (was.m && !now.m) say(p, "§a[Mute] Your mute ended. You can chat again.");
        if (was.e && !now.e) say(p, "§a[Economy] Your money account is active again.");
      }
      flags.set(p.id, now);
    }
  } catch (e) { /* ignore */ }
}, 40);

// ---- economy freeze: no buying, selling, paying, auction or orders (the guards are in economy.js, potions.js, pay.js, auction.js, orders.js ...)
export function econFreeze(actor, target, ms, reason) {
  const r = setPun("eco", "econ", "efreeze", actor, target, ms, reason, "froze the money of");
  if (r.ok) { const t = online(target.id); if (t) say(t, "§c[Economy] Your money account was frozen by the staff (" + left(r.rec.u) + "). Reason: §f" + r.rec.r); }
  return r;
}
export function econUnfreeze(actor, target) {
  const r = liftPun("eco", "econ", "eunfreeze", actor, target);
  if (r.ok) { const t = online(target.id); if (t) say(t, "§a[Economy] Your money account is active again."); }
  return r;
}
/** text to show a player whose account is frozen (null = he may trade).  Every trade entry point asks this BEFORE anything happens. */
export function econMsg(p) {
  try { const r = activeOf("eco", p.id); return r ? "§c[Economy] Your money account is frozen by the staff (" + left(r.u) + "). Reason: §f" + r.r : null; } catch (e) { return null; }
}

// ---------------------------------------------------------------- kick
export function kickPlayer(actor, target, reason) {
  try {
    if (!allow(actor, "kick")) return { err: "No permission." };
    const bad = checkTarget(actor, target); if (bad) return { err: bad };
    const why = checkReason(reason); if (!why) return { err: NEED_REASON };
    const t = online(target.id); if (!t) return { err: "He is offline." };
    const msg = "Kicked by the staff. Reason: " + why;
    let ok = false;
    try { world.getDimension("overworld").runCommand('kick "' + t.name + '" ' + msg); ok = true; }
    catch (e) { try { t.runCommand("kick @s " + msg); ok = true; } catch (e2) { ok = false; } }
    if (!ok) return { err: "The kick failed." };
    slog(actor, "kick", target, why);
    opAlert("§f" + actor.name + " §ckicked §f" + target.name + " §7- " + why, { chat: false });
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- warnings (one saved record per player: stf:w:<id>)
const PW = "stf:w:", PN = "stf:n:";
export function warnsOf(id) {
  const d = readOf(PW + id);
  if (!d || !Array.isArray(d.l)) return [];
  const cut = Date.now() - Math.max(1, C.warnDays) * DAY;
  return d.l.filter((w) => w.t > cut);
}
export function warn(actor, target, reason) {
  try {
    if (!allow(actor, "warn")) return { err: "No permission." };
    const bad = checkTarget(actor, target); if (bad) return { err: bad };
    const why = checkReason(reason); if (!why) return { err: NEED_REASON };
    const d = readOf(PW + target.id); if (d === undefined) return { err: "Could not read the data." };
    const rec = d && Array.isArray(d.l) ? d : { n: target.name, l: [] };
    rec.n = String(target.name).slice(0, 32);
    const cut = Date.now() - Math.max(1, C.warnDays) * DAY;
    rec.l = rec.l.filter((w) => w.t > cut);
    rec.l.push({ t: Date.now(), r: why, by: String(actor.name).slice(0, 32) });
    if (rec.l.length > 8) rec.l.splice(0, rec.l.length - 8);
    if (!writeOf(PW + target.id, rec)) return { err: "Could not save." };
    const n = rec.l.length, lim = Math.max(1, C.warnLimit);
    slog(actor, "warn", target, "#" + n + " - " + why);
    const t = online(target.id);
    if (t) { say(t, "§c[Warning " + n + "/" + lim + "] §fReason: " + why); try { t.onScreenDisplay.setTitle("§c§lWARNING " + n + "/" + lim, { subtitle: "§7" + why, fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 10 }); } catch (e) { /* ignore */ } }
    opAlert("§f" + actor.name + " §7warned §f" + target.name + " §e(" + n + "/" + lim + ") §7- " + why + (n >= lim ? " §c- limit reached: consider a temporary ban" : ""), { chat: n >= lim });
    return { ok: true, count: n, limit: lim };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function removeWarn(actor, target, index) {
  try {
    if (!allow(actor, "unwarn")) return { err: "No permission." };
    const d = readOf(PW + target.id); if (!d || !Array.isArray(d.l)) return { err: "No warnings." };
    const cut = Date.now() - Math.max(1, C.warnDays) * DAY;
    const live = d.l.filter((w) => w.t > cut), w = live[index]; if (!w) return { err: "That warning is gone." };
    d.l = d.l.filter((x) => x !== w && !(x.t === w.t && x.r === w.r));
    if (!writeOf(PW + target.id, d.l.length ? d : null)) return { err: "Could not save." };
    slog(actor, "unwarn", target, w.r);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
/** every player with active warnings: [{ id, n, count }] */
export function warnedPlayers() {
  const out = [], cut = Date.now() - Math.max(1, C.warnDays) * DAY;
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(PW)) continue;
      const d = readOf(k); if (!d || !Array.isArray(d.l)) continue;
      const c = d.l.filter((w) => w.t > cut).length;
      if (c) out.push({ id: k.slice(PW.length), n: d.n, count: c });
    }
  } catch (e) { /* ignore */ }
  return out.sort((a, b) => b.count - a.count || String(a.n).localeCompare(String(b.n)));
}

// ---------------------------------------------------------------- private notes (only operators see them)
export function notesOf(id) { const d = readOf(PN + id); return d && Array.isArray(d.l) ? d.l : []; }
export function addNote(actor, target, text) {
  try {
    if (!allow(actor, "notes")) return { err: "No permission." };
    if (!target || !target.id) return { err: "Player not found." };
    const x = clean(text, 120); if (x.length < 2) return { err: "Write the note." };
    const d = readOf(PN + target.id); if (d === undefined) return { err: "Could not read the data." };
    const rec = d && Array.isArray(d.l) ? d : { n: target.name, l: [] };
    rec.n = String(target.name).slice(0, 32);
    rec.l.push({ t: Date.now(), x, by: String(actor.name).slice(0, 32), bi: String(actor.id) });
    if (rec.l.length > 10) rec.l.splice(0, rec.l.length - 10);
    if (!writeOf(PN + target.id, rec)) return { err: "Could not save." };
    slog(actor, "note", target, x);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function removeNote(actor, target, index) {
  try {
    const d = readOf(PN + target.id); if (!d || !Array.isArray(d.l)) return { err: "No notes." };
    const n = d.l[index]; if (!n) return { err: "That note is gone." };
    if (!(can(actor, "unwarn") || n.bi === actor.id)) return { err: "Only an Admin or the author can delete a note." };
    d.l.splice(index, 1);
    if (!writeOf(PN + target.id, d.l.length ? d : null)) return { err: "Could not save." };
    slog(actor, "unnote", target, n.x);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
export function notedPlayers() {
  const out = [];
  try {
    for (const k of world.getDynamicPropertyIds()) {
      if (!k.startsWith(PN)) continue;
      const d = readOf(k); if (!d || !Array.isArray(d.l) || !d.l.length) continue;
      out.push({ id: k.slice(PN.length), n: d.n, count: d.l.length });
    }
  } catch (e) { /* ignore */ }
  return out.sort((a, b) => String(a.n).localeCompare(String(b.n)));
}

// ---------------------------------------------------------------- vanish state (the on/off switch and the page are in staffworld.js / staffmenu.js)
// While vanished an operator is: invisible, can't be hit by players or mobs, has no particles / world sounds around him (lux.js, cosmetics trail),
// and is left out of the player lists that normal players see (TPA, pay, duels).
export const vanishedIds = new Set();
export const isVanishedId = (id) => vanishedIds.has(id);
/** true when `q` is a vanished operator that `viewer` (a normal player) must not see in a list */
export const hiddenFrom = (viewer, q) => { try { return vanishedIds.has(q.id) && !isStaff(viewer); } catch (e) { return false; } };
/** true when a vanished operator is standing close to this spot (effects there are skipped, otherwise they would show where he is) */
export function nearVanished(dimId, loc, rh = 3.5, rv = 4) {
  try {
    if (!vanishedIds.size) return false;
    for (const id of vanishedIds) {
      const q = online(id); if (!q || q.dimension.id !== dimId) continue;
      const l = q.location;
      if (Math.abs(l.x - loc.x) <= rh && Math.abs(l.z - loc.z) <= rh && Math.abs(l.y - loc.y) <= rv) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}
try {
  world.beforeEvents.entityHurt?.subscribe((e) => {
    try { if (vanishedIds.size && e.hurtEntity && vanishedIds.has(e.hurtEntity.id) && e.damageSource?.damagingEntity) e.cancel = true; } catch (err) { /* ignore */ }   // nobody can hit him (no damage, no knockback)
  });
} catch (e) { /* not available */ }

// ---------------------------------------------------------------- tp here (force).  "Ask first" uses the normal /tphere request (tpa.js) from the menu.
export function tpHereForce(actor, target) {
  try {
    if (!allow(actor, "tphere")) return { err: "No permission." };
    const bad = checkTarget(actor, target); if (bad) return { err: bad };
    const t = online(target.id); if (!t) return { err: "He is offline." };
    let inDuel = false; try { inDuel = duelView.bar(t) != null; } catch (e) { inDuel = false; }
    if (inDuel) return { err: "He is in a duel round right now." };
    t.teleport({ x: actor.location.x, y: actor.location.y, z: actor.location.z }, { dimension: actor.dimension });
    say(t, "§d[Staff] You were teleported to §f" + actor.name + "§d.");
    slog(actor, "tphere", target);
    return { ok: true };
  } catch (e) { return { err: "The teleport failed (the area may not be loaded)." }; }
}

// ---------------------------------------------------------------- shop switches (read by economy.js before a purchase / sale; edited in staffworld.js)
export const shopStore = makeStore("stf:shop", () => ({ p: {}, b: {} }));
/** true while an operator switched the shop item off */
export function shopBlocked(id) { try { return !!shopStore.get()?.b?.[id]; } catch (e) { return false; } }

/** teleports every normal player (not operators, not players in a duel round) to the operator.  Returns { ok, moved, skipped } */
export function tpAllForce(actor) {
  try {
    if (!allow(actor, "tpall")) return { err: "No permission." };
    let moved = 0, skipped = 0;
    const to = { x: actor.location.x, y: actor.location.y, z: actor.location.z };
    for (const t of world.getAllPlayers()) {
      if (t.id === actor.id) continue;
      try {
        let inDuel = false; try { inDuel = duelView.bar(t) != null; } catch (e) { inDuel = false; }
        if (isStaff(t) || inDuel) { skipped++; continue; }
        t.teleport(to, { dimension: actor.dimension });
        say(t, "§d[Staff] You were teleported to §f" + actor.name + "§d.");
        moved++;
      } catch (e) { skipped++; }
    }
    slog(actor, "tphere", null, "all players: " + moved + " moved" + (skipped ? ", " + skipped + " skipped" : ""));
    return { ok: true, moved, skipped };
  } catch (e) { return { err: "The teleport failed (the area may not be loaded)." }; }
}

// ---------------------------------------------------------------- reports (/report)
const repStore = makeStore("stf:rep", () => ({ n: 0, l: [] }));
const repAt = new Map();
export function addReport(reporter, target, reason) {
  try {
    if (!target || !target.id) return { err: "Player not found." };
    if (target.id === reporter.id) return { err: "You can't report yourself." };
    const why = clean(reason, 80); if (why.length < 3) return { err: "Write a short reason (at least 3 letters)." };
    const now = Date.now(), wait = Math.max(0, (repAt.get(reporter.id) ?? 0) + C.reportCooldownSec * 1000 - now);
    if (wait > 0) return { err: "Please wait " + Math.ceil(wait / 1000) + "s before sending another report." };
    const st = repStore.get(); if (!st) return { err: "Reports are not ready, try again in a moment." };
    st.n = (st.n | 0) + 1;
    st.l.unshift({ i: st.n, t: now, ri: reporter.id, rn: String(reporter.name).slice(0, 32), ti: String(target.id), tn: String(target.name).slice(0, 32), r: why });
    if (st.l.length > Math.max(5, C.reportsCap)) st.l.length = Math.max(5, C.reportsCap);
    while (JSON.stringify(st).length > 24000 && st.l.length > 5) st.l.pop();
    if (!repStore.save()) return { err: "Could not send the report." };
    repAt.set(reporter.id, now);
    opAlert("§d[Report] §f" + reporter.name + " §7reported §f" + target.name + " §7- " + why + " §8(Operator > Reports)");
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
export const listReports = () => repStore.get()?.l ?? [];
export function closeReport(actor, seq) {
  try {
    if (!allow(actor, "handle")) return { err: "No permission." };
    const st = repStore.get(); if (!st) return { err: "Could not read the reports." };
    const i = st.l.findIndex((r) => r.i === seq); if (i < 0) return { err: "Already closed." };
    const [r] = st.l.splice(i, 1);
    if (!repStore.save()) { st.l.splice(i, 0, r); return { err: "Could not save." }; }
    slog(actor, "report", { id: r.ti, name: r.tn }, r.r);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}

// ---------------------------------------------------------------- last known position of every player (kept in memory, saved when he leaves)
const lastPos = new Map();
function snap(p) { try { const l = p.location; lastPos.set(p.id, { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z), d: p.dimension.id, t: Date.now() }); } catch (e) { /* ignore */ } }
system.runInterval(() => { try { for (const p of world.getAllPlayers()) snap(p); } catch (e) { /* ignore */ } }, 100);
try { world.beforeEvents.playerLeave?.subscribe(({ player }) => { try { snap(player); } catch (e) { /* ignore */ } }); } catch (e) { /* not available */ }
try {
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    try { const v = lastPos.get(playerId); if (v) { world.setDynamicProperty("stf:pos:" + playerId, JSON.stringify({ ...v, t: Date.now() })); } lastPos.delete(playerId); } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }
/** { x, y, z, d, t, online } or null */
export function positionOf(id) {
  const p = online(id);
  if (p) { try { const l = p.location; return { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z), d: p.dimension.id, t: Date.now(), online: true }; } catch (e) { /* fall through */ } }
  const d = readOf("stf:pos:" + id);
  return d && typeof d.x === "number" ? { ...d, online: false } : null;
}

// ---------------------------------------------------------------- broadcast + staff chat
let bcAt = 0;
export const BROADCAST_SECONDS = { min: 1, max: 30, def: 10 };      // how long the big title stays on the screen (the operator chooses, 30 s at most)
export function broadcast(actor, title, message, seconds) {
  try {
    if (!allow(actor, "broadcast")) return { err: "No permission." };
    const msg = clean(message, 160); if (msg.length < 2) return { err: "Write the message." };
    const ttl = clean(title, 30), now = Date.now();
    const t = String(seconds ?? "").trim(), secs = t === "" ? BROADCAST_SECONDS.def : /^\d{1,3}$/.test(t) ? Number(t) : NaN;
    if (!(secs >= BROADCAST_SECONDS.min && secs <= BROADCAST_SECONDS.max)) return { err: "The time on screen must be a whole number of seconds from 1 to 30." };
    if (now - bcAt < C.broadcastCooldownSec * 1000) return { err: "Wait a few seconds between broadcasts." };
    bcAt = now;
    world.sendMessage("§6§l[Announcement] §r§e" + msg);
    if (ttl) for (const p of world.getAllPlayers()) { try { p.onScreenDisplay.setTitle("§6§l" + ttl, { subtitle: "§e" + msg, fadeInDuration: 10, stayDuration: secs * 20, fadeOutDuration: 20 }); } catch (e) { /* ignore */ } }
    slog(actor, "broadcast", null, (ttl ? ttl + " (" + secs + " s): " : "") + msg);
    return { ok: true };
  } catch (e) { return { err: "Something went wrong." }; }
}
const scAt = new Map();
/** /sc <message>: only operators see it */
export function staffChat(p, raw) {
  try {
    if (!allow(p, "staffchat")) return;
    const msg = clean(raw, 200).replace(/\s+/g, " ");
    if (!msg) return say(p, "§7[Staff] Use: §f/sc <message>");
    const now = Date.now();
    if (now - (scAt.get(p.id) ?? 0) < 400) return;
    scAt.set(p.id, now);
    const line = "§8[§dStaff§8] " + ROLE_COLOR[roleOf(p)] + p.name + "§7: §f" + msg;
    for (const x of world.getAllPlayers()) if (isStaff(x)) say(x, line);
  } catch (e) { /* ignore */ }
}
