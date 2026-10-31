'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('tc-iphone-daily-sms-status-v241.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const flow=fs.readFileSync('.github/workflows/publicar-iphone.yml','utf8');
new vm.Script(script);
assert(html.includes('tc-iphone-daily-admin-v24.js'));
assert(html.includes('tc-iphone-daily-sms-status-v241.js'));
assert(sw.includes('tc-iphone-daily-sms-status-v241.js'));
assert(flow.includes('test-iphone-daily-sms-v241.cjs'));
assert(script.includes('tc_morning_v269_iphone_status'),'consultar registros actuales, no módulo SMS diario anterior');
assert(!script.includes('tc_daily_admin_sms_status'));
assert(!script.includes('sendTextMessage')&&!script.includes('sendSmsRemindersNow'));
let calls=0;
const data={day:'2026-10-30',self_status:'requested',self_opted:true,is_primary:true,
 self_attempt_no:16,total:3,requested:3,failed:0,delivered:0,reserved:0};
const ctx={
 console,Promise,Date,Number,String,
 tcCloudOn:true,tcUser:{uid:'user1'},tcWorkspace:'company1',tcDenied:false,page:'cloud',
 navigator:{onLine:true},tcClient:{rpc:async(name,args)=>{
  calls++;assert.equal(name,'tc_morning_v269_iphone_status');assert.equal(args.p_workspace,'company1');
  return {error:null,data};
 }},
 window:{addEventListener(){}},document:{addEventListener(){},hidden:false},
 setInterval(){},setTimeout(){},toast(){},esc:x=>String(x),render(){},tcCloudView(){return '<article>Vista anterior</article>'}
};
vm.createContext(ctx);vm.runInContext(script,ctx);
(async()=>{
 let view=vm.runInContext('tcCloudView()',ctx);
 assert.match(view,/Vista anterior/);
 assert.match(view,/iPhone no envía SMS/);
 await vm.runInContext('window.tcIphoneRefreshDailySmsV241()',ctx);
 await new Promise(r=>setImmediate(r));
 view=vm.runInContext('tcCloudView()',ctx);
 assert.match(view,/Envíos confirmados por Android/);
 assert.match(view,/0 entregas confirmadas/);
 assert.match(view,/Destinatarios con intento hoy/);
 assert.equal(calls,1);
 ctx.tcUser={uid:'user2'};
 ctx.tcClient.rpc=async()=>({error:null,data:{day:'2026-10-30',self_status:'requested',
  self_opted:true,is_primary:false,is_sender:false,self_attempt_no:16,
  total:null,requested:null,failed:null,delivered:null,reserved:null}});
 await vm.runInContext('window.tcIphoneRefreshDailySmsV241()',ctx);
 await new Promise(r=>setImmediate(r));
 view=vm.runInContext('tcCloudView()',ctx);
 assert.match(view,/Android confirmó el envío/);
 assert.doesNotMatch(view,/Destinatarios con intento hoy/,'ocultar agregados a otros administradores');
 console.log('OK iPhone V2.6.9: estado real y privacidad, sin emisor de SMS en iOS');
})().catch(e=>{console.error(e);process.exitCode=1;});
