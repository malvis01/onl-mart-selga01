import {read,write,json} from "./_shared/store.mjs";
import crypto from "node:crypto";
export default async req=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const secret=Netlify.env.get("PAYSTACK_SECRET_KEY"); const signature=req.headers.get("x-paystack-signature"); const raw=await req.text();
 if(!secret||!signature)return json({error:"Unauthorized"},401);
 const expected=crypto.createHmac("sha512",secret).update(raw).digest("hex");
 if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return json({error:"Invalid signature"},401);
 const event=JSON.parse(raw); if(event.event!=="charge.success"&&event.event!=="transaction.success")return json({received:true});
 const ref=event.data?.reference; if(!ref)return json({received:true});
 const orders=await read("orders",[]); const o=orders.find(x=>x.reference===ref); if(o&&o.status!=="paid"){o.status="paid";o.paidAt=new Date().toISOString();o.gatewayTransactionId=event.data.id;await write("orders",orders)}
 return json({received:true});
}
export const config={path:"/api/paystack-webhook"};
