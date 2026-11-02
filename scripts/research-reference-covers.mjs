/** Collect official public store metadata for review; never assigns stars or changes a selection. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = ['china-song','china-instrumental','global-song','global-instrumental'];
const groups = process.env.REFERENCE_RESEARCH_GROUPS?.split(',') || allowed;
if (groups.some(group => !allowed.includes(group))) throw new Error('Unknown reference group');
const albums = (await Promise.all(groups.map(async group => JSON.parse(await readFile(resolve(root,`src/data/reference-review/${group}.json`),'utf8'))))).flat();
const result = [];
let cursor = 0;
let stopped = false;
async function worker() {
  while (!stopped && cursor < albums.length) {
    const a = albums[cursor++];
    if (a.coverUrl) continue;
    const country = a.id.startsWith('china-') ? 'hk' : 'us';
    const query = new URL('https://itunes.apple.com/search');
    query.search = new URLSearchParams({ term:`${a.artist} ${a.album}`, entity:'album',country,limit:'8' }).toString();
    try {
      const response = await fetch(query,{ signal:AbortSignal.timeout(15000) });
      if (!response.ok) {
        // Respect provider refusal/rate limits; a later manual run may resume.
        if ([403,429].includes(response.status)) stopped = true;
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      result.push({ id:a.id, expected:{album:a.album,artist:a.artist,year:a.year,edition:a.edition}, query:String(query), results:(data.results || []).map(x=>Object.fromEntries(['collectionId','collectionName','artistName','releaseDate','trackCount','collectionViewUrl','artworkUrl100'].map(k=>[k,x[k]]))) });
    } catch (error) { result.push({id:a.id,query:String(query),error:String(error)}); }
    // Apple documents approximately 20 calls/minute; use one request at a time.
    if (!stopped) await new Promise(r=>setTimeout(r,3500));
  }
}
await worker();
const directory = resolve(root,'test-results/reference-research');
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'apple-cover-candidates.json'),JSON.stringify({version:'reference-2026-11-02-r1',purpose:'仅供逐条核对的发行元数据，不自动采用搜索首图',results:result.sort((a,b)=>a.id.localeCompare(b.id))},null,2)+'\n');
// Public catalogue metadata is also readable without downloading a ZIP artifact.
for (const candidate of result) console.log(`REFERENCE_COVER_CANDIDATE ${JSON.stringify(candidate)}`);
console.log(`官方封面候选：${result.filter(r=>r.results?.length).length}/${result.length}有目录返回；没有改变任何作品、星级或人工数据。`);
