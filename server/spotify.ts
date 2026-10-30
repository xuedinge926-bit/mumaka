import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { SpotifyAlbumDetails, SpotifyAlbumSummary, SpotifyErrorCode, SpotifyTrack } from '../src/lib/spotify';

const API = 'https://api.spotify.com/v1';
const TOKEN = 'https://accounts.spotify.com/api/token';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const artist = (value: unknown): string => {
  const artists = array(value);
  if (!artists.length || artists.some(v => !object(v) || !text(v.name).trim())) throw unavailable();
  return artists.map(v => text((v as Record<string, unknown>).name)).join(' / ');
};

class ApiError extends Error {
  constructor(public code: SpotifyErrorCode, message: string, public status: number, public retryAfter?: number) { super(message); }
}
const unavailable = () => new ApiError('SPOTIFY_UNAVAILABLE', 'Spotify 暂时不可用，请稍后重试或手动添加。', 502);
const validId = (id: string) => /^[a-zA-Z0-9]{22}$/.test(id);
const safeUrl = (value: unknown, hostname?: string): string => {
  try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password && (!hostname || url.hostname === hostname) ? url.href : ''; } catch { return ''; }
};
function releaseDate(value: unknown): string {
  const date = text(value);
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date)) throw unavailable();
  const parts = date.split('-');
  if (parts.length > 1 && (Number(parts[1]) < 1 || Number(parts[1]) > 12)) throw unavailable();
  if (parts.length === 3) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== Number(parts[0]) || parsed.getUTCMonth() + 1 !== Number(parts[1]) || parsed.getUTCDate() !== Number(parts[2])) throw unavailable();
  }
  return date;
}
function summary(raw: unknown): SpotifyAlbumSummary {
  if (!object(raw) || !validId(text(raw.id)) || !text(raw.name)) throw unavailable();
  const releaseType = ['album', 'single', 'compilation'].includes(text(raw.album_type)) ? raw.album_type as SpotifyAlbumSummary['releaseType'] : 'unknown';
  const released = releaseDate(raw.release_date);
  const datePrecision = { year: 4, month: 7, day: 10 } as const;
  if (raw.release_date_precision !== undefined && (typeof raw.release_date_precision !== 'string' || !(raw.release_date_precision in datePrecision) || released.length !== datePrecision[raw.release_date_precision as keyof typeof datePrecision])) throw unavailable();
  const image = array(raw.images).find(v => object(v) && safeUrl(v.url));
  const external = object(raw.external_urls) ? raw.external_urls : {};
  return { id: text(raw.id), title: text(raw.name), artist: artist(raw.artists), year: released.slice(0, 4), releaseDate: released, releaseType,
    ...(releaseType === 'album' || releaseType === 'compilation' ? { kind: '专辑' as const } : {}),
    coverUrl: object(image) ? safeUrl(image.url) : '', url: safeUrl(external.spotify, 'open.spotify.com') || `https://open.spotify.com/album/${raw.id}`,
    ...(typeof raw.total_tracks === 'number' && Number.isInteger(raw.total_tracks) ? { totalTracks: raw.total_tracks } : {}) };
}
function track(raw: unknown): SpotifyTrack {
  if (!object(raw) || !validId(text(raw.id)) || !text(raw.name).trim() || typeof raw.duration_ms !== 'number' || !Number.isInteger(raw.duration_ms) || raw.duration_ms < 0 || typeof raw.disc_number !== 'number' || !Number.isInteger(raw.disc_number) || raw.disc_number < 1 || typeof raw.track_number !== 'number' || !Number.isInteger(raw.track_number) || raw.track_number < 1) throw unavailable();
  return { id: text(raw.id), title: text(raw.name), artist: artist(raw.artists), duration: raw.duration_ms / 1000,
    discNumber: raw.disc_number, trackNumber: raw.track_number };
}

export interface SpotifyServiceOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Official API only. No secrets, access tokens, or upstream bodies are logged/returned. */
export function createSpotifyService(options: SpotifyServiceOptions = {}) {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number; credentialKey: string } | undefined;
  let inFlight: Promise<string> | undefined;
  const configured = () => Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
  async function fetchTimed(url: string, init: RequestInit = {}): Promise<{ response: Response; data?: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
      // Include JSON body consumption in the timeout, not only response headers.
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); return { response }; }
      return { response, data: await response.json() };
    } catch { throw unavailable(); } finally { clearTimeout(timer); }
  }
  const rateLimited = (response: Response): ApiError => {
    const raw = Number(response.headers.get('retry-after'));
    const retryAfter = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 30;
    return new ApiError('SPOTIFY_RATE_LIMITED', `Spotify 请求较多，请 ${retryAfter} 秒后再试。`, 429, retryAfter);
  };
  async function token(force = false): Promise<string> {
    if (!configured()) throw new ApiError('SPOTIFY_NOT_CONFIGURED', 'Spotify 尚未连接，可以手动添加专辑。', 503);
    const credentialKey = `${env.SPOTIFY_CLIENT_ID}\0${env.SPOTIFY_CLIENT_SECRET}`;
    if (!force && cached?.credentialKey === credentialKey && cached.expiresAt > now() + 30_000) return cached.token;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { response, data: value } = await fetchTimed(TOKEN, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
      if (response.status === 429) throw rateLimited(response);
      if (!response.ok) throw new ApiError('SPOTIFY_UNAVAILABLE', 'Spotify 授权尚未可用，请检查服务端凭据及开发者应用权限。', 502);
      if (!object(value) || !text(value.access_token) || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw unavailable();
      cached = { token: text(value.access_token), expiresAt: now() + value.expires_in * 1000, credentialKey };
      return cached.token;
    })();
    try { return await inFlight; } finally { inFlight = undefined; }
  }
  async function spotify(path: string, refreshed = false): Promise<Record<string, unknown>> {
    const accessToken = await token();
    const { response, data: value } = await fetchTimed(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (response.status === 401 && !refreshed) { cached = undefined; await token(true); return spotify(path, true); }
    if (response.status === 429) throw rateLimited(response);
    if (response.status === 404) throw new ApiError('SPOTIFY_NOT_FOUND', '未找到该 Spotify 专辑，可以手动添加。', 404);
    if (!response.ok) throw unavailable();
    if (!object(value)) throw unavailable();
    return value;
  }
  return {
    status: () => ({ configured: configured() }),
    async search(query: string): Promise<SpotifyAlbumSummary[]> {
      const q = query.trim();
      if (!q || q.length > 120) throw new ApiError('SPOTIFY_INVALID_REQUEST', '请输入 1–120 字的专辑或音乐人名称。', 400);
      const value = await spotify(`/search?${new URLSearchParams({ q, type: 'album', limit: '10' })}`);
      if (!object(value.albums) || !Array.isArray(value.albums.items)) throw unavailable();
      return value.albums.items.map(summary);
    },
    async album(id: string): Promise<SpotifyAlbumDetails> {
      if (!validId(id)) throw new ApiError('SPOTIFY_INVALID_REQUEST', '专辑标识无效。', 400);
      const value = await spotify(`/albums/${id}`);
      if (!object(value.tracks) || !Array.isArray(value.tracks.items)) throw unavailable();
      if (!validId(text(value.id)) || value.id !== id || typeof value.total_tracks !== 'number' || !Number.isInteger(value.total_tracks) || value.total_tracks < 0 || value.total_tracks > 10_000) throw unavailable();
      if (value.tracks.total !== undefined && value.tracks.total !== value.total_tracks) throw unavailable();
      const all = [...value.tracks.items];
      let next = text(value.tracks.next);
      const visited = new Set<string>();
      // Never fetch arbitrary next URLs: validate the fixed official host and
      // album path, then reconstruct the permitted pagination query ourselves.
      for (let page = 0; next; page++) {
        if (page >= 100 || visited.has(next)) throw unavailable();
        visited.add(next);
        const url = new URL(next);
        const offset = url.searchParams.get('offset');
        if (url.protocol !== 'https:' || url.hostname !== 'api.spotify.com' || url.port || url.username || url.password || url.hash || url.pathname !== `/v1/albums/${id}/tracks` || !offset || !/^\d+$/.test(offset) || Number(offset) !== all.length || Number(offset) > 10_000) throw unavailable();
        const data = await spotify(`/albums/${id}/tracks?${new URLSearchParams({ offset, limit: '50' })}`);
        if (!Array.isArray(data.items)) throw unavailable();
        all.push(...data.items);
        next = text(data.next);
      }
      const totalTracks = value.total_tracks;
      if (totalTracks !== all.length) throw new ApiError('SPOTIFY_UNAVAILABLE', 'Spotify 曲目资料不完整，请稍后重试或手动补充。', 502);
      return { ...summary(value), tracks: all.map(track), totalTracks, ...(text(value.label) ? { label: text(value.label) } : {}) };
    },
  };
}

export function createSpotifyHandler(options: SpotifyServiceOptions = {}) {
  const env = options.env ?? process.env;
  const service = createSpotifyService({ ...options, env });
  const originUrl = (raw: string): URL | undefined => {
    try {
      const url = new URL(raw);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
      return url;
    } catch { return undefined; }
  };
  const allowed = new Set((env.SPOTIFY_ALLOWED_ORIGINS ?? '').split(',').map(value => originUrl(value.trim())?.origin).filter((value): value is string => Boolean(value)));
  const sameOrigin = (request: IncomingMessage): string | undefined => {
    const host = request.headers?.host;
    if (!host || Array.isArray(host)) return undefined;
    let protocol = (request.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https:' : 'http:';
    // Host comes from the actual request. Never trust an arbitrary forwarded
    // host; Vercel's managed HTTPS termination is the supported proxy case.
    const forwardedProtocol = request.headers['x-forwarded-proto'];
    if (env.VERCEL === '1' && (forwardedProtocol === 'https' || forwardedProtocol === 'http')) protocol = `${forwardedProtocol}:`;
    return originUrl(`${protocol}//${host}`)?.origin;
  };
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Content-Type', 'application/json;charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    try {
      const origin = request.headers?.origin;
      if (origin !== undefined) {
        const parsed = typeof origin === 'string' ? originUrl(origin) : undefined;
        if (!parsed || origin !== parsed.origin || (!allowed.has(parsed.origin) && parsed.origin !== sameOrigin(request))) throw new ApiError('SPOTIFY_FORBIDDEN', '当前网站尚未获得专辑搜索代理的访问许可，请检查代理配置。', 403);
        response.setHeader('Access-Control-Allow-Origin', parsed.origin);
        response.setHeader('Access-Control-Expose-Headers', 'Retry-After');
      }
      if (request.method === 'OPTIONS') {
        const requested = request.headers?.['access-control-request-method'];
        const headers = text(request.headers?.['access-control-request-headers']).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (requested && requested !== 'GET' || headers.some(value => value !== 'accept')) throw new ApiError('SPOTIFY_INVALID_REQUEST', '此代理仅允许无需账号凭据的 GET 请求。', 405);
        response.setHeader('Allow', 'GET, OPTIONS');
        response.setHeader('Access-Control-Allow-Methods', 'GET');
        response.setHeader('Access-Control-Allow-Headers', 'Accept');
        response.setHeader('Access-Control-Max-Age', '600');
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); throw new ApiError('SPOTIFY_INVALID_REQUEST', '仅支持 GET 请求。', 405); }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const action = url.searchParams.get('action');
      const data = action === 'status' ? service.status() : action === 'search' ? await service.search(url.searchParams.get('q') ?? '') : action === 'album' ? await service.album(url.searchParams.get('id') ?? '') : (() => { throw new ApiError('SPOTIFY_INVALID_REQUEST', '未知的 Spotify 操作。', 400); })();
      response.statusCode = 200;
      response.end(JSON.stringify({ data }));
    } catch (error) {
      const safe = error instanceof ApiError ? error : unavailable();
      response.statusCode = safe.status;
      if (safe.retryAfter) response.setHeader('Retry-After', String(safe.retryAfter));
      response.end(JSON.stringify({ error: { code: safe.code, message: safe.message, ...(safe.retryAfter ? { retryAfter: safe.retryAfter } : {}) } }));
    }
  };
}

export function spotifyProxy(options: SpotifyServiceOptions = {}): Plugin {
  const handler = createSpotifyHandler(options);
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/spotify') { next(); return; }
    void handler(request, response);
  };
  return { name: 'nmc-spotify-proxy', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
