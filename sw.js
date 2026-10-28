// ToolControl iPhone: cache de la aplicación, no sesiones ni respuestas privadas de Supabase.
const CACHE='toolcontrol-iphone-v24-admin-daily-0630-v5';
const SHELL=['./toolcontrol-app-icon.png','./toolcontrol-logo.png','./index.html','./manifest.webmanifest','./icon.svg','./tc-iphone-updates-2.2.js','./tc-iphone-followup-2.4.js','./tc-iphone-inventory-v24.js','./tc-iphone-scanner-frame-v24.js','./tc-iphone-home-android-v24.js','./tc-iphone-daily-admin-v24.js'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('toolcontrol-iphone-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const u=new URL(event.request.url);
 if(u.origin===self.location.origin)event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{const live=await fetch(event.request);if(live.ok)cache.put('./index.html',live.clone());return live}
   catch{return(await cache.match('./index.html'))||Response.error()}
  }
  if(u.pathname.endsWith('/tc-iphone-updates-2.2.js') || u.pathname.endsWith('/tc-iphone-inventory-v24.js') || u.pathname.endsWith('/tc-iphone-scanner-frame-v24.js') || u.pathname.endsWith('/tc-iphone-home-android-v24.js') || u.pathname.endsWith('/tc-iphone-daily-admin-v24.js')){
   try{
    const live=await fetch(event.request);
    if(live.ok){await cache.put(event.request,live.clone());return live}
   }catch(e){}
  }
  return (await cache.match(event.request))||fetch(event.request);
 })());
 if(u.origin==='https://cdn.jsdelivr.net'&&u.pathname.includes('/@zxing/library@0.21.3/umd/index.min.js')){
  event.respondWith(caches.open(CACHE).then(async cache=>{
   const saved=await cache.match(event.request);if(saved)return saved;
   const fresh=await fetch(event.request);if(fresh.ok||fresh.type==='opaque')await cache.put(event.request,fresh.clone());return fresh;
  }));
 }
});