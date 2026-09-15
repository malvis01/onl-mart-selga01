(() => {
  try {
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = "/manifest.webmanifest";
      document.head.appendChild(link);
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => console.warn("SALGA service worker registration failed", error));
  } catch (error) { console.warn("SALGA PWA setup failed", error); }
})();
