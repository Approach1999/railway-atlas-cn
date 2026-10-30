"""Build an immutable Shenyang MVP bundle from preserved PBF + source metadata.

The generated quality report accounts for every Rust candidate. Never invent route
membership when the input snapshot lacks relations.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

from mvp_data import normalize_relations, station_anchor
from geometry_integrity import validate_geometry

ROOT = Path(__file__).resolve().parents[1]
FACILITIES = {"platform", "stop_position", "entrance", "signal", "switch", "level_crossing", "buffer_stop",
    "depot", "yard", "works", "maintenance", "water_tower", "turntable", "roundhouse", "wash", "fuel", "loading_ramp"}
MODES = {"rail", "subway", "light_rail", "tram", "other", "unknown"}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def light(feature):
    heavy = {"tags", "class_warnings", "mode_evidence", "link_evidence", "aliases", "node_refs",
        "line_color", "colour_source", "colour_confidence"}
    return {**feature, "properties": {key: value for key, value in feature["properties"].items() if key not in heavy}}


def valid_geometry(geometry):
    def coordinates(value):
        if value and isinstance(value[0], (float, int)):
            yield value
        else:
            for child in value: yield from coordinates(child)
    points = list(coordinates(geometry["coordinates"]))
    return bool(points) and all(len(p) == 2 and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in points)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    source, target = args.input.resolve(strict=True), args.output_dir.resolve()
    if target.exists(): parser.error("Output exists; choose a new immutable snapshot id")
    provenance, metadata = read(args.source_manifest), read(args.metadata)
    if metadata["pbf_sha256"] != digest(source) or metadata["xml_sha256"] != provenance["sha256"]:
        parser.error("PBF/XML/metadata fingerprints do not describe the same source")
    subprocess.run(["cargo", "build", "--release", "--locked", "--offline"], cwd=ROOT, check=True)
    folder = target.with_name(target.name + ".building-" + uuid.uuid4().hex[:8])
    folder.mkdir(parents=True)
    binary = ROOT / "target/release" / ("railway-probe.exe" if os.name == "nt" else "railway-probe")
    subprocess.run([str(binary), str(source), str(folder / "raw.geojson"), str(folder / "rust-report.json")], check=True)
    raw, rust_report = read(folder / "raw.geojson"), read(folder / "rust-report.json")
    if rust_report["missing_way_node_refs"] or rust_report["missing_relation_member_refs"]:
        raise ValueError("Missing geometry or relation references; snapshot will not be published")
    palette, config = read(ROOT / "config/line-colors.json"), read(ROOT / "config/map-preview.json")
    features, excluded = [], list(raw.get("excluded", []))
    for feature in raw["features"]:
        p, geometry = feature["properties"], feature["geometry"]
        key = p["osm_id"]
        reason = None
        if p["feature_kind"] == "facility" and p["facility_kind"] not in FACILITIES:
            reason = "facility_kind_not_in_v1_matrix"
        if not valid_geometry(geometry): reason = "invalid_coordinates"
        if geometry["type"] == "LineString":
            dedup = [point for i, point in enumerate(geometry["coordinates"]) if i == 0 or point != geometry["coordinates"][i-1]]
            if len(dedup) < 2: reason = "zero_length_geometry"
            else: geometry["coordinates"] = dedup
        if reason:
            excluded.append({"feature_key": key, "rule": reason, "railway": p["railway"]})
            continue
        validate_geometry(geometry, key)
        p.update(metadata["records"].get(key, {}))
        p["metadata_available"] = bool(metadata["records"].get(key))
        p["snapshot_id"] = target.name
        p["link_status"] = "none"
        p["station_links"] = []
        if p["rail_mode"] not in MODES:
            p["rail_mode"] = "other" if p["feature_kind"] == "track" else "unknown"
        override = config["station_mode_overrides"].get(key)
        if override:
            if p["tags"].get("railway:ref") != override["expected_ref"]:
                raise ValueError(f"Station evidence changed: {key}")
            p.update({"rail_mode": override["mode"], "mode_evidence": override["evidence"]})
        features.append(feature)
    lines = normalize_relations(features, raw["relations"], palette)
    tracks, stations, tile_features, shards = [], [], [], {}
    for feature in features:
        p = feature["properties"]
        p["aliases"] = sorted({value.strip() for key in ["name", "name:zh", "alt_name", "old_name", "official_name"] for value in p["tags"].get(key, "").split(";") if value.strip()})
        if p["feature_kind"] in ["station", "station_area"]:
            point, method = station_anchor(feature["geometry"])
            p.update({"anchor": point, "anchor_method": method,
                "label_priority": 0 if p["osm_id"] in config["major_station_keys"] else 1})
            stations.append({**feature, "geometry": {"type": "Point", "coordinates": point},
                "properties": {key: value for key, value in p.items() if key not in ["tags", "class_warnings", "node_refs"]}})
        if p["feature_kind"] != "station": tile_features.append(light(feature))
        if p["feature_kind"] == "track": tracks.append(feature)
        bucket = hashlib.sha256(p["osm_id"].encode()).hexdigest()[:2]
        shards.setdefault(bucket, {})[p["osm_id"]] = feature
    keys = [f["properties"]["osm_id"] for f in features]
    if len(keys) != len(set(keys)): raise ValueError("Duplicate source identities")
    if len(features) + len(excluded) + len(raw["relations"]) != rust_report["candidate_objects"]: raise ValueError("Source object counts do not reconcile")
    folder.joinpath("details").mkdir()
    for bucket, records in shards.items(): write(folder / "details" / (bucket + ".json"), records)
    write(folder / "stations.geojson", {"type": "FeatureCollection", "features": stations})
    index_fields = {"osm_id", "feature_kind", "display_name", "facility_kind", "rail_mode", "status",
        "line_class", "line_keys", "line_tokens", "aliases"}
    write(folder / "objects.json", {"snapshot_id": target.name, "records": [
        {key: value for key, value in feature["properties"].items() if key in index_fields} for feature in features]})
    write(folder / "features.geojson", {"type": "FeatureCollection", "features": tile_features})
    write(folder / "lines.json", {"schema_version": 1, "snapshot_id": target.name, "lines": lines,
        "source_time": provenance.get("osm_base", {}), "relations_available": bool(raw["relations"])})
    write(folder / "palette.json", palette)
    audit = {"candidate_objects": rust_report["candidate_objects"], "relation_records": len(raw["relations"]), "published_features": len(features),
        "excluded_count": len(excluded), "excluded": excluded,
        "facility_counts": dict(Counter(f["properties"]["facility_kind"] for f in features if f["properties"]["feature_kind"] == "facility")),
        "metadata_records": sum(f["properties"]["metadata_available"] for f in features),
        "station_area_records": sum(f["properties"]["feature_kind"] == "station_area" for f in features),
        "route_relations": sum(len(line["relation_ids"]) for line in lines),
        "line_count": len(lines), "missing_way_node_refs": 0, "missing_relation_member_refs": 0,
        "warnings": [] if lines else ["Source snapshot has no urban route relations; no line membership or colors invented"]}
    write(folder / "quality.json", audit)
    subprocess.run(["node", str(ROOT / "apps/web/probe/build-tiles.mjs"), str(folder / "features.geojson"), str(folder / "tiles"), "--mvp"], check=True)
    tiles = read(folder / "tiles/build.json")
    now = datetime.now(timezone.utc)
    try: retention_until = now.replace(year=now.year + 1)
    except ValueError: retention_until = now.replace(year=now.year + 1, day=28)
    manifest = {"schema_version": 2, "snapshot_id": target.name, "region": "shenyang",
        "source": provenance, "input_sha256": digest(source), "bbox": provenance["bbox"],
        "relation_version": "route-master-membership-v1",
        "object_index": "objects.json",
        "classification_version": "mvp-v1", "palette_version": palette["palette_version"],
        "build_time": now.isoformat(), "retention_until": retention_until.isoformat(),
        "class_counts": dict(Counter(f["properties"]["line_class"] for f in tracks)),
        "station_records": len(stations), "facility_kinds": sorted(audit["facility_counts"]),
        "line_count": len(lines), "tile_format": "mvt-directory",
        "tiles": {key: value for key, value in tiles.items() if key != "files"},
        "tile_index_sha256": digest(folder / "tiles/build.json"),
        "files": {str(p.relative_to(folder)).replace('\\','/'): {"bytes": p.stat().st_size, "sha256": digest(p)}
            for p in sorted(folder.rglob('*.json')) if not p.name.endswith('.geojson') and p.name != 'rust-report.json'}}
    write(folder / "dataset.json", manifest)
    folder.rename(target)
    print(json.dumps({"snapshot": target.name, **{k: v for k, v in audit.items() if k != 'excluded'}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
