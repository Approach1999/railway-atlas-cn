import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.error import HTTPError

from basemap_proxy import BasemapProxy, PNG, USER_AGENT, coordinates, lifetime


class Response(io.BytesIO):
    def __init__(self, body=PNG + b"fixture", headers=None):
        super().__init__(body)
        self.headers = headers or {"Cache-Control": "max-age=60", "ETag": '"tile-v1"'}
        self.code = 200


class ProxyTests(unittest.TestCase):
    def test_fresh_disk_cache_identification_and_origin_only_referrer(self):
        with TemporaryDirectory() as directory:
            calls = []
            def fetch(request, timeout):
                calls.append(request)
                self.assertEqual(timeout, 8)
                return Response(headers={"Cache-Control": "max-age=60", "Age": "10", "ETag": '"one"'})
            proxy = BasemapProxy(directory, fetcher=fetch, clock=lambda: 1000)
            first = proxy.tile("/preview-basemap/10/863/381.png", "http://192.168.1.2:8766/?feature=node/1#map=secret")
            self.assertEqual(calls[0].full_url, "https://tile.openstreetmap.org/10/863/381.png")
            self.assertEqual(calls[0].get_header("User-agent"), USER_AGENT)
            self.assertEqual(calls[0].get_header("Referer"), "http://192.168.1.2:8766/")
            self.assertIsNone(calls[0].get_header("Pragma"))
            def no_network(*args, **kwargs):
                self.fail("Fresh tiles must be served from persistent cache")
            again = BasemapProxy(directory, fetcher=no_network, clock=lambda: 1020).tile(
                "/preview-basemap/10/863/381.png", "http://192.168.1.2:8766/")
            self.assertEqual(first[0], again[0])
            self.assertEqual(again[1]["Age"], "30")

    def test_expired_tile_uses_conditional_request_and_304_preserves_body(self):
        with TemporaryDirectory() as directory:
            clock = [1000]
            calls = []
            def fetch(request, timeout):
                calls.append(request)
                if len(calls) == 1:
                    return Response(headers={"Cache-Control": "max-age=10", "ETag": '"one"'})
                self.assertEqual(request.get_header("If-none-match"), '"one"')
                raise HTTPError(request.full_url, 304, "Not Modified", {"Cache-Control": "max-age=60"}, io.BytesIO())
            proxy = BasemapProxy(directory, fetcher=fetch, clock=lambda: clock[0])
            first = proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            clock[0] = 1011
            second = proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            self.assertEqual(second[0], first[0])
            self.assertEqual(second[1]["ETag"], '"one"')
            self.assertEqual(len(calls), 2)

    def test_no_store_is_not_written_and_non_png_is_rejected(self):
        with TemporaryDirectory() as directory:
            proxy = BasemapProxy(directory, fetcher=lambda *a, **k: Response(headers={"Cache-Control": "no-store"}))
            proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            self.assertEqual(list(Path(directory).iterdir()), [])
            proxy = BasemapProxy(directory, fetcher=lambda *a, **k: Response(body=b"<html>blocked</html>"))
            with self.assertRaisesRegex(ValueError, "PNG"):
                proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_arbitrary_urls_paths_and_out_of_range_tiles_never_fetch(self):
        with TemporaryDirectory() as directory:
            proxy = BasemapProxy(directory, fetcher=lambda *a, **k: self.fail("Must reject before network"))
            for path in ["http://example.com", "/preview-basemap/../secret", "/preview-basemap/20/0/0.png", "/preview-basemap/1/2/0.png", "/preview-basemap/1/0/2.png"]:
                with self.assertRaises(ValueError):
                    proxy.tile(path, "http://localhost/")
            with self.assertRaises(ValueError):
                proxy.tile("/preview-basemap/0/0/0.png", "http://user:password@localhost/")

    def test_no_store_revalidation_removes_an_old_cached_copy(self):
        with TemporaryDirectory() as directory:
            clock = [1000]
            def fetch(*args, **kwargs):
                return Response(headers={"Cache-Control": "max-age=1" if clock[0] == 1000 else "no-store"})
            proxy = BasemapProxy(directory, fetcher=fetch, clock=lambda: clock[0])
            proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
            clock[0] = 1002
            proxy.tile("/preview-basemap/0/0/0.png", "http://localhost/")
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_expiry_and_minimum_fallback_policy(self):
        self.assertEqual(lifetime({}, 1000), 604800)
        self.assertEqual(lifetime({"Cache-Control": "no-cache, max-age=100"}, 1000), 0)
        self.assertEqual(lifetime({"Cache-Control": "max-age=60", "Age": "61"}, 1000), 0)
        self.assertEqual(coordinates("/preview-basemap/19/524287/524287.png"), (19, 524287, 524287))


if __name__ == "__main__":
    unittest.main()
