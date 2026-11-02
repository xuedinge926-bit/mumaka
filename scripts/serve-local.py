"""Serve the packaged manual-scoring application at a stable loopback origin."""
import argparse
import functools
import json
import socket
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path(__file__).resolve().parent))
    parser.add_argument('--port', default=8765, type=int)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    url = f'http://127.0.0.1:{args.port}/'

    def open_browser():
        if sys.platform == 'darwin':
            result = subprocess.run(['open', '-a', 'Google Chrome', url], check=False)
            if result.returncode:
                subprocess.run(['open', url], check=False)
        else:
            import webbrowser
            webbrowser.open(url)

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/__mumaka_health':
                body = json.dumps({'app': 'mumaka', 'release': 'v0.41', 'root': 'local'}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache')
            super().end_headers()

    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(root)))
    except OSError:
        try:
            with urlopen(url + '__mumaka_health', timeout=2) as response:
                existing = json.load(response)
            if existing == {'app': 'mumaka', 'release': 'v0.41', 'root': 'local'}:
                if args.open:
                    open_browser()
                print('MUMAKA 已在本机运行。')
                return
        except (URLError, ValueError, socket.timeout):
            pass
        raise SystemExit(f'{args.port}端口已有其他程序或旧版本。请先关闭旧版启动窗口，再打开新版。')
    print(f'MUMAKA V0.41：{url}\n保持此窗口开启；Ctrl+C 停止。', flush=True)
    if args.open:
        open_browser()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
