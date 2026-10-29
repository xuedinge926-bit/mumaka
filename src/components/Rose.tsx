import { DIMENSIONS, LABELS, type Album } from '../model/types';

export interface RoseProps {
  ratings: Album['ratings'];
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

/** Geometry is driven solely by stars; weights are separate annotations. */
export function RoseGraphic({ ratings, weights, dark = false }: Omit<RoseProps, 'size'>) {
  const ink = dark ? '#f5f1dc' : '#244c40';
  const muted = dark ? '#c4ccb7' : '#777a6c';
  const colors = dark
    ? ['#d6b76b', '#c4ce9c', '#8fbda3', '#d6b76b', '#c4ce9c', '#8fbda3']
    : ['#285c4b', '#39725c', '#4b8068', '#b18c49', '#c3a05e', '#9b7e45'];
  return <g fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
    {[1, 2, 3, 4, 5].map(star => <circle key={star} cx="180" cy="180" r={star * 21} fill="none" stroke={dark ? '#607464' : '#dcded2'} strokeWidth={star === 5 ? 1.1 : 0.65} strokeDasharray={star === 5 ? undefined : '2 4'} />)}
    {DIMENSIONS.map((dimension, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const tip = point(angle, 112);
      return <line key={dimension} x1="180" y1="180" x2={tip[0]} y2={tip[1]} stroke={dark ? '#748575' : '#d1d6c8'} strokeWidth="0.8" />;
    })}
    {DIMENSIONS.map((dimension, index) => {
      const value = ratings[dimension].value;
      if (typeof value !== 'number') return null;
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const length = value * 21;
      const left = point(angle - Math.PI / 3, length * 0.26);
      const right = point(angle + Math.PI / 3, length * 0.26);
      const tip = point(angle, length);
      const middle = point(angle, length * 0.63);
      return <g key={dimension}>
        <path d={`M180 180 L${left.join(' ')} L${tip.join(' ')} L${right.join(' ')} Z`} fill={colors[index]} opacity="0.9" stroke={colors[index]} strokeWidth="0.6" />
        <path d={`M180 180 L${tip.join(' ')} L${middle.join(' ')} Z`} fill="#ffffff" opacity="0.15" />
      </g>;
    })}
    <circle cx="180" cy="180" r="3" fill={ink} />
    <text x="188" y="76" fill={muted} fontSize="6.5">5★</text>
    {DIMENSIONS.map((dimension, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const [x, y] = point(angle, 143);
      return <g key={dimension} textAnchor="middle">
        <text x={x} y={y - 4} fill={ink} fontSize="12" fontWeight="600">{LABELS[dimension]}</text>
        <text x={x} y={y + 11} fill={muted} fontSize="9">{ratingText(ratings[dimension].value)}</text>
        {weights?.[index] !== undefined && <text x={x} y={y + 24} fill={dark ? '#aebba3' : '#9b9e90'} fontSize="8">权重 {displayWeight(weights[index])}</text>}
      </g>;
    })}
  </g>;
}

export function Rose({ ratings, weights, size = 340, dark = false }: RoseProps) {
  const description = DIMENSIONS.map(d => `${LABELS[d]} ${ratingText(ratings[d].value)}`).join('；');
  return <svg viewBox="0 0 360 360" width={size} height={size} role="img" aria-label={`六维风向玫瑰图：${description}`} style={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
    <RoseGraphic ratings={ratings} weights={weights} dark={dark} />
  </svg>;
}

export default Rose;
