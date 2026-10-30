"""Pure adapters for public metadata; fixtures can exercise these without the network."""
from __future__ import annotations

import html
import json
import math
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit, urlunsplit


class ImportFailure(ValueError):
    pass


def clean(value, limit=1000):
    return value.strip()[:limit] if isinstance(value, str) else ""


def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def identify(url):
    if isinstance(url, str):
        matches = re.findall(r'https://[^\s<>"\u201c\u201d()\uff08\uff09]+', url)
        if len(matches)>1:raise ImportFailure("一次只能导入一张专辑，请分别粘贴链接。")
        if len(matches) == 1:
            url = matches[0].rstrip(')）》,，。')
    try:
        p = urlsplit(url.strip())
        if p.scheme != "https" or p.username or p.password or p.port not in (None, 443):
            raise ValueError()
    except (ValueError, AttributeError):
        raise ImportFailure("请粘贴不含账号密码的 HTTPS 专辑详情页链接。")
    host = (p.hostname or "").lower()
    if host == "163cn.tv" and re.fullmatch(r"/[A-Za-z0-9_-]+/?",p.path):
        return "netease", urlunsplit(("https",host,p.path,"","")), {"short":True}
    if host in {"music.163.com","y.music.163.com"}:
        page = urlsplit(p.fragment) if p.fragment.startswith("/album") else p
        album_id = parse_qs(page.query).get("id",[""])[0]
        if page.path.rstrip("/") not in {"/album","/m/album"} or not re.fullmatch(r"[0-9]{1,20}",album_id):
            raise ImportFailure("请使用网易云专辑链接，歌曲或歌单不能直接作为专辑导入。")
        return "netease", "https://music.163.com/album?id="+album_id, {"id":album_id}
    if host in {"y.qq.com","i.y.qq.com","c.y.qq.com","c6.y.qq.com"}:
        query=parse_qs(p.query)
        if p.path=="/base/fcgi-bin/u" and re.fullmatch(r"[A-Za-z0-9_-]{1,200}",query.get("__",[""])[0]):
            return "qq-music", urlunsplit(("https",host,p.path,"__="+query['__'][0],"")), {"short":True}
        match=re.fullmatch(r"/n/ryqq(?:_v2)?/albumDetail/([A-Za-z0-9]{1,80})/?",p.path) or re.fullmatch(r"/n/yqq/album/([A-Za-z0-9]{1,80})\.html",p.path)
        album_id=match.group(1) if match else ""
        if p.path=="/n2/m/share/details/album.html":
            album_id=query.get("albummid",query.get("albumid",[""]))[0]
        if not re.fullmatch(r"[A-Za-z0-9]{1,80}",album_id):
            raise ImportFailure("请使用 QQ 音乐专辑链接，歌曲或歌单不能直接作为专辑导入。")
        return "qq-music", "https://y.qq.com/n/ryqq/albumDetail/"+album_id, {"id":album_id}
    if host == "music.apple.com":
        match = re.fullmatch(r"/([a-zA-Z]{2})/album/(?:[^/]+/)?([0-9]+)/?", p.path)
        if not match:
            raise ImportFailure("请使用 Apple Music 的专辑详情页链接。")
        country, album_id = match.groups()
        return "apple-music", urlunsplit(("https", host, p.path.rstrip("/"), "", "")), {"country": country.lower(), "id": album_id}
    if re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.bandcamp\.com", host) and re.fullmatch(r"/album/[^/]+/?", p.path):
        return "bandcamp", urlunsplit(("https", host, p.path.rstrip("/"), "", "")), {}
    if host == "open.spotify.com":
        raise ImportFailure("此来源暂未接入免费的完整曲目导入，请手动添加；Spotify 官方搜索仍可单独配置。")
    raise ImportFailure("本轮处理网易云、QQ 音乐和 Apple Music 专辑链接，保留已有 Bandcamp 格式。此链接暂未接入，请手动添加。")


def blank_album():
    return {"title": "", "artist": "", "year": "", "releaseDate": "", "releaseType": None,
            "coverUrl": "", "coverDataUrl": "", "label": "", "tracks": [], "referenceGenres": []}


def set_date(album, value):
    value = clean(value, 80)
    if re.match(r"^\d{4}(?:-|$)", value):
        album["releaseDate"] = value
        album["year"] = value[:4]


def parse_apple(payload, album_id):
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise ImportFailure("Apple 返回的资料格式无法识别，请手动填写。")
    rows = [r for r in payload["results"] if isinstance(r, dict)]
    collection = next((r for r in rows if r.get("wrapperType") == "collection" and str(r.get("collectionId")) == str(album_id)), None)
    if not collection:
        raise ImportFailure("没有取得这张专辑的公开资料，可能受地区或上架状态限制。请手动添加。")
    album = blank_album()
    album.update(title=clean(collection.get("collectionName")), artist=clean(collection.get("artistName")), coverUrl=clean(collection.get("artworkUrl100"), 3000))
    set_date(album, collection.get("releaseDate"))
    # iTunes collectionType=Album does not reliably distinguish Album / EP / Single.
    if clean(collection.get("primaryGenreName")):
        album["referenceGenres"] = [clean(collection["primaryGenreName"])]
    tracks = [r for r in rows if r.get("wrapperType") == "track" and r.get("kind") == "song" and str(r.get("collectionId")) == str(album_id)]
    tracks.sort(key=lambda r: (number(r.get("discNumber")) or 1, number(r.get("trackNumber")) or 100000))
    for i, row in enumerate(tracks):
        millis = number(row.get("trackTimeMillis"))
        album["tracks"].append({"position": i + 1, "title": clean(row.get("trackName")), "duration": millis / 1000 if millis is not None else None})
    expected = number(collection.get("trackCount"))
    warnings = []
    if expected and len(tracks) < expected:
        warnings.append(f"来源标注 {int(expected)} 首，本次只取得 {len(tracks)} 首，请确认或补全曲目。")
    if not tracks:
        warnings.append("没有取得曲目列表，可在确认页手动补充。")
    return album, warnings


class PublicHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.ld = []
        self.tralbum = None
        self._script = None
        self._parts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta":
            key = values.get("property") or values.get("name")
            if key and values.get("content"):
                self.meta[key] = values["content"]
        if values.get("data-tralbum"):
            try:
                self.tralbum = json.loads(values["data-tralbum"])
            except (ValueError, TypeError):
                pass
        if tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._script, self._parts = True, []

    def handle_data(self, data):
        if self._script:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script:
            raw = "".join(self._parts)
            try:
                self.ld.append(json.loads(raw))
            except ValueError:
                try:
                    self.ld.append(json.loads(html.unescape(raw)))
                except ValueError:
                    pass
            self._script = None


def nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from nodes(item)
    elif isinstance(value, dict):
        yield value
        if "@graph" in value:
            yield from nodes(value["@graph"])


def names(value):
    if isinstance(value, list):
        return " / ".join(filter(None, (names(v) for v in value)))
    if isinstance(value, dict):
        return clean(value.get("name"))
    return clean(value)


def iso_duration(value):
    if not isinstance(value, str):
        return number(value)
    # Some Bandcamp public pages use P00H03M00S rather than the standard PT3M.
    m = re.fullmatch(r"PT?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", value)
    return sum(float(n or 0) * factor for n, factor in zip(m.groups(), [3600, 60, 1])) if m and any(m.groups()) else None


def parse_bandcamp(page):
    parser = PublicHTML()
    parser.feed(page)
    all_nodes = list(nodes(parser.ld))
    release = next((n for n in all_nodes if "MusicAlbum" in (n.get("@type") if isinstance(n.get("@type"), list) else [n.get("@type")])), {})
    embedded = parser.tralbum if isinstance(parser.tralbum, dict) else {}
    current = embedded.get("current") if isinstance(embedded.get("current"), dict) else {}
    album = blank_album()
    album.update(title=clean(release.get("name") or current.get("title") or parser.meta.get("og:title")), artist=names(release.get("byArtist")) or clean(embedded.get("artist")), label=names(release.get("recordLabel")))
    image = release.get("image")
    if isinstance(image, list):
        image = image[0] if image else None
    album["coverUrl"] = clean(image.get("url") if isinstance(image, dict) else image or parser.meta.get("og:image"), 3000)
    set_date(album, release.get("datePublished"))
    release_type = clean(release.get("albumReleaseType")).split("/")[-1]
    album["releaseType"] = {"AlbumRelease": "album", "EPRelease": "ep", "SingleRelease": "single"}.get(release_type)
    tags = release.get("genre", [])
    album["referenceGenres"] = list(dict.fromkeys(filter(None, (clean(t) for t in (tags if isinstance(tags, list) else [tags])))))[:40]
    tracks = release.get("track", [])
    if isinstance(tracks, dict):
        tracks = tracks.get("itemListElement", [tracks])
    if isinstance(tracks, list):
        ordered = []
        for index, item in enumerate(tracks):
            if not isinstance(item, dict):
                continue
            track = item.get("item", item)
            if not isinstance(track, dict):
                continue
            ordered.append((number(item.get("position")) or index + 1, {"title": clean(track.get("name")), "duration": iso_duration(track.get("duration"))}))
        album["tracks"] = [{**track, "position": i + 1} for i, (_, track) in enumerate(sorted(ordered, key=lambda t: t[0]))]
    # Only parse structured attributes shipped in the public album page. No private endpoints.
    if not album["tracks"] and isinstance(embedded.get("trackinfo"), list):
        album["tracks"] = [{"position": i + 1, "title": clean(t.get("title")), "duration": number(t.get("duration"))} for i, t in enumerate(embedded["trackinfo"]) if isinstance(t, dict)]
    if not album["title"]:
        raise ImportFailure("页面没有可读取的专辑资料，请手动添加。")
    warnings = []
    for key, label in [("artist", "音乐人"), ("year", "发行年份"), ("tracks", "曲目列表")]:
        if not album[key]:
            warnings.append(f"未取得{label}，请在确认页补充。")
    return album, warnings
