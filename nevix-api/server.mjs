import http from 'node:http';
import { createPrivateFilmService } from './private-films.mjs';
const PORT=Number(process.env.PORT||10000);
const KEY=String(process.env.WATCHMODE_API_KEY||'').trim();
const TMDB_KEY=String(process.env.TMDB_API_KEY||'').trim();
const ORIGIN='https://nevix-tv-personal.onrender.com';
const memo=new Map(), pending=new Map();
let date=new Date().toISOString().slice(0,10),spent=0,inflight=0;
const CAP=62;
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':ORIGIN,'vary':'Origin','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
const get=(k)=>{const e=memo.get(k);if(e&&e.until>Date.now())return e.value;memo.delete(k);return undefined;};
function save(k,val,ttl=86400000){if(memo.size>500){for(const key of memo.keys()){memo.delete(key);if(memo.size<350)break;}}memo.set(k,{value:val,until:Date.now()+ttl});return val;}
async function single(k,fn){const hit=get(k);if(hit!==undefined)return hit;if(pending.has(k))return pending.get(k);const task=Promise.resolve().then(fn).then(val=>save(k,val,k.startsWith('details:')?3*86400000:12*3600000)).finally(()=>pending.delete(k));pending.set(k,task);return task;}
// Watchmode may return HTTP 429 when list-titles requests overlap on free keys.
// Serialize outbound requests and space them apart; do not expose the key.
let providerQueue=Promise.resolve(),lastProviderStart=0;
function serializedProviderRequest(fn){
 const work=providerQueue.then(async()=>{
  const delay=Math.max(0,1300-(Date.now()-lastProviderStart));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  lastProviderStart=Date.now();
  return fn();
 });
 providerQueue=work.then(()=>undefined,()=>undefined);
 return work;
}
async function query(path,params={}){
 return serializedProviderRequest(async()=>{
  const today=new Date().toISOString().slice(0,10);if(today!==date){date=today;spent=0;}
  if(!KEY)throw {status:503,error:'missing_key',message:'Falta configurar WATCHMODE_API_KEY en Render'};
  if(spent>=CAP)throw {status:429,error:'daily_budget',message:'Límite preventivo de consultas alcanzado. El catálogo guardado seguirá disponible.'};
  const url=new URL('https://api.watchmode.com/v1'+path+'/');
  for(const [key,val] of Object.entries(params))url.searchParams.set(key,String(val));
  inflight++;
  try{
   for(let attempt=0;attempt<3;attempt++){
    if(spent>=CAP)throw {status:429,error:'daily_budget',message:'Límite preventivo de consultas alcanzado.'};
    const response=await fetch(url,{headers:{'X-API-Key':KEY,'Accept':'application/json'},signal:AbortSignal.timeout(12000)});
    spent++;
    if(response.status===429&&attempt<2){
     await new Promise(resolve=>setTimeout(resolve,(attempt+1)*2200));
     continue;
    }
    if(!response.ok){
     const error=response.status===401||response.status===403?'invalid_key':response.status===429?'provider_quota':'watchmode_error';
     const safe=String(await response.text()).slice(0,240).replaceAll(KEY,'[hidden]');
     console.error('Watchmode provider response HTTP='+response.status+' endpoint='+path+' details='+safe);
     throw {status:response.status===429?429:502,error,message:'Watchmode no pudo completar la consulta (HTTP '+response.status+')'};
    }
    return response.json();
   }
  }finally{inflight--;}
 });
}

async function tmdbTitle(id,kind){
 if(!TMDB_KEY||!/^\d{1,12}$/.test(String(id||'')))return null;
 const type=kind==='series'?'tv':'movie';
 return single('tmdb:'+type+':'+id,async()=>{
  const url=new URL('https://api.themoviedb.org/3/'+type+'/'+id);
  url.searchParams.set('language','es-ES');
  const isToken=TMDB_KEY.startsWith('eyJ')&&TMDB_KEY.length>100;
  if(!isToken)url.searchParams.set('api_key',TMDB_KEY);
  const response=await fetch(url,{headers:isToken?{Authorization:'Bearer '+TMDB_KEY}:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)return null;
  const value=await response.json();
  const poster=String(value.poster_path||'');
  return {image:/^\/[a-zA-Z0-9_.-]+\.(?:jpg|png|webp)$/.test(poster)?'https://image.tmdb.org/t/p/w500'+poster:null,overview:String(value.overview||'').slice(0,350)};
 });
}

const cleanFilmTitle=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g,' ').trim();
// Fallback real de TMDB cuando el catálogo no incluye identificador TMDB.
async function tmdbSearchPoster(title,year,kind){
 if(!TMDB_KEY||!title)return null;
 const type=kind==='series'?'tv':'movie';
 return single('tmdbFind:'+type+':'+title+':'+year,async()=>{
  const u=new URL('https://api.themoviedb.org/3/search/'+type);
  u.searchParams.set('language','en-US');
  u.searchParams.set('query',String(title));
  u.searchParams.set('include_adult','false');
  const expectedYear=Number(year)||0;
  if(expectedYear>1900&&expectedYear<2100)u.searchParams.set(type==='tv'?'first_air_date_year':'year',String(expectedYear));
  const token=TMDB_KEY.startsWith('eyJ')&&TMDB_KEY.length>100;
  if(!token)u.searchParams.set('api_key',TMDB_KEY);
  const response=await fetch(u,{headers:token?{Authorization:'Bearer '+TMDB_KEY}:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  const data=await response.json();
  const desired=cleanFilmTitle(title);
  const found=(Array.isArray(data.results)?data.results:[]).find(x=>{
   const poster=String(x?.poster_path||'');
   const names=[x?.title,x?.original_title,x?.name,x?.original_name].map(cleanFilmTitle);
   const date=String(x?.release_date||x?.first_air_date||'');
   const yr=Number(date.slice(0,4))||0;
   return /^\/[A-Za-z0-9_.-]+\.(?:jpg|png|webp)$/.test(poster)&&names.includes(desired)&&(!expectedYear||!yr||Math.abs(yr-expectedYear)<=1);
  });
  return found?{image:'https://image.tmdb.org/t/p/w500'+found.poster_path,overview:String(found.overview||'').slice(0,350)}:null;
 });
}
async function decorate(rows,kind){
 const items=rows.slice(0,24).map(x=>({id:String(x.id),title:String(x.title).slice(0,130),year:String(x.year||''),rank:0,image:null,overview:'',imageProvider:null,tmdbId:String(x.tmdb_id||'')}));
 if(!TMDB_KEY)return items;
 for(let i=0;i<items.length;i+=3){
  await Promise.all(items.slice(i,i+3).map(async it=>{
   try{
    let m=await tmdbTitle(it.tmdbId,kind);
    if(!m?.image)m=await tmdbSearchPoster(it.title,it.year,kind)||m;
    if(m){it.image=m.image||null;it.overview=m.overview||'';it.imageProvider=m.image?'TMDB':null;}
   }catch{}
  }));
 }
 return items;
}

async function catalog(kind,sort,page){
 const cacheKey='catalog:'+kind+':'+sort+':'+page;
 return single(cacheKey,async()=>{
  const today=Number(new Date().toISOString().slice(0,10).replaceAll('-',''));
  const watchmodeType=kind==='series'?'tv_series':'movie';
  const common={types:watchmodeType,source_ids:'203',source_types:'sub',sort_by:sort==='recent'?'release_date_desc':'popularity_desc',page,limit:12};
  if(sort==='recent'){common.release_date_start=kind==='series'?20230101:20250101;common.release_date_end=today;}
  // Filtering a streaming source requires one region per Watchmode request.
  const attempts=await Promise.allSettled(['US','CO'].map(regions=>query('/list-titles',{...common,regions})));
  const ok=attempts.map((r,i)=>r.status==='fulfilled'?{region:['US','CO'][i],data:r.value}:null).filter(Boolean);
  if(!ok.length)throw attempts[0].reason;
  if(ok.length<2)console.warn('Watchmode catalog partial: '+kind+' '+ok.map(x=>x.region).join(','));
  const merged=new Map();
  for(const {region,data} of ok){
   const entries=(Array.isArray(data?.titles)?data.titles:[]).filter(x=>x&&x.id&&x.title&&(kind==='series'?['tv_series','tv_miniseries'].includes(x.type):x.type==='movie'));
   for(let i=0;i<entries.length;i++){
    const x=entries[i],id=String(x.id);
    const old=merged.get(id)||{...x,regions:[],position:i,score:0};
    old.regions.push(region);
    old.position=Math.min(old.position,i);
    old.score+=12-i;
    merged.set(id,old);
   }
  }
  const ordered=[...merged.values()].sort((a,b)=>sort==='recent'
   ?(Number(b.year)||0)-(Number(a.year)||0)||a.position-b.position||b.score-a.score
   :b.score-a.score||a.position-b.position||(Number(b.year)||0)-(Number(a.year)||0));
  const decorated=await decorate(ordered,kind);
  decorated.forEach((it,i)=>{it.rank=(page-1)*24+i+1;it.regions=merged.get(it.id)?.regions||[];});
  return {titles:decorated,kind,section:sort,page,totalPages:Math.min(300,Math.max(1,...ok.map(x=>Number(x.data?.total_pages)||1))),totalResults:ok.reduce((n,x)=>n+(Number(x.data?.total_results)||0),0),regions:ok.map(x=>x.region),rankingMetric:sort==='popular'?'Watchmode combined popularity ranking (not views)':'Original release date and country order',partialPosters:decorated.some(x=>!x.image),posterCount:decorated.filter(x=>x.image).length,missingPosterCount:decorated.filter(x=>!x.image).length,postersConfigured:Boolean(TMDB_KEY)};
 });
}
async function movieLink(id){
 return single('movieLink:'+id,async()=>{
  const list=await query('/title/'+id+'/sources',{regions:'US,CO'});
  const sources=Array.isArray(list)?list:[];
  const valid=x=>x&&['US','CO'].includes(String(x.region||'').toUpperCase())&&(Number(x.source_id)===203||String(x.name||'').toLowerCase()==='netflix')&&x.type==='sub'&&/^https:\/\/([a-z0-9-]+\.)?netflix\.com\//i.test(String(x.web_url||''));
  const source=sources.filter(valid).sort((a,b)=>String(a.region)==='US'?-1:String(b.region)==='US'?1:0)[0];
  return {id,webUrl:source?.web_url||null,region:source?.region||null};
 });
}
const privateFilms=createPrivateFilmService({send,tmdbTitle,tmdbSearchPoster,origin:ORIGIN});
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){
  if(req.headers.origin&&req.headers.origin!==ORIGIN){send(res,403,{error:'origin_not_allowed'});return;}
  res.writeHead(204,{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, X-Nevix-Access-Code, X-Nevix-Admin-Key','access-control-max-age':'600'});res.end();return;
 }
 const url=new URL(req.url||'/','http://localhost');
 if(url.pathname==='/health'&&req.method==='GET'){send(res,200,{ok:true,configured:Boolean(KEY),countries:['US','CO'],mode:'combined',posters:TMDB_KEY?'TMDB':'illustrative-placeholder',privateStorage:privateFilms.configured});return;}
 // Native <video> requests normally omit Origin; require a valid short-lived
 // signed media token inside privateFilms.handle instead. Do not relax CORS for
 // catalog, administration, uploads, or requests coming from another origin.
 const videoTokenRequest=url.pathname==='/api/private/video'&&(req.method==='GET'||req.method==='HEAD');
 if(req.headers.origin!==ORIGIN&&!(videoTokenRequest&&!req.headers.origin)){send(res,403,{error:'origin_not_allowed'});return;}
 if(url.pathname.startsWith('/api/private/')){await privateFilms.handle(req,res,url);return;}
 if(req.method!=='GET'){send(res,405,{error:'method_not_allowed'});return;}
 try{
  if(url.pathname==='/api/movies'||url.pathname==='/api/series'){
   const page=Number(url.searchParams.get('page')||1);
   const section=String(url.searchParams.get('section')||'popular');
   if(!Number.isInteger(page)||page<1||page>300||!['popular','recent'].includes(section)){send(res,400,{error:'invalid_query'});return;}
   send(res,200,await catalog(url.pathname==='/api/series'?'series':'movie',section,page));return;
  }
  const match=url.pathname.match(/^\/api\/movie\/([0-9]{1,12})$/);
  if(match){send(res,200,await movieLink(match[1]));return;}
  send(res,404,{error:'not_found'});
 }catch(e){send(res,e.status||502,{error:e.error||'unavailable',message:e.message||'No se pudo consultar el catálogo'});}
});
server.listen(PORT,'0.0.0.0',()=>{
 console.log('NÉVIX catalog ready; configured='+Boolean(KEY)+'; mode=combined; tmdb_posters='+Boolean(TMDB_KEY));
 void privateFilms.checkConnection().then(result=>{
  console.log('NÉVIX Cloudflare R2 storage probe: configured='+privateFilms.configured+' connected='+result.ok+' reason='+result.reason+(result.issues?.length?' invalid_fields='+result.issues.join(',') : ''));
 }).catch(()=>console.log('NÉVIX Telnyx storage probe: configured='+privateFilms.configured+' connected=false reason=probe_failed'));
});

async function checkCatalogHealth(){
 if(!KEY)return;
 for(const [kind,type] of [['movie','movie'],['series','tv_series']]){
  // Comprobar varias entradas reales de cada país y sus imágenes. Nunca registrar claves.
  const results=await Promise.allSettled(['US','CO'].map(regions=>query('/list-titles',{types:type,regions,source_ids:'203',source_types:'sub',sort_by:'popularity_desc',page:1,limit:6})));
  for(let i=0;i<results.length;i++){
   const x=results[i],country=['US','CO'][i];
   const titles=x.status==='fulfilled'&&Array.isArray(x.value?.titles)?x.value.titles:[];
   const reason=x.status==='rejected'?String(x.reason?.error||x.reason?.name||'unknown'):'none';
   console.log('Watchmode health check: type='+kind+' region='+country+' status='+(x.status==='fulfilled'?'ok':'error')+' titles='+titles.length+' reason='+reason);
   if(country==='US'&&TMDB_KEY&&titles.length){
    let checked=0,posters=0,missing=0;
    for(const t of titles.slice(0,4)){
     checked++;
     let m=null;
     try{
      if(/^\d{1,12}$/.test(String(t.tmdb_id||'')))m=await tmdbTitle(String(t.tmdb_id),kind);
      if(!m?.image)m=await tmdbSearchPoster(String(t.title||''),String(t.year||''),kind)||m;
     }catch(_){}
     if(m?.image)posters++;else missing++;
    }
    console.log('NÉVIX poster QA: kind='+kind+' checked='+checked+' real_posters='+posters+' missing='+missing);
   }
  }
 }
}
void checkCatalogHealth();
