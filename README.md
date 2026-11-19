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
- Needs `@minecraft/server` 2.1.0 (Minecraft 1.21.100+). Without the inventory event, everything works like before.

## Prices
- `python3 tools/reprice.py`: makes all shop prices from `tools/shop_data.original.js` (the old prices) and writes
  `BP/scripts/shop_data.js` + `tools/price_changes.csv` (old -> new for every item).
- `python3 tools/check_prices.py`: checks that buying and selling (also crafting / smelting) can never make money.
- Rules: sell = what the materials are worth (diamond 600, iron 25, gold 50 ...), buy = about 3x sell, never more expensive than before.
- Enchanted books: half price. Potions: $999 - $3,999 (were $4,999 - $11,999).
- Prices that the Owner changed in the game (Shop admin) stay as they were set. Reset an item there to get the new price.
