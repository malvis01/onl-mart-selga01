(() => {
  const token = () => localStorage.getItem("adminToken") || "";
  const terminal = new Set(["completed","cancelled","unsuccessful","failed","rejected","expired"]);
  const money = n => `₦${Number(n||0).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const esc = s => String(s??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

  function panel(){
    const admin = document.getElementById("admin");
    if(!admin || document.getElementById("adminOrderControlPanel")) return;
    const wrap = document.createElement("div");
    wrap.id = "adminOrderControlPanel";
    wrap.className = "panel";
    wrap.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h2 style="margin:0 0 5px">Order Control & Monitoring</h2>
          <p class="muted" style="margin:0">Admin can monitor active orders and cancel unpaid orders when necessary. Terminal orders remain visible for 25 hours before automatic cleanup.</p>
        </div>
        <button id="adminRefreshOrders" class="btn gray" type="button">Refresh</button>
      </div>
      <div id="adminOrderControlStatus" class="status"></div>
      <div id="adminActiveOrders" style="margin-top:12px">Loading active orders...</div>
    `;
    const target = admin.querySelector(".dashboard-tabs")?.parentElement || admin.firstElementChild;
    if(target?.parentNode) target.parentNode.insertBefore(wrap,target.nextSibling); else admin.appendChild(wrap);
    document.getElementById("adminRefreshOrders")?.addEventListener("click",load);
    load();
  }

  async function load(){
    const box=document.getElementById("adminActiveOrders");
    if(!box) return;
    const t=token();
    if(!t){ box.innerHTML='<div class="notice">Admin login is required to manage orders.</div>'; return; }
    box.innerHTML='Loading active orders...';
    try{
      const r=await fetch('/api/admin-monitoring',{headers:{Authorization:`Bearer ${t}`}});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Unable to load orders.');
      const orders=(d.orders||[]).filter(o=>!terminal.has(String(o.status||'').toLowerCase()));
      if(!orders.length){box.innerHTML='<div class="notice success">No active orders require admin action right now.</div>';return;}
      box.innerHTML=orders.map(o=>{
        const canCancel=String(o.payment_status||'').toLowerCase()!=="paid";
        return `<div class="record" data-order-id="${esc(o.id)}">
          <div class="record-title">Order ${esc(o.id)}</div>
          <div class="record-line"><span>Status</span><strong>${esc(o.status||'unknown')}</strong></div>
          <div class="record-line"><span>Payment</span><strong>${esc(o.payment_status||'unknown')}</strong></div>
          <div class="record-line"><span>Total</span><strong>${money(o.total_amount)}</strong></div>
          <div class="record-line"><span>Created</span><span>${o.created_at?new Date(o.created_at).toLocaleString():"—"}</span></div>
          ${canCancel?`<div class="row" style="margin-top:10px"><button class="btn danger admin-cancel-order" type="button" data-order-id="${esc(o.id)}">Cancel Order</button></div>`:'<div class="notice">Paid order: cancellation is locked here until a safe refund process is available.</div>'}
        </div>`;
      }).join('');
      box.querySelectorAll('.admin-cancel-order').forEach(btn=>btn.addEventListener('click',()=>cancelOrder(btn.dataset.orderId)));
    }catch(e){box.innerHTML=`<div class="notice error">${esc(e.message||e)}</div>`;}
  }

  async function cancelOrder(orderId){
    const reason=window.prompt('Reason for cancelling this order (optional):','Cancelled by SALGA administration.');
    if(reason===null) return;
    const t=token();
    try{
      const r=await fetch('/api/admin-order-actions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify({action:'cancel_order',order_id:orderId,reason})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Order cancellation failed.');
      const s=document.getElementById('adminOrderControlStatus');
      if(s) s.className='status notice success',s.textContent=d.message||'Order cancelled successfully.';
      await load();
      if(typeof window.renderAdmin==='function') { try{ window.renderAdmin(); }catch(_){} }
    }catch(e){
      const s=document.getElementById('adminOrderControlStatus');
      if(s) s.className='status notice error',s.textContent=e.message||String(e);
    }
  }

  const boot=()=>{ if(document.getElementById('admin')) { panel(); } };
  new MutationObserver(boot).observe(document.body,{childList:true,subtree:true});
  setInterval(()=>{if(localStorage.getItem('adminToken')) load();},60000);
  boot();
})();
