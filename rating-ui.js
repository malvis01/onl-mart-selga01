(function(){
  function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");}
  function install(){
    if(typeof window.renderBuyerOrders !== "function" || window.__salgaRatingWrapped) return;
    const original=window.renderBuyerOrders;
    window.renderBuyerOrders=function(orders){
      original(orders);
      const box=document.getElementById("buyerOrders");
      if(!box) return;
      box.querySelectorAll(".salga-rate-wrap").forEach(e=>e.remove());
      (orders||[]).filter(o=>String(o.status||"").toLowerCase()==="completed").forEach(order=>{
        const record=[...box.querySelectorAll(".record")].find(el=>el.textContent.includes(String(order.id)));
        if(!record) return;
        const wrap=document.createElement("div");wrap.className="salga-rate-wrap";wrap.style.marginTop="10px";
        const button=document.createElement("button");button.className="btn";button.type="button";button.textContent="⭐ Rate Business";
        button.onclick=async function(){
          const raw=window.prompt("Rate this business from 1 to 5 stars:","5");
          if(raw===null)return; const rating=Number(raw);
          if(!Number.isInteger(rating)||rating<1||rating>5){window.alert("Please enter a whole number from 1 to 5.");return;}
          const review=window.prompt("Optional review:","")||"";
          try{
            const session=window.session;
            const token=session&&session.access_token;
            if(!token) throw new Error("Please log in again.");
            const res=await fetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({order_id:order.id,rating,review})});
            const data=await res.json();if(!res.ok||data.success===false)throw new Error(data.error||"Unable to save rating.");
            button.textContent="✓ Rated "+rating+"/5";button.disabled=true;window.alert("Thank you. Your rating has been saved.");
          }catch(e){window.alert(e.message||"Unable to save rating.");}
        };
        wrap.appendChild(button);record.appendChild(wrap);
      });
    };
    window.__salgaRatingWrapped=true;
  }
  const timer=setInterval(function(){install();if(window.__salgaRatingWrapped)clearInterval(timer);},500);
})();

(function(){
  function esc2(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");}
  const token=()=>localStorage.getItem("adminToken")||"";
  function contactsPanel(){
    const admin=document.getElementById("admin");
    if(!admin||document.getElementById("salgaBusinessContactsPanel")) return;
    const panel=document.createElement("div");panel.id="salgaBusinessContactsPanel";panel.className="panel";
    panel.innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0 0 5px">Business Owners & Contacts</h2><p id="salgaBusinessContactsMeta" class="muted" style="margin:0">Admin-only registered business owner contacts.</p></div><button id="salgaBusinessContactsRefresh" class="btn gray" type="button">Refresh</button></div><div id="salgaBusinessContactsStatus" class="status" style="margin-top:10px">Loading...</div><div style="overflow:auto;margin-top:12px"><table style="width:100%;border-collapse:collapse;min-width:760px"><thead><tr><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Business</th><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Owner</th><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Account phone</th><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Registered</th><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Account status</th><th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1">Business status</th></tr></thead><tbody id="salgaBusinessContactsBody"></tbody></table></div>`;
    const target=admin.querySelector("#adminOrderControlPanel")||admin.querySelector(".dashboard-grid")||admin.firstElementChild;
    if(target?.parentNode) target.parentNode.insertBefore(panel,target.nextSibling);else admin.appendChild(panel);
    document.getElementById("salgaBusinessContactsRefresh")?.addEventListener("click",loadContacts);loadContacts();
  }
  async function loadContacts(){
    const status=document.getElementById("salgaBusinessContactsStatus"),body=document.getElementById("salgaBusinessContactsBody");if(!status||!body)return;
    const t=token();if(!t){status.textContent="Admin login is required.";return;}status.textContent="Loading business owners...";
    try{const r=await fetch("/api/admin-business-contacts",{headers:{Authorization:`Bearer ${t}`,Accept:"application/json"},cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Unable to load business owner contacts.");const rows=Array.isArray(d.businesses)?d.businesses:[];body.innerHTML=rows.length?rows.map(row=>`<tr><td style="padding:9px;border-bottom:1px solid #edf0f2">${esc2(row.business_name)}</td><td style="padding:9px;border-bottom:1px solid #edf0f2">${esc2(row.owner_name)}</td><td style="padding:9px;border-bottom:1px solid #edf0f2;font-weight:600">${esc2(row.account_phone)}</td><td style="padding:9px;border-bottom:1px solid #edf0f2">${esc2(row.registration_date?new Date(row.registration_date).toLocaleString():"—")}</td><td style="padding:9px;border-bottom:1px solid #edf0f2">${esc2(row.account_status)}</td><td style="padding:9px;border-bottom:1px solid #edf0f2">${esc2(row.business_status)}</td></tr>`).join(""):`<tr><td colspan="6" style="padding:16px;text-align:center">No registered business owners found.</td></tr>`;const meta=document.getElementById("salgaBusinessContactsMeta");if(meta)meta.textContent=`${rows.length} registered business owner${rows.length===1?"":"s"} — visible only to the admin account.`;status.textContent="Updated just now.";}catch(e){body.innerHTML=`<tr><td colspan="6" style="padding:16px;color:#b42318">${esc2(e.message||e)}</td></tr>`;status.textContent="Could not load contacts.";}
  }
  const boot=()=>{if(document.getElementById("admin"))contactsPanel();};new MutationObserver(boot).observe(document.body,{childList:true,subtree:true});boot();
})();
