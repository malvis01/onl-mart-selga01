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
