# Smp_zah
Minecraft Bedrock SMP add-on (made by @Zahraiiq).

## Folders
| Folder | What |
|---|---|
| `BP/` | Behavior pack: scripts (`BP/scripts`), blocks, items, entities |
| `RP/` | Resource pack: textures, models, sounds, UI |
| `tools/` | Price tools (run on a computer, not in the game) |

## Performance (v1.29.169)
- `BP/scripts/perf.js` is loaded **first**. It keeps world data, the player list (once per tick) and the dimensions in memory,
  so the game engine is not asked the same thing again and again. It returns exactly the same values.
  If the game refuses a patch, the normal function is used.
- `BP/scripts/systems/invwatch.js`: inventories are read again only when they **changed** (game event), with a timed full
  check as a safety net. Used by the sell-price lore, special tools, Hearts and the bundle ban.
- Uses `@minecraft/server` 2.0.0 (Minecraft 1.21.90+, same as before). The inventory event (2.1.0+) is used only when the game has it; without it the inventories are scanned like before.

## Prices
- `python3 tools/reprice.py`: makes all shop prices from `tools/shop_data.original.js` (the old prices) and writes
  `BP/scripts/shop_data.js` + `tools/price_changes.csv` (old -> new for every item).
- `python3 tools/check_prices.py`: checks that buying and selling (also crafting / smelting) can never make money.
- Rules: sell = what the materials are worth (diamond 600, iron 25, gold 50 ...), buy = about 3x sell, never more expensive than before.
- Enchanted books: half price. Potions: $999 - $3,999 (were $4,999 - $11,999).
- Prices that the Owner changed in the game (Shop admin) stay as they were set. Reset an item there to get the new price.

## Building > Spawn (Owner only)
`/opr` > **Building** > **Spawn**, then pick one (you stand in the middle):
- **Grand Spawn - "The Ancient Sanctuary" (151 x 151, ~95k blocks)**: mossy walls with buttresses, hanging leaves and glow berries,
  4 corner towers and 4 gates with gate towers; a giant Tree of Life on an island with a moat and 4 bridges; 4 avenues with lamps and
  guardian statues; **Crate Temple** (NE, the 3 crates are placed and work), **Hall of Legends** (NW, the 10 TOP boards are placed);
  a terraced cliff with a waterfall (SE); ruins garden + pergola (SW); gardens and trees everywhere.
- **Small Spawn** (41 x 41): gazebo, fountain, trees, 4 paths.

No lag: the area is loaded with temporary ticking areas only while building; it is designed and built a little every tick;
only plain blocks, leaves never decay, vines never grow, invisible light blocks stop mobs. It becomes the `/spawn` point.
- **Protection:** only the Owner can break / place / use blocks inside (Admins can't); everybody can still open the crates;
  explosions don't touch it; no lava / water / fire / TNT / pistons close to it; no land protection on top of it.
- **Undo:** the land is saved before building (structures `smp:spawn_backup_*`); Undo puts it back, removes the crates / boards
  it placed and restores the old spawn point.
- Code: `systems/spawndesign.js` (the designs), `systems/spawnbuild.js` (builder, menu, protection), `systems/spawnzone.js` (area).

## Building > Arenas (Owner only) and /arena (players)
Two colosseums (89 x 91, ~35k blocks each), built around the Owner, one at a time:
- **Arena of Valor** (teal + white): Keep Inventory ON, building OFF, ender pearls OFF (defaults).
- **Blood Pit** (red + blackstone): Keep Inventory OFF, temporary building ON, ender pearls ON (defaults).

Inside: skull gate with a dark crown, 3 tiers of arches, domed turrets, a furnished concourse under the stands (grand lobby,
armory, rest hall, hall of champions, 8 staircases), 11 rows of seats, a royal box and the round fighting pit.
- The Owner changes the rules any time: Open / Closed, Keep Inventory, Building (OFF / ON / TEMPORARY 30 s - 10 min),
  ender pearls, clear placed blocks, teleport, Undo.
- The rules work in the **pit** only; everywhere else in the arena nobody takes damage. Only the Owner can change the building.
- Keep Inventory uses the normal API: the drops of a death in the pit are taken off the ground and given back at respawn.
- Code: `systems/arenadesign.js` (design), `systems/arena.js` (build, rules, menus, protection, `/arena`).

## Building > AFK Hall (Owner only)
"The Crimson Hall" (45 x 46, 39 high, ~18.5k blocks): white floor with a red pattern and a glowing crest, red carpet,
4 rows of stone seats, pillars with red / white medallions, red & white banners, red / purple crystals in the corners,
a tall glass dome on red ribs, chandeliers. Built around the Owner (no lag, land saved for Undo).
When it is ready the **AFK area** (afk.js) becomes the inside of the hall: `/afk` goes there and the AFK rewards work.
Only the Owner can change the hall. Undo puts the land and the old AFK area back.
Code: `systems/afkdesign.js` (design), `systems/afkhall.js` (builder, page, protection).

## Sign log (Owner only)
Who placed a sign and who wrote on it (front / back) is saved. The Owner: look at a sign (action bar),
sneak + right-click it (full details in chat, it does not open), `/signlog` (last 150 texts with name and place).
Code: `systems/signlog.js`.

## Spawner friends
Spawner page > **Friends**: add an online player and choose what he may do: take items + XP, sell, break / pick up,
add / remove friends. A friend can always open the spawner and stack more into it (also inside the owner's land).
Staff with the Admin or Owner role open, sell, take, break and switch the hologram of any spawner like its owner.

## Fast hoppers
Every hopper moves up to 20 items every 0.4 s (pull from above, push where it points; furnace input / output too),
locked hoppers do nothing, crates are never emptied. Code: `systems/fasthopper.js` (`FAST_HOPPER` settings).

## Fast healing (merged from "Java Saturation" by Raiyon)
Java-style healing: natural regeneration off, +1 health every 0.5 s while saturation >= 3 and hunger >= 18 (uses 1.5
saturation), or hunger > 18 (uses 1 hunger). Admin / Owner switch it in `/opr > World > Fast healing` (default ON;
OFF = vanilla healing again). The saturation HUD bar of that pack is not merged (it rewrites the action bar every tick).
Code: `systems/fastheal.js`.

## Swear filter (chat)
Reading / stopping chat needs **Beta APIs**, so the filter is a small extra pack: `chatguard/` (build it for your exact
game version: `python3 tools/build_chatguard.py 1.26.60`). The SMP pack itself stays on the stable API.
- Arabic (Iraqi, Gulf, Levant, Egyptian), Franco-Arabic and English swearing; tricks are caught (spaces, symbols,
  repeated letters, numbers for letters, گ / چ, harakat). Normal words that contain a short bad word are not blocked.
- A blocked message: nobody sees it, the player is muted for **1 hour**, online staff see the name, the word and the
  message, offline staff get an alert, the staff log + chat ban log keep it. The Owner is never filtered.
- Code: `chatguard/scripts/filter.js` (lists + matching), `chatguard/scripts/main.js`, `BP/scripts/systems/chatban.js`.

## Chat Shield (standalone anti-swear mod for any world / server)
`chatshield/` - the same filter without the SMP pack: blocks the message, mutes 1 hour (its own data), tells the
admins (operators or tag `chat_admin`), log. Admins / tag `chat_bypass` are not filtered.
Commands (admins): `/cs:log`, `/cs:unmute <name>`, `/cs:mute <name> <minutes>`. Needs Beta APIs.
Build: `PACK=chatshield python3 tools/build_chatguard.py <game version>`.

## Kits (/kit)
- Starter Kit: new players only (data created after the kit system first ran), once: iron sword, stone tools,
  leather armor, bread, torches, logs, crafting table, bed.
- Daily Kit: everybody, once a day (midnight of UTC_OFFSET_HOURS): one random kit of 8 (Iron Warrior, Chain Ranger,
  Miner, Lumberjack, Farmer, Builder, Explorer, Fisher) - normal gear only.
- Kit items have the lore "Kit item": the shop / sell box refuse them. Edit the kits at the top of `systems/kits.js`.

## Item timer switch
`/opr > World > Item timer` (Admin / Owner): turns the floating Clear lag countdown above dropped items ON / OFF.

## Shulker Box preview
Bedrock does not let scripts draw into the inventory tooltip, nor read a shulker box ITEM's contents (the item inventory
API only covers "Storage Item" items like bundles, from script API 2.5). So: when a player breaks a shulker box, its real
contents are read from the block and saved on the dropped item (a shulker item can not change, so it stays exact).
Hover = the game's tooltip lists the contents (lore); hold the box + right-click into the air = chest window with the real
items (icons, amounts, enchant glint, same slots). Boxes never broken since the update say "not scanned yet".
Code: `systems/shulkerpeek.js`.

## Football (event) - Building > Stadium, Events > Football (Owner), /football (players)
**The stadium** (85 x 109, ~36k blocks, built around the Owner, no lag, the land is saved for Undo): a striped 35 x 59 pitch
inside a white line (halfway line, centre circle, penalty / goal boxes, spots, corner flags), 2 goals with nets, LED boards,
10 rows of stands on all 4 sides, blue / red dugouts, a glass roof on dark-oak beams with lanterns, a concourse under the
stands (blue + red locker rooms, snack bar, trophy hall, entrance hall, 4 staircases), 2 player tunnels, 4 doors,
4 floodlight towers, 2 scoreboards (the script shows the score and the time) with FOOTBALL above them, roads + cherry trees.

**A match** (`/opr > Events > Football`): the Owner chooses the players (online, or "everybody on the pitch"), the team
size (1 - 10) and the time (5, 10, 15, 20, 32, 45, 60 min), then Start.
- Teams at random: BLUE (blue diamond + white iron kit, defends north) and RED (black netherite + red boots, defends south); sent to
  his half. His own armour waits in a hidden locker under the pitch and comes back at the end (also after leaving / a restart),
  with his game mode and his old place. Adventure mode, no damage, no hunger; the kit can't be dropped.
- The ball is `smp:football` (looks like the sulfur cube, no AI, can't be hurt / despawn). Hit = kick where you look
  (sprint = strong, sneak = soft, look up = high), right-click = pass, walking into it = dribble. Every player gets a spear.
  The ball can never leave the white line (it bounces back).
- 10 s countdown, kick-off. Goal: title with the scorer (or own goal) + effects, the ball goes to the middle, the players to
  their halves; 30 s later only the team that conceded may touch it first. The clock stops during that pause.
- Hitting a player = foul; 3 fouls = 30 s on the bench. Players can't leave the pitch; spectators who walk on it are sent
  to the stands. Time over: winner / draw, the goal list, stats (goals, matches, wins in `/football`).
- The Owner can pause / resume, put the ball back in the middle, end now (winner) or stop (no winner).
- Code: `systems/stadiumdesign.js` (design), `systems/football.js` (build, match, pages, `/football`),
  `BP/entities/smp_football.json` + `RP/entity/smp_football.entity.json` (the ball).

## TNT Run (event) - Building > TNT Run, Events > TNT Run (Owner), /tntrun (players)
**The arena** (63 x 63, ~46k blocks, built around the Owner, land saved for Undo): 4 floors of 43 x 43, 8 blocks apart, with a
TNT block under every floor block - layer 1 sand with gravel rings, layer 2 sand, layer 3 gravel, layer 4 sand with a red sand
star - the elimination floor below, walls of stone bricks / andesite / quartz pillars / chiseled bands / red tops / lights,
6 rows of seats on top all around (behind glass), a back wall, corner towers and a TNT RUN leaderboard hologram.

**A game** (`/opr > Events > TNT Run`): the Owner chooses 2 - 16 players (online, or everybody at the arena), the block delay
(0.25 / 0.5 / 0.75 / 1 / 1.5 s, default 0.5 s), the double jumps (0 - 5 feathers) and the prize ($0 - $10,000), then Start.
- The floors are put back as new, the players go onto layer 1, 10 s countdown, GO.
- Every block a player stands on (or jumps from) disappears after the delay: the sand / gravel and the TNT under it, with a
  sound - no explosion, standing still does not help. Falling = the next layer; below layer 4 = OUT (announced, title, the
  player goes to the seats and watches).
- No PvP (no damage, no knockback), Adventure mode (no breaking / placing), no items - only the Double Jump feather.
- The last one standing wins: announced (+ 2nd / 3rd), the prize, effects. Wins / losses are saved (`/tntrun`, the board).
  After the game everybody goes back to his place and game mode, and the floors are put back.
- Code: `systems/tntdesign.js` (design), `systems/tntrun.js` (build, game, pages, `/tntrun`).

## Red Light, Green Light (event) - Building > Red Light, Events > Red Light (Owner), /redlight (players)
**The arena** (69 x 145, ~25k blocks, land saved for Undo): a sandy 55 x 141 field between walls painted like a blue sky with
clouds, the start area behind the red START line (south), hay bales / barrels / rocks and pink guards in the middle, the white
FINISH line, a huge glowing gate with FINISH and 2 big signal lights (north), the GIANT DOLL (`smp:sg_doll`, ~14 blocks high,
animated: she turns to the players at red with red eyes and looks around, turns away at green) next to a bare tree, 2
spectator balconies behind glass, a leaderboard hologram.

**A game**: the Owner picks 2 - 30 players, the walking speed (normal / slow / slower / very slow = slowness), the time
limit (3 - 15 min), the winners (first 1 / 3 / 5 / everybody who finishes) and the prize.
- 10 s countdown behind the start line, then GREEN / RED at random times. The stage follows the best runner:
  0-25 %: green 8-12 s / red 3-5 s, 25-50 %: 5-9 / 4-7, 50-75 %: 4-7 / 5-8, 75-100 %: 3-6 / 6-10.
  A short warning sound comes at a random moment before red.
- Red light: the movement is watched the whole time: 0.35 s grace, then the place is saved (a jump may land); more than
  0.25 block (or jumping up) in 2 checks in a row, or 0.9 block at once = OUT. One wrong network position that is corrected
  at once does not count. OUT = "PLAYER ELIMINATED / name / reason / PLAYERS REMAINING", effects, the balcony.
- Over the finish line (alive, not flying) = winner: prize, stats. Time over = the rest is out. No PvP, Adventure, no items.
- Code: `systems/squiddesign.js`, `systems/squidgame.js`, the doll: `BP/entities/smp_sg_doll.json`, `RP/entity/smp_sg_doll.entity.json`,
  `RP/models/entity/smp_sg_doll.geo.json`, `RP/animations/smp_sg_doll.animation.json`, `RP/animation_controllers/smp_sg_doll.ac.json`.

## Dropper (event) - Building > Dropper, Events > Dropper (Owner), /dropper (players)
**The tower** (53 x 73 with the lobby, 136 high - build it on normal ground): a white / purple tower with DROPPER on it,
a 3 x 3 grid of shafts (15 x 15 inside), 7 of them are stages, each with its own style, height, start ledge, obstacles and a
water pool at the bottom: 1 THE BEGINNING (80, oak + leaves, big openings), 2 GLASS TUNNEL (95, a long glass tunnel),
3 THE LAVA (100, basalt / magma, sealed lava pools), 4 ROTATION (90, 3 rotating arms around a pillar), 5 THE NETHER (110,
openings left / right), 6 DEEP OCEAN (100, prismarine + coral, a small hole), 7 THE IMPOSSIBLE (120, a spiral, 3 x 3
openings, a rotating arm at the top). The openings are placed by the falling speed, so every stage can be done.
The lobby at the foot (south) with the 7 stage colours and a DROPPER leaderboard. The walls / shell are built with big fills (fast).

**A game**: 2 - 16 players, attempts per stage (3 / 5 / unlimited), no attempts left = back one stage (checkpoint) or wait
10 s, waiting time 15 / 30 / 60 s, time limit 10 - 30 min, prize (1st full, 2nd half, 3rd a quarter).
- Lobby countdown, then stage 1. Land in the water = stage clear (water particles, sound, time), 5 s later the next stage.
  Everyone plays at his own pace. Touching anything on the way down / the floor / lava = a failed attempt (back to the top).
- The first 3 who finish stage 7 are 1st / 2nd / 3rd (by time); time over = ranked by stage and time.
- No ender pearls (a message), no items, no water / building / breaking, no PvP, no fall damage.
- The arms (stage 4 + 7) only turn while somebody plays that stage.
- Code: `systems/dropperdesign.js` (design, `TallCanvas`, the openings), `systems/dropper.js` (build, game, pages, `/dropper`).

## Pillars of Fortune (event) - Building > Pillars, Events > Pillars (Owner), /pillars (players)
**The arena** (93 x 93, 118 high, land saved for Undo): 16 stone pillars (7 x 7, 81 high, each its own colour) in the sky -
11 outer (radius 27) + 5 inner (radius 13), 5 - 8 blocks apart - and a gold / quartz centre platform; a dark magma floor far
below; a glass viewers' ring (radius 42 - 45) out of reach; 32 hidden locker barrels under the floor. Pillars are big fills.

**A game**: 2 - 16 players, a random item every 5 / 8 / 12 s, a pillar falls every 25 / 40 / 60 s, random events on / off, prize.
- Start: the arena is put back as new. Every player's OWN inventory, armour and off hand go into his lockers (the real items,
  with all enchantments / names) and his XP is noted: he plays with nothing of his own. Own pillar each, rules, 10 s, GO.
- Random items: common 55 % / useful 25 % / rare 15 % / legendary 5 % (blocks, food, snowballs, ender pearl, slime, bow,
  shield, fishing rod, wind charge, iron gear, golden apples, knockback sticks, diamond sword, totem ...). All carry the
  lore "Pillars of Fortune item": can't be sold, and every game item disappears after the game (also from viewers).
- Random events every 60 s: block rain, sudden night (darkness), lucky drop, low gravity, speed rush.
- From 90 s the pillars fall one by one (outer ring first, 10 s red flashing warning), then the centre breaks ring by ring,
  then every built block vanishes - so the game always ends.
- OUT (15 blocks under the tops, too far away, killed, left): announced + players left; everything from the game is removed,
  his own things + XP come back exactly and he goes back to where he was. Killed: drops removed, given back after respawn.
  Offline / a restart: given back when he joins again (never twice). Only players' blocks / falling blocks can be broken.
- Code: `systems/pillarsdesign.js` (design), `systems/pillars.js` (build, lockers, items, events, game, pages, `/pillars`).

## Pillars of Fortune 1x1 (event) - Building > Pillars 1x1, Events > Pillars 1x1 (Owner), /pillars1 (players)
The same game as Pillars of Fortune, on a second arena of its own (the classic one stays): 16 pillars of ONE block, 81 high,
11 outer (radius 15) + 5 inner (radius 7), about 7 blocks apart, a 1 x 1 golden centre pillar, 77 x 77 (build it next to the
classic one: it keeps away from it by itself). The players start on top of a 1 x 1 pillar and must build with the random items.
Everything else works like the classic game (lockers for the own things, random items + events, pillars fall one by one,
the void at the end, prize, stats). It has its own settings, lockers, data and stats (`/pillars1`, `pq:*`, wins `qw`).
A player can only be in one of the two Pillars games at a time.
Code: `systems/pillarsdesign.js` (`makeDesign`: BIG + SMALL), `systems/pillars.js` (`makeGame`: CLASSIC + ONE).

## Color Rush (event) - Building > Color Rush, Events > Color Rush (Owner), /colors (players)
**The hall** (53 x 53, land saved for Undo): a 33 x 33 wool floor over a deep pit, a gap + a glass wall on a light blue rim
(nobody can stand beside the floor), a walkway with seats, stone-brick walls with 4 big COLOUR PANELS, a leaderboard.
**Two floors** (the Owner chooses): MIXED = every block its own colour, PATCHES = 3 x 3 patches of one colour; 12 colours,
every colour the same number of times, shuffled, no equal neighbours side by side; a NEW floor every round.
**A game**: 2 - 30 players; time to find the colour (first round 6 / 5 / 4 / 3 s), faster every round (0 / 0.2 / 0.4 s, never
under 1 s), how the other blocks vanish (at once / in waves 0.5 s / 1 s), prize.
- A colour is called (title in that colour, the wall panels turn that colour, a shrinking bar in the colour), then every
  other block vanishes; who falls is out (announced, goes to the walkway). The last one wins; if the last players fall in the
  same round they win together (the prize is shared). No PvP, Adventure, no items.
- Code: `systems/colordesign.js` (hall, floor patterns), `systems/colorrush.js` (build, game, pages, `/colors`).

## Villager spawn egg + villager restock
- `/shop` > Shards Shop > Spawn Eggs: **Villager Spawn Egg** for $10,000 (or 300 shards), its OWN limit: 10 every 12 hours
  (key `spawn_egg_villager`, the admin can change it like the others; the other eggs keep the shared `spawn_egg` limit).
- Villager trades come back 20 minutes after a player traded with the villager: the time is saved on the villager (it goes on
  while nobody is there, after a restart, after leaving the server); the next time a player is near and the time is over, the
  game's own resupply runs (every used-up trade / red X works again) and the villager goes on with his normal schedule.
  A timer "⟳ 14:52" shows above the villager only while a player is within 5 blocks; a real name stays (timer under it).
  The game does not tell scripts when a trade is used up, so the 20 minutes start at the first trade.
  Code: `systems/villagerrestock.js`.

## v35 changes
- Villager spawn egg: the villager that comes out has NO job (an adult unskilled villager): he takes the job of the first
  free job block the player puts near him (systems/villagerrestock.js, end of the file).
- Dropper: **Slow falling** (Events > Dropper > Slow falling): the Owner picks the stages (any of 1 - 7, all or none, also
  during a game); in those stages the players fall slowly (more time to steer), a fall may then take up to 3 minutes.
- Bundles: also deleted from every container a player opens (chest, barrel, shulker box, hopper ...) and hoppers never move
  a bundle (they delete it) - so they can't be used to duplicate items. (Inventory, ground, use, shop: as before.)
- Cheaper: Night Vision $799 / $1,499 / $7,999 (30 min / 1 h / 6 h, was $1,999 / $3,999 / $21,999).
  /mining (30 min / 1 h / 6 h): Timber 899 / 1,699 / 8,999, Timber x2 1,798 / 3,398 / 17,998, Area 3x3 1,999 / 3,799 / 19,999,
  Area 5x5 3,499 / 6,499 / 34,999, Chest Sell 1,499 / 2,799 / 14,999, Auto-Smelt 2,499 (30 min).
  Prices an admin had set in the game stay as they were (Set prices > reset = the new prices).

## Ender chest of a player (Admin / Owner) - /opr > Players > a player > Inventory > Ender chest
See his ender chest (icons, amounts, names, enchantments, durability), take an item (all / half / 1: the REAL item goes into
your inventory) or clear the whole ender chest (cheaters). Online players only; an operator's: Owner only; staff log.
The SMP pack uses script API 2.0.0, which can't read ender chests (that came in 2.8.0), so the small helper pack
**SMP Ender View** (`enderview/`, script API 2.8.0) does the reading / moving (script events `smp:ec` / `smp:ec_r`).
It is inside the .mcaddon: turn it on in the world's behavior packs (under the SMP pack). Without it the page says so and
"Clear" still works with the game's `replaceitem ... slot.enderchest` command.
Code: `systems/enderchest.js` (page), `enderview/scripts/main.js` (helper).

## Fast Craft & Fast Loot (merged into the resource pack)
From "Fast craft & Fast loot v3.1" (UT_MODS): a Fast Craft button next to the crafting arrow (crafting table, inventory,
stonecutter; pocket UI too), double-click to send an item / quick trade at villagers, and a Quick Loot switch on chests
(click = the whole stack moves). Its UI files were joined with the SMP UI files (chest_screen, inventory_screen, pocket_containers,
ui_common, _global_variables: both changes kept), new: ui/fc_quick_loot.json, trade_2_screen(_pocket), stonecutter_screen(_pocket),
inventory_screen_pocket, textures/ui/Fast_craft.png + arrow_large.png. Credits: RP/CREDITS_Fast_Craft_Quick_Loot.txt.

## Building > Spawn > Celestial Sanctuary (201 x 201) + Spawn rules
A third spawn (only one spawn can exist: Undo the old one first). ~98k blocks + 4 big fills, built in a few minutes, no lag.
- The RING: 7 tiers of white seats all around, a gothic colonnade of 64 pillars with pointed arches, a dark cornice with
  lanterns, a spire on every pillar, 3 grand gates (E, S, W) with crowns and stairs.
- The CATHEDRAL (north): mosaic windows, a rose window, twin towers (46 high + spires), a steep dark roof; inside: columns,
  pews, a red carpet, an altar with candles, an organ wall (bookshelves + pipes), lecterns, amethyst, chandeliers, side chapels.
- The PLAZA: a three-tier fountain, benches, lamp posts; 4 avenues with lamp posts and flower beds.
- NE Crate Pavilion (domed gazebo, the 3 crates placed), NW Hall of Legends (the 10 TOP boards on obelisks).
- SE Library & Café (furnished: bookshelves, reading tables, lecterns, armchairs, carpets, enchanting / cartography table,
  café counter with cakes, kitchen, tables + chairs, plants, chandeliers, a terrace with umbrellas).
- SW Wisteria Garden: a giant dark tree with pink hanging leaves, lanterns on chains, a swing, a pond, flowers, amethyst, a
  tree house (table, chairs, bed, barrel, candles, ladder).  S Moonlit Garden: water channels, white paths and bridges,
  arches with pale hanging moss, mushroom lamps, soul lanterns, glowing sea pickles.  E / W pergola gardens. 80 big trees.
- **Spawn rules** (Building > Spawn > Spawn rules, Owner only, for every spawn type): No building / breaking (Owner only),
  No PvP, No damage, No fire (players + mobs, fire aspect), No monsters, No explosions, No hunger - each ON / OFF.
Code: `systems/celestialdesign.js` (design, `BigCanvas`), `systems/spawnbuild.js` (builder, fills, rules).

## Celestial Sanctuary v2 (271 x 271): Nether Gate + Butterfly Lantern portals
- The spawn is bigger (radius 135): a BOULEVARD around the ring (r 104 - 108) with lamp posts, avenues out of the gates,
  diagonal paths, ~140 trees. (A Celestial spawn built before: Undo it and build it again to get the new parts.)
- The NETHER GATE (south, at the end of the south avenue): a purple mosaic plaza, a real nether portal (11 wide, pointed top)
  in an obsidian frame with a purple lattice, white pillars with purpur stripes, a pointed arch with a purple diamond, and two
  huge stone WINGS (8 curved feathers each side) with vines and glow lichen, rocks at the foot.
- 4 BUTTERFLY LANTERNS (the diagonals, r ~119): a cream lantern on legs with purple glass walls, steps up to a real portal on
  the side facing the spawn, a tiered roof, and a giant pixel BUTTERFLY (blue + purple + pink wings in a V) on top.
- Every portal INSIDE the built spawn sends a player to a RANDOM safe place in the Nether (300 - 3,000 blocks out, a new place
  every time, solid ground, no lava next to the feet): the game's own portal never takes him (he is put back one step at once,
  the portal swirl plays while the place is loaded). Code: `systems/netherportal.js`; design: `celestialdesign.js` part 10b.

## Celestial Sanctuary v3: flying butterflies, garden pieces, natural ground
- 8 GARDEN PIECES at the edge of the spawn (r 121, between the gates/lanterns), from the pictures: pond with a terracotta
  bridge + pergola (x2), mushroom pond (x2), rocky pond with trees + gazebo, stone grotto with hanging leaves + chain lanterns,
  picnic island with log lantern posts, bamboo and a blanket (x2). (`celestialdesign.js` part 10c)
- NATURAL GROUND: outside the plaza/ring/roads the land is no longer flat: gentle hills (0 - 3 blocks), moss / coarse dirt /
  podzol patches, ~70 mossy boulders; trees, bushes and flowers sit on the hills. (part 10d)
- A Celestial spawn built before: Undo it and build it again to get the new parts.

## Celestial Sanctuary v4: built butterflies, the server name, the black & white twin cathedral (`celestialextra.js`)
- The moving butterflies (entities) are gone. Now the butterflies are BUILT of blocks (like the picture): two pairs of pixel
  wings opened in a V (blue fore wings, pink / purple hind wings, black outline, white spots), a brown body, antennae, some
  with a little lantern. One sits on top of each of the 4 Butterfly Lanterns, and 12 big ones float in the sky around and
  above the spawn at different heights (56 - 102 blocks) and places, each looking a different way.
- The server name 『ZYTHER SMP』 in big green block letters (glowing top row, gold brackets, emerald stars) on a floating
  board with a white / gold frame above the south avenue (y 22 - 70): it reads right from the plaza AND from the Nether Gate
  side.
- THE TWIN CATHEDRAL (instead of the old one), like the picture - the LEFT half black, the RIGHT half white:
  * the black bell tower (15 x 15, 78 high + pinnacles to ~94): lancet window strips, a light checkered band, a rose with a
    red eye, a crown of spiky pinnacles with copper tops
  * the white tower: white walls with grey shadows, mossy feet, a great purple window, an octagon crown with a grey diamond
    lattice and purple gems, a forest of thin white spires (up to ~110)
  * the front between them: a great open portal with stepped arches, a gallery, a rose window (copper / white ring), side
    windows, the gable with a spire and a golden cross; the roof dark on the left, white on the right
  * inside: columns (black / white), pews, red carpet, altar with candles, organ wall, chandeliers, side chapels
- The spawn is now 112 blocks high (UP) for the towers and the sky. A Celestial spawn built before: Undo it and build again.
- The side panel (scoreboard) title and the SMP Menu title are now 『Zyther Smp』 in green bold letters (custom font: `RP/font/glyph_E1.png`,
  characters U+E100 - U+E10A).

## Server ranks (VIP) - /opr > Ranks (Owner only) - `systems/viprank.js`
- Silver -5 % / +5 %, Gold 10/10, Emerald 15/15, Diamond 20/20, Netherite 25/25, Master 30/30, Master II 40/40,
  Master III 50/50, Legend 70/70 (buy discount / sell bonus). Added to the Trading skill perks (max -75 % / +80 %).
- The discount works on everything bought with money: /shop items, spawn eggs, spawners, enchant books, potions, /mining
  tools, Night Vision, Hearts, cosmetics, table uses + passes, land protection + fast growth. Shard prices never change.
- No exploit: an item that can be sold is never cheaper than (its sell price with YOUR bonus) + 10 %, and items bought
  from the shop never get the sell bonus -> buy / sell (or buy / craft / sell) loops can never make money.
- The Owner gives / changes / takes a rank (online or offline players), sees who has each rank; the player gets a title.
- Above the name: a crown in the rank's colours (custom glyphs U+E110 - U+E118 in `RP/font/glyph_E1.png`) + the rank
  name; in chat the crown + rank before the name.

## Rank statues - /opr > Ranks > Rank statues (Owner) - `systems/rankstatue.js`
- A player-size statue of a ranked player on a dark pedestal with a gold rim: a rank outfit (shoulder pads, chest gem,
  bracers, boots), a cape with the rank gem and a crown, all in the rank's colours (entity `smp:rank_statue`, 9 textures).
  It breathes, looks around, the cape moves; sparkles while somebody is near.
- Above it: crown + RANK, the name, money, kills, online / offline - updated every 2 s. New rank = new colours at once;
  rank taken away = the statue disappears. It can't be hit, pushed or moved and comes back if removed by a command.
- Owner: place one statue where you stand (looking at you), place ALL ranked players in a row, go to / remove a statue,
  remove all. Bedrock can't give an add-on a player's real skin, so the statue wears the rank outfit.

## Spleef (event) - /opr > Building / Events > Spleef (Owner), /spleef (everybody) - `systems/spleef.js`, `spleefdesign.js`
- Arena 65 x 65: a round snow floor (41 across) over a deep pit with a lava lake, deepslate + ice walls 4 blocks above
  the snow, 6 rows of spruce seats, a walkway with soul lanterns, a back wall with ice windows, snowy pines.
- Owner: players (2 - 24), prize, "the floor melts" after 2 / 3 / 5 min (the snow shrinks ring by ring) or OFF.
- Game: the floor is made new, players in a circle, Adventure mode + the SPLEEF SHOVEL (diamond, Efficiency V, can
  break ONLY snow), 10 s countdown (no digging), DIG! Snow breaks instantly with no drops.
- Out at once: falling below the floor, leaving the arena (over the wall), leaving the game. Out players go to the
  seats and can't come back. No other items (pearls, food, blocks), no placing, no flying, no PvP damage / knockback,
  fire resistance (the lava never hurts). Last one on the floor wins: prize, fireworks, wins / losses saved,
  SPLEEF leaderboard in the arena.

## Football: 11 vs 11 + the Owner picks the teams
- Team size now 1 - 11. In "Choose the players" a click cycles: chosen (random team) -> BLUE -> RED -> not chosen.
  The players put in a team stay there (max the team size); the others are spread at random to keep the teams even.

## The swear filter is removed
- The extra packs "SMP Chat Guard" / chatshield and the SMP side (chatban.js) are gone. No pack needs Beta APIs now.

## Villager egg fix
- The egg villager is no longer removed and spawned again (that new one had no skin -> invisible / gone, or the spawn failed): the SAME villager now gets the game's "become unskilled" event and stays where it was placed.
- Clear lag (mobs) never removes villagers, wandering traders, golems, allays, tamed or leashed animals.

## Fixes
- Football: normal play - no fouls, no warnings, no bench.
- "Failed to get property name" in the menus (football players, TPA ...): a player who is still joining (downloading the resource pack) or leaving is no longer in the player lists until he is ready (perf.js).

## Spawners free for all + safer player data
- Spawners: everybody (teammate or enemy) can open, collect, sell, stack and break / pick up any spawner, in any land (not in the protected spawn). Old spawners with no data get new data the first time they are used.
- Player data: a record is never overwritten by an empty one when the first read fails (it is read again); a broken record is kept in pbad:<id>; very long records drop old transactions instead of failing to save.
- /opr > Players > a player > Old account (Owner): a saved record with the same name (he came back with a new id) can be moved onto him (money, shards, stats, rank; a copy is kept in pold:<id>).
