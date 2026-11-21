import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
const MAX=4*1024**3-1;
const EXT=/\.(mp4|m4v|mkv|avi|mov|webm|wmv|mpeg|mpg|ts|m2ts)$/i;
export function validMegaLink(s){
 return typeof s==='string'&&/^https:\/\/(?:mega\.nz|mega\.co\.nz)\/file\/[A-Za-z0-9_-]{8}#[A-Za-z0-9_-]{43}$/.test(s);
}
export function createMegaImport({uploads,loadFile=async link=>{const {File}=await import('megajs');return File.fromURL(link).loadAttributes();}}){
 const jobs=new Map(), queue=[];let running=false;
 const view=j=>({id:j.id,title:j.title,state:j.state,bytes:j.bytes,size:j.size,message:j.message,movieId:j.movieId||null});
 const fail=(status,error,message)=>Object.assign(new Error(message),{status,error});
 async function upload(path,payload,raw=false){
  const data=raw?payload:Buffer.from(JSON.stringify(payload));
  const req=Readable.from([data]);req.method='POST';req.headers={'content-length':String(data.length),'content-type':raw?'application/octet-stream':'application/json'};
  let status,result;
  const res={writeHead(code){status=code;},end(body){result=JSON.parse(String(body));}};
  await uploads.handle(req,res,new URL('/api/private/upload/'+path,'http://localhost'));
  if(!(status>=200&&status<300))throw fail(status||502,'upload_failed',result?.message||'La transferencia no pudo completarse.');
  return result;
 }
 function start(data){
  if(data?.authorized!==true)throw fail(400,'authorization_required','Confirma que tienes permiso para guardar y reproducir el archivo.');
  const link=String(data.link||'').trim();
  if(!validMegaLink(link))throw fail(400,'invalid_mega_link','Introduce un enlace individual de MEGA con su clave completa, no una carpeta.');
  const title=String(data.title||'').trim(),year=String(data.year||'').trim();
  if(title.length<2||title.length>130||year&&!/^(19|20)\d{2}$/.test(year))throw fail(400,'invalid_metadata','Introduce un título válido y opcionalmente el año.');
  const fingerprint=createHash('sha256').update(link.split('#')[0].split('/').pop()).digest('hex');
  const existing=[...jobs.values()].find(x=>x.fingerprint===fingerprint&&!['error','cancelled'].includes(x.state));
  if(existing)return view(existing);
  if(queue.length>=10)throw fail(429,'queue_full','La cola de importación está llena.');
  for(const [id,j] of jobs){if(jobs.size<50)break;if(['stored','error','cancelled'].includes(j.state))jobs.delete(id);}
  if(jobs.size>=50)throw fail(429,'queue_full','La cola de importación está llena.');
  const job={id:randomUUID(),link,fingerprint,title,year,state:'queued',bytes:0,size:0,message:'En cola',cancel:false,stream:null};
  jobs.set(job.id,job);queue.push(job);void pump();return view(job);
 }
 async function pump(){
  if(running)return;running=true;
  try{while(queue.length){const j=queue.shift();if(j.cancel){j.link='';continue;}await run(j);}}finally{running=false;}
 }
 async function run(j){
  let session='',stream,timer,completed=false;
  try{
   j.state='connecting';j.message='Consultando archivo de MEGA';
   const file=await Promise.race([loadFile(j.link),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),30000);})]);clearTimeout(timer);j.link='';
   if(j.cancel)throw Error('cancelled');
   const name=String(file?.name||'');const size=Number(file?.size);
   if(!EXT.test(name)||!Number.isSafeInteger(size)||size<1||size>MAX){throw fail(400,'invalid_file','El enlace debe contener un único video compatible de menos de 4 GiB.');}
   j.size=size;
   const opened=await upload('start',{name,title:j.title,year:j.year,size});session=opened.uploadId;
   const block=Number(opened.chunkSize);if(!Number.isInteger(block)||block<1||block>16*1024**2)throw Error('invalid chunk size');
   j.state='transferring';j.message='Descargando y guardando por bloques';
   stream=file.download({maxConnections:1});j.stream=stream;
   const idle=()=>{clearTimeout(timer);timer=setTimeout(()=>stream.destroy(Error('timeout')),120000);};idle();
   let part=1,buffer=Buffer.allocUnsafe(block),used=0;
   async function flush(){clearTimeout(timer);const sent=await upload('part?id='+encodeURIComponent(session)+'&part='+part++,buffer.subarray(0,used),true);j.bytes+=sent.received;used=0;idle();}
   for await(const chunk of stream){
    idle();if(j.cancel)throw Error('cancelled');
    let pos=0;while(pos<chunk.length){let n=Math.min(block-used,chunk.length-pos);chunk.copy(buffer,used,pos,pos+n);used+=n;pos+=n;if(j.bytes+used>size)throw Error('size mismatch');if(used===block){await flush();if(j.cancel)throw Error('cancelled');}}
   }
   clearTimeout(timer);if(j.cancel)throw Error('cancelled');
   if(j.bytes+used!==size)throw Error('size mismatch');
   if(used)await flush();clearTimeout(timer);if(j.cancel)throw Error('cancelled');
   j.state='finalizing';j.message='Verificando almacenamiento';
   const result=await upload('complete',{uploadId:session});completed=result.stored===true;
   if(!completed)throw Error('not stored');
   j.state='stored';j.movieId=result.movieId;j.message=result.autoProcessing?'Guardado. Preparación audiovisual en curso; consulta el catálogo.':'Guardado. Consulta revisión de películas pendientes.';
  }catch(e){
   if(session&&!completed)try{await upload('abort',{uploadId:session});}catch{}
   j.state=j.cancel?'cancelled':'error';j.message=j.cancel?'Importación cancelada':e?.status===400&&e.error==='invalid_file'?e.message:'No se completó la importación. Revisa el enlace, disponibilidad y cuotas de MEGA o vuelve a probar.';
  }finally{clearTimeout(timer);stream?.destroy();j.stream=null;j.link='';}
 }
 function cancel(id){
  const j=jobs.get(String(id));if(!j)throw fail(404,'not_found','Importación no encontrada.');
  if(j.state==='finalizing'||j.state==='stored')throw fail(409,'already_finalizing','El archivo está finalizando o ya fue guardado. Consulta tu biblioteca.');
  if(['error','cancelled'].includes(j.state))return view(j);
  j.cancel=true;j.stream?.destroy(Error('cancelled'));if(j.state==='queued'){j.state='cancelled';j.message='Cancelada';j.link='';}
  return view(j);
 }
 return {start,list:()=>[...jobs.values()].reverse().map(view),cancel};
}
