"""Exercise the real publisher control flow with controlled subprocess outputs."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import build_mvp


class MvtPublicationGateTests(unittest.TestCase):
    def test_decoder_failure_blocks_final_publication_after_manifest_exists(self):
        parent = build_mvp.ROOT / "data/manifests/local/mvt-gate-tests"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            root = Path(tmp)
            self.assertTrue(root.resolve().is_relative_to(parent.resolve()))
            source = root / "fixture.osm.pbf"
            source.write_bytes(b"controlled subprocess fixture")
            build_mvp.write(root / "source.json", {"sha256": "fixture-xml", "bbox": [-1, -1, 1, 1]})
            build_mvp.write(root / "metadata.json", {"pbf_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "xml_sha256": "fixture-xml", "records": {}})
            target = root / "blocked-snapshot"
            calls = []
            def stage(command, **kwargs):
                calls.append(command)
                if len(calls) == 2:
                    build_mvp.write(command[2], {"features": [{"type": "Feature", "properties": {
                        "osm_id": "way/901", "feature_kind": "track", "railway": "rail", "rail_mode": "rail",
                        "line_class": "conventional_main", "status": "mapped", "display_name": "Fixture",
                        "tags": {"railway": "rail"}}, "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}}], "relations": []})
                    build_mvp.write(command[3], {"candidate_objects": 1, "missing_way_node_refs": 0, "missing_relation_member_refs": 0})
                elif len(calls) == 3:
                    self.assertTrue(command[1].endswith("build-tiles.mjs"))
                    tiles = Path(command[3])
                    tiles.mkdir()
                    build_mvp.write(tiles / "build.json", {"builder": "fixture", "minzoom": 8, "maxzoom": 15,
                        "source_layers": ["rail_tracks"], "bounds": [-1, -1, 1, 1], "tile_count": 0, "total_bytes": 0, "files": []})
                elif len(calls) == 4:
                    self.assertTrue(command[1].endswith("verify_mvt_integrity.mjs"))
                    self.assertTrue((Path(command[2]) / "dataset.json").is_file())
                    self.assertFalse(target.exists())
                    raise build_mvp.subprocess.CalledProcessError(1, command)
                elif len(calls) > 4:
                    self.fail("No further publish commands expected")
            argv = ["build_mvp", "--input", str(source), "--source-manifest", str(root / "source.json"),
                    "--metadata", str(root / "metadata.json"), "--output-dir", str(target)]
            with patch.object(sys, "argv", argv), patch.object(build_mvp.subprocess, "run", stage):
                with self.assertRaises(build_mvp.subprocess.CalledProcessError):
                    build_mvp.main()
            self.assertEqual(len(calls), 4)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
