/* ToolControl iPhone V2.4 — guía de escaneo visual.
 * No cambia decodificadores, permisos, QR, registro, entrega ni recepción.
 * El marco es una guía; la detección sigue utilizando toda la imagen.
 */
(function(){
  'use strict';
  const style=document.createElement('style');
  style.id='tc-iphone-scanner-frame-v24';
  style.textContent="\n.tc-guided-camera{width:100%;position:relative;overflow:hidden;border-radius:14px;background:#14212c;isolation:isolate}\n.tc-guided-camera>video{display:block;width:100%;max-width:100%;margin:0;object-fit:cover;min-height:190px}\n.tc-scan-overlay{position:absolute;inset:0;z-index:2;pointer-events:none}\n.tc-scan-frame{position:absolute;box-sizing:border-box;left:15%;right:15%;top:17%;bottom:19%;min-height:105px;border:1px solid rgba(233,252,255,.55);border-radius:11px;box-shadow:0 0 0 100vmax rgba(4,17,29,.17);transition:border-color .18s ease,background-color .18s ease}\n.tc-scan-corner{position:absolute;width:26px;height:26px;border-color:#41f0c8;border-style:solid;border-width:0;filter:drop-shadow(0 1px 3px #062b24)}\n.tc-scan-corner.tl{top:-3px;left:-3px;border-top-width:4px;border-left-width:4px;border-top-left-radius:12px}\n.tc-scan-corner.tr{top:-3px;right:-3px;border-top-width:4px;border-right-width:4px;border-top-right-radius:12px}\n.tc-scan-corner.bl{bottom:-3px;left:-3px;border-bottom-width:4px;border-left-width:4px;border-bottom-left-radius:12px}\n.tc-scan-corner.br{bottom:-3px;right:-3px;border-bottom-width:4px;border-right-width:4px;border-bottom-right-radius:12px}\n.tc-scan-line{position:absolute;left:7%;right:7%;height:3px;top:16%;border-radius:100%;opacity:.95;background:linear-gradient(90deg,transparent,#64ffe2 18%,#26e5bc 50%,#64ffe2 82%,transparent);box-shadow:0 0 12px 2px rgba(43,255,206,.56);animation:tc-guided-sweep 2.1s ease-in-out infinite alternate}\n.tc-scan-overlay-label{position:absolute;left:10px;right:10px;bottom:7px;border-radius:9px;background:rgba(7,24,36,.77);color:#fff;text-align:center;padding:7px 9px;font-size:12px;font-weight:600;line-height:1.3;text-shadow:0 1px 1px #000}\n.tc-guided-camera.is-success .tc-scan-frame{background:rgba(15,207,126,.16);border-color:#4bffb6}\n.tc-guided-camera.is-success .tc-scan-corner{border-color:#7dffb9}\n.tc-guided-camera.is-success .tc-scan-line{background:#7dffb9;animation:none;top:50%}\n.tc-guided-camera.is-success .tc-scan-overlay-label{background:#096842}\n.tc-scanner-done{position:fixed;top:max(14px,env(safe-area-inset-top,14px));left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;background:#067644;color:#fff;border-radius:12px;box-shadow:0 4px 22px rgba(0,0,0,.25);padding:11px 18px;font-size:14px;font-weight:700;max-width:90vw;text-align:center}\n@keyframes tc-guided-sweep{0%{top:14%;opacity:.65}100%{top:86%;opacity:1}}\n@media(prefers-reduced-motion:reduce){.tc-scan-line{animation:none;top:50%}.tc-scan-frame{transition:none}}\n@media(max-width:350px){.tc-scan-frame{left:11%;right:11%;top:17%;bottom:20%}.tc-scan-overlay-label{font-size:11px}}\n";
  if(!document.getElementById(style.id))document.head.appendChild(style);

  function decorateScanner(){
    const modal=document.getElementById('scanModal');
    const video=document.getElementById('scanVideo');
    if(!modal || !video || !video.parentNode)return false;
    if(video.parentNode.classList?.contains('tc-guided-camera'))return true;
    const camera=document.createElement('div');
    camera.className='tc-guided-camera';
    video.parentNode.insertBefore(camera,video);
    camera.appendChild(video);
    const overlay=document.createElement('div');
    overlay.className='tc-scan-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML='<div class="tc-scan-frame">'+
      '<i class="tc-scan-corner tl"></i><i class="tc-scan-corner tr"></i>'+
      '<i class="tc-scan-corner bl"></i><i class="tc-scan-corner br"></i>'+
      '<i class="tc-scan-line"></i></div>'+
      '<div class="tc-scan-overlay-label">Coloca el QR o código de barras en el recuadro</div>';
    camera.appendChild(overlay);
    return true;
  }

  let doneTimer=null;
  function showDone(){
    const camera=document.querySelector('#scanModal .tc-guided-camera');
    if(camera){
      camera.classList.add('is-success');
      const label=camera.querySelector('.tc-scan-overlay-label');
      if(label)label.textContent='✓ Código reconocido';
      setTimeout(()=>{
        if(!camera.isConnected)return;
        camera.classList.remove('is-success');
        if(label)label.textContent='Coloca el QR o código de barras en el recuadro';
      },900);
      return;
    }
    // La lectura individual cierra el modal antes de devolver el código.
    const old=document.getElementById('tcScannerDone24');
    if(old)old.remove();
    const note=document.createElement('div');
    note.id='tcScannerDone24';
    note.className='tc-scanner-done';
    note.setAttribute('role','status');
    note.textContent='✓ Código reconocido';
    document.body.appendChild(note);
    if(doneTimer)clearTimeout(doneTimer);
    doneTimer=setTimeout(()=>{note.remove();doneTimer=null;},950);
  }

  // Mantener la misma cámara, decoder, callback y sonido existentes.
  if(typeof openBrowserScanner==='function'){
    const originalOpenBrowserScanner=openBrowserScanner;
    openBrowserScanner=function(...args){
      if(typeof scanDone==='function' && !scanDone.tcScannerFrame24){
        const originalDone=scanDone;
        const wrappedDone=function(code){
          if(String(code??'').trim())showDone();
          return originalDone.call(this,code);
        };
        wrappedDone.tcScannerFrame24=true;
        scanDone=wrappedDone;
      }
      const result=originalOpenBrowserScanner.apply(this,args);
      decorateScanner();
      return result;
    };
  }
  if(typeof openContinuousBrowserScanner==='function'){
    const originalOpenContinuousBrowserScanner=openContinuousBrowserScanner;
    openContinuousBrowserScanner=function(...args){
      const result=originalOpenContinuousBrowserScanner.apply(this,args);
      decorateScanner();
      return result;
    };
  }
  if(typeof scanResult==='function'){
    const originalScanResult=scanResult;
    scanResult=function(message,kind,...args){
      if(kind==='ok')showDone();
      return originalScanResult.call(this,message,kind,...args);
    };
  }
  window.tcScannerFrameV24={decorateScanner,showDone};
})();