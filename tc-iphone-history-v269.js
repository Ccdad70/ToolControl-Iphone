/* ToolControl iPhone V2.6.9 — historial compartido como Android.
 * Solo principal puede solicitar borrado; requiere BORRAR HISTORIAL y RPC protegida.
 * El corte de historial en Supabase evita que operaciones viejas revivan los registros.
 * El modulo NO ejecuta eliminaciones automaticamente al cargar.
 */
(function(){
'use strict';
let data269={key:'',cutoff:null,stamp:0,busy:false,resetting:false,error:''};
function key(){
 try{return tcCloudOn&&tcClient&&tcWorkspace&&tcUser?.uid&&!tcDenied
  ?String(tcWorkspace)+'|'+String(tcUser.uid):'';}catch(_){return '';}
}
function principal(){
 try{return typeof tcIsCompanyPrincipal==='function'&&tcIsCompanyPrincipal();}
 catch(_){return false;}
}
function scope(){
 const k=key();
 if(k!==data269.key)data269={key:k,cutoff:null,stamp:0,busy:false,resetting:false,error:''};
 return k;
}
async function refresh(force){
 const k=scope();
 if(!k||data269.busy||data269.resetting||!navigator.onLine||(!force&&Date.now()-data269.stamp<45000))return;
 data269.busy=true;data269.stamp=Date.now();
 try{
  const {data,error}=await tcClient.rpc('tc_history_v263_cutoff',{p_workspace:tcWorkspace});
  if(error)throw error;
  if(k!==key())return;
  data269.cutoff=typeof data==='string'&&Number.isFinite(Date.parse(data))?Date.parse(data):null;
  data269.error='';
 }catch(e){if(k===key())data269.error=String(e?.message||e).slice(0,130);}
 finally{
  data269.busy=false;
  if(k===key()&&page==='history')render();
 }
}
window.tcIphoneResetHistory269=async function(){
 const k=scope();
 if(!k||!principal()||data269.resetting)return toast('Solo el administrador principal puede borrar el historial.');
 if(!navigator.onLine)return toast('Debes estar conectado a Supabase.');
 if(typeof tcOps!=='undefined' && tcOps.length)return toast('Sincroniza los cambios pendientes antes de borrar el historial.');
 const confirmed=prompt('Accion irreversible para TODOS los dispositivos. Escribe BORRAR HISTORIAL:');
 if(confirmed!=='BORRAR HISTORIAL')return toast('Borrado cancelado: confirmacion incorrecta.');
 if(!confirm('Eliminar todos los movimientos historicos compartidos de esta empresa. No borra herramientas ni trabajadores. ¿Confirmas?'))return;
 data269.resetting=true;
 try{
  const {data,error}=await tcClient.rpc('tc_history_v263_reset',{p_workspace:tcWorkspace,p_confirm:'BORRAR HISTORIAL'});
  if(error)throw error;
  if(k!==key())return;
  data269.cutoff=Date.now();data269.stamp=Date.now();
  // Evitar presentar historial obsoleto del cache local; la verdad es Supabase.
  if(typeof tcRemote!=='undefined'&&Array.isArray(tcRemote.history))tcRemote.history=[];
  if(typeof state!=='undefined'&&Array.isArray(state.history))state.history=[];
  if(typeof tcSaved!=='undefined'&&Array.isArray(tcSaved.history))tcSaved.history=[];
  if(typeof tcRefresh==='function')await tcRefresh();
  toast('✓ Historial compartido borrado ('+Number(data||0)+' movimientos).');
 }catch(e){if(k===key())toast('No se pudo borrar: '+String(e?.message||e).slice(0,150));}
 finally{
  data269.resetting=false;
  if(k===key()&&page==='history')render();
 }
};
if(typeof historyView==='function'){
 const previousHistory=historyView;
 historyView=function(...args){
  const k=scope(),cutoff=data269.cutoff;
  const original=state.history;
  let content='';
  // Solamente filtrar la vista; no mutar datos del inventario o cola pendientes.
  if(k&&cutoff!==null&&Array.isArray(original)){
   state.history=original.filter(entry=>{
    const t=Date.parse(entry?.at||'');
    return Number.isFinite(t)&&t>cutoff;
   });
  }
  try{content=previousHistory.apply(this,args);}
  finally{state.history=original;}
  if(!k)return content;
  let panel='<div class="card"><h3>🗂️ Historial compartido V2.6.9</h3>'+
   '<p class="hint">Los movimientos son comunes en Android y iPhone.</p>';
  if(data269.error)panel+='<p style="color:#a12727">'+esc(data269.error)+'</p>';
  if(principal())panel+='<p class="hint">Solo el administrador principal puede borrar el historial. Las herramientas y sus asignaciones no se eliminan.</p>'+
   '<button class="btn outline block" type="button" style="color:#a42525" onclick="tcIphoneResetHistory269()"'+(data269.resetting?' disabled':'')+'>🗑️ Borrar historial compartido</button>';
  panel+='<button class="btn outline block" type="button" onclick="tcIphoneHistoryReload269()">↻ Actualizar historial</button></div>';
  return panel+content;
 };
}
window.tcIphoneHistoryReload269=function(){
 if(typeof tcRefresh==='function')void tcRefresh();
 void refresh(true);
};
const oldRender=render;
render=function(...args){
 const result=oldRender.apply(this,args);
 if(page==='history'&&scope())setTimeout(()=>{void refresh(false);},0);
 return result;
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&page==='history')void refresh(true);});
window.addEventListener('online',()=>{if(page==='history')void refresh(true);});
})();