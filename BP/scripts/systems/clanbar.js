// Clan notifications in the middle-bottom of the screen (action bar), like the "Night vision is Enabled" message:
//   "Hussein joined the server"   "Hussein died"   "Hussein was killed by Ali"   "Hussein killed Ali"   "Hussein left the server"
// The colour is the one the clan owner picked.  Messages wait in a short queue (one at a time, 5 seconds each, soft fade-out at the end).
// While a pay notice / table pass / skill bar / duel timer owns the action bar, the message waits (and is dropped after 40 s so it never shows late).
import { world, system } from "@minecraft/server";
import { stats } from "../data.js";
import { updateHud } from "../hud.js";
import { sendBar } from "../barsend.js";
import { clanBusy, payBusy, passBusy, skillBusy } from "../state.js";
import { duelView } from "./duelstate.js";
import { valid } from "./util.js";

const TICK = 5, SHOW_SECONDS = 5, TOTAL = SHOW_SECONDS * (20 / TICK), FADE_STEPS = 6, MAX_QUEUE = 6, STALE_MS = 40000;
const FADE = { b: ["\u00a7b", "\u00a73", "\u00a78"], a: ["\u00a7a", "\u00a72", "\u00a78"], e: ["\u00a7e", "\u00a76", "\u00a78"], c: ["\u00a7c", "\u00a74", "\u00a78"], d: ["\u00a7d", "\u00a75", "\u00a78"], 6: ["\u00a76", "\u00a77", "\u00a78"] };
const st = new Map();       // player id -> { q: [{ text, color, t }], cur, n }

/** shows `text` to player p in the owner's colour (b a e c d 6) */
export function clanBanner(p, text, color) {
  try {
    let s = st.get(p.id);
    if (!s) { s = { q: [], cur: null, n: 0 }; st.set(p.id, s); }
    s.q.push({ text: String(text).replace(/\u00a7/g, "").slice(0, 80), color: FADE[color] ? String(color) : "b", t: Date.now() });
    while (s.q.length > MAX_QUEUE) s.q.shift();
  } catch (e) { /* ignore */ }
}

function finish(p, s) {
  s.cur = null; s.n = 0;
  clanBusy.delete(p.id);
  if (s.q.length === 0) st.delete(p.id);
  try {
    if (s.q.length === 0) {
      p.onScreenDisplay.setActionBar("");
      if ((stats(p).hud ?? "panel") === "bar") updateHud(p, true);
    }
  } catch (e) { /* ignore */ }
}

system.runInterval(() => {
  if (st.size === 0) return;
  let players; try { players = new Map(world.getAllPlayers().map((p) => [p.id, p])); } catch (e) { return; }
  for (const [id, s] of [...st]) {
    try {
      const p = players.get(id);
      if (!p || !valid(p)) { st.delete(id); clanBusy.delete(id); continue; }
      if (!s.cur) {
        while (s.q.length && Date.now() - s.q[0].t > STALE_MS) s.q.shift();
        if (s.q.length === 0) { st.delete(id); continue; }
        if (payBusy.has(id) || passBusy.has(id) || skillBusy.has(id) || duelView.bar(p)) continue;      // wait: someone else owns the action bar
        s.cur = s.q.shift(); s.n = 0; clanBusy.add(id);
      }
      if (s.n >= TOTAL) { finish(p, s); continue; }
      const k = s.n - (TOTAL - FADE_STEPS), lv = k < 2 ? 0 : k < 4 ? 1 : 2;       // full colour, darker, grey: a soft fade-out
      sendBar(p, FADE[s.cur.color][lv] + s.cur.text);
      s.n++;
    } catch (e) { st.delete(id); clanBusy.delete(id); }
  }
}, TICK);

try { world.afterEvents.playerLeave.subscribe(({ playerId }) => { st.delete(playerId); clanBusy.delete(playerId); }); } catch (e) { /* ignore */ }
