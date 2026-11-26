"use strict";
self.addEventListener("install",event=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 await self.registration.unregister();
 const names=await caches.keys();
 await Promise.all(names.map(name=>caches.delete(name)));
 const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
 for(const client of clients){
  const current=new URL(client.url);
  if(current.pathname.includes("/balsam-demo/")){
   const filename=current.pathname.split("/").pop()||"index.html";
   client.navigate(new URL("/-/"+filename+current.search+current.hash,self.location.origin).href);
  }
 }
})()));
self.addEventListener("fetch",event=>{});
