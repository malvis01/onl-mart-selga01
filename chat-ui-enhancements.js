(function(){
  "use strict";

  function escChat(value){
    return String(value ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function addStyles(){
    if(document.getElementById("salgaChatEnhancementStyles")) return;
    const style=document.createElement("style");
    style.id="salgaChatEnhancementStyles";
    style.textContent=`
      .salga-chat-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
      .salga-chat-btn{background:#075e54!important;color:#fff!important}
      .salga-profile-btn{background:#e8ecef!important;color:#17202a!important}
      .salga-chat-status{margin:8px 0;font-size:13px;color:#68727d}
      .salga-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:16px;z-index:1000}
      .salga-modal{background:#fff;width:min(520px,100%);max-height:90vh;overflow:auto;border-radius:16px;padding:20px;box-shadow:0 15px 50px rgba(0,0,0,.25)}
      .salga-modal h2{margin-top:0}
      .salga-admin-card{margin:12px 0;padding:14px;border:1px solid #d6dde1;border-radius:12px;background:#f8fafb}
    `;
    document.head.appendChild(style);
  }

  function ensureModal(){
    if(document.getElementById("salgaBusinessModal")) return;
    const wrap=document.createElement("div");
    wrap.id="salgaBusinessModal";
    wrap.className="salga-modal-backdrop hidden";
    wrap.innerHTML=`<div class="salga-modal" role="dialog" aria-modal="true"><div id="salgaBusinessModalBody"></div><div class="row" style="margin-top:14px"><button class="btn gray" type="button" onclick="closeSalgaBusinessProfile()">Close</button></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click",e=>{if(e.target===wrap)closeSalgaBusinessProfile();});
  }

  window.closeSalgaBusinessProfile=function(){
    const m=document.getElementById("salgaBusinessModal");
    if(m)m.classList.add("hidden");
  };

  function productList(){
    try{return Array.isArray(products)?products:[];}catch(_){return []}
  }

  /*
   * The original API helper always replaced a buyer/seller Supabase
   * session with adminToken when one existed in localStorage. That made
   * authenticated chat requests look like invalid admin requests.
   * Keep the admin token only for /api/admin; normal user requests use
   * the current Supabase access token.
   */
  function installSafeApi(){
    if(typeof window.api!=="function" || window.api.__salgaAuthFixed) return;

    async function safeApi(path,options={}){
      const isFormData=options.body instanceof FormData;
      const headers={...(options.headers||{})};
      if(!isFormData) headers["Content-Type"]="application/json";

      const adminPath=String(path).replace(/^\//,"")==="admin";
      let userSession=null;
      try{userSession=(typeof session!=="undefined"?session:null);}catch(_){userSession=null;}

      if(adminPath){
        const adminToken=localStorage.getItem("adminToken");
        if(adminToken) headers.Authorization="Bearer "+adminToken;
      }else if(userSession?.access_token){
        headers.Authorization="Bearer "+userSession.access_token;
      }

      let response;
      try{
        response=await fetch("/api/"+String(path).replace(/^\//,""),{...options,headers});
      }catch(error){
        throw new Error("Unable to connect to the server. Please check your internet connection.");
      }

      const text=await response.text();
      let data={};
      try{data=text?JSON.parse(text):{};}catch(_){throw new Error("The server returned an invalid response.");}
      if(!response.ok) throw new Error(data.error||data.message||"Request failed.");
      return data;
    }

    safeApi.__salgaAuthFixed=true;
    window.api=safeApi;
  }

  window.openSalgaBusinessProfile=function(productId){
    const product=productList().find(p=>String(p.id)===String(productId));
    if(!product){alert("Business information is not available for this product right now.");return;}
    ensureModal();
    const businessId=product.business_id||product.businesses?.id||"";
    const businessName=product.business_name||product.businessName||product.businesses?.business_name||"Business owner";
    document.getElementById("salgaBusinessModalBody").innerHTML=`
      <span class="tag">Business Profile</span>
      <h2>${escChat(businessName)}</h2>
      <p class="muted">Local business on SALGA Digital Mart.</p>
      <div class="record">
        <div class="record-title">${escChat(product.name||"Product")}</div>
        <div>Category: ${escChat(product.category||"Other")}</div>
        <div class="record-money">${typeof money==="function"?money(product.price):"₦"+Number(product.price||0).toLocaleString("en-NG")}</div>
        <div class="muted">${escChat(product.description||"")}</div>
      </div>
      <div class="salga-chat-actions">
        <button class="btn salga-chat-btn" type="button" ${businessId?"":"disabled"} onclick="startSalgaBusinessChat('${escChat(businessId)}')">💬 Chat with Business Owner</button>
      </div>`;
    document.getElementById("salgaBusinessModal").classList.remove("hidden");
  };

  async function requireBuyer(){
    if(typeof me==="undefined"||!me||me.role!=="buyer"){
      alert("Please log in with your existing buyer account to chat. No separate message account is needed.");
      if(typeof show==="function")show("account");
      return false;
    }
    return true;
  }

  window.startSalgaBusinessChat=async function(businessId){
    if(!businessId||!(await requireBuyer()))return;
    try{
      const data=await api("chat",{method:"POST",body:JSON.stringify({action:"start",business_id:businessId})});
      if(!data.success||!data.conversation)throw new Error(data.error||"Unable to start business chat.");
      closeSalgaBusinessProfile();
      activeBuyerConversation=data.conversation.id;
      if(typeof show==="function")show("account");
      if(typeof buyerTab==="function")buyerTab("chat");
      await openConversation("buyer",data.conversation.id);
      await refreshChatConversations("buyer");
    }catch(error){alert(error.message||"Unable to start business chat.");}
  };

  window.startSalgaAdminChat=async function(){
    if(!(await requireBuyer()))return;
    try{
      const data=await api("chat",{method:"POST",body:JSON.stringify({action:"start_admin"})});
      if(!data.success||!data.conversation)throw new Error(data.error||"Unable to start SALGA administration chat.");
      activeBuyerConversation=data.conversation.id;
      if(typeof show==="function")show("account");
      if(typeof buyerTab==="function")buyerTab("chat");
      await openConversation("buyer",data.conversation.id);
      await refreshChatConversations("buyer");
    }catch(error){alert(error.message||"Unable to start SALGA administration chat.");}
  };

  window.refreshChatConversations=async function(role){
    try{
      const data=await api("chat",{method:"POST",body:JSON.stringify({action:"conversations"})});
      if(!data.success)throw new Error(data.error||"Unable to load conversations.");
      if(typeof renderConversations==="function")renderConversations(role,data.conversations||[]);
      return data.conversations||[];
    }catch(error){
      console.error("SALGA CHAT LIST:",error);
      return [];
    }
  };

  function addAdminButton(){
    const dash=document.getElementById("buyerDashboard");
    if(!dash||dash.classList.contains("hidden")||document.getElementById("salgaAdminChatButton"))return;
    const host=document.createElement("div");
    host.className="salga-admin-card";
    host.id="salgaAdminChatButton";
    host.innerHTML=`<strong>Need help from SALGA?</strong><div class="muted" style="margin:5px 0 9px">Chat directly with SALGA Administration using your existing buyer account.</div><button class="btn salga-chat-btn" type="button" onclick="startSalgaAdminChat()">💬 Chat with SALGA Administration</button>`;
    const tabs=dash.querySelector(".panel");
    if(tabs)tabs.after(host);else dash.prepend(host);
  }

  function enhanceProducts(){
    const list=productList();
    document.querySelectorAll("#products .product").forEach(card=>{
      if(card.querySelector(".salga-chat-actions"))return;
      const buy=card.querySelector("button[onclick*='buyProduct']");
      if(!buy)return;
      const match=(buy.getAttribute("onclick")||"").match(/buyProduct\(['\"]([^'\"]+)['\"]\)/);
      const product=match?list.find(p=>String(p.id)===String(match[1])):null;
      if(!product)return;
      const businessId=product.business_id||product.businesses?.id||"";
      const actions=document.createElement("div");
      actions.className="salga-chat-actions";
      actions.innerHTML=`<button class="btn salga-profile-btn" type="button">View Business</button><button class="btn salga-chat-btn" type="button" ${businessId?"":"disabled"}>💬 Chat Owner</button>`;
      actions.children[0].addEventListener("click",()=>openSalgaBusinessProfile(product.id));
      actions.children[1].addEventListener("click",()=>startSalgaBusinessChat(businessId));
      card.appendChild(actions);
    });
    addAdminButton();
  }

  function wrapDashboard(name,role){
    const original=window[name];
    if(typeof original!=="function"||original.__salgaChatWrapped)return;
    async function wrapped(){
      const result=await original.apply(this,arguments);
      setTimeout(()=>refreshChatConversations(role),0);
      return result;
    }
    wrapped.__salgaChatWrapped=true;
    window[name]=wrapped;
  }

  function install(){
    addStyles();
    ensureModal();
    installSafeApi();

    const original=window.loadProducts;
    if(typeof original==="function"&&!original.__salgaWrapped){
      async function wrappedLoadProducts(){
        const result=await original.apply(this,arguments);
        setTimeout(enhanceProducts,0);
        return result;
      }
      wrappedLoadProducts.__salgaWrapped=true;
      window.loadProducts=wrappedLoadProducts;
    }

    wrapDashboard("loadBuyerDashboard","buyer");
    wrapDashboard("loadSellerDashboard","seller");
    wrapDashboard("loadAdminDashboard","admin");

    setTimeout(()=>refreshChatConversations("buyer"),800);
    setInterval(enhanceProducts,1200);
    setInterval(addAdminButton,1200);
    setInterval(()=>{
      try{
        if(typeof me!=="undefined"&&me?.role==="buyer")refreshChatConversations("buyer");
        if(typeof me!=="undefined"&&(me?.role==="seller"||me?.role==="business"))refreshChatConversations("seller");
      }catch(_){ }
    },5000);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();
