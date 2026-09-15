(() => {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c]));
  let lastUser = null;

  const getUser = () => {
    try { return typeof me !== "undefined" ? me : null; } catch (_) { return null; }
  };

  const isLoggedIn = () => {
    try { return typeof session !== "undefined" && !!session?.access_token; } catch (_) { return false; }
  };

  const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

  const show = () => {
    const user = getUser();
    if (!user || !isLoggedIn()) return;
    const dashboard = user.role === "buyer" ? document.getElementById("buyerDashboard") : document.getElementById("sellerDashboard");
    if (!dashboard || dashboard.classList.contains("hidden")) return;
    const id = "salgaAccountUpdates";
    let panel = document.getElementById(id);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = id;
      panel.className = "panel";
      dashboard.insertBefore(panel, dashboard.firstChild);
    }

    const roleText = user.role === "buyer" ? "buyer account" : "business account";
    panel.innerHTML = `
      <h2 style="margin-top:0">✨ Your SALGA account updates</h2>
      <p class="muted">Welcome back. Your existing ${esc(roleText)} has been kept. You can now use the new features without creating a new account.</p>
      <div style="display:grid;gap:8px;margin-top:10px">
        <div style="padding:10px;border:1px solid #dfe5e7;border-radius:10px"><b>👤 Profile picture / business logo</b><br><span class="muted">Add or update your picture. Business owners can use a face or business logo.</span></div>
        <div style="padding:10px;border:1px solid #dfe5e7;border-radius:10px"><b>🔔 Order notifications</b><br><span class="muted">Enable notifications to receive important order updates, including when SALGA is not open.</span></div>
        <div style="padding:10px;border:1px solid #dfe5e7;border-radius:10px"><b>📱 Install SALGA</b><br><span class="muted">Add SALGA to your phone home screen for quicker access.</span></div>
      </div>
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
        <button class="btn" type="button" id="salgaUpdateNotifications">🔔 Enable notifications</button>
        <button class="btn gray" type="button" id="salgaUpdateInstall">📱 Install / Add to home screen</button>
        <button class="btn gray" type="button" id="salgaUpdateProfile">👤 Go to my profile</button>
      </div>
      <div id="salgaAccountUpdateStatus" class="status" style="margin-top:8px"></div>`;

    panel.querySelector("#salgaUpdateNotifications").onclick = async () => {
      const status = panel.querySelector("#salgaAccountUpdateStatus");
      try {
        if (typeof window.salgaEnablePush !== "function") throw new Error("Notification setup is not available yet. Please refresh SALGA after the latest deployment.");
        status.textContent = "Setting up notifications...";
        await window.salgaEnablePush();
        status.textContent = "Notification setup opened. Allow SALGA notifications when your browser asks.";
      } catch (e) { status.textContent = e.message || "Could not enable notifications."; }
    };

    panel.querySelector("#salgaUpdateInstall").onclick = () => {
      if (isInstalled()) {
        panel.querySelector("#salgaAccountUpdateStatus").textContent = "SALGA is already installed on this device.";
        return;
      }
      if (typeof window.salgaInstallApp === "function") {
        window.salgaInstallApp();
        return;
      }
      panel.querySelector("#salgaAccountUpdateStatus").textContent = "On Android Chrome, open the browser menu (⋮) and choose Install app or Add to Home screen. If an Install SALGA prompt appears, use it.";
    };

    panel.querySelector("#salgaUpdateProfile").onclick = () => {
      const target = user.role === "buyer" ? document.getElementById("buyerDashboard") : document.getElementById("sellerDashboard");
      const avatar = target?.querySelector("#salgaBuyerAvatarCard, #salgaSellerAvatarCard");
      avatar?.scrollIntoView({ behavior: "smooth", block: "center" });
      avatar?.querySelector("input[type=file]")?.focus();
    };
  };

  const tick = () => {
    const user = getUser();
    const key = user?.id || null;
    if (key !== lastUser) lastUser = key;
    show();
  };

  window.addEventListener("load", tick);
  setInterval(tick, 1200);
})();
