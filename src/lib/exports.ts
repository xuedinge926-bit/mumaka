import { DIMENSIONS, LABELS, type Album, type Calculation } from '../model/types';
import provenance from '../data/provenance.json';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filename = (album: Album) => (album.title || '未命名专辑').replace(/[\\/:*?"<>|]/g, '_');

export function exportJSON(album: Album, calculation: Calculation, frozenProvenance: unknown = provenance): void {
  downloadBlob(new Blob([JSON.stringify({ format: 'nmc-evaluation', schemaVersion: 1, exportedAt: new Date().toISOString(), album, calculation, provenance: frozenProvenance }, null, 2)], { type: 'application/json;charset=utf-8' }), `${filename(album)}-评价.json`);
}

/** Prevent spreadsheet formula execution even when an editor later removes CSV quotes. */
export function csvCell(value: unknown): string {
  let cell = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

export function evaluationCSV(album: Album, calculation: Calculation, frozenProvenance: unknown = provenance): string {
  const model = frozenProvenance && typeof frozenProvenance === 'object' && 'modelVersion' in frozenProvenance && 'referenceVerified' in frozenProvenance ? frozenProvenance : provenance;
  const rows: unknown[][] = [
    ['专辑', '音乐人', '发行年份', '版本', '风格ID', '审核状态', '模型版本', '参考程序已核验', album.status === 'published' ? '总分（已人工批准）' : '总分（非正式预览）', '维度', '星级', '基础权重%', '实际权重%', '依据', '反证', '评分理由', '高星依据', '为何不低半星', 'N/A理由'],
    ...DIMENSIONS.map((d, i) => [album.title, album.artist, album.year, album.release, album.genreId, album.status, model.modelVersion, model.referenceVerified ? '是' : '否', calculation.total ?? '未完成', LABELS[d], album.ratings[d].value === null ? '未评价' : album.ratings[d].value === 'na' ? 'N/A' : album.ratings[d].value, calculation.baseWeights[i] ?? '', calculation.finalWeights[i] ?? '', album.ratings[d].evidence, album.ratings[d].counterEvidence, album.ratings[d].rationale, album.ratings[d].highJustification, album.ratings[d].notLower, album.ratings[d].naReason]),
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function exportCSV(album: Album, calculation: Calculation, frozenProvenance: unknown = provenance): void {
  downloadBlob(new Blob([evaluationCSV(album, calculation, frozenProvenance)], { type: 'text/csv;charset=utf-8' }), `${filename(album)}-评价.csv`);
}

export function serializeSVG(element: SVGSVGElement): string {
  const svg = element.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.removeAttribute('style');
  const viewBox = element.viewBox.baseVal;
  if (viewBox.width && viewBox.height) { svg.setAttribute('width', String(viewBox.width)); svg.setAttribute('height', String(viewBox.height)); }
  for (const image of svg.querySelectorAll('image')) {
    const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(href)) throw new Error('封面尚未嵌入图片，无法完整导出。请先使用本地上传封面后重试。');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

export async function exportSVG(element: SVGSVGElement, name = '新乐评主义-评分卡.svg'): Promise<void> {
  downloadBlob(new Blob([serializeSVG(element)], { type: 'image/svg+xml;charset=utf-8' }), name.endsWith('.svg') ? name : `${name}.svg`);
}

export async function exportPNG(element: SVGSVGElement, name = '新乐评主义-评分卡.png'): Promise<void> {
  if (document.fonts) await document.fonts.ready;
  const source = serializeSVG(element);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('评分卡图片渲染失败，可改用 SVG 导出')); img.src = url; });
    const width = element.viewBox.baseVal.width || element.width.baseVal.value || 1080;
    const height = element.viewBox.baseVal.height || element.height.baseVal.value || 1350;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布，可改用 SVG 导出');
    context.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成 PNG，请尝试 SVG')), 'image/png'));
    downloadBlob(png, name.endsWith('.png') ? name : `${name}.png`);
  } finally { URL.revokeObjectURL(url); }
}
