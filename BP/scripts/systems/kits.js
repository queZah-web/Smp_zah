// ===================================================================================================================
// /kit - KITS
//   * STARTER KIT: only for NEW players (their data was created after this system first ran) and only ONCE.
//   * DAILY KIT:   every player, once a day (the day changes at midnight of UTC_OFFSET_HOURS, like the daily reward):
//                  one RANDOM kit of the list below - normal gear (iron / chain / stone), never strong.
//   * Every kit item carries the lore "Kit item" -> the shop / sell box / chest sell refuse it (no free money).
//   * Inventory full -> the rest drops at the player's feet (never lost).  Claims are saved FIRST (can never be taken twice).
// ===================================================================================================================
import { world, system, ItemStack, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import { ex } from "../smp/store.js";
import { stats } from "../data.js";
import { make, set, open, hdr, COLS, NAV, status, backBtn } from "../smp/ui.js";
import { pick } from "./arextra.js";
import { UTC_OFFSET_HOURS } from "../smp/config.js";

// ---------------------------------------------------------------- the kits (edit here)
// [item id, amount]   (tools / armor = 1)
export const STARTER = {
  name: "Starter Kit", ar: "عدة البداية", icon: "textures/items/iron_sword",
  items: [["iron_sword", 1], ["stone_pickaxe", 1], ["stone_axe", 1], ["stone_shovel", 1], ["leather_helmet", 1], ["leather_chestplate", 1], ["leather_leggings", 1], ["leather_boots", 1],
    ["bread", 24], ["torch", 16], ["oak_log", 16], ["crafting_table", 1], ["white_bed", 1]],
};
export const DAILY_KITS = [
  { name: "Iron Warrior", ar: "المحارب الحديدي", icon: "textures/items/iron_chestplate", items: [["iron_sword", 1], ["iron_helmet", 1], ["iron_chestplate", 1], ["shield", 1], ["cooked_beef", 8]] },
  { name: "Chain Ranger", ar: "الرامي", icon: "textures/items/bow_standby", items: [["chainmail_helmet", 1], ["chainmail_chestplate", 1], ["chainmail_leggings", 1], ["chainmail_boots", 1], ["bow", 1], ["arrow", 32]] },
  { name: "Miner", ar: "المعدّن", icon: "textures/items/iron_pickaxe", items: [["iron_pickaxe", 1], ["iron_shovel", 1], ["torch", 32], ["cooked_porkchop", 12]] },
  { name: "Lumberjack", ar: "الحطّاب", icon: "textures/items/iron_axe", items: [["iron_axe", 1], ["oak_log", 32], ["apple", 12], ["oak_sapling", 4]] },
  { name: "Farmer", ar: "المزارع", icon: "textures/items/iron_hoe", items: [["iron_hoe", 1], ["wheat_seeds", 16], ["carrot", 8], ["potato", 8], ["bone_meal", 8], ["bread", 16]] },
  { name: "Builder", ar: "البنّاء", icon: "textures/blocks/brick", items: [["cobblestone", 64], ["oak_planks", 48], ["glass", 16], ["torch", 16], ["stone_pickaxe", 1]] },
  { name: "Explorer", ar: "المستكشف", icon: "textures/items/compass_item", items: [["iron_leggings", 1], ["chainmail_boots", 1], ["iron_sword", 1], ["cooked_chicken", 12], ["ender_pearl", 2], ["oak_boat", 1]] },
  { name: "Fisher", ar: "الصيّاد", icon: "textures/items/fishing_rod_uncast", items: [["fishing_rod", 1], ["cooked_cod", 16], ["chainmail_helmet", 1], ["iron_boots", 1]] },
];
const LORE = ["§r§7Kit item", "§r§7(غرض من الكيت)"];

// ---------------------------------------------------------------- who / when
const DAY = 86400000, OFFSET = UTC_OFFSET_HOURS * 3600000;
const today = (now = Date.now()) => Math.floor((now + OFFSET) / DAY);
const msToNext = (now = Date.now()) => (today(now) + 1) * DAY - OFFSET - now;
const left = (ms) => { const m = Math.ceil(ms / 60000), h = Math.floor(m / 60); return h > 0 ? h + "h " + (m % 60) + "m" : m + "m"; };
const SINCE_KEY = "kit:since";
let since = null;
system.run(() => { try { let v = world.getDynamicProperty(SINCE_KEY); if (typeof v !== "number") { v = Date.now(); world.setDynamicProperty(SINCE_KEY, v); } since = v; } catch (e) { /* retry later */ } });
const kd = (p) => { const d = ex(p); d.kit ??= {}; return d.kit; };
/** "new" = his SMP data was created after the kit system started in this world */
export function isNewPlayer(p) { try { const j = stats(p).joined; return since !== null && typeof j === "number" && j >= since; } catch (e) { return false; } }
export const starterState = (p) => (kd(p).s ? "taken" : isNewPlayer(p) ? "ready" : "old");
export const dailyReady = (p) => kd(p).d !== today();

// ---------------------------------------------------------------- giving
const ID = (id) => (id.includes(":") ? id : "minecraft:" + id);
function giveKit(p, kit) {
  const c = p.getComponent("inventory")?.container;
  let dropped = 0;
  for (const [id, n] of kit.items) {
    let st; try { st = new ItemStack(ID(id), 1); } catch (e) { continue; }     // an item this game version does not know
    let rest = n;
    while (rest > 0) {
      const one = new ItemStack(ID(id), Math.min(rest, st.maxAmount)); rest -= one.amount;
      try { one.setLore(LORE); } catch (e) { /* ignore */ }
      const extra = c ? c.addItem(one) : one;
      if (extra) { p.dimension.spawnItem(extra, p.location); dropped++; }
    }
  }
  return dropped;
}
const kitName = (p, k) => pick(p, k.name, k.ar);
const lines = (k) => k.items.map(([id, n]) => "§r§7- §f" + (n > 1 ? n + " x " : "") + id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

function claimStarter(p) {
  const st = starterState(p);
  if (st === "taken") return p.sendMessage(pick(p, "§c[Kit] You already took your Starter Kit.", "§c[الكيت] أخذت عدة البداية من قبل."));
  if (st === "old") return p.sendMessage(pick(p, "§c[Kit] The Starter Kit is only for new players.", "§c[الكيت] عدة البداية بس للاعبين الجدد."));
  kd(p).s = Date.now();                                           // saved FIRST
  const dr = giveKit(p, STARTER);
  p.sendMessage(pick(p, "§a[Kit] You got the §fStarter Kit§a! Good luck!", "§a[الكيت] أخذت §fعدة البداية§a! بالتوفيق!") + (dr ? pick(p, " §7(inventory full: some items are at your feet)", " §7(الحقيبة ممتلئة: بعض الأغراض طاحت عند رجولك)") : ""));
  try { p.playSound("random.levelup"); } catch (e) { /* ignore */ }
}
function claimDaily(p) {
  if (!dailyReady(p)) return p.sendMessage(pick(p, "§c[Kit] You already took today's kit. §7Next one in §f" + left(msToNext()), "§c[الكيت] أخذت كيت اليوم. §7الجاي بعد §f" + left(msToNext())));
  kd(p).d = today();                                              // saved FIRST
  const kit = DAILY_KITS[Math.floor(Math.random() * DAILY_KITS.length)];
  const dr = giveKit(p, kit);
  p.sendMessage(pick(p, "§a[Kit] Daily kit: §e" + kit.name + "§a!", "§a[الكيت] كيت اليوم: §e" + kit.ar + "§a!") + (dr ? pick(p, " §7(inventory full: some items are at your feet)", " §7(الحقيبة ممتلئة: بعض الأغراض طاحت عند رجولك)") : ""));
  try { p.onScreenDisplay.setTitle("§e" + kitName(p, kit), { subtitle: pick(p, "§7Daily kit", "§7كيت اليوم"), fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 10 }); p.playSound("random.levelup"); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- the page
export function kitPage(p, back) {
  const self = () => kitPage(p, back);
  const f = make(pick(p, "Kits", "الكيتات"), 5); f.self = self; f.glass = true;
  set(f, 0 * COLS + 4, hdr(1) + pick(p, "§6§lKits\n§r§7New players: a Starter Kit, once\n§r§7Everybody: a random kit every day\n§r§8Kit items can't be sold", "§6§lالكيتات\n§r§7اللاعب الجديد: عدة البداية مرة وحدة\n§r§7الكل: كيت عشوائي كل يوم\n§r§8أغراض الكيت ما تنباع"), "textures/ui/shop/ic_chest", null);
  const st = starterState(p);
  set(f, 2 * COLS + 2, hdr(1, st === "ready" ? "g" : "r") + "§a§l" + kitName(p, STARTER) + "\n" + lines(STARTER).join("\n") + "\n§r" +
    (st === "ready" ? pick(p, "§eClick to take it (once)", "§eاضغط لأخذها (مرة وحدة)") : st === "taken" ? pick(p, "§cAlready taken", "§cأخذتها من قبل") : pick(p, "§cOnly for new players", "§cبس للاعبين الجدد")),
    STARTER.icon, { run: () => { claimStarter(p); self(); } });
  set(f, 2 * COLS + 4, hdr(DAILY_KITS.length) + pick(p, "§b§lAll daily kits\n§r§7See what you can get", "§b§lكل كيتات اليوم\n§r§7شوف وش ممكن يطلع لك") + "\n§r§eClick to open", "textures/items/book_writable", { run: () => listPage(p, self) });
  const dr = dailyReady(p);
  set(f, 2 * COLS + 6, hdr(1, dr ? "g" : "r") + pick(p, "§e§lDaily Kit\n§r§7One random kit of " + DAILY_KITS.length + "\n§r§7(iron, chain, tools, food...)\n§r", "§e§lكيت اليوم\n§r§7كيت عشوائي من " + DAILY_KITS.length + "\n§r§7(حديد، تشين، أدوات، أكل...)\n§r") +
    (dr ? pick(p, "§eClick to take today's kit", "§eاضغط لأخذ كيت اليوم") : pick(p, "§cNext kit in §f" + left(msToNext()), "§cالكيت الجاي بعد §f" + left(msToNext()))), "textures/ui/shop/ic_gift", { run: () => { claimDaily(p); self(); } });
  if (back) backBtn(f, back);
  status(p, f);
  open(p, f);
}
function listPage(p, back) {
  const f = make(pick(p, "Daily kits", "كيتات اليوم"), 5); f.self = () => listPage(p, back); f.glass = true;
  const cols = [1, 2, 3, 4, 5, 6, 7, 8];
  DAILY_KITS.forEach((k, i) => set(f, 2 * COLS + (cols[i] ?? i) - (DAILY_KITS.length < 8 ? 0 : 0), hdr(1) + "§e§l" + kitName(p, k) + "\n" + lines(k).join("\n"), k.icon, null));
  backBtn(f, back);
  open(p, f);
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry: cr }) => {
  try {
    cr.registerCommand({ name: "smp:kit", description: "Kits: Starter Kit (new players) + a random kit every day", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (o) => {
      const p = o.sourceEntity?.typeId === "minecraft:player" ? o.sourceEntity : null;
      if (p) system.run(() => { try { kitPage(p); } catch (e) { console.warn("[kits] page: " + e); } });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) { console.warn("[kits] command: " + e); }
});
// a new player is told once that the Starter Kit is waiting
try {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    system.runTimeout(() => { try { if (starterState(player) === "ready") player.sendMessage(pick(player, "§a[Kit] Welcome! Type §f/kit §ato take your Starter Kit.", "§a[الكيت] أهلاً! اكتب §f/kit §aعشان تاخذ عدة البداية.")); else if (dailyReady(player)) player.sendMessage(pick(player, "§e[Kit] Your daily kit is ready: §f/kit", "§e[الكيت] كيت اليوم جاهز: §f/kit")); } catch (e) { /* ignore */ } }, 100);
  });
} catch (e) { /* ignore */ }
