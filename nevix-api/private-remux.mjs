import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
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

const MAX_SIZE=3*1024*1024*1024;
const JOBS_LIMIT=10;
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
  const task=spawn(FFMPEG_BIN,['-hide_banner','-nostdin','-loglevel','error','-stats_period','1','-progress','pipe:2','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart','-f','mp4',output],{stdio:['ignore','ignore','pipe']});
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
   const reason=/Invalid data found|moov atom not found|error reading header/i.test(stderr)?'La estructura original del archivo está dañada.':/No space left on device/i.test(stderr)?'No hay espacio temporal suficiente.':'FFmpeg no pudo remultiplexar el video con copia de pistas.';
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
export function createPrivateRemux({client,bucket,uploadObject,finalize}){
 const jobs=new Map();
 let active=null;
 function get(id){const job=jobs.get(String(id||''));return job?statusOf(job):null;}
 function start(entry){
  if(active&&active.phase!=='failed'&&active.phase!=='completed')return{busy:true,job:statusOf(active)};
  if(!entry?.id||!/\.mp4$/i.test(entry.key)||entry.status!=='ready')return{error:'movie_not_available'};
  if(!(entry.size>0&&entry.size<=MAX_SIZE))return{error:'file_too_large'};
  const readyTools=mediaToolsReady();
  if(!readyTools.ffmpeg||!readyTools.ffprobe)return{error:'media_tools_unavailable'};
  const job={jobId:randomUUID(),filmId:entry.id,phase:'queued',percent:0,message:'Preparando una copia compatible sin recodificar.',createdAt:Date.now()};
  jobs.set(job.jobId,job);active=job;
  while(jobs.size>JOBS_LIMIT)jobs.delete(jobs.keys().next().value);
  void (async()=>{
   let directory='',lastPhase='queued';
   try{
    const fs=await statfs(tmpdir());
    const free=Number(fs.bavail)*Number(fs.bsize);
    if(free<entry.size*2.3+150*1024*1024)throw Error('No hay espacio temporal suficiente para una copia segura.');
    directory=await mkdtemp(join(tmpdir(),'nevix-remux-'));
    const input=join(directory,'source.mp4'),output=join(directory,'compatible.mp4');
    job.phase='downloading';job.message='Descargando la copia original desde Telnyx.';
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:entry.key}));
    if(!response?.Body||typeof response.Body.pipe!=='function')throw Error('Telnyx no entregó el archivo original.');
    let downloaded=0;
    const counter=new Transform({transform(chunk,_enc,cb){downloaded+=chunk.length;job.percent=Math.min(99,Math.floor(downloaded/entry.size*100));cb(null,chunk);}});
    await pipeline(response.Body,counter,createWriteStream(input,{flags:'wx'}));
    const local=await stat(input);
    if(local.size!==entry.size)throw Error('La copia descargada llegó incompleta.');
    job.phase='remuxing';lastPhase='remuxing';job.percent=1;job.message='Reorganizando el MP4 con FFmpeg, sin pérdida de calidad.';
    const before=await probe(input);
    if(!(before.streams||[]).some(x=>x.codec_type==='video'&&x.codec_name==='h264'))throw Error('El video no usa H.264 y requiere otro procedimiento.');
    await ffmpegRemux(input,output,pct=>{job.percent=Math.max(job.percent,pct);},Number(before.format?.duration)||0);
    const after=await probe(output);
    if(!validateMedia(before,after))throw Error('La conversión no pasó la comparación de pistas y duración.');
    const ready=await stat(output);
    if(ready.size<1024||ready.size>MAX_SIZE)throw Error('La copia resultante tiene un tamaño inválido.');
    const filename=String(entry.title||'pelicula').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9 -]/g,'').replace(/\s+/g,'.').slice(0,85)||'pelicula';
    const stamp=entry.year&&/^(19|20)\d{2}$/.test(String(entry.year))?'.'+entry.year:'';
    const key='peliculas/'+Date.now()+'-'+randomUUID()+'-'+filename+stamp+'.mp4';
    job.phase='uploading';lastPhase='uploading';job.percent=0;job.message='Guardando la copia compatible en tu bucket privado.';
    let uploaded=0;
    const file=createReadStream(output);
    file.on('data',chunk=>{uploaded+=chunk.length;job.percent=Math.min(99,Math.floor(uploaded/ready.size*100));});
    await uploadObject(key,file,ready.size);
    job.phase='indexing';lastPhase='indexing';job.percent=0;job.message='Actualizando la película y conservando el original como respaldo.';
    await finalize(entry,key,ready.size);
    job.phase='completed';job.percent=100;job.message='Copia MP4 estándar lista. Abre Películas y actualiza el catálogo.';
    console.log('NÉVIX remux completed: original_preserved=true size='+ready.size);
   }catch(e){
    job.phase='failed';job.message=String(e?.message||'No se pudo preparar el archivo.').slice(0,230);
    console.error('NÉVIX remux failed: type='+String(e?.name||'error')+' at='+lastPhase+' code='+String(e?.code||'none').slice(0,24)+' category='+(/Telnyx|FFmpeg|FFprobe|espacio|incompleta|pistas|duración/i.exec(job.message)||['unknown'])[0]);
   }finally{
    if(directory){try{await rm(directory,{recursive:true,force:true});}catch(_){}}
    if(active?.jobId===job.jobId)active=null;
   }
  })();
  return{job:statusOf(job)};
 }
 return{get,start};
}
