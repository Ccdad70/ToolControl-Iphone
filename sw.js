// ToolControl iPhone: enlace público desactivado por su creador.
// Evita servir versiones antiguas de la PWA desde el caché del Service Worker.
// El código original permanece preservado en el historial y en una rama de respaldo.
const BLOCKED_HTML = `<!doctype html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>ToolControl — Enlace desactivado</title>
<style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#10273a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}body{min-height:100svh;display:grid;place-items:center;padding:24px}main{width:min(100%,850px);padding:clamp(25px,7vw,60px) 20px;text-align:center;background:#1b344a;border:2px solid #ffb4b4;border-radius:24px}h1{font-size:clamp(34px,7vw,72px);line-height:1.15;font-weight:900;margin:0}h1 strong{color:#ffb4b4}p{font-size:clamp(17px,3vw,23px);color:#e1ebf2}i{display:block;font-size:75px;font-style:normal;margin-bottom:20px}</style>
</head><body><main role="alert"><i>⛔</i><h1><strong>LINK FUE DESACTIVADO</strong><br>POR SU CREADOR</h1><p>El acceso a ToolControl para iPhone ya no está disponible.</p></main></body></html>`;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith('toolcontrol-iphone-')).map(n => caches.delete(n)));
  await self.clients.claim();
  const pages = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  await Promise.all(pages.filter(p => p.url.startsWith(self.registration.scope))
    .map(p => p.navigate(self.registration.scope + 'index.html').catch(() => {})));
})()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin || !u.href.startsWith(self.registration.scope)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(new Response(BLOCKED_HTML, {
      status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
    }));
  } else {
    event.respondWith(new Response('Link fue desactivado por su creador.', {
      status:410,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    }));
  }
});
