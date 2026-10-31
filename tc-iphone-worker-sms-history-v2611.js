/* ToolControl iPhone 2.6.11 — worker SMS history from Android.
 * Read-only through authenticated Supabase RPC. Does NOT send SMS.
 */
(function(){
'use strict';
let memory={scope:'',rows:[],last:0,busy:false,error:''};
function scope(){
 try{return tcCloudOn&&tcClient&&tcWorkspace&&tcUser?.uid&&!tcDenied?tcWorkspace+'|'+tcUser.uid:'';}
 catch(_){return '';}
}
function principal(){
 try{return typeof tcIsCompanyPrincipal==='function' && tcIsCompanyPrincipal();}
 catch(_){return false;}
}
function guard(){
 const value=scope();
 if(memory.scope!==value)memory={scope:value,rows:[],last:0,busy:false,error:''};
 return value&&principal();
}
function fmt(s){
 try{return new Date(s).toLocaleString('es',{dateStyle:'short',timeStyle:'short'});}
 catch(_){return String(s||'');}
}
function status(s){
 return s==='delivered'?'✅ Entrega confirmada por operadora':
 s==='sent'?'📤 Android confirmó envío':
 s==='failed'?'❌ Fallo reportado por Android':
 '⏳ Pendiente de confirmar';
}
async function load(force){
 const value=scope();
 if(!guard()||memory.busy||!navigator.onLine||(!force&&Date.now()-memory.last<35000))return;
 memory.busy=true;memory.last=Date.now();
 try{
  const {data,error}=await tcClient.rpc('tc_sms_delivery_history_v25',{p_workspace:tcWorkspace,p_limit:60});
  if(error)throw error;
  if(scope()!==value)return;
  memory.rows=Array.isArray(data)?data:[];
  memory.error='';
 }catch(e){
  if(scope()===value)memory.error=String(e?.message||e).slice(0,150);
 }finally{
  memory.busy=false;
  if(scope()===value && page==='cloud')render();
 }
}
function view(){
 if(!guard())return '';
 let html='<div class="card" id="tcIphoneWorkerHistory2611"><h3>📨 Historial de SMS a trabajadores · V2.6.11</h3>'+
  '<p class="hint">Registros reales del Android autorizado. iPhone solo consulta el historial.</p>';
 if(memory.error)html+='<p role="alert" style="color:#ad2727">No fue posible leer el historial: '+esc(memory.error)+'</p>';
 const rows=memory.rows;
 if(!rows.length)html+='<p class="hint">No hay SMS registrados todavía en este historial.</p>';
 else{
  html+='<p class="hint">Últimos '+rows.length+' registros (máximo 60):</p>';
  for(const row of rows.slice(0,60)){
   html+='<div style="padding:10px 0;border-top:1px solid #e2ebf3">'+
    '<strong>👷 '+esc(String(row.recipient||'Trabajador'))+'</strong>'+
    '<p class="hint">'+esc(status(row.status))+' · '+esc(fmt(row.created_at))+'</p>'+
    (row.delivered_at?'<p class="hint">Acuse: '+esc(fmt(row.delivered_at))+'</p>':'')+
    '</div>';
  }
 }
 html+='<button type="button" class="btn outline block" onclick="tcIphoneWorkerHistoryReload2611()">↻ Actualizar historial de SMS</button>'+
 '<p class="hint">No recibir un acuse de entrega no significa que el trabajador no haya recibido el mensaje. El envío automático depende del Android asignado.</p></div>';
 return html;
}
window.tcIphoneWorkerHistoryReload2611=function(){void load(true);};
if(typeof tcCloudView==='function'){
 const old=tcCloudView;
 tcCloudView=function(...args){return old.apply(this,args)+view();};
}
if(typeof aboutView==='function'){
 const old=aboutView;
 aboutView=function(...args){
  return '<div class="card"><h3>ToolControl iPhone V2.6.11</h3>'+
   '<p>Inventario, QR y barras, agrupación, registro continuo, trabajadores, teléfonos, historial y seguimiento compartidos con Android V2.6.11.</p>'+
   '<p class="hint">iOS usa un escáner Safari/ZXing. Los SMS automáticos salen exclusivamente del Android autorizado.</p></div>'+
   old.apply(this,args);
 };
}
const oldRender=render;
render=function(...args){
 const value=oldRender.apply(this,args);
 if(page==='cloud'&&guard())setTimeout(()=>{void load(false);},0);
 return value;
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&page==='cloud')void load(true);});
window.addEventListener('online',()=>{if(page==='cloud')void load(true);});
})();
