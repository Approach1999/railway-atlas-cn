"""Measure every published MVT with the server's gzip level and no data edits."""
import argparse
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.folder / "dataset.json").read_text(encoding="utf-8"))
    sizes = [(len(gzip.compress(path.read_bytes(), compresslevel=6, mtime=0)), str(path.relative_to(args.folder)).replace("\\", "/"), path.stat().st_size)
        for path in (args.folder / "tiles").rglob("*.pbf")]
    sizes.sort()
    assert len(sizes) == manifest["tiles"]["tile_count"] and sizes
    result = {"date": datetime.now(timezone.utc).isoformat(), "snapshot": manifest["snapshot_id"],
        "tiles": len(sizes), "compression": "gzip level 6, mtime 0, matches local HTTP server",
        "gzip_bytes": {"median": sizes[(len(sizes)-1)//2][0], "p95": sizes[(len(sizes)*95+99)//100-1][0], "max": sizes[-1][0], "total": sum(s[0] for s in sizes)},
        "largest_tile": sizes[-1][1], "uncompressed_bytes": sum(s[2] for s in sizes),
        "individual_tile_budget_bytes": 500*1024, "all_individual_tiles_within_budget": sizes[-1][0] <= 500*1024,
        "scope": "Current bounded snapshot only; all zooms checked, not national-scale evidence"}
    if args.report: args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    if not result["all_individual_tiles_within_budget"]: raise SystemExit(1)
