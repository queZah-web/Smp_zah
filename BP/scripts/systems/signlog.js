// ===================================================================================================================
// SIGN LOG - who PLACED a sign and who WROTE on it (front + back).  Only the OWNER can see it.
//   * placing a sign: the placer is saved.  Writing: when a player places / opens a sign, its text is watched for 40 s;
//     every change is saved with his name (front and back separately) and goes into the log (last 150 changes).
//   * the Owner LOOKS at a sign (6 blocks): the action bar shows  Placed by ... | Front: ... | Back: ...
//   * the Owner SNEAKS + right-clicks a sign: all details in the chat (texts, names, times) - the sign does not open
//   * /signlog (Owner): the last changes on the whole server (name, text, place) - to find who insults others
//   Players see nothing and nothing changes for them. Signs that nobody placed / wrote (structures) are not tracked.
// Data: one world property per tracked sign  "sg:<dim>:<x>,<y>,<z>"  +  the log "sg:log".  No lag: work only happens
// when someone places / opens a sign, plus one ray check every 0.5 s for the Owner only.
// ===================================================================================================================
import { world, system, SignSide, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { isOwner } from "./staffcore.js";
import { showModal } from "./forms.js";
import { pick } from "./arextra.js";
import { ago } from "../format.js";

const LOG = "sg:log", MAX_LOG = 150, WATCH_MS = 40000, TXT = 90;
const isSign = (id) => typeof id === "string" && id.includes("sign");
const dimS = (d) => (d === "minecraft:overworld" ? "o" : d === "minecraft:nether" ? "n" : d === "minecraft:the_end" ? "e" : d);
const keyOf = (b) => "sg:" + dimS(b.dimension.id) + ":" + b.x + "," + b.y + "," + b.z;
const read = (k) => { try { const v = world.getDynamicProperty(k); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; } };
const write = (k, v) => { try { world.setDynamicProperty(k, v ? JSON.stringify(v) : undefined); } catch (e) { console.warn("[signlog] save: " + e); } };
const clean = (s) => String(s ?? "").replace(/§./g, "").replace(/\s+/g, " ").trim().slice(0, TXT);
const owner = (p) => { try { return isOwner(p); } catch (e) { return false; } };
const safe = (name, fn) => { try { fn(); } catch (e) { console.warn("[signlog] " + name + ": " + e); } };
const textOf = (b, side) => { try { return clean(b.getComponent("minecraft:sign")?.getText(side)); } catch (e) { return ""; } };

function addLog(e) {
  const a = read(LOG) ?? [];
  a.unshift(e); if (a.length > MAX_LOG) a.length = MAX_LOG;
  write(LOG, a);
}

// ---------------------------------------------------------------- watching: a sign a player placed / opened
const watch = new Map();                    // sign key -> { b (location), d, pid, name, until, f, k (last texts) }
function startWatch(p, b) {
  const k = keyOf(b);
  watch.set(k, { x: b.x, y: b.y, z: b.z, d: b.dimension.id, pid: p.id, name: p.name, until: Date.now() + WATCH_MS, f: textOf(b, SignSide.Front), bk: textOf(b, SignSide.Back) });
}
system.runInterval(() => {
  if (!watch.size) return;
  const now = Date.now();
  for (const [k, w] of watch) {
    try {
      const b = world.getDimension(w.d).getBlock({ x: w.x, y: w.y, z: w.z });
      if (!b || !isSign(b.typeId)) { watch.delete(k); continue; }
      for (const [side, key, label] of [[SignSide.Front, "f", "front"], [SignSide.Back, "bk", "back"]]) {
        const t = textOf(b, side);
        if (t === w[key]) continue;
        w[key] = t;
        const rec = read(k) ?? { p: null };
        rec[key === "f" ? "f" : "b"] = [w.name, t, now, w.pid];
        write(k, rec);
        if (t) addLog({ t: now, n: w.name, id: w.pid, s: label, x: w.x, y: w.y, z: w.z, d: dimS(w.d), tx: t });
      }
      if (now > w.until) watch.delete(k);
    } catch (e) { watch.delete(k); }
  }
}, 20);

safe("place", () => world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  try {
    if (!isSign(block.typeId)) return;
    const k = keyOf(block);
    write(k, { p: [player.name, Date.now(), player.id] });
    startWatch(player, block);
  } catch (e) { /* ignore */ }
}));
safe("open", () => world.afterEvents.playerInteractWithBlock.subscribe(({ player, block }) => {
  try { if (isSign(block.typeId) && !(owner(player) && player.isSneaking)) startWatch(player, block); } catch (e) { /* ignore */ }
}));
safe("break", () => world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
  try { if (isSign(brokenBlockPermutation?.type?.id)) { const k = keyOf(block); watch.delete(k); write(k, null); } } catch (e) { /* ignore */ }
}));

// ---------------------------------------------------------------- the Owner: look at a sign / sneak + click / /signlog
const line = (r, key, en) => { const v = r?.[key]; return v ? "§f" + v[0] + (v[1] !== undefined && key !== "p" ? " §7\"" + v[1] + "\"" : "") : "§8-"; };
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      if (!owner(p)) continue;
      const hit = p.getBlockFromViewDirection({ maxDistance: 6 });
      const b = hit?.block; if (!b || !isSign(b.typeId)) continue;
      const r = read(keyOf(b));
      const txt = r ? "§6✎ §7Placed: " + (r.p ? "§f" + r.p[0] : "§8?") + " §8| §7Front: " + (r.f ? "§f" + r.f[0] : "§8-") + " §8| §7Back: " + (r.b ? "§f" + r.b[0] : "§8-") : "§8✎ no record (not placed / written by a player)";
      p.onScreenDisplay.setActionBar(txt);
    } catch (e) { /* ignore */ }
  }
}, 10);
safe("owner click", () => world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player, b = ev.block;
  if (!isSign(b.typeId) || !p.isSneaking || !owner(p)) return;
  ev.cancel = true;
  if (ev.isFirstEvent === false) return;
  const r = read(keyOf(b)), at = b.x + " " + b.y + " " + b.z;
  system.run(() => {
    const when = (v) => (v && v[2] ? " §8(" + ago(v[2]) + ")" : "");
    p.sendMessage("§6§l[Sign] §r§7" + at + "\n§7Placed by: " + (r?.p ? "§f" + r.p[0] + " §8(" + ago(r.p[1]) + ")" : "§8unknown") +
      "\n§7Front: " + line(r, "f") + when(r?.f) + "\n§7Back: " + line(r, "b") + when(r?.b));
  });
}));
export function signLogPage(p) {
  if (!owner(p)) return;
  const a = read(LOG) ?? [];
  const body = a.length ? a.slice(0, 60).map((e) => "§e" + e.n + " §8" + ago(e.t) + " §7(" + e.s + ", " + e.x + " " + e.y + " " + e.z + (e.d !== "o" ? " " + e.d : "") + ")\n§f  \"" + e.tx + "\"").join("\n") : pick(p, "§7Nothing written on signs yet.", "§7ما أحد كتب على لوحة للحين.");
  const f = new ActionFormData().title(pick(p, "Sign log (Owner)", "سجل اللوحات (المالك)")).body(body).button(pick(p, "Close", "إغلاق"));
  showModal(p, f, () => {});
}
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:signlog", description: "Owner: who wrote what on the signs", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { if (owner(p)) signLogPage(p); else p.sendMessage("§c[Sign] Owner only."); });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[signlog] command: " + e); }
});
safe("leave", () => world.afterEvents.playerLeave.subscribe(({ playerId }) => { for (const [k, w] of watch) if (w.pid === playerId) watch.delete(k); }));
