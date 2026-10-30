"""python3 -m tools.album_import URL -o album.json | serve --root dist"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .importer import import_album
from .server import LocalServer
from .sources import ImportFailure


def main():
    parser = argparse.ArgumentParser(description="MUMAKA 免费本地专辑资料导入（不需要 API 密钥）")
    parser.add_argument("url", help="专辑 HTTPS 链接，或 serve 启动本地网页")
    parser.add_argument("-o", "--output", help="保存元数据 JSON，供网页导入")
    parser.add_argument("--root", default="dist", help="本地网页构建目录（默认 dist）")
    parser.add_argument("--port", type=int, default=8765, help="本地端口（默认 8765，请固定使用以读取原有本地数据）")
    args = parser.parse_args()
    try:
        if args.url == "serve":
            with LocalServer(("127.0.0.1", args.port), args.root) as server:
                print(f"MUMAKA 已启动：http://127.0.0.1:{server.server_port}", flush=True)
                print("请从此地址打开网页；GitHub Pages 的浏览器数据需要先导出备份再在这里导入。", flush=True)
                server.serve_forever()
        else:
            result = json.dumps(import_album(args.url), ensure_ascii=False, indent=2)
            if args.output:
                target = Path(args.output)
                # Existing exports are user data; do not silently overwrite them.
                with target.open("x", encoding="utf-8") as file:
                    file.write(result + "\n")
                print(f"已保存 {target}，在 MUMAKA 中选择“通过链接添加 → 导入元数据 JSON”。")
            else:
                print(result)
    except KeyboardInterrupt:
        pass
    except (ImportFailure, OSError) as error:
        print(str(error) if isinstance(error, ImportFailure) else "无法启动或保存，请检查端口、输出文件是否已存在及目录权限。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
