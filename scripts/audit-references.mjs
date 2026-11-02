import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const groups = ['china-song', 'china-instrumental', 'global-song', 'global-instrumental'];
const raw = await json('src/data/reference-review/manual-2026-11-02.json');
const lockDir = 'docs/reference-review/manual/2026-11-02';
const checksums = await json(`${lockDir}/checksums.json`);
const errors = [], tables = [], sourceFiles = {};
const check = (ok, text) => { if (!ok) errors.push(text); };
const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const https = s => { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
let all = [];
for (const group of groups) {
  const cells = await json(`src/data/reference-review/${group}.json`);
  sourceFiles[`${group}.json`] = createHash('sha256').update(await readFile(resolve(root,`src/data/reference-review/${group}.json`))).digest('hex');
  all.push(...cells);
  const names = group.endsWith('instrumental') ? ['素材','结构','表演','制作','愿景','语境'] : ['歌词','作曲','表演','制作','愿景','语境'];
  check(cells.length === 42 && new Set(cells.map(a => a.id)).size === 42, `${group}: 需要42个唯一格位`);
  for (const name of names) {
    const row = cells.filter(a => a.dimension === name);
    check(row.map(a => a.stars).sort((a,b)=>a-b).join(',') === '2,2.5,3,3.5,4,4.5,5', `${group}/${name}: 七档覆盖错误`);
    check(new Set(row.map(a => a.primaryArtistId)).size === 7 && new Set(row.map(a => normalize(a.artist))).size === 7, `${group}/${name}: 主艺人重复`);
  }
  let repeats = [];
  for (const fn of [a => a.primaryArtistId, a => normalize(a.artist)]) {
    const counts = new Map();
    for (const a of cells) counts.set(fn(a), [...(counts.get(fn(a)) || []), a]);
    const repeated = [...counts.values()].filter(a => a.length > 1);
    check(repeated.length <= 1 && repeated.every(a => a.length <= 2), `${group}: 只允许一位艺人最多两次`);
    repeats = repeated.map(a => ({ artist: a[0].artist, count: a.length }));
  }
  check(new Set(cells.map(a => a.workId)).size === 42 && new Set(cells.map(a => `${normalize(a.artist)}:${normalize(a.album)}`)).size === 42, `${group}: 专辑重复占格`);
  for (const a of cells) {
    for (const key of ['id','workId','primaryArtistId','artist','album','year','mainGenre','dimension','feature','status','edition','evidence','confidence','pending'])
      check(typeof a[key] === 'string' && !!a[key].trim(), `${a.id}: ${key}为空`);
    check(/^\d{4}$/.test(a.year) && +a.year >= 1900 && +a.year <= 2026, `${a.id}: 发行年份无效`);
    check(a.id.startsWith(group + '-'), `${a.id}: 错误分类`);
    const axis = {歌词:'Lyrics',作曲:'Composition',素材:'Material',结构:'Structure',表演:'Performance',制作:'Production',愿景:'Vision',语境:'Context'}[a.dimension];
    check(a.id === `${group}-${axis}-${a.stars * 2}`, `${a.id}: 格位与等级不符`);
    check(Array.isArray(a.sources) && a.sources.length > 0 && a.sources.every(https), `${a.id}: 缺少合法HTTPS资料出处`);
    check(!a.unassigned && !/安河桥北|亲密关系.*Close to Me/i.test(a.album), `${a.id}: 空位或错误发行名`);
    check(a.approved === false && a.listening === '未做完整试听', `${a.id}: 研究初稿不可冒称复听审定`);
    if (a.coverUrl) check(https(a.coverUrl) && https(a.coverSource) && !!a.coverLicense, `${a.id}: 封面无出处或用途说明`);
  }
  tables.push({ group, cells: cells.length, artists: new Set(cells.map(a => a.primaryArtistId)).size, repeats, works: new Set(cells.map(a => a.workId)).size, covers: cells.filter(a=>a.coverUrl).length, discussion: cells.filter(a=>a.status === 'discussion').length, lowConfidence: cells.filter(a=>a.confidence === 'low').length, years: [Math.min(...cells.map(a=>+a.year)), Math.max(...cells.map(a=>+a.year))] });
}
check(all.length === 168 && new Set(all.map(a=>a.id)).size === 168, '全包必须168个唯一格位');
let manualCount = 0, nullCount = 0;
for (const row of raw.rows) row.cells.forEach((title, i) => {
  if (!title) { nullCount++; return; }
  manualCount++;
  const a = all.find(a => a.id.startsWith('china-song-') && a.dimension === raw.columns[i] && a.stars === row.stars);
  check(a && a.manualTitle === title && a.manualVersion === raw.version && a.manualLocked === true, `人工原始记录或锁丢失：${row.stars}/${raw.columns[i]}`);
});
check(manualCount === 23 && nullCount === 19, '人工原始版必须保留23项与19个空格');
for (const [name, expected] of Object.entries(checksums.files)) {
  const bytes = await readFile(resolve(root, lockDir, name));
  check(createHash('sha256').update(bytes).digest('hex') === expected, `人工归档被覆盖：${name}`);
  if (name.endsWith('.json')) check(bytes.equals(await readFile(resolve(root, 'src/data/reference-review', name))), '工作区原始转录与归档不一致');
}
check(raw.sourceImageSha256 === checksums.files[raw.sourceImage], '原图指纹不一致');
const report = { version:'reference-2026-11-02-r1', auditDate:'2026-11-02', scope:'结构、元数据完整性、重复、人工数据锁；不宣称验证艺术等级或整碟试听', passed:errors.length === 0, cells:all.length, manualCount, nullCount, sourceFiles, tables, errors, listeningReviewed:0, metadataSources:all.reduce((n,a)=>n+a.sources.length,0) };
if (process.argv.includes('--write')) await writeFile(resolve(root, 'docs/reference-review/audit.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if (errors.length) process.exitCode = 1;
