"""Opt-in local preview transport for the fixed OSM raster source, not an open proxy.

Only interactive tile requests are fetched. Keep origin Referer/identifiable UA,
respect HTTP cache metadata and revalidate expired entries. No prefetch/offline API.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
from email.utils import parsedate_to_datetime
from tempfile import NamedTemporaryFile
from threading import BoundedSemaphore, Lock
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TEMPLATE = "/preview-basemap/{z}/{x}/{y}.png"
USER_AGENT = "RailwayAtlasCN-local-preview/0.2 (+https://github.com/Approach1999/railway-atlas-cn)"
PNG = bytes.fromhex("89504e470d0a1a0a")
MAX_BYTES = 1024 * 1024
KEEP_HEADERS = ("Cache-Control", "Expires", "ETag", "Last-Modified", "Age")


def coordinates(path):
    match = re.fullmatch(r"/preview-basemap/(\d{1,2})/(\d{1,6})/(\d{1,6})\.png", path)
    if not match:
        raise ValueError("Invalid tile path")
    z, x, y = map(int, match.groups())
    if not 0 <= z <= 19 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise ValueError("Tile outside source bounds")
    return z, x, y


def referrer_origin(value):
    if not value or "\r" in value or "\n" in value:
        raise ValueError("Web Referer required")
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid Referer")
    # Match the website's cross-origin policy: never forward view/query data.
    return f"{parsed.scheme}://{parsed.netloc}/"


def lifetime(headers, now):
    control = headers.get("Cache-Control", "").lower()
    if "no-cache" in control or "no-store" in control:
        return 0
    match = re.search(r'(?:^|,)\s*max-age\s*=\s*"?(\d+)', control)
    if match:
        return max(0, int(match[1]) - int(headers.get("Age", "0")))
    if headers.get("Expires"):
        try:
            return max(0, parsedate_to_datetime(headers["Expires"]).timestamp() - now)
        except (TypeError, ValueError, OverflowError):
            pass
    return 7 * 24 * 3600


class BasemapProxy:
    def __init__(self, cache_dir, fetcher=urlopen, clock=time.time):
        self.root = Path(cache_dir)
        self.fetcher, self.clock = fetcher, clock
        self.locks = [Lock() for _ in range(64)]
        self.requests = BoundedSemaphore(4)

    def tile(self, path, referer):
        z, x, y = coordinates(path)
        origin = referrer_origin(referer)
        key = f"{z}-{x}-{y}"
        with self.locks[hashlib.sha256(key.encode()).digest()[0] % len(self.locks)]:
            target = self.root / (key + ".json")
            entry = None
            try:
                entry = json.loads(target.read_text(encoding="utf-8"))
                body = base64.b64decode(entry["body"], validate=True)
                if not body.startswith(PNG) or len(body) > MAX_BYTES:
                    entry = None
            except (OSError, ValueError, KeyError):
                entry = None
            now = self.clock()
            if entry is None or now >= entry["expires"]:
                headers = {"User-Agent": USER_AGENT, "Referer": origin}
                if entry:
                    if entry["headers"].get("ETag"):
                        headers["If-None-Match"] = entry["headers"]["ETag"]
                    if entry["headers"].get("Last-Modified"):
                        headers["If-Modified-Since"] = entry["headers"]["Last-Modified"]
                with self.requests:
                    try:
                        response = self.fetcher(Request(f"https://tile.openstreetmap.org/{z}/{x}/{y}.png", headers=headers), timeout=8)
                    except HTTPError as error:
                        if error.code != 304 or not entry:
                            raise
                        response = error
                    with response:
                        upstream = {name: response.headers[name] for name in KEEP_HEADERS if response.headers.get(name) is not None}
                        if response.code == 304:
                            merged = {**entry["headers"], "Age": "0", **upstream}
                        else:
                            body = response.read(MAX_BYTES + 1)
                            if response.code != 200 or not body.startswith(PNG) or len(body) > MAX_BYTES:
                                raise ValueError("Upstream did not return a bounded PNG tile")
                            merged = upstream
                now = self.clock()
                entry = {"stored": now, "expires": now + lifetime(merged, now), "headers": merged,
                         "body": base64.b64encode(body).decode("ascii")}
                if "no-store" not in merged.get("Cache-Control", "").lower():
                    self.root.mkdir(parents=True, exist_ok=True)
                    temporary = None
                    try:
                        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.root, delete=False) as stream:
                            temporary = Path(stream.name)
                            json.dump(entry, stream)
                        os.replace(temporary, target)
                    finally:
                        if temporary is not None:
                            temporary.unlink(missing_ok=True)
                else:
                    # A new no-store policy must also remove a prior cached copy.
                    target.unlink(missing_ok=True)
            result = dict(entry["headers"])
            result["Age"] = str(max(0, int(self.clock() - entry["stored"])) + int(result.get("Age", "0")))
            return body, result
