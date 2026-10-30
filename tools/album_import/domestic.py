"""Public HTML / JSON-LD only. No reverse-engineered or authenticated music APIs."""
from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from .sources import PublicHTML, ImportFailure, blank_album, clean, identify, iso_duration, names, nodes, number, set_date


class AlbumPage(PublicHTML):
    def __init__(self):
        super().__init__()
        self.json_docs=[]
        self.textareas=[]
        self._json=None
        self._json_parts=[]
        self._textarea=None
        self._textarea_parts=[]
        self._info_depth=0
        self._heading=False
        self._paragraph=False
        self._title=False
        self.dom_title=[]
        self.dom_paragraphs=[]
        self.document_title=[]
        self.dom_cover=""
        self.redirect=""

    def handle_starttag(self,tag,attrs):
        super().handle_starttag(tag,attrs)
        values=dict(attrs)
        if tag=='script' and values.get('type','').lower()=='application/json':
            self._json=True;self._json_parts=[]
        if tag=='textarea' and values.get('id')=='song-list-pre-data':
            self._textarea=True;self._textarea_parts=[]
        if tag=='title':self._title=True
        if tag=='meta' and values.get('http-equiv','').lower()=='refresh':
            match=re.search(r'url\s*=\s*[\"\x27]?([^\"\x27]+)',values.get('content',''),re.I)
            if match:self.redirect=match.group(1).strip()
        if tag=='link' and values.get('rel')=='canonical':self.redirect=values.get('href') or self.redirect
        if tag=='div':
            if self._info_depth:self._info_depth+=1
            elif 'm-info' in values.get('class','').split():self._info_depth=1
        if self._info_depth:
            if tag=='h2' and 'f-ff2' in values.get('class','').split():self._heading=True
            if tag=='p':self._paragraph=True;self.dom_paragraphs.append([])
            if tag=='img' and not self.dom_cover:self.dom_cover=values.get('data-src') or values.get('src','')

    def handle_data(self,data):
        super().handle_data(data)
        if self._json:self._json_parts.append(data)
        if self._textarea:self._textarea_parts.append(data)
        if self._title:self.document_title.append(data)
        if self._heading:self.dom_title.append(data)
        if self._paragraph and self.dom_paragraphs:self.dom_paragraphs[-1].append(data)

    def handle_endtag(self,tag):
        super().handle_endtag(tag)
        if tag=='script' and self._json:
            try:self.json_docs.append(json.loads(''.join(self._json_parts)))
            except ValueError:pass
            self._json=None
        if tag=='textarea' and self._textarea:
            try:self.textareas.append(json.loads(html.unescape(''.join(self._textarea_parts))))
            except ValueError:pass
            self._textarea=None
        if tag=='title':self._title=False
        if tag=='h2':self._heading=False
        if tag=='p':self._paragraph=False
        if tag=='div' and self._info_depth:self._info_depth-=1


def public_redirect(page,base):
    parser=AlbumPage();parser.feed(page)
    title=''.join(parser.document_title)
    if re.search(r'验证码|人机验证|访问受限|登录后|captcha|access denied',title,re.I):
        raise ImportFailure('来源要求验证或限制访问，未继续读取。请手动添加。')
    target=parser.redirect
    if not target:
        # Read a literal public redirect, never execute page JavaScript.
        match=re.search(r'(?:window\.)?location(?:\.href|\.replace|\.assign)?\s*(?:=|\()\s*([\"\x27])(https?://[^\"\x27]+)\1',page)
        if match:target=match.group(2).replace('\\/','/')
    return urljoin(base,html.unescape(target)) if target else ''


def secure_image(value):
    value=clean(value,3000)
    if value.startswith('//'):value='https:'+value
    if value.startswith('http://') and ((urlsplit(value).hostname or '').endswith('.music.126.net') or urlsplit(value).hostname in {'y.gtimg.cn','y.qq.com'}):value='https://'+value[7:]
    return value


def ld_album(parser,provider,album_id):
    candidates=[n for _,n,_ in walk_json(parser.ld) if clean(n.get('name')) and 'MusicAlbum' in (n.get('@type') if isinstance(n.get('@type'),list) else [n.get('@type')])]
    matched=[];unidentified=[]
    for candidate in candidates:
        known=False
        for link in [candidate.get('url'),candidate.get('@id')]:
            if not isinstance(link,str):continue
            try:p,_,params=identify(link)
            except ImportFailure:continue
            if p==provider and params.get('id'):
                known=True
                if params['id']==album_id:matched.append(candidate)
        if not known:unidentified.append(candidate)
    release=matched[0] if matched else unidentified[0] if len(candidates)==1 and len(unidentified)==1 else {}
    album=blank_album()
    if not release:return album
    album.update(title=clean(release.get('name')),artist=names(release.get('byArtist')),label=names(release.get('recordLabel')))
    set_date(album,release.get('datePublished'))
    image=release.get('image')
    if isinstance(image,list):image=image[0] if image else ''
    album['coverUrl']=secure_image(image.get('url') if isinstance(image,dict) else image)
    album['releaseType']={'AlbumRelease':'album','EPRelease':'ep','SingleRelease':'single'}.get(clean(release.get('albumReleaseType')).split('/')[-1])
    tags=release.get('genre',[])
    album['referenceGenres']=[clean(t,200) for t in (tags if isinstance(tags,list) else [tags]) if clean(t,200)][:40]
    tracks=release.get('track',[])
    if isinstance(tracks,dict):tracks=tracks.get('itemListElement',[tracks])
    ordered=[]
    if isinstance(tracks,list):
        for i,row in enumerate(tracks):
            if not isinstance(row,dict):continue
            item=row.get('item',row)
            if isinstance(item,dict):ordered.append((number(row.get('position')) or i+1,{'title':clean(item.get('name')),'duration':iso_duration(item.get('duration'))}))
    album['tracks']=[{**row,'position':i+1} for i,(_,row) in enumerate(sorted(ordered,key=lambda x:x[0]))]
    return album


def walk_json(value,path=(),parent=None):
    if isinstance(value,dict):
        yield path,value,parent
        for key,item in value.items():yield from walk_json(item,path+(str(key),),value)
    elif isinstance(value,list):
        for i,item in enumerate(value):yield from walk_json(item,path+(str(i),),value)


def embedded_album(parser,provider,album_id):
    for document in parser.json_docs:
        for path,row,parent in walk_json(document):
            location='.'.join(path).lower()
            explicit_name=row.get('albumName') or row.get('albumname')
            actual=row.get('albumMID') or row.get('albumMid') or row.get('albummid') or row.get('mid') or row.get('albumId') or row.get('albumid') or row.get('id')
            if str(actual)!=album_id or not (explicit_name or any(k in location for k in ['albuminfo','albumdetail','album_info'])):continue
            album=blank_album()
            album['title']=clean(explicit_name or row.get('name'))
            artist=row.get('singer') or row.get('singers') or row.get('singerList') or row.get('artist') or row.get('artists')
            album['artist']=names(artist)
            album['coverUrl']=secure_image(row.get('cover') or row.get('coverUrl') or row.get('picUrl'))
            album['label']=names(row.get('company') or row.get('label'))
            set_date(album,row.get('releaseDate') or row.get('aDate') or row.get('time_public') or row.get('publishTime'))
            track_rows=row.get('songs') or row.get('songlist') or row.get('songList') or row.get('tracks')
            if not track_rows and isinstance(parent,dict):track_rows=parent.get('songlist') or parent.get('songList') or parent.get('songs')
            if isinstance(track_rows,dict):track_rows=track_rows.get('list')
            if isinstance(track_rows,list):
                for t in track_rows:
                    if not isinstance(t,dict):continue
                    info=t.get('songInfo',t)
                    if not isinstance(info,dict):continue
                    related=info.get('album',{})
                    related_id=related.get('mid') or related.get('id') if isinstance(related,dict) else None
                    if related_id and str(related_id)!=album_id:continue
                    seconds=number(info.get('interval')) if provider=='qq-music' else None
                    millis=number(info.get('dt',info.get('duration'))) if provider=='netease' else None
                    album['tracks'].append({'position':len(album['tracks'])+1,'title':clean(info.get('name') or info.get('songname') or info.get('title')),'duration':seconds if seconds is not None else millis/1000 if millis is not None else None})
            return album
    return blank_album()


def parse_domestic(page,provider,album_id):
    parser=AlbumPage();parser.feed(page)
    title=''.join(parser.document_title)
    if re.search(r'验证码|人机验证|访问受限|登录后|captcha|access denied',title,re.I):raise ImportFailure('来源要求验证或限制访问，未继续读取。请手动添加。')
    album=ld_album(parser,provider,album_id)
    embedded=embedded_album(parser,provider,album_id)
    for key in album:
        if not album[key] and embedded[key]:album[key]=embedded[key]
    if provider=='netease':
        album['title']=album['title'] or clean(''.join(parser.dom_title))
        album['coverUrl']=album['coverUrl'] or secure_image(parser.dom_cover)
        for paragraph in parser.dom_paragraphs:
            value=''.join(paragraph).strip()
            for label,key in [('歌手','artist'),('发行时间','releaseDate'),('发行公司','label')]:
                match=re.match(label+r'\s*[:：]\s*(.+)',value)
                if not match:continue
                if key=='releaseDate' and not album['year']:set_date(album,match.group(1))
                elif key!='releaseDate' and not album[key]:album[key]=clean(match.group(1))
        if not album['tracks']:
            songs=next((v for v in parser.textareas if isinstance(v,list)),[])
            for song in songs:
                if not isinstance(song,dict):continue
                millis=number(song.get('dt',song.get('duration')))
                album['tracks'].append({'position':len(album['tracks'])+1,'title':clean(song.get('name')),'duration':millis/1000 if millis is not None else None})
    # Only accept an explicitly album-typed Open Graph fallback, not a generic
    # player shell or a search-engine title combining unrelated site text.
    if parser.meta.get('og:type') in {'music.album','MusicAlbum'}:
        album['title']=album['title'] or clean(parser.meta.get('og:title'))
        artist=parser.meta.get('og:music:artist') or parser.meta.get('music:musician','')
        if not artist.startswith(('http:','https:')):album['artist']=album['artist'] or clean(artist)
        album['coverUrl']=album['coverUrl'] or secure_image(parser.meta.get('og:image'))
    if not album['title']:raise ImportFailure('此公开页面没有可读取的专辑资料；可能只返回播放器框架，请手动添加。')
    warnings=[]
    for key,label in [('artist','音乐人'),('year','发行年份'),('tracks','曲目列表')]:
        if not album[key]:warnings.append(f'未取得{label}，请确认或手动补充。')
    if album['tracks'] and any(not t['title'] for t in album['tracks']):warnings.append('部分曲目名称缺失，请核对后继续。')
    return album,warnings
