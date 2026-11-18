import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createPrivateUploads } from './private-uploads.mjs';
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
 if(/^\d{6,}$/.test(name))return {title:'Película pendiente',year:''};
 return {title:name.slice(0,120)||'Película pendiente',year:year||''};
}
function sanitizedCatalog(item){
 return {id:item.id,title:item.title,kind:'movie',year:item.year||'',image:item.image||'',description:item.description||'',privateMovie:true,category:'Cine',source:'NÉVIX TV',addedAt:item.addedAt||'',size:item.size||0};
}
export function createPrivateFilmService({send,tmdbTitle,tmdbSearchPoster,origin}){
 // Telnyx authenticates the S3 Access Key ID; the signing secret must be a placeholder, never repeat a real API key.
 // IMPORTANT: never use AWS S3 getSignedUrl here: it would disclose the Telnyx API key!
 const telnyxKey=string(process.env.TELNYX_API_KEY);
 const bucket=string(process.env.TELNYX_STORAGE_BUCKET);
 const region=string(process.env.TELNYX_STORAGE_REGION)||'us-east-1';
 const family=string(process.env.NEVIX_FAMILY_ACCESS_CODE),admin=string(process.env.NEVIX_PRIVATE_ADMIN_KEY);
 const validBucket=/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(bucket);
 const validRegion=/^(?:us-(?:central|east|west)-1|eu-central-1|ap-southeast-1|ca-central-1)$/.test(region);
 // EU does not currently support the private browser upload/CORS workflow.
 const supportsBrowser=region!=='eu-central-1';
 const configured=Boolean(validBucket&&validRegion&&supportsBrowser&&telnyxKey.length>=16&&family.length>=12&&admin.length>=16&&family!==admin);
 const client=configured?new S3Client({region,endpoint:'https://'+region+'.telnyxcloudstorage.com',forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',credentials:{accessKeyId:telnyxKey,secretAccessKey:'telnyx-s3-secret-ignored'},maxAttempts:2}):null;
 let catalog=null,cacheUntil=0,running=null;

 async function rawUploadPart(key,uploadId,partNumber,body,declaredSize,contentType='application/octet-stream'){
  // Telnyx documents that the AWS SigV4 signature itself is ignored; only the Access Key ID is validated.
  // Never include the API key in a URL, a log, or a browser response.
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const date=stamp.slice(0,8);
  const authorization='AWS4-HMAC-SHA256 Credential='+telnyxKey+'/'+date+'/test/execute-api/aws4_request, SignedHeaders=host;x-amz-date, Signature='+('0'.repeat(64));
  const objectKey=key.split('/').map(encodeURIComponent).join('/');
  const uri='https://'+region+'.telnyxcloudstorage.com/'+encodeURIComponent(bucket)+'/'+objectKey+(uploadId?'?partNumber='+partNumber+'&uploadId='+encodeURIComponent(uploadId):'');
  const byteSize=Number(declaredSize??body.length);
  const response=await fetch(uri,{method:'PUT',headers:{Authorization:authorization,'x-amz-date':stamp,'Content-Type':contentType,'Content-Length':String(byteSize)},body,duplex:'half',signal:AbortSignal.timeout(3600000)});
  if(!response.ok)throw {name:'TelnyxPartHttpError',$metadata:{httpStatusCode:response.status}};
  const ETag=String(response.headers.get('etag')||'');
  if(uploadId&&!ETag)throw {name:'MissingTelnyxPartETag',$metadata:{httpStatusCode:502}};
  return {ETag};
 }
 async function telnyxSignedUrl(key,ttl=240){
  // Telnyx requires its own presigned URL API. Never sign with the AWS SDK;
  // doing so can reveal the API key embedded in the S3 Access Key ID.
  const objectPath=String(key).split('/').map(encodeURIComponent).join('/');
  const path='/v2/storage/buckets/'+encodeURIComponent(bucket)+'/'+objectPath+'/presigned_url';
  let result;
  try{
   const response=await fetch('https://api.telnyx.com'+path,{
    method:'POST',
    headers:{Authorization:'Bearer '+telnyxKey,'Content-Type':'application/json'},
    body:JSON.stringify({ttl:Math.min(240,Math.max(1,Math.trunc(Number(ttl)||240)))}),signal:AbortSignal.timeout(20000)
   });
   if(!response.ok){
    console.error('NÉVIX Telnyx presign rejected http='+response.status);
    throw {status:502,error:'presign_unavailable',message:'Telnyx no pudo generar el enlace temporal de reproducción.'};
   }
   result=await response.json();
  }catch(e){
   if(e?.status)throw e;
   throw {status:502,error:'presign_unavailable',message:'No se pudo conectar con Telnyx para reproducir la película.'};
  }
  const raw=String(result?.data?.presigned_url||result?.content?.presigned_url||'').trim();
  let url;
  try{url=new URL(raw);}catch(_){}
  const host=url?.hostname?.toLowerCase()||'';
  if(!url||url.protocol!=='https:'||!(/^[a-z0-9-]+\.telnyxcloudstorage\.com$/.test(host)||/^[a-z0-9-]+\.telnyxstorage\.com$/.test(host))||raw.includes(telnyxKey)||url.username||url.password||url.searchParams.has('X-Amz-Credential')){
   console.error('NÉVIX Telnyx presign returned unsafe or unexpected URL');
   throw {status:502,error:'invalid_presign',message:'Telnyx devolvió un enlace de video que no pasó la verificación de seguridad.'};
  }
  return raw;
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
   const result=await client.send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:PER_PAGE,...(cursor?{ContinuationToken:cursor}:{})}));
   for(const entry of result.Contents||[]){
    if(entry.Key&&entry.Size>0&&!seen.has(entry.Key)&&(entry.Key.startsWith(PREFIX)||!entry.Key.includes('/'))&&/\.(mp4|webm|mkv)$/i.test(entry.Key)){
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
 async function handle(req,res,url){
  try{
   if(url.pathname==='/api/private/status'){
    if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
    return reply(res,200,{configured,provider:'Telnyx Storage',supports:['mp4','webm']});
   }
   if(!configured)return reply(res,503,{error:'storage_not_configured',message:'Telnyx Storage aún no está configurado. Utiliza una región US compatible y configura las credenciales.'});
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
    const signed=await telnyxSignedUrl(item.key,240);
    return reply(res,200,{url:signed,expiresIn:240,type:item.key.endsWith('.webm')?'video/webm':'video/mp4'});
   }
   if(!auth(req,'admin'))return reply(res,401,{error:'admin_access_denied',message:'Código de administración incorrecto.'});
   if(url.pathname==='/api/private/upload/direct'){
    if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
    const name=string(url.searchParams.get('name'));
    const declaredSize=Number(url.searchParams.get('size'));
    const wireLength=Number(req.headers['content-length']||0);
    const ext=name.match(/\.(mp4|webm)$/i);
    if(!ext||!Number.isSafeInteger(declaredSize)||declaredSize<1||declaredSize>MAX_UPLOAD||wireLength!==declaredSize){
     return reply(res,400,{error:'invalid_file',message:'El video debe ser MP4 o WebM y coincidir con el tamaño indicado (máximo 5 GB).'});
    }
    const clean=name.replace(/[^\p{L}\p{N} ._()-]/gu,'_').replace(/\s+/g,' ').slice(0,140);
    const objectKey=PREFIX+Date.now()+'-'+randomUUID()+'-'+clean;
    await rawUploadPart(objectKey,null,0,req,declaredSize,ext[1].toLowerCase()==='mp4'?'video/mp4':'video/webm');
    let scanned=null;
    try{
     const movies=await sync(true);
     scanned={ready:movies.filter(x=>x.status==='ready').length,pending:movies.filter(x=>x.status!=='ready').length};
    }catch(_){console.error('NÉVIX: película guardada pero no se pudieron actualizar sus metadatos.');}
    return reply(res,200,{ok:true,stored:true,ready:scanned?.ready??null,pending:scanned?.pending??null,metadataPending:!scanned});
   }
   if(await uploads.handle(req,res,url))return;
   if(url.pathname==='/api/private/admin/catalog'&&req.method==='GET'){
    const rows=await sync(true);
    return reply(res,200,{items:rows.map(x=>({id:x.id,title:x.title,year:x.year,status:x.status,size:x.size,image:x.image||''})),ready:rows.filter(x=>x.status==='ready').length,pending:rows.filter(x=>x.status!=='ready').length});
   }
   if(url.pathname==='/api/private/upload')return reply(res,410,{error:'upgrade_required',message:'Actualiza NÉVIX TV para subir películas con el nuevo sistema seguro.'});
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
   return reply(res,e.status||502,{error:e.error||'storage_unavailable',message:e.message&&e.status?e.message:'No se pudo consultar Telnyx Storage. Revisa el bucket, la región, el CORS y las credenciales.'});
  }
 }
 async function checkConnection(){
  if(!configured){
   const issues=[];
   if(telnyxKey.length<16)issues.push('TELNYX_API_KEY');
   if(!validBucket)issues.push('TELNYX_STORAGE_BUCKET');
   if(!validRegion||!supportsBrowser)issues.push('TELNYX_STORAGE_REGION');
   if(family.length<12)issues.push('NEVIX_FAMILY_ACCESS_CODE');
   if(admin.length<16)issues.push('NEVIX_PRIVATE_ADMIN_KEY');
   if(family&&family===admin)issues.push('FAMILY_AND_ADMIN_SAME');
   return {ok:false,reason:'incomplete_env',issues};
  }
  let stage='list';
  const singleKey='nevix-meta/.single-probe-'+randomUUID()+'.bin';
  const streamKey='nevix-meta/.stream-probe-'+randomUUID()+'.bin';
  try{
   await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,MaxKeys:1}));
   stage='small_put';
   await client.send(new PutObjectCommand({Bucket:bucket,Key:singleKey,Body:Buffer.from('NEVIX-WRITE-TEST'),ContentType:'application/octet-stream'}));
   stage='stream_put';
   // Keep the routine startup probe small; a separate 8 MiB transfer was verified successfully.
   const content=Buffer.from('NEVIX-STREAM-TEST');
   await rawUploadPart(streamKey,null,0,(async function*(){yield content;})(),content.length);
   stage='catalog_sync';
   const rows=await sync(true);
   console.log('NÉVIX private catalog sync: total='+rows.length+' ready='+rows.filter(x=>x.status==='ready').length+' pending='+rows.filter(x=>x.status!=='ready').length);
   const firstReady=rows.find(x=>x.status==='ready'&&SUPPORTED.test(x.key));
   if(firstReady){
    stage='presigned_url';
    // Probe is private, with a short TTL. Never log the temporary URL or any credentials.
    const playbackUrl=await telnyxSignedUrl(firstReady.key,240);
    stage='video_range';
    // Check that the temporary URL can actually read the object, without
    // downloading a complete movie or exposing its link in logs.
    const playback=await fetch(playbackUrl,{method:'GET',headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(20000)});
    const playbackCode=playback.status;
    if(playback.body){try{await playback.body.cancel();}catch(_){}}
    if(playbackCode!==200&&playbackCode!==206)throw {name:'TelnyxVideoReadFailed',$metadata:{httpStatusCode:playbackCode}};
    console.log('NÉVIX Telnyx private playback link probe: verified=true ttl=240 video_http='+playbackCode+' range_supported='+(playbackCode===206));
   }
   return {ok:true,reason:firstReady?'bucket_read_write_and_presign_ok':'bucket_read_write_and_catalog_sync_ok'};
  }catch(e){
   const http=Number(e?.$metadata?.httpStatusCode)||0;
   const reason=http===401||http===403?'access_denied':http===404?'bucket_not_found_or_region_mismatch':http>=500?'telnyx_service_error':'storage_request_failed';
   console.error('NÉVIX Telnyx probe: http='+String(http||'unknown')+' category='+reason+' stage='+stage+' type='+String(e?.name||'unknown').slice(0,60));
   return {ok:false,reason};
  }finally{
   for(const key of [singleKey,streamKey]){try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}catch(_){}}
  }
 }
 return {handle,configured,checkConnection};
}
