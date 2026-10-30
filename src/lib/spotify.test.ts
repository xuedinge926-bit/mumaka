import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSpotifyHandler, createSpotifyService } from '../../server/spotify';
import { getAlbum, isSpotifyConfigured, resolveSpotifyEndpoint, searchAlbums, SpotifyError, spotifyStatus } from './spotify';

// Deliberately fictitious transport fixtures, never application search data.
const id = '1234567890ABCDEFGHIJKL';
const env = { SPOTIFY_CLIENT_ID: 'test-client-not-real', SPOTIFY_CLIENT_SECRET: 'test-secret-not-real' };
const rawAlbum = (overrides: Record<string, unknown> = {}) => ({
  id, name: '技术用例唱片（虚构）', album_type: 'album', release_date: '2026-01-02', total_tracks: 2,
  artists: [{ name: '技术用例艺人', genres: ['must-not-become-album-genre'] }],
  images: [{ url: 'https://i.scdn.co/image/test-fixture' }],
  external_urls: { spotify: `https://open.spotify.com/album/${id}` }, available_markets: ['US'], genres: ['must-not-select-genre'],
  ...overrides,
});
const rawTrack = (n: number) => ({ id: String(n).padStart(22, '0'), name: `技术曲目${n}`, duration_ms: 180_500, disc_number: 1, track_number: n, artists: [{ name: '技术用例艺人' }] });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const token = () => json({ access_token: 'fictitious-server-token', expires_in: 3600 });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Spotify browser provider', () => {
  it.each([new Response('<html>static fallback</html>', { headers: { 'Content-Type': 'text/html' } }), json({ error: 'not found' }, 404)])('treats absent static-host API as not configured', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response.clone()));
    expect(await isSpotifyConfigured()).toBe(false);
    await expect(searchAlbums('测试')).rejects.toMatchObject({ code: 'SPOTIFY_NOT_CONFIGURED' });
  });
  it('empty input never produces synthetic results or a network call', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await searchAlbums('  ')).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
  });
  it('forwards cancellation instead of showing an unconnected error', async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(searchAlbums('技术用例', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['headers','body'])('bounds a stalled optional proxy %s request so manual editing can resume', async stage => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_url, init) => stage==='headers'
      ? new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))))
      : Promise.resolve(new Response(new ReadableStream<Uint8Array>({start(stream){init?.signal?.addEventListener('abort',()=>stream.error(new Error('slow body')));}}),{headers:{'Content-Type':'application/json'}}))));
    const outcome=expect(searchAlbums('test')).rejects.toMatchObject({code:'SPOTIFY_NOT_CONFIGURED'});
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
  });
  it('uses only the same-origin proxy and typed response', async () => {
    const expected = { id, title: '技术用例', artist: '技术者', year: '2026', releaseDate: '2026', releaseType: 'album', coverUrl: '', url: `https://open.spotify.com/album/${id}` };
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [expected] })); vi.stubGlobal('fetch', fetcher);
    expect(await searchAlbums('测试 & 乐队')).toEqual([expected]);
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain('/api/spotify?'); expect(new URL(url, 'https://local.invalid').searchParams.get('q')).toBe('测试 & 乐队');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('test-secret');
  });
  it('invalid album ID is rejected before issuing a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(getAlbum('../../another-host')).rejects.toBeInstanceOf(SpotifyError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not assume that the existence of credentials proves live authorization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { configured: true } })));
    expect(await spotifyStatus()).toEqual({ configured: true });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'SPOTIFY_UNAVAILABLE', message: '授权不可用' } }, 502)));
    await expect(searchAlbums('测试')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('uses the configured public HTTPS proxy for GitHub Pages without cookies or auth headers', async () => {
    vi.stubEnv('VITE_SPOTIFY_PROXY_URL', 'https://proxy.example/api/spotify');
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [] })); vi.stubGlobal('fetch', fetcher);
    expect(await searchAlbums('专辑 & 音乐人')).toEqual([]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe('https://proxy.example'); expect(url.pathname).toBe('/api/spotify'); expect(url.searchParams.get('q')).toBe('专辑 & 音乐人');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit', headers: { Accept: 'application/json' } });
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
  it.each(['http://proxy.example/api/spotify', 'https://user:secret@proxy.example/api', 'https://proxy.example/api?token=secret', 'https://proxy.example/api#secret', '/another/api', '*'])('rejects unsafe public endpoint %s before a request', async endpoint => {
    vi.stubEnv('VITE_SPOTIFY_PROXY_URL', endpoint); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(searchAlbums('测试')).rejects.toMatchObject({ code: 'SPOTIFY_NOT_CONFIGURED' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains the local same-origin endpoint when no public proxy is configured', () => {
    expect(resolveSpotifyEndpoint('')).toBe('/api/spotify');
    expect(resolveSpotifyEndpoint(null)).toBe('/api/spotify');
  });
  it.each([{}, null, { configured: 'yes' }])('rejects malformed status payload %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data })));
    await expect(spotifyStatus()).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('rejects incomplete normalized album metadata rather than letting the UI treat it as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id, title: '技术用例', artist: '', releaseDate: '', year: '' }] })));
    await expect(searchAlbums('测试')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('rejects normalized album details with missing tracks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { id, title: '技术用例', artist: '测试者', releaseDate: '2026-01-01', year: '2026', releaseType: 'album', coverUrl: '', url: `https://open.spotify.com/album/${id}`, totalTracks: 2, tracks: [] } })));
    await expect(getAlbum(id)).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('preserves typed rate limits and Retry-After without inventing empty search results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'SPOTIFY_RATE_LIMITED', message: '稍后再试', retryAfter: 120 } }, 429)));
    await expect(searchAlbums('测试')).rejects.toMatchObject({ code: 'SPOTIFY_RATE_LIMITED', retryAfter: 120 });
  });
});

describe('server-only official Spotify adapter', () => {
  it('makes no request without credentials and exposes only a configuration boolean', async () => {
    const fetcher = vi.fn(); const service = createSpotifyService({ env: {}, fetch: fetcher });
    expect(service.status()).toEqual({ configured: false });
    await expect(service.search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the official client-credentials grant, caches tokens, and excludes genre/origin assumptions', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json({ albums: { items: [rawAlbum()] } }));
    const service = createSpotifyService({ env, fetch: fetcher });
    const first = await service.search('技术用例'); await service.search('另一个用例');
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(fetcher.mock.calls[0][0]).toBe('https://accounts.spotify.com/api/token');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: 'grant_type=client_credentials', redirect: 'error' });
    const requestUrl = new URL(String(fetcher.mock.calls[1][0])); expect(requestUrl.hostname).toBe('api.spotify.com'); expect(requestUrl.searchParams.get('type')).toBe('album');
    expect(first[0]).toMatchObject({ id, title: '技术用例唱片（虚构）', year: '2026', releaseType: 'album', totalTracks: 2 });
    expect(first[0]).not.toHaveProperty('genres'); expect(first[0]).not.toHaveProperty('origin'); expect(first[0]).not.toHaveProperty('available_markets');
    expect(JSON.stringify(first)).not.toContain('test-secret'); expect(JSON.stringify(first)).not.toContain('fictitious-server-token');
  });
  it('does not label a single as EP or deduplicate releases by name', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json({ albums: { items: [rawAlbum({ album_type: 'single' }), rawAlbum({ id: 'ABCDEFGHIJKL1234567890', release_date: '2025-01-01' })] } }));
    const result = await createSpotifyService({ env, fetch: fetcher }).search('技术用例');
    expect(result).toHaveLength(2); expect(result[0].releaseType).toBe('single'); expect(result[0].kind).toBeUndefined(); expect(result[0].id).not.toBe(result[1].id);
  });
  it('collects every official album-track page and preserves exact milliseconds as seconds', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).includes('/api/token')) return token();
      if (String(url).includes('/tracks?')) return json({ items: [rawTrack(2)], next: null });
      return json(rawAlbum({ label: '技术用例厂牌', tracks: { items: [rawTrack(1)], next: `https://api.spotify.com/v1/albums/${id}/tracks?offset=1&limit=1` } }));
    });
    const result = await createSpotifyService({ env, fetch: fetcher }).album(id);
    expect(result.tracks).toHaveLength(2); expect(result.tracks[0].duration).toBe(180.5); expect(result.totalTracks).toBe(2); expect(result.label).toBe('技术用例厂牌');
    expect(fetcher.mock.calls[2][0]).toBe(`https://api.spotify.com/v1/albums/${id}/tracks?offset=1&limit=50`);
  });
  it('refuses pagination to other hosts before issuing an external request', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json(rawAlbum({ tracks: { items: [rawTrack(1)], next: 'https://untrusted.invalid/v1/albums/x/tracks?offset=1' } })));
    await expect(createSpotifyService({ env, fetch: fetcher }).album(id)).rejects.toThrow(); expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('rejects an incomplete track list rather than silently importing a truncated release', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json(rawAlbum({ tracks: { items: [rawTrack(1)], next: null } })));
    await expect(createSpotifyService({ env, fetch: fetcher }).album(id)).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('refreshes a token once on 401, then stops retrying', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json({}, 401));
    await expect(createSpotifyService({ env, fetch: fetcher }).search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
    expect(fetcher.mock.calls).toHaveLength(4);
  });
  it('returns Retry-After without repeatedly calling a rate-limited endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json({}, 429, { 'Retry-After': '120' }));
    await expect(createSpotifyService({ env, fetch: fetcher }).search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_RATE_LIMITED', retryAfter: 120 }); expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('bounds upstream request time and returns a safe generic error', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('transport secret must not leak')))));
    await expect(createSpotifyService({ env, fetch: fetcher, timeoutMs: 5 }).search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it('returns no credentials/token through its public handler', async () => {
    const handler = createSpotifyHandler({ env });
    const headers = new Map<string, string>(); let body = '';
    const response = { statusCode: 0, setHeader: (key: string, value: string) => headers.set(key, value), end: (value: string) => { body = value; } };
    await handler({ method: 'GET', url: '/api/spotify?action=status' } as IncomingMessage, response as unknown as ServerResponse);
    expect(JSON.parse(body)).toEqual({ data: { configured: true } }); expect(headers.get('Cache-Control')).toBe('no-store');
    expect(body).not.toContain(env.SPOTIFY_CLIENT_ID); expect(body).not.toContain(env.SPOTIFY_CLIENT_SECRET);
  });
  it.each([{ artists: [] }, { release_date: '' }, { release_date: '2026-02-30' }, { release_date_precision: 'year' }])('rejects incomplete official album fields %j', async invalid => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json({ albums: { items: [rawAlbum(invalid)] } }));
    await expect(createSpotifyService({ env, fetch: fetcher }).search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it.each([{ artists: [] }, { disc_number: undefined }, { track_number: 0 }, { id: null }])('does not fabricate missing track fields %j', async invalid => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json(rawAlbum({ total_tracks: 1, tracks: { items: [{ ...rawTrack(1), ...invalid }], next: null } })));
    await expect(createSpotifyService({ env, fetch: fetcher }).album(id)).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
  it.each([`https://user:pass@api.spotify.com/v1/albums/${id}/tracks?offset=1`, `https://api.spotify.com/v1/albums/${id}/tracks?offset=1#fragment`, `https://api.spotify.com/v1/albums/${id}/tracks?offset=0`, `https://api.spotify.com/v1/albums/${id}/tracks?offset=2`])('rejects unsafe or skipping pagination %s', async next => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/api/token') ? token() : json(rawAlbum({ tracks: { items: [rawTrack(1)], next } })));
    await expect(createSpotifyService({ env, fetch: fetcher }).album(id)).rejects.toThrow(); expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('keeps the timeout active while reading a slow JSON response body', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream<Uint8Array>({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('slow body aborted'))); } }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(createSpotifyService({ env, fetch: fetcher, timeoutMs: 5 }).search('技术用例')).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
  });
});

async function callHandler(handler: ReturnType<typeof createSpotifyHandler>, headers: Record<string, string> = {}, method = 'GET') {
  const responseHeaders = new Map<string, string>(); let body = '';
  const response = { statusCode: 0, setHeader: (key: string, value: string) => responseHeaders.set(key.toLowerCase(), value), end: (value?: string) => { body = value ?? ''; } };
  await handler({ method, url: '/api/spotify?action=status', headers, socket: {} } as IncomingMessage, response as unknown as ServerResponse);
  return { status: response.statusCode, headers: responseHeaders, body };
}
describe('cross-origin Pages / Node Serverless boundary', () => {
  const pageOrigin = 'https://reviewer.github.io';
  it('allows only the configured exact Pages origin and never allows cookies', async () => {
    const result = await callHandler(createSpotifyHandler({ env: { ...env, SPOTIFY_ALLOWED_ORIGINS: pageOrigin } }), { origin: pageOrigin, host: 'proxy.vercel.app' });
    expect(result.status).toBe(200); expect(result.headers.get('access-control-allow-origin')).toBe(pageOrigin); expect(result.headers.get('vary')).toBe('Origin'); expect(result.headers.has('access-control-allow-credentials')).toBe(false);
    expect(JSON.parse(result.body)).toEqual({ data: { configured: true } });
  });
  it.each(['https://evil.example', 'null', `${pageOrigin}/`, `${pageOrigin}.evil.example`, `${pageOrigin}/mumaka`])('blocks invalid/unapproved Origin %s before any upstream call', async origin => {
    const fetcher = vi.fn(); const result = await callHandler(createSpotifyHandler({ env: { ...env, SPOTIFY_ALLOWED_ORIGINS: pageOrigin }, fetch: fetcher }), { origin, host: 'proxy.vercel.app' });
    expect(result.status).toBe(403); expect(result.headers.has('access-control-allow-origin')).toBe(false); expect(fetcher).not.toHaveBeenCalled(); expect(result.body).not.toContain(env.SPOTIFY_CLIENT_SECRET);
  });
  it('never treats a wildcard as an allowed origin', async () => {
    const result = await callHandler(createSpotifyHandler({ env: { ...env, SPOTIFY_ALLOWED_ORIGINS: '*' } }), { origin: pageOrigin, host: 'proxy.vercel.app' }); expect(result.status).toBe(403);
  });
  it('keeps local same-origin requests and Vercel TLS-terminated same-origin requests working', async () => {
    expect((await callHandler(createSpotifyHandler({ env }), { origin: 'http://localhost:5173', host: 'localhost:5173' })).status).toBe(200);
    expect((await callHandler(createSpotifyHandler({ env: { ...env, VERCEL: '1' } }), { origin: 'https://proxy.vercel.app', host: 'proxy.vercel.app', 'x-forwarded-proto': 'https' })).status).toBe(200);
  });
  it('does not trust an arbitrary forwarded host to bypass the allowlist', async () => {
    const result = await callHandler(createSpotifyHandler({ env: { ...env, VERCEL: '1' } }), { origin: pageOrigin, host: 'proxy.vercel.app', 'x-forwarded-host': 'reviewer.github.io', 'x-forwarded-proto': 'https' }); expect(result.status).toBe(403);
  });
  it('answers an allowed GET preflight without contacting Spotify', async () => {
    const fetcher = vi.fn(); const result = await callHandler(createSpotifyHandler({ env: { ...env, SPOTIFY_ALLOWED_ORIGINS: pageOrigin }, fetch: fetcher }), { origin: pageOrigin, host: 'proxy.vercel.app', 'access-control-request-method': 'GET', 'access-control-request-headers': 'accept' }, 'OPTIONS');
    expect(result.status).toBe(204); expect(result.body).toBe(''); expect(result.headers.get('access-control-allow-methods')).toBe('GET'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ 'access-control-request-method': 'POST' }, { 'access-control-request-method': 'GET', 'access-control-request-headers': 'Authorization' }])('blocks a credentialed or unsupported preflight %j', async requested => {
    const result = await callHandler(createSpotifyHandler({ env: { ...env, SPOTIFY_ALLOWED_ORIGINS: pageOrigin } }), { ...requested, origin: pageOrigin, host: 'proxy.vercel.app' } as Record<string, string>, 'OPTIONS'); expect(result.status).toBe(405);
  });
});
