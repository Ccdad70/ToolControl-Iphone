'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'..','tc-iphone-scanner-frame-v24.js'),'utf8');

function element(tag){
  const node={tag,className:'',id:'',style:{},parentNode:null,children:[],isConnected:true,textContent:'',innerHTML:'',
    setAttribute(name,value){this[name]=value;},
    appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;return child;},
    insertBefore(child,other){if(child.parentNode)child.parentNode.removeChild(child);const i=this.children.indexOf(other);this.children.splice(i<0?this.children.length:i,0,child);child.parentNode=this;return child;},
    removeChild(child){const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child;},
    remove(){if(this.parentNode)this.parentNode.removeChild(this);this.isConnected=false;},
    querySelector(selector){
      if(selector==='.tc-scan-overlay-label')return this.children.find(x=>x.className==='tc-scan-overlay')?.label || null;
      return null;
    }
  };
  node.classList={
    contains(c){return node.className.split(' ').includes(c);},
    add(c){if(!this.contains(c))node.className=(node.className+' '+c).trim();},
    remove(c){node.className=node.className.split(' ').filter(x=>x!==c).join(' ');}
  };
  return node;
}
let modal=null,video=null,oneCalls=0,continuousCalls=0,doneCalls=0,results=[],timerCalls=[];
const head=element('head'),body=element('body');
function makeScanner(){
  modal=element('div');modal.id='scanModal';video=element('video');video.id='scanVideo';
  const sheet=element('div');modal.appendChild(sheet);sheet.appendChild(video);body.appendChild(modal);
}
const ctx={
  document:{
    head,body,
    createElement:tag=>{const item=element(tag); if(tag==='div'){
      // The frame script sets innerHTML on the overlay; tests only need the label.
      Object.defineProperty(item,'innerHTML',{get(){return this._html||'';},set(x){
        this._html=x;if(this.className==='tc-scan-overlay')this.label={textContent:'Coloca el QR o código de barras en el recuadro'};
      }});
    }return item;},
    getElementById:id=>{
      if(id==='scanModal')return modal;
      if(id==='scanVideo')return video;
      if(id==='tcScannerDone24')return body.children.find(x=>x.id===id)||null;
      if(id==='tc-iphone-scanner-frame-v24')return head.children.find(x=>x.id===id)||null;
      return null;
    },
    querySelector:selector=>{
      if(selector==='#scanModal .tc-guided-camera'&&modal)return modal.children[0].children.find(n=>n.className.includes('tc-guided-camera'))||null;
      return null;
    }
  },
  window:{},scanDone:null,
  openBrowserScanner(){oneCalls++;makeScanner();return Promise.resolve();},
  openContinuousBrowserScanner(){continuousCalls++;makeScanner();return Promise.resolve();},
  scanResult(message,kind){results.push([message,kind]);return true;},
  setTimeout(fn,ms){timerCalls.push({fn,ms});return timerCalls.length;},
  clearTimeout(){},console
};
vm.createContext(ctx);vm.runInContext(code,ctx);

assert.equal(head.children.length,1,'Hoja de estilos inyectada una vez');
assert.match(head.children[0].textContent,/tc-guided-sweep/);
assert.match(head.children[0].textContent,/prefers-reduced-motion/);

ctx.scanDone=()=>{doneCalls++;};
ctx.openBrowserScanner();
assert.equal(oneCalls,1,'se preserva el lector de una sola lectura');
assert.equal(video.parentNode.className,'tc-guided-camera','se añade marco al vídeo existente');
assert.equal(video.parentNode.children.length,2,'marco y vídeo juntos');
assert.match(video.parentNode.children[1].innerHTML,/tc-scan-frame/);
assert.match(video.parentNode.children[1].innerHTML,/tc-scan-line/);
ctx.window.tcScannerFrameV24.decorateScanner();
assert.equal(video.parentNode.children.length,2,'marco idempotente');
modal.remove();modal=null;video=null;
ctx.scanDone('TC-100');
assert.equal(doneCalls,1,'preserva el callback original del código');
assert.equal(body.children.filter(x=>x.id==='tcScannerDone24').length,1,'confirmación para escaneo individual');

ctx.openContinuousBrowserScanner();
assert.equal(continuousCalls,1,'no cambia lector continuo');
const camera=video.parentNode;
ctx.scanResult('Registrada','ok');
assert.equal(results[0][0],'Registrada','función scanResult anterior permanece');
assert.equal(camera.classList.contains('is-success'),true,'marco verde al reconocer código');
assert.equal(camera.querySelector('.tc-scan-overlay-label').textContent,'✓ Código reconocido');
const reset=timerCalls.find(x=>x.ms===900);
assert.ok(reset,'confirmación transitoria');
reset.fn();assert.equal(camera.classList.contains('is-success'),false,'vuelve a buscar');
ctx.scanResult('No coincide','error');
assert.equal(results.at(-1)[1],'error');
assert.equal(camera.classList.contains('is-success'),false);
console.log('OK: marco, esquinas, línea animada, accesibilidad, confirmación y lectores iPhone intactos.');
