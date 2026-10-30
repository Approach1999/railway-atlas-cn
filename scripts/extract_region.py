"""Bounded regional PBF -> complete-way/member Shenyang XML with provenance.

Three streaming passes preserve source identities and object metadata. The input
is a dated provincial file, not a country/planet extract. No proximity merging.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
LIFECYCLES = ["abandoned", "disused", "razed", "construction", "proposed"]
AREA_KINDS = {"station", "halt", "platform", "depot", "yard", "works", "maintenance", "water_tower", "roundhouse"}
URBAN = {"subway", "light_rail", "tram"}


def rail_context(tags):
    return any(tags.get(mode) == "yes" for mode in ["train", "subway", "light_rail", "tram"])


def rail_object(tags):
    return "railway" in tags or any(f"{state}:railway" in tags for state in LIFECYCLES) or (
        tags.get("public_transport") in {"station", "platform", "stop_position"} and rail_context(tags))


def inside(point, bbox):
    return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def segment_intersects(a, b, bbox):
    dx, dy = b[0] - a[0], b[1] - a[1]
    low, high = 0., 1.
    for p, q in [(-dx, a[0]-bbox[0]), (dx, bbox[2]-a[0]), (-dy, a[1]-bbox[1]), (dy, bbox[3]-a[1])]:
        if p == 0:
            if q < 0: return False
        elif p < 0: low = max(low, q/p)
        else: high = min(high, q/p)
        if low > high: return False
    return True


def intersects(points, bbox, area=False):
    if any(inside(point, bbox) for point in points): return True
    if any(segment_intersects(a, b, bbox) for a, b in zip(points, points[1:])): return True
    # A closed source area can enclose the entire rectangle without crossing it.
    if area and len(points) > 3 and points[0] == points[-1]:
        x, y = (bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2
        contained = False
        for a, b in zip(points, points[1:]):
            if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]: contained = not contained
        return contained
    return False


def main():
    import osmium
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--expected-md5", required=True)
    args = parser.parse_args()
    target, source = args.output.resolve(), args.input.resolve(strict=True)
    provenance = target.with_suffix(".source.json")
    partial = target.with_suffix(target.suffix + ".building.osm")
    if any(path.exists() for path in [target, provenance, partial]): parser.error("Output exists; choose a new immutable name")
    if source.stat().st_size > 256*1024*1024: parser.error("Provincial pilot input exceeds 256 MiB budget")
    content = source.read_bytes()
    if hashlib.md5(content).hexdigest() != args.expected_md5: parser.error("Input does not match provider MD5")
    source_hash = hashlib.sha256(content).hexdigest()
    del content
    config = json.loads((ROOT / "config/shenyang.json").read_text(encoding="utf-8"))
    bbox = config["bbox"]
    reader = osmium.io.Reader(str(source))
    header = reader.header()
    source_time = header.get("osmosis_replication_timestamp")
    reader.close()
    if not source_time: parser.error("Source PBF lacks a replication timestamp")
    begin = time.perf_counter()
    spatial, seeds, relations, candidates, masters = set(), set(), {}, {}, set()

    class Spatial(osmium.SimpleHandler):
        def node(self, obj):
            if inside((obj.lon, obj.lat), bbox):
                key = ("n", obj.id)
                spatial.add(key)
                if rail_object(obj.tags): seeds.add(key)

        def way(self, obj):
            points = [(ref.location.lon, ref.location.lat) for ref in obj.nodes]
            area = obj.tags.get("area") != "no" and (obj.tags.get("railway") in AREA_KINDS or obj.tags.get("public_transport") in {"station", "platform"})
            if intersects(points, bbox, area):
                key = ("w", obj.id)
                spatial.add(key)
                if rail_object(obj.tags): seeds.add(key)

        def relation(self, obj):
            refs = [(member.type, member.ref) for member in obj.members]
            relations[obj.id] = refs
            tags = obj.tags
            if tags.get("type") == "route_master" and tags.get("route_master") in URBAN: masters.add(obj.id)
            if tags.get("route") in URBAN: candidates[obj.id] = "urban"
            elif tags.get("public_transport") == "stop_area": candidates[obj.id] = "rail_stop" if rail_context(tags) else "unconfirmed_stop"
            elif tags.get("railway") in AREA_KINDS or tags.get("public_transport") == "station" and rail_context(tags): candidates[obj.id] = "area"

    Spatial().apply_file(str(source), locations=True)
    # Spatial relation membership can be nested. Determine it without assuming
    # that a line number, operator or nearby station implies a relationship.
    changed = True
    while changed:
        changed = False
        for identity, refs in relations.items():
            key = ("r", identity)
            if key not in spatial and any(ref in spatial for ref in refs):
                spatial.add(key); changed = True
    selected = set(seeds)
    seed_relations = []
    for identity, kind in candidates.items():
        if ("r", identity) not in spatial: continue
        if kind == "unconfirmed_stop" and not any(ref in seeds for ref in relations[identity]): continue
        selected.add(("r", identity)); seed_relations.append(identity)
    # Keep explicit parents of selected direction relations. Their network/ref
    # tags and membership provide identity evidence absent on some children.
    for identity in masters:
        if any(ref in selected for ref in relations[identity] if ref[0] == "r"):
            selected.add(("r", identity)); seed_relations.append(identity)
    queue = list(seed_relations)
    missing_relations = []
    while queue:
        identity = queue.pop()
        if identity not in relations:
            missing_relations.append(identity); continue
        for ref in relations[identity]:
            if ref not in selected:
                selected.add(ref)
                if ref[0] == "r": queue.append(ref[1])
    if missing_relations: raise ValueError(f"Incomplete source relation references: {missing_relations[:10]}")
    selected_ways = {identity for kind, identity in selected if kind == "w"}
    found_ways = set()

    class WayNodes(osmium.SimpleHandler):
        def way(self, obj):
            if obj.id in selected_ways:
                found_ways.add(obj.id)
                selected.update(("n", ref.ref) for ref in obj.nodes)

    WayNodes().apply_file(str(source))
    if found_ways != selected_ways: raise ValueError("Incomplete source way references")
    target.parent.mkdir(parents=True, exist_ok=True)
    writer = osmium.SimpleWriter(str(partial))
    counts = {"node": 0, "way": 0, "relation": 0}
    metadata_counts = {"version": 0, "timestamp": 0, "changeset": 0}
    seen = set()

    class Copy(osmium.SimpleHandler):
        def save(self, obj, kind, code):
            key = (code, obj.id)
            if key not in selected: return
            seen.add(key); counts[kind] += 1
            metadata_counts["version"] += obj.version > 0
            metadata_counts["timestamp"] += obj.timestamp.year > 1970
            metadata_counts["changeset"] += obj.changeset > 0
            getattr(writer, "add_"+kind)(obj)

        def node(self, obj): self.save(obj, "node", "n")
        def way(self, obj): self.save(obj, "way", "w")
        def relation(self, obj): self.save(obj, "relation", "r")

    try: Copy().apply_file(str(source))
    finally: writer.close()
    if seen != selected: raise ValueError("Incomplete source object closure; partial output retained for diagnosis")
    if partial.stat().st_size > 80*1024*1024: raise ValueError("Extract exceeds 80 MiB bounded pilot budget")
    if not counts["relation"]: raise ValueError("No route/area relations selected")
    metadata = {"source_url": args.source_url, "provider": "Geofabrik / OpenStreetMap contributors",
        "source_pbf_sha256": source_hash, "source_pbf_md5": args.expected_md5,
        "source_pbf_bytes": source.stat().st_size, "source_time": source_time, "bbox": bbox,
        "extracted_at": datetime.now(timezone.utc).isoformat(), "strategy": "spatial rail-context seeds; full ways; recursive urban/rail-stop/rail-area relation members",
        "seed_objects": len(seeds), "seed_relations": len(seed_relations), "nodes": counts["node"], "ways": counts["way"], "relations": counts["relation"],
        "metadata_counts": metadata_counts, "missing_refs": 0, "bytes": partial.stat().st_size,
        "sha256": hashlib.sha256(partial.read_bytes()).hexdigest(), "processing_seconds": round(time.perf_counter()-begin, 3),
        "license": "ODbL 1.0", "attribution": "OpenStreetMap contributors; regional extract supplied by Geofabrik",
        "metadata_note": "Geofabrik public extract omits contributor identity and changeset IDs; absent fields stay unlabelled",
        "scope": "Bounded Shenyang rectangle, not administrative boundary; full selected source objects may extend beyond it"}
    with provenance.open("x", encoding="utf-8") as stream: json.dump(metadata, stream, ensure_ascii=False, indent=2)
    partial.rename(target)
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__": main()
