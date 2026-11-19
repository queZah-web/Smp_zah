// 🌱 CROP INFO PANEL (inside a protected land): look at a plant in YOUR land (owner / allowed player / admin) and its details appear
//   above the hotbar: name, stage, growth bar + exact percentage (it rises 3.6% -> 3.7% ...), time left until fully grown, land growth speed.
// The game only knows whole growth stages, so the percentage INSIDE a stage is an estimate: time since the stage was first seen divided by the
// average time of a stage (vanilla time / the land's Grow speed, the same maths growth.js uses).  When a stage changes (growth, Shift boost) it restarts.
// It never writes while another system owns the action bar (combat timer, skills, pay ...), and puts the stats bar back when it ends.
import { world, system } from "@minecraft/server";
import { claimAt, isMember, isAdmin, growLevel, growOf, growLeft, dur } from "./landcore.js";
import { CROPS, maxOf } from "./growth.js";
import { formBusy, combatBusy, skillBusy, passBusy, payBusy, clanBusy, afkBusy } from "../state.js";
import { stats } from "../data.js";
import { updateHud } from "../hud.js";

export const FARMINFO = {
  enabled: true,
  needCrouch: false,      // true = the panel only shows while you crouch
  reach: 6,               // how far you can be from the plant (blocks)
  everyTicks: 5,          // how often the look-target is checked
  barLen: 14,
};
const BAMBOO_MAX = 12;                                      // same limit as growth.js
const CAP = 0.95;                                           // inside a stage the estimate never goes past 95%: the real next stage decides the rest
const NAME = { "minecraft:wheat": "Wheat", "minecraft:carrots": "Carrots", "minecraft:potatoes": "Potatoes", "minecraft:beetroot": "Beetroot", "minecraft:melon_stem": "Melon Stem", "minecraft:pumpkin_stem": "Pumpkin Stem",
  "minecraft:nether_wart": "Nether Wart", "minecraft:cocoa": "Cocoa Beans", "minecraft:reeds": "Sugar Cane", "minecraft:cactus": "Cactus", "minecraft:bamboo": "Bamboo", "minecraft:cherry_sapling": "Cherry Sapling", "minecraft:sweet_berry_bush": "Sweet Berries", "minecraft:torchflower_crop": "Torchflower", "minecraft:pitcher_crop": "Pitcher Plant", "minecraft:bamboo_sapling": "Bamboo Shoot", "minecraft:mangrove_propagule": "Mangrove Propagule", "minecraft:crimson_fungus": "Crimson Fungus", "minecraft:warped_fungus": "Warped Fungus", "minecraft:pale_oak_sapling": "Pale Oak Sapling" };
const cap = (s) => String(s).split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

// ---------------------------------------------------------------- when each stage was first seen
const seen = new Map();                                                    // "dim|x|y|z" -> { k: stage key, t: ms }
function elapsedMs(block, key) {
  const id = block.dimension.id + "|" + block.x + "|" + block.y + "|" + block.z, now = Date.now(), s = seen.get(id);
  if (s && s.k === key) return now - s.t;
  if (seen.size > 600) seen.clear();
  seen.set(id, { k: key, t: now });
  return 0;
}
function stackHeight(block, type) {
  let h = 1;
  for (let i = 1; i < 20; i++) { const d = block.dimension.getBlock({ x: block.x, y: block.y - i, z: block.z }); if (d && d.typeId === type) h++; else break; }
  for (let i = 1; i < 20; i++) { const d = block.dimension.getBlock({ x: block.x, y: block.y + i, z: block.z }); if (d && d.typeId === type) h++; else break; }
  return h;
}

// ---------------------------------------------------------------- the numbers: { name, pct (0..100), left (ms), line (stage text), done }
function measure(block, speed) {
  const type = block.typeId, def = CROPS[type]; if (!def) return null;
  const sec = (def.sec / speed) * 1000, perm = block.permutation;
  let name = NAME[type] ?? cap(type.replace("minecraft:", ""));
  if (def.kind === "bamboo") {
    const h = stackHeight(block, type), el = elapsedMs(block, "b" + h), done = h >= BAMBOO_MAX, f = done ? 0 : Math.min(CAP, el / sec);
    return { name, pct: done ? 100 : ((h - 1 + f) / (BAMBOO_MAX - 1)) * 100, left: done ? 0 : (BAMBOO_MAX - h - f) * sec, line: "§7Height §f" + h + "§7/§f" + BAMBOO_MAX, done, wait: !done && el >= sec * CAP };
  }
  if (def.kind === "bsapling" || def.direct) {                                  // bamboo shoot / propagule / fungus: one stage, then it becomes the real thing
    const el = elapsedMs(block, "d"), f = Math.min(CAP, el / sec);
    return { name, pct: f * 100, left: (1 - f) * sec, line: def.kind === "bsapling" ? "§7Becomes a bamboo" : "§7Becomes a tree", done: false, wait: el >= sec * CAP };
  }
  if (def.kind === "sapling") {
    const age = perm.getState("age_bit") === true, el = elapsedMs(block, "s" + age), f = Math.min(CAP, el / sec);
    if (type === "minecraft:sapling") { const t = perm.getState("sapling_type"); if (t) name = cap(t) + " Sapling"; }
    return { name, pct: (age ? 50 : 0) + f * 50, left: ((age ? 1 : 2) - f) * sec, line: age ? "§7Stage §f2§7/§f2 §8- §7becomes a tree" : "§7Stage §f1§7/§f2 §8- §7becomes a tree", done: false, wait: el >= sec * CAP };
  }
  const v = perm.getState(def.state); if (typeof v !== "number") return null;
  if (def.kind === "tall") {
    const h = stackHeight(block, type), el = elapsedMs(block, "t" + h + "_" + v), done = h >= def.high, f = done ? 0 : Math.min(CAP, el / sec);
    const per = def.max + 1, total = def.high * per, now = (h - 1) * per + v + f;
    return { name, pct: done ? 100 : Math.min(99.9, (now / total) * 100), left: done ? 0 : Math.max(0, (total - now) * sec), line: "§7Height §f" + h + "§7/§f" + def.high, done, wait: !done && el >= sec * CAP };
  }
  const max = maxOf(def) || def.max, el = elapsedMs(block, "c" + v), done = v >= max, f = done ? 0 : Math.min(CAP, el / sec);
  const stem = type.endsWith("_stem");
  return { name, pct: done ? 100 : ((v + f) / max) * 100, left: done ? 0 : (max - v - f) * sec, line: "§7Stage §f" + (v + 1) + "§7/§f" + (max + 1), done, stem, wait: !done && el >= sec * CAP };
}

// ---------------------------------------------------------------- the panel text
function panel(m, claim, speed) {
  const L = FARMINFO.barLen, pct = Math.max(0, Math.min(100, m.pct)), fill = Math.round((pct / 100) * L);
  const bar = "§a" + "█".repeat(fill) + "§8" + "█".repeat(L - fill);
  const lines = ["§8« §a§l" + m.name + " §r§8»", "§7Growth " + bar + " §f§l" + pct.toFixed(1) + "%"];
  lines.push(m.done ? "§a§lFully grown" + (m.stem ? " §r§7- the fruit grows next to it" : " §r§7- ready") : m.line + " §8| §7Time left §e" + dur(m.left) + (m.wait ? " §8(§7next stage soon§8)" : ""));
  const lv = growLevel(claim);
  if (lv) lines.push("§7Land speed §ax" + speed + " §8(§7" + growOf(lv).name + " §8- §e" + dur(growLeft(claim)) + "§8)");
  return lines.join("\n");
}

// ---------------------------------------------------------------- loop
const busy = (id) => formBusy.has(id) || combatBusy.has(id) || skillBusy.has(id) || passBusy.has(id) || payBusy.has(id) || clanBusy.has(id) || afkBusy.has(id);
const st = new Map();                                                      // player id -> { text, t, on }
function stop(p, s) {
  if (!s.on) return;
  s.on = false; s.text = "";
  try { p.onScreenDisplay.setActionBar(""); } catch (e) { /* ignore */ }
  try { if ((stats(p).hud ?? "panel") === "bar") updateHud(p, true); } catch (e) { /* ignore */ }      // put the stats bar back
}
function lookAt(p) {
  const hit = p.getBlockFromViewDirection({ maxDistance: FARMINFO.reach, includePassableBlocks: true });
  const b = hit?.block; if (!b || !CROPS[b.typeId]) return null;
  const claim = claimAt(b.dimension.id, b.x, b.y, b.z);
  if (!claim || !(isMember(claim, p) || isAdmin(p))) return null;
  return { b, claim };
}
try {
  system.runInterval(() => {
    if (!FARMINFO.enabled) return;
    const now = system.currentTick;
    for (const p of world.getAllPlayers()) {
      try {
        let s = st.get(p.id); if (!s) { s = { text: "", t: 0, on: false }; st.set(p.id, s); }
        if (busy(p.id)) { s.on = false; continue; }                        // another system owns the screen right now
        const t = FARMINFO.needCrouch && !p.isSneaking ? null : lookAt(p);
        if (!t) { stop(p, s); continue; }
        const lv = growLevel(t.claim), speed = lv ? growOf(lv).x : 1, m = measure(t.b, speed);
        if (!m) { stop(p, s); continue; }
        const text = panel(m, t.claim, speed);
        if (text !== s.text || now - s.t >= 30) { p.onScreenDisplay.setActionBar(text); s.text = text; s.t = now; }
        s.on = true;
      } catch (e) { /* skip this player */ }
    }
  }, FARMINFO.everyTicks);
  world.afterEvents.playerLeave.subscribe((ev) => { st.delete(ev.playerId); });
} catch (e) { console.warn("[farminfo] not started: " + e); }
