const CACHE_NAME="salga-digital-mart-v1";
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));

self.addEventListener("push",event=>{
  let data={title:"SALGA Digital Mart",body:"You have a new update.",url:"/",badge:1};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  const options={body:data.body,icon:data.icon||"/icon.svg",badge:data.badgeIcon||"/icon.svg",tag:data.tag||"salga-update",renotify:true,data:{url:data.url||"/"},badgeCount:Number(data.badge||0)};
  event.waitUntil((async()=>{
    try{if(self.registration.setAppBadge&&Number(data.badge)>=0)await self.registration.setAppBadge(Number(data.badge));}catch{}
    await self.registration.showNotification(data.title,options);
  })());
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/";
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){if("focus" in client){try{await client.navigate(target);}catch{};return client.focus();}}
    return clients.openWindow(target);
  })());
});
