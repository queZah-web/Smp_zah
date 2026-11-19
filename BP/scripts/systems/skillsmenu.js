// /menu -> Skills  (Skills + Abilities merged into ONE page)
//
//  Each skill is a column pair:  the skill card on top, the ability it gives right under it.
//     row 1 : Mining | Woodcutting | Excavation | Farming
//     row 2 : their tool speed buttons (hold the tool, click to upgrade)
//     row 3 : Flying | Combat | Fishing | Trading
//     row 4 : Elytra Speed | Damage Bonus | Double Catch | Shop Perks
//     row 5 : Back | Balance | Refresh | Help
//  Elytra Speed (OFF / Auto / +5% ... +25%) opens its own small page.
//  Green slot = you can click it now,  red = locked,  normal = information only.  Black glass fills the empty slots.
import { make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { num, money } from "../format.js";
import { balance } from "../data.js";
import { confirmShort } from "./forms.js";
import {
  SKILLS, TOOL_KEYS, aTool, SPEED, PERK, MAX_LEVEL, GATE_LEVEL, unlockCost, isUnlocked, unlockSkill, toolSlots, toolsStarted,
  skillInfo, pointsOf, pointsEarned, boostOf, heldItem, kindOf, prettyId, upgradeHeld, rewardText,
  flyUnlocked, flyActive, flyChosen, setFlySpeed, combatBonus, nextPerkLevel,
  tradeBuyDiscount, tradeSellBonus, tradeNext, TRADE_TIERS, fishDouble,
} from "./skills.js";
import { upgradeMult } from "../value.js";

// ---------------------------------------------------------------- small helpers
const L = "\n§r";                                   // new line + colour reset
const BAR = 20;
const bar = (pct) => { const f = Math.max(0, Math.min(BAR, Math.floor((pct / 100) * BAR))); return "§a" + "|".repeat(f) + "§8" + "|".repeat(BAR - f); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const left = (lv, now) => Math.max(0, lv - now);
const ICON = { clock: "textures/items/clock_item", done: "textures/items/experience_bottle", lock: NAV.no, help: "textures/ui/shop/ic_help", info: "textures/ui/shop/ic_info" };

/** every page: black glass in the empty slots */
function newPage(title, rows) { const f = make(title, rows); f.glass = true; return f; }

/** put a card:  card = { zone: "c" | "g" | "r", text, icon, run? } */
const put = (f, slot, card) => set(f, slot, hdr(1, card.zone || "c") + card.text, card.icon, card.run ? { run: card.run } : null);

// ---------------------------------------------------------------- unlock levels 126-250 (asks first, then charges)
function unlockConfirm(player, key, reopen) {
  const S = SKILLS[key], cost = unlockCost(key);
  if (isUnlocked(player, key)) return reopen();
  if (balance(player) < cost) return reopen("§cNot enough money. You need " + money(cost) + ".");
  confirmShort(player, "Unlock more levels", [
    "§7Skill: §f" + S.name,
    "§7Price: §a" + money(cost),
    "§7Unlocks levels §f" + (GATE_LEVEL + 1) + "-" + MAX_LEVEL,
    S.tool ? "§7Bonus: a 2nd " + S.tool + " can be upgraded" : "§7Bonus: the remaining perk steps",
  ], () => { const r = unlockSkill(player, key); reopen(r.text); }, () => reopen());
}

// ---------------------------------------------------------------- cards (shared by page 1 and page 2)

/** skill card: name, level, progress bar, next reward */
function skillCard(player, key, onUnlock) {
  const S = SKILLS[key], inf = skillInfo(player, key);
  const state = inf.locked ? "§c§lLOCKED §r§7at level §f" + GATE_LEVEL
    : inf.max ? "§6§lMAX LEVEL"
    : "§7Next level: §f" + num(inf.into) + "§7/§f" + num(inf.next) + " §8(" + inf.pct + "%)";
  const extra = inf.locked ? L + "§7Price: §a" + money(unlockCost(key)) + L + "§eClick to unlock"
    : inf.max ? "" : L + "§7Reward: " + rewardText(inf.level + 1, key);
  return {
    zone: inf.locked ? "r" : "c",
    text: S.color + "§l" + S.name + " §r§7Lv §f" + inf.level + L + bar(inf.pct) + L + state + extra + L + "§8" + S.what,
    icon: S.icon,
    run: inf.locked && onUnlock ? () => onUnlock(key) : null,
  };
}

/** tool speed button (pickaxe / axe / shovel / hoe): spend a point on the tool in your hand */
function toolCard(player, key, again) {
  const S = SKILLS[key], held = heldItem(player), heldKind = held ? kindOf(held.typeId) : null;
  const pts = pointsOf(player, key), cur = held && heldKind === S.tool ? boostOf(held) : -1;
  const full = cur === 0 && toolsStarted(player, key) >= toolSlots(player, key);
  const can = pts > 0 && cur >= 0 && cur < SPEED.max && !full;
  const inf = skillInfo(player, key), nxL = (Math.floor(inf.level / SPEED.every) + 1) * SPEED.every;
  const nextPt = !inf.locked && nxL <= MAX_LEVEL ? L + "§7Next point: level §f" + nxL + " §8(" + left(nxL, inf.level) + " left)" : "";
  const hint = can ? L + "§eClick: +" + SPEED.step + "% speed"
    : cur >= SPEED.max ? L + "§6This tool is at the maximum"
    : full ? L + (isUnlocked(player, key) ? "§cBoth tools are already started" : "§cUnlock the skill for a 2nd tool")
    : pts <= 0 ? L + "§8No points yet" : "";
  return {
    zone: can ? "g" : "c",
    text: "§b§l" + cap(S.tool) + " Speed" + L + "§7Points to spend: §f" + pts + " §8(earned " + pointsEarned(player, key) + ")" +
      L + (cur >= 0 ? "§7Holding: §f" + prettyId(held.typeId) + " §b+" + cur + "%" : "§7Hold " + aTool(S.tool) + " to upgrade it") + hint + nextPt +
      (cur > 0 ? L + "§7Tool value: §6+" + Math.round((upgradeMult(held) - 1) * 1000) / 10 + "%" : "") +
      L + "§8Each +" + SPEED.step + "% adds 7-15% value (random)" +
      L + "§7Tools upgraded: §f" + toolsStarted(player, key) + "§7/§f" + toolSlots(player, key),
    icon: ICON.info,
    run: () => { const r = upgradeHeld(player, key); again(r.text); },
  };
}

/** the ability a perk skill gives: Elytra speed / Damage bonus / Double catch / Shop prices */
function abilityCard(player, key, openSpeed) {
  const nx = nextPerkLevel(player, key);
  if (key === "fly") {
    const un = flyUnlocked(player), act = flyActive(player);
    if (un <= 0) return { zone: "c", icon: ICON.lock, text: "§c§lElytra Speed §r§8(locked)" + L + "§7Reach Flying level §f" + PERK.every + L + "§7to get §b+" + PERK.step + "% §7speed" };
    return {
      zone: act > 0 ? "g" : "c", icon: "textures/items/firework_rocket", run: openSpeed,
      text: "§d§lElytra Speed" + L + "§7Now: " + (act > 0 ? "§aON  §b+" + act + "%" : "§cOFF") + L + "§7Unlocked up to §b+" + un + "%" +
        L + (nx ? "§7Next: §f+" + (un + PERK.step) + "% §7at level §f" + nx : "§6Maximum unlocked") + L + "§eClick: on / off, choose speed",
    };
  }
  if (key === "combat") {
    const cb = combatBonus(player);
    return {
      zone: cb > 0 ? "g" : "c", icon: "textures/items/iron_sword",
      text: "§c§lDamage Bonus" + L + "§7Now: §a+" + cb + "% §7damage" + L + (nx ? "§7Next: §f+" + (cb + PERK.step) + "% §7at level §f" + nx : "§6Maximum reached") +
        L + "§8Kill points: zombie 1, armoured 3, sword 4," + L + "§8sword + armour 7, strongest 10",
    };
  }
  if (key === "fish") {
    const fd = fishDouble(player);
    return {
      zone: fd > 0 ? "g" : "c", icon: "textures/items/fish_raw",
      text: "§3§lDouble Catch" + L + "§7Now: §a+" + fd + "% §7chance" + L + (nx ? "§7Next: §f+" + (fd + PERK.step) + "% §7at level §f" + nx : "§6Maximum reached") + L + "§8Fish only, never junk or treasure",
    };
  }
  // trade
  const bd = tradeBuyDiscount(player), sb = tradeSellBonus(player), tn = tradeNext(player);
  return {
    zone: bd > 0 || sb > 0 ? "g" : "c", icon: "textures/items/emerald",
    text: "§2§lShop Perks" + L + "§7Buy prices: §a" + (bd ? "-" + bd + "%" : "normal") + L + "§7Sell prices: §a" + (sb ? "+" + sb + "%" : "normal") +
      L + (tn ? "§7Next: §f" + tn.text + " §7at level §f" + tn.lv : "§6Everything unlocked") + L + "§8Money only, not on shop-bought items",
  };
}

// ================================================================ PAGE 1 : Skills
export function skillsPage(player, back, msg) {
  const f = newPage("Skills", 6);
  f.self = () => skillsPage(player, back);
  const again = (m) => skillsPage(player, back, m);
  const unlock = (k) => unlockConfirm(player, k, again);
  const openSpeed = () => speedPage(player, back);
  const COL = [1, 3, 5, 7];

  // row 0 : short explanation
  put(f, 4, {
    icon: NAV.page,
    text: "§e§lSkills" + L + "§7Do things to level up (max " + MAX_LEVEL + ")." + L + "§7Every level gives a reward." +
      L + "§7Level " + GATE_LEVEL + ": pay §a" + money(unlockCost("mining")) + " §7per skill to go on." +
      L + "§7Tools: every " + SPEED.every + " levels = 1 speed point (+" + SPEED.step + "%)." +
      L + "§7Others: every " + PERK.every + " levels = +" + PERK.step + "% (max +" + PERK.max + "%).",
  });

  // rows 1-2 : Mining, Woodcutting, Excavation, Farming  +  their speed button
  TOOL_KEYS.forEach((key, i) => {
    put(f, 1 * COLS + COL[i], skillCard(player, key, unlock));
    put(f, 2 * COLS + COL[i], toolCard(player, key, again));
  });
  // rows 3-4 : Flying, Combat, Fishing, Trading  +  their ability
  ["fly", "combat", "fish", "trade"].forEach((key, i) => {
    put(f, 3 * COLS + COL[i], skillCard(player, key, unlock));
    put(f, 4 * COLS + COL[i], abilityCard(player, key, openSpeed));
  });

  // row 5 : Back | Balance | (Refresh) | Abilities | Help
  put(f, 5 * COLS + 4, { icon: ICON.help, text: (msg ? msg + L + "§8" : "§e§lHow it works" + L) + "§7The skill bar shows only while you gain xp." + L + "§7Blocks you placed yourself do not count." + L + "§7Survival mode only." });
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

// ================================================================ PAGE 3 : Elytra Speed
/** choose the elytra speed: off / auto / any unlocked speed */
export function speedPage(player, back, msg, ret) {
  const f = newPage("Elytra Speed", 9);
  f.self = () => speedPage(player, back, undefined, ret);
  const again = (m) => speedPage(player, back, m, ret);
  const unlocked = flyUnlocked(player), active = flyActive(player), chosen = flyChosen(player);
  const pick = (pct) => {
    const ok = setFlySpeed(player, pct);
    again(ok ? (pct === undefined ? "§aAuto: always the best unlocked speed." : pct === 0 ? "§cElytra speed is OFF." : "§aElytra speed is now +" + pct + "%.") : "§cThat speed is not unlocked yet.");
  };

  put(f, 1 * COLS + 4, {
    icon: NAV.page,
    text: "§d§lElytra Speed" + L + "§7Now: " + (active > 0 ? "§aON  §b+" + active + "%" : "§cOFF") + L + "§7Unlocked up to §b+" + unlocked + "%" +
      L + "§7Every " + PERK.every + " Flying levels unlocks the next +" + PERK.step + "%.",
  });
  put(f, 3 * COLS + 2, { zone: active === 0 ? "g" : "c", icon: NAV.no, text: "§c§lOFF" + L + "§7Normal elytra speed", run: () => pick(0) });
  put(f, 3 * COLS + 6, { zone: chosen === undefined && active > 0 ? "g" : "c", icon: "textures/items/firework_rocket", text: "§a§lAuto" + L + "§7Always the best unlocked speed" + L + "§7(now +" + unlocked + "%)", run: () => pick(undefined) });
  for (let i = 1; i <= PERK.max / PERK.step; i++) {
    const pct = i * PERK.step, slot = 5 * COLS + 2 * (i - 1);
    if (pct <= unlocked) {
      const sel = chosen === pct;
      put(f, slot, { zone: sel ? "g" : "c", icon: "textures/items/feather", text: "§b§l+" + pct + "% speed" + L + (sel ? "§aSelected" : "§eClick to use this speed"), run: () => pick(pct) });
    } else {
      put(f, slot, { zone: "c", icon: ICON.lock, text: "§c§l+" + pct + "% speed §r§8(locked)" + L + "§7Flying level §f" + i * PERK.every });
    }
  }
  put(f, 7 * COLS + 4, { icon: ICON.help, text: (msg ? msg + L + "§8" : "§e§lTip" + L) + "§7Faster flying also means harder crashes." + L + "§7Turn it off any time." });
  backBtn(f, () => (ret ? ret() : skillsPage(player, back)));
  status(player, f);
  open(player, f);
}

// ================================================================ "Abilities" = the same page now (Skills + Abilities were merged)
// commands.js and smp/menu.js still import abilitiesPage: it simply opens the merged page.
export const abilitiesPage = (player, back, msg) => skillsPage(player, back, msg);
