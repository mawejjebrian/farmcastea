const CACHE="farmcast-regional-v3";
const CORE=["/regional/","/regional/index.html","/regional/manifest.webmanifest"];

self.addEventListener("install",event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())
));

self.addEventListener("activate",event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith("farmcast-regional-")&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==location.origin)return;

  // Always check the network first for page navigations so new releases
  // (including farmer registration fixes) are not hidden by stale HTML.
  if(request.mode==="navigate"||url.pathname.endsWith(".html")){
    event.respondWith(
      fetch(request).then(response=>{
        if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
        return response;
      }).catch(()=>caches.match(request).then(hit=>hit||caches.match("/regional/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit=>hit||fetch(request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
      return response;
    }))
  );
});
