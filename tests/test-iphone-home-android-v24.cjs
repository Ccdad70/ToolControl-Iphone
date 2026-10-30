'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','tc-iphone-home-android-v24.js'),'utf8');
const styles=[];
const nodes={};
const form={
  firstChild:{id:'originalFirst'},
  appended:[],batch:{classList:{names:[],add(x){this.names.push(x)}}},
  querySelector(selector){
    if(selector==='.tc-home-batch-hint')return this.appended.find(x=>x.className==='tc-home-batch-hint')||null;
    if(selector==='.tc-batch-block')return this.batch;
    return null;
  },
  insertBefore(node,anchor){assert.equal(anchor,this.firstChild);this.appended.unshift(node);}
};
const ctx={
  document:{
    createElement:type=>({type,id:'',textContent:'',className:''}),
    getElementById:id=>id==='toolForm'?form:null,
    head:{appendChild:n=>styles.push(n)}
  },
  homeView:()=>'<section id="followCard24">Seguimiento existente</section><div class="brand-attribution">Desarrollado por</div><div class="stats">3 contadores</div>'+
    '<h2 class="section">¿Qué deseas hacer?</h2><div class="quick"><button onclick="go(\'toolnew\')">Registrar</button></div>'+
    '<h2 class="section">Más opciones</h2><div class="card">Historial de movimientos</div>',
  page:'home',go:target=>{ctx.page=target;ctx.lastGo=target},
  window:{},console
};
vm.createContext(ctx);vm.runInContext(src,ctx);
assert.equal(styles.length,1,'se instala estilo una vez');
assert.match(styles[0].textContent,/background:linear-gradient\(155deg,#0d2b4e/,'tarjetas azul marino');
assert.match(styles[0].textContent,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'rejilla 2 columnas');
assert.match(styles[0].textContent,/\.bottom button\.active/,'barra inferior');
const html=ctx.homeView();
for(const label of ['Registro múltiple','Registrar herramienta','Entregar','Recibir','Inventario','Seguimiento']){
  assert.ok(html.includes('<b>'+label+'</b>'),'acceso '+label);
}
for(const target of ["go('toolnew')","go('assign')","go('return')","go('inventory')","go('cloud')"]){
  assert.ok(html.includes(target),'ruta '+target);
}
assert.match(html,/tcGoRegisterMultipleV24/);
assert.equal((html.match(/class="emoji"/g)||[]).length,6,'seis tarjetas con íconos');
assert.equal((html.match(/tc-home-actions-v24/g)||[]).length,1,'no duplica tarjetas');
assert.match(html,/Seguimiento existente/,'mantiene seguimiento');
assert.match(html,/Historial de movimientos/,'mantiene otras opciones');
assert.match(html,/brand-attribution/,'mantiene logo original');
assert.match(html,/class="stats"/,'mantiene contadores actuales');
ctx.window.tcGoRegisterMultipleV24();
assert.equal(ctx.lastGo,'toolnew','acceso abre registro existente');
assert.equal(form.appended.length,1);
assert.match(form.appended[0].textContent,/Registrar varias herramientas iguales/);
assert.equal(form.batch.classList.names[0],'tc-batch-from-home-v24');
ctx.window.tcGoRegisterMultipleV24();
assert.equal(form.appended.length,1,'no duplica instrucciones');
assert.equal(src.includes('tcClient.rpc'),false,'no toca Supabase ni datos');
console.log('OK: Inicio estilo Android, seis tarjetas, contadores, accesos y registro múltiple iPhone');
