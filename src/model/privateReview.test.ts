import { describe, expect, it } from 'vitest';
import { calculate, sourcePresets } from './engine';
import { calculatePrivate, PRIVATE_SOURCE_PRESET_OPTIONS, resolvePrivateSource } from './privateReview';
import { DIMENSIONS, newAlbum } from './types';
import type { Album, Track } from './types';
import fixtures from '../data/golden-fixtures.json';

function album(value = 4): Album {
  const a = newAlbum();
  a.genreId = 'genre:pop-general'; a.title = '私人评分测试'; a.artist = '测试音乐人';
  a.ux = { market:'china', sourceKind:'new' };
  for (const dimension of DIMENSIONS) a.ratings[dimension].value = value;
  return a;
}
function track(genreId: string, duration = 180): Track {
  return { id:genreId, title:'测试曲目', duration, genreId, lyricsSource:'', compositionSource:'', sourceEvidence:'' };
}

describe('私人评分：无需发表材料即可真实计算，始终不冒充审核', () => {
  it('普通原创六维评分无需理由、台账、文化说明或听评确认', () => {
    const a = album(); const before = JSON.stringify(a);
    const result = calculatePrivate(a);
    expect(result.total).toBe('8.00'); expect(result.valid).toBe(true);
    expect(result.publishEligible).toBe(false);
    expect(result.eligibilityIssues.join()).toContain('私人评分记录');
    expect(a.ratings.lyrics.evidence).toBe(''); expect(a.cultureNote).toBe('');
    expect(JSON.stringify(a)).toBe(before);
  });
  it('高星不因缺少长篇理由而阻止私人评分与导出', () => {
    const a = album(5);
    expect(calculatePrivate(a).total).toBe('10.00');
    expect(calculatePrivate(a).publishEligible).toBe(false);
    expect(calculate(a).publishEligible).toBe(false);
  });
  it.each(['cn-index:campus-folk','cn-index:chinese-style-pop','cn-index:alternative-pop'])('入口%s私评不强制文字或音频断言，公开严格门禁仍保留', entryId => {
    const a = album(); a.chinaEntryId = entryId;
    a.genreId = entryId === 'cn-index:campus-folk' ? 'genre:contemporary-folk' : entryId.replace('cn-index:', 'genre:');
    const strict = calculate(a); const personal = calculatePrivate(a);
    expect(strict.valid).toBe(false); expect(strict.total).toBeNull();
    expect(personal.valid).toBe(true); expect(personal.total).toBe('8.00');
    expect(personal.eligibilityIssues.length).toBeGreaterThan(0);
    expect(personal.publishEligible).toBe(false);
    expect(a.historicTraditionEvidence).toBeUndefined();
    expect(a.fullListenConfirmed).toBe(false);
  });
  it('按逐曲等份合成权重而不要求20字和8字证据', () => {
    const a = album(); a.blendMode = 'equal';
    a.tracks = [track('genre:pop-general'), track('genre:folk-rock')];
    a.ratings.lyrics.value = 3.5;
    const strict = calculate(a); const personal = calculatePrivate(a);
    expect(strict.valid).toBe(false); expect(personal.valid).toBe(true);
    expect(personal.baseWeightsExact?.[0]).toBe('45/2');
    expect(personal.exactTotal).toBe('311/40');
    expect(personal.total).toBe('7.78');
    expect(a.crossFamilyReason).toBeUndefined(); expect(a.tracks[0].genreEvidence).toBeUndefined();
  });
  it('按时长合成仍要求真实有效时长', () => {
    const a = album(); a.blendMode = 'duration';
    a.tracks = [track('genre:pop-general', 180), track('genre:folk-rock', 240)];
    expect(calculatePrivate(a).baseWeightsExact?.[0]).toBe('159/7');
    expect(calculatePrivate(a).total).toBe('8.00');
    a.tracks[0].duration = 0;
    expect(calculatePrivate(a).valid).toBe(false); expect(calculatePrivate(a).total).toBeNull();
  });
  it('逐曲未选风格或伪造候选ID仍然不能合成', () => {
    const a = album(); a.blendMode = 'equal';
    a.tracks = [track('cn-review:northwest-folk')];
    expect(calculatePrivate(a).valid).toBe(false); expect(calculatePrivate(a).total).toBeNull();
  });
  it('未评分与N/A仍严格不同，空白N/A理由也不会被程序伪造', () => {
    const a = album(); a.ratings.lyrics.value = null;
    expect(calculatePrivate(a).complete).toBe(false); expect(calculatePrivate(a).total).toBeNull();
    a.ratings.lyrics.value = 'na';
    expect(calculatePrivate(a).complete).toBe(true); expect(calculatePrivate(a).total).toBe('8.00');
    expect(calculatePrivate(a).finalWeightsExact?.[0]).toBe('0');
    expect(a.ratings.lyrics.naReason).toBe('');
    expect(calculatePrivate(a).eligibilityIssues.join()).toContain('N/A必须记录');
  });
  it('罕见表演N/A不代填审批，原始数学归一化与公开审批各自保留', () => {
    const a = album(); a.ratings.performance.value = 'na';
    expect(calculatePrivate(a).total).toBe('8.00');
    expect(calculatePrivate(a).eligibilityIssues.join()).toContain('人工批准');
    expect(a.ratings.performance.naApproved).toBe(false);
  });
  it('非法维度N/A、非法星级、固定权重修改和修正预算继续拒绝', () => {
    const invalid = [album(), album(), album(), album()];
    invalid[0].ratings.sound.value = 'na';
    invalid[1].ratings.lyrics.value = 4.25;
    invalid[2].cultureDelta = [1,0,0,0,-1,0];
    invalid[3].cultureDelta = [-3,3,0,0,0,0];
    for (const a of invalid) { expect(calculatePrivate(a).valid).toBe(false); expect(calculatePrivate(a).total).toBeNull(); }
  });
});

describe('来源选择没有分类阈值、推测或静默补齐', () => {
  it('预设选项与冻结政策的五个向量键完全一致', () => {
    expect(PRIVATE_SOURCE_PRESET_OPTIONS.map(option => option.value)).toEqual(Object.keys(sourcePresets));
    expect(PRIVATE_SOURCE_PRESET_OPTIONS.every(option => option.label && option.description)).toBe(true);
  });
  it('只有用户明确选择新创作，才直接确认none', () => {
    const a = album();
    expect(resolvePrivateSource(a)).toEqual({ confirmed:true, preset:'none' });
    expect(a.ux?.sourceDoubleCount).toBeUndefined();
  });
  it.each(['cover','mixed','rerecord'] as const)('%s不被自动映射到来源档位', sourceKind => {
    const a = album(); a.ux!.sourceKind = sourceKind;
    a.tracks = [track('genre:pop-general')]; a.tracks[0].provenanceKind = 'existing';
    expect(resolvePrivateSource(a).confirmed).toBe(false);
    expect(calculatePrivate(a).total).toBeNull();
    a.ux!.sourcePresetConfirmed = 'mixed_light';
    expect(resolvePrivateSource(a).confirmed).toBe(false);
    a.ux!.sourceDoubleCount = 'clear';
    expect(resolvePrivateSource(a)).toEqual({ confirmed:true, preset:'mixed_light' });
    expect(calculatePrivate(a).finalWeightsExact).toEqual(['20','22','15','13','15','15']);
  });
  it('unknown即便存在旧档位和打完六维，也保持未确认草稿', () => {
    const a = album(); a.ux!.sourceKind = 'unknown'; a.ux!.sourcePresetConfirmed = 'mixed_light'; a.ux!.sourceDoubleCount = 'clear';
    a.sourcePreset = 'mixed_material';
    const result = calculatePrivate(a);
    expect(resolvePrivateSource(a).confirmed).toBe(false);
    expect(result.total).toBeNull(); expect(result.exactTotal).toBeNull();
    expect(result.finalWeights).toEqual([]); expect(result.valid).toBe(false);
    expect(a.sourcePreset).toBe('mixed_material');
  });
  it('若风格已考虑演绎，不猜测减弱程度，只有明确none才确认', () => {
    const a = album(); a.ux = { market:'china', sourceKind:'cover', sourcePresetConfirmed:'mixed_light', sourceDoubleCount:'included' };
    expect(resolvePrivateSource(a).confirmed).toBe(false);
    a.ux.sourcePresetConfirmed = 'none';
    expect(resolvePrivateSource(a)).toEqual({ confirmed:true, preset:'none' });
    expect(calculatePrivate(a).finalWeightsExact).toEqual(['21','23','14','12','15','15']);
  });
  it('已有来源修正preset与数字不会在用户明确改选前被迁移或删除', () => {
    const a = album(); delete a.ux;
    a.sourcePreset = 'mixed_light';
    const original = JSON.stringify(a);
    expect(calculatePrivate(a).finalWeightsExact).toEqual(calculate(a).finalWeightsExact);
    expect(JSON.stringify(a)).toBe(original);
    a.sourcePreset = 'none'; a.sourceDelta = [0,-2,1,1,0,0];
    expect(calculatePrivate(a).finalWeightsExact).toEqual(calculate(a).finalWeightsExact);
    expect(a.sourceDelta).toEqual([0,-2,1,1,0,0]);
  });
  it('旧记录只修改市场推荐、主题或比例时不丢失原始修正', () => {
    const a = album(); delete a.ux; a.sourcePreset = 'none'; a.sourceDelta = [0,-2,1,1,0,0];
    a.ratings.composition.value = 3.5;
    const original = calculatePrivate(a);
    a.ux = { market:'global', cardTheme:'ink', cardRatio:'1:1' };
    expect(resolvePrivateSource(a).confirmed).toBe(true);
    expect(calculatePrivate(a).total).toBe(original.total);
    expect(calculatePrivate(a).finalWeightsExact).toEqual(original.finalWeightsExact);
    expect(a.sourceDelta).toEqual([0,-2,1,1,0,0]);
  });
  it('未知来源类别、预设或防重复状态不会猜填', () => {
    const a = album(); a.ux!.sourceKind = 'mixed'; a.ux!.sourceDoubleCount = 'clear';
    for (const preset of ['invented', '__proto__', 'toString']) {
      a.ux!.sourcePresetConfirmed = preset;
      expect(resolvePrivateSource(a).confirmed).toBe(false); expect(calculatePrivate(a).total).toBeNull();
    }
    a.ux!.sourcePresetConfirmed = 'mixed_light'; a.ux!.sourceKind = 'invented' as NonNullable<Album['ux']>['sourceKind'];
    expect(resolvePrivateSource(a).confirmed).toBe(false);
    a.ux!.sourceKind = 'mixed'; a.ux!.sourceDoubleCount = 'invented' as NonNullable<Album['ux']>['sourceDoubleCount'];
    expect(resolvePrivateSource(a).confirmed).toBe(false);
  });
  it('私人来源元数据不能利用旧的完整审稿材料冒充公开审核', () => {
    const a = album();
    a.fullListenConfirmed = true; a.releaseIdentityVerified = true; a.genreEvidence = '人工音乐判据'; a.genreExclusions = '人工排除说明'; a.cultureNote = '文化适配'; a.sourceReviewed = true; a.noDoubleCount = true; a.reviewer = '人工审核人';
    a.tracks = [{...track(a.genreId), lyricsSource:'新词', compositionSource:'新曲', sourceEvidence:'人工唱片署名'}];
    for (const d of DIMENSIONS) { a.ratings[d].evidence = '逐维证据'; a.ratings[d].rationale = '逐维判断'; a.ratings[d].counterEvidence = '逐维反证'; }
    const legacy = { ...a }; delete legacy.ux;
    expect(calculate(legacy).publishEligible).toBe(true);
    expect(calculate(a).publishEligible).toBe(false);
    expect(calculate(a).eligibilityIssues.join()).toContain('私人工作流记录');
    expect(calculatePrivate(a).publishEligible).toBe(false);
  });
  it('用户明确选择新来源只影响本次计算的副本，不覆盖旧矢量', () => {
    const a = album(); a.sourcePreset = 'mixed_material'; a.sourceDelta = [0,-2,1,1,0,0];
    expect(calculatePrivate(a).valid).toBe(true);
    expect(calculatePrivate(a).finalWeightsExact).toEqual(['21','23','14','12','15','15']);
    expect(a.sourcePreset).toBe('mixed_material'); expect(a.sourceDelta).toEqual([0,-2,1,1,0,0]);
  });
  it('已有非零文化修正仍保留，公开发表继续被拒绝', () => {
    const a = album(); a.cultureDelta = [1,-1,0,0,0,0];
    expect(calculatePrivate(a).finalWeightsExact).toEqual(['22','22','14','12','15','15']);
    expect(calculatePrivate(a).publishEligible).toBe(false);
    expect(calculate(a).eligibilityIssues.join()).toContain('获批文化数值修正档案为0');
    expect(a.cultureDelta).toEqual([1,-1,0,0,0,0]);
  });
  it('来源预设不适用于N/A时不会自动换档位绕过数学约束', () => {
    const a = album(); a.ux = { market:'china', sourceKind:'cover', sourcePresetConfirmed:'mixed_light', sourceDoubleCount:'clear' };
    a.ratings.lyrics.value = 'na';
    expect(calculatePrivate(a).errors.join()).toContain('来源修正不得涉及');
    expect(calculatePrivate(a).total).toBeNull();
  });
  it('中国/其他地区、卡片比例、主题、封面和短评不改变分数', () => {
    const a = album(); const before = calculatePrivate(a);
    a.ux!.market = 'global'; a.ux!.cardRatio = '3:4'; a.ux!.cardTheme = 'ink'; a.summary = '自选短评'; a.cover = 'data:image/png;base64,AA==';
    expect(calculatePrivate(a).total).toBe(before.total);
    expect(calculatePrivate(a).exactTotal).toBe(before.exactTotal);
    expect(calculatePrivate(a).finalWeightsExact).toEqual(before.finalWeightsExact);
  });
});

describe('私人计算仍逐项保持原始黄金样例数学结果', () => {
  it.each(fixtures)('$fixture_id', fixture => {
    const a = album(); delete a.ux; a.genreId = fixture.global_genre_id;
    a.sourcePreset = fixture.source_preset;
    a.sourceDelta = (fixture.source_override ?? [0,0,0,0,0,0]) as Album['sourceDelta'];
    a.cultureDelta = fixture.cultural_delta as Album['cultureDelta'];
    for (const d of DIMENSIONS) a.ratings[d].value = (fixture.na_dims as string[]).includes(d) ? 'na' : fixture.stars[d];
    const result = calculatePrivate(a);
    expect(result.total).toBe(fixture.expected.score_display);
    expect(result.finalWeightsExact).toEqual(fixture.final_weights);
    expect(result.publishEligible).toBe(false);
  });
});
