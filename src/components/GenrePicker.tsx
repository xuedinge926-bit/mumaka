import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { genres, chinaIndex } from '../model/engine';

export const FAMILY_NAMES:Record<string,string>={pop:'流行',rock:'摇滚',punk:'朋克',metal:'金属',folk:'民谣',country:'乡村',blues:'布鲁斯',jazz:'爵士',funk:'放克',rnb:'R&B',soul:'灵魂乐',hiphop:'说唱 / 嘻哈',electronic:'电子',african_pop:'非洲流行',disco:'迪斯科',industrial:'工业',ambient:'氛围',reggae:'雷鬼',experimental:'实验',caribbean:'加勒比',latin:'拉丁',brazil:'巴西',mexican:'墨西哥',mena:'中东与北非',african_roots:'非洲根源',gospel:'福音',western_art:'西方艺术音乐',south_asian:'南亚',east_asian:'东亚传统',southeast_asian:'东南亚',european_roots:'欧洲根源',new_age:'新世纪',north_america_roots:'北美根源',oceania_pacific:'大洋洲与太平洋'};
interface Props {value:string;indexEntryId?:string;market?:'china'|'global';onChange:(genreId:string,indexEntryId?:string)=>void;disabled?:boolean;compact?:boolean;label?:string}

export function GenrePicker({value,indexEntryId='',market='china',onChange,disabled=false,compact=false,label='专辑风格'}:Props) {
 const selected=genres.find(g=>g.id===value);
 const [family,setFamily]=useState(selected?.parentId||'');
 const [open,setOpen]=useState<'family'|'secondary'|'global'|null>(null);
 const [familyQuery,setFamilyQuery]=useState('');
 const [secondaryQuery,setSecondaryQuery]=useState('');
 const [globalQuery,setGlobalQuery]=useState('');
 const selectedParent=selected?.parentId||family;
 const ranks=useMemo(()=>new Map(chinaIndex.map((entry,index)=>[entry.genreId,index])),[]);
 const families=useMemo(()=>Array.from(new Set(genres.map(g=>g.parentId||''))).filter(Boolean).sort((a,b)=>{
   if(market==='china'){const rank=(p:string)=>Math.min(...genres.filter(g=>g.parentId===p).map(g=>ranks.get(g.id)??999));return rank(a)-rank(b)||FAMILY_NAMES[a].localeCompare(FAMILY_NAMES[b],'zh-CN');}
   return FAMILY_NAMES[a].localeCompare(FAMILY_NAMES[b],'zh-CN');
 }),[market,ranks]);
 const aliases=(id:string)=>chinaIndex.filter(entry=>entry.genreId===id).map(e=>e.name).join(' ');
 const matches=(g:typeof genres[number],query:string)=>`${g.name} ${g.nameEn} ${aliases(g.id)}`.toLowerCase().includes(query.trim().toLowerCase());
 const sorted=(list:(typeof genres[number])[])=>list.sort((a,b)=>(market==='china'?(ranks.get(a.id)??999)-(ranks.get(b.id)??999):0)||a.name.localeCompare(b.name,'zh-CN'));
 const options=sorted(genres.filter(g=>g.parentId===selectedParent&&matches(g,secondaryQuery)));
 const globalOptions=globalQuery.trim()?sorted(genres.filter(g=>matches(g,globalQuery))):[];
 const choose=(id:string,query='')=>{
   const match=genres.find(g=>g.id===id);
   const entry=query.trim()?chinaIndex.find(i=>i.genreId===id&&i.name.includes(query.trim())):undefined;
   onChange(id,entry?.id||'');setFamily(match?.parentId||'');setOpen(null);setSecondaryQuery('');setGlobalQuery('');
 };
 const name=indexEntryId?chinaIndex.find(e=>e.id===indexEntryId)?.name||selected?.name:selected?.name;
 return <div className={`genre-picker ${compact?'compact':''}`}>
   <div className="genre-picker-pair">
    <div className="genre-field"><span>{compact?'一级':'一级风格'}</span><button type="button" className={`choice-trigger ${open==='family'?'expanded':''}`} disabled={disabled} aria-label={`${label}一级风格`} aria-expanded={open==='family'} onClick={()=>{setOpen(open==='family'?null:'family');setFamilyQuery('');}}>{selectedParent?FAMILY_NAMES[selectedParent]||selectedParent:'选择一级风格'}<ChevronDown size={15}/></button>
     {open==='family'&&<div className="choice-popover"><div className="mini-search"><Search size={15}/><input autoFocus aria-label={`${label}搜索一级风格`} placeholder="搜索一级风格" value={familyQuery} onChange={e=>setFamilyQuery(e.target.value)}/><button aria-label="关闭风格列表" onClick={()=>setOpen(null)}><X size={13}/></button></div><div className="choice-options">{families.filter(p=>`${FAMILY_NAMES[p]} ${p}`.toLowerCase().includes(familyQuery.toLowerCase())).map(parent=><button key={parent} type="button" onClick={()=>{setFamily(parent);if(selected?.parentId!==parent)onChange('','');setOpen('secondary');setSecondaryQuery('');}}><span>{FAMILY_NAMES[parent]||parent}</span>{selectedParent===parent&&<Check size={15}/>}</button>)}</div></div>}
    </div>
    <div className="genre-field"><span>{compact?'二级':'二级风格'}</span><button type="button" className={`choice-trigger ${open==='secondary'?'expanded':''}`} disabled={disabled||!selectedParent} aria-label={`${label}二级风格`} aria-expanded={open==='secondary'} onClick={()=>{setOpen(open==='secondary'?null:'secondary');setSecondaryQuery('');}}>{name||'选择细分风格'}<ChevronDown size={15}/></button>
     {open==='secondary'&&<div className="choice-popover"><div className="mini-search"><Search size={15}/><input autoFocus aria-label={`${label}搜索二级风格`} placeholder="在当前一级内搜索" value={secondaryQuery} onChange={e=>setSecondaryQuery(e.target.value)}/><button aria-label="关闭风格列表" onClick={()=>setOpen(null)}><X size={13}/></button></div><div className="choice-options">{options.map(g=><button type="button" key={g.id} onClick={()=>choose(g.id,secondaryQuery)}><span>{g.name}<small>{g.nameEn}</small></span>{value===g.id&&<Check size={15}/>}</button>)}{!options.length&&<p className="choice-empty">没有匹配风格</p>}</div></div>}
    </div>
   </div>
   {!compact&&<button type="button" className="quiet-link global-genre-search" disabled={disabled} onClick={()=>{setOpen(open==='global'?null:'global');setGlobalQuery('');}}><Search size={13}/>直接搜索细分风格</button>}
   {open==='global'&&<div className="global-choice"><div className="mini-search"><Search size={16}/><input autoFocus aria-label={`${label}搜索全部风格`} placeholder="输入中文、英文或风格别名" value={globalQuery} onChange={e=>setGlobalQuery(e.target.value)}/><button aria-label="关闭全局风格搜索" onClick={()=>setOpen(null)}><X size={14}/></button></div>{!!globalQuery.trim()&&<div className="choice-options">{globalOptions.slice(0,30).map(g=><button key={g.id} onClick={()=>choose(g.id,globalQuery)}><span>{g.name}<small>{g.nameEn}</small></span><small>{FAMILY_NAMES[g.parentId||'']}</small></button>)}{!globalOptions.length&&<p className="choice-empty">没有匹配风格</p>}</div>}</div>}
 </div>;
}
export default GenrePicker;
