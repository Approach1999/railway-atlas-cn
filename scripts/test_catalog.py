from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from catalog import build_catalog, expired, read_manifest


class CatalogTests(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[1] / "data/manifests/local/catalog-tests"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name)
        def cleanup():
            assert self.root.resolve().is_relative_to(parent.resolve())
            self.temp.cleanup()
        self.addCleanup(cleanup)
        self.config = {"regions": [{"id": "shenyang", "name": "沈阳试验区", "default_view": {"zoom": 10.5},
            "snapshots": ["old", "expired", "missing", "incomplete"]}]}
        for name in ["current", "old", "expired", "incomplete", "unlisted"]:
            folder = self.root / name
            folder.mkdir()
            manifest = {"snapshot_id": name, "schema_version": 2, "region": "shenyang",
                "retention_until": "2025-01-01T00:00:00Z" if name == "expired" else "2028-01-01T00:00:00Z"}
            (folder / "dataset.json").write_text(json.dumps(manifest), encoding="utf-8")
            for file in ["palette.json", "stations.geojson", "lines.json", "tiles/build.json"]:
                if name == "incomplete" and file == "lines.json": continue
                path = folder / file
                path.parent.mkdir(exist_ok=True)
                path.write_text("{}", encoding="utf-8")

    def test_only_explicit_complete_available_snapshots_enter_directory(self):
        catalog = build_catalog(self.config, self.root, "current", datetime(2026, 1, 1, tzinfo=timezone.utc))
        region = catalog["regions"][0]
        self.assertEqual([entry["id"] for entry in region["snapshots"]], ["current", "old"])
        self.assertEqual(region["current_snapshot"], "current")

    def test_retention_boundary_is_explicit(self):
        manifest = {"retention_until": "2027-10-22T12:00:00Z"}
        self.assertFalse(expired(manifest, datetime(2027, 10, 22, 12, tzinfo=timezone.utc)))
        self.assertTrue(expired(manifest, datetime(2027, 10, 22, 12, 0, 1, tzinfo=timezone.utc)))
        with self.assertRaises(ValueError): expired({"retention_until": "2027-10-22"})

    def test_identity_and_path_are_verified(self):
        with self.assertRaises(ValueError): read_manifest(self.root, "../current")
        path = self.root / "old/dataset.json"
        path.write_text('{"snapshot_id":"other"}', encoding="utf-8")
        with self.assertRaises(ValueError): read_manifest(self.root, "old")


if __name__ == "__main__": unittest.main()
