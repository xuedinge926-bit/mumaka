import io
import json
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from tools.album_import.domestic import parse_domestic, public_redirect
from tools.album_import.importer import import_album
from tools.album_import.network import PublicFetcher, check_url
from tools.album_import.sources import ImportFailure, identify

ROOT=Path(__file__).parent/'fixtures'
PNG=(Path(__file__).parents[2]/'tests/fixtures/cover.png').read_bytes()


class DomesticFixtureFetcher(PublicFetcher):
    """Real resolver / parser with explicit synthetic HTTP and page samples."""
    def __init__(self):super().__init__();self.reads=[];self.allowed=[]
    def allow_page(self,url):self.allowed.append(url)
    def read(self,url,**kwargs):
        self.reads.append(url)
        if 'c6.y.qq.com' in url:
            raise urllib.error.HTTPError(url,302,'redirect',{'Location':'https://i.y.qq.com/n2/m/share/details/album.html?albummid=QQFIXTUREALBUM01'},io.BytesIO())
        if '163cn.tv' in url:return b'<script>window.location.href="https://music.163.com/album?id=123456789";</script>','text/html'
        if 'music.163.com/album' in url:return (ROOT/'netease-album.html').read_bytes(),'text/html'
        if 'qq.com/' in url:return (ROOT/'qq-album.html').read_bytes(),'text/html'
        return PNG,'image/png'


class DomesticTests(unittest.TestCase):
    def test_user_supplied_share_texts_recognize_provider_without_network(self):
        samples=[('分享专辑 唐璜 Don Juan《2号线｜绿日长夏》 https://c6.y.qq.com/base/fcgi-bin/u?__=2zNumVIuq73g @QQ音乐','qq-music'),('分享唐璜Don Juan的专辑《2号线｜绿日长夏》https://163cn.tv/bjQO3xkl (@网易云音乐)','netease')]
        for text,expected in samples:
            provider,canonical,params=identify(text)
            self.assertEqual(provider,expected);self.assertTrue(params['short']);self.assertTrue(canonical.startswith('https://'))

    def test_netease_fragment_mobile_and_regular_links_point_to_one_album(self):
        for url in ['https://music.163.com/#/album?id=123&userid=4','https://music.163.com/album?id=123','https://y.music.163.com/m/album?id=123']:
            self.assertEqual(identify(url),('netease','https://music.163.com/album?id=123',{'id':'123'}))

    def test_qq_old_mobile_and_current_urls_keep_album_id(self):
        for url in ['https://y.qq.com/n/yqq/album/QQFIXTUREALBUM01.html','https://y.qq.com/n/ryqq_v2/albumDetail/QQFIXTUREALBUM01','https://i.y.qq.com/n2/m/share/details/album.html?albummid=QQFIXTUREALBUM01']:
            self.assertEqual(identify(url),('qq-music','https://y.qq.com/n/ryqq/albumDetail/QQFIXTUREALBUM01',{'id':'QQFIXTUREALBUM01'}))

    def test_song_playlist_and_lookalike_hosts_never_become_albums(self):
        for url in ['https://music.163.com/song?id=123','https://music.163.com/playlist?id=123','https://y.qq.com/n/ryqq/songDetail/abc','https://music.163.com.evil.test/album?id=123','https://c6.y.qq.com.evil.test/base/fcgi-bin/u?__=abc']:
            with self.subTest(url=url),self.assertRaises(ImportFailure):identify(url)

    def test_netease_public_dom_and_embedded_track_json(self):
        album,warnings=parse_domestic((ROOT/'netease-album.html').read_text(),'netease','123456789')
        self.assertEqual(album['title'],'网易云导入测试（固定样本）');self.assertEqual(album['artist'],'测试音乐人');self.assertEqual(album['year'],'2024')
        self.assertEqual([t['duration'] for t in album['tracks']],[180,210,200.5]);self.assertEqual(warnings,[])
        self.assertIsNone(album['releaseType']);self.assertEqual(album['referenceGenres'],[])

    def test_qq_public_json_filters_other_album_and_keeps_durations(self):
        album,warnings=parse_domestic((ROOT/'qq-album.html').read_text(),'qq-music','QQFIXTUREALBUM01')
        self.assertEqual(album['title'],'QQ 导入测试（固定样本）');self.assertEqual(album['artist'],'测试音乐人');self.assertEqual(album['year'],'2024')
        self.assertEqual([t['duration'] for t in album['tracks']],[180,210,200.5]);self.assertEqual(warnings,[])
        with self.assertRaises(ImportFailure):parse_domestic((ROOT/'qq-album.html').read_text(),'qq-music','NOT-IN-PAGE')

    def test_json_ld_is_used_without_guessing_missing_release_info(self):
        page='<script type="application/ld+json">'+json.dumps({'@type':'MusicAlbum','name':'T','byArtist':{'name':'A'},'dateCreated':'1999-01-01','track':{'itemListElement':[{'position':2,'item':{'name':'B','duration':'PT2M'}},{'position':1,'item':{'name':'A','duration':'PT1M'}}]}})+'</script>'
        album,warnings=parse_domestic(page,'qq-music','unused')
        self.assertEqual([t['title'] for t in album['tracks']],['A','B']);self.assertEqual(album['year'],'');self.assertIn('发行年份',warnings[0])

    def test_json_ld_recommendations_do_not_replace_the_requested_album(self):
        page='<script type="application/ld+json">'+json.dumps({'@graph':[{'@type':'MusicAlbum','name':'wrong','url':'https://music.163.com/album?id=999'},{'@type':'MusicAlbum','name':'correct','url':'https://music.163.com/album?id=123'}]})+'</script>'
        album,_=parse_domestic(page,'netease','123');self.assertEqual(album['title'],'correct')
        with self.assertRaises(ImportFailure):parse_domestic(page,'netease','555')

    def test_json_ld_webpage_main_entity_is_read_as_an_album(self):
        page='<script type="application/ld+json">'+json.dumps({'@type':'WebPage','mainEntity':{'@type':'MusicAlbum','name':'T','byArtist':{'name':'A'},'datePublished':'2024-01-01','url':'https://music.163.com/album?id=123','track':[{'@type':'MusicRecording','name':'one','duration':'PT3M','inAlbum':{'@type':'MusicAlbum','@id':'#album'}}]}})+'</script>'
        album,warnings=parse_domestic(page,'netease','123');self.assertEqual(album['title'],'T');self.assertEqual(album['tracks'][0]['duration'],180);self.assertEqual(warnings,[])

    def test_access_gates_and_generic_player_shells_fail_honestly(self):
        for page in ['<title>访问受限 请登录后重试</title>','<title>captcha</title>','<title>QQ音乐</title><div id="app"></div>','<meta property="og:title" content="网易云音乐 听见好时光">']:
            with self.assertRaises(ImportFailure):parse_domestic(page,'qq-music','unused')

    def test_partial_metadata_is_explicitly_incomplete(self):
        album,warnings=parse_domestic('<meta property="og:type" content="music.album"><meta property="og:title" content="真实字段样本">','netease','1')
        self.assertEqual(album['title'],'真实字段样本');self.assertEqual(album['artist'],'');self.assertEqual(album['tracks'],[]);self.assertEqual(len(warnings),3)

    def test_share_http_and_literal_redirects_use_real_resolver_and_keep_original_url(self):
        with patch('tools.album_import.network.check_url',side_effect=lambda url:check_url(url,resolve=False)):
            for url,provider in [('https://c6.y.qq.com/base/fcgi-bin/u?__=fixture','qq-music'),('https://163cn.tv/fixture','netease')]:
                transport=DomesticFixtureFetcher();result=import_album(url,transport)
                self.assertEqual(result['source']['provider'],provider);self.assertEqual(result['source']['originalUrl'],url)
                self.assertEqual(len(result['album']['tracks']),3);self.assertTrue(result['album']['coverDataUrl'].startswith('data:image/png;base64,'))
                self.assertEqual(len([u for u in transport.reads if 'api' in u]),0)
                self.assertGreaterEqual(len(transport.allowed),3)

    def test_share_redirects_cannot_escape_official_host_or_loop(self):
        class Bad(DomesticFixtureFetcher):
            def read(self,url,**kwargs):raise urllib.error.HTTPError(url,302,'redirect',{'Location':destination},io.BytesIO())
        with patch('tools.album_import.network.check_url',side_effect=lambda url:check_url(url,resolve=False)):
            for destination in ['https://127.0.0.1/private','https://evil.test/','https://c6.y.qq.com/base/fcgi-bin/u?__=fixture']:
                with self.subTest(destination=destination),self.assertRaises(ImportFailure):Bad().read_public_album_page('https://c6.y.qq.com/base/fcgi-bin/u?__=fixture','qq-music')

    def test_robots_denial_prevents_short_link_request(self):
        transport=DomesticFixtureFetcher()
        with patch('tools.album_import.network.check_url'),patch.object(transport,'allow_page',side_effect=ImportFailure('robots denied')):
            with self.assertRaises(ImportFailure):transport.read_public_album_page('https://163cn.tv/fixture','netease')
        self.assertEqual(transport.reads,[])

    def test_public_meta_and_literal_redirects_do_not_execute_javascript(self):
        self.assertEqual(public_redirect('<meta http-equiv="refresh" content="0;url=https://music.163.com/album?id=1">','https://163cn.tv/f'),'https://music.163.com/album?id=1')
        self.assertEqual(public_redirect('<script>window.location.replace("https://y.qq.com/n/ryqq/albumDetail/abc");</script>','https://c6.y.qq.com/base/fcgi-bin/u?__=f'),'https://y.qq.com/n/ryqq/albumDetail/abc')
        self.assertEqual(public_redirect('<script>eval(secretFunction())</script>','https://163cn.tv/f'),'')


if __name__=='__main__':unittest.main()
