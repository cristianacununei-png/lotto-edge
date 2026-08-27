const CACHE="lotto-edge-v17";
const CORE=[
  "./",
  "index.html",
  "app.css?v=17",
  "app.js?v=17",
  "manifest.webmanifest?v=17",
  "icon-192.png",
  "icon-512.png",
  "euromillions_history.csv"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;

  const url=new URL(event.request.url);

  // External lottery data is fetched directly and never held in shell cache.
  if(url.origin!==self.location.origin){
    event.respondWith(fetch(event.request));
    return;
  }

  // version.json must always reflect the deployed version.
  if(url.pathname.endsWith("/version.json") || url.pathname.endsWith("version.json")){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }

  // HTML navigation: cached immediately, silently refresh cache in background.
  if(event.request.mode==="navigate"){
    event.respondWith(
      caches.match("index.html").then(cached=>{
        const network=fetch("index.html",{cache:"no-store"})
          .then(resp=>{
            if(resp.ok){
              caches.open(CACHE).then(c=>c.put("index.html",resp.clone()));
            }
            return resp;
          }).catch(()=>null);
        return cached || network;
      })
    );
    return;
  }

  // Static assets: cache-first for instant app startup, then refresh silently.
  event.respondWith(
    caches.match(event.request).then(cached=>{
      const network=fetch(event.request,{cache:"no-store"})
        .then(resp=>{
          if(resp && resp.ok){
            caches.open(CACHE).then(c=>c.put(event.request,resp.clone()));
          }
          return resp;
        }).catch(()=>null);

      return cached || network;
    })
  );
});
