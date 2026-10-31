/* ToolControl iPhone V2.6.11 — Camera/scanner parity for iOS Safari PWA.
 * Enhances the existing ZXing/BarcodeDetector decoders without replacing them.
 * Rear camera, autofocus/zoom/torch when the media track genuinely supports.
 * QR/1D reading, grouped inventory search, delivery and return remain unchanged.
 * iOS browsers do NOT provide Google Code Scanner / ML Kit; degrade safely.
 */
(function(){
'use strict';
const V='2.6.11', ID='tc-iphone-camera-pro-v2611';
let sequence=0, timer=null, track=null, currentZoom=1, lastCodeAt=Date.now(), autoZoom=true;
const allowed=(t)=>!!t && t.readyState!=='ended' && typeof t.applyConstraints==='function';
function capabilities(t){
  try{return t && typeof t.getCapabilities==='function' ? t.getCapabilities()||{}:{};}
  catch(_){return {};}
}
function zoomRange(caps){
  const z=caps?.zoom;
  if(!z || !Number.isFinite(Number(z.min)) || !Number.isFinite(Number(z.max)) || Number(z.max)<=Number(z.min))return null;
  return {min:Number(z.min),max:Math.min(Number(z.max),8),step:Math.max(.1,Number(z.step)||.1)};
}
function hasTorch(caps){return caps?.torch===true || Array.isArray(caps?.torch)&&caps.torch.includes(true);}
function hasFocus(caps){return Array.isArray(caps?.focusMode) && caps.focusMode.includes('continuous');}
function label(button,message){if(button)button.textContent=message;}
function feedback(message){
 const target=document.getElementById('tcProScanState2611');
 if(target)target.textContent=message;
}
function makeButton(text,action){
 const button=document.createElement('button');button.type='button';button.className='btn outline';
 button.textContent=text;button.style.cssText='flex:1 1 95px;min-height:38px;font-size:13px;padding:8px 7px;';
 button.addEventListener('click',event=>{event.preventDefault();void action(button);});
 return button;
}
async function applyAdvanced(t,values){
 if(!allowed(t))return false;
 try{await t.applyConstraints({advanced:[values]});return true;}
 catch(error){console.debug('iPhone no acepta restriccion de cámara:',error?.name||'unknown');return false;}
}
function currentTrack(){
 const video=document.getElementById('scanVideo');
 const stream=video?.srcObject;
 const tracks=typeof stream?.getVideoTracks==='function'?stream.getVideoTracks():[];
 return tracks[0] || (typeof scanStream!=='undefined'?scanStream?.getVideoTracks?.()[0]:null) || null;
}
async function adjustZoom(value){
 if(!allowed(track))return false;
 const range=zoomRange(capabilities(track));if(!range)return false;
 const target=Math.max(range.min,Math.min(range.max,value));
 const ok=await applyAdvanced(track,{zoom:target});
 if(ok){currentZoom=target;feedback('Zoom '+target.toFixed(1)+'× • enfoca el código dentro del recuadro');}
 return ok;
}
function stopTimer(){if(timer!==null){clearInterval(timer);timer=null;}}
function reset(){
 sequence++;stopTimer();track=null;currentZoom=1;lastCodeAt=Date.now();autoZoom=true;
}
function recognized(){lastCodeAt=Date.now();}
function initWhenReady(expected,attempt=0){
 if(expected!==sequence)return;
 const modal=document.getElementById('scanModal');
 const video=document.getElementById('scanVideo');
 if(!modal||!video)return;
 const candidate=currentTrack();
 if(!candidate){
  if(attempt<24)setTimeout(()=>initWhenReady(expected,attempt+1),250);
  return;
 }
 if(!allowed(candidate))return;
 track=candidate;
 const caps=capabilities(track),range=zoomRange(caps),torch=hasTorch(caps);
 const target=video.closest?.('.tc-guided-camera')||video.parentElement;
 if(!target||!target.parentNode)return;
 if(document.getElementById(ID))return;
 const controls=document.createElement('div');
 controls.id=ID;
 controls.style.cssText='display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 6px;background:#eff7fd;border-radius:12px;margin:10px 0;';
 const info=document.createElement('p');
 info.id='tcProScanState2611';info.setAttribute('role','status');
 info.style.cssText='flex:1 1 100%;font-size:12px;color:#28536f;margin:0;';
 info.textContent='Lector QR y barras listo • cámara trasera • ToolControl '+V;
 controls.appendChild(info);
 const actions={};
 if(range){
  const settings=track.getSettings?.()||{};
  currentZoom=Number.isFinite(Number(settings.zoom))?Number(settings.zoom):Math.max(1,range.min);
  actions.out=makeButton('➖ Alejar',async()=>{autoZoom=false;await adjustZoom(currentZoom-.5);});
  actions.in=makeButton('➕ Acercar',async()=>{autoZoom=false;await adjustZoom(currentZoom+.5);});
  actions.auto=makeButton('🎯 Zoom automático',async b=>{
   autoZoom=!autoZoom;
   label(b,autoZoom?'🎯 Zoom automático':'🎯 Zoom manual');
   if(autoZoom){lastCodeAt=Date.now();await adjustZoom(Math.max(1,range.min));}
   else feedback('Control de zoom manual activado');
  });
  controls.append(actions.out,actions.in,actions.auto);
 }else{
  info.textContent+=' • el iPhone no permite controlar el zoom desde Safari';
 }
 if(torch){
  let on=false;
  actions.torch=makeButton('🔦 Encender luz',async b=>{
   const next=!on;
   if(await applyAdvanced(track,{torch:next})){on=next;label(b,on?'🔦 Apagar luz':'🔦 Encender luz');}
   else feedback('La linterna no está disponible en este modo de cámara');
  });
  controls.appendChild(actions.torch);
 }
 target.parentNode.insertBefore(controls,target.nextSibling);
 if(hasFocus(caps))void applyAdvanced(track,{focusMode:'continuous'});
 stopTimer();
 if(range){
  timer=setInterval(()=>{
   if(expected!==sequence || !track || !document.getElementById(ID)){stopTimer();return;}
   if(!autoZoom || Date.now()-lastCodeAt<8500 || currentZoom>=Math.min(2.6,range.max))return;
   lastCodeAt=Date.now();
   void adjustZoom(currentZoom+.3);
  },2500);
 }
}
function scannerStart(original,args){
 reset();const expected=sequence;
 const result=original.apply(this,args);
 // Do not replace the existing recognition callbacks or start the camera twice.
 initWhenReady(expected);
 return result;
}
if(typeof openBrowserScanner==='function'){
 const old=openBrowserScanner;
 openBrowserScanner=function(...args){return scannerStart.call(this,old,args);};
}
if(typeof openContinuousBrowserScanner==='function'){
 const old=openContinuousBrowserScanner;
 openContinuousBrowserScanner=function(...args){return scannerStart.call(this,old,args);};
}
if(typeof closeScan==='function'){
 const old=closeScan;
 closeScan=function(...args){
  reset();
  return old.apply(this,args);
 };
}
if(typeof scanResult==='function'){
 const old=scanResult;
 scanResult=function(message,kind,...args){
  if(kind==='ok')recognized();
  return old.call(this,message,kind,...args);
 };
}
if(typeof tcStartZxing==='function'){
 const old=tcStartZxing;
 tcStartZxing=function(video,onDecoded){
  return old.call(this,video,function(code){recognized();onDecoded(code);});
 };
}
window.tcIphoneCameraPro2611={version:V,capabilities,zoomRange,recognized};
})();