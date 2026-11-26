import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createPrivateUploads } from './private-uploads.mjs';
import { createPrivateRemux } from './private-remux-r2.mjs';
import { createPrivateDubbing } from './private-dubbing.mjs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const PREFIX='peliculas/';
const INDEX='nevix-meta/peliculas.json';
const NETFLIX_SETTINGS_KEY='nevix-meta/netflix-catalog-settings.json';
const MAX_UPLOAD=5*1024*1024*1024-1024;
const SUPPORTED=/\.(?:mp4|m4v|mkv|avi|mov|webm|wmv|mpeg|mpg|ts|m2ts)$/i;
const OUTPUT_MP4=/\.mp4$/i;
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
 name=name.replace(/^[0-9]{13}-[a-f0-9-]{36}-/i,'').replace(SUPPORTED,'');
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
 // Preferencia global almacenada en R2, separada de las películas y sus respaldos.
 let netflixConfig=null,netflixCacheAt=0,netflixPending=null;
 async function netflixEnabled(force=false){
  if(!configured)throw {status:503,error:'settings_unavailable',message:'No se pudo consultar la configuración general de NÉVIX TV.'};
  if(!force&&netflixConfig!==null&&Date.now()-netflixCacheAt<3000)return netflixConfig;
  if(netflixPending)return netflixPending;
  netflixPending=(async()=>{
   let enabled=true;
   try{
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:NETFLIX_SETTINGS_KEY}));
    const value=JSON.parse(await response.Body.transformToString());
    if(typeof value.enabled!=='boolean')throw Error('netflix_settings_invalid');
    enabled=value.enabled;
   }catch(error){
    if(!(error?.name==='NoSuchKey'||error?.name==='NotFound'||error?.$metadata?.httpStatusCode===404))throw error;
   }
   netflixConfig=enabled;netflixCacheAt=Date.now();
   return enabled;
  })().finally(()=>{netflixPending=null;});
  return netflixPending;
 }
 async function saveNetflixSetting(enabled){
  await client.send(new PutObjectCommand({Bucket:bucket,Key:NETFLIX_SETTINGS_KEY,
   ContentType:'application/json',Body:JSON.stringify({enabled,updatedAt:new Date().toISOString(),version:1})}));
  netflixConfig=enabled;netflixCacheAt=Date.now();
  return enabled;
 }
 const auth=(req,key)=>safeSame(string(req.headers[key==='admin'?'x-nevix-admin-key':'x-nevix-access-code']),key==='admin'?admin:family);
 const reply=(res,code,data)=>send(res,code,data);
 async function body(req,maxBytes=8192){
  let size=0,parts=[];
  for await (const part of req){
   size+=part.length;
   if(size>maxBytes)throw {status:413,error:'too_large',message:'La solicitud es demasiado grande.'};
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
    if(entry.Key&&entry.Size>0&&!seen.has(entry.Key)&&entry.Key.startsWith(PREFIX)&&SUPPORTED.test(entry.Key)){
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
    if(it.status==='new'){
     if(processed<8)await enrich(it);
     else{const inferred=inferMovie(it.key);it.title=inferred.title;it.year=inferred.year;it.status='review';}
     it.publicationStatus=it.status==='ready'?'ready':'review';
     it.status='processing';
     processed++;changed=true;
    }
   }
   catalog=updated;
   if(changed)await saveIndex();
   cacheUntil=Date.now()+90000;
   return catalog;
  })().finally(()=>{running=null;});
  return running;
 }
 // Fast, non-destructive catalogue view: reading the saved index does not
 // enumerate every large movie on R2. Full scans still run for explicit
 // administrative resync and immediately after upload completion.
 async function catalogSnapshot(){
  const rows=await readIndex();
  return rows.length?rows:await sync();
 }
 let remux=null;
 async function markValidationFailed(entry,message){
  const rows=await sync(true),x=rows.find(y=>y.key===entry.key&&y.id===entry.id);
  if(x&&x.status==='processing'){
   x.status='processing_failed';x.validationError=String(message||'No se pudo preparar el MP4.').slice(0,220);
   await saveIndex();
  }
 }
 async function publishValidated(entry){
  const rows=await sync(true),x=rows.find(y=>y.key===entry.key&&y.id===entry.id);
  if(!x)throw Error('El MP4 ya no existe.');
  x.status=x.publicationStatus==='ready'?'ready':'review';
  x.verified=true;x.container='standard';x.validationError='';
  delete x.publicationStatus;
  await saveIndex();
  console.log('NÉVIX auto MP4 verified: repair=false published='+(x.status==='ready'));
 }
 async function publishRepaired(original,key,size){
  const rows=await sync(true);
  const old=rows.find(x=>x.key===original.key&&x.id===original.id),next=rows.find(x=>x.key===key&&x.size===size);
  if(!old||!next||!['ready','processing','processing_failed','review'].includes(old.status))throw Error('No se pudo comprobar la copia MP4 y el original.');
  const status=old.publicationStatus||old.status;
  Object.assign(next,{title:old.title,year:old.year||'',image:old.image||'',description:old.description||'',status:status==='ready'?'ready':'review',container:'standard',verified:true,remuxed:true,backupKey:old.key,addedAt:old.addedAt||new Date().toISOString()});
  old.status='backup';old.validationError='';delete old.publicationStatus;
  await saveIndex();cacheUntil=Date.now()+90000;
  console.log('NÉVIX R2 MP4 prepared: published='+(next.status==='ready')+' backup=true');
  void checkPlayback();
 }
 remux=configured?createPrivateRemux({client,bucket,finalize:publishRepaired,finishWithoutRemux:publishValidated,onFailure:markValidationFailed}):null;
 const dubbing=configured?createPrivateDubbing({client,bucket,admin,family,origin,
   findFilm:async id=>(await sync()).find(x=>x.id===id&&x.status==='ready'&&OUTPUT_MP4.test(x.key))||null,
   reply:(res,status,data)=>send(res,status,data),baseUrl:'https://nevix-catalog-api.onrender.com'}):null;
 async function autoValidateUploadedMovie(key,metadata={}){
  const rows=await sync(true),entry=rows.find(x=>x.key===key);
  if(!entry)throw Error('No se encontró el archivo MP4 recién subido.');
  const requestedTitle=string(metadata.title).slice(0,130),requestedYear=string(metadata.year).slice(0,4);
  if(requestedTitle.length>=2&&(!requestedYear||/^(19|20)\d{2}$/.test(requestedYear))){
   // Search the poster before converting the video; failure never removes the uploaded file.
   entry.title=requestedTitle;entry.year=requestedYear;
   entry.image='';entry.description='';
   try{
    const match=await tmdbSearchPoster(requestedTitle,requestedYear,'movie');
    if(match?.image){entry.image=match.image;entry.description=match.overview||'';}
   }catch(err){console.log('NÉVIX upload poster search postponed; movie saved, title retained');}
   entry.status=entry.image?'ready':'review';
  }
  entry.publicationStatus=entry.status==='ready'?'ready':'review';
  entry.status='processing';entry.validationError='';
  await saveIndex();
  const result=remux.start(entry,{auto:true});
  if(result.error){
   await markValidationFailed(entry,result.error==='file_too_large'?'El MP4 supera 4 GiB, límite de preparación automática.':'No se pudo iniciar la verificación: '+result.error);
   return{ready:rows.filter(x=>x.status==='ready').length,pending:1,autoProcessing:false,validationError:result.error};
  }
  console.log('NÉVIX automatic MP4 validation queued: size_mb='+Math.round(entry.size/1048576));
  return{ready:rows.filter(x=>x.status==='ready').length,pending:rows.filter(x=>!['ready','backup'].includes(x.status)).length,autoProcessing:true,jobId:result.job.jobId,movieId:entry.id};
 }
 const uploads=configured?createPrivateUploads({client,bucket,reply:(res,status,data)=>send(res,status,data),readJson:body,onComplete:autoValidateUploadedMovie}):null;
 async function recoverAutoJobs(){
  if(!configured||!uploadReady)return;
  let rows=await sync(true);
  // One-time, administrator-authorized deletion: the single stalled ~902 MiB
  // "Película pendiente" MKV shown in the user's admin screenshot.
  // Never delete published movies, backups, completed MP4s, or other MKVs.
  const requestedDeletion=rows.filter(entry=>
    ['processing','processing_failed'].includes(entry.status)
    && /\.mkv$/i.test(String(entry.key||''))
    && Math.round(Number(entry.size||0)/1048576)===902
    && String(entry.title||'').trim().toLocaleLowerCase('es')==='película pendiente'
  );
  if(requestedDeletion.length===1){
   const entry=requestedDeletion[0];
   // The FFmpeg worker from the previous instance is terminated by this
   // deployment before startup recovery runs.
   await client.send(new DeleteObjectCommand({Bucket:bucket,Key:entry.key}));
   rows=await sync(true);
   if(rows.some(x=>x.key===entry.key)){
    console.error('NÉVIX requested deletion not confirmed in R2; no other films modified');
    throw Error('R2 did not confirm removal of the selected unfinished MKV');
   }
   videoProbeCount.delete(entry.id);
   console.log('NÉVIX administrator deletion confirmed: unfinished 902 MiB MKV removed from R2; other movies retained');
  }else if(requestedDeletion.length>1){
   console.error('NÉVIX requested deletion refused: more than one unfinished 902 MiB MKV matched');
  }
  for(const entry of rows.filter(x=>x.status==='processing')){
   // A specific legacy 902-MiB MKV was deliberately stopped at the user's
   // request to replace it with a browser-compatible H.264/AAC MP4.
   // Preserve the R2 original and any already published movies; do not
   // repeatedly restart its costly MPEG-4 to H.264 conversion after deploys.
   const legacyReset=/\.mkv$/i.test(String(entry.key||''))
    &&Math.round(Number(entry.size||0)/1048576)===902
    &&String(entry.title||'').trim().toLocaleLowerCase('es').includes('película pendiente');
   if(legacyReset){
    await markValidationFailed(entry,'Conversión detenida a petición del administrador. El archivo MKV original sigue guardado; sube la nueva versión MP4 H.264/AAC.');
    console.log('NÉVIX requested reset: stalled legacy MKV conversion stopped; original retained in R2');
    continue;
   }
   const started=remux.start(entry,{auto:true});
   if(started.error)await markValidationFailed(entry,started.error);
   else console.log('NÉVIX automatic MP4 job restarted after server deploy');
  }
 }
 async function handle(req,res,url){
  try{
   if(url.pathname==='/api/private/netflix-settings'){
    if(req.method==='GET')return reply(res,200,{enabled:await netflixEnabled(),scope:'global'});
    if(req.method==='POST'){
     if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied',message:'Código de administración incorrecto.'});
     const data=await body(req);
     if(typeof data.enabled!=='boolean')return reply(res,400,{error:'invalid_enabled',message:'Indica un estado válido para Netflix.'});
     const enabled=await saveNetflixSetting(data.enabled);
     console.log('NÉVIX Netflix catalog setting changed: enabled='+enabled);
     return reply(res,200,{ok:true,enabled,scope:'global'});
    }
    return reply(res,405,{error:'method_not_allowed'});
   }
   if(url.pathname==='/api/private/status'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    return reply(res,200,{configured,connected:uploadReady,uploadReady,provider:'Cloudflare R2',supports:['mp4','m4v','mkv','avi','mov','webm','wmv','mpeg','mpg','ts','m2ts'],output:'mp4',audio:'aac_stereo_and_5_1_if_surround',orphanCleanup:uploads?.cleanupStatus()||null});
   }
   if(!configured)return reply(res,503,{error:'storage_not_configured',message:'Configura R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY en Render.'});
   if(url.pathname==='/api/private/dub-source'||url.pathname==='/api/private/dub-audio'){
    await dubbing.serve(req,res,url);return;
   }
   if(url.pathname==='/api/private/dubbing/status'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied'});
    return reply(res,200,await dubbing.status(string(url.searchParams.get('id'))));
   }
   if(url.pathname==='/api/private/dubbing/start'){
    if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied'});
    return reply(res,202,await dubbing.start(await body(req)));
   }
   if(url.pathname==='/api/private/video'){
    if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'method_not_allowed'});
    const id=string(url.searchParams.get('id')),expiration=string(url.searchParams.get('expires'));
    if(!checkVideoToken(id,expiration,string(url.searchParams.get('sig'))))return reply(res,403,{error:'video_access_expired',message:'El acceso temporal al video expiró.'});
    const rows=await catalogSnapshot();
    const entry=rows.find(x=>x.id===id&&x.status==='ready'&&x.key.startsWith(PREFIX)&&OUTPUT_MP4.test(x.key));
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
    const rows=await catalogSnapshot();
    const movies=rows.filter(x=>x.status==='ready'&&OUTPUT_MP4.test(x.key)).map(sanitizedCatalog);
    console.log('NÉVIX family catalog: available='+movies.length+' pending='+rows.filter(x=>x.status!=='ready'&&x.status!=='backup').length+' indexed=true');
    return reply(res,200,{movies,pending:rows.filter(x=>x.status!=='ready'&&x.status!=='backup').length,updatedAt:new Date().toISOString()});
   }
   if(url.pathname==='/api/private/stream'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    if(!auth(req,'family')&&!auth(req,'admin'))return reply(res,401,{error:'access_denied'});
    const id=string(url.searchParams.get('id')),rows=await catalogSnapshot();
    const item=rows.find(x=>x.id===id&&x.status==='ready'&&OUTPUT_MP4.test(x.key));
    if(!item)return reply(res,404,{error:'not_available'});
    const proxy=signedVideoPath(item.id);
    return reply(res,200,{url:'https://nevix-catalog-api.onrender.com'+proxy.path,expiresIn:proxy.expiresIn,
     fallbackPath:proxy.path,fallbackExpiresIn:proxy.expiresIn,preferProxy:true,standardMp4:true,type:'video/mp4'});
   }
   if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied',message:'Código de administración incorrecto.'});
   if(url.pathname==='/api/private/remux/start'&&req.method==='POST'){
    if(!uploadReady)return reply(res,503,{error:'r2_not_ready',message:'Cloudflare R2 no está listo para reparar el video.'});
    const arg=await body(req),rows=await sync(true);
    const candidates=rows.filter(x=>['ready','processing_failed','review'].includes(x.status)&&SUPPORTED.test(x.key));
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
   if(url.pathname==='/api/private/upload/metadata-preview'&&req.method==='POST'){
    const input=await body(req);
    const title=string(input.title),year=string(input.year);
    if(title.length<2||title.length>130||year&&!/^(19|20)\d{2}$/.test(year))
     return reply(res,400,{error:'invalid_metadata',message:'Escribe el título y opcionalmente el año de estreno (4 cifras).'});
    const match=await tmdbSearchPoster(title,year,'movie');
    if(!match?.image)return reply(res,200,{ok:true,found:false,message:'No se encontró una portada exacta. Podrás revisarla después de subir la película.'});
    return reply(res,200,{ok:true,found:true,image:match.image,description:match.overview||'',matchedTitle:match.matchedTitle||title,matchedYear:match.matchedYear||'',title,year});
   }
   if(await uploads.handle(req,res,url))return;
   if(url.pathname==='/api/private/admin/library'&&req.method==='GET'){
    const rows=url.searchParams.get('refresh')==='1'?await sync(true):await catalogSnapshot();
    return reply(res,200,{files:rows.map(x=>({
     id:x.id,title:x.title,year:x.year||'',status:x.status,size:x.size||0,
     remuxed:x.remuxed===true,verified:x.verified===true,validationError:x.validationError||'',
     backupOf:rows.find(y=>y.backupKey===x.key)?.id||'',job:remux?.findByFilm(x.id)||null
    })),count:rows.length});
   }
   if(url.pathname==='/api/private/admin/delete'&&req.method==='POST'){
    const arg=await body(req);
    if(string(arg.confirm)!=='ELIMINAR')return reply(res,400,{error:'confirmation_required',message:'Confirma escribiendo ELIMINAR.'});
    const rows=await sync(true),entry=rows.find(x=>x.id===string(arg.id));
    if(!entry||!entry.key.startsWith(PREFIX)||!SUPPORTED.test(entry.key))return reply(res,404,{error:'not_found',message:'No encontramos ese MP4 en Cloudflare R2.'});
    if(remux?.findByFilm(entry.id))return reply(res,409,{error:'movie_processing',message:'Espera a que finalice la preparación de esta película antes de eliminarla.'});
    if(string(arg.title)!==string(entry.title))return reply(res,409,{error:'movie_changed',message:'El nombre cambió. Actualiza la lista antes de eliminar.'});
    const bytes=Number(entry.size)||0,wasBackup=entry.status==='backup';
    await client.send(new DeleteObjectCommand({Bucket:bucket,Key:entry.key}));
    const updated=await sync(true);
    if(updated.some(x=>x.key===entry.key))return reply(res,502,{error:'delete_unconfirmed',message:'El objeto aún aparece en el catálogo de R2. Recarga la lista para comprobar.'});
    let linksChanged=false;
    for(const x of updated)if(x.backupKey===entry.key){delete x.backupKey;linksChanged=true;}
    if(linksChanged)await saveIndex();
    videoProbeCount.delete(entry.id);
    console.log('NÉVIX R2 video deleted: size_mb='+Math.round(bytes/1048576)+' backup='+wasBackup);
    return reply(res,200,{ok:true,deleted:true,bytes,wasBackup,remaining:updated.length});
   }
   if(url.pathname==='/api/private/admin/catalog'&&req.method==='GET'){
    const rows=await catalogSnapshot(),items=rows.filter(x=>x.status!=='backup').map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||'',remuxed:x.remuxed===true,verified:x.verified===true,validationError:x.validationError||'',job:remux?.findByFilm(x.id)||null}));
    const pendingItems=items.filter(x=>x.status!=='ready');
    console.log('NÉVIX R2 admin catalog: movies='+items.length+' pending='+pendingItems.length);
    return reply(res,200,{items,pendingItems,ready:items.length-pendingItems.length,pending:pendingItems.length});
   }
   if(url.pathname==='/api/private/upload')return reply(res,410,{error:'upgrade_required',message:'Actualiza NÉVIX TV para subir películas con el nuevo sistema seguro.'});
   if(url.pathname==='/api/private/sync'&&req.method==='POST'){
    const rows=await sync(true);
    const items=rows.filter(x=>x.status!=='backup').map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||'',remuxed:x.remuxed===true,verified:x.verified===true,validationError:x.validationError||'',job:remux?.findByFilm(x.id)||null}));
    const pendingItems=items.filter(x=>x.status!=='ready');
    console.log('NÉVIX R2 sync: movies='+items.length+' pending='+pendingItems.length);
    return reply(res,200,{ready:items.length-pendingItems.length,pending:pendingItems.length,pendingItems});
   }
   if(url.pathname==='/api/private/metadata-preview'&&req.method==='POST'){
    const arg=await body(req),rows=await sync(true),entry=rows.find(x=>x.id===string(arg.id));
    if(!entry||!SUPPORTED.test(entry.key)||!['ready','review'].includes(entry.status))
     return reply(res,404,{error:'not_editable',message:'La película no está disponible para editar. Espera a que finalice su verificación.'});
    const requestedTitle=string(arg.title),requestedYear=string(arg.year);
    if(requestedTitle.length<2||requestedTitle.length>130||requestedYear&&!/^(19|20)\d{2}$/.test(requestedYear))
     return reply(res,400,{error:'invalid_metadata',message:'Escribe un título válido y un año de cuatro cifras.'});
    const found=await tmdbSearchPoster(requestedTitle,requestedYear,'movie');
    if(!found?.image)return reply(res,422,{error:'no_exact_match',message:'No se encontró una portada que coincida exactamente con el título y el año. Comprueba la escritura o prueba con el título original.'});
    return reply(res,200,{ok:true,id:entry.id,title:requestedTitle,year:requestedYear,image:found.image,description:found.overview||'',matchedTitle:found.matchedTitle||requestedTitle,matchedYear:found.matchedYear||'',currentTitle:entry.title});
   }
   if(url.pathname==='/api/private/approve'&&req.method==='POST'){
    const arg=await body(req,140000),rows=await sync(true),entry=rows.find(x=>x.id===string(arg.id));
    if(!entry||!SUPPORTED.test(entry.key))return reply(res,404,{error:'not_found'});
    if(!['ready','review'].includes(entry.status)||!OUTPUT_MP4.test(entry.key))return reply(res,409,{error:'not_editable',message:'Primero debe completarse la conversión de esta película a MP4.'});
    const newTitle=string(arg.title).slice(0,130),newYear=string(arg.year).slice(0,4);
    if(newTitle.length<2||newYear&&!/^(19|20)\d{2}$/.test(newYear))return reply(res,400,{error:'invalid_metadata'});
    let meta;
    if(Object.prototype.hasOwnProperty.call(arg,'manualPoster')){
     const image=arg.manualPoster;
     if(typeof image!=='string'||image.length>130000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
      return reply(res,400,{error:'invalid_poster',message:'La portada manual no es una imagen JPEG válida o supera el tamaño permitido.'});
     const encoded=image.slice('data:image/jpeg;base64,'.length),bytes=Buffer.from(encoded,'base64');
     if(bytes.length<4||bytes.toString('base64')!==encoded||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)
      return reply(res,400,{error:'invalid_poster',message:'La portada manual no es una imagen JPEG válida.'});
     meta={image,overview:entry.description||''};
    }else{
     meta=await tmdbSearchPoster(newTitle,newYear,'movie');
     if(!meta?.image)return reply(res,422,{error:'no_exact_match',message:'No se encontró una portada que coincida con ese título y año. Puedes subir una portada manual.'});
    }
    const previousTitle=entry.title;
    entry.title=newTitle;entry.year=newYear;entry.image=meta.image;entry.description=meta.overview||'';entry.status='ready';
    await saveIndex();cacheUntil=Date.now()+90000;
    console.log('NÉVIX private film metadata corrected: id='+entry.id+' changed='+Boolean(previousTitle!==newTitle)+' poster=true file_unchanged=true');
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
   stage='cleanup';const cleanup=await uploads.cleanupIncomplete();
   // Cancellation is best effort when permissions or network are restricted.
   // Publish normal upload readiness, but expose the exact cleanup result for verification.
   uploadReady=true;console.log('NÉVIX R2 readiness: multipart=true ready_movies='+movies.filter(x=>x.status==='ready').length+' cleanup_ok='+cleanup.ok+' orphan_aborted='+Number(cleanup.aborted||0));
   return {ok:true,reason:'r2_multipart_verified',cleanup};
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
 return {handle,configured,checkConnection,checkPlayback,recoverAutoJobs,netflixEnabled};
}
