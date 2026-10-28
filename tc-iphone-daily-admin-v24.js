/* ToolControl V2.4 — recordatorio diario a administradores (06:30 America/New_York).
 * La base de datos valida permisos; nunca confiar solo en ocultar botones.
 * Entrega dentro de ToolControl, no promete SMS ni push externo. */
(function(){
'use strict';
let cache={scope:'',settings:null,todayMessage:null,busy:false,saving:false,lastFetch:0,error:''};
function scope(){
  try {return tcCloudOn&&tcClient&&tcUser?.uid&&tcWorkspace&&!tcDenied ? tcUser.uid+'|'+tcWorkspace : '';}
  catch(e){return '';}
}
function isPrimary(){
  try {return !!tcIsCompanyPrincipal()&&String(tcUser?.email||tcUser?.contact_email||'').toLowerCase()==='toolcontrolgaylor@gmail.com';}
  catch(e){return false;}
}
function todayInEastern(){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  catch(e){return new Date().toISOString().slice(0,10);}
}
function reconcile(){
  const s=scope();
  if(s!==cache.scope)cache={scope:s,settings:null,todayMessage:null,busy:false,saving:false,lastFetch:0,error:''};
  return s;
}
async function load(force){
  const current=reconcile();
  if(!current||cache.busy||!navigator.onLine||(!force&&Date.now()-cache.lastFetch<30000))return;
  cache.busy=true;cache.lastFetch=Date.now();
  try{
    const [config,delivered]=await Promise.all([
      tcClient.from('tc_daily_admin_config').select('message,enabled,send_time,time_zone').eq('workspace_id',tcWorkspace).maybeSingle(),
      tcClient.from('tc_daily_admin_messages').select('message,local_day,created_at').eq('workspace_id',tcWorkspace).eq('user_id',tcUser.uid).order('local_day',{ascending:false}).limit(1)
    ]);
    if(config.error)throw config.error;
    if(delivered.error)throw delivered.error;
    if(current!==scope())return;
    cache.settings=config.data||null;
    const latest=Array.isArray(delivered.data)?delivered.data[0]:null;
    cache.todayMessage=latest&&latest.local_day===todayInEastern()?latest:null;
    cache.error='';
  }catch(e){if(current===scope())cache.error=String(e?.message||e).slice(0,140);}
  finally{
    cache.busy=false;
    if(current===scope()&&(page==='home'||page==='cloud'))render();
  }
}
function homeCard(){
  if(!reconcile()||!cache.todayMessage)return '';
  return '<div class="card" style="border-left:5px solid #147bc8;background:linear-gradient(145deg,#eff8ff,#fff)">'+
    '<h3>⏰ Recordatorio de las 6:30 a. m.</h3>'+
    '<p style="white-space:pre-wrap;line-height:1.55">'+esc(cache.todayMessage.message)+'</p>'+
    '<small style="color:#55738e">Mensaje enviado por ToolControl a tus avisos internos de administrador.</small></div>';
}
function settingsCard(){
  if(!reconcile())return '';
  const p=isPrimary(),c=cache.settings;
  let html='<div class="card" id="tcDailyAdminReminderCard"><h3>⏰ Recordatorio diario a administradores</h3>'+
    '<p class="hint">Todos los días a las <b>6:30 a. m.</b> (hora del este, ajustada al horario de verano). Se muestra dentro de ToolControl.</p>';
  if(cache.error)html+='<p class="hint" style="color:#a32929">Error de conexión: '+esc(cache.error)+'</p>';
  if(!c)return html+'<button type="button" class="btn outline" onclick="tcDailyAdminReloadV24()">↻ Consultar configuración</button></div>';
  if(p){
    html+='<div class="field"><label for="tcDailyAdminTextV24">Mensaje para los administradores</label>'+
      '<textarea id="tcDailyAdminTextV24" maxlength="500" rows="6" style="width:100%;min-height:125px" aria-label="Mensaje de recordatorio">'+esc(c.message||'')+'</textarea></div>'+
      '<label style="display:flex;gap:9px;align-items:center;margin:12px 0"><input type="checkbox" id="tcDailyAdminEnabledV24" '+(c.enabled?'checked':'')+'> Enviar recordatorio diario</label>'+
      '<button type="button" class="btn primary block" onclick="tcDailyAdminSaveV24()" '+(cache.saving?'disabled':'')+'>Guardar mensaje (solo administrador principal)</button>';
  }else{
    html+='<p style="white-space:pre-wrap">'+esc(c.message||'')+'</p>'+
      '<p class="hint">Solo el administrador principal puede modificar o desactivar este mensaje.</p>';
  }
  html+='<p class="hint">Estado: <b>'+(c.enabled?'Activado':'Desactivado')+'</b>. La entrega por SMS no está incluida en este aviso interno.</p></div>';
  return html;
}
window.tcDailyAdminSaveV24=async function(){
  if(!isPrimary()||!reconcile()||cache.saving)return toast('Solo la cuenta principal puede editar el recordatorio.');
  const message=document.getElementById('tcDailyAdminTextV24')?.value.trim()||'';
  const enabled=!!document.getElementById('tcDailyAdminEnabledV24')?.checked;
  if(message.length<15||message.length>500)return toast('El mensaje debe contener entre 15 y 500 caracteres.');
  if(!navigator.onLine)return toast('Necesitas conexión para guardar el mensaje.');
  cache.saving=true;
  try {
    const {data,error}=await tcClient.from('tc_daily_admin_config')
       .update({message,enabled,changed_at:new Date().toISOString(),changed_by:tcUser.uid})
       .eq('workspace_id',tcWorkspace).select('workspace_id');
    if(error)throw error;
    if(!Array.isArray(data)||data.length!==1)throw Error('No tienes permisos para modificar este recordatorio.');
    toast('✓ Mensaje diario guardado. Solo el administrador principal puede modificarlo.');
    await load(true);
  }catch(e){toast('No se guardó: '+String(e?.message||e).slice(0,130));}
  finally{cache.saving=false;if(page==='cloud')render();}
};
window.tcDailyAdminReloadV24=function(){void load(true);};
const priorHome=homeView;
homeView=function(...args){const html=priorHome.apply(this,args);return homeCard()+html;};
if(typeof tcCloudView==='function'){
 const priorCloud=tcCloudView;
 tcCloudView=function(...args){return settingsCard()+priorCloud.apply(this,args);};
}
const priorRender=render;
render=function(...args){
  const result=priorRender.apply(this,args);
  if((page==='cloud'||page==='home')&&reconcile())setTimeout(()=>{void load(false);},0);
  return result;
};
setInterval(()=>{if(!document.hidden&&reconcile())void load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&reconcile())void load(true);});
window.addEventListener('focus',()=>{if(reconcile())void load(true);});
})();
