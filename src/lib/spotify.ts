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
export type SpotifyErrorCode = 'SPOTIFY_NOT_CONFIGURED' | 'SPOTIFY_RATE_LIMITED' | 'SPOTIFY_UNAVAILABLE' | 'SPOTIFY_INVALID_REQUEST' | 'SPOTIFY_NOT_FOUND';
export class SpotifyError extends Error {
  constructor(public code: SpotifyErrorCode, message: string, public retryAfter?: number) {
    super(message);
    this.name = 'SpotifyError';
  }
}

const codes = new Set<SpotifyErrorCode>(['SPOTIFY_NOT_CONFIGURED', 'SPOTIFY_RATE_LIMITED', 'SPOTIFY_UNAVAILABLE', 'SPOTIFY_INVALID_REQUEST', 'SPOTIFY_NOT_FOUND']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const notConnected = () => new SpotifyError('SPOTIFY_NOT_CONFIGURED', 'Spotify 尚未连接，可以手动添加专辑。');

async function request<T>(action: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ action, ...params });
  let response: Response;
  try {
    response = await fetch(`/api/spotify?${query}`, { signal, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  } catch (error) {
    if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
    throw notConnected();
  }
  // Static hosting often serves index.html for an unknown API route. That is
  // an unconnected provider, not a successful search with fabricated results.
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
}

export async function spotifyStatus(signal?: AbortSignal): Promise<{ configured: boolean }> {
  try {
    const result: unknown = await request('status', {}, signal);
    return { configured: object(result) && result.configured === true };
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
  return request<SpotifyAlbumSummary[]>('search', { q: normalized }, signal);
}
export async function getAlbum(id: string, signal?: AbortSignal): Promise<SpotifyAlbumDetails> {
  if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new SpotifyError('SPOTIFY_INVALID_REQUEST', '专辑标识无效，请重新选择搜索结果。');
  return request<SpotifyAlbumDetails>('album', { id }, signal);
}
