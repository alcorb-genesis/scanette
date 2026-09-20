/* Navigation only: database RLS and RPCs remain the authority. */
(()=>{'use strict';
const shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
const routes=Object.freeze({team:'team.html?embedded=1',settings:'store-settings.html?embedded=1',sale:'gestion-demo.html?embedded=1&section=sale',restock:'gestion-demo.html?embedded=1&section=restock',dispatch:'gestion-demo.html?embedded=1&section=dispatch',accounting:'gestion-demo.html?embedded=1&section=accounting',stats:'gestion-demo.html?embedded=1&section=storestats',scan:'index.html?embedded=1',receipts:'gestion.html?embedded=1',catalogue:'bellecave.html?embedded=1',demo:'gestion-demo.html?embedded=1'});
const labels={team:'Équipe du magasin',settings:'Mon magasin',sale:'Comptoir · démo',restock:'Réapprovisionnement · démo',dispatch:'Départs · démo',accounting:'Comptabilité · démo',stats:'Statistiques · démo',scan:'Pointage',receipts:'Réceptions et stock',catalogue:'Catalogue',demo:'Gestion · démonstration'};
const $=id=>document.getElementById(id);let client,actor=null,access=false,generation=0,current='home',moduleDirty=false;
function clear(){moduleDirty=false;generation++;actor=null;access=false;current='home';$('module').replaceChildren();$('workspace').hidden=true;$('identity').textContent='';$('sectionNotice').hidden=true;}
function section(name){if(!access)return;if(name!=='home'&&!Object.hasOwn(routes,name))name='home';if(current===name&&$('module').firstChild)return;
 if(current!==name&&moduleDirty&&!confirm('Quitter cette section sans enregistrer les modifications ?'))return;moduleDirty=false;
 current=name;$('module').replaceChildren();$('home').hidden=name!=='home';
 $('sectionNotice').hidden=!['demo','sale','restock','dispatch','accounting','stats'].includes(name);$('sectionNotice').textContent='Démonstration : les ventes, la comptabilité et les profils ci-dessous sont simulés. Ils ne modifient pas les données réelles du magasin.';
 document.querySelectorAll('#sections [data-section]').forEach(b=>{if(b.dataset.section===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if(name!=='home'){const frame=document.createElement('iframe');frame.title=labels[name];frame.src=routes[name];frame.allow='camera';$('module').append(frame);}
 history.replaceState(null,'','#'+name);
}
async function enter(session){const id=session?.user?.id||null;if(id!==actor){clear();actor=id;}$('login').hidden=!!id;$('logout').hidden=!id;if(!id){$('status').textContent='';return;}
 const ticket=++generation;try{const result=await client.from('scanette_members').select('role').eq('workspace_id',shop).eq('user_id',id).maybeSingle();if(ticket!==generation)return;
 if(result.error)throw Error('Impossible de vérifier les accès. Réessayez en vous reconnectant.');
 if(!result.data||!['reader','operator','admin'].includes(result.data.role))throw Error('Ce compte ne dispose pas encore d’un accès au magasin. Le responsable doit lui attribuer un rôle.');
 access=true;$('status').textContent='';$('workspace').hidden=false;$('identity').textContent=(session.user.email||'Compte personnel')+' · Bellecave · '+({reader:'Lecture',operator:'Opérateur',admin:'Administrateur'}[result.data.role]);
 section(location.hash.slice(1)||'home');
 }catch(error){if(ticket!==generation)return;clear();actor=id;$('status').textContent=error.message;}}
 document.addEventListener('click',e=>{const button=e.target.closest('[data-section]');if(button)section(button.dataset.section);});
 window.addEventListener('message',e=>{const frame=$('module').firstChild;if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow )return;if(e.data?.type==='alcorb-dirty'){moduleDirty=e.data.dirty===true;return;}if(e.data?.type==='alcorb-section')section(e.data.section);});
 window.addEventListener('hashchange',()=>section(location.hash.slice(1)));
 $('loginForm').onsubmit=async e=>{e.preventDefault();if(!client)return;$('connect').disabled=true;try{const r=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(r.error)throw r.error;await enter(r.data.session);}catch{clear();$('login').hidden=false;$('status').textContent='Connexion impossible. Vérifiez vos identifiants et votre connexion.';}finally{$('password').value='';$('connect').disabled=false;}};
 $('logout').onclick=async()=>{clear();$('logout').disabled=true;try{const r=await client.auth.signOut({scope:'local'});if(r.error)throw r.error;$('login').hidden=false;$('logout').hidden=true;$('status').textContent='Vous êtes déconnecté de cet appareil.';}catch{$('status').textContent='Déconnexion non confirmée. Réessayez ; les sections restent fermées.';}finally{$('logout').disabled=false;}};
 try{client=supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>enter(session),0));client.auth.getSession().then(r=>enter(r.data.session)).catch(()=>{$('status').textContent='Session indisponible. Reconnectez-vous.';});}catch{$('connect').disabled=true;$('status').textContent='Le service de connexion est indisponible. Rechargez la page lorsque la connexion est rétablie.';}
})();
