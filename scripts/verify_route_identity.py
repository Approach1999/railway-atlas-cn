"""Audit published route identities and source fidelity of one snapshot against its preserved XML.

Works for any region: the palette operator configured for the snapshot's region supplies the
expected network name and line-key prefix. Identity is re-derived from the XML independently
of the build. Member counts describe what the source contains; they never state that an
operating line is complete.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

URBAN = {"subway", "light_rail", "tram"}
IDENTITY = ("operator", "network", "ref")


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def tags(obj):
    return {entry.attrib["k"]: entry.attrib["v"] for entry in obj.findall("tag")}


def stamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def region_operator(palette, region):
    """The single palette operator configured for a region, as (key, entry)."""
    found = [(key, entry) for key, entry in palette.get("operators", {}).items() if entry.get("region") == region]
    if len(found) != 1:
        raise ValueError(f"expected one palette operator for region {region!r}, found {len(found)}")
    return found[0]


def audit(folder, xml_path, expect_lines=None, expect_directions=None):
    manifest, palette = read(folder / "dataset.json"), read(folder / "palette.json")
    lines = read(folder / "lines.json")["lines"]
    source = Path(xml_path).read_bytes()
    assert hashlib.sha256(source).hexdigest() == manifest["source"]["sha256"], "source XML is not the one the manifest records"
    objects = {obj.tag + "/" + obj.attrib["id"]: obj for obj in ET.fromstring(source) if obj.tag in {"node", "way", "relation"}}
    records = {}
    for file in sorted((folder / "details").glob("*.json")):
        records.update(read(file))
    for key, feature in records.items():
        obj, p = objects[key], feature["properties"]
        assert p["tags"] == tags(obj), key
        assert p.get("osm_version") == int(obj.attrib["version"]), key
        assert stamp(p["osm_timestamp"]) == stamp(obj.attrib["timestamp"]), key
        assert (p.get("osm_changeset") or 0) == int(obj.attrib.get("changeset", "0")), key
    operator_key, operator = region_operator(palette, manifest["region"])
    names = {operator["name"], *operator.get("aliases", [])}
    ref_aliases = operator.get("ref_aliases", {})
    expected_lines, direct, route_count, report_lines = defaultdict(set), {}, 0, []
    for line in lines:
        assert line["relation_ids"] and len(set(line["relation_ids"])) == len(line["relation_ids"]), line["line_key"]
        masters, members, identity, seen = line.get("master_ids", []), set(), {}, {}
        for master_key in masters:
            master_tags = tags(objects[master_key])
            assert master_tags.get("type") == "route_master" and master_tags.get("route_master") == line["mode"], master_key
            children = {member.attrib["type"] + "/" + member.attrib["ref"] for member in objects[master_key].findall("member")}
            assert set(line["relation_ids"]).issubset(children), master_key
            identity.update({field: master_tags[field] for field in IDENTITY if master_tags.get(field)})
            seen.setdefault("master", []).append(master_tags)
        for route_key in line["relation_ids"]:
            route_tags = tags(objects[route_key])
            assert route_tags.get("route") == line["mode"], route_key
            route_count += 1
            route_members = {member.attrib["type"] + "/" + member.attrib["ref"] for member in objects[route_key].findall("member")}
            assert route_members.issubset(objects), route_key
            members |= route_members
            identity.update({field: route_tags[field] for field in IDENTITY if route_tags.get(field)})
            seen.setdefault("route", []).append(route_tags)
        assert set(line["members"]) == members, line["line_key"]
        # Identity is re-derived with the build's stated rule: an operator or network tag that
        # names the configured operator, plus the ref; otherwise the relation's own typed id.
        supported = names.intersection(value for field, value in identity.items() if field in ("operator", "network"))
        if supported:
            ref = ref_aliases.get(identity.get("ref", ""), identity.get("ref", ""))
            assert line["operator_key"] == operator_key and line["ref"] == ref, line["line_key"]
            assert ref and line["line_key"] == f"{operator_key}/{ref}", line["line_key"]
        else:
            assert line["operator_key"] is None and line["line_key"] in {f"osm/{key}" for key in masters + line["relation_ids"]}, line["line_key"]
        rendered = set()
        for key in members:
            p = records.get(key, {}).get("properties", {})
            if p.get("feature_kind") == "track" and p.get("rail_mode") == line["mode"]:
                rendered.add(key)
                expected_lines[key].add(line["line_key"])
        assert set(line["rendered_tracks"]) == rendered, line["line_key"]
        direct[line["line_key"]] = members
        own = [value for kind in ("master", "route") for value in seen.get(kind, [])]
        report_lines.append({"line_key": line["line_key"], "mode": line["mode"], "ref": line["ref"], "name": line["name"],
            "identity": "route_master" if masters else "route relation", "directions": len(line["relation_ids"]),
            "member_ways": sum(key.startswith("way/") for key in members), "rendered_tracks": len(rendered),
            "missing_members": len(line["missing_members"]), "completeness": line["completeness"],
            "color": line["color"], "confidence": line["confidence"], "color_source": line["color_source"],
            "source_operator_tags": sorted({value["operator"] for value in own if value.get("operator")}),
            "source_network_tags": sorted({value["network"] for value in own if value.get("network")}),
            "source_colour_tags": sorted({value["colour"] for value in own if value.get("colour")}),
            "source_name_tags": sum(bool(value.get("name")) for value in own), "source_relations": len(own)})
    for key, feature in records.items():
        p = feature["properties"]
        # A record may only name lines that this snapshot publishes.
        assert set(p.get("line_keys") or []) <= set(direct), key
        if p["feature_kind"] == "track":
            assert set(p["line_keys"]) == expected_lines.get(key, set()), key
        if p.get("line_membership_source") == "stop_area relation":
            for line_key in p["line_keys"]:
                confirmed = False
                for area_key in p["line_link_evidence"]:
                    area = objects[area_key]
                    assert tags(area).get("public_transport") == "stop_area", area_key
                    area_members = {member.attrib["type"] + "/" + member.attrib["ref"] for member in area.findall("member")}
                    assert key in area_members, area_key
                    if area_members.intersection(direct[line_key]):
                        confirmed = True
                assert confirmed, key
    urban = {key: feature["properties"] for key, feature in records.items()
        if feature["properties"]["feature_kind"] == "track" and feature["properties"]["rail_mode"] in URBAN}
    findings = {
        "lines_without_route_master": [line["line_key"] for line in report_lines if line["identity"] != "route_master"],
        "lines_with_several_operator_spellings": {line["line_key"]: line["source_operator_tags"]
            for line in report_lines if len(line["source_operator_tags"]) > 1},
        "lines_without_any_operator_tag": [line["line_key"] for line in report_lines if not line["source_operator_tags"]],
        "lines_without_any_colour_tag": [line["line_key"] for line in report_lines if not line["source_colour_tags"]],
        "lines_with_colour_tag_differing_from_palette": [line["line_key"] for line in report_lines
            if line["source_colour_tags"] and not any(colour.lower() == line["color"].lower() for colour in line["source_colour_tags"])],
        "lines_with_unnamed_source_relations": [line["line_key"] for line in report_lines if line["source_name_tags"] < line["source_relations"]],
        "lines_with_identity_warnings": [line["line_key"] for line in lines if line.get("identity_warnings")],
        "urban_tracks_published": len(urban),
        "urban_tracks_in_route_relations": sum(bool(p["line_keys"]) for p in urban.values()),
        "urban_tracks_outside_route_relations": sum(not p["line_keys"] for p in urban.values()),
    }
    if expect_lines is not None:
        assert len(lines) == expect_lines, f"expected {expect_lines} lines, found {len(lines)}"
    if expect_directions is not None:
        assert route_count == expect_directions, f"expected {expect_directions} direction relations, found {route_count}"
    return {"date": datetime.now(timezone.utc).isoformat(), "snapshot": manifest["snapshot_id"], "region": manifest["region"],
        "source_time": manifest["source"].get("source_time"), "source_xml_sha256": manifest["source"]["sha256"],
        "palette_version": manifest.get("palette_version"), "operator_key": operator_key,
        "published_objects_checked": len(records), "route_directions": route_count, "route_masters": sum(len(line.get("master_ids", [])) for line in lines),
        "lines": report_lines, "findings": findings,
        "checks": ["every published record's original tags, version, timestamp and changeset match the preserved XML",
            "every line identity is re-derived from route_master membership, operator/network tags and ref, or the relation's typed id",
            "every direct route reference, rendered track membership and per-track line list reconciles",
            "every stop-area line link has a source relation that contains the record and a direct member of that line"],
        "scope": "Source fidelity and identity audit. Member counts describe the source only: they do not show that an operating line is complete, and they are not independent human review or MVP acceptance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--expect-lines", type=int)
    parser.add_argument("--expect-directions", type=int)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = audit(args.folder, args.xml, args.expect_lines, args.expect_directions)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open("x", encoding="utf-8") as stream:
            stream.write(text + "\n")
    print(json.dumps({key: result[key] for key in ("snapshot", "region", "published_objects_checked", "route_directions", "route_masters")}
        | {"lines": [{key: line[key] for key in ("line_key", "identity", "directions", "member_ways", "rendered_tracks", "confidence")}
                     for line in result["lines"]], "findings": result["findings"]}, ensure_ascii=False))
