'use strict';
const assert=require('node:assert/strict');
const { chromium, webkit }=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const results=[];

async function testBrowser(browserType, label) {
  const browser=await browserType.launch({headless:true});
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,
    isMobile:label==='webkit',hasTouch:label==='webkit'
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e.stack||e.message||e)));
  page.on('console',m=>{if(m.type()==='error' && /Uncaught|SyntaxError|ReferenceError/i.test(m.text()))errors.push('console: '+m.text());});
  try {
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>typeof window.tcIphoneHomeV24==='object'&&typeof window.tcInventoryGroupHelpersV24==='object'&&typeof window.tcScannerFrameV24==='object',null,{timeout:15000});
    await page.waitForTimeout(1000);
    // Comprobar la pantalla de autenticación sin credenciales ni escrituras.
    assert.equal(await page.locator('#tcEmail').count(),1,'acceso requiere autenticación');
    // Probar las vistas en un arnés UI aislado: NO sustituye ni evade
    // la autenticación real del sitio publicado.
    await page.evaluate(()=>{
      const views={
        home:()=>homeView(),toolnew:()=>toolNewView(),inventory:()=>inventoryView(),
        assign:()=>assignView(),return:()=>returnView(),people:()=>peopleView(),
        alerts:()=>alertView()
      };
      window.render=function(){
        const main=document.getElementById('content');
        if(main)main.innerHTML=(views[page]||views.home)();
        const nav=document.getElementById('bottomnav');
        if(nav)nav.innerHTML=navButton('home','🏠','Inicio')+
          navButton('inventory','🧰','Inventario')+
          navButton('people','👷','Personal')+
          navButton('alerts','🔔','Alertas');
      };
      window.go=function(id){page=id;window.render();};
      window.go('home');
    });
    const registered=await page.evaluate(()=>({
       modules:[typeof tcIphoneHomeV24,typeof tcInventoryGroupHelpersV24,typeof tcScannerFrameV24],
       hasStore:typeof state,hasHome:typeof homeView,hasForm:typeof toolForm,hasView:typeof inventoryView,
       hasBatch:typeof startBatchRegister,hasSms:typeof tcSmsViewerRefreshNow,
       hasScan:typeof openBrowserScanner,hasContinuous:typeof openContinuousBrowserScanner,
       serviceWorker:'serviceWorker' in navigator
    }));
    assert.equal(registered.hasHome,'function');
    assert.equal(registered.hasBatch,'function');
    await page.evaluate(()=>window.go('home'));
    await page.locator('.tc-home-actions-v24 button').first().waitFor({timeout:9000}).catch(async e=>{
      const diagnostics=await page.evaluate(()=>({
        ready:document.readyState,
        main:document.querySelector('#content')?.outerHTML?.slice(0,1800)||null,
        body:document.body.innerText?.slice(0,1600)||null,
        pageVar:typeof page!=='undefined'?page:null,
        homeViewSample:typeof homeView==='function'?homeView().slice(-850):null,
        hasHomeScript:typeof tcIphoneHomeV24,
        login:document.querySelector('#loginModal')?.outerHTML?.slice(0,300)||null
      }));
      console.error('DIAG '+label+' '+JSON.stringify({diagnostics,errors}));
      await page.screenshot({path:path.join('qa-results',label+'-failure.png'),fullPage:true});
      throw e;
    });
    assert.equal(await page.locator('.tc-home-actions-v24 button').count(),5,'cinco tarjetas');
    const cards=await page.locator('.tc-home-actions-v24 button b').allTextContents();
    assert.deepEqual(cards.map(x=>x.trim()),['Registro múltiple','Registrar herramienta','Entregar','Recibir','Inventario']);
    assert.equal(await page.locator('.stats .stat').count(),3);
    assert.equal(await page.locator('#bottomnav button').count(),4);
    await page.screenshot({path:path.join('qa-results',label+'-home.png'),fullPage:true});
    await page.locator('.tc-home-actions-v24 button').first().click();
    assert.equal(await page.locator('#toolForm').count(),1,'registro múltiple abre formulario');
    assert.equal(await page.locator('.tc-home-batch-hint').count(),1,'mensaje registro múltiple');
    assert.equal(await page.locator('.tc-batch-block').count(),1,'permanece función de registrar herramientas iguales');

    await page.evaluate(()=>{
      state.tools=[
        {id:'qa-a',code:'QA-001',name:'Milwaukee Impact Driver',brand:'Milwaukee',serial:'2853-20 / SERIE-X01',status:'available',personId:null,photo:''},
        {id:'qa-b',code:'QA-002',name:'Dewalt Impacto Driver',brand:'Dewalt',serial:'SN-9876',status:'assigned',personId:null,photo:''},
        {id:'qa-c',code:'QA-003',name:'Milwaukee Hole Hawg',brand:'Milwaukee',serial:'HW-11',status:'available',personId:null,photo:''},
        {id:'qa-d',code:'QA-004',name:'Milwaukee Grinder M18',brand:'Milwaukee',serial:'GR-42',status:'available',personId:null,photo:''},
        {id:'qa-e',code:'QA-005',name:'Dewalt Grinder 20V',brand:'Dewalt',serial:'GR-43',status:'available',personId:null,photo:''},
        {id:'qa-f',code:'QA-006',name:'Bandsaw M18',status:'retired',personId:null,photo:''}
      ];
      toolFilter='all';inventorySearch='';go('inventory');
    });
    assert.equal(await page.locator('.tc-inv-group').count()>=3,true,'Inventario agrupado');
    assert.equal(await page.locator('.tc-inv-summary').count(),1,'resumen');
    assert.match(await page.locator('.tc-inv-summary').innerText(),/Total registradas:\s*6/);
    const groups=await page.locator('.tc-inv-group-btn').allTextContents();
    assert.ok(groups.some(x=>x.includes('Impacto / Impact')&&x.includes('2 herramientas')),'Impacto 2');
    assert.ok(groups.some(x=>x.includes('Hole Hawg')),'Hole Hawg');
    assert.ok(groups.some(x=>x.includes('Grinder')&&x.includes('2 herramientas')),'Grinder 2');
    await page.locator('#inventorySearch').fill('gr43');
    assert.equal(await page.locator('.tc-inv-group').count(),1,'filtrado por serie sin guiones');
    assert.match(await page.locator('.tc-inv-group-btn').innerText(),/Grinder/);
    await page.screenshot({path:path.join('qa-results',label+'-inventory.png'),fullPage:true});
    await page.locator('#inventorySearch').fill('');
    await page.getByRole('button',{name:/Escanear/}).first().click();
    await page.locator('#scanModal .tc-scan-frame').waitFor({timeout:5000});
    assert.equal(await page.locator('#scanModal .tc-scan-line').count(),1,'línea animada');
    assert.equal(await page.locator('#scanModal .tc-scan-overlay-label').count(),1);
    await page.screenshot({path:path.join('qa-results',label+'-scanner.png')});
    await page.evaluate(()=>closeScan());
    await page.evaluate(()=>window.tcInventoryFoundByScan(' QA-003 '));
    assert.match(await page.locator('#modal').innerText(),/Hole Hawg/);
    await page.evaluate(()=>closeModal());
    await page.evaluate(()=>go('assign'));
    assert.equal(await page.locator('#assignPerson').count(),1,'vista entregar');
    await page.evaluate(()=>go('return'));
    assert.equal(await page.locator('#content').innerText().then(x=>x.length>30),true,'vista recibir');
    if(errors.length)throw Error(label+': errores JS:\n'+errors.join('\n'));
    results.push({browser:label,status:'PASS',cards,tests:['boot','Inicio','Registro múltiple','Inventario','agrupación','modelo/serie','escaner','QR ficha','Entregar','Recibir'],errors:[]});
    console.log('PASS '+label+' '+JSON.stringify(registered));
  } catch(e) {
    results.push({browser:label,status:'FAIL',error:String(e.stack||e),errors});
    console.error('FAIL '+label,e.stack||e);
  } finally { await browser.close(); }
}
(async()=>{
  fs.mkdirSync('qa-results',{recursive:true});
  await testBrowser(chromium,'chromium-390x844');
  await testBrowser(webkit,'webkit-iphone-390x844');
  fs.writeFileSync('qa-results/results.json',JSON.stringify(results,null,2));
  if(results.some(r=>r.status!=='PASS')) process.exitCode=1;
})();
