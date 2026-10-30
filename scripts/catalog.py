"""Build a safe local catalog from explicitly configured immutable snapshots."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re

KEY = re.compile(r"[A-Za-z0-9_-]{1,80}")


def read_manifest(root, snapshot):
    if not KEY.fullmatch(snapshot):
        raise ValueError("Invalid snapshot identity")
    folder = (root / snapshot).resolve()
    if not folder.is_relative_to(root.resolve()):
        raise ValueError("Snapshot outside dataset root")
    manifest = json.loads((folder / "dataset.json").read_text(encoding="utf-8"))
    if manifest.get("snapshot_id") != snapshot:
        raise ValueError("Snapshot identity mismatch")
    return manifest


def expired(manifest, now=None):
    until = manifest.get("retention_until")
    if not until:
        return False
    deadline = datetime.fromisoformat(until.replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        raise ValueError("Retention deadline requires timezone")
    return deadline < (now or datetime.now(timezone.utc))


def build_catalog(config, root, current_snapshot, now=None):
    regions = []
    for region in config["regions"]:
        if not KEY.fullmatch(region["id"]):
            raise ValueError("Invalid region identity")
        entries = []
        requested = list(dict.fromkeys([current_snapshot, *region["snapshots"]]))
        for snapshot in requested:
            try:
                manifest = read_manifest(root, snapshot)
            except FileNotFoundError:
                continue
            if manifest.get("region") != region["id"] or expired(manifest, now):
                continue
            folder = root / snapshot
            if not all((folder / name).is_file() for name in ["palette.json", "stations.geojson", "tiles/build.json"]):
                continue
            if manifest.get("schema_version", 1) >= 2 and not (folder / "lines.json").is_file():
                continue
            entries.append({"id": snapshot, "build_time": manifest.get("build_time"),
                "retention_until": manifest.get("retention_until"), "schema_version": manifest.get("schema_version", 1),
                "features": manifest.get("station_records"), "object_list": manifest.get("object_index") == "objects.json"})
        if entries:
            ids = {entry["id"] for entry in entries}
            regions.append({"id": region["id"], "name": region["name"], "default_view": region["default_view"],
                "current_snapshot": current_snapshot if current_snapshot in ids else entries[0]["id"], "snapshots": entries})
    return {"schema_version": 1, "regions": regions, "scope": config.get("note", "Local preview")}
