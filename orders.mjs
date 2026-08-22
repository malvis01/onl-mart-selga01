import {read,json} from "./_shared/store.mjs";
export default async req=>{
  if(req.method!=="GET") return json({error:"Method not allowed"},405);
  const phone=req.headers.get("x-user-phone");
  const users=await read("users",[]); const u=users.find(x=>x.phone===phone && x.status==="active");
  if(!u) return json({error:"Login required"},401);
  const orders=await read("orders",[]);
  return json({orders:u.role==="seller"?orders.filter(o=>o.sellerId===u.id):orders.filter(o=>o.buyerPhone===phone)});
}
export const config={path:"/api/orders"};
