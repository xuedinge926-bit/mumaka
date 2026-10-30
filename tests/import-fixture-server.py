"""Browser test server: real local service + parsers, explicit upstream fixtures."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.album_import.importer import import_album
from tools.album_import.server import LocalServer
from tools.album_import.sources import ImportFailure
from tools.tests.test_album_import import FixtureFetcher


def fixture_import(url):
    if url.endswith("/blocked"):
        raise ImportFailure("来源限制了公开读取，请手动添加。")
    return import_album(url, FixtureFetcher())


with LocalServer(("127.0.0.1", 0), "dist", fixture_import) as server:
    print(f"READY http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()
