// /menu -> Night Vision : buy night vision time (30 min / 1 h / 6 h packs, real time) and switch it on / off.
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { NV } from "./config.js";
import { nvTimeLeft, nvFitsMin, nvAddMinutes, nvPrice, nvClock, nvIsOn, nvToggle, nvNotice, nvBasePrice, nvSetPrices, nvResetPrices, NV_MAX_PRICE } from "./nv.js";
import { stats, takeMoney, addTx } from "../data.js";
import { buyPrice } from "../priceperks.js";
const myNv = (p, m) => buyPrice(p, nvPrice(m), 0);                     // the rank / Trading discount of this player
import { money } from "../format.js";
import { confirmShort as confirm, showModal, textField } from "./forms.js";
import { ModalFormData } from "@minecraft/server-ui";
import { isAdmin } from "./landcore.js";
import { can } from "./staffcore.js";
import { luxDing, luxShop } from "../lux.js";
import { menuMsg, MenuForm } from "./menulang.js";

const ICON = "textures/ui/shop/nv_potion";
const timeLine = (p) => (nvTimeLeft(p) > 0 ? "\u00a77Time left: \u00a7f" + nvClock(nvTimeLeft(p)) : "\u00a7cNo time - buy below");

const PACKS = [[30, "30 minutes"], [60, "1 hour"], [360, "6 hours"]];
/** takes the money and adds the time - every check is done again here, so a double click or an old page can never over-fill or go below zero */
function buy(p, min) {
  const pk = PACKS.find((x) => x[0] === min), cost = myNv(p, min);
  if (!pk || !nvFitsMin(p, min)) { p.sendMessage(menuMsg(p, "\u00a7c[NV] You can hold at most " + NV.maxHours + " hours of night vision.")); return false; }
  if (stats(p).money < cost) { p.sendMessage(menuMsg(p, "\u00a7c[NV] You don't have enough money! You need \u00a7f" + money(cost - stats(p).money) + " \u00a7cmore.")); return false; }
  if (!takeMoney(p, cost)) return false;
  try { addTx(p, { type: "buy", id: "night_vision", name: "Night Vision +" + pk[1], qty: 1, total: cost }); } catch (e) { /* ignore */ }
  const wasLocked = nvTimeLeft(p) <= 0;                  // no time before = it was off
  nvAddMinutes(p, min);
  p.sendMessage(menuMsg(p, "\u00a7a[NV] Night vision \u00a7a+" + pk[1] + " for \u00a7e" + money(cost) + " \u00a7a- time left: \u00a7f" + nvClock(nvTimeLeft(p))));
  luxDing(p); luxShop(p);
  if (nvIsOn(p)) nvNotice(p, true);                       // it is running: show the new time
  else if (wasLocked) nvToggle(p);                         // bought it -> turn it ON right away (a player who still had time keeps his own ON / OFF choice)
  return true;
}

export function nvPage(p, back) {
  const bal = stats(p).money, on = nvIsOn(p), left = nvTimeLeft(p);
  const f = make("Night Vision", SHORT_ROWS); f.self = () => nvPage(p, back);
  const again = () => nvPage(p, back);
  set(f, 0 * COLS + 4, hdr(1) + "\u00a7b\u00a7lNight Vision\n\u00a7r" + PACKS.map(([m, l]) => "\u00a77" + l + ": \u00a7a" + money(myNv(p, m))).join("\n\u00a7r") + "\n\u00a7r\u00a77Maximum: \u00a7f" + NV.maxHours + " hours\n\u00a7r\u00a77Your balance: \u00a7a" + money(bal) + "\n\u00a7r" + timeLine(p) + "\n\u00a7r\u00a77Now: " + (on ? "\u00a7aON" : "\u00a7cOFF"), ICON, null);

  [[1, 0], [4, 1], [7, 2]].forEach(([col, i]) => {
    const [min, label] = PACKS[i], price = myNv(p, min), fit = nvFitsMin(p, min), okb = fit && bal >= price;
    set(f, 2 * COLS + col, hdr(1, okb ? "g" : "r") + "\u00a7a\u00a7l+" + label + "\n\u00a7r\u00a77Cost: \u00a7a" + money(price) + "\n\u00a7r" + (!fit ? "\u00a7cWould go over " + NV.maxHours + " hours" : bal >= price ? "\u00a7eClick to buy" : "\u00a7cNeed " + money(price - bal) + " more"), NAV.ok,
      { run: () => { if (!fit) return again(); confirm(p, "Buy time", ["\u00a7fNight Vision", "\u00a77Time: \u00a7f" + label + " (real time)", "\u00a77Cost: \u00a7a" + money(price), "\u00a77Your balance: \u00a7a" + money(bal)], () => { buy(p, min); again(); }, again); } });
  });

  if (on) set(f, 1 * COLS + 4, hdr(1, "g") + "\u00a7c\u00a7lTurn OFF\n\u00a7r\u00a77Now: \u00a7aON\n\u00a7r\u00a77The time keeps running\n\u00a7r\u00a7eClick to switch", NAV.no, { run: () => { nvToggle(p); again(); } });
  else if (left > 0) set(f, 1 * COLS + 4, hdr(1, "g") + "\u00a7a\u00a7lTurn ON\n\u00a7r\u00a77Now: \u00a7cOFF\n\u00a7r\u00a77The time keeps running\n\u00a7r\u00a7eClick to switch", NAV.ok, { run: () => { nvToggle(p); again(); } });
  else set(f, 1 * COLS + 4, hdr(1, "r") + "\u00a7c\u00a7lNo time left\n\u00a7r\u00a77Buy time first", NAV.no, null);

  if (canPrice(p)) set(f, 0 * COLS + 8, hdr(1) + "\u00a76\u00a7lSet prices\n\u00a7r\u00a77Price of every time pack\n\u00a7r\u00a77(30 min, 1 hour, 6 hours)\n\u00a7r\u00a7eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => priceForm(p, back) });
  backBtn(f, back); status(p, f);
  open(p, f);
}

// ---- admin: price of every Night Vision pack (30 minutes / 1 hour / 6 hours) - same price for everybody
const canPrice = (p) => { try { return isAdmin(p) || can(p, "landlimit"); } catch (e) { return false; } };
function priceForm(p, back) {
  if (!canPrice(p)) return nvPage(p, back);
  const form = new MenuForm().title("Night Vision prices");
  PACKS.forEach(([m, l]) => textField(form, "\u00a7f" + l + " \u00a77- price\n\u00a77Now: \u00a7a" + money(nvPrice(m)) + " \u00a77| normal: \u00a7f" + money(nvBasePrice(m)) + "\n\u00a77Whole number, 1 to " + NV_MAX_PRICE, String(nvPrice(m))));
  try { form.toggle("\u00a7eReset all three to the normal prices", { defaultValue: false }); } catch (e) { form.toggle("\u00a7eReset all three to the normal prices", false); }
  showModal(p, form, (v) => {
    if (!v) return nvPage(p, back);
    if (v[PACKS.length] === true) {
      const err = nvResetPrices();
      p.sendMessage(menuMsg(p, err ? "\u00a7c[NV] " + err : "\u00a7a[NV] Night vision prices are back to the normal prices."));
      return nvPage(p, back);
    }
    const next = {};
    let any = false;
    PACKS.forEach(([m], i) => { const raw = String(v[i] ?? "").trim(); next[m] = raw === "" ? nvPrice(m) : raw; if (raw !== "") any = true; });
    if (!any) return nvPage(p, back);
    for (const m of [30, 60, 360]) if (!/^[0-9]{1,8}$/.test(String(next[m]))) { p.sendMessage(menuMsg(p, "\u00a7c[NV] Prices must be whole numbers from 1 to " + NV_MAX_PRICE + ".")); return nvPage(p, back); }
    const err = nvSetPrices(next);
    p.sendMessage(menuMsg(p, err ? "\u00a7c[NV] " + err : "\u00a7a[NV] New night vision prices: " + PACKS.map(([m, l]) => "\u00a7f" + l + " \u00a7a" + money(nvPrice(m))).join("\u00a77, ") + "\u00a7a."));
    nvPage(p, back);
  });
}
