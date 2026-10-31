/* Visual parity: styles mirrored from the installed ToolControl Android V2.6.11.
   iOS-specific safe areas and PWA camera remain available.
   No changes to tool state, account permissions or SMS backend. */
(function(){
'use strict';
const VERSION='2.6.11';
const style=document.createElement('style');
style.id='tc-iphone-android-visual-v2611-css';
style.textContent=`
:root{--brand:#0758a9;--deep:#083c72;--green:#149b55;--blue:#0668d8;--amber:#fc891b;--navy:#092f63;--ink:#182941;--muted:#697c95;--shadow:0 7px 22px rgba(8,52,108,.075)}
html,body{background:#f3f6fb;color:var(--ink)}
.app{background:#f4f7fb;max-width:740px}
.top{background:linear-gradient(125deg,#05396f,#0755a0)!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:19px 18px 18px}
.top:after{display:none}.brand h1{font-size:23px;font-style:normal;letter-spacing:-.5px;text-shadow:none}.brand small{font-size:11px;color:#dceaff}
.brand-logo{width:42px;height:42px;border-radius:13px;background:#fff url('./toolcontrol-logo.png') center/contain no-repeat!important;border:1px solid #d8e9ff;font-size:0!important}
.hero{margin-top:13px}.hero h2{font-size:22px;font-weight:850;letter-spacing:-.4px;text-shadow:none}.hero p{font-size:12px;color:#e4f0ff}
main{padding:12px 15px 25px}.section{font-size:16px!important;color:#142a45!important;margin:17px 2px 11px!important}
.tc-welcome{display:flex;align-items:center;justify-content:space-between;background:white;border:1px solid #e4ebf6;border-radius:16px;padding:15px 14px;box-shadow:var(--shadow);gap:10px}
.tc-eyebrow{font-size:10px;font-weight:800;letter-spacing:.12em;color:#2165a9}
.tc-welcome h2{font-size:17px;line-height:1.25;margin:6px 0}.tc-welcome p{font-size:11px;color:#607792;margin:0}.tc-welcome-symbol{background:#eaf3ff;border-radius:14px;padding:13px;font-size:24px}
.tc-stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.tc-stat{display:flex;gap:10px;align-items:center;min-width:0;background:white;border:1px solid #e7ecf5;border-radius:14px;padding:13px 10px;box-shadow:var(--shadow)}
.tc-stat.wide{grid-column:span 2;background:#f8fbff}
.tc-stat-icon{background:#eef4fe;padding:9px;border-radius:11px;font-size:21px;flex-shrink:0}
.tc-stat div{min-width:0}.tc-stat b{display:block;font-size:23px;line-height:1.1;color:#1b3355}
.tc-stat small{display:block;color:#60768c;font-size:11px;margin-top:4px;line-height:1.3}
.tc-stat.green .tc-stat-icon{background:#e3f7ec}.tc-stat.amber .tc-stat-icon{background:#fff0de}.tc-stat.red .tc-stat-icon{background:#ffe8e8}
.tc-stat.green b{color:#12894a}.tc-stat.blue b{color:#1067ca}.tc-stat.amber b{color:#a5680a}.tc-stat.red b{color:#bb323e}
.tc-action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tc-action{color:white;border:0;border-radius:15px;min-height:107px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:11px;box-shadow:0 4px 11px #15457424;font-size:14px;font-weight:850;letter-spacing:.015em}
.tc-action span{font-size:30px;line-height:1}.tc-deliver{background:linear-gradient(145deg,#119d50,#0d7e3c)}
.tc-receive{background:linear-gradient(145deg,#0877e9,#0053ca)}.tc-scan{background:linear-gradient(145deg,#113d7d,#09295b)}.tc-add{background:linear-gradient(145deg,#ff991b,#ea7506)}.tc-action:active{transform:scale(.98)}
.tc-shortcut{display:flex;gap:9px;margin-top:12px}.tc-shortcut button{background:#fff;border:1px solid #e3e9f3;border-radius:12px;color:#224366;font-weight:700;padding:12px 9px;min-height:48px;flex:1;font-size:11px}
.tc-shortcut button span{color:#1267c5;font-size:19px;margin-left:4px}
.tc-alert-summary{display:flex;width:100%;gap:12px;align-items:center;background:#fff;border:1px solid #e4eaf3;border-radius:14px;text-align:left;padding:14px;color:#274269;box-shadow:var(--shadow)}
.tc-alert-summary>span:first-child{font-size:25px}.tc-alert-summary div{flex:1}
.tc-alert-summary b{font-size:12px;display:block}.tc-alert-summary small{font-size:11px;color:#64768d;display:block;margin-top:5px}
.tc-secondary-links{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}
.tc-secondary-links button{background:#e7effb;border:0;border-radius:10px;padding:11px 9px;color:#23548d;font-size:11px;font-weight:750;min-height:44px;flex:1}
.card,.tc-inv-group{border-radius:16px!important;box-shadow:var(--shadow)!important;border-color:#e1e9f3!important}
.btn.primary{background:#0862cd}.btn{border-radius:12px;min-height:46px}
.field input,.field textarea,.field select,.toolbar input{border-radius:12px;min-height:48px}
.pill.active{background:#0a62cb!important;border-color:#0a62cb!important}
.tc-inv-group-btn{min-height:65px!important}.tc-inv-qty{background:#e7f2ff!important;color:#0a5ba9!important}
.preview{object-fit:contain;background:#f8fbff;border-radius:10px}
.bottom{box-shadow:0 -4px 15px #072d6918;padding:7px 4px max(9px,env(safe-area-inset-bottom))}
.bottom button{min-width:0;flex:1;font-size:10px;min-height:48px;color:#74859b}
.bottom button span{font-size:24px;font-weight:750}.bottom button.active{color:#005ac0}
.bottom .tc-navscan{flex:1.1;background:transparent;color:#065dc5;font-weight:800}
.bottom .tc-navscan span{display:grid;place-items:center;background:linear-gradient(145deg,#1476e9,#0752c4);color:white;border-radius:50%;width:49px;height:49px;margin:-21px auto 1px;box-shadow:0 6px 15px #075cd259;font-size:27px}
.bottom .tc-navscan small{font-size:10px}
@media(min-width:741px){.bottom{width:740px;left:50%;transform:translateX(-50%)}}
@media(max-width:354px){.tc-action{min-height:90px}.tc-stat small{font-size:10px}.tc-shortcut{flex-direction:column}.bottom button{font-size:9px}}
@media(prefers-reduced-motion:reduce){.tc-action:active{transform:none}}
/* Keep the scan controls available inside the camera modal on iOS. */
.tc-guided-camera{background:#0b2035}.tc-pro-scanner-card{background:#eaf3ff}
`;
if(!document.getElementById(style.id))document.head.appendChild(style);
function modernHome(){
 const tools=Array.isArray(state?.tools)?state.tools:[];
 const active=tools.filter(t=>t.status!=='retired');
 const alerts=typeof alarms==='function'?alarms():[];
 const pending=tools.filter(t=>t.status==='assigned'&&
  ((typeof overdue==='function'&&overdue(t))||
   (typeof dueToday==='function'&&dueToday(t)))).length;
 const missing=tools.filter(t=>t.status==='lost').length;
 const avail=typeof countStatus==='function'?countStatus('available'):tools.filter(t=>t.status==='available').length;
 const assigned=typeof countStatus==='function'?countStatus('assigned'):tools.filter(t=>t.status==='assigned').length;
 const cloud=typeof tcCloudOn!=='undefined'&&tcCloudOn;
 return '<section class="tc-welcome"><div><div class="tc-eyebrow">GESTIÓN DE HERRAMIENTAS</div>'+
  '<h2>Buenos días, administrador</h2><p>'+(cloud?'Inventario compartido':'Inventario de este dispositivo')+
  ' · Control en tiempo real</p></div><span class="tc-welcome-symbol">🔧</span></section>'+
  '<h2 class="section tc-block-heading">Resumen del inventario</h2>'+
  '<div class="tc-stats-grid">'+
  '<div class="tc-stat wide"><span class="tc-stat-icon">📦</span><div><b>'+active.length+'</b><small>Total registradas activas</small></div></div>'+
  '<div class="tc-stat green"><span class="tc-stat-icon">✅</span><div><b>'+avail+'</b><small>Disponibles</small></div></div>'+
  '<div class="tc-stat blue"><span class="tc-stat-icon">👷</span><div><b>'+assigned+'</b><small>Asignadas</small></div></div>'+
  '<div class="tc-stat amber"><span class="tc-stat-icon">⚠️</span><div><b>'+pending+'</b><small>Pendientes de hoy o vencidas</small></div></div>'+
  '<div class="tc-stat red"><span class="tc-stat-icon">🔴</span><div><b>'+missing+'</b><small>Extraviadas</small></div></div></div>'+
  '<h2 class="section tc-block-heading">Acciones rápidas</h2><div class="tc-action-grid">'+
  '<button class="tc-action tc-deliver" onclick="go(\'assign\')"><span>📤</span><b>ENTREGAR</b></button>'+
  '<button class="tc-action tc-receive" onclick="go(\'return\')"><span>📥</span><b>RECIBIR</b></button>'+
  '<button class="tc-action tc-scan" onclick="tcIphoneVisualScan2611()"><span>▣</span><b>ESCANEAR</b></button>'+
  '<button class="tc-action tc-add" onclick="go(\'toolnew\')"><span>＋</span><b>REGISTRAR</b></button></div>'+
  '<div class="tc-shortcut"><button onclick="tcGoRegisterMultipleV24()">📦 Registro múltiple <span>›</span></button>'+
  '<button onclick="go(\'cloud\')">⚙️ Administración y configuración <span>›</span></button></div>'+
  '<h2 class="section tc-block-heading">Alertas del día</h2>'+
  '<button class="tc-alert-summary" onclick="go(\'alerts\')"><span>🔔</span><div><b>'+
  (alerts.length?alerts.length+' herramienta(s) requieren atención':'Sin devoluciones vencidas para hoy')+
  '</b><small>'+(alerts.length?'Revisar préstamos, vencimientos y responsables':'Toca para revisar todas las alertas')+
  '</small></div><span>›</span></button>'+
  '<div class="tc-secondary-links"><button onclick="go(\'history\')">🕘 Historial</button>'+
  '<button onclick="go(\'report\')">📄 Reportes y respaldo</button>'+
  '<button onclick="go(\'sms\')">📲 SMS trabajadores</button>'+
  '<button onclick="go(\'about\')">ⓘ Acerca de ToolControl</button></div>';
}
window.tcIphoneVisualScan2611=function(){
 go('inventory');
 if(typeof window.tcInventorySearchScanV24==='function')window.tcInventorySearchScanV24();
 else if(typeof window.openBrowserScanner==='function')window.openBrowserScanner();
};
const previousHome=homeView;
homeView=function(...args){
 const original=previousHome.apply(this,args);
 // Preserve company, follow-up, SMS and administrator panels surrounding the
 // old V2.4 home. Replace ONLY the old home markup, never user records.
 const holder=document.createElement('div');
 holder.innerHTML=original;
 const brand=holder.querySelector('.brand-attribution');
 const oldHeading=Array.from(holder.querySelectorAll('h2.section')).find(x=>x.textContent.trim()==='Más opciones');
 if(!brand||!oldHeading)return modernHome()+original;
 const nodes=[];
 let node=brand, seenMore=false, foundEnd=false;
 while(node){
  const next=node.nextElementSibling;
  if(node===oldHeading)seenMore=true;
  const stop=seenMore&&node.classList.contains('card');
  nodes.push(node);
  if(stop){foundEnd=true;break;}
  node=next;
 }
 if(!foundEnd)return modernHome()+original;
 brand.insertAdjacentHTML('beforebegin',modernHome());
 for(const item of nodes)item.remove();
 return holder.innerHTML;
};
const previousRender=render;
render=function(...args){
 const result=previousRender.apply(this,args);
 // The same 5-item navigation Android V2.6.11 renders on every screen.
 const bar=document.getElementById('bottomnav');
 if(bar){
  const nav=(id,icon,label)=>'<button class="'+(page===id?'active':'')+'" onclick="go(\''+id+'\')"><span>'+icon+'</span>'+label+'</button>';
  bar.innerHTML=nav('home','⌂','Inicio')+nav('inventory','▣','Inventario')+
   '<button class="tc-navscan" onclick="tcIphoneVisualScan2611()" aria-label="Escanear herramienta"><span>▣</span><small>Escanear</small></button>'+
   nav('people','♟','Personal')+nav('alerts','♧','Alertas');
 }
 return result;
};
if(typeof aboutView==='function'){
 const originalAbout=aboutView;
 aboutView=function(...args){
  return originalAbout.apply(this,args).replace(/Versión (?:iPhone )?2\.4/g,'Versión iPhone 2.6.11');
 };
}
window.tcIphoneAndroidVisual2611={version:VERSION,modernHome};
})();
