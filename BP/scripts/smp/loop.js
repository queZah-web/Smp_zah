// Background jobs: achievement checks, daily reward reminders, join message.
import { world, system } from "@minecraft/server";
import { checkAchievements, sampleWorld } from "./achievements.js";
import { tickMissions } from "./missions.js";
import { remindDaily, dailyInfo } from "./daily.js";
import { unread } from "./notify.js";
import { ex } from "./store.js";
import { menuMsg } from "../systems/menulang.js";

const each = (fn) => { for (const p of world.getAllPlayers()) { try { fn(p); } catch (e) { console.warn("[smp] " + e); } } };

system.runInterval(() => each((p) => { sampleWorld(p); checkAchievements(p); }), 40);          // every 2 s
system.runInterval(() => each((p) => tickMissions(p)), 200);              // every 10 s (tells the player when a mission is finished)
system.runInterval(() => each((p) => remindDaily(p)), 1200);              // every minute (the day may have changed)

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      remindDaily(player, false);
      if (ex(player).set.join === false) return;
      const n = unread(player);
      if (n > 0) player.sendMessage(menuMsg(player, `§e[SMP] §fYou have §a${n} §fnew notification${n > 1 ? "s" : ""}` + (dailyInfo(player).available ? " §7- §aDaily reward ready!" : "") + " §7(sneak + Clock, or /smp:menu)"));
    } catch (e) { /* player left */ }
  }, 100);
});
