// Commands:  /smp:menu  /smp:daily  /smp:stats  /smp:achievements  /smp:inbox 
// Registered in their OWN startup handler, so a problem here can never stop the shop commands from loading.
import { system, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { dashboard, statsPage, achievementsPage, dailyPage, notificationsPage } from "./menu.js";
import { luxCmd } from "../lux.js";

system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const player = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);
  const reg = (name, description, fn, permissionLevel = CommandPermissionLevel.Any) => {
    try { cr.registerCommand({ name, description, permissionLevel, cheatsRequired: false }, (o) => { const p = player(o); if (p) system.run(() => { luxCmd(p, name); fn(p); }); return OK; }); }
    catch (e) { console.warn("[smp] command " + name + " not registered: " + e); }
  };
  reg("smp:menu", "Open the SMP menu", dashboard);
  reg("smp:daily", "Open the daily reward", dailyPage);
  reg("smp:stats", "Open your statistics", statsPage);
  reg("smp:achievements", "Open your achievements", achievementsPage);
  reg("smp:inbox", "Open your notifications", notificationsPage);
});
