// CRATE OPENING ANIMATION (hologram roulette)
//   1. key goes in   -> sound + magic particles around the crate
//   2. the possible rewards pop up as floating icons in a ring above the crate
//   3. a glowing marker runs over the icons: fast at first, then slower and slower
//   4. it stops on the reward that was already rolled -> big flash, the icon grows, then flies to the player
// The reward is decided BEFORE the animation (by crates.js); this file only shows it. Everything is wrapped in try/catch and
// every icon removes itself (entity timer) even if the script stops, so nothing can be left behind or block another system.
import { world, system } from "@minecraft/server";
import { CRATE_ICONS } from "./crateicons.js";

const TYPE = "smp:crate_icon";
const SIZE_IDLE = 48, SIZE_SEL = 88, SIZE_WIN = 150;       // icon size (% of one block)
const RING_UP = 2.7;                                       // ring height above the crate block
const SAFETY_TICKS = 20 * 22;                              // whole show can never last longer than this

const iconIdx = (path) => { const i = CRATE_ICONS.indexOf(path); return i < 0 ? 0 : i; };
const ok = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch (er) { return false; } };

function near(dim, at, fn) {
  try { for (const pl of dim.getPlayers({ location: at, maxDistance: 20 })) { try { fn(pl); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
}
function sfx(dim, at, id, volume, pitch) { near(dim, at, (pl) => pl.playSound(id, { volume, pitch })); }
function fx(dim, id, at) { try { dim.spawnParticle(id, at); } catch (e) { /* ignore */ } }

/**
 * opts: { player, dim, pos:{x,y,z} (crate block), rewards:[...], winner:index, iconOf(r), labelOf(r), onReward(), onClosed() }
 * returns { abort() }  (abort = show ends now, the reward is still given)
 */
export function playOpening(opts) {
  const { player, dim, pos, rewards, winner, iconOf, labelOf } = opts;
  const N = rewards.length;
  const cx = pos.x + 0.5, cy = pos.y + RING_UP, cz = pos.z + 0.5;
  const R = Math.min(5, Math.max(2.4, N * 0.32));
  const ents = [];                                         // icon entity per reward
  const spots = [];                                        // where each icon floats
  const timers = new Set();
  let label = null, rewarded = false, closed = false, cur = -1;

  const later = (ticks, fn) => {
    const id = system.runTimeout(() => { timers.delete(id); if (closed && fn !== finishClose) return; try { fn(); } catch (e) { console.warn("[crate-anim] " + e); abort(); } }, Math.max(1, ticks));
    timers.add(id); return id;
  };
  const giveOnce = () => { if (rewarded) return; rewarded = true; try { opts.onReward(); } catch (e) { console.warn("[crate-anim] reward: " + e); } };
  const setSize = (i, s) => { try { if (ok(ents[i])) ents[i].setProperty("smp:size", s); } catch (e) { /* ignore */ } };
  const setLabel = (txt) => { try { if (ok(label)) label.nameTag = txt; } catch (e) { /* ignore */ } };
  const bar = (txt) => { try { if (ok(player)) player.onScreenDisplay.setActionBar(txt); } catch (e) { /* ignore */ } };

  function finishClose() {
    closed = true;
    for (const t of [...timers]) { try { system.clearRun(t); } catch (e) { /* ignore */ } }
    timers.clear();
    for (const e of ents) { try { if (ok(e)) e.remove(); } catch (er) { /* ignore */ } }
    try { if (ok(label)) label.remove(); } catch (e) { /* ignore */ }
    try { opts.onClosed(); } catch (e) { /* ignore */ }
  }
  function abort() {
    if (closed) return;
    giveOnce();
    closed = true;
    finishClose();
  }

  // ------------------------------------------------ 1. key goes in
  const mid = { x: cx, y: pos.y + 1.2, z: cz };
  sfx(dim, mid, "random.anvil_use", 0.5, 1.6);
  sfx(dim, mid, "random.chestopen", 0.8, 0.9);
  for (let i = 0; i < 3; i++) fx(dim, "minecraft:enchanting_table_particle", { x: cx + (Math.random() - 0.5), y: pos.y + 1.3 + Math.random() * 0.6, z: cz + (Math.random() - 0.5) });
  fx(dim, "minecraft:totem_particle", mid);
  bar("§b§l[SPINNING...]");

  // ------------------------------------------------ 2. icons pop up in a ring
  try {
    label = dim.spawnEntity(TYPE, { x: cx, y: cy + 1.0, z: cz });
    label.setProperty("smp:size", 1); label.nameTag = "§7...";
  } catch (e) { console.warn("[crate-anim] needs the updated pack: " + e); abort(); return { abort }; }
  const popGap = Math.max(1, Math.min(3, Math.floor(24 / N)));
  for (let k = 0; k < N; k++) {
    const th = (2 * Math.PI * k) / N, dx = Math.sin(th), dz = Math.cos(th);
    const at = { x: cx + dx * R, y: cy, z: cz + dz * R };
    spots.push(at);
    later(4 + k * popGap, () => {
      const e = dim.spawnEntity(TYPE, at);
      e.setProperty("smp:icon", iconIdx(iconOf(rewards[k])));
      e.setProperty("smp:size", SIZE_IDLE);
      e.teleport(at, { rotation: { x: 0, y: -th * 180 / Math.PI } });
      ents[k] = e;
      fx(dim, "minecraft:villager_happy", at);
      sfx(dim, at, "random.pop", 0.6, 0.8 + (k / N) * 0.9);
    });
  }
  const spawnEnd = 4 + N * popGap + 6;

  // ------------------------------------------------ 3. the marker runs, slower and slower
  const S = 22, start = (((winner - S) % N) + N) % N;       // exactly S steps from `start` end on the winner (so the stop is always the rolled reward)
  const delays = [];
  for (let i = 0; i < S; i++) delays.push(2 + Math.floor(Math.pow(i / Math.max(1, S - 1), 3) * 13));   // 2 ticks -> 15 ticks
  let t = spawnEnd;
  const select = (i, step) => {
    if (cur >= 0) setSize(cur, SIZE_IDLE);
    cur = i; setSize(i, SIZE_SEL);
    setLabel("§e" + labelOf(rewards[i]));
    const at = spots[i];
    fx(dim, "minecraft:end_rod", at);
    sfx(dim, at, "note.hat", 0.7, 1.0 + 0.5 * (step / S));
    bar("§b§l[SPINNING...]  §a[SELECTING REWARD...]");
  };
  for (let s = 0; s < S; s++) {
    const i = (start + s + 1) % N, step = s + 1;
    t += delays[s];
    later(t, () => select(i, step));
  }

  // ------------------------------------------------ 4. reveal
  t += 24;                                                 // the tension pause on the last icon
  later(t, () => {
    const w = winner;
    setSize(w, 120);
    setLabel("§6§l★ " + labelOf(rewards[w]) + " §6§l★");
    bar("§6§l★ " + labelOf(rewards[w]) + " §6§l★");
    sfx(dim, spots[w], "random.totem", 0.9, 1.0);
    sfx(dim, spots[w], "random.levelup", 0.9, 1.0);
    for (let i = 0; i < 12; i++) fx(dim, "minecraft:totem_particle", { x: spots[w].x + (Math.random() - 0.5) * 0.8, y: spots[w].y + (Math.random() - 0.5) * 0.8, z: spots[w].z + (Math.random() - 0.5) * 0.8 });
    for (let i = 0; i < N; i++) if (i !== w) {
      fx(dim, "minecraft:large_explosion", spots[i]);
      try { if (ok(ents[i])) ents[i].remove(); } catch (e) { /* ignore */ }
    }
  });
  later(t + 4, () => setSize(winner, SIZE_WIN));
  // winner flies to the player, then the reward is given
  const hold = t + 30, fly = 10;
  later(hold, () => {
    const from = spots[winner];
    for (let k = 1; k <= fly; k++) {
      later(hold + k, () => {
        if (!ok(ents[winner])) return;
        const to = ok(player) ? { x: player.location.x, y: player.location.y + 1.1, z: player.location.z } : mid;
        const f = k / fly, e = f * f;
        ents[winner].teleport({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e });
        setSize(winner, Math.max(20, Math.round(SIZE_WIN * (1 - 0.7 * f))));
      });
    }
  });
  later(hold + fly + 1, () => { giveOnce(); });
  later(hold + fly + 6, finishClose);
  later(SAFETY_TICKS, abort);

  return { abort };
}
