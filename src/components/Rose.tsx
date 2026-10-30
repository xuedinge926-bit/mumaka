import { DIMENSIONS, LABELS, type Album } from '../model/types';

export interface RoseProps {
  ratings: Album['ratings'];
  /** Retained for old callers; weights never alter or annotate the rose. */
  weights?: string[];
  size?: number;
  dark?: boolean;
}

const point = (angle: number, radius: number): [number, number] => [180 + Math.cos(angle) * radius, 180 + Math.sin(angle) * radius];

export function displayWeight(value?: string): string {
  if (!value) return '—';
  const parts = value.split('/').map(Number);
  const number = parts.length === 2 ? parts[0] / parts[1] : parts[0];
  return Number.isFinite(number) ? `${Number(number.toFixed(2))}%` : `${value}%`;
}

export function ratingText(value: number | null | 'na'): string {
  return value === null ? '未评价' : value === 'na' ? 'N/A' : `${value.toFixed(1)} ★`;
}

/** A pair of tangent cubic curves forms each soft, rounded petal. */
export function RoseGraphic({ ratings, dark = false }: Omit<RoseProps, 'size'>) {
  const ink = dark ? '#f5f0e5' : '#353a35';
  const muted = dark ? '#c3bdb1' : '#77756d';
  const colors = dark
    ? ['#df987d', '#cfaa8c', '#a1b6a4', '#df987d', '#cfaa8c', '#a1b6a4']
    : ['#b65743', '#c8795e', '#8a9b88', '#b65743', '#c8795e', '#8a9b88'];
  return <g fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
    {[1, 2, 3, 4, 5].map(star => <circle key={star} cx="180" cy="180" r={star * 21} fill="none" stroke={dark ? '#51564e' : '#ded9ce'} strokeWidth={star === 5 ? 0.8 : 0.5} strokeDasharray={star === 5 ? undefined : '2 5'} />)}
    {DIMENSIONS.map((dimension, index) => {
      const value = ratings[dimension].value;
      if (typeof value !== 'number') return null;
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const radius = value * 21;
      const local = (radial: number, lateral: number) => [
        180 + Math.cos(angle) * radius * radial - Math.sin(angle) * radius * lateral,
        180 + Math.sin(angle) * radius * radial + Math.cos(angle) * radius * lateral,
      ].join(' ');
      return <path key={dimension} data-petal={dimension}
        d={`M180 180 C${local(.33, -.32)} ${local(1, -.36)} ${local(1, 0)} C${local(1, .36)} ${local(.33, .32)} 180 180 Z`}
        fill={colors[index]} opacity="0.94" />;
    })}
    <circle cx="180" cy="180" r="3.5" fill={dark ? '#e9deca' : '#f7f3eb'} />
    {DIMENSIONS.map((dimension, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const [x, y] = point(angle, 142);
      return <g key={dimension} textAnchor="middle">
        <text x={x} y={y - 3} fill={ink} fontSize="14" fontWeight="600">{LABELS[dimension]}</text>
        <text x={x} y={y + 15} fill={muted} fontSize="10.5">{ratingText(ratings[dimension].value)}</text>
      </g>;
    })}
  </g>;
}

export function Rose({ ratings, size = 340, dark = false }: RoseProps) {
  const description = DIMENSIONS.map(d => `${LABELS[d]} ${ratingText(ratings[d].value)}`).join('；');
  return <svg viewBox="0 0 360 360" width={size} height={size} role="img" aria-label={`六维风向玫瑰图：${description}`} style={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
    <RoseGraphic ratings={ratings} dark={dark} />
  </svg>;
}

export default Rose;
