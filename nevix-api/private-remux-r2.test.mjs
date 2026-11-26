import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRangeSource, createPrivateRemux, FFMPEG_BIN, FFPROBE_BIN } from './private-remux-r2.mjs';

function fakeR2(source) {
 const objects=new Map([['peliculas/source.mkv',source]]);
 const parts=new Map(), requests=[];
 const client={async send(command) {
  const i=command.input, name=command.constructor.name;
  requests.push({name,key:i.Key,range:i.Range});
  const bytes=objects.get(i.Key);
  switch(name) {
   case 'HeadObjectCommand': return {ContentLength:bytes.length};
   case 'GetObjectCommand': {
    let body=bytes,range;
    if(i.Range){
     const m=/^bytes=(\d+)-(\d*)$/.exec(i.Range);
     const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;
     assert.ok(start<=end);
     body=bytes.subarray(start,end+1);range='bytes '+start+'-'+end+'/'+bytes.length;
    }
    const stream=Readable.from([body]);stream.transformToByteArray=async()=>body;
    return {Body:stream,ContentLength:body.length,ContentRange:range};
   }
   case 'CreateMultipartUploadCommand': parts.set(i.Key,[]);return {UploadId:'test'};
   case 'UploadPartCommand': parts.get(i.Key)[i.PartNumber-1]=Buffer.from(i.Body);return {ETag:'part'+i.PartNumber};
   case 'CompleteMultipartUploadCommand': objects.set(i.Key,Buffer.concat(parts.get(i.Key)));return {};
   case 'AbortMultipartUploadCommand': parts.delete(i.Key);return {};
   default: throw Error(name);
  }
 }};
 return {client,objects,requests};
}
test('R2 input serves exact byte ranges and denies unknown paths',async()=>{
 const {client}=fakeR2(Buffer.from('0123456789'));
 const source=await openRangeSource(client,'test',{key:'peliculas/source.mkv',size:10});
 try{
  const response=await fetch(source.url,{headers:{Range:'bytes=3-5'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 3-5/10');
  assert.equal(await response.text(),'345');
  assert.equal((await fetch(source.url+'/wrong')).status,404);
  assert.equal((await fetch(source.url,{headers:{Range:'bytes=-3'}})).status,416);
 }finally{await source.close();}
});
test('MKV conversion streams R2 input, prefers Spanish, validates output and retains original',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nevix-test-'));
 try{
  const file=join(dir,'source.mkv');
  execFileSync(FFMPEG_BIN,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x120:r=15:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-f','lavfi','-i','sine=frequency=660:duration=4','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=spa','-threads','1','-y',file]);
  const original=await readFile(file);
  const {client,objects,requests}=fakeR2(original);
  let result;
  const done=new Promise((resolve,reject)=>{
   const service=createPrivateRemux({client,bucket:'test',finalize:async(entry,key,size)=>{result={key,size};resolve();},onFailure:async(_entry,msg)=>reject(Error(msg))});
   const started=service.start({id:'test-film',key:'peliculas/source.mkv',title:'Test',size:original.length,status:'processing'},{auto:true});
   assert.ok(started.job);
  });
  await done;
  const output=objects.get(result.key);
  assert.equal(output.length,result.size);assert.deepEqual(objects.get('peliculas/source.mkv'),original);
  assert.ok(requests.some(x=>x.name==='GetObjectCommand'&&x.range));
  const dest=join(dir,'output.mp4');await writeFile(dest,output);
  const info=JSON.parse(execFileSync(FFPROBE_BIN,['-v','error','-show_streams','-show_format','-of','json',dest],{encoding:'utf8'}));
  assert.equal(info.streams.find(x=>x.codec_type==='video').codec_name,'h264');
  assert.equal(info.streams.find(x=>x.codec_type==='audio').tags.language,'spa');
  assert.ok(Number(info.format.duration)>3.8);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('already compatible MP4 stays original and uses range layout check',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nevix-test-'));
 try{
  const file=join(dir,'source.mp4');
  execFileSync(FFMPEG_BIN,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x120:r=15:d=4','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart','-y',file]);
  const original=await readFile(file);const {client,objects,requests}=fakeR2(original);
  objects.set('peliculas/source.mp4',original);
  await new Promise((resolve,reject)=>{
   const service=createPrivateRemux({client,bucket:'test',finalize:()=>reject(Error('unexpected conversion')),finishWithoutRemux:resolve,onFailure:async(_entry,msg)=>reject(Error(msg))});
   assert.ok(service.start({id:'mp4',key:'peliculas/source.mp4',title:'Test',size:original.length,status:'processing'},{auto:true}).job);
  });
  assert.ok(requests.some(x=>x.range==='bytes=0-15'));
  assert.ok(!requests.some(x=>x.name==='CreateMultipartUploadCommand'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
