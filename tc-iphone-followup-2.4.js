/* ToolControl iPhone V2.4 — seguimiento en tiempo real, compartido con Android. */
(function(){
'use strict';
let follow24={scope:'',rows:[],loaded:false,busy:false,last:0,expanded:false,error:''};
function scope24(){return typeof tcDenied!=='undefined'&&tcDenied?'':(tcUser?.uid&&tcCloudOn&&tcClient&&tcWorkspace?tcUser.uid+'|'+tcWorkspace:'');}
function due24(v){if(!/^\d{4}-\d\d-\d\d$/.test(String(v||'')))return null;const d=new Date(v+'T12:00:00');if(!Number.isFinite(d.getTime()))return null;const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);return Math.round((today-d)/86400000);}
function label24(r){const days=due24(r.due_on);
 if(r.flag==='lost')return '🔴 Reportada extraviada';
 if(r.flag==='attention')return '🟠 En seguimiento';
 if(days>0)return '🔴 Vencida: '+days+' día(s)';
 if(days===0)return '🟡 Devolver hoy';
 return days===null?'🟢 Asignada · sin fecha':'🟢 En plazo';
}
async function reload24(force=false){
 const scope=scope24();if(!scope)return;
 if(scope!==follow24.scope)follow24={scope,rows:[],loaded:false,busy:false,last:0,expanded:false,error:''};
 if(follow24.busy||!navigator.onLine||(!force&&Date.now()-follow24.last<18000))return;
 follow24.busy=true;follow24.last=Date.now();
 try{const workspace=tcWorkspace,{data,error}=await tcClient.rpc('tc_followup_list',{p_workspace:workspace});
  if(error)throw error;if(scope!==scope24())return;
  follow24.rows=Array.isArray(data)?data:[];follow24.loaded=true;follow24.error='';
 }catch(e){if(scope===scope24())follow24.error=String(e?.message||e).slice(0,160);}
 finally{follow24.busy=false;if(scope===scope24())paint24();}
}
function entry24(r){
 const id=String(r.tool_id||'');const safe=/^[a-f0-9-]{36}$/i.test(id);
 const dt=r.last_sms_at?' · '+esc(new Date(r.last_sms_at).toLocaleString('es')):'';
 const message=r.last_sms_result==='sent'?'✓ Android confirmó envío':
    r.last_sms_result==='failed'?'✕ Android reportó fallo':
    r.last_scheduled_request?'Intento automático; salida sin confirmar':'Sin envío SMS confirmado';
 return '<div style="padding:12px 0;border-top:1px solid #dce3e7"><strong>'+esc(r.tool_name)+' · '+esc(r.tool_code)+'</strong>'+
   '<p class="hint">👷 '+esc(r.worker_name)+' · Devolución: '+esc(r.due_on||'Sin fecha')+'</p>'+
   '<p><b>'+label24(r)+'</b></p><p class="hint">SMS: '+message+dt+'</p>'+
   (r.last_sms_sender?'<p class="hint">Enviado por: '+esc(r.last_sms_sender)+'</p>':'')+
   (r.responsible?'<p class="hint">Última gestión: '+esc(r.responsible)+'</p>':'')+
   (r.case_note?'<p class="hint">Nota: '+esc(r.case_note)+'</p>':'')+
   (safe?'<div class="field"><label>Observación</label><input maxlength="500" id="followNote24-'+id+'" placeholder="Ej.: Trabajador avisado"></div>'+
   '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
   '<button class="btn outline" onclick="tcFollowSave24(\''+id+'\',\'note\')">Guardar nota</button>'+
   '<button class="btn secondary" onclick="tcFollowSave24(\''+id+'\',\'attention\')">En seguimiento</button>'+
   '<button class="btn outline" onclick="tcFollowSave24(\''+id+'\',\'lost\')">Extraviada</button>'+
   '<button class="btn outline" onclick="tcFollowSave24(\''+id+'\',\'normal\')">Quitar marca</button>'+
   '<button class="btn outline" onclick="tcFollowHistory24(\''+id+'\')">Historial</button></div>'+
   '<div id="followHistory24-'+id+'" class="hint" role="status"></div>':'')+'</div>';
}
function card24(){
 const rows=[...follow24.rows].sort((a,b)=>(b.flag==='lost'?100:due24(b.due_on)>0?10:0)-(a.flag==='lost'?100:due24(a.due_on)>0?10:0));
 const overdue=rows.filter(r=>due24(r.due_on)>0).length;
 const flagged=rows.filter(r=>r.flag==='lost'||r.flag==='attention').length;
 return '<div class="card" id="followCard24"><h3>📋 Seguimiento de herramientas · V2.4</h3>'+
 '<p class="hint">Android y iPhone comparten los préstamos, fechas, observaciones y responsable.</p>'+
 (follow24.error?'<p class="hint">⚠️ No se pudo consultar Supabase: '+esc(follow24.error)+'</p>':'')+
 (!navigator.onLine?'<p class="hint">Sin Internet. Los datos pueden estar desactualizados.</p>':'')+
 (follow24.loaded?'<div><strong>🔧 '+rows.length+' asignadas · 🔴 '+overdue+' vencidas · 🟠 '+flagged+' marcadas</strong></div>':'<p>Consultando seguimiento…</p>')+
 '<p><button class="btn outline" onclick="tcFollowRefresh24()">↻ Actualizar seguimiento</button>'+
 (rows.length?' <button class="btn secondary" onclick="tcFollowToggle24()">'+(follow24.expanded?'Ocultar detalle':'Ver todas')+'</button>':'')+'</p>'+
 (follow24.expanded?rows.slice(0,300).map(entry24).join('')+(rows.length>300?'<p class="hint">Mostrando las primeras 300 de '+rows.length+'</p>':''):'')+
 (follow24.loaded&&!rows.length?'<p class="hint">Actualmente no hay herramientas prestadas.</p>':'')+
 '<p class="hint">El SMS enviado no significa SMS entregado ni leído. Las confirmaciones provienen del Android autorizado.</p></div>';
}
function paint24(){
 const el=document.getElementById('followCard24');
 if(el&&document.activeElement?.tagName!=='INPUT'){
  const wrap=document.createElement('div');wrap.innerHTML=card24();el.replaceWith(wrap.firstElementChild);
 }
}
window.tcFollowRefresh24=()=>{void reload24(true);};
window.tcFollowToggle24=()=>{follow24.expanded=!follow24.expanded;if(page==='cloud')render();};
window.tcFollowSave24=async function(id,flag){
 if(!scope24()||!navigator.onLine)return toast('Conecta tu inventario');
 const r=follow24.rows.find(x=>x.tool_id===id);if(!r)return;
 const note=document.getElementById('followNote24-'+id)?.value?.trim()||'';
 if(flag==='note'&&!note)return toast('Escribe una observación');
 if(flag==='lost'){
  if(note.length<3)return toast('Explica por qué está extraviada');
  if(!confirm('¿Reportar como extraviada esta herramienta? Se registrará quién lo hizo.'))return;
 }
 try{const{error}=await tcClient.rpc('tc_followup_mark',{p_workspace:tcWorkspace,p_tool:id,p_flag:flag,p_note:note});
  if(error)throw error;toast('Seguimiento guardado');await reload24(true);
 }catch(e){toast('Error: '+String(e?.message||e).slice(0,120));}
};
window.tcFollowHistory24=async function(id){
 const el=document.getElementById('followHistory24-'+id);if(!el)return;el.textContent='Consultando historial…';
 try{const {data,error}=await tcClient.rpc('tc_followup_timeline',{p_workspace:tcWorkspace,p_tool:id});
  if(error)throw error;
  if(!document.getElementById('followHistory24-'+id))return;
  el.innerHTML=(data||[]).length?(data||[]).map(x=>'<p>• '+esc(new Date(x.created_at).toLocaleString('es'))+' · '+esc(x.actor)+' · '+esc(x.action)+(x.note?' · '+esc(x.note):'')+'</p>').join(''):'Sin anotaciones registradas';
 }catch(e){el.textContent='No se pudo cargar: '+String(e?.message||e).slice(0,120);}
};
const oldCloud=tcCloudView;
tcCloudView=function(){const content=oldCloud(),scope=scope24();if(!scope)return content;
 if(scope!==follow24.scope){follow24={scope,rows:[],loaded:false,busy:false,last:0,expanded:false,error:''};setTimeout(()=>void reload24(true),0);}
 return card24()+content;
};
const oldHome=homeView;
homeView=function(){const content=oldHome(),scope=scope24();if(!scope)return content;
 if(scope!==follow24.scope){follow24={scope,rows:[],loaded:false,busy:false,last:0,expanded:false,error:''};setTimeout(()=>void reload24(true),0);}
 return '<div class="card"><h3>📋 Seguimiento V2.4</h3><p class="hint">'+(follow24.loaded?follow24.rows.length+' herramientas prestadas · '+follow24.rows.filter(r=>due24(r.due_on)>0).length+' vencidas':'Consulta el estado de las devoluciones')+'</p><button class="btn outline" onclick="go(\'cloud\')">Ver seguimiento</button></div>'+content;
};
setInterval(()=>{if(!document.hidden&&scope24())void reload24();},20000);
window.addEventListener('focus',()=>{if(scope24())void reload24(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&scope24())void reload24(true);});
})();
