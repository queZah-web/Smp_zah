// =====================================================================================================================
// PILLARS OF FORTUNE - the arena (pure data, no game calls: can be tested / previewed outside the game)
//
//   Up in the sky (the tops at +90): 16 stone pillars 7 x 7, 81 high, each with its own colour - an OUTER ring of 11
//   (radius 27) and an INNER ring of 5 (radius 13), 5 - 8 blocks apart, and a small round CENTRE platform.
//   Far below (+0): a dark floor with magma (nobody gets there: falling 15 blocks under the tops = out).
//   Around it (radius 42 - 44, +98): a glass ring with seats for the viewers (out of reach: past radius 36 = out).
//   Under the floor (-2): the LOCKERS - 32 hidden barrels: the own items of the players wait there during a game.
//   Pillars are big boxes (fills): built, removed (shrinking) and put back with one call each = no lag.
// =====================================================================================================================
import { TallCanvas } from "./dropperdesign.js";

export const POF = {
  HX: 46, UP: 118, DOWN: 3,
  TOP: 90, BASE: 10,                        // pillar tops / bottoms (relative y)
  OUT_Y: 75,                                // feet lower than this = out (15 under the tops)
  OUT_R: 36,                                // farther than this from the middle = out
  CENTER_R: 3,
  view: { x: 0, y: 99, z: 43 },
  lockers: 32,
};
const COLORS = ["red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink", "white", "red", "lime", "light_blue", "yellow"];
/** the 16 pillars: { x, z (middle), ring, color } - index 0..10 outer, 11..15 inner */
export const PILLARS = (() => {
  const out = [];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; out.push({ x: Math.round(Math.cos(a) * 27), z: Math.round(Math.sin(a) * 27), ring: 0 }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + Math.PI / 5; out.push({ x: Math.round(Math.cos(a) * 13), z: Math.round(Math.sin(a) * 13), ring: 1 }); }
  out.forEach((p, i) => (p.color = COLORS[i]));
  return out;
})();
export const lockerAt = (n) => ({ x: (n % 16) - 8, y: -2, z: Math.floor(n / 16) - 1 });
/** the boxes of one pillar (to build it again / to remove it): [{ from, to, id }] relative */
export function pillarFills(p) {
  const T = POF.TOP, B = POF.BASE, out = [];
  out.push({ from: { x: p.x - 3, y: B, z: p.z - 3 }, to: { x: p.x + 3, y: T - 1, z: p.z + 3 }, id: "polished_deepslate" });
  for (let y = B + 6; y < T - 2; y += 12) out.push({ from: { x: p.x - 3, y, z: p.z - 3 }, to: { x: p.x + 3, y, z: p.z + 3 }, id: p.color + "_concrete" });
  out.push({ from: { x: p.x - 3, y: T - 1, z: p.z - 3 }, to: { x: p.x + 3, y: T - 1, z: p.z + 3 }, id: "deepslate_tiles" });
  out.push({ from: { x: p.x - 3, y: T, z: p.z - 3 }, to: { x: p.x + 3, y: T, z: p.z + 3 }, id: p.color + "_concrete" });
  out.push({ from: { x: p.x - 2, y: T, z: p.z - 2 }, to: { x: p.x + 2, y: T, z: p.z + 2 }, id: "polished_andesite" });
  out.push({ from: { x: p.x, y: T, z: p.z }, to: { x: p.x, y: T, z: p.z }, id: "sea_lantern" });
  return out;
}
/** the centre platform blocks (relative), ring by ring from the outside (for the sudden death) */
export function centerRings() {
  const rings = [];
  for (let r = POF.CENTER_R; r >= 0; r--) {
    const cells = [];
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) { const d = Math.hypot(x, z); if (d <= r + 0.5 && d > r - 0.5) cells.push({ x, y: POF.TOP, z }); }
    rings.push(cells);
  }
  return rings;
}

export function* pillarsGen() {
  const P = POF, C = new TallCanvas();
  const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
  // the floor far below + magma pattern
  C.fill(-40, 0, -40, 40, 0, 40, "blackstone");
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) { const r = Math.hypot(x, z); if (Math.round(r) % 6 === 0 || (x * 7 + z * 13 + 400) % 11 === 0) put(x, 0, z, (x + z) % 2 ? "magma" : "crying_obsidian"); }
  yield;
  // the pillars (fills)
  for (const p of PILLARS) for (const f of pillarFills(p)) C.fills.push(f);
  // the centre platform: a gold / quartz disc on a thin column
  C.fill(-1, P.BASE, -1, 1, P.TOP - 1, 1, "polished_deepslate");
  for (const ring of centerRings()) for (const c of ring) { const r = Math.round(Math.hypot(c.x, c.z)); put(c.x, c.y, c.z, r === 0 ? "gold_block" : r === P.CENTER_R ? "quartz_bricks" : r % 2 ? "smooth_quartz" : "chiseled_quartz_block"); }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.hypot(x, z) <= 2.5) put(x, P.TOP - 1, z, "polished_deepslate");
  yield;
  // the viewers' ring (glass floor, a railing, seats) - out of reach of the players
  for (let x = -45; x <= 45; x++) for (let z = -45; z <= 45; z++) {
    const r = Math.hypot(x, z); if (r < 41.5 || r > 45.5) continue;
    put(x, P.TOP + 8, z, r > 44.5 ? "quartz_bricks" : (Math.round(Math.atan2(z, x) * 20) % 3 === 0 ? "sea_lantern" : "white_stained_glass"));
    if (r < 42.5) { put(x, P.TOP + 9, z, "glass_pane"); }
    if (r > 44.5) { put(x, P.TOP + 9, z, "quartz_bricks"); put(x, P.TOP + 10, z, "quartz_slab", { "minecraft:vertical_half": "bottom" }); }
  }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2, x = Math.round(Math.cos(a) * 44), z = Math.round(Math.sin(a) * 44); for (let y = P.TOP + 9; y <= P.TOP + 12; y++) put(x, y, z, y === P.TOP + 12 ? "sea_lantern" : "quartz_pillar", y === P.TOP + 12 ? undefined : { pillar_axis: "y" }); }
  // the lockers (hidden barrels under the floor)
  for (let n = 0; n < P.lockers; n++) { const l = lockerAt(n); put(l.x, l.y, l.z, "barrel", { facing_direction: 1 }); }
  return C;
}
export function pillarsArena() { const g = pillarsGen(); let r; while (!(r = g.next()).done); return r.value; }
