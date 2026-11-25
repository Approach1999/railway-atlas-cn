"""Read-only survey of a provincial PBF around a candidate region.

Reports the source header, urban route relations that reach the envelope, and
railway object counts inside it. Nothing is written to the source or to a
snapshot; the report only informs and documents a bbox choice.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

# The extractor's own seed predicate, so what the survey counts is exactly what an extract would select.
from extract_region import rail_object

URBAN = {"subway", "light_rail", "tram"}
IDENTITY = ["type", "route", "route_master", "ref", "name", "name:zh", "operator", "network", "colour", "state",
    "from", "to", "via", "public_transport:version"]
STATION = ["name", "name:zh", "railway", "station", "train", "subway", "tram", "light_rail", "operator", "railway:ref",
    "public_transport", "uic_ref", "uic_name"]


def inside(point, bbox):
    return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def bounds(boxes):
    """Union box of already ordered (west, south, east, north) boxes."""
    if not boxes:
        return None
    return [min(box[0] for box in boxes), min(box[1] for box in boxes),
        max(box[2] for box in boxes), max(box[3] for box in boxes)]


def reaches(box, envelope):
    if box is None:
        return False
    return box[0] <= envelope[2] and box[2] >= envelope[0] and box[1] <= envelope[3] and box[3] >= envelope[1]


def survey(source, envelope):
    import osmium
    reader = osmium.io.Reader(str(source))
    header = reader.header()
    timestamp = header.get("osmosis_replication_timestamp")
    try:
        box = header.box()
        header_bounds = [box.bottom_left.lon, box.bottom_left.lat, box.top_right.lon, box.top_right.lat]
    except RuntimeError:  # The header carries no bounds.
        header_bounds = None
    generator, history = header.get("generator"), bool(header.has_multiple_object_versions)
    reader.close()
    routes, nodes, stations, ways, station_nodes, masters = {}, Counter(), Counter(), Counter(), {}, {}
    # Relation members carry no geometry in this pyosmium version; remember the
    # geometry of railway-tagged ways and nodes to bound each route afterwards.
    way_boxes, node_points = {}, {}

    class Survey(osmium.SimpleHandler):
        def node(self, obj):
            if "railway" in obj.tags or "public_transport" in obj.tags:
                node_points[obj.id] = (obj.lon, obj.lat)
            if inside((obj.lon, obj.lat), envelope) and rail_object(obj.tags):
                nodes[obj.tags.get("railway", "lifecycle-only")] += 1
                if obj.tags.get("railway") in {"station", "halt", "tram_stop"}:
                    stations[obj.tags.get("railway")] += 1
                    station_nodes[obj.id] = {"feature_key": f"node/{obj.id}", "longitude": obj.lon, "latitude": obj.lat,
                        "tags": {key: obj.tags[key] for key in STATION if key in obj.tags}, "tag_count": len(obj.tags),
                        "version": obj.version, "timestamp": str(obj.timestamp)}

        def way(self, obj):
            points = [(ref.location.lon, ref.location.lat) for ref in obj.nodes]
            if not points:
                return
            if "railway" in obj.tags:
                way_boxes[obj.id] = [min(p[0] for p in points), min(p[1] for p in points),
                    max(p[0] for p in points), max(p[1] for p in points)]
            if any(inside(point, envelope) for point in points) and rail_object(obj.tags):
                ways[obj.tags.get("railway", "lifecycle-only")] += 1

        def relation(self, obj):
            tags = obj.tags
            if tags.get("type") == "route_master" and tags.get("route_master") in URBAN:
                # A master has no geometry of its own; it is placed through its child routes afterwards.
                masters[obj.id] = {"feature_key": f"relation/{obj.id}", "tags": {key: tags[key] for key in IDENTITY if key in tags},
                    "children": [f"relation/{member.ref}" for member in obj.members if member.type == "r"],
                    "child_ids": [member.ref for member in obj.members if member.type == "r"],
                    "other_members": sum(member.type != "r" for member in obj.members)}
                return
            if tags.get("route") not in URBAN:
                return
            boxes = [way_boxes[member.ref] for member in obj.members if member.type == "w" and member.ref in way_boxes]
            points = [node_points[member.ref] for member in obj.members if member.type == "n" and member.ref in node_points]
            extent = bounds([*boxes, *([x, y, x, y] for x, y in points)])
            if not reaches(extent, envelope):
                return
            routes[obj.id] = {"feature_key": f"relation/{obj.id}",
                "tags": {key: tags[key] for key in IDENTITY if key in tags}, "tag_count": len(tags),
                "members": dict(Counter(member.type for member in obj.members)),
                "roles": dict(Counter(member.role for member in obj.members)),
                "member_ways_with_geometry": len(boxes),
                "member_ways_without_geometry": sum(member.type == "w" for member in obj.members) - len(boxes),
                "member_nodes_with_geometry": len(points), "extent": extent,
                "version": obj.version, "timestamp": str(obj.timestamp)}

    Survey().apply_file(str(source), locations=True)
    # Only masters whose child routes reach the envelope describe this region. Route records are keyed by id.
    reached = []
    for master in masters.values():
        master["children"].sort()
        if any(child in routes for child in master.pop("child_ids")):
            reached.append(master)
    order = {"subway": 0, "light_rail": 1, "tram": 2}
    return {"source_file": source.name, "source_bytes": source.stat().st_size,
        "header": {"bounds": header_bounds, "with_history": history,
            "osmosis_replication_timestamp": timestamp, "generator": str(generator or "")},
        "envelope": envelope,
        "route_masters": sorted(reached, key=lambda master: (
            order.get(master["tags"].get("route_master"), 3), master["tags"].get("ref", ""), master["feature_key"])),
        "routes": sorted(routes.values(), key=lambda route: (
            order.get(route["tags"].get("route_master") or route["tags"].get("route"), 3), route["tags"].get("ref", ""),
            route["feature_key"])),
        "rail_nodes_in_envelope_by_railway": dict(nodes.most_common()),
        "rail_stations_in_envelope": dict(stations),
        "station_nodes_in_envelope": sorted(station_nodes.values(), key=lambda station: (
            station["tags"].get("name") or station["tags"].get("name:zh") or "", station["feature_key"])),
        "rail_ways_touching_envelope_by_railway": dict(ways.most_common())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--bbox", type=float, nargs=4, required=True, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    west, south, east, north = args.bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        parser.error("Envelope must be ordered WGS84 west,south,east,north")
    report = survey(args.input.resolve(strict=True), list(args.bbox))
    report["surveyed_at"] = datetime.now(timezone.utc).isoformat()
    report["scope"] = ("Read-only survey of source relations and tag counts. Route extents cover railway-tagged member ways "
        "and railway/public-transport-tagged member nodes only, so they are a lower bound; route masters are listed when a "
        "child route reaches the envelope. Tag presence does not confirm operating status or line completeness.")
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open("x", encoding="utf-8") as stream:
            stream.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
