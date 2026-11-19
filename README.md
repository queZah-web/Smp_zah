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
