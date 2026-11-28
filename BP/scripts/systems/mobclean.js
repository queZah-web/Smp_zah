// ===================================================================================================================
// MOB CLEANER + BREEDING LIMIT (less lag)  -  Admin / Owner: /opr > World > Mob cleaner
//
//   MOB CLEANER: every 30 s / 1 / 2 / 5 / 10 min the chosen mobs are removed in all 3 worlds (no drops):
//     * monsters (zombies, skeletons, creepers ...): each one can be switched on / off
//     * animals: only when "Animals too" is ON, and only the chosen kinds
//     * junk: arrows lying around, XP orbs, thrown snowballs / eggs ... (each one on / off)
//     Never removed: players, villagers, golems, bosses, NPCs, armor stands, anything with a name tag, tamed or leashed
//     animals, the mobs of a running Lucky Wars game.
//   BREEDING LIMIT: when a baby animal is born and that kind of animal is already over the limit (20 / 30 / 50 / 80 / 120)
//     in its chunk or in its area of 8 x 8 chunks, one grown-up of that kind dies at once and drops its meat / leather /
//     wool like a normal kill.  Every minute the areas that are still over the limit lose a few grown-ups too.
// Saved in the world ("mobclean:cfg").  No lag: one entity list per world per run, the limit only checks on a birth.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { make, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { roleOf, slog } from "./staffcore.js";

const M = (ids) => ids.map((x) => "minecraft:" + x);
export const MONSTERS = M(["zombie", "zombie_villager_v2", "husk", "drowned", "skeleton", "stray", "bogged", "creeper", "spider", "cave_spider", "enderman", "witch", "slime", "magma_cube", "phantom", "zombie_pigman", "piglin", "piglin_brute", "hoglin", "zoglin", "blaze", "ghast", "wither_skeleton", "silverfish", "endermite", "pillager", "vindicator", "evocation_illager", "ravager", "vex", "guardian", "breeze", "creaking"]);
export const ANIMALS = M(["cow", "mooshroom", "pig", "sheep", "chicken", "rabbit", "goat", "horse", "donkey", "mule", "llama", "fox", "panda", "bee", "frog", "axolotl", "armadillo", "camel", "sniffer", "turtle", "cod", "salmon", "tropicalfish", "pufferfish", "squid", "glow_squid", "dolphin", "bat", "parrot", "polar_bear", "strider", "ocelot", "cat", "wolf"]);
export const JUNK = M(["arrow", "xp_orb", "snowball", "egg", "small_fireball", "fireworks_rocket"]);
const BREED = new Set(M(["cow", "mooshroom", "pig", "sheep", "chicken", "rabbit", "goat", "horse", "donkey", "llama", "fox", "panda", "frog", "axolotl", "armadillo", "camel", "sniffer", "turtle", "hoglin", "strider", "bee"]));
const NEVER = new Set(M(["player", "villager", "villager_v2", "wandering_trader", "iron_golem", "snow_golem", "allay", "ender_dragon", "wither", "npc", "armor_stand", "elder_guardian", "warden"]));
const SECS = [30, 60, 120, 300, 600], LIMITS = [20, 30, 50, 80, 120], AREAS = [16, 128], DIMS = ["overworld", "nether", "the_end"];
const nice = (id) => id.replace("minecraft:", "").replace("zombie_pigman", "zombified_piglin").replace("evocation_illager", "evoker").replace("zombie_villager_v2", "zombie_villager").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ---- settings
const DEF = { on: false, sec: 60, animals: false, junk: true, sel: [...MONSTERS, ...M(["arrow", "snowball", "egg", "small_fireball"])], breed: true, limit: 50, area: 128 };
let cfg = null;
export function mobCfg() { if (cfg) return cfg; try { const v = world.getDynamicProperty("mobclean:cfg"); cfg = { ...DEF, ...(typeof v === "string" ? JSON.parse(v) : {}) }; } catch (e) { return { ...DEF }; } return cfg; }
const save = () => { try { world.setDynamicProperty("mobclean:cfg", JSON.stringify(cfg)); } catch (e) { /* ignore */ } };
const isOn = (id) => mobCfg().sel.includes(id);
function toggle(id) { const c = mobCfg(); c.sel = c.sel.includes(id) ? c.sel.filter((x) => x !== id) : [...c.sel, id]; save(); }

// ---- the cleaner
const safeOne = (e) => {
  try {
    if (e.nameTag) return false;
    if (e.hasTag("lbw") || e.hasTag("egw")) return false;                                  // the mobs of a running game
    if (e.getComponent("minecraft:is_tamed") || e.getComponent("minecraft:leashable")?.isLeashed) return false;
    return true;
  } catch (x) { return false; }
};
let last = { t: 0, n: 0 };
export function cleanNow() {
  const c = mobCfg(), mons = new Set(MONSTERS.filter(isOn)), anim = new Set(c.animals ? ANIMALS.filter(isOn) : []), junk = new Set(c.junk ? JUNK.filter(isOn) : []);
  let n = 0;
  for (const d of DIMS) {
    let list = []; try { list = world.getDimension(d).getEntities(); } catch (e) { continue; }
    for (const e of list) {
      try {
        const t = e.typeId; if (NEVER.has(t)) continue;
        if (!mons.has(t) && !anim.has(t) && !junk.has(t)) continue;
        if (!junk.has(t) && !safeOne(e)) continue;
        e.remove(); n++;
      } catch (x) { /* gone */ }
    }
  }
  last = { t: Date.now(), n };
  return n;
}
let next = 0;
system.runInterval(() => {
  const c = mobCfg(); if (!c.on) { next = 0; return; }
  const now = Date.now(); if (!next) next = now + c.sec * 1000;
  if (now >= next) { next = now + c.sec * 1000; try { cleanNow(); } catch (e) { console.warn("[mobclean] " + e); } }
}, 20);

// ---- the breeding limit
const keyOf = (l, a) => Math.floor(l.x / a) + "," + Math.floor(l.z / a);
const adult = (e) => { try { return !e.getComponent("minecraft:is_baby"); } catch (x) { return true; } };
/** kills up to `max` grown-ups of this kind in the area of `l` when there are more than the limit.  Returns how many died */
function thin(dim, type, l, max) {
  const c = mobCfg(), k = keyOf(l, c.area);
  let list = []; try { list = dim.getEntities({ type }).filter((e) => { try { return keyOf(e.location, c.area) === k; } catch (x) { return false; } }); } catch (e) { return 0; }
  let over = list.length - c.limit; if (over <= 0) return 0;
  const grown = list.filter((e) => adult(e) && safeOne(e)).sort((a, b) => Math.hypot(a.location.x - l.x, a.location.z - l.z) - Math.hypot(b.location.x - l.x, b.location.z - l.z));
  let n = 0;
  for (const e of grown) { if (n >= Math.min(over, max)) break; try { e.kill(); n++; } catch (x) { /* ignore */ } }      // a normal death: meat / leather / wool drop
  return n;
}
world.afterEvents.entitySpawn.subscribe(({ entity: e, cause }) => {
  try {
    const c = mobCfg(); if (!c.breed || !e || !BREED.has(e.typeId)) return;
    if (String(cause) !== "Born" && !(e.typeId === "minecraft:chicken" && String(cause) === "Spawned")) return;
    const dim = e.dimension, l = e.location, type = e.typeId;
    system.run(() => thin(dim, type, l, 1));
  } catch (x) { /* ignore */ }
});
system.runInterval(() => {                                                                    // every minute: areas still over the limit
  const c = mobCfg(); if (!c.breed) return;
  for (const d of DIMS) {
    let dim; try { dim = world.getDimension(d); } catch (e) { continue; }
    const seen = new Set();
    for (const type of BREED) {
      let list = []; try { list = dim.getEntities({ type }); } catch (e) { continue; }
      if (list.length <= c.limit) continue;
      const count = new Map(); for (const e of list) { try { const k = keyOf(e.location, c.area); count.set(k, (count.get(k) ?? 0) + 1); } catch (x) { /* ignore */ } }
      for (const [k, n] of count) { if (n <= c.limit || seen.has(type + k)) continue; seen.add(type + k); const one = list.find((e) => { try { return keyOf(e.location, c.area) === k; } catch (x) { return false; } }); if (one) thin(dim, type, one.location, 5); }
    }
  }
}, 1200);

// ---------------------------------------------------------------- /opr > World > Mob cleaner (Admin / Owner)
const boss = (p) => { try { const r = roleOf(p); return r === "owner" || r === "admin"; } catch (e) { return false; } };
export function mobCleanPage(player, back) {
  if (!boss(player)) return back();
  const self = () => mobCleanPage(player, back), c = mobCfg();
  const f = make("Mob cleaner", SHORT_ROWS); f.self = self; f.glass = true;
  const flip = (k) => { c[k] = !c[k]; save(); try { slog(player, "mobclean", null, k + " " + (c[k] ? "ON" : "OFF")); } catch (e) { /* ignore */ } self(); };
  const cyc = (arr, k) => { c[k] = arr[(arr.indexOf(c[k]) + 1) % arr.length]; save(); self(); };
  const t = (s) => (s < 60 ? s + " s" : s / 60 + " min");
  set(f, 0 * COLS + 4, hdr(1, c.on ? "g" : "r") + "§c§lMob cleaner\n§r§7Removes the chosen mobs every few\n§r§7minutes (less lag). Name tags, pets,\n§r§7villagers and golems always stay.\n§r§7Last: §f" + (last.t ? last.n + " removed" : "-"), "textures/items/rotten_flesh", null);
  set(f, 1 * COLS + 1, hdr(1, c.on ? "g" : "r") + "§f§lCleaner: " + (c.on ? "§aON" : "§cOFF") + "\n§r§eClick to turn " + (c.on ? "OFF" : "ON"), c.on ? "textures/ui/shop/ic_confirm" : "textures/ui/shop/ic_cancel", { run: () => flip("on") });
  set(f, 1 * COLS + 2, hdr(Math.min(99, Math.max(1, c.sec / 60 | 0))) + "§f§lEvery: §e" + t(c.sec) + "\n§r§eClick: " + t(SECS[(SECS.indexOf(c.sec) + 1) % SECS.length]), "textures/items/clock_item", { run: () => cyc(SECS, "sec") });
  set(f, 1 * COLS + 3, hdr(1, "g") + "§a§lClear now\n§r§7The chosen mobs, once", "textures/ui/shop/i3d_tnt", { run: () => { const n = cleanNow(); player.sendMessage("§a[Mob cleaner] §f" + n + " §aremoved."); self(); } });
  set(f, 1 * COLS + 5, hdr(1, c.animals ? "g" : "r") + "§6§lAnimals too: " + (c.animals ? "§aON" : "§cOFF") + "\n§r§7OFF = animals are never removed\n§r§7ON = the chosen animals too\n§r§eClick", "textures/items/beef_raw", { run: () => flip("animals") });
  set(f, 1 * COLS + 6, hdr(1, c.junk ? "g" : "r") + "§7§lJunk too: " + (c.junk ? "§aON" : "§cOFF") + "\n§r§7Arrows on the ground, snowballs,\n§r§7eggs ... (the chosen ones)\n§r§eClick", "textures/items/arrow", { run: () => flip("junk") });
  const nOn = (l) => l.filter(isOn).length;
  set(f, 2 * COLS + 2, hdr(Math.min(99, Math.max(1, nOn(MONSTERS)))) + "§c§lChoose monsters\n§r§7Chosen: §f" + nOn(MONSTERS) + " / " + MONSTERS.length + "\n§r§eClick to open", "textures/items/bone", { run: () => pickPage(player, "Monsters", MONSTERS, self) });
  set(f, 2 * COLS + 3, hdr(Math.min(99, Math.max(1, nOn(ANIMALS)))) + "§6§lChoose animals\n§r§7Chosen: §f" + nOn(ANIMALS) + " / " + ANIMALS.length + "\n§r§7(only with Animals too ON)\n§r§eClick to open", "textures/items/leather", { run: () => pickPage(player, "Animals", ANIMALS, self) });
  set(f, 2 * COLS + 4, hdr(Math.min(99, Math.max(1, nOn(JUNK)))) + "§7§lChoose junk\n§r§7Chosen: §f" + nOn(JUNK) + " / " + JUNK.length + "\n§r§eClick to open", "textures/items/arrow", { run: () => pickPage(player, "Junk", JUNK, self) });
  set(f, 3 * COLS + 2, hdr(1, c.breed ? "g" : "r") + "§d§lBreeding limit: " + (c.breed ? "§aON" : "§cOFF") + "\n§r§7Too many cows (or pigs, sheep ...)?\n§r§7A baby is born = one grown-up dies\n§r§7and drops its meat\n§r§eClick", "textures/items/wheat", { run: () => flip("breed") });
  set(f, 3 * COLS + 3, hdr(Math.min(99, c.limit)) + "§d§lLimit: §f" + c.limit + " §7of one kind\n§r§eClick: " + LIMITS[(LIMITS.indexOf(c.limit) + 1) % LIMITS.length], "textures/items/egg", { run: () => cyc(LIMITS, "limit") });
  set(f, 3 * COLS + 4, hdr(1) + "§d§lArea: §f" + (c.area === 16 ? "1 chunk" : "8 x 8 chunks") + "\n§r§eClick to change", "textures/items/map_filled", { run: () => cyc(AREAS, "area") });
  backBtn(f, back); status(player, f);
  open(player, f);
}
const ICON_FIX = { zombie_villager_v2: "zombie_villager", evocation_illager: "evoker", zombie_pigman: "zombified_piglin" };
const iconOf = (id) => { const n = id.replace("minecraft:", ""); if (JUNK.includes(id)) return n === "xp_orb" ? "textures/items/experience_bottle" : n === "small_fireball" ? "textures/items/fireball" : n === "fireworks_rocket" ? "textures/items/fireworks" : "textures/items/" + n; return "textures/items/spawn_eggs/spawn_egg_" + (ICON_FIX[n] ?? n); };
function pickPage(player, title, ids, back) {
  if (!boss(player)) return back();
  const self = () => pickPage(player, title, ids, back);
  const f = make("Mob cleaner: " + title); f.self = self; f.glass = true;
  set(f, 4, hdr(1, "g") + "§f§l" + title + "\n§r§7Green = removed by the cleaner\n§r§7Click to switch", "textures/items/book_writable", null);
  ids.slice(0, 63).forEach((id, i) => {
    const on = isOn(id);
    set(f, 9 + i, hdr(1, on ? "g" : "r") + (on ? "§a" : "§c") + nice(id) + "\n§r" + (on ? "§aremoved" : "§7kept") + "\n§r§eClick", iconOf(id), { run: () => { toggle(id); self(); } });
  });
  backBtn(f, back); status(player, f);
  open(player, f);
}
