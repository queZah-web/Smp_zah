// Finders used ONLY by /rtp (locate.js, used by /spawn, is untouched).
// They do NOT use Block.isSolid (it is unreliable in some API versions): a block counts as "ground" when it is not air,
// not liquid, not dangerous and not a "walk-through" plant / decoration.
const idOf = (b) => b.typeId.replace("minecraft:", "");
const DANGER = /^(lava|flowing_lava|magma|cactus|fire|soul_fire|campfire|soul_campfire|sweet_berry_bush|powder_snow|pointed_dripstone|wither_rose|web|tnt|end_portal|portal|bubble_column|water|flowing_water|cave_vines.*|.*_fence|.*_fence_gate|.*_wall|fence|nether_brick_fence|cobblestone_wall|iron_bars|.*_bars)$/;
const TREE = /leaves|_log$|_wood$|_stem$|hyphae|^vine$|mangrove_roots|^bee_nest$|^bamboo/;
const PASS = /grass|fern|flower|sapling|mushroom|torch|rail|carpet|button|lever|sign|banner|vine|roots|sprouts|lichen|leaf_litter|wildflowers|petals|bush|kelp|coral|dandelion|poppy|orchid|allium|tulip|cornflower|rose|peony|lilac|sunflower|lily|string|tripwire|redstone_wire|reeds|sugar_cane|snow_layer|pressure_plate|candle|sea_pickle|cluster|amethyst_bud|blossom|dripleaf|hanging_moss|ladder|scaffolding|^light|pitcher|frog|egg|^skull|_head$|_wall_head|^structure_void|^barrier|^deadbush|^dead_bush|^tallgrass/;
const SOLID_EXC = /grass_block|grass_path|coral_block|mushroom_block|mushroom_stem|moss_block|sea_lantern|^light_gray|^lightning/;
const passable = (id) => PASS.test(id) && !SOLID_EXC.test(id);
const isDanger = (b) => DANGER.test(idOf(b));
const isGround = (b) => !b.isAir && !b.isLiquid && !isDanger(b) && !TREE.test(idOf(b)) && !passable(idOf(b));
const isFree = (b) => b.isAir || (!b.isLiquid && !isDanger(b) && passable(idOf(b)));    // body can stand in it

/** true = terrain generated, false = chunk loaded but still empty, null = chunk not loaded.  (generated overworld always has bedrock at y=-64) */
export function generated(dim, x, z) {
  try {
    const b = dim.getBlock({ x, y: -64, z });
    if (!b) return true;
    return b.typeId === "minecraft:bedrock";
  } catch (e) {
    return /bound|height|world/i.test(String(e && e.name) + " " + String(e && e.message)) && !/unloaded/i.test(String(e && e.name) + " " + String(e && e.message)) ? true : null;
  }
}

/** safe surface spot at x,z -> {x,y,z} | null (not safe here) | undefined (not loaded) */
export function surfaceAt(dim, x, z) {
  let top;
  try { top = dim.getTopmostBlock({ x, z }); } catch (e) { return undefined; }
  if (!top) return undefined;
  let g = null, y = top.y;
  try {
    for (let i = 0; i < 80 && y > -60; i++, y--) {
      const b = dim.getBlock({ x, y, z });
      if (!b) return undefined;
      if (b.isAir) continue;
      if (b.isLiquid || isDanger(b)) return null;
      const id = idOf(b);
      if (TREE.test(id) || passable(id)) continue;     // leaves, logs, grass, flowers, snow layer: look further down
      g = b; break;
    }
    if (!g || g.y + 3 > 318) return null;
    for (const dy of [1, 2]) {                          // body space must be free
      const b = dim.getBlock({ x, y: g.y + dy, z });
      if (!b) return null;
      if (!isFree(b)) return null;
    }
  } catch (e) { return undefined; }
  return { x: x + 0.5, y: g.y + 1, z: z + 0.5 };
}

function caveOk(dim, x, y, z) {
  let air = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) {
    const b = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz });
    if (!b) return false;
    if (isDanger(b) || b.isLiquid) return false;
    if (dy >= 0 && dy <= 1 && b.isAir) air++;
  }
  return air >= 10;                                     // a real cave room, not a 1 block crack
}

/** random safe cave spot in the column x,z -> {x,y,z} | null | undefined (not loaded) */
export function caveAt(dim, x, z) {
  let top;
  try { top = dim.getTopmostBlock({ x, z }); } catch (e) { return undefined; }
  if (!top) return undefined;
  const found = [];
  try {
    for (let y = Math.min(top.y - 10, 50); y >= -52; y--) {
      const b = dim.getBlock({ x, y, z });
      if (!b) return undefined;
      if (!b.isAir) continue;
      const below = dim.getBlock({ x, y: y - 1, z }), above = dim.getBlock({ x, y: y + 1, z });
      if (!below || !above || !above.isAir) continue;
      if (!isGround(below)) continue;
      if (caveOk(dim, x, y, z)) found.push(y);
    }
  } catch (e) { return undefined; }
  return found.length ? { x: x + 0.5, y: found[Math.floor(Math.random() * found.length)], z: z + 0.5 } : null;
}
