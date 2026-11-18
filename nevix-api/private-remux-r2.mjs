import { GetObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, statfs, open as openFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn, spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
export const FFMPEG_BIN=ffmpegInstaller?.path||'ffmpeg';
export const FFPROBE_BIN=ffprobeInstaller?.path||'ffprobe';
export function mediaToolsReady(){
 const ffmpeg=spawnSync(FFMPEG_BIN,['-version'],{encoding:'utf8',timeout:6000});
 const ffprobe=spawnSync(FFPROBE_BIN,['-version'],{encoding:'utf8',timeout:6000});
 return {ffmpeg:!ffmpeg.error&&ffmpeg.status===0,ffprobe:!ffprobe.error&&ffprobe.status===0};
}

const MAX_SIZE=4*1024*1024*1024;
const JOBS_LIMIT=10;
const MULTIPART_CHUNK=5*1024*1024;
async function withRetry(operation){
 let failure;
 for(let attempt=0;attempt<3;attempt++){
  try{return await operation();}
  catch(err){
   failure=err;
   const http=Number(err?.$metadata?.httpStatusCode)||0;
   const transient=!http||http===408||http===429||http>=500;
   if(!transient||attempt===2)break;
   await new Promise(resolve=>setTimeout(resolve,600*(attempt+1)));
  }
 }
 throw failure;
}
async function multipartUpload(client,bucket,storageOps,key,size,getBuffer,onProgress=()=>{},chunkSize=MULTIPART_CHUNK){
 const created=await storageOps.start(key);
 const uploadId=created?.UploadId;
 if(!uploadId)throw Error('Cloudflare R2 no confirmó el inicio de la transferencia por partes.');
 let completed=false,bytesConfirmed=0;
 try{
  const parts=[];
  const count=Math.ceil(size/chunkSize);
  for(let n=1;n<=count;n++){
   const offset=(n-1)*chunkSize,amount=Math.min(chunkSize,size-offset);
   const data=await getBuffer(offset,amount);
   if(!Buffer.isBuffer(data)||data.length!==amount)throw Error('La copia local tiene una parte incompleta.');
   const part=await withRetry(()=>storageOps.part(key,uploadId,n,data));
   if(!part?.ETag)throw Error('Cloudflare R2 no confirmó una parte de la película.');
   parts.push({ETag:part.ETag,PartNumber:n});
   bytesConfirmed+=amount;
   onProgress(Math.min(99,Math.floor(bytesConfirmed/size*100)));
  }
  try{
   await storageOps.complete(key,uploadId,parts);
   completed=true;
  }catch(err){
   // The response may be interrupted even when Cloudflare R2 has assembled the object.
   try{
    const h=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
    if(Number(h.ContentLength)===size)completed=true;
   }catch(_){}
   if(!completed)throw err;
  }
  const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
  if(Number(head.ContentLength)!==size)throw Error('Cloudflare R2 no confirmó el tamaño final de la copia MP4.');
  onProgress(99);
 }catch(err){
  if(!completed){
   try{await storageOps.abort(key,uploadId);}catch(_){}
  }
  throw err;
 }
}
async function multipartFile(client,bucket,storageOps,key,path,size,onProgress){
 const fd=await openFile(path,'r');
 try{
  await multipartUpload(client,bucket,storageOps,key,size,async(offset,amount)=>{
   const buffer=Buffer.allocUnsafe(amount);
   let read=0;
   while(read<amount){
    const result=await fd.read(buffer,read,amount-read,offset+read);
    if(!result.bytesRead)break;
    read+=result.bytesRead;
   }
   if(read!==amount)throw Error('No se pudo leer completamente la copia MP4 local.');
   return buffer;
  },onProgress);
 }finally{await fd.close();}
}
const statusOf=job=>({jobId:job.jobId,phase:job.phase,percent:job.percent,completed:job.phase==='completed',failed:job.phase==='failed',message:job.message,ready:job.phase==='completed'});
async function probe(path){
 return new Promise((resolve,reject)=>{
  execFile(FFPROBE_BIN,['-v','error','-show_entries','format=duration:stream=codec_name,codec_type,width,height,sample_rate','-of','json',path],
   {timeout:45000,maxBuffer:256*1024},(err,out)=>{
    if(err)return reject(Error('FFprobe no pudo analizar el archivo de video.'));
    try{resolve(JSON.parse(out));}catch(_){reject(Error('FFprobe devolvió metadatos inválidos.'));}
   });
 });
}
async function ffmpegRemux(input,output,onProgress=()=>{},durationSec=0){
 await new Promise((resolve,reject)=>{
  const task=spawn(FFMPEG_BIN,['-hide_banner','-nostdin','-loglevel','error','-progress','pipe:2','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart','-f','mp4',output],{stdio:['ignore','ignore','pipe']});
  let exited=false,stderr='';
  const watchdog=setTimeout(()=>{if(!exited){try{task.kill('SIGKILL');}catch(_){}}},20*60*1000);
  task.stderr.on('data',chunk=>{
   const detail=String(chunk);
   stderr=(stderr+detail).slice(-1200);
   for(const part of detail.split(/\r?\n/)){
    const m=part.match(/^out_time_(?:us|ms)=(\d+)$/);
    if(m&&Number(durationSec)>0){
     const pct=Math.min(98,Math.floor(Number(m[1])/1000000/Number(durationSec)*100));
     if(Number.isFinite(pct))onProgress(pct);
    }
   }
  });
  task.on('error',()=>{exited=true;clearTimeout(watchdog);reject(Error('FFmpeg no está disponible para convertir el contenedor.'));});
  task.on('close',code=>{
   if(exited)return;
   exited=true;clearTimeout(watchdog);
   if(code===0)return resolve();
   const reason=/Invalid data found|moov atom not found|error reading header/i.test(stderr)?'La estructura original del archivo puede estar dañada.':/No space left on device/i.test(stderr)?'No hay espacio temporal suficiente.':/Unrecognized option|Option not found|Error splitting the argument list/i.test(stderr)?'La versión instalada de FFmpeg no reconoce una opción de conversión.':'FFmpeg no pudo remultiplexar el video con copia de pistas.';
   const lines=stderr.split(/\r?\n/).map(x=>x.trim()).filter(x=>/error|invalid|option|failed|could not|moov|non.monotonous|corrupt|damaged|unknown|unsupported/i.test(x));
   const diagnostic=(lines[lines.length-1]||'no_specific_detail').replace(/(?:\/[^\s:]+)+/g,'[path]').slice(0,160);
   console.error('NÉVIX FFmpeg remux exit='+String(code)+' diagnostic='+diagnostic);
   reject(Error(reason));
  });
 });
}
function validateMedia(input,output){
 const video=a=>(a.streams||[]).find(x=>x.codec_type==='video');
 const audio=a=>(a.streams||[]).find(x=>x.codec_type==='audio');
 const v1=video(input),v2=video(output),a1=audio(input),a2=audio(output);
 if(!v1||!v2||v1.codec_name!=='h264'||v2.codec_name!=='h264'||v1.width!==v2.width||v1.height!==v2.height)return false;
 if(Boolean(a1)!==Boolean(a2)||a1&&a2&&(a1.codec_name!==a2.codec_name||a1.sample_rate!==a2.sample_rate))return false;
 const d1=Number(input.format?.duration),d2=Number(output.format?.duration);
 return Number.isFinite(d1)&&Number.isFinite(d2)&&d1>2&&Math.abs(d1-d2)<=Math.max(3,d1*0.002);
}
async function detectMp4Layout(path,size){
 const fd=await openFile(path,'r');
 let offset=0,foundMoov=false,moovBeforeMdat=false,fragmented=false,foundMdat=false,steps=0;
 try{
  while(offset<size&&steps++<128){
   const buffer=Buffer.alloc(16);
   const {bytesRead}=await fd.read(buffer,0,16,offset);
   if(bytesRead<8)break;
   const atom=buffer.toString('latin1',4,8);
   let length=buffer.readUInt32BE(0);
   if(length===1){
    if(bytesRead<16)break;
    const large=buffer.readBigUInt64BE(8);
    if(large>BigInt(Number.MAX_SAFE_INTEGER))break;
    length=Number(large);
   }
   if(length===0)length=size-offset;
   if(length<8||length>size-offset)break;
   if(atom==='moov'){foundMoov=true;if(!foundMdat)moovBeforeMdat=true;}
   if(atom==='moof')fragmented=true;
   if(atom==='mdat'){foundMdat=true;break;}
   offset+=length;
  }
 }finally{await fd.close();}
 if(!foundMoov||!foundMdat)throw Error('No se encontró un índice MP4 completo; revisa el archivo de origen.');
 return {fragmented,needsRepair:fragmented||!moovBeforeMdat,moovBeforeMdat};
}
export function createPrivateRemux({client,bucket,finalize,finishWithoutRemux,onFailure}){
 const storageOps={
  start:key=>client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:'video/mp4'})),
  part:(key,uploadId,n,bytes)=>client.send(new UploadPartCommand({Bucket:bucket,Key:key,UploadId:uploadId,PartNumber:n,Body:bytes,ContentLength:bytes.length})),
  complete:(key,uploadId,parts)=>client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:parts}})),
  abort:(key,uploadId)=>client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:uploadId}))
 };
 const jobs=new Map(),queue=[];
 let active=null;
 function get(id){const job=jobs.get(String(id||''));return job?statusOf(job):null;}
 function findByFilm(id){
  for(const job of jobs.values())if(job.filmId===id&&!['failed','completed'].includes(job.phase))return job;
  return null;
 }
 function start(entry,{auto=false}={}){
  if(!entry?.id||!/\.mp4$/i.test(entry.key)||!['ready','processing','processing_failed','review'].includes(entry.status))return{error:'movie_not_available'};
  if(!(entry.size>0&&entry.size<=MAX_SIZE))return{error:'file_too_large'};
  const existing=findByFilm(entry.id);if(existing)return{job:statusOf(existing)};
  const tools=mediaToolsReady();
  if(!tools.ffmpeg||!tools.ffprobe)return{error:'media_tools_unavailable'};
  const job={jobId:randomUUID(),filmId:entry.id,phase:'queued',percent:0,message:'Esperando turno para verificar el MP4 en Cloudflare R2.',createdAt:Date.now(),auto};
  jobs.set(job.jobId,job);
  while(jobs.size>JOBS_LIMIT){const first=[...jobs].find(([,v])=>['completed','failed'].includes(v.phase));if(!first)break;jobs.delete(first[0]);}
  queue.push({entry,job,auto});
  pump();
  return{job:statusOf(job)};
 }
 function pump(){
  if(active||!queue.length)return;
  const task=queue.shift(),{entry,job,auto}=task;
  active=job;
  void (async()=>{
   let directory='',lastPhase='queued';
   try{
    const fs=await statfs(tmpdir());
    const free=Number(fs.bavail)*Number(fs.bsize);
    if(free<entry.size*2.3+150*1024*1024)throw Error('No hay espacio temporal suficiente para preparar el MP4 de forma segura.');
    directory=await mkdtemp(join(tmpdir(),'nevix-remux-'));
    const input=join(directory,'source.mp4'),output=join(directory,'compatible.mp4');
    job.phase='downloading';job.percent=0;job.message='Analizando y descargando MP4 desde Cloudflare R2.';
    console.log('NÉVIX R2 MP4 verification: phase=download auto='+auto+' size_mb='+Math.round(entry.size/1048576));
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:entry.key}));
    if(!response?.Body||typeof response.Body.pipe!=='function')throw Error('Cloudflare R2 no entregó el archivo MP4.');
    let downloaded=0;
    const counter=new Transform({transform(chunk,_enc,cb){downloaded+=chunk.length;job.percent=Math.min(99,Math.floor(downloaded/entry.size*100));cb(null,chunk);}});
    await pipeline(response.Body,counter,createWriteStream(input,{flags:'wx'}));
    const local=await stat(input);
    if(local.size!==entry.size)throw Error('El MP4 llegó incompleto al servidor.');
    job.phase='remuxing';lastPhase='verifying';job.percent=1;job.message='Verificando códecs H.264/AAC e índice MP4…';
    const before=await probe(input);
    const video=(before.streams||[]).find(x=>x.codec_type==='video');
    const audio=(before.streams||[]).find(x=>x.codec_type==='audio');
    if(!video||video.codec_name!=='h264')throw Error('Este MP4 no usa video H.264; no se puede garantizar compatibilidad sin recodificar.');
    if(audio&&audio.codec_name!=='aac')throw Error('El audio del MP4 no está en AAC; requiere una conversión diferente.');
    const duration=Number(before.format?.duration);
    if(!Number.isFinite(duration)||duration<2)throw Error('El MP4 no contiene una duración de video válida.');
    const layout=await detectMp4Layout(input,local.size);
    console.log('NÉVIX R2 MP4 verification: auto='+auto+' fragmented='+layout.fragmented+' needs_repair='+layout.needsRepair+' video=h264 audio='+(audio?.codec_name||'none'));
    if(auto&&!layout.needsRepair){
     job.phase='indexing';job.percent=99;job.message='El MP4 ya es compatible. Publicando sin crear otra copia.';
     if(typeof finishWithoutRemux==='function')await finishWithoutRemux(entry);
     job.phase='completed';job.percent=100;job.message='MP4 verificado, sin reparación necesaria.';
     console.log('NÉVIX R2 MP4 verification completed: auto=true remuxed=false');
     return;
    }
    lastPhase='remuxing';job.phase='remuxing';job.percent=1;job.message='Reorganizando el MP4 sin recodificar ni perder calidad.';
    console.log('NÉVIX R2 MP4 repair: phase=remuxing auto='+auto);
    await ffmpegRemux(input,output,pct=>{job.percent=Math.max(job.percent,pct);},duration);
    const after=await probe(output);
    if(!validateMedia(before,after))throw Error('La versión reparada no pasó la comparación de duración y calidad.');
    const ready=await stat(output);
    if(ready.size<1024||ready.size>MAX_SIZE)throw Error('La copia MP4 tiene un tamaño incorrecto.');
    const readyLayout=await detectMp4Layout(output,ready.size);
    if(readyLayout.needsRepair)throw Error('FFmpeg no generó un contenedor MP4 estándar.');
    const filename=String(entry.title||'pelicula').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9 -]/g,'').replace(/\s+/g,'.').slice(0,85)||'pelicula';
    const stamp=entry.year&&/^(19|20)\d{2}$/.test(String(entry.year))?'.'+entry.year:'';
    const key='peliculas/'+Date.now()+'-'+randomUUID()+'-'+filename+stamp+'.mp4';
    job.phase='uploading';lastPhase='uploading';job.percent=0;job.message='Guardando versión MP4 compatible en Cloudflare R2.';
    console.log('NÉVIX R2 MP4 repair: phase=uploading size_mb='+Math.round(ready.size/1048576));
    await multipartFile(client,bucket,storageOps,key,output,ready.size,pct=>{job.percent=Math.max(job.percent,pct);});
    job.phase='indexing';lastPhase='indexing';job.percent=0;job.message='Publicando MP4 compatible y conservando el archivo original.';
    await finalize(entry,key,ready.size);
    job.phase='completed';job.percent=100;job.message='MP4 compatible y verificado. El original se conserva como respaldo.';
    console.log('NÉVIX R2 MP4 repair completed: auto='+auto+' original_preserved=true size_mb='+Math.round(ready.size/1048576));
   }catch(e){
    job.phase='failed';job.message=String(e?.message||'No se pudo preparar el archivo.').slice(0,230);
    console.error('NÉVIX R2 MP4 verification failed: stage='+lastPhase+' auto='+auto+' type='+String(e?.name||'error')+' code='+String(e?.code||'none').slice(0,22));
    if(auto&&typeof onFailure==='function'){
     try{await onFailure(entry,job.message);}catch(err){console.error('NÉVIX R2 MP4 failure status save error: '+String(err?.name||'error'));}
    }
   }finally{
    if(directory){try{await rm(directory,{recursive:true,force:true});}catch(_){}}
    if(active?.jobId===job.jobId)active=null;
    pump();
   }
  })();
 }
 return{get,start,findByFilm:filmId=>{const job=findByFilm(filmId);return job?statusOf(job):null;}};
}
