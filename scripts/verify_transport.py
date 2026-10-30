"""Check negotiated gzip and byte ranges against a running local preview."""
import argparse
from datetime import datetime, timezone
import gzip
import json
import urllib.request


def request(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
        return response.status, response.headers, response.read()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8773")
    parser.add_argument("--report")
    args = parser.parse_args()
    _, _, latest = request(args.base + "/dataset.json", {"Accept-Encoding": "identity"})
    manifest = json.loads(latest)
    url = args.base + "/snapshots/" + manifest["snapshot_id"] + "/dataset.json"
    status, headers, packed = request(url, {"Accept-Encoding": "gzip"})
    assert status == 200 and headers["Content-Encoding"] == "gzip"
    assert headers["Vary"] == "Accept-Encoding" and int(headers["Content-Length"]) == len(packed)
    original = gzip.decompress(packed)
    assert json.loads(original)["snapshot_id"] == manifest["snapshot_id"]
    status, headers, content = request(url, {"Accept-Encoding": "gzip", "Range": "bytes=10-29"})
    assert status == 206 and headers.get("Content-Encoding") is None
    assert content == original[10:30] and headers["Content-Range"] == f"bytes 10-29/{len(original)}"
    status, headers, content = request(url, {"Accept-Encoding": "gzip;q=0"})
    assert status == 200 and headers.get("Content-Encoding") is None and content == original
    result = {"date": datetime.now(timezone.utc).isoformat(), "server_url": args.base,
        "snapshot": manifest["snapshot_id"], "checks": ["negotiated gzip round trip and encoded Content-Length", "Vary separates encodings", "byte ranges use original immutable bytes", "explicit gzip refusal returns identity"],
        "original_bytes": len(original), "gzip_bytes": len(packed)}
    if args.report:
        from pathlib import Path
        Path(args.report).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
