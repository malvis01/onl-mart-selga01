(function(){
 "use strict";
 const session=()=>{try{return JSON.parse(localStorage.getItem("session")||"null")}catch{return null}};
 const sid=()=>{let v=sessionStorage.getItem("salga_activity_session");if(!v){v=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());sessionStorage.setItem("salga_activity_session",v)}return v};
 async function track(event_type,metadata={}){const s=session();if(!s?.access_token)return;try{await fetch("/api/activity",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({event_type,session_id:sid(),path:location.pathname+location.hash,metadata})})}catch(_){} }
 function page(){const key=`salga-page:${location.pathname}${location.hash}`;const now=Date.now();const last=Number(sessionStorage.getItem(key)||0);if(now-last>30000){sessionStorage.setItem(key,String(now));track("page_view")}}
 document.addEventListener("DOMContentLoaded",()=>{page();const s=session();if(s?.access_token)track("login",{role:s.user?.role||null})});
 window.salgaTrack=track;
 const oldPush=history.pushState;history.pushState=function(){const r=oldPush.apply(this,arguments);setTimeout(page,0);return r};
 window.addEventListener("popstate",page);
})();
