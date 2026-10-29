import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newAlbum, type Calculation } from '../model/types';
import { Rose, displayWeight } from './Rose';
import { ScoreCard } from './ScoreCard';
import provenance from '../data/provenance.json';

describe('six-dimension rose and score card', () => {
  it('does not draw a scored petal for an unrated or N/A dimension', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 'na';
    const svg = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings }));
    expect(svg).toContain('N/A');
    expect(svg).toContain('未评价');
    expect(svg.match(/<path/g)).toBeNull();
  });

  it('uses stars for geometry independently of weight annotations', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 4;
    const render = (weights: string[]) => renderToStaticMarkup(createElement(Rose, { ratings: album.ratings, weights }));
    const one = render(['10', '20', '20', '20', '15', '15']);
    const two = render(['30', '20', '10', '10', '15', '15']);
    expect(one.match(/<path[^>]+>/g)).toEqual(two.match(/<path[^>]+>/g));
    expect(one).toContain('权重 10%');
    expect(two).toContain('权重 30%');
    expect(displayWeight('70/3')).toBe('23.33%');
  });

  it('uses contrast-safe cream labels and gold/sage petals on dark previews', () => {
    const album = newAlbum();
    album.ratings.lyrics.value = 5;
    const light = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings }));
    const dark = renderToStaticMarkup(createElement(Rose, { ratings: album.ratings, dark: true }));
    expect(dark).toContain('fill="#f5f1dc"');
    expect(dark).toContain('fill="#c4ccb7"');
    expect(dark).toContain('fill="#d6b76b"');
    expect(dark).toContain('stroke="#607464"');
    expect(light).toContain('fill="#244c40"');
    expect(dark.match(/d="M[^\"]+"/g)).toEqual(light.match(/d="M[^\"]+"/g));
  });

  it('exports escaped text and excludes remote covers from the standalone SVG', () => {
    const album = newAlbum();
    album.title = '<script>危险文本</script>';
    album.cover = 'https://untrusted.example/cover.jpg';
    const calculation: Calculation = { valid: true, complete: true, total: '8.00', exactTotal: '8', baseWeights: ['20','20','15','15','15','15'], finalWeights: ['20','20','15','15','15','15'], errors: [], warnings: [], eligibilityIssues: [], publishEligible: false };
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation }));
    expect(svg).toContain('id="score-card-svg"');
    expect(svg).toContain('草稿预览');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('untrusted.example');
    expect(svg).not.toContain('foreignObject');
  });

  it('labels reference verification and human approval independently', () => {
    const album = newAlbum();
    const calculation: Calculation = { valid: true, complete: true, total: '8.00', exactTotal: '8', baseWeights: ['20','20','15','15','15','15'], finalWeights: ['20','20','15','15','15','15'], errors: [], warnings: [], eligibilityIssues: [], publishEligible: false };
    const render = () => renderToStaticMarkup(createElement(ScoreCard, { album, calculation }));
    const original = provenance.referenceVerified;
    try {
      provenance.referenceVerified = false;
      expect(render()).toContain('参考程序尚未核验');
      provenance.referenceVerified = true;
      expect(render()).toContain('参考计算已核验');
      expect(render()).not.toContain('不用于正式发表');
      album.status = 'research_candidate';
      expect(render()).toContain('研究性候选');
      calculation.publishEligible = true;
      album.status = 'publish_eligible';
      expect(render()).toContain('结构化条件满足 · 待人工批准');
      album.status = 'published';
      expect(render()).toContain('已人工批准发表');
    } finally {
      provenance.referenceVerified = original;
    }
  });

  it('uses historical provenance when exporting an old score card', () => {
    const album = newAlbum();
    const calculation: Calculation = { valid: true, complete: true, total: '7.58', exactTotal: '379/50', baseWeights: ['21','23','14','12','15','15'], finalWeights: ['21','23','14','12','15','15'], errors: [], warnings: [], eligibilityIssues: [], publishEligible: false };
    const svg = renderToStaticMarkup(createElement(ScoreCard, { album, calculation, modelProvenance: { modelVersion: 'V0.18-历史快照', referenceVerified: false } }));
    expect(svg).toContain('V0.18-历史快照');
    expect(svg).toContain('参考程序尚未核验');
    expect(svg).not.toContain('模型 V0.19-RC1');
    expect(svg).toContain('7.58');
  });
});
