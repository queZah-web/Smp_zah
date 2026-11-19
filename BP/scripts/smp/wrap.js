// Long hover texts ("information" of a slot) used to run past the edge of the screen. This breaks every line that is longer than MAX visible
// characters at a space and keeps the colours / bold of the line on the continuation (so it looks the same, only narrower).
// Only used when a page is shown (ui.js / main.js open): the page data and the click logic are never touched.
export const MAX_LINE = 30;
const vis = (s) => s.replace(/§./g, "").length;

/** codes that are active at the end of `s` (colour + bold/italic...), as a string starting with §r */
function activeCodes(s) {
  let color = "", fmt = "";
  const re = /§(.)/g; let m;
  while ((m = re.exec(s))) {
    const c = m[1].toLowerCase();
    if (c === "r") { color = ""; fmt = ""; }
    else if (/[0-9a-gjmnpqstuv]/.test(c) && !/[klmno]/.test(c)) { color = "§" + c; fmt = ""; }
    else if (/[klmno]/.test(c) && !fmt.includes("§" + c)) fmt += "§" + c;
  }
  return "§r" + color + fmt;
}

function wrapLine(line, max) {
  if (vis(line) <= max) return [line];
  const out = [], words = line.split(" ");
  let cur = "", prefix = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (cur && vis(test) > max) {
      out.push(cur);
      prefix = activeCodes(out.join(" "));
      cur = prefix + w;
    } else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

/** text of one button = 3 character header + lines separated by \n */
export function wrapTip(text, max = MAX_LINE) {
  try {
    const s = String(text);
    if (s.length <= max) return s;
    const head = s.slice(0, 3), body = s.slice(3);
    const lines = body.split("\n"), out = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = wrapLine(lines[i], max);
      if (parts.length > 1) {
        // colours must continue from the start of THIS line, not from the whole text: compute them again per line
        const first = parts[0], rest = [];
        let acc = first;
        for (let k = 1; k < parts.length; k++) {
          const p = parts[k], body2 = p.replace(/^§r(§[0-9a-gjmnpqstuv])?(§[klmno])*/, "");
          rest.push(activeCodes(acc) + body2); acc += " " + body2;
        }
        out.push(first, ...rest);
      } else out.push(parts[0]);
    }
    return head + out.join("\n");
  } catch (e) { return String(text); }
}
