import { DIMENSIONS, LABELS, type Album, type Calculation } from '../model/types';
import { RoseGraphic, displayWeight, ratingText } from './Rose';
import provenance from '../data/provenance.json';

export interface ScoreCardProps { album: Album; calculation: Calculation; modelProvenance?: unknown }

const lines = (text: string, width: number, maxLines: number): string[] => {
  const chars = Array.from(text);
  const result: string[] = [];
  for (let i = 0; i < chars.length && result.length < maxLines; i += width) {
    const line = chars.slice(i, i + width).join('');
    result.push(i + width < chars.length && result.length === maxLines - 1 ? `${line.slice(0, -1)}…` : line);
  }
  return result;
};

/** Self-contained SVG: no browser CSS, remote image requests, or foreignObject. */
export function ScoreCard({ album, calculation, modelProvenance }: ScoreCardProps) {
  const model: { modelVersion: string; referenceVerified: boolean } = modelProvenance && typeof modelProvenance === 'object' && 'modelVersion' in modelProvenance && 'referenceVerified' in modelProvenance && typeof modelProvenance.modelVersion === 'string' && typeof modelProvenance.referenceVerified === 'boolean' ? modelProvenance as { modelVersion: string; referenceVerified: boolean } : provenance;
  const hasCover = /^data:image\/(?:png|jpeg|webp);base64,/.test(album.cover);
  const titleLines = lines(album.title || '尚未命名的作品', 17, 2);
  const summaryLines = lines(album.summary || '让每一个判断，都有听得见的依据。', 35, 3);
  const status = album.status === 'published'
    ? '已人工批准发表'
    : calculation.publishEligible && model.referenceVerified
      ? '结构化条件满足 · 待人工批准'
      : album.status === 'draft' ? '草稿预览' : '研究性候选';
  const statusEn = album.status === 'published' ? 'PUBLISHED' : calculation.publishEligible && model.referenceVerified ? 'REVIEW READY' : album.status === 'draft' ? 'DRAFT' : 'RESEARCH CANDIDATE';
  return <svg id="score-card-svg" viewBox="0 0 700 900" width="700" height="900" role="img" aria-label={`${album.title || '未命名作品'}的评分卡：${status}`} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: 'auto' }}>
    <rect width="700" height="900" rx="6" fill="#f8f6ee" />
    <rect x="24" y="24" width="652" height="852" fill="none" stroke="#d9dbcf" />
    <g fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
      <path d="M54 47 L59 59 L71 64 L59 69 L54 81 L49 69 L37 64 L49 59 Z" fill="#244c40" />
      <text x="82" y="62" fill="#244c40" fontSize="20" fontWeight="700" letterSpacing="4">新乐评主义</text>
      <text x="83" y="79" fill="#8b8e7e" fontSize="8" letterSpacing="2">NEW MUSIC CRITICISM</text>
      <text x="647" y="62" textAnchor="end" fill="#8b8e7e" fontSize="9" letterSpacing="1">LISTEN · REASON · RECORD</text>
      <line x1="48" x2="652" y1="103" y2="103" stroke="#d9dbcf" />
      <rect x="48" y="131" width="100" height="100" rx="2" fill="#e2e6dc" />
      {hasCover ? <image x="48" y="131" width="100" height="100" href={album.cover} preserveAspectRatio="xMidYMid slice" /> : <g fill="none" stroke="#a4b1a0"><circle cx="98" cy="181" r="33" /><circle cx="98" cy="181" r="11" /><circle cx="98" cy="181" r="3" fill="#a4b1a0" /></g>}
      <text x="172" y="144" fill="#8b8e7e" fontSize="9" letterSpacing="2">{album.kind} / {album.year || '年份待填'}</text>
      {titleLines.map((line, i) => <text key={i} x="170" y={177 + i * 29} fill="#244c40" fontSize="25" fontWeight="700">{line}</text>)}
      <text x="172" y="230" fill="#697466" fontSize="13">{lines(album.artist || '音乐人待填', 30, 1)[0]}</text>
      <text x="48" y="283" fill="#a08750" fontSize="9" letterSpacing="2">{statusEn} / {status}</text>
      <text x="45" y="358" fill="#244c40" fontSize="71" fontWeight="500" fontFamily="Georgia, serif">{calculation.total ?? '—'}</text>
      <text x="49" y="381" fill="#8b8e7e" fontSize="10">{calculation.total ? '/ 10  ·  整碟六维加权' : '完成有效评分后生成总分'}</text>
      <text x="49" y="415" fill="#8b8e7e" fontSize="9">模型 {model.modelVersion}</text>
      <text x="49" y="433" fill="#8b8e7e" fontSize="9">{model.referenceVerified ? '参考计算已核验 · 艺术判断由评价人负责' : '参考程序尚未核验 · 不用于正式发表'}</text>
      <g transform="translate(272 250) scale(1.02)"><RoseGraphic ratings={album.ratings} /></g>
      <line x1="48" x2="652" y1="635" y2="635" stroke="#d9dbcf" />
      {DIMENSIONS.map((dimension, i) => <g key={dimension} transform={`translate(${48 + i * 102} 663)`}>
        <text fill="#8b8e7e" fontSize="10">{LABELS[dimension]}</text>
        <text y="25" fill="#244c40" fontSize="17" fontFamily="Georgia, serif">{ratingText(album.ratings[dimension].value)}</text>
        <text y="45" fill="#8b8e7e" fontSize="9">权重 {displayWeight(calculation.finalWeights[i])}</text>
      </g>)}
      <line x1="48" x2="652" y1="733" y2="733" stroke="#d9dbcf" />
      {summaryLines.map((line, i) => <text key={i} x="48" y={762 + i * 21} fill="#54644f" fontSize="12">{line}</text>)}
      <text x="48" y="849" fill="#8b8e7e" fontSize="9">评价：{lines(album.reviewer || '尚未署名', 20, 1)[0]} · 版本 {album.revision}</text>
      <text x="652" y="849" textAnchor="end" fill="#8b8e7e" fontSize="8">星级决定花瓣长度，权重单独列示</text>
    </g>
  </svg>;
}

export default ScoreCard;
