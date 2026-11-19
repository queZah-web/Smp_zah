// "+$565.94K" - the sale popup in the middle of the screen (green), shown for a moment whenever the player sells something, then it fades out smoothly.
// Side-panel players get it through the scoreboard UI (a 7th field after the 6 rows + a fade marker), action-bar players in their bar, the others as an action bar message.
// The fade = STEPS more and more transparent copies of the text in the UI (RP/ui/smp_hud.json), one new copy EVERY tick (20 per second) following a soft cosine curve.
import { world, system } from "@minecraft/server";
import { stats } from "./data.js";
import { updateHud } from "./hud.js";
import { saleView, SALE_FIELD } from "./salestate.js";

const LIFE_TICKS = 50, STEPS = 24, WINDOW = 100;   // fully visible 2.5 s, then 24 ticks (1.2 s) of fade. WINDOW = width of the popup window in the UI (units)
const active = new Map();                          // player id -> { text, t0 (tick), buy }
export const FADE_STEPS = STEPS;

/** 565940 -> "565.94K", 1130000 -> "1.13M", 250 -> "250" */
export function amountText(n) {
  n = Math.floor(n);
  const U = [["K", 1e3], ["M", 1e6], ["B", 1e9], ["T", 1e12]];
  let i = -1; for (let k = 0; k < U.length; k++) if (n >= U[k][1]) i = k;
  if (i < 0) return String(n);
  let x = Number((n / U[i][1]).toFixed(2));
  if (x >= 1000 && i < U.length - 1) { i++; x = Number((n / U[i][1]).toFixed(2)); }       // 999,999 -> 1M, not 1000K
  return String(x) + U[i][0];
}
const cw = (c) => (c === "." || c === "," ? 3 : c === " " ? 4 : 6);       // width of a character in the Minecraft font

/** 0 = fully visible, 1..STEPS = fading out, null = gone */
const stepOf = (p) => {
  const a = active.get(p.id); if (!a) return null;
  const age = system.currentTick - a.t0;
  if (age < LIFE_TICKS) return 0;
  const k = age - LIFE_TICKS + 1;
  if (k > STEPS) { active.delete(p.id); return null; }
  return k;
};

saleView.field = (p) => {
  if (stepOf(p) === null) return " ".repeat(SALE_FIELD);
  const t = active.get(p.id).text, tw = [...t].reduce((s, c) => s + cw(c), 0);
  const right = Math.max(0, Math.round((WINDOW - tw) / 8));                // the UI shows the END of the field, right aligned: spaces on the right move the text to the middle of its window
  return (" ".repeat(Math.max(0, SALE_FIELD - t.length - right)) + t + " ".repeat(right)).slice(0, SALE_FIELD);
};
saleView.marker = (p) => { const k = stepOf(p); if (k === null) return ""; return (active.get(p.id)?.buy ? "QQR" : "") + (k ? "QQS" + k + "Q" : ""); };      // QQR = red copy of the text (a purchase)
saleView.bar = (p) => (stepOf(p) === 0 ? (active.get(p.id).buy ? "§c" : "§a") + active.get(p.id).text : "");

/** a sale: green "+$565.94K"  (buy = true: a purchase, light red "-$565.94K") */
export function saleFx(p, total, buy = false) {
  try {
    total = Math.floor(total); if (!(total > 0)) return;
    const prev = active.get(p.id);
    if (prev && prev.buy === buy && stepOf(p) !== null) total += prev.sum;      // the previous popup is still on the screen (same kind): add to it, so 8$ then 1$ shows +$9
    const text = (buy ? "-$" : "+$") + amountText(total);
    active.set(p.id, { text, t0: system.currentTick, buy, sum: total });
    updateHud(p, true);
    system.runTimeout(() => { try { updateHud(p, true); } catch (e) { /* ignore */ } }, 10);      // shows it even if a shop form was open at that moment
  } catch (e) { /* never break a sale because of a popup */ }
}

/** a purchase: light red "-$565.94K" in the same place, with the same fade */
export const buyFx = (p, total) => saleFx(p, total, true);

// while a popup is fading: a new frame every tick (the last one removes it)
system.runInterval(() => {
  if (active.size === 0) return;
  for (const [id, a] of active) {
    const p = world.getAllPlayers().find((x) => x.id === id);
    if (!p) { active.delete(id); continue; }
    if (system.currentTick - a.t0 < LIFE_TICKS - 1) continue;
    try { stepOf(p); updateHud(p, true); } catch (e) { /* ignore */ }
  }
}, 1);
