// OPERATOR > EVENTS: the pages (chest style, same look as the rest of /opr).  The data and the rules are in events.js; every action there checks the
// operator's permission "events" again, so an old open screen can never do more than the operator is allowed to.  opmenu.js adds the category.
import { world } from "@minecraft/server";
import { makeOpr as make, set, open, hdr, COLS, NAV, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { showModal, textField, dropdown, confirmOpr as confirm } from "./forms.js";
import { knownPlayers } from "../data.js";
import { allow, isOwner } from "./staffcore.js";
import { stadiumHook, tntHook, squidHook, dropperHook, pillarsHook, pillars1Hook, colorHook, spleefHook, skywarsHook, eggwarsHook, luckyHook } from "./spawnbuild.js";
import { isStaff } from "./opcore.js";
import { oprMsg, OprForm } from "./oprlang.js";
import {
  TYPES, typeKeysFor, RULES, EV, listEvents, getEvent, activeCount, waitingCount, hasArea, fmt, placeText, ruleNames, statusOf, beforeHurtOk,
  createEvent, deleteEvent, renameEvent, changeType, setRule, setAreaSquare, setCorner, clearArea, setSpot, gotoEvent, setDuration, startEvent, stopEvent,
  setMode, addPlayer, removePlayer, addOnline, clearPlayers, bringParticipants, announceEvent,
} from "./events.js";

const ICON = {
  crown: "textures/ui/shop/x_firework_star", paper: "textures/items/paper", book: "textures/items/book_writable", compass: "textures/items/compass_item", clock: "textures/items/clock_item",
  prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", barrier: "textures/ui/shop/ic_cancel", search: "textures/ui/shop/key_search", player: NAV.player,
  pearl: "textures/items/ender_pearl", tag: "textures/items/name_tag", map: "textures/items/map_filled", mail: "textures/ui/shop/ic_mail", gear: "textures/ui/shop/ic_gear",
};
const say = (p, msg) => { try { p.sendMessage(oprMsg(p, msg)); } catch (e) { /* ignore */ } };
const reply = (p, r, okMsg) => say(p, r && r.ok ? "§a[Operator] " + okMsg : "§c[Operator] " + ((r && r.err) || "That did not work."));
const guard = (p) => { if (!isStaff(p)) { say(p, "§c[Operator] Operators only."); return false; } return allow(p, "events"); };
const gone = (p, back) => { say(p, "§c[Operator] That event does not exist any more."); back(); };

// ================================================================ generic list page (9 rows, 72 per page, paging + extra buttons on the bottom row)
function lister(player, title, items, page, back, self, extras = []) {
  const PER = 72, pages = Math.max(1, Math.ceil(items.length / PER)), pg = Math.min(Math.max(0, page), pages - 1);
  const f = make(title + " §8(" + items.length + ")", 9); f.self = () => self(pg); f.glass = true;
  items.slice(pg * PER, pg * PER + PER).forEach((it, i) => set(f, i, hdr(it.n ?? 1, it.zone ?? "c") + it.text, it.icon ?? NAV.page, it.run ? { run: it.run } : null));
  if (!items.length) set(f, 3 * COLS + 4, hdr(1) + "§7Nothing here", ICON.paper, null);
  const base = 8 * COLS;
  if (pg > 0) set(f, base + 3, hdr(1) + "§e§lPrevious page", ICON.prev, { run: () => self(pg - 1) });
  if (pages > 1) set(f, base + 4, hdr(1) + "§fPage " + (pg + 1) + "§7/§f" + pages, NAV.page, null);
  if (pg < pages - 1) set(f, base + 5, hdr(1) + "§e§lNext page", ICON.next, { run: () => self(pg + 1) });
  for (const [k, text, icon, run] of extras) set(f, base + k, text, icon, { run });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const eventItem = (e, run) => {
  const t = TYPES[e.k] ?? TYPES.general, s = statusOf(e);
  return { zone: s.zone, icon: t.icon, text: "§e§l" + e.n + "\n§r" + t.col + t.name + "\n§r§7Status: " + s.line + "\n§r§7Place: §f" + placeText(e) + "\n§r§eClick to open", run };
};
/** choose an event, then run(e).  With only one event (that fits the filter) it is taken at once. */
function pickEvent(player, back, title, run, filter, page = 0) {
  const evs = listEvents().filter(filter ?? (() => true));
  if (!evs.length) { say(player, "§e[Operator] " + (filter ? "No event is running or scheduled." : "There is no event yet. Create one first.")); return back(); }
  if (evs.length === 1) return run(evs[0]);
  lister(player, title, evs.map((e) => eventItem(e, () => run(e))), page, back, (pg) => pickEvent(player, back, title, run, filter, pg));
}

// ================================================================ the hub: the 8 options of the category
/** called by opmenu.js to fill the Events category page (row 1 + row 2) */
export function hubButtons(f, player, self) {
  if (!guard(player)) return;
  const evs = listEvents(), on = activeCount(), wait = waitingCount();
  set(f, 0 * COLS + 4, hdr(Math.min(99, Math.max(1, on)), on ? "g" : "c") + "§6§lEvents now\n§r§7Running: §f" + on + "\n§r§7Scheduled: §f" + wait + "\n§r§7Saved events: §f" + evs.length + "§7/§f" + EV.maxEvents, ICON.crown, null);
  set(f, 1 * COLS + 4, hdr(Math.min(99, Math.max(1, evs.length))) + "§b§lManage events\n§r§7Current and coming events\n§r§7Click one to control it\n§r§eClick to open", ICON.book, { run: () => eventsListPage(player, self) });
  set(f, 1 * COLS + 2, hdr(1, "g") + "§a§lCreate an event\n§r§7A new event with a name\n§r§7and a type (safe zone, arena...)\n§r§eClick to create", ICON.tag, { run: () => createForm(player, self) });
  set(f, 2 * COLS + 2, hdr(1) + "§a§lAreas\n§r§7Where the event is: the borders,\n§r§7the spot and the corners\n§r§eClick to choose an event", ICON.map, { run: () => pickEvent(player, self, "Choose the event", (e) => areaPage(player, e.i, self)) });
  set(f, 2 * COLS + 3, hdr(1) + "§e§lEvent rules\n§r§7Keep Inventory, no PvP, no damage,\n§r§7no building, time, weather...\n§r§eClick to choose an event", NAV.page, { run: () => pickEvent(player, self, "Choose the event", (e) => rulesPage(player, e.i, self)) });
  set(f, 2 * COLS + 4, hdr(1) + "§b§lEvent time\n§r§7When it starts and how long it lasts\n§r§eClick to choose an event", ICON.clock, { run: () => pickEvent(player, self, "Choose the event", (e) => durationForm(player, e.i, self)) });
  set(f, 2 * COLS + 5, hdr(1) + "§d§lParticipants\n§r§7Everybody in the area, or only\n§r§7the players you choose\n§r§eClick to choose an event", ICON.player, { run: () => pickEvent(player, self, "Choose the event", (e) => playersPage(player, e.i, self)) });
  set(f, 2 * COLS + 6, hdr(1) + "§6§lAnnounce an event\n§r§7Tell all the players (chat + title)\n§r§eClick to choose an event", ICON.mail, { run: () => pickEvent(player, self, "Choose the event", (e) => announceForm(player, e.i, self)) });
  set(f, 1 * COLS + 6, hdr(1, on || wait ? "r" : "c") + "§c§lStop an event\n§r§7Ends it and puts every setting\n§r§7back to normal\n§r§eClick to choose an event", ICON.barrier, { run: () => pickEvent(player, self, "Stop which event?", (e) => stopConfirm(player, e, self), (e) => e.st !== "off") });
  if (isOwner(player)) set(f, 3 * COLS + 2, hdr(1, "g") + "§a§lFootball\n§r§7A match in the stadium: teams,\n§r§7kits, the sulfur cube ball, goals\n§r§eClick to open", "textures/items/slime_ball", { run: () => { try { stadiumHook.page(player, self); } catch (e) { say(player, "§c[Football] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 3, hdr(1, "g") + "§c§lTNT Run\n§r§7The floors fall under your feet:\n§r§74 layers, last one standing wins\n§r§eClick to open", "textures/blocks/tnt_side", { run: () => { try { tntHook.page(player, self); } catch (e) { say(player, "§c[TNT Run] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 5, hdr(1, "g") + "§d§lRed Light\n§r§7Red Light, Green Light: run on\n§r§7green, freeze on red (the doll)\n§r§eClick to open", "textures/items/dye_powder_pink", { run: () => { try { squidHook.page(player, self); } catch (e) { say(player, "§c[Red Light] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 7, hdr(1, "g") + "§d§lDropper\n§r§7Fall down the tower, land in\n§r§7the water: 7 stages, 3 winners\n§r§eClick to open", "textures/items/feather", { run: () => { try { dropperHook.page(player, self); } catch (e) { say(player, "§c[Dropper] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 1, hdr(1, "g") + "§6§lPillars\n§r§7Pillars of Fortune: random items,\n§r§7last one standing on the pillars\n§r§eClick to open", "textures/items/gold_ingot", { run: () => { try { pillarsHook.page(player, self); } catch (e) { say(player, "§c[Pillars] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 8, hdr(1, "g") + "§e§lPillars 1x1\n§r§7Pillars of Fortune on pillars\n§r§7of ONE block (hard)\n§r§eClick to open", "textures/items/gold_nugget", { run: () => { try { pillars1Hook.page(player, self); } catch (e) { say(player, "§c[Pillars 1x1] " + e); } } });
  if (isOwner(player)) set(f, 3 * COLS + 0, hdr(1, "g") + "§d§lColor Rush\n§r§7A colour is called: run onto it,\n§r§7the rest of the floor vanishes\n§r§eClick to open", "textures/blocks/wool_colored_magenta", { run: () => { try { colorHook.page(player, self); } catch (e) { say(player, "§c[Color Rush] " + e); } } });
  if (isOwner(player)) set(f, 0 * COLS + 8, hdr(1, "g") + "§e§lLucky Wars\n§r§7Lucky blocks on sky islands:\n§r§7break one = a surprise\n§r§eClick to open", "textures/blocks/glazed_terracotta_yellow", { run: () => { try { luckyHook.page(player, self); } catch (e) { /* ignore */ } } });
  if (isOwner(player)) set(f, 0 * COLS + 6, hdr(1, "g") + "§e§lEgg Wars\n§r§7Protect your egg, generators,\n§r§7villager shop, break the eggs\n§r§eClick to open", "textures/items/egg", { run: () => { try { eggwarsHook.page(player, self); } catch (e) { /* ignore */ } } });
  if (isOwner(player)) set(f, 0 * COLS + 7, hdr(1, "g") + "§b§lSky Wars\n§r§7Islands in the sky, random loot,\n§r§7last one alive wins\n§r§eClick to open", "textures/items/diamond_sword", { run: () => { try { skywarsHook.page(player, self); } catch (e) { console.warn("[events] skywars: " + e); } } });
  if (isOwner(player)) set(f, 0 * COLS + 1, hdr(1, "g") + "§b§lSpleef\n§r§7Dig the snow under the others with\n§r§7a shovel - the last one up wins\n§r§eClick to open", "textures/items/diamond_shovel", { run: () => { try { spleefHook.page(player, self); } catch (e) { console.warn("[events] spleef: " + e); } } });
  set(f, 3 * COLS + 4, hdr(1) + "§7§lGood to know\n§r§7Operators and duel players are never\n§r§7touched by the rules.\n§r§7Stopping an event restores the time,\n§r§7the weather and the game modes.\n§r§7Stop-the-death rules: " + (beforeHurtOk() ? "§aavailable" : "§cnot available here"), ICON.paper, null);
}

// ================================================================ the list of events
export function eventsListPage(player, back, page = 0) {
  if (!guard(player)) return back();
  const evs = listEvents().slice().sort((a, b) => (b.st === "on" ? 2 : b.st === "wait" ? 1 : 0) - (a.st === "on" ? 2 : a.st === "wait" ? 1 : 0) || a.t - b.t);
  lister(player, "Events", evs.map((e) => eventItem(e, () => eventPage(player, e.i, () => eventsListPage(player, back, page)))), page, back, (pg) => eventsListPage(player, back, pg),
    [[7, hdr(1, "g") + "§a§lCreate an event\n§r§7A new event", ICON.tag, () => createForm(player, () => eventsListPage(player, back, page))]]);
}

// ================================================================ one event
export function eventPage(player, id, back) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const self = () => eventPage(player, id, back), t = TYPES[e.k] ?? TYPES.general, s = statusOf(e), rn = ruleNames(e);
  const f = make("Event: " + e.n, SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 4, hdr(1, s.zone) + t.col + "§l" + e.n + "\n§r§7Type: " + t.col + t.name + "\n§r§7Status: " + s.line + "\n§r§7Place: §f" + placeText(e) + "\n§r§7Length: §f" + (e.len ? fmt(e.len * 60000) : "until stopped") + "\n§r§7Participants: §f" + (e.mode === "list" ? e.pl.length + " chosen" : "everybody"), t.icon, null);
  set(f, 1 * COLS + 1, hdr(Math.min(99, Math.max(1, rn.length)), rn.length ? "g" : "c") + "§e§lRules\n§r§7Switched on: §f" + rn.length + "\n§r§7Keep Inventory, no PvP, no damage...\n§r§eClick to open", NAV.page, { run: () => rulesPage(player, id, self) });
  set(f, 1 * COLS + 3, hdr(1, hasArea(e) ? "c" : "r") + "§a§lArea\n§r§7" + placeText(e) + "\n§r§7Borders, corners and the event spot\n§r§eClick to open", ICON.map, { run: () => areaPage(player, id, self) });
  set(f, 1 * COLS + 5, hdr(1) + "§b§lTime\n§r§7Start in / lasts\n§r§7Now: §f" + (e.len ? fmt(e.len * 60000) : "until stopped") + "\n§r§eClick to change", ICON.clock, { run: () => durationForm(player, id, self) });
  set(f, 1 * COLS + 7, hdr(1) + "§d§lParticipants\n§r§7Now: §f" + (e.mode === "list" ? "only " + e.pl.length + " chosen" : "everybody") + "\n§r§eClick to open", ICON.player, { run: () => playersPage(player, id, self) });
  set(f, 2 * COLS + 1, hdr(1) + "§6§lAnnounce\n§r§7Tell all the players about it\n§r§eClick to announce", ICON.mail, { run: () => announceForm(player, id, self) });
  if (e.st === "off") set(f, 2 * COLS + 3, hdr(1, "g") + "§a§lStart now\n§r§7The rules start working\n§r§7inside the area\n§r§eClick to start", "textures/items/emerald", { run: () => { reply(player, startEvent(player, id), "Event started."); self(); } });
  else if (e.st === "wait") set(f, 2 * COLS + 3, hdr(1, "r") + "§c§lCancel the schedule\n§r§7It will not start by itself\n§r§eClick to cancel", ICON.barrier, { run: () => { reply(player, stopEvent(player, id), "Schedule cancelled."); self(); } });
  else set(f, 2 * COLS + 3, hdr(1, "r") + "§c§lStop the event\n§r§7Ends it and puts everything\n§r§7back to normal\n§r§eClick to stop", ICON.barrier, { run: () => stopConfirm(player, e, self) });
  set(f, 2 * COLS + 5, hdr(1, e.st === "on" ? "g" : "c") + "§d§lTeleport the participants\n§r§7Online participants go to the\n§r§7event spot now (the event must run)\n§r§eClick to teleport", ICON.pearl, { run: () => confirm(player, "Teleport the participants?", ["§7Every online participant goes to the event spot."], () => { const r = bringParticipants(player, id); reply(player, r, "Teleported " + (r.n ?? 0) + " player" + (r.n === 1 ? "" : "s") + "."); self(); }, self) });
  set(f, 2 * COLS + 7, hdr(1) + "§b§lGo to the event\n§r§7Teleports you to its spot\n§r§eClick to go", ICON.compass, { run: () => { reply(player, gotoEvent(player, id), "Teleported to the event."); self(); } });
  set(f, 3 * COLS + 1, hdr(1) + "§e§lRename\n§r§7Change the name\n§r§eClick to rename", ICON.tag, { run: () => renameForm(player, id, self) });
  set(f, 3 * COLS + 3, hdr(1) + "§e§lChange the type\n§r§7Now: " + t.col + t.name + "\n§r§7The rules are set again\n§r§eClick to change", t.icon, { run: () => typeForm(player, id, self) });
  set(f, 3 * COLS + 5, hdr(1, "r") + "§c§lDelete the event\n§r§7Removes it for ever\n§r§eClick to delete", ICON.barrier, { run: () => confirm(player, "Delete this event?", ["§7" + e.n, "§7(a running event is stopped first)"], () => { reply(player, deleteEvent(player, id), "Event deleted."); back(); }, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function stopConfirm(player, e, back) {
  confirm(player, "Stop this event?", ["§7" + e.n, "§7Everything is put back to normal."], () => { reply(player, stopEvent(player, e.i), "Event stopped."); back(); }, back);
}

// ================================================================ forms
function createForm(player, back) {
  if (!guard(player)) return back();
  const form = new OprForm().title("Create an event");
  textField(form, "§fName of the event §7(2-" + EV.nameMax + " letters)", "e.g. Spleef night");
  const keys = typeKeysFor(player);
  dropdown(form, "§fType", keys.map((k) => TYPES[k].name));
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = createEvent(player, String(v[0] ?? ""), keys[Number(v[1])] ?? "general");
    if (r.ok) { say(player, "§a[Operator] Event created: §f" + r.event.n + " §7- now set its area."); eventPage(player, r.event.i, back); }
    else { say(player, "§c[Operator] " + r.err); back(); }
  });
}
function renameForm(player, id, back) {
  const e = getEvent(id); if (!e) return gone(player, back);
  const form = new OprForm().title("Rename the event");
  try { form.textField("§fNew name", "2-" + EV.nameMax + " letters", { defaultValue: e.n }); } catch (err) { form.textField("§fNew name", "2-" + EV.nameMax + " letters", e.n); }
  showModal(player, form, (v) => { if (!v) return back(); reply(player, renameEvent(player, id, String(v[0] ?? "")), "Event renamed."); back(); });
}
function typeForm(player, id, back) {
  const e = getEvent(id); if (!e) return gone(player, back);
  const form = new OprForm().title("Change the type (sets the rules again)");
  const keys = typeKeysFor(player);
  dropdown(form, "§fType", keys.map((k) => TYPES[k].name));
  showModal(player, form, (v) => { if (!v) return back(); reply(player, changeType(player, id, keys[Number(v[0])] ?? e.k), "Type changed. The rules were set for the new type."); back(); });
}
const minutesOf = (v) => { const t = String(v ?? "").trim(); return t === "" || !/^\d{1,5}$/.test(t) ? NaN : Number(t); };
function minutesField(form, label, def) {
  try { form.textField(label, "whole number, e.g. 30", { defaultValue: String(def) }); } catch (e) { form.textField(label, "whole number, e.g. 30", String(def)); }
}
export function durationForm(player, id, back) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const form = new OprForm().title("Event time");
  minutesField(form, "§fStart in how many minutes? §7(0 = I start it myself, needs the area first)", 0);
  minutesField(form, "§fHow long does it last? §7(minutes, 0 = until I stop it)", e.len);
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = setDuration(player, id, minutesOf(v[0]), minutesOf(v[1]));
    reply(player, r, r.scheduled ? "The event is scheduled." : "Time saved.");
    back();
  });
}
function announceForm(player, id, back) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const form = new OprForm().title("Announce the event");
  textField(form, "§fExtra message §7(optional, shown to everybody)", "e.g. Prizes for the winners!");
  showModal(player, form, (v) => {
    if (!v) return back();
    const r = announceEvent(player, id, String(v[0] ?? ""));
    reply(player, r, "Announced to " + (r.n ?? 0) + " player" + (r.n === 1 ? "" : "s") + ".");
    back();
  });
}

// ================================================================ the rules
export function rulesPage(player, id, back) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const self = () => rulesPage(player, id, back), t = TYPES[e.k] ?? TYPES.general, s = statusOf(e);
  const f = make("Rules: " + e.n, SHORT_ROWS); f.self = self; f.glass = true;
  set(f, 4, hdr(1, s.zone) + t.col + "§l" + e.n + "\n§r§7Status: " + s.line + "\n§r§7Click a rule to switch it\n§r§7" + (e.st === "on" ? "Changes work at once" : "The rules work when the event runs"), t.icon, null);
  RULES.forEach((r, i) => {
    const v = e.r[r.k], on = r.values ? v > 0 : !!v, slot = (1 + Math.floor(i / 4)) * COLS + [1, 3, 5, 7][i % 4];
    const now = r.values ? (v ? "§a" + r.values[v] : "§cOff") : (on ? "§aON" : "§cOFF");
    const warn = r.k === "restore" && !on ? "\n§r§cOFF: the time / weather lock and\n§r§cAdventure mode stay after the event" : "";
    set(f, slot, hdr(1, on ? "g" : "c") + (on ? "§a§l" : "§7§l") + r.name + "\n§r§7Now: " + now + "\n§r§7" + r.info.split("\n").join("\n§r§7") + warn + "\n§r§eClick to " + (r.values ? "change" : "switch"), r.icon, {
      run: () => { reply(player, setRule(player, id, r.k, r.values ? (v + 1) % r.values.length : v ? 0 : 1), r.name + " changed."); self(); },
    });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ================================================================ the area
export function areaPage(player, id, back) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const self = () => areaPage(player, id, back), t = TYPES[e.k] ?? TYPES.general, s = statusOf(e);
  const f = make("Area: " + e.n, SHORT_ROWS); f.self = self; f.glass = true;
  const c = (k) => (e[k] ? "§f" + e[k].x + ", " + e[k].z : "§7not set");
  set(f, 4, hdr(1, hasArea(e) ? "g" : "r") + t.col + "§l" + e.n + "\n§r§7Status: " + s.line + "\n§r§7Area: §f" + placeText(e) + "\n§r§7Corner 1: " + c("c1") + "\n§r§7Corner 2: " + c("c2") + "\n§r§7Spot: " + (e.sp ? "§f" + Math.floor(e.sp.x) + ", " + Math.floor(e.sp.y) + ", " + Math.floor(e.sp.z) : "§7the middle of the area"), t.icon, null);
  set(f, 1 * COLS + 1, hdr(1, "g") + "§a§lSquare around me\n§r§7A square area with you in the\n§r§7middle (whole height)\n§r§eClick to choose the size", ICON.map, { run: () => squareForm(player, id, self) });
  set(f, 1 * COLS + 3, hdr(1) + "§e§lCorner 1 here\n§r§7Stand on the first corner\n§r§eClick to save it", "textures/items/stick", { run: () => { reply(player, setCorner(player, id, 1), "Corner 1 saved."); self(); } });
  set(f, 1 * COLS + 5, hdr(1) + "§e§lCorner 2 here\n§r§7Stand on the opposite corner,\n§r§7the area is made from the two corners\n§r§eClick to save it", "textures/items/stick", { run: () => { const r = setCorner(player, id, 2); reply(player, r, r.done ? "Area saved from the two corners." : "Corner 2 saved. Now set corner 1."); self(); } });
  set(f, 1 * COLS + 7, hdr(1) + "§b§lEvent spot here\n§r§7Where players are teleported and\n§r§7brought back when they are knocked out\n§r§7(stand inside the area)\n§r§eClick to save it", ICON.pearl, { run: () => { reply(player, setSpot(player, id), "Event spot saved."); self(); } });
  set(f, 2 * COLS + 3, hdr(1) + "§b§lGo to the event\n§r§7Teleports you there\n§r§eClick to go", ICON.compass, { run: () => { reply(player, gotoEvent(player, id), "Teleported to the event."); self(); } });
  set(f, 2 * COLS + 5, hdr(1, "r") + "§c§lClear the area\n§r§7Removes the area, the corners\n§r§7and the spot\n§r§eClick to clear", ICON.barrier, { run: () => confirm(player, "Clear the area?", ["§7" + e.n, "§7The area, the corners and the spot are removed."], () => { reply(player, clearArea(player, id), "Area cleared."); self(); }, self) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
function squareForm(player, id, back) {
  if (!guard(player)) return back();
  const form = new OprForm().title("Square around you");
  dropdown(form, "§fSize (a square, you are in the middle)", EV.radii.map((r) => r * 2 + " x " + r * 2 + " blocks"));
  showModal(player, form, (v) => { if (!v) return back(); reply(player, setAreaSquare(player, id, EV.radii[Number(v[0])] ?? EV.radii[0]), "Area saved."); back(); });
}

// ================================================================ the participants
export function playersPage(player, id, back, page = 0) {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const self = (pg = 0) => playersPage(player, id, back, pg), live = new Set(world.getAllPlayers().map((p) => p.id));
  const items = e.pl.slice().sort((a, b) => a.n.localeCompare(b.n)).map((x) => ({
    zone: live.has(x.i) ? "g" : "c", icon: ICON.player,
    text: (live.has(x.i) ? "§a§l" : "§7§l") + x.n + "\n§r" + (live.has(x.i) ? "§aOnline" : "§7Offline") + "\n§r§cClick to remove him",
    run: () => { reply(player, removePlayer(player, id, x.i), x.n + " removed."); self(page); },
  }));
  const all = e.mode !== "list";
  lister(player, "Participants: " + e.n, items, page, back, self, [
    [6, hdr(1, all ? "g" : "c") + "§e§lWho takes part\n§r§7Now: §f" + (all ? "Everybody in the area" : "Only the list") + "\n§r§7Click to switch", ICON.player, () => { reply(player, setMode(player, id, all ? "list" : "all"), "Participants changed."); self(page); }],
    [7, hdr(1, "g") + "§a§lAdd a player\n§r§7Online or offline", ICON.player, () => pickPlayerPage(player, id, () => self(page))],
    [8, hdr(1, "g") + "§a§lAdd everybody online\n§r§7(not the operators)", ICON.pearl, () => { const r = addOnline(player, id); reply(player, r, (r.n ?? 0) + " player" + (r.n === 1 ? "" : "s") + " added."); self(page); }],
    [2, hdr(1, "r") + "§c§lClear the list\n§r§7Remove every player", ICON.barrier, () => confirm(player, "Clear the list?", ["§7Every chosen player is removed."], () => { reply(player, clearPlayers(player, id), "List cleared."); self(0); }, () => self(page))],
  ]);
}
function pickPlayerPage(player, id, back, page = 0, q = "") {
  if (!guard(player)) return back();
  const e = getEvent(id); if (!e) return gone(player, back);
  const live = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  let all = knownPlayers().map((x) => ({ id: x.id, name: String(x.name) }));
  for (const p of live.values()) if (!all.some((x) => x.id === p.id)) all.push({ id: p.id, name: p.name });
  const have = new Set(e.pl.map((x) => x.i)), ql = q.toLowerCase();
  all = all.filter((x) => !have.has(x.id) && (!ql || x.name.toLowerCase().includes(ql)));
  all.sort((a, b) => (live.has(b.id) ? 1 : 0) - (live.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
  const again = (pg) => pickPlayerPage(player, id, back, pg, q);
  const items = all.map((x) => ({
    zone: live.has(x.id) ? "g" : "c", icon: ICON.player,
    text: (live.has(x.id) ? "§a§l" : "§7§l") + x.name + "\n§r" + (live.has(x.id) ? "§aOnline" : "§7Offline") + "\n§r§eClick to add him",
    run: () => { reply(player, addPlayer(player, id, x.id, x.name), x.name + " added."); again(page); },
  }));
  const extras = [[7, hdr(1) + "§b§lSearch\n§r§7Find a player by name", ICON.search, () => {
    const form = new OprForm().title("Search player");
    textField(form, "§fPart of the name", "e.g. steve");
    showModal(player, form, (v) => pickPlayerPage(player, id, back, 0, v ? String(v[0] ?? "").trim() : q));
  }]];
  if (q) extras.push([8, hdr(1) + "§c§lClear search\n§r§7Show everybody again", NAV.no, () => pickPlayerPage(player, id, back, 0, "")]);
  lister(player, q ? "Add: " + q : "Add a player", items, page, back, again, extras);
}
