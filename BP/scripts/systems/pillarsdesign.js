// =====================================================================================================================
// PILLARS OF FORTUNE - the 2 arenas (classic 7 x 7 + hard 1 x 1) (pure data, no game calls: can be tested / previewed outside the game)
//
//   Up in the sky (the tops at +90): 16 stone pillars 7 x 7, 81 high, each with its own colour - an OUTER ring of 11
//   (radius 27) and an INNER ring of 5 (radius 13), 5 - 8 blocks apart, and a small round CENTRE platform.
//   Far below (+0): a dark floor with magma (nobody gets there: falling 15 blocks under the tops = out).
//   Around it (radius 42 - 44, +98): a glass ring with seats for the viewers (out of reach: past radius 36 = out).
//   Under the floor (-2): the LOCKERS - 32 hidden barrels: the own items of the players wait there during a game.
//   Pillars are big boxes (fills): built, removed (shrinking) and put back with one call each = no lag.
// =====================================================================================================================
import { TallCanvas } from "./dropperdesign.js";

const COLORS = ["red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink", "white", "red", "lime", "light_blue", "yellow"];

/**
 * one arena kind. o: { H: half width of a pillar (3 = 7 x 7, 0 = 1 x 1), RO / RI: radius of the outer (11) / inner (5) ring,
 * CR: radius of the centre platform, HX: half size of the area, FLOOR: half size of the floor, VIEW: radius of the viewers' ring }
 */
function makeDesign(o) {
  const POF = {
    HX: o.HX, UP: 118, DOWN: 3, TOP: 90, BASE: 10,
    OUT_Y: 75,                                // feet lower than this = out (15 under the tops)
    OUT_R: o.OUT_R,                           // farther than this from the middle = out
    CENTER_R: o.CR, H: o.H, CLEAR: o.FLOOR, RAIN_R: o.RAIN_R,
    view: { x: 0, y: 99, z: o.VIEW + 1 },
    lockers: 32,
  };
  const PILLARS = [];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; PILLARS.push({ x: Math.round(Math.cos(a) * o.RO), z: Math.round(Math.sin(a) * o.RO), ring: 0 }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + Math.PI / 5; PILLARS.push({ x: Math.round(Math.cos(a) * o.RI), z: Math.round(Math.sin(a) * o.RI), ring: 1 }); }
  PILLARS.forEach((p, i) => (p.color = COLORS[i]));
  const lockerAt = (n) => ({ x: (n % 16) - 8, y: -2, z: Math.floor(n / 16) - 1 });
  const H = o.H;
  /** the boxes of one pillar (to build it again / to remove it): [{ from, to, id }] relative */
  function pillarFills(p) {
    const T = POF.TOP, B = POF.BASE, out = [];
    out.push({ from: { x: p.x - H, y: B, z: p.z - H }, to: { x: p.x + H, y: T - 1, z: p.z + H }, id: "polished_deepslate" });
    for (let y = B + 6; y < T - 2; y += 12) out.push({ from: { x: p.x - H, y, z: p.z - H }, to: { x: p.x + H, y, z: p.z + H }, id: p.color + "_concrete" });
    if (H > 0) {
      out.push({ from: { x: p.x - H, y: T - 1, z: p.z - H }, to: { x: p.x + H, y: T - 1, z: p.z + H }, id: "deepslate_tiles" });
      out.push({ from: { x: p.x - H, y: T, z: p.z - H }, to: { x: p.x + H, y: T, z: p.z + H }, id: p.color + "_concrete" });
      out.push({ from: { x: p.x - H + 1, y: T, z: p.z - H + 1 }, to: { x: p.x + H - 1, y: T, z: p.z + H - 1 }, id: "polished_andesite" });
      out.push({ from: { x: p.x, y: T, z: p.z }, to: { x: p.x, y: T, z: p.z }, id: "sea_lantern" });
    } else {                                    // 1 x 1: a glowing block under the coloured top, so every pillar is easy to see
      out.push({ from: { x: p.x, y: T - 1, z: p.z }, to: { x: p.x, y: T - 1, z: p.z }, id: "sea_lantern" });
      out.push({ from: { x: p.x, y: T, z: p.z }, to: { x: p.x, y: T, z: p.z }, id: p.color + "_concrete" });
    }
    return out;
  }
  /** the centre platform blocks (relative), ring by ring from the outside (for the sudden death) */
  function centerRings() {
    const rings = [];
    for (let r = POF.CENTER_R; r >= 0; r--) {
      const cells = [];
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) { const d = Math.hypot(x, z); if (d <= r + 0.5 && d > r - 0.5) cells.push({ x, y: POF.TOP, z }); }
      rings.push(cells);
    }
    return rings;
  }
  const centerId = (c) => { const r = Math.round(Math.hypot(c.x, c.z)); return r === 0 ? "gold_block" : r === POF.CENTER_R ? "quartz_bricks" : r % 2 ? "smooth_quartz" : "chiseled_quartz_block"; };
  /** the centre: its column (fills) + the blocks of the platform */
  function centerParts() {
    const fills = [], blocks = [];
    if (o.CR > 0) {
      fills.push({ from: { x: -1, y: POF.BASE, z: -1 }, to: { x: 1, y: POF.TOP - 1, z: 1 }, id: "polished_deepslate" });
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.hypot(x, z) <= 2.5) blocks.push({ x, y: POF.TOP - 1, z, id: "polished_deepslate" });
    } else {
      fills.push({ from: { x: 0, y: POF.BASE, z: 0 }, to: { x: 0, y: POF.TOP - 2, z: 0 }, id: "polished_deepslate" });
      for (let y = POF.BASE + 6; y < POF.TOP - 2; y += 12) blocks.push({ x: 0, y, z: 0, id: "yellow_concrete" });
      blocks.push({ x: 0, y: POF.TOP - 1, z: 0, id: "glowstone" });
    }
    for (const ring of centerRings()) for (const c of ring) blocks.push({ ...c, id: centerId(c) });
    return { fills, blocks };
  }
  /** what is removed when the centre is gone (its column) */
  const centerCore = () => (o.CR > 0 ? { from: { x: -2, y: POF.BASE, z: -2 }, to: { x: 2, y: POF.TOP - 1, z: 2 } } : { from: { x: 0, y: POF.BASE, z: 0 }, to: { x: 0, y: POF.TOP - 1, z: 0 } });

  function* gen() {
    const P = POF, C = new TallCanvas(), F = o.FLOOR, V = o.VIEW;
    const put = (x, y, z, id, st, late) => C.put(x, y, z, id, st, late);
    // the floor far below + magma pattern
    C.fill(-F, 0, -F, F, 0, F, "blackstone");
    for (let x = -F; x <= F; x++) for (let z = -F; z <= F; z++) { const r = Math.hypot(x, z); if (Math.round(r) % 6 === 0 || (x * 7 + z * 13 + 400) % 11 === 0) put(x, 0, z, (x + z) % 2 ? "magma" : "crying_obsidian"); }
    yield;
    // the pillars (fills) + the centre
    for (const p of PILLARS) for (const f of pillarFills(p)) C.fills.push(f);
    const cp = centerParts();
    for (const f of cp.fills) C.fills.push(f);
    for (const b of cp.blocks) put(b.x, b.y, b.z, b.id);
    yield;
    // the viewers' ring (glass floor, a railing, seats) - out of reach of the players
    for (let x = -V - 4; x <= V + 4; x++) for (let z = -V - 4; z <= V + 4; z++) {
      const r = Math.hypot(x, z); if (r < V - 0.5 || r > V + 3.5) continue;
      put(x, P.TOP + 8, z, r > V + 2.5 ? "quartz_bricks" : (Math.round(Math.atan2(z, x) * 20) % 3 === 0 ? "sea_lantern" : "white_stained_glass"));
      if (r < V + 0.5) { put(x, P.TOP + 9, z, "glass_pane"); }
      if (r > V + 2.5) { put(x, P.TOP + 9, z, "quartz_bricks"); put(x, P.TOP + 10, z, "quartz_slab", { "minecraft:vertical_half": "bottom" }); }
    }
    const posts = Math.round(V * 0.55);
    for (let k = 0; k < posts; k++) { const a = (k / posts) * Math.PI * 2, x = Math.round(Math.cos(a) * (V + 2)), z = Math.round(Math.sin(a) * (V + 2)); for (let y = P.TOP + 9; y <= P.TOP + 12; y++) put(x, y, z, y === P.TOP + 12 ? "sea_lantern" : "quartz_pillar", y === P.TOP + 12 ? undefined : { pillar_axis: "y" }); }
    // the lockers (hidden barrels under the floor)
    for (let n = 0; n < P.lockers; n++) { const l = lockerAt(n); put(l.x, l.y, l.z, "barrel", { facing_direction: 1 }); }
    return C;
  }
  const arenaNow = () => { const g = gen(); let r; while (!(r = g.next()).done); return r.value; };
  return { POF, PILLARS, lockerAt, pillarFills, centerRings, centerParts, centerCore, gen, arena: arenaNow, size: (2 * o.HX + 1) + " x " + (2 * o.HX + 1) };
}

/** the classic arena: 16 pillars 7 x 7 (outer radius 27, inner 13), a round centre platform, 93 x 93 */
export const BIG = makeDesign({ H: 3, RO: 27, RI: 13, CR: 3, HX: 46, FLOOR: 40, VIEW: 42, OUT_R: 36, RAIN_R: 28 });
/** the hard arena: 16 pillars of ONE block (outer radius 15, inner 7 - about 7 blocks apart), a 1 x 1 golden centre, 77 x 77 */
export const SMALL = makeDesign({ H: 0, RO: 15, RI: 7, CR: 0, HX: 38, FLOOR: 28, VIEW: 31, OUT_R: 24, RAIN_R: 18 });
// (the names used before: the classic arena)
export const { POF, PILLARS, lockerAt, pillarFills, centerRings } = BIG;
export const pillarsGen = BIG.gen;
export function pillarsArena() { return BIG.arena(); }
