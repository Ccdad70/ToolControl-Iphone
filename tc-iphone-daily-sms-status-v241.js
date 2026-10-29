/* ToolControl iPhone v2.4.1: panel de diagnóstico LEÍDO desde Supabase.
 * iPhone no envía SMS en segundo plano. El Android autorizado es el emisor.
 * Cada administrador solo consulta su estado; el principal ve un total agregado.
 */
(function(){
'use strict';
let record={scope:'',data:null,busy:false,last:0,error:''};
function key(){
  try{return tcCloudOn&&tcWorkspace&&tcUser?.uid&&!tcDenied ? tcUser.uid+'|'+tcWorkspace : '';}
  catch(e){return '';}
}
function resetIfChanged(){
 const k=key();
 if(k!==record.scope)record={scope:k,data:null,busy:false,last:0,error:''};
 return k;
}
async function refresh(force){
 const k=resetIfChanged();
 if(!k||record.busy||!navigator.onLine||(!force&&Date.now()-record.last<45000))return;
 record.busy=true;record.last=Date.now();
 try{
   const {data,error}=await tcClient.rpc('tc_daily_admin_sms_status',{p_workspace:tcWorkspace});
   if(error)throw error;
   if(k!==key())return;
   record.data=data||null;record.error='';
 }catch(e){if(k===key())record.error=String(e?.message||e).slice(0,130);}
 finally{
   record.busy=false;
   if(k===key()&&page==='cloud')render();
 }
}
function statusLabel(status){
 switch(status){
   case 'requested':return '✅ Android aceptó la solicitud de SMS (entrega al destinatario no confirmada)';
   case 'reserved':return '🟠 Envío reservado; todavía sin confirmación de Android';
   case 'failed':return '❌ Android informó un fallo de envío';
   default:return '⚪ Sin intento de SMS registrado hoy';
 }
}
function panel(){
 if(!resetIfChanged())return '';
 const s=record.data;
 let html='<div class="card" id="tcIphoneDailySmsStatusV241"><h3>📲 SMS diario — 6:30 a. m.</h3>'+
   '<p class="hint">Diagnóstico del recordatorio para administradores, separado de los avisos de devolución de herramientas.</p>'+
   '<p class="hint"><b>El envío automático sale solo del Android encargado de SMS.</b> iPhone consulta el estado, pero no puede enviar SMS automáticamente con la aplicación cerrada.</p>';
 if(record.error)html+='<p class="hint" style="color:#9e2424">No se pudo consultar el estado: '+esc(record.error)+'</p>';
 if(s){
   html+='<p><b>Fecha:</b> '+esc(String(s.day||''))+'</p>'+
     '<p><b>Tu SMS:</b> '+esc(statusLabel(s.self_status))+'</p>';
   if(!s.self_opted)html+='<p class="hint">⚠️ Tu teléfono no figura como destinatario válido y habilitado para el SMS diario. Consulta al administrador principal.</p>';
   if(s.self_queued&&(!s.self_status))html+='<p class="hint">El aviso interno sí fue generado, pero todavía no consta ningún SMS solicitado.</p>';
   if(s.is_primary){
     const n=v=>Number.isFinite(Number(v))?Number(v):0;
     html+='<div class="stats" style="margin:12px 0">'+
       '<div><b>'+n(s.recipient_count)+'</b><small>Destinatarios habilitados</small></div>'+
       '<div><b>'+n(s.requested)+'</b><small>Solicitudes aceptadas por Android</small></div>'+
       '<div><b>'+n(s.failed)+'</b><small>Fallos</small></div>'+
       '<div><b>'+n(s.reserved)+'</b><small>Sin confirmación</small></div></div>';
     if(n(s.recipient_count)>0 && n(s.requested)===0 && n(s.failed)===0 && n(s.reserved)===0)
       html+='<p class="hint" style="color:#a42f20">⚠️ No hay intentos de SMS registrados hoy. Revisa en el Android encargado su permiso de SMS, conexión, alarma y el diagnóstico local.</p>';
   }
 }else html+='<p class="hint">Aún no se ha cargado el diagnóstico de hoy.</p>';
 html+='<button type="button" class="btn outline block" onclick="tcIphoneRefreshDailySmsV241()">↻ Actualizar estado de SMS</button>'+
   '<p class="hint">Una solicitud aceptada por Android no garantiza que la operadora haya entregado el mensaje.</p></div>';
 return html;
}
window.tcIphoneRefreshDailySmsV241=function(){void refresh(true);};
if(typeof tcCloudView==='function'){
 const previous=tcCloudView;
 tcCloudView=function(...args){const h=previous.apply(this,args);return h+panel();};
}
const originalRender=render;
render=function(...args){
 const result=originalRender.apply(this,args);
 if(page==='cloud'&&resetIfChanged())setTimeout(()=>void refresh(false),0);
 return result;
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true);});
window.addEventListener('focus',()=>{void refresh(true);});
setInterval(()=>{if(!document.hidden&&key())void refresh(false);},60000);
})();
