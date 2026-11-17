import http from 'node:http';
const PORT=Number(process.env.PORT||10000);
const KEY=String(process.env.WATCHMODE_API_KEY||'').trim();
const ORIGIN='https://nevix-tv-personal.onrender.com';
const memo=new Map();let date=new Date().toISOString().slice(0,10),spent=0,inflight=0;
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':ORIGIN,'vary':'Origin','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
function cached(key){const e=memo.get(key);if(e&&e.until>Date.now())return e.value;memo.delete(key);return null;}
function remember(key,value,ttl=86400000){if(memo.size>600){for(const k of memo.keys()){memo.delete(k);if(memo.size<400)break;}}memo.set(key,{until:Date.now()+ttl,value});return value;}
async function query(path,params={}){
 const today=new Date().toISOString().slice(0,10);if(today!==date){date=today;spent=0;}
 if(!KEY)throw {status:503,error:'missing_key',message:'Falta configurar WATCHMODE_API_KEY en Render'};
 if(spent+inflight>=70)throw {status:429,error:'daily_budget',message:'Presupuesto diario de consultas agotado'};
 const url=new URL('https://api.watchmode.com/v1'+path+'/');
 for(const [name,value] of Object.entries(params))url.searchParams.set(name,String(value));
 inflight++;
 try{
  const r=await fetch(url,{headers:{'X-API-Key':KEY,'Accept':'application/json'},signal:AbortSignal.timeout(12000)});
  spent++;
  if(!r.ok)throw {status:r.status===429?429:502,error:r.status===401||r.status===403?'invalid_key':'watchmode_error',message:'El proveedor rechazó la consulta'};
  return await r.json();
 }finally{inflight--;}
}
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type'});res.end();return;}
 if(req.method!=='GET'){send(res,405,{error:'method_not_allowed'});return;}
 const url=new URL(req.url||'/', 'http://localhost');
 if(url.pathname==='/health'){send(res,200,{ok:true,configured:Boolean(KEY),countries:['US','CO']});return;}
 // Browser calls from NÉVIX always carry Origin. A public server cannot reliably authenticate a browser.
 if(req.headers.origin!==ORIGIN){send(res,403,{error:'origin_not_allowed'});return;}
 const region=String(url.searchParams.get('region')||'US').toUpperCase();
 if(region!=='US'&&region!=='CO'){send(res,400,{error:'invalid_region'});return;}
 try{
  if(url.pathname==='/api/movies'){
   const page=Number(url.searchParams.get('page')||1);
   if(!Number.isInteger(page)||page<1||page>300){send(res,400,{error:'invalid_page'});return;}
   const key='movies-'+region+'-'+page;let data=cached(key);
   if(!data){
    const r=await query('/list-titles',{types:'movie',regions:region,source_ids:'203',source_types:'sub',sort_by:'popularity_desc',page,limit:250});
    data=remember(key,{titles:(Array.isArray(r.titles)?r.titles:[]).filter(x=>x&&x.id&&x.title&&x.type==='movie').map(x=>({id:x.id,title:String(x.title).slice(0,150),year:x.year||'',region})),page,totalPages:Math.min(300,Math.max(1,Number(r.total_pages)||1)),totalResults:Number(r.total_results)||0,region});
   }
   send(res,200,data);return;
  }
  const match=url.pathname.match(/^\/api\/movie\/([0-9]{1,12})$/);
  if(match){
   const id=match[1],key='link-'+region+'-'+id;let data=cached(key);
   if(!data){
    const [sources,details]=await Promise.all([query('/title/'+id+'/sources',{regions:region}),query('/title/'+id+'/details')]);
    const source=(Array.isArray(sources)?sources:[]).find(x=>x&&String(x.region).toUpperCase()===region&&(Number(x.source_id)===203||String(x.name).toLowerCase()==='netflix')&&x.type==='sub'&&typeof x.web_url==='string'&&/^https:\/\/([a-z0-9-]+\.)?netflix\.com\//i.test(x.web_url));
    data=remember(key,{id,title:String(details?.title||'Película'),poster:/^https:\/\//.test(details?.poster||'')?details.poster:null,overview:String(details?.plot_overview||'').slice(0,1000),webUrl:source?.web_url||null,region},43200000);
   }
   send(res,200,data);return;
  }
  send(res,404,{error:'not_found'});
 }catch(e){send(res,e.status||502,{error:e.error||'unavailable',message:e.message||'No se pudo consultar el catálogo'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log('NÉVIX catalog gateway ready; configured='+Boolean(KEY)));
