"""Region registry: one configured source of region identities, boundaries and data entry points."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import regions


def registry():
    """A minimal two-region registry whose default is not the first entry."""
    return {"schema_version": 1, "default_region": "b", "regions": [
        {"id": "a", "pipeline": {"region_config": "config/a.json"}},
        {"id": "b", "pipeline": {"region_config": "config/b.json"}}]}


class RegistryTests(unittest.TestCase):
    def root(self, config, files):
        """A throwaway repository root holding a registry and the files it names."""
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        root = Path(holder.name)
        (root / "config").mkdir()
        (root / regions.CATALOG).write_text(json.dumps(config), encoding="utf-8")
        for name, content in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(content), encoding="utf-8")
        return root

    def test_shipped_registry_resolves_every_region_and_its_own_files(self):
        config = regions.catalog()
        ids = [region["id"] for region in config["regions"]]
        self.assertIn(config["default_region"], ids)
        self.assertEqual(len(ids), len(set(ids)))
        for region in config["regions"]:
            extraction = regions.extraction_config(region["id"])
            preview = regions.preview_config(region["id"])
            self.assertEqual(extraction["id"], region["id"])
            self.assertEqual(len(extraction["bbox"]), 4)
            self.assertTrue(region["description"])
            self.assertIn("major_station_keys", preview)
            self.assertIn("station_mode_overrides", preview)
        with self.assertRaises(regions.RegionError):
            regions.extraction_config("beijing")
        with self.assertRaises(regions.RegionError):
            regions.preview_config("../shenyang")

    def test_the_default_region_is_the_configured_one_and_each_region_reads_its_own_file(self):
        files = {"config/a.json": {"id": "a", "bbox": [0, 0, 1, 1]}, "config/b.json": {"id": "b", "bbox": [2, 2, 3, 3]}}
        root = self.root(registry(), files)
        self.assertEqual(regions.default_region(root), "b")
        self.assertEqual(regions.extraction_config("b", root)["bbox"], [2, 2, 3, 3])
        self.assertEqual(regions.extraction_config("a", root)["bbox"], [0, 0, 1, 1])
        with self.assertRaises(regions.RegionError):
            regions.extraction_config("c", root)

    def test_malformed_registries_and_region_files_are_refused(self):
        def breaking():
            yield lambda config: config.update(schema_version=2)
            yield lambda config: config.update(default_region="missing")
            yield lambda config: config.pop("default_region")
            yield lambda config: config.update(regions=[])
            yield lambda config: config["regions"].append({"id": "a", "pipeline": {"region_config": "config/a.json"}})
            yield lambda config: config["regions"][0].update(id="../a")
            yield lambda config: config["regions"][0].update(id=None)
            yield lambda config: config["regions"][0].pop("pipeline")
            yield lambda config: config["regions"][0].update(pipeline={"region_config": "../outside.json"})
            yield lambda config: config["regions"][0].update(pipeline={"region_config": "config/other.json"})
            yield lambda config: config["regions"][0].update(pipeline={})
        files = {"config/a.json": {"id": "a", "bbox": [0, 0, 1, 1]},
                 "config/other.json": {"id": "other", "bbox": [0, 0, 1, 1]}}
        for break_registry in breaking():
            config = registry()
            break_registry(config)
            root = self.root(config, files)
            with self.subTest(config=config), self.assertRaises((regions.RegionError, FileNotFoundError)):
                regions.extraction_config("a", root)
        for config in [None, [], "regions", {"schema_version": 1, "regions": [None], "default_region": "a"}]:
            root = self.root(config, {})
            with self.subTest(config=config), self.assertRaises(regions.RegionError):
                regions.catalog(root)
        # A file whose own id disagrees with the registry, or an unordered rectangle, is not that region.
        for content in [{"id": "z", "bbox": [0, 0, 1, 1]}, {"id": "a", "bbox": [1, 0, 0, 1]}, {"id": "a", "bbox": [0, 0, 1]},
                        {"id": "a", "bbox": [0, 0, float("nan"), 1]}, {"id": "a", "bbox": [0, 0, True, 1]}]:
            root = self.root(registry(), {"config/a.json": content})
            with self.subTest(content=content), self.assertRaises(regions.RegionError):
                regions.extraction_config("a", root)

    def test_region_argument_defaults_to_the_registry_and_reports_an_unreadable_one_as_usage(self):
        parser = argparse.ArgumentParser()
        regions.region_argument(parser, regions.ROOT)
        self.assertEqual(parser.parse_args([]).region, regions.catalog()["default_region"])
        self.assertEqual(parser.parse_args(["--region", "dalian"]).region, "dalian")
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stopped:
            regions.region_argument(argparse.ArgumentParser(), Path(holder.name))
        self.assertEqual(stopped.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
