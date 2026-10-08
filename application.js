/* Navigation only. Data access goes through the shared_* database functions of each module. */
(()=>{'use strict';
const routes=Object.freeze({preparation:'preparation.html',returns:'returns.html?embedded=1',receipts:'logistics-sessions.html?embedded=1&kind=receipt',inventory:'inventory/index.html',departures:'store-partners.html?embedded=1',scan:'index.html?embedded=1',catalogue:'bellecave.html?embedded=1'});
const labels={preparation:'Préparation commande',returns:'Retours et garanties',receipts:'Réception',inventory:'Inventaire',departures:'Départs',scan:'Scanette',catalogue:'Catalogue'};
const $=id=>document.getElementById(id);let access=false,generation=0,current='home',moduleDirty=false;
let activeFrame=null,started=false,hintTimer=null;
/* Back button: one entry per screen and per open layer, exit boundary at the root.
   Without the controller (older test harness) the previous behaviour is kept. */
const nav=typeof AlcorbNavHistory!=='undefined'&&typeof history.pushState==='function'?AlcorbNavHistory.createNavHistory({
 history,
 render:(name,receiptId)=>show(name,receiptId),
 current:()=>current,
 canLeave:()=>!moduleDirty||confirm('Quitter cette section sans enregistrer les modifications ?'),
 closeLayer:entry=>{
  if(entry.owner==='shell')return;
  activeFrame?.contentWindow?.postMessage({type:'alcorb-back',id:entry.id},location.origin);
 },
 toast:()=>{const hint=$('backHint');if(!hint)return;hint.hidden=false;clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hint.hidden=true;},4000);}
}):null;
function addReturnsTile(){const host=document.querySelector?.('#home .tiles');if(!host||host.querySelector?.('[data-section="returns"]'))return;const button=document.createElement('button');button.dataset.section='returns';button.innerHTML='<svg class="task-drawing" viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="10" width="40" height="44" rx="4"/><path d="M20 22h24M20 30h12M22 42l7 7 15-16"/></svg><strong>Retours et garanties</strong><span>À enlever, contrôler, renvoyer et suivre l’avoir</span>';host.prepend(button);}
addReturnsTile();
function showEntry(){$('entry').hidden=false;$('status').textContent='';}
function clear(){if(started){started=false;nav?.reset('home');}activeFrame=null;$('workspace').dataset.focus='';moduleDirty=false;generation++;access=false;current='home';$('module').replaceChildren();$('workspace').hidden=true;$('identity').textContent='';$('sectionNotice').hidden=true;$('backHome').hidden=true;showEntry();}
const isRoute=name=>name==='home'||Object.hasOwn(routes,name);
/* A user request to change section: confirmation, history entry, then display. */
function section(name,receiptId=null){if(!access)return;if(!isRoute(name))name='home';if(current===name&&(activeFrame||name==='home')&&!receiptId)return;
 if(current!==name&&moduleDirty&&!confirm('Quitter cette section sans enregistrer les modifications ?'))return;moduleDirty=false;
 if(nav){if(name==='home')nav.goHome();else nav.openScreen(name,/^[0-9a-f-]{36}$/i.test(receiptId||'')?{receiptId}:{});}
 show(name,receiptId);
}
/* Display only: used by user requests and by the Back/Forward buttons. */
function show(name,receiptId=null){if(!isRoute(name))name='home';moduleDirty=false;
 const hint=$('backHint');if(hint&&name!=='home')hint.hidden=true;
 current=name;$('workspace').dataset.focus=['scan','inventory'].includes(name)?name:'';$('module').replaceChildren();activeFrame=null;$('home').hidden=name!=='home';
 $('sectionNotice').hidden=true;
 $('backHome').hidden=name==='home';
 if(name!=='home'){const frame=document.createElement('iframe');frame.title=labels[name];frame.src=routes[name]+(['receipts','scan'].includes(name)&&/^[0-9a-f-]{36}$/i.test(receiptId||'')?'&receipt='+encodeURIComponent(receiptId):'');frame.allow='camera';$('module').append(frame);activeFrame=frame;}
 if(!nav)history.replaceState(null,'','#'+name);
}
/* Shared access: one shop password, checked by the server (shared-access.js). The workspace opens
   only once a session exists; a section link asks for the password first. */
let entering=false;
async function enterLogistics(first='home',receiptId=null){
 if(access||entering)return;entering=true;
 try{await SharedAccess.enter();openWorkspace(first,receiptId);}
 catch(error){$('status').textContent=error.code==='CANCELLED'?'':error.message;}
 finally{entering=false;}
}
function openWorkspace(first='home',receiptId=null){
 if(access)return;
 access=true;$('entry').hidden=true;$('status').textContent='';$('workspace').hidden=false;$('leave').hidden=false;
 $('identity').textContent='Accès logistique partagé · Bellecave';
 if(!nav){section(first,receiptId);return;}
 if(!started){started=true;nav.start(first);show(first,receiptId);}
}
function leaveWorkspace(){
 if(moduleDirty&&!confirm('Quitter cette section sans enregistrer les modifications ?'))return;
 clear();$('leave').hidden=true;
 // « Changer d’accès » ends the session on the server as well.
 SharedAccess.leave();
}
 document.addEventListener('click',e=>{const button=e.target.closest('[data-section]');if(button)section(button.dataset.section);});
 window.addEventListener('message',e=>{if(e.origin!==location.origin)return;const frame=activeFrame;if(!frame||e.source!==frame.contentWindow)return;if(e.data?.type==='alcorb-dirty'){moduleDirty=e.data.dirty===true;return;}if(e.data?.type==='alcorb-activated'){nav?.activate();return;}if(e.data?.type==='alcorb-layer'&&typeof e.data.id==='string'&&/^[\w-]{1,64}$/.test(e.data.id)){if(e.data.action==='open')nav?.layerOpened(e.data.id,'module');else if(e.data.action==='closed')nav?.layerClosed(e.data.id);return;}if(e.data?.type==='alcorb-section')section(e.data.section,e.data.receiptId);});
 window.addEventListener('hashchange',()=>{const name=location.hash.slice(1);
  if(!access){if(isRoute(name)&&name!=='home')enterLogistics(name);return;}
  if(!nav){section(name);return;}
  // Only route names are handled; other fragments (« Aller au contenu ») stay ordinary links.
  if(!isRoute(name)||name===current)return;
  if(moduleDirty&&!confirm('Quitter cette section sans enregistrer les modifications ?')){history.back();return;}
  if(nav.onHashChange(name,true))show(name);});
 window.addEventListener('popstate',e=>{if(access)nav?.onPopState(e.state);});
 // The first user action allows the browser to keep our entries (Chrome skips entries added without one).
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(access)nav?.activate();},true);
 $('openLogistics').onclick=()=>enterLogistics('home');$('leave').onclick=leaveWorkspace;
 // A link to a section (bookmark, « Ouvrir Réception ») opens the workspace after the password.
 {const hash=location.hash.slice(1);if(isRoute(hash)&&hash!=='home')enterLogistics(hash,new URLSearchParams(location.search).get('receipt'));}
})();
