// Form helpers for the new systems (modal forms with the same "busy" handling as the shop + a confirm page).
import { system } from "@minecraft/server";
import { FormCancelationReason } from "@minecraft/server-ui";
import { formBusy } from "../state.js";
import { updateHud } from "../hud.js";
import { makeOpr, makeShop, make, set, open, hdr, COLS, NAV, SHORT_ROWS } from "../smp/ui.js";

/** shows a ModalFormData; cb(values) or cb(null) when cancelled. Retries while the chat screen is still open. */
export function showModal(player, form, cb, tries = 0) {
  formBusy.add(player.id);
  form.show(player).then((res) => {
    if (res.canceled) {
      if (res.cancelationReason === FormCancelationReason.UserBusy && tries < 25) { system.runTimeout(() => showModal(player, form, cb, tries + 1), 8); return; }
      formBusy.delete(player.id); updateHud(player); cb(null); return;
    }
    formBusy.delete(player.id);
    cb(res.formValues ?? []);
  }).catch((e) => { formBusy.delete(player.id); console.warn("[forms] " + e); });
}
export function textField(form, label, placeholder) {
  try { form.textField(label, placeholder, { defaultValue: "" }); } catch (e) { form.textField(label, placeholder); }
}
export function dropdown(form, label, items) {
  try { form.dropdown(label, items, { defaultValueIndex: 0 }); } catch (e) { form.dropdown(label, items, 0); }
}

/** chest-style confirmation page */
export function confirm(player, title, lines, onYes, onNo) {
  const f = make("Confirm"); f.self = () => confirm(player, title, lines, onYes, onNo);
  set(f, 1 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 4 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 4 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}

/** same as confirm() but in the short chest (used by the pages that were shortened) */
export function confirmShort(player, title, lines, onYes, onNo) {
  const f = make("Confirm", SHORT_ROWS); f.self = () => confirmShort(player, title, lines, onYes, onNo);
  set(f, 0 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 2 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 2 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}

/** same as confirmShort() but for the Operator menu (translated for Arabic players) */
export function confirmOpr(player, title, lines, onYes, onNo) {
  const f = makeOpr("Confirm", SHORT_ROWS); f.self = () => confirmOpr(player, title, lines, onYes, onNo);
  set(f, 0 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 2 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 2 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}

/** confirm() / confirmShort() for the /shop pages (Land Protection, Table Passes) - translated for Arabic players */
export function confirmShop(player, title, lines, onYes, onNo) {
  const f = makeShop("Confirm"); f.self = () => confirmShop(player, title, lines, onYes, onNo);
  set(f, 1 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 4 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 4 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}
export function confirmShopShort(player, title, lines, onYes, onNo) {
  const f = makeShop("Confirm", SHORT_ROWS); f.self = () => confirmShopShort(player, title, lines, onYes, onNo);
  set(f, 0 * COLS + 4, hdr(1) + "§e§l" + title + "\n§r" + lines.join("\n§r"), NAV.page, null);
  set(f, 2 * COLS + 2, hdr(1) + "§a§lCONFIRM\n§r§7Click to proceed", NAV.ok, { run: onYes });
  set(f, 2 * COLS + 6, hdr(1) + "§c§lCANCEL\n§r§7Go back", NAV.no, { run: onNo });
  open(player, f);
}
