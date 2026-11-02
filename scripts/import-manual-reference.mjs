/** Import a checked transcription together with the untouched screenshot. No OCR claims. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [transcription, image] = process.argv.slice(2);
if (!transcription || !image) throw new Error('用法：node scripts/import-manual-reference.mjs 已人工核对的转录.json 原始截图.png');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(await readFile(transcription, 'utf8'));
const png = await readFile(image);
if (!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.length > 20_000_000) throw new Error('需要20MB以内的原始PNG截图');
if (!/^manual-\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)?$/.test(raw.version) || raw.group !== 'china-song' || JSON.stringify(raw.columns) !== JSON.stringify(['歌词','作曲','表演','制作','愿景','语境'])) throw new Error('人工版本、分类或六维表头无效');
if (!Array.isArray(raw.rows) || raw.rows.length !== 7 || raw.rows.map(r=>r.stars).sort((a,b)=>a-b).join(',') !== '2,2.5,3,3.5,4,4.5,5' || raw.rows.some(r=>!Array.isArray(r.cells)||r.cells.length!==6||r.cells.some(v=>v!==null&&(typeof v!=='string'||!v.trim())))) throw new Error('转录需完整保留七档×六维，原始空格必须为null');
const sha = b => createHash('sha256').update(b).digest('hex');
const name = `${raw.version}.json`;
const bytes = Buffer.from(JSON.stringify({...raw, schemaVersion:1, sourceImage:basename(image), sourceImageSha256:sha(png), locked:true, emptyCellsRemainNull:true},null,2)+'\n');
const archive = resolve(root, 'docs/reference-review/manual', raw.version.replace(/^manual-/,''));
// Exclusive directory/file creation: an existing manual version can never be overwritten.
await mkdir(archive);
await writeFile(resolve(archive,basename(image)),png,{flag:'wx'});
await writeFile(resolve(archive,name),bytes,{flag:'wx'});
await writeFile(resolve(archive,'checksums.json'),JSON.stringify({algorithm:'sha256',files:{[name]:sha(bytes),[basename(image)]:sha(png)}},null,2)+'\n',{flag:'wx'});
await writeFile(resolve(root,'src/data/reference-review',name),bytes,{flag:'wx'});
console.log(`已归档独立人工版本 ${raw.version}；未覆盖现有候选。下一步先审查差异，再显式接入选片层。`);
