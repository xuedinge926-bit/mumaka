"""Serve the built React app and import API together on a loopback origin."""
from __future__ import annotations

import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .importer import import_album
from .sources import ImportFailure


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, root, importer=import_album):
        self.root = Path(root).resolve()
        if not (self.root / "index.html").is_file():
            raise ImportFailure("未找到网页构建。请先在项目目录运行 npm run build。")
        self.importer = importer
        self.import_lock = threading.Lock()
        super().__init__(address, functools.partial(Handler, directory=str(self.root)))


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Do not put user-pasted URLs or metadata into routine server logs.
        pass

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def same_origin(self):
        return self.valid_host() and self.headers.get("Origin") == "http://" + self.headers.get("Host", "")

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def do_OPTIONS(self):
        self.send_json(403, {"error": "本地导入仅接受同一个网页的请求。"})

    def do_POST(self):
        if not self.same_origin():
            return self.send_json(403, {"error": "请从此本地服务打开网页后再导入。"})
        if urlsplit(self.path).path != "/api/album-import":
            return self.send_json(404, {"error": "未找到接口。"})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(415, {"error": "请使用网页中的链接导入按钮。"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 16 * 1024:
                return self.send_json(413, {"error": "链接资料为空或过长。"})
            self.connection.settimeout(10)
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict) or not isinstance(request.get("url"), str) or len(request["url"]) > 4096:
                raise ValueError()
        except (ValueError, OSError):
            return self.send_json(400, {"error": "无法读取链接，请重新粘贴。"})
        if not self.server.import_lock.acquire(blocking=False):
            return self.send_json(429, {"error": "正在获取另一张专辑，请稍后再试。"})
        try:
            self.send_json(200, {"data": self.server.importer(request["url"])})
        except ImportFailure as error:
            self.send_json(422, {"error": str(error)})
        except Exception:
            self.send_json(502, {"error": "来源暂时无法读取，可稍后重试或继续手动添加。"})
        finally:
            self.server.import_lock.release()

    def do_GET(self):
        if not self.valid_host():
            return self.send_json(403, {"error": "请使用终端显示的本机地址。"})
        path = urlsplit(self.path).path
        if path == "/api/album-import/status":
            return self.send_json(200, {"data": {"available": True, "sources": ["netease", "qq-music", "apple-music", "bandcamp"]}})
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "此可选服务尚未配置，可通过链接或手动添加。"})
        target = (self.server.root / unquote(path).lstrip("/")).resolve()
        if not target.is_relative_to(self.server.root) or any(part.startswith(".") for part in Path(unquote(path)).parts if part not in ("/", ".")):
            return self.send_error(403)
        if target.is_dir() and not (target / "index.html").is_file():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self.valid_host():
            return self.send_json(403, {"error": "请使用本机地址。"})
        # Keep the same path confinement checks as GET.
        path = urlsplit(self.path).path
        target = (self.server.root / unquote(path).lstrip("/")).resolve()
        if not target.is_relative_to(self.server.root) or any(part.startswith(".") for part in Path(unquote(path)).parts if part not in ("/", ".")):
            return self.send_error(403)
        return super().do_HEAD()
