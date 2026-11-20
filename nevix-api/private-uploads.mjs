import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const CHUNK_SIZE=5*1024*1024;
const MAX_SIZE=5*1024*1024*1024-1;
const MAX_SESSIONS=3;
const MAX_AGE=4*60*60*1000;
const PREFIX='peliculas/';
const ALLOWED=/\.(mp4|m4v|mkv|avi|mov|webm|wmv|mpeg|mpg|ts|m2ts)$/i;
const CONTENT_TYPES={mp4:'video/mp4',m4v:'video/x-m4v',mkv:'video/x-matroska',avi:'video/x-msvideo',mov:'video/quicktime',webm:'video/webm',wmv:'video/x-ms-wmv',mpeg:'video/mpeg',mpg:'video/mpeg',ts:'video/mp2t',m2ts:'video/mp2t'};
const safeString=x=>String(x||'').trim();

export function createPrivateUploads({client,bucket,reply,readJson,onComplete}){
 const active=new Map();
 const cancelled=new Map();
 let cleanupRunning=null;
 let cleanupReport={ok:null,checked:0,aborted:0,skipped:0,failed:0,message:'Sin comprobar'};
 const ownIncompleteKey=key=>/^peliculas\/\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-.+$/i.test(String(key||''));
 async function cleanupIncomplete(){
  if(cleanupRunning)return cleanupRunning;
  if(active.size>0)return {ok:false,error:'uploads_in_progress',message:'Primero cancela o termina las subidas que sigan activas.'};
  cleanupRunning=(async()=>{
   const report={ok:true,checked:0,aborted:0,skipped:0,failed:0,remaining:0,message:''};
   let keyMarker,uploadIdMarker,seen=0;
   const maxPages=40;
   try{
    for(let page=0;page<maxPages;page++){
     const listing=await client.send(new ListMultipartUploadsCommand({
      Bucket:bucket,Prefix:PREFIX,MaxUploads:1000,
      ...(keyMarker?{KeyMarker:keyMarker}:{}),
      ...(uploadIdMarker?{UploadIdMarker:uploadIdMarker}:{})
     }));
     const uploads=Array.isArray(listing.Uploads)?listing.Uploads:[];
     for(const upload of uploads){
      const key=safeString(upload.Key),id=safeString(upload.UploadId);
      report.checked++;
      if(!ownIncompleteKey(key)||!id){report.skipped++;continue;}
      // A complete object is not an incomplete upload; never delete published films.
      try{
       const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
       if(Number(head.ContentLength)>=0){report.skipped++;continue;}
      }catch(err){
       const missing=err?.name==='NoSuchKey'||err?.name==='NotFound'||Number(err?.$metadata?.httpStatusCode)===404;
       if(!missing){report.failed++;continue;}
      }
      try{
       await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:id}));
       report.aborted++;
      }catch(e){
       if(e?.name==='NoSuchUpload'||Number(e?.$metadata?.httpStatusCode)===404)report.aborted++;
       else{report.failed++;console.error('NÉVIX R2 orphan cleanup error type='+safeString(e?.name||'error').slice(0,45));}
      }
     }
     seen+=uploads.length;
     if(!listing.IsTruncated)break;
     keyMarker=safeString(listing.NextKeyMarker);
     uploadIdMarker=safeString(listing.NextUploadIdMarker);
     if(!keyMarker||!uploadIdMarker){report.ok=false;report.message='R2 no entregó la paginación completa de sesiones incompletas.';break;}
     if(page===maxPages-1){report.ok=false;report.message='Se alcanzó el límite de lotes; repetir limpieza.';}
    }
    if(report.failed)report.ok=false;
    if(!report.message)report.message=report.ok?'Limpieza verificada en R2. Solo se cancelaron transferencias multipart sin completar.':'Algunas sesiones no pudieron cancelarse.';
   }catch(e){
    report.ok=false;report.message='No se pudo listar las subidas incompletas de R2.';
    console.error('NÉVIX R2 orphan cleanup failed: '+safeString(e?.name||'Error').slice(0,60)+' http='+safeString(e?.$metadata?.httpStatusCode||'none'));
   }
   cleanupReport=report;
   console.log('NÉVIX R2 orphan multipart cleanup: ok='+report.ok+' checked='+report.checked+' aborted='+report.aborted+' skipped='+report.skipped+' failed='+report.failed);
   return report;
  })().finally(()=>{cleanupRunning=null;});
  return cleanupRunning;
 }

 // A cancelled multipart session is never published as a movie in R2.
 async function cancelSession(id,s){
  if(s.finalizing)return {status:409,data:{ok:false,error:'upload_finalizing',message:'R2 está finalizando esta película. Comprueba si ya aparece en la biblioteca antes de eliminarla.'}};
  s.cancelRequested=true;
  if(s.busy||s.abortInProgress)return {status:202,data:{ok:true,cancelPending:true,message:'Deteniendo el bloque actual antes de liberar la sesión de R2.'}};
  s.abortInProgress=true;
  try{
   await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId}));
   active.delete(id);
   cancelled.set(id,Date.now());
   console.log('NÉVIX R2 upload cancelled: partial multipart removed; no movie published');
   return {status:200,data:{ok:true,cancelled:true}};
  }catch(error){
   if(error?.name==='NoSuchUpload'||error?.name==='NoSuchKey'||Number(error?.$metadata?.httpStatusCode)===404){
    // NoSuchUpload also occurs when R2 already assembled the complete movie.
    // Never report deletion without verifying that no published object exists.
    try{
     const object=await client.send(new HeadObjectCommand({Bucket:bucket,Key:s.key}));
     if(Number(object.ContentLength)>0){
      active.delete(id);
      return {status:409,data:{error:'movie_already_stored',message:'La película ya fue guardada. Si deseas borrarla utiliza el administrador de películas de R2.'}};
     }
    }catch(headError){
     if(headError?.name!=='NoSuchKey'&&headError?.name!=='NotFound'&&Number(headError?.$metadata?.httpStatusCode)!==404)
      return {status:502,data:{error:'cancel_not_confirmed',message:'No fue posible verificar la cancelación en R2.'}};
    }
    active.delete(id);cancelled.set(id,Date.now());
    return {status:200,data:{ok:true,cancelled:true}};
   }
   console.error('NÉVIX R2 cancel failed: '+safeString(error?.name||'error').slice(0,36));
   return {status:502,data:{ok:false,error:'cancel_not_confirmed',message:'Cloudflare R2 no confirmó la cancelación. Vuelve a intentarlo.'}};
  }finally{s.abortInProgress=false;}
 }
 const respond=(res,status,data)=>reply(res,status,data);
 async function expire(){
  for(const [id,at] of cancelled){if(Date.now()-at>MAX_AGE)cancelled.delete(id);}
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
  if(s.cancelRequested){respond(res,409,{error:'upload_cancelling',message:'La subida está cancelándose. No se admiten más bloques.'});return null;}
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
   if(url.pathname==='/api/private/upload/cleanup'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const report=await cleanupIncomplete();
    respond(res,report.ok?200:report.error==='uploads_in_progress'?409:502,report);return true;
   }
   if(url.pathname==='/api/private/upload/start'){
    if(cleanupRunning){respond(res,503,{error:'cleanup_in_progress',message:'Finalizando limpieza de subidas incompletas en R2. Vuelve a intentar.'});return true;}
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),name=safeString(data.name),size=Number(data.size);
    const title=safeString(data.title).slice(0,130),year=safeString(data.year).slice(0,4);
    if(data.title!==undefined&&(title.length<2||title.length>130)||year&&!/^(19|20)\d{2}$/.test(year)){
     respond(res,400,{error:'invalid_movie_title',message:'Introduce un título de al menos dos caracteres y un año válido (opcional).'});return true;
    }
    const ext=name.match(ALLOWED);
    if(!ext||!Number.isSafeInteger(size)||size<1||size>MAX_SIZE){
     respond(res,400,{error:'invalid_video',message:'Selecciona un video MP4, MKV, AVI, MOV, WEBM, WMV, MPEG, TS o M2TS menor de 5 GiB.'});return true;
    }
    if(active.size>=MAX_SESSIONS){respond(res,429,{error:'too_many_uploads',message:'Hay otras cargas activas. Termínalas antes de continuar.'});return true;}
    const cleaned=name.replace(/[^\p{L}\p{N} ._()-]/gu,'_').replace(/\s+/g,' ').slice(0,140);
    const key=PREFIX+Date.now()+'-'+randomUUID()+'-'+cleaned;
    const type=CONTENT_TYPES[ext[1].toLowerCase()]||'application/octet-stream';
    const started=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:type}));
    if(!started?.UploadId)throw {status:502,error:'multipart_start_failed',message:'Cloudflare R2 no pudo iniciar la subida.'};
    const id=randomUUID(),chunks=Math.ceil(size/CHUNK_SIZE);
    active.set(id,{name:cleaned,key,uploadId:started.UploadId,size,chunks,title,year,parts:new Map(),updatedAt:Date.now(),busy:false,finalizing:false,cancelRequested:false,abortInProgress:false});
    console.log('NÉVIX R2 upload start: format='+ext[1].toLowerCase()+' size_mb='+Math.round(size/1048576)+' chunks='+chunks);
    respond(res,200,{uploadId:id,chunkSize:CHUNK_SIZE,chunks});return true;
   }
   if(url.pathname==='/api/private/upload/progress'){
    if(req.method!=='GET'){respond(res,405,{error:'method_not_allowed'});return true;}
    const id=safeString(url.searchParams.get('id'));
    const s=session(res,id);if(!s)return true;
    respond(res,200,{uploadId:id,name:s.name,size:s.size,chunks:s.chunks,title:s.title||'',year:s.year||'',chunkSize:CHUNK_SIZE,receivedParts:[...s.parts.keys()].sort((a,b)=>a-b)});
    return true;
   }
   if(url.pathname==='/api/private/upload/part'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const s=session(res,url.searchParams.get('id'));if(!s)return true;
    const n=Number(url.searchParams.get('part'));
    if(!Number.isInteger(n)||n<1||n>s.chunks){respond(res,400,{error:'invalid_part'});return true;}
    if(s.busy){respond(res,409,{error:'part_busy',message:'Espera a que termine la parte anterior.'});return true;}
    const expected=Math.min(CHUNK_SIZE,s.size-((n-1)*CHUNK_SIZE));
    s.busy=true;
    if(n===1||n%10===0||n===s.chunks)console.log('NÉVIX R2 upload part received: n='+n+' total='+s.chunks+' size='+expected);
    try{
     const data=await readPart(req,expected);
     let result;
     for(let attempt=1;attempt<=3;attempt++){
      try{
       result=await client.send(new UploadPartCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId,PartNumber:n,Body:data,ContentLength:data.length}));
       break;
      }catch(err){
       const http=Number(err?.$metadata?.httpStatusCode)||0;
       if(attempt===3||(http>=400&&http<500&&http!==408&&http!==429))throw err;
       await new Promise(resolve=>setTimeout(resolve,800*attempt));
      }
     }
     if(!result?.ETag)throw {status:502,error:'missing_etag',message:'Cloudflare R2 no confirmó la parte subida.'};
     s.parts.set(n,result.ETag);
     if(n===1||n%10===0||n===s.chunks)console.log('NÉVIX R2 upload part stored: n='+n+' total='+s.chunks);
     respond(res,200,{ok:true,part:n,received:data.length});
    }finally{
     s.busy=false;
     if(s.cancelRequested&&!s.finalizing)await cancelSession(safeString(url.searchParams.get('id')),s);
    }
    return true;
   }
   if(url.pathname==='/api/private/upload/complete'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),s=session(res,data.uploadId);if(!s)return true;
    if(s.busy||s.parts.size!==s.chunks){respond(res,409,{error:'incomplete_upload',message:'Faltan partes por enviar.'});return true;}
    const parts=Array.from({length:s.chunks},(_,i)=>({PartNumber:i+1,ETag:s.parts.get(i+1)}));
    if(parts.some(x=>!x.ETag)){respond(res,409,{error:'missing_parts'});return true;}
    s.busy=true;s.finalizing=true;
    try{
     try{
      await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:s.key,UploadId:s.uploadId,MultipartUpload:{Parts:parts}}));
     }catch(err){
      // R2 puede ensamblar el archivo aunque se interrumpa la respuesta.
      try{
       const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:s.key}));
       if(Number(head.ContentLength)!==s.size)throw err;
      }catch(_){throw err;}
     }
     const verified=await client.send(new HeadObjectCommand({Bucket:bucket,Key:s.key}));
     if(Number(verified.ContentLength)!==s.size)throw {status:502,error:'stored_size_mismatch',message:'R2 no confirmó el tamaño correcto de la película.'};
     active.delete(safeString(data.uploadId));
     console.log('NÉVIX R2 upload complete: size_mb='+Math.round(s.size/1048576)+' chunks='+s.chunks+' verified=true');
    }finally{s.busy=false;s.finalizing=false;}
    let result=null;
    try{result=await onComplete(s.key,{title:s.title||'',year:s.year||''});}
    catch(e){console.error('NÉVIX automatic MP4 verification setup failed after upload: '+safeString(e?.name||'Error'));}
    respond(res,200,{ok:true,stored:true,ready:result?.ready??null,pending:result?.pending??null,
      metadataPending:result===null,autoProcessing:result?.autoProcessing===true,jobId:result?.jobId||null,
      movieId:result?.movieId||null,validationError:result?.validationError||''});return true;
   }
   if(url.pathname==='/api/private/upload/abort'){
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
    const data=await readJson(req),id=safeString(data.uploadId);
    if(!/^[a-f0-9-]{36}$/i.test(id)){respond(res,400,{error:'invalid_upload_id'});return true;}
    if(cancelled.has(id)){respond(res,200,{ok:true,cancelled:true});return true;}
    const s=active.get(id);
    if(!s){respond(res,404,{error:'upload_not_active',message:'La sesión ya no está activa. Comprueba que no se haya completado antes de quitarla de la lista.'});return true;}
    const result=await cancelSession(id,s);
    respond(res,result.status,result.data);return true;
   }
   respond(res,404,{error:'not_found'});return true;
  }catch(e){
   const code=e.status||e.$metadata?.httpStatusCode||502;
   console.error('NÉVIX multipart upload failed:',safeString(e?.name||e?.error||'storage_error'),String(e?.$metadata?.httpStatusCode||''));
   respond(res,code===401||code===403?502:(code>=400&&code<500?code:502),{error:e.error||'upload_failed',message:e.status&&e.message?e.message:'Cloudflare R2 no aceptó esta parte del video. Reintenta la carga.'});
   return true;
  }
 }
 return {handle,chunkSize:CHUNK_SIZE,cleanupIncomplete,cleanupStatus:()=>cleanupReport};
}
