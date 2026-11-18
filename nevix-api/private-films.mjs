import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createPrivateUploads } from './private-uploads.mjs';
import { createPrivateRemux } from './private-remux-r2.mjs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const PREFIX='peliculas/';
const INDEX='nevix-meta/peliculas.json';
const MAX_UPLOAD=5*1024*1024*1024-1024;
const SUPPORTED=/\.mp4$/i;
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
 name=name.replace(/^[0-9]{13}-[a-f0-9-]{36}-/i,'').replace(/\.mp4$/i,'');
 const match=name.match(/(?:^|[\s.(\[-])((?:19|20)\d{2})(?:[\s.)\]-]|$)/);
 const year=match?Number(match[1]):null;
 if(match)name=name.slice(0,match.index);
 name=name.replace(/\b(480p|720p|1080p|2160p|4k|bluray|brrip|webrip|web-dl|x264|x265|h264|h265|aac|hdr|latino|dual|spanish|castellano|dublado)\b.*$/i,'');
 name=name.replace(/[._-]+/g,' ').replace(/[\[\]()]+/g,' ').replace(/\s+/g,' ').trim();
 if(/^\d{6,}$/.test(name))return {title:'Película pendiente',year:''};
 return {title:name.slice(0,120)||'Película pendiente',year:year||''};
}
function sanitizedCatalog(item){
 return {id:item.id,title:item.title,kind:'movie',year:item.year||'',image:item.image||'',description:item.description||'',privateMovie:true,category:'Cine',source:'NÉVIX TV',addedAt:item.addedAt||'',size:item.size||0};
}
export function createPrivateFilmService({send,tmdbTitle,tmdbSearchPoster,origin}){
 const accountId=string(process.env.R2_ACCOUNT_ID),bucket=string(process.env.R2_BUCKET);
 const accessKeyId=string(process.env.R2_ACCESS_KEY_ID),secretAccessKey=string(process.env.R2_SECRET_ACCESS_KEY);
 const family=string(process.env.NEVIX_FAMILY_ACCESS_CODE),admin=string(process.env.NEVIX_PRIVATE_ADMIN_KEY);
 const validAccount=/^[a-f0-9]{32}$/i.test(accountId);
 const validBucket=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
 const configured=Boolean(validAccount&&validBucket&&accessKeyId.length>=16&&secretAccessKey.length>=30&&family.length>=12&&admin.length>=16&&family!==admin);
 const client=configured?new S3Client({region:'auto',endpoint:'https://'+accountId+'.r2.cloudflarestorage.com',
  forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
  credentials:{accessKeyId,secretAccessKey},maxAttempts:3}):null;
 let catalog=null,cacheUntil=0,running=null,uploadReady=false;
 const videoProbeCount=new Map();
 const VIDEO_TOKEN_TTL_MS=30*60*1000;
 const videoSig=(id,expires)=>createHmac('sha256',secretAccessKey+':'+admin+':'+family).update('NEVIX-VIDEO-V1:'+id+':'+expires).digest('hex');
 function signedVideoPath(id){
  const expires=Date.now()+VIDEO_TOKEN_TTL_MS;
  return {path:'/api/private/video?id='+encodeURIComponent(id)+'&expires='+expires+'&sig='+videoSig(id,expires),expiresIn:Math.floor(VIDEO_TOKEN_TTL_MS/1000)};
 }
 function checkVideoToken(id,expiresString,signature){
  if(!/^priv-[a-f0-9]{24}$/.test(id)||!/^\d{13}$/.test(expiresString)||!/^[a-f0-9]{64}$/.test(signature))return false;
  const expires=Number(expiresString);
  if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+VIDEO_TOKEN_TTL_MS+2000)return false;
  const actual=Buffer.from(signature,'hex'),expected=Buffer.from(videoSig(id,expires),'hex');
  return timingSafeEqual(actual,expected);
 }
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
    if(entry.Key&&entry.Size>0&&!seen.has(entry.Key)&&entry.Key.startsWith(PREFIX)&&/\.mp4$/i.test(entry.Key)){
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
 const uploads=configured?createPrivateUploads({client,bucket,reply:(res,status,data)=>send(res,status,data),readJson:body,onComplete:()=>sync(true)}):null;
 const remux=configured?createPrivateRemux({client,bucket,finalize:async(original,newKey,newSize)=>{
  const rows=await sync(true);
  const old=rows.find(x=>x.key===original.key&&x.id===original.id);
  const next=rows.find(x=>x.key===newKey&&x.size===newSize);
  if(!old||!next||old.status!=='ready')throw Error('No se pudo comprobar el catálogo original y la copia MP4.');
  Object.assign(next,{
   title:old.title,year:old.year||'',image:old.image||'',description:old.description||'',
   status:'ready',container:'standard',remuxed:true,addedAt:old.addedAt||new Date().toISOString()
  });
  old.status='backup';
  await saveIndex();
  cacheUntil=Date.now()+90000;
  console.log('NÉVIX R2 MP4 catalog finalized: standard=true original_backup=true');
  void checkPlayback();
 }}):null;
 async function handle(req,res,url){
  try{
   if(url.pathname==='/api/private/status'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    return reply(res,200,{configured,connected:uploadReady,uploadReady,provider:'Cloudflare R2',supports:['mp4']});
   }
   if(!configured)return reply(res,503,{error:'storage_not_configured',message:'Configura R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY en Render.'});
   if(url.pathname==='/api/private/video'){
    if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'method_not_allowed'});
    const id=string(url.searchParams.get('id')),expiration=string(url.searchParams.get('expires'));
    if(!checkVideoToken(id,expiration,string(url.searchParams.get('sig'))))return reply(res,403,{error:'video_access_expired',message:'El acceso temporal al video expiró.'});
    const rows=await sync();
    const entry=rows.find(x=>x.id===id&&x.status==='ready'&&x.key.startsWith(PREFIX)&&SUPPORTED.test(x.key));
    if(!entry)return reply(res,404,{error:'video_unavailable'});
    const range=string(req.headers.range);
    if(range&&(!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)||range.length>70))return reply(res,416,{error:'invalid_range'});
    const type='video/mp4';
    if(req.method==='HEAD'){
     const info=await client.send(new HeadObjectCommand({Bucket:bucket,Key:entry.key}));
     res.writeHead(200,{'content-type':type,'content-length':String(info.ContentLength||entry.size),'accept-ranges':'bytes','cache-control':'private, no-store','access-control-allow-origin':origin,'access-control-expose-headers':'Content-Range, Content-Length, Accept-Ranges, Content-Type','x-content-type-options':'nosniff'});
     res.end();return;
    }
    const media=await client.send(new GetObjectCommand({Bucket:bucket,Key:entry.key,...(range?{Range:range}:{})}));
    if(!media.Body||typeof media.Body.pipe!=='function')throw {status:502,error:'missing_video_stream',message:'Cloudflare R2 no devolvió los datos de la película.'};
    const headers={'content-type':type,'accept-ranges':'bytes','content-disposition':'inline','cache-control':'private, no-store','access-control-allow-origin':origin,'access-control-expose-headers':'Content-Range, Content-Length, Accept-Ranges, Content-Type','x-content-type-options':'nosniff'};
    if(media.ContentRange)headers['content-range']=String(media.ContentRange);
    if(Number.isSafeInteger(Number(media.ContentLength)))headers['content-length']=String(media.ContentLength);
    const logged=videoProbeCount.get(id)||0;
    if(logged<5){
     console.log('NÉVIX private MP4 GET: http='+(media.ContentRange?206:200)+' range_requested='+(range?'yes':'no')+' range_delivered='+(media.ContentRange?'yes':'no')+' bytes='+String(media.ContentLength||'unknown'));
     videoProbeCount.set(id,logged+1);
    }
    res.writeHead(media.ContentRange?206:200,headers);
    const source=media.Body;
    source.once('error',()=>{console.error('NÉVIX private video proxy read failed.');try{res.destroy();}catch(_){}});
    res.once('close',()=>{if(!res.writableEnded){try{source.destroy();}catch(_){}}});
    source.pipe(res);
    return;
   }
   if(url.pathname==='/api/private/catalog'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied',message:'Introduce tu código de acceso familiar.'});
    const rows=await sync();
    return reply(res,200,{movies:rows.filter(x=>x.status==='ready').map(sanitizedCatalog),pending:rows.filter(x=>x.status!=='ready'&&x.status!=='backup').length,updatedAt:new Date().toISOString()});
   }
   if(url.pathname==='/api/private/stream'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied'});
    const id=string(url.searchParams.get('id')),rows=await sync();
    const item=rows.find(x=>x.id===id&&x.status==='ready'&&SUPPORTED.test(x.key));
    if(!item)return reply(res,404,{error:'not_available'});
    const proxy=signedVideoPath(item.id);
    return reply(res,200,{url:'https://nevix-catalog-api.onrender.com'+proxy.path,expiresIn:proxy.expiresIn,
     fallbackPath:proxy.path,fallbackExpiresIn:proxy.expiresIn,preferProxy:true,standardMp4:true,type:'video/mp4'});
   }
   if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied',message:'Código de administración incorrecto.'});
   if(url.pathname==='/api/private/remux/start'&&req.method==='POST'){
    if(!uploadReady)return reply(res,503,{error:'r2_not_ready',message:'Cloudflare R2 no está listo para reparar el video.'});
    const arg=await body(req),rows=await sync(true);
    const candidates=rows.filter(x=>x.status==='ready'&&SUPPORTED.test(x.key));
    const item=candidates.find(x=>x.id===string(arg.id))||(!string(arg.id)&&candidates.length===1?candidates[0]:null);
    if(!item)return reply(res,404,{error:'movie_not_available',message:'Selecciona una película disponible para reparar.'});
    if(item.remuxed)return reply(res,409,{error:'already_repaired',message:'Esta película ya tiene un MP4 estándar. Comprueba su reproducción.'});
    const result=remux.start(item);
    if(result.error)return reply(res,503,{error:result.error,message:result.error==='media_tools_unavailable'?'El servidor todavía no dispone de FFmpeg y FFprobe. La película original no se modificó.':'No se pudo iniciar la preparación MP4.'});
    return reply(res,result.busy?409:202,result);
   }
   if(url.pathname==='/api/private/remux/status'&&req.method==='GET'){
    const job=remux?.get(url.searchParams.get('jobId'));
    return job?reply(res,200,job):reply(res,404,{error:'job_not_found',message:'La preparación ya no está activa. Comprueba el catálogo antes de repetirla.'});
   }
   if(url.pathname==='/api/private/upload/direct')return reply(res,410,{error:'upgrade_required',message:'Actualiza NÉVIX TV; el MP4 se sube por bloques a R2.'});
   if(url.pathname.startsWith('/api/private/upload/')&&!uploadReady)return reply(res,503,{error:'r2_not_ready',message:'Cloudflare R2 todavía no está configurado o no superó la prueba de subida. Comprueba las credenciales.'});
   if(await uploads.handle(req,res,url))return;
   if(url.pathname==='/api/private/admin/catalog'&&req.method==='GET'){
    const rows=await sync(true),items=rows.filter(x=>x.status!=='backup').map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||'',remuxed:x.remuxed===true}));
    const pendingItems=items.filter(x=>x.status!=='ready');
    console.log('NÉVIX R2 admin catalog: movies='+items.length+' pending='+pendingItems.length);
    return reply(res,200,{items,pendingItems,ready:items.length-pendingItems.length,pending:pendingItems.length});
   }
   if(url.pathname==='/api/private/upload')return reply(res,410,{error:'upgrade_required',message:'Actualiza NÉVIX TV para subir películas con el nuevo sistema seguro.'});
   if(url.pathname==='/api/private/sync'&&req.method==='POST'){
    const rows=await sync(true);
    const items=rows.filter(x=>x.status!=='backup').map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||'',remuxed:x.remuxed===true}));
    const pendingItems=items.filter(x=>x.status!=='ready');
    console.log('NÉVIX R2 sync: movies='+items.length+' pending='+pendingItems.length);
    return reply(res,200,{ready:items.length-pendingItems.length,pending:pendingItems.length,pendingItems});
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
   if(res.headersSent){try{res.destroy();}catch(_){};return;}
   console.error('NÉVIX private storage request failed:',String(e?.name||'Error'),String(e?.$metadata?.httpStatusCode||''));
   return reply(res,e.status||502,{error:e.error||'storage_unavailable',message:e.message&&e.status?e.message:'No se pudo consultar Cloudflare R2 Storage. Revisa el bucket, la región, el CORS y las credenciales.'});
  }
 }
 async function checkConnection(){
  uploadReady=false;
  if(!configured)return {ok:false,reason:'incomplete_env',issues:[
   ...(!validAccount?['R2_ACCOUNT_ID']:[]),...(!validBucket?['R2_BUCKET']:[]),
   ...(accessKeyId.length<16?['R2_ACCESS_KEY_ID']:[]),...(secretAccessKey.length<30?['R2_SECRET_ACCESS_KEY']:[]),
   ...(family.length<12?['NEVIX_FAMILY_ACCESS_CODE']:[]),...(admin.length<16?['NEVIX_PRIVATE_ADMIN_KEY']:[])]};
  const key='nevix-meta/.r2-probe-'+randomUUID()+'.bin';
  let uploadId='',completed=false,stage='list';
  try{
   await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,MaxKeys:1}));
   stage='start';const start=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:'application/octet-stream'}));
   uploadId=start.UploadId;if(!uploadId)throw Error('missing_upload_id');
   stage='parts';const big=Buffer.alloc(5*1024*1024,88),small=Buffer.from('NEVIX-R2-PROBE');
   const a=await client.send(new UploadPartCommand({Bucket:bucket,Key:key,UploadId:uploadId,PartNumber:1,Body:big,ContentLength:big.length}));
   const b=await client.send(new UploadPartCommand({Bucket:bucket,Key:key,UploadId:uploadId,PartNumber:2,Body:small,ContentLength:small.length}));
   if(!a.ETag||!b.ETag)throw Error('parts_missing_etag');
   stage='complete';await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:[{PartNumber:1,ETag:a.ETag},{PartNumber:2,ETag:b.ETag}]}}));
   completed=true;
   stage='verify';const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
   if(Number(head.ContentLength)!==big.length+small.length)throw Error('size_mismatch');
   stage='catalog';const movies=await sync(true);
   uploadReady=true;console.log('NÉVIX R2 readiness: multipart=true ready_movies='+movies.filter(x=>x.status==='ready').length);
   return {ok:true,reason:'r2_multipart_verified'};
  }catch(e){console.error('NÉVIX R2 check failed: stage='+stage+' type='+String(e?.name||'Error').slice(0,42)+' http='+String(e?.$metadata?.httpStatusCode||'none'));
   return {ok:false,reason:'r2_probe_failed',stage};
  }finally{
   if(uploadId&&!completed){try{await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:uploadId}));}catch(_){}}
   try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}catch(_){}
  }
 }
 async function checkPlayback(){
  if(!configured)return;
  let stage='catalog';
  try{
   const movies=await sync(true);
   const film=movies.find(x=>x.status==='ready'&&SUPPORTED.test(x.key));
   if(!film){console.log('NÉVIX MP4 playback scan: no_ready_film');return;}
   const fileSize=Number(film.size);
   if(!Number.isSafeInteger(fileSize)||fileSize<32){console.log('NÉVIX MP4 playback scan: invalid_size');return;}
   let offset=0,atomCount=0,moovAt=-1,mdatAt=-1,rangeSupported=true;
   const boxes=[];
   while(offset<fileSize&&atomCount++<16){
    stage='read_range';
    const end=Math.min(fileSize-1,offset+63);
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:film.key,Range:'bytes='+offset+'-'+end}));
    const raw=Buffer.from(await response.Body.transformToByteArray());
    if(!response.ContentRange||raw.length<8){rangeSupported=false;break;}
    const type=raw.toString('latin1',4,8);
    let length=raw.readUInt32BE(0);
    if(length===1){if(raw.length<16)break;const large=raw.readBigUInt64BE(8);if(large>BigInt(Number.MAX_SAFE_INTEGER))break;length=Number(large);}
    if(length===0)length=fileSize-offset;
    if(length<8||length>fileSize-offset)break;
    if(type==='moov')moovAt=offset;
    if(type==='mdat')mdatAt=offset;
    boxes.push(type+'@'+Math.round(offset/1048576)+'MiB');
    offset+=length;
    if(type==='moov'&&mdatAt>=0)break;
   }
   console.log('NÉVIX MP4 playback scan: size_mb='+Math.round(fileSize/1048576)+' range='+rangeSupported+' moov='+(moovAt>=0?(mdatAt>=0&&moovAt>mdatAt?'after_mdat':'before_mdat'):'not_found')+' atoms='+boxes.join(',').slice(0,180));
  }catch(err){console.error('NÉVIX MP4 playback scan failed: stage='+stage+' reason='+String(err?.name||'Error').slice(0,42)+' http='+String(err?.$metadata?.httpStatusCode||'none'));}
 }
 return {handle,configured,checkConnection,checkPlayback};
}
