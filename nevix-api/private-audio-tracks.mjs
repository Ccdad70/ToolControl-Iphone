
import {GetObjectCommand, PutObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand} from '@aws-sdk/client-s3';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm,stat,statfs,open as openFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {FFMPEG_BIN,FFPROBE_BIN} from './private-remux-r2.mjs';

const MAX_TRACKS=12;
const MAX_MEDIA_BYTES=4*1024*1024*1024;
const PART=5*1024*1024;
const PREFIX='nevix-audio/';
const META='nevix-meta/audio-tracks/';
const TOKEN_MS=6*60*60*1000;
const txt=x=>String(x||'').trim();
const filmIdOk=id=>/^priv-[a-f0-9]{24}$/.test(id);
const notFound=e=>e?.name==='NoSuchKey'||e?.name==='NotFound'||Number(e?.$metadata?.httpStatusCode)===404;
function identifyLanguage(code,title){
 const normalized=txt(code).toLowerCase().replace(/_/g,'-');
 const titleLower=txt(title).toLowerCase();
 const latin=/latino|latin american|latam|es-419|es-mx|mexic/i.test(normalized+' '+titleLower);
 const castilian=/castellano|españa|spanish spain|es-es/i.test(normalized+' '+titleLower);
 if(/^(spa|es|esl|es-)/.test(normalized)||/español|spanish|castellano|latino/i.test(titleLower))
  return {code:'es',priority:latin?0:castilian?2:1,label:latin?'Español latino':castilian?'Español (España)':'Español'};
 if(/^(eng|en|en-)/.test(normalized)||/\benglish\b|ingl[eé]s/i.test(titleLower))
  return {code:'en',priority:3,label:'Inglés'};
 if(/^(por|pt|pt-)/.test(normalized))return {code:'pt',priority:4,label:'Portugués'};
 if(/^(fra|fre|fr|fr-)/.test(normalized))return {code:'fr',priority:4,label:'Francés'};
 return {code:normalized||'und',priority:5,label:txt(title)||'Idioma sin identificar'};
}
function inspect(path){
 return new Promise((resolve,reject)=>{
  execFile(FFPROBE_BIN,['-v','error','-show_entries',
   'format=duration:stream=index,codec_type,codec_name,channels:stream_tags=language,title,handler_name:stream_disposition=default',
   '-of','json',path],{timeout:90000,maxBuffer:1024*1024},(err,out)=>{
   if(err)return reject(Error('FFprobe no pudo revisar el audio del archivo original.'));
   try{resolve(JSON.parse(out));}catch(_){reject(Error('El análisis de pistas devolvió datos inválidos.'));}
  });
 });
}
function convertAudio(source,index,target){
 return new Promise((resolve,reject)=>{
  const args=['-hide_banner','-nostdin','-loglevel','error','-y','-threads','1','-i',source,
   '-map','0:'+index,'-vn','-sn','-dn','-c:a','aac','-b:a','160k','-ac','2','-af','aresample=async=1:first_pts=0',
   '-movflags','+faststart','-f','ipod',target];
  const proc=spawn(FFMPEG_BIN,args,{stdio:['ignore','ignore','pipe']});
  let errMessage='',finished=false;
  const timeout=setTimeout(()=>{try{proc.kill('SIGKILL');}catch(_){}},45*60*1000);
  proc.stderr.on('data',d=>{errMessage=(errMessage+String(d)).slice(-1200);});
  proc.once('error',()=>{if(finished)return;finished=true;clearTimeout(timeout);reject(Error('FFmpeg no se pudo iniciar.'));});
  proc.once('close',code=>{
   if(finished)return;finished=true;clearTimeout(timeout);
   if(code!==0)reject(Error('No se pudo extraer la pista '+index+' del archivo original.'));
   else resolve();
  });
 });
}
async function multipartFile(client,bucket,key,path,size){
 const fd=await openFile(path,'r');
 let id='',done=false;
 try{
  if(size<=PART){
   const bytes=Buffer.alloc(size);const {bytesRead}=await fd.read(bytes,0,size,0);
   if(bytesRead!==size)throw Error('No se pudo leer la pista completa.');
   await client.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'audio/mp4',Body:bytes,ContentLength:size}));
   return;
  }
  const started=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:'audio/mp4'}));
  id=started.UploadId;if(!id)throw Error('R2 no aceptó la nueva pista.');
  const parts=[];let pos=0,num=0;
  while(pos<size){
   const amount=Math.min(PART,size-pos),bytes=Buffer.alloc(amount);
   let read=0;while(read<amount){const r=await fd.read(bytes,read,amount-read,pos+read);if(!r.bytesRead)break;read+=r.bytesRead;}
   if(read!==amount)throw Error('Una parte del audio no se pudo leer.');
   const result=await client.send(new UploadPartCommand({Bucket:bucket,Key:key,UploadId:id,PartNumber:++num,Body:bytes,ContentLength:amount}));
   if(!result.ETag)throw Error('R2 no confirmó una parte de audio.');
   parts.push({ETag:result.ETag,PartNumber:num});pos+=amount;
  }
  await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:id,MultipartUpload:{Parts:parts}}));done=true;
 }finally{
  await fd.close();
  if(id&&!done)try{await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:id}));}catch(_){}
 }
}
export function createPrivateAudioTracks({client,bucket,admin,family,origin,findFilm,reply}){
 const jobs=new Map(),queue=[];
 let active=null;
 const dataKey=id=>META+id+'.json';
 const fileKey=(id,index)=>PREFIX+id+'/'+index+'.m4a';
 const token=(id,index,expires)=>createHmac('sha256',txt(process.env.R2_SECRET_ACCESS_KEY)+':'+admin+':'+family)
  .update('NEVIX-TRACK-V1:'+id+':'+index+':'+expires).digest('hex');
 function urlFor(id,index){
  const expires=Date.now()+TOKEN_MS;
  return 'https://nevix-catalog-api.onrender.com/api/private/audio/file?id='+encodeURIComponent(id)+
   '&track='+index+'&expires='+expires+'&sig='+token(id,index,expires);
 }
 async function read(id){
  try{
   const x=await client.send(new GetObjectCommand({Bucket:bucket,Key:dataKey(id)}));
   return JSON.parse(await x.Body.transformToString());
  }catch(e){if(notFound(e))return null;throw e;}
 }
 async function save(id,data){
  await client.send(new PutObjectCommand({Bucket:bucket,Key:dataKey(id),ContentType:'application/json',
   Body:JSON.stringify({...data,updatedAt:new Date().toISOString()})}));
 }
 async function status(id){
  if(!filmIdOk(id))throw {status:400,error:'invalid_movie'};
  const film=await findFilm(id);
  if(!film)return {state:'not_found',tracks:[]};
  const persisted=await read(id);
  if(!persisted||![film.key,film.backupKey].includes(persisted.sourceKey))return {state:'not_scanned',tracks:[],sourceAvailable:true};
  const job=jobs.get(id);
  const state=job&&!['completed','failed'].includes(job.state)?job.state:persisted.state==='processing'?'interrupted':persisted.state;
  if(state!=='ready')return {state:state||'not_scanned',percent:job?.percent||0,message:job?.message||persisted.message||'',tracks:[]};
  return {state:'ready',tracks:(persisted.tracks||[]).map(x=>({
   index:x.index,language:x.language,label:x.label,channels:x.channels,default:x.default,
   url:x.ready?urlFor(id,x.index):null
  })),preferredLanguage:(persisted.tracks||[]).some(x=>x.language==='es')?'es':'original'};
 }
 function start(id){
  if(!filmIdOk(id))throw {status:400,error:'invalid_movie'};
  const existing=jobs.get(id);
  if(existing&&!['completed','failed'].includes(existing.state))return {queued:true,state:existing.state};
  const job={id,state:'queued',percent:0,message:'En cola para analizar pistas de audio.',createdAt:Date.now()};
  jobs.set(id,job);queue.push(job);
  while(jobs.size>20){const first=[...jobs].find(([k,v])=>['completed','failed'].includes(v.state));if(!first)break;jobs.delete(first[0]);}
  void pump();
  return {queued:true,state:'queued'};
 }
 async function pump(){
  if(active||!queue.length)return;
  const job=queue.shift();active=job;
  let dir='';
  try{
   const film=await findFilm(job.id);
   if(!film)throw Error('La película ya no está disponible.');
   let srcKey=film.backupKey&&film.backupKey.startsWith('peliculas/')?film.backupKey:film.key;
   let head;
   try{head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:srcKey}));}
   catch(e){
    if(srcKey===film.key||!notFound(e))throw e;
    srcKey=film.key;
    head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:srcKey}));
   }
   const size=Number(head.ContentLength)||0;
   if(size<100||size>MAX_MEDIA_BYTES)throw Error('El archivo no cabe en el límite de análisis de 4 GiB.');
   const tmp=await statfs(tmpdir());
   if(Number(tmp.bavail)*Number(tmp.bsize)<size+512*1024*1024)throw Error('Render no tiene espacio temporal suficiente para analizar esta película.');
   dir=await mkdtemp(join(tmpdir(),'nevix-audio-'));
   const input=join(dir,'original'+(srcKey.match(/\.[a-z0-9]{2,5}$/i)?.[0]||'.mp4'));
   job.state='downloading';job.message='Descargando copia temporal para identificar idiomas.';
   await save(job.id,{state:'processing',sourceKey:srcKey,message:job.message});
   const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:srcKey}));
   if(!response?.Body||typeof response.Body.pipe!=='function')throw Error('R2 no pudo entregar el archivo original.');
   await pipeline(response.Body,createWriteStream(input,{flags:'wx'}));
   const received=await stat(input);
   if(received.size!==size)throw Error('El archivo original llegó incompleto.');
   job.state='inspecting';job.percent=20;job.message='Identificando idiomas y pistas originales.';
   const media=await inspect(input);
   const sounds=(media.streams||[]).filter(x=>x.codec_type==='audio').slice(0,MAX_TRACKS);
   const tracks=sounds.map((x,i)=>{
    const detected=identifyLanguage(x.tags?.language,x.tags?.title||x.tags?.handler_name);
    return {index:Number(x.index),language:detected.code,label:detected.code==='und'?'Pista '+(i+1):detected.label,
     priority:detected.priority,default:Number(x.disposition?.default)===1,channels:Number(x.channels)||0,ready:false};
   });
   if(!tracks.length){
    await save(job.id,{state:'ready',sourceKey:srcKey,tracks:[],message:'Este video no contiene pistas de audio.'});
    job.state='completed';job.percent=100;return;
   }
   for(let i=0;i<tracks.length;i++){
    const track=tracks[i];
    const output=join(dir,'pista-'+track.index+'.m4a');
    job.state='extracting';job.percent=20+Math.round(i/tracks.length*70);
    job.message='Preparando audio '+(i+1)+' de '+tracks.length+' ('+track.label+').';
    await convertAudio(input,track.index,output);
    const info=await stat(output);
    if(info.size<1000||info.size>512*1024*1024)throw Error('La pista procesada tiene un tamaño no válido.');
    await multipartFile(client,bucket,fileKey(job.id,track.index),output,info.size);
    const verified=await client.send(new HeadObjectCommand({Bucket:bucket,Key:fileKey(job.id,track.index)}));
    if(Number(verified.ContentLength)!==info.size)throw Error('R2 no confirmó la pista extraída.');
    track.ready=true;
    await rm(output,{force:true});
   }
   await save(job.id,{state:'ready',sourceKey:srcKey,tracks,
    message:'Se identificaron '+tracks.length+' pista(s) de audio. Archivos originales conservados.'});
   job.state='completed';job.percent=100;job.message='Idiomas disponibles.';
   console.log('NÉVIX audio inspection: complete tracks='+tracks.length+' spanish='+tracks.some(x=>x.language==='es'));
  }catch(e){
   job.state='failed';job.message=txt(e?.message||'Error de análisis').slice(0,200);
   console.error('NÉVIX audio inspection failed: '+txt(e?.name||'Error').slice(0,40));
   const film=await findFilm(job.id).catch(()=>null);
   if(film)await save(job.id,{state:'failed',sourceKey:film.backupKey||film.key,tracks:[],message:job.message}).catch(()=>{});
  }finally{
   if(dir)try{await rm(dir,{recursive:true,force:true});}catch(_){}
   active=null;void pump();
  }
 }
 async function serve(req,res,url){
  if(!['GET','HEAD'].includes(req.method))return reply(res,405,{error:'method_not_allowed'});
  const id=txt(url.searchParams.get('id')),index=Number(url.searchParams.get('track')),expires=txt(url.searchParams.get('expires')),sig=txt(url.searchParams.get('sig'));
  const until=Number(expires);
  if(!filmIdOk(id)||!Number.isInteger(index)||index<0||index>100||!/^\d{13}$/.test(expires)||!/^[a-f0-9]{64}$/.test(sig)
    ||until<=Date.now()||until>Date.now()+TOKEN_MS+2000
    ||!timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(token(id,index,until),'hex')))
    return reply(res,403,{error:'audio_token_expired'});
  const film=await findFilm(id);
  const data=await read(id);
  if(!film||data?.state!=='ready'||![film.key,film.backupKey].includes(data.sourceKey)||!data.tracks?.some(x=>x.index===index&&x.ready))
    return reply(res,404,{error:'audio_unavailable'});
  const key=fileKey(id,index),range=txt(req.headers.range);
  if(range&&(!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)||range.length>70))return reply(res,416,{error:'invalid_range'});
  const headers={'content-type':'audio/mp4','cache-control':'private, no-store','accept-ranges':'bytes',
   'access-control-allow-origin':origin,'access-control-expose-headers':'Content-Range, Content-Length, Accept-Ranges, Content-Type',
   'x-content-type-options':'nosniff','content-disposition':'inline'};
  if(req.method==='HEAD'){
   const h=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
   headers['content-length']=String(h.ContentLength||0);
   res.writeHead(200,headers);res.end();return true;
  }
  const stream=await client.send(new GetObjectCommand({Bucket:bucket,Key:key,...(range?{Range:range}:{})}));
  if(stream.ContentRange)headers['content-range']=String(stream.ContentRange);
  if(Number.isSafeInteger(Number(stream.ContentLength)))headers['content-length']=String(stream.ContentLength);
  res.writeHead(stream.ContentRange?206:200,headers);
  stream.Body.once('error',()=>{try{res.destroy();}catch(_){}});
  res.once('close',()=>{if(!res.writableEnded)try{stream.Body.destroy();}catch(_){}});
  stream.Body.pipe(res);
  return true;
 }
 return {status,start,serve};
}
