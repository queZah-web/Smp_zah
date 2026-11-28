// ===================================================================================================================
// WATCHERS (مراقب)  -  Admin / Owner: /opr > Server & staff > Watchers      the watcher himself: /watch
//
// A Watcher is a player who may only WATCH: he chooses an online player and becomes a spectator next to him.
//   * he can't go farther than 40 blocks from that player (pulled back at once), can't follow anybody else, can't
//     teleport (/tpa, /home, /spawn ... are refused while he watches), and he has no other staff power at all
//     (he is NOT an operator / staff role: no /opr, no commands of the staff)
//   * "Stop watching" puts him back exactly where he was, in the game mode he had (also after a restart / if he left the
//     game while watching)
//   * optional (Admin / Owner): hide the coordinates of EVERYBODY while a watcher watches (Bedrock has ONE coordinates
//     switch for the whole world, it can't be hidden for one player only); it comes back when nobody watches
// Saved in the world ("watch:list") + on the player ("watch:st" = where he was).  No lag: one check every 5 ticks.
// ===================================================================================================================
import { world, system, GameMode, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { make, makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { roleOf, slog, hiddenFrom } from "./staffcore.js";
import { tpGuards } from "./util.js";
import { pick } from "./arextra.js";

const LIST = "watch:list", ST = "watch:st", HIDE = "watch:hidexyz", XYZ_WAS = "watch:xyzwas", RANGE = 40;
const tell = (p, en, ar) => { try { p.sendMessage(pick(p, en, ar)); } catch (e) { /* ignore */ } };
const readJson = (k, d) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { world.setDynamicProperty(k, v == null ? undefined : JSON.stringify(v)); } catch (e) { /* ignore */ } };
const staffBoss = (p) => { try { const r = roleOf(p); return r === "owner" || r === "admin"; } catch (e) { return false; } };
const online = (id) => world.getAllPlayers().find((p) => p.id === id);

// ---- who is a watcher { id: name }
const list = () => readJson(LIST, {});
export const isWatcher = (p) => !!p && !!list()[p.id];
export function setWatcher(actor, id, name, on) {
  if (!staffBoss(actor)) return { err: "Only the Admin or the Owner can change the watchers." };
  const l = list(); if (on) l[id] = name; else delete l[id];
  writeJson(LIST, l);
  try { slog(actor, "watch", { id, name }, on ? "made a watcher" : "not a watcher any more"); } catch (e) { /* ignore */ }
  const p = online(id);
  if (!on && p) stopWatch(p, true);
  if (p) tell(p, on ? "§b[Watch] You are a WATCHER now: §f/watch §bto watch a player." : "§7[Watch] You are not a watcher any more.", on ? "§b[مراقبة] صرت مراقب: §f/watch §bحتى تراقب لاعب." : "§7[مراقبة] ما بقيت مراقب.");
  return { ok: true };
}

// ---- watching: watcher id -> target id (+ the saved place on the player)
const watching = new Map();
const savedOf = (p) => { try { const v = p.getDynamicProperty(ST); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } };
export const isWatching = (p) => watching.has(p.id);
tpGuards.push((p) => (watching.has(p.id) ? pick(p, "§c[Watch] You can't teleport while you watch. Stop watching first (/watch).", "§c[مراقبة] ما تقدر تنتقل وانت تراقب. وقف المراقبة أول (/watch).") : null));

function startWatch(p, t) {
  if (!isWatcher(p) || !t || t.id === p.id) return;
  if (!savedOf(p)) {                                                        // where he was (only the first time: switching the target keeps it)
    let gm = "survival"; try { gm = String(p.getGameMode()).toLowerCase(); } catch (e) { /* ignore */ }
    const l = p.location;
    try { p.setDynamicProperty(ST, JSON.stringify({ x: l.x, y: l.y, z: l.z, d: p.dimension.id, gm })); } catch (e) { /* ignore */ }
  }
  watching.set(p.id, t.id);
  try { p.setGameMode(GameMode.Spectator); } catch (e) { /* ignore */ }
  try { p.teleport({ x: t.location.x, y: t.location.y + 3, z: t.location.z }, { dimension: t.dimension }); } catch (e) { /* ignore */ }
  tell(p, "§b[Watch] Watching §f" + t.name + "§b (max " + RANGE + " blocks). §7/watch to stop.", "§b[مراقبة] تراقب §f" + t.name + "§b (أقصى " + RANGE + " بلوكة). §7/watch حتى توقف.");
  xyz();
}
const MODES = { survival: GameMode.Survival, adventure: GameMode.Adventure, creative: GameMode.Creative, spectator: GameMode.Survival };
export function stopWatch(p, quiet) {
  watching.delete(p.id);
  const s = savedOf(p);
  if (s) {
    try { p.setGameMode(MODES[s.gm] ?? GameMode.Survival); } catch (e) { /* ignore */ }
    try { p.teleport({ x: s.x, y: s.y, z: s.z }, { dimension: world.getDimension(s.d) }); } catch (e) { /* ignore */ }
    try { p.setDynamicProperty(ST, undefined); } catch (e) { /* ignore */ }
  }
  if (!quiet) tell(p, "§7[Watch] You stopped watching.", "§7[مراقبة] وقفت المراقبة.");
  xyz();
}

// ---- the coordinates of the whole world while somebody watches (optional)
const hideOn = () => world.getDynamicProperty(HIDE) === true;
function xyz() {
  try {
    const want = hideOn() && watching.size > 0, was = world.getDynamicProperty(XYZ_WAS);
    if (want && was === undefined) { world.setDynamicProperty(XYZ_WAS, world.gameRules.showCoordinates === true); world.gameRules.showCoordinates = false; }
    else if (!want && was !== undefined) { world.gameRules.showCoordinates = was === true; world.setDynamicProperty(XYZ_WAS, undefined); }
  } catch (e) { /* ignore */ }
}

// ---- every 5 ticks: spectator, inside 40 blocks of the target
system.runInterval(() => {
  for (const [wid, tid] of [...watching]) {
    const p = online(wid); if (!p) { watching.delete(wid); xyz(); continue; }
    const t = online(tid);
    if (!t) { tell(p, "§e[Watch] The player left the game.", "§e[مراقبة] اللاعب طلع من اللعبة."); stopWatch(p, true); continue; }
    try {
      if (String(p.getGameMode()).toLowerCase() !== "spectator") p.setGameMode(GameMode.Spectator);
      const a = p.location, b = t.location;
      if (p.dimension.id !== t.dimension.id) { p.teleport({ x: b.x, y: b.y + 3, z: b.z }, { dimension: t.dimension }); continue; }
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, d = Math.hypot(dx, dy, dz);
      if (d > RANGE) { const k = (RANGE - 2) / d; p.teleport({ x: b.x + dx * k, y: b.y + dy * k, z: b.z + dz * k }, { dimension: t.dimension }); }
    } catch (e) { /* not ready */ }
  }
}, 5);
// he left the game while watching: back where he was when he joins again
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || watching.has(player.id) || !savedOf(player)) return;
  system.runTimeout(() => { try { stopWatch(player, true); tell(player, "§7[Watch] You are back where you were before watching.", "§7[مراقبة] رجعت لمكانك قبل المراقبة."); } catch (e) { /* ignore */ } }, 20);
});
world.afterEvents.playerLeave.subscribe(({ playerId }) => { if (watching.delete(playerId)) xyz(); });

// ---------------------------------------------------------------- /watch (the watcher)
export function watchMenu(p) {
  if (!isWatcher(p)) return tell(p, "§c[Watch] Only watchers can use this.", "§c[مراقبة] بس المراقبين يقدرون يستعملون هذا.");
  const f = make("Watch", 6); f.self = () => watchMenu(p); f.glass = true;
  const cur = watching.get(p.id), curName = cur ? online(cur)?.name : null;
  set(f, 0 * COLS + 4, hdr(1, cur ? "g" : "c") + "§b§lWatch a player\n§r§7You become a spectator next to him\n§r§7(max " + RANGE + " blocks). Nothing else.\n§r§7Now: " + (cur ? "§a" + curName : "§fnot watching"), "textures/items/ender_eye", null);
  world.getAllPlayers().filter((x) => x.id !== p.id && !hiddenFrom(p, x)).slice(0, 36).forEach((x, i) => {
    set(f, 1 * COLS + i, hdr(1, cur === x.id ? "g" : "c") + "§f" + x.name + "\n§r§e" + (cur === x.id ? "watching" : "Click to watch"), "textures/ui/shop/ic_player", { run: () => startWatch(p, x) });
  });
  if (cur) set(f, 5 * COLS + 4, hdr(1, "r") + "§c§lStop watching\n§r§7Back where you were", "textures/ui/shop/ic_cancel", { run: () => stopWatch(p) });
  open(p, f);
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:watch", description: "Watchers: watch a player (spectator, 40 blocks)", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { watchMenu(p); } catch (e) { console.warn("[watch] " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[watch] command: " + e); }
});

// ---------------------------------------------------------------- /opr > Server & staff > Watchers (Admin / Owner)
export function watchersPage(player, back) {
  if (!staffBoss(player)) return back();
  const self = () => watchersPage(player, back), l = list(), hide = hideOn();
  const f = makeOpr("Watchers", 6); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(Math.max(1, Object.keys(l).length), "g") + "§b§lWatchers\n§r§7A watcher can ONLY watch one player\n§r§7as a spectator (40 blocks), nothing\n§r§7else: no staff power, no teleport.\n§r§7He uses §f/watch\n§r§7Click a name below to add / remove", "textures/items/ender_eye", null);
  const all = world.getAllPlayers().sort((a, b) => a.name.localeCompare(b.name));
  const rows = [...all.map((p) => [p.id, p.name, true]), ...Object.entries(l).filter(([id]) => !all.some((p) => p.id === id)).map(([id, n]) => [id, n, false])].slice(0, 36);
  rows.forEach(([id, name, on], i) => {
    const w = !!l[id], now = watching.get(id);
    set(f, 1 * COLS + i, hdr(1, w ? "g" : "c") + (w ? "§b👁 " : "§7") + name + (on ? "" : " §8(offline)") + "\n§r§7" + (w ? "WATCHER" + (now ? " §a(watching " + (online(now)?.name ?? "?") + ")" : "") + "\n§r§eClick to remove" : "Click to make a watcher"), w ? "textures/items/ender_eye" : "textures/ui/shop/ic_player", { run: () => { setWatcher(player, id, name, !w); self(); } });
  });
  set(f, 5 * COLS + 6, hdr(1, hide ? "g" : "r") + "§e§lHide coordinates: " + (hide ? "§aON" : "§cOFF") + "\n§r§7While a watcher watches, the\n§r§7coordinates are hidden for EVERYBODY\n§r§7(Bedrock has one switch for the\n§r§7whole world, not per player)\n§r§eClick to turn " + (hide ? "OFF" : "ON"), "textures/items/compass_item", { run: () => { try { world.setDynamicProperty(HIDE, !hide); } catch (e) { /* ignore */ } xyz(); self(); } });
  backBtn(f, back); status(player, f);
  open(player, f);
}
