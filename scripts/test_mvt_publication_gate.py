"""Exercise the real publisher control flow with controlled subprocess outputs."""
import contextlib
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import build_mvp


class MvtPublicationGateTests(unittest.TestCase):
    def fixture(self, parent):
        """A source, its extract record and conversion metadata inside a fresh folder."""
        root = Path(parent)
        source = root / "fixture.osm.pbf"
        source.write_bytes(b"controlled subprocess fixture")
        build_mvp.write(root / "source.json", {"sha256": "fixture-xml", "bbox": [-1, -1, 1, 1]})
        build_mvp.write(root / "metadata.json", {"pbf_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "xml_sha256": "fixture-xml", "records": {}})
        return root, source

    def test_decoder_failure_blocks_final_publication_after_manifest_exists(self):
        parent = build_mvp.ROOT / "data/manifests/local/mvt-gate-tests"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            root, source = self.fixture(tmp)
            self.assertTrue(root.resolve().is_relative_to(parent.resolve()))
            target = root / "shenyang-blocked-snapshot"
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

    def test_a_version_is_named_for_its_region_and_built_only_from_that_regions_extract(self):
        parent = build_mvp.ROOT / "data/manifests/local/mvt-gate-tests"
        parent.mkdir(parents=True, exist_ok=True)
        for extra, folder, message in [
            ([], "dalian-looking", "must start with"),                    # the default region is shenyang
            (["--region", "shenyang"], "elsewhere-snapshot", "must start with"),
            (["--region", "dalian"], "dalian-foreign-source", "another region"),   # the extract is shenyang's
            (["--region", "beijing"], "beijing-unknown", "not configured"),       # not a configured region
        ]:
            with self.subTest(extra=extra, folder=folder), tempfile.TemporaryDirectory(dir=parent) as tmp:
                root, source = self.fixture(tmp)
                build_mvp.write(root / "source.json", {"sha256": "fixture-xml", "bbox": [-1, -1, 1, 1], "region": "shenyang"})
                target = root / folder
                argv = ["build_mvp", "--input", str(source), "--source-manifest", str(root / "source.json"),
                        "--metadata", str(root / "metadata.json"), "--output-dir", str(target), *extra]
                reported = io.StringIO()
                with contextlib.redirect_stderr(reported), patch.object(sys, "argv", argv), \
                        patch.object(build_mvp.subprocess, "run", side_effect=AssertionError("no build command may run")), \
                        self.assertRaises(SystemExit) as stopped:
                    build_mvp.main()
                self.assertEqual(stopped.exception.code, 2)
                self.assertIn(message, reported.getvalue())
                self.assertFalse(target.exists())
                self.assertEqual([path.name for path in root.iterdir() if "building" in path.name], [])


if __name__ == "__main__":
    unittest.main()
