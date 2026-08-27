const CACHE="lotto-edge-v8";
const CORE=[
  "./",
  "index.html",
  "app.css?v=8",
  "app.js?v=8",
  "manifest.webmanifest?v=8",
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

  // Remote lottery APIs are never cached by the service worker.
  if(url.origin!==self.location.origin){
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first: deployed GitHub files update automatically.
  event.respondWith(
    fetch(event.request,{cache:"no-store"})
      .then(response=>{
        if(response && response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./")))
  );
});
