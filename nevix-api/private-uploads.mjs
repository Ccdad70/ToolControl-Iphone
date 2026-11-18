import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const CHUNK_SIZE=8*1024*1024;
const MAX_SIZE=5*1024*1024*1024-1;
const MAX_SESSIONS=3;
const MAX_AGE=4*60*60*1000;
const PREFIX='peliculas/';
const safeString=x=>String(x||'').trim();

export function createPrivateUploads({client,bucket,reply,readJson,onComplete}){
 const active=new Map();
 const respond=(res,status,data)=>reply(res,status,data);
 async function expire(){
  for(const [id,s] of active){
   if(Date.now()-s.updatedAt>MAX_AGE){
    active.delete(id);
    try{await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId}));}catch(_){}
   }
  }
 }
 function session(res,id){
  const s=active.get(safeString(id));
  if(!s){respond(res,404,{error:'upload_expired',message:'La carga ya no está activa. Selecciona el archivo y vuelve a empezar.'});return null;}
  s.updatedAt=Date.now();return s;
 }
 async function readPart(req,expected){
  const len=Number(req.headers['content-length']||0);
  if(len&&len!==expected)throw {status:400,error:'wrong_part_size',message:'El tamaño de la parte no coincide.'};
  const buffers=[];let size=0;
  for await(const part of req){
   size+=part.length;
   if(size>CHUNK_SIZE)throw {status:413,error:'part_too_large',message:'Una parte del archivo es demasiado grande.'};
   buffers.push(part);
  }
  if(size!==expected)throw {status:400,error:'incomplete_part',message:'La parte llegó incompleta. Intenta nuevamente.'};
  return Buffer.concat(buffers,size);
 }
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/private/upload/'))return false;
  await expire();
  try{
   if(url.pathname==='/api/private/upload/start'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),name=safeString(data.name),size=Number(data.size);
    const ext=name.match(/\.(mp4|webm)$/i);
    if(!ext||!Number.isSafeInteger(size)||size<1||size>MAX_SIZE){
     respond(res,400,{error:'invalid_video',message:'Selecciona un MP4 o WebM menor de 5 GB.'});return true;
    }
    if(active.size>=MAX_SESSIONS){respond(res,429,{error:'too_many_uploads',message:'Hay otras cargas activas. Termínalas antes de continuar.'});return true;}
    const cleaned=name.replace(/[^\p{L}\p{N} ._()-]/gu,'_').replace(/\s+/g,' ').slice(0,140);
    const key=PREFIX+Date.now()+'-'+randomUUID()+'-'+cleaned;
    const type=ext[1].toLowerCase()==='mp4'?'video/mp4':'video/webm';
    const started=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:type}));
    if(!started?.UploadId)throw {status:502,error:'multipart_start_failed',message:'Telnyx no pudo iniciar la subida.'};
    const id=randomUUID(),chunks=Math.ceil(size/CHUNK_SIZE);
    active.set(id,{key,uploadId:started.UploadId,size,chunks,parts:new Map(),updatedAt:Date.now(),busy:false});
    respond(res,200,{uploadId:id,chunkSize:CHUNK_SIZE,chunks});return true;
   }
   if(url.pathname==='/api/private/upload/part'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const s=session(res,url.searchParams.get('id'));if(!s)return true;
    const n=Number(url.searchParams.get('part'));
    if(!Number.isInteger(n)||n<1||n>s.chunks){respond(res,400,{error:'invalid_part'});return true;}
    if(s.busy){respond(res,409,{error:'part_busy',message:'Espera a que termine la parte anterior.'});return true;}
    const expected=Math.min(CHUNK_SIZE,s.size-((n-1)*CHUNK_SIZE));
    s.busy=true;
    try{
     const data=await readPart(req,expected);
     const result=await client.send(new UploadPartCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId,PartNumber:n,Body:data,ContentLength:data.length}));
     if(!result?.ETag)throw {status:502,error:'missing_etag',message:'Telnyx no confirmó la parte subida.'};
     s.parts.set(n,result.ETag);
     respond(res,200,{ok:true,part:n,received:data.length});
    }finally{s.busy=false;}
    return true;
   }
   if(url.pathname==='/api/private/upload/complete'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),s=session(res,data.uploadId);if(!s)return true;
    if(s.busy||s.parts.size!==s.chunks){respond(res,409,{error:'incomplete_upload',message:'Faltan partes por enviar.'});return true;}
    const parts=Array.from({length:s.chunks},(_,i)=>({PartNumber:i+1,ETag:s.parts.get(i+1)}));
    if(parts.some(x=>!x.ETag)){respond(res,409,{error:'missing_parts'});return true;}
    s.busy=true;
    try{
     await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId,MultipartUpload:{Parts:parts}}));
     active.delete(safeString(data.uploadId));
    }finally{s.busy=false;}
    let ready=null,pending=null;
    try{const rows=await onComplete();ready=rows.filter(x=>x.status==='ready').length;pending=rows.filter(x=>x.status!=='ready').length;}
    catch(e){console.error('NÉVIX metadata refresh failed after successful upload:',String(e?.$metadata?.httpStatusCode||'unknown'));}
    respond(res,200,{ok:true,stored:true,ready,pending,metadataPending:ready===null});return true;
   }
   if(url.pathname==='/api/private/upload/abort'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),id=safeString(data.uploadId),s=active.get(id);
    if(s&&!s.busy){
     active.delete(id);
     try{await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId}));}catch(_){}
    }
    respond(res,200,{ok:true});return true;
   }
   respond(res,404,{error:'not_found'});return true;
  }catch(e){
   const code=e.status||e.$metadata?.httpStatusCode||502;
   console.error('NÉVIX multipart upload failed:',safeString(e?.name||e?.error||'storage_error'),String(e?.$metadata?.httpStatusCode||''));
   respond(res,code===401||code===403?502:(code>=400&&code<500?code:502),{error:e.error||'upload_failed',message:e.status&&e.message?e.message:'Telnyx no aceptó esta parte del video. Reintenta la carga.'});
   return true;
  }
 }
 return {handle,chunkSize:CHUNK_SIZE};
}
