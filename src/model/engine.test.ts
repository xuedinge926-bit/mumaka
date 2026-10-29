import { describe, expect, it } from 'vitest';
import { calculate, chinaIndex, genres, validateDatabase, sourcePresets } from './engine';
import { DIMENSIONS, newAlbum } from './types';
import type { Album, Track } from './types';
import fixtures from '../data/golden-fixtures.json';
import provenance from '../data/provenance.json';
import { readFileSync } from 'node:fs';

function rated(value = 4): Album {
  const album = newAlbum();
  album.genreId = 'genre:pop-general';
  album.title = '手工测试发行'; album.artist = '测试者';
  album.crossFamilyReason = '逐曲核对全碟跨家族的不同音乐结构，现有单一风格不足以反映音乐组织';
  for (const d of DIMENSIONS) album.ratings[d] = { ...album.ratings[d], value, evidence: '第二首的具体音乐细节', rationale: '独立维度评价理由', counterEvidence: '第三首存在反例' };
  return album;
}
function track(genreId: string, duration = 100): Track {
  return { id: crypto.randomUUID(), title: '测试曲目', duration, genreId, genreEvidence: '明确可听的全曲结构判据', lyricsSource: '新词', compositionSource: '新曲', sourceEvidence: '唱片内页署名' };
}

describe('冻结主库和中国市场索引', () => {
  it('全部558条权重和33个入口引用有效', () => {
    expect(validateDatabase()).toEqual([]);
    expect(genres).toHaveLength(558);
    expect(chinaIndex).toHaveLength(33);
    expect(new Set(chinaIndex.map(entry => entry.genreId)).size).toBe(32);
    expect(genres.filter(g => g.status === 'provisional_chinese_focus')).toHaveLength(24);
  });
  it('校园民谣只是当代民谣别名，不产生新权重', () => {
    const entry = chinaIndex.find(i => i.id === 'cn-index:campus-folk')!;
    expect(entry.genreId).toBe('genre:contemporary-folk');
    expect(genres.some(g => g.id === 'genre:campus-folk')).toBe(false);
    const a = rated(); a.genreId = entry.genreId; a.chinaEntryId = entry.id;
    expect(calculate(a).baseWeights).toEqual(genres.find(g => g.id === entry.genreId)!.weights.map(String));
  });
  it('地域待审候选不能作为全球风格', () => {
    const a = rated(); a.genreId = 'cn-review:northwest-folk';
    expect(calculate(a).valid).toBe(false);
  });
  it('语言地域不改变基础权重或星级', () => {
    const a = rated(); const before = calculate(a);
    a.language = '陕西方言'; a.region = '西北';
    const after = calculate(a);
    expect(after.finalWeights).toEqual(before.finalWeights);
    expect(after.total).toBe(before.total);
  });
  it('拒绝索引和主库ID不匹配', () => {
    const a = rated(); a.chinaEntryId = 'cn-index:campus-folk';
    expect(calculate(a).errors.join()).toContain('映射不一致');
  });
  it('只读原始主库不被UI修改', () => {
    expect(Object.isFrozen(genres)).toBe(true);
    expect(Object.isFrozen(genres[0].weights)).toBe(true);
  });
});

describe('评分公式和末步half-up', () => {
  it('所有558条有效主库权重在六维4星时精确为8.00', () => {
    for (const genre of genres) {
      const a = rated(); a.genreId = genre.id;
      if (genre.weights[0] < 5) { a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '整张发行无可评价歌词'; }
      expect(calculate(a).total, genre.id).toBe('8.00');
      expect(calculate(a).exactTotal, genre.id).toBe('8');
    }
  });
  it('全0.5星为1.00，全5星为10.00', () => {
    expect(calculate(rated(0.5)).total).toBe('1.00');
    expect(calculate(rated(5)).total).toBe('10.00');
  });
  it('使用实际权重，不平均六维星级', () => {
    const a = rated(); a.ratings.lyrics.value = 3;
    expect(calculate(a).total).toBe('7.58');
  });
  it('7.795精确half-up到7.80，不受JS浮点或银行舍入影响', () => {
    const a = rated(); a.blendMode = 'equal';
    a.tracks = [track('genre:pop-general'), track('genre:dance-pop')];
    a.ratings.lyrics.value = 3.5;
    const result = calculate(a);
    expect(result.baseWeights[0]).toBe('20.5');
    expect(result.exactTotal).toBe('1559/200');
    expect(result.total).toBe('7.80');
  });
  it.each([0, 0.1, 0.75, 5.5, -1, NaN, Infinity])('拒绝非法星级%s', value => {
    const a = rated(); a.ratings.composition.value = value;
    expect(calculate(a).valid).toBe(false);
    expect(calculate(a).total).toBeNull();
  });
  it('未评价即使基础权重为零也不自动转N/A', () => {
    const a = rated(); a.genreId = 'genre:guqin-music'; a.ratings.lyrics.value = null;
    expect(calculate(a).complete).toBe(false);
    expect(calculate(a).total).toBeNull();
  });
});

describe('修正预算与N/A顺序', () => {
  it('允许零和、在毛额16预算内的研究修正，固定维度仍15', () => {
    const a = rated(); a.cultureDelta = [-2, 2, 0, 0, 0, 0]; a.sourceDelta = [-6, 0, 6, 0, 0, 0];
    const result = calculate(a);
    expect(result.valid).toBe(true); expect(result.total).toBe('8.00');
    expect(result.finalWeights).toEqual(['13', '25', '20', '12', '15', '15']);
    expect(result.publishEligible).toBe(false);
    expect(result.warnings.join()).toContain('待实证工程先验');
  });
  it('相反修正不得抵消毛额L1预算', () => {
    const a = rated(); a.cultureDelta = [-2, 2, 0, 0, 0, 0]; a.sourceDelta = [8, -8, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('毛额L1合计');
  });
  it('拒绝非零和修正', () => {
    const a = rated(); a.sourceDelta[0] = 1;
    expect(calculate(a).errors.join()).toContain('零和');
  });
  it('拒绝超过单独来源L1预算', () => {
    const a = rated(); a.sourceDelta = [-8.5, 8.5, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('来源修正L1');
  });
  it('拒绝超过文化L1预算', () => {
    const a = rated(); a.cultureDelta = [-2.5, 2.5, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('文化修正L1');
  });
  it('拒绝固定维度转移', () => {
    const a = rated(); a.sourceDelta = [1, 0, 0, 0, -1, 0];
    expect(calculate(a).errors.join()).toContain('固定15%');
  });
  it('不发明最低权重，但拒绝负权重', () => {
    const a = rated(); a.genreId = 'genre:guqin-music'; a.sourceDelta = [-1, 1, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('不得为负');
  });
  it('按Python正式规范拒绝小数百分点修正', () => {
    const a = rated(); a.sourceDelta = [-0.3, 0.1, 0.2, 0, 0, 0];
    expect(calculate(a).valid).toBe(false);
    expect(calculate(a).errors.join()).toContain('整数百分点');
  });
  it('作词N/A归一化动态70，其余固定15', () => {
    const a = rated(); a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '全碟无歌词发行';
    const result = calculate(a);
    expect(result.valid).toBe(true); expect(result.complete).toBe(true);
    expect(result.finalWeights).toEqual(['0', '32.857143', '20', '17.142857', '15', '15']);
    expect(result.exactTotal).toBe('8'); expect(result.total).toBe('8.00');
  });
  it('文化先应用、N/A归一化其次、来源最后', () => {
    const a = rated(); a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '全碟器乐';
    a.cultureDelta = [0, 1, -1, 0, 0, 0]; a.sourceDelta = [0, -2, 2, 0, 0, 0];
    a.ratings.composition.value = 3.5;
    const result = calculate(a);
    expect(result.valid).toBe(true);
    expect(result.finalWeights[1]).toBe('32.285714');
    expect(result.exactTotal).toBe('2687/350');
    expect(result.total).toBe('7.68');
  });
  it('N/A必须有证据', () => {
    const a = rated(); a.ratings.lyrics.value = 'na';
    expect(calculate(a).eligibilityIssues.join()).toContain('适用证据');
  });
  it('声音等其他维度不允许N/A', () => {
    const a = rated(); a.ratings.sound.value = 'na'; a.ratings.sound.naReason = '测试';
    expect(calculate(a).errors.join()).toContain('声音不允许N/A');
  });
  it('表演N/A必须经特殊情形人工批准', () => {
    const a = rated(); a.ratings.performance.value = 'na'; a.ratings.performance.naReason = '特殊记录';
    expect(calculate(a).eligibilityIssues.join()).toContain('人工批准');
    a.ratings.performance.naApproved = true;
    expect(calculate(a).valid).toBe(true);
    expect(calculate(a).total).toBe('8.00');
  });
  it('来源不得向N/A维度转移', () => {
    const a = rated(); a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '器乐'; a.sourceDelta = [1, -1, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('来源修正不得涉及');
  });
});

describe('跨风格权重和发表门禁', () => {
  it('按时长聚合真实风格权重，不平均歌曲星级', () => {
    const a = rated(); a.blendMode = 'duration';
    a.tracks = [track('genre:pop-general', 100), track('genre:dance-pop', 300)];
    const result = calculate(a);
    expect(result.valid).toBe(true); expect(result.baseWeights[0]).toBe('20.25'); expect(result.total).toBe('8.00');
  });
  it('聚合要求每首都存在合法风格', () => {
    const a = rated(); a.blendMode = 'equal'; a.tracks = [track('cn-review:northwest-folk')];
    expect(calculate(a).valid).toBe(false);
  });
  it('时长聚合拒绝零时长，等曲目模式不要求时长', () => {
    const a = rated(); a.blendMode = 'duration'; a.tracks = [track('genre:pop-general', 0)];
    expect(calculate(a).valid).toBe(false);
    a.blendMode = 'equal'; expect(calculate(a).valid).toBe(true);
  });
  it('高星缺少全碟和不低半星依据会显示门禁原因', () => {
    const a = rated(4.5);
    expect(calculate(a).eligibilityIssues.join()).toContain('为何不低半星');
    a.ratings.lyrics.highJustification = '全碟支撑'; a.ratings.lyrics.notLower = '比4星更强的证据';
    expect(calculate(a).eligibilityIssues.filter(x => x.startsWith('作词4.5'))).toEqual([]);
  });
  it('全部人工材料齐备且参考验收通过才能满足结构化发表条件', () => {
    const a = rated();
    a.fullListenConfirmed = true; a.cultureNote = '结合文化理解'; a.genreEvidence = '全碟稳定特征'; a.genreExclusions = '已排除';
    a.sourceReviewed = true; a.noDoubleCount = true; a.reviewer = '审核人'; a.tracks = [track(a.genreId)]; a.releaseIdentityVerified = true;
    const result = calculate(a);
    expect(result.publishEligible).toBe(provenance.referenceVerified);
    expect(result.eligibilityIssues).toHaveLength(provenance.referenceVerified ? 0 : 1);
  });
  it('非零文化修正无获批档案不得发表', () => {
    const a = rated(); a.cultureDelta = [-1, 1, 0, 0, 0, 0];
    expect(calculate(a).eligibilityIssues.join()).toContain('获批文化数值修正档案为0');
  });
  it('旧记录状态不能冒充新的计算资格', () => {
    const a = rated(); a.status = 'published';
    expect(calculate(a).publishEligible).toBe(false);
  });
});

describe('Python参考程序与黄金样例一致性', () => {
  it.each(fixtures)('原始黄金用例 $fixture_id 的显示总分、精确分数与最终权重逐项匹配', fixture => {
    const a = rated(); a.genreId = fixture.global_genre_id;
    a.sourcePreset = fixture.source_preset;
    a.sourceDelta = (fixture.source_override ?? [0, 0, 0, 0, 0, 0]) as Album['sourceDelta'];
    a.cultureDelta = fixture.cultural_delta as Album['cultureDelta'];
    for (const d of DIMENSIONS) {
      a.ratings[d].value = (fixture.na_dims as string[]).includes(d) ? 'na' : fixture.stars[d];
      a.ratings[d].naReason = '原始计算样例，不构成真实专辑听评';
      a.ratings[d].naApproved = true;
    }
    const result = calculate(a);
    expect(result.errors).toEqual([]);
    expect(result.total).toBe(fixture.expected.score_display);
    expect(result.exactTotal).toBe(fixture.expected.score_denominator === 1 ? String(fixture.expected.score_numerator) : `${fixture.expected.score_numerator}/${fixture.expected.score_denominator}`);
    expect(result.baseWeightsExact).toEqual(fixture.base_weights);
    expect(result.finalWeightsExact).toEqual(fixture.final_weights);
  });
  it('完整558×5来源档位×4种N/A组合与当前Python实际执行结果一致', () => {
    const output = readFileSync('node_modules/.cache/nmc-reference-matrix.json', 'utf8');
    const cases = JSON.parse(output) as { gid: string; preset: string; na: string[]; ok: boolean; weights?: string[]; score?: string; exact?: string }[];
    expect(cases).toHaveLength(558 * 5 * 4);
    let legal = 0;
    for (const fixture of cases) {
      const a = rated(); a.genreId = fixture.gid; a.sourcePreset = fixture.preset;
      [4.5, 4, 4, 3.5, 4, 4.5].forEach((v, i) => { const d = DIMENSIONS[i]; a.ratings[d].value = fixture.na.includes(d) ? 'na' : v; a.ratings[d].naReason = '自动计算边界用例'; a.ratings[d].naApproved = true; });
      const result = calculate(a);
      const label = `${fixture.gid}/${fixture.preset}/${fixture.na.join(',')}`;
      expect(result.valid, label).toBe(fixture.ok);
      if (fixture.ok) {
        legal++;
        expect(result.total, label).toBe(fixture.score);
        expect(result.exactTotal, label).toBe(fixture.exact);
        expect(result.finalWeightsExact, label).toEqual(fixture.weights);
      } else expect(result.total, label).toBeNull();
    }
    expect(legal).toBeGreaterThan(2000);
  }, 30000);
  it('五档完全保持V0.16原始向量，自定义修正不可与预设并用', () => {
    expect(Object.keys(sourcePresets)).toHaveLength(5);
    expect(sourcePresets.existing_dominant_exceptional).toEqual([-4, -4, 5, 3, 0, 0]);
    const a = rated(); a.sourcePreset = 'mixed_light'; a.sourceDelta = [0, -2, 1, 1, 0, 0];
    expect(calculate(a).errors.join()).toContain('互斥');
  });
  it('最终权重5%下限对所有适用维度生效', () => {
    const a = rated(); a.genreId = 'genre:guqin-music';
    expect(calculate(a).errors.join()).toContain('低于5%');
    a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '完整器乐发行';
    expect(calculate(a).valid).toBe(true);
  });
  it('文化也不允许转移N/A维度权重', () => {
    const a = rated(); a.ratings.lyrics.value = 'na'; a.ratings.lyrics.naReason = '完整器乐发行'; a.cultureDelta = [1, -1, 0, 0, 0, 0];
    expect(calculate(a).errors.join()).toContain('文化修正不得涉及');
  });
  it('不凭中间文化向量否决满足最终下限的组合，与Python一致', () => {
    const a = rated(); a.genreId = 'genre:guqin-music'; a.cultureDelta = [-1, 1, 0, 0, 0, 0]; a.sourceDelta = [6, -6, 0, 0, 0, 0];
    expect(calculate(a).valid).toBe(true);
    expect(calculate(a).finalWeights[0]).toBe('5');
  });
  it('校园历史别名和条件风格需满足独立证据长度与音频确认', () => {
    const a = rated(); a.genreId = 'genre:contemporary-folk'; a.chinaEntryId = 'cn-index:campus-folk';
    expect(calculate(a).valid).toBe(false);
    a.fullListenConfirmed = true; a.genreEvidence = '原声吉他主导，旋律段落与歌唱方式具有稳定歌曲形态'; a.historicTraditionEvidence = '能够联系台湾校园民歌历史创作传统的确切证据';
    expect(calculate(a).valid).toBe(true);
    a.genreId = 'genre:chinese-style-pop'; a.chinaEntryId = 'cn-index:chinese-style-pop'; a.genreEvidence = '古风歌词';
    expect(calculate(a).valid).toBe(false);
    a.genreEvidence = '传统声腔音型与流行编配构成结构性融合且贯穿整张';
    expect(calculate(a).valid).toBe(true);
  });
  it('全球搜索不绕过条件风格的发表证据要求，研究算术仍可用', () => {
    const a = rated(); a.genreId = 'genre:alternative-pop'; a.fullListenConfirmed = true; a.genreEvidence = '新奇';
    const result = calculate(a);
    expect(result.valid).toBe(true);
    expect(result.total).toBe('8.00');
    expect(result.eligibilityIssues.join()).toContain('即使从全球检索选择');
    a.genreEvidence = '非常规节奏与音色组织贯穿整张唱片，并有逐曲结构依据支持';
    expect(calculate(a).eligibilityIssues.join()).not.toContain('即使从全球检索选择');
  });
});
