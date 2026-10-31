'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const js=fs.readFileSync('tc-iphone-daily-admin-v24.js','utf8');
const sw=fs.readFileSync('sw.js','utf8');
new vm.Script(js);
assert(js.includes('tc_morning_v263_config_get'),'debe leer la misma configuración que Android V2.6.9');
assert(js.includes('tc_morning_v263_config_save'),'guardar realmente en Supabase Android');
assert(js.includes('type="time"'),'hora editable');
assert(js.includes('maxlength="480"'),'límite real del servidor, no el antiguo 500');
assert(js.includes('tcIsCompanyPrincipal()'),'controles del administrador principal');
assert(js.includes('Android autorizado'),'instrucciones de sincronizar alarma Android');
assert(!js.includes('tc_daily_admin_config'),'no programar el horario antiguo y divergente');
assert(!js.includes('sendTextMessage(')&&!js.includes('sendMultipartTextMessage('),'iOS PWA no envía SMS');
assert(sw.includes('tc-iphone-daily-admin-v24.js'));
let calls=[],saved=null;
const config={enabled:true,time:'06:30',days:[1,2,3,4,5,6],message:'Buenos dias equipo, revisen ToolControl.'};
const inputs={
 tcMorningIphoneTime269:{value:'07:15'},
 tcMorningIphoneMessage269:{value:'Recuerden mantener actualizado el inventario y las devoluciones.'},
 tcMorningIphoneEnabled269:{checked:true}
};
const env={
 console,Date,Number,String,Set,Array,Promise,window:{addEventListener(){}},
 tcCloudOn:true,tcClient:{rpc:async(name,args)=>{
  calls.push({name,args});if(name==='tc_morning_v263_config_get')return {data:config,error:null};
  if(name==='tc_morning_v263_config_save'){saved=args;return {data:config,error:null};}
  throw Error('RPC inesperado '+name);
 }},tcWorkspace:'workspace-1',tcUser:{uid:'primary-1'},tcDenied:false,
 tcIsCompanyPrincipal:()=>true,
 navigator:{onLine:true},
 document:{
  getElementById:id=>inputs[id]||null,
  querySelectorAll:()=>[{value:'1'},{value:'2'},{value:'3'}],
  addEventListener(){}
 },
 page:'cloud',tcCloudView:()=>'<div>Previo</div>',
 render:()=>{},esc:s=>String(s),toast:()=>{},setInterval:()=>{},setTimeout:()=>{}
};
vm.createContext(env);vm.runInContext(js,env);
assert.match(vm.runInContext('tcCloudView()',env),/Cargar configuracion compartida/);
(async()=>{
 await vm.runInContext('window.tcMorningIphoneReload269()',env);
 await new Promise(r=>setImmediate(r));
 let html=vm.runInContext('tcCloudView()',env);
 assert.match(html,/07|06:30/);
 assert.match(html,/Android autorizado/);
 await vm.runInContext('window.tcMorningIphoneSave269()',env);
 assert.equal(saved.p_workspace,'workspace-1');
 assert.equal(saved.p_time,'07:15');
 assert.equal(saved.p_days.length,3);
 assert.equal(saved.p_message,inputs.tcMorningIphoneMessage269.value);
 assert.equal(calls.filter(x=>x.name==='tc_morning_v263_config_save').length,1);
 console.log('OK iPhone V2.6.9: horario real Android, principal autorizado y sin SMS local');
})().catch(e=>{console.error(e);process.exitCode=1;});
