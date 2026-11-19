// Commands:  /home [name]  /sethome [name]  /spawn  /rtp  /tpa <player>  /tphere <player>  /tpaccept  /tpdeny  /clan  /clanhome  /cc  /sc (staff chat)  /report  /clantop  /mining  /nv
// Registered in their OWN startup handler (each one inside try/catch), so a problem here can never stop the shop commands.
import { system, world, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType } from "@minecraft/server";
import { dashboard } from "../smp/menu.js";
import { homePage, goHome, saveHome, findHome } from "./homes.js";
import { rtpPage } from "./rtp.js";
import { goSpawn } from "./spawn.js";
import { sendTpa, sendTphere, acceptTpa, denyTpa, tpaPage, pickPlayer } from "./tpa.js";
import { clanPage, goClanHome, clanChat, topPage } from "./clans.js";
import { miningPage } from "./miningmenu.js";
import { skillsPage, abilitiesPage } from "./skillsmenu.js";
import { nvToggle } from "./nv.js";
import { nvPage } from "./nvmenu.js";
import { luxCmd, luxSave } from "../lux.js";
import { landPage } from "./landmenu.js";
import { passesPage } from "./tables.js";
import { duelPage } from "./duel.js";
import { payPage, payTo } from "./pay.js";
import { showTop, TOP_USAGE } from "./hologram.js";
import { ahCommand } from "../smp/ahmenu.js";
import { orderCommand } from "../smp/ordermenu.js";
import { cosmeticsPage } from "../smp/cosmenu.js";
import { staffChat } from "./staffcore.js";
import { reportCommand, afkSettingsPage, lockPage } from "./staffmenu.js";
import { opPage } from "./opmenu.js";
import { allow, isOwner } from "./staffcore.js";
import { toggleTestCrown } from "./crown.js";
import { mobRewardOn, setMobReward } from "./mobreward.js";
import { afkCommand } from "./afk.js";
import { toggleSellSlot } from "./sellslot.js";
import { endGateOpen, eventView, startEvent, stopEvent, mmss, DEFAULT_OPEN_MS } from "./endgate.js";
import { menuMsg } from "./menulang.js";
import { goBack, backOn, setBackOn } from "./back.js";
import { pick } from "./arextra.js";

system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  const OK = { status: CustomCommandStatus.Success };
  const player = (o) => (o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null);
  const reg = (def, fn) => {
    try {
      cr.registerCommand({ permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, ...def }, (o, ...args) => {
        const p = player(o);
        if (p) system.run(() => { luxCmd(p, def.name, args[0]); try { fn(p, ...args); } catch (e) { console.warn("[smp] /" + def.name + " failed: " + e); } });
        return OK;
      });
    } catch (e) { console.warn("[smp] command " + def.name + " not registered: " + e); }
  };
  const back = (p) => () => dashboard(p);

  reg({ name: "smp:home", description: "Open the homes menu (or /home <name> to go directly)", optionalParameters: [{ name: "name", type: CustomCommandParamType.String }] }, (p, name) => {
    if (name) { const h = findHome(p, name); return h ? goHome(p, h) : p.sendMessage(menuMsg(p, "§c[Home] You have no home called " + name + ".")); }
    homePage(p, back(p));
  });
  reg({ name: "smp:sethome", description: "Save a home at your position", optionalParameters: [{ name: "name", type: CustomCommandParamType.String }] }, (p, name) => {
    const err = saveHome(p, name, true);
    p.sendMessage(menuMsg(p, err ? "§c[Home] " + err : "§a[Home] Home §f" + (name || "home") + " §asaved at your position."));
    if (!err) luxSave(p);
  });
  reg({ name: "smp:spawn", description: "Teleport to spawn" }, (p) => goSpawn(p));
  reg({ name: "smp:back", description: "Go back to the place where you died" }, (p) => goBack(p));
  reg({ name: "smp:backset", description: "Turn /back on or off (Owner / Admin): /backset on | off | status", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }] }, (p, action) => {
    const a = String(action ?? "status").toLowerCase();
    if (a === "on" || a === "off") {
      if (!allow(p, "back")) return;
      const r = setBackOn(p, a === "on");
      return p.sendMessage(r.err ? "§c[Back] " + r.err : pick(p, "§6[Back] §f/back is now " + (r.on ? "§aON" : "§cOFF") + "§f.", "§6[العودة] أمر /back الآن " + (r.on ? "§aمفعّل" : "§cمعطّل") + "§f."));
    }
    p.sendMessage(pick(p, "§6[Back] §f/back is " + (backOn() ? "§aON" : "§cOFF"), "§6[العودة] أمر /back " + (backOn() ? "§aمفعّل" : "§cمعطّل")));
  });
  reg({ name: "smp:sellslot", description: "Turn the red sell slot (top-right slot of your backpack) ON or OFF: items moved into it are sold at once" }, (p) => { toggleSellSlot(p); });
  reg({ name: "smp:afk", description: "Teleport to the AFK area: a timer shows on your screen and every minute you earn money and shards (use it again to go back)" }, (p) => afkCommand(p));
  // /crown  -  Owner / Admin only: puts the Duel Arena Crown on you to test it (use it again to take it off)
  reg({ name: "smp:crown", description: "Admin test: wear the Duel Arena Crown (use again to take it off)" }, (p) => {
    if (!allow(p, "duelset")) return;
    p.sendMessage(menuMsg(p, toggleTestCrown(p) ? "§6[Crown] §fTest crown §aON§f. Use §e/crown §fagain to take it off." : "§6[Crown] §fTest crown §cOFF§f."));
  });
  reg({ name: "smp:afkset", description: "AFK area settings (Owner / Admin): rewards per minute and the area" }, (p) => { if (allow(p, "afkset")) afkSettingsPage(p, back(p)); });
  reg({ name: "smp:lock", description: "Owner only: supreme lock - lock the AFK area and the lands so nobody (not even Admins) can break them" }, (p) => { if (isOwner(p)) lockPage(p, back(p)); else p.sendMessage(menuMsg(p, "§c[Lock] Only the Owner can use this.")); });
  reg({ name: "smp:rtp", description: "Random teleport menu" }, (p) => rtpPage(p, back(p)));
  reg({ name: "smp:tpa", description: "Ask to teleport to a player", optionalParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }] }, (p, targets) => {
    const t = targets?.[0];
    if (t) sendTpa(p, t); else tpaPage(p, back(p));
  });
  reg({ name: "smp:tphere", description: "Ask a player to teleport to you", optionalParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }] }, (p, targets) => {
    const t = targets?.[0];
    if (t) sendTphere(p, t); else pickPlayer(p, "§fWhich player should come to you?", sendTphere);
  });
  reg({ name: "smp:tpaccept", description: "Accept a teleport request" }, (p) => acceptTpa(p));
  reg({ name: "smp:tpdeny", description: "Deny a teleport request" }, (p) => denyTpa(p));
  reg({ name: "smp:clan", description: "Open the clan menu" }, (p) => clanPage(p, back(p)));
  reg({ name: "smp:clanhome", description: "Teleport to your clan home" }, (p) => goClanHome(p));
  reg({ name: "smp:cc", description: "Clan chat: /cc <message> (only your clan sees it)", mandatoryParameters: [{ name: "message", type: CustomCommandParamType.Message ?? CustomCommandParamType.String }] }, (p, message) => clanChat(p, message));
  reg({ name: "smp:opr", description: "Operator panel (operators and staff only)" }, (p) => opPage(p, back(p)));   // opPage checks isStaff itself
  reg({ name: "smp:sc", description: "Staff chat: /sc <message> (only operators see it)", mandatoryParameters: [{ name: "message", type: CustomCommandParamType.Message ?? CustomCommandParamType.String }] }, (p, message) => staffChat(p, message));
  reg({ name: "smp:report", description: "Report a player to the staff: /report <player> <reason>", optionalParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }, { name: "reason", type: CustomCommandParamType.Message ?? CustomCommandParamType.String }] }, (p, targets, reason) => reportCommand(p, targets, reason));
  reg({ name: "smp:clantop", description: "Top clans (kills and money) and the daily shard rewards" }, (p) => topPage(p, back(p)));
  reg({ name: "smp:protect", description: "Land protection: buy time, allowed players, borders" }, (p) => landPage(p, back(p)));
  reg({ name: "smp:pass", description: "Buy a 30-minute pass for the Anvil, Enchanting Table, Grindstone or Smithing Table" }, (p) => passesPage(p, back(p)));
  reg({ name: "smp:duel", description: "Open the hourly 1 vs 1 duel challenge (while a round is open)" }, (p) => duelPage(p));
  reg({ name: "smp:land", description: "Land protection (same as /protect)" }, (p) => landPage(p, back(p)));
  reg({ name: "smp:cosmetics", description: "Cosmetics: titles, name colors, particle trails, effects and sounds" }, (p) => cosmeticsPage(p, back(p)));
  reg({ name: "smp:mining", description: "Open the mining tools menu (Timber, Vein Miner, Area Mining, Magnet, Auto-Smelt)" }, (p) => miningPage(p, back(p)));
  reg({ name: "smp:skills", description: "Open your skill levels (Mining, Woodcutting, Excavation, Farming) and tool speed upgrades" }, (p) => skillsPage(p, back(p)));
  reg({ name: "smp:abilities", description: "Open all the abilities you unlocked from skill levels" }, (p) => abilitiesPage(p, back(p)));
  reg({ name: "smp:pay", description: "Send money to a player (online or offline)", optionalParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }, { name: "amount", type: CustomCommandParamType.String }] }, (p, targets, amount) => {
    const t = targets?.[0];
    if (t) payTo(p, back(p), t, amount); else payPage(p, back(p));
  });
  reg({ name: "smp:nv", description: "Night vision on / off (paid time). /nv menu = open the Night Vision page (buy time; admins can set the prices there)", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }] }, (p, action) => {
    if (action && ["menu", "shop", "buy", "price", "prices", "set", "admin"].includes(String(action).toLowerCase())) return nvPage(p, back(p));
    if (nvToggle(p) === "none") { p.sendMessage(menuMsg(p, "\u00a7c[NV] You have no night vision time left. Buy hours here:")); nvPage(p, back(p)); }
  });

  // /top [money|clan|duel|sell|buy|play|kills|shards|skills|ach]  -  floating hologram leaderboard in front of the player
  reg({ name: "smp:top", description: "Top 10 hologram: /top money | clan | duel | sell | buy | play | kills | shards | skills | ach", optionalParameters: [{ name: "type", type: CustomCommandParamType.String }] }, (p, type) => {
    if (!showTop(p, type)) p.sendMessage(menuMsg(p, "\u00a76[Top] \u00a77Use: " + TOP_USAGE));
  });
  reg({ name: "smp:ah", description: "Auction House: /ah | /ah sell <price> | /ah list | /ah search <word>", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }, { name: "value", type: CustomCommandParamType.String }] }, (p, action, value) => ahCommand(p, action, value, back(p)));
  reg({ name: "smp:order", description: "Buy orders: ask for items and pay for them (/order | /order list | /order <item>)", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }] }, (p, action) => orderCommand(p, action, back(p)));
  reg({ name: "smp:orders", description: "Buy orders (same as /order)", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }] }, (p, action) => orderCommand(p, action, back(p)));
  reg({ name: "smp:end", description: "The End event (Owner / Admin): /end start [minutes until it opens] | open | close | cancel | status", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }, { name: "minutes", type: CustomCommandParamType.Integer }] }, (p, action, minutes) => {
    const a = String(action ?? "status").toLowerCase(), say = (m) => p.sendMessage(menuMsg(p, m));
    let r = null;
    if (a === "start") r = startEvent(p, Math.max(10, (Number(minutes) || 1) * 60) * 1000, DEFAULT_OPEN_MS);
    else if (a === "open") r = startEvent(p, 0, DEFAULT_OPEN_MS);
    else if (a === "close" || a === "cancel") r = stopEvent(p);
    if (r) { if (r.err) say("§c[End] " + r.err); return; }
    const v = eventView(), now = Date.now();
    say("§5[End] §fThe End is " + (endGateOpen() ? "§aOPEN" + (v.openUntil ? " §7(closes in " + mmss(v.openUntil - now) + ")" : "") : v.openAt ? "§eopening in " + mmss(v.openAt - now) : "§cCLOSED"));
  });
  reg({ name: "smp:mobmoney", description: "Money for killing mobs (Owner / Admin): /mobmoney on | off | status", optionalParameters: [{ name: "action", type: CustomCommandParamType.String }] }, (p, action) => {
    const a = String(action ?? "status").toLowerCase();
    if (a === "on" || a === "off") { if (!allow(p, "mobmoney")) return; const r = setMobReward(p, a === "on"); if (r.err) p.sendMessage(menuMsg(p, "§c[Mobs] " + r.err)); return; }
    p.sendMessage(menuMsg(p, "§6[Mobs] §fMob kill rewards are " + (mobRewardOn() ? "§aON" : "§cOFF")));
  });
});
