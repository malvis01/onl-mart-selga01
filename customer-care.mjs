import OpenAI from "openai";
export default async req=>{
 if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{"content-type":"application/json"}});
 const {message}=await req.json().catch(()=>({})); if(!message)return new Response(JSON.stringify({error:"Message required"}),{status:400,headers:{"content-type":"application/json"}});
 try{
   const client=new OpenAI();
   const completion=await client.chat.completions.create({model:"gpt-4o-mini",messages:[
    {role:"system",content:"You are SALGA Digital Mart Customer Care. Help buyers and business owners with accounts, orders, payments, products, promotions, delivery questions, refunds, and general marketplace support. Be warm, concise and practical. Never claim you completed a refund, payment, payout, account change, or admin action unless the system actually did it. If a matter needs human admin review, say so and tell the customer to use the support contact in the site. SALGA charges sellers 5% marketplace commission and promoted transactions can have an additional 2% promotion fee. Payment options can include card, bank, bank transfer, USSD, PayAttitude, and OPay/PalmPay when enabled by the Paystack merchant account."},
    {role:"user",content:String(message).slice(0,4000)}
   ]});
   return new Response(JSON.stringify({reply:completion.choices?.[0]?.message?.content||"Please contact SALGA support for help."}),{headers:{"content-type":"application/json"}});
 }catch(e){
   return new Response(JSON.stringify({reply:"I’m SALGA Customer Care. I can help with buyer accounts, seller accounts, products, orders, payments and promotions. For a payment or payout problem, please keep your transaction reference and contact the administrator."}),{headers:{"content-type":"application/json"}});
 }
}
export const config={path:"/api/customer-care"};
