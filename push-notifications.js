(() => {
  const VAPID_PUBLIC_KEY="BAMDx7Yr0hS7_v51OHro8hoHqRAmMv2NmBVX_G_Vba595Idx3D-GGKSN9YjvKVF_dLQW8RsmOs6AP_P8zYpvsQA";
  let deferredInstallPrompt=null;

  const ready=()=>document.readyState==="loading"?new Promise(r=>document.addEventListener("DOMContentLoaded",r,{once:true})):Promise.resolve();
  const authToken=()=>window.session?.access_token||window.currentSession?.access_token||null;
  const supported=()=>"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
  const base64ToBytes=(value)=>{const pad="=".repeat((4-value.length%4)%4);const raw=atob((value+pad).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(raw,c=>c.charCodeAt(0));};

  function injectStyles(){
    if(document.getElementById("salgaPushStyles"))return;
    const s=document.createElement("style");s.id="salgaPushStyles";s.textContent=`
      #salgaPushCard{position:fixed;left:14px;right:14px;bottom:14px;z-index:9998;background:#fff;border:1px solid #d6dde1;border-radius:16px;padding:16px;box-shadow:0 8px 30px #0002;max-width:520px;margin:auto}
      #salgaPushCard h3{margin:0 0 6px;color:#075e54} #salgaPushCard p{margin:0 0 12px;color:#68727d;font-size:14px}
      #salgaPushCard .row{display:flex;gap:8px;flex-wrap:wrap} #salgaPushCard button{padding:10px 14px;border:0;border-radius:9px;cursor:pointer}
      #salgaPushAllow{background:#075e54;color:#fff} #salgaPushLater{background:#e8ecef;color:#17202a}
      #salgaInstallCard{position:fixed;left:14px;right:14px;bottom:14px;z-index:9997;background:#075e54;color:#fff;border-radius:16px;padding:16px;box-shadow:0 8px 30px #0003;max-width:520px;margin:auto}
      #salgaInstallCard .row{display:flex;gap:8px;flex-wrap:wrap} #salgaInstallCard button{border:0;border-radius:9px;padding:10px 14px;cursor:pointer}
      #salgaInstallBtn{background:#fff;color:#075e54} #salgaInstallLater{background:#0b806f;color:#fff}
    `;document.head.appendChild(s);
  }

  function showPushCard(){
    if(document.getElementById("salgaPushCard")||!supported()||Notification.permission==="granted"||Notification.permission==="denied")return;
    const card=document.createElement("div");card.id="salgaPushCard";card.innerHTML=`<h3>🔔 Stay updated with SALGA</h3><p>Allow SALGA Digital Mart to notify you about orders, payments, messages and important account updates.</p><div class="row"><button id="salgaPushAllow">Allow notifications</button><button id="salgaPushLater">Not now</button></div>`;document.body.appendChild(card);
    card.querySelector("#salgaPushAllow").onclick=async()=>{card.remove();await requestPushPermission();};
    card.querySelector("#salgaPushLater").onclick=()=>card.remove();
  }

  async function requestPushPermission(){
    if(!supported())return false;
    const permission=await Notification.requestPermission();
    if(permission!=="granted")return false;
    try{
      const reg=await navigator.serviceWorker.register("/sw.js",{scope:"/"});
      const existing=await reg.pushManager.getSubscription();
      const subscription=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(VAPID_PUBLIC_KEY)});
      const token=authToken(); if(!token)return false;
      const r=await fetch("/api/push-subscription",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({subscription,user_agent:navigator.userAgent})});
      if(!r.ok)throw new Error("Subscription could not be saved.");
      updateBadge();
      showInstallCard();
      return true;
    }catch(e){console.error("SALGA PUSH SETUP",e);return false;}
  }

  function showInstallCard(){
    if(!deferredInstallPrompt||document.getElementById("salgaInstallCard")||window.matchMedia("(display-mode: standalone)").matches)return;
    const card=document.createElement("div");card.id="salgaInstallCard";card.innerHTML=`<strong>📲 Add SALGA to your phone</strong><p style="margin:6px 0 12px">Install SALGA Digital Mart on your home screen for a faster app-like experience and notifications.</p><div class="row"><button id="salgaInstallBtn">Install SALGA</button><button id="salgaInstallLater">Later</button></div>`;document.body.appendChild(card);
    card.querySelector("#salgaInstallBtn").onclick=async()=>{try{await deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;}catch{} deferredInstallPrompt=null;card.remove();};
    card.querySelector("#salgaInstallLater").onclick=()=>card.remove();
  }

  async function updateBadge(){
    const token=authToken();if(!token)return;
    try{const r=await fetch("/api/order-notifications?limit=100",{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return;const data=await r.json();const count=(data.notifications||[]).filter(n=>!n.read_at).length;if(navigator.setAppBadge)await navigator.setAppBadge(count);document.title=count?`(${count}) SALGA Digital Mart`:"SALGA Digital Mart";}catch{}
  }

  window.salgaEnableNotifications=requestPushPermission;
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;showInstallCard();});
  window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;document.getElementById("salgaInstallCard")?.remove();});

  ready().then(()=>{
    injectStyles();
    if(supported())navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(e=>console.error("SALGA SERVICE WORKER",e));
    setTimeout(()=>{if(authToken())showPushCard();},1200);
    setInterval(()=>{if(authToken())updateBadge();},30000);
    updateBadge();
  });
})();
