import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createSpotifyHandler } from '../server/spotify';

// Local HTTP transport fixtures only: no real credential or Spotify call.
const albumId = '1234567890ABCDEFGHIJKL';
const fixtureEnv = { SPOTIFY_CLIENT_ID: 'transport-test-client', SPOTIFY_CLIENT_SECRET: 'transport-test-secret' };
const officialFixture = {
  id: albumId, name: 'HTTP技术验收（虚构唱片）', album_type: 'album', release_date: '2026-10-30', release_date_precision: 'day', total_tracks: 1,
  artists: [{ name: 'HTTP技术测试者' }], images: [], external_urls: { spotify: `https://open.spotify.com/album/${albumId}` },
  tracks: { items: [{ id: 'ABCDEFGHIJKL1234567890', name: 'HTTP技术曲目', duration_ms: 180_500, disc_number: 1, track_number: 1, artists: [{ name: 'HTTP技术测试者' }] }], next: null, total: 1 },
};
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function withProxy(env: Record<string, string>, upstream: typeof fetch, check: (url: string) => Promise<void>) {
  const handler = createSpotifyHandler({ env, fetch: upstream });
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local test address');
  try { await check(`http://127.0.0.1:${address.port}/api/spotify`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('真实 Node HTTP 处理器允许精确 Pages Origin，搜索和专辑曲目可完整返回', async ({ request }) => {
  const origin = 'https://reviewer.github.io';
  const calls: string[] = [];
  await withProxy({ ...fixtureEnv, SPOTIFY_ALLOWED_ORIGINS: origin }, async url => {
    calls.push(String(url));
    if (String(url).includes('/api/token')) return json({ access_token: 'transport-test-token', expires_in: 3600 });
    return String(url).includes('/search?') ? json({ albums: { items: [officialFixture] } }) : json(officialFixture);
  }, async url => {
    const search = await request.get(`${url}?action=search&q=技术用例`, { headers: { Origin: origin } });
    expect(search.status()).toBe(200); expect(search.headers()['access-control-allow-origin']).toBe(origin); expect(search.headers()['access-control-allow-credentials']).toBeUndefined();
    expect((await search.json()).data[0]).toMatchObject({ id: albumId, artist: 'HTTP技术测试者', releaseDate: '2026-10-30' });
    const album = await request.get(`${url}?action=album&id=${albumId}`, { headers: { Origin: origin } });
    expect(album.status()).toBe(200); expect((await album.json()).data.tracks[0]).toMatchObject({ duration: 180.5, discNumber: 1, trackNumber: 1 });
    expect(JSON.stringify(await album.json())).not.toContain(fixtureEnv.SPOTIFY_CLIENT_SECRET);
  });
  expect(calls.filter(url => url.includes('/api/token'))).toHaveLength(1);
});

test('真实 HTTP 拒绝未知 Origin，预检只允许 GET 且不联系上游', async ({ request }) => {
  const origin = 'https://reviewer.github.io'; let calls = 0;
  await withProxy({ ...fixtureEnv, SPOTIFY_ALLOWED_ORIGINS: origin }, async () => { calls++; throw new Error('should not be called'); }, async url => {
    const denied = await request.get(`${url}?action=search&q=技术用例`, { headers: { Origin: 'https://unapproved.example' } });
    expect(denied.status()).toBe(403); expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
    const preflight = await request.fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'accept' } });
    expect(preflight.status()).toBe(204); expect(preflight.headers()['access-control-allow-methods']).toBe('GET');
    const blocked = await request.fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    expect(blocked.status()).toBe(405);
  });
  expect(calls).toBe(0);
});

test('真实 HTTP 区分尚未配置和配额限制，保留 Retry-After 且不重试轰炸', async ({ request }) => {
  const origin = 'https://reviewer.github.io';
  await withProxy({ SPOTIFY_ALLOWED_ORIGINS: origin }, async () => { throw new Error('no credentials'); }, async url => {
    const status = await request.get(`${url}?action=status`, { headers: { Origin: origin } });
    expect((await status.json()).data).toEqual({ configured: false });
    const search = await request.get(`${url}?action=search&q=技术用例`, { headers: { Origin: origin } });
    expect(search.status()).toBe(503); expect((await search.json()).error.code).toBe('SPOTIFY_NOT_CONFIGURED');
  });
  let calls = 0;
  await withProxy({ ...fixtureEnv, SPOTIFY_ALLOWED_ORIGINS: origin }, async url => {
    calls++;
    return String(url).includes('/api/token') ? json({ access_token: 'test-token', expires_in: 3600 }) : json({}, 429, { 'Retry-After': '90' });
  }, async url => {
    const result = await request.get(`${url}?action=search&q=技术用例`, { headers: { Origin: origin } });
    expect(result.status()).toBe(429); expect(result.headers()['retry-after']).toBe('90'); expect(result.headers()['access-control-expose-headers']).toBe('Retry-After');
    expect((await result.json()).error).toMatchObject({ code: 'SPOTIFY_RATE_LIMITED', retryAfter: 90 });
  });
  expect(calls).toBe(2);
});

test('真实 Chromium 从前端跨源读取允许的代理，使用无 Cookie 请求', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('No browser test origin');
  const origin = new URL(baseURL).origin;
  await withProxy({ ...fixtureEnv, SPOTIFY_ALLOWED_ORIGINS: origin }, async url => String(url).includes('/api/token') ? json({ access_token: 'transport-test-token', expires_in: 3600 }) : json({ albums: { items: [officialFixture] } }), async url => {
    await page.goto('/');
    const result = await page.evaluate(async endpoint => {
      const response = await fetch(`${endpoint}?action=search&q=HTTP测试`, { mode: 'cors', credentials: 'omit', headers: { Accept: 'application/json' } });
      return { status: response.status, body: await response.json() };
    }, url);
    expect(result.status).toBe(200); expect(result.body.data[0]).toMatchObject({ id: albumId, title: 'HTTP技术验收（虚构唱片）' });
  });
});
