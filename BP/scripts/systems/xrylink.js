// ===================================================================================================================
// ANTI X-RAY LINK  (Owner: /opr > Server & staff > Anti X-Ray)
//
// The Anti X-Ray itself is the separate pack "XryGuard" (its own saved data, so the SMP pack is never slowed down by its
// thousands of chunk records).  This file only:
//   * listens to XryGuard: every 10 s it says "I am here" + its settings (scriptevent smp:xry {...})
//   * sends XryGuard the Owner's buttons (scriptevent xry:... as the Owner, so the answers come to his chat)
//   * asks XryGuard to uncover the hidden ores around a 3x3 / 5x5 Area Mining or a Vein Miner hit BEFORE the extra
//     blocks are broken (mining.js), so a hidden ore is never broken as stone
// Without XryGuard nothing here does anything.
// ===================================================================================================================
import { world, system } from "@minecraft/server";
import { makeOpr, set, open, hdr, COLS, SHORT_ROWS, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirm } from "./forms.js";
import { isOwner, slog } from "./staffcore.js";

let st = null;              // { p: paused, r: radius, b: budget ms, busy, t: when we heard it }
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "smp:xry") return;
  try { st = { ...JSON.parse(ev.message || "{}"), t: Date.now() }; } catch (e) { st = { t: Date.now() }; }
});
/** XryGuard is installed and answered in the last 30 s */
export const xryPresent = () => !!st && Date.now() - st.t < 30000;
export const xryActive = () => xryPresent() && !st.p;
/** uncover the hidden ores in a cube (radius r) around a place: used before Area Mining / Vein Miner */
export function xryReveal(dim, l, r) {
  try { dim.runCommand(`scriptevent xry:reveal ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} ${r} ${dim.id}`); } catch (e) { /* ignore */ }
}
const send = (p, c) => { try { p.runCommand("scriptevent " + c); return true; } catch (e) { return false; } };

const RADII = [4, 6, 8, 10, 12, 16], BUDGETS = [2, 3, 5, 8], PRESCAN = [256, 512, 1000, 2000];
let prescanR = 512;
export function xryPage(player, back) {
  if (!isOwner(player)) return back();
  const self = () => xryPage(player, back), here = xryPresent(), on = xryActive();
  const f = makeOpr("Anti X-Ray", SHORT_ROWS); f.self = self; f.glass = true;
  const log = (t) => { try { slog(player, "xray", null, t); } catch (e) { /* ignore */ } };
  set(f, 0 * COLS + 4, hdr(1, here ? (on ? "g" : "r") : "r") + "§b§lAnti X-Ray (XryGuard)\n§r§7Buried ores are turned into stone and\n§r§7come back the moment a side is opened:\n§r§7X-Ray sees only stone.\n§r§7Now: " + (!here ? "§cthe XryGuard pack is not running" : on ? "§aON" : "§cPAUSED") + (here ? "\n§r§7Radius: §f" + (st.r ?? "?") + " chunks §7| work: §f" + (st.b ?? "?") + " ms/tick" + (st.busy ? "\n§r§eA scan / restore is running" : "") : ""), "textures/items/diamond_pickaxe", null);
  if (!here) {
    set(f, 2 * COLS + 4, hdr(1, "r") + "§c§lXryGuard is not running\n§r§7Add the XryGuard pack to the world\n§r§7(world_behavior_packs.json) and restart.\n§r§7The buttons appear when it answers.", "textures/ui/shop/ic_cancel", null);
  } else {
    set(f, 1 * COLS + 2, hdr(1) + "§f§lStatus\n§r§7Chunks, hidden ores, jobs\n§r§7(the answer comes in the chat)\n§r§eClick", "textures/items/book_writable", { run: () => { send(player, "xry:status"); } });
    set(f, 1 * COLS + 4, hdr(1, on ? "g" : "r") + (on ? "§e§lPause" : "§a§lResume") + "\n§r§7" + (on ? "No new chunks are hidden\n§r§7(uncovering keeps working)" : "Hides the ores again") + "\n§r§eClick", on ? "textures/ui/shop/ic_cancel" : "textures/ui/shop/ic_confirm", { run: () => { send(player, on ? "xry:pause" : "xry:resume"); log(on ? "pause" : "resume"); system.runTimeout(self, 25); } });
    const nr = RADII[(RADII.indexOf(st.r) + 1) % RADII.length] ?? 10;
    set(f, 1 * COLS + 6, hdr(Math.min(99, st.r ?? 1)) + "§f§lRadius: §e" + (st.r ?? "?") + " chunks\n§r§7Around every player\n§r§7More = more work for the server\n§r§eClick: " + nr, "textures/items/compass_item", { run: () => { send(player, "xry:radius " + nr); log("radius " + nr); system.runTimeout(self, 25); } });
    const nb = BUDGETS[(BUDGETS.indexOf(st.b) + 1) % BUDGETS.length] ?? 3;
    set(f, 2 * COLS + 2, hdr(Math.min(99, st.b ?? 1)) + "§f§lWork per tick: §e" + (st.b ?? "?") + " ms\n§r§7Less = lighter, slower scanning\n§r§7(3 ms is a good choice)\n§r§eClick: " + nb + " ms", "textures/items/clock_item", { run: () => { send(player, "xry:budget " + nb); log("budget " + nb); system.runTimeout(self, 25); } });
    set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lScan around me: §f" + prescanR + " blocks\n§r§7Hides the ores of the whole area now\n§r§7(even where nobody walks). Slow + safe.\n§r§eClick to start §7| §eother size: below", "textures/items/map_filled", { run: () => confirm(player, "Scan " + prescanR + " blocks around you?", ["§7The ores in this area are hidden now.", "§7It takes a while (the chat shows the progress)."], () => { send(player, "xry:prescan " + prescanR); log("prescan " + prescanR); }, self) });
    set(f, 3 * COLS + 4, hdr(1) + "§7Scan size: §f" + prescanR + "\n§r§eClick: " + PRESCAN[(PRESCAN.indexOf(prescanR) + 1) % PRESCAN.length], "textures/items/map_empty", { run: () => { prescanR = PRESCAN[(PRESCAN.indexOf(prescanR) + 1) % PRESCAN.length]; self(); } });
    set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lRestore ALL ores\n§r§7Every hidden ore becomes a real ore\n§r§7again (all dimensions) and the Anti\n§r§7X-Ray stops. Do it before removing\n§r§7the XryGuard pack!\n§r§eClick", "textures/ui/shop/ic_cancel", { run: () => confirm(player, "Restore every hidden ore?", ["§cThe Anti X-Ray is switched OFF.", "§7All hidden ores become real ores again.", "§7(Resume to hide them again later.)"], () => { send(player, "xry:restore confirm"); log("restore all"); }, self) });
  }
  backBtn(f, back); status(player, f);
  open(player, f);
}
