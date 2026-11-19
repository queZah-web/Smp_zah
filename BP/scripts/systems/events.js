// EVENTS & TEMPORARY ZONES (Operator > Events).  No menus here - the pages are in eventsmenu.js.
// An event = a name + a type + an area (a box, whole height) + rules + a time (start / length) + the participants.
//   status: "off" (not started)  |  "wait" (scheduled: starts by itself)  |  "on" (running: the rules work)
// While an event runs, its rules are enforced for the players inside its area:
//   Keep Inventory, no PvP, no damage, no building / breaking, no item dropping, no death, Adventure mode, no monsters,
//   a locked time / weather (these two are for the whole world, not only the area) and an automatic teleport to the event spot.
// Operators (isStaff) and players who are in a 1 vs 1 duel are NEVER touched by the rules.
//   EXCEPTION = the type "Owner zone": while it runs NOBODY except the Owner can do anything inside it (no building, breaking, opening, using, hitting, dropping) - staff and admins included -
//   and only the Owner can create, change, start, stop or delete such an event.
// When an event ends (or is stopped) everything that was changed (time / weather lock, game modes) is put back.
// Every public function checks the operator's permission "events" again and returns { ok: true, ... } or { err: "text" }; nothing here throws into the rest of the addon.
import { world, system, GameMode } from "@minecraft/server";
import { isStaff, opAlert } from "./opcore.js";
import { allow, slog, makeStore, cleanText, isOwner } from "./staffcore.js";
import { duelView } from "./duelstate.js";
import { menuMsg } from "./menulang.js";

export const EV = { maxEvents: 8, maxPlayers: 30, maxSide: 600, radii: [10, 25, 50, 100, 200], maxMin: 10080, nameMax: 24 };

// ---------------------------------------------------------------- types (a type only sets the first rules, the operator can change every rule after that)
export const TYPE_KEYS = ["safe", "arena", "contest", "general", "owner"];
export const TYPES = {
  safe: { name: "Safe zone", col: "§a", icon: "textures/ui/shop/ic_shield", info: "No fighting and no damage", rules: { nopvp: 1, nodmg: 1, nomobs: 1 } },
  arena: { name: "Battle arena", col: "§c", icon: "textures/items/diamond_sword", info: "PvP is allowed", rules: { keepinv: 1, nobuild: 1, nodrop: 1 } },
  contest: { name: "Contest zone", col: "§e", icon: "textures/ui/shop/ic_trophy", info: "Rules for the kind of contest", rules: { nopvp: 1, nobuild: 1, nodrop: 1, adventure: 1 } },
  general: { name: "General event zone", col: "§b", icon: "textures/items/map_filled", info: "The operator chooses every rule", rules: {} },
  owner: { name: "Owner zone", col: "§4", icon: "textures/ui/shop/ic_shield", info: "Only the Owner can do anything inside", rules: {} },
};
/** the types this person may choose (the Owner zone is for the Owner only) */
export const typeKeysFor = (p) => TYPE_KEYS.filter((k) => k !== "owner" || isOwner(p));
// ---- OWNER ZONE: nobody but the Owner can do anything inside, not even staff / admins.  Fail-closed: if the check breaks, the player is treated as locked.
const isOwnerZone = (e) => !!e && e.k === "owner";
const ownerLocked = (e, p) => { try { return isOwnerZone(e) && !isOwner(p); } catch (err) { return isOwnerZone(e); } };
/** the running Owner zone that holds this spot and locks this player (or null) */
function lockZone(p, x, z, d) {
  try { for (const e of activeNow()) if (isOwnerZone(e) && inBox(e, d, x, z) && ownerLocked(e, p)) return e; } catch (err) { /* ignore */ }
  return null;
}
// ---------------------------------------------------------------- the rules (k = key saved in the event, values = the choices of a rule that is not just ON / OFF)
export const RULES = [
  { k: "keepinv", name: "Keep Inventory", info: "Players keep their items\nafter dying in the area", icon: "textures/ui/shop/ic_chest" },
  { k: "nopvp", name: "No PvP", info: "Players can't hit each other", icon: "textures/items/diamond_sword" },
  { k: "nodmg", name: "No damage", info: "Nobody takes damage\ninside the area", icon: "textures/ui/shop/ic_shield" },
  { k: "nobuild", name: "No building / breaking", info: "Blocks can't be placed,\nbroken or burned", icon: "textures/items/iron_pickaxe" },
  { k: "nodrop", name: "No item dropping", info: "Players can't throw\nitems on the ground", icon: "textures/items/hopper" },
  { k: "nodeath", name: "No death", info: "Nobody can die inside\nthe area", icon: "textures/items/totem" },
  { k: "time", name: "Lock the time", info: "The time of the whole server\nstays on day or night", icon: "textures/items/clock_item", values: ["Off", "Day", "Night"] },
  { k: "weather", name: "Lock the weather", info: "The weather of the whole server\nstays as you choose", icon: "textures/items/bucket_water", values: ["Off", "Clear", "Rain", "Thunder"] },
  { k: "adventure", name: "Adventure mode", info: "Players inside are put in\nAdventure mode", icon: "textures/items/map_filled" },
  { k: "nomobs", name: "No monsters", info: "Monsters can't appear\nor stay in the area", icon: "textures/ui/shop/skull_zombie" },
  { k: "autotp", name: "Auto teleport", info: "The participants are teleported\nto the event spot when it starts", icon: "textures/items/ender_pearl" },
  { k: "restore", name: "Restore settings", info: "When the event ends everything\nreturns to normal by itself", icon: "textures/items/book_enchanted" },
];
const DEFAULT_R = { keepinv: 0, nopvp: 0, nodmg: 0, nobuild: 0, nodrop: 0, nodeath: 0, time: 0, weather: 0, adventure: 0, nomobs: 0, autotp: 0, restore: 1 };

// ---------------------------------------------------------------- saved data
const store = makeStore("evt:v1", () => ({ l: [] }), 30000);        // the events
const gmStore = makeStore("evt:gm", () => ({}), 8000);              // player id -> { m: game mode before Adventure, e: event id }
const gStore = makeStore("evt:g", () => ({ dc: null, wc: null, tl: [], wl: [] }), 4000);   // the world: what the time / weather lock changed (to put it back)
const dimShort = (id) => String(id ?? "").replace("minecraft:", "");
const list = () => { const s = store.get(); return s ? s.l : []; };
export const listEvents = () => list();
export const getEvent = (id) => list().find((e) => e.i === id) ?? null;
const activeNow = () => list().filter((e) => e.st === "on");
export const activeCount = () => activeNow().length;
export const waitingCount = () => list().filter((e) => e.st === "wait").length;
export const hasArea = (e) => !!e && !!e.d && e.x2 >= e.x1 && e.z2 >= e.z1 && (e.x2 - e.x1 + e.z2 - e.z1) > 0;
const inBox = (e, d, x, z) => e.d === d && x >= e.x1 && x < e.x2 + 1 && z >= e.z1 && z < e.z2 + 1;
const overlap = (a, b) => a.d === b.d && a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;
const online = (id) => { try { return world.getAllPlayers().find((x) => x.id === id) ?? null; } catch (e) { return null; } };
const alive = (p) => { try { return typeof p.isValid === "function" ? p.isValid() : !!p.isValid; } catch (e) { return false; } };
const inDuel = (p) => { try { return duelView.bar(p) != null; } catch (e) { return false; } };
/** true when the engine has the "before hurt" event (needed to stop a deadly hit: Keep Inventory, No death, and to stop PvP hits completely) */
export const beforeHurtOk = () => { try { return !!world.beforeEvents.entityHurt; } catch (e) { return false; } };

export function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m ? m + "m " + x + "s" : x + "s";
}
export function placeText(e) {
  if (!hasArea(e)) return "No area yet";
  return dimShort(e.d) + " " + Math.floor((e.x1 + e.x2) / 2) + ", " + Math.floor((e.z1 + e.z2) / 2) + " (" + (e.x2 - e.x1 + 1) + "x" + (e.z2 - e.z1 + 1) + ")";
}
/** the rules that are switched on, as short names */
export function ruleNames(e) {
  const out = [];
  for (const r of RULES) {
    if (r.k === "restore" || r.k === "autotp") continue;
    const v = e.r[r.k]; if (!v) continue;
    out.push(r.values ? r.name + ": " + r.values[v] : r.name);
  }
  return out;
}
/** { text, zone } for the status of an event */
export function statusOf(e) {
  if (e.st === "on") return { text: "§aRUNNING", zone: "g", line: "§aRunning" + (e.u ? " §7- ends in §f" + fmt(e.u - Date.now()) : " §7- until it is stopped") };
  if (e.st === "wait") return { text: "§eSCHEDULED", zone: "g", line: "§eStarts in §f" + fmt(e.s - Date.now()) };
  return { text: "§7NOT STARTED", zone: "c", line: "§7Not started" };
}

// ---------------------------------------------------------------- who is touched by the rules
function affects(e, p) {
  try {
    if (isStaff(p) || inDuel(p)) return false;
    return e.mode !== "list" || e.pl.some((x) => x.i === p.id);
  } catch (err) { return false; }
}
function zoneOf(p) {
  const act = activeNow(); if (!act.length) return null;
  const l = p.location, d = p.dimension.id;
  for (const e of act) if (inBox(e, d, l.x, l.z) && affects(e, p)) return e;
  return null;
}
const tell = (p, text) => { try { p.sendMessage(menuMsg(p, text)); } catch (e) { /* ignore */ } };
const tellInside = (e, text) => { for (const p of world.getAllPlayers()) { try { const l = p.location; if (inBox(e, p.dimension.id, l.x, l.z)) tell(p, text); } catch (err) { /* ignore */ } } };
const title = (p, big, small) => { try { p.onScreenDisplay.setTitle(menuMsg(p, big), { subtitle: small ? menuMsg(p, small) : "", fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15 }); } catch (e) { /* ignore */ } };
const attackerOf = (src) => {
  try {
    const a = src && src.damagingEntity; if (a && a.typeId === "minecraft:player") return a;
    const o = src && src.damagingProjectile && src.damagingProjectile.getComponent("minecraft:projectile") && src.damagingProjectile.getComponent("minecraft:projectile").owner;
    return o && o.typeId === "minecraft:player" ? o : null;
  } catch (e) { return null; }
};

// ---------------------------------------------------------------- the safe place of an event (event spot, or the middle of the area)
function spotOf(e, p) {
  if (e.sp) return { x: e.sp.x, y: e.sp.y, z: e.sp.z };
  try {
    const x = Math.floor((e.x1 + e.x2) / 2), z = Math.floor((e.z1 + e.z2) / 2);
    const t = world.getDimension(e.d).getTopmostBlock({ x, z });
    if (t) return { x: x + 0.5, y: t.y + 1, z: z + 0.5 };
  } catch (err) { /* chunk not loaded */ }
  const s = p ? lastSafe.get(p.id) : null;
  return s && s.d === e.d ? s : null;
}
const lastSafe = new Map();            // player id -> { x, y, z, d } the last good place inside an event area
function sendTo(p, e) {
  const s = spotOf(e, p); if (!s) return false;
  try { p.teleport({ x: s.x, y: s.y, z: s.z }, { dimension: world.getDimension(e.d) }); return true; } catch (err) { return false; }
}

// ---------------------------------------------------------------- world settings: game rules + time + weather
function grGet(names) { try { const gr = world.gameRules; for (const n of names) if (gr && typeof gr[n] === "boolean") return gr[n]; } catch (e) { /* ignore */ } return null; }
function grSet(names, cmd, v) {
  try { const gr = world.gameRules; for (const n of names) if (gr && typeof gr[n] === "boolean") { gr[n] = v; return true; } } catch (e) { /* try the command */ }
  try { world.getDimension("overworld").runCommand("gamerule " + cmd + " " + v); return true; } catch (e) { return false; }
}
const DC = ["doDayLightCycle", "doDaylightCycle"], WC = ["doWeatherCycle"];
const setTime = (n) => { try { world.setTimeOfDay(n); } catch (e) { try { world.getDimension("overworld").runCommand("time set " + n); } catch (err) { /* ignore */ } } };
const setWeather = (v) => { try { world.getDimension("overworld").runCommand("weather " + ["", "clear", "rain", "thunder"][v]); } catch (e) { /* ignore */ } };
const WEATHER_WORD = ["", "clear", "rain", "thunder"];

/** makes the time / weather lock of a running event match its rules; { err } when another running event already holds that lock */
function syncGlobal(e) {
  const g = gStore.get(); if (!g) return { err: "Could not read the world settings." };
  const others = activeNow().filter((o) => o.i !== e.i);
  const wantT = e.st === "on" && e.r.time > 0, wantW = e.st === "on" && e.r.weather > 0;
  if (wantT && others.some((o) => o.r.time > 0)) return { err: "Another running event already locks the time." };
  if (wantW && others.some((o) => o.r.weather > 0)) return { err: "Another running event already locks the weather." };
  const restore = e.r.restore !== 0;
  // time
  if (wantT) {
    if (g.dc === null) g.dc = grGet(DC) ?? true;
    if (!g.tl.includes(e.i)) g.tl.push(e.i);
    grSet(DC, "dodaylightcycle", false); setTime(e.r.time === 1 ? 6000 : 18000);
  } else if (g.tl.includes(e.i)) {
    g.tl = g.tl.filter((x) => x !== e.i);
    if (!g.tl.length) { if (restore && g.dc !== null) grSet(DC, "dodaylightcycle", g.dc); g.dc = null; }
  }
  // weather
  if (wantW) {
    if (g.wc === null) g.wc = grGet(WC) ?? true;
    if (!g.wl.includes(e.i)) g.wl.push(e.i);
    grSet(WC, "doweathercycle", false); setWeather(e.r.weather);
  } else if (g.wl.includes(e.i)) {
    g.wl = g.wl.filter((x) => x !== e.i);
    if (!g.wl.length) { if (restore && g.wc !== null) grSet(WC, "doweathercycle", g.wc); g.wc = null; }
  }
  gStore.save();
  return { ok: true };
}
/** every few seconds: keeps the locked time / weather (a bed, a command or a plugin can't change it), and cleans a lock whose event is gone */
function keepWorld(tick) {
  const g = gStore.get(); if (!g) return;
  const act = activeNow();
  let dirty = false;
  const t = act.find((e) => e.r.time > 0), w = act.find((e) => e.r.weather > 0);
  const stillT = g.tl.filter((id) => act.some((e) => e.i === id && e.r.time > 0)), stillW = g.wl.filter((id) => act.some((e) => e.i === id && e.r.weather > 0));
  if (stillT.length !== g.tl.length) { g.tl = stillT; dirty = true; if (!g.tl.length && g.dc !== null) { grSet(DC, "dodaylightcycle", g.dc); g.dc = null; } }
  if (stillW.length !== g.wl.length) { g.wl = stillW; dirty = true; if (!g.wl.length && g.wc !== null) { grSet(WC, "doweathercycle", g.wc); g.wc = null; } }
  if (dirty) gStore.save();
  if (t && g.tl.length) { grSet(DC, "dodaylightcycle", false); setTime(t.r.time === 1 ? 6000 : 18000); }
  if (w && g.wl.length && w.r.weather === 1 && tick % 6 === 0) setWeather(1);
}

// ---------------------------------------------------------------- game mode (Adventure) bookkeeping
const MODE = { survival: GameMode.Survival, creative: GameMode.Creative, adventure: GameMode.Adventure };
const modeOf = (p) => { try { return String(p.getGameMode()).toLowerCase(); } catch (e) { return "survival"; } };
function restoreMode(p, gm) {
  const ent = gm[p.id]; if (!ent) return;
  try { if (modeOf(p) === "adventure") p.setGameMode(MODE[ent.m] ?? GameMode.Survival); } catch (e) { /* ignore */ }
  delete gm[p.id]; gmStore.save();
}

// ---------------------------------------------------------------- the lifecycle: begin / finish
function begin(e, actor, how) {
  if (e.st === "on") return { err: "This event is already running." };
  if (!hasArea(e)) return { err: "Set the area of the event first." };
  for (const o of activeNow()) if (o.i !== e.i && overlap(o, e)) return { err: "The area overlaps the running event \"" + o.n + "\"." };
  const was = { st: e.st, s: e.s, u: e.u };
  e.st = "on"; e.s = 0; e.u = e.len > 0 ? Date.now() + e.len * 60000 : 0;
  const g = syncGlobal(e);
  if (g.err) { e.st = was.st; e.s = was.s; e.u = was.u; syncGlobal(e); return g; }
  if (!store.save()) { e.st = was.st; e.s = was.s; e.u = was.u; syncGlobal(e); return { err: "Could not save the event." }; }
  let moved = 0;
  if (e.r.autotp) moved = bring(e);
  for (const p of world.getAllPlayers()) { try { if (affects(e, p)) { const l = p.location; if (inBox(e, p.dimension.id, l.x, l.z)) title(p, "§a§l" + e.n, "§7The event started"); } } catch (err) { /* ignore */ } }
  slog(actor, "event", null, (how === "schedule" ? "started (scheduled) " : "started ") + e.n);
  try { opAlert("§f" + (actor ? actor.name : "The schedule") + " §astarted the event §f" + e.n + " §7(" + placeText(e) + ")", { chat: false }); } catch (err) { /* ignore */ }
  return { ok: true, moved };
}
function finish(e, actor, why) {
  const wasOn = e.st === "on";
  e.st = "off"; e.s = 0; e.u = 0;
  store.save();
  if (wasOn) {
    syncGlobal(e);                                                                   // e.st is "off" now: releases the time / weather lock (and puts it back when "restore" is on)
    const gm = gmStore.get();
    if (gm) for (const id of Object.keys(gm)) {
      if (gm[id].e !== e.i) continue;
      if (e.r.restore !== 0) { const p = online(id); if (p) restoreMode(p, gm); }    // offline players are put back when they join (tick below)
      else delete gm[id];
    }
    if (gm) gmStore.save();
    for (const [pid, eid] of [...inside]) {
      if (eid !== e.i) continue;
      inside.delete(pid); const p = online(pid);
      if (p) { tell(p, "§6[Event] §f" + e.n + " §6has ended."); title(p, "§6§l" + e.n, "§7The event ended"); }
    }
    slog(actor, "event", null, (why === "time" ? "ended (time is up) " : "stopped ") + e.n);
    try { opAlert("§f" + e.n + " §7" + (why === "time" ? "ended (the time is up)." : "was stopped by §f" + (actor ? actor.name : "the system") + "§7."), { chat: false }); } catch (err) { /* ignore */ }
  }
}
function bring(e) {
  let n = 0;
  for (const p of world.getAllPlayers()) {
    try { if (!affects(e, p) || (e.mode === "list" && !e.pl.some((x) => x.i === p.id))) continue; if (sendTo(p, e)) { n++; tell(p, "§a[Event] You were teleported to §e" + e.n); } } catch (err) { /* ignore */ }
  }
  return n;
}
/** the clock: starts scheduled events, ends events whose time is up (every 0.5 s) */
function schedule() {
  const now = Date.now();
  for (const e of list().slice()) {
    try {
      if (e.st === "wait" && e.s > 0 && now >= e.s) { const r = begin(e, null, "schedule"); if (r.err) { e.st = "off"; e.s = 0; store.save(); try { opAlert("§cThe event §f" + e.n + " §ccould not start: §7" + r.err, { chat: true }); } catch (err) { /* ignore */ } } }
      else if (e.st === "on" && e.u > 0 && now >= e.u) finish(e, null, "time");
    } catch (err) { console.warn("[events] schedule: " + err); }
  }
}

// ---------------------------------------------------------------- the rules at work
const lastDeny = new Map();
function deny(p, e, what) {
  system.run(() => {
    try { const now = Date.now(); if (now - (lastDeny.get(p.id) ?? 0) < 2000) return; lastDeny.set(p.id, now); tell(p, "§c[Event] You can't " + what + " here §7- §f" + e.n); } catch (err) { /* ignore */ }
  });
}
function buildZone(block, p) {                         // the running event with "no building" that holds this block (and touches this player)
  try {
    const d = p.dimension.id, l = block.location;
    for (const e of activeNow()) if (inBox(e, d, l.x, l.z) && ((e.r.nobuild && affects(e, p)) || ownerLocked(e, p))) return e;
  } catch (err) { /* ignore */ }
  return null;
}
try { world.beforeEvents.playerBreakBlock.subscribe((ev) => { try { const e = buildZone(ev.block, ev.player); if (e) { ev.cancel = true; deny(ev.player, e, "break blocks"); } } catch (err) { /* ignore */ } }); } catch (e) { console.warn("[events] break: " + e); }
try { const pb = world.beforeEvents.playerPlaceBlock; if (pb) pb.subscribe((ev) => { try { const e = buildZone(ev.block, ev.player); if (e) { ev.cancel = true; deny(ev.player, e, "place blocks"); } } catch (err) { /* ignore */ } }); } catch (e) { console.warn("[events] place: " + e); }
// buckets, fire, bone meal, hoes / shovels / axes change blocks without "placing" them
const TOOLY = /(_bucket|^bucket|flint_and_steel|fire_charge|bone_meal|_hoe|_shovel|_axe)$/;
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      const id = ev.itemStack ? String(ev.itemStack.typeId).replace("minecraft:", "") : ""; if (!id || !TOOLY.test(id)) return;
      const e = buildZone(ev.block, ev.player); if (e) { ev.cancel = true; deny(ev.player, e, "change blocks"); }
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] interact: " + e); }
// Owner zone: opening chests / doors, buttons, spawn eggs, boats, armor stands, villagers, animals... nothing works for anybody but the Owner
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try { const l = ev.block.location, e = lockZone(ev.player, l.x, l.z, ev.player.dimension.id); if (e) { ev.cancel = true; deny(ev.player, e, "use anything"); } } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] owner interact: " + e); }
try {
  const ie = world.beforeEvents.playerInteractWithEntity;
  if (ie) ie.subscribe((ev) => {
    try { const l = ev.target.location, e = lockZone(ev.player, l.x, l.z, ev.player.dimension.id); if (e) { ev.cancel = true; deny(ev.player, e, "use anything"); } } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] owner entity: " + e); }
try {
  const eh = world.beforeEvents.entityHurt;
  if (eh) eh.subscribe((h) => {                                       // hitting anything (player, animal, item frame...) from inside / into the zone
    try {
      const a = attackerOf(h.damageSource); if (!a) return;
      const v = h.hurtEntity, la = a.location, lv = v ? v.location : la, d = a.dimension.id;
      if (lockZone(a, la.x, la.z, d) || lockZone(a, lv.x, lv.z, d)) h.cancel = true;
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] owner hit: " + e); }
// explosions never destroy blocks inside a "no building" area
try {
  const ex = world.beforeEvents.explosion;
  if (ex) ex.subscribe((ev) => {
    try {
      const zs = activeNow().filter((e) => e.r.nobuild || isOwnerZone(e)); if (!zs.length) return;
      const d = ev.dimension.id, blocks = ev.getImpactedBlocks(), keep = blocks.filter((b) => !zs.some((e) => inBox(e, d, b.location.x, b.location.z)));
      if (keep.length !== blocks.length) ev.setImpactedBlocks(keep);
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] explosion: " + e); }

// ---- damage: no damage / no PvP / no death / Keep Inventory
const BAD = /^(poison|wither|slowness|weakness|nausea|blindness|hunger|mining_fatigue|levitation|darkness|fatal_poison|infested|oozing|weaving|wind_charged)$/;
function rescue(pid, eid, kind, by) {
  const p = online(pid), e = getEvent(eid); if (!p || !e || e.st !== "on" || !alive(p)) return;
  try { const h = p.getComponent("minecraft:health"); if (h) h.setCurrentValue(h.effectiveMax); } catch (err) { /* ignore */ }
  try { p.extinguishFire(); } catch (err) { /* ignore */ }
  try { for (const ef of p.getEffects()) if (BAD.test(String(ef.typeId).replace("minecraft:", ""))) p.removeEffect(ef.typeId); } catch (err) { /* ignore */ }
  try { p.addEffect("resistance", 60, { amplifier: 4, showParticles: false }); } catch (err) { /* ignore */ }
  if (kind === "out") {
    sendTo(p, e);
    title(p, "§c§lKnocked out", "§7Your items are safe");
    tellInside(e, "§e[Event] §f" + p.name + " §7was knocked out" + (by ? " by §f" + by : "") + ".");
  }
}
try {
  const ev = world.beforeEvents.entityHurt;
  if (ev) ev.subscribe((h) => {
    try {
      const v = h.hurtEntity; if (!v || v.typeId !== "minecraft:player") return;
      const e = zoneOf(v); if (!e) return;
      const r = e.r, a = attackerOf(h.damageSource);
      if (r.nodmg) { h.cancel = true; return; }
      if (r.nopvp && a && a.id !== v.id) { h.cancel = true; return; }
      if (!r.nodeath && !r.keepinv) return;
      const hp = v.getComponent("minecraft:health"); if (!hp || h.damage < hp.currentValue) return;      // only a deadly hit
      h.cancel = true;
      const id = v.id, eid = e.i, kind = r.nodeath ? "protect" : "out", by = a ? a.name : null;
      system.run(() => rescue(id, eid, kind, by));
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] hurt (before): " + e); }
try {
  world.afterEvents.entityHurt.subscribe((h) => {                          // backup when the game has no "before" event: give the health back (a deadly hit can't be stopped this way)
    try {
      if (beforeHurtOk()) return;
      const v = h.hurtEntity; if (!v || v.typeId !== "minecraft:player") return;
      const e = zoneOf(v); if (!e) return;
      const a = attackerOf(h.damageSource);
      if (!(e.r.nodmg || (e.r.nopvp && a && a.id !== v.id))) return;
      const hp = v.getComponent("minecraft:health"); if (hp && hp.currentValue > 0) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + h.damage));
    } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] hurt (after): " + e); }

// ---- no item dropping (a thrown item appears at the player's eye height, right next to him: it goes back into his inventory)
function fits(cont, st) {
  try {
    if (cont.emptySlotsCount > 0) return true;
    let room = 0;
    for (let i = 0; i < cont.size; i++) { const s = cont.getItem(i); if (s && s.isStackableWith(st)) room += s.maxAmount - s.amount; }
    return room >= st.amount;
  } catch (e) { return false; }
}
function dropGuard(item) {
  const zs = activeNow().filter((e) => e.r.nodrop || isOwnerZone(e)); if (!zs.length) return;
  const l = item.location, d = item.dimension.id, e = zs.find((z) => inBox(z, d, l.x, l.z)); if (!e) return;
  let best = null, bd = 99;
  for (const p of item.dimension.getPlayers({ location: l, maxDistance: 2 })) {
    try {
      const pl = p.location, dy = l.y - pl.y, dx = Math.hypot(l.x - pl.x, l.z - pl.z);
      if (dy < 0.7 || dy > 2.1 || dx > 1.8 || !((e.r.nodrop && affects(e, p)) || ownerLocked(e, p)) || dx >= bd) continue;
      best = p; bd = dx;
    } catch (err) { /* ignore */ }
  }
  if (!best) return;
  const st = item.getComponent("minecraft:item")?.itemStack; if (!st) return;
  const cont = best.getComponent("minecraft:inventory")?.container; if (!cont || !fits(cont, st)) return;      // no room: the item just drops
  const rest = cont.addItem(st);
  if (!rest) { item.remove(); deny(best, e, "drop items"); }
}
// ---- no monsters
const mobOk = (m) => { try { return !String(m.typeId).startsWith("smp:") && !m.nameTag && m.typeId !== "minecraft:player"; } catch (e) { return false; } };
function mobGuard(m) {
  const zs = activeNow().filter((e) => e.r.nomobs); if (!zs.length || !mobOk(m)) return;
  const l = m.location, d = m.dimension.id;
  if (!zs.some((e) => inBox(e, d, l.x, l.z))) return;
  if (m.matches({ families: ["monster"] })) m.remove();
}
try {
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try { if (!entity || !alive(entity)) return; if (entity.typeId === "minecraft:item") dropGuard(entity); else mobGuard(entity); } catch (err) { /* ignore */ }
  });
} catch (e) { console.warn("[events] spawn: " + e); }
function sweepMobs() {
  for (const e of activeNow()) {
    if (!e.r.nomobs) continue;
    try {
      const mobs = world.getDimension(e.d).getEntities({ families: ["monster"], location: { x: e.x1, y: -64, z: e.z1 }, volume: { x: e.x2 - e.x1 + 1, y: 400, z: e.z2 - e.z1 + 1 } });
      for (const m of mobs) { if (mobOk(m)) { try { m.remove(); } catch (err) { /* ignore */ } } }
    } catch (err) { /* area not loaded */ }
  }
}

// ---- the player loop (0.5 s): entering / leaving, Adventure mode, the no-damage shield, falling out of the world
const inside = new Map();             // player id -> event id he stands in (only for the messages)
function tickPlayer(p, act, gm) {
  const z = act.length ? zoneOf(p) : null, was = inside.get(p.id) ?? null, now = z ? z.i : null;
  if (was !== now) {
    if (now) inside.set(p.id, now); else inside.delete(p.id);
    if (was) { const o = getEvent(was); if (o && o.st === "on") tell(p, "§7[Event] You left §f" + o.n); }
    if (z) { const rn = ruleNames(z); tell(p, "§a[Event] You are in §e" + z.n + (rn.length ? "\n§7Rules: §f" + rn.join("§7, §f") : "")); }
  }
  if (z) {
    const l = p.location, low = p.dimension.id === "minecraft:overworld" ? -62 : -2;
    if (l.y >= low + 6) lastSafe.set(p.id, { x: l.x, y: l.y, z: l.z, d: p.dimension.id });
    if (z.r.nodmg) { try { p.addEffect("resistance", 40, { amplifier: 4, showParticles: false }); } catch (err) { /* ignore */ } }
    if (l.y < low && (z.r.nodmg || z.r.nodeath || z.r.keepinv)) {                      // the world has no floor here: back to a safe place before the void kills
      const s = z.sp ?? lastSafe.get(p.id);
      if (s) { try { p.teleport({ x: s.x, y: s.y, z: s.z }, { dimension: world.getDimension(z.d) }); } catch (err) { /* ignore */ } }
    }
    if (z.r.adventure) {
      const cur = modeOf(p);
      if (cur !== "adventure" && cur !== "spectator") {
        if (!gm[p.id]) { gm[p.id] = { m: cur, e: z.i }; gmStore.save(); }
        try { p.setGameMode(GameMode.Adventure); } catch (err) { /* ignore */ }
      } else if (gm[p.id]) gm[p.id].e = z.i;
    }
  }
  const ent = gm[p.id];
  if (ent && !(z && z.r.adventure && z.i === ent.e)) restoreMode(p, gm);
}
system.runInterval(() => {
  try {
    schedule();
    const act = activeNow(), gm = gmStore.get(); if (!gm) return;
    for (const p of world.getAllPlayers()) { try { tickPlayer(p, act, gm); } catch (err) { /* ignore this player */ } }
  } catch (err) { console.warn("[events] loop: " + err); }
}, 10);
let slow = 0;
system.runInterval(() => {
  slow++;
  try { sweepMobs(); if (slow % 5 === 0) keepWorld(slow); } catch (err) { console.warn("[events] slow loop: " + err); }
}, 20);
try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { inside.delete(playerId); lastSafe.delete(playerId); lastDeny.delete(playerId); }); } catch (e) { /* ignore */ }

// ================================================================ the operator's actions (menus call these)
const need = (actor) => (allow(actor, "events") ? null : { err: "No permission." });
function pick(actor, id) {
  const bad = need(actor); if (bad) return { bad };
  const e = getEvent(id); if (!e) return { bad: { err: "That event does not exist any more." } };
  if (ownerLocked(e, actor)) return { bad: { err: "Only the Owner can change an Owner zone." } };
  return { e };
}
const saveOr = (e, undo, msg = "Could not save the event.") => { if (store.save()) return null; try { undo(); } catch (err) { /* ignore */ } return { err: msg }; };

export function createEvent(actor, name, type) {
  try {
    const bad = need(actor); if (bad) return bad;
    const n = cleanText(name, EV.nameMax); if (n.length < 2) return { err: "Write a name (at least 2 letters)." };
    const st = store.get(); if (!st) return { err: "Could not read the events." };
    if (st.l.length >= EV.maxEvents) return { err: "There are already " + EV.maxEvents + " events. Delete one first." };
    if (st.l.some((x) => x.n.toLowerCase() === n.toLowerCase())) return { err: "An event with this name already exists." };
    const k = TYPES[type] ? type : "general";
    if (k === "owner" && !isOwner(actor)) return { err: "Only the Owner can make an Owner zone." };
    const e = { i: Date.now().toString(36), n, k, d: null, x1: 0, x2: 0, z1: 0, z2: 0, sp: null, c1: null, c2: null, r: { ...DEFAULT_R, ...TYPES[k].rules }, st: "off", s: 0, len: 0, u: 0, mode: "all", pl: [], by: String(actor.name).slice(0, 32), t: Date.now() };
    st.l.push(e);
    const f = saveOr(e, () => st.l.pop(), "Could not save the event."); if (f) return f;
    slog(actor, "event", null, "created " + n + " (" + TYPES[k].name + ")");
    return { ok: true, event: e };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function deleteEvent(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st !== "off") finish(e, actor, "stop");
    const st = store.get(), i = st.l.indexOf(e); if (i < 0) return { err: "Already deleted." };
    st.l.splice(i, 1);
    const f = saveOr(e, () => st.l.splice(i, 0, e), "Could not save."); if (f) return f;
    slog(actor, "event", null, "deleted " + e.n);
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function renameEvent(actor, id, name) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const n = cleanText(name, EV.nameMax); if (n.length < 2) return { err: "Write a name (at least 2 letters)." };
    if (list().some((x) => x.i !== e.i && x.n.toLowerCase() === n.toLowerCase())) return { err: "An event with this name already exists." };
    const old = e.n; e.n = n;
    const f = saveOr(e, () => { e.n = old; }); if (f) return f;
    slog(actor, "event", null, "renamed " + old + " to " + n);
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
/** changes the type and sets the rules of that type again (the operator can change them after that) */
export function changeType(actor, id, type) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (!TYPES[type]) return { err: "Choose a type from the list." };
    if (type === "owner" && !isOwner(actor)) return { err: "Only the Owner can make an Owner zone." };
    if (e.st === "on") return { err: "Stop the event first." };
    const old = { k: e.k, r: e.r }; e.k = type; e.r = { ...DEFAULT_R, ...TYPES[type].rules, restore: old.r.restore, autotp: old.r.autotp };
    const f = saveOr(e, () => { e.k = old.k; e.r = old.r; }); if (f) return f;
    slog(actor, "event", null, e.n + " type: " + TYPES[type].name);
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function setRule(actor, id, key, val) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const def = RULES.find((r) => r.k === key); if (!def) return { err: "Unknown rule." };
    const max = def.values ? def.values.length - 1 : 1, v = Math.max(0, Math.min(max, Math.floor(Number(val)) || 0)), old = e.r[key];
    e.r[key] = v;
    if (e.st === "on") { const g = syncGlobal(e); if (g.err) { e.r[key] = old; syncGlobal(e); return g; } }
    const f = saveOr(e, () => { e.r[key] = old; if (e.st === "on") syncGlobal(e); }); if (f) return f;
    slog(actor, "event", null, e.n + " rule " + def.name + ": " + (def.values ? def.values[v] : v ? "on" : "off"));
    return { ok: true, value: v };
  } catch (err) { return { err: "Something went wrong." }; }
}

// ---- the area
function sideOk(x1, x2, z1, z2) { return x2 - x1 + 1 <= EV.maxSide && z2 - z1 + 1 <= EV.maxSide; }
function applyArea(e, d, x1, x2, z1, z2) {
  const old = { d: e.d, x1: e.x1, x2: e.x2, z1: e.z1, z2: e.z2 };
  e.d = d; e.x1 = x1; e.x2 = x2; e.z1 = z1; e.z2 = z2;
  const f = saveOr(e, () => Object.assign(e, old)); return f;
}
export function setAreaSquare(actor, id, radius) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st === "on") return { err: "Stop the event first." };
    if (!EV.radii.includes(radius)) return { err: "Choose a size from the list." };
    const l = actor.location, f = applyArea(e, actor.dimension.id, Math.floor(l.x - radius), Math.floor(l.x + radius), Math.floor(l.z - radius), Math.floor(l.z + radius)); if (f) return f;
    slog(actor, "event", null, e.n + " area: " + placeText(e));
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function setCorner(actor, id, which) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st === "on") return { err: "Stop the event first." };
    const l = actor.location, c = { x: Math.floor(l.x), z: Math.floor(l.z), d: actor.dimension.id }, key = which === 2 ? "c2" : "c1", old = e[key];
    e[key] = c;
    if (e.c1 && e.c2) {
      if (e.c1.d !== e.c2.d) { e[key] = old; return { err: "The two corners must be in the same world (dimension)." }; }
      const x1 = Math.min(e.c1.x, e.c2.x), x2 = Math.max(e.c1.x, e.c2.x), z1 = Math.min(e.c1.z, e.c2.z), z2 = Math.max(e.c1.z, e.c2.z);
      if (!sideOk(x1, x2, z1, z2)) { e[key] = old; return { err: "The area is too big (at most " + EV.maxSide + " x " + EV.maxSide + " blocks)." }; }
      const f = applyArea(e, e.c1.d, x1, x2, z1, z2); if (f) { e[key] = old; return f; }
      slog(actor, "event", null, e.n + " area: " + placeText(e));
      return { ok: true, done: true };
    }
    const f = saveOr(e, () => { e[key] = old; }); if (f) return f;
    return { ok: true, done: false };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function clearArea(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st !== "off") return { err: "Stop the event first." };
    const old = { d: e.d, x1: e.x1, x2: e.x2, z1: e.z1, z2: e.z2, c1: e.c1, c2: e.c2, sp: e.sp };
    e.d = null; e.x1 = e.x2 = e.z1 = e.z2 = 0; e.c1 = e.c2 = null; e.sp = null;
    const f = saveOr(e, () => Object.assign(e, old)); if (f) return f;
    slog(actor, "event", null, e.n + " area cleared");
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function setSpot(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (!hasArea(e)) return { err: "Set the area first." };
    const l = actor.location;
    if (actor.dimension.id !== e.d || !inBox(e, e.d, l.x, l.z)) return { err: "Stand inside the area of the event to set its spot." };
    const old = e.sp; e.sp = { x: Math.round(l.x * 2) / 2, y: Math.round(l.y * 2) / 2, z: Math.round(l.z * 2) / 2 };
    const f = saveOr(e, () => { e.sp = old; }); if (f) return f;
    slog(actor, "event", null, e.n + " spot: " + Math.floor(l.x) + ", " + Math.floor(l.y) + ", " + Math.floor(l.z));
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function gotoEvent(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (!hasArea(e)) return { err: "This event has no area yet." };
    if (!sendTo(actor, e)) return { err: "Could not find a safe place there (the area may not be loaded)." };
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}

// ---- time: "start in" minutes (0 = the operator starts it) and "lasts" minutes (0 = until it is stopped)
export function setDuration(actor, id, startIn, len) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const a = Math.floor(Number(startIn)), b = Math.floor(Number(len));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > EV.maxMin || b > EV.maxMin) return { err: "Use whole minutes from 0 to " + EV.maxMin + "." };
    const old = { st: e.st, s: e.s, len: e.len, u: e.u };
    if (a > 0) {
      if (e.st === "on") return { err: "The event is already running. Stop it first to schedule it again." };
      if (!hasArea(e)) return { err: "Set the area first." };
      e.st = "wait"; e.s = Date.now() + a * 60000;
    } else if (e.st === "wait") { e.st = "off"; e.s = 0; }
    e.len = b;
    if (e.st === "on") e.u = b > 0 ? Date.now() + b * 60000 : 0;                  // a running event: the length counts from now
    const f = saveOr(e, () => Object.assign(e, old)); if (f) return f;
    slog(actor, "event", null, e.n + " time: " + (a ? "starts in " + a + " min" : "manual start") + ", " + (b ? "lasts " + b + " min" : "until stopped"));
    return { ok: true, scheduled: a > 0 };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function startEvent(actor, id) {
  try { const p = pick(actor, id); if (p.bad) return p.bad; return begin(p.e, actor, "now"); } catch (err) { return { err: "Something went wrong." }; }
}
export function stopEvent(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st === "off") return { err: "This event is not running." };
    finish(e, actor, "stop"); return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function stopAll(actor) {
  try {
    const bad = need(actor); if (bad) return bad;
    let n = 0; for (const e of list().slice()) if (e.st !== "off" && !ownerLocked(e, actor)) { finish(e, actor, "stop"); n++; }
    return { ok: true, n };
  } catch (err) { return { err: "Something went wrong." }; }
}

// ---- participants
export function setMode(actor, id, mode) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const old = e.mode; e.mode = mode === "list" ? "list" : "all";
    const f = saveOr(e, () => { e.mode = old; }); if (f) return f;
    slog(actor, "event", null, e.n + " participants: " + (e.mode === "list" ? "only the list" : "everybody"));
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function addPlayer(actor, id, pid, name) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.pl.some((x) => x.i === pid)) return { err: "He is already in the list." };
    if (e.pl.length >= EV.maxPlayers) return { err: "The list is full (" + EV.maxPlayers + " players)." };
    e.pl.push({ i: String(pid), n: cleanText(name, 32) });
    const f = saveOr(e, () => e.pl.pop()); if (f) return f;
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function removePlayer(actor, id, pid) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const i = e.pl.findIndex((x) => x.i === pid); if (i < 0) return { err: "He is not in the list." };
    const [x] = e.pl.splice(i, 1);
    const f = saveOr(e, () => e.pl.splice(i, 0, x)); if (f) return f;
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function addOnline(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    let n = 0;
    for (const pl of world.getAllPlayers()) {
      if (e.pl.length >= EV.maxPlayers) break;
      if (e.pl.some((x) => x.i === pl.id) || isStaff(pl)) continue;
      e.pl.push({ i: pl.id, n: cleanText(pl.name, 32) }); n++;
    }
    if (n && !store.save()) return { err: "Could not save the event." };
    return { ok: true, n };
  } catch (err) { return { err: "Something went wrong." }; }
}
export function clearPlayers(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const old = e.pl; e.pl = [];
    const f = saveOr(e, () => { e.pl = old; }); if (f) return f;
    return { ok: true };
  } catch (err) { return { err: "Something went wrong." }; }
}
/** teleports the participants who are online to the event spot (the event must be running) */
export function bringParticipants(actor, id) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    if (e.st !== "on") return { err: "Start the event first." };
    if (!hasArea(e)) return { err: "This event has no area yet." };
    const n = bring(e);
    slog(actor, "event", null, e.n + " teleported " + n + " player" + (n === 1 ? "" : "s"));
    return { ok: true, n };
  } catch (err) { return { err: "Something went wrong." }; }
}

// ---- announce to everybody (chat + a title); the same event can be announced again after 15 seconds
const lastAnn = new Map();
export function announceEvent(actor, id, extra) {
  try {
    const p = pick(actor, id); if (p.bad) return p.bad; const e = p.e;
    const now = Date.now(); if (now - (lastAnn.get(e.i) ?? 0) < 15000) return { err: "Wait a few seconds before announcing the same event again." };
    lastAnn.set(e.i, now);
    const msg = cleanText(extra, 100), t = TYPES[e.k] ?? TYPES.general, when = e.st === "on" ? "§aRunning now" : e.st === "wait" ? "§eStarts in §f" + fmt(e.s - now) : "§7Soon";
    let n = 0;
    for (const pl of world.getAllPlayers()) {
      try {
        pl.sendMessage(menuMsg(pl, "§6§l[Event] §e" + e.n + " §7(" + t.name + ")\n§r§7When: " + when + (hasArea(e) ? "\n§r§7Where: §f" + placeText(e) : "") + (msg ? "\n§r§f" + msg : "")));
        title(pl, "§6§l" + e.n, "§7" + t.name + " - " + (e.st === "on" ? "running now" : e.st === "wait" ? "starts in " + fmt(e.s - now) : "soon"));
        n++;
      } catch (err) { /* ignore */ }
    }
    slog(actor, "event", null, "announced " + e.n);
    return { ok: true, n };
  } catch (err) { return { err: "Something went wrong." }; }
}
