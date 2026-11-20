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
 const enabled=!ffmpeg.error&&ffmpeg.status===0;
 const encoders=enabled?spawnSync(FFMPEG_BIN,['-hide_banner','-encoders'],{encoding:'utf8',timeout:6000,maxBuffer:512*1024}):null;
 const list=encoders?.status===0?String(encoders.stdout||''):'';
 return {ffmpeg:enabled,ffprobe:!ffprobe.error&&ffprobe.status===0,
  h264Encoder:/^\s*V[^\n]*\blibx264\b/m.test(list),
  aacEncoder:/^\s*A[^\n]*\baac\b/m.test(list)};
}

const MAX_SIZE=6*1024*1024*1024;
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
  execFile(FFPROBE_BIN,['-v','error','-show_entries',
   'format=duration,format_name:stream=index,codec_name,codec_type,width,height,pix_fmt,channels,channel_layout,sample_rate,duration,profile:stream_tags=language,title,handler_name:stream_disposition=attached_pic,default',
   '-of','json',path],{timeout:90000,maxBuffer:1024*1024},(err,out)=>{
   if(err)return reject(Error('FFprobe no pudo analizar el contenedor. Comprueba que el archivo de video no esté dañado.'));
   try{resolve(JSON.parse(out));}catch(_){reject(Error('FFprobe devolvió datos multimedia inválidos.'));}
  });
 });
}
const firstVideo=p=>(p.streams||[]).find(x=>x.codec_type==='video'&&x.disposition?.attached_pic!==1);
const firstAudio=p=>(p.streams||[]).find(x=>x.codec_type==='audio');
const movieDuration=p=>Number(p.format?.duration||firstVideo(p)?.duration||firstAudio(p)?.duration)||0;
const compatibleH264=p=>{
 const v=firstVideo(p);
 return v?.codec_name==='h264'&&['yuv420p','yuvj420p'].includes(String(v.pix_fmt||'').toLowerCase());
};
const languageOf=x=>{
 const lang=String(x.tags?.language||'').trim().toLowerCase();
 const name=String(x.tags?.title||x.tags?.handler_name||'').toLowerCase();
 if(/^(spa|es|es-)/.test(lang)||/espa[nñ]ol|spanish|latino|castellano/.test(name))return 'spa';
 if(/^(eng|en|en-)/.test(lang)||/\benglish\b|ingl[eé]s/.test(name))return 'eng';
 if(/^(por|pt|pt-)/.test(lang))return 'por';
 if(/^(fra|fre|fr|fr-)/.test(lang))return 'fra';
 return /^[a-z]{3}$/.test(lang)?lang:'und';
};
function conversionPlan(before,filename,layout){
 const video=firstVideo(before);
 if(!video)throw Error('El archivo no contiene una pista de video reconocible.');
 const videoCopy=compatibleH264(before);
 const sounds=(before.streams||[]).filter(x=>x.codec_type==='audio');
 if(sounds.length>16)throw Error('Esta película contiene más de 16 pistas. Se necesita revisión manual para conservarlas todas.');
 const preferred=sounds.find(x=>languageOf(x)==='spa')||sounds.find(x=>Number(x.disposition?.default)===1)||sounds[0];
 const ordered=preferred?[preferred,...sounds.filter(x=>x.index!==preferred.index)]:[];
 const audioTracks=ordered.map(x=>({
  index:Number(x.index),codec:String(x.codec_name||''),channels:Number(x.channels)||0,
  language:languageOf(x),title:String(x.tags?.title||'').slice(0,80),
  sourceDefault:Number(x.disposition?.default)===1
 }));
 const hasAudio=Boolean(audioTracks.length);
 const outputAudioTracks=audioTracks.flatMap(track=>track.channels>=6?
   [{...track,profile:'stereo'},{...track,profile:'surround'}]:[{...track,profile:'stereo'}]);
 const incompatible=audioTracks.some(x=>x.codec!=='aac'||x.channels>2||x.channels<1);
 const changeDefault=Boolean(preferred&&sounds[0]&&preferred.index!==sounds[0].index);
 const needsConversion=!/\.mp4$/i.test(filename)||layout?.needsRepair||!videoCopy||incompatible||changeDefault;
 return {videoCopy,hasAudio,needsConversion,audioTracks,outputAudioTracks,videoIndex:video.index,
  sourceVideo:video.codec_name,sourceAudio:audioTracks[0]?.codec||'sin audio',sourceChannels:audioTracks[0]?.channels||0};
}
async function ffmpegConvert(input,output,plan,onProgress=()=>{},durationSec=0){
 const args=['-hide_banner','-nostdin','-loglevel','error','-progress','pipe:2','-y','-threads','1','-i',input,
  '-map','0:'+plan.videoIndex];


 for(const track of plan.outputAudioTracks)args.push('-map','0:'+track.index);
 if(plan.videoCopy)args.push('-c:v:0','copy');
 else args.push('-c:v:0','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-threads:v:0','1');
 for(let i=0;i<plan.outputAudioTracks.length;i++){
  const track=plan.outputAudioTracks[i];
  if(track.profile==='surround'){
   if(track.codec==='aac'&&track.channels===6)args.push('-c:a:'+i,'copy');
   else args.push('-c:a:'+i,'aac','-ac:a:'+i,'6','-b:a:'+i,'384k');
  }else if(track.codec==='aac'&&track.channels>0&&track.channels<=2)args.push('-c:a:'+i,'copy');
  else args.push('-c:a:'+i,'aac','-ac:a:'+i,'2','-b:a:'+i,'192k');
  args.push('-metadata:s:a:'+i,'language='+track.language,
   '-metadata:s:a:'+i,'title='+(track.title||('Audio '+(i+1)))+(track.profile==='surround'?' · 5.1':''),
   '-disposition:a:'+i,(i===0?'default':'0'));
 }
 args.push('-max_muxing_queue_size','2048','-movflags','+faststart','-f','mp4',output);
 await new Promise((resolve,reject)=>{
  const proc=spawn(FFMPEG_BIN,args,{stdio:['ignore','ignore','pipe']});
  let done=false,reason='',timedOut=false;
  const watchdog=setTimeout(()=>{timedOut=true;try{proc.kill('SIGKILL');}catch(_){}},30*60*1000);
  proc.stderr.on('data',buf=>{
   const detail=String(buf);
   reason=(reason+detail).slice(-1400);
   for(const part of detail.split(/\r?\n/)){
    const m=part.match(/^out_time_(?:us|ms)=(\d+)$/);
    if(m&&Number(durationSec)>0){
     const pct=Math.min(98,Math.floor(Number(m[1])/1000000/Number(durationSec)*100));
     if(Number.isFinite(pct))onProgress(pct);
    }
   }
  });
  proc.on('error',()=>{if(done)return;done=true;clearTimeout(watchdog);reject(Error('FFmpeg no está disponible para convertir este archivo.'));});
  proc.on('close',code=>{
   if(done)return;done=true;clearTimeout(watchdog);
   if(code===0)return resolve();
   const message=timedOut?'El video requiere más de 30 minutos de conversión. Este plan de Render no tiene suficiente potencia.':/No space left on device/i.test(reason)?'El servidor no tiene espacio temporal suficiente para convertir esta película.':/Cannot allocate memory|out of memory|Resource temporarily unavailable/i.test(reason)?'El servidor no tiene memoria suficiente para convertir este archivo.':/Error while decoding|Invalid data found|moov atom not found|error reading header/i.test(reason)?'El video de origen contiene datos dañados o no admite esta conversión.':/Unknown encoder|Encoder .* not found/i.test(reason)?'FFmpeg no dispone del codificador H.264/AAC necesario.':'FFmpeg no pudo completar la conversión multimedia en este servidor.';
   const tail=reason.split(/\r?\n/).map(x=>x.trim()).filter(x=>/error|invalid|failed|could not|unsupported|encoder|unknown/i.test(x));
   console.error('NÉVIX conversion failed: exit='+code+' diagnostics='+String(tail.at(-1)||'none').replace(/(?:\/[^\s:]+)+/g,'[path]').slice(0,150));
   reject(Error(message));
  });
 });
}
function validateMedia(before,after,plan){
 const originalVideo=firstVideo(before),outputVideo=firstVideo(after);
 if(!originalVideo||!outputVideo||outputVideo.codec_name!=='h264'||!['yuv420p','yuvj420p'].includes(String(outputVideo.pix_fmt||'').toLowerCase()))return false;
 if(originalVideo.width!==outputVideo.width||originalVideo.height!==outputVideo.height)return false;


 const audio=(after.streams||[]).filter(x=>x.codec_type==='audio');
 if(audio.length!==plan.outputAudioTracks.length)return false;
 for(let i=0;i<plan.outputAudioTracks.length;i++){
  const expected=plan.outputAudioTracks[i],actual=audio[i];
  if(actual.codec_name!=='aac')return false;
  const channels=Number(actual.channels);
  if(expected.profile==='surround'&&channels!==6)return false;
  if(expected.profile!=='surround'&&(channels<1||channels>2))return false;
  if(expected.language!=='und'&&languageOf(actual)!==expected.language)return false;
 }
 const beforeSeconds=movieDuration(before),afterSeconds=movieDuration(after);
 if(!Number.isFinite(afterSeconds)||afterSeconds<=2)return false;
 return !(beforeSeconds>2&&Math.abs(beforeSeconds-afterSeconds)>Math.max(4,beforeSeconds*0.01));
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
   if(atom==='moov'){foundMoov=true;if(!foundMdat)moovBeforeMdat=true;else break;}
   if(atom==='moof')fragmented=true;
   if(atom==='mdat'){foundMdat=true;if(foundMoov)break;}
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
  if(!entry?.id||!/\.(?:mp4|m4v|mkv|avi|mov|webm|wmv|mpeg|mpg|ts|m2ts)$/i.test(entry.key)||!['ready','processing','processing_failed','review'].includes(entry.status))return{error:'movie_not_available'};
  if(!(entry.size>0&&entry.size<=MAX_SIZE))return{error:'file_too_large'};
  const existing=findByFilm(entry.id);if(existing)return{job:statusOf(existing)};
  const tools=mediaToolsReady();
  if(!tools.ffmpeg||!tools.ffprobe||!tools.h264Encoder||!tools.aacEncoder)return{error:'media_tools_unavailable'};
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
    const sourceExt=String(entry.key||'').match(/\.(mp4|m4v|mkv|avi|mov|webm|wmv|mpeg|mpg|ts|m2ts)$/i)?.[1]?.toLowerCase()||'video';
    const input=join(directory,'source.'+sourceExt),output=join(directory,'compatible.mp4');
    job.phase='downloading';job.percent=0;job.message='Analizando y descargando MP4 desde Cloudflare R2.';
    console.log('NÉVIX R2 MP4 verification: phase=download auto='+auto+' size_mb='+Math.round(entry.size/1048576));
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:entry.key}));
    if(!response?.Body||typeof response.Body.pipe!=='function')throw Error('Cloudflare R2 no entregó el archivo MP4.');
    let downloaded=0;
    const counter=new Transform({transform(chunk,_enc,cb){downloaded+=chunk.length;job.percent=Math.min(99,Math.floor(downloaded/entry.size*100));cb(null,chunk);}});
    await pipeline(response.Body,counter,createWriteStream(input,{flags:'wx'}));
    const local=await stat(input);
    if(local.size!==entry.size)throw Error('El MP4 llegó incompleto al servidor.');
    job.phase='remuxing';lastPhase='verifying';job.percent=1;job.message='Identificando códecs, pistas de audio y compatibilidad del contenedor…';
    const before=await probe(input);
    const duration=movieDuration(before);
    if(!Number.isFinite(duration)||duration<2)throw Error('No fue posible confirmar la duración del archivo de video.');
    const layout=/\.(?:mp4|m4v)$/i.test(entry.key)?await detectMp4Layout(input,local.size):null;
    const plan=conversionPlan(before,entry.key,layout);
    console.log('NÉVIX video inspection: auto='+auto+' format='+sourceExt+' video='+plan.sourceVideo+' audio='+plan.sourceAudio+' channels='+plan.sourceChannels+' needs_conversion='+plan.needsConversion+' video_copy='+plan.videoCopy);
    if(auto&&!plan.needsConversion){
     job.phase='indexing';job.percent=99;job.message='El MP4 es compatible con reproducción web. Publicando el archivo original sin convertir.';
     if(typeof finishWithoutRemux==='function')await finishWithoutRemux(entry,plan.audioTracks);
     job.phase='completed';job.percent=100;job.message='MP4 compatible; no fue necesario convertir.';
     console.log('NÉVIX video verified: auto=true conversion=false');
     return;
    }
    lastPhase='remuxing';job.phase='remuxing';job.percent=1;
    job.message=plan.videoCopy?'Preparando MP4 compatible sin modificar el video. Ajustando audio cuando sea necesario.':'Convirtiendo video '+plan.sourceVideo+' a H.264 compatible. Puede requerir bastante procesamiento.';
    console.log('NÉVIX video conversion: phase=ffmpeg auto='+auto+' video_copy='+plan.videoCopy+' audio='+plan.sourceAudio+' tracks='+plan.audioTracks.length+' surround='+plan.outputAudioTracks.filter(x=>x.profile==='surround').length);
    await ffmpegConvert(input,output,plan,pct=>{job.percent=Math.max(job.percent,pct);},duration);
    const after=await probe(output);
    if(!validateMedia(before,after,plan))throw Error('La versión preparada no pasó la verificación de video, audio y duración.');
    const ready=await stat(output);
    if(ready.size<1024||ready.size>MAX_SIZE)throw Error('La copia MP4 tiene un tamaño incorrecto.');
    const readyLayout=await detectMp4Layout(output,ready.size);
    if(readyLayout.needsRepair)throw Error('FFmpeg no generó un contenedor MP4 estándar.');
    const filename=String(entry.title||'pelicula').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9 -]/g,'').replace(/\s+/g,'.').slice(0,85)||'pelicula';
    const stamp=entry.year&&/^(19|20)\d{2}$/.test(String(entry.year))?'.'+entry.year:'';
    const key='peliculas/'+Date.now()+'-'+randomUUID()+'-'+filename+stamp+'.mp4';
    job.phase='uploading';lastPhase='uploading';job.percent=0;job.message='Guardando versión MP4 compatible H.264/AAC en Cloudflare R2.';
    console.log('NÉVIX R2 MP4 repair: phase=uploading size_mb='+Math.round(ready.size/1048576));
    await multipartFile(client,bucket,storageOps,key,output,ready.size,pct=>{job.percent=Math.max(job.percent,pct);});
    job.phase='indexing';lastPhase='indexing';job.percent=0;job.message='Publicando MP4 compatible y conservando el archivo original.';
    await finalize(entry,key,ready.size,plan.audioTracks);
    job.phase='completed';job.percent=100;job.message='Película compatible H.264/AAC guardada. El archivo original permanece como respaldo en R2.';
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
