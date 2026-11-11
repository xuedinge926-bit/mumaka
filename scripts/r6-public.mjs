import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE = 'v0.41-r6-2026-11-11';
export const DATA_SHA256 = 'b226d1ffe514f547dcc12a65232a43d8fa24d5a71dcff7e705360af039fc380d';
const directory = new URL('./r6-public/', import.meta.url);
const coefficients = { S: 190578024n, A: 164291400n, B: 140420000n, C: 119000000n, D: 100000000n };

export async function validatedPublicData() {
  const bytes = await readFile(new URL('data.json', directory));
  if (createHash('sha256').update(bytes).digest('hex') !== DATA_SHA256) throw new Error('R6 public data fingerprint changed; explicit review is required.');
  const data = JSON.parse(bytes);
  if (data.records.length !== 39 || data.records.filter(r => r.trial_eligible).length !== 38) throw new Error('Expected the frozen 39/38 R6 research records.');
  const keys = new Set();
  for (const row of data.records) {
    if (keys.has(row.record_key) || row.approval_status !== 'unapproved') throw new Error('Duplicate or approved R6 record.');
    keys.add(row.record_key);
    if (!row.trial_eligible) {
      if (row.grades_d1_d4 !== null || row.weights_pct !== null) throw new Error('Historical index must not acquire a vector.');
      continue;
    }
    const grades = row.grades_d1_d4;
    if (grades.length !== 4 || grades.filter(g => g === 'S').length !== 1 || grades.some(g => !Object.hasOwn(coefficients, g))) throw new Error('Invalid current R6 grades.');
    const sum = grades.reduce((n, g) => n + coefficients[g], 0n);
    row.weights_pct.exact.forEach((fraction, i) => {
      const [n, d] = fraction.split('/').map(BigInt);
      if (d <= 0n || (i < 4 ? n * sum !== d * 70n * coefficients[grades[i]] : n !== d * 15n)) throw new Error('R6 exact weight differs from its frozen grade coefficients.');
    });
    if (row.weights_pct.exact.length !== 6) throw new Error('Six weights are required.');
  }
  return data;
}

export async function embedResearchR6(html) {
  if (html.includes('MUMAKA PUBLIC R6 BEGIN') || html.includes('MUMAKA LOCAL R6 BEGIN')) throw new Error('R6 is already installed.');
  const root = '<div id="root"></div>';
  if (html.split(root).length !== 2) throw new Error('Unexpected standalone application root.');
  const data = await validatedPublicData();
  const names = ['panel.css', 'panel.html', 'score.js', 'review.js', 'panel.js', 'workspace.js'];
  const [css, markup, ...scripts] = await Promise.all(names.map(name => readFile(new URL(name, directory), 'utf8')));
  const payload = JSON.stringify(data).replaceAll('<', '\\u003c');
  const fragment = `<!-- MUMAKA PUBLIC R6 BEGIN -->\n<style>${css.replace(/<\/style/gi, '<\\/style')}</style>\n${markup}<script id="mumaka-r6-data" type="application/json">${payload}</script>\n<script id="mumaka-r6-script">\n(() => {\n"use strict";\n${scripts.join('\n').replace(/<\/script/gi, '<\\/script')}\n})();\n</script>\n<!-- MUMAKA PUBLIC R6 END -->\n`;
  return html.replace('<head>', `<head><meta name="mumaka-release" content="${RELEASE}"><meta name="mumaka-r6-data-sha256" content="${DATA_SHA256}">`).replace(root, fragment + root);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const data = await validatedPublicData();
  if (process.argv[2] === '--manifest' && process.argv[3]) {
    const target = resolve(process.argv[3]);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ release: RELEASE, sourceCommit: process.env.GITHUB_SHA || 'local-validation', researchDataset: data.dataset_version, researchDataSha256: DATA_SHA256, records: 39, trialConfigurations: 38, productionApprovals: 0, legacyWeightSource: 'v0.38.1', previousRelease: './legacy/pre-r6-20261111/' }, null, 2) + '\n');
  }
  console.log(`${RELEASE}: frozen public R6 data verified; 39 records, 38 trial configurations, 0 production approvals.`);
}
