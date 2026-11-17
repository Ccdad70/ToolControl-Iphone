import http from 'node:http';
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
async function query(path,params={}){
 const today=new Date().toISOString().slice(0,10);if(today!==date){date=today;spent=0;}
 if(!KEY)throw {status:503,error:'missing_key',message:'Falta configurar WATCHMODE_API_KEY en Render'};
 if(spent+inflight>=CAP)throw {status:429,error:'daily_budget',message:'Límite preventivo de consultas alcanzado. El catálogo guardado seguirá disponible.'};
 const url=new URL('https://api.watchmode.com/v1'+path+'/');
 for(const [key,val] of Object.entries(params))url.searchParams.set(key,String(val));
 inflight++;
 try{
  const r=await fetch(url,{headers:{'X-API-Key':KEY,'Accept':'application/json'},signal:AbortSignal.timeout(12000)});
  spent++;
  if(!r.ok){const error=r.status===401||r.status===403?'invalid_key':r.status===429?'provider_quota':'watchmode_error';const safeMessage=String(await r.text()).slice(0,240).replaceAll(KEY,'[hidden]');console.error('Watchmode provider response HTTP='+r.status+' endpoint='+path+' details='+safeMessage);throw {status:r.status===429?429:502,error,message:'Watchmode no pudo completar la consulta (HTTP '+r.status+')'};}
  return r.json();
 }finally{inflight--;}
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
async function decorate(rows,kind){
 const items=rows.slice(0,24).map(x=>({id:String(x.id),title:String(x.title).slice(0,130),year:String(x.year||''),rank:0,image:null,overview:'',imageProvider:null,tmdbId:String(x.tmdb_id||'')}));
 if(!TMDB_KEY)return items;
 for(let i=0;i<items.length;i+=3){
  await Promise.all(items.slice(i,i+3).map(async it=>{
   try{
    const m=await tmdbTitle(it.tmdbId,kind);
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
  return {titles:decorated,kind,section:sort,page,totalPages:Math.min(300,Math.max(1,...ok.map(x=>Number(x.data?.total_pages)||1))),totalResults:ok.reduce((n,x)=>n+(Number(x.data?.total_results)||0),0),regions:ok.map(x=>x.region),rankingMetric:sort==='popular'?'Watchmode combined popularity ranking (not views)':'Original release date and country order',partialPosters:decorated.some(x=>!x.image),postersConfigured:Boolean(TMDB_KEY)};
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
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type'});res.end();return;}
 if(req.method!=='GET'){send(res,405,{error:'method_not_allowed'});return;}
 const url=new URL(req.url||'/','http://localhost');
 if(url.pathname==='/health'){send(res,200,{ok:true,configured:Boolean(KEY),countries:['US','CO'],mode:'combined',posters:TMDB_KEY?'TMDB':'illustrative-placeholder'});return;}
 if(req.headers.origin!==ORIGIN){send(res,403,{error:'origin_not_allowed'});return;}
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
server.listen(PORT,'0.0.0.0',()=>console.log('NÉVIX catalog ready; configured='+Boolean(KEY)+'; mode=combined; tmdb_posters='+Boolean(TMDB_KEY)));

async function checkCatalogHealth(){
 if(!KEY)return;
 // Two small validations per media type, one country per Watchmode request.
 for(const [kind,type] of [['movie','movie'],['series','tv_series']]){
  const results=await Promise.allSettled(['US','CO'].map(regions=>query('/list-titles',{types:type,regions,source_ids:'203',source_types:'sub',sort_by:'popularity_desc',page:1,limit:1})));
  results.forEach((x,i)=>{
   const country=['US','CO'][i];
   const titles=x.status==='fulfilled'&&Array.isArray(x.value?.titles)?x.value.titles.length:0;
   const reason=x.status==='rejected'?String(x.reason?.error||x.reason?.name||'unknown'):'none';
   console.log('Watchmode health check: type='+kind+' region='+country+' status='+(x.status==='fulfilled'?'ok':'error')+' titles='+titles+' reason='+reason);
  });
 }
}
void checkCatalogHealth();
