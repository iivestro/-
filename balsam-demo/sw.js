"use strict";
self.addEventListener("install",event=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
// No caching of authenticated pages, tokens, messages, or medical data.
self.addEventListener("fetch",event=>{});
