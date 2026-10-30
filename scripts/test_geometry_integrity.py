import copy
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from geometry_integrity import validate_geometry
import build_mvp
import verify_snapshot


class GeometryIntegrityTests(unittest.TestCase):
    def test_valid_paths_closure_shared_junctions_and_small_ring_are_not_mutated(self):
        values = [
            {"type": "Point", "coordinates": [123.4, 41.8]},
            {"type": "LineString", "coordinates": [[0, 0], [1, 0], [0, 0]]},
            {"type": "MultiLineString", "coordinates": [[[0, 0], [1, 0]], [[1, 0], [2, 0]]]},
            {"type": "Polygon", "coordinates": [[[123.4, 41.8], [123.4000001, 41.8], [123.4, 41.8000001], [123.4, 41.8]]]},
        ]
        original = copy.deepcopy(values)
        self.assertEqual([validate_geometry(v)["type"] for v in values], [v["type"] for v in values])
        self.assertEqual(values, original)

    def test_bad_coordinates_cannot_hide_as_bool_nan_infinity_or_extra_dimensions(self):
        for point in [[True, 1], [0, float("nan")], [float("inf"), 0], [10**1000, 0], [181, 0], [0, -91], [0, 0, 2], ["0", 0]]:
            with self.subTest(point=repr(point)):
                with self.assertRaisesRegex(ValueError, "way/7: invalid_"):
                    validate_geometry({"type": "Point", "coordinates": point}, "way/7")

    def test_duplicate_and_zero_length_paths_report_source_identity(self):
        for points, reason in [([[0, 0], [0, 0]], "zero_length_edge"),
                               ([[0, 0], [1, 1], [0, 0], [2, 2]], "repeated_nonclosing_position"),
                               ([[0, 0]], "too_few_positions")]:
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, "way/9: " + reason):
                validate_geometry({"type": "LineString", "coordinates": points}, "way/9")

    def test_ring_must_be_closed_nonzero_area_and_without_internal_repetition(self):
        cases = [([[0, 0], [1, 0], [0, 1], [2, 2]], "unclosed_ring"),
                 ([[0, 0], [1, 1], [2, 2], [0, 0]], "zero_area_ring"),
                 ([[0, 0], [1, 0], [1, 1], [1, 0], [0, 0]], "repeated_nonclosing_position")]
        for ring, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                validate_geometry({"type": "Polygon", "coordinates": [ring]})

    def test_each_ring_and_part_is_checked_and_unsupported_detail_types_are_rejected(self):
        good = [[0, 0], [3, 0], [0, 3], [0, 0]]
        with self.assertRaisesRegex(ValueError, r"zero_area_ring at coordinates\[1\]"):
            validate_geometry({"type": "Polygon", "coordinates": [good, [[0, 0], [1, 1], [2, 2], [0, 0]]]})
        for value in [None, {"type": "Polygon", "coordinates": []}, {"type": "GeometryCollection", "geometries": []},
                      {"type": "MultiPolygon", "coordinates": [[good]]}, {"type": "MultiLineString", "coordinates": []}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_geometry(value)

    def test_build_main_rejects_bad_geometry_before_tiling_or_publishing(self):
        parent = build_mvp.ROOT / "data/manifests/local/geometry-tests"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            root = Path(tmp)
            self.assertTrue(root.resolve().is_relative_to(parent.resolve()))
            source = root / "fixture.osm.pbf"
            source.write_bytes(b"fixture only: Rust output is controlled")
            build_mvp.write(root / "source.json", {"sha256": "fixture-xml"})
            build_mvp.write(root / "metadata.json", {"pbf_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "xml_sha256": "fixture-xml", "records": {}})
            calls = []
            def stage(command, **kwargs):
                calls.append(command)
                if len(calls) == 2:
                    build_mvp.write(command[2], {"features": [{"type": "Feature", "properties": {"osm_id": "way/900", "railway": "station", "feature_kind": "station_area"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2], [0, 0]]]}}], "relations": []})
                    build_mvp.write(command[3], {"missing_way_node_refs": 0, "missing_relation_member_refs": 0})
                elif len(calls) > 2:
                    self.fail("Tiler must not run for invalid geometry")
            target = root / "must-not-publish"
            argv = ["build_mvp", "--input", str(source), "--source-manifest", str(root / "source.json"),
                    "--metadata", str(root / "metadata.json"), "--output-dir", str(target)]
            with patch.object(sys, "argv", argv), patch.object(build_mvp.subprocess, "run", stage):
                with self.assertRaisesRegex(ValueError, "way/900: zero_area_ring"):
                    build_mvp.main()
            self.assertEqual(len(calls), 2)
            self.assertFalse(target.exists())

    def test_snapshot_rejects_geometry_even_when_file_hashes_are_self_consistent(self):
        parent = build_mvp.ROOT / "data/manifests/local/geometry-tests"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            root = Path(tmp)
            self.assertTrue(root.resolve().is_relative_to(parent.resolve()))
            (root / "details").mkdir()
            (root / "tiles").mkdir()
            key = "way/901"
            shard = "details/" + hashlib.sha256(key.encode()).hexdigest()[:2] + ".json"
            feature = {"type": "Feature", "properties": {"osm_id": key, "feature_kind": "track"},
                       "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}}
            quality = {"candidate_objects": 1, "published_features": 1, "relation_records": 0,
                       "excluded_count": 0, "excluded": [], "facility_counts": {},
                       "missing_way_node_refs": 0, "missing_relation_member_refs": 0}
            build_mvp.write(root / "quality.json", quality)
            build_mvp.write(root / "tiles/build.json", {})
            build_mvp.write(root / "stations.geojson", {"type": "FeatureCollection", "features": []})
            def save():
                build_mvp.write(root / shard, {key: feature})
                files = {name: {"bytes": (root / name).stat().st_size, "sha256": build_mvp.digest(root / name)}
                         for name in [shard, "quality.json", "tiles/build.json"]}
                build_mvp.write(root / "dataset.json", {"schema_version": 2, "snapshot_id": root.name, "files": files,
                    "tile_index_sha256": build_mvp.digest(root / "tiles/build.json"), "tiles": {"tile_count": 0, "total_bytes": 0}})
            save()
            self.assertEqual(verify_snapshot.verify(root)["geometry"]["features"], 1)
            feature["geometry"]["coordinates"] = [[0, 0], [1, 1], [0, 0], [2, 2]]
            save()  # Recompute all hashes: integrity alone must not certify bad geometry.
            with self.assertRaisesRegex(ValueError, "way/901: repeated_nonclosing_position"):
                verify_snapshot.verify(root)


if __name__ == "__main__":
    unittest.main()
