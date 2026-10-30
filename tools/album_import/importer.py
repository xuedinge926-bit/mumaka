from __future__ import annotations

import base64
import json
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit

from .network import PublicFetcher
from .sources import ImportFailure, identify, parse_apple, parse_bandcamp


def embed_cover(fetcher, url):
    if not url:
        return ""
    # Album sources are not general image proxies.
    if not (urlsplit(url).hostname or "").endswith((".bcbits.com", ".mzstatic.com")):
        raise ImportFailure("来源封面不在支持的图片域名中。")
    fetcher.allow_page(url)
    body, kind = fetcher.read(url, limit=5 * 1024 * 1024, accept="image/png,image/jpeg,image/webp,image/gif")
    valid = (kind == "image/png" and body.startswith(b"\x89PNG\r\n\x1a\n")) or (kind == "image/jpeg" and body.startswith(b"\xff\xd8\xff")) or (kind == "image/gif" and body[:6] in (b"GIF87a", b"GIF89a")) or (kind == "image/webp" and body[:4] == b"RIFF" and body[8:12] == b"WEBP")
    if not valid:
        raise ImportFailure("未取得可保存的封面图片。")
    return "data:" + kind + ";base64," + base64.b64encode(body).decode("ascii")


def import_album(url, fetcher=None):
    provider, canonical, params = identify(url)
    fetcher = fetcher or PublicFetcher()
    if provider == "apple-music":
        metadata_url = "https://itunes.apple.com/lookup?" + urlencode({"id": params["id"], "entity": "song", "country": params["country"], "limit": 200})
        raw, kind = fetcher.read(metadata_url, accept="application/json")
        try:
            album, warnings = parse_apple(json.loads(raw), params["id"])
        except (ValueError, UnicodeError) as error:
            if isinstance(error, ImportFailure):
                raise
            raise ImportFailure("Apple 暂未返回可读取的资料，请手动添加。") from error
        adapter = "itunes-public-lookup-v1"
    else:
        metadata_url = canonical
        fetcher.allow_page(canonical)
        raw, kind = fetcher.read(canonical, accept="text/html")
        if kind != "text/html":
            raise ImportFailure("来源没有返回可读取的专辑页面，请手动添加。")
        album, warnings = parse_bandcamp(raw.decode("utf-8", "replace"))
        adapter = "bandcamp-public-structured-v1"
    if len(album["tracks"]) > 1000:
        raise ImportFailure("曲目过多，请分批手动录入。")
    if album["coverUrl"]:
        try:
            album["coverDataUrl"] = embed_cover(fetcher, album["coverUrl"])
        except (ImportFailure, urllib.error.HTTPError, ValueError):
            warnings.append("封面未能保存为本地资源，请在确认页上传图片；不会影响评分。")
    else:
        warnings.append("没有取得封面，可在确认页上传图片。")
    return {"format": "mumaka-album-import", "schemaVersion": 1,
            "source": {"provider": provider, "url": canonical, "metadataUrl": metadata_url, "fetchedAt": datetime.now(timezone.utc).isoformat(), "adapter": adapter},
            "album": album, "warnings": warnings}
