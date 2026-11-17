// NÉVIX TV: eliminador de caché para instalaciones web anteriores.
// No borra favoritos, ajustes ni otros datos de localStorage/IndexedDB.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});
// No interceptar fetch: los navegadores deben obtener el sitio actualizado.
