// Shared by the Edge Function and the tests. No client-side PIN verification.
const encoder=new TextEncoder();
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const randomHex=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
export async function digest(pin,salt,pepper){
 const hkey=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const secret=await crypto.subtle.sign('HMAC',hkey,encoder.encode('logistics-pin-v1:'+pin));
 const key=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:600000},key,256));
}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let mismatch=0;for(let i=0;i<64;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
export function validPin(pin){return typeof pin==='string'&&/^\d{6}$/.test(pin)&&!(/^(\d)\1{5}$/.test(pin))&&!['123456','654321','012345','543210'].includes(pin);}
export function freshPassword(token,now=Date.now()){
 try{const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const claims=JSON.parse(atob(encoded));return Array.isArray(claims.amr)&&claims.amr.some(a=>a.method==='password'&&a.timestamp*1000<=now&&now-a.timestamp*1000<=300000);}catch{return false;}
}
export function createHandler({rpc,authenticate,issueSession,pepper,shop,origins}){
 return async request=>{
  const origin=request.headers.get('origin');const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(!origins.includes(origin))return new Response('{}',{status:403,headers});
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Méthode refusée.'});
  try{
   const text=await request.text();if(text.length>2048)return reply(413,{error:'Requête trop longue.'});
   const body=JSON.parse(text);if(!body||typeof body!=='object')return reply(400,{error:'Requête invalide.'});
   if(['pair','enrol','revoke'].includes(body.action)){
    const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
    const user=await authenticate(token);if(!user?.id||!freshPassword(token))return reply(401,{error:'Reconnectez-vous avec votre mot de passe pour activer ou modifier le PIN (moins de cinq minutes).'});
    if(body.action==='pair'){const device=randomHex(32);await rpc('logistics_pin_pair',{actor:user.id,shop,device_hash:await sha(device)});return reply(200,{device});}
    if(body.action==='enrol'){if(!validPin(body.pin))return reply(400,{error:'Choisissez six chiffres, sans suite simple ni chiffre répété six fois.'});const salt=randomHex(16);await rpc('logistics_pin_enrol',{actor:user.id,shop,pin_salt:salt,pin_digest:await digest(body.pin,salt,pepper)});return reply(200,{ok:true});}
    if(typeof body.device!=='string'||!/^[a-f0-9]{64}$/.test(body.device))return reply(400,{error:'Appareil inconnu.'});
    await rpc('logistics_pin_revoke',{actor:user.id,device_hash:await sha(body.device)});return reply(200,{ok:true});
   }
   if(typeof body.device!=='string'||!/^[a-f0-9]{64}$/.test(body.device))return reply(401,{error:'Ce navigateur doit être associé au magasin par le responsable.'});
   const device_hash=await sha(body.device);
   if(body.action==='roster'){const people=await rpc('logistics_pin_roster',{device_hash});return reply(200,{people});}
   if(body.action!=='login'||typeof body.person!=='string'||!/^[a-f0-9-]{36}$/i.test(body.person)||typeof body.pin!=='string'||!/^\d{6}$/.test(body.pin))return reply(400,{error:'Choisissez votre nom et saisissez six chiffres.'});
   const entry=await rpc('logistics_pin_attempt',{device_hash,person:body.person});
   if(!entry||!equal(await digest(body.pin,entry.salt,pepper),entry.digest))return reply(401,{error:'Connexion refusée. Vérifiez le code ; après cinq essais, attendez quinze minutes.'});
   const session=await issueSession(entry.user_id);
   if(session?.user?.id!==entry.user_id||!session.access_token||!session.refresh_token)return reply(401,{error:'Connexion refusée.'});
   if(!await rpc('logistics_pin_finish',{device_hash,person:entry.user_id,credential_version:entry.version}))return reply(401,{error:'Accès modifié. Reconnectez-vous.'});
   return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return reply(503,{error:'Connexion PIN indisponible. Utilisez la connexion de secours ou réessayez plus tard.'});}
 };
}
