/**
 * UUID and SHA-256 support for browser contexts that expose getRandomValues,
 * but not the secure-context-only randomUUID / SubtleCrypto APIs.
 * IDs always use cryptographic randomness; hashes retain SHA-256 verification.
 */
const toHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function createId(): string {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === 'function') return browserCrypto.randomUUID();
  if (typeof browserCrypto?.getRandomValues !== 'function') {
    throw new Error('当前浏览器无法提供安全随机数，请使用支持 Web Crypto 的现代浏览器。');
  }
  const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
  // RFC 4122 UUID version 4 and variant 1; getRandomValues also works on HTTP.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return toHex(new Uint8Array(digest));
  }
  // Audited implementation of the same algorithm, loaded only when the native
  // API is unavailable. No data is sent to a service or substituted with a weak hash.
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return toHex(sha256(bytes));
}
