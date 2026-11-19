// Operator > 1 vs 1 Duel > Duel log  (permission "duelset": Owner / Admin).
// List of the last duel fights: who won, who lost, who killed whom.  Click a fight: everything the loser lost (it dropped where he died) and what the winner picked up from it.
import { makeOpr as make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { confirmOpr as confirmShort } from "./forms.js";
import { can, isOwner, slog } from "./staffcore.js";
import { ago, num } from "../format.js";
import { UTC_OFFSET_HOURS } from "../smp/config.js";
import { duelRecords, duelRecordCount, clearDuelRecords, deleteDuelRecord, MAX_RECORDS } from "./duellog.js";
import { oprMsg } from "./oprlang.js";

const PER_PAGE = 27;
/** the items of a record's loser as [[item, count], ...] (new records keep the whole inventory, old ones only this list) */
const itemsOf = (l) => {
  if (!l) return [];
  if (!Array.isArray(l.inv)) return l.it ?? [];
  const m = new Map();
  for (const [, k, n] of l.inv) m.set(k, (m.get(k) ?? 0) + n);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const BLOCKS = ["cobblestone", "dirt", "stone", "obsidian", "sand", "gravel", "netherrack", "glass", "end_stone", "bedrock", "tnt", "cobweb"];
const iconOf = (id) => (BLOCKS.includes(id) ? "textures/blocks/" + id : "textures/items/" + id);
const sum = (list) => (list ?? []).reduce((a, x) => a + (Number(x[1]) || 0), 0);
const nice = (id) => String(id).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const when = (t) => new Date(t + UTC_OFFSET_HOURS * 3600000).toISOString().replace("T", " ").slice(0, 16);
const nameOf = (rec, id) => rec.p?.find((x) => x.i === id)?.n ?? "?";
const howText = (l) => (l.how === "left" ? "left the game" : l.by ? "killed by §e" + l.by : "died");
const CAUSE = { entityAttack: "melee", projectile: "arrow", fall: "fall", fire: "fire", fireTick: "fire", lava: "lava", drowning: "drowning", void: "void", entityExplosion: "explosion", blockExplosion: "explosion", magic: "potion" };
const causeText = (c) => CAUSE[c] ?? String(c ?? "").replace(/([A-Z])/g, " $1").toLowerCase();

// ================================================================ the list
export function duelLogPage(player, back, page = 0, msg) {
  if (!can(player, "duelset")) { try { player.sendMessage(oprMsg(player, "§c[Operator] You are not allowed to do this.")); } catch (e) { /* ignore */ } return back(); }
  const all = duelRecords(), pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  page = Math.max(0, Math.min(page, pages - 1));
  const f = make("Duel log", 5);
  f.self = () => duelLogPage(player, back, page);
  set(f, 0 * COLS + 4, hdr(Math.max(1, Math.min(99, all.length))) + (msg ? msg + "\n§r§8" : "§c§l⚔ Duel log\n§r") + "§7Fights saved: §f" + all.length + "§7/§f" + MAX_RECORDS + "\n§r§7Only fights inside the 1 vs 1 duel.\n§r§7Click a fight to see the items.", "textures/items/book_writable", null);
  all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).forEach((r, i) => {
    const losers = (r.l ?? []).map((l) => l.n), lost = (r.l ?? []).reduce((a, l) => a + sum(itemsOf(l)), 0);
    const head = r.r === "win" ? "§6§l⚔ §e" + nameOf(r, r.w) + " §7beat §f" + (losers.join(" §7&§f ") || "?") : "§7§l⚔ Draw: §f" + r.p.map((x) => x.n).join(" §7&§f ");
    const txt = hdr(1, r.r === "win" ? "c" : "c") + head + "\n§r§7" + ago(r.t) + " §8| §7Items lost: §f" + num(lost) +
      (r.r === "win" ? "\n§r§7Picked up: " + (r.u ? "§f" + num(sum(r.pk)) : "§8not counted yet") : (r.y ? "\n§r§7" + r.y : "")) + "\n§r§eClick for details";
    set(f, 9 + i, txt, r.r === "win" ? "textures/items/diamond_sword" : "textures/items/iron_sword", { run: () => duelDetail(player, r, 0, () => duelLogPage(player, back, page)) });
  });
  if (!all.length) set(f, 2 * COLS + 4, hdr(1) + "§7No duel fight was saved yet", "textures/ui/shop/ic_help", null);
  if (page > 0) set(f, 0 * COLS + 2, hdr(1) + "§e§lPrevious page\n§r§7Newer fights", NAV.back, { run: () => duelLogPage(player, back, page - 1) });
  if (page < pages - 1) set(f, 0 * COLS + 6, hdr(1) + "§e§lNext page\n§r§7Older fights", NAV.page, { run: () => duelLogPage(player, back, page + 1) });
  if (all.length) set(f, 0 * COLS + 8, hdr(1, "r") + "§c§lClear the log\n§r§7Deletes all saved fights", NAV.no, {
    run: () => confirmShort(player, "Clear the duel log?", ["§7" + all.length + " fights will be deleted.", "§7This cannot be undone."],
      () => { if (!can(player, "duelset")) return back(); clearDuelRecords(); duelLogPage(player, back, 0, "§aThe log was cleared."); }, () => duelLogPage(player, back, page)),
  });
  backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ one fight
const LOST_SLOTS = [1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => r * COLS + c));
const GOT_SLOTS = [1, 2, 3].flatMap((r) => [5, 6, 7, 8].map((c) => r * COLS + c));

function duelDetail(player, rec, li, back) {
  if (!can(player, "duelset")) return back();
  const f = make("Duel fight", 5), losers = rec.l ?? [], L = losers[li] ?? null, win = rec.r === "win";
  f.self = () => duelDetail(player, rec, li, back);
  const feed = (rec.k ?? []).slice(0, 4).map((k) => "§r§c" + k.v + " §7" + (k.k ? "killed by §e" + k.k + " §8(" + causeText(k.c) + ")" : "§8" + causeText(k.c))).join("\n");
  set(f, 0 * COLS + 4, hdr(1) + (win ? "§6§l⚔ " + nameOf(rec, rec.w) + " won" : "§7§l⚔ Draw") + "\n§r§7" + when(rec.t) + " §8(" + ago(rec.t) + ")\n§r§7Fighters: §f" + rec.p.map((x) => x.n).join(" §7&§f ") + (feed ? "\n" + feed : "") + (rec.y ? "\n§r§7" + rec.y : ""), "textures/items/book_writable", null);

  // the loser(s): one tab each
  losers.slice(0, 2).forEach((l, i) => set(f, 0 * COLS + 1 + i, hdr(1, i === li ? "r" : "c") + "§c§lLoser: §f" + l.n + "\n§r§7" + howText(l) + "\n§r§7Lost: §f" + num(sum(itemsOf(l))) + " §7items" + (losers.length > 1 && i !== li ? "\n§r§eClick to see his items" : ""), NAV.player,
    i === li ? null : { run: () => duelDetail(player, rec, i, back) }));
  if (L) set(f, 0 * COLS + 3, hdr(1, "r") + "§c§lLoser inventory\n§r§7Everything " + L.n + " carried\n§r§7when he died\n§r§eClick to open", "textures/items/chest_minecart", Array.isArray(L.inv) ? { run: () => invPage(player, "Loser: " + L.n, "§c§l" + L.n + " §7(when he died)", L.inv, () => duelDetail(player, rec, li, back)) } : null);
  if (win) set(f, 0 * COLS + 5, hdr(1, "g") + "§a§lWinner inventory\n§r§7What " + nameOf(rec, rec.w) + " carried\n§r§730 s after the win, before he\n§r§7was sent back\n§r§e" + (rec.u ? (Array.isArray(rec.wi) ? "Click to open" : "Not available") : "Not saved yet"), "textures/items/chest_minecart", rec.u && Array.isArray(rec.wi) ? { run: () => invPage(player, "Winner: " + nameOf(rec, rec.w), "§a§l" + nameOf(rec, rec.w) + " §7(after the loot time)", rec.wi, () => duelDetail(player, rec, li, back)) } : null);
  if (win) set(f, 0 * COLS + 7, hdr(1, "g") + "§a§lWinner: §f" + nameOf(rec, rec.w) + "\n§r§7Won: §a+1 duel win\n§r§7Picked up: " + (rec.u ? "§f" + num(sum(rec.pk)) + " §7items" : "§8not counted yet"), NAV.ok, null);
  else set(f, 0 * COLS + 7, hdr(1) + "§7§lNo winner\n§r§7Nobody won this fight", NAV.no, null);

  // what the loser lost (left) / what the winner picked up from it (right)
  set(f, 1 * COLS + 4, hdr(1, "r") + "§c§l← Lost\n§r§7" + (L ? "Everything " + L.n + " had\n§r§7(it dropped where he died)" : "Nobody lost items"), NAV.no, null);
  set(f, 2 * COLS + 4, hdr(1, "g") + "§a§lPicked up →\n§r§7" + (win ? (rec.u ? "From the loser's drops" : "Counted when the loot\n§r§7time is over") : "No winner"), NAV.ok, null);
  const show = (items, slots, color) => {
    const list = items ?? [];
    list.slice(0, slots.length).forEach(([id, n], i) => {
      if (i === slots.length - 1 && list.length > slots.length) { set(f, slots[i], hdr(1) + "§7§l+" + (list.length - slots.length + 1) + " more kinds\n§r§7" + num(list.slice(i).reduce((a, x) => a + x[1], 0)) + " items", "textures/ui/shop/ic_help", null); return; }
      set(f, slots[i], hdr(Math.min(99, n)) + color + "§l" + nice(id) + "\n§r§7Amount: §f" + num(n), iconOf(id), null);
    });
  };
  show(itemsOf(L), LOST_SLOTS, "§c");
  if (win && rec.u) show(rec.pk, GOT_SLOTS, "§a");
  if (L && !itemsOf(L).length) set(f, LOST_SLOTS[1], hdr(1) + "§7He had no items", "textures/ui/shop/ic_help", null);
  if (win && rec.u && !(rec.pk ?? []).length) set(f, GOT_SLOTS[1], hdr(1) + "§7He picked up nothing", "textures/ui/shop/ic_help", null);
  if (isOwner(player)) set(f, 0 * COLS + 8, hdr(1, "r") + "§c§lDelete this fight\n§r§7Removes only this one record\n§r§7Only the Owner sees this button", NAV.no, { run: () => {
    if (!isOwner(player)) return duelDetail(player, rec, li, back);                          // checked again
    confirmShort(player, "Delete this fight?", ["§7" + rec.p.map((x) => x.n).join(" & "), "§7" + when(rec.t), "§cIt is removed for good", "§cand can't be brought back."], () => {
      if (!isOwner(player)) return back();                                                    // checked a third time, at the moment of deleting
      const ok = deleteDuelRecord(rec.n);
      if (ok) { try { slog(player, "dellog", null, "duel fight: " + rec.p.map((x) => x.n).join(" & ").slice(0, 60)); } catch (e) { /* ignore */ } }
      try { player.sendMessage(oprMsg(player, ok ? "§a[Operator] The fight was deleted." : "§7[Operator] The fight was not found (already deleted).")); } catch (e) { /* ignore */ }
      back();
    }, () => duelDetail(player, rec, li, back));
  } });
  backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ a whole inventory, laid out like the game: 3 rows of storage, the hotbar, armor + off hand
function invPage(player, title, head, inv, back) {
  if (!can(player, "duelset")) return back();
  const f = make(title.slice(0, 24), 7);
  f.self = () => invPage(player, title, head, inv, back);
  const at = new Map(inv.map((x) => [x[0], x]));
  const put = (slot, n, color) => {
    const x = at.get(n); if (!x) return;
    set(f, slot, hdr(Math.min(99, x[2])) + color + "§l" + nice(x[1]) + "\n§r§7Amount: §f" + num(x[2]), iconOf(x[1]), null);
  };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) put(r * COLS + c, 9 + r * 9 + c, "§f");           // storage = game slots 9-35
  for (let c = 0; c < 9; c++) put(3 * COLS + c, c, "§e");                                                      // hotbar = game slots 0-8
  const ARM = [["Helmet", 36], ["Chestplate", 37], ["Leggings", 38], ["Boots", 39]];
  ARM.forEach(([label, n], i) => { if (at.has(n)) put(4 * COLS + 1 + i, n, "§b"); else set(f, 4 * COLS + 1 + i, hdr(1) + "§8" + label + "\n§r§8empty", "textures/ui/shop/ic_help", null); });
  if (at.has(40)) put(4 * COLS + 7, 40, "§d"); else set(f, 4 * COLS + 7, hdr(1) + "§8Off hand\n§r§8empty", "textures/ui/shop/ic_help", null);
  set(f, 4 * COLS + 0, hdr(1) + head + "\n§r§7Items: §f" + num(inv.reduce((a, x) => a + x[2], 0)) + " §7in §f" + inv.length + " §7slots\n§r§8Top: storage | next: hotbar\n§r§8Below: armor and off hand", "textures/items/chest_minecart", null);
  backBtn(f, back);
  status(player, f);
  open(player, f);
}
export { duelRecordCount };
