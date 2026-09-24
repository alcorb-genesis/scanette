/* Navigation only: database RLS and RPCs remain the authority. */
(()=>{'use strict';
const shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
const routes=Object.freeze({tracking:'delivery-tracking.html',receipts:'logistics-sessions.html?embedded=1&kind=receipt',inventory:'inventory/index.html',departures:'store-partners.html?embedded=1',team:'team.html?embedded=1',settings:'store-settings.html?embedded=1',scan:'index.html?embedded=1',catalogue:'bellecave.html?embedded=1'});
const labels={tracking:'Où est ma pièce ?',receipts:'Réception',inventory:'Inventaire',departures:'Départs',team:'Équipe',settings:'Paramétrage',scan:'Scanette',catalogue:'Catalogue'};
const $=id=>document.getElementById(id);let client,actor=null,access=false,generation=0,current='home',moduleDirty=false;
let trackingFrame=null,activeFrame=null;
function stopTracking(){try{return trackingFrame?.contentWindow?.stopDeliverySharing?.();}catch{return Promise.resolve();}}
function clear(){stopTracking();trackingFrame=null;activeFrame=null;$('gpsBanner').hidden=true;$('workspace').dataset.focus='';moduleDirty=false;generation++;actor=null;access=false;current='home';$('module').replaceChildren();$('workspace').hidden=true;$('identity').textContent='';$('sectionNotice').hidden=true;$('backHome').hidden=true;}
function section(name,receiptId=null){if(!access)return;if(name!=='home'&&!Object.hasOwn(routes,name))name='home';if(current===name&&activeFrame&&!receiptId)return;
 if(current!==name&&moduleDirty&&!confirm('Quitter cette section sans enregistrer les modifications ?'))return;moduleDirty=false;
 current=name;$('workspace').dataset.focus=['scan','inventory'].includes(name)?name:'';for(const frame of [...$('module').children]){if(frame!==trackingFrame)frame.remove();else frame.hidden=name!=='tracking';}activeFrame=null;$('home').hidden=name!=='home';
 $('sectionNotice').hidden=true;
 $('sections').hidden=name!=='home'; $('backHome').hidden=name==='home';
 document.querySelectorAll('#sections [data-section]').forEach(b=>{if(b.dataset.section===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if(name==='tracking'&&trackingFrame){activeFrame=trackingFrame;}
 else if(name!=='home'){const frame=document.createElement('iframe');frame.title=labels[name];frame.src=routes[name]+(['receipts','scan'].includes(name)&&/^[0-9a-f-]{36}$/i.test(receiptId||'')?'&receipt='+encodeURIComponent(receiptId):'');frame.allow='camera; geolocation';$('module').append(frame);activeFrame=frame;if(name==='tracking'){trackingFrame=frame;frame.onload=()=>frame.contentWindow.postMessage({type:'alcorb-tracking-view',visible:current==='tracking'},location.origin);}}
 trackingFrame?.contentWindow.postMessage({type:'alcorb-tracking-view',visible:name==='tracking'},location.origin);
 history.replaceState(null,'','#'+name);
}
async function enter(session){const id=session?.user?.id||null;if(id!==actor){clear();actor=id;}$('login').hidden=!!id;$('logout').hidden=!id;if(!id){$('status').textContent='';return;}
 const ticket=++generation;try{const result=await client.from('scanette_members').select('role').eq('workspace_id',shop).eq('user_id',id).maybeSingle();if(ticket!==generation)return;
 if(result.error)throw Error('Impossible de vérifier les accès. Réessayez en vous reconnectant.');
 if(!result.data||!['reader','operator','admin'].includes(result.data.role))throw Error('Ce compte ne dispose pas encore d’un accès au magasin. L’administrateur de l’application doit lui attribuer un rôle.');
 access=true;$('status').textContent='';$('workspace').hidden=false;$('identity').textContent=(session.user.email||'Compte personnel')+' · Bellecave · '+({reader:'Lecture',operator:'Opérateur',admin:'Administrateur de l’application'}[result.data.role]);
 section(location.hash.slice(1)||'home',new URLSearchParams(location.search).get('receipt'));
 }catch(error){if(ticket!==generation)return;clear();actor=id;$('status').textContent=error.message;}}
 document.addEventListener('click',e=>{const button=e.target.closest('[data-section]');if(button)section(button.dataset.section);});
 window.addEventListener('message',e=>{if(e.origin!==location.origin)return;if(trackingFrame&&e.source===trackingFrame.contentWindow&&e.data?.type==='alcorb-gps-state'){$('gpsBanner').hidden=e.data.active!==true;$('gpsName').textContent=String(e.data.name||'Livreur').slice(0,80);return;}const frame=activeFrame;if(!frame||e.source!==frame.contentWindow)return;if(e.data?.type==='alcorb-dirty'){moduleDirty=e.data.dirty===true;return;}if(e.data?.type==='alcorb-section')section(e.data.section,e.data.receiptId);});
 window.addEventListener('hashchange',()=>section(location.hash.slice(1)));
 $('loginForm').onsubmit=async e=>{e.preventDefault();if(!client)return;$('connect').disabled=true;try{const r=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(r.error)throw r.error;await enter(r.data.session);}catch{clear();$('login').hidden=false;$('status').textContent='Connexion impossible. Vérifiez vos identifiants et votre connexion.';}finally{$('password').value='';$('connect').disabled=false;}};
 $('gpsStop').onclick=()=>stopTracking();
 $('logout').onclick=async()=>{$('logout').disabled=true;let timer;try{await Promise.race([Promise.resolve(stopTracking()),new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);clear();const r=await client.auth.signOut({scope:'local'});if(r.error)throw r.error;$('login').hidden=false;$('logout').hidden=true;$('status').textContent='Vous êtes déconnecté de cet appareil.';}catch{$('status').textContent='Déconnexion non confirmée. Réessayez ; les sections restent fermées.';}finally{clearTimeout(timer);$('logout').disabled=false;}};
 try{client=supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');window.AlcorbAuth=client;client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>enter(session),0));client.auth.getSession().then(r=>enter(r.data.session)).catch(()=>{$('status').textContent='Session indisponible. Reconnectez-vous.';});}catch{$('connect').disabled=true;$('status').textContent='Le service de connexion est indisponible. Rechargez la page lorsque la connexion est rétablie.';}
})();
