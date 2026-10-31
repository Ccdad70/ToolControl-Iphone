'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..');
const script=fs.readFileSync(root+'/tc-iphone-camera-pro-v2611.js','utf8');
const html=fs.readFileSync(root+'/index.html','utf8');
const cache=fs.readFileSync(root+'/sw.js','utf8');
new vm.Script(script);
assert(html.includes('tc-iphone-camera-pro-v2611.js'));
assert(cache.includes('tc-iphone-camera-pro-v2611.js'));
assert.equal((html.match(/width:\{ideal:1920\}/g)||[]).length,2,'ambos lectores piden alta resolución');
assert(html.includes('tcZxingLoadPromise=null;resolve(false)'),'el lector puede recuperarse si no hubo internet');
assert(html.includes('tcInventorySearchScanV24')===false || html.includes('tc-iphone-inventory-v24.js'));
assert(!script.includes('sendTextMessage')&&!script.includes('sendSmsRemindersNow'));
let toolbar=null,timers=[],constraints=[],calls=0;
const mediaTrack={
 readyState:'live',
 getCapabilities(){return {zoom:{min:1,max:5,step:.1},torch:true,focusMode:['continuous']};},
 getSettings(){return {zoom:1};},
 async applyConstraints(c){constraints.push(c);}
};
const stream={getVideoTracks(){return [mediaTrack];}};
function el(tag){
 const o={tag,style:{},children:[],parentNode:null,addEventListener(name,callback){this[name]=callback;},
  setAttribute(name,val){this[name]=val;},appendChild(x){this.children.push(x);x.parentNode=this;},
  append(...xs){xs.forEach(x=>this.appendChild(x));},
  insertBefore(x){this.appendChild(x);if(x.id==='tc-iphone-camera-pro-v2611')toolbar=x;},
  contains(){return true;},closest(){return null;}};
 return o;
}
const camera=el('div'),sheet=el('div'),video=el('video'),modal=el('div');
camera.parentNode=sheet;video.parentElement=camera;modal.contains=()=>true;
let ctxt={
 console,Date,Math,Number,Object,String,Promise,
 window:{},document:{
  createElement:el,getElementById(id){
   if(id==='scanModal')return modal;
   if(id==='scanVideo')return video;
   if(id==='tc-iphone-camera-pro-v2611')return toolbar;
   if(id==='tcProScanState2611')return toolbar?.children?.[0]||null;
   return null;
  }
 },
 scanStream:null,openBrowserScanner(){calls++;video.srcObject=stream;return Promise.resolve();},
 openContinuousBrowserScanner(){calls++;video.srcObject=stream;return Promise.resolve();},
 closeScan(){return true;},scanResult(){return true;},tcStartZxing(v,fn){fn('QR123');return true;},
 setTimeout(fn){timers.push(fn);return 1;},setInterval(fn){timers.push(fn);return timers.length;},
 clearInterval(){}
};
vm.createContext(ctxt);vm.runInContext(script,ctxt);
assert.equal(ctxt.window.tcIphoneCameraPro2611.version,'2.6.11');
assert.equal(ctxt.window.tcIphoneCameraPro2611.zoomRange({zoom:{min:1,max:3}}).max,3);
assert.equal(ctxt.window.tcIphoneCameraPro2611.zoomRange({zoom:false}),null);
ctxt.openBrowserScanner();
assert.equal(calls,1,'no abrir la cámara dos veces');
assert.ok(toolbar,'instala controles en el lector actual');
assert.ok(toolbar.children.some(x=>x.textContent==='🔦 Encender luz'),'linterna condicional');
assert.ok(constraints.some(x=>x.advanced?.[0]?.focusMode==='continuous'));
const zoomIn=toolbar.children.find(x=>x.textContent==='➕ Acercar');
const torch=toolbar.children.find(x=>x.textContent==='🔦 Encender luz');
(async()=>{
 await zoomIn.click({preventDefault(){}});
 await torch.click({preventDefault(){}});
 assert(constraints.some(x=>x.advanced?.[0]?.zoom>1),'zoom en el track de vídeo');
 assert(constraints.some(x=>x.advanced?.[0]?.torch===true),'linterna de cámara');
 console.log('OK iPhone V2.6.11: cámara alta resolución, zoom, autofocus, linterna, mismo lector/URL');
})().catch(e=>{console.error(e);process.exitCode=1;});
