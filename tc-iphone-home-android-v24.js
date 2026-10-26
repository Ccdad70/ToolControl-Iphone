/* ToolControl iPhone V2.4 — pantalla Inicio igual al diseño Android.
 * Solo presentación y navegación: no modifica datos, usuarios, escaneo ni Supabase.
 */
(function(){
  'use strict';
  const style=document.createElement('style');
  style.id='tc-iphone-home-android-v24-style';
  style.textContent="\n/* Igualar la pantalla Inicio al diseño Android mostrado por el usuario. */\n.app{background:#eaf0f9}\n.app main{padding-left:16px;padding-right:16px}\n.app .brand-attribution{\n  margin-bottom:17px;border-radius:17px 17px 18px 18px;\n  border:1px solid #2375b5;background:linear-gradient(150deg,#102c4d,#062344);\n  box-shadow:0 8px 22px rgba(10,38,69,.13);\n}\n.app .brand-attribution .credit{font-size:12px;font-weight:700}\n.app .brand-attribution .credit strong{font-size:14px;line-height:1.4;margin-top:3px}\n.app .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:3px 0 20px}\n.app .stats .stat{\n  border-radius:16px;min-width:0;padding:15px 4px 13px;\n  background:#fff;box-shadow:0 6px 17px rgba(30,61,91,.04);border:0\n}\n.app .stats .stat b{font-size:30px;font-weight:800;line-height:1.2;color:#0869c7}\n.app .stats .stat b.emerald{color:#188777}\n.app .stats .stat b.orange{color:#e7972d}\n.app .stats .stat span{font-size:12px;color:#748591;display:block;margin-top:6px}\n.app h2.section{font-size:17px;font-weight:800;margin-top:20px;margin-bottom:12px;color:#182f43}\n.app .tc-home-actions-v24{\n display:grid;grid-template-columns:repeat(2,minmax(0,1fr));\n gap:12px;align-items:stretch\n}\n.app .tc-home-actions-v24 button{\n display:flex;flex-direction:column;justify-content:center;align-items:center;\n text-align:center;gap:8px;min-width:0;width:100%;min-height:145px;\n padding:18px 10px 15px;border-radius:19px;\n background:linear-gradient(155deg,#0d2b4e 0%,#071c35 90%);\n border:1px solid #2475b3;color:#fff;\n box-shadow:0 9px 18px rgba(8,36,65,.15);\n -webkit-tap-highlight-color:transparent\n}\n.app .tc-home-actions-v24 button:focus-visible{outline:3px solid #4baff7;outline-offset:3px}\n.app .tc-home-actions-v24 button:active{transform:scale(.985)}\n.app .tc-home-actions-v24 .emoji{\n width:57px;height:57px;display:grid;place-items:center;\n border-radius:15px;background:#173f6b;font-size:32px;line-height:1\n}\n.app .tc-home-actions-v24 b{color:#fff;font-size:14px;font-weight:800;line-height:1.25}\n.app .tc-home-actions-v24 small{color:#b1cce8;font-size:11px;line-height:1.32}\n.app .tc-home-batch-hint{\n background:#e8f2ff;border:1px solid #aed5fb;border-radius:13px;\n padding:12px;color:#17436e;font-size:13px;line-height:1.55;margin:0 0 16px\n}\n.bottom{background:#fff;box-shadow:0 -4px 15px rgba(16,47,80,.06)}\n.bottom button.active{color:#0a65c7}\n@media(min-width:550px){.app .tc-home-actions-v24 button{min-height:160px}}\n@media(max-width:360px){\n .app .tc-home-actions-v24{gap:9px}\n .app .tc-home-actions-v24 button{padding:14px 6px;min-height:135px}\n .app .tc-home-actions-v24 b{font-size:13px}\n .app .tc-home-actions-v24 small{font-size:10px}\n .app .stats{gap:7px}\n .app .stats .stat b{font-size:27px}\n}\n";
  if(!document.getElementById(style.id))document.head.appendChild(style);

  // Los cinco accesos de la captura conducen a los flujos iPhone existentes.
  const actions=[
    {icon:'📦',name:'Registro múltiple',sub:'Varias herramientas iguales',action:'tcGoRegisterMultipleV24()'},
    {icon:'🔎',name:'Registrar herramienta',sub:'Nueva herramienta',action:"go('toolnew')"},
    {icon:'↗',name:'Entregar',sub:'Asignar a empleado',action:"go('assign')"},
    {icon:'↙',name:'Recibir',sub:'Registrar devolución',action:"go('return')"},
    {icon:'🧰',name:'Inventario',sub:'Buscar herramientas',action:"go('inventory')"}
  ];
  function actionMarkup(){
    return '<div class="quick tc-home-actions-v24">'+actions.map(x=>
      '<button type="button" onclick="'+x.action+'" aria-label="'+x.name+': '+x.sub+'">'+
       '<span class="emoji" aria-hidden="true">'+x.icon+'</span>'+
       '<b>'+x.name+'</b><small>'+x.sub+'</small></button>'
    ).join('')+'</div>';
  }

  window.tcGoRegisterMultipleV24=function(){
    // El registro múltiple ya existe en iPhone: se abre el formulario
    // donde el usuario escribe nombre, marca, modelo y pulsa el botón del lote.
    go('toolnew');
    const form=document.getElementById('toolForm');
    if(!form || form.querySelector('.tc-home-batch-hint'))return;
    const hint=document.createElement('p');
    hint.className='tc-home-batch-hint';
    hint.textContent='Registro múltiple: escribe los datos y selecciona una foto. Después pulsa «Registrar varias herramientas iguales» y escanea cada código.';
    form.insertBefore(hint,form.firstChild);
    const batch=form.querySelector('.tc-batch-block');
    if(batch)batch.classList.add('tc-batch-from-home-v24');
  };
  const originalHome=homeView;
  homeView=function(...args){
    const html=originalHome.apply(this,args);
    // Sustituir únicamente las cinco acciones de Inicio. No tocar tarjetas
    // de seguimiento, SMS, seguridad o histórico añadidas por otros módulos.
    return html.replace(/<div class="quick">[\s\S]*?<\/div>/,actionMarkup());
  };
  window.tcIphoneHomeV24={actionMarkup};
})();