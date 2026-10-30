import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newAlbum, type Calculation } from '../model/types';
import { Rose, displayWeight } from './Rose';
import { ScoreCard, type CardRatio, wrapCardText } from './ScoreCard';

const calculation: Calculation = {
  valid: true, complete: true, total: '8.00', exactTotal: '8',
  baseWeights: ['20','20','15','15','15','15'], finalWeights: ['20','20','15','15','15','15'],
  errors: [], warnings: [], eligibilityIssues: [], publishEligible: false,
};

const textContent = (svg: string) => svg.replace(/<[^>]+>/g, '');

describe('rounded six-petal rose', () => {
  it('does not draw a scored petal for an unrated or N/A dimension', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 'na';
    const svg = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings }));
    expect(svg).toContain('N/A');
    expect(svg).toContain('未评价');
    expect(svg.match(/<path/g)).toBeNull();
  });

  it('uses tangent cubic petals whose shape depends only on stars', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 4;
    const render = (weights: string[]) => renderToStaticMarkup(createElement(Rose, { ratings: album.ratings, weights }));
    const one = render(['10', '20', '20', '20', '15', '15']);
    const two = render(['30', '20', '10', '10', '15', '15']);
    expect(one).toEqual(two);
    expect(one).toContain(' C');
    expect(one).not.toContain('权重');
    expect(one.match(/data-petal=/g)).toHaveLength(1);
    expect(displayWeight('70/3')).toBe('23.33%');
    album.ratings.lyrics.value = 5;
    expect(render([]).match(/d="M[^\"]+"/g)).not.toEqual(one.match(/d="M[^\"]+"/g));
  });

  it('retains contrast-safe dark rendering without changing geometry', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 5;
    const light = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings }));
    const dark = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings, dark: true }));
    expect(dark).toContain('fill="#f5f0e5"');
    expect(dark).toContain('fill="#c3bdb1"');
    expect(dark).toContain('fill="#df987d"');
    expect(light).toContain('fill="#353a35"');
    expect(dark.match(/d="M[^\"]+"/g)).toEqual(light.match(/d="M[^\"]+"/g));
  });
});

describe('private score card exports', () => {
  it.each<[CardRatio, number]>([['4:5', 1350], ['3:4', 1440], ['1:1', 1080]])('uses an exact 1080px %s canvas without modifying its score', (ratio, height) => {
    const album = newAlbum();
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation, ratio }));
    expect(svg).toContain(`viewBox="0 0 1080 ${height}"`);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain(`height="${height}"`);
    expect(svg).toContain('8.00');
  });

  it('defaults to 4:5 and collapses an empty summary area', () => {
    const album = newAlbum();
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation }));
    expect(svg).toContain('viewBox="0 0 1080 1350"');
    expect(svg).not.toContain('aria-label="专辑短评"');
    expect(svg).not.toContain('让每一个判断');
    expect(svg).toContain('aria-label="专辑封面"');
    expect(svg).toContain('aria-label="六维风向玫瑰图"');
  });

  it.each<CardRatio>(['4:5', '3:4', '1:1'])('keeps all 200 Chinese codepoints in %s without ellipsis or shrinking the comment', ratio => {
    const album = newAlbum();
    album.summary = '这是一段完整且需要被保留的中文短评。'.repeat(12).slice(0, 200);
    expect(Array.from(album.summary)).toHaveLength(200);
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation, ratio }));
    expect(textContent(svg)).toContain(album.summary);
    expect(svg).not.toContain('…');
    expect(svg).toContain('font-size="26"');
    const summaryBlock = svg.slice(svg.indexOf('aria-label="专辑短评"'));
    const ys = [...summaryBlock.matchAll(/<text[^>]+ y="([\d.]+)"/g)].map(match => Number(match[1]));
    const height = ratio === '1:1' ? 1080 : ratio === '3:4' ? 1440 : 1350;
    expect(Math.max(...ys)).toBeLessThan(height);
  });

  it('wraps Unicode text without cutting surrogate pairs or discarding newlines', () => {
    expect(wrapCardText('声🎵音\n共鸣', 2)).toEqual(['声🎵', '音', '共鸣']);
  });

  it('shows a consistent paper/ink palette while retaining the same score', () => {
    const album = newAlbum();
    const light = renderToStaticMarkup(createElement(ScoreCard, { album, calculation, theme: 'paper' }));
    const dark = renderToStaticMarkup(createElement(ScoreCard, { album, calculation, theme: 'ink' }));
    expect(light).toContain('fill="#f7f3eb"');
    expect(dark).toContain('fill="#242624"');
    expect(dark).toContain('fill="#f5f0e5"');
    expect(dark).toContain('8.00');
    expect(calculation.total).toBe('8.00');
  });

  it('escapes text and includes only embedded raster covers in self-contained SVG', () => {
    const album = newAlbum();
    album.title = '<script>危险文本</script>';
    album.cover = 'https://untrusted.example/cover.jpg';
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation }));
    expect(svg).toContain('id="score-card-svg"');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('untrusted.example');
    expect(svg).not.toContain('foreignObject');
    album.cover = 'data:image/png;base64,aW1hZ2U=';
    expect(renderToStaticMarkup(createElement(ScoreCard, { album, calculation }))).toContain('href="data:image/png;base64,aW1hZ2U="');
    album.cover = 'data:image/gif;base64,R0lGODlh';
    expect(renderToStaticMarkup(createElement(ScoreCard, { album, calculation }))).toContain('href="data:image/gif;base64,R0lGODlh"');
    album.cover = 'data:image/svg+xml;base64,PHN2Zz4=';
    expect(renderToStaticMarkup(createElement(ScoreCard, { album, calculation }))).not.toContain('href="data:image/svg+xml');
  });

  it('prints private scoring only, with no public approval or audit claims', () => {
    const album = newAlbum();
    album.status = 'published';
    const svg = renderToStaticMarkup(createElement(ScoreCard, {
      album, calculation: { ...calculation, publishEligible: true },
      modelProvenance: { modelVersion: 'V0.18-历史快照', referenceVerified: false },
    }));
    expect(svg).toContain('私人评分');
    for (const hidden of ['已人工批准', '发表', '研究', '审计', 'V0.18', 'V0.19', '参考', '权重', '证据', '模型']) expect(svg).not.toContain(hidden);
  });
});
