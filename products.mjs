import {read,write,id,now,json,body} from "./_shared/store.mjs";
export default async req=>{
 const products=await read("products",[]);
 if(req.method==="GET")return json({products:products.filter(x=>x.status!=="deleted")});
 if(req.method==="POST"){const b=await body(req);const phone=req.headers.get("x-user-phone");const users=await read("users",[]);const u=users.find(x=>x.phone===phone&&x.role==="seller"&&x.status==="active");if(!u)return json({error:"Seller authentication required"},401);if(!b.name||!b.price)return json({error:"Name and price required"},400);const p={id:id("prd"),sellerId:u.id,businessName:u.businessName,name:b.name,price:Number(b.price),category:b.category||"Other",description:b.description||"",image:b.image||"",status:"active",promoted:false,createdAt:now()};products.push(p);await write("products",products);return json({product:p},201)}
return json({error:"Method not allowed"},405)}
export const config={path:"/api/products"};