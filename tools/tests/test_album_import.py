import io
import json
import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

from tools.album_import.importer import import_album
from tools.album_import.network import PublicFetcher, check_url
from tools.album_import.server import LocalServer
from tools.album_import.sources import ImportFailure, identify, parse_apple, parse_bandcamp, iso_duration

ROOT = Path(__file__).parent / "fixtures"
PNG = (Path(__file__).parents[2] / "tests/fixtures/cover.png").read_bytes()


class FixtureFetcher:
    """Transport fixtures only. These never claim live access to the named websites."""
    def allow_page(self, url):
        pass

    def read(self, url, **kwargs):
        if "itunes.apple.com" in url:
            return (ROOT / "apple-lookup.json").read_bytes(), "application/json"
        if "bandcamp.com" in url:
            return (ROOT / "bandcamp-album.html").read_bytes(), "text/html"
        return PNG, "image/png"


class ParserTests(unittest.TestCase):
    def test_apple_orders_tracks_without_guessing_ep_or_genre_mapping(self):
        album, warnings = parse_apple(json.loads((ROOT / "apple-lookup.json").read_text()), "123456789")
        self.assertEqual([t["title"] for t in album["tracks"]], ["第一首", "第二首", "第三首"])
        self.assertEqual(album["tracks"][2]["duration"], 200.5)
        self.assertEqual(album["year"], "2024")
        self.assertIsNone(album["releaseType"])
        self.assertEqual(album["referenceGenres"], ["Alternative"])
        self.assertEqual(warnings, [])

    def test_apple_does_not_mix_other_editions_or_make_missing_tracks(self):
        payload = json.loads((ROOT / "apple-lookup.json").read_text())
        payload["results"][1]["collectionId"] = 999
        album, warnings = parse_apple(payload, "123456789")
        self.assertEqual(len(album["tracks"]), 2)
        self.assertIn("只取得 2 首", warnings[0])
        with self.assertRaises(ImportFailure):
            parse_apple(payload, "999")

    def test_bandcamp_reads_graph_order_duration_and_explicit_type(self):
        album, warnings = parse_bandcamp((ROOT / "bandcamp-album.html").read_text())
        self.assertEqual(album["releaseType"], "ep")
        self.assertEqual([t["duration"] for t in album["tracks"]], [180, 210, 200.5])
        self.assertEqual(album["artist"], "测试音乐人")
        self.assertEqual(warnings, [])

    def test_public_embedded_attributes_are_optional_fallback(self):
        page = '<meta property="og:title" content="T, by A"><script data-tralbum="{&quot;artist&quot;:&quot;A&quot;,&quot;current&quot;:{&quot;title&quot;:&quot;T&quot;},&quot;trackinfo&quot;:[{&quot;title&quot;:&quot;Song&quot;,&quot;duration&quot;:12.5}]}"></script>'
        album, warnings = parse_bandcamp(page)
        self.assertEqual(album["title"], "T")
        self.assertEqual(album["tracks"][0]["title"], "Song")
        self.assertEqual(album["year"], "")
        self.assertIsNone(album["releaseType"])
        self.assertIn("发行年份", warnings[0])

    def test_public_duration_variants_and_unknown_values(self):
        self.assertEqual(iso_duration("PT1H2M3.5S"), 3723.5)
        self.assertEqual(iso_duration("P00H03M20S"), 200)
        self.assertIsNone(iso_duration("unknown"))

    def test_partial_or_invalid_pages_never_invent_data(self):
        album, warnings = parse_bandcamp('<meta property="og:title" content="Title">')
        self.assertEqual(album["artist"], "")
        self.assertEqual(album["tracks"], [])
        self.assertEqual(len(warnings), 3)
        with self.assertRaises(ImportFailure):
            parse_bandcamp('<html>captcha / login</html>')

    def test_source_urls_and_tracking(self):
        provider, canonical, params = identify("https://music.apple.com/us/album/title/123456789?i=123&at=tracking")
        self.assertEqual(canonical, "https://music.apple.com/us/album/title/123456789")
        self.assertEqual(params["id"], "123456789")
        for url in ["http://example.com/", "https://127.0.0.1/album/a", "https://bandcamp.com.evil.test/album/a", "https://name:secret@artist.bandcamp.com/album/a", "https://artist.bandcamp.com:123/album/a", "https://artist.bandcamp.com/track/a", "file:///etc/passwd"]:
            with self.subTest(url=url), self.assertRaises(ImportFailure):
                identify(url)

    def test_unavailable_sources_have_manual_fallback(self):
        for url in ["https://open.spotify.com/album/example", "https://www.kugou.com/album/1.html", "https://www.deezer.com/album/1"]:
            with self.assertRaisesRegex(ImportFailure, "手动"):
                identify(url)

    def test_metadata_envelope_and_persistent_cover(self):
        result = import_album("https://fixture.bandcamp.com/album/fixture", FixtureFetcher())
        self.assertTrue(result["album"]["coverDataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(result["source"]["provider"], "bandcamp")
        self.assertNotIn("ratings", result["album"])
        self.assertNotIn("genreId", result["album"])
        self.assertIn("fetchedAt", result["source"])

    def test_cover_failure_preserves_metadata(self):
        class NoCover(FixtureFetcher):
            def read(self, url, **kwargs):
                if "bcbits" in url:
                    raise ImportFailure("blocked")
                return super().read(url, **kwargs)
        result = import_album("https://fixture.bandcamp.com/album/fixture", NoCover())
        self.assertEqual(result["album"]["coverDataUrl"], "")
        self.assertEqual(len(result["album"]["tracks"]), 3)
        self.assertIn("封面", result["warnings"][0])


class AccessTests(unittest.TestCase):
    def test_allowlist_and_private_address_rejection(self):
        with self.assertRaises(ImportFailure):
            check_url("https://evil.test/page", resolve=False)
        with patch("urllib.request.getproxies", return_value={}), patch("socket.getaddrinfo", return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ImportFailure):
                check_url("https://fixture.bandcamp.com/album/a")

    def test_proxy_dns_is_not_replaced_with_a_direct_route(self):
        with patch("urllib.request.getproxies", return_value={"https":"http://managed-proxy.invalid:8080"}), patch("urllib.request.proxy_bypass",return_value=False), patch("socket.getaddrinfo") as dns:
            self.assertEqual(check_url("https://itunes.apple.com/lookup?id=1"),"https://itunes.apple.com/lookup?id=1")
            dns.assert_not_called()
            with self.assertRaises(ImportFailure):
                check_url("https://untrusted.invalid/")

    def test_robots_denial_is_final(self):
        fetcher = PublicFetcher()
        with patch.object(fetcher, "read", return_value=(b'User-agent: *\nDisallow: /album/', 'text/plain')):
            with self.assertRaisesRegex(ImportFailure, "访问规则"):
                fetcher.allow_page("https://fixture.bandcamp.com/album/a")

    def test_unreadable_robots_does_not_allow_scraping(self):
        fetcher = PublicFetcher()
        with patch.object(fetcher, "read", side_effect=ImportFailure("blocked")):
            with self.assertRaises(ImportFailure):
                fetcher.allow_page("https://fixture.bandcamp.com/album/a")

    def test_redirect_cannot_escape_source_host(self):
        fetcher = PublicFetcher()
        error = urllib.error.HTTPError("https://fixture.bandcamp.com/album/a",302,"redirect",{"Location":"https://evil.test/"},io.BytesIO())
        with patch("tools.album_import.network.check_url"), patch.object(fetcher.opener,"open",side_effect=error):
            with self.assertRaisesRegex(ImportFailure,"跳转"):
                fetcher.read("https://fixture.bandcamp.com/album/a")


class LocalServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        Path(self.temp.name,"index.html").write_text("<h1>MUMAKA</h1>")
        self.server = LocalServer(("127.0.0.1",0), self.temp.name, lambda url: import_album(url,FixtureFetcher()))
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.temp.cleanup()

    def post(self, origin=None, content_type="application/json"):
        return urlopen(Request(self.origin+"/api/album-import",data=json.dumps({"url":"https://fixture.bandcamp.com/album/a"}).encode(),headers={"Origin":origin or self.origin,"Content-Type":content_type}),timeout=5)

    def test_same_origin_roundtrip_is_real_http_and_uses_parser(self):
        with self.post() as response:
            result=json.load(response)
            self.assertEqual(result["data"]["album"]["tracks"][0]["title"],"第一首")
        with urlopen(self.origin+"/api/album-import/status") as response:
            self.assertTrue(json.load(response)["data"]["available"])

    def test_remote_pages_null_origins_and_simple_posts_are_rejected(self):
        for origin in ["https://xuedinge926-bit.github.io","null","https://evil.test"]:
            with self.subTest(origin=origin), self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(origin)
            self.assertEqual(caught.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post(content_type="text/plain")
        self.assertEqual(caught.exception.code,415)

    def test_no_proxy_or_static_root_escape(self):
        for path in ["/api/spotify?action=status", "/../outside", "/.env", "/%2e%2e/outside"]:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError):
                urlopen(self.origin+path)


if __name__ == "__main__":
    unittest.main()
