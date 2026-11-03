/* ToolControl iPhone V2.6.14: avisos de voz locales (PWA Safari).
   No escribe a Supabase ni modifica operaciones, Android, permisos ni SMS.
   Solo anuncia operaciones que confirman el guardado con éxito. */
(function(w){
  'use strict';
  const KEY='tc-iphone-voice-enabled-v2614';
  const synth=w.speechSynthesis;
  const available=!!(synth && w.SpeechSynthesisUtterance);
  let enabled=true,activated=false,busy=false,items=[];
  try { enabled=w.localStorage.getItem(KEY)!=='no'; } catch(e){}
  const cleaned=value=>String(value==null?'':value).replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
  const speechName=value=>cleaned(value).replace(/SawZall/ig,'Sawzall').slice(0,135);
  const localState=()=>typeof state!=='undefined'?state:w.state;
  const cloudEnabled=()=>typeof tcCloudOn!=='undefined'?tcCloudOn:w.tcCloudOn;
  const savedState=()=>typeof tcSaved!=='undefined'?tcSaved:w.tcSaved;
  const currentPage=()=>typeof page!=='undefined'?page:w.page;
  function spanishVoice(){
    try {
      const voices=synth.getVoices()||[];
      return voices.find(v=>/^es[-_]US$/i.test(v.lang)) ||
             voices.find(v=>/^es[-_]MX$/i.test(v.lang)) ||
             voices.find(v=>/^es[-_]/i.test(v.lang)) || null;
    }catch(e){return null;}
  }
  function next(){
    if(!available||!enabled||!activated||busy||!items.length||w.document?.hidden)return;
    const utterance=new w.SpeechSynthesisUtterance(items.shift());
    utterance.lang='es-ES'; utterance.rate=.95; utterance.pitch=1; utterance.volume=1;
    const selected=spanishVoice();
    if(selected){utterance.voice=selected;utterance.lang=selected.lang;}
    busy=true;
    let finished=false;
    const done=()=>{if(finished)return;finished=true;busy=false;w.setTimeout(next,40);};
    utterance.onend=done;utterance.onerror=done;
    try{synth.speak(utterance);}catch(e){done();}
  }
  function say(message){
    if(!available||!enabled)return false;
    const txt=cleaned(message).slice(0,300);
    if(!txt)return false;
    items.push(txt);
    if(items.length>25)items=items.slice(-25);
    next();return true;
  }
  function activate(){
    if(!available||!enabled)return false;
    if(!activated){activated=true;items.unshift('Voz de ToolControl lista');}
    try{if(synth.paused)synth.resume();}catch(e){}
    next();return true;
  }
  function updateButton(){
    const el=w.document?.getElementById('tcIphoneVoiceButton');
    if(!el)return;
    el.textContent=!available?'🔇 Voz no disponible':enabled?'🔊 Voz activada':'🔇 Activar voz';
    el.disabled=!available;el.setAttribute('aria-pressed',String(enabled));
  }
  function setEnabled(v){
    enabled=!!v;
    try{w.localStorage.setItem(KEY,enabled?'yes':'no');}catch(e){}
    if(!enabled){items=[];busy=false;try{synth?.cancel();}catch(e){}}
    else activate();
    updateButton();
    return enabled;
  }
  function mountButton(){
    if(!w.document?.body||w.document.getElementById('tcIphoneVoiceButton'))return;
    const el=w.document.createElement('button');
    el.id='tcIphoneVoiceButton';el.type='button';
    el.title='Anuncios por voz en español';
    el.setAttribute('aria-label','Activar o desactivar confirmaciones por voz');
    el.style.cssText='position:fixed;right:12px;bottom:calc(81px + env(safe-area-inset-bottom));z-index:45;border-radius:18px;padding:8px 12px;font:600 12px system-ui;background:#0d344d;color:#fff;border:1px solid #7bc8ce;box-shadow:0 2px 10px #0a1d3355;max-width:48vw';
    el.addEventListener('click',()=>setEnabled(!enabled));
    w.document.body.appendChild(el);updateButton();
  }
  function onGesture(name){
    const original=w[name];
    if(typeof original!=='function')return;
    w[name]=function(...args){activate();return original.apply(this,args);};
  }
  function onSavedOperation(name,operation){
    const original=w[name];
    if(typeof original!=='function')return;
    w[name]=async function(...args){
      activate();
      const [code,session]=args;
      const count=Number(session?.count||0);
      let tool=null,worker='';
      try {
        tool=typeof w.toolByCode==='function'?w.toolByCode(code):null;
        worker=session?.personId&&typeof w.person==='function'?w.person(session.personId)?.name||'':'';
      }catch(e){}
      const result=await original.apply(this,args);
      if(tool&&worker&&session&&Number(session.count||0)>count){
        if(operation==='entrega'&&tool.status==='assigned'&&tool.personId===session.personId){
          say('Se asignó '+speechName(tool.name)+' a '+speechName(worker));
        } else if(operation==='devolución'&&(tool.status==='available'||tool.status==='damaged')&&!tool.personId){
          say('Se recibió '+speechName(tool.name)+' de '+speechName(worker));
        }
      }
      return result;
    };
  }
  function onMultiRegistration(){
    const original=w.scanResult;
    if(typeof original!=='function')return;
    w.scanResult=function(message,kind,...args){
      const result=original.call(this,message,kind,...args);
      const match=kind==='ok'&&/^✓\s*REGISTRADA:\s*(.+?)\s*·\s*(.+)$/i.exec(cleaned(message));
      if(match)say('Se registró '+speechName(match[1]));
      return result;
    };
  }
  function onSingleRegistration(){
    const original=w.saveTool;
    if(typeof original!=='function')return;
    w.saveTool=async function(...args){
      activate();
      let before,previousHistory='';
      try {
        before=new Set((localState()?.tools||[]).map(t=>t.id));
        previousHistory=localState()?.history?.[0]?.id||'';
      }catch(e){before=new Set();}
      const result=await original.apply(this,args);
      try {
        const tool=(localState()?.tools||[]).find(t=>!before.has(t.id));
        const h=localState()?.history?.[0];
        const isPersisted=!cloudEnabled()||(savedState()?.tools||[]).some(t=>t.id===tool?.id);
        if(tool&&h?.id!==previousHistory&&h?.action==='registro'&&h?.toolId===tool.id&&isPersisted&&currentPage()==='inventory'){
          say('Se registró '+speechName(tool.name));
        }
      }catch(e){}
      return result;
    };
  }
  function onCloseSession(){
    const original=w.stopContinuousSession;
    if(typeof original!=='function')return;
    w.stopContinuousSession=function(showSummary=true){
      const session=typeof continuousSession!=='undefined'?continuousSession:w.continuousSession;
      const pending=typeof continuousPromise!=='undefined'?continuousPromise:Promise.resolve();
      const result=original.apply(this,arguments);
      if(showSummary&&session?.mode==='return'){
        Promise.resolve(pending).then(()=>{
          if(Number(session.count||0)<1)return;
          const remaining=(localState()?.tools||[]).filter(t=>t.status==='assigned'&&t.personId===session.personId).length;
          say('Recepción finalizada: '+session.count+' herramientas recibidas de '+speechName(session.personName)+'. '+remaining+' pendientes por devolver.');
        }).catch(()=>{});
      }
      return result;
    };
  }
  w.ToolControlIphoneVoice=Object.freeze({
    available,activate,announce:say,setEnabled,isEnabled:()=>enabled,
    pendingCount:()=>items.length
  });
  onGesture('startContinuousSession');
  onGesture('startReturnContinuousSession');
  onGesture('startBatchRegister');
  onSavedOperation('assignScannedCode','entrega');
  onSavedOperation('returnScannedCode','devolución');
  onMultiRegistration();onSingleRegistration();onCloseSession();
  if(w.document?.readyState==='loading')w.document.addEventListener('DOMContentLoaded',mountButton);
  else mountButton();
  w.document?.addEventListener('visibilitychange',()=>{
    if(!w.document.hidden){try{synth?.resume();}catch(e){}next();}
  });
})(window);
