/** Browser-only Spotify metadata provider. Credentials belong to the server. */
export interface SpotifyAlbumSummary {
  id: string;
  title: string;
  artist: string;
  year: string;
  releaseDate: string;
  releaseType: 'album' | 'single' | 'compilation' | 'unknown';
  release?: string;
  kind?: '专辑' | 'EP';
  coverUrl: string;
  url: string;
  totalTracks?: number;
}
export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  discNumber: number;
  trackNumber: number;
}
export interface SpotifyAlbumDetails extends SpotifyAlbumSummary {
  tracks: SpotifyTrack[];
  label?: string;
  totalTracks: number;
}
export type SpotifyErrorCode = 'SPOTIFY_NOT_CONFIGURED' | 'SPOTIFY_RATE_LIMITED' | 'SPOTIFY_UNAVAILABLE' | 'SPOTIFY_INVALID_REQUEST' | 'SPOTIFY_NOT_FOUND' | 'SPOTIFY_FORBIDDEN';
export class SpotifyError extends Error {
  constructor(public code: SpotifyErrorCode, message: string, public retryAfter?: number) {
    super(message);
    this.name = 'SpotifyError';
  }
}

const codes = new Set<SpotifyErrorCode>(['SPOTIFY_NOT_CONFIGURED', 'SPOTIFY_RATE_LIMITED', 'SPOTIFY_UNAVAILABLE', 'SPOTIFY_INVALID_REQUEST', 'SPOTIFY_NOT_FOUND', 'SPOTIFY_FORBIDDEN']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const notConnected = () => new SpotifyError('SPOTIFY_NOT_CONFIGURED', 'Spotify 尚未连接，可以手动添加专辑。');
const invalidMetadata = () => new SpotifyError('SPOTIFY_UNAVAILABLE', 'Spotify 返回的专辑资料不完整，请重试或手动添加。');

/** Public endpoint configuration only. Client Secret never belongs in this URL. */
export function resolveSpotifyEndpoint(configured: unknown = import.meta.env?.VITE_SPOTIFY_PROXY_URL): string {
  if (configured === undefined || configured === null || configured === '') return '/api/spotify';
  try {
    if (typeof configured !== 'string') throw new Error();
    const url = new URL(configured.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  } catch { throw new SpotifyError('SPOTIFY_NOT_CONFIGURED', 'Spotify 代理地址需为不含账号、密钥、查询参数或片段的 HTTPS 地址。'); }
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function validReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const parts = value.split('-');
  if (parts.length === 1) return true;
  const month = Number(parts[1]);
  if (month < 1 || month > 12) return false;
  if (parts.length === 2) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(parts[0]) && date.getUTCMonth() + 1 === month && date.getUTCDate() === Number(parts[2]);
}
function validSummary(value: unknown): value is SpotifyAlbumSummary {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9]{22}$/.test(value.id) || !nonempty(value.title) || !nonempty(value.artist) || !validReleaseDate(value.releaseDate) || value.year !== value.releaseDate.slice(0, 4) || !['album', 'single', 'compilation', 'unknown'].includes(String(value.releaseType)) || typeof value.coverUrl !== 'string' || typeof value.url !== 'string') return false;
  try {
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.pathname !== `/album/${value.id}`) return false;
    if (value.coverUrl) { const image = new URL(value.coverUrl); if (image.protocol !== 'https:' || image.username || image.password) return false; }
  } catch { return false; }
  return (value.kind === undefined || value.kind === '专辑' || value.kind === 'EP') && (value.totalTracks === undefined || typeof value.totalTracks === 'number' && Number.isInteger(value.totalTracks) && value.totalTracks >= 0);
}
function validTrack(value: unknown): value is SpotifyTrack {
  return object(value) && nonempty(value.id) && nonempty(value.title) && nonempty(value.artist) && typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 && typeof value.discNumber === 'number' && Number.isInteger(value.discNumber) && value.discNumber >= 1 && typeof value.trackNumber === 'number' && Number.isInteger(value.trackNumber) && value.trackNumber >= 1;
}

async function request<T>(action: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ action, ...params });
  const endpoint = resolveSpotifyEndpoint();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  // Includes response body reads. An optional metadata provider cannot lock editing forever.
  const timer = setTimeout(cancel, 20_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${endpoint}?${query}`, { signal: controller.signal, mode: 'cors', headers: { Accept: 'application/json' }, credentials: 'omit' });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw notConnected();
    }
    // Static hosts can serve HTML for absent API routes; this is unconfigured.
    if (!response.headers.get('content-type')?.includes('application/json')) throw notConnected();
    let payload: unknown;
    try { payload = await response.json(); } catch { throw notConnected(); }
    if (!object(payload)) throw notConnected();
    if (!response.ok) {
      const error = object(payload.error) ? payload.error : {};
      const code = codes.has(error.code as SpotifyErrorCode) ? error.code as SpotifyErrorCode : response.status === 404 ? 'SPOTIFY_NOT_CONFIGURED' : 'SPOTIFY_UNAVAILABLE';
      throw new SpotifyError(code, typeof error.message === 'string' ? error.message : 'Spotify 暂时不可用，请稍后再试或手动添加。', typeof error.retryAfter === 'number' ? error.retryAfter : undefined);
    }
    if (!('data' in payload)) throw notConnected();
    return payload.data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function spotifyStatus(signal?: AbortSignal): Promise<{ configured: boolean }> {
  try {
    const result: unknown = await request('status', {}, signal);
    if (!object(result) || typeof result.configured !== 'boolean') throw invalidMetadata();
    return { configured: result.configured };
  } catch (error) {
    if (error instanceof SpotifyError && error.code === 'SPOTIFY_NOT_CONFIGURED') return { configured: false };
    throw error;
  }
}
export async function isSpotifyConfigured(signal?: AbortSignal): Promise<boolean> { return (await spotifyStatus(signal)).configured; }
export async function searchAlbums(query: string, signal?: AbortSignal): Promise<SpotifyAlbumSummary[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (normalized.length > 120) throw new SpotifyError('SPOTIFY_INVALID_REQUEST', '搜索词请控制在 120 字以内。');
  const result: unknown = await request('search', { q: normalized }, signal);
  if (!Array.isArray(result) || !result.every(validSummary)) throw invalidMetadata();
  return result;
}
export async function getAlbum(id: string, signal?: AbortSignal): Promise<SpotifyAlbumDetails> {
  if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new SpotifyError('SPOTIFY_INVALID_REQUEST', '专辑标识无效，请重新选择搜索结果。');
  const result: unknown = await request('album', { id }, signal);
  if (!validSummary(result) || result.id !== id || !object(result) || !Array.isArray(result.tracks) || !result.tracks.every(validTrack) || typeof result.totalTracks !== 'number' || !Number.isInteger(result.totalTracks) || result.totalTracks !== result.tracks.length || result.label !== undefined && typeof result.label !== 'string') throw invalidMetadata();
  return result as unknown as SpotifyAlbumDetails;
}
