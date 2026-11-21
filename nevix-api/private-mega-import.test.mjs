import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createMegaImport,validMegaLink} from './private-mega-import.mjs';
const link='https://mega.nz/file/abcdefgh#'+'a'.repeat(43);
const wait=async(f)=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('timeout');};
const mock=()=>{let parts=[],aborted=false;return {parts,get aborted(){return aborted;},async handle(req,res,url){
 let data=[];for await(const b of req)data.push(b);const body=Buffer.concat(data);let result={};
 if(url.pathname.endsWith('/start'))result={uploadId:'mock',chunkSize:4};
 else if(url.pathname.endsWith('/part')){parts.push(body);result={received:body.length};}
 else if(url.pathname.endsWith('/complete'))result={stored:true,autoProcessing:true,movieId:'movie'};
 else if(url.pathname.endsWith('/abort')){aborted=true;result={ok:true};}
 res.writeHead(200);res.end(JSON.stringify(result));return true;
 }}};
test('strict individual MEGA links only',()=>{assert(validMegaLink(link));assert(!validMegaLink('http://mega.nz/file/abcdefgh#'+'a'.repeat(43)));assert(!validMegaLink(link.replace('mega.nz','mega.nz.evil.com')));assert(!validMegaLink(link.replace('/file/','/folder/')));});
test('permission required and streamed exact bytes, duplicates prevented',async()=>{const uploads=mock();const service=createMegaImport({uploads,loadFile:async()=>({name:'test.mp4',size:10,download:()=>Readable.from([Buffer.from('abc'),Buffer.from('defghij')])})});
 assert.throws(()=>service.start({link,title:'Test'}));
 const j=service.start({link,title:'Test',authorized:true});
 assert.equal(service.start({link,title:'Test',authorized:true}).id,j.id);
 await wait(()=>service.list()[0].state==='stored');assert.equal(Buffer.concat(uploads.parts).toString(),'abcdefghij');assert.equal(service.list()[0].bytes,10);assert(!JSON.stringify(service.list()).includes(link));
});
test('incomplete transfer aborts rather than publishing',async()=>{const uploads=mock();const service=createMegaImport({uploads,loadFile:async()=>({name:'test.mp4',size:10,download:()=>Readable.from([Buffer.from('short')])})});service.start({link,title:'Test',authorized:true});await wait(()=>service.list()[0].state==='error');assert(uploads.aborted);});

import {createPrivateUploads} from './private-uploads.mjs';
test('integration with production multipart handler, correct metadata and bytes',async()=>{
 const bytes=Buffer.alloc(5*1024*1024+137,93);
 const chunks=[],calls=[];let stored=0;
 const client={async send(command){
  const name=command.constructor.name,input=command.input;calls.push(name);
  if(name==='CreateMultipartUploadCommand')return {UploadId:'fake-s3'};
  if(name==='UploadPartCommand'){chunks.push(Buffer.from(input.Body));return {ETag:'etag-'+input.PartNumber};}
  if(name==='CompleteMultipartUploadCommand'){stored=chunks.reduce((n,b)=>n+b.length,0);return {};}
  if(name==='HeadObjectCommand')return {ContentLength:stored};
  if(name==='AbortMultipartUploadCommand')return {};
  throw Error('unexpected command '+name);
 }};
 let metadata=null;
 const uploads=createPrivateUploads({client,bucket:'fake',reply:(res,status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));},readJson:async req=>{let data=[];for await(const b of req)data.push(b);return JSON.parse(Buffer.concat(data).toString());},onComplete:async(key,m)=>{metadata=m;return{autoProcessing:true,movieId:'fake-movie'};}});
 const service=createMegaImport({uploads,loadFile:async()=>({name:'sample.mp4',size:bytes.length,download:()=>Readable.from([bytes.subarray(0,1024),bytes.subarray(1024)])})});
 service.start({link,title:'Sample video',year:'2026',authorized:true});
 await wait(()=>['stored','error'].includes(service.list()[0].state));
 assert.equal(service.list()[0].state,'stored');assert.equal(chunks.length,2);assert.deepEqual(Buffer.concat(chunks),bytes);assert.deepEqual(metadata,{title:'Sample video',year:'2026'});assert(calls.includes('HeadObjectCommand'));
});
test('invalid type and excessive size never open multipart upload',async()=>{
 for(const bad of [{name:'sample.zip',size:10},{name:'sample.mp4',size:4*1024**3}]){
  let opened=0;const service=createMegaImport({uploads:{handle:async()=>{opened++;}},loadFile:async()=>bad});
  service.start({link,title:'Test',authorized:true});await wait(()=>service.list()[0].state==='error');assert.equal(opened,0);
 }
});
test('queued cancellation does not start storage transfer',async()=>{
 let resolve;const uploads=mock();const service=createMegaImport({uploads,loadFile:()=>new Promise(r=>resolve=r)});
 const a=service.start({link,title:'A video',authorized:true});
 const b=service.start({link:link.replace('abcdefgh','ijklmnop'),title:'B video',authorized:true});
 service.cancel(b.id);resolve({name:'a.mp4',size:4,download:()=>Readable.from([Buffer.from('abcd')])});
 await wait(()=>service.list().find(j=>j.id===a.id)?.state==='stored');assert.equal(service.list().find(j=>j.id===b.id).state,'cancelled');assert.equal(uploads.parts.length,1);
});
