const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','tc-iphone-voice-v2614.js'),'utf8');
const spoken=[];
const elements=new Map();
const document={
  readyState:'complete',hidden:false,
  getElementById:id=>elements.get(id)||null,
  addEventListener(){},
  body:{appendChild(el){elements.set(el.id,el);}},
  createElement(){return {style:{},setAttribute(){},addEventListener(type,fn){this.click=fn;}};}
};
class Utterance{constructor(text){this.text=text;}}
let enabledSave=true;
const data={
  tools:[{id:'t1',code:'QR-1',name:'SawZall',status:'available',personId:null}],
  people:[{id:'p1',name:'Juan Pérez'}],history:[]
};
const win={
  document,SpeechSynthesisUtterance:Utterance,
  speechSynthesis:{
    getVoices(){return [{lang:'es-MX'}];},
    speak(u){spoken.push(u.text);setTimeout(()=>u.onend?.(),1);},
    resume(){},cancel(){}
  },
  setTimeout,
  localStorage:{getItem(){return null;},setItem(){}},
  toolByCode:code=>data.tools.find(t=>t.code===code),
  person:id=>data.people.find(p=>p.id===id),
  startContinuousSession(){},
  startReturnContinuousSession(){},
  startBatchRegister(){},
  scanResult(){},
  async assignScannedCode(code,session){
    const tool=data.tools.find(t=>t.code===code);
    if(!enabledSave||tool.status!=='available')return;
    tool.status='assigned';tool.personId=session.personId;session.count++;
  },
  async returnScannedCode(code,session){
    const tool=data.tools.find(t=>t.code===code);
    if(!enabledSave||tool.status!=='assigned')return;
    tool.status='available';tool.personId=null;session.count++;
  },
  async saveTool(){},stopContinuousSession(){}
};
win.window=win;
const ctx=vm.createContext({...win});
ctx.window=ctx;
ctx.__data=data;
vm.runInContext("let state=globalThis.__data;let tcCloudOn=false;let page='inventory';let continuousSession=null;let continuousPromise=Promise.resolve();",ctx);
vm.runInContext(code,ctx);
const delay=()=>new Promise(resolve=>setTimeout(resolve,100));
(async()=>{
  assert.equal(ctx.ToolControlIphoneVoice.available,true);
  assert(elements.has('tcIphoneVoiceButton'));
  const session={count:0,personId:'p1'};
  enabledSave=false;await ctx.assignScannedCode('QR-1',session);await delay();
  assert.equal(spoken.some(x=>x.startsWith('Se asignó')),false);
  enabledSave=true;await ctx.assignScannedCode('QR-1',session);await delay();
  assert(spoken.includes('Se asignó Sawzall a Juan Pérez'));
  await ctx.assignScannedCode('QR-1',session);await delay();
  assert.equal(spoken.filter(x=>x.startsWith('Se asignó')).length,1);
  enabledSave=false;await ctx.returnScannedCode('QR-1',session);await delay();
  assert.equal(spoken.some(x=>x.startsWith('Se recibió')),false);
  enabledSave=true;await ctx.returnScannedCode('QR-1',session);await delay();
  assert(spoken.includes('Se recibió Sawzall de Juan Pérez'));
  ctx.scanResult('✓ REGISTRADA: Drill · QR-2','ok');await delay();
  assert(spoken.includes('Se registró Drill'));
  const previous=spoken.length;
  ctx.ToolControlIphoneVoice.setEnabled(false);
  ctx.scanResult('✓ REGISTRADA: Drill · QR-3','ok');await delay();
  assert.equal(spoken.length,previous);
  assert.equal(ctx.ToolControlIphoneVoice.setEnabled(true),true);
  console.log('OK: voz iPhone 2.6.14 — guardados, errores, duplicados, español y botón.');
})().catch(err=>{console.error(err);process.exitCode=1;});
