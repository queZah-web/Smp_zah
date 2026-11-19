// PAGE POLISH - runs just before every chest page is shown (/menu, /shop, /opr and everything inside them).
// Only positions, icons and the page height change: every button keeps its text and its click action. It can never throw.
//
// 1. THE BUTTON BAR (last row) - the same on every page:
//      [ Back ] [ ◀ ] [ Page ] [ ▶ ] [ Refresh ] [ Search ] [ Balance ] [ other ] [ other ]
//    Back = red arrow, page arrows = green arrows, Refresh = the refresh icon, Search = the magnifier.
//    The other buttons of the row (Sell Items, Edit, Tip, Settings ...) go to the right end, in their old order.
// 2. ICONS that fit: time buttons get a clock, "claim" a gift, "edit price" a book & quill, "remove" a barrier ...
// 3. PAGE HEIGHT: a tall (9-row) page that is mostly empty becomes a short chest (5 / 6 / 7 rows) - empty rows are dropped,
//    one empty row stays between groups.  A page can opt out with  f.noCompact = true.
const COLS = 9;
const NAVI = { back: "textures/ui/shop/nav_back", prev: "textures/ui/shop/nav_prev", next: "textures/ui/shop/nav_next", refresh: "textures/ui/shop/key_refresh", search: "textures/ui/shop/key_search" };
export const ICON_ARROW = NAVI.back, ICON_ANVIL = NAVI.refresh, ICON_SIGN = NAVI.search;
const SLOT = { back: 0, prev: 1, page: 2, next: 3, refresh: 4, search: 5, status: 6 };
const EXTRA = [8, 7];                                          // where the other bar buttons go first

const plain = (b) => String(b?.[0] ?? "").slice(3).replace(/§./g, "").replace(/^[<>\s]+/, "");
function roleOf(b) {
  try {
    const t = plain(b), icon = String(b[1] ?? "");
    if (/^Back\b/.test(t) || icon.endsWith("nav_back")) return "back";
    if (/^Previous page/.test(t) || icon.endsWith("nav_prev")) return "prev";
    if (/^Next page/.test(t) || icon.endsWith("nav_next")) return "next";
    if (/^Refresh\b/.test(t) || icon.endsWith("key_refresh")) return "refresh";
    if (/^Search\b/.test(t) || /^Type the start/.test(t)) return "search";
    if (/^Your Balance/.test(t)) return "status";
    if (/^Page \d+\/\d+/.test(t)) return "page";
  } catch (e) { /* not a standard button */ }
  return null;
}

function tidyRow(f) {
  const rows = f.rows ? f.rows : 9, base = (rows - 1) * COLS;
  const all = [];
  for (let k = 0; k < COLS; k++) { const b = f.buttons[base + k]; if (b && String(b[0]).length > 3) all.push({ role: roleOf(b), b, e: f.entries[base + k], from: k }); }
  if (!all.some((x) => x.role === "back" || x.role === "prev" || x.role === "next" || x.role === "refresh")) return;   // not a navigation row
  for (let k = 0; k < COLS; k++) { f.buttons[base + k] = null; f.entries[base + k] = null; }
  const ar0 = f.arDone ? new Set([...f.arDone].filter((i) => i >= base && i < base + COLS).map((i) => i - base)) : null;   // shop: texts that are already Arabic
  if (ar0) for (const k of ar0) f.arDone.delete(base + k);
  const used = new Set(), put = (k, x) => { used.add(k); f.buttons[base + k] = NAVI[x.role] ? [x.b[0], NAVI[x.role]] : x.b; f.entries[base + k] = x.e; if (ar0 && ar0.has(x.from)) f.arDone.add(base + k); };
  const std = all.filter((x) => x.role), extra = all.filter((x) => !x.role);
  for (const x of std) if (!used.has(SLOT[x.role])) put(SLOT[x.role], x); else extra.push(x);
  const free = [...EXTRA, ...[8, 7, 6, 5, 3, 2, 1, 0]].filter((k, i, a) => a.indexOf(k) === i);
  for (const x of extra.sort((a, b) => b.from - a.from)) { const k = free.find((c) => !used.has(c)); if (k !== undefined) put(k, x); }
}

// ---------------------------------------------------------------- icons that fit the button
const I = {
  clock: "textures/items/clock_item", gift: "textures/ui/shop/ic_gift", quill: "textures/items/book_writable", barrier: "textures/blocks/barrier",
  bars: "textures/blocks/iron_bars", spawner: "textures/ui/shop/ic_spawner", shards: "textures/ui/shop/hud_shards", trophy: "textures/ui/shop/ic_trophy",
  book: "textures/items/book_written", anvil: "textures/ui/shop/i3d_anvil", shulker: "textures/blocks/shulker_top_purple", tag: "textures/items/name_tag", back: NAVI.back,
  bucket: "textures/items/bucket_empty", map: "textures/items/map_filled", eye: "textures/items/ender_eye",
};
const RULES = [
  [/ic_confirm|ic_info|nav_page/, /^\+?\s*\d+\s*(minutes?|mins?|hours?|h|days?)\b/i, I.clock],
  [/ic_info|nav_page|ic_confirm/, /^Buy time\b/i, I.clock],
  [/ic_confirm/, /^Claim\b/i, I.gift],
  [/ic_confirm/, /^Create Clan\b/i, I.tag],
  [/hud_money/, /^(Edit (this category|prices?|price)|Set prices?)\b/i, I.quill],
  [/ic_cancel/, /^(Remove the area|Blocked from Creative)\b/i, I.barrier],
  [/ic_cancel/, /^Taking is locked\b/i, I.bars],
  [/ic_cancel/, /^Back to the original\b/i, I.back],
  [/ic_cancel/, /^Clear box\b/i, I.bucket],
  [/nav_page/, /^Table Passes\b/i, I.anvil],
  [/nav_page/, /^Spawners/i, I.spawner],
  [/nav_page/, /^Shard shop\b/i, I.shards],
  [/nav_page/, /^Event rules\b/i, I.book],
  [/nav_page/, /^Manage boards\b/i, I.trophy],
  [/nav_page/, /Shulker Boxes\b/i, I.shulker],
  [/ic_help/, /^No duel fight/i, I.book],
  [/paper|nav_page/, /^Good to know\b/i, "textures/ui/shop/ic_help"],
  [/ic_cancel/, /^Suspicious\b/i, "textures/items/spyglass"],
];
function fixIcons(f) {
  for (let i = 0; i < f.buttons.length; i++) {
    const b = f.buttons[i]; if (!b || !b[1]) continue;
    const t = plain(b).split("\n")[0];
    for (const [ic, re, to] of RULES) if (ic.test(b[1]) && re.test(t)) { f.buttons[i] = [b[0], to]; break; }
  }
}

// ---------------------------------------------------------------- page height
const HEIGHTS = [5, 6, 7, 9];
function compact(f) {
  const rows = f.rows ? f.rows : 9;
  if (rows !== 9 || f.noCompact || /sell/i.test(String(f.title ?? ""))) return;
  const has = (r) => { for (let c = 0; c < COLS; c++) { const b = f.buttons[r * COLS + c]; if (b && String(b[0]).length > 3) return true; } return false; };
  let content = [];                                             // content rows, with ONE empty row kept between groups
  let gap = false;
  for (let r = 0; r < rows - 1; r++) { if (has(r)) { if (gap && content.length) content.push(-1); content.push(r); gap = false; } else gap = true; }
  if (!content.length) return;
  let need = content.length + 1, target = HEIGHTS.find((h) => h >= need);
  if (!target || target >= rows) { content = content.filter((r) => r >= 0); need = content.length + 1; target = HEIGHTS.find((h) => h >= need); }   // too tall: without the empty rows between groups
  if (!target || target >= rows) return;
  let extra = target - need, top = Math.floor(extra / 2);
  if (content.length + 1 + extra > target) return;
  const B = new Array(f.buttons.length).fill(null), E = new Array(f.entries.length).fill(null);
  const copy = (from, to) => { for (let c = 0; c < COLS; c++) { B[to * COLS + c] = f.buttons[from * COLS + c]; E[to * COLS + c] = f.entries[from * COLS + c]; } };
  let r2 = top;
  for (const r of content) { if (r >= 0) copy(r, r2); r2++; }
  copy(rows - 1, target - 1);                                    // the button bar stays the last row
  if (f.arDone) { const map = new Map(); let r3 = top; for (const r of content) { if (r >= 0) for (let c = 0; c < COLS; c++) map.set(r * COLS + c, r3 * COLS + c); r3++; } for (let c = 0; c < COLS; c++) map.set((rows - 1) * COLS + c, (target - 1) * COLS + c); f.arDone = new Set([...f.arDone].map((i) => map.get(i)).filter((i) => i !== undefined)); }
  f.buttons = B; f.entries = E; f.rows = target;
}

export function tidyBar(f) {
  try { compact(f); } catch (e) { /* ignore */ }
  try { tidyRow(f); } catch (e) { /* ignore */ }
  try { fixIcons(f); } catch (e) { /* ignore */ }
}
