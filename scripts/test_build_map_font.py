import json
from pathlib import Path
import tempfile
import unittest
from build_map_font import collect_map_names

class MapFontCoverageTests(unittest.TestCase):
    def test_independent_station_and_route_indexes_contribute_glyphs_and_fingerprints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'config').mkdir()
            (root / 'config/catalog.json').write_text(json.dumps({'regions': [{'snapshots': ['fixture']}]}))
            data = root / 'data/processed/fixture'; data.mkdir(parents=True)
            (data / 'features.geojson').write_text(json.dumps({'features': [{'properties': {'display_name': '沈阳线'}}]}))
            (data / 'stations.geojson').write_text(json.dumps({'features': [{'properties': {'display_name': '霁虹站'}}]}))
            (data / 'lines.json').write_text(json.dumps({'lines': [{'name': 'Ω号线', 'ref': 'Α'}]}))
            codes, inputs, counts = collect_map_names(root)
            self.assertTrue(set(map(ord, '沈阳线霁虹站ΩΑ')).issubset(codes))
            self.assertEqual(len(inputs), 4)
            self.assertEqual(counts['fixture'], {'features.geojson': 1, 'stations.geojson': 1, 'lines.json': 1})
            (data / 'stations.geojson').unlink()
            with self.assertRaises(FileNotFoundError):
                collect_map_names(root)

if __name__ == '__main__':
    unittest.main()
