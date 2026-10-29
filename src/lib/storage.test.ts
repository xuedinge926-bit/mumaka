import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DIMENSIONS, newAlbum, type Calculation } from '../model/types';
import { calculate } from '../model/engine';
import { deleteAlbum, exportBackup, importBackup, listAlbums, listSnapshots, saveAlbum, saveSnapshot } from './storage';
import { csvCell, evaluationCSV } from './exports';
import provenance from '../data/provenance.json';

const calculation: Calculation = { valid: true, complete: true, total: '8.00', exactTotal: '8', baseWeights: ['21', '23', '14', '12', '15', '15'], finalWeights: ['21', '23', '14', '12', '15', '15'], errors: [], warnings: [], eligibilityIssues: ['参考程序未核验'], publishEligible: false };
async function clearDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('nmc-workbench-v1');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}
beforeEach(clearDatabase);

function reviewedAlbum() {
  const album = newAlbum();
  album.title = '纯技术验收样本'; album.artist = '人工测试'; album.genreId = 'genre:pop-general';
  album.fullListenConfirmed = true; album.releaseIdentityVerified = true; album.sourceReviewed = true; album.noDoubleCount = true;
  album.cultureNote = '定性理解的记录，不增加权重'; album.genreEvidence = '整碟可听的稳定流行歌曲结构'; album.genreExclusions = '未出现持续的摇滚合奏结构'; album.reviewer = '测试审核员';
  album.tracks = [{ id: crypto.randomUUID(), title: '测试曲目', duration: 180, genreId: album.genreId, lyricsSource: '新作', compositionSource: '新作', sourceEvidence: '人工技术用例，不代表真实发行' }];
  for (const dimension of DIMENSIONS) Object.assign(album.ratings[dimension], { value: 4, evidence: '具体曲目中的维度依据', counterEvidence: '记录限制与反例', rationale: '此维度独立判断' });
  return album;
}

describe('IndexedDB library and immutable versions', () => {
  it('persists the full editor shape including track provenance and independent evidence', async () => {
    const album = newAlbum();
    album.title = '备份测试'; album.artist = '人工录入';
    album.tracks = [{ id: crypto.randomUUID(), title: '曲目一', duration: 180, genreId: 'genre:pop-general', lyricsSource: '原创', compositionSource: '传统改编', sourceEvidence: '发行内页 p.3' }];
    album.ratings.lyrics.value = 4; album.ratings.lyrics.evidence = '第 1 首的叙述人称';
    await saveAlbum(album);
    expect(await listAlbums()).toEqual([album]);
  });

  it('does not mutate a saved historical snapshot when the draft or loaded object changes', async () => {
    const album = newAlbum(); album.title = '第一版';
    await saveAlbum(album);
    const snapshot = await saveSnapshot(album, calculation);
    album.title = '第二版'; calculation.warnings.push('仅供本用例');
    await saveAlbum(album);
    snapshot.album.title = '外部对象改动';
    const history = await listSnapshots(album.id);
    expect(history[0].album.title).toBe('第一版');
    expect(history[0].calculation.warnings).not.toContain('仅供本用例');
    expect(history[0].provenance).toMatchObject({ modelVersion: 'V0.19-RC1', referenceVerified: provenance.referenceVerified, dataHashes: { genres: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    calculation.warnings.pop();
  });

  it('restores an exported backup without dropping fields or snapshots, and reimport is idempotent', async () => {
    const album = newAlbum(); album.summary = '完整保留\n换行与中文';
    await saveAlbum(album); const snapshot = await saveSnapshot(album, calculation);
    const backup = await exportBackup();
    await deleteAlbum(album.id);
    expect(await listAlbums()).toHaveLength(0);
    expect(await listSnapshots()).toHaveLength(1);
    expect(await importBackup(backup)).toEqual({ albums: 1, snapshots: 0, skipped: 1 });
    expect((await listAlbums())[0]).toEqual(album);
    expect((await listSnapshots())[0]).toEqual(snapshot);
    expect(await importBackup(backup)).toEqual({ albums: 0, snapshots: 0, skipped: 2 });
  });

  it('rejects malformed data before any write', async () => {
    const good = newAlbum(); const bad = newAlbum();
    const backup = { format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [good, { ...bad, ratings: { lyrics: { value: 7 } } }], snapshots: [] };
    await expect(importBackup(JSON.stringify(backup))).rejects.toThrow('评价字段不完整');
    expect(await listAlbums()).toHaveLength(0);
  });

  it('rejects an album conflict atomically rather than silently overwriting or partially importing', async () => {
    const old = newAlbum(); old.title = '本地较新的草稿'; await saveAlbum(old);
    const fresh = newAlbum();
    const backup = { format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [fresh, { ...old, title: '备份中的不同版本' }], snapshots: [] };
    await expect(importBackup(JSON.stringify(backup))).rejects.toThrow('冲突');
    expect(await listAlbums()).toEqual([old]);
  });

  it('rejects historical snapshot overwrite on import', async () => {
    const album = newAlbum(); await saveAlbum(album); await saveSnapshot(album, calculation);
    const data = JSON.parse(await exportBackup());
    const originalTotal = data.snapshots[0].calculation.total;
    data.snapshots[0].calculation.total = '9.00';
    await expect(importBackup(JSON.stringify(data))).rejects.toThrow('历史快照冲突');
    expect((await listSnapshots())[0].calculation.total).toBe(originalTotal);
  });

  it('can preserve imported historical published records but cannot edit or delete them', async () => {
    const album = reviewedAlbum();
    const snapshot = await saveSnapshot(album, calculate(album), 'published');
    const backup = await exportBackup();
    await clearDatabase();
    await importBackup(backup);
    await expect(saveAlbum({ ...album, status: 'draft', title: '覆盖' })).rejects.toThrow('不可覆盖');
    await expect(deleteAlbum(album.id)).rejects.toThrow('不可删除');
    expect((await listAlbums())[0].status).toBe('published');
    expect((await listSnapshots())[0]).toEqual(snapshot);
  });

  it('recomputes publication eligibility instead of trusting a caller-supplied true flag', async () => {
    const album = newAlbum();
    await expect(saveSnapshot(album, { ...calculation, publishEligible: true }, 'published')).rejects.toThrow('未通过发表门禁');
    album.status = 'publish_eligible';
    await expect(saveAlbum(album)).rejects.toThrow('尚未满足结构化发表条件');
  });

  it('publishes a fully reviewed record atomically, freezes the recomputed result, and preserves it across revisions and backup restore', async () => {
    const album = reviewedAlbum();
    const current = calculate(album);
    expect(current.publishEligible, current.eligibilityIssues.join('；')).toBe(true);
    const published = await saveSnapshot(album, { ...current, total: '9.99' }, 'published');
    expect(published.album.status).toBe('published');
    expect(published.calculation.total).toBe('8.00');
    expect(published.provenance).toMatchObject({ approval: { approvedBy: '测试审核员', action: 'explicit_manual_publication' } });
    expect((await listAlbums())[0]).toEqual(published.album);
    await expect(saveAlbum({ ...album, title: '不允许覆盖' })).rejects.toThrow('不可覆盖');
    const next = { ...structuredClone(album), id: crypto.randomUUID(), revision: 2, parentSnapshotId: published.id, status: 'draft' as const };
    next.ratings.lyrics.value = 3;
    await saveAlbum(next); await saveSnapshot(next, calculate(next));
    expect((await listSnapshots(album.id))[0].calculation.total).toBe('8.00');
    expect((await listSnapshots(next.id))[0].calculation.total).toBe('7.58');
    const backup = await exportBackup();
    expect(await importBackup(backup)).toEqual({ albums: 0, snapshots: 0, skipped: 4 });
  });

  it('rejects spoofed publication statuses, missing approval and forged current eligible states before any write', async () => {
    const album = reviewedAlbum();
    const snapshot = await saveSnapshot(album, calculate(album), 'published');
    const data = JSON.parse(await exportBackup());
    await clearDatabase();
    const onlyAlbum = { ...data, snapshots: [] };
    await expect(importBackup(JSON.stringify(onlyAlbum))).rejects.toThrow('缺少匹配');
    delete data.snapshots[0].provenance.approval;
    await expect(importBackup(JSON.stringify(data))).rejects.toThrow('审批记录');
    const draft = newAlbum(); draft.status = 'publish_eligible';
    await expect(importBackup(JSON.stringify({ ...data, albums: [draft], snapshots: [] }))).rejects.toThrow('尚未满足');
    expect(await listAlbums()).toHaveLength(0);
    expect(await listSnapshots()).toHaveLength(0);
    expect(snapshot.kind).toBe('published');
  });

  it('rejects broken, unsupported, duplicate-ID or unsafe-image backups', async () => {
    await expect(importBackup('{')).rejects.toThrow('JSON');
    await expect(importBackup('{}')).rejects.toThrow('不支持');
    const album = newAlbum();
    const backup = { format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [album, album], snapshots: [] };
    await expect(importBackup(JSON.stringify(backup))).rejects.toThrow('重复 ID');
    album.cover = 'https://example.com/external-cover.jpg';
    await expect(saveAlbum(album)).rejects.toThrow('封面只支持本地');
  });
});

describe('CSV output', () => {
  it('preserves commas, quotes, newlines and protects formula cells', () => {
    expect(csvCell('第1首, "标题"\n证据')).toBe('"第1首, ""标题""\n证据"');
    for (const value of ['=1+1', '+sum(A1:A2)', '-12', '@foo', '  =evil', '\t=evil']) expect(csvCell(value)).toContain("'");
    const album = newAlbum(); album.title = '=HYPERLINK("bad")';
    const csv = evaluationCSV(album, calculation);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('未评价'); expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('参考程序已核验');
    expect(evaluationCSV(album, calculation, { modelVersion: 'V0.18-历史快照', referenceVerified: false })).toContain('V0.18-历史快照');
  });
});
