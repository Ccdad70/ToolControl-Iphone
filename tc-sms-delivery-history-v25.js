/* ToolControl V2.5: historial SMS consultable, sin PUSH ni confirmación de lectura. */
(function(){
'use strict';
let cache={scope:'',rows:[],allowed:false,loading:false,last:0,error:''};
function key(){
 try{return tcCloudOn&&tcWorkspace&&tcUser?.uid&&!tcDenied?tcWorkspace+'|'+tcUser.uid:'';}
 catch(e){return '';}
}
function reconcile(){
 const scope=key();
 if(cache.scope!==scope)cache={scope,rows:[],allowed:false,loading:false,last:0,error:''};
 return scope;
}
function label(status){
 switch(status){
 case 'delivered':return '🟢 Entregado (confirmado por operadora)';
 case 'requested':case 'sent':return '🔵 Enviado (sin entrega confirmada)';
 case 'reserved':return '🟠 Pendiente de respuesta Android';
 case 'failed':return '🔴 Fallido';
 case 'unconfirmed':return '⚪ Sin confirmación de entrega';
 default:return '⚪ Estado desconocido';
 }
}
async function refresh(force){
 const scope=reconcile();
 if(!scope||cache.loading||!navigator.onLine||(!force&&Date.now()-cache.last<45000))return;
 cache.loading=true;cache.last=Date.now();
 try{
   const {data,error}=await tcClient.rpc('tc_sms_delivery_history_v25',
     {p_workspace:tcWorkspace,p_limit:60});
   if(error)throw error;
   if(scope!==reconcile())return;
   cache.allowed=true;cache.rows=Array.isArray(data)?data:[];
   cache.error='';
 }catch(e){
   if(scope===reconcile()){
     cache.allowed=false;
     cache.error=String(e?.message||e).slice(0,130);
   }
 }finally{
   cache.loading=false;
   if(scope===reconcile()&&page==='cloud')render();
 }
}
function panel(){
 if(!reconcile()||!cache.allowed)return '';
 const rows=cache.rows;
 let html='<section class="card" id="tcSmsHistoryV25"><h3>📨 Historial de SMS · V2.5</h3>'+
 '<p class="hint">Solo lo consultan el administrador principal y el encargado de SMS. Entregado significa acuse de la operadora, nunca leído por la persona.</p>';
 if(!rows.length)html+='<p class="hint">Aún no hay resultados registrados.</p>';
 else{
  html+='<div style="max-height:370px;overflow:auto">';
  for(const row of rows){
    const when=row.created_at?new Date(row.created_at).toLocaleString('es-US'):'—';
    const delivered=row.delivered_at?new Date(row.delivered_at).toLocaleString('es-US'):'';
    const phone=String(row.phone||'').trim();
    const type=row.kind==='matutino'?'🌅 Matutino':'🔧 Devolución';
    html+='<div style="border-bottom:1px solid #e5e7eb;padding:12px 0">'+
       '<b>'+esc(type)+'</b> · '+esc(phone||String(row.recipient||''))+
       '<br><small>'+esc(label(row.status))+'</small>'+
       '<br><small>Envío: '+esc(when)+'</small>'+
       (delivered?'<br><small>Entrega: '+esc(delivered)+'</small>':'')+
       '</div>';
  }
  html+='</div>';
 }
 html+='<button class="btn outline block" onclick="tcSmsHistoryRefreshV25()">↻ Actualizar historial SMS</button>'+
 '<p class="hint">Si la operadora no devuelve un acuse, la entrega queda sin confirmar. No se reenvía automáticamente por esa ausencia.</p></section>';
 return html;
}
window.tcSmsHistoryRefreshV25=()=>{void refresh(true);};
if(typeof tcCloudView==='function'){
 const previous=tcCloudView;
 tcCloudView=function(...args){return previous.apply(this,args)+panel();};
}
const oldRender=render;
render=function(...args){
 const val=oldRender.apply(this,args);
 if(page==='cloud'&&reconcile())setTimeout(()=>void refresh(false),0);
 return val;
};
setInterval(()=>{if(!document.hidden&&reconcile())void refresh(false);},60000);
window.addEventListener('focus',()=>{if(reconcile())void refresh(true);});
})();