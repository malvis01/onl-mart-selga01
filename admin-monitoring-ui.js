(function(){
  "use strict";
  const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  const money=v=>"₦"+Number(v||0).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
  const token=()=>localStorage.getItem("adminToken")||"";
  let timer=null;
  async function load(){
    const root=document.getElementById("adminDashboard");
    if(!root||!token())return;
    let panel=document.getElementById("salgaAdminControlCenter");
    if(!panel){panel=document.createElement("div");panel.id="salgaAdminControlCenter";panel.className="panel";root.insertBefore(panel,root.firstChild);}
    panel.innerHTML='<h2>Admin Control Center</h2><div class="muted">Loading live marketplace data...</div>';
    try{
      const r=await fetch("/api/admin-monitoring",{headers:{Authorization:"Bearer "+token()}});
      const d=await r.json().catch(()=>({}));
      if(r.status===401||r.status===403){localStorage.removeItem("adminToken");panel.innerHTML='<div class="notice error">Admin session expired. Please log in again.</div>';return;}
      if(!r.ok)throw new Error(d.error||"Unable to load admin monitoring.");
      const o=d.overview||{}, users=d.users||[], orders=d.orders||[];
      panel.innerHTML=`
        <div class="dashboard-grid">
          <div class="stat"><div class="stat-label">Buyers</div><div class="stat-value">${o.buyers||0}</div></div>
          <div class="stat"><div class="stat-label">Business owners</div><div class="stat-value">${o.business_owners||0}</div></div>
          <div class="stat"><div class="stat-label">Businesses</div><div class="stat-value">${o.businesses||0}</div></div>
          <div class="stat"><div class="stat-label">Active businesses</div><div class="stat-value">${o.active_businesses||0}</div></div>
          <div class="stat"><div class="stat-label">Orders today</div><div class="stat-value">${o.orders_today||0}</div></div>
          <div class="stat"><div class="stat-label">Paid orders</div><div class="stat-value">${o.paid_orders||0}</div></div>
          <div class="stat"><div class="stat-label">Open orders</div><div class="stat-value">${o.open_orders||0}</div></div>
          <div class="stat"><div class="stat-label">Completed orders</div><div class="stat-value">${o.completed_orders||0}</div></div>
          <div class="stat"><div class="stat-label">Restricted users</div><div class="stat-value">${o.restricted_users||0}</div></div>
          <div class="stat"><div class="stat-label">Unread order alerts</div><div class="stat-value">${o.unread_order_notifications||0}</div></div>
        </div>
        <div class="row" style="justify-content:space-between;align-items:center;margin-top:16px"><h3 style="margin:0">Recent Orders</h3><button class="btn gray" type="button" id="salgaAdminRefresh">Refresh</button></div>
        <div class="table-wrap" style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Order</th><th style="text-align:left;padding:8px">Amount</th><th style="text-align:left;padding:8px">Payment</th><th style="text-align:left;padding:8px">Status</th><th style="text-align:left;padding:8px">Created</th></tr></thead><tbody>${orders.length?orders.slice(0,20).map(x=>`<tr><td style="padding:8px">#${esc(x.id).slice(0,12)}</td><td style="padding:8px">${money(x.total_amount)}</td><td style="padding:8px">${esc(x.payment_status||"pending")}</td><td style="padding:8px">${esc(x.status||"pending")}</td><td style="padding:8px">${esc(x.created_at||"")}</td></tr>`).join(""):'<tr><td colspan="5" style="padding:10px">No orders recorded.</td></tr>'}</tbody></table></div>
        <h3>User Access & Activity</h3>
        <div class="muted">Last activity is based on recorded profile/order activity. Restricted accounts are blocked at login.</div>
        <div class="table-wrap" style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">User</th><th style="text-align:left;padding:8px">Role</th><th style="text-align:left;padding:8px">Orders</th><th style="text-align:left;padding:8px">Last activity</th><th style="text-align:left;padding:8px">Status</th><th style="padding:8px">Action</th></tr></thead><tbody>${users.length?users.map(u=>`<tr><td style="padding:8px">${esc(u.full_name||"User")}</td><td style="padding:8px">${esc(u.role||"")}</td><td style="padding:8px">${Number(u.order_count||0)}</td><td style="padding:8px">${esc(u.last_activity||"Never")}</td><td style="padding:8px"><span class="tag">${esc(u.account_status||"active")}</span></td><td style="padding:8px">${u.role==="admin"?'—':u.account_status==="restricted"?`<button class="btn gray salga-restore-user" data-user="${esc(u.id)}" type="button">Restore</button>`:`<button class="btn salga-restrict-user" data-user="${esc(u.id)}" data-name="${esc(u.full_name||"User")}" type="button">Restrict</button>`}</td></tr>`).join(""):'<tr><td colspan="6" style="padding:10px">No users found.</td></tr>'}</tbody></table></div>`;
      panel.querySelector("#salgaAdminRefresh")?.addEventListener("click",load);
      panel.querySelectorAll(".salga-restrict-user").forEach(b=>b.addEventListener("click",async()=>{const reason=prompt("Reason for restricting "+b.dataset.name+":");if(reason===null)return;await change(b.dataset.user,"restrict",reason);}));
      panel.querySelectorAll(".salga-restore-user").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Restore this user's access?"))return;await change(b.dataset.user,"restore","");}));
    }catch(e){panel.innerHTML=`<h2>Admin Control Center</h2><div class="notice error">${esc(e.message||e)}</div>`;}
  }
  async function change(user_id,action,reason){
    try{const r=await fetch("/api/admin-monitoring",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token()},body:JSON.stringify({user_id,action,reason})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Unable to update account.");await load();}catch(e){alert(e.message);}
  }
  function start(){
    if(!document.getElementById("adminDashboard")||!token())return;
    setTimeout(load,250);
    clearInterval(timer);timer=setInterval(()=>{if(document.getElementById("adminDashboard")&&!document.getElementById("adminDashboard").classList.contains("hidden")&&token())load();},20000);
  }
  window.loadAdminMonitoring=load;
  document.addEventListener("DOMContentLoaded",start);
  const original=window.renderAdmin;
  if(typeof original==="function")window.renderAdmin=function(){original.apply(this,arguments);start();};
})();
