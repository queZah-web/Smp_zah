// The BUTTON BAR (last row of every chest page) in one tidy order, the same on every page:
//    < previous | Back | . | . | Refresh | Search | . | balance | next >
// Pages build their buttons wherever they like; just before a page is shown, tidyBar() moves the standard buttons (Back, page arrows, Refresh, Search,
// balance, page number) to their places in that row and gives them the game's arrow / anvil / sign icons.
// Only the position and the icon change: every button keeps its text and its click action, other buttons of the row are never touched,
// and nothing is moved when the row has no navigation buttons at all. It can never throw.
const COLS = 9;
export const ICON_ARROW = "textures/items/arrow", ICON_ANVIL = "textures/ui/shop/i3d_anvil", ICON_SIGN = "textures/items/sign";
const ORDER = ["back", "prev", "next", "refresh", "search", "status", "page"];
const WHERE = { prev: [0], back: [1], next: [8, 7, 6, 5], refresh: [4, 2, 3, 6, 5, 7], search: [5, 6, 2, 3], status: [7, 6, 3, 2], page: [3, 2, 6, 7] };
const ICON = { back: ICON_ARROW, prev: ICON_ARROW, next: ICON_ARROW, refresh: ICON_ANVIL, search: ICON_SIGN };

function roleOf(b) {
  try {
    const t = String(b[0]).slice(3).replace(/§./g, "").replace(/^[<>\s]+/, ""), icon = String(b[1] ?? "");
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

export function tidyBar(f) {
  try {
    const rows = f.rows ? f.rows : 9, base = (rows - 1) * COLS;
    const found = [];
    for (let k = 0; k < COLS; k++) {
      const b = f.buttons[base + k];
      if (!b) continue;
      const role = roleOf(b);
      if (role) found.push({ role, b, e: f.entries[base + k], from: k });
    }
    if (!found.some((x) => x.role === "back" || x.role === "prev" || x.role === "next" || x.role === "refresh")) return;   // not a navigation row
    for (const x of found) { f.buttons[base + x.from] = null; f.entries[base + x.from] = null; }
    const used = new Set();
    for (let k = 0; k < COLS; k++) if (f.buttons[base + k]) used.add(k);
    found.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
    for (const x of found) {
      let k = [...WHERE[x.role], x.from].find((c) => !used.has(c));
      if (k === undefined) for (let c = 0; c < COLS; c++) if (!used.has(c)) { k = c; break; }
      if (k === undefined) continue;
      used.add(k);
      f.buttons[base + k] = ICON[x.role] ? [x.b[0], ICON[x.role]] : x.b;
      f.entries[base + k] = x.e;
    }
  } catch (e) { /* leave the page as it is */ }
}
