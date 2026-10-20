/* ToolControl iPhone 2.2: feedback de recepcion y alta continua de herramientas identicas.
   No modifica Android, autenticacion, permisos, tablas ni API de Supabase. */
(function(){
  'use strict';
  // Mantener intactas las funciones originales para las operaciones habituales.
  const originalToast=toast;
  toast=function(message,kind){
    originalToast(message);
    const el=document.getElementById('toastbox');
    if(!el)return;
    const type=kind||(/^(✓|✔|Recepción confirmada|Herramienta guardada|Registro completado)/i.test(String(message))?'ok':'');
    el.classList.toggle('tc-ok',type==='ok');
    el.classList.toggle('tc-error',type==='error');
  };

  function tcWrongCodeBeep(){
    try{
      prepareScanAudio();
      if(!scanAudio||scanAudio.state!=='running')return;
      const start=scanAudio.currentTime;
      [0,0.13].forEach((delay,index)=>{
        const o=scanAudio.createOscillator(),g=scanAudio.createGain(),t=start+delay;
        o.type='sine';o.frequency.setValueAtTime(index===0?440:320,t);
        g.gain.setValueAtTime(0.0001,t);
        g.gain.exponentialRampToValueAtTime(0.16,t+0.008);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.095);
        o.connect(g);g.connect(scanAudio.destination);
        o.start(t);o.stop(t+0.1);
      });
    }catch(e){}
  }
  const originalScanResult=scanResult;
  scanResult=function(message,kind='error'){
    originalScanResult(message,kind);
    if(kind==='error'||kind==='duplicate')tcWrongCodeBeep();
    if(!continuousSession?.active){
      if(kind==='ok')playScanBeep();
      const el=document.getElementById('toastbox');
      if(el){el.classList.toggle('tc-ok',kind==='ok');el.classList.toggle('tc-error',kind==='error'||kind==='duplicate');}
    }
    const target=document.getElementById('tcScanResultBanner');
    if(target&&(kind==='ok'||kind==='error'||kind==='duplicate')){
      target.textContent=message;
      target.className='tc-scan-result '+(kind==='ok'?'ok':'error');
      target.hidden=false;
      clearTimeout(target._tcTimer);
      target._tcTimer=setTimeout(()=>{target.hidden=true},2200);
    }
  };

  // Una foto y datos comunes para un lote; cada herramienta conserva su propio ID y codigo.
  const originalToolForm=toolForm;
  toolForm=function(tool){
    const html=originalToolForm(tool);
    if(tool?.id||editId)return html; // Editar una herramienta existente sigue siendo individual.
    const batch=`<div class="tc-batch-block">
      <button type="button" class="btn secondary block" onclick="startBatchRegister()">▣ Registrar varias herramientas iguales</button>
      <small>Escribe el nombre, marca y modelo una sola vez y elige una foto. Después escanea todos los códigos sin pulsar Guardar otra vez. Cada código crea una herramienta distinta.</small>
      <p id="tcBatchSummary" class="hint" role="status"></p>
    </div>`;
    return html.replace('</form>',batch+'</form>');
  };

  window.startBatchRegister=function(){
    prepareScanAudio(); // iOS necesita habilitar audio mediante una interacción del usuario.
    if(editId)return toast('Termina la edición antes de registrar un lote.','error');
    if(continuousSession?.active)return;
    const name=(document.getElementById('toolName')?.value||'').trim();
    if(!name)return toast('Primero escribe el nombre de la herramienta.','error');
    if(tcCloudOn&&(!navigator.onLine||!tcReady))return toast('Conecta el inventario de Supabase antes de registrar un lote.','error');
    const firstCode=(document.getElementById('toolCode')?.value||'').trim();
    continuousSession={
      mode:'register',active:true,name,brand:(document.getElementById('toolBrand')?.value||'').trim(),
      serial:(document.getElementById('toolSerial')?.value||'').trim(),photo:photoData||'',
      personName:name,count:0,savedIds:new Set(),last:'',seenCodes:new Set()
    };
    continuousPromise=Promise.resolve();continuousCodeTimes.clear();
    openContinuousBrowserScanner();
    if(firstCode)receiveContinuousCode(firstCode);
  };

  async function tcSaveBatchCode(raw,session){
    const code=String(raw||'').trim();
    if(!code||!session)return;
    if(session.seenCodes.has(code.toUpperCase())){
      scanResult('Código repetido en este lote: '+code,'duplicate');return;
    }
    if(toolByCode(code)){
      scanResult('Código ya registrado: '+code+' · no se duplicó.','error');return;
    }
    // Reusar los mismos campos/foto, nunca reusar identificadores o codigos.
    const t={id:newId(),name:session.name,code,brand:session.brand,serial:session.serial,
      photo:session.photo,status:'available',personId:null,assignedAt:null,due:'',notes:''};
    state.tools.push(t);
    logMove('registro',t,null,'Registro continuo desde iPhone');
    const historyId=state.history[0]?.id;
    let ok=false;
    try{ok=await save()}catch(err){ok=false;}
    if(!ok){
      state.tools=state.tools.filter(x=>x.id!==t.id);
      state.history=state.history.filter(h=>h.id!==historyId);
      continuousCodeTimes.delete(code);
      scanResult('No se guardó '+code+'. Verifica la conexión y vuelve a escanear.','error');
      return;
    }
    session.seenCodes.add(code.toUpperCase());session.savedIds.add(t.id);
    session.count++;session.last=code;
    const summary=document.getElementById('tcBatchSummary');
    if(summary)summary.textContent='✓ '+session.count+' herramientas iguales registradas. Último código: '+code;
    const input=document.getElementById('toolCode');if(input&&input.value.trim()===code)input.value='';
    scanResult('✓ REGISTRADA: '+session.name+' · '+code,'ok');
  }

  const originalReceiveContinuousCode=receiveContinuousCode;
  receiveContinuousCode=function(raw){
    const session=continuousSession;
    if(!session?.active||session.mode!=='register')return originalReceiveContinuousCode(raw);
    const code=String(raw||'').trim();if(!code)return;
    continuousPromise=continuousPromise.then(()=>tcSaveBatchCode(code,session)).catch(e=>{
      scanResult('Error al registrar: '+String(e?.message||e),'error');
    });
  };
  window.receiveContinuousScan=receiveContinuousCode;

  const originalOpenContinuousBrowserScanner=openContinuousBrowserScanner;
  openContinuousBrowserScanner=function(){
    const registration=continuousSession?.mode==='register';
    const promise=originalOpenContinuousBrowserScanner();
    if(registration){
      const modal=document.getElementById('scanModal');
      if(modal){
        const title=modal.querySelector('.sheet-title h2');if(title)title.textContent='Registro continuo de herramientas';
        const caption=modal.querySelector('.sheet > p.hint');if(caption)caption.innerHTML='Herramientas iguales: <b>'+esc(continuousSession.name)+'</b> · foto compartida';
        const counter=modal.querySelector('.scan-counter');if(counter)counter.innerHTML='<b id="continuousCount">0</b> herramientas registradas';
        const finish=modal.querySelector('.sheet > button.btn');if(finish)finish.textContent='✓ Terminé de escanear';
      }
    }
    const sheet=document.querySelector('#scanModal .sheet');
    if(sheet&&!document.getElementById('tcScanResultBanner')){
      const result=document.createElement('div');result.id='tcScanResultBanner';result.hidden=true;
      result.className='tc-scan-result';result.setAttribute('role','status');
      const title=sheet.querySelector('.sheet-title');title?.insertAdjacentElement('afterend',result);
    }
    return promise;
  };

  const originalStopContinuousSession=stopContinuousSession;
  stopContinuousSession=function(showSummary=true){
    const session=continuousSession;
    if(session?.mode!=='register')return originalStopContinuousSession(showSummary);
    session.active=false;
    closeScan();continuousSession=null;
    continuousPromise.then(()=>{
      const message='Registro completado: '+session.count+' herramienta'+(session.count===1?'':'s')+' con códigos diferentes y foto compartida.';
      const summary=document.getElementById('tcBatchSummary');if(summary)summary.textContent=message;
      if(showSummary)toast(message,'ok');
    });
  };
})();