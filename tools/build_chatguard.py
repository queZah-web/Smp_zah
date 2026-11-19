#!/usr/bin/env python3
"""Builds the SMP Chat Guard pack for ONE game version:  python3 tools/build_chatguard.py 1.26.60
The Beta API version must match the game exactly (Settings > bottom of the screen shows the game version)."""
import json, os, sys, zipfile
MAP = [("1.21.100", "2.2.0-beta"), ("1.21.110", "2.3.0-beta"), ("1.21.120", "2.4.0-beta"), ("1.21.130", "2.5.0-beta"), ("1.26.0", "2.6.0-beta"), ("1.26.10", "2.7.0-beta"),
       ("1.26.20", "2.8.0-beta"), ("1.26.30", "2.9.0-beta"), ("1.26.40", "2.10.0-beta"), ("1.26.50", "2.11.0-beta"), ("1.26.60", "2.12.0-beta")]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def key(v): return tuple(int(x) for x in v.split("."))
def beta_for(game):
    g = key(game if game.startswith("1.") else "1." + game)
    best = None
    for v, b in MAP:
        if key(v)[:3] <= g and (g[1] == key(v)[1]): best = b
    return best
if __name__ == "__main__":
    game = sys.argv[1]; beta = beta_for(game)
    if not beta: sys.exit("unknown game version " + game)
    src = os.path.join(ROOT, "chatguard"); m = json.load(open(os.path.join(src, "manifest.template.json")))
    m["dependencies"][0]["version"] = beta
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "SMP_ChatGuard_" + game + ".mcpack")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("SMP_ChatGuard/manifest.json", json.dumps(m, indent=2))
        for f in ["pack_icon.png", "scripts/main.js", "scripts/filter.js"]: z.write(os.path.join(src, f), "SMP_ChatGuard/" + f)
    print(out, "->", beta)
