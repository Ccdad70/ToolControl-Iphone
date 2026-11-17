import http from 'node:http';
const PORT=Number(process.env.PORT||10000);
const KEY=String(process.env.WATCHMODE_API_KEY||'').trim();
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
  if(!r.ok){const error=r.status===401||r.status===403?'invalid_key':r.status===429?'provider_quota':'watchmode_error';throw {status:r.status===429?429:502,error,message:'Watchmode no pudo completar la consulta (HTTP '+r.status+')'};}
  return r.json();
 }finally{inflight--;}
}
const isWebPoster=x=>typeof x==='string'&&/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(x)&&x.length<600;
async function details(id){return single('details:'+id,()=>query('/title/'+id+'/details'));}
async function decorate(rows){
 // list-titles does not return poster URLs. Fetch title details in small groups to preserve API credits.
 const items=rows.slice(0,12).map(x=>({id:String(x.id),title:String(x.title).slice(0,130),year:String(x.year||''),rank:0,image:null,overview:''}));
 for(let i=0;i<items.length;i+=3){
  await Promise.all(items.slice(i,i+3).map(async it=>{
   try{const d=await details(it.id);const poster=[d?.poster,d?.poster_large].find(isWebPoster);it.image=poster||null;it.overview=String(d?.plot_overview||'').slice(0,350);}
   catch(e){it.image=null;it.overview='';}
  }));
 }
 return items;
}
async function movies(sort,page){
 const cacheKey='movies:'+sort+':'+page;
 return single(cacheKey,async()=>{
  const today=Number(new Date().toISOString().slice(0,10).replaceAll('-',''));
  const opts={types:'movie',regions:'US,CO',source_ids:'203',source_types:'sub',sort_by:sort==='recent'?'release_date_desc':'popularity_desc',page,limit:12};
  if(sort==='recent'){opts.release_date_start=20250101;opts.release_date_end=today;}
  const data=await query('/list-titles',opts);
  const rows=(Array.isArray(data?.titles)?data.titles:[]).filter(x=>x&&x.id&&x.title&&x.type==='movie');
  const decorated=await decorate(rows);
  decorated.forEach((it,i)=>it.rank=(page-1)*12+i+1);
  return {titles:decorated,section:sort,page,totalPages:Math.min(300,Math.max(1,Number(data?.total_pages)||1)),totalResults:Number(data?.total_results)||0,regions:['US','CO'],rankingMetric:sort==='popular'?'Watchmode popularity (not actual views)':'Movie original release date',partialPosters:decorated.some(x=>!x.image)};
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
 if(url.pathname==='/health'){send(res,200,{ok:true,configured:Boolean(KEY),countries:['US','CO'],mode:'combined',posters:'watchmode-details'});return;}
 if(req.headers.origin!==ORIGIN){send(res,403,{error:'origin_not_allowed'});return;}
 try{
  if(url.pathname==='/api/movies'){
   const page=Number(url.searchParams.get('page')||1);
   const section=String(url.searchParams.get('section')||'popular');
   if(!Number.isInteger(page)||page<1||page>300||!['popular','recent'].includes(section)){send(res,400,{error:'invalid_query'});return;}
   send(res,200,await movies(section,page));return;
  }
  const match=url.pathname.match(/^\/api\/movie\/([0-9]{1,12})$/);
  if(match){send(res,200,await movieLink(match[1]));return;}
  send(res,404,{error:'not_found'});
 }catch(e){send(res,e.status||502,{error:e.error||'unavailable',message:e.message||'No se pudo consultar el catálogo'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log('NÉVIX catalog ready; configured='+Boolean(KEY)+'; mode=combined; posters=details'));