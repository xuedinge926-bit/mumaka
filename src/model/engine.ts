import genreRows from '../data/genres.json';
import chinaRows from '../data/china-index.json';
import provenance from '../data/provenance.json';
import sourcePolicy from '../data/source-policy.json';
import { DIMENSIONS, LABELS } from './types';
import type { Album, Calculation, ChinaEntry, Genre } from './types';

/** All arithmetic is rational until the final half-up rounding step. */
class Fraction {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw new Error('分母不能为零');
    const sign = d < 0n ? -1n : 1n;
    const divisor = gcd(n, d);
    this.n = n * sign / divisor;
    this.d = d * sign / divisor;
  }
  static from(value: number): Fraction {
    if (!Number.isFinite(value)) throw new Error('数值必须有限');
    const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
    const decimals = (mantissa.split('.')[1] ?? '').length;
    const shift = Number(exponent) - decimals;
    const integer = BigInt(mantissa.replace('.', ''));
    return shift >= 0 ? new Fraction(integer * 10n ** BigInt(shift)) : new Fraction(integer, 10n ** BigInt(-shift));
  }
  add(b: Fraction) { return new Fraction(this.n * b.d + b.n * this.d, this.d * b.d); }
  mul(b: Fraction) { return new Fraction(this.n * b.n, this.d * b.d); }
  div(b: Fraction) { return new Fraction(this.n * b.d, this.d * b.n); }
  abs() { return new Fraction(this.n < 0n ? -this.n : this.n, this.d); }
  compare(b: Fraction) { const v = this.n * b.d - b.n * this.d; return v < 0n ? -1 : v > 0n ? 1 : 0; }
  round(places: number): string {
    const negative = this.n < 0n;
    const n = negative ? -this.n : this.n;
    const scale = 10n ** BigInt(places);
    const quotient = n * scale / this.d;
    const remainder = n * scale % this.d;
    const rounded = quotient + (remainder * 2n >= this.d ? 1n : 0n);
    const digits = rounded.toString().padStart(places + 1, '0');
    return `${negative && rounded !== 0n ? '-' : ''}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
  }
  display() { return this.d === 1n ? this.n.toString() : this.round(6).replace(/0+$/, '').replace(/\.$/, ''); }
  exact() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
}
function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }
const f = (n: number) => Fraction.from(n);
const sum = (items: Fraction[]) => items.reduce((a, b) => a.add(b), f(0));
const l1 = (items: Fraction[]) => sum(items.map(v => v.abs()));
const unique = (messages: string[]) => [...new Set(messages)];

export const genres: readonly Genre[] = Object.freeze(genreRows.map(row => Object.freeze({ ...row, weights: Object.freeze([...row.weights]) as unknown as number[] })));
export const chinaIndex: readonly ChinaEntry[] = Object.freeze(chinaRows.map(row => Object.freeze({ ...row })));
export const sourcePresets: Readonly<Record<string, readonly number[]>> = Object.freeze(Object.fromEntries(Object.entries(sourcePolicy.presets).map(([key, value]) => [key, Object.freeze([...value])])));
const genreMap = new Map(genres.map(g => [g.id, g]));

/** Validate the provided frozen workbook transcription; do not create a parallel market weight table. */
export function validateDatabase(): string[] {
  const errors: string[] = [];
  if (genres.length !== 558 || genreMap.size !== 558) errors.push('全球主库必须为558个唯一风格ID');
  if (chinaIndex.length !== 33 || new Set(chinaIndex.map(i => i.id)).size !== 33) errors.push('中国市场索引必须为33个唯一入口ID');
  if (new Set(chinaIndex.map(i => i.genreId)).size !== 32) errors.push('33个入口应引用32个主库ID');
  for (const g of genres) {
    if (g.weights.length !== 6 || g.weights.some(v => !Number.isFinite(v) || v < 0) || sum(g.weights.map(f)).compare(f(100)) !== 0 || g.weights[4] !== 15 || g.weights[5] !== 15) errors.push(`${g.id} 基础权重不合法`);
  }
  for (const i of chinaIndex) if (!genreMap.has(i.genreId)) errors.push(`${i.id} 引用未知主库ID`);
  return errors;
}
const databaseErrors = validateDatabase();

/**
 * Exact port of nmc_reference_v019.py with UI-specific structured evidence gates.
 * Scores are never inferred from metadata or an artist's reputation.
 */
export function calculate(album: Album): Calculation {
  const errors: string[] = [...databaseErrors];
  const warnings: string[] = ['显示权重最多保留六位小数，计算使用未舍入的精确分数。'];
  const eligibilityIssues: string[] = [];
  if (!provenance.referenceVerified) { eligibilityIssues.push('参考程序与黄金测试尚未完成核验，暂不开放正式发表'); warnings.push('参考程序与黄金测试尚未完成核验；当前总分仅供研究预览。'); }
  let base: Fraction[] = [];
  const selected = genreMap.get(album.genreId);
  if (album.blendMode === 'single') {
    if (!selected) errors.push('请选择主库中已有的风格');
    else base = selected.weights.map(f);
  } else if (album.blendMode === 'equal' || album.blendMode === 'duration') {
    warnings.push('跨风格仅聚合权重，整张专辑仍只评价一组六维星级；家族分类须人工核实。');
    if ((album.crossFamilyReason ?? '').trim().length < 20) errors.push('跨家族合成需要至少20字的必要性说明');
    if (!album.tracks.length) errors.push('跨风格聚合需要逐曲风格记录');
    const weighted = album.tracks.map((track, index) => {
      const genre = genreMap.get(track.genreId);
      if (!genre) errors.push(`曲目${index + 1}须选择已有全球风格，候选标签不能充当风格ID`);
      if ((track.genreEvidence ?? '').trim().length < 8) errors.push(`曲目${index + 1}需要至少8字的风格证据`);
      const duration = album.blendMode === 'equal' ? 1 : track.duration;
      if (!Number.isFinite(duration) || duration <= 0) errors.push(`曲目${index + 1}的聚合时长必须大于0`);
      return { genre, duration };
    });
    if (weighted.length && weighted.every(t => t.genre && Number.isFinite(t.duration) && t.duration > 0)) {
      const divisor = sum(weighted.map(t => f(t.duration)));
      base = DIMENSIONS.map((_, i) => sum(weighted.map(t => f(t.genre!.weights[i]).mul(f(t.duration)))).div(divisor));
    }
  } else errors.push('未知权重聚合方式');

  const entry = album.chinaEntryId ? chinaIndex.find(i => i.id === album.chinaEntryId) : undefined;
  if (album.chinaEntryId && !entry) errors.push('未知中国市场入口');
  if (entry && album.blendMode === 'single' && entry.genreId !== album.genreId) errors.push('中国市场入口与主库风格映射不一致');
  if (entry?.status === 'conditional' && (!album.fullListenConfirmed || album.genreEvidence.trim().length < 20)) errors.push('条件试用风格需要全碟听评确认及至少20字的音乐结构证据');
  if (entry?.id === 'cn-index:campus-folk' && (!album.fullListenConfirmed || album.genreEvidence.trim().length < 12 || (album.historicTraditionEvidence ?? '').trim().length < 12)) errors.push('校园民谣入口需要全碟听评确认、至少12字音乐证据及至少12字历史传统证据');
  // Searching the global catalogue must not bypass the two conditional styles'
  // editorial gate. Keep research arithmetic available, just as the reference's
  // direct-global route does, while retaining the documented publication rule.
  if (album.blendMode === 'single' && !entry && chinaIndex.some(i => i.genreId === album.genreId && i.status === 'conditional') && (!album.fullListenConfirmed || album.genreEvidence.trim().length < 20)) {
    eligibilityIssues.push('条件试用风格即使从全球检索选择，也需全碟听评确认及至少20字结构证据');
  }
  const used = album.blendMode === 'single' ? [selected] : album.tracks.map(t => genreMap.get(t.genreId));
  if (used.some(g => g?.status === 'provisional_chinese_focus')) {
    warnings.push('当前选择包含 provisional_chinese_focus 待实证风格，请保留审核状态。');
  }

  const readDelta = (values: number[], label: string): Fraction[] => {
    if (!Array.isArray(values) || values.length !== 6 || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      errors.push(`${label}修正必须包含六个有限数字`); return Array.from({ length: 6 }, () => f(0));
    }
    const result = values.map(f);
    if (values.some(v => !Number.isInteger(v))) errors.push(`${label}修正必须为整数百分点`);
    if (sum(result).n !== 0n) errors.push(`${label}修正必须零和`);
    if (result[4].n !== 0n || result[5].n !== 0n) errors.push(`${label}修正不得改变愿景和语境的固定15%`);
    return result;
  };
  const culture = readDelta(album.cultureDelta, '文化');
  const preset = album.sourcePreset ?? 'none';
  const knownPreset = Object.hasOwn(sourcePresets, preset);
  if (!knownPreset) errors.push('未知来源修正档位');
  const rawSource = readDelta(album.sourceDelta, '来源');
  if (preset !== 'none' && rawSource.some(v => v.n !== 0n)) errors.push('来源预设与自定义来源修正互斥，请先清零自定义修正');
  const source = preset !== 'none' && knownPreset ? sourcePresets[preset].map(f) : rawSource;
  if (l1(culture).compare(f(4)) > 0) errors.push('文化修正L1不得超过4个百分点');
  if (l1(source).compare(f(16)) > 0) errors.push('来源修正L1不得超过16个百分点');
  if (l1(culture).add(l1(source)).compare(f(16)) > 0) errors.push('文化与来源修正的毛额L1合计不得超过16个百分点（不得相互抵消预算）');
  if (culture.some(v => v.n !== 0n)) {
    eligibilityIssues.push('当前获批文化数值修正档案为0，非零文化修正不得发表');
    warnings.push('非零文化修正仅供研究，未套用任何虚构文化档案。');
    if (!album.cultureNote.trim()) eligibilityIssues.push('非零文化修正需要定性适配与证据');
  }
  if (source.some(v => v.n !== 0n)) {
    warnings.push('来源修正属于V0.16待实证工程先验，不是翻唱惩罚；不得与星级重复扣减。');
    if (!album.sourceNote.trim()) eligibilityIssues.push('来源修正需要独立理由');
    if (!album.sourceReviewed || !album.tracks.length) eligibilityIssues.push('非零来源修正需要获人工审核的逐曲词曲来源台账');
  }

  let complete = true;
  const na = new Set<number>();
  DIMENSIONS.forEach((dimension, i) => {
    const rating = album.ratings[dimension];
    if (!rating || rating.value === null) { complete = false; eligibilityIssues.push(`${LABELS[dimension]}尚未评价`); return; }
    if (rating.value === 'na') {
      na.add(i);
      if (dimension !== 'lyrics' && dimension !== 'performance') errors.push(`${LABELS[dimension]}不允许N/A`);
      if (!rating.naReason.trim()) eligibilityIssues.push(`${LABELS[dimension]} N/A必须记录适用证据`);
      if (dimension === 'performance' && !rating.naApproved) eligibilityIssues.push('表演N/A须特殊情形人工批准');
      if (source[i].n !== 0n) errors.push(`${LABELS[dimension]}已设为N/A，来源修正不得涉及该维度`);
      if (culture[i].n !== 0n) errors.push(`${LABELS[dimension]}已设为N/A，文化修正不得涉及该维度`);
      return;
    }
    if (typeof rating.value !== 'number' || !Number.isFinite(rating.value) || rating.value < 0.5 || rating.value > 5 || !Number.isInteger(rating.value * 2)) errors.push(`${LABELS[dimension]}星级必须为0.5至5、步长0.5`);
    if (!rating.evidence.trim() || !rating.rationale.trim()) eligibilityIssues.push(`${LABELS[dimension]}需独立证据与评分理由`);
    if (!rating.counterEvidence.trim()) eligibilityIssues.push(`${LABELS[dimension]}需记录反证或说明未发现反证`);
    if (rating.value >= 4.5 && (!rating.highJustification.trim() || !rating.notLower.trim())) eligibilityIssues.push(`${LABELS[dimension]}4.5/5星需要全碟支撑及为何不低半星的说明`);
  });

  let final: Fraction[] = [];
  if (base.length === 6) {
    // Required order: culture on original base → remove N/A → normalize dynamic70 → source.
    const cultural = base.map((value, i) => value.add(culture[i]));
    const applicableDynamic = cultural.slice(0, 4).filter((_, i) => !na.has(i));
    const dynamicTotal = sum(applicableDynamic);
    if (dynamicTotal.n <= 0n) errors.push('适用动态维度权重之和必须大于0');
    else {
      final = cultural.map((value, i) => na.has(i) ? f(0) : i < 4 ? value.mul(f(70)).div(dynamicTotal) : value);
      final = final.map((value, i) => value.add(source[i]));
      if (final.some(v => v.n < 0n)) errors.push('实际权重不得为负');
      if (final.slice(0, 4).some((value, i) => !na.has(i) && value.compare(f(5)) < 0)) errors.push('最终适用动态维度权重不得低于5%；无可评价歌词须显式设置作词N/A');
      if (sum(final).compare(f(100)) !== 0 || final[4].compare(f(15)) !== 0 || final[5].compare(f(15)) !== 0) errors.push('实际权重必须合计100%，愿景与语境各15%');
    }
  }
  if (!album.title.trim() || !album.artist.trim()) eligibilityIssues.push('需填写专辑名和音乐人');
  if (!album.fullListenConfirmed) eligibilityIssues.push('需确认完成全碟聆听');
  if (!album.releaseIdentityVerified) eligibilityIssues.push('需确认发行版本、作品类型和曲目身份已核实');
  if (!album.cultureNote.trim()) eligibilityIssues.push('需填写文化定性适配记录（不自动加分）');
  if (!album.genreEvidence.trim() || !album.genreExclusions.trim()) eligibilityIssues.push('需填写风格判据和易混淆风格排除理由');
  if (!album.sourceReviewed || !album.noDoubleCount) eligibilityIssues.push('需确认逐曲来源审核及未重复计量');
  if (!album.tracks.length || album.tracks.some(t => !t.title.trim() || !t.lyricsSource.trim() || !t.compositionSource.trim() || !t.sourceEvidence.trim())) eligibilityIssues.push('需填写逐曲词曲来源与证据');
  if (!album.reviewer.trim()) eligibilityIssues.push('需填写人工审核责任人');
  let total: Fraction | null = null;
  if (!errors.length && complete && final.length === 6) total = sum(DIMENSIONS.map((d, i) => album.ratings[d].value === 'na' ? f(0) : f(album.ratings[d].value as number).mul(final[i]))).div(f(50));
  const issues = unique([...errors, ...eligibilityIssues]);
  return { valid: errors.length === 0, complete, total: total?.round(2) ?? null, exactTotal: total?.exact() ?? null, baseWeights: base.map(v => v.display()), finalWeights: final.map(v => v.display()), baseWeightsExact: base.map(v => v.exact()), finalWeightsExact: final.map(v => v.exact()), errors: unique(errors), warnings: unique(warnings), eligibilityIssues: issues, publishEligible: errors.length === 0 && complete && issues.length === 0 };
}
