'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','tc-iphone-inventory-v24.js'),'utf8');
const elements=new Map();
const get=id=>{
  if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',style:{}});
  return elements.get(id);
};
const body={};
const events={};
const ctx={
  state:{tools:[],people:[]},page:'inventory',toolFilter:'all',inventorySearch:'',
  continuousSession:null,scanDone:null,
  person:id=>ctx.state.people.find(p=>p.id===id),
  overdue:()=>false,
  esc:value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  toolsHtml:list=>list.map(t=>'<span>TOOL:'+t.code+'</span>').join(''),
  empty:()=>'Vacío',
  $:get,
  toast:msg=>{ctx.lastToast=msg;},
  prepareScanAudio:()=>{ctx.audioReady=true;},
  openBrowserScanner:()=>{ctx.scanOpen=(ctx.scanOpen||0)+1;},
  go:name=>{ctx.page=name;ctx.render();},
  render:()=>{ctx.lastRender=ctx.inventoryView();},
  showTool:id=>{ctx.openedId=id;},
  document:{head:{appendChild:()=>{}},createElement:()=>({})},
  window:{},
  Set,Map,console
};
vm.createContext(ctx);
vm.runInContext(src,ctx);
const {categoryOf,groupTools,matchesInventorySearch}=ctx.window.tcInventoryGroupHelpersV24;
const tools=[
  {id:'a',name:'Milwaukee Impact Driver',code:'QR-001',brand:'Milwaukee',model:'2853-20',serial:'SN-XYZ100',status:'available'},
  {id:'b',name:'DeWalt Impacto 20V',code:'QR-002',brand:'DeWalt',serial:'SERIE 7654',status:'assigned'},
  {id:'c',name:'Hole Hawg Milwaukee',code:'QR-003',status:'available'},
  {id:'d',name:'Milwaukee Grinder M18',code:'QR-004',status:'available'},
  {id:'e',name:'DeWalt Grinder 20V',code:'QR-005',serial:'GM-22-A1',status:'assigned'},
  {id:'f',name:'Bateria M18',code:'QR-006',status:'retired'},
  {id:'g',name:'Cordless Drill Milwaukee',code:'QR-007',status:'available'},
  {id:'h',name:'Bandsaw M18',code:'QR-008',status:'available'},
  {id:'i',name:'Circular Saw DeWalt',code:'QR-009',status:'available'},
  {id:'j',name:'Rotary Hammer Milwaukee',code:'QR-010',status:'available'},
  {id:'k',name:'Sawzall Milwaukee',code:'QR-011',status:'available'}
];
ctx.state.tools=tools;
assert.equal(categoryOf(tools[0].name),'impact');
assert.equal(categoryOf(tools[1].name),'impact');
assert.equal(categoryOf(tools[2].name),'holehawg');
assert.equal(categoryOf(tools[6].name),'drill');
assert.equal(categoryOf(tools[7].name),'bandsaw');
assert.equal(groupTools(tools).find(g=>g.name==='Grinder').items.length,2);
assert.equal(groupTools(tools).reduce((total,g)=>total+g.items.length,0),tools.length);
assert.equal(matchesInventorySearch(tools[0],'2853-20'),true);
assert.equal(matchesInventorySearch(tools[0],'SNXYZ100'),true);
assert.equal(matchesInventorySearch(tools[1],'serie 7654'),true);
assert.equal(matchesInventorySearch(tools[1],'qr002'),true);
assert.equal(matchesInventorySearch(tools[0],'no-existe'),false);
assert.ok(ctx.inventoryView().includes('📷 Escanear'));
assert.ok(ctx.inventoryView().includes('Total registradas: <strong>11</strong>'));
assert.ok(ctx.inventoryView().includes('10</strong>'),'retiradas excluidas del filtro general');
ctx.window.tcToggleInventoryGroupV24('impact');
assert.ok(get('inventoryItems').innerHTML.includes('TOOL:QR-001'),'despliega grupo Impacto');
ctx.inventorySearch='GM22A1';
ctx.window.tcToggleInventoryGroupV24('auto-grinder');
ctx.renderInventoryItems();
assert.ok(get('inventoryItems').innerHTML.includes('TOOL:QR-005'),'busca por serie ignorando guiones');
assert.ok(!get('inventoryItems').innerHTML.includes('TOOL:QR-004'));
ctx.inventorySearch='';
ctx.window.tcInventorySearchScanV24();
assert.equal(ctx.scanOpen,1,'usa lector QR existente en iPhone');
assert.equal(typeof ctx.scanDone,'function');
ctx.scanDone('qr-003');
assert.equal(ctx.openedId,'c','QR abre la ficha');
assert.equal(ctx.inventorySearch,'QR-003');
assert.ok(ctx.lastRender.includes('Hole Hawg'));
ctx.scanDone('QR-006');
assert.equal(ctx.toolFilter,'retired','puede encontrar retiradas');
assert.equal(ctx.openedId,'f');
ctx.scanDone('QR-INEXISTENTE');
assert.equal(ctx.openedId,'f','no abre herramienta equivocada');
assert.match(ctx.lastToast,/No se encontró/);
ctx.continuousSession={active:true};
ctx.scanOpen=0;
ctx.window.tcInventorySearchScanV24();
assert.equal(ctx.scanOpen,0,'no interrumpe entrega o devolución continua');
const toolCount=ctx.state.tools.length;
ctx.continuousSession=null;
ctx.state.tools.push({id:'new',name:'Milwaukee Cable Cutter M18',code:'QR-012',status:'available'});
assert.equal(groupTools(ctx.state.tools).reduce((total,g)=>total+g.items.length,0),toolCount+1);
assert.ok(groupTools(ctx.state.tools).find(g=>g.name==='Cable Cutter'));
console.log('OK iPhone: agrupación dinámica, contadores, filtro, búsqueda por modelo/serie, QR, retire y sesiones intactas');
