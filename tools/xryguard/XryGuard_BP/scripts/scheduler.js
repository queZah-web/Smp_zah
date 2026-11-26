// ============================================================
//  XryGuard - يوزع الشغل على التكات حتى ما يصير لاگ
// ============================================================
import { system } from "@minecraft/server";

// إذا الجوب سوت yield WAIT، توقف لهذا التك وتكمل بالتك الجاي.
export const WAIT = Symbol("wait");

const jobs = [];
let budgetMs = 5;

export function setBudget(ms) {
  budgetMs = Math.max(1, ms);
}

export function addJob(gen, label = "job") {
  jobs.push({ gen, label });
}

export function jobCount() {
  return jobs.length;
}

export function runTick() {
  const start = Date.now();
  const waiting = new Set();
  let i = 0;
  while (jobs.length > waiting.size && Date.now() - start < budgetMs) {
    if (i >= jobs.length) i = 0;
    const job = jobs[i];
    if (waiting.has(job)) {
      i++;
      continue;
    }
    let r;
    try {
      r = job.gen.next();
    } catch (e) {
      console.warn(`[XryGuard] job "${job.label}" crashed: ${e}`);
      r = { done: true };
    }
    if (r.done) {
      jobs.splice(i, 1);
    } else if (r.value === WAIT) {
      waiting.add(job);
      i++;
    }
  }
}

export function start() {
  system.runInterval(runTick, 1);
}
