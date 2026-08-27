
const CACHE="lotto-edge-v5";
const ASSETS=[
  "./","index.html","app.css","app.js","manifest.webmanifest","icon-192.png","icon-512.png","euromillions_history.csv"
];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET") return;

  const url=new URL(req.url);
  if(url.origin!==location.origin){
    e.respondWith(fetch(req));
    return;
  }

  e.respondWith(
    caches.match(req).then(cached=>{
      const fresh=fetch(req).then(resp=>{
        const clone=resp.clone();
        caches.open(CACHE).then(c=>c.put(req,clone));
        return resp;
      }).catch(()=>cached);
      return cached || fresh;
    })
  );
});
