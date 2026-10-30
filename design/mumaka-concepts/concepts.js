/** Independent design sandbox. Does not import or mutate production UI / scoring code. */
const DIMENSIONS = ['作词','作曲','表演','声音','愿景','语境'];
const DESCRIPTIONS = {
  A:{title:'A / Swiss Grid',description:'无衬线网格。大标题、右上总分、硬朗横线；封面与六向扇区构成主视觉。'},
  B:{title:'B / Editorial Folio',description:'编辑书页。衬线标题、克制的黑色分数栏；封面更大，六维以径向刻度展开。'},
  C:{title:'C / Data Plate',description:'数据版式。黑色刊头、并置的封面与线性量表；总分放在下方，文字与读数分区。'},
};
const RATIO_HEIGHT = {'4:5':1350,'3:4':1440,'1:1':1080};
let activeRatio = new URLSearchParams(location.search).get('ratio') || '4:5';
if (!(activeRatio in RATIO_HEIGHT)) activeRatio = '4:5';
let currentAlbum = null;
const isolatedConcept = new URLSearchParams(location.search).get('concept')?.toUpperCase();
const isolated = ['A','B','C'].includes(isolatedConcept);
if (isolated) document.body.classList.add('isolated');
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const point = (center, radius, angle) => [center + Math.cos(angle)*radius, center + Math.sin(angle)*radius];
const pair = p => p.map(n=>n.toFixed(3)).join(' ');
const starsOf = album => Array.isArray(album.stars) ? album.stars.slice(0,6) : DIMENSIONS.map((_,i)=>album.ratings?.[i] ?? null);
const validStar = v => typeof v === 'number' && v >= .5 && v <= 5 && Number.isInteger(v*2);
const starText = v => validStar(v) ? v.toFixed(1) : v==='na'?'N/A':'—';
const scoreOf = album => typeof album.score === 'string' && /^(?:\d\.\d{2}|10\.00)$/.test(album.score) ? album.score : '—';
const svg = (viewBox, body, label) => `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)}" font-family="Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif">${body}</svg>`;
const labelRing = (center,radius,values,fontSize=21) => DIMENSIONS.map((label,i)=>{
  const angle=-Math.PI/2+i*Math.PI/3;
  const[x,y]=point(center,radius,angle);
  return `<text x="${x.toFixed(3)}" y="${(y-5).toFixed(3)}" text-anchor="middle" font-size="${fontSize}" font-weight="500">${label}</text><text x="${x.toFixed(3)}" y="${(y+19).toFixed(3)}" text-anchor="middle" font-size="16">${starText(values[i])}</text>`;
}).join('');
function chartA(values){
 const c=225,max=129;
 const sector=(radius,index)=>{
  const angle=-Math.PI/2+index*Math.PI/3,half=22*Math.PI/180;
  return `M${c} ${c} L${pair(point(c,radius,angle-half))} A${radius} ${radius} 0 0 1 ${pair(point(c,radius,angle+half))} Z`;
 };
 let body=values.map((v,i)=>`<path d="${sector(max,i)}" fill="#F3F3F1"/>${validStar(v)?`<path data-dimension="${i}" d="${sector(v/5*max,i)}" fill="#111111"/>`:''}`).join('');
 body += [1,2,3,4].map(n=>`<circle cx="${c}" cy="${c}" r="${n/5*max}" fill="none" stroke="#FFFFFF" stroke-width="1.5"/>`).join('');
 body += `<circle cx="${c}" cy="${c}" r="${max}" fill="none" stroke="#111111" stroke-width="1"/><circle cx="${c}" cy="${c}" r="8" fill="#FFFFFF"/>`;
 body += labelRing(c,185,values,22);
 return svg('0 0 450 450',body,'六维径向扇区图，长度由星级线性决定');
}
function chartB(values){
 const c=210,max=119;
 let body=[1,2,3,4,5].map(n=>`<circle cx="${c}" cy="${c}" r="${n/5*max}" fill="none" stroke="#111111" stroke-width="1"/>`).join('');
 body += values.map((v,i)=>{
   const angle=-Math.PI/2+i*Math.PI/3;
   const end=point(c,validStar(v)?v/5*max:0,angle);
   return validStar(v)?`<path data-dimension="${i}" d="M${c} ${c} L${pair(end)}" fill="none" stroke="#111111" stroke-width="13" stroke-linecap="butt"/>`:'';
 }).join('');
 body += `<circle cx="${c}" cy="${c}" r="6" fill="#FFFFFF"/>${labelRing(c,171,values,21)}`;
 return svg('0 0 420 420',body,'六维径向刻度图，读数使用同一五星尺度');
}
function chartC(values){
 let body='';
 values.forEach((value,i)=>{
  const y=i*76+10;
  body += `<text x="0" y="${y+15}" font-size="12">${String(i+1).padStart(2,'0')}</text><text x="33" y="${y+16}" font-size="21" font-weight="500">${DIMENSIONS[i]}</text><text x="430" y="${y+16}" text-anchor="end" font-size="21">${starText(value)}</text><rect x="0" y="${y+33}" width="430" height="15" fill="#F3F3F1"/>${validStar(value)?`<rect data-dimension="${i}" x="0" y="${y+33}" width="${value/5*430}" height="15" fill="#111111"/>`:''}`;
 });
 return svg('0 0 430 470',body,'六维水平量表图，每条长度线性对应零至五星');
}
const cover = album => `<img class="cover" src="${esc(album.cover)}" alt="${esc(`${album.artist}《${album.title}》正式专辑封面`)}">`;
const comment = album => `<p class="card-summary">${esc(album.summary || '')}</p>`;
const cardFooter = concept => `<footer class="card-footer"><span>MUMAKA / 木马卡</span><span class="mock-label">${concept} · 排版演示，非正式评分</span></footer>`;
function cardA(album,ratio){
 return `<article class="artboard concept-a ${album.summary?'':'is-no-summary'}" data-concept="A" data-ratio="${ratio}" aria-label="A 无衬线网格方案">
 <header class="a-masthead"><div><div class="a-wordmark">MUMAKA</div><div class="a-subbrand"><span>木马卡</span><span>新乐评主义</span></div></div><div class="a-masthead-right"><span></span><p>ALBUM REVIEW<br>NO. 001</p></div></header>
 <section class="a-heading"><div><h2>${esc(album.title)}</h2><h3>${esc(album.artist)}</h3><div class="a-release"><span class="album-year">${esc(album.year)}</span><span class="metadata-type">ALBUM</span></div></div><div class="a-score"><strong>${scoreOf(album)}</strong><span>OUT OF 10</span></div></section>
 <section class="a-visuals"><div>${cover(album)}<div class="a-caption"><span>ORIGINAL ALBUM ARTWORK</span><span>${esc(album.year)}</span></div></div><div class="chart">${chartA(starsOf(album))}</div></section>
 <section class="a-commentary"><span class="comment-label">COMMENT</span>${comment(album)}</section>${cardFooter('A')}</article>`;
}
function cardB(album,ratio){
 return `<article class="artboard concept-b ${album.summary?'':'is-no-summary'}" data-concept="B" data-ratio="${ratio}" aria-label="B 编辑书页方案">
 <header class="b-masthead"><span class="b-wordmark">MUMAKA</span><div class="b-masthead-right">木马卡<small>新乐评主义</small></div></header>
 <section class="b-heading"><div><h2>${esc(album.title)}</h2><h3>${esc(album.artist)}</h3><p class="b-release">${esc(album.year)} / Album</p></div><aside class="b-score"><strong>${scoreOf(album)}</strong><span>OUT OF 10</span></aside></section>
 <section class="b-visuals"><div>${cover(album)}<p class="b-cover-credit"><span>${esc(album.artist)} — ${esc(album.title)}</span><span>${esc(album.year)}</span></p></div><div><p class="b-chart-label">SIX DIMENSIONS</p><div class="chart">${chartB(starsOf(album))}</div></div></section>
 <section class="b-essay">${comment(album)}</section>${cardFooter('B')}</article>`;
}
function cardC(album,ratio){
 return `<article class="artboard concept-c ${album.summary?'':'is-no-summary'}" data-concept="C" data-ratio="${ratio}" aria-label="C 数据版式方案">
 <header class="c-masthead"><div class="c-wordmark">MUMAKA</div><div class="c-masthead-right">木马卡<small>新乐评主义</small></div></header>
 <section class="c-heading"><div class="c-heading-top"><span>ALBUM / 001</span><span>${esc(album.year)}</span></div><h2>${esc(album.title)}</h2><h3>${esc(album.artist)}</h3></section>
 <section class="c-visuals"><div>${cover(album)}<p class="c-cover-credit"><span>ORIGINAL ALBUM ARTWORK</span><span>${esc(album.year)}</span></p></div><div class="chart">${chartC(starsOf(album))}</div></section>
 <section class="c-bottom"><div class="c-commentary"><span class="comment-label">COMMENT</span>${comment(album)}</div><div class="c-score"><strong>${scoreOf(album)}</strong><span>OUT OF 10</span></div></section>${cardFooter('C')}</article>`;
}
const renderers={A:cardA,B:cardB,C:cardC};
function scaleCards(){
 document.querySelectorAll('.card-viewport').forEach(viewport=>{
   const card=viewport.querySelector('.artboard');
   if(!card)return;
   const scale=isolated?1:viewport.clientWidth/1080;
   card.style.transform=`scale(${scale})`;
   viewport.style.height=`${RATIO_HEIGHT[activeRatio]*scale}px`;
 });
}
/** Data is provided by the parent review task; no score calculation is recreated here. */
export function renderConcepts(album,{ratio=activeRatio,concept=isolatedConcept}={}){
 if(!album||!album.title||!album.artist||!album.cover)throw new Error('请先提供真实专辑名称、音乐人与原封面路径。');
 currentAlbum=album;activeRatio=ratio in RATIO_HEIGHT?ratio:'4:5';
 const targets=isolated&&renderers[concept]?[concept]:['A','B','C'];
 document.getElementById('gallery').innerHTML=targets.map(key=>{
  const d=DESCRIPTIONS[key];
  return `<section class="concept-comparison"><div class="concept-heading"><h2>${d.title}</h2><a href="?concept=${key}&ratio=${encodeURIComponent(activeRatio)}" target="_blank" rel="noopener">原尺寸查看 ↗</a></div><p class="concept-caption">${d.description}</p><div class="card-viewport">${renderers[key](album,activeRatio)}</div></section>`;
 }).join('');
 document.querySelectorAll('[data-ratio]').forEach(button=>{if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.ratio===activeRatio));});
 scaleCards();
 document.documentElement.dataset.rendered='true';
 return document.querySelectorAll('.artboard');
}
window.renderConcepts=renderConcepts;
window.addEventListener('resize',scaleCards);
document.querySelectorAll('.study-header button[data-ratio]').forEach(button=>button.addEventListener('click',()=>{if(currentAlbum)renderConcepts(currentAlbum,{ratio:button.dataset.ratio});}));
try{
 const reference=await fetch('./reference/album.json').then(response=>{if(!response.ok)throw new Error('专辑资料尚未提供。');return response.json();});
 let demonstration={};
 try{const response=await fetch('./reference/layout-demo.json');if(response.ok)demonstration=await response.json();}catch{/* No fabricated ratings when comparison input is absent. */}
 renderConcepts({...reference,...demonstration});
 await document.fonts.ready;
 await Promise.all([...document.querySelectorAll('.cover')].map(image=>image.decode().catch(()=>undefined)));
 document.documentElement.dataset.assetsReady='true';
}catch(error){document.getElementById('gallery').innerHTML=`<p class="loading-message">${esc(error.message)} 请保留真实资料，勿使用生成封面或虚构数据。</p>`;}
