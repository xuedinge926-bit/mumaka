import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToCoverDataURL, embedRemoteCover, MAX_COVER_BYTES } from './images';

const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' });
afterEach(() => vi.unstubAllGlobals());

describe('embedded cover assets', () => {
  it('embeds local image bytes in a portable data URI', async () => {
    const uri = await blobToCoverDataURL(png);
    expect(uri).toBe('data:image/png;base64,iVBORw0KGgoA');
    expect(atob(uri.split(',')[1]).charCodeAt(0)).toBe(137);
  });
  it('loads remote images through standard CORS without credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(png)); vi.stubGlobal('fetch', fetcher);
    expect(await embedRemoteCover('https://i.scdn.co/image/example')).toMatch(/^data:image\/png;base64,/);
    expect(fetcher).toHaveBeenCalledWith('https://i.scdn.co/image/example', expect.objectContaining({ mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
  });
  it.each(['http://example.com/cover.png', 'data:image/png;base64,abc', 'javascript:alert(1)', 'https://user:secret@example.com/cover.png', 'broken-url'])('rejects unsafe remote address %s', async url => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(embedRemoteCover(url)).rejects.toThrow('本地上传');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports CORS and HTTP errors with an upload fallback instead of bypassing them', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetcher);
    await expect(embedRemoteCover('https://example.com/cover.png')).rejects.toThrow('跨域、授权或网络限制');
    fetcher.mockResolvedValue(new Response('', { status: 403 }));
    await expect(embedRemoteCover('https://example.com/cover.png')).rejects.toThrow('本地上传');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized content before downloading it', async () => {
    const response = new Response(png, { headers: { 'Content-Length': String(MAX_COVER_BYTES + 1) } });
    const reader = vi.spyOn(response, 'blob'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(embedRemoteCover('https://example.com/large.png')).rejects.toThrow('超过 5 MB');
    expect(reader).not.toHaveBeenCalled();
  });
  it('rejects unsupported, empty, oversized and MIME-disguised files', async () => {
    await expect(blobToCoverDataURL(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow('本地上传');
    await expect(blobToCoverDataURL(new Blob([], { type: 'image/png' }))).rejects.toThrow('为空');
    await expect(blobToCoverDataURL(new Blob(['<html>not a png</html>'], { type: 'image/png' }))).rejects.toThrow('内容与图片格式不符');
    await expect(blobToCoverDataURL(new Blob([new Uint8Array(MAX_COVER_BYTES + 1)], { type: 'image/png' }))).rejects.toThrow('超过 5 MB');
  });
  it('stops a streamed oversized response even without Content-Length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_COVER_BYTES)); controller.enqueue(new Uint8Array([1])); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'image/png' } })));
    await expect(embedRemoteCover('https://example.com/stream.png')).rejects.toThrow('超过 5 MB');
    expect(cancel).toHaveBeenCalled();
  });
});
