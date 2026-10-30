'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),home=read('tc-iphone-home-android-v24.js'),
followup=read('tc-iphone-followup-2.4.js'),push=read('tc-iphone-push-admin-v241.js'),
daily=read('tc-iphone-daily-admin-v24.js'),status=read('tc-iphone-daily-sms-status-v241.js'),sw=read('sw.js');
assert(home.includes("name:'Seguimiento'"),'Sexto botón');
assert(home.includes("action:\"go('cloud')\""),'Seguimiento abre pantalla completa');
assert(!followup.includes('<h3>📋 Seguimiento V2.4</h3><p class="hint">'), 'Sin tarjeta gigante en Inicio');
assert(followup.includes('tcCloudView=function()'), 'Seguimiento completo permanece');
assert(daily.includes('return html+settingsCard()'), 'recordatorio al final');
assert(daily.includes('send_time:sendTime'), 'SMS horario editable');
assert(status.includes('tc_sms_current'), 'encargado desde servidor');
assert(status.includes('tcIsCompanyPrincipal()'), 'diagnóstico exclusivo');
assert(push.includes('tcIsCompanyPrincipal()'), 'PUSH exclusivo principal');
assert(push.includes('settings-update'),'Panel PUSH activo con backend');
assert(html.includes('tc-iphone-push-admin-v241.js'));
assert(sw.includes('tc-iphone-push-admin-v241.js'));
console.log('OK iPhone V2.4.1: Inicio seis botones, permisos, recordatorios y PUSH protegido');
