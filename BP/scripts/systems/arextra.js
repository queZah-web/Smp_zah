// Small Arabic helper for a few single messages (duel immunity banner, The End event, first Owner message).
// Same method as the rest of the pack: Arabic text goes through arText() (letters joined + right-to-left), and ONLY for players whose
// language is Arabic (/menu > Language). English players get the original English text, untouched.
import { getLang } from "../smp/lang.js";
import { arText } from "../smp/arabic.js";

export const isAr = (p) => { try { return getLang(p) === "ar"; } catch (e) { return false; } };

/** `en` for English players, the shaped Arabic `ar` for Arabic players (`max` = visible characters per line) */
export function pick(p, en, ar, max = 46) {
  if (!isAr(p)) return en;
  try { return ar.split("\n").map((l) => arText(l, max)).join("\n"); } catch (e) { return en; }
}

/** a number + unit in Arabic with the right plural: arUnit(3, "دقيقة", "دقيقتان", "دقائق") -> "3 دقائق" */
function unit(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  return n + " " + (n >= 3 && n <= 10 ? few : many);
}
/** same idea as "nice(ms)" in endgate.js:  "30 seconds" / "5 minutes" / "2 hours"  ->  Arabic */
export function niceAr(ms) {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return unit(Math.round(ms / 1000), "ثانية واحدة", "ثانيتين", "ثوانٍ", "ثانية");
  if (m >= 60 && m % 60 === 0) return unit(m / 60, "ساعة واحدة", "ساعتين", "ساعات", "ساعة");
  return unit(m, "دقيقة واحدة", "دقيقتين", "دقائق", "دقيقة");
}
/** "2 free hours" / "1 free hour 30 min" / "45 free minutes"  ->  Arabic (m = minutes) */
export function freeAr(m) {
  const mins = (n) => unit(n, "دقيقة مجانية", "دقيقتان مجانيتان", "دقائق مجانية", "دقيقة مجانية");
  if (m < 60) return mins(m);
  const h = Math.floor(m / 60), r = m % 60;
  const hs = unit(h, "ساعة مجانية", "ساعتان مجانيتان", "ساعات مجانية", "ساعة مجانية");
  return hs + (r ? " و" + unit(r, "دقيقة", "دقيقتان", "دقائق", "دقيقة") : "");
}
