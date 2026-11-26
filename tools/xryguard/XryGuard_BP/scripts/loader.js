// ============================================================
//  XryGuard - تحميل مناطق بعيدة (Ticking Area) للفحص المسبق والاسترجاع
// ============================================================
import { system } from "@minecraft/server";
import { TICKING_AREA } from "./config.js";
import * as store from "./store.js";
import { processChunk, restoreChunk, chunkLoaded, WAIT } from "./hider.js";

const REGION = 8; // 8x8 تشنكات بكل مرة (+ إطار تشنك = 10x10 = 100 حد الـ ticking area)
const LOAD_TIMEOUT_TICKS = 600;
let busy = false;

export function isBusy() {
  return busy;
}

function cmd(dim, text) {
  try {
    dim.runCommand(text);
    return true;
  } catch (e) {
    console.warn(`[XryGuard] command failed: ${text} -> ${e}`);
    return false;
  }
}

function* withArea(dim, cx0, cz0, cx1, cz1, body) {
  cmd(dim, `tickingarea remove ${TICKING_AREA}`);
  const ok = cmd(
    dim,
    `tickingarea add ${cx0 * 16} 0 ${cz0 * 16} ${cx1 * 16 + 15} 0 ${cz1 * 16 + 15} ${TICKING_AREA} true`
  );
  if (!ok) return false;
  const startTick = system.currentTick;
  for (;;) {
    let all = true;
    for (let cx = cx0; cx <= cx1 && all; cx++)
      for (let cz = cz0; cz <= cz1 && all; cz++) if (!chunkLoaded(dim, cx, cz)) all = false;
    if (all) break;
    if (system.currentTick - startTick > LOAD_TIMEOUT_TICKS) break;
    yield WAIT;
  }
  try {
    yield* body();
  } finally {
    cmd(dim, `tickingarea remove ${TICKING_AREA}`);
  }
  return true;
}

// يفحص ويخفي منطقة مربعة حول نقطة، حتى لو ماكو لاعبين هناك.
export function* prescan(dim, center, radiusBlocks, notify) {
  busy = true;
  try {
    const c0x = Math.floor((center.x - radiusBlocks) / 16);
    const c1x = Math.floor((center.x + radiusBlocks) / 16);
    const c0z = Math.floor((center.z - radiusBlocks) / 16);
    const c1z = Math.floor((center.z + radiusBlocks) / 16);
    const totalRegions = Math.ceil((c1x - c0x + 1) / REGION) * Math.ceil((c1z - c0z + 1) / REGION);
    let region = 0;
    let processed = 0;
    let failed = 0;
    for (let gx = c0x; gx <= c1x; gx += REGION) {
      for (let gz = c0z; gz <= c1z; gz += REGION) {
        region++;
        const ex = Math.min(gx + REGION - 1, c1x);
        const ez = Math.min(gz + REGION - 1, c1z);
        let pending = false;
        for (let cx = gx; cx <= ex && !pending; cx++)
          for (let cz = gz; cz <= ez && !pending; cz++) if (!store.isDone(dim.id, cx, cz)) pending = true;
        if (!pending) continue;
        const ok = yield* withArea(dim, gx - 1, gz - 1, ex + 1, ez + 1, function* () {
          for (let cx = gx; cx <= ex; cx++)
            for (let cz = gz; cz <= ez; cz++) {
              if (store.isDone(dim.id, cx, cz)) continue;
              const ok = yield* processChunk(dim, cx, cz);
              if (ok) processed++;
              else failed++;
            }
        });
        if (!ok) return notify("§c[XryGuard] ما گدرت أسوي ticking area. شيل وحدة من القديمات وعيد.");
        notify(`§7[XryGuard] فحص مسبق: ${region}/${totalRegions} منطقة`);
      }
    }
    notify(`§a[XryGuard] خلص الفحص المسبق. تشنكات انفحصت: ${processed}، فشلت: ${failed}`);
  } finally {
    busy = false;
  }
}

// يرجّع كل الخامات المخفية بالبعد (قبل حذف الأدآون).
export function* restoreAll(dim, notify) {
  busy = true;
  try {
    const regions = new Map();
    for (const key of store.knownKeys(dim.id)) {
      const { cx, cz } = store.parseKey(key);
      const rk = `${Math.floor(cx / REGION)}:${Math.floor(cz / REGION)}`;
      if (!regions.has(rk)) regions.set(rk, []);
      regions.get(rk).push({ cx, cz });
    }
    let restored = 0;
    let left = 0;
    let i = 0;
    for (const chunks of regions.values()) {
      i++;
      const gx = Math.floor(chunks[0].cx / REGION) * REGION;
      const gz = Math.floor(chunks[0].cz / REGION) * REGION;
      yield* withArea(dim, gx, gz, gx + REGION - 1, gz + REGION - 1, function* () {
        for (const { cx, cz } of chunks) {
          const n = restoreChunk(dim, cx, cz);
          if (n < 0) left++;
          else restored += n;
          yield;
        }
      });
      if (i % 5 === 0) notify(`§7[XryGuard] استرجاع: ${i}/${regions.size} منطقة`);
    }
    notify(
      left === 0
        ? `§a[XryGuard] رجعت ${restored} خامة بـ ${dim.id}. هسه تگدر تشيل الأدآون بأمان.`
        : `§e[XryGuard] رجعت ${restored} خامة، بس ${left} تشنك ما انحمل. عيد الأمر.`
    );
  } finally {
    busy = false;
  }
}
