const CACHE='alcorb-inventory-static-v1';
const FILES=['index.html','style.css','core.js','storage.js','app.js','html5-qrcode.min.js'].map(p=>new URL(p,self.location).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('alcorb-inventory-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const u=new URL(event.request.url);if(u.pathname.endsWith('/inventory/'))u.pathname+='index.html';u.hash='';if(!FILES.includes(u.href))return;event.respondWith(fetch(event.request).then(r=>r.ok?r:caches.match(u.href)).catch(()=>caches.match(u.href)));});
