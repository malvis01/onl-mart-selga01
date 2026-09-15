(function(){
  "use strict";
  const token=()=>{try{return JSON.parse(localStorage.getItem("session")||"null")?.access_token||""}catch{return ""}};
  const adminToken=()=>localStorage.getItem("adminToken")||"";
  async function post(body,auth){const r=await fetch("/api/withdrawals",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${auth||token()}`},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||"Withdrawal operation failed.");return d;}
  window.sellerWithdrawal=async function(){
    const amount=Number(document.getElementById("sellerWithdrawAmount")?.value);
    if(!amount||amount<=0){if(window.status)status("sellerWithdrawMessage","Enter a valid withdrawal amount.");return;}
    const pin=prompt("Enter your 4-digit SALGA withdrawal PIN.\n\nFor security, SALGA does not ask for or store your bank PIN.");
    if(pin===null)return;
    if(!/^\d{4}$/.test(pin)){if(window.status)status("sellerWithdrawMessage","Your SALGA withdrawal PIN must be exactly 4 digits.");return;}
    try{const d=await post({action:"seller_request",amount,pin});if(window.status)status("sellerWithdrawMessage",d.message||"Withdrawal submitted.","success");const el=document.getElementById("sellerWithdrawAmount");if(el)el.value="";if(typeof window.loadSellerDashboard==="function")loadSellerDashboard();}catch(e){if(window.status)status("sellerWithdrawMessage",e.message);}
  };
  window.setSellerWithdrawalPin=async function(){
    const current=prompt("Enter your current 4-digit SALGA withdrawal PIN.\nIf you have never set one, leave this blank.");
    if(current===null)return;
    const pin=prompt("Create a new 4-digit SALGA withdrawal PIN.");
    if(pin===null)return;
    const confirm=prompt("Re-enter the new 4-digit PIN.");
    if(pin!==confirm||!/^[0-9]{4}$/.test(pin)){alert("The PINs do not match or are not exactly 4 digits.");return;}
    try{const d=await post({action:"seller_set_pin",current_pin:current,pin});alert(d.message||"Withdrawal PIN saved.");}catch(e){alert(e.message);}
  };
  window.adminWithdrawal=async function(){
    const amount=Number(document.getElementById("adminWithdrawAmount")?.value);
    const bank=document.getElementById("adminWithdrawBank")?.value.trim();
    const bankCode=document.getElementById("adminWithdrawBankCode")?.value.trim();
    const account=document.getElementById("adminWithdrawAccount")?.value.trim();
    if(!amount||amount<=0||!bank||!bankCode||!/^\d{10}$/.test(account.replace(/\D/g,""))){if(window.status)status("adminWithdrawalMessage","Enter the amount, Nigerian bank, bank code and 10-digit account number.");return;}
    try{
      const d=await post({action:"admin_request",amount,bank_name:bank,bank_code:bankCode,account_number:account},adminToken());
      const otp=prompt(d.message+"\n\nEnter the 5-digit code from your admin email to continue.");
      if(otp===null)return;
      if(!/^\d{5}$/.test(otp)){if(window.status)status("adminWithdrawalMessage","The verification code must be 5 digits.");return;}
      const done=await post({action:"admin_verify",withdrawal_id:d.withdrawal_id,otp,bank_code:bankCode},adminToken());
      if(window.status)status("adminWithdrawalMessage",done.message||"Admin withdrawal submitted.","success");
      if(typeof window.loadAdminDashboard==="function")loadAdminDashboard();
    }catch(e){if(window.status)status("adminWithdrawalMessage",e.message);}
  };
  function activityPanel(){
    const root=document.getElementById("adminDashboard");
    if(!root||document.getElementById("salgaAdminActivityPanel"))return;
    const panel=document.createElement("div");panel.id="salgaAdminActivityPanel";panel.className="panel";panel.innerHTML="<h2>Live Marketplace Activity</h2><div class=\"muted\">Loading 30-day usage analytics...</div>";
    root.appendChild(panel);
    fetch("/api/admin-activity?days=30",{headers:{Authorization:`Bearer ${adminToken()}`}}).then(r=>r.json()).then(d=>{
      if(d.error)throw new Error(d.error);const a=d.activity||{};const s=a.daily_activity||[];const top=a.top_event_types||[];
      panel.innerHTML=`<h2>Live Marketplace Activity</h2><div class="dashboard-grid"><div class="stat"><div class="stat-label">Active users (30d)</div><div class="stat-value">${a.active_users||0}</div></div><div class="stat"><div class="stat-label">Users today</div><div class="stat-value">${a.users_today||0}</div></div><div class="stat"><div class="stat-label">Events today</div><div class="stat-value">${a.events_today||0}</div></div><div class="stat"><div class="stat-label">Total events (30d)</div><div class="stat-value">${a.total_events||0}</div></div></div><h3>Daily usage</h3>${s.length?s.slice(-14).map(x=>`<div class="record-line"><span>${String(x.day||"")}</span><strong>${Number(x.events||0)} events · ${Number(x.users||0)} users</strong></div>`).join(""):"<div class=\"notice\">No activity events have been recorded yet. The tracker will populate this section as buyers and business owners use the site.</div>"}<h3>Top activity types</h3>${top.length?top.map(x=>`<div class="record-line"><span>${String(x.event_type||"")}</span><strong>${Number(x.count||0)}</strong></div>`).join(""):"<div class=\"muted\">No activity types recorded yet.</div>"}`;
    }).catch(e=>{panel.innerHTML=`<h2>Live Marketplace Activity</h2><div class="error">${String(e.message||e)}</div>`;});
  }
  const originalRender=window.renderAdmin;
  if(typeof originalRender==="function")window.renderAdmin=function(){originalRender.apply(this,arguments);setTimeout(activityPanel,300);};
  document.addEventListener("DOMContentLoaded",()=>{
    const sellerBox=document.getElementById("sellerWithdrawalInfo");
    if(sellerBox&&!document.getElementById("setSellerWithdrawalPinBtn")){
      const b=document.createElement("button");b.id="setSellerWithdrawalPinBtn";b.className="btn gray";b.type="button";b.textContent="Set / Change Withdrawal PIN";b.onclick=window.setSellerWithdrawalPin;sellerBox.parentElement?.appendChild(b);
    }
  });
})();
