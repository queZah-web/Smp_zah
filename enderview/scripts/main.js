// SMP ENDER VIEW - a small helper pack (script API 2.8.0: the first stable version that can read an ender chest).
// The SMP pack (/opr, script API 2.0.0) asks it with a script event, it answers with a script event:
//   "smp:ec" {req, op: "ping" | "get" | "take" | "clear", target: player id, admin: player id, slot, n}  ->  "smp:ec_r" {req, ok, ...}
//   get   = every item of the target's ender chest (slot, id, amount, name, enchantments, durability)
//   take  = moves the REAL item (all its data) from the ender chest into the admin's inventory (n = how many, 0 = all)
//   clear = empties the ender chest
// It does nothing by itself; only the SMP pack (Admin / Owner in /opr) sends these events.
import { world, system } from "@minecraft/server";

const online = (id) => world.getAllPlayers().find((p) => p.id === id);
const reply = (o) => { try { system.sendScriptEvent("smp:ec_r", JSON.stringify(o)); } catch (e) { /* ignore */ } };
const ender = (p) => { try { return p.getComponent("minecraft:ender_inventory")?.container ?? null; } catch (e) { return null; } };
function info(s) {
  let ench = [], dur = null;
  try { ench = (s.getComponent("minecraft:enchantable")?.getEnchantments() ?? []).map((e) => [e.type.id ?? String(e.type), e.level]); } catch (e) { ench = []; }
  try { const d = s.getComponent("minecraft:durability"); if (d) dur = [d.maxDurability - d.damage, d.maxDurability]; } catch (e) { dur = null; }
  return { id: s.typeId, n: s.amount, name: s.nameTag ?? "", ench, dur };
}
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "smp:ec") return;
  let q; try { q = JSON.parse(ev.message); } catch (e) { return; }
  const base = { req: q.req, op: q.op };
  try {
    if (q.op === "ping") return reply({ ...base, ok: true });
    const t = online(q.target); if (!t) return reply({ ...base, ok: false, err: "offline" });
    const c = ender(t); if (!c) return reply({ ...base, ok: false, err: "noapi" });
    if (q.op === "get") {
      const items = [];
      for (let i = 0; i < c.size; i++) { const s = c.getItem(i); if (s) items.push({ slot: i, ...info(s) }); }
      return reply({ ...base, ok: true, size: c.size, items });
    }
    if (q.op === "clear") {
      let n = 0; for (let i = 0; i < c.size; i++) { if (c.getItem(i)) { c.setItem(i, undefined); n++; } }
      return reply({ ...base, ok: true, n });
    }
    if (q.op === "take") {
      const a = online(q.admin); if (!a) return reply({ ...base, ok: false, err: "admin offline" });
      const s = c.getItem(q.slot); if (!s || s.typeId !== q.id) return reply({ ...base, ok: false, err: "changed" });
      const want = q.n > 0 ? Math.min(q.n, s.amount) : s.amount;
      const give = s.clone(); give.amount = want;
      const left = a.getComponent("minecraft:inventory").container.addItem(give);
      const got = want - (left ? left.amount : 0);
      if (got < 1) return reply({ ...base, ok: false, err: "full" });
      if (got >= s.amount) c.setItem(q.slot, undefined); else { const rest = s.clone(); rest.amount = s.amount - got; c.setItem(q.slot, rest); }
      return reply({ ...base, ok: true, n: got, id: s.typeId });
    }
  } catch (e) { reply({ ...base, ok: false, err: String(e) }); }
});
