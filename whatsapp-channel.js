(() => {
  const CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDbQAqHwXbFEE8IVX2Y';
  const CARD_ID = 'salgaWhatsAppChannelCard';

  function mountWhatsAppCard() {
    const dashboard = document.getElementById('buyerDashboard');
    if (!dashboard || dashboard.classList.contains('hidden') || document.getElementById(CARD_ID)) return;

    const card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'panel';
    card.style.cssText = 'border:1px solid #cfe8e3;background:linear-gradient(135deg,#f4fffc,#ffffff);margin-top:16px;';
    card.innerHTML = `
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div style="font-size:34px;line-height:1">📢</div>
        <div style="flex:1;min-width:240px">
          <h2 style="margin:0 0 7px">Stay Connected With SALGA Digital Mart</h2>
          <p class="muted" style="margin:0 0 12px">Join our official WhatsApp Channel to stay informed, learn how to use SALGA, discover new businesses and products, and receive important marketplace updates.</p>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:14px">
            <div class="record" style="margin:0;padding:10px"><strong>🛍️ New products & businesses</strong><br><span class="muted">See new sellers and products added to SALGA.</span></div>
            <div class="record" style="margin:0;padding:10px"><strong>📚 Learn how SALGA works</strong><br><span class="muted">Get simple guides for registration, buying, payment and orders.</span></div>
            <div class="record" style="margin:0;padding:10px"><strong>📦 Order & delivery education</strong><br><span class="muted">Understand the order, payment, delivery and receipt process.</span></div>
            <div class="record" style="margin:0;padding:10px"><strong>📢 Important updates</strong><br><span class="muted">Stay informed about features, announcements and activities.</span></div>
          </div>
          <p class="muted" style="margin:0 0 12px"><strong>Help us grow local commerce:</strong> join the channel and share it with family, friends, customers and businesses that should be on SALGA.</p>
          <a class="btn" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none">💬 Join Official WhatsApp Channel</a>
        </div>
      </div>`;

    const hero = dashboard.querySelector('.hero');
    if (hero?.nextElementSibling) hero.insertAdjacentElement('afterend', card);
    else dashboard.prepend(card);
  }

  function observeDashboard() {
    mountWhatsAppCard();
    const observer = new MutationObserver(mountWhatsAppCard);
    const dashboard = document.getElementById('buyerDashboard');
    if (dashboard) observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeDashboard);
  else observeDashboard();
})();
