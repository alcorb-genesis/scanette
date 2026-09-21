import {createHandler,createApiClient} from './service.mjs';
const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Dedicated encrypted Vault secret, independent from API-key rotation.
let cachedHandler;
const call=createApiClient(url,key);
async function getHandler(){
 if(cachedHandler)return cachedHandler;
 const pepper=await call('/rest/v1/rpc/logistics_pin_pepper',{});
 if(typeof pepper!=='string'||pepper.length<43)throw Error('PIN service unconfigured');
 cachedHandler=createHandler({
 pepper,shop:'8770297c-cadb-4cc6-8b93-55a0f9bd154e',origins:['https://scanette.vercel.app'],
 rpc:(name,args)=>call('/rest/v1/rpc/'+name,args),
 authenticate:token=>call('/auth/v1/user',undefined,token),
 issueSession:async id=>{
  const user=await call('/auth/v1/admin/users/'+id);
  if(user.id!==id||!user.email||user.banned_until&&new Date(user.banned_until)>new Date())throw Error('Account unavailable');
  const link=await call('/auth/v1/admin/generate_link',{type:'magiclink',email:user.email});
  if(link.id!==id||!link.hashed_token)throw Error('Identity mismatch');
  return call('/auth/v1/verify',{type:'magiclink',token_hash:link.hashed_token});
 }
});
 return cachedHandler;
}
Deno.serve(async request=>{try{if(!url||!key)throw Error();return await (await getHandler())(request);}catch{return new Response(JSON.stringify({error:'Connexion PIN non activée.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}});
