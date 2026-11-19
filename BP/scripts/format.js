export const money = (n) => "$" + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const num = (n) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 2456789012 -> "2.45B", 7800 -> "7.8k", 1192 -> "1.19k" (HUD style) */
export function short(n, d = 2) {
  n = Math.floor(n);
  for (const [s, v] of [["T", 1e12], ["B", 1e9], ["M", 1e6], ["k", 1e3]]) {
    if (n >= v) return (n / v).toFixed(d).replace(/\.?0+$/, "") + s;
  }
  return String(n);
}

/** seconds -> "42s" | "14m 20s" | "1h 25m" | "12d 19h" */
export function playtime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function countdown(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s %= 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
