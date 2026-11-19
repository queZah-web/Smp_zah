// TPA / TP Here:
//   /tpa <player>     ask to teleport TO that player
//   /tphere <player>  ask that player to teleport TO YOU
//   /tpaccept  /tpdeny  (or the Accept / Deny popup, or the "Incoming Requests" page in the menu)
import { hiddenFrom } from "./staffcore.js";   // staff tools: vanished operators are not listed
import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import { sendBar } from "../barsend.js";
import { TPA_EXPIRE_SECONDS } from "./config.js";
import { combatLeft } from "./combat.js";
import { canTeleport, stamp, teleportTo, teleportWithFx, online } from "./util.js";
import { showModal, dropdown } from "./forms.js";
import { formBusy } from "../state.js";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { ex } from "../smp/store.js";
import { luxTpOff, luxTpOn } from "../lux.js";
import { clanView } from "./clanstate.js";
import { clanBanner } from "./clanbar.js";
import { claimById } from "./landcore.js";
import { menuMsg, MenuForm } from "./menulang.js";

const reqs = new Map();          // target id -> { type: "to" | "here", from: player id, name, exp }

/** the pending request of player t (or null) */
export function pending(t) {
  const r = reqs.get(t.id);
  if (!r) return null;
  if (r.exp < Date.now()) { reqs.delete(t.id); return null; }
  return r;
}

/** popup with Accept / Deny for the target - in the same chest style as every other page (a plain form is drawn wrongly by the custom UI).
 *  open() retries while the target has another screen open. */
function popup(t, r, body) {
  if (reqs.get(t.id) !== r || r.exp < Date.now()) return;     // answered / replaced / expired meanwhile
  const alive = () => reqs.get(t.id) === r && r.exp >= Date.now();
  const f = make("Teleport Request", SHORT_ROWS);
  set(f, 0 * COLS + 4, hdr(1) + "§e§lTeleport Request\n§r" + body + "\n§r§8Expires in " + TPA_EXPIRE_SECONDS + " seconds", NAV.page, null);
  set(f, 2 * COLS + 2, hdr(1, "g") + "§a§lACCEPT\n§r§7Click to accept", NAV.ok, { run: () => { if (!alive()) return t.sendMessage(menuMsg(t, "§c[TPA] This request expired.")); acceptTpa(t); } });
  set(f, 2 * COLS + 6, hdr(1, "r") + "§c§lDENY\n§r§7Click to deny", NAV.no, { run: () => { if (!alive()) return t.sendMessage(menuMsg(t, "§c[TPA] This request expired.")); denyTpa(t); } });
  try { open(t, f); } catch (e) { formBusy.delete(t.id); }
}

/** text in the middle-bottom of the screen (action bar), re-sent for a few seconds so other bars can't hide it.
 *  alive() = false stops it (answered / replaced / expired). */
const NOTICE_SECONDS = 6;
function bar(t, text, alive) {
  let n = 0, h = null;
  const stop = () => { if (h !== null) { try { system.clearRun(h); } catch (e) { /* ignore */ } h = null; } };
  const show = () => {
    if (n++ >= NOTICE_SECONDS * 4 || !alive()) return stop();
    try { sendBar(t, text); } catch (e) { stop(); }                               // player left
  };
  show();
  h = system.runInterval(show, 5);
}
/** green = the sender wants to bring YOU to them (TP Here)   red = the sender wants to come TO YOU (TPA, dangerous) */
function notice(t, r, color) { bar(t, color + r.name + " sent you a tp request", () => reqs.get(t.id) === r && r.exp >= Date.now()); }

// ---- "close my teleport requests": nobody can send this player a TPA / TP Here (saved with his settings)
export const tpOff = (p) => { try { return ex(p).set.tpoff === true; } catch (e) { return false; } };
const toggles = new Map();       // player id -> the latest toggle notice (a newer one replaces the older)
function setTpOff(p, off) {
  ex(p).set.tpoff = off;
  if (off) reqs.delete(p.id);                                  // a request that is still waiting is cancelled too
  const tok = {}; toggles.set(p.id, tok);
  bar(p, off ? "§cTP Cancel" : "§aTP Enable", () => toggles.get(p.id) === tok);
  if (off) luxTpOff(p); else luxTpOn(p);                        // luxury sound + particles
}
world.afterEvents.playerLeave.subscribe(({ playerId }) => { toggles.delete(playerId); });

/** asks to teleport TO player t */
export function sendTpa(p, t) {
  if (!t || t.id === p.id) return p.sendMessage(menuMsg(p, "§c[TPA] Choose another player."));
  if (tpOff(t)) return p.sendMessage(menuMsg(p, "§c[TPA] §f" + t.name + " §chas closed teleport requests."));
  if (!canTeleport(p, "tpa")) return;
  const r = { type: "to", from: p.id, name: p.name, exp: Date.now() + TPA_EXPIRE_SECONDS * 1000 };
  reqs.set(t.id, r);
  p.sendMessage(menuMsg(p, "§a[TPA] Request sent to §f" + t.name + "§a. It expires in " + TPA_EXPIRE_SECONDS + "s."));
  t.sendMessage(menuMsg(t, "§e[TPA] §f" + p.name + " §ewants to teleport to you.\n§a/tpaccept §7to accept   §c/tpdeny §7to deny §8(expires in " + TPA_EXPIRE_SECONDS + "s)"));
  try { t.playSound("random.orb"); } catch (e) { /* ignore */ }
  notice(t, r, "§c");                                           // red: he wants to come TO you
  popup(t, r, "§f" + p.name + " §7wants to teleport to you.");
}

/** asks player t to teleport to ME (TP Here) */
export function sendTphere(p, t) {
  if (!t || t.id === p.id) return p.sendMessage(menuMsg(p, "§c[TPHere] Choose another player."));
  if (tpOff(t)) return p.sendMessage(menuMsg(p, "§c[TPHere] §f" + t.name + " §chas closed teleport requests."));
  if (combatLeft(p) > 0) return p.sendMessage(menuMsg(p, "§c[Combat] You can't send a request while in combat §7(" + Math.ceil(combatLeft(p) / 1000) + "s left)"));
  const r = { type: "here", from: p.id, name: p.name, exp: Date.now() + TPA_EXPIRE_SECONDS * 1000 };
  reqs.set(t.id, r);
  p.sendMessage(menuMsg(p, "§a[TPHere] Request sent to §f" + t.name + "§a. It expires in " + TPA_EXPIRE_SECONDS + "s."));
  t.sendMessage(menuMsg(t, "§e[TPHere] §f" + p.name + " §easks you to teleport to them.\n§a/tpaccept §7to accept   §c/tpdeny §7to deny §8(expires in " + TPA_EXPIRE_SECONDS + "s)"));
  try { t.playSound("random.orb"); } catch (e) { /* ignore */ }
  notice(t, r, "§a");                                           // green: he wants to bring YOU to him
  popup(t, r, "§f" + p.name + " §7asks you to teleport to them.");
}

/** a CLAN MATE asks to teleport to one of YOUR protected lands (only clan mates, only your own land). c = the claim */
export function sendTpaLand(p, t, c) {
  if (!t || !c || t.id === p.id) return p.sendMessage(menuMsg(p, "§c[TPA] Choose another player."));
  if (!clanView.same(p.id, t.id)) return p.sendMessage(menuMsg(p, "§c[TPA] This only works for players of your clan."));
  const claim = claimById(c.id);
  if (!claim || claim.o !== t.id) return p.sendMessage(menuMsg(p, "§c[TPA] That land no longer exists."));
  if (tpOff(t)) return p.sendMessage(menuMsg(p, "§c[TPA] §f" + t.name + " §chas closed teleport requests."));
  if (!canTeleport(p, "tpa")) return;
  const r = { type: "land", from: p.id, name: p.name, land: claim.id, landName: claim.n, exp: Date.now() + TPA_EXPIRE_SECONDS * 1000 };
  reqs.set(t.id, r);
  p.sendMessage(menuMsg(p, "§a[TPA] Request sent to §f" + t.name + "§a for the land §f" + claim.n + "§a. It expires in " + TPA_EXPIRE_SECONDS + "s."));
  t.sendMessage(menuMsg(t, "§e[TPA] §f" + p.name + " §ewants to teleport to your land §f" + claim.n + "§e.\n§a/tpaccept §7to accept   §c/tpdeny §7to deny §8(expires in " + TPA_EXPIRE_SECONDS + "s)"));
  try { t.playSound("random.orb"); } catch (e) { /* ignore */ }
  clanBanner(t, p.name + " sent you request tp for your land", clanView.noteColor(t.id));          // middle-bottom of the screen, in the clan notification colour
  popup(t, r, "§f" + p.name + " §7wants to teleport to your land §f" + claim.n);
}

export function acceptTpa(t) {
  const r = pending(t);
  if (!r) return t.sendMessage(menuMsg(t, "§c[TPA] You have no pending request."));
  const from = online(r.from);
  if (!from) { reqs.delete(t.id); return t.sendMessage(menuMsg(t, "§c[TPA] That player is offline.")); }

  if (r.type === "land") {                                    // the sender travels to the land of t
    const c = claimById(r.land);
    if (!c || c.o !== t.id) { reqs.delete(t.id); return t.sendMessage(menuMsg(t, "§c[TPA] That land no longer exists.")); }
    if (!clanView.same(from.id, t.id)) { reqs.delete(t.id); return t.sendMessage(menuMsg(t, "§c[TPA] §f" + from.name + " §cis not in your clan anymore.")); }
    if (!canTeleport(from, "tpa")) { t.sendMessage(menuMsg(t, "§c[TPA] §f" + from.name + " §ccan't teleport right now (combat / cooldown). Ask again later.")); return; }
    reqs.delete(t.id);
    teleportWithFx(from, c.sp, c.d, "tpa",
      () => { from.sendMessage(menuMsg(from, "§a[TPA] Teleported to the land §f" + c.n + " §aof §f" + t.name)); t.sendMessage(menuMsg(t, "§a[TPA] §f" + from.name + " §ateleported to your land.")); },
      () => from.sendMessage(menuMsg(from, "§c[TPA] Teleport failed.")));
    return;
  }

  if (r.type === "here") {                                    // t (the one who accepts) travels to the sender
    if (!canTeleport(t, "tpa")) return;                       // combat / cooldown of the player who will move (reason is sent by canTeleport)
    reqs.delete(t.id);
    try { teleportTo(t, from.location, from.dimension.id); } catch (e) { return t.sendMessage(menuMsg(t, "§c[TPHere] Teleport failed.")); }
    stamp(t, "tpa");
    t.sendMessage(menuMsg(t, "§a[TPHere] Teleported to §f" + from.name));
    from.sendMessage(menuMsg(from, "§a[TPHere] §f" + t.name + " §ateleported to you."));
    return;
  }

  if (combatLeft(t) > 0) return t.sendMessage(menuMsg(t, "§c[Combat] You can't accept while in combat §7(" + Math.ceil(combatLeft(t) / 1000) + "s)"));
  if (!canTeleport(from, "tpa")) { t.sendMessage(menuMsg(t, "§c[TPA] §f" + from.name + " §ccan't teleport right now (combat / cooldown). Ask again later.")); return; }
  reqs.delete(t.id);
  try { teleportTo(from, t.location, t.dimension.id); } catch (e) { return t.sendMessage(menuMsg(t, "§c[TPA] Teleport failed.")); }
  stamp(from, "tpa");
  from.sendMessage(menuMsg(from, "§a[TPA] Teleported to §f" + t.name)); t.sendMessage(menuMsg(t, "§a[TPA] §f" + from.name + " §ateleported to you."));
}
export function denyTpa(t) {
  const r = pending(t);
  if (!r) return t.sendMessage(menuMsg(t, "§c[TPA] You have no pending request."));
  reqs.delete(t.id);
  t.sendMessage(menuMsg(t, "§7[TPA] Request denied."));
  const from = online(r.from); if (from) from.sendMessage(menuMsg(from, "§c[TPA] §f" + t.name + " §cdenied your request."));
}

/** modal: pick an online player, then fn(player, target) */
export function pickPlayer(player, label, fn) {
  const others = world.getAllPlayers().filter((x) => x.id !== player.id && !hiddenFrom(player, x));        // a vanished operator is not in the list
  if (others.length === 0) return player.sendMessage(menuMsg(player, "§7[TP] No other players online."));
  const form = new MenuForm().title("Teleport Request");
  dropdown(form, label, others.map((x) => x.name));
  showModal(player, form, (v) => { if (v) { const t = others[Number(v[0])]; if (t) fn(player, t); } });
}

/** menu page: Incoming requests with Accept / Deny buttons */
export function requestsPage(player, back) {
  const r = pending(player);
  const f = make("Teleport Requests", 6); f.self = () => requestsPage(player, back);
  if (!r) {
    set(f, 0 * COLS + 4, hdr(1) + "§7§lNo requests\n§r§7Nobody is asking you\n§r§7to teleport right now", NAV.page, null);
  } else {
    const secs = Math.max(0, Math.ceil((r.exp - Date.now()) / 1000));
    set(f, 0 * COLS + 4, hdr(1) + "§e§l" + r.name + "\n§r§7" + (r.type === "here" ? "asks you to teleport to them" : r.type === "land" ? "wants to go to your land " + (r.landName ?? "") : "wants to teleport to you") + "\n§r§7Expires in §f" + secs + "s", NAV.player, null);
    set(f, 2 * COLS + 2, hdr(1) + "§a§lACCEPT\n§r§7Click to accept", NAV.ok, { run: () => acceptTpa(player) });
    set(f, 2 * COLS + 6, hdr(1) + "§c§lDENY\n§r§7Click to deny", NAV.no, { run: () => denyTpa(player) });
  }
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}

/** menu: ONE page for everything - TPA, TP Here and the incoming requests */
export function tpaPage(player, back) {
  const n = pending(player) ? 1 : 0;
  const f = make("Teleport Requests", 6); f.self = () => tpaPage(player, back);
  set(f, 0 * COLS + 4, hdr(1) + "§d§lTeleport Requests\n§r§7Go to a player, bring a player\n§r§7to you, or answer a request", "textures/items/ender_eye", null);
  set(f, 2 * COLS + 1, hdr(1) + "§a§lTPA\n§r§7Teleport TO a player\n§r§8/tpa", "textures/items/ender_eye", { run: () => pickPlayer(player, "§fTeleport to which player?", sendTpa) });
  set(f, 2 * COLS + 4, hdr(1) + "§b§lTP Here\n§r§7Ask a player to come TO YOU\n§r§8/tphere", "textures/items/ender_pearl", { run: () => pickPlayer(player, "§fWhich player should come to you?", sendTphere) });
  set(f, 2 * COLS + 7, hdr(Math.max(1, n)) + "§e§lIncoming Requests\n§r" + (n ? "§e1 waiting - click to answer" : "§7No requests") + "\n§r§8/tpaccept  /tpdeny", "textures/ui/shop/ic_mail", { run: () => requestsPage(player, () => tpaPage(player, back)) });
  const off = tpOff(player);
  set(f, 4 * COLS + 4, hdr(1, off ? "r" : "g") + (off ? "§c§lTP CLOSED\n§r§7Nobody can send you requests\n§r§eClick to open" : "§a§lTP OPEN\n§r§7Players can send you requests\n§r§eClick to close"), off ? NAV.no : NAV.ok, { run: () => { setTpOff(player, !off); tpaPage(player, back); } });
  if (back) backBtn(f, back);
  status(player, f);
  open(player, f);
}
