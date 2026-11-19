// Item timer: a small floating countdown above every DROPPED item = the seconds left until the next Clear lag.
// Same idea as the Heart countdown (heartfx.js): an invisible "shop:holo" text entity that follows the item.
// The time is read from clearlag.js (clearLagLeftMs), so it is always exactly the Clear lag timer (also when an operator changes the time / switches it OFF).
// Loot of a dead player (deathloot.js) shows its own 30 minute countdown instead.
// Hearts are skipped (Clear lag never touches them and they have their own timer). Nothing else is changed by this file.
import { world, system } from "@minecraft/server";
import { clearLagLeftMs } from "./clearlag.js";
import { isHeart } from "../heartids.js";
import { deathLootLeftMs } from "./deathloot.js";

const DIMS = ["overworld", "nether", "the_end"];
const LABEL_TYPE = "shop:holo", LABEL_TAG = "item_cd", ID_PFX = "icd_", UP = 0.45;
const RANGE = 40;           // only items within 40 blocks of a player get a label (nobody sees the others)
const MAX_LABELS = 200;     // safety cap, so a huge pile of items can never lag the server
const labels = new Map();   // item entity id -> { ent: label entity, item: item entity, text }
const okEnt = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (x) { return false; } };
const clock = (s) => (s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : s + "s");
const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const deathColor = (s) => (s <= 60 ? "\u00a7c\u00a7l" : s <= 300 ? "\u00a76\u00a7l" : "\u00a7b\u00a7l");     // loot of a dead player: aqua, gold under 5 min, red under 1 min
const colorOf = (s) => (s <= 10 ? "\u00a7c\u00a7l" : s <= 30 ? "\u00a76\u00a7l" : "\u00a7a\u00a7l");
const drop = (id) => { const st = labels.get(id); labels.delete(id); try { if (st && okEnt(st.ent)) st.ent.remove(); } catch (x) { /* ignore */ } };
const dropAll = () => { for (const id of [...labels.keys()]) drop(id); };

// ON / OFF (Admin / Owner: /opr > World > Item timer), saved in the world, default ON
const ON_KEY = "itemtimer:on";
let on = null;
export function itemTimerOn() { if (on !== null) return on; try { on = world.getDynamicProperty(ON_KEY) !== false; } catch (e) { return true; } return on; }
/** Admin / Owner only (role checked by the caller page too).  Returns { ok } or { err } */
export function setItemTimer(actor, v, roleOk) {
  if (!roleOk) return { err: "Only the Admin or the Owner can change this." };
  on = !!v;
  try { world.setDynamicProperty(ON_KEY, on); } catch (e) { return { err: "Could not save." }; }
  if (!on) dropAll();
  return { ok: true };
}

// every 5 ticks: create / update / remove the labels
system.runInterval(() => {
  if (!itemTimerOn()) { if (labels.size) dropAll(); return; }
  try {
    const left = clearLagLeftMs();
    const sec = left === null ? 0 : Math.max(0, Math.ceil(left / 1000)), clearText = left === null ? null : colorOf(sec) + clock(sec);   // Clear lag OFF: no timer on normal items
    const seen = new Set(); let count = labels.size;
    for (const dn of DIMS) {
      let dim, players = [], items = [];
      try { dim = world.getDimension(dn); players = dim.getPlayers(); } catch (x) { continue; }
      if (!players.length) continue;
      try { items = dim.getEntities({ type: "minecraft:item" }); } catch (x) { continue; }
      for (const it of items) {
        try {
          if (!okEnt(it)) continue;
          const tid = it.getComponent("minecraft:item")?.itemStack?.typeId;
          if (!tid || isHeart(tid)) continue;                // Hearts: never cleared, own timer
          let text = clearText;
          const dl = deathLootLeftMs(it);                    // loot of a dead player: its own 30 minute timer instead
          if (dl !== null) { const ds = Math.ceil(dl / 1000); text = deathColor(ds) + mmss(ds); }
          if (text === null) continue;
          const l = it.location;
          let near = false;
          for (const p of players) { const q = p.location; if (Math.abs(q.x - l.x) <= RANGE && Math.abs(q.z - l.z) <= RANGE && Math.abs(q.y - l.y) <= RANGE) { near = true; break; } }
          if (!near) continue;
          let st = labels.get(it.id);
          if (!st || !okEnt(st.ent)) {
            if (count >= MAX_LABELS) continue;
            const ent = dim.spawnEntity(LABEL_TYPE, { x: l.x, y: l.y + UP, z: l.z });
            try { ent.addTag(LABEL_TAG); ent.addTag(ID_PFX + it.id); } catch (x) { /* ignore */ }
            st = { ent, item: it, text: null }; labels.set(it.id, st); count++;
          }
          st.item = it; seen.add(it.id);
          if (st.text !== text) { st.ent.nameTag = text; st.text = text; }
        } catch (x) { /* ignore this item */ }
      }
    }
    for (const id of [...labels.keys()]) if (!seen.has(id)) drop(id);   // picked up / merged / cleared / far away
  } catch (e) { console.warn("[itemtimer] " + e); }
}, 5);

// the label follows its item (thrown, falling, pushed by water ...)
system.runInterval(() => {
  for (const [id, st] of labels) {
    try {
      if (!okEnt(st.item) || !okEnt(st.ent)) { drop(id); continue; }
      const l = st.item.location, c = st.ent.location;
      if (Math.abs(l.x - c.x) + Math.abs(l.y + UP - c.y) + Math.abs(l.z - c.z) > 0.03) st.ent.teleport({ x: l.x, y: l.y + UP, z: l.z });
    } catch (x) { /* ignore */ }
  }
}, 2);

// leftovers (server stopped / chunk unloaded while a label existed): labels that are not in the list are removed
const sweep = () => {
  const mine = new Set(); for (const st of labels.values()) { try { mine.add(st.ent.id); } catch (x) { /* ignore */ } }
  for (const dn of DIMS) {
    try { for (const e of world.getDimension(dn).getEntities({ type: LABEL_TYPE, tags: [LABEL_TAG] })) { try { if (!mine.has(e.id)) e.remove(); } catch (x) { /* ignore */ } } } catch (x) { /* ignore */ }
  }
};
try { system.runTimeout(sweep, 40); } catch (x) { /* ignore */ }
try { system.runInterval(sweep, 1200); } catch (x) { /* ignore */ }
try { world.afterEvents.entityLoad.subscribe((ev) => { try { const e = ev.entity; if (e.typeId === LABEL_TYPE && e.hasTag(LABEL_TAG)) { for (const st of labels.values()) if (st.ent === e) return; e.remove(); } } catch (x) { /* ignore */ } }); } catch (x) { /* ignore */ }
