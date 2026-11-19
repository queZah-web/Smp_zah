// Arabic for the Operator menu (/opr) and everything inside it.
// Same method as the rest of the Arabic menu: Arabic text goes through arText() (letters joined + right-to-left) and the language is the
// one the player chose in /menu > Language. The English code of the pages is NOT touched: the finished page / message / form is
// translated at the moment it is shown (pieces of text that are in oprdict.js become Arabic, anything else stays English).
// English players: nothing changes at all.
import { getLang } from "../smp/lang.js";
import { arText } from "../smp/arabic.js";
import { PART, EXACT } from "./oprdict.js";
import { ModalFormData } from "@minecraft/server-ui";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYS = Object.keys(PART).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
let RE = null;
try { RE = new RegExp(KEYS.map(esc).join("|"), "g"); } catch (e) { console.warn("[oprlang] dictionary: " + e); }
const LET = /[A-Za-z]/;
const RULES = [
  [/(\d+) players? (?:is|are) online\. How\?/g, "$1 لاعب متصل. كيف؟"],
];
// a letter that belongs to a colour code (§a) is not a letter of a word
const letterAt = (str, k) => k >= 0 && k < str.length && LET.test(str[k]) && str[k - 1] !== "§";

function part(line) {
  if (!RE) return line;
  RE.lastIndex = 0;
  let out = "", pos = 0, m;
  while ((m = RE.exec(line))) {
    const key = m[0], off = m.index;
    const endCode = /§.$/.test(key), nx = off + key.length;
    const plural = line[nx] === "s" && !letterAt(line, nx + 1);                   // "report" + "s"
    if ((LET.test(key[0]) && letterAt(line, off - 1)) || (!endCode && !plural && LET.test(key[key.length - 1]) && letterAt(line, nx))) {
      RE.lastIndex = off + 1; continue;                                           // inside another word: leave it
    }
    let ar = PART[key], used = key.length;
    // a text that ends with a colour code (the colour of the value that follows): give the code back so the next piece can use it
    if (/§.$/.test(key) && ar.endsWith(key.slice(-2))) { ar = ar.slice(0, -2); used -= 2; }
    out += line.slice(pos, off) + ar; pos = off + used; RE.lastIndex = pos;
  }
  return out + line.slice(pos);
}
function line1(line) {
  const plain = line.replace(/§./g, "").trim();
  if (Object.prototype.hasOwnProperty.call(EXACT, plain)) return (line.match(/^(§.)*/)?.[0] ?? "") + EXACT[plain];
  let s = line;
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = part(s);
  return s.replace(/([\u0600-\u06FF])s(?![A-Za-z])/g, "$1");                      // "report" + "s" -> only the Arabic word
}
const isAr = (p) => { try { return getLang(p) === "ar"; } catch (e) { return false; } };

/** translate a text (several lines allowed) for this player; `max` = visible characters per line before it is cut */
export function oprText(player, text, max = 28) {
  if (typeof text !== "string" || !isAr(player)) return text;
  try { return arText(text.split("\n").map(line1).join("\n"), max); } catch (e) { return text; }
}
/** a button text: the first 3 characters (zone + stack count) stay as they are */
export function oprButton(player, text) {
  if (typeof text !== "string" || !isAr(player)) return text;
  return text.slice(0, 3) + oprText(player, text.slice(3), 28);
}
/** a chat message */
export function oprMsg(player, msg) { return oprText(player, msg, 46); }

/** ModalFormData that is translated when it is shown (use  new OprForm()  instead of  new ModalFormData()) */
export class OprForm {
  constructor() { this.calls = []; }
  title(...a) { this.calls.push(["title", a]); return this; }
  textField(...a) { this.calls.push(["textField", a]); return this; }
  dropdown(...a) { this.calls.push(["dropdown", a]); return this; }
  toggle(...a) { this.calls.push(["toggle", a]); return this; }
  slider(...a) { this.calls.push(["slider", a]); return this; }
  submitButton(...a) { this.calls.push(["submitButton", a]); return this; }
  build(player) {
    const f = new ModalFormData(), ar = isAr(player);
    const tr = (v) => (typeof v === "string" ? oprText(player, v, 40) : Array.isArray(v) ? v.map(tr) : v);
    for (const [m, a] of this.calls) f[m](...(ar ? a.map(tr) : a));
    return f;
  }
  show(player) { return this.build(player).show(player); }
}
