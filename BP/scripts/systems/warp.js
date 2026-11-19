// Warps  -  server warps in the SMP Menu (and /warp).
//   Everyone:  SMP Menu > Warps  (or /warp)   -> list of warps, click one to teleport to its EXACT coordinates
//              /warp <name>                    -> teleports straight to that warp
//   Admin:     buttons in the Warps page: Add Warp / Edit Warp / Remove Warp  (name + X Y Z + dimension, typed in a form)
//              /setwarp <name> creates a warp at your position, /deletewarp <name> removes one
// Permission "warps" (Admin by default; the Owner can change it in Role permissions). Saved in ONE world property ("warp:v1").
import { world, system, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { dashboard } from "../smp/menu.js";
import { can, allow, slog } from "./staffcore.js";
import { canTeleport, teleportWithFx, dimLabel } from "./util.js";
import { pointInAfkZone } from "./afk.js";
import { showModal, confirmShort as confirm } from "./forms.js";
import { luxCmd } from "../lux.js";
import { menuMsg, MenuForm } from "./menulang.js";

const KEY = "warp:v1", MAX = 36;
export const WARP_ICON = "textures/ui/shop/ic_warp";                 // the teleport sign (RP/textures/ui/shop/ic_warp.png)
const DIMS = [["minecraft:overworld", "Overworld"], ["minecraft:nether", "Nether"], ["minecraft:the_end", "The End"]];
const clean = (s) => String(s ?? "").replace(/[§\n\r]/g, "").trim().slice(0, 16);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => String(Math.round(n * 100) / 100);               // 12.5 -> "12.5", 12 -> "12"
const coords = (w) => fmt(w.x) + ", " + fmt(w.y) + ", " + fmt(w.z);

function load() {
  try { const raw = world.getDynamicProperty(KEY); const a = typeof raw === "string" ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function save(a) { try { world.setDynamicProperty(KEY, JSON.stringify(a)); return true; } catch (e) { console.warn("[warp] save failed: " + e); return false; } }
const find = (name) => load().find((w) => w.n.toLowerCase() === clean(name).toLowerCase());
export const warpCount = () => load().length;

export function goWarp(player, w) {
  if (!canTeleport(player, "warp")) return;
  teleportWithFx(player, w, w.d, "warp",                              // exact x / y / z of the warp, in the warp's dimension
    () => player.sendMessage(menuMsg(player, "§a[Warp] Teleported to §f" + w.n)),
    () => player.sendMessage(menuMsg(player, "§c[Warp] Teleport failed.")));
}

// ---------------------------------------------------------------- data (admin)
/** checks a name + coordinates typed by an admin. Returns { rec } or { err } */
function parseRec(nameRaw, xs, ys, zs, dimIdx) {
  const name = clean(nameRaw);
  if (!name) return { err: "Give the warp a name." };
  if (["delete", "remove"].includes(name.toLowerCase())) return { err: "That name is reserved." };
  const num = (s) => { const t = String(s ?? "").trim().replace(",", "."); return t === "" ? NaN : Number(t); };
  const x = num(xs), y = num(ys), z = num(zs);
  if (![x, y, z].every(Number.isFinite)) return { err: "X, Y and Z must be numbers." };
  if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000) return { err: "X / Z are too far from the world centre." };
  if (y < -64 || y > 320) return { err: "Y must be between -64 and 320." };
  const d = (DIMS[dimIdx] ?? DIMS[0])[0];
  if (pointInAfkZone(d, x, y, z)) return { err: "A warp can't be inside the AFK area." };
  return { rec: { n: name, x: r1(x), y: r1(y), z: r1(z), d } };
}
const logIt = (p, text) => { try { slog(p, "warps", null, text); } catch (e) { /* ignore */ } };

/** admin: add a warp (or, with replace, move the warp with the same name). Returns an error text or null */
export function addWarp(p, rec, replace = false) {
  if (!can(p, "warps")) { allow(p, "warps"); return "Not allowed."; }
  const a = load(), at = a.findIndex((w) => w.n.toLowerCase() === rec.n.toLowerCase());
  if (at >= 0) { if (!replace) return "There is already a warp called " + rec.n + "."; a[at] = rec; }
  else { if (a.length >= MAX) return "Limit of " + MAX + " warps reached. Remove one first."; a.push(rec); }
  if (!save(a)) return "Could not save the warp.";
  logIt(p, (at >= 0 ? "moved" : "added") + " warp " + rec.n + " (" + coords(rec) + " " + dimLabel(rec.d) + ")");
  return null;
}
/** admin: change a warp (name / coordinates / dimension). Returns an error text or null */
export function editWarpRec(p, oldName, rec) {
  if (!can(p, "warps")) { allow(p, "warps"); return "Not allowed."; }
  const a = load(), at = a.findIndex((w) => w.n.toLowerCase() === clean(oldName).toLowerCase());
  if (at < 0) return "That warp no longer exists.";
  const clash = a.findIndex((w, i) => i !== at && w.n.toLowerCase() === rec.n.toLowerCase());
  if (clash >= 0) return "There is already a warp called " + rec.n + ".";
  const before = a[at]; a[at] = rec;
  if (!save(a)) return "Could not save the warp.";
  logIt(p, "edited warp " + before.n + (before.n !== rec.n ? " -> " + rec.n : "") + " (" + coords(rec) + " " + dimLabel(rec.d) + ")");
  return null;
}
/** quick save at the admin's position (used by /warp <name>). Returns an error text or null */
export function setWarp(p, nameRaw) {
  if (!can(p, "warps")) { allow(p, "warps"); return "Not allowed."; }
  const name = clean(nameRaw);
  if (!name) return "Give the warp a name: /setwarp <name>";
  if (["delete", "remove"].includes(name.toLowerCase())) return "That name is reserved.";
  const l = p.location;
  if (pointInAfkZone(p.dimension.id, l.x, l.y, l.z)) return "You can't set a warp inside the AFK area.";
  return addWarp(p, { n: name, x: r1(l.x), y: r1(l.y), z: r1(l.z), d: p.dimension.id }, true);
}
export function deleteWarp(p, nameRaw) {
  if (!can(p, "warps")) { allow(p, "warps"); return "Not allowed."; }
  const a = load(), at = a.findIndex((w) => w.n.toLowerCase() === clean(nameRaw).toLowerCase());
  if (at < 0) return "There is no warp called " + clean(nameRaw) + ".";
  const [gone] = a.splice(at, 1);
  if (!save(a)) return "Could not save.";
  logIt(p, "removed warp " + gone.n);
  return null;
}

// ---------------------------------------------------------------- forms
function field(form, label, placeholder, def) {
  try { form.textField(label, placeholder, { defaultValue: def }); } catch (e) { form.textField(label, placeholder); }
}
function dimField(form, current) {
  const names = DIMS.map((d) => d[1]), idx = Math.max(0, DIMS.findIndex((d) => d[0] === current));
  try { form.dropdown("§fDimension", names, { defaultValueIndex: idx }); } catch (e) { form.dropdown("§fDimension", names, idx); }
}
/** the form shared by Add and Edit.  w = the warp being edited, or null (Add: starts with your current position) */
function warpForm(player, w, back) {
  const l = player.location, cur = w ?? { n: "", x: r1(l.x), y: r1(l.y), z: r1(l.z), d: player.dimension.id };
  const form = new MenuForm().title(w ? "Edit Warp" : "Add Warp");
  field(form, "§fName §7(max 16 characters)", "e.g. Market", cur.n);
  field(form, "§fX", "e.g. 100", fmt(cur.x));
  field(form, "§fY", "e.g. 64", fmt(cur.y));
  field(form, "§fZ", "e.g. -250", fmt(cur.z));
  dimField(form, cur.d);
  showModal(player, form, (v) => {
    if (!v) return back();                                            // closed the form: nothing changes
    const r = parseRec(v[0], v[1], v[2], v[3], v[4]);
    if (r.err) { player.sendMessage(menuMsg(player, "§c[Warp] " + r.err)); return back(); }
    const err = w ? editWarpRec(player, w.n, r.rec) : addWarp(player, r.rec, false);
    player.sendMessage(menuMsg(player, err ? "§c[Warp] " + err : "§a[Warp] Warp §f" + r.rec.n + " §a" + (w ? "updated" : "added") + " §7(" + coords(r.rec) + ", " + dimLabel(r.rec.d) + ")"));
    back();
  });
}

// ---------------------------------------------------------------- pages
const infoLines = (w) => "§r§7" + dimLabel(w.d) + "\n§r§7" + coords(w);

/** admin list: pick a warp to edit or remove */
function pickPage(player, mode, back) {
  const a = load(), again = () => pickPage(player, mode, back), toPage = () => warpPage(player, back);
  const f = make(mode === "edit" ? "Edit a Warp" : "Remove a Warp", SHORT_ROWS); f.self = again;
  if (!can(player, "warps")) return toPage();
  a.slice(0, MAX).forEach((w, i) => {
    if (mode === "edit") set(f, i, hdr(1, "g") + "§e" + w.n + "\n" + infoLines(w) + "\n§r§eClick to edit", WARP_ICON, { run: () => warpForm(player, w, toPage) });
    else set(f, i, hdr(1, "r") + "§c" + w.n + "\n" + infoLines(w) + "\n§r§eClick to remove", WARP_ICON, {
      run: () => confirm(player, "Remove warp", ["§f" + w.n, "§7" + dimLabel(w.d) + " " + coords(w), "", "§cThis cannot be undone."],
        () => { const err = deleteWarp(player, w.n); player.sendMessage(menuMsg(player, err ? "§c[Warp] " + err : "§a[Warp] Removed §f" + w.n)); pickPage(player, mode, back); }, again),
    });
  });
  if (a.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7No warps yet\n§r§7Use §fAdd Warp §7first", WARP_ICON, null);
  backBtn(f, toPage); status(player, f);
  open(player, f);
}

/** the Warps page: every player sees the list; admins also get Add / Edit / Remove */
export function warpPage(player, back) {
  const a = load(), admin = can(player, "warps"), f = make("Warps §8(" + a.length + ")", SHORT_ROWS); f.self = () => warpPage(player, back);
  a.slice(0, MAX).forEach((w, i) => {
    set(f, i, hdr(1, "g") + "§a" + w.n + "\n" + infoLines(w) + "\n§r§eClick to teleport", WARP_ICON, { run: () => goWarp(player, w) });
  });
  if (a.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7No warps yet" + (admin ? "\n§r§7Use §fAdd Warp §7to create one" : ""), WARP_ICON, null);
  const base = (SHORT_ROWS - 1) * COLS;                               // button bar (last row): Back . Balance . [Refresh] [Add] [Edit] [Remove]
  if (admin) {
    set(f, base + 3, hdr(1, "g") + "§a§lAdd Warp\n§r§7Name + X Y Z + dimension\n§r§7(starts with your position)", NAV.ok, { run: () => warpForm(player, null, () => warpPage(player, back)) });
    set(f, base + 4, hdr(1) + "§e§lEdit Warp\n§r§7Change name, coordinates\n§r§7or dimension", WARP_ICON, { run: () => pickPage(player, "edit", back) });
    set(f, base + 5, hdr(1, "r") + "§c§lRemove Warp\n§r§7Delete a warp", NAV.no, { run: () => pickPage(player, "del", back) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- commands
//   /warp            -> opens the Warps menu (same page as SMP Menu > Warps)
//   /warp <name>     -> teleports to that warp
//   /setwarp <name>  -> (admin) creates a warp at your position
//   /deletewarp <name> -> (admin) deletes a warp
system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const asPlayer = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);
  const reg = (def, fn) => {
    try {
      cr.registerCommand({ permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, ...def }, (o, ...args) => {
        const p = asPlayer(o);
        if (!p) return OK;
        system.run(() => { try { fn(p, ...args); } catch (e) { console.warn("[warp] " + def.name + " failed: " + e); } });
        return OK;
      });
    } catch (e) { console.warn("[warp] " + def.name + " not registered: " + e); }
  };
  reg({ name: "smp:warp", description: "Warps: /warp (menu) | /warp <name> (teleport)", optionalParameters: [{ name: "name", type: CustomCommandParamType.String }] }, (p, name) => {
    const first = String(name ?? "").trim();
    if (!first) { luxCmd(p, "smp:warp", ""); return warpPage(p, () => dashboard(p)); }
    const w = find(first);
    if (!w) return p.sendMessage(menuMsg(p, "§c[Warp] There is no warp called " + clean(first) + ". §7Use §f/warp §7to see the list."));
    goWarp(p, w);
  });
  reg({ name: "smp:setwarp", description: "Admin: create a warp at your position", mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }] }, (p, name) => {
    luxCmd(p, "smp:setwarp", name);
    const err = setWarp(p, name);
    p.sendMessage(menuMsg(p, err ? "§c[Warp] " + err : "§a[Warp] Warp §f" + clean(name) + " §asaved at your position."));
  });
  reg({ name: "smp:deletewarp", description: "Admin: delete a warp", mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }] }, (p, name) => {
    luxCmd(p, "smp:deletewarp", name);
    const err = deleteWarp(p, name);
    p.sendMessage(menuMsg(p, err ? "§c[Warp] " + err : "§a[Warp] Deleted §f" + clean(name)));
  });
});
