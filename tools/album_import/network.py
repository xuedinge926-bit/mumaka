"""Bounded public HTTPS reads, using inherited proxy and CA trust. No login or bypass."""
from __future__ import annotations

import ipaddress
import re
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from .sources import ImportFailure

USER_AGENT = "MUMAKA/0.1 (+personal public album metadata import)"


def permitted_host(host):
    return host in {"itunes.apple.com", "music.apple.com", "music.163.com", "y.music.163.com", "163cn.tv", "y.qq.com", "i.y.qq.com", "c.y.qq.com", "c6.y.qq.com", "y.gtimg.cn"} or bool(re.fullmatch(r"[a-z0-9-]+\.bandcamp\.com", host)) or bool(re.fullmatch(r"f\d+\.bcbits\.com", host)) or bool(re.fullmatch(r"[a-z0-9-]+\.mzstatic\.com", host)) or bool(re.fullmatch(r"[a-z0-9-]+\.music\.126\.net",host))


def check_url(url, resolve=True):
    try:
        p = urlsplit(url)
        if p.scheme != "https" or p.username or p.password or p.port not in (None, 443) or not permitted_host(p.hostname or ""):
            raise ValueError()
        # HTTPS through an inherited proxy resolves at the proxy. Managed networks
        # may return synthetic local DNS addresses; do not open a direct connection
        # or override that route. The strict official-host allowlist still applies.
        proxy_in_use = bool(urllib.request.getproxies().get("https")) and not urllib.request.proxy_bypass(p.hostname)
        if resolve and not proxy_in_use:
            addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError()
    except (ValueError, OSError):
        raise ImportFailure("此资料地址不在允许的公开音乐来源中，或网络无法解析。请手动添加。")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PublicFetcher:
    def __init__(self, timeout=30):
        self.deadline = time.monotonic() + timeout
        self.opener = urllib.request.build_opener(NoRedirect())
        self.robots = {}

    def read(self, url, limit=3 * 1024 * 1024, accept="text/html,application/json", redirects=3):
        check_url(url)
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ImportFailure("获取信息超时，请稍后重试或手动添加。")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept, "Accept-Encoding": "identity"})
        try:
            with self.opener.open(request, timeout=min(10, remaining)) as response:
                length = response.headers.get("Content-Length")
                if length and int(length) > limit:
                    raise ImportFailure("来源资料过大，请手动添加。")
                chunks, size = [], 0
                while True:
                    if time.monotonic() > self.deadline:
                        raise ImportFailure("获取信息超时，请稍后重试或手动添加。")
                    # read1 returns after one buffered/socket read, so a slow stream
                    # cannot keep an internal read(n) loop past our total deadline.
                    chunk = response.read1(min(65536, limit + 1 - size))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limit:
                        raise ImportFailure("来源资料过大，请手动添加。")
                    chunks.append(chunk)
                return b"".join(chunks), response.headers.get_content_type()
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308) and redirects and error.headers.get("Location"):
                target = urljoin(url, error.headers["Location"])
                # Only follow redirects within the exact original public host.
                if urlsplit(target).hostname != urlsplit(url).hostname:
                    raise ImportFailure("来源跳转到其他网站，请直接粘贴最终专辑链接或手动添加。")
                return self.read(target, limit, accept, redirects - 1)
            if error.code in (401, 403, 429):
                raise ImportFailure("来源限制了公开读取或请求过于频繁，请稍后重试或手动添加。") from error
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ImportFailure("无法连接来源，可能受网络或访问限制。可继续手动添加。") from error

    def allow_page(self, url):
        origin = f"https://{urlsplit(url).hostname}"
        if origin not in self.robots:
            robot = RobotFileParser()
            try:
                raw, _ = self.read(origin + "/robots.txt", limit=256 * 1024, accept="text/plain")
                robot.parse(raw.decode("utf-8", "replace").splitlines())
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise ImportFailure("无法确认来源的公开访问规则，请手动添加。") from error
                robot.parse([])
            self.robots[origin] = robot
        robot = self.robots[origin]
        if not robot.can_fetch("MUMAKA", url):
            raise ImportFailure("来源的访问规则不允许读取此页面，请手动添加。")
        # A one-off importer does not retry or batch around a site's rate policy.
        delay = robot.crawl_delay("MUMAKA") or robot.crawl_delay("*")
        if delay and delay > 0:
            if time.monotonic() + delay >= self.deadline:
                raise ImportFailure("来源要求更长的访问间隔，请稍后使用本地工具或手动添加。")
            time.sleep(delay)

    def read_public_album_page(self, url, provider):
        from .domestic import public_redirect
        from .sources import identify
        hosts = {'netease':{'163cn.tv','music.163.com','y.music.163.com'},'qq-music':{'y.qq.com','i.y.qq.com','c.y.qq.com','c6.y.qq.com'}}[provider]
        current=url
        visited=set()
        for _ in range(6):
            check_url(current)
            if urlsplit(current).hostname not in hosts or current in visited:raise ImportFailure('分享链接跳转异常，请使用专辑详情页的完整地址或手动添加。')
            visited.add(current)
            self.allow_page(current)
            target=''
            try:
                raw,kind=self.read(current,accept='text/html',redirects=0)
            except urllib.error.HTTPError as error:
                if error.code not in (301,302,303,307,308) or not error.headers.get('Location'):raise
                target=urljoin(current,error.headers['Location'])
            else:
                try:identified,canonical,params=identify(current)
                except ImportFailure:identified,params=provider,{'short':True}
                if identified==provider and not params.get('short'):
                    if kind!='text/html':raise ImportFailure('来源没有返回可读取的专辑页面，请手动添加。')
                    return current,raw,kind
                if kind=='text/html':target=public_redirect(raw.decode('utf-8','replace'),current)
            if not target:raise ImportFailure('分享短链没有提供可读取的专辑地址，请复制完整专辑链接或手动添加。')
            parsed=urlsplit(target)
            if parsed.scheme=='http' and parsed.hostname in hosts:target='https://'+target[7:]
            # A share link may only redirect within its own official provider.
            if urlsplit(target).hostname not in hosts:raise ImportFailure('分享链接跳到了其他网站，未继续读取，请使用完整专辑链接。')
            current=target
        raise ImportFailure('分享链接跳转次数过多，请使用完整专辑链接或手动添加。')
