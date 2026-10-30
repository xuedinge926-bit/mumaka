export const MAX_COVER_BYTES = 5 * 1024 * 1024;
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const uploadHint = '请改用本地上传 PNG、JPEG、WebP 或 GIF 图片（最多 5 MB）。';

/** Covers are stored as embedded images so saved records and exported SVGs work offline. */
export async function blobToCoverDataURL(blob: Blob): Promise<string> {
  const type = blob.type.toLowerCase().split(';')[0];
  if (!allowedTypes.includes(type)) throw new Error(`不支持此封面图片格式。${uploadHint}`);
  if (!blob.size || blob.size > MAX_COVER_BYTES) throw new Error(`封面为空或超过 5 MB。${uploadHint}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const signatureValid = type === 'image/png'
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
    : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!signatureValid) throw new Error(`封面文件内容与图片格式不符。${uploadHint}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** Use ordinary browser CORS only; never send credentials or use a CORS bypass proxy. */
export async function embedRemoteCover(url: string): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`封面地址无效。${uploadHint}`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`远程封面必须使用不含凭据的 HTTPS 地址。${uploadHint}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(parsed.href, { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok || response.type === 'opaque') throw new Error('无法获得可导出的图片响应');
    const length = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_COVER_BYTES) throw new Error('图片超过 5 MB');
    const type = (response.headers.get('Content-Type') ?? '').toLowerCase().split(';')[0];
    if (!allowedTypes.includes(type)) throw new Error('响应不是可支持的图片');
    if (!response.body) return await blobToCoverDataURL(await response.blob());
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COVER_BYTES) { await reader.cancel().catch(() => undefined); throw new Error('图片超过 5 MB'); }
      chunks.push(new Uint8Array(value).buffer);
    }
    return await blobToCoverDataURL(new Blob(chunks, { type }));
  } catch (error) {
    const detail = error instanceof Error && error.message.includes('5 MB') ? '远程封面超过 5 MB。' : '远程封面无法读取，可能受跨域、授权或网络限制。';
    throw new Error(`${detail}${uploadHint}`);
  } finally { clearTimeout(timer); }
}
