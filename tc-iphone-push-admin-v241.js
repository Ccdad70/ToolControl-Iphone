/* ToolControl V2.4.1 — administración PUSH. Solo principal; controles del servidor obligatorios. */
(function(){
'use strict';
let memo={scope:'',settings:null,ready:false,devices:0,attempts:[],loading:false,saving:false,error:'',last:0};
function scope(){try{return tcCloudOn&&!tcDenied&&tcUser?.uid&&tcWorkspace&&tcIsCompanyPrincipal()?tcWorkspace+'|'+tcUser.uid:'';}catch{return '';}}
function reset(){const v=scope();if(memo.scope!==v)memo={scope:v,settings:null,ready:false,devices:0,attempts:[],loading:false,saving:false,error:'',last:0};return v;}
async function request(action,payload={}){
 const {data,error}=await tcClient.functions.invoke('tc-push',{body:{action,workspace_id:tcWorkspace,...payload}});
 if(error)throw error;
 if(!data?.ok)throw Error(data?.error||'El servidor PUSH rechazó la operación');
 return data;
}
async function load(force=false){
 const k=reset();if(!k||memo.loading||!navigator.onLine||(!force&&Date.now()-memo.last<60000))return;
 memo.loading=true;memo.last=Date.now();
 try{
  const data=await request('settings-get');
  if(k!==scope())return;
  memo.settings=data.settings;memo.ready=!!data.firebase_ready;memo.devices=data.devices||0;
  memo.attempts=data.attempts||[];memo.error='';
 }catch(e){if(k===scope())memo.error=String(e?.message||e).slice(0,180);}
 finally{memo.loading=false;if(k===scope()&&page==='cloud')render();}
}
function panel(){
 if(!reset())return '';
 const s=memo.settings, v=k=>s?.[k]?'checked':'';
 let html='<div class="card" id="tcPushAdminV241" style="border-top:4px solid #d84231"><h3>🚨 PUSH tipo AMBER · Administración principal</h3>'+
  '<p class="hint">Solo el administrador principal puede configurar alertas PUSH. Los trabajadores vinculados podrán recibirlas con su consentimiento. No son alertas oficiales AMBER.</p>';
 if(memo.error)html+='<p style="color:#a42121" class="hint">Conexión: '+esc(memo.error)+'</p>';
 if(!s)return html+'<button class="btn outline block" onclick="tcPushReloadV241()">↻ Revisar conexión PUSH</button></div>';
 html+='<p class="hint"><b>Firebase Android:</b> '+(memo.ready?'✅ credenciales configuradas':'⚠️ falta configurar credenciales privadas')+
  ' · <b>Dispositivos vinculados:</b> '+Number(memo.devices)+'</p>'+
  '<label class="field"><input id="tcPushEnabledV241" type="checkbox" '+v('enabled')+'> Activar alertas PUSH</label>'+
  '<label class="field"><input id="tcPushPendingV241" type="checkbox" '+v('notify_pending')+'> Herramientas pendientes</label>'+
  '<label class="field"><input id="tcPushOverdueV241" type="checkbox" '+v('notify_overdue')+'> Devoluciones vencidas</label>'+
  '<label class="field"><input id="tcPushLostV241" type="checkbox" '+v('notify_lost')+'> Herramientas extraviadas (preparado para ampliar eventos)</label>'+
  '<div class="field"><label>Frecuencia mínima (minutos)</label>'+
  '<input id="tcPushIntervalV241" type="number" min="15" max="1440" step="15" value="'+Number(s.reminder_interval_minutes||60)+'"></div>'+
  '<div class="field"><label>Texto de notificación</label>'+
  '<textarea id="tcPushTextV241" maxlength="500" rows="4" style="width:100%">'+esc(s.message_template||'')+'</textarea>'+
  '<small>Variables: {trabajador}, {cantidad}, {herramientas}.</small></div>'+
  '<div class="two"><div class="field"><label>Silencio desde (opcional)</label><input id="tcPushQuietStartV241" type="time" value="'+esc(String(s.quiet_start||'').slice(0,5))+'"></div>'+
  '<div class="field"><label>Hasta (opcional)</label><input id="tcPushQuietEndV241" type="time" value="'+esc(String(s.quiet_end||'').slice(0,5))+'"></div></div>'+
  '<button class="btn primary block" '+(memo.saving?'disabled':'')+' onclick="tcPushSaveV241()">Guardar configuración PUSH</button>'+
  '<h4>🧪 Pruebas y diagnóstico</h4>'+
  '<p class="hint">Android utiliza FCM. Para iPhone instalado como PWA falta habilitar Web Push/VAPID; no se simula una entrega. Los sonidos obedecen las reglas de Android/iOS.</p>'+
  '<div class="field"><label>Trabajador con dispositivo vinculado</label><select id="tcPushWorkerV241">'+
  (state.people||[]).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></div>'+
  '<button class="btn secondary block" onclick="tcPushTestV241()" '+(!memo.ready||!memo.devices?'disabled':'')+'>🔔 Enviar PUSH de prueba</button>'+
  '<button class="btn outline block" onclick="tcPushReloadV241()">↻ Actualizar diagnóstico</button>'+
  '<p class="hint">Últimos intentos: '+memo.attempts.length+'. FCM aceptado no demuestra que el teléfono lo haya mostrado.</p>'+
  '<h4>🔐 Permisos futuros</h4><p class="hint">Reservado para futuras versiones. En V2.4.1 solamente el administrador principal tiene acceso; no se pueden delegar permisos todavía.</p></div>';
 return html;
}
window.tcPushReloadV241=function(){void load(true);};
window.tcPushSaveV241=async function(){
 if(!reset()||memo.saving)return toast('Solo el principal puede cambiar PUSH.');
 const get=id=>document.getElementById(id), enabled=id=>!!get(id)?.checked;
 const interval=Number(get('tcPushIntervalV241')?.value);
 const template=String(get('tcPushTextV241')?.value||'').trim();
 if(!Number.isInteger(interval)||interval<15||interval>1440)return toast('Frecuencia entre 15 y 1440 minutos.');
 if(template.length<15||template.length>500)return toast('El texto requiere 15 a 500 caracteres.');
 const quiet_start=get('tcPushQuietStartV241')?.value||null, quiet_end=get('tcPushQuietEndV241')?.value||null;
 if(!!quiet_start!==!!quiet_end)return toast('Configura ambas horas de silencio o deja ambas vacías.');
 memo.saving=true;
 try{
  await request('settings-update',{settings:{
   enabled:enabled('tcPushEnabledV241'),notify_pending:enabled('tcPushPendingV241'),
   notify_overdue:enabled('tcPushOverdueV241'),notify_lost:enabled('tcPushLostV241'),
   reminder_interval_minutes:interval,message_template:template,quiet_start,quiet_end
  }});
  toast('✓ Configuración PUSH guardada de forma segura');await load(true);
 }catch(e){toast('No se guardó PUSH: '+String(e?.message||e).slice(0,150));}
 finally{memo.saving=false;if(page==='cloud')render();}
};
window.tcPushTestV241=async function(){
 if(!reset())return toast('Solo administrador principal.');
 const worker_id=document.getElementById('tcPushWorkerV241')?.value;
 if(!worker_id)return toast('Selecciona un trabajador.');
 try{
  const r=await request('test',{worker_id});
  toast('Firebase aceptó '+r.fcm_accepted+' aviso(s). Fallidos: '+r.failed+'. Revisa el teléfono.');
  await load(true);
 }catch(e){toast('Prueba PUSH: '+String(e?.message||e).slice(0,140));}
};
const oldCloud=tcCloudView;
tcCloudView=function(...args){return oldCloud.apply(this,args)+panel();};
const oldRender=render;
render=function(...args){const r=oldRender.apply(this,args);if(page==='cloud'&&reset())setTimeout(()=>void load(false),0);return r;};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load(true);});
window.addEventListener('focus',()=>{void load(true);});
})();
