"""Verify a generated schema-2 bundle independently of its build process."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from geometry_integrity import validate_geometry


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify(folder):
    manifest, quality = read(folder / "dataset.json"), read(folder / "quality.json")
    assert manifest["schema_version"] == 2
    assert manifest["snapshot_id"] == folder.name
    for key, expected in manifest["files"].items():
        path = (folder / key).resolve()
        assert path.is_relative_to(folder.resolve()), key
        content = path.read_bytes()
        assert len(content) == expected["bytes"], key
        assert hashlib.sha256(content).hexdigest() == expected["sha256"], key
    assert hashlib.sha256((folder / "tiles/build.json").read_bytes()).hexdigest() == manifest["tile_index_sha256"]
    assert quality["candidate_objects"] == quality["published_features"] + quality["relation_records"] + quality["excluded_count"]
    assert len(quality["excluded"]) == quality["excluded_count"]
    excluded = [entry["feature_key"] for entry in quality["excluded"]]
    assert len(set(excluded)) == len(excluded)
    assert all(entry.get("rule") for entry in quality["excluded"])
    records = {}
    geometry_types, geometry_totals = Counter(), Counter()
    for path in (folder / "details").glob("*.json"):
        for key, feature in read(path).items():
            assert key not in records and key not in excluded
            assert feature["properties"]["osm_id"] == key
            assert hashlib.sha256(key.encode()).hexdigest()[:2] == path.stem
            geometry = validate_geometry(feature["geometry"], key)
            geometry_types[geometry["type"]] += 1
            geometry_totals.update({field: geometry[field] for field in ("positions", "line_parts", "polygon_rings")})
            records[key] = feature
    assert len(records) == quality["published_features"]
    facilities = Counter(f["properties"]["facility_kind"] for f in records.values() if f["properties"]["feature_kind"] == "facility")
    assert dict(facilities) == quality["facility_counts"]
    for station in read(folder / "stations.geojson")["features"]:
        assert station["properties"]["osm_id"] in records
    if manifest.get("object_index"):
        index = read(folder / "objects.json")
        assert index["snapshot_id"] == manifest["snapshot_id"]
        indexed = [record["osm_id"] for record in index["records"]]
        assert len(indexed) == len(records) and set(indexed) == set(records)
        for record in index["records"]:
            assert all(records[record["osm_id"]]["properties"][key] == value for key, value in record.items())
    assert not quality["missing_way_node_refs"] and not quality["missing_relation_member_refs"]
    tiles = list((folder / "tiles").rglob("*.pbf"))
    assert len(tiles) == manifest["tiles"]["tile_count"]
    assert sum(path.stat().st_size for path in tiles) == manifest["tiles"]["total_bytes"]
    return {"snapshot": manifest["snapshot_id"], "checks": [
        f"{len(manifest['files'])} manifest assets match lengths and SHA-256",
        "Candidate objects reconcile with published features, relations and named exclusions",
        "Typed identities are unique; detail shards and station references are complete",
        "Facility counts and all declared tile files/bytes reconcile",
        "All published detail geometries have finite WGS84 coordinates, no zero-length edges or repeated nonclosing positions; polygon rings are closed and nonzero-area",
        "No missing source references; absent relations and metadata remain explicit limitations"],
        "quality": {key: value for key, value in quality.items() if key != "excluded"},
        "geometry": {"features": len(records), "types": dict(geometry_types), **dict(geometry_totals),
            "scope": "All published full-detail geometries. Terminal path closure permitted; not topology/intersection, MVT quantization or real-world accuracy review."},
        "scope": "Local snapshot integrity; not proof of source completeness, individual tile semantics, or full MVP acceptance"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify(args.folder)
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"snapshot": report["snapshot"], "checks": len(report["checks"])}))
