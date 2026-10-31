'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const js=fs.readFileSync('tc-iphone-history-v269.js','utf8');
new vm.Script(js);
assert(js.includes('tc_history_v263_reset'));
assert(js.includes('tc_history_v263_cutoff'));
assert(js.includes('BORRAR HISTORIAL'));
assert(js.includes('tcIsCompanyPrincipal()'));
assert(!js.includes('onload="tcIphoneResetHistory269()"'));
let saves=0,cutoffs=0,principal=true,confirmation=null;
const ctx={
 console,Date,Number,String,Array,Promise,
 state:{history:[{id:'old',at:'2025-01-01T00:00:00Z'},{id:'new',at:'2026-10-31T00:00:00Z'}]},
 tcRemote:{history:[]},tcSaved:{history:[]},tcOps:[],tcCloudOn:true,tcClient:{rpc:async(n)=>{
  if(n==='tc_history_v263_cutoff'){cutoffs++;return {data:'2026-10-30T00:00:00Z',error:null};}
  if(n==='tc_history_v263_reset'){saves++;return {data:2,error:null};}
  throw Error(n);
 }},tcWorkspace:'w',tcUser:{uid:'u'},tcDenied:false,
 tcIsCompanyPrincipal:()=>principal,page:'history',
 navigator:{onLine:true},document:{addEventListener(){},hidden:false},
 window:{addEventListener(){}},setTimeout(){},historyView(){return 'Previo '+ctx.state.history.length;},
 render(){},esc:x=>String(x),toast(){},
 prompt(){return confirmation;},confirm(){return true;},
 tcRefresh:async()=>true
};
vm.createContext(ctx);vm.runInContext(js,ctx);
(async()=>{
 assert.match(vm.runInContext('historyView()',ctx),/Borrar historial compartido/);
 assert.equal(saves,0,'abrir historial nunca debe borrar datos');
 await vm.runInContext('window.tcIphoneResetHistory269()',ctx);
 assert.equal(saves,0,'sin confirmación exacta no se borra');
 await vm.runInContext('window.tcIphoneHistoryReload269()',ctx);
 await new Promise(resolve=>setImmediate(resolve));
 assert(cutoffs>=1,'consulta corte de la empresa');
 assert.match(vm.runInContext('historyView()',ctx),/Previo 1/,'oculta movimientos anteriores al corte');
 assert.equal(ctx.state.history.length,2,'no modifica la lista original por filtrar');
 principal=false;
 assert.doesNotMatch(vm.runInContext('historyView()',ctx),/Borrar historial compartido/);
 await vm.runInContext('window.tcIphoneResetHistory269()',ctx);
 assert.equal(saves,0,'administradores normales no pueden borrar');
 principal=true;confirmation='BORRAR HISTORIAL';
 await vm.runInContext('window.tcIphoneResetHistory269()',ctx);
 assert.equal(saves,1,'sólo después de confirmación explícita');
 console.log('OK iPhone V2.6.9: historial seguro, filtro, principal y confirmación');
})().catch(e=>{console.error(e);process.exitCode=1;});
