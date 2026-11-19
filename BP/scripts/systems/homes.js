// Homes: /home opens a menu (teleport / add / delete), /sethome [name] saves quickly, /home <name> goes directly.
// Stored in the player's extra data (smp/store.js) as  homes: [{ n, x, y, z, d }]
import { ModalFormData } from "@minecraft/server-ui";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { ex } from "../smp/store.js";
import { HOME_MAX } from "./config.js";
import { canTeleport, stamp, teleportTo, teleportWithFx, dimLabel } from "./util.js";
import { showModal, textField, confirmShort as confirm } from "./forms.js";
import { luxSave } from "../lux.js";
import { inAfkZone, pointInAfkZone } from "./afk.js";
import { menuMsg, MenuForm } from "./menulang.js";

const BED = "textures/items/bed_red";
const list = (p) => (ex(p).homes ??= []);
const clean = (s) => String(s ?? "").replace(/[§\n\r]/g, "").trim().slice(0, 16);
const r1 = (n) => Math.round(n * 10) / 10;

export function goHome(player, h) {
  if (pointInAfkZone(h.d, h.x, h.y, h.z)) return player.sendMessage(menuMsg(player, "§c[Home] This home is inside the AFK area. You can't teleport there with /home. §7Use §f/afk§7."));
  if (!canTeleport(player, "home")) return;
  teleportWithFx(player, h, h.d, "home",                         // same swirl + sounds as /rtp
    () => player.sendMessage(menuMsg(player, "§a[Home] Teleported to §f" + h.n)),
    () => player.sendMessage(menuMsg(player, "§c[Home] Teleport failed.")));
}

/** adds (or, with replace, moves) a home at the player's position. returns an error text or null */
export function saveHome(player, nameRaw, replace = false) {
  if (inAfkZone(player)) return "You can't set a home inside the AFK area.";
  const name = clean(nameRaw) || "home", homes = list(player), at = homes.findIndex((h) => h.n.toLowerCase() === name.toLowerCase());
  const rec = { n: name, x: r1(player.location.x), y: r1(player.location.y), z: r1(player.location.z), d: player.dimension.id };
  if (at >= 0) { if (!replace) return "You already have a home called " + name + "."; homes[at] = rec; return null; }
  if (homes.length >= HOME_MAX) return "You reached the limit of " + HOME_MAX + " homes. Delete one first.";
  homes.push(rec);
  return null;
}
export const findHome = (player, nameRaw) => list(player).find((h) => h.n.toLowerCase() === clean(nameRaw).toLowerCase());

function addHome(player, back) {
  const form = new MenuForm().title("Add Home");
  textField(form, "§fName of the new home §7(max 16 characters)", "e.g. base");
  showModal(player, form, (v) => {
    if (!v) return homePage(player, back);
    const err = saveHome(player, v[0], false);
    player.sendMessage(menuMsg(player, err ? "§c[Home] " + err : "§a[Home] Home §f" + (clean(v[0]) || "home") + " §asaved at your position."));
    if (!err) luxSave(player);
    homePage(player, back);
  });
}

function homeList(player, mode, back) {
  const homes = list(player), again = () => homeList(player, mode, back);
  const f = make(mode === "tp" ? "Teleport to a Home" : "Delete a Home", SHORT_ROWS); f.self = again;
  homes.slice(0, 36).forEach((h, i) => {
    const info = "§r§7" + dimLabel(h.d) + "\n§r§7" + Math.floor(h.x) + ", " + Math.floor(h.y) + ", " + Math.floor(h.z);
    if (mode === "tp") set(f, i, hdr(1, "g") + "§a" + h.n + "\n" + info + "\n§r§eClick to teleport", BED, { run: () => goHome(player, h) });
    else set(f, i, hdr(1, "r") + "§c" + h.n + "\n" + info + "\n§r§eClick to delete", BED, {
      run: () => confirm(player, "Delete home", ["§f" + h.n, "§7" + dimLabel(h.d) + " " + Math.floor(h.x) + ", " + Math.floor(h.y) + ", " + Math.floor(h.z), "", "§cThis cannot be undone."],
        () => { const a = list(player), k = a.findIndex((x) => x.n === h.n); if (k >= 0) a.splice(k, 1); player.sendMessage(menuMsg(player, "§a[Home] Deleted §f" + h.n)); homeList(player, mode, back); }, again) });
  });
  if (homes.length === 0) set(f, 1 * COLS + 4, hdr(1) + "§7You have no homes yet\n§r§7Use §fAdd Home §7first", BED, null);
  backBtn(f, () => homePage(player, back)); status(player, f);
  open(player, f);
}

export function homePage(player, back) {
  const homes = list(player), f = make("Homes §8(" + homes.length + "/" + HOME_MAX + ")", SHORT_ROWS); f.self = () => homePage(player, back);
  set(f, 0 * COLS + 4, hdr(Math.max(1, homes.length)) + "§e§lYour Homes\n§r§7Saved: §f" + homes.length + "§7/§f" + HOME_MAX + "\n§r§7Quick save: §f/sethome <name>", BED, null);
  set(f, 2 * COLS + 2, hdr(1, "g") + "§a§lTeleport to Home\n§r§7Choose one of your homes", NAV.ok, { run: () => homeList(player, "tp", back) });
  set(f, 2 * COLS + 4, hdr(1) + "§b§lAdd Home\n§r§7Save your current position", BED, { run: () => addHome(player, back) });
  set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lDelete Home\n§r§7Remove a saved home", NAV.no, { run: () => homeList(player, "del", back) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
