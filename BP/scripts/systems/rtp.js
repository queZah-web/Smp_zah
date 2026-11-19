// /rtp - menu with two options (overworld only):
//   Surface RTP: random place anywhere, always on solid ground (never lava / water / cactus / void)
//   Cave RTP:    random cave underground, always a safe pocket with a solid floor
// How it works: ONE random spot is chosen, the player waits high above it (slow falling + resistance) while the area loads,
// then the safe place is searched AROUND that spot (the coordinates do not jump around). If nothing is ready within
// LOAD_SECONDS the player is sent back to where they started.
import { world, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { SHORT_ROWS, make, set, open, hdr, COLS, NAV, backBtn, status } from "../smp/ui.js";
import { RTP, RTP_PRICE } from "./config.js";
import { balance, takeMoney, addMoney } from "../data.js";
import { money } from "../format.js";
import { ex } from "../smp/store.js";
import { canTeleport, stamp, valid } from "./util.js";
import { enterSky, leaveSky } from "./locate.js";
import { generated, surfaceAt, caveAt } from "./rtpfind.js";
import { luxRtpGo, luxRtpLand } from "../lux.js";
import { showModal, textField } from "./forms.js";
import { isAdmin } from "./landcore.js";
import { can } from "./staffcore.js";
import { menuMsg, MenuForm } from "./menulang.js";

// ---- RTP prices set by an admin (/rtp -> Set prices): saved in ONE world property "rtpprice" = { surface, cave }.  Nothing saved = config.js.
const RTPP = "rtpprice", RTP_BASE = { surface: RTP_PRICE.surface, cave: RTP_PRICE.cave };
export const RTP_MIN_PRICE = 149, RTP_MAX_PRICE = 5000;
let rtpLoaded = false;
function rtpLoad() {             // lazy: world data can't be read while the script is starting
  if (rtpLoaded) return;
  try {
    const raw = world.getDynamicProperty(RTPP);
    rtpLoaded = true;
    if (typeof raw === "string") { const v = JSON.parse(raw); for (const k of ["surface", "cave"]) { const n = Math.floor(Number(v?.[k])); if (Number.isFinite(n) && n >= RTP_MIN_PRICE && n <= RTP_MAX_PRICE) RTP_PRICE[k] = n; } }
  } catch (e) { /* unreadable: normal prices */ }
}
export const rtpPrice = (key) => { rtpLoad(); return key === "cave" ? RTP_PRICE.cave : RTP_PRICE.surface; };
/** returns an error text, or null when saved */
export function rtpSetPrices(surface, cave) {
  const a = Number(surface), b = Number(cave);
  for (const n of [a, b]) if (!Number.isInteger(n) || n < RTP_MIN_PRICE || n > RTP_MAX_PRICE) return "Prices must be whole numbers from " + RTP_MIN_PRICE + " to " + RTP_MAX_PRICE + ".";
  try { world.setDynamicProperty(RTPP, JSON.stringify({ surface: a, cave: b })); } catch (e) { return "Could not save it."; }
  rtpLoaded = true; RTP_PRICE.surface = a; RTP_PRICE.cave = b;
  return null;
}
export function rtpResetPrices() {
  try { world.setDynamicProperty(RTPP, undefined); } catch (e) { return "Could not save it."; }
  rtpLoaded = true; RTP_PRICE.surface = RTP_BASE.surface; RTP_PRICE.cave = RTP_BASE.cave;
  return null;
}
const canRtpPrice = (p) => { try { return isAdmin(p) || can(p, "landlimit"); } catch (e) { return false; } };

const busy = new Set();
const LOAD_SECONDS = 30;          // give up and go back after this long
const POLL = 5;                   // ticks between checks
const MAX_REROLL = 3;             // only used when the whole area around the spot is unusable (e.g. deep ocean)
const RADIUS = 32;                // surface: search this far around the chosen spot
const CAVE_SAMPLES = 300;         // cave: random columns tried around the chosen spot
const CAVE_RADIUS = 40;

// nearest columns first
const OFFSETS = (() => {
  const a = [];
  for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) a.push([dx, dz, dx * dx + dz * dz]);
  return a.filter((o) => o[2] <= RADIUS * RADIUS).sort((p, q) => p[2] - q[2]);
})();

function randomXZ() {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random() * (RTP.max * RTP.max - RTP.min * RTP.min) + RTP.min * RTP.min);
  return [Math.floor(Math.cos(a) * r), Math.floor(Math.sin(a) * r)];
}

export function rtp(player, kind) {
  if (player.dimension.id !== "minecraft:overworld") return player.sendMessage(menuMsg(player, "§c[RTP] Random teleport works only in the Overworld."));
  if (busy.has(player.id)) return player.sendMessage(menuMsg(player, "§e[RTP] Already searching for a place..."));
  if (!canTeleport(player, "rtp")) return;
  const cave = kind === "cave", key = cave ? "cave" : "surface", price = rtpPrice(key);
  // PAYMENT: charged when the search really starts. If the teleport fails the money is given back at once. If something cuts it
  // short that cannot be answered (the player leaves / the server stops) the payment is kept as a saved free teleport of this kind.
  const paid = () => { const d = ex(player); d.rtpPaid ??= {}; return d.rtpPaid; };
  if ((paid()[key] ?? 0) <= 0 && balance(player) < price) return player.sendMessage(menuMsg(player, "§c[RTP] " + (cave ? "Cave" : "Surface") + " RTP costs §f" + money(price) + "§c. You have §f" + money(balance(player)) + "§c."));
  const dim = world.getDimension("overworld");
  const origin = { loc: { x: player.location.x, y: player.location.y, z: player.location.z }, dim: player.dimension };
  const st = { sky: false };
  busy.add(player.id);
  player.sendMessage(menuMsg(player, "§7[RTP] Searching for a safe " + (cave ? "cave" : "place") + "..."));

  let startTick = system.currentTick;
  let x = 0, z = 0, readyAt = null, idx = 0, samples = 0, rerolls = 0, last = "";
  let handle = null;
  let pay = "none";                                        // "money" = charged now | "ticket" = used an earlier unused payment | "none"
  const charge = () => {
    const t = paid();
    if ((t[key] ?? 0) > 0) { pay = "ticket"; return true; }
    if (!takeMoney(player, price)) return false;
    t[key] = (t[key] ?? 0) + 1; pay = "money";
    return true;
  };
  const consume = () => { if (pay === "none") return; const t = paid(); t[key] = Math.max(0, (t[key] ?? 0) - 1); };
  const refund = () => { if (pay !== "money") return false; addMoney(player, price); const t = paid(); t[key] = Math.max(0, (t[key] ?? 0) - 1); pay = "none"; return true; };

  const stop = () => { if (handle !== null) { system.clearRun(handle); handle = null; } };
  const cleanup = () => { stop(); busy.delete(player.id); if (valid(player)) leaveSky(player, st); };
  const fail = (msg) => {
    stop();
    if (valid(player)) {
      try { player.teleport(origin.loc, { dimension: origin.dim }); } catch (e) { /* ignore */ }
      const back = refund();
      try { player.sendMessage(menuMsg(player, msg + (back ? " §a" + money(price) + " refunded." : pay === "ticket" ? " §aYour next " + (cave ? "cave" : "surface") + " RTP is free." : ""))); } catch (e) { /* ignore */ }
    }
    cleanup();
  };
  const target = () => {                                  // pick ONE random spot and go above it
    [x, z] = randomXZ(); readyAt = null; idx = 0; samples = 0;
    try { enterSky(player, dim, x, z, st); return true; } catch (e) { return false; }
  };

  // one search step: spot | null (area exhausted) | undefined (wait / not ready)
  const step = () => {
    const gen = generated(dim, x, z);
    if (gen === null) return undefined;                   // area not loaded yet
    if (gen === false) {                                  // loaded but terrain not generated yet
      if (readyAt === null) readyAt = system.currentTick;
      if (system.currentTick - readyAt < 60) return undefined;
    }
    if (cave) {
      for (let i = 0; i < 16; i++) {
        const sx = x + Math.floor((Math.random() * 2 - 1) * CAVE_RADIUS), sz = z + Math.floor((Math.random() * 2 - 1) * CAVE_RADIUS);
        if (generated(dim, sx, sz) !== true && gen !== false) continue;
        const r = caveAt(dim, sx, sz);
        if (r === undefined) continue;
        if (r) return r;
        if (++samples >= CAVE_SAMPLES) { last = "no cave near " + x + ", " + z; return null; }
      }
      return undefined;
    }
    for (let i = 0; i < 150 && idx < OFFSETS.length; i++) {
      const o = OFFSETS[idx], r = surfaceAt(dim, x + o[0], z + o[1]);
      if (r === undefined) { if (idx === 0) return undefined; idx++; continue; }
      if (r) return r;
      if (idx === 0) { try { const t = dim.getTopmostBlock({ x, z }); last = t ? t.typeId.replace("minecraft:", "") + " y=" + t.y : "no block"; } catch (e) { /* ignore */ } }
      idx++;
    }
    return idx >= OFFSETS.length ? null : undefined;
  };

  const begin = () => {                                  // runs when the vortex has finished
    if (!valid(player)) { cleanup(); return; }
    if (!charge()) { cleanup(); player.sendMessage(menuMsg(player, "§c[RTP] Not enough money. " + (cave ? "Cave" : "Surface") + " RTP costs §f" + money(price) + "§c.")); return; }
    if (pay === "ticket") player.sendMessage(menuMsg(player, "§a[RTP] Free teleport (an earlier payment was never used)."));
    else player.sendMessage(menuMsg(player, "§7[RTP] Paid §e" + money(price) + " §8(refunded if it fails)"));
    startTick = system.currentTick;
    if (!target()) return fail("§c[RTP] Teleport failed.");
    handle = system.runInterval(() => {
      if (!valid(player)) { cleanup(); return; }
      if (system.currentTick - startTick > LOAD_SECONDS * 20) return fail("§c[RTP] The area took too long to load. You were sent back - try again.");
      let r;
      try { r = step(); } catch (e) { r = undefined; }
      if (r === undefined) return;
      if (r === null) {                                     // nothing usable around this spot (rare) -> pick another spot
        if (++rerolls > MAX_REROLL) return fail("§c[RTP] Could not find a safe place. You were sent back - try again." + (last ? " §8(" + last + ")" : ""));
        if (!target()) return fail("§c[RTP] Teleport failed.");
        return;
      }
      stop();
      try { player.teleport(r, { dimension: dim }); } catch (e) { return fail("§c[RTP] Teleport failed."); }
      consume(); cleanup(); stamp(player, "rtp");
      try { ex(player).st.rtp = (ex(player).st.rtp ?? 0) + 1; } catch (e) { /* ignore */ }
      luxRtpLand(player);
      player.sendMessage(menuMsg(player, "§a[RTP] Teleported to §f" + Math.floor(r.x) + ", " + Math.floor(r.y) + ", " + Math.floor(r.z) + (cave ? " §7(cave)" : "")));
    }, POLL);
  };
  luxRtpGo(player, begin);
}

export function rtpPage(player, back) {
  const f = make("Random Teleport", SHORT_ROWS); f.self = () => rtpPage(player, back);
  set(f, 0 * COLS + 4, hdr(1) + "§e§lRandom Teleport\n§r§7Overworld only\n§r§7Always a safe landing:\n§r§7no lava, no void, no water\n§r§7Refunded if it fails", "textures/items/ender_pearl", null);
  set(f, 2 * COLS + 2, hdr(1) + "§a§lSurface RTP\n§r§7Random place on the surface\n§r§7(any biome, any block)\n§r§7Price: §a" + money(rtpPrice("surface")), "textures/blocks/grass_side_carried", { run: () => rtp(player, "surface") });
  set(f, 2 * COLS + 6, hdr(1) + "§b§lCave RTP\n§r§7Random cave underground\n§r§7(random depth)\n§r§7Price: §a" + money(rtpPrice("cave")), "textures/items/iron_pickaxe", { run: () => rtp(player, "cave") });
  if (canRtpPrice(player)) set(f, 0 * COLS + 8, hdr(1) + "§6§lSet prices\n§r§7Price of Surface RTP and Cave RTP\n§r§7From " + money(RTP_MIN_PRICE) + " to " + money(RTP_MAX_PRICE) + "\n§r§eAdmins only - click to change", "textures/ui/shop/hud_money", { run: () => rtpPriceForm(player, back) });
  backBtn(f, back); status(player, f);
  open(player, f);
}

// ---- admin: price of Surface RTP and Cave RTP - same price for everybody
function rtpPriceForm(p, back) {
  if (!canRtpPrice(p)) return rtpPage(p, back);
  const form = new MenuForm().title("RTP prices");
  textField(form, "§aSurface RTP §7- price\n§7Now: §a" + money(rtpPrice("surface")) + " §7| normal: §f" + money(RTP_BASE.surface) + "\n§7Whole number, " + RTP_MIN_PRICE + " to " + RTP_MAX_PRICE, String(rtpPrice("surface")));
  textField(form, "§bCave RTP §7- price\n§7Now: §a" + money(rtpPrice("cave")) + " §7| normal: §f" + money(RTP_BASE.cave) + "\n§7Whole number, " + RTP_MIN_PRICE + " to " + RTP_MAX_PRICE, String(rtpPrice("cave")));
  try { form.toggle("§eReset both to the normal prices", { defaultValue: false }); } catch (e) { form.toggle("§eReset both to the normal prices", false); }
  showModal(p, form, (v) => {
    if (!v) return rtpPage(p, back);
    if (v[2] === true) {
      const err = rtpResetPrices();
      p.sendMessage(menuMsg(p, err ? "§c[RTP] " + err : "§a[RTP] RTP prices are back to the normal prices."));
      return rtpPage(p, back);
    }
    const rs = String(v[0] ?? "").trim(), rc = String(v[1] ?? "").trim();
    if (rs === "" && rc === "") return rtpPage(p, back);
    const ns = rs === "" ? rtpPrice("surface") : rs, nc = rc === "" ? rtpPrice("cave") : rc;
    for (const n of [ns, nc]) if (!/^[0-9]{1,8}$/.test(String(n))) { p.sendMessage(menuMsg(p, "§c[RTP] Prices must be whole numbers from " + RTP_MIN_PRICE + " to " + RTP_MAX_PRICE + ".")); return rtpPage(p, back); }
    const err = rtpSetPrices(ns, nc);
    p.sendMessage(menuMsg(p, err ? "§c[RTP] " + err : "§a[RTP] New RTP prices: §fSurface §a" + money(rtpPrice("surface")) + "§7, §fCave §a" + money(rtpPrice("cave")) + "§a."));
    rtpPage(p, back);
  });
}
