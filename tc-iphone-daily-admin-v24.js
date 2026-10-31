/* ToolControl iPhone V2.6.11 — mismo recordatorio matutino de Android.
 * Configuracion REAL: tc_morning_v263_config_get/save.
 * El iPhone NO emite SMS en segundo plano. Solo el Android autorizado realiza envios.
 * Al cambiar la hora desde iPhone, el Android emisor debe sincronizar su alarma local.
 */
(function(){
'use strict';
const DAY_NAMES=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DAYS=[1,2,3,4,5,6,7];
let state269={key:'',config:null,busy:false,saving:false,stamp:0,error:''};
function currentKey(){
 try{return !!tcCloudOn&&!!tcClient&&!!tcWorkspace&&!!tcUser?.uid&&!tcDenied
   ?String(tcWorkspace)+'|'+String(tcUser.uid):'';}catch(_){return '';}
}
function principal(){
 try{return typeof tcIsCompanyPrincipal==='function' && tcIsCompanyPrincipal();}
 catch(_){return false;}
}
function normalize(){
 const key=currentKey();
 if(key!==state269.key)state269={key,config:null,busy:false,saving:false,stamp:0,error:''};
 return key;
}
function validTime(t){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t||''));}
function safeDays(v){
 return [...new Set((Array.isArray(v)?v:[1,2,3,4,5,6])
   .map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=7))].sort((a,b)=>a-b);
}
function tidyError(e){return String(e?.message||e||'Error desconocido').slice(0,160);}
async function refresh(force){
 const key=normalize();
 if(!key||!principal()||state269.busy||state269.saving||!navigator.onLine||
   (!force&&Date.now()-state269.stamp<25000))return;
 state269.busy=true;state269.stamp=Date.now();
 try{
   const {data,error}=await tcClient.rpc('tc_morning_v263_config_get',{p_workspace:tcWorkspace});
   if(error)throw error;
   if(key!==currentKey())return;
   state269.config=data||null;state269.error='';
 }catch(e){if(key===currentKey())state269.error=tidyError(e);}
 finally{
   state269.busy=false;
   if(key===currentKey()&&page==='cloud')render();
 }
}
function view(){
 if(!normalize())return '';
 let html='<div class="card" id="tcMorningIphone269"><h3>🌅 Recordatorio matutino · Android / iPhone V2.6.11</h3>'+
 '<p class="hint">Configuracion compartida con Android por Supabase. El SMS sale exclusivamente del Android autorizado; el iPhone no realiza envios SMS automaticos.</p>';
 if(!principal()){
   return html+'<p class="hint">La configuracion y el mensaje estan protegidos. El administrador principal puede cambiar el horario desde esta pantalla.</p></div>';
 }
 const c=state269.config;
 if(state269.error)html+='<p role="alert" style="color:#a12828">No fue posible leer la configuracion: '+esc(state269.error)+'</p>';
 if(!c){
   return html+'<button class="btn outline block" onclick="tcMorningIphoneReload269()">↻ Cargar configuracion compartida</button></div>';
 }
 const time=validTime(c.time)?c.time:'06:30',days=safeDays(c.days);
 html+='<label style="display:flex;gap:10px;align-items:center;margin:12px 0"><input id="tcMorningIphoneEnabled269" type="checkbox"'+(c.enabled?' checked':'')+'> Activar recordatorios</label>'+
 '<div class="field"><label for="tcMorningIphoneTime269">Hora de envio (America/New_York)</label>'+
 '<input id="tcMorningIphoneTime269" type="time" step="60" value="'+esc(time)+'" style="width:100%;padding:13px;font-size:17px"></div>'+
 '<div class="field"><label>Selecciona los dias</label><div id="tcMorningIphoneDays269" style="display:flex;flex-wrap:wrap;gap:10px;margin:12px 0">';
 for(let n=1;n<=7;n++)html+='<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" value="'+n+'"'+(days.includes(n)?' checked':'')+'> '+DAY_NAMES[n-1]+'</label>';
 html+='</div></div><div class="field"><label for="tcMorningIphoneMessage269">Mensaje que enviara Android a los administradores</label>'+
 '<textarea id="tcMorningIphoneMessage269" rows="5" maxlength="480" style="width:100%;min-height:120px">'+esc(c.message||'')+'</textarea>'+
 '<small class="hint">De 10 a 480 caracteres; admite mensajes largos y emojis.</small></div>'+
 '<button class="btn primary block" type="button" onclick="tcMorningIphoneSave269()"'+(state269.saving?' disabled':'')+'>💾 Guardar en Android y iPhone</button>'+
 '<button class="btn outline block" type="button" onclick="tcMorningIphoneReload269()">↻ Sincronizar configuracion</button>'+
 '<p class="hint" style="color:#804512">⚠️ Despues de cambiar la hora desde iPhone, abre ToolControl en el Android autorizado para sincronizar/programar su alarma. Guardar en Supabase por si solo no garantiza que iOS programe el envio.</p>'+
 '<p class="hint">La prueba de envio manual se realiza en el Android autorizado; no se inicia desde iPhone.</p></div>';
 return html;
}
window.tcMorningIphoneReload269=function(){void refresh(true);};
window.tcMorningIphoneSave269=async function(){
 const key=normalize();
 if(!key||!principal()||state269.saving)return toast('Solo el administrador principal puede guardar estos ajustes.');
 if(!navigator.onLine)return toast('Conectate a Internet para guardar.');
 const time=document.getElementById('tcMorningIphoneTime269')?.value||'';
 const message=(document.getElementById('tcMorningIphoneMessage269')?.value||'').trim();
 const enabled=!!document.getElementById('tcMorningIphoneEnabled269')?.checked;
 const days=[...document.querySelectorAll('#tcMorningIphoneDays269 input:checked')].map(x=>Number(x.value));
 if(!validTime(time))return toast('Selecciona una hora valida.');
 if(!days.length||days.some(n=>!DAYS.includes(n)))return toast('Selecciona al menos un dia.');
 if(message.length<10||message.length>480)return toast('El texto debe tener entre 10 y 480 caracteres.');
 state269.saving=true;
 try{
   const {data,error}=await tcClient.rpc('tc_morning_v263_config_save',{
     p_workspace:tcWorkspace,p_enabled:enabled,p_time:time,p_days:days,p_message:message
   });
   if(error)throw error;
   if(key!==currentKey())return;
   state269.config=data;state269.error='';state269.stamp=Date.now();
   toast('✓ Guardado en Supabase. Abre ToolControl en el Android emisor para sincronizar la alarma.');
 }catch(e){if(key===currentKey())toast('No se guardo: '+tidyError(e));}
 finally{
   state269.saving=false;
   if(key===currentKey()&&page==='cloud')render();
 }
};
if(typeof tcCloudView==='function'){
 const oldView=tcCloudView;
 tcCloudView=function(...args){return view()+oldView.apply(this,args);};
}
const oldRender=render;
render=function(...args){
 const result=oldRender.apply(this,args);
 if(page==='cloud'&&normalize()&&principal())setTimeout(()=>{void refresh(false);},0);
 return result;
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true);});
window.addEventListener('focus',()=>{void refresh(true);});
window.addEventListener('online',()=>{void refresh(true);});
setInterval(()=>{if(!document.hidden&&currentKey()&&page==='cloud')void refresh(false);},45000);
})();