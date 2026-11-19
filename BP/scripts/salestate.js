// Tiny bridge between the scoreboard (hud.js) and the sale popup (salefx.js) - no imports, so there is no import cycle.
export const SALE_FIELD = 30;                    // width of the sale field in the side-panel text (must match RP/ui/smp_hud.json: '%.181s')
export const saleView = {
  field: (p) => " ".repeat(SALE_FIELD),          // the text of the popup, already padded to SALE_FIELD characters (blank = nothing shown)
  bar: (p) => "",                                // the same popup for the action-bar scoreboard style
  marker: (p) => "",                             // "QQS<step>Q" while the popup fades out (the UI picks a more transparent copy of the text), else ""
};
