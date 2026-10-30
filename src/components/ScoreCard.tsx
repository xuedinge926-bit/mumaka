import { type Album, type Calculation } from '../model/types';
import { RoseGraphic } from './Rose';

export type CardRatio = '4:5' | '3:4' | '1:1';
export type CardTheme = 'paper' | 'ink';
export interface ScoreCardProps {
  album: Album;
  calculation: Calculation;
  /** Legacy snapshot metadata is kept by storage, never printed on the card. */
  modelProvenance?: unknown;
  ratio?: CardRatio;
  theme?: CardTheme;
}

/** Width is measured in approximate CJK cells, preserving every codepoint. */
export function wrapCardText(text: string, maxUnits: number): string[] {
  const result: string[] = [];
  let line = '';
  let width = 0;
  for (const char of Array.from(text)) {
    if (char === '\n') { result.push(line); line = ''; width = 0; continue; }
    const units = /^[\x20-\x7e]$/.test(char) ? .56 : 1;
    if (width + units > maxUnits && line) { result.push(line); line = ''; width = 0; }
    line += char;
    width += units;
  }
  if (line) result.push(line);
  return result;
}

/** Standalone 1080px SVG; all imagery is embedded and all styling is local. */
export function ScoreCard({ album, calculation, ratio = '4:5', theme = 'paper' }: ScoreCardProps) {
  const height = ratio === '3:4' ? 1440 : ratio === '1:1' ? 1080 : 1350;
  const dark = theme === 'ink';
  const paper = dark ? '#242624' : '#f7f3eb';
  const ink = dark ? '#f5f0e5' : '#353a35';
  const muted = dark ? '#c3bdb1' : '#77756d';
  const accent = dark ? '#df987d' : '#b65743';
  const line = dark ? '#51564e' : '#ded9ce';
  const hasCover = /^data:image\/(?:png|jpe?g|webp|gif);base64,/.test(album.cover);
  const rawTitle = album.title || '未命名专辑';
  const titleFont = Array.from(rawTitle).length > 35 ? 36 : 46;
  const titleLines = wrapCardText(rawTitle, 690 / titleFont);
  const artistLines = wrapCardText(album.artist || '未填写音乐人', 28);
  const titleY = 155;
  const artistY = titleY + titleLines.length * (titleFont + 11) + 14;
  const headerBottom = artistY + artistLines.length * 35 + 26;
  const summary = album.summary;
  const naturalSummaryLines = summary.trim() ? wrapCardText(summary, 36) : [];
  // Keep the original comment in storage; reflow excessive user line breaks
  // so an otherwise valid 200-character comment fits every export ratio.
  const summaryLines = naturalSummaryLines.length > 8
    ? wrapCardText(summary.replace(/\s+/gu, ' ').trim(), 36)
    : naturalSummaryLines;
  const summaryHeight = summaryLines.length ? summaryLines.length * 39 + 22 : 0;
  const availableMain = height - headerBottom - 48 - 80 - (summaryHeight ? summaryHeight + 40 : 0);
  const mainHeight = Math.max(200, Math.min(summaryHeight ? 520 : 610, availableMain));
  const mainTop = headerBottom + 48 + Math.max(0, (availableMain - mainHeight) / 2);
  const coverSize = Math.min(450, mainHeight * .9);
  const roseSize = Math.min(530, mainHeight);
  const coverX = 290 - coverSize / 2;
  const coverY = mainTop + (mainHeight - coverSize) / 2;
  const roseX = 790 - roseSize / 2;
  const roseY = mainTop + (mainHeight - roseSize) / 2;
  const summaryY = mainTop + mainHeight + 40;
  return <svg id="score-card-svg" viewBox={`0 0 1080 ${height}`} width="1080" height={height} role="img" aria-label={`${rawTitle}的私人评分卡`} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: 'auto' }}>
    <rect width="1080" height={height} fill={paper} />
    <g fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
      <text x="64" y="65" fill={ink} fontSize="27" fontWeight="700" letterSpacing="3">新乐评主义</text>
      <text x="1016" y="63" textAnchor="end" fill={muted} fontSize="21">私人评分</text>
      <line x1="64" x2="1016" y1="92" y2="92" stroke={line} />
      {titleLines.map((value, i) => <text key={i} x="64" y={titleY + i * (titleFont + 11)} fill={ink} fontSize={titleFont} fontWeight="700">{value}</text>)}
      {artistLines.map((value, i) => <text key={i} x="66" y={artistY + i * 35} fill={muted} fontSize="27">{value}{i === artistLines.length - 1 && album.year ? ` · ${album.year}` : ''}</text>)}
      <text x="1016" y="174" textAnchor="end" fill={accent} fontSize="98" fontWeight="500" fontFamily="Georgia, serif">{calculation.total ?? '—'}</text>
      <text x="1012" y="212" textAnchor="end" fill={muted} fontSize="23">/ 10</text>
      <g aria-label="专辑封面">
        <rect x={coverX} y={coverY} width={coverSize} height={coverSize} rx="4" fill={dark ? '#363b35' : '#e9e3d8'} />
        {hasCover ? <image x={coverX} y={coverY} width={coverSize} height={coverSize} href={album.cover} preserveAspectRatio="xMidYMid slice" /> : <g fill="none" stroke={dark ? '#667260' : '#bab9a7'} strokeWidth="2">
          <circle cx="290" cy={coverY + coverSize / 2} r={coverSize * .34} />
          <circle cx="290" cy={coverY + coverSize / 2} r={coverSize * .105} />
          <circle cx="290" cy={coverY + coverSize / 2} r={coverSize * .025} />
        </g>}
      </g>
      <g transform={`translate(${roseX} ${roseY}) scale(${roseSize / 360})`} aria-label="六维风向玫瑰图"><RoseGraphic ratings={album.ratings} dark={dark} /></g>
      {summaryLines.length > 0 && <g aria-label="专辑短评">
        <line x1="64" x2="1016" y1={summaryY - 23} y2={summaryY - 23} stroke={line} />
        {summaryLines.map((value, i) => <text key={i} x="64" y={summaryY + 14 + i * 39} fill={ink} fontSize="26">{value}</text>)}
      </g>}
      <text x="64" y={height - 42} fill={muted} fontSize="17" letterSpacing="2">NEW MUSIC CRITICISM</text>
      <circle cx="1008" cy={height - 49} r="5" fill={accent} />
    </g>
  </svg>;
}

export default ScoreCard;
