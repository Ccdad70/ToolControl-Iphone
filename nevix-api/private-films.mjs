import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const PREFIX='peliculas/';
const INDEX='nevix-meta/peliculas.json';
const MAX_UPLOAD=5*1024*1024*1024-1024;
const SUPPORTED=/\.(?:mp4|webm)$/i;
const PER_PAGE=1000;
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const string=v=>String(v||'').trim();

function safeSame(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!b)return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
function inferMovie(key){
 let name=key.split('/').pop()||'';
 try{name=decodeURIComponent(name);}catch(_){}
 name=name.replace(/^[0-9]{13}-[a-f0-9-]{36}-/i,'').replace(/\.(?:mp4|webm|mkv|mov|avi)$/i,'');
 const match=name.match(/(?:^|[\s.(\[-])((?:19|20)\d{2})(?:[\s.)\]-]|$)/);
 const year=match?Number(match[1]):null;
 if(match)name=name.slice(0,match.index);
 name=name.replace(/\b(480p|720p|1080p|2160p|4k|bluray|brrip|webrip|web-dl|x264|x265|h264|h265|aac|hdr|latino|dual|spanish|castellano|dublado)\b.*$/i,'');
 name=name.replace(/[._-]+/g,' ').replace(/[\[\]()]+/g,' ').replace(/\s+/g,' ').trim();
 return {title:name.slice(0,120)||'Película pendiente',year:year||''};
}
function sanitizedCatalog(item){
 return {id:item.id,title:item.title,kind:'movie',year:item.year||'',image:item.image||'',description:item.description||'',privateMovie:true,category:'Cine',source:'NÉVIX TV',addedAt:item.addedAt||'',size:item.size||0};
}
export function createPrivateFilmService({send,tmdbTitle,tmdbSearchPoster,origin}){
 const account=string(process.env.R2_ACCOUNT_ID),accessKey=string(process.env.R2_ACCESS_KEY_ID),secret=string(process.env.R2_SECRET_ACCESS_KEY),bucket=string(process.env.R2_BUCKET);
 const family=string(process.env.NEVIX_FAMILY_ACCESS_CODE),admin=string(process.env.NEVIX_PRIVATE_ADMIN_KEY);
 const validAccount=/^[a-z0-9]{16,64}$/i.test(account),validBucket=/^[a-z0-9][a-z0-9-]{1,62}$/i.test(bucket);
 const configured=Boolean(validAccount&&validBucket&&accessKey&&secret&&family.length>=12&&admin.length>=16&&family!==admin);
 const client=configured?new S3Client({region:'auto',endpoint:'https://'+account+'.r2.cloudflarestorage.com',forcePathStyle:true,credentials:{accessKeyId:accessKey,secretAccessKey:secret},maxAttempts:2}):null;
 let catalog=null,cacheUntil=0,running=null;
 const auth=(req,key)=>safeSame(string(req.headers[key==='admin'?'x-nevix-admin-key':'x-nevix-access-code']),key==='admin'?admin:family);
 const reply=(res,code,data)=>send(res,code,data);
 async function body(req){
  let size=0,parts=[];
  for await (const part of req){
   size+=part.length;
   if(size>8192)throw {status:413,error:'too_large',message:'La solicitud es demasiado grande.'};
   parts.push(part);
  }
  try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
  catch(_){throw {status:400,error:'invalid_json',message:'Solicitud inválida.'};}
 }
 async function readIndex(){
  if(catalog)return catalog;
  try{
   const data=await client.send(new GetObjectCommand({Bucket:bucket,Key:INDEX}));
   const raw=await data.Body.transformToString();
   const parsed=JSON.parse(raw);
   catalog=Array.isArray(parsed.items)?parsed.items.slice(0,5000):[];
  }catch(e){
   if(e.name==='NoSuchKey'||e.name==='NotFound'||e.$metadata?.httpStatusCode===404)catalog=[];
   else throw e;
  }
  return catalog;
 }
 async function saveIndex(){
  await client.send(new PutObjectCommand({Bucket:bucket,Key:INDEX,ContentType:'application/json',Body:JSON.stringify({updatedAt:new Date().toISOString(),items:catalog})}));
 }
 async function listMovies(){
  const objects=[],seen=new Set();let cursor;
  do{
   const result=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,MaxKeys:PER_PAGE,...(cursor?{ContinuationToken:cursor}:{})}));
   for(const entry of result.Contents||[]){
    if(entry.Key&&entry.Size>0&&!seen.has(entry.Key)&&/\.(mp4|webm|mkv)$/i.test(entry.Key)){
     seen.add(entry.Key);objects.push({key:entry.Key,size:Number(entry.Size)||0,etag:entry.ETag||''});
    }
   }
   cursor=result.IsTruncated?result.NextContinuationToken:null;
  }while(cursor&&objects.length<5000);
  return objects;
 }
 async function enrich(item){
  const inferred=inferMovie(item.key);
  item.title=inferred.title;item.year=inferred.year;
  if(!SUPPORTED.test(item.key)){item.status='unsupported';return;}
  if(!item.title||item.title==='Película pendiente'){item.status='review';return;}
  try{
   const m=await tmdbSearchPoster(item.title,item.year,'movie');
   if(m?.image){
    item.image=m.image;item.description=m.overview||'';
    item.status='ready';
   }else item.status='review';
  }catch(_){item.status='review';}
 }
 async function sync(force=false){
  if(running)return running;
  if(!force&&Date.now()<cacheUntil&&catalog)return catalog;
  running=(async()=>{
   const records=await readIndex(),objs=await listMovies();
   const old=new Map(records.map(x=>[x.key,x]));
   const updated=objs.map(o=>{
    const prior=old.get(o.key);
    if(prior&&prior.etag===o.etag)return prior;
    return {id:'priv-'+sha(o.key).slice(0,24),key:o.key,size:o.size,etag:o.etag,addedAt:new Date().toISOString(),title:'',year:'',image:'',description:'',status:'new'};
   });
   let processed=0,changed=updated.length!==records.length||updated.some(x=>!old.has(x.key)||old.get(x.key)?.etag!==x.etag);
   for(const it of updated){
    if(it.status==='new'&&processed<8){await enrich(it);processed++;changed=true;}
   }
   catalog=updated;
   if(changed)await saveIndex();
   cacheUntil=Date.now()+90000;
   return catalog;
  })().finally(()=>{running=null;});
  return running;
 }
 async function handle(req,res,url){
  try{
   if(url.pathname==='/api/private/status'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    return reply(res,200,{configured,provider:'Cloudflare R2',supports:['mp4','webm']});
   }
   if(!configured)return reply(res,503,{error:'storage_not_configured',message:'El almacenamiento privado aún no está configurado.'});
   if(url.pathname==='/api/private/catalog'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied',message:'Introduce tu código de acceso familiar.'});
    const rows=await sync();
    return reply(res,200,{movies:rows.filter(x=>x.status==='ready').map(sanitizedCatalog),pending:rows.filter(x=>x.status!=='ready').length,updatedAt:new Date().toISOString()});
   }
   if(url.pathname==='/api/private/stream'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied'});
    const id=string(url.searchParams.get('id'));
    const rows=await sync();
    const item=rows.find(x=>x.id===id&&x.status==='ready'&&SUPPORTED.test(x.key));
    if(!item)return reply(res,404,{error:'not_available'});
    const signed=await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:item.key}),{expiresIn:21600});
    return reply(res,200,{url:signed,expiresIn:21600,type:item.key.endsWith('.webm')?'video/webm':'video/mp4'});
   }
   if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied',message:'Código de administración incorrecto.'});
   if(url.pathname==='/api/private/admin/catalog'&&req.method==='GET'){
    const rows=await sync(true);
    return reply(res,200,{items:rows.map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||''})),ready:rows.filter(x=>x.status==='ready').length,pending:rows.filter(x=>x.status!=='ready').length});
   }
   if(url.pathname==='/api/private/upload'&&req.method==='POST'){
    const args=await body(req);
    const original=string(args.name),size=Number(args.size);
    const ext=original.match(/\.(mp4|webm)$/i);
    if(!ext||!Number.isSafeInteger(size)||size<=0||size>MAX_UPLOAD)return reply(res,400,{error:'invalid_file',message:'Sube un MP4 o WebM de hasta 5 GB. Convierte MKV a MP4 antes de subirlo.'});
    const safe=original.replace(/[^\p{L}\p{N} ._()-]/gu,'_').replace(/\s+/g,' ').slice(0,150);
    const key=PREFIX+Date.now()+'-'+randomUUID()+'-'+safe;
    const type=ext[1].toLowerCase()==='webm'?'video/webm':'video/mp4';
    const signed=await getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:type}),{expiresIn:7200});
    return reply(res,200,{uploadUrl:signed,method:'PUT',contentType:type,expiresIn:7200,keyHint:key.split('/').pop()});
   }
   if(url.pathname==='/api/private/sync'&&req.method==='POST'){
    const rows=await sync(true);
    return reply(res,200,{ready:rows.filter(x=>x.status==='ready').length,pending:rows.filter(x=>x.status!=='ready').length});
   }
   if(url.pathname==='/api/private/approve'&&req.method==='POST'){
    const arg=await body(req),rows=await sync(true),entry=rows.find(x=>x.id===string(arg.id));
    if(!entry||!SUPPORTED.test(entry.key))return reply(res,404,{error:'not_found'});
    const newTitle=string(arg.title).slice(0,130),newYear=string(arg.year).slice(0,4);
    if(newTitle.length<2||newYear&&!/^(19|20)\d{2}$/.test(newYear))return reply(res,400,{error:'invalid_metadata'});
    const meta=await tmdbSearchPoster(newTitle,newYear,'movie');
    if(!meta?.image)return reply(res,422,{error:'no_exact_match',message:'No se encontró una portada que coincida con ese título y año.'});
    entry.title=newTitle;entry.year=newYear;entry.image=meta.image;entry.description=meta.overview||'';entry.status='ready';
    await saveIndex();cacheUntil=Date.now()+90000;
    return reply(res,200,{ok:true,movie:sanitizedCatalog(entry)});
   }
   return reply(res,404,{error:'not_found'});
  }catch(e){
   console.error('NÉVIX private storage request failed:',String(e?.name||'Error'),String(e?.$metadata?.httpStatusCode||''));
   return reply(res,e.status||502,{error:e.error||'storage_unavailable',message:e.message&&e.status?e.message:'No se pudo consultar el servidor privado. Comprueba la configuración R2.'});
  }
 }
 return {handle,configured};
}
