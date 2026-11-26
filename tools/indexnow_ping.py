"""Submit floridianpolicypros.com URLs to IndexNow.

Usage: indexnow_ping.py [BASE_SHA]   (changed pages since BASE_SHA; all pages if no SHA or ALL=true)
"""
import json, os, pathlib, re, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://www.floridianpolicypros.com"
HOST = "www.floridianpolicypros.com"
key = next(p.stem for p in (ROOT / "fpp").glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem))
sitemap = re.findall(r"<loc>([^<]+)</loc>", (ROOT / "fpp" / "sitemap.xml").read_text())

def to_url(path):
    rel = path[len("fpp/"):]
    if not rel.endswith(".html") or rel == "404.html":
        return None
    rel = rel[:-5]
    if rel == "index":
        return SITE + "/"
    return SITE + "/" + rel

base = sys.argv[1] if len(sys.argv) > 1 else ""
if os.environ.get("ALL") == "true" or not base or set(base) == {"0"}:
    urls = sitemap
else:
    out = subprocess.run(["git", "diff", "--name-only", base, "HEAD", "--", "fpp/"],
                         capture_output=True, text=True, cwd=ROOT).stdout.split()
    urls = sorted({u for u in map(to_url, out) if u and u in sitemap})
    if any(f in out for f in ("fpp/sitemap.xml",)) and not urls:
        urls = sitemap
if not urls:
    print("No page changes to submit."); sys.exit(0)
body = json.dumps({"host": HOST, "key": key, "keyLocation": f"{SITE}/{key}.txt", "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                             headers={"Content-Type": "application/json; charset=utf-8"})
with urllib.request.urlopen(req, timeout=30) as r:
    print(f"IndexNow HTTP {r.status} for {len(urls)} URLs")
