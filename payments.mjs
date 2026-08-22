import {read,write,id,now,json,body} from "./_shared/store.mjs";
const PAYSTACK="https://api.paystack.co";
function headers(){return {Authorization:`Bearer ${Netlify.env.get("PAYSTACK_SECRET_KEY")}`,"Content-Type":"application/json"}}
export default async req=>{
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 const key=Netlify.env.get("PAYSTACK_SECRET_KEY"); if(!key) return json({error:"Live Paystack key is not configured. Add PAYSTACK_SECRET_KEY in Netlify."},503);
 const b=await body(req); const products=await read("products",[]); const p=products.find(x=>x.id===b.productId&&x.status==="active"); if(!p)return json({error:"Product not found"},404);
 const users=await read("users",[]); const seller=users.find(x=>x.id===p.sellerId&&x.role==="seller"); if(!seller?.subaccountCode)return json({error:"Seller payout account is not connected. The seller must complete bank verification first."},409);
 const amount=Math.round(Number(p.price)*100); const commission=Math.round(amount*0.05); const promoFee=p.promoted?Math.round(amount*0.02):0; const platformCharge=commission+promoFee;
 const ref="SALGA_"+Date.now()+"_"+crypto.randomUUID().slice(0,8);
 const origin=new URL(req.url).origin;
 const payload={email:b.email||seller.email||"customer@salgadigitalmart.com",amount,reference:ref,currency:"NGN",subaccount:seller.subaccountCode,transaction_charge:platformCharge,bearer:"account",channels:["card","bank","bank_transfer","ussd","qr","payattitude"],callback_url:origin+"/"+"?payment_ref="+encodeURIComponent(ref),metadata:{productId:p.id,sellerId:seller.id,buyerPhone:req.headers.get("x-user-phone")||"",commissionRate:5,promotionRate:p.promoted?2:0}};
 const r=await fetch(PAYSTACK+"/transaction/initialize",{method:"POST",headers:headers(),body:JSON.stringify(payload)}); const d=await r.json(); if(!r.ok||!d.status)return json({error:d.message||"Payment initialization failed"},400);
 const orders=await read("orders",[]); orders.push({id:id("ord"),reference:ref,productId:p.id,sellerId:seller.id,buyerPhone:req.headers.get("x-user-phone")||"",amount:Number(p.price),commission:commission/100,promotionFee:promoFee/100,vendorAmount:(amount-platformCharge)/100,status:"pending",paymentChannels:payload.channels,createdAt:now()}); await write("orders",orders);
 return json({authorization_url:d.data.authorization_url,reference:ref,paymentMethods:["Card","Bank","Bank Transfer","USSD","PayAttitude","OPay/PalmPay where enabled on Paystack"]});
}
export const config={path:"/api/payments"};
