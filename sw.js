// ToolControl iPhone: solo cachea los archivos de la app, nunca sesiones de Supabase.
const CACHE='toolcontrol-iphone-2-0-v3';
const SHELL=['./index.html','./manifest.webmanifest','./icon192.png','./icon512.png','./apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('toolcontrol-iphone-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin===self.location.origin){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      if(event.request.mode==='navigate'){
        try{const live=await fetch(event.request);if(live.ok)cache.put('./index.html',live.clone());return live}
        catch{return (await cache.match('./index.html'))||Response.error()}
      }
      return (await cache.match(event.request)) || fetch(event.request);
    })());
  }
  if(u.origin==='https://cdn.jsdelivr.net'&&u.pathname.includes('/@zxing/library@0.21.3/umd/index.min.js')){
    event.respondWith(caches.open(CACHE).then(async cache=>{
      const saved=await cache.match(event.request);if(saved)return saved;
      const fresh=await fetch(event.request);if(fresh.ok||fresh.type==='opaque')await cache.put(event.request,fresh.clone());return fresh;
    }));
  }
});