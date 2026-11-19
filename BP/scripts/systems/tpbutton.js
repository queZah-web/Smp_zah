// TELEPORT BUTTONS - an operator puts a "button" anywhere (the spawn, a hub ...).  A player who taps it is teleported to the coordinates the operator typed.
//   Operator > World > Teleport buttons   (or /tpbutton)       permission "tpbtn" (Admin by default; the Owner can change it in Role permissions)
//   * Look            : "Stone button" (a stone button on the floor) or "Nether Star" (a spinning floating star) - changeable any time
//   * Add button      : stand where the button should be, type the name (hologram - optional) + X Y Z + dimension
//   * Hologram name   : set / change / REMOVE the floating name above the button (the button stays).  & = colour (&6 gold), | = new line
//   * Destination     : change X Y Z + dimension (or use your own position)
//   * Move here       : moves the button to where you stand
//   * Remove button   : deletes the button and its name
//   SNEAK + tap a button (operators) opens its page; a normal tap teleports (so an operator can test it).
// The button is an invisible box (smp:tp_btn) + the usual text entities (shop:holo) + a soft violet effect.  Saved in ONE world property (\"tpb:v1\").
// Players teleport with the same effects, combat check and rules as /warp.  Nothing here can break another system.
import { world, system, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { COLS, SHORT_ROWS, NAV, hdr, makeOpr as make, set, open, status, backBtn } from "../smp/ui.js";
import { showModal, confirmOpr as confirm } from "./forms.js";
import { isStaff } from "./opcore.js";
import { allow, can, slog } from "./staffcore.js";
import { canTeleport, teleportWithFx, teleportTo, dimLabel } from "./util.js";
import { pointInAfkZone } from "./afk.js";
import { fx } from "../lux.js";
import { oprMsg, OprForm } from "./oprlang.js";
import { menuMsg } from "./menulang.js";

const KEY = "tpb:v1", MAX = 30;
const STYLES = { stone: { type: "smp:tp_btn", name: "Stone button", top: 0.75 }, star: { type: "smp:tp_star", name: "Nether Star", top: 1.75 } };   // look of a button + height of its hologram name
const HIT_TYPES = [STYLES.stone.type, STYLES.star.type], HOLO = "shop:holo";
const styleOf = (b) => (b && b.s === "star" ? "star" : "stone");
const HIT_TAG = "tp_hit", HOLO_TAG = "tp_holo";            // HOLO_TAG is also in the cleaner whitelist of hologram.js
const GAP = 0.27, MAX_LINES = 3, NAME_MAX = 60;
const RANGE = 48, FX_RANGE = 32;
const ICON = "textures/items/ender_pearl";
const DIMS = [["minecraft:overworld", "Overworld"], ["minecraft:nether", "Nether"], ["minecraft:the_end", "The End"]];

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(r2(n));
const where = (o) => fmt(o.x) + ", " + fmt(o.y) + ", " + fmt(o.z);
const dimShort = (id) => String(id).replace("minecraft:", "");
const plain = (s) => String(s ?? "").replace(/§./g, "");
/** typed name -> saved name: & + colour letter becomes a colour code, real § is removed */
const cleanName = (s) => String(s ?? "").replace(/§/g, "").replace(/[\r]/g, "").replace(/&([0-9a-fk-or])/gi, "§$1").trim().slice(0, NAME_MAX);
const linesOf = (b) => String(b.n ?? "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, MAX_LINES);
const labelOf = (b) => (b.n ? "§f" + plain(b.n).replace(/\|/g, " / ") : "§7(no name)");
const say = (p, m) => { try { p.sendMessage(oprMsg(p, m)); } catch (e) { /* ignore */ } };
const guard = (p) => { if (can(p, "tpbtn")) return true; allow(p, "tpbtn"); return false; };
const logIt = (p, text) => { try { slog(p, "tpbtn", null, text); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- data
const okRec = (b) => b && typeof b.id === "string" && typeof b.d === "string" && [b.x, b.y, b.z].every(Number.isFinite) && b.t && typeof b.t.d === "string" && [b.t.x, b.t.y, b.t.z].every(Number.isFinite);
function load() {
  try { const raw = world.getDynamicProperty(KEY); const a = typeof raw === "string" ? JSON.parse(raw) : []; return Array.isArray(a) ? a.filter(okRec) : []; } catch (e) { return null; }
}
function save(a) { try { world.setDynamicProperty(KEY, JSON.stringify(a)); return true; } catch (e) { console.warn("[tpbtn] save failed: " + e); return false; } }
export const listButtons = () => load() ?? [];
const findBtn = (id) => listButtons().find((b) => b.id === id) ?? null;

// ---------------------------------------------------------------- the entities (box + text lines)
const dimOf = (d) => { try { return world.getDimension(d); } catch (e) { return null; } };
const hitsOf = (dim, id) => { try { return dim.getEntities({ tags: ["tpb_" + id] }); } catch (e) { return []; } };
const holosOf = (dim, id) => { try { return dim.getEntities({ type: HOLO, tags: ["tph_" + id] }); } catch (e) { return []; } };
const killAll = (list) => { for (const e of list) { try { e.remove(); } catch (er) { /* ignore */ } } };

/** makes / repairs the box and the text lines of one button.  Only call it when the area is loaded (a player is near). */
function render(b) {
  const dim = dimOf(b.d); if (!dim) return;
  let blk = null; try { blk = dim.getBlock({ x: b.x, y: b.y, z: b.z }); } catch (e) { return; }
  if (!blk) return;                                                                       // area not loaded
  const want = STYLES[styleOf(b)];
  let hits = hitsOf(dim, b.id);
  const wrong = hits.filter((e) => e.typeId !== want.type);                               // the look was changed: the old one goes
  if (wrong.length) { killAll(wrong); hits = hits.filter((e) => e.typeId === want.type); }
  if (hits.length === 0) {
    try { const e = dim.spawnEntity(want.type, { x: b.x, y: b.y, z: b.z }); e.addTag(HIT_TAG); e.addTag("tpb_" + b.id); } catch (e) { console.warn("[tpbtn] box: " + e); }
  } else killAll(hits.slice(1));                                                          // doubled box: keep one
  const lines = linesOf(b), holos = holosOf(dim, b.id);
  if (!lines.length) { killAll(holos); return; }                                          // no name: no hologram
  const byLine = new Map();
  for (const e of holos) { try { const t = e.getTags().find((x) => x.startsWith("tphl")); if (t) byLine.set(+t.slice(4), e); } catch (er) { /* ignore */ } }
  if (holos.length !== lines.length || byLine.size !== lines.length) {                    // wrong number of lines: build them again
    killAll(holos);
    lines.forEach((text, i) => {
      try {
        const e = dim.spawnEntity(HOLO, { x: b.x, y: b.y + want.top + (lines.length - 1 - i) * GAP, z: b.z });
        e.nameTag = text; e.addTag(HOLO_TAG); e.addTag("tph_" + b.id); e.addTag("tphl" + i);
      } catch (er) { /* the next scan tries again */ }
    });
    return;
  }
  lines.forEach((text, i) => { const e = byLine.get(i); try { if (e && e.nameTag !== text) e.nameTag = text; } catch (er) { /* ignore */ } });
}
function clearEntities(b) {
  const dim = dimOf(b.d); if (!dim) return;
  killAll(hitsOf(dim, b.id)); killAll(holosOf(dim, b.id));
}

const nearBy = (players, b, range) => players.find((p) => { try { return p.dimension.id === b.d && Math.hypot(p.location.x - b.x, p.location.z - b.z) <= range; } catch (e) { return false; } });

system.runInterval(() => {                                                               // keep the buttons alive (only where a player is near)
  try {
    const list = load(); if (!list || !list.length) return;
    const players = world.getAllPlayers(); if (!players.length) return;
    for (const b of list) { try { if (nearBy(players, b, RANGE)) render(b); } catch (e) { console.warn("[tpbtn] render: " + e); } }
  } catch (e) { /* ignore */ }
}, 40);
system.runInterval(() => {                                                               // the soft violet effect on every button
  try {
    const list = load(); if (!list || !list.length) return;
    const players = world.getAllPlayers(); if (!players.length) return;
    for (const b of list) {
      const q = nearBy(players, b, FX_RANGE); if (!q) continue;
      fx(q.dimension, "lux:column", { x: b.x, y: b.y + 0.05, z: b.z }, { count: 3, radius: 0.45, speed: 1.4, life: 1.0, size: 0.13, r: 0.78, g: 0.6, b: 1.0 });
    }
  } catch (e) { /* ignore */ }
}, 10);
system.runInterval(() => {                                                               // leftovers of buttons that were removed while their area was not loaded
  try {
    const list = load(); if (!list) return;                                              // not readable: touch nothing
    const ids = new Set(list.map((b) => b.id));
    for (const d of ["overworld", "nether", "the_end"]) {
      const dim = dimOf(d); if (!dim) continue;
      let a = []; try { a = HIT_TYPES.flatMap((t) => dim.getEntities({ type: t })); } catch (e) { a = []; }
      for (const e of a) { try { const t = e.getTags().find((x) => x.startsWith("tpb_")); if (!t || !ids.has(t.slice(4))) e.remove(); } catch (er) { /* ignore */ } }
      let h = []; try { h = dim.getEntities({ type: HOLO, tags: [HOLO_TAG] }); } catch (e) { h = []; }
      for (const e of h) { try { const t = e.getTags().find((x) => x.startsWith("tph_")); if (!t || !ids.has(t.slice(4))) e.remove(); } catch (er) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}, 100);

// ---------------------------------------------------------------- operator actions (each one checks the permission again)
/** checks X Y Z + dimension typed by an operator. Returns { t } or { err } */
function parseTarget(xs, ys, zs, dimIdx) {
  const num = (s) => { const t = String(s ?? "").trim().replace(",", "."); return t === "" ? NaN : Number(t); };
  const x = num(xs), y = num(ys), z = num(zs);
  if (![x, y, z].every(Number.isFinite)) return { err: "X, Y and Z must be numbers." };
  if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000) return { err: "X / Z are too far from the world centre." };
  if (y < -64 || y > 320) return { err: "Y must be between -64 and 320." };
  const d = (DIMS[dimIdx] ?? DIMS[0])[0];
  if (pointInAfkZone(d, x, y, z)) return { err: "The destination can't be inside the AFK area." };
  return { t: { x: r2(x), y: r2(y), z: r2(z), d } };
}
function addButton(p, name, t, style) {
  if (!guard(p)) return { err: "Not allowed." };
  const a = load(); if (!a) return { err: "Could not read the saved buttons." };
  if (a.length >= MAX) return { err: "Limit of " + MAX + " buttons reached. Remove one first." };
  const l = p.location;
  const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), n: cleanName(name), d: p.dimension.id, x: r2(l.x), y: r2(l.y), z: r2(l.z), t, s: style === "star" ? "star" : "stone" };
  a.push(b);
  if (!save(a)) return { err: "Could not save the button." };
  try { render(b); } catch (e) { console.warn("[tpbtn] render: " + e); }
  logIt(p, "added a button at " + where(b) + " -> " + where(t) + " " + dimLabel(t.d));
  return { b };
}
/** changes fields of one button. patch(b) edits it; log = text for the staff log. Returns an error text or null */
function change(p, id, patch, log) {
  if (!guard(p)) return "Not allowed.";
  const a = load(); if (!a) return "Could not read the saved buttons.";
  const at = a.findIndex((b) => b.id === id); if (at < 0) return "That button no longer exists.";
  const before = { ...a[at] };
  patch(a[at]);
  if (!save(a)) return "Could not save the button.";
  if (before.d !== a[at].d || before.x !== a[at].x || before.y !== a[at].y || before.z !== a[at].z) clearEntities(before);   // moved: the old box and text go away
  try { render(a[at]); } catch (e) { console.warn("[tpbtn] render: " + e); }
  logIt(p, log);
  return null;
}
const setName = (p, id, name) => change(p, id, (b) => { b.n = cleanName(name); }, cleanName(name) ? "set the name of a button to " + plain(cleanName(name)) : "removed the name of a button");
const setStyle = (p, id, style) => change(p, id, (b) => { b.s = style === "star" ? "star" : "stone"; }, "changed the look of a button to " + STYLES[style === "star" ? "star" : "stone"].name);
const setTarget = (p, id, t) => change(p, id, (b) => { b.t = t; }, "changed the destination of a button to " + where(t) + " " + dimLabel(t.d));
const moveHere = (p, id) => { const l = p.location, d = p.dimension.id; return change(p, id, (b) => { b.d = d; b.x = r2(l.x); b.y = r2(l.y); b.z = r2(l.z); }, "moved a button to " + where(l)); };
function removeButton(p, id) {
  if (!guard(p)) return "Not allowed.";
  const a = load(); if (!a) return "Could not read the saved buttons.";
  const at = a.findIndex((b) => b.id === id); if (at < 0) return "That button no longer exists.";
  const [gone] = a.splice(at, 1);
  if (!save(a)) return "Could not save.";
  clearEntities(gone);
  logIt(p, "removed a button at " + where(gone));
  return null;
}

// ---------------------------------------------------------------- what a player does: tap -> teleport
export function goButton(player, b) {
  if (!canTeleport(player, "tpbtn")) return;
  const name = plain(b.n).replace(/\|/g, " ").trim();
  teleportWithFx(player, b.t, b.t.d, "tpbtn",
    () => player.sendMessage(menuMsg(player, "§a[Teleport] Teleported" + (name ? " to §f" + name : "") + "§a.")),
    () => player.sendMessage(menuMsg(player, "§c[Teleport] Teleport failed.")));
}
const lastTap = new Map();
function tapped(player, ent) {
  try {
    if (!ent || !HIT_TYPES.includes(ent.typeId) || player?.typeId !== "minecraft:player") return;
    const now = Date.now(); if (now - (lastTap.get(player.id) ?? 0) < 600) return;       // touch screens send several events for one tap
    lastTap.set(player.id, now);
    const t = ent.getTags().find((x) => x.startsWith("tpb_")); if (!t) return;
    const b = findBtn(t.slice(4)); if (!b) return;
    if (player.isSneaking && isStaff(player) && can(player, "tpbtn")) buttonPage(player, b, () => { });     // operator: SNEAK + tap = manage
    else goButton(player, b);
  } catch (e) { console.warn("[tpbtn] tap: " + e); }
}
try { world.beforeEvents.playerInteractWithEntity.subscribe((ev) => { if (!HIT_TYPES.includes(ev.target?.typeId)) return; ev.cancel = true; const p = ev.player, t = ev.target; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[tpbtn] interact hook: " + e); }
try { world.afterEvents.entityHitEntity.subscribe((ev) => { if (!HIT_TYPES.includes(ev.hitEntity?.typeId)) return; const p = ev.damagingEntity, t = ev.hitEntity; system.run(() => tapped(p, t)); }); } catch (e) { console.warn("[tpbtn] hit hook: " + e); }
world.afterEvents.playerLeave.subscribe(({ playerId }) => { lastTap.delete(playerId); });

// ---------------------------------------------------------------- forms
function field(form, label, placeholder, def) {
  try { form.textField(label, placeholder, { defaultValue: String(def ?? "") }); } catch (e) { form.textField(label, placeholder); }
}
function dimField(form, current) {
  const names = DIMS.map((d) => d[1]), idx = Math.max(0, DIMS.findIndex((d) => d[0] === current));
  try { form.dropdown("§fDimension", names, { defaultValueIndex: idx }); } catch (e) { form.dropdown("§fDimension", names, idx); }
}
function styleField(form, current) {
  const names = [STYLES.stone.name, STYLES.star.name], idx = current === "star" ? 1 : 0;
  try { form.dropdown("§fLook of the button", names, { defaultValueIndex: idx }); } catch (e) { form.dropdown("§fLook of the button", names, idx); }
}
function toggleField(form, label, def) {
  try { form.toggle(label, { defaultValue: def }); } catch (e) { form.toggle(label, def); }
}
const NAME_HELP = "§fName above the button §7(hologram)\n§7& = colour (e.g. &6 gold), | = new line, empty = no name";

function addForm(player, back) {
  if (!guard(player)) return back();
  const form = new OprForm().title("Add teleport button");
  field(form, NAME_HELP, "e.g. &6&lMarket", "");
  styleField(form, "stone");
  field(form, "§fGo to X", "e.g. 100", "");
  field(form, "§fGo to Y", "e.g. 64", "");
  field(form, "§fGo to Z", "e.g. -250", "");
  dimField(form, player.dimension.id);
  showModal(player, form, (v) => {
    if (!v) return back();
    if (!guard(player)) return back();
    const r = parseTarget(v[2], v[3], v[4], v[5]);
    if (r.err) { say(player, "§c[Teleport button] " + r.err); return back(); }
    const res = addButton(player, v[0], r.t, v[1] === 1 ? "star" : "stone");
    say(player, res.err ? "§c[Teleport button] " + res.err : "§a[Teleport button] Button placed at §f" + where(res.b) + "§a. Step back to see it.");
    back();
  });
}
function nameForm(player, b, back) {
  if (!guard(player)) return back();
  const form = new OprForm().title("Hologram name");
  field(form, NAME_HELP, "e.g. &6&lMarket", String(b.n ?? "").replace(/§/g, "&"));
  showModal(player, form, (v) => {
    if (!v) return back();
    const err = setName(player, b.id, v[0]);
    say(player, err ? "§c[Teleport button] " + err : cleanName(v[0]) ? "§a[Teleport button] Hologram name saved." : "§6[Teleport button] Hologram name removed.");
    back();
  });
}
function targetForm(player, b, back) {
  if (!guard(player)) return back();
  const form = new OprForm().title("Destination");
  field(form, "§fGo to X", "e.g. 100", fmt(b.t.x));
  field(form, "§fGo to Y", "e.g. 64", fmt(b.t.y));
  field(form, "§fGo to Z", "e.g. -250", fmt(b.t.z));
  dimField(form, b.t.d);
  toggleField(form, "§aUse my current position instead of the numbers", false);
  showModal(player, form, (v) => {
    if (!v) return back();
    let r;
    if (v[4]) { const l = player.location, di = Math.max(0, DIMS.findIndex((d) => d[0] === player.dimension.id)); r = parseTarget(l.x, l.y, l.z, di); }
    else r = parseTarget(v[0], v[1], v[2], v[3]);
    if (r.err) { say(player, "§c[Teleport button] " + r.err); return back(); }
    const err = setTarget(player, b.id, r.t);
    say(player, err ? "§c[Teleport button] " + err : "§a[Teleport button] Destination saved: §f" + where(r.t) + " §7(" + dimLabel(r.t.d) + ")");
    back();
  });
}

// ---------------------------------------------------------------- pages
export function tpButtonPage(player, back) {
  if (!guard(player)) return;
  const f = make("Teleport Buttons", SHORT_ROWS); f.self = () => tpButtonPage(player, back);
  const n = listButtons().length;
  set(f, 0 * COLS + 4, hdr(Math.max(1, n)) + "§d§lTeleport buttons\n§r§7Placed: §f" + n + "§7/§f" + MAX + "\n§r§7A player who taps a button is sent\n§r§7to the coordinates you choose.", ICON, null);
  set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lAdd button here\n§r§7Stand where the button should be.\n§r§7Pick the look (stone button / nether star),\n§r§7the name (optional) and the X Y Z to go to.", NAV.ok, { run: () => addForm(player, f.self) });
  set(f, 1 * COLS + 6, hdr(Math.max(1, n)) + "§e§lManage buttons\n§r§7Change the name, the destination,\n§r§7remove the name or the button", ICON, { run: () => managePage(player, f.self) });
  set(f, 3 * COLS + 4, hdr(1) + "§7§lTip\n§r§7SNEAK + tap a button to manage it.\n§r§7A normal tap teleports (to test it).", NAV.page, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function managePage(player, back) {
  if (!guard(player)) return;
  const f = make("Manage Buttons", SHORT_ROWS); f.self = () => managePage(player, back);
  const list = listButtons();
  list.slice(0, 27).forEach((b, i) => {
    set(f, i, hdr(1) + "§d§l" + (b.n ? plain(b.n).replace(/\|/g, " / ") : "Button " + (i + 1)) + "\n§r§7At: §f" + where(b) + " §7(" + dimShort(b.d) + ")\n§r§7Goes to: §f" + where(b.t) + " §7(" + dimShort(b.t.d) + ")\n§r§eClick to manage", ICON, { run: () => buttonPage(player, b, f.self) });
  });
  if (!list.length) set(f, 1 * COLS + 4, hdr(1) + "§7No buttons yet\n§r§7Use §fAdd button here §7first", ICON, null);
  backBtn(f, back); status(player, f);
  open(player, f);
}
function buttonPage(player, b0, back) {
  if (!guard(player)) return;
  const b = findBtn(b0.id);
  if (!b) { say(player, "§c[Teleport button] That button no longer exists."); return back(); }
  const f = make("Teleport Button", SHORT_ROWS); f.self = () => buttonPage(player, b, back);
  const again = f.self;
  set(f, 0 * COLS + 4, hdr(1) + "§d§l" + labelOf(b) + "\n§r§7At: §f" + where(b) + " §7(" + dimShort(b.d) + ")\n§r§7Goes to: §f" + where(b.t) + " §7(" + dimLabel(b.t.d) + ")", ICON, null);
  set(f, 1 * COLS + 1, hdr(1) + "§e§l" + (b.n ? "Change hologram name" : "Add hologram name") + "\n§r§7The floating text above the button\n§r§eClick to type", "textures/items/name_tag", { run: () => nameForm(player, b, again) });
  if (b.n) set(f, 1 * COLS + 3, hdr(1, "r") + "§c§lRemove hologram name\n§r§7The button stays, only the\n§r§7floating text goes away", NAV.no, { run: () => {
    const err = setName(player, b.id, "");
    say(player, err ? "§c[Teleport button] " + err : "§6[Teleport button] Hologram name removed.");
    again();
  } });
  set(f, 1 * COLS + 5, hdr(1) + "§b§lChange destination\n§r§7Now: §f" + where(b.t) + "\n§r§eClick to type X Y Z", "textures/items/compass_item", { run: () => targetForm(player, b, again) });
  set(f, 1 * COLS + 7, hdr(1) + "§a§lMove button here\n§r§7Puts the button where you\n§r§7are standing now", "textures/items/ender_eye", { run: () => {
    const err = moveHere(player, b.id);
    say(player, err ? "§c[Teleport button] " + err : "§a[Teleport button] Button moved here.");
    again();
  } });
  set(f, 2 * COLS + 2, hdr(1) + "§a§lTest\n§r§7Teleport yourself to the\n§r§7destination of this button", NAV.ok, { run: () => system.run(() => { if (guard(player)) goButton(player, b); }) });
  set(f, 2 * COLS + 4, hdr(1) + "§b§lGo to button\n§r§7Teleport next to this button", "textures/items/ender_pearl", { run: () => system.run(() => {
    if (!guard(player)) return;
    try { teleportTo(player, { x: b.x, y: b.y, z: b.z + 2 }, b.d); say(player, "§a[Teleport button] Teleported to the button."); } catch (e) { say(player, "§c[Teleport button] Teleport failed (the area may not be loaded)."); }
  }) });
  set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lRemove button\n§r§7Delete the button and its name", NAV.no, { run: () => confirm(player, "Remove this button?", ["§7" + plain(b.n || "Button") + " at §f" + where(b)], () => {
    const err = removeButton(player, b.id);
    say(player, err ? "§c[Teleport button] " + err : "§6[Teleport button] Button removed.");
    back();
  }, again) });
  const star = styleOf(b) === "star";
  set(f, 3 * COLS + 4, hdr(1) + "§6§lLook: §f" + STYLES[styleOf(b)].name + "\n§r§7Click to change it to §f" + STYLES[star ? "stone" : "star"].name, star ? "textures/items/nether_star" : "textures/ui/shop/i3d_stone_button", { run: () => {
    const err = setStyle(player, b.id, star ? "stone" : "star");
    say(player, err ? "§c[Teleport button] " + err : "§a[Teleport button] Look changed to §f" + STYLES[star ? "stone" : "star"].name + "§a.");
    again();
  } });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- command:  /tpbutton  (operators) opens the page
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:tpbutton", description: "Admin: teleport buttons (place, name, remove)", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { if (allow(p, "tpbtn")) tpButtonPage(p, () => { }); } catch (e) { console.warn("[tpbtn] command: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[tpbtn] command not registered: " + e); }
});
