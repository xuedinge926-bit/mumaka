import { createId, sha256Hex } from './browserCrypto';
import { openDB, type DBSchema } from 'idb';
import { DIMENSIONS, type Album, type Calculation, type Snapshot } from '../model/types';
import provenance from '../data/provenance.json';
import genres from '../data/genres.json';
import chinaIndex from '../data/china-index.json';
import { calculate } from '../model/engine';
import { calculatePrivate } from '../model/privateReview';

interface LibraryDB extends DBSchema {
  albums: { key: string; value: Album };
  snapshots: { key: string; value: Snapshot; indexes: { albumId: string } };
}
const db = () => openDB<LibraryDB>('nmc-workbench-v1', 1, {
  upgrade(database) {
    database.createObjectStore('albums', { keyPath: 'id' });
    database.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('albumId', 'albumId');
  },
});
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (message: string): never => { throw new Error(message); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const date = (v: unknown): boolean => text(v) && Number.isFinite(Date.parse(v));
const statuses = ['draft', 'research_candidate', 'publish_eligible', 'published'];

/** Validate the complete persisted shape before opening a write transaction. */
export function validateAlbum(value: unknown): asserts value is Album {
  if (!object(value)) fail('作品数据必须是对象');
  const a = value as Record<string, unknown>;
  const stringFields = ['id', 'title', 'artist', 'year', 'release', 'cover', 'language', 'region', 'label', 'genreId', 'chinaEntryId', 'genreEvidence', 'genreExclusions', 'cultureNote', 'sourceNote', 'summary', 'reviewer'];
  if (!stringFields.every(k => text(a[k])) || !a.id) fail('作品缺少必要的文本字段或 ID');
  if (a.parentSnapshotId !== undefined && !text(a.parentSnapshotId)) fail('历史版本引用格式错误');
  for (const key of ['sourcePreset', 'historicTraditionEvidence', 'crossFamilyReason']) if (a[key] !== undefined && !text(a[key])) fail('扩展审核字段格式错误');
  if (a.releaseIdentityVerified !== undefined && typeof a.releaseIdentityVerified !== 'boolean') fail('发行身份审核字段格式错误');
  if (a.ux !== undefined) {
    if (!object(a.ux) || !['china', 'global'].includes(a.ux.market as string) || (a.ux.sourceKind !== undefined && !['new', 'cover', 'mixed', 'rerecord', 'unknown'].includes(a.ux.sourceKind as string))) fail('私人评分设置格式错误');
    const ux = a.ux as Record<string, unknown>;
    if (ux.sourcePresetConfirmed !== undefined && !text(ux.sourcePresetConfirmed)) fail('来源确认格式错误');
    if (ux.sourceDoubleCount !== undefined && !['clear', 'included', 'unknown'].includes(ux.sourceDoubleCount as string)) fail('来源重叠确认格式错误');
    if (ux.cardRatio !== undefined && !['4:5', '3:4', '1:1'].includes(ux.cardRatio as string)) fail('评分卡比例无效');
    if (ux.cardTheme !== undefined && !['paper', 'ink'].includes(ux.cardTheme as string)) fail('评分卡主题无效');
  }
  if (a.spotify !== undefined) {
    if (!object(a.spotify) || !text(a.spotify.id) || !text(a.spotify.url) || (a.spotify.coverUrl !== undefined && !text(a.spotify.coverUrl)) || (a.spotify.releaseDate !== undefined && !text(a.spotify.releaseDate))) fail('Spotify 来源信息格式错误');
    for (const key of ['url', 'coverUrl']) {
      const field = (a.spotify as Record<string, unknown>)[key];
      if (field) { try { const url = new URL(field as string); if (url.protocol !== 'https:' || url.username || url.password) fail('Spotify 来源链接须使用 HTTPS'); } catch { fail('Spotify 来源链接须使用 HTTPS'); } }
    }
  }
  if (!['专辑', 'EP'].includes(a.kind as string) || !['single', 'equal', 'duration'].includes(a.blendMode as string) || !statuses.includes(a.status as string)) fail('作品类型、聚合方式或审核状态无效');
  if (!date(a.createdAt) || !date(a.updatedAt) || !Number.isInteger(a.revision) || (a.revision as number) < 1) fail('作品日期或版本号无效');
  if (!['sourceReviewed', 'noDoubleCount', 'fullListenConfirmed'].every(k => typeof a[k] === 'boolean')) fail('审核确认字段无效');
  for (const key of ['cultureDelta', 'sourceDelta']) {
    if (!Array.isArray(a[key]) || a[key].length !== 6 || !a[key].every(finite)) fail('权重修正必须是六个有限数值');
  }
  if ((a.cover as string).length > 12 * 1024 * 1024 || (a.cover && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.cover as string))) fail('封面只支持本地 PNG、JPEG、WebP 或 GIF 图片（最多 12 MB）');
  if (!Array.isArray(a.tracks)) fail('曲目列表无效');
  const trackIds = new Set<string>();
  for (const track of a.tracks as unknown[]) {
    if (!object(track) || !['id', 'title', 'genreId', 'lyricsSource', 'compositionSource', 'sourceEvidence'].every(k => text(track[k])) || !track.id || !finite(track.duration) || track.duration < 0) fail('曲目字段或时长无效');
    const t = track as Record<string, unknown>;
    if (t.genreEvidence !== undefined && !text(t.genreEvidence)) fail('曲目风格依据格式错误');
    if (t.provenanceKind !== undefined && !['new', 'existing', 'rerecord', 'unknown'].includes(t.provenanceKind as string)) fail('曲目来源选择格式错误');
    if (trackIds.has(t.id as string)) fail('曲目 ID 重复');
    trackIds.add(t.id as string);
  }
  if (!object(a.ratings)) fail('六维评价数据无效');
  for (const dimension of DIMENSIONS) {
    const r = (a.ratings as Record<string, unknown>)[dimension];
    if (!object(r) || !['evidence', 'counterEvidence', 'rationale', 'highJustification', 'notLower', 'naReason'].every(k => text(r[k])) || typeof r.naApproved !== 'boolean') fail(`“${dimension}”评价字段不完整`);
    const v = (r as Record<string, unknown>).value;
    if (v !== null && v !== 'na' && (!finite(v) || v < 0.5 || v > 5 || !Number.isInteger(v * 2))) fail('星级须为 0.5–5，步长 0.5，或未评价 / N/A');
    if (v === 'na' && dimension !== 'lyrics' && dimension !== 'performance') fail('只有作词与特殊表演允许 N/A');
  }
}

function validateCalculation(value: unknown): asserts value is Calculation {
  if (!object(value)) fail('快照缺少计算结果');
  const c = value as Record<string, unknown>;
  if (!['valid', 'complete', 'publishEligible'].every(k => typeof c[k] === 'boolean') || !['errors', 'warnings', 'eligibilityIssues'].every(k => strings(c[k]))) fail('快照计算状态无效');
  if (!(c.total === null || (text(c.total) && /^(?:[0-9]\.[0-9]{2}|10\.00)$/.test(c.total))) || !(c.exactTotal === null || (text(c.exactTotal) && /^\d+(?:\/[1-9]\d*)?$/.test(c.exactTotal)))) fail('快照总分格式无效');
  for (const key of ['baseWeights', 'finalWeights']) {
    if (!strings(c[key]) || ((c[key] as string[]).length !== 0 && (c[key] as string[]).length !== 6)) fail('快照权重格式无效');
    if (!(c[key] as string[]).every(w => /^-?\d+(?:\/[1-9]\d*|\.\d+)?$/.test(w))) fail('快照权重不是有效数值');
  }
  for (const key of ['baseWeightsExact', 'finalWeightsExact']) if (c[key] !== undefined && (!strings(c[key]) || ![0, 6].includes((c[key] as string[]).length) || !(c[key] as string[]).every(w => /^-?\d+(?:\/[1-9]\d*)?$/.test(w)))) fail('快照精确权重格式无效');
}

function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!object(value) || !text(value.id) || !value.id || !text(value.albumId) || !date(value.createdAt) || !text(value.reviewer) || !['saved', 'published'].includes(value.kind as string)) fail('快照元数据无效');
  const s = value as Record<string, unknown>;
  validateAlbum(s.album);
  validateCalculation(s.calculation);
  if ((s.album as Album).id !== s.albumId) fail('快照与作品 ID 不一致');
  if (!object(s.provenance) || !text(s.provenance.modelVersion) || !object(s.provenance.sourceFiles) || typeof s.provenance.referenceVerified !== 'boolean') fail('快照缺少模型版本与来源哈希');
  const p = s.provenance as Record<string, unknown>;
  if (p.purpose !== undefined && !['private', 'review'].includes(p.purpose as string)) fail('快照用途格式错误');
  if (p.purpose === 'private' && (s.kind !== 'saved' || (s.calculation as Calculation).publishEligible || p.approval !== undefined)) fail('私人评分快照不得冒充正式审批');
  if (!Object.keys(p.sourceFiles as object).length || !Object.values(p.sourceFiles as Record<string, unknown>).every(v => text(v) && /^[a-f0-9]{64}$/.test(v))) fail('模型来源哈希格式无效');
  if (!object(p.dataHashes) || !['genres', 'chinaIndex'].every(k => text((p.dataHashes as Record<string, unknown>)[k]) && /^[a-f0-9]{64}$/.test((p.dataHashes as Record<string, string>)[k]))) fail('快照缺少有效的风格数据哈希');
  if (s.kind === 'published') {
    const a = s.album as Album;
    const c = s.calculation as Calculation;
    const approval = p.approval;
    if (a.status !== 'published' || !c.valid || !c.complete || !c.publishEligible || c.total === null || c.exactTotal === null || !object(approval) || !text(approval.approvedBy) || !approval.approvedBy.trim() || approval.approvedBy !== a.reviewer || s.reviewer !== a.reviewer || !date(approval.approvedAt) || approval.action !== 'explicit_manual_publication') fail('已发表快照缺少一致的人工审批记录或完整计算结果');
  } else if ((s.album as Album).status === 'published') fail('已发表记录必须保存在发表快照中');
}

export async function listAlbums(): Promise<Album[]> {
  const database = await db();
  try { return (await database.getAll('albums')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  finally { database.close(); }
}

export async function saveAlbum(album: Album): Promise<void> {
  validateAlbum(album);
  if (album.status === 'published') fail('请通过人工批准操作保存正式发表快照');
  if (album.status === 'publish_eligible' && !calculate(album).publishEligible) fail('尚未满足结构化发表条件，不能保存为此状态');
  const database = await db();
  try {
    const tx = database.transaction('albums', 'readwrite');
    const previous = await tx.store.get(album.id);
    if (previous?.status === 'published') { tx.abort(); await tx.done.catch(() => undefined); fail('已发表评价不可覆盖，请创建新版本'); }
    await tx.store.put(clone(album));
    await tx.done;
  } finally { database.close(); }
}

/** Removing a working draft intentionally retains its independent historical snapshots. */
export async function deleteAlbum(id: string): Promise<void> {
  const database = await db();
  try {
    const tx = database.transaction('albums', 'readwrite');
    const previous = await tx.store.get(id);
    if (previous?.status === 'published') { tx.abort(); await tx.done.catch(() => undefined); fail('已发表评价不可删除'); }
    await tx.store.delete(id); await tx.done;
  } finally { database.close(); }
}

export async function listSnapshots(albumId?: string): Promise<Snapshot[]> {
  const database = await db();
  try {
    const values = albumId ? await database.getAllFromIndex('snapshots', 'albumId', albumId) : await database.getAll('snapshots');
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally { database.close(); }
}

async function digest(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

export async function saveSnapshot(album: Album, calculation: Calculation, kind: Snapshot['kind'] = 'saved', purpose: 'review'|'private' = 'review'): Promise<Snapshot> {
  validateAlbum(album); validateCalculation(calculation);
  if (kind !== 'saved' && kind !== 'published') fail('快照类型无效');
  if (purpose !== 'review' && purpose !== 'private') fail('快照用途无效');
  if (purpose === 'private' && kind === 'published') fail('私人评分不执行正式发表审批');
  const current = purpose === 'private' ? calculatePrivate(album) : calculate(album);
  if (kind === 'published' && (!current.publishEligible || !album.reviewer.trim())) fail(`未通过发表门禁：${current.eligibilityIssues.join('；') || '请填写审核人'}`);
  if (album.status === 'published') fail('已发表评价不可再次保存，请创建新版本');
  const frozenAlbum = clone(album);
  if (kind === 'published') frozenAlbum.status = 'published';
  const snapshot: Snapshot = {
    id: createId(), albumId: album.id, createdAt: new Date().toISOString(), reviewer: album.reviewer,
    album: frozenAlbum, calculation: clone(current), kind,
    provenance: { ...clone(provenance), purpose, dataHashes: { genres: await digest(genres), chinaIndex: await digest(chinaIndex) }, selectedGenres: clone(genres.filter(g => g.id === album.genreId || album.tracks.some(t => t.genreId === g.id))), ...(kind === 'published' ? { approval: { approvedBy: album.reviewer, approvedAt: new Date().toISOString(), action: 'explicit_manual_publication' } } : {}) },
  };
  const database = await db();
  try {
    const tx = database.transaction(['albums', 'snapshots'], 'readwrite');
    const previous = await tx.objectStore('albums').get(album.id);
    if (previous?.status === 'published') { tx.abort(); await tx.done.catch(() => undefined); fail('已发表评价不可覆盖，请创建新版本'); }
    await tx.objectStore('snapshots').add(snapshot);
    if (kind === 'published') await tx.objectStore('albums').put(frozenAlbum);
    await tx.done;
  }
  finally { database.close(); }
  return clone(snapshot);
}

/** Private exports never create review evidence, reviewer identities or publication approval. */
export async function savePrivateSnapshot(album: Album): Promise<Snapshot> {
  return saveSnapshot(album, calculatePrivate(album), 'saved', 'private');
}

export interface Backup { format: 'nmc-library'; schemaVersion: 1; exportedAt: string; albums: Album[]; snapshots: Snapshot[] }

export async function exportBackup(): Promise<string> {
  const database = await db();
  try {
    const tx = database.transaction(['albums', 'snapshots'], 'readonly');
    const [albums, snapshots] = await Promise.all([tx.objectStore('albums').getAll(), tx.objectStore('snapshots').getAll()]);
    await tx.done;
    return JSON.stringify({ format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums, snapshots } satisfies Backup, null, 2);
  } finally { database.close(); }
}

// Key-order independent equality makes an unchanged JSON backup safe to re-import.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function importBackup(json: string): Promise<{ albums: number; snapshots: number; skipped: number }> {
  if (json.length > 100 * 1024 * 1024) fail('备份超过 100 MB，请分批恢复');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { fail('无法读取 JSON：备份文件格式错误'); }
  if (!object(parsed) || parsed.format !== 'nmc-library' || parsed.schemaVersion !== 1 || !date(parsed.exportedAt) || !Array.isArray(parsed.albums) || !Array.isArray(parsed.snapshots)) fail('不支持的备份格式或版本，请使用完整作品库备份');
  const data = parsed as unknown as Backup;
  data.albums.forEach(validateAlbum); data.snapshots.forEach(validateSnapshot);
  for (const album of data.albums) {
    if (album.status === 'publish_eligible' && !calculate(album).publishEligible) fail('导入记录尚未满足当前结构化发表条件');
    if (album.status === 'published' && !data.snapshots.some(s => s.kind === 'published' && s.albumId === album.id && canonical(s.album) === canonical(album))) fail('已发表作品缺少匹配的不可变发表快照，未导入任何数据');
  }
  for (const records of [data.albums, data.snapshots]) {
    if (new Set(records.map(r => r.id)).size !== records.length) fail('备份中存在重复 ID，未导入任何数据');
  }
  const database = await db();
  const result = { albums: 0, snapshots: 0, skipped: 0 };
  try {
    const tx = database.transaction(['albums', 'snapshots'], 'readwrite');
    try {
      // Validate every conflict before any write; the transaction also protects concurrent imports.
      const existingAlbums = await Promise.all(data.albums.map(a => tx.objectStore('albums').get(a.id)));
      const existingSnapshots = await Promise.all(data.snapshots.map(s => tx.objectStore('snapshots').get(s.id)));
      data.albums.forEach((a, i) => { if (existingAlbums[i] && canonical(a) !== canonical(existingAlbums[i])) fail(`作品“${a.title || a.id}”与本地记录冲突；未导入，请先备份并另存为新版本`); });
      data.snapshots.forEach((s, i) => { if (existingSnapshots[i] && canonical(s) !== canonical(existingSnapshots[i])) fail('历史快照冲突，不允许覆盖；未导入任何数据'); });
      for (let i = 0; i < data.albums.length; i++) {
        if (existingAlbums[i]) result.skipped++;
        else { await tx.objectStore('albums').add(clone(data.albums[i])); result.albums++; }
      }
      for (let i = 0; i < data.snapshots.length; i++) {
        if (existingSnapshots[i]) result.skipped++;
        else { await tx.objectStore('snapshots').add(clone(data.snapshots[i])); result.snapshots++; }
      }
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
    return result;
  } finally { database.close(); }
}
