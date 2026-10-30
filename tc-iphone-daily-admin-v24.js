/* ToolControl V2.4 — recordatorio diario a administradores (06:30 America/New_York).
 * La base de datos valida permisos; nunca confiar solo en ocultar botones.
 * Entrega dentro de ToolControl, no promete SMS ni push externo. */
(function(){
'use strict';
let cache={scope:'',settings:null,todayMessage:null,ownerUid:null,busy:false,saving:false,lastFetch:0,error:''};
function scope(){
  try {return tcCloudOn&&tcClient&&tcUser?.uid&&tcWorkspace&&!tcDenied ? tcUser.uid+'|'+tcWorkspace : '';}
  catch(e){return '';}
}
function isPrimary(){
  try {return !!tcIsCompanyPrincipal();}
  catch(e){return false;}
}
function canSee(){return !!(isPrimary()||(cache.ownerUid&&cache.ownerUid===tcUser?.uid));}
function todayInEastern(){
  try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;}
  catch(e){return new Date().toISOString().slice(0,10);}
}
function reconcile(){
  const s=scope();
  if(s!==cache.scope)cache={scope:s,settings:null,todayMessage:null,ownerUid:null,busy:false,saving:false,lastFetch:0,error:''};
  return s;
}
async function load(force){
  const current=reconcile();
  if(!current||cache.busy||!navigator.onLine||(!force&&Date.now()-cache.lastFetch<30000))return;
  cache.busy=true;cache.lastFetch=Date.now();
  try{
    const owner=await tcClient.rpc('tc_sms_current',{p_workspace:tcWorkspace,p_device:'00000000-0000-4000-8000-000000000000'});
    if(owner.error)throw owner.error;
    if(current!==scope())return;
    const row=Array.isArray(owner.data)?owner.data[0]:null;
    cache.ownerUid=row?.owner_uid||null;
    const delivered=await tcClient.from('tc_daily_admin_messages').select('message,local_day,created_at').eq('workspace_id',tcWorkspace).eq('user_id',tcUser.uid).order('local_day',{ascending:false}).limit(1);
    if(delivered.error)throw delivered.error;
    let config={data:null,error:null};
    if(canSee()){
      config=await tcClient.from('tc_daily_admin_config').select('message,enabled,send_time,time_zone').eq('workspace_id',tcWorkspace).maybeSingle();
      if(config.error)throw config.error;
    }
    if(current!==scope())return;
    cache.settings=config.data||null;
    const latest=Array.isArray(delivered.data)?delivered.data[0]:null;
    cache.todayMessage=latest&&latest.local_day===todayInEastern()?latest:null;
    cache.error='';
  }catch(e){if(current===scope())cache.error=String(e?.message||e).slice(0,140);}
  finally{
    cache.busy=false;
    if(current===scope()&&page==='home')render();
  }
}
function settingsCard(){
  if(!reconcile()||!canSee())return '';
  const p=isPrimary(),c=cache.settings;
  let html='<div class="card" id="tcDailyAdminReminderCard" style="margin-top:18px;border-top:4px solid #147bc8">'+
    '<h3>⏰ Recordatorio diario a administradores</h3>'+
    '<p class="hint">Configuración sincronizada con Supabase. El envío automático se realiza únicamente desde el Android autorizado.</p>';
  if(cache.error)html+='<p class="hint" style="color:#a32929">Error de conexión: '+esc(cache.error)+'</p>';
  if(!c)return html+'<button type="button" class="btn outline" onclick="tcDailyAdminReloadV24()">↻ Consultar configuración</button></div>';
  html+='<p><b>Horario:</b> '+esc(String(c.send_time||'06:30').slice(0,5))+' (America/New_York) · <b>Estado:</b> '+(c.enabled?'Activado':'Desactivado')+'</p>';
  if(p){
    html+='<div class="field"><label for="tcDailyAdminTextV24">Mensaje para los administradores</label>'+
      '<textarea id="tcDailyAdminTextV24" maxlength="500" rows="5" style="width:100%;min-height:110px">'+esc(c.message||'')+'</textarea></div>'+
      '<div class="field"><label for="tcDailyAdminTimeV24">Hora diaria (zona Este)</label>'+
      '<input type="time" id="tcDailyAdminTimeV24" value="'+esc(String(c.send_time||'06:30').slice(0,5))+'"></div>'+
      '<label style="display:flex;gap:9px;align-items:center;margin:12px 0"><input type="checkbox" id="tcDailyAdminEnabledV24" '+(c.enabled?'checked':'')+'> Activar envío diario</label>'+
      '<button type="button" class="btn primary block" onclick="tcDailyAdminSaveV24()" '+(cache.saving?'disabled':'')+'>Guardar recordatorio</button>';
  }else{
    html+='<p style="white-space:pre-wrap">'+esc(c.message||'')+'</p>'+
      '<p class="hint">Eres el encargado SMS. Puedes ver la programación, pero solo el administrador principal puede modificarla.</p>';
  }
  if(cache.todayMessage)html+='<p class="hint">Aviso interno de hoy:</p><p style="white-space:pre-wrap">'+esc(cache.todayMessage.message)+'</p>';
  html+='<p class="hint">Los cambios de horario se aplicarán al Android encargado cuando este sincronice la configuración. Con la aplicación cerrada, Android puede retrasar el envío.</p></div>';
  return html;
}
window.tcDailyAdminSaveV24=async function(){
  if(!isPrimary()||!reconcile()||cache.saving)return toast('Solo la cuenta principal puede editar el recordatorio.');
  const message=document.getElementById('tcDailyAdminTextV24')?.value.trim()||'';
  const enabled=!!document.getElementById('tcDailyAdminEnabledV24')?.checked;
  const sendTime=String(document.getElementById('tcDailyAdminTimeV24')?.value||'');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime))return toast('Selecciona una hora válida.');
  if(message.length<15||message.length>500)return toast('El mensaje debe contener entre 15 y 500 caracteres.');
  if(!navigator.onLine)return toast('Necesitas conexión para guardar el mensaje.');
  cache.saving=true;
  try {
    const {data,error}=await tcClient.from('tc_daily_admin_config')
       .update({message,enabled,send_time:sendTime,changed_at:new Date().toISOString(),changed_by:tcUser.uid})
       .eq('workspace_id',tcWorkspace).select('workspace_id');
    if(error)throw error;
    if(!Array.isArray(data)||data.length!==1)throw Error('No tienes permisos para modificar este recordatorio.');
    toast('✓ Recordatorio y horario guardados. El Android encargado los sincronizará al abrirse.');
    await load(true);
  }catch(e){toast('No se guardó: '+String(e?.message||e).slice(0,130));}
  finally{cache.saving=false;if(page==='home')render();}
};
window.tcDailyAdminReloadV24=function(){void load(true);};
const priorHome=homeView;
homeView=function(...args){const html=priorHome.apply(this,args);return html+settingsCard();};
const priorRender=render;
render=function(...args){
  const result=priorRender.apply(this,args);
  if(page==='home'&&reconcile())setTimeout(()=>{void load(false);},0);
  return result;
};
setInterval(()=>{if(!document.hidden&&reconcile())void load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&reconcile())void load(true);});
window.addEventListener('focus',()=>{if(reconcile())void load(true);});
})();
