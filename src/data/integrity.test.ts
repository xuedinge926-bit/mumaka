import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import genres from './genres.json';
import chinaIndex from './china-index.json';
import provenance from './provenance.json';
import rubric from './rubric.json';
import { DIMENSIONS } from '../model/types';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = `${project}docs/reference-supplement/`;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** RFC4180 quoting (including escaped quotes, commas and multiline cells). */
function csvRows(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const csv = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV field in frozen source');
  if (row.length || cell) { row.push(cell); rows.push(row); }
  const header = rows.shift()!;
  return rows.filter(r => r.some(Boolean)).map(r => {
    if (r.length !== header.length) throw new Error('Frozen CSV row width mismatch');
    return Object.fromEntries(header.map((key, i) => [key, r[i]]));
  });
}

describe('authoritative source data integrity', () => {
  it('matches every frozen global CSV field used by the application, without changing weights', () => {
    const rows = csvRows(readFileSync(`${source}data/genre-weights-v0.17-frozen.csv`, 'utf8'));
    expect(rows).toHaveLength(558);
    expect(genres).toHaveLength(558);
    expect(new Set(genres.map(g => g.id)).size).toBe(558);
    const byId = new Map(rows.map(row => [row.genre_id, row]));
    for (const genre of genres) {
      const original = byId.get(genre.id)!;
      expect(original, genre.id).toBeDefined();
      expect(genre).toEqual({
        id: original.genre_id,
        name: original.name_zh,
        nameEn: original.name_en,
        status: original.status,
        weights: DIMENSIONS.map(d => Number(original[d])),
        parentId: original.parent_id,
        note: original.note,
        validation: original.weight_validation,
        orientationReason: original.orientation_reason,
      });
      expect(genre.weights.reduce((a, b) => a + b, 0)).toBe(100);
      expect(genre.weights.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(70);
      expect(genre.weights.slice(4)).toEqual([15, 15]);
    }
  });

  it('preserves all 33 market entries and their 32 global references, statuses and evidence criteria', () => {
    const rows = csvRows(readFileSync(`${source}data/CHINA_MARKET_INDEX_33.csv`, 'utf8'));
    expect(rows).toHaveLength(33);
    expect(chinaIndex).toHaveLength(33);
    expect(new Set(chinaIndex.map(e => e.genreId)).size).toBe(32);
    const byId = new Map(rows.map(row => [row.entry_id, row]));
    for (const entry of chinaIndex) {
      const original = byId.get(entry.id)!;
      expect(original, entry.id).toBeDefined();
      expect(entry).toMatchObject({
        id: original.entry_id, name: original.display_name, group: original.group,
        genreId: original.global_genre_id, status: original.usage_state,
        kind: original.entry_type, criteria: original.criteria,
        insufficient: original.not_sufficient, verification: original.usage_research,
      });
      expect(genres.some(g => g.id === entry.genreId)).toBe(true);
    }
    expect(chinaIndex.find(e => e.id === 'cn-index:campus-folk')?.genreId).toBe('genre:contemporary-folk');
    expect(chinaIndex.filter(e => e.status === 'conditional')).toHaveLength(2);
    expect(genres.filter(g => g.status === 'provisional_chinese_focus')).toHaveLength(24);
  });

  it('matches the original frozen CSV SHA in both manifest and application provenance', () => {
    const manifest = JSON.parse(readFileSync(`${source}data/VERSION_MANIFEST.json`, 'utf8'));
    const hash = sha256(readFileSync(`${source}data/genre-weights-v0.17-frozen.csv`));
    expect(hash).toBe(manifest.global_base_sha256);
    expect(hash).toBe(provenance.baseDataSha256);
    expect(sha256(readFileSync(`${source}MODEL_POLICY_V019.json`))).toBe(provenance.policySha256);
  });

  it('keeps machine policies and supplied golden fixtures byte-for-byte unchanged', () => {
    for (const [local, original] of [
      ['policy.json', 'MODEL_POLICY_V019.json'],
      ['source-policy.json', 'source-correction-policy-v0.16.json'],
      ['golden-fixtures.json', 'data/GOLDEN_CALC_FIXTURES.json'],
    ]) {
      expect(readFileSync(`${project}src/data/${local}`).equals(readFileSync(`${source}${original}`)), local).toBe(true);
    }
  });

  it('preserves the exact six definitions, questions, boundaries and all 60 handbook grade criteria', () => {
    const handbook = readFileSync(`${source}data/HANDBOOK_V0.16_BASELINE.md`, 'utf8');
    expect(Object.keys(rubric).sort()).toEqual([...DIMENSIONS].sort());
    for (const dimension of DIMENSIONS) {
      const start = handbook.indexOf(` · ${dimension}\n`);
      expect(start).toBeGreaterThan(-1);
      const rest = handbook.slice(start + ` · ${dimension}\n`.length);
      const section = rest.split(/\n###? /)[0];
      const definition = section.trim().split('\n')[0];
      const question = section.match(/\*\*核心问题：\*\*(.*)/)?.[1].trim();
      const boundary = section.match(/\*\*边界：\*\*(.*)/)?.[1].trim();
      const levels = [...section.matchAll(/^\|\s*(\d+(?:\.\d+)?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
        .map(match => ({ star: Number(match[1]), label: match[2].trim(), criteria: match[3].trim() }));
      expect(levels, dimension).toHaveLength(10);
      expect(rubric[dimension], dimension).toEqual({ definition, question, boundary, levels });
    }
  });

  it('verifies every retained authoritative source SHA against actual file bytes', () => {
    const entries = Object.entries(provenance.sourceFiles).filter(([path]) => !path.includes('__pycache__') && !path.endsWith('.pyc'));
    expect(entries.length).toBeGreaterThan(20);
    for (const [path, expected] of entries) {
      expect(sha256(readFileSync(`${project}docs/${path}`)), path).toBe(expected);
    }
  });
});
