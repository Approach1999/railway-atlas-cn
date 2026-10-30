"""Negotiated gzip for full local responses; byte ranges remain identity."""
from functools import lru_cache
import gzip
from pathlib import Path

COMPRESSIBLE = {".html", ".js", ".css", ".json", ".geojson", ".pbf", ".svg"}


def accepts_gzip(header):
    qualities = {}
    for part in header.lower().split(","):
        fields = [value.strip() for value in part.split(";")]
        quality = 1.0
        for parameter in fields[1:]:
            if parameter.startswith("q="):
                try: quality = float(parameter[2:])
                except ValueError: quality = 0
        qualities[fields[0]] = quality
    return qualities.get("gzip", qualities.get("*", 0)) > 0


@lru_cache(maxsize=256)
def _compressed(path, modified_ns, size):
    # Metadata participates in the key; changing development assets cannot
    # reuse a stale body. Gzip never modifies the immutable source files.
    return gzip.compress(Path(path).read_bytes(), compresslevel=6, mtime=0)


def gzip_payload(path, accept_encoding, range_header=None):
    if range_header or path.suffix.lower() not in COMPRESSIBLE or not accepts_gzip(accept_encoding):
        return None
    stat = path.stat()
    if stat.st_size < 1024:
        return None
    compressed = _compressed(str(path.resolve()), stat.st_mtime_ns, stat.st_size)
    return compressed if len(compressed) < stat.st_size else None
