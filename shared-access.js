/* Shared logistics access behind one shared password (decision of 8 October 2026).
   The password is checked by the server (shared_access_open) and is never kept: this file only
   holds the short session token the server returns, for the life of the tab. No password, hash or
   shop identifier is written here. Every data call goes to a shared_* database function. */
(function(root){
'use strict';
const URL='https://pryocchvwmnuoidtitow.supabase.co',KEY='sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ';
// Local storage key used for this device's own work (scanner pointage, preparations).
const ACTOR='shared',STORE='alcorb_shared_session_v1';
let client=null,asking=null,memory=null;
function db(){
 // A staff session left on the device by the former login is never reused.
 if(!client)client=root.supabase.createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 return client;
}
/* Session token: tab storage (shared by the shell and its embedded modules), memory as a fallback. */
function stored(){try{return JSON.parse(root.sessionStorage.getItem(STORE)||'null');}catch{return memory;}}
function saved(){const v=stored();return v&&/^[0-9a-f]{64}$/.test(v.token||'')&&new Date(v.expires_at).getTime()>Date.now()?v:null;}
function keep(v){memory=v;try{root.sessionStorage.setItem(STORE,JSON.stringify(v));}catch{}}
function forget(){memory=null;try{root.sessionStorage.removeItem(STORE);}catch{}}
const active=()=>saved()!==null;
function fail(error){return Object.assign(Error(message(error)),{code:error.code,original:error.message});}
/* Sends the password once. Nothing is stored but the token returned by the server. */
async function open(password){
 if(typeof password!=='string'||!password)throw Object.assign(Error('Saisissez le mot de passe.'),{code:'EMPTY'});
 const {data,error}=await db().rpc('shared_access_open',{password});
 if(error)throw fail(error);
 const row=Array.isArray(data)?data[0]:data;
 if(!row||!/^[0-9a-f]{64}$/.test(row.token||''))throw Object.assign(Error('Mot de passe incorrect.'),{code:'WRONG'});
 keep({token:row.token,expires_at:row.expires_at});
}
async function leave(){const session=saved();forget();if(session)try{await db().rpc('shared_access_close',{session_token:session.token});}catch{}}
/* One password form at a time, built here so every logistics page shares it. */
function form(){return new Promise((resolve,reject)=>{
 const d=root.document,el=(tag,text)=>{const n=d.createElement(tag);if(text)n.textContent=text;return n;};
 const box=el('dialog'),f=el('form'),label=el('label','Mot de passe du magasin'),input=el('input'),note=el('p'),row=el('div'),ok=el('button','Entrer'),cancel=el('button','Annuler');
 box.className='shared-access-dialog';box.setAttribute('aria-label','Accès logistique');
 box.style.cssText='max-width:420px;width:calc(100% - 32px);padding:24px;border:1px solid #c9ced6;border-radius:12px;font:inherit';
 input.type='password';input.autocomplete='current-password';input.required=true;input.maxLength=200;input.style.cssText='display:block;width:100%;margin-top:8px;padding:12px;font:inherit;box-sizing:border-box';
 note.setAttribute('role','alert');note.style.cssText='min-height:1.4em;margin:10px 0';row.style.cssText='display:flex;gap:12px;justify-content:flex-end';
 ok.type='submit';ok.className='primary';cancel.type='button';cancel.className='secondary';label.append(input);row.append(cancel,ok);
 f.append(el('h2','Accès logistique'),el('p','Le même mot de passe pour toute l’équipe. Il est vérifié par le serveur et n’est pas conservé sur cet appareil.'),label,note,row);box.append(f);
 const close=()=>{try{box.close?.();}catch{}box.remove();};
 cancel.onclick=()=>{close();reject(Object.assign(Error('Mot de passe requis pour l’accès logistique.'),{code:'CANCELLED'}));};
 box.addEventListener('cancel',e=>{e.preventDefault();cancel.onclick();});
 f.onsubmit=async e=>{e.preventDefault();if(ok.disabled)return;ok.disabled=true;note.textContent='Vérification…';
  try{await open(input.value);input.value='';close();resolve();}
  catch(error){input.value='';note.textContent=error.message;ok.disabled=false;input.focus();}};
 (d.body||d.documentElement).append(box);if(box.showModal)box.showModal();else box.setAttribute('open','');input.focus();
});}
/* Resolves once a session exists; asks for the password when there is none. */
function enter(){if(active())return Promise.resolve();if(!asking)asking=form().finally(()=>{asking=null;});return asking;}
async function call(name,args={}){
 if(!/^shared_[a-z_]+$/.test(name)||/^shared_access_/.test(name))throw Error('Fonction non autorisée.');
 for(let attempt=0;;attempt++){
  await enter();
  const session=saved();
  // A session that is already over is never sent: ask once more instead.
  if(!session){if(attempt===0)continue;throw fail({code:'PT401'});}
  const {data,error}=await db().rpc(name,{...args,session_token:session.token});
  if(!error)return data;
  // Session expired or ended elsewhere: ask again once, then repeat the same call.
  if(error.code==='PT401'&&attempt===0){forget();continue;}
  throw fail(error);
 }
}
async function one(name,args){const data=await call(name,args);return Array.isArray(data)?data[0]??null:data;}
function message(error){
 if(error?.code==='PT401')return 'Session terminée : saisissez de nouveau le mot de passe.';
 if(error?.code==='PT429')return 'Trop de tentatives. Réessayez dans quelques minutes.';
 if(error?.code==='42501')return 'L’accès logistique partagé est fermé pour le moment.';
 if(error?.code==='PT409')return 'Ce document a changé ailleurs. Actualisez avant de recommencer.';
 if(error?.code==='22023')return 'Données refusées par le serveur : vérifiez la saisie.';
 if(error?.code==='23505')return 'Cette fiche existe déjà.';
 return 'Opération non confirmée : vérifiez la connexion puis réessayez.';
}
/* Former per-account data on this device: offered once, never deleted. */
function adoptLocal(storage,prefix,target,ask){
 if(storage.getItem(target)!==null)return null;
 const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&key.startsWith(prefix)&&/^[0-9a-f-]{36}$/i.test(key.slice(prefix.length)))keys.push(key);}
 for(const key of keys.sort()){const value=storage.getItem(key);if(value&&ask(key)){storage.setItem(target,value);return key;}}
 return null;
}
const api={ACTOR,client:db,call,one,message,adoptLocal,enter,open,leave,active};
root.SharedAccess=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
