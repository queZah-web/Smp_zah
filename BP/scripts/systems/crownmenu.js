// /menu -> Crowns : choose the crown you wear (Duel Arena Crown, Frost Crown) or take it off.
// A player wears one crown at a time.  The Duel Arena Crown belongs to the #1 in kills; the Frost Crown to the richest player ($100,000 by default; admin can set $10k - $5M).
// ADMIN (permission "duelset": Owner / Admin): an extra button opens the crown settings - rename a crown, set the kills needed, add / edit / remove EFFECTS
//   (every player who wears the crown gets them, the new #1 gets them at once), delete the crown, restore it or reset it.
import { ModalFormData } from "@minecraft/server-ui";
import { make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { showModal, confirmShort } from "./forms.js";
import { can } from "./staffcore.js";
import { money } from "../format.js";
import {
  KINDS, EFFECTS, MAX_FX, MAX_LEVEL, kindName, effectLabel, crownInfo, pickCrown, crownCfg, minKillsOf, crownHolder, frostCrownHolder,
  setCrownEffect, removeCrownEffect, clearCrownEffects, renameCrown, setCrownMin, setCrownEnabled, resetCrown,
} from "./crown.js";
import { menuMsg, MenuForm } from "./menulang.js";

export function crownPage(player, back, msg) {
  const f = make("Crowns", 5);
  f.self = () => crownPage(player, back);
  const again = (m) => crownPage(player, back, m);
  const info = crownInfo(player), has = (k) => info.owned.includes(k), cur = info.current;
  const D = KINDS.duel, F = KINDS.frost, dn = kindName("duel"), fn = kindName("frost");

  const choose = (k) => () => {
    const ok = pickCrown(player, k);
    again(ok ? (k === "none" ? "§cYou took your crown off." : "§aYou now wear the " + KINDS[k].color + kindName(k) + "§a.") : "§cYou do not own that crown.");
  };
  const fxLines = (k) => { const fx = crownCfg(k).fx; return fx.length ? "\n§r§7Effects: §f" + fx.map(effectLabel).join("§7, §f") : ""; };

  // info tile
  set(f, 0 * COLS + 4, hdr(1) + (msg ? msg + "\n§r§8" : "§e§lYour crown\n§r") + "§7Wearing now: " + (cur ? KINDS[cur].color + "§l" + kindName(cur) : "§fno crown") +
    "\n§r§7One crown at a time. Everybody can\n§r§7see it on your head.", cur ? KINDS[cur].icon : "textures/ui/shop/ic_help", null);

  // Duel Arena Crown (only the #1 in kills)
  if (has("duel")) {
    set(f, 2 * COLS + 2, hdr(1, cur === "duel" ? "g" : "c") + D.color + "§l" + dn + "\n§r§7Gold and red gems, sparks and lightning.\n§r§7You are the §e#1 §7in kills!" + fxLines("duel") + "\n§r" + (cur === "duel" ? "§aWearing now" : "§eClick to wear it"), D.icon, { run: choose("duel") });
  } else if (!info.on.duel) {
    set(f, 2 * COLS + 2, hdr(1) + D.color + "§l" + dn + " §r§8(removed)\n§r§7An admin removed this crown.", D.icon, null);
  } else {
    const h = info.holder;
    set(f, 2 * COLS + 2, hdr(1) + D.color + "§l" + dn + " §r§8(locked)\n§r§7Be the §e#1 §7in kills (at least §f" + info.duelMin + "§7)\n§r§7to win it from the others.\n§r§7Holder now: §f" + (h ? h.name : "nobody yet") + fxLines("duel"), D.icon, null);
  }

  // no crown
  set(f, 2 * COLS + 4, hdr(1, cur === null ? "g" : "c") + "§c§lNo crown\n§r§7Take your crown off\n§r" + (cur === null ? "§aSelected" : "§eClick to take it off"), NAV.no, { run: choose("none") });

  // Frost Crown (every player, or the kills set for it)
  if (has("frost")) {
    set(f, 2 * COLS + 6, hdr(1, cur === "frost" ? "g" : "c") + F.color + "§l" + fn + "\n§r§7Silver and ice blue, ice spikes.\n§r§7You are the §brichest §7player!" + fxLines("frost") + "\n§r" + (cur === "frost" ? "§aWearing now" : "§eClick to wear it"), F.icon, { run: choose("frost") });
  } else if (!info.on.frost) {
    set(f, 2 * COLS + 6, hdr(1) + F.color + "§l" + fn + " §r§8(removed)\n§r§7An admin removed this crown.", F.icon, null);
  } else {
    set(f, 2 * COLS + 6, hdr(1) + F.color + "§l" + fn + " §r§8(locked)\n§r§7Be the §brichest §7player (at least §a" + money(info.frostMin) + "§7)\n§r§7to win it from the others.\n§r§7Holder now: §f" + (info.frostHolder ? info.frostHolder.name : "nobody yet") + fxLines("frost"), F.icon, null);
  }

  // admin only: the button is not even shown to other players (and every action below checks the permission again)
  if (can(player, "duelset")) {
    set(f, 3 * COLS + 4, hdr(1, "r") + "§c§lAdmin: crowns\n§r§7Edit the crowns, add effects,\n§r§7delete or restore them\n§r§8Only Owner / Admin see this", "textures/ui/shop/ic_gear", { run: () => adminPage(player, () => crownPage(player, back)) });
  }

  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

const KINDS_LIST = ["duel", "frost"];
// ================================================================ admin: choose the crown to edit
function adminPage(player, back, msg) {
  if (!can(player, "duelset")) return back();
  const f = make("Crown settings", 5);
  f.self = () => adminPage(player, back);
  set(f, 0 * COLS + 4, hdr(1) + (msg ? msg + "\n§r§8" : "§c§lCrown settings\n§r") + "§7Choose the crown you want to edit.\n§r§7Effects you add are given to every\n§r§7player who wears that crown.", "textures/ui/shop/ic_gear", null);
  KINDS_LIST.forEach((k, i) => {
    const c = crownCfg(k), K = KINDS[k], h = crownHolder();
    set(f, 2 * COLS + 2 + i * 4, hdr(Math.max(1, c.fx.length), c.on ? "c" : "r") + K.color + "§l" + kindName(k) + "\n§r" + (c.on ? "§aActive" : "§cDeleted") + " §8| §7Effects: §f" + c.fx.length +
      (k === "duel" ? "\n§r§7Kills needed: §f" + minKillsOf(k) + "\n§r§7Holder: §f" + (h ? h.name : "nobody") : "\n§r§7Money needed: §a" + money(minKillsOf(k)) + "\n§r§7Richest: §f" + (frostCrownHolder()?.name ?? "nobody")) + "\n§r§eClick to edit", K.icon, { run: () => editPage(player, k, () => adminPage(player, back)) });
  });
  backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ admin: one crown (effects, name, kills, delete)
const FX_SLOTS = [1, 2, 3, 4, 5, 6, 7].flatMap((c) => [1 * COLS + c, 2 * COLS + c]).sort((a, b) => a - b);   // 14 slots: chest rows 2 and 3 (the effects); row 4 = tools, row 1 = info

function editPage(player, kind, back, msg) {
  if (!can(player, "duelset")) return back();
  const c = crownCfg(kind), K = KINDS[kind];
  const f = make("Crown: " + kindName(kind).slice(0, 20), 5);
  f.self = () => editPage(player, kind, back);

  set(f, 0 * COLS + 4, hdr(1) + (msg ? msg + "\n§r§8" : K.color + "§l" + kindName(kind) + "\n§r") + "§7Status: " + (c.on ? "§aActive" : "§cDeleted (nobody wears it)") +
    "\n§r§7" + (kind === "duel" ? "Kills needed: §f" + minKillsOf(kind) : "Money needed: §a" + money(minKillsOf(kind))) + " §8| §7Effects: §f" + c.fx.length + "§7/§f" + MAX_FX, K.icon, null);

  // the effects (click one to change its level or remove it)
  c.fx.forEach((e, i) => {
    if (i >= FX_SLOTS.length) return;
    set(f, FX_SLOTS[i], hdr(e.lvl) + "§b§l" + effectLabel(e) + "\n§r§7Given to everybody who wears\n§r§7this crown.\n§r§eClick to edit or remove", "textures/items/potion_bottle_drinkable", { run: () => effectForm(player, kind, e, () => editPage(player, kind, back)) });
  });
  if (!c.fx.length) set(f, 1 * COLS + 4, hdr(1) + "§7No effects yet\n§r§7Use §aAdd effect §7below.", "textures/ui/shop/ic_help", null);

  // bottom row of tools
  if (c.fx.length < MAX_FX) set(f, 3 * COLS + 1, hdr(1, "g") + "§a§lAdd effect\n§r§7Speed, Strength, Haste, Regeneration...", NAV.ok, { run: () => addForm(player, kind, () => editPage(player, kind, back)) });
  else set(f, 3 * COLS + 1, hdr(1) + "§7§lAdd effect\n§r§cThe crown is full (" + MAX_FX + " effects)", NAV.no, null);
  set(f, 3 * COLS + 3, hdr(1) + "§e§lRename\n§r§7Change the name of the crown", "textures/items/name_tag", { run: () => renameForm(player, kind, () => editPage(player, kind, back)) });
  set(f, 3 * COLS + 5, hdr(1) + (kind === "duel" ? "§6§lKills needed\n§r§7Now: §f" + minKillsOf(kind) + "\n§r§7Minimum kills for the #1" : "§6§lMoney needed\n§r§7Now: §a" + money(minKillsOf(kind)) + "\n§r§7Min for the richest ($10k - $5M)"), "textures/items/iron_sword", { run: () => minForm(player, kind, () => editPage(player, kind, back)) });
  if (c.on) {
    set(f, 3 * COLS + 7, hdr(1, "r") + "§c§lDelete crown\n§r§7Nobody wears it and the effects stop.\n§r§7You can restore it later.", NAV.no, {
      run: () => confirmShort(player, "Delete the crown?", ["§7" + K.color + kindName(kind), "§7Everybody loses it and its effects.", "§7You can restore it any time."],
        () => { const r = setCrownEnabled(player, kind, false); editPage(player, kind, back, r.err ? "§c" + r.err : "§cThe crown was deleted."); }, () => editPage(player, kind, back)),
    });
  } else {
    set(f, 3 * COLS + 7, hdr(1, "g") + "§a§lRestore crown\n§r§7Bring the crown back with its\n§r§7effects.", NAV.ok, { run: () => { const r = setCrownEnabled(player, kind, true); editPage(player, kind, back, r.err ? "§c" + r.err : "§aThe crown is back."); } });
  }
  // small extras in the top corners
  if (c.fx.length) set(f, 0 * COLS + 2, hdr(1, "r") + "§c§lRemove all effects\n§r§7Clear the whole effect list", "textures/ui/shop/ic_cancel", {
    run: () => confirmShort(player, "Remove all effects?", ["§7" + K.color + kindName(kind), "§7The crown keeps its name and kills."],
      () => { const r = clearCrownEffects(player, kind); editPage(player, kind, back, r.err ? "§c" + r.err : "§aAll effects removed."); }, () => editPage(player, kind, back)),
  });
  set(f, 0 * COLS + 6, hdr(1, "r") + "§c§lReset crown\n§r§7Back to the original crown:\n§r§7no effects, normal name and kills", "textures/ui/shop/key_refresh", {
    run: () => confirmShort(player, "Reset the crown?", ["§7" + K.color + kindName(kind), "§7Name, kills and effects go back to normal."],
      () => { const r = resetCrown(player, kind); editPage(player, kind, back, r.err ? "§c" + r.err : "§aThe crown was reset."); }, () => editPage(player, kind, back)),
  });
  backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ---------------------------------------------------------------- the forms (modal)
const slider = (form, label, min, max, def) => { try { form.slider(label, min, max, { defaultValue: def, valueStep: 1 }); } catch (e) { form.slider(label, min, max, 1, def); } };
const field = (form, label, ph, def) => { try { form.textField(label, ph, { defaultValue: String(def ?? "") }); } catch (e) { form.textField(label, ph, String(def ?? "")); } };
const drop = (form, label, items, idx) => { try { form.dropdown(label, items, { defaultValueIndex: idx }); } catch (e) { form.dropdown(label, items, idx); } };
const toggle = (form, label, def) => { try { form.toggle(label, { defaultValue: def }); } catch (e) { form.toggle(label, def); } };

function addForm(player, kind, back) {
  const form = new MenuForm().title("Add an effect");
  drop(form, "§fEffect", EFFECTS.map((e) => e[1]), 0);
  slider(form, "§fLevel (1 = I, 2 = II ...)", 1, MAX_LEVEL, 1);
  showModal(player, form, (v) => {
    if (!v) return back();
    const eff = EFFECTS[Number(v[0])];
    const r = eff ? setCrownEffect(player, kind, eff[0], Number(v[1])) : { err: "Unknown effect." };
    if (r.err) player.sendMessage(menuMsg(player, "§c[Crown] " + r.err)); else player.sendMessage(menuMsg(player, "§6[Crown] §a" + eff[1] + " §fadded to the crown. Everybody who wears it has it now."));
    back();
  });
}
function effectForm(player, kind, e, back) {
  const form = new MenuForm().title(effectLabel(e));
  slider(form, "§fLevel (1 = I, 2 = II ...)", 1, MAX_LEVEL, e.lvl);
  toggle(form, "§cRemove this effect from the crown", false);
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = v[1] ? removeCrownEffect(player, kind, e.id) : setCrownEffect(player, kind, e.id, Number(v[0]));
    player.sendMessage(menuMsg(player, r.err ? "§c[Crown] " + r.err : v[1] ? "§6[Crown] §cEffect removed from the crown." : "§6[Crown] §aEffect updated for everybody who wears the crown."));
    back();
  });
}
function renameForm(player, kind, back) {
  const form = new MenuForm().title("Rename the crown");
  field(form, "§fNew name (empty = the original name)", KINDS[kind].name, crownCfg(kind).name ?? "");
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = renameCrown(player, kind, v[0]);
    player.sendMessage(menuMsg(player, r.err ? "§c[Crown] " + r.err : "§6[Crown] §aName saved."));
    back();
  });
}
function minForm(player, kind, back) {
  const form = new MenuForm().title(kind === "duel" ? "Kills needed" : "Money needed");
  field(form, kind === "duel" ? "§fMinimum kills the #1 needs to get the crown" : "§fMoney the richest player needs (10000 - 5000000)", "whole number", minKillsOf(kind));
  showModal(player, form, (v) => {
    if (!v) return back();
    const txt = String(v[0] ?? "").trim().replace(/[,$\s]/g, "");
    const r = /^\d+$/.test(txt) ? setCrownMin(player, kind, Number(txt)) : { err: "Enter a whole number." };
    player.sendMessage(menuMsg(player, r.err ? "§c[Crown] " + r.err : "§6[Crown] §aSaved."));
    back();
  });
}
