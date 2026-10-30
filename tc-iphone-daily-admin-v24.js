/* ToolControl V2.4.2 — horario editable de recordatorios matutinos.
 * Autoridad y validación real: Supabase RLS/RPC; solo principal edita.
 * Los SMS salen exclusivamente del Android autorizado. */
(function(){
'use strict';
const DAY_NAMES=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const ALL_DAYS=[1,2,3,4,5,6,7];
let cache={scope:'',settings:null,todayMessage:null,busy:false,saving:false,lastFetch:0,error:''};
function scope(){
  try{return tcCloudOn&&tcClient&&tcUser?.uid&&tcWorkspace&&!tcDenied?tcUser.uid+'|'+tcWorkspace:'';}
  catch(e){return '';}
}
function isPrimary(){
  try{return !!tcIsCompanyPrincipal()&&String(tcUser?.email||tcUser?.contact_email||'').toLowerCase()==='toolcontrolgaylor@gmail.com';}
  catch(e){return false;}
}
function validTime(s){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s||''));}
function timeText(s){
  const t=String(s||'06:30').slice(0,5);
  if(!validTime(t))return '6:30 a. m.';
  const a=t.split(':'),h=Number(a[0]);
  return String(h%12||12)+':'+a[1]+(h>=12?' p. m.':' a. m.');
}
function daysOf(config){
  const days=Array.isArray(config?.days_of_week)?config.days_of_week.map(Number):ALL_DAYS;
  return [...new Set(days.filter(d=>Number.isInteger(d)&&d>=1&&d<=7))].sort((a,b)=>a-b);
}
function todayInEastern(){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  }catch(e){return new Date().toISOString().slice(0,10);}
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
      tcClient.from('tc_daily_admin_config').select('message,enabled,send_time,time_zone,days_of_week').eq('workspace_id',tcWorkspace).maybeSingle(),
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
    '<h3>🌅 Recordatorio matutino</h3>'+
    '<p style="white-space:pre-wrap;line-height:1.55">'+esc(cache.todayMessage.message)+'</p>'+
    '<small style="color:#55738e">Aviso interno de ToolControl para administradores.</small></div>';
}
function settingsCard(){
  if(!reconcile())return '';
  const p=isPrimary(),c=cache.settings;
  let html='<div class="card" id="tcDailyAdminReminderCard"><h3>🌅 Recordatorios matutinos</h3>'+
    '<p class="hint">Configura el horario y los días igual que en los SMS de fin de jornada. Hora del este (America/New_York). Los SMS se envían solo desde el Android autorizado.</p>';
  if(cache.error)html+='<p class="hint" style="color:#a32929">Error de conexión: '+esc(cache.error)+'</p>';
  if(!c)return html+'<button type="button" class="btn outline" onclick="tcDailyAdminReloadV24()">↻ Consultar configuración</button></div>';
  const time=String(c.send_time||'06:30').slice(0,5);
  const days=daysOf(c);
  if(p){
    html+='<label style="display:flex;gap:12px;align-items:center;margin:14px 0"><input type="checkbox" id="tcDailyAdminEnabledV24" '+(c.enabled?'checked':'')+'> Activar recordatorios automáticos</label>'+
      '<div class="field"><label for="tcDailyAdminTimeV24">Hora de envío del recordatorio</label>'+
      '<input type="time" id="tcDailyAdminTimeV24" value="'+esc(validTime(time)?time:'06:30')+'" step="60" style="width:100%;padding:14px;border:1px solid #cbd5e1;border-radius:12px;font-size:18px"></div>'+
      '<div class="field" style="margin-top:12px"><label>Días de envío</label>'+
      '<div id="tcDailyAdminDaysV24" style="display:flex;flex-wrap:wrap;gap:10px 15px;margin:12px 0">';
    for(let i=1;i<=7;i++){
      html+='<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600"><input type="checkbox" value="'+i+'" '+(days.includes(i)?'checked':'')+' style="width:19px;height:19px">'+DAY_NAMES[i-1]+'</label>';
    }
    html+='</div></div><div class="field"><label for="tcDailyAdminTextV24">Mensaje de recordatorio</label>'+
      '<textarea id="tcDailyAdminTextV24" maxlength="500" rows="6" style="width:100%;min-height:125px" aria-label="Mensaje de recordatorio">'+esc(c.message||'')+'</textarea></div>'+
      '<button type="button" class="btn primary block" onclick="tcDailyAdminSaveV24()" '+(cache.saving?'disabled':'')+'>💾 Guardar horario, días y mensaje</button>';
  }else{
    html+='<p><b>Horario:</b> '+esc(timeText(time))+'</p>'+
      '<p><b>Días:</b> '+esc(days.map(d=>DAY_NAMES[d-1]).join(', '))+'</p>'+
      '<p style="white-space:pre-wrap">'+esc(c.message||'')+'</p>'+
      '<p class="hint">Solo el administrador principal puede modificar estos ajustes.</p>';
  }
  html+='<p class="hint">Estado: <b>'+(c.enabled?'Activado':'Desactivado')+'</b>. El envío depende de la conexión, permiso SMS, SIM y ejecución de Android; no se garantiza la entrega exacta.</p></div>';
  return html;
}
window.tcDailyAdminSaveV24=async function(){
  if(!isPrimary()||!reconcile()||cache.saving)return toast('Solo la cuenta principal puede editar el recordatorio.');
  const message=document.getElementById('tcDailyAdminTextV24')?.value.trim()||'';
  const enabled=!!document.getElementById('tcDailyAdminEnabledV24')?.checked;
  const send_time=document.getElementById('tcDailyAdminTimeV24')?.value||'';
  const days_of_week=[...document.querySelectorAll('#tcDailyAdminDaysV24 input[type="checkbox"]:checked')]
    .map(x=>Number(x.value)).sort((a,b)=>a-b);
  if(message.length<15||message.length>500)return toast('El mensaje debe contener entre 15 y 500 caracteres.');
  if(!validTime(send_time))return toast('Selecciona una hora válida.');
  if(!days_of_week.length||days_of_week.some(x=>!ALL_DAYS.includes(x)))return toast('Selecciona al menos un día.');
  if(!navigator.onLine)return toast('Necesitas conexión para guardar los ajustes.');
  cache.saving=true;
  try{
    const {data,error}=await tcClient.from('tc_daily_admin_config')
      .update({message,enabled,send_time,days_of_week,changed_at:new Date().toISOString(),changed_by:tcUser.uid})
      .eq('workspace_id',tcWorkspace).select('workspace_id');
    if(error)throw error;
    if(!Array.isArray(data)||data.length!==1)throw Error('No tienes permisos para modificar el recordatorio.');
    toast('✓ Horario, días y mensaje guardados.');
    await load(true);
    // En el Android encargado se actualiza la alarma inmediatamente.
    if(tcSmsOwner22?.isMine&&window.AppBridge?.syncDailyAdminSms&&
       typeof window.tcConfigureDailyAdminSmsNow==='function')
      void window.tcConfigureDailyAdminSmsNow();
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