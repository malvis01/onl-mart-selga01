(() => {
  let deferredInstallPrompt = null;
  let initializedFor = null;
  let registrationPromise = null;

  const authToken = () => {
    try { return typeof session !== "undefined" ? session?.access_token || null : null; } catch (_) { return null; }
  };

  const apiRequest = async (path, options = {}) => {
    if (typeof api === "function") return api(path, options);
    const token = authToken();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api/${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  };

  const vapidKeyToBytes = (value) => {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  };

  const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

  const install = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => {});
      deferredInstallPrompt = null;
      renderPrompt();
      return;
    }
    alert("To install SALGA: open your browser menu and choose ‘Add to Home screen’ or ‘Install app’. Chrome/Android may show the install option automatically.");
  };

  const renderPrompt = (message = "") => {
    let box = document.getElementById("salgaPushPrompt");
    if (!box) {
      box = document.createElement("div");
      box.id = "salgaPushPrompt";
      box.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#fff;border:1px solid #d6dde1;border-radius:14px;box-shadow:0 8px 30px #0002;padding:14px;max-width:560px;margin:auto";
      document.body.appendChild(box);
    }
    const notificationAllowed = Notification.permission === "granted";
    const canInstall = Boolean(deferredInstallPrompt) && !isInstalled();
    if (!notificationAllowed && Notification.permission !== "denied") {
      box.innerHTML = `<strong>🔔 Stay updated with SALGA</strong><div style="margin:6px 0;color:#68727d">Allow SALGA notifications so you can receive order updates even when SALGA is not open.</div><button id="salgaAllowPush" style="background:#075e54;color:#fff;border:0;border-radius:8px;padding:9px 12px">Allow notifications</button><button id="salgaDismissPush" style="margin-left:7px;background:#eef2f3;border:0;border-radius:8px;padding:9px 12px">Not now</button>`;
      box.querySelector("#salgaAllowPush").onclick = enablePush;
      box.querySelector("#salgaDismissPush").onclick = () => { box.remove(); localStorage.setItem("salga_push_prompt_dismissed", "1"); };
      return;
    }
    if (canInstall) {
      box.innerHTML = `<strong>📱 Add SALGA to your phone</strong><div style="margin:6px 0;color:#68727d">Install SALGA on your home screen so it opens like an app.</div><button id="salgaInstall" style="background:#075e54;color:#fff;border:0;border-radius:8px;padding:9px 12px">Install SALGA</button><button id="salgaDismissInstall" style="margin-left:7px;background:#eef2f3;border:0;border-radius:8px;padding:9px 12px">Later</button>`;
      box.querySelector("#salgaInstall").onclick = install;
      box.querySelector("#salgaDismissInstall").onclick = () => box.remove();
      return;
    }
    if (message) {
      box.innerHTML = `<strong>✅ SALGA notifications enabled</strong><div style="margin-top:5px;color:#68727d">${message}</div>`;
      setTimeout(() => box.remove(), 4500);
    } else box.remove();
  };

  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator)) return Promise.reject(new Error("Service workers are not supported."));
    if (!registrationPromise) registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registrationPromise;
  };

  async function enablePush() {
    try {
      const config = await apiRequest("push-subscriptions");
      if (!config.configured || !config.publicKey) throw new Error("Web Push is not configured on SALGA yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        renderPrompt("Notifications were not enabled. You can enable them later in your browser settings.");
        return;
      }
      const registration = await registerServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToBytes(config.publicKey)
        });
      }
      await apiRequest("push-subscriptions", { method: "POST", body: JSON.stringify({ subscription }) });
      localStorage.setItem("salga_push_enabled", "1");
      renderPrompt("You will receive important order updates even when SALGA is closed.");
    } catch (error) {
      console.error("SALGA PUSH SETUP", error);
      renderPrompt(`Notifications could not be enabled yet: ${error.message}`);
    }
  }

  async function refreshBadge() {
    if (!authToken()) return;
    try {
      const data = await apiRequest("order-notifications?limit=100");
      const count = (data.notifications || []).filter((item) => !item.read_at).length;
      if (navigator.setAppBadge && count > 0) await navigator.setAppBadge(count);
      else if (navigator.clearAppBadge && count === 0) await navigator.clearAppBadge();
    } catch (_) {}
  }

  async function maybeInitialize() {
    const token = authToken();
    if (!token || initializedFor === token) return;
    initializedFor = token;
    if ("serviceWorker" in navigator) registerServiceWorker().catch(() => {});
    if (!("Notification" in window) || !("PushManager" in window)) return;
    await refreshBadge();
    if (Notification.permission === "granted") {
      try {
        const registration = await registerServiceWorker();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await apiRequest("push-subscriptions", { method: "POST", body: JSON.stringify({ subscription }) });
        else if (!localStorage.getItem("salga_push_prompt_dismissed")) renderPrompt();
      } catch (_) {}
    } else if (Notification.permission === "default" && !localStorage.getItem("salga_push_prompt_dismissed")) {
      renderPrompt();
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (authToken()) renderPrompt();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.getElementById("salgaPushPrompt")?.remove();
  });

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "salga-notification-open") {
      refreshBadge();
      if (event.data.orderId && typeof show === "function") show("account");
    }
  });

  window.salgaEnablePush = enablePush;
  window.salgaRefreshPushBadge = refreshBadge;

  setInterval(maybeInitialize, 1500);
  window.addEventListener("load", maybeInitialize);
})();
