// Extra SMP systems entry point (imported once by smp/index.js)
// land protection first: the guard must be active no matter what else fails
import "./landcore.js";
import "./landguard.js";
import "./growth.js";
import "./farmfx.js";
import "./farminfo.js";
import "./landholo.js";
import "./tables.js";
import "./combat.js";
import "./back.js";        // /back: saves where a player died (must load BEFORE duel.js so it sees the duel state)
import "./deathloot.js"; // loot of a dead player: not cleared by Clear lag, 30 minutes to get it back (before duel.js, like back.js)
import "./duel.js";
import "./crown.js";       // Duel Arena Crown: the #1 in kills (10+ kills) wears a crown
import "./skills.js";
import "./oplog.js";
import "./staffcore.js";   // staff tools (mute, freeze, roles ...): before the chat systems
import "./creativelog.js"; // Creative log: who used Creative mode and which items they took (Operator > Logs)
import "./staffworld.js";
import "./events.js";       // events + temporary zones (Operator > Events): Keep Inventory, no PvP, no damage, time, weather...
import "./endgate.js";     // The End event: closed, countdown, timer, log (Owner / Admin)
import "./endholo.js";     // holograms on the End portals
import "./mobreward.js";   // money for killing mobs (Owner / Admin switch it on / off)
import "./xrayrestore.js"; // safety net: turns old hidden ores back into real ores (before mining.js)
import "./specialtool.js";
import "./mining.js";
import "./magnet.js";
import "./chestsell.js";
import "./nobundle.js";    // bundles are banned (dupe): removed from every player, from the ground and from the shop
import "./sellslot.js";     // red sell slot: top-right slot of the backpack sells what is moved into it (player switch ON / OFF)
import "./spawnercfg.js";  // saved spawner numbers (Owner can change them in game): before spawners.js
import "./spawners.js";
import "./spawnerholo.js";  // floating info text above every spawner (owner can close it)
import "./spawnermodel.js";  // a small spinning mob inside the cage of every spawner
import "./afk.js";         // /afk area: timer + money / shards per minute (Owner / Admin set it)
import "./clearlag.js";
import "./itemtimer.js";   // floating Clear lag countdown above every dropped item (Hearts have their own timer)
import "./blackhole.js";   // holographic black hole: clock for the tendrils, light pull, minor damage
import "./clans.js";
import "./commands.js";
import "./tpbutton.js";  // teleport buttons: an admin places a button (+ hologram name) that teleports the player to typed coordinates
import "./warp.js";       // /warp: admin saves server warps, players teleport
import "./crates.js";      // crates (shulker-box crate + keys every 30 real minutes)
import "./arena.js";       // the 2 fighting arenas (/arena, Owner: /opr > Building > Arenas)
import "./signlog.js";     // sign log: who placed / wrote each sign (Owner only: look at it, sneak + click, /signlog)
import "./fasthopper.js";
import "./fastheal.js";     // fast healing, Java style (Admin / Owner: /opr > World > Fast healing)  // hoppers move 20 items at once (DonutSMP style)
import "./afkhall.js";     // the AFK Hall (Owner: /opr > Building > AFK Hall) - becomes the AFK area
import "./football.js";    // Football event: the stadium (Owner: /opr > Building / Events > Football), matches, /football
import "./tntrun.js";      // TNT Run event: the arena (Owner: /opr > Building / Events > TNT Run), games, /tntrun
import "./spleef.js";
import "./skywars.js";
import "./eggwars.js";
import "./luckywars.js";
import "./piglinlimit.js";
import "./watcher.js";    // Watchers: players who may only watch one player as a spectator, 40 blocks (Admin: /opr > Server & staff), /watch // gold farm: at most N Zombified Piglins per 8 x 8 chunks + their drops vanish (Admin: /opr > World)   // Lucky Block Wars event: golden sky islands full of lucky blocks (Owner: /opr > Building / Events > Lucky Wars), /luckywars     // Egg Wars event: coloured islands, eggs, generators, villager shop (Owner: /opr > Building / Events > Egg Wars), /eggwars     // Sky Wars event: sky islands + random loot (Owner: /opr > Building / Events > Sky Wars), /skywars, loot records      // Spleef event: the snow arena (Owner: /opr > Building / Events > Spleef), games, /spleef
import "./squidgame.js";   // Red Light, Green Light event: the arena + the doll (Owner: /opr > Building / Events > Red Light), /redlight
import "./dropper.js";     // Dropper event: the tower with 7 stages (Owner: /opr > Building / Events > Dropper), /dropper
import "./pillars.js";     // Pillars of Fortune event: 16 pillars in the sky (Owner: /opr > Building / Events > Pillars), /pillars
import "./colorrush.js";   // Color Rush event: the colour floor hall (Owner: /opr > Building / Events > Color Rush), /colors
import "./villagerrestock.js"; // villager trades come back 20 min after trading (timer above the villager within 5 blocks)
import "./netherportal.js";  // portals inside the built spawn -> a random safe place in the Nether
import "./rankstatue.js";   // statues of the players who have a server rank (Owner: /opr > Ranks > Rank statues)
import "./javacombat.js";   // combat: reach limit (anti reach-hack) + the netherite wind page (the Java attack cooldown was removed)
import "./hopperlog.js";    // hopper log (who placed / used / broke every hopper) + the last logout place of every player
import "./nv.js";
import "./newgift.js";
import "./kits.js";
import "./shulkerpeek.js"; // shulker box preview: contents saved when broken (hover lore + right-click-in-air window)       // /kit: Starter Kit (new players, once) + a random daily kit   // 16 cooked steaks for NEW players only (once)
import "./opcore.js";
