// SMP Chat Guard - the swear-word filter (Arabic: Iraqi / Gulf / Levant / Egyptian, Franco-Arabic, English).
// check(text) -> null (clean) or { word } (the bad word that was found).
// How it beats the usual tricks: harakat / tatweel / hidden characters removed, letter forms unified (أإآ=ا, ة=ه, ى=ي, گ=ك, چ=ج ...),
// repeated letters collapsed (كسسسس = كس), numbers read as letters (f4ck, b1tch, 3ayr, 7mar), spaced letters joined (ك س / f u c k),
// symbols between letters removed for the long words (f.u.c.k).  Normal words that only CONTAIN a short bad word are NOT
// blocked (كسر, عكس, زبون, هناك, class, assassin ...) because short words must be a whole word (with Arabic prefixes / suffixes).

// ---------------------------------------------------------------- normalizing
const AR = { "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي", "گ": "ك", "ڪ": "ك", "ک": "ك", "چ": "ج", "ڤ": "ف", "پ": "ب", "ژ": "ز", "ی": "ي", "ھ": "ه", "ۀ": "ه" };
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e", "+": "t" };
const FRANCO = { "2": "a", "3": "a", "4": "a", "5": "kh", "6": "t", "7": "h", "8": "gh", "9": "q", "0": "o", "1": "i", "@": "a", "$": "s" };
const HIDDEN = /[ً-ٰٟـ​-‏‪-‮⁠-⁩﻿]/g;
const base = (t) => String(t ?? "").replace(/§./g, "").replace(HIDDEN, "").toLowerCase().replace(/[أإآٱةىؤئگڪکچڤپژیھۀ]/g, (c) => AR[c] ?? c);
const collapse = (s) => s.replace(/(.)\1+/g, "$1");
const latinWith = (s, map) => s.replace(/[0-9@$!|€+]/g, (c) => map[c] ?? c);
const tokens = (s) => s.split(/[^a-zء-ي]+/).filter(Boolean);

// ---------------------------------------------------------------- the word lists
// Arabic: P = prefixes that can stick to a word (و ف ب ل يا ال ...), S = endings (ك ه ي كم ج ...)
const P = "(?:و|ف|ب|ل|يا|وال|بال|فال|ال|لل|وب|وي)?";
const S = "(?:ك|كي|كو|كم|ه|ها|هم|هن|ي|ج|جي|ين|ات|يه|يك|مك|امك|ختك|اختك|خواتك|ابوك|ك[يو])?";
const AR_ROOTS = ["كس", "زب", "طيز", "عير", "نيك", "نيج", "خره", "خرا", "زق", "فرخ", "نغل", "عرص", "خول", "منيك", "كواد", "قواد", "منيوك", "منيوج"];
const AR_STEMS = [   // a word that STARTS with one of these is bad (with the prefixes above)
  "كسمك", "كسامك", "كسختك", "كساختك", "كسخت", "كسام", "كسعرض", "كسدين", "كسربك",
  "شرموط", "شرمط", "شراميط", "قحب", "كحب", "قحاب", "كحاب", "عاهر", "عواهر", "منيوك", "منيوج", "منايك", "مناييك", "نياك", "نياج", "نيوك", "نيوج", "متناك", "متنيك", "اتناك", "انتاك", "انيك", "انيج", "نيكني", "نيجني",
  "ديوث", "ديايث", "قوادين", "كوادين", "معرص", "لوطي", "مخنث", "مخانيث", "مفروخ", "خنيث", "طيزك", "طيزه", "عيوره", "شرمطه",
  "ابنالقحبه", "ابنالكحبه", "ابنالشرموطه", "ابنالمتناكه", "ابنالحرام", "ابنالزنا", "ولدالحرام", "ولدالقحبه", "ولدالكحبه",
];
const AR_PHRASES = [   // whole words one after the other (after normalizing)
  ["كس", "*"], ["يا", "كلب"], ["يا", "حمار"], ["يا", "حيوان"], ["يا", "زمال"], ["يا", "جحش"], ["يا", "خنزير"], ["يا", "حقير"], ["يا", "واطي"], ["يا", "سافل"], ["يا", "ساقط"], ["يا", "وسخ"], ["يا", "قذر"], ["يا", "كلبه"], ["يا", "بقره"], ["يا", "سرسري"],
  ["ابن", "الكلب"], ["ابن", "كلب"], ["بنت", "الكلب"], ["ابن", "الحمار"], ["كلب", "ابن", "كلب"], ["ابن", "حرام"], ["ابن", "الحرام"], ["ابن", "زنا"], ["ابن", "الزنا"], ["ولد", "الحرام"], ["ابن", "القحبه"], ["ابن", "الكحبه"], ["ابن", "الشرموطه"], ["ابن", "المتناكه"],
  ["دين", "امك"], ["دين", "ابوك"], ["دين", "اختك"], ["دين", "ربك"], ["عرض", "امك"], ["عرض", "اختك"], ["شرف", "امك"], ["شرف", "اختك"],
  ["عيري", "*"], ["زبي", "*"], ["طيز", "*"],
];
const CURSE_START = ["يلعن", "لعن", "الله يلعن", "انعل", "ينعل", "نعل", "يلعنك", "انعلك", "تبا", "يخرب"];
const CURSE_OBJ = /^(ا?بو|ابوك|ابوج|امك|امج|اخت|اختك|دين|دينك|دينج|رب|ربك|ربج|شرف|شرفك|والدي|والديك|والدينك|جد|جدك|عرض|عرضك|ميت|ميتين|اهل|اهلك|سلف|خلف|ام|ابو)/;

// Franco-Arabic (after the FRANCO digits + collapsing): exact words / stems
const FR_EXACT = new Set(["kos", "kus", "kuss", "koss", "ks", "zeb", "zib", "zebi", "zbi", "zobi", "zebak", "tiz", "tez", "teez", "tizak", "tezak", "ayr", "ayri", "ayrak", "ayry", "khara", "khra", "neek", "neeik",
  "kahba", "kehba", "khawal", "kwad", "gawad", "qawad", "manyak", "manyok", "mnyok", "metnak", "mtnak", "sharmota", "sharmoota", "sharmouta", "sharmoot", "sharmot", "shrmota", "shrmot", "arsa", "mitnak"]);
const FR_STEMS = ["kosom", "kusom", "kosum", "kusum", "ksom", "ksum", "kosomk", "kosokht", "kusokht", "kosekht", "kosamak", "kusamak", "kosomak", "anikak", "aneekak", "anekak", "aneek", "anik",
  "sharmo", "sharmu", "shrmo", "qahb", "gahb", "kahb", "kehb", "khawal", "manyo", "manyou", "manyuk", "metnak", "mitnak", "ibnelkalb", "ibnalkalb", "ibnelsharmota", "ibnelqahba", "yel3an", "yelaan", "yilaan"];
// English (after LEET): exact words (regex) + stems + phrases
const EN_RE = [
  /^(mother|mutha|motha)?f+[uv]*c?k+(ing|in|er|ers|ed|s|off|face|head|wit|hole|boy|tard)?$/, /^f+[uva]+[ck]+$/, /^f+a+c+k+(ing|er|ers|ed|s|off)?$/, /^(fck|fuk|fuq|phuck|phuk|fcuk|fking|fcking|fukin|fuking|fkn|fkin)$/, /^mf+$/, /^m+o*t*h*e*r*f+u*c*k*e*r*$/,
  /^b+i+a*t+c+h+(es|y|ass|ez|z)?$/, /^(biatch|bich|btch|bitchass)$/, /^(bull)?sh+i+t+(ty|s|head|face|hole|ter)?$/, /^(shite|sht)$/,
  /^(dumb|jack|smart|fat|lard|bad)?a+s+(s+)(es|hole|holes|wipe|hat|clown|face)?$/, /^a+r+s+e+(hole|holes)?$/,
  /^d+i+c+k+(head|heads|s|face|less)?$/, /^c+o+c+k+(sucker|suckers|s)?$/, /^p+u+s+y+$/, /^pussies$/, /^c+u+n+t+s*$/, /^t+w+a+t+s*$/, /^w+h+o+r+e+s*$/, /^s+l+u+t+s*$/, /^sluts?$/, /^b+a+s+t+a+r+d+s*$/, /^w+a+n+k+(er|ers|ing)?$/, /^p+r+i+c+k+s*$/, /^d+o+u+c+h+e+(bag|bags)?$/,
  /^r+e+t+a+r+d+(ed|s)?$/, /^n+i+g+(a|er|ers|as|az|ah|uh)$/, /^n+i+g+g+(a|er|ers|as|az|ah)?$/, /^nigg/, /^f+a+g+(s|got|gots|gy)?$/, /^porn(o|hub|s)?$/, /^(kys|stfu|gtfo)$/, /^(cum|cumshot|blowjob|handjob|dildo|horny)$/, /^(rape|rapist|raped)$/,
];
const EN_SQUASH = ["fuck", "motherf", "bitch", "whore", "cunt", "nigger", "nigga", "faggot", "pussy", "cocksucker", "dickhead", "bastard", "asshole", "shithead", "retard", "kosomak", "kosomk", "ksomak", "kosokht", "sharmot", "manyok", "khawal", "aneekak"];
const EN_PHRASES = [["son", "of", "a", "bitch"], ["kill", "yourself"], ["kill", "urself"], ["kill", "your", "self"], ["ibn", "el", "kalb"], ["ibn", "al", "kalb"], ["ya", "kalb"], ["ya", "hmar"], ["ya", "haywan"], ["ya", "zmal"], ["ya", "khanzir"]];
const AR_SQUASH = ["شرموط", "قحبه", "كحبه", "منيوك", "منيوج", "متناك", "ديوث", "كسختك", "كساختك", "انيكك", "انيجك", "كسامك"];

// every Latin word list is used in the same form as the text: numbers read as letters, repeated letters collapsed
const FR_EX = new Set([...FR_EXACT].map((w) => collapse(latinWith(w, FRANCO))));
const FR_ST = FR_STEMS.map((w) => collapse(latinWith(w, FRANCO)));
const EN_PH = EN_PHRASES.map((ph) => ph.map((w) => (w === "*" ? w : collapse(latinWith(w, LEET)))));
const FR_PH = EN_PHRASES.map((ph) => ph.map((w) => (w === "*" ? w : collapse(latinWith(w, FRANCO)))));

// ---------------------------------------------------------------- matching
const reRoot = new RegExp("^" + P + "(" + AR_ROOTS.join("|") + ")" + S + "$");
const reStem = new RegExp("^" + P + "(" + AR_STEMS.join("|") + ")");
const isAr = (t) => /[ء-ي]/.test(t);
function phraseHit(list, toks) {
  for (const ph of list) {
    outer: for (let i = 0; i + ph.length <= toks.length; i++) {
      for (let j = 0; j < ph.length; j++) { if (ph[j] !== "*" && toks[i + j] !== ph[j]) continue outer; }
      if (ph[ph.length - 1] === "*" && i + ph.length > toks.length) continue;
      return ph.filter((x) => x !== "*").join(" ");
    }
  }
  return null;
}
/** joins runs of single letters ("ك س ا م ك" -> "كسامك", "f u c k" -> "fuck") */
function joinSingles(toks) {
  const out = []; let run = "";
  for (const t of toks) { if (t.length === 1) run += t; else { if (run.length >= 2) out.push(run); else if (run) out.push(run); run = ""; out.push(t); } }
  if (run) out.push(run);
  return out;
}
function checkTokens(toks) {
  for (const t of toks) {
    if (isAr(t)) {
      const c = collapse(t);
      if (reRoot.test(t) || reRoot.test(c)) return t;
      if (reStem.test(t) || reStem.test(c)) return t;
    }
  }
  const p = phraseHit(AR_PHRASES, toks); if (p) return p;
  for (let i = 0; i < toks.length; i++) {                                            // curses: يلعن / انعل + ابوك / دينك / ربك ...
    const one = toks[i], two = i + 1 < toks.length ? one + " " + toks[i + 1] : "";
    const start = CURSE_START.includes(one) ? 1 : CURSE_START.includes(two) ? 2 : 0;
    if (start && i + start < toks.length && CURSE_OBJ.test(toks[i + start])) return (start === 2 ? two : one) + " " + toks[i + start];
    if (/^(يلعن|انعل|ينعل)(ابو|ام|دين|رب|شرف|اخت|والدي)/.test(one)) return one;
  }
  return null;
}
function checkLatin(toks, map) {
  const rawT = toks.map((t) => latinWith(t, map)).filter((t) => /[a-z]/.test(t)), ts = rawT.map(collapse);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], r = rawT[i];
    if (map === FRANCO) { if (FR_EX.has(t)) return t; for (const s of FR_ST) if (t.startsWith(s)) return t; }
    else for (const re of EN_RE) if (re.test(t) || re.test(r)) return r;
  }
  const p = phraseHit(map === FRANCO ? FR_PH : EN_PH, ts); if (p) return p;
  return null;
}
/** null = clean, { word } = blocked */
export function check(text) {
  const b = base(text);
  if (!b.trim()) return null;
  // Arabic
  const arToks = joinSingles(tokens(b));
  let w = checkTokens(arToks) ?? checkTokens(arToks.map(collapse));
  if (w) return { word: w };
  // Latin: English (leet) and Franco-Arabic (numbers as letters)
  const latToks = (s) => joinSingles(s.split(/[^a-z0-9@$!|€+]+/).filter(Boolean));
  const raw = latToks(b);
  w = checkLatin(raw, LEET) ?? checkLatin(raw, FRANCO);
  if (w) return { word: w };
  // symbols inside a word removed (f.u.c.k, s-h-a-r-m-o-t-a, ش_ر_م_و_ط): the cleaned word must START with the bad word
  for (const wd of b.split(/\s+/).filter(Boolean)) {
    const l1 = collapse(latinWith(wd, LEET).replace(/[^a-z]/g, "")), l2 = collapse(latinWith(wd, FRANCO).replace(/[^a-z]/g, "")), a = collapse(wd.replace(/[^\u0621-\u064A]/g, ""));
    for (const s of EN_SQUASH) { const c = collapse(s); if ((l1 && l1.startsWith(c)) || (l2 && l2.startsWith(c))) return { word: s }; }
    for (const s of AR_SQUASH) if (a && a.startsWith(collapse(s))) return { word: s };
    if (a && a !== wd && checkTokens([a])) return { word: a };
  }
  return null;
}
