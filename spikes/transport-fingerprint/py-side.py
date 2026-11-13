"""S2 reference side: what curl_cffi's impersonation actually produces.

The point is not to prove curl_cffi works (Scrapling already relies on it) but to
capture the *target* fingerprint that any Node wrapper must match.
"""
import json
import sys

from curl_cffi import requests

URL = "https://tls.peet.ws/api/all"
TARGETS = ["chrome", "chrome131", "safari"]


def snapshot(impersonate):
    r = requests.get(URL, impersonate=impersonate, timeout=30)
    d = r.json()
    tls = d.get("tls") or {}
    h2 = d.get("http2") or {}
    return {
        "impersonate": impersonate,
        "http_version": d.get("http_version"),
        "ja3_hash": tls.get("ja3_hash"),
        "ja4": tls.get("ja4"),
        "akamai": h2.get("akamai_fingerprint"),
        "akamai_hash": h2.get("akamai_fingerprint_hash"),
        "user_agent": (d.get("user_agent") or "")[:70],
    }


out = {}
for target in TARGETS:
    try:
        out[target] = snapshot(target)
    except Exception as exc:  # unsupported alias, network, etc.
        out[target] = {"error": f"{type(exc).__name__}: {exc}"[:160]}

path = sys.argv[1] if len(sys.argv) > 1 else "out-python.json"
with open(path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=1)
print(json.dumps(out, indent=1))
