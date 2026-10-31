'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..');
const content=fs.readFileSync(root+'/tc-iphone-worker-sms-history-v2611.js','utf8');
const html=fs.readFileSync(root+'/index.html','utf8');
const sw=fs.readFileSync(root+'/sw.js','utf8');
new vm.Script(content);
assert(html.includes('tc-iphone-worker-sms-history-v2611.js'));
assert(sw.includes('tc-iphone-worker-sms-history-v2611.js'));
assert(content.includes('tc_sms_delivery_history_v25'));
assert(!content.includes('sendTextMessage')&&!content.includes('sendSmsRemindersNow'));
let calls=0,principal=true;
const env={
 console,Date,Number,String,Array,
 window:{addEventListener(){}},
 document:{addEventListener(){},hidden:false},
 tcCloudOn:true,tcWorkspace:'one',tcUser:{uid:'admin1'},tcDenied:false,
 tcClient:{rpc:async(name,p)=>{calls++;assert.equal(name,'tc_sms_delivery_history_v25');assert.equal(p.p_workspace,'one');return {data:[{recipient:'Trabajador',status:'sent',created_at:'2026-10-30T10:00:00Z',delivered_at:null}],error:null};}},
 tcIsCompanyPrincipal:()=>principal,navigator:{onLine:true},page:'cloud',
 tcCloudView(){return 'Original';},aboutView(){return 'Original about';},render(){},esc:s=>String(s),
 setTimeout(){},toast(){}
};
vm.createContext(env);vm.runInContext(content,env);
assert.match(vm.runInContext('tcCloudView()',env),/Historial de SMS/);
assert.match(vm.runInContext('aboutView()',env),/V2\.6\.11/);
(async()=>{
 await vm.runInContext('window.tcIphoneWorkerHistoryReload2611()',env);
 await new Promise(r=>setImmediate(r));
 assert.equal(calls,1);
 assert.match(vm.runInContext('tcCloudView()',env),/Android confirmó envío/);
 principal=false;
 assert.doesNotMatch(vm.runInContext('tcCloudView()',env),/Historial de SMS a trabajadores/);
 console.log('OK V2.6.11: historial de trabajadores solo lectura, principal autorizado y sin enviar SMS');
})().catch(e=>{console.error(e);process.exitCode=1;});
