import gzip
from pathlib import Path
import tempfile
import unittest
from http_payload import accepts_gzip, gzip_payload


class PayloadTests(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[1] / "data/manifests/local/http-tests"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.folder = Path(self.temp.name)
        def cleanup():
            assert self.folder.resolve().is_relative_to(parent.resolve())
            self.temp.cleanup()
        self.addCleanup(cleanup)

    def test_negotiation_respects_explicit_refusal(self):
        self.assertTrue(accepts_gzip("br, gzip, deflate"))
        self.assertTrue(accepts_gzip("*;q=.5"))
        self.assertFalse(accepts_gzip("gzip;q=0, *;q=1"))
        self.assertFalse(accepts_gzip("gzip;q=invalid"))
        self.assertFalse(accepts_gzip(""))

    def test_full_compression_round_trip_and_ranges_remain_identity(self):
        path = self.folder / "tiles.pbf"
        body = b"source geometry and typed identities " * 500
        path.write_bytes(body)
        compressed = gzip_payload(path, "gzip")
        self.assertLess(len(compressed), len(body))
        self.assertEqual(gzip.decompress(compressed), body)
        self.assertEqual(path.read_bytes(), body)
        self.assertIsNone(gzip_payload(path, "gzip", "bytes=4-20"))
        self.assertIsNone(gzip_payload(path, "identity"))

    def test_changed_assets_invalidate_cache_and_archive_types_stay_uncompressed(self):
        path = self.folder / "client.js"
        path.write_bytes(b"first" * 1000)
        first = gzip_payload(path, "gzip")
        path.write_bytes(b"second" * 1000)
        second = gzip_payload(path, "gzip")
        self.assertNotEqual(first, second)
        self.assertEqual(gzip.decompress(second), path.read_bytes())
        archive = self.folder / "source.pmtiles"
        archive.write_bytes(b"archive" * 1000)
        self.assertIsNone(gzip_payload(archive, "gzip"))


if __name__ == "__main__": unittest.main()
