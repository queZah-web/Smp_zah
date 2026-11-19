// ===================================================================================================================
// SHULKER BOX PREVIEW - see what is inside a shulker box ITEM without placing it.
//
// What Bedrock allows (checked in the Script API): scripts can NOT draw into the inventory hover tooltip and can NOT read the
// contents of a shulker box while it is an item (the item inventory API only covers "Storage Item" items like bundles, and only
// from script API 2.5).  What IS allowed: reading the box while it is a BLOCK, and saving data on a non-stackable item.
// So, with the REAL contents only (nothing is guessed or made up):
//   * a player BREAKS a shulker box  ->  its contents are read at that moment and saved on the dropped shulker item
//     (a shulker item can not change while it is an item, so the saved contents always stay exact; placing it again and
//     breaking it again saves the new contents)
//   * HOVER over the box in the inventory: the game's own tooltip shows the contents (lore lines: "64x Diamond" ...)
//   * hold the box and RIGHT-CLICK INTO THE AIR: a chest window opens with the real items - icons, amounts, enchant glint
//   * a box that was never broken by a player after this update says "contents not scanned yet" (place + break it once)
// No lag: work only happens when a shulker box is broken or a player asks for the window.  No entities are created for the
// preview (the dropped box is the real item: it is only given the saved data).
// ===================================================================================================================
import { world, system, ItemStack } from "@minecraft/server";
import { make, set, open, hdr, COLS, NAV, status } from "../smp/ui.js";
import { CATEGORIES } from "../shop_data.js";
import { realId } from "../alias.js";
import { pick } from "./arextra.js";

const KEY = "sbx:items";                    // dynamic property on the shulker ITEM: JSON [[slot, id, amount, enchanted, name], ...]
const isShulker = (id) => typeof id === "string" && /shulker_box$/.test(id);
const MAX_LORE = 8;
const pretty = (id) => String(id).replace(/^minecraft:/, "").split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

// icons: the shop catalogue (same list the operator inventory viewer uses)
const ICONS = new Map();
try {
  for (const c of CATEGORIES) for (const it of c.items) {
    if (!ICONS.has(it[0])) ICONS.set(it[0], it[2]);
    try { const r = String(realId(it[0], it[1])).replace("minecraft:", ""); if (!ICONS.has(r)) ICONS.set(r, it[2]); } catch (e) { /* ignore */ }
  }
} catch (e) { /* ignore */ }
const iconOf = (id) => { const k = String(id).replace(/^minecraft:/, ""); return ICONS.get(k) ?? "textures/items/" + k; };

// ---------------------------------------------------------------- 1. breaking a shulker box: read the real contents
const pending = [];                         // { d, x, y, z, items, t }
try {
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    try {
      const b = ev.block; if (!isShulker(b.typeId)) return;
      const c = b.getComponent("minecraft:inventory")?.container; if (!c) return;
      const items = [];
      for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i); if (!s) continue;
        let ench = false; try { ench = (s.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0; } catch (e) { ench = false; }
        items.push([i, s.typeId, s.amount, ench ? 1 : 0, s.nameTag ? String(s.nameTag).slice(0, 30) : ""]);
      }
      pending.push({ d: b.dimension.id, x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5, items, t: system.currentTick });
      if (pending.length > 20) pending.shift();
    } catch (e) { /* never block breaking */ }
  });
} catch (e) { console.warn("[shulkerpeek] break: " + e); }

const lore = (items) => {
  if (!items.length) return ["§r§7Contents: §8empty", "§r§8(right-click in the air to look inside)"];
  const sum = new Map(); for (const [, id, n] of items) sum.set(id, (sum.get(id) ?? 0) + n);
  const list = [...sum].sort((a, b) => b[1] - a[1]);
  const out = ["§r§6Contents §7(" + items.length + "/27 slots):"];
  for (const [id, n] of list.slice(0, MAX_LORE)) out.push("§r§f" + n + "x §7" + pretty(id));
  if (list.length > MAX_LORE) out.push("§r§8...and " + (list.length - MAX_LORE) + " more");
  out.push("§r§8(right-click in the air to look inside)");
  return out;
};
// the dropped box: the same item, plus the saved contents + the lore (the entity is replaced by an exact copy of its item)
try {
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try {
      if (!pending.length || entity.typeId !== "minecraft:item") return;
      const st = entity.getComponent("minecraft:item")?.itemStack; if (!st || !isShulker(st.typeId)) return;
      const l = entity.location, d = entity.dimension.id, now = system.currentTick;
      const k = pending.findIndex((q) => q.d === d && now - q.t <= 3 && Math.abs(q.x - l.x) < 1.6 && Math.abs(q.y - l.y) < 1.6 && Math.abs(q.z - l.z) < 1.6);
      if (k < 0) return;
      const q = pending.splice(k, 1)[0];
      const copy = st.clone();
      try { copy.setDynamicProperty(KEY, JSON.stringify(q.items)); } catch (e) { return; }
      try { copy.setLore(lore(q.items)); } catch (e) { /* lore is only the hover text */ }
      const dim = entity.dimension, at = { x: l.x, y: l.y, z: l.z };
      entity.remove();                                                    // first remove, then drop the copy: never two boxes
      dim.spawnItem(copy, at);
    } catch (e) { console.warn("[shulkerpeek] drop: " + e); }
  });
} catch (e) { console.warn("[shulkerpeek] spawn: " + e); }

// ---------------------------------------------------------------- 2. the window (hold the box, right-click into the air)
function readSaved(st) {
  try {
    const inv = st.getComponent("minecraft:inventory")?.container;          // newer script APIs may expose the box directly: use it when it is there
    if (inv) { const out = []; for (let i = 0; i < inv.size; i++) { const s = inv.getItem(i); if (s) out.push([i, s.typeId, s.amount, 0, s.nameTag ?? ""]); } return out; }
  } catch (e) { /* not available */ }
  try { const v = st.getDynamicProperty(KEY); return typeof v === "string" ? JSON.parse(v) : null; } catch (e) { return null; }
}
export function shulkerPage(p, st) {
  const items = readSaved(st);
  const name = st.nameTag || pretty(st.typeId);
  const f = make(name, 5); f.self = () => shulkerPage(p, st); f.noRefresh = true; f.quietEmpty = true;
  if (!items) {
    set(f, 2 * COLS + 4, hdr(1, "r") + pick(p, "§c§lContents not scanned yet\n§r§7This box was filled before the preview\n§r§7existed. Place it and break it once:\n§r§7its contents are saved on the item.", "§c§lالمحتوى ما انقرا للحين\n§r§7هذا الصندوق انملى قبل هالميزة.\n§r§7حطه واكسره مرة وحدة:\n§r§7محتواه ينحفظ على الغرض."), "textures/blocks/barrier", null);
  } else {
    for (const [slot, id, n, ench, nm] of items) {
      if (slot < 0 || slot > 26) continue;
      set(f, 9 + slot, hdr(n, ench ? "x" : "c") + "§f" + (nm || pretty(id)) + (n > 1 ? " §7x" + n : ""), iconOf(id), null);
    }
    set(f, 0 * COLS + 4, hdr(1) + "§6§l" + name + "\n§r§7" + items.length + "/27 " + pick(p, "slots used", "خانة مستخدمة") + "\n§r§8" + pick(p, "Real contents (saved when the box was broken)", "المحتوى الحقيقي (انحفظ لما انكسر الصندوق)"), iconOf(st.typeId), null);
  }
  status(p, f);
  set(f, 4 * COLS + 0, hdr(1) + pick(p, "§cClose", "§cإغلاق"), NAV.back, { run: () => {} });
  open(p, f);
}
try {
  world.beforeEvents.itemUse.subscribe((ev) => {
    try {
      const st = ev.itemStack; if (!st || !isShulker(st.typeId)) return;
      const p = ev.source; if (!p || p.typeId !== "minecraft:player") return;
      const copy = st.clone();
      system.run(() => { try { shulkerPage(p, copy); } catch (e) { console.warn("[shulkerpeek] page: " + e); } });
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.warn("[shulkerpeek] use: " + e); }
