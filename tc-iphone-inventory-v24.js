/* ToolControl iPhone V2.4 — inventario organizado como Android (solo Inventario General).
   Es una mejora visual: no modifica herramientas, estados ni Supabase. */
(function(){
  'use strict';

  // Grupos conocidos: alias en inglés/español, con marcas/modelos en cualquier posición.
  // Los nombres no reconocidos generan sus propios grupos automáticamente.
  const definitions = [
    {key:'battery', name:'Batería / Battery', icon:'🔋', expressions:[/\bbaterias?\b/,/\bbatter(?:y|ies)\b/]},
    {key:'sawzall', name:'SawZall', icon:'🪚', expressions:[/\bsaw[\s-]*zall\b/,/\bsawzall\b/,/\breciprocating[\s-]*saw\b/]},
    {key:'bandsaw', name:'Bandsaw', icon:'🪚', expressions:[/\bband[\s-]*saw\b/,/\bbandsaw\b/]},
    {key:'circular', name:'Circular Saw', icon:'🪚', expressions:[/\bcircular[\s-]*saw\b/,/\bsierra[\s-]*circular\b/]},
    {key:'rotary', name:'Rotary Hammer', icon:'🔨', expressions:[/\brotary[\s-]*hammer\b/,/\bmartillo[\s-]*rotativo\b/,/\brotomartillo\b/]},
    {key:'impact', name:'Impacto / Impact', icon:'🔩', expressions:[/\bimpactos?\b/,/\bimpacts?\b/,/\batornillador[\s-]*de[\s-]*impacto\b/]},
    {key:'holehawg', name:'Hole Hawg', icon:'🛠️', expressions:[/\bhole[\s-]*hawg\b/,/\bholehawg\b/]},
    {key:'drill', name:'Drill', icon:'🛠️', expressions:[/\bdrills?\b/,/\btaladros?\b/]}
  ];
  const opened = new Set();
  const descriptorWords = new Set([
    'milwaukee','dewalt','makita','bosch','hilti','ryobi','ridgid','rigid','greenlee',
    'klein','kobalt','craftsman','husky','metabo','bauer','fluke','southwire',
    'skil','flex','festool','ingco','stanley','black','decker','porter',
    'm12','m18','m28','mxl','fuel','brushless','cordless','inalambrico','inalambrica',
    'electrico','electrica','electric','heavy','duty','tool','tools','herramienta',
    'herramientas','lithium','litio','ion','kit','set','combo','nuevo','nueva',
    'modelo','model','serie','series','profesional','professional','de','del','la',
    'el','para','con','sin','the','and','y'
  ]);
  function normalizeName(value){
    return String(value == null ? '' : value).normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function inferredCategory(name){
    const original=normalizeName(name);
    const tokens=original.replace(/[^a-z0-9\u00f1]+/g,' ').trim().split(/\s+/)
      .filter(token=>token && !descriptorWords.has(token) && !/\d/.test(token));
    // Ej. Milwaukee Grinder M18 y DeWalt Grinder 20V => Grinder.
    const base=tokens.slice(0,2);
    const title=base.length ? base.map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(' ') : 'Sin nombre';
    const key='auto-'+(base.length?base.join('-'):'sin-nombre');
    return {key,name:title,icon:'📦'};
  }
  function categoryInfo(name){
    const value=normalizeName(name);
    for(const group of definitions){
      if(group.expressions.some(regex=>regex.test(value)))
        return {key:group.key,name:group.name,icon:group.icon};
    }
    return inferredCategory(name);
  }
  function categoryOf(name){return categoryInfo(name).key;}
  // Buscar también por modelo y número de serie, incluso en registros anteriores.
  // El formulario de V2.4 guarda ambos en serial (campo "Modelo / N.º serie").
  function matchesInventorySearch(tool,query){
    const needle=normalizeName(query);
    if(!needle)return true;
    const fields=[
      tool.name,tool.code,tool.brand,tool.model,tool.modelo,
      tool.modelNumber,tool.numeroModelo,tool.serial,tool.serie,
      tool.serialNumber,tool.numeroSerie,person(tool.personId)?.name
    ];
    const values=fields.filter(x=>x!==undefined&&x!==null).map(normalizeName);
    if(values.some(x=>x.includes(needle)))return true;
    // Los fabricantes pueden escribir un mismo modelo SN-1234 / SN1234.
    const packed=needle.replace(/[^a-z0-9]/g,'');
    return packed.length>=3 && values.some(x=>x.replace(/[^a-z0-9]/g,'').includes(packed));
  }
  function filteredTools(){
    return state.tools.filter(t=>
      ((toolFilter==='all' && t.status!=='retired') ||
       (toolFilter==='overdue' ? overdue(t) : t.status===toolFilter)) &&
      matchesInventorySearch(t,inventorySearch)
    );
  }
  function groupTools(list){
    // Recalcular con cada render: se agrupan las herramientas existentes y nuevas.
    const groups = new Map();
    for(const tool of list){
      const group=categoryInfo(tool.name);
      if(!groups.has(group.key))groups.set(group.key,{...group,items:[]});
      groups.get(group.key).items.push(tool);
    }
    const knownOrder=new Map(definitions.map((group,index)=>[group.key,index]));
    return [...groups.values()].sort((a,b)=>
      (knownOrder.get(a.key)??999)-(knownOrder.get(b.key)??999) ||
      a.name.localeCompare(b.name,'es')
    );
  }
  function renderGroups(list){
    const groups=groupTools(list);
    if(!groups.length) return empty('No hay herramientas para este filtro.');
    return groups.map(group=>{
      const isOpen=opened.has(group.key);
      return `<section class="tc-inv-group">
        <button type="button" class="tc-inv-group-btn" onclick="tcToggleInventoryGroupV24('${group.key}')" aria-expanded="${isOpen}">
          <span class="tc-inv-icon" aria-hidden="true">${group.icon}</span>
          <span class="tc-inv-title">${esc(group.name)}</span>
          <span class="tc-inv-qty">${group.items.length} ${group.items.length===1?'herramienta':'herramientas'}</span>
          <span class="tc-inv-arrow" aria-hidden="true">${isOpen?'▴':'▾'}</span>
        </button>
        ${isOpen?`<div class="tc-inv-details">${toolsHtml(group.items)}</div>`:''}
      </section>`;
    }).join('');
  }
  function inventoryHtml(){
    const list=filteredTools();
    const statuses=[['all','Todas'],['available','Disponibles'],['assigned','Asignadas'],
      ['overdue','Vencidas'],['damaged','Dañadas'],['retired','Retiradas'],['lost','Extraviadas']];
    return `<div class="toolbar tc-inv-toolbar">
      <input id="inventorySearch" placeholder="Buscar nombre, QR, modelo, serie o responsable" value="${esc(inventorySearch)}" oninput="inventorySearch=this.value;renderInventoryItems()">
      <div class="tc-inv-actions">
        <button type="button" class="btn primary tiny" onclick="tcInventorySearchScanV24()" aria-label="Escanear QR o código de barras para buscar herramienta">📷 Escanear</button>
        <button type="button" class="btn primary tiny" onclick="go('toolnew')">+ Nueva</button>
      </div>
    </div>
    <div class="pillbar">${statuses.map(([key,label])=>
      `<button class="pill ${toolFilter===key?'active':''}" onclick="toolFilter='${key}';render()">${label}</button>`
    ).join('')}</div>
    <div class="tc-inv-summary">En este filtro: <strong id="tcInventoryVisibleV24">${list.length}</strong>
       · Total registradas: <strong>${state.tools.length}</strong></div>
    <div id="inventoryItems" class="tc-inv-groups">${renderGroups(list)}</div>`;
  }

  // La búsqueda QR tiene su propio canal nativo: no reutiliza
  // receiveNativeScan (que pertenece a registro, entrega y recepción).
  window.tcInventorySearchScanV24=function(){
    // En Safari usamos el lector QR de ToolControl iPhone existente.
    // No inicia sesiones de entrega, devolución ni registro continuo.
    if(continuousSession?.active)return toast('Finaliza el escaneo continuo antes de buscar.');
    if(typeof openBrowserScanner!=='function')return toast('El lector QR no está disponible en este navegador.');
    try{
      if(typeof prepareScanAudio==='function')prepareScanAudio();
      scanDone=function(code){window.tcInventoryFoundByScan(code);};
      openBrowserScanner();
    }catch(err){
      scanDone=null;
      toast('No se pudo abrir la cámara. Escribe el código en la búsqueda.');
    }
  };
  window.tcInventoryFoundByScan=function(rawCode){
    const code=String(rawCode??'').trim();
    if(!code){toast('El código escaneado está vacío.');return;}
    const tool=state.tools.find(t=>String(t.code??'').trim().toUpperCase()===code.toUpperCase());
    if(!tool){
      toast('No se encontró ninguna herramienta con el código '+code+'.');
      return;
    }
    // Todas excluye los equipos dados de baja; incluirlos cuando corresponda.
    toolFilter=tool.status==='retired'?'retired':'all';
    inventorySearch=String(tool.code||'').trim();
    opened.add(categoryOf(tool.name));
    if(page!=='inventory')go('inventory');
    else render();
    toast('Herramienta encontrada: '+tool.name);
    showTool(tool.id);
  };
  window.tcInventoryScanFailed=function(message){
    toast(String(message||'No se pudo leer el código.'));
  };
  window.tcInventoryScanCancelled=function(){};
  window.tcToggleInventoryGroupV24=function(key){
    if(!groupTools(state.tools).some(g=>g.key===key))return;
    if(opened.has(key))opened.delete(key);else opened.add(key);
    renderInventoryItems();
  };
  inventoryView=inventoryHtml;
  renderInventoryItems=function(){
    const list=filteredTools();
    const target=$('inventoryItems');
    if(target) target.innerHTML=renderGroups(list);
    const n=$('tcInventoryVisibleV24');
    if(n)n.textContent=String(list.length);
  };
  const css=document.createElement('style');
  css.id='tc-inventory-groups-v24-css';
  css.textContent=`
    .tc-inv-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .tc-inv-toolbar input{flex:1 1 185px;min-width:0}
    .tc-inv-actions{display:flex;gap:6px;align-items:center}
    .tc-inv-actions button{white-space:nowrap}
    .tc-inv-summary{font-size:13px;color:#41556a;margin:12px 2px 8px}
    .tc-inv-groups{display:flex;flex-direction:column;gap:10px}
    .tc-inv-group{background:#fff;border:1px solid #dce5ed;border-radius:13px;overflow:hidden;box-shadow:0 2px 9px rgba(13,42,67,.04)}
    .tc-inv-group-btn{display:flex;align-items:center;width:100%;text-align:left;gap:9px;border:0;background:#fff;padding:15px 12px;color:#143148;min-height:56px}
    .tc-inv-group-btn:focus-visible{outline:3px solid #2374a7;outline-offset:-3px}
    .tc-inv-icon{font-size:21px;flex-shrink:0}
    .tc-inv-title{font-size:14px;font-weight:700;flex:1;min-width:0}
    .tc-inv-qty{font-size:12px;font-weight:700;color:#164969;background:#e8f4fc;padding:6px 8px;border-radius:14px;white-space:nowrap}
    .tc-inv-arrow{font-size:19px;color:#5b7182;width:15px;text-align:center}
    .tc-inv-details{border-top:1px solid #e2eaf0;padding:0 10px}
    .tc-inv-details .item:last-child{border-bottom:0}
    @media(max-width:350px){.tc-inv-group-btn{gap:5px;padding:11px 6px}.tc-inv-qty{font-size:10px;padding:4px 5px}}
  `;
  document.head.appendChild(css);

  // Expose pure helpers to regression tests only; never change live tool data.
  window.tcInventoryGroupHelpersV24={categoryOf,categoryInfo,groupTools,matchesInventorySearch};
})();
