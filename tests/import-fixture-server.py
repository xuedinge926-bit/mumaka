"""Browser test server: real local service + parsers, explicit upstream fixtures."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.album_import.importer import import_album
from tools.album_import.server import LocalServer
from tools.album_import.sources import ImportFailure
from tools.tests.test_album_import import FixtureFetcher
from tools.tests.test_domestic_import import DomesticFixtureFetcher
from tools.album_import.network import check_url
from unittest.mock import patch


def fixture_import(url):
    if url.endswith("/blocked"):
        raise ImportFailure("来源限制了公开读取，请手动添加。")
    if any(host in url for host in ['c6.y.qq.com','163cn.tv','music.163.com','i.y.qq.com','y.qq.com']):
        with patch('tools.album_import.network.check_url',side_effect=lambda value:check_url(value,resolve=False)):
            return import_album(url,DomesticFixtureFetcher())
    return import_album(url, FixtureFetcher())


with LocalServer(("127.0.0.1", 0), "dist", fixture_import) as server:
    print(f"READY http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()
