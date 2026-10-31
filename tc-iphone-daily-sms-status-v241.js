/* ToolControl iPhone V2.6.11 — estados del MISMO sistema SMS Android V2.6.11.
 * Solo lectura. Seguridad: RPC tc_morning_v269_iphone_status restringe datos por usuario.
 * Ni esta web ni el service worker pueden enviar SMS automaticos desde iOS.
 */
(function(){
'use strict';
let record={key:'',data:null,busy:false,at:0,error:''};
function key(){
 try{return tcCloudOn&&tcClient&&tcUser?.uid&&tcWorkspace&&!tcDenied
  ?String(tcWorkspace)+'|'+String(tcUser.uid):'';}catch(_){return '';}
}
function reset(){
 const k=key();
 if(k!==record.key)record={key:k,data:null,busy:false,at:0,error:''};
 return k;
}
async function refresh(force){
 const k=reset();
 if(!k||record.busy||!navigator.onLine||(!force&&Date.now()-record.at<22000))return;
 record.busy=true;record.at=Date.now();
 try{
  const {data,error}=await tcClient.rpc('tc_morning_v269_iphone_status',{p_workspace:tcWorkspace});
  if(error)throw error;
  if(k!==key())return;
  record.data=data||null;record.error='';
 }catch(e){if(k===key())record.error=String(e?.message||e).slice(0,145);}
 finally{
  record.busy=false;
  if(k===key()&&page==='cloud')render();
 }
}
function stateLabel(v){
 switch(v){
  case 'delivered':return '✅ Entrega confirmada por operadora';
  case 'requested':return '📤 Android confirmó el envío; sin acuse de entrega de operadora';
  case 'reserved':return '🟠 Solicitud reservada; aún sin resultado de Android';
  case 'failed':return '❌ Android informó un fallo de envío';
  default:return '⚪ Sin SMS registrado para ti hoy';
 }
}
function panel(){
 if(!reset())return '';
 const data=record.data;
 let html='<div class="card" id="tcIphoneMorningStatus269"><h3>📨 SMS matutinos · estado compartido V2.6.11</h3>'+
  '<p class="hint">Lee en Supabase los envíos realizados por el teléfono Android autorizado. iPhone no envía SMS por su cuenta.</p>';
 if(record.error)html+='<p role="alert" style="color:#a12727">No se pudo consultar el estado: '+esc(record.error)+'</p>';
 if(!data){
  html+='<p class="hint">Consulta el último estado del servidor para hoy.</p>';
 }else{
  html+='<p><strong>Fecha:</strong> '+esc(String(data.day||''))+'</p>'+
    '<p><strong>Mi mensaje:</strong> '+esc(stateLabel(data.self_status))+'</p>';
  if(data.self_attempt_no)html+='<p class="hint">Intento n.º '+Number(data.self_attempt_no)+'</p>';
  if(!data.self_opted)html+='<p class="hint" style="color:#a12828">⚠️ No tienes un teléfono internacional válido registrado. Solicita al principal que lo revise.</p>';
  if(data.is_primary||data.is_sender){
   const safe=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0;
   html+='<div class="stats" style="margin:12px 0">'+
    '<div><b>'+safe(data.total)+'</b><small>Destinatarios con intento hoy</small></div>'+
    '<div><b>'+safe(data.requested)+'</b><small>Envíos confirmados por Android</small></div>'+
    '<div><b>'+safe(data.delivered)+'</b><small>Entregas confirmadas</small></div>'+
    '<div><b>'+safe(data.failed)+'</b><small>Fallidos</small></div>'+
    '<div><b>'+safe(data.reserved)+'</b><small>Reservados</small></div></div>';
  }
 }
 html+='<button type="button" class="btn outline block" onclick="tcIphoneRefreshDailySmsV241()">↻ Actualizar ahora</button>'+
 '<p class="hint">Las operadoras pueden no enviar confirmación de entrega. «0 entregas confirmadas» NO significa que los SMS no hayan llegado. Para una prueba manual utiliza el Android autorizado.</p></div>';
 return html;
}
window.tcIphoneRefreshDailySmsV241=function(){void refresh(true);};
if(typeof tcCloudView==='function'){
 const prev=tcCloudView;
 tcCloudView=function(...args){return prev.apply(this,args)+panel();};
}
const oldRender=render;
render=function(...args){
 const value=oldRender.apply(this,args);
 if(page==='cloud'&&reset())setTimeout(()=>{void refresh(false);},0);
 return value;
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true);});
window.addEventListener('focus',()=>{void refresh(true);});
window.addEventListener('online',()=>{void refresh(true);});
setInterval(()=>{if(!document.hidden&&key()&&page==='cloud')void refresh(false);},45000);
})();