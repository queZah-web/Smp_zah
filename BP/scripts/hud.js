// Scoreboard.  Three styles per player (chosen with buttons in Menu > Cosmetics > Effects & Sounds):
//   "panel" = board on the far RIGHT,  "bar" = one line at the bottom centre (action bar),  "left" = board on the far LEFT
import { world, system } from "@minecraft/server";
import { stats, playSeconds, onChange } from "./data.js";
import { short, playtime } from "./format.js";
import { formBusy, combatBusy, skillBusy, passBusy, payBusy, clanBusy, afkBusy } from "./state.js";
import { duelView } from "./systems/duelstate.js";
import { saleView, SALE_FIELD } from "./salestate.js";

// ---- side panel text protocol (must match RP/ui/smp_hud.json) -----------------------------------------
//   "sb:" + name (16 chars, left aligned) + 5 fields of 22 chars, each value RIGHT aligned (spaces on the left)
// The UI never subtracts text: every row just cuts a PREFIX of this string (%.Ns) that ends exactly at the end of
// its value, and shows it right-aligned inside a small clipped window -> only the value itself is visible.
const NAME_W = 16, FIELD_W = 22, VALUE_MAX = 10;
const ascii = (t) => String(t).replace(/[^\x20-\x7E]/g, "?").replace(/:/g, "_");

// ---- the SERVER NAME on the side panel (title of the panel).  Saved in the world; only the Owner (and an Admin the Owner allowed) can change it:
//      Operator menu > Server & staff > Scoreboard name (staffmenu.js).  Nothing saved = the original coloured "SMP".
//   text protocol: after the sale field comes the name (NAME_FIELD chars, centered, spaces around) + one guard char "~"; when a custom name is set
//   a marker "QQN<color>Q" is added so the UI (RP/ui/smp_hud.json) shows the custom name label in that colour instead of the original "SMP" label.
//   The name is plain ASCII (no colour codes, no ':'), max NAME_MAX characters, and can never contain "QQ" (that is the start of every UI marker).
const NKEY = "hud:name", NAME_MAX = 12, NAME_FIELD = 14;
export const HUD_NAME_MAX = NAME_MAX;
export const NAME_COLORS = [["Red", "§c"], ["Gold", "§6"], ["Yellow", "§e"], ["Green", "§a"], ["Aqua", "§b"], ["Blue", "§9"], ["Light purple", "§d"], ["White", "§f"]];
export function cleanHudName(t) {
  let s = String(t ?? "").replace(/[^\x20-\x7E]/g, "").replace(/:/g, "-").replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  while (s.includes("QQ")) s = s.replace(/QQ+/g, "Q");
  return s.slice(0, NAME_MAX).trim();
}
let nameCache;                                  // undefined = not read yet, null = original "SMP", { n, c } = custom name
function readName() {
  if (nameCache !== undefined) return nameCache;
  try {
    const raw = world.getDynamicProperty(NKEY);
    const o = typeof raw === "string" ? JSON.parse(raw) : null;
    const n = o && typeof o.n === "string" ? cleanHudName(o.n) : "";
    const c = o && Number.isInteger(o.c) && o.c >= 0 && o.c < NAME_COLORS.length ? o.c : 1;
    nameCache = n ? { n, c } : null;
  } catch (e) { return null; }                  // world not ready / unreadable: show the original name (nothing is overwritten)
  return nameCache;
}
/** the custom name now shown: { n, c } or null (original "SMP") */
export const hudNameNow = () => readName();
function nameField() {
  const o = readName(), blank = " ".repeat(NAME_FIELD);
  if (!o) return blank + "~";
  const pad = NAME_FIELD - o.n.length, left = Math.floor(pad / 2);
  return " ".repeat(left) + o.n + " ".repeat(pad - left) + "~" + "QQN" + o.c + "Q";
}
function refreshAll() { for (const p of world.getAllPlayers()) { last.delete(p.id); updateHud(p, true); } }
/** saves a custom name + colour (index of NAME_COLORS).  { ok: true, name } or { err } */
export function setHudName(rawName, colorIndex) {
  const n = cleanHudName(rawName);
  if (!n) return { err: "Type a name (letters, numbers and symbols, max " + NAME_MAX + " characters)." };
  const c = Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < NAME_COLORS.length ? colorIndex : 1;
  try { world.setDynamicProperty(NKEY, JSON.stringify({ n, c })); } catch (e) { return { err: "Could not save the name." }; }
  nameCache = { n, c };
  refreshAll();
  return { ok: true, name: n };
}
/** back to the original coloured "SMP" */
export function resetHudName() {
  try { world.setDynamicProperty(NKEY, undefined); } catch (e) { return { err: "Could not save." }; }
  nameCache = null;
  refreshAll();
  return { ok: true };
}

/** the player's style: "panel" (right) | "bar" (bottom line) | "left".  Anything else (old saved "off") = "panel" */
export const HUD_MODES = ["panel", "bar", "left"];
export function hudMode(p) { try { const m = stats(p).hud; return m === "bar" || m === "left" ? m : "panel"; } catch (e) { return "panel"; } }
const noMarker = (t) => t.replace(/QQ+/g, "Qq");      // a player name must never look like a UI marker

export function panelText(p, left = false) {
  const s = stats(p), f = (v) => ascii(v).slice(0, VALUE_MAX).padStart(FIELD_W, " ");
  return "sb:" + noMarker(ascii(p.name)).slice(0, NAME_W).padEnd(NAME_W, " ")
    + f(short(s.money)) + f(short(s.shards, 1)) + f(String(s.kills)) + f(String(s.deaths)) + f(playtime(playSeconds(p))) + f(duelView.field(p))
    + (saleView.field(p) || " ".repeat(SALE_FIELD)).padStart(SALE_FIELD, " ").slice(-SALE_FIELD)      // 7th field: the sale popup (always present, blank when nothing was sold)
    + nameField()                                                                  // 8th field: the server name (see above); the UI only reads it through fixed cuts
    + (duelView.banner(p) ?? "") + saleView.marker(p)
    + (left ? "QQL" : "");                                  // the LEFT board: this last marker tells the UI to draw it on the left side      // the centered message: only markers are added AFTER the last field (the UI shows fixed texts for them)
}
const barText = (p) => {
  const s = stats(p);
  return (saleView.bar(p) ? saleView.bar(p) + " §8| " : "") + "§a$" + short(s.money) + " §8| §d" + short(s.shards, 1) + " shards §8| §cKills " + s.kills + " §8| §6Deaths " + s.deaths + " §8| §b" + playtime(playSeconds(p)) + (duelView.bar(p) ? " §8| " + duelView.bar(p) : "");
};

const last = new Map();      // player id -> { mode, text, t }   (only resend when something changed)
export function updateHud(p, force = false) {
  if (formBusy.has(p.id)) return;          // never touch the screen while a shop form is open
  try {
    const mode = hudMode(p);
    if (mode === "bar" && (combatBusy.has(p.id) || skillBusy.has(p.id) || passBusy.has(p.id) || payBusy.has(p.id) || clanBusy.has(p.id) || afkBusy.has(p.id))) return;      // the combat timer / skill bar own the action bar
    const text = mode === "bar" ? barText(p) : panelText(p, mode === "left"), now = system.currentTick, l = last.get(p.id);
    if (!force && l && l.mode === mode && l.text === text && now - l.t < 100) return;          // unchanged text: only a slow refresh (the title now stays 60 s, so it can never expire between two updates, even when the server lags)
    last.set(p.id, { mode, text, t: now });
    if (mode === "bar") p.onScreenDisplay.setActionBar(text);
    else p.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: 1200, fadeOutDuration: 0 });
  } catch (e) { /* player not ready yet */ }
}

const LABEL = { panel: "right panel", bar: "bottom line", left: "left panel" };
/** choose the style (called by the buttons in Effects & Sounds) */
export function setHud(p, mode) {
  if (!HUD_MODES.includes(mode)) return;
  stats(p).hud = mode; last.delete(p.id);
  wipePanel(p);
  try { p.onScreenDisplay.setActionBar(""); } catch (e) { /* ignore */ }
  p.sendMessage("§6[Scoreboard] §fStyle: §e" + LABEL[mode]);
  if (mode === "bar") {                      // the board must be gone before the line starts: wipe again a little later (the UI keeps the last title text), then draw the line
    for (const d of [4, 12, 30]) system.runTimeout(() => { try { if (p.isValid && hudMode(p) === "bar") wipePanel(p); } catch (e) { /* ignore */ } }, d);
    system.runTimeout(() => { try { if (p.isValid) updateHud(p, true); } catch (e) { /* ignore */ } }, 2);
  } else updateHud(p, true);
}
/** removes the board from the screen.  "title clear" alone leaves the old board text in the UI, so a blank title (no "sb:") replaces it first. */
function wipePanel(p) {
  try { p.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }); } catch (e) { /* ignore */ }
  try { p.runCommand("title @s clear"); } catch (e) { /* ignore */ }
}

system.runInterval(() => { for (const p of world.getAllPlayers()) updateHud(p); }, 20);
onChange(updateHud);
