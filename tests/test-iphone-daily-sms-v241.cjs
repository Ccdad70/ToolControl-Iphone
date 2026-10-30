'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const script=read('tc-iphone-daily-sms-status-v241.js');
const html=read('index.html');
const sw=read('sw.js');
const flow=read('.github/workflows/publicar-iphone.yml');
assert(html.includes('tc-iphone-daily-admin-v24.js'));
assert(html.includes('tc-iphone-daily-sms-status-v241.js'));
assert(sw.includes('tc-iphone-daily-sms-status-v241.js'));
assert(flow.includes('test-iphone-daily-sms-v241.cjs'));
assert(script.includes('tc_daily_admin_sms_status'));
assert(!script.includes('sendTextMessage')&&!script.includes('sendSmsRemindersNow'));
const listeners={};let requested=0;
const ctx={
 console,Promise,Date,Number,String,
 tcCloudOn:true,tcUser:{uid:'user1'},tcWorkspace:'company1',tcDenied:false,page:'home',tcIsCompanyPrincipal:()=>ctx.tcUser.uid==='user1',
 navigator:{onLine:true},tcClient:{rpc:async(name,args)=>{requested++;if(name==='tc_sms_current')return {error:null,data:[{owner_uid:'user2'}]};assert.equal(name,'tc_daily_admin_sms_status');assert.equal(args.p_workspace,'company1');return {error:null,data:{day:'2026-10-29',self_status:null,self_queued:true,self_opted:true,is_primary:true,recipient_count:4,requested:0,failed:0,reserved:0}}}},
 window:{addEventListener(){}},document:{addEventListener(name,fn){listeners[name]=fn},hidden:false},
 setInterval(){},setTimeout(){},toast(){},esc:x=>String(x),render(){},homeView(){return '<article>Vista anterior</article>'},homeView(){return '<article>Nube</article>'}
};
vm.createContext(ctx);vm.runInContext(script,ctx);
(async()=>{
  let view=vm.runInContext('homeView()',ctx);
  assert.match(view,/Vista anterior/);
  assert.match(view,/iPhone consulta el estado/);
  assert.match(view,/Aún no se ha cargado/);
  await vm.runInContext('window.tcIphoneRefreshDailySmsV241()',ctx);
  await new Promise(r=>setImmediate(r));
  view=vm.runInContext('homeView()',ctx);
  assert.match(view,/No hay intentos de SMS registrados hoy/);
  assert.match(view,/Destinatarios habilitados/);
  assert.equal(requested,2);
  ctx.tcUser={uid:'user2'};
  ctx.tcClient.rpc=async(name)=>name==='tc_sms_current'?{error:null,data:[{owner_uid:'user2'}]}:({error:null,data:{day:'2026-10-29',self_status:'requested',self_queued:true,self_opted:true,is_primary:false,recipient_count:null,requested:null,failed:null,reserved:null}});
  await vm.runInContext('window.tcIphoneRefreshDailySmsV241()',ctx);
  await new Promise(r=>setImmediate(r));
  view=vm.runInContext('homeView()',ctx);
  assert.match(view,/solicitud de SMS/);
  assert.doesNotMatch(view,/Destinatarios habilitados/,'no mostrar agregados a administradores que no son principal');
  assert.match(view,/devolución de herramientas/);
  console.log('OK iPhone V2.4.1: diagnostic SMS status, privacy, no direct SMS, prior module intact');
})().catch(e=>{console.error(e);process.exitCode=1});
