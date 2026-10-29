import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createId, sha256Hex } from './browserCrypto';

const nativeCrypto = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());

describe('browser crypto compatibility', () => {
  it('uses the native UUID method when available', () => {
    const nativeId = '12345678-1234-4234-8234-123456789abc';
    const randomUUID = vi.fn(() => nativeId);
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    expect(createId()).toBe(nativeId);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('creates a RFC 4122 UUID from secure random bytes when randomUUID is absent', () => {
    const getRandomValues = vi.fn((buffer: Uint8Array) => {
      buffer.set(Array.from({ length: 16 }, (_, index) => index));
      return buffer;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('preserves UUID version/variant and uniqueness with the actual random-byte provider', () => {
    vi.stubGlobal('crypto', { getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto) });
    const ids = Array.from({ length: 128 }, () => createId());
    expect(new Set(ids).size).toBe(128);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not substitute Math.random when no cryptographic randomness is available', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createId()).toThrow('安全随机数');
  });

  it('uses native SubtleCrypto SHA-256 when exposed', async () => {
    const digest = vi.fn(nativeCrypto.subtle.digest.bind(nativeCrypto.subtle));
    vi.stubGlobal('crypto', { subtle: { digest } });
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digest).toHaveBeenCalledOnce();
    expect(digest.mock.calls[0][0]).toBe('SHA-256');
  });

  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('uses the same SHA-256 known-answer vector without native APIs (%j)', async (value, expected) => {
    vi.stubGlobal('crypto', undefined);
    expect(await sha256Hex(value)).toBe(expected);
  });

  it('native and fallback hashes match independent SHA-256 for Unicode and multiple blocks', async () => {
    const value = '新乐评主义 · 六维证据 🎵\u0000'.repeat(70);
    const expected = createHash('sha256').update(value, 'utf8').digest('hex');
    expect(await sha256Hex(value)).toBe(expected);
    vi.stubGlobal('crypto', { getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto) });
    expect(await sha256Hex(value)).toBe(expected);
  });
});
