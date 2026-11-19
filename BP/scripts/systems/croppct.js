// 📈 GROWTH PERCENT HOLOGRAM: a small floating text above a plant after the Shift boost (farmfx.js).
//   "+12%" (green) = how much the plant's growth rose, "0%" (grey) = it did not rise, "+Fruit" = a melon / pumpkin appeared.
// It floats up slowly for ~2.5 s and removes itself.  The text entity is the same invisible one the holograms use (shop:holo).
// Leftovers (server stopped while one was showing) are removed when their chunk loads.  Never throws.
import { world, system } from "@minecraft/server";

const TYPE = "shop:holo", TAG = "crop_pct", LIFE_STEPS = 28, STEP_TICKS = 2, RISE = 0.04, MAX_LIVE = 24;
let live = 0;
const alive = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (er) { return false; } };

/** text to show for a growth result */
export function pctText(r) {
  if (r.fruit) return "§6§l+Fruit";
  const d = Math.round(r.delta);
  return r.ok && r.delta > 0 ? "§a§l+" + Math.max(1, d) + "%" : "§7§l0%";
}

/** shows `text` above the plant at block position b (above the top of a tall plant) */
export function popPct(dim, b, text) {
  try {
    if (live >= MAX_LIVE) return;
    let y = b.y; const type = dim.getBlock(b)?.typeId;
    if (type) for (let i = 0; i < 20; i++) { const n = dim.getBlock({ x: b.x, y: y + 1, z: b.z }); if (n && n.typeId === type) y++; else break; }
    const base = { x: b.x + 0.5, y: y + 1.25, z: b.z + 0.5 };
    const e = dim.spawnEntity(TYPE, base);
    e.nameTag = text; try { e.addTag(TAG); } catch (er) { /* ignore */ }
    live++;
    let i = 0, done = false;
    const end = (h) => { if (done) return; done = true; live = Math.max(0, live - 1); try { system.clearRun(h); } catch (er) { /* ignore */ } try { if (alive(e)) e.remove(); } catch (er) { /* ignore */ } };
    const h = system.runInterval(() => {
      try {
        if (i >= LIFE_STEPS || !alive(e)) { end(h); return; }
        e.teleport({ x: base.x, y: base.y + i * RISE, z: base.z });
        i++;
      } catch (er) { end(h); }
    }, STEP_TICKS);
  } catch (e) { /* no entity: skip the hologram */ }
}

try {
  world.afterEvents.entityLoad.subscribe((ev) => {
    try { const e = ev.entity; if (e.typeId === TYPE && e.hasTag(TAG)) e.remove(); } catch (er) { /* ignore */ }
  });
} catch (e) { /* event not available: ignore */ }
