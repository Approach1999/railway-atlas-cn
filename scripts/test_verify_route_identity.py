"""The route identity audit on a small synthetic snapshot with its own preserved XML."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from verify_route_identity import audit


def element(kind, identity, tags, members=(), nodes=(), **attributes):
    node = ET.Element(kind, **{"id": str(identity), "version": "3", "timestamp": "2026-01-02T03:04:05Z", **attributes})
    for key, value in tags.items():
        ET.SubElement(node, "tag", k=key, v=value)
    for ref in nodes:
        ET.SubElement(node, "nd", ref=str(ref))
    for member in members:
        ET.SubElement(node, "member", type=member[0], ref=str(member[1]), role=member[2])
    return node


def build(root, route_tags, with_master=True, operators=None, line=None, record_line="test-metro/1"):
    """A snapshot of one subway line under `root`: two directions under one master, one track and one stop area.
    Its preserved extract is written next to the snapshot folder."""
    routes = {"type": "route", "route": "subway", "ref": "1", "colour": "#112233", "name": "Line 1", **route_tags}
    master = {"type": "route_master", "route_master": "subway", "ref": "1", "network": "Test Metro", "name": "Line 1", **route_tags}
    document = ET.Element("osm")
    for node in [element("node", 1, {}), element("node", 2, {}),
                 element("node", 5, {"railway": "station", "station": "subway", "name": "A"}),
                 element("node", 6, {"public_transport": "stop_position", "railway": "stop", "subway": "yes"}),
                 element("way", 100, {"railway": "subway"}, nodes=(1, 2)),
                 element("relation", 10, routes, [("way", 100, ""), ("node", 6, "stop")]),
                 element("relation", 11, routes, [("way", 100, ""), ("node", 6, "stop")]),
                 element("relation", 13, {"type": "public_transport", "public_transport": "stop_area", "name": "A"},
                         [("node", 5, "station"), ("node", 6, "stop")])]:
        document.append(node)
    if with_master:
        document.append(element("relation", 12, master, [("relation", 10, ""), ("relation", 11, "")]))
    root.parent.mkdir(parents=True, exist_ok=True)
    root.mkdir(parents=True, exist_ok=True)
    source = root.parent / "extract.osm"
    source.write_text(ET.tostring(document, encoding="unicode"), encoding="utf-8")
    (root / "dataset.json").write_text(json.dumps({"snapshot_id": "fixture-20260101", "region": "test", "palette_version": "x",
        "source": {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source_time": "2026-01-01T00:00:00Z"}}), encoding="utf-8")
    palette_operators = operators if operators is not None else {"test-metro": {"name": "Test Metro", "region": "test", "aliases": []}}
    (root / "palette.json").write_text(json.dumps({"operators": palette_operators}), encoding="utf-8")
    properties = {"osm_version": 3, "osm_timestamp": "2026-01-02 03:04:05+00:00", "status": "mapped", "line_keys": [record_line]}
    records = {
        "way/100": {"osm_id": "way/100", "feature_kind": "track", "rail_mode": "subway", "tags": {"railway": "subway"},
                    "line_membership_source": "route relation", **properties},
        "node/6": {"osm_id": "node/6", "feature_kind": "facility", "rail_mode": "subway",
                   "tags": {"public_transport": "stop_position", "railway": "stop", "subway": "yes"},
                   "line_membership_source": "route relation", **properties},
        "node/5": {"osm_id": "node/5", "feature_kind": "station", "rail_mode": "subway",
                   "tags": {"railway": "station", "station": "subway", "name": "A"},
                   "line_membership_source": "stop_area relation", "line_link_evidence": ["relation/13"], **properties}}
    details = root / "details"
    details.mkdir(exist_ok=True)
    for key, record in records.items():
        shard = hashlib.sha256(key.encode()).hexdigest()[:2] + ".json"
        path = details / shard
        shards = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        shards[key] = {"type": "Feature", "properties": record}
        path.write_text(json.dumps(shards), encoding="utf-8")
    identified = line or {"line_key": "test-metro/1", "operator_key": "test-metro", "ref": "1", "name": "Line 1", "mode": "subway",
        "relation_ids": ["relation/10", "relation/11"], "members": ["node/6", "way/100"], "missing_members": [],
        "rendered_tracks": ["way/100"], "master_ids": ["relation/12"], "identity_source": "route_master relation",
        "identity_warnings": [], "completeness": "members_present", "color": "#112233", "confidence": "manual", "color_source": "manual"}
    (root / "lines.json").write_text(json.dumps({"snapshot_id": "fixture-20260101", "lines": [identified]}), encoding="utf-8")


def tagged(route_tags, **options):
    route_tags.update({"operator": "Test Metro", "network": "Test Metro"})
    return dict(options, route_tags=route_tags)


class RouteIdentityAuditTests(unittest.TestCase):
    def snapshot(self, **options):
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        root = Path(holder.name) / "fixture-20260101"
        build(root, **options)
        return root, root.parent / "extract.osm"

    def test_a_consistent_snapshot_passes_and_reports_what_the_source_contains(self):
        root, xml = self.snapshot(route_tags={"operator": "Test Metro", "network": "Test Metro"})
        result = audit(root, xml, expect_lines=1, expect_directions=2)
        self.assertEqual((result["route_directions"], result["route_masters"], result["published_objects_checked"]), (2, 1, 3))
        line = result["lines"][0]
        self.assertEqual((line["identity"], line["member_ways"], line["rendered_tracks"], line["confidence"]), ("route_master", 1, 1, "manual"))
        self.assertEqual(line["source_operator_tags"], ["Test Metro"])
        self.assertEqual(result["findings"]["urban_tracks_published"], 1)
        self.assertEqual(result["findings"]["urban_tracks_in_route_relations"], 1)
        self.assertEqual(result["findings"]["lines_with_several_operator_spellings"], {})
        self.assertEqual(result["findings"]["lines_with_colour_tag_differing_from_palette"], [])

    def test_lines_without_a_master_fall_back_to_the_relation_identity_and_are_reported(self):
        untagged = {"line_key": "osm/relation/10", "operator_key": None, "ref": "1", "name": "Line 1", "mode": "subway",
            "relation_ids": ["relation/10", "relation/11"], "members": ["node/6", "way/100"], "missing_members": [],
            "rendered_tracks": ["way/100"], "master_ids": [], "identity_source": "route relation", "identity_warnings": [],
            "completeness": "members_present", "color": "#8657A6", "confidence": "fallback", "color_source": "fallback"}
        root, xml = self.snapshot(route_tags={}, with_master=False, line=untagged, record_line="osm/relation/10")
        result = audit(root, xml)
        self.assertEqual(result["lines"][0]["identity"], "route relation")
        self.assertEqual(result["findings"]["lines_without_route_master"], ["osm/relation/10"])
        self.assertEqual(result["findings"]["lines_without_any_operator_tag"], ["osm/relation/10"])

    def test_tampered_publications_are_refused_before_any_count_is_believed(self):
        consistent = {"line_key": "test-metro/1", "operator_key": "test-metro", "ref": "1", "name": "Line 1", "mode": "subway",
            "relation_ids": ["relation/10", "relation/11"], "members": ["node/6", "way/100"], "missing_members": [],
            "rendered_tracks": ["way/100"], "master_ids": ["relation/12"], "identity_source": "route_master relation",
            "identity_warnings": [], "completeness": "members_present", "color": "#112233", "confidence": "manual", "color_source": "manual"}
        tags = {"operator": "Test Metro", "network": "Test Metro"}
        for change in [lambda line: line.update(line_key="test-metro/9"), lambda line: line.update(operator_key="other"),
                       lambda line: line.update(relation_ids=["relation/10", "relation/13"]),
                       lambda line: line.update(members=["way/100"]), lambda line: line.update(rendered_tracks=[]),
                       lambda line: line.update(master_ids=["relation/13"]), lambda line: line.update(ref="01")]:
            line = dict(consistent)
            change(line)
            root, xml = self.snapshot(route_tags=tags, line=line)
            with self.subTest(line=line), self.assertRaises(AssertionError):
                audit(root, xml)
        for operators in [{}, {"a": {"name": "A", "region": "test"}, "b": {"name": "B", "region": "test"}},
                          {"x": {"name": "Test Metro", "region": "elsewhere"}}]:
            root, xml = self.snapshot(route_tags=tags, operators=operators)
            with self.subTest(operators=operators), self.assertRaises((ValueError, AssertionError)):
                audit(root, xml)
        root, xml = self.snapshot(route_tags=tags)
        with self.assertRaises(AssertionError):
            audit(root, xml, expect_lines=2)
        with self.assertRaises(AssertionError):
            audit(root, xml, expect_directions=4)

    def test_records_that_drift_from_the_preserved_xml_or_its_fingerprint_are_refused(self):
        root, xml = self.snapshot(route_tags={"operator": "Test Metro", "network": "Test Metro"})
        shard = root / "details" / (hashlib.sha256(b"way/100").hexdigest()[:2] + ".json")
        original = shard.read_text(encoding="utf-8")
        for mutate in [lambda record: record["properties"]["tags"].update(railway="tram"),
                       lambda record: record["properties"].update(osm_version=4),
                       lambda record: record["properties"].update(osm_timestamp="2026-01-03 03:04:05+00:00"),
                       lambda record: record["properties"].update(line_keys=[])]:
            shards = json.loads(original)
            mutate(shards["way/100"])
            shard.write_text(json.dumps(shards), encoding="utf-8")
            with self.subTest(record=shards["way/100"]["properties"]), self.assertRaises(AssertionError):
                audit(root, xml)
        shard.write_text(original, encoding="utf-8")
        # The same snapshot audited against another extract is refused by fingerprint. An identical
        # copy has the same fingerprint and is, correctly, accepted.
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        other = Path(holder.name) / "fixture-20260101"
        build(other, route_tags={"operator": "Test Metro", "network": "Test Metro"})
        self.assertEqual(audit(root, other.parent / "extract.osm")["snapshot"], "fixture-20260101")
        changed = Path(holder.name) / "changed"
        build(changed, route_tags={"operator": "Another Operator", "network": "Test Metro"})
        with self.assertRaises(AssertionError):
            audit(root, changed.parent / "extract.osm")


if __name__ == "__main__":
    unittest.main()
