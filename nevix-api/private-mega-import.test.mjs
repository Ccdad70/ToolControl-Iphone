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
