
import {GetObjectCommand,PutObjectCommand,HeadObjectCommand,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand} from '@aws-sdk/client-s3';
import {createHmac,timingSafeEqual} from 'node:crypto';

const AUDIO_PREFIX='nevix-audio/';
const META_PREFIX='nevix-meta/dubbing/';
const PART_SIZE=5*1024*1024;
const MAX_DUB_BYTES=1024*1024*1024;
const SOURCE_TTL=6*60*60*1000;
const AUDIO_TTL=6*60*60*1000;
const txt=v=>String(v||'').trim();
const missing=e=>e?.name==='NoSuchKey'||e?.name==='NotFound'||Number(e?.$metadata?.httpStatusCode)===404;

export function createPrivateDubbing({client,bucket,admin,family,origin,findFilm,reply,baseUrl}){
 const apiKey=txt(process.env.ELEVENLABS_API_KEY);
 const ongoing=new Map();
 const idOk=id=>/^priv-[a-f0-9]{24}$/.test(id);
 const audioKey=id=>AUDIO_PREFIX+id+'/es.flac';
 const metaKey=id=>META_PREFIX+id+'.json';
 const sig=(id,kind,exp)=>createHmac('sha256',txt(process.env.R2_SECRET_ACCESS_KEY)+':'+admin+':'+family)
   .update('NEVIX-DUB-V1:'+kind+':'+id+':'+exp).digest('hex');
 function signed(id,kind,ttl){
  const expires=Date.now()+ttl;
  return baseUrl+'/api/private/dub-'+kind+'?id='+encodeURIComponent(id)+'&expires='+expires+'&sig='+sig(id,kind,expires);
 }
 function verify(id,kind,expiry,signature,ttl){
  if(!idOk(id)||!/^\d{13}$/.test(expiry)||!/^[a-f0-9]{64}$/.test(signature))return false;
  const e=Number(expiry);
  if(!Number.isSafeInteger(e)||e<=Date.now()||e>Date.now()+ttl+2000)return false;
  const expected=Buffer.from(sig(id,kind,e),'hex'),actual=Buffer.from(signature,'hex');
  return timingSafeEqual(actual,expected);
 }
 async function read(id){
  try{
   const obj=await client.send(new GetObjectCommand({Bucket:bucket,Key:metaKey(id)}));
   const parsed=JSON.parse(await obj.Body.transformToString());
   return parsed&&typeof parsed==='object'?parsed:null;
  }catch(e){if(missing(e))return null;throw e;}
 }
 async function write(id,data){
  await client.send(new PutObjectCommand({Bucket:bucket,Key:metaKey(id),ContentType:'application/json',
   Body:JSON.stringify({...data,updatedAt:new Date().toISOString()})}));
 }
 async function eleven(path,options={}){
  const result=await fetch('https://api.elevenlabs.io'+path,{...options,headers:{'xi-api-key':apiKey,...options.headers},signal:AbortSignal.timeout(45000)});
  const data=await result.json().catch(()=>({}));
  if(!result.ok)throw {status:502,error:'dubbing_provider_unavailable',message:'ElevenLabs rechazó la solicitud ('+result.status+'). Revisa los créditos y permisos de la clave API.'};
  return data;
 }
 async function start(arg){
  if(!apiKey)throw {status:503,error:'dubbing_not_configured',message:'Falta configurar ELEVENLABS_API_KEY en Render para generar doblajes.'};
  const id=txt(arg?.id),film=idOk(id)?await findFilm(id):null;
  if(!film)throw {status:404,error:'movie_not_found',message:'La película no está publicada en Cloudflare R2.'};
  if(arg?.rightsConfirmed!==true||arg?.paidConfirmed!==true)
   throw {status:400,error:'confirmation_required',message:'Confirma los derechos de uso y que ElevenLabs cobrará créditos por este doblaje.'};
  if(Number(film.size)>3*1024*1024*1024)
   throw {status:413,error:'media_too_large',message:'ElevenLabs acepta hasta 3 GiB por archivo. El MP4 original permanecerá intacto.'};
  const old=await read(id);
  if(old&&old.status!=='failed')return {ok:true,state:old.status,alreadyRequested:true};
  const form=new FormData();
  form.set('source_url',signed(id,'source',SOURCE_TTL));
  form.set('reference','NEVIX '+id);
  form.set('model_id','dubbing_v2');
  form.set('target_language','es');
  const project=await eleven('/v1/dubbing/project',{method:'POST',body:form});
  const projectId=txt(project.project_id);
  if(!/^proj_[a-zA-Z0-9]+$/.test(projectId))throw {status:502,error:'invalid_provider_response',message:'ElevenLabs no confirmó el proyecto de doblaje.'};
  let languageId=txt(project.language_ids?.[0]);
  const initial={projectId,languageId,status:'queued',startedAt:new Date().toISOString()};
  await write(id,initial);
  if(!languageId){
   const language=await eleven('/v1/dubbing/project/'+encodeURIComponent(projectId)+'/language',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_language:'es'})});
   languageId=txt(language.language_id);
   if(!/^lang_[a-zA-Z0-9]+$/.test(languageId))throw {status:502,error:'invalid_language_response',message:'El proyecto se creó, pero ElevenLabs no confirmó el idioma español.'};
   await write(id,{...initial,languageId});
  }
  return {ok:true,state:'queued',alreadyRequested:false,message:'El doblaje español se inició. Puede requerir varios minutos.'};
 }
 async function uploadAudio(id,url){
  // Only fetch provider-issued audio from the documented output storage.
  const remote=new URL(url);
  if(remote.protocol!=='https:'||remote.hostname!=='storage.googleapis.com')
   throw Error('La dirección de audio de ElevenLabs no pertenece al almacenamiento esperado.');
  const result=await fetch(remote,{signal:AbortSignal.timeout(25*60*1000)});
  if(!result.ok||!result.body)throw Error('No se pudo descargar el audio generado.');
  let multipart=null,done=false,bytes=0,buffer=Buffer.alloc(0),partNum=0;
  const pieces=[];
  try{
   for await(const chunk of result.body){
    const part=Buffer.from(chunk);
    bytes+=part.length;
    if(bytes>MAX_DUB_BYTES)throw Error('La pista de audio supera el límite de 1 GiB.');
    buffer=Buffer.concat([buffer,part],buffer.length+part.length);
    while(buffer.length>=PART_SIZE){
     if(!multipart){
      const started=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:audioKey(id),ContentType:'audio/flac'}));
      multipart=started.UploadId;
      if(!multipart)throw Error('R2 no inició la subida del audio.');
     }
     const content=buffer.subarray(0,PART_SIZE);
     buffer=buffer.subarray(PART_SIZE);
     const result=await client.send(new UploadPartCommand({Bucket:bucket,Key:audioKey(id),UploadId:multipart,PartNumber:++partNum,Body:content,ContentLength:content.length}));
     if(!result.ETag)throw Error('R2 no confirmó una parte del audio.');
     pieces.push({PartNumber:partNum,ETag:result.ETag});
    }
   }
   if(!bytes)throw Error('ElevenLabs devolvió audio vacío.');
   if(!multipart){
    await client.send(new PutObjectCommand({Bucket:bucket,Key:audioKey(id),Body:buffer,ContentLength:buffer.length,ContentType:'audio/flac'}));
   }else{
    if(buffer.length){
     const result=await client.send(new UploadPartCommand({Bucket:bucket,Key:audioKey(id),UploadId:multipart,PartNumber:++partNum,Body:buffer,ContentLength:buffer.length}));
     if(!result.ETag)throw Error('R2 no confirmó la última parte del audio.');
     pieces.push({PartNumber:partNum,ETag:result.ETag});
    }
    await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:audioKey(id),UploadId:multipart,MultipartUpload:{Parts:pieces}}));
    done=true;
   }
   const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:audioKey(id)}));
   if(Number(head.ContentLength)!==bytes)throw Error('El audio guardado no coincide con el tamaño descargado.');
   return bytes;
  }finally{
   if(multipart&&!done)try{await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:audioKey(id),UploadId:multipart}));}catch(_){}
  }
 }
 function backgroundSave(id,record,remoteUrl){
  if(ongoing.has(id))return;
  const work=(async()=>{
   try{
    try{
     const already=await client.send(new HeadObjectCommand({Bucket:bucket,Key:audioKey(id)}));
     if(Number(already.ContentLength)>0){await write(id,{...record,status:'ready',bytes:Number(already.ContentLength)});return;}
    }catch(e){if(!missing(e))throw e;}
    const bytes=await uploadAudio(id,remoteUrl);
    await write(id,{...record,status:'ready',bytes});
   }catch(e){
    // Keep project IDs so the output may be recovered without another paid generation.
    console.error('NÉVIX dubbing audio persistence failed: '+txt(e.name||'Error').slice(0,32));
    await write(id,{...record,status:'storing',error:'No se pudo guardar el audio en R2. Intenta consultar el estado de nuevo.'}).catch(()=>{});
   }
  })().finally(()=>ongoing.delete(id));
  ongoing.set(id,work);
 }
 async function status(id){
  if(!idOk(id)||!await findFilm(id))throw {status:404,error:'movie_not_found',message:'Película no disponible.'};
  const data=await read(id);
  if(!data)return {available:false,state:'not_requested',providerConfigured:Boolean(apiKey)};
  if(data.status==='ready'){
   return {available:true,state:'ready',language:'es',format:'audio/flac',audioUrl:signed(id,'audio',AUDIO_TTL),providerConfigured:Boolean(apiKey)};
  }
  if(!apiKey)return {available:false,state:'paused',providerConfigured:false};
  if(data.status==='storing'&&ongoing.has(id))return {available:false,state:'storing',providerConfigured:true};
  try{
   if(!/^proj_[a-zA-Z0-9]+$/.test(txt(data.projectId)))throw Error('Proyecto inválido');
   if(!/^lang_[a-zA-Z0-9]+$/.test(txt(data.languageId))){
    return {available:false,state:'queued',providerConfigured:true};
   }
   const info=await eleven('/v1/dubbing/project/'+encodeURIComponent(data.projectId)+'/language/'+encodeURIComponent(data.languageId));
   if(info.status==='failed'){
    await write(id,{...data,status:'failed',error:'ElevenLabs no pudo generar el doblaje.'});
    return {available:false,state:'failed',providerConfigured:true};
   }
   if(info.status==='completed'&&info.outputs?.lossless_audio){
    backgroundSave(id,data,info.outputs.lossless_audio);
    return {available:false,state:'storing',providerConfigured:true};
   }
   return {available:false,state:['queued','processing'].includes(info.status)?info.status:'preparing',providerConfigured:true};
  }catch(e){
   return {available:false,state:data.status==='storing'?'storing':'queued',providerConfigured:true,message:'No se pudo consultar el progreso del doblaje.'};
  }
 }
 async function serve(req,res,url){
  const kind=url.pathname==='/api/private/dub-source'?'source':url.pathname==='/api/private/dub-audio'?'audio':null;
  if(!kind)return false;
  if(!['GET','HEAD'].includes(req.method))return reply(res,405,{error:'method_not_allowed'});
  const id=txt(url.searchParams.get('id')),exp=txt(url.searchParams.get('expires')),token=txt(url.searchParams.get('sig'));
  if(!verify(id,kind,exp,token,kind==='source'?SOURCE_TTL:AUDIO_TTL))
   return reply(res,403,{error:'media_link_expired'});
  const film=await findFilm(id);
  if(!film)return reply(res,404,{error:'movie_not_found'});
  const state=kind==='audio'?await read(id):null;
  if(kind==='audio'&&state?.status!=='ready')return reply(res,404,{error:'audio_unavailable'});
  const key=kind==='source'?film.key:audioKey(id);
  const range=txt(req.headers.range);
  if(range&&(!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)||range.length>70))
   return reply(res,416,{error:'invalid_range'});
  const type=kind==='source'?'video/mp4':'audio/flac';
  const headers={'content-type':type,'accept-ranges':'bytes','cache-control':'private, no-store',
    'access-control-allow-origin':origin,'access-control-expose-headers':'Content-Range, Content-Length, Accept-Ranges, Content-Type',
    'x-content-type-options':'nosniff','content-disposition':'inline'};
  if(req.method==='HEAD'){
   const h=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
   headers['content-length']=String(h.ContentLength||0);
   res.writeHead(200,headers);res.end();return true;
  }
  const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key,...(range?{Range:range}:{})}));
  if(response.ContentRange)headers['content-range']=String(response.ContentRange);
  if(Number.isSafeInteger(Number(response.ContentLength)))headers['content-length']=String(response.ContentLength);
  res.writeHead(response.ContentRange?206:200,headers);
  const stream=response.Body;
  stream.once('error',()=>{try{res.destroy();}catch(_){}});
  res.once('close',()=>{if(!res.writableEnded)try{stream.destroy();}catch(_){}});
  stream.pipe(res);
  return true;
 }
 return {start,status,serve};
}
