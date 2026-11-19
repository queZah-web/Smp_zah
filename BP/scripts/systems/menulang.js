// Arabic for the /menu pages (everything the SMP menu opens except /shop and /opr, which have their own files).
// Same method as oprlang.js / shoplang.js: the finished page / message / form is translated when it is shown, only for players whose
// language is Arabic. Item names are never translated. Lines that are already Arabic (the dashboard uses i18n.js) are left alone.
import { getLang } from "../smp/lang.js";
import { arText } from "../smp/arabic.js";
import { PART, EXACT } from "./menudict.js";
import { ModalFormData } from "@minecraft/server-ui";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYS = Object.keys(PART).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
let RE = null;
try { RE = new RegExp(KEYS.map(esc).join("|"), "g"); } catch (e) { console.warn("[menulang] dictionary: " + e); }
const LET = /[A-Za-z]/;
const HAS_AR = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
// pieces that cannot be a dictionary key because a number or a plural "s" is part of them (applied after the dictionary)
const RULES = [
  [/(\d+) players?\b/g, "$1 لاعب"], [/(\d+) homes?\b/g, "$1 منزل"], [/(\d+) warps?\b/g, "$1 نقطة انتقال"], [/(\d+) members?\b/g, "$1 عضو"],
  [/(\d+) seconds?\b/g, "$1 ثانية"], [/(\d+) minutes?\b/g, "$1 دقيقة"], [/(\d+) hours?\b/g, "$1 ساعة"], [/(\d+) days?\b/g, "$1 يوم"],
  [/(\$[\d,.]+[kKmMbB]?) now\b/g, "$1 الآن"],
  [/(?<![\d.])(\d+)d\b/g, "$1ي"], [/(?<![\d.])(\d+)h\b/g, "$1س"], [/(?<![\d.])(\d+)m\b/g, "$1د"], [/(?<![\d.])(\d+)s\b/g, "$1ث"],
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
    const plural = line[nx] === "s" && !letterAt(line, nx + 1);
    if ((LET.test(key[0]) && letterAt(line, off - 1)) || (!endCode && !plural && LET.test(key[key.length - 1]) && letterAt(line, nx))) {
      RE.lastIndex = off + 1; continue;                                           // inside another word: leave it
    }
    let ar = PART[key], used = key.length;
    if (/§.$/.test(key) && ar.endsWith(key.slice(-2))) { ar = ar.slice(0, -2); used -= 2; }
    out += line.slice(pos, off) + ar; pos = off + used; RE.lastIndex = pos;
  }
  return out + line.slice(pos);
}
function line1(line) {
  const plain = line.replace(/§./g, "").trim();
  if (Object.prototype.hasOwnProperty.call(EXACT, plain)) return (line.match(/^(§.)*/)?.[0] ?? "") + EXACT[plain];
  let s = part(line);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.replace(/([\u0600-\u06FF])s(?![A-Za-z])/g, "$1");
}
const isAr = (p) => { try { return getLang(p) === "ar"; } catch (e) { return false; } };

/** translate a text (several lines allowed) for this player; `max` = visible characters per line before it is cut */
export function menuText(player, text, max = 28) {
  if (typeof text !== "string" || !isAr(player)) return text;
  try {
    return text.split("\n").map((ln) => {
      if (HAS_AR.test(ln)) return ln;                                              // already Arabic (finished by i18n.js)
      const tr = line1(ln);
      return tr !== ln && HAS_AR.test(tr) ? arText(tr, max) : tr;
    }).join("\n");
  } catch (e) { return text; }
}
/** a button text: the first 3 characters (zone + stack count) stay as they are */
export function menuButton(player, text) {
  if (typeof text !== "string" || !isAr(player)) return text;
  return text.slice(0, 3) + menuText(player, text.slice(3), 28);
}
/** a chat message */
export function menuMsg(player, msg) { return menuText(player, msg, 46); }
/** an action-bar text */
export function menuBar(player, text) { return menuText(player, text, 80); }

/** ModalFormData that is translated when it is shown (use  new MenuForm()  instead of  new ModalFormData()) */
export class MenuForm {
  constructor() { this.calls = []; }
  title(...a) { this.calls.push(["title", a]); return this; }
  textField(...a) { this.calls.push(["textField", a]); return this; }
  dropdown(...a) { this.calls.push(["dropdown", a]); return this; }
  toggle(...a) { this.calls.push(["toggle", a]); return this; }
  slider(...a) { this.calls.push(["slider", a]); return this; }
  submitButton(...a) { this.calls.push(["submitButton", a]); return this; }
  build(player) {
    const f = new ModalFormData(), ar = isAr(player);
    const tr = (v) => (typeof v === "string" ? menuText(player, v, 40) : Array.isArray(v) ? v.map(tr) : v);
    for (const [m, a] of this.calls) f[m](...(ar ? a.map(tr) : a));
    return f;
  }
  show(player) { return this.build(player).show(player); }
}
