// "Ranks" page of the SMP menu: one button per leaderboard. A click shows the same hologram as /top <type> in front of the player.
import { system } from "@minecraft/server";
import { COLS, SHORT_ROWS, hdr, make, set, open, status, backBtn } from "./ui.js";
import { showTop } from "../systems/hologram.js";
import { LISTS, TOP_KEYS } from "../systems/ranks.js";
import { can } from "../systems/staffcore.js";
import { boardAdminPage } from "../systems/rankadmin.js";

const ICON = {
  money: "textures/ui/shop/hud_money", clan: "textures/items/name_tag", duel: "textures/items/iron_sword", sell: "textures/items/emerald", buy: "textures/items/diamond",
  play: "textures/ui/shop/hud_time", kills: "textures/ui/shop/hud_kills", shards: "textures/ui/shop/hud_shards", skills: "textures/items/iron_axe", ach: "textures/items/nether_star",
};
const COLOR = { money: "\u00a7a", clan: "\u00a76", duel: "\u00a7c", sell: "\u00a7b", buy: "\u00a7d", play: "\u00a7f", kills: "\u00a74", shards: "\u00a75", skills: "\u00a73", ach: "\u00a7e" };

export function ranksPage(player, back) {
  const f = make("Ranks", SHORT_ROWS); f.self = () => ranksPage(player, back);
  TOP_KEYS.forEach((type, i) => {
    const slot = (1 + Math.floor(i / 5)) * COLS + (i % 5) * 2;
    set(f, slot, hdr(1) + (COLOR[type] ?? "\u00a7e") + "\u00a7lTop " + LISTS[type].label + "\n\u00a7r\u00a77" + LISTS[type].sub + "\n\u00a7r\u00a7eClick to show it in front of you\n\u00a7r\u00a78/top " + type, ICON[type], { run: () => system.run(() => showTop(player, type)) });
  });
  set(f, 0 * COLS + 4, hdr(1) + "\u00a7e\u00a7lHologram\n\u00a7r\u00a77The list floats in front of you for 15 seconds.\n\u00a7r\u00a77You can open a new one after 30 seconds.\n\u00a7r\u00a77Top 3 of each list win shards every week!", "textures/ui/shop/ic_trophy", null);
  // admin only: the button is not shown to other players (and every action checks the permission again)
  if (can(player, "boards")) set(f, 3 * COLS + 4, hdr(1, "r") + "\u00a7c\u00a7lAdmin: leaderboards\n\u00a7r\u00a77Remove or ban players from any list\n\u00a7r\u00a78Only Owner / Admin see this", "textures/ui/shop/ic_gear", { run: () => boardAdminPage(player, () => ranksPage(player, back)) });
  backBtn(f, back); status(player, f);
  open(player, f);
}
