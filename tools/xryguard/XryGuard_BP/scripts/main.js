// ============================================================
//  XryGuard - Anti X-Ray لسيرفرات بيدروك فانيلا
//  الفكرة: كل خامة مدفونة بالكامل تتحول لحجر حقيقي، ومكانها ينحفظ
//  بالسيرفر. من ينكسر بلوك يمها ترجع خامة. اللاعب العادي ما يحس،
//  والـ X-Ray (باك أو كلاينت مهكر) يشوف حجر بس.
// ============================================================
import { world, system } from "@minecraft/server";
import { DIMENSIONS } from "./config.js";
import * as store from "./store.js";
import * as scheduler from "./scheduler.js";
import { WAIT } from "./scheduler.js";
import { processChunk, revealNeighbors, reveal, checkArea, isHidden } from "./hider.js";
import * as loader from "./loader.js";

const SCAN_EVERY = 20; // كل ثانية نحدّث قائمة التشنكات
const HEAL_EVERY = 40; // كل ثانيتين فحص احتياطي حول اللاعبين

// ---------------- الفاحص التلقائي حول اللاعبين ----------------
let pending = [];

function rebuildQueue() {
  const s = store.getSettings();
  if (s.paused || loader.isBusy()) {
    pending = [];
    return;
  }
  const R = s.radius;
  const best = new Map();
  for (const p of world.getAllPlayers()) {
    const dimId = p.dimension.id;
    if (!DIMENSIONS[dimId]) continue;
    const pcx = Math.floor(p.location.x / 16);
    const pcz = Math.floor(p.location.z / 16);
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${dimId}|${cx}|${cz}`;
        const d = dx * dx + dz * dz;
        const cur = best.get(key);
        if (cur && cur.d <= d) continue;
        if (!cur && store.isDone(dimId, cx, cz)) continue;
        best.set(key, { dimId, cx, cz, d });
      }
  }
  pending = [...best.values()].sort((a, b) => a.d - b.d);
}

function* scanner() {
  for (;;) {
    const s = store.getSettings();
    if (s.paused || loader.isBusy() || pending.length === 0) {
      yield WAIT;
      continue;
    }
    const job = pending.shift();
    if (store.isDone(job.dimId, job.cx, job.cz)) continue;
    yield* processChunk(world.getDimension(job.dimId), job.cx, job.cz);
    yield;
  }
}

function healAroundPlayers() {
  const s = store.getSettings();
  if (s.paused || scheduler.jobCount() > 8) return;
  for (const p of world.getAllPlayers()) {
    if (!DIMENSIONS[p.dimension.id]) continue;
    scheduler.addJob(checkArea(p.dimension, p.location, s.healRadius), "heal");
  }
}

// ---------------- الأحداث ----------------
function subscribeEvents() {
  // اللاعب يحاول يكسر بلوك هو بنفسه خامة مخفية (حالة نادرة): نلغي ونكشفها.
  world.beforeEvents.playerBreakBlock?.subscribe((ev) => {
    const dim = ev.block.dimension;
    const loc = ev.block.location;
    if (isHidden(dim.id, loc)) {
      ev.cancel = true;
      system.run(() => reveal(dim, loc.x, loc.y, loc.z));
    }
  });

  // انكسر بلوك: نكشف الخامات اللي يمه فوراً.
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    revealNeighbors(ev.block.dimension, ev.block.location);
  });

  // الانفجار: الخامات المخفية ما تنفجر كحجر، تبقى وتنكشف.
  world.beforeEvents.explosion?.subscribe((ev) => {
    if (typeof ev.setImpactedBlocks !== "function") return;
    const dimId = ev.dimension.id;
    if (!DIMENSIONS[dimId]) return;
    const blocks = ev.getImpactedBlocks();
    const keep = blocks.filter((b) => !isHidden(dimId, b.location));
    if (keep.length !== blocks.length) ev.setImpactedBlocks(keep);
  });

  world.afterEvents.blockExplode?.subscribe((ev) => {
    revealNeighbors(ev.dimension, ev.block.location);
  });

  // البستن يحرك بلوكات: نفحص المنطقة بعد ما يخلص الحركة.
  world.afterEvents.pistonActivate?.subscribe((ev) => {
    const dim = ev.dimension;
    let locs = [];
    try {
      locs =
        ev.piston.getAttachedBlocksLocations?.() ??
        ev.piston.getAttachedBlocks?.().map((b) => b.location) ??
        [];
    } catch {
      locs = [];
    }
    locs.push(ev.block.location);
    system.runTimeout(() => {
      for (const l of locs) scheduler.addJob(checkArea(dim, l, 2), "piston");
    }, 4);
  });
}

// ---------------- الأوامر (/scriptevent) ----------------
function subscribeCommands() {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (!ev.id.startsWith("xry:")) return;
    if (ev.id !== "xry:reveal") system.runTimeout(announce, 5);
    const src = ev.sourceEntity;
    const say = (m) => {
      try {
        if (src && typeof src.sendMessage === "function") src.sendMessage(m);
        else console.warn(m.replace(/§./g, ""));
      } catch {}
    };
    const arg = (ev.message || "").trim();
    const s = store.getSettings();

    switch (ev.id) {
      case "xry:status": {
        const st = store.stats();
        say(
          `§b[XryGuard]§r الحالة: ${s.paused ? "§cمتوقف" : "§aشغال"}§r\n` +
            `تشنكات مسجلة: ${st.chunks}\nبالانتظار: ${pending.length}\nجوبات: ${scheduler.jobCount()}\n` +
            `نصف القطر: ${s.radius} تشنك | الميزانية: ${s.budgetMs}ms\n` +
            `خامات مخفية (بالذاكرة): ${st.hiddenInCache}`
        );
        break;
      }
      case "xry:radius": {
        const n = Math.max(2, Math.min(32, Number(arg) || 0));
        if (!arg) return say("§eالاستخدام: /scriptevent xry:radius <2-32>");
        store.updateSettings({ radius: n });
        say(`§a[XryGuard] نصف القطر صار ${n} تشنك`);
        break;
      }
      case "xry:budget": {
        const n = Math.max(1, Math.min(20, Number(arg) || 0));
        if (!arg) return say("§eالاستخدام: /scriptevent xry:budget <1-20>");
        store.updateSettings({ budgetMs: n });
        scheduler.setBudget(n);
        say(`§a[XryGuard] الميزانية صارت ${n}ms لكل تك`);
        break;
      }
      case "xry:reveal": {
        // مود SMP يطلب كشف الخامات المخفية بمكعب حول نقطة (قبل الحفر 3x3 / Vein Miner) حتى ما تنكسر كحجر
        const parts = arg.split(/\s+/), [x, y, z, r] = parts.slice(0, 4).map(Number), dimArg = parts[4];
        if (![x, y, z].every(Number.isFinite)) return;
        const R = Math.max(1, Math.min(8, r || 3));
        for (const dimId of Object.keys(DIMENSIONS)) {
          if (dimArg && dimArg !== dimId) continue;
          const dim = world.getDimension(dimId);
          for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
            if (isHidden(dimId, { x: x + dx, y: y + dy, z: z + dz })) reveal(dim, x + dx, y + dy, z + dz);
          }
        }
        return;
      }
      case "xry:pause":
        store.updateSettings({ paused: true });
        say("§e[XryGuard] توقف إخفاء التشنكات الجديدة (الكشف يبقى شغال)");
        system.run(announce);
        break;
      case "xry:resume":
        store.updateSettings({ paused: false });
        say("§a[XryGuard] رجع يشتغل");
        system.run(announce);
        break;
      case "xry:prescan": {
        if (!src || !src.dimension) return say("§cلازم تشغل الأمر وإنت داخل اللعبة");
        if (!DIMENSIONS[src.dimension.id]) return say("§cهذا البعد ما بيه خامات");
        if (loader.isBusy()) return say("§cأكو فحص أو استرجاع شغال هسه");
        const r = Math.max(16, Math.min(5000, Number(arg) || 0));
        if (!arg) return say("§eالاستخدام: /scriptevent xry:prescan <نصف القطر بالبلوكات>");
        say(`§b[XryGuard] بلشت فحص مسبق بنصف قطر ${r} بلوك...`);
        scheduler.addJob(loader.prescan(src.dimension, src.location, r, say), "prescan");
        break;
      }
      case "xry:restore": {
        if (loader.isBusy()) return say("§cأكو فحص أو استرجاع شغال هسه");
        if (arg !== "confirm")
          return say("§eهذا يرجّع كل الخامات ويوقف الأدآون. للتأكيد: /scriptevent xry:restore confirm");
        store.updateSettings({ paused: true });
        say("§b[XryGuard] بلشت أرجّع الخامات بكل الأبعاد...");
        scheduler.addJob(
          (function* () {
            for (const dimId of Object.keys(DIMENSIONS)) yield* loader.restoreAll(world.getDimension(dimId), say);
          })(),
          "restore"
        );
        break;
      }
      default:
        say(
          "§b[XryGuard] الأوامر:§r\n" +
            "xry:status | xry:prescan <بلوكات> | xry:radius <تشنكات>\n" +
            "xry:budget <ms> | xry:pause | xry:resume | xry:restore confirm"
        );
    }
  });
}

// ---------------- الربط مع مود SMP ----------------
function announce() {
  try {
    const s = store.getSettings();
    world.getDimension("minecraft:overworld").runCommand(
      `scriptevent smp:xry ${JSON.stringify({ p: s.paused ? 1 : 0, r: s.radius, b: s.budgetMs, busy: loader.isBusy() ? 1 : 0 })}`
    );
  } catch {}
}

// ---------------- التشغيل ----------------
let started = false;
function start() {
  if (started) return;
  started = true;
  store.init();
  scheduler.setBudget(store.getSettings().budgetMs);
  scheduler.start();
  scheduler.addJob(scanner(), "scanner");
  subscribeEvents();
  subscribeCommands();
  system.runInterval(() => store.flush(), 1);
  system.runInterval(rebuildQueue, SCAN_EVERY);
  system.runInterval(healAroundPlayers, HEAL_EVERY);
  // يخبر مود SMP إنه شغال + الإعدادات (كل 10 ثواني) حتى تبين أزرار /opr
  system.runInterval(announce, 200);
  system.runTimeout(announce, 40);
  console.warn("[XryGuard] Anti X-Ray started");
}

const loadEvent = world.afterEvents.worldLoad ?? world.afterEvents.worldInitialize;
if (loadEvent) loadEvent.subscribe(start);
else system.run(start);
