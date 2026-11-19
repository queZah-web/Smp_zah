// Arabic text for the menus.  Minecraft does not join Arabic letters or write right-to-left by itself, so every text with Arabic
// letters goes through  arText():
//   1. long lines are cut into lines of at most MAX visible characters (BEFORE shaping, so the words stay in the right order),
//   2. the letters are joined with the shaper of the "Arabic Language Fix" pack (arabic_shaper.js, drawn by the Arabic font pages in RP/font),
//   3. the text is put in visual order (right-to-left); numbers and English words keep their own order,
//   4. colour codes (§a, §l, §r ...) stay with the words they belong to.
// Text without Arabic letters is returned unchanged.
import { processArabicScriptText, isArabicScript } from "./arabic_shaper.js";

export const MAX = 28;
const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LAT = /[A-Za-z0-9\u00C0-\u024F]/;
const MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "{": "}", "}": "{" };

/** one logical line -> array of { ch, st } (st = the colour + bold/italic codes active for that character, "" = none) + whether the line has codes */
function parse(line) {
  const out = []; let color = "", fmt = "", codes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "§" && i + 1 < line.length) {
      const c = line[i + 1].toLowerCase(); i++; codes = true;
      if (c === "r") { color = ""; fmt = ""; }
      else if (/[klmno]/.test(c)) { if (!fmt.includes("§" + c)) fmt += "§" + c; }
      else { color = "§" + c; fmt = ""; }                         // a colour code also ends bold / italic
    } else out.push({ ch: line[i], st: color + fmt });
  }
  return { chars: out, codes };
}

/** cut into pieces of at most `max` visible characters, at spaces */
function wrap(chars, max) {
  if (chars.length <= max) return [chars];
  const lines = []; let cur = [];
  const words = []; let w = [];
  for (const c of chars) { if (c.ch === " ") { words.push(w); w = []; } else w.push(c); }
  words.push(w);
  for (const word of words) {
    if (cur.length && cur.length + 1 + word.length > max) { lines.push(cur); cur = []; }
    if (cur.length) cur.push({ ch: " ", st: word[0]?.st ?? "" });
    cur = cur.concat(word);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function visual(chars, codes) {
  // strong classes
  const cls = chars.map((c) => (AR.test(c.ch) ? "A" : LAT.test(c.ch) ? "L" : "N"));
  for (let i = 0; i < cls.length; i++) {                           // "$5", "+3", "#2" and "50%" stay together as numbers
    if (cls[i] !== "N") continue;
    if (/[$€£¥+\-#@]/.test(chars[i].ch) && cls[i + 1] === "L") cls[i] = "L";
    else if (chars[i].ch === "%" && cls[i - 1] === "L") cls[i] = "L";
  }
  const first = cls.find((x) => x !== "N");
  if (!first) return chars.map((c) => c.ch).join("");
  const base = first;                                              // A = right-to-left line, L = left-to-right line
  for (let i = 0; i < cls.length; i++) {                           // neutral characters: between two same classes they join them, else the line direction
    if (cls[i] !== "N") continue;
    let j = i; while (j < cls.length && cls[j] === "N") j++;
    const prev = i > 0 ? cls[i - 1] : null, next = j < cls.length ? cls[j] : null;
    const r = prev && next && prev === next ? prev : base;
    for (let k = i; k < j; k++) cls[k] = r;
    i = j - 1;
  }
  const runs = [];                                                 // consecutive characters with the same direction (a colour change stays INSIDE its run)
  for (let i = 0; i < chars.length; i++) {
    let run = runs[runs.length - 1];
    if (!run || run.cls !== cls[i]) { run = { cls: cls[i], pieces: [] }; runs.push(run); }
    const last = run.pieces[run.pieces.length - 1];
    if (last && last.st === chars[i].st) last.text += chars[i].ch;
    else run.pieces.push({ st: chars[i].st, text: chars[i].ch });
  }
  const pre = (st) => (codes ? "§r" + st : "");
  const draw = (run) => {
    if (run.cls !== "A") return run.pieces.map((p) => pre(p.st) + p.text).join("");           // English words and numbers keep their order
    return run.pieces.slice().reverse().map((p) => {                                          // Arabic: last piece first, letters joined and reversed
      const shaped = processArabicScriptText(p.text, false);
      return pre(p.st) + [...shaped].reverse().map((ch) => MIRROR[ch] ?? ch).join("");
    }).join("");
  };
  if (base === "A") runs.reverse();
  return runs.map(draw).join("");
}

/** the text of one line (or several lines separated by \n) ready to be shown */
export function arText(text, max = MAX) {
  if (typeof text !== "string" || !isArabicScript(text)) return text;
  try {
    return text.split("\n").map((line) => {
      if (!isArabicScript(line)) return line;
      const { chars, codes } = parse(line);
      return wrap(chars, max).map((c) => visual(c, codes)).join("\n");
    }).join("\n");
  } catch (e) { return text; }
}
