'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'tc-iphone-android-visual-v2611.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
new vm.Script(js);
assert(html.includes('<script src="./tc-iphone-android-visual-v2611.js"></script>'));
assert(sw.includes('tc-iphone-android-visual-v2611.js'));
assert(sw.includes('toolcontrol-iphone-v2611-android-visual-20261031'));
assert.equal(manifest.start_url,'./index.html','preservar inicio instalado');
assert.equal(manifest.theme_color,'#0755a0');
assert(!js.includes('sendTextMessage('),'iPhone no envía SMS sin consentimiento');
assert(!js.includes('tc_apply_changes'),'no cambiar control de inventario');
const styles=[],bar={innerHTML:''},nodes=[];
let inserted='',openedScan=0,lastNavigation='',page='home';
function element(label,cls='',tagName='DIV',textContent=''){
 const o={label,className:cls,tagName,textContent,removed:false,
  classList:{contains(name){return cls.split(' ').includes(name);}},
  get nextElementSibling(){
    const i=nodes.indexOf(o);
    return nodes.slice(i+1).find(x=>!x.removed)||null;
  },
  insertAdjacentHTML(where,html){assert.equal(where,'beforebegin');inserted=html;},
  remove(){o.removed=true;}
 };
 return o;
}
const prefix=element('<div class="card" id="follow">Seguimiento conservado</div>','card');
const brand=element('<div class="brand-attribution">Versión V2.4</div>','brand-attribution');
const stats=element('<div class="stats">Estadísticas V2.4</div>','stats');
const actions=element('<div class="quick">Tarjetas azules antiguas</div>','quick');
const h1=element('<h2 class="section">¿Qué deseas hacer?</h2>','section','H2','¿Qué deseas hacer?');
const h2=element('<h2 class="section">Más opciones</h2>','section','H2','Más opciones');
const oldMore=element('<div class="card">Más opciones antiguas</div>','card');
const suffix=element('<section class="card" id="sms">SMS compartido conservado</section>','card');
nodes.push(prefix,brand,stats,h1,actions,h2,oldMore,suffix);
const holder={_value:'',
 set innerHTML(s){this._value=s;},
 get innerHTML(){return nodes.filter(x=>!x.removed).map(x=>x===brand?inserted+x.label:x.label).join('');},
 querySelector(selector){return selector==='.brand-attribution'?brand:null;},
 querySelectorAll(selector){return selector==='h2.section'?[h1,h2]:[];}
};
const document={
 head:{appendChild(el){styles.push(el);}},
 createElement(t){return t==='style'?{id:'',textContent:''}:holder;},
 getElementById(id){return id==='bottomnav'?bar:null;}
};
const ctx={document,window:{tcInventorySearchScanV24(){openedScan++;}},
  console,Array,Math,Number,String,Set,Date,
  get page(){return page;},set page(v){page=v;},
  state:{tools:[{status:'available'},{status:'assigned'},{status:'lost'},{status:'retired'}]},
  alarms(){return [{id:'pending'}];},overdue(){return false;},dueToday(){return false;},
  countStatus(s){return s==='available'?1:s==='assigned'?1:0;},
  tcCloudOn:true,go(p){lastNavigation=p;page=p;},
  homeView(){return 'previous home';},
  render(){bar.innerHTML='old navbar';},aboutView(){return '<p>Versión 2.4</p>';}
};
vm.createContext(ctx);vm.runInContext(js,ctx);
assert.equal(styles.length,1);
assert.match(styles[0].textContent,/\.tc-action-grid/);
assert.match(styles[0].textContent,/\.bottom \.tc-navscan/);
const home=vm.runInContext('homeView()',ctx);
assert.match(home,/Resumen del inventario/);
assert.match(home,/tc-stats-grid/);
assert.match(home,/Acciones rápidas/);
assert.match(home,/ENTREGAR/);
assert.match(home,/RECIBIR/);
assert.match(home,/ESCANEAR/);
assert.match(home,/REGISTRAR/);
assert.match(home,/Registro múltiple/);
assert.match(home,/Seguimiento conservado/);
assert.match(home,/SMS compartido conservado/);
assert.doesNotMatch(home,/Tarjetas azules antiguas|Más opciones antiguas|Versión V2\.4/);
const about=vm.runInContext('aboutView()',ctx);
assert.match(about,/Versión iPhone 2\.6\.11/);
vm.runInContext('render()',ctx);
assert.match(bar.innerHTML,/tc-navscan/);
assert.match(bar.innerHTML,/Escanear/);
assert.match(bar.innerHTML,/Inventario/);
vm.runInContext('window.tcIphoneVisualScan2611()',ctx);
assert.equal(lastNavigation,'inventory');
assert.equal(openedScan,1,'abre el escáner independiente del inventario');
console.log('OK: portada, indicadores, acciones, barra central, versión y módulos preservados como Android V2.6.11.');
