import {read,write,id,now,hash,json,body} from "./_shared/store.mjs";
export default async req=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const b=await body(req); const users=await read("users",[]);
 if(!b.phone||!b.password||!["buyer","seller"].includes(b.role))return json({error:"Phone, password and role are required"},400);
 const phone=String(b.phone).trim(); let u=users.find(x=>x.phone===phone&&x.role===b.role);
 if(b.action==="register"){
   if(u)return json({error:"Account already exists"},409);
   u={id:id("usr"),phone,role:b.role,passwordHash:hash(b.password),status:"pending_activation",createdAt:now()};
   if(b.role==="seller"){if(!b.businessName||!b.bankName||!b.accountNumber)return json({error:"Business name, bank and account number are required"},400);u.businessName=b.businessName;u.email=b.email||"";u.bankName=b.bankName;u.bankCode=b.bankCode||"";u.accountNumber=b.accountNumber.replace(/\D/g,"");}
   u.activationCode=String(Math.floor(100000+Math.random()*900000));users.push(u);await write("users",users);
   // Production SMS/WhatsApp hook: set SMS_PROVIDER_URL/SMS_PROVIDER_TOKEN or replace sendActivation.
   return json({activationRequired:true,activationCode:u.activationCode,user:{...u,passwordHash:undefined,activationCode:undefined}});
 }
 if(!u||u.passwordHash!==hash(b.password))return json({error:"Invalid phone number or password"},401);
 if(u.status!=="active")return json({error:"Account is not activated yet"},403);
 return json({user:{...u,passwordHash:undefined,activationCode:undefined}});
}
export const config={path:"/api/auth"};