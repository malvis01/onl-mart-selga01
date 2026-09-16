(function(){
  const PANEL_ID = "salgaBusinessContactsPanel";

  function esc(value){
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function sessionToken(){
    return window.session && window.session.access_token ? window.session.access_token : "";
  }

  function install(){
    const admin = document.getElementById("admin");
    if(!admin || document.getElementById(PANEL_ID)) return false;

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "card";
    panel.style.marginTop = "18px";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px;">Business Owners &amp; Contacts</h3>
          <div id="salgaBusinessContactsMeta" style="color:#68727d;font-size:13px;">Admin-only contact directory</div>
        </div>
        <button id="salgaBusinessContactsRefresh" class="btn" type="button">Refresh</button>
      </div>
      <div id="salgaBusinessContactsStatus" style="margin:12px 0;color:#68727d;">Loading...</div>
      <div style="overflow:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:760px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Business</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Owner</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Account phone</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Registered</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Account status</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #d6dde1;">Business status</th>
            </tr>
          </thead>
          <tbody id="salgaBusinessContactsBody"></tbody>
        </table>
      </div>`;

    const anchor = admin.querySelector(".dashboard-grid") || admin.firstElementChild;
    if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else admin.appendChild(panel);

    document.getElementById("salgaBusinessContactsRefresh").addEventListener("click", load);
    load();
    return true;
  }

  async function load(){
    const status = document.getElementById("salgaBusinessContactsStatus");
    const body = document.getElementById("salgaBusinessContactsBody");
    const meta = document.getElementById("salgaBusinessContactsMeta");
    if(!status || !body) return;

    const token = sessionToken();
    if(!token){
      status.textContent = "Admin login required.";
      return;
    }

    status.textContent = "Loading business owners...";
    try{
      const res = await fetch("/api/admin-business-contacts",{
        method:"GET",
        headers:{Authorization:"Bearer "+token,Accept:"application/json"},
        cache:"no-store"
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Unable to load business contacts.");

      const rows = Array.isArray(data.businesses) ? data.businesses : [];
      body.innerHTML = rows.length ? rows.map(row=>{
        const date = row.registration_date ? new Date(row.registration_date).toLocaleString() : "—";
        return `<tr>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;">${esc(row.business_name)}</td>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;">${esc(row.owner_name)}</td>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;font-weight:600;">${esc(row.account_phone)}</td>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;">${esc(date)}</td>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;">${esc(row.account_status)}</td>
          <td style="padding:9px;border-bottom:1px solid #edf0f2;">${esc(row.business_status)}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="6" style="padding:16px;text-align:center;color:#68727d;">No registered business owners found.</td></tr>`;

      if(meta) meta.textContent = `${rows.length} registered business owner${rows.length===1?"":"s"} — visible only to the admin account.`;
      status.textContent = "Updated just now.";
    }catch(error){
      body.innerHTML = `<tr><td colspan="6" style="padding:16px;color:#b42318;">${esc(error.message || "Unable to load contacts.")}</td></tr>`;
      status.textContent = "Could not load contacts.";
    }
  }

  const timer = setInterval(function(){
    if(install()) clearInterval(timer);
  },500);
})();
