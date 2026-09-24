(()=>{'use strict';
const $=id=>document.getElementById(id),shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
let db,actor=null,epoch=0,lease=null,watch=null,sequence=0,lastSent=0,queue=Promise.resolve(),rows=[],receivedAt=0,loading=false;
const markers=[],driverNumbers=new Map();let viewVisible=true,selectedDriver='',selectedLabel='';
const nameKey=id=>'alcorb-driver-name:'+shop+':'+id;
function rememberName(value){try{localStorage.setItem(nameKey(actor),value);}catch{}}
function restoreName(id){try{return localStorage.getItem(nameKey(id))||'';}catch{return '';}}
function notifyParent(){if(window.parent!==window)window.parent.postMessage({type:'alcorb-gps-state',active:!!lease,name:$('driverName').value},location.origin);}
function recent(){const elapsed=(Date.now()-receivedAt)/1000;return rows.filter(r=>r.age_seconds+elapsed<90);}
function chooseDriver(){const r=recent().find(r=>r.user_id===selectedDriver);if(r&&window.deliveryMap)deliveryMap.setView([r.latitude,r.longitude],17);}
$('driverSelect').onchange=()=>{selectedDriver=$('driverSelect').value;selectedLabel=recent().find(r=>r.user_id===selectedDriver)?.label||'';chooseDriver();paint();};
$('driverName').onchange=()=>{if(actor)rememberName($('driverName').value.trim());};
function driverNumber(r){const key=r.user_id||r.label;if(!driverNumbers.has(key))driverNumbers.set(key,driverNumbers.size+1);return driverNumbers.get(key);}
const status=t=>{$('sharingStatus').textContent=t;};
function unavailable(label,message){$('startSharing').disabled=true;$('startSharing').textContent=label;status(message);}
function enqueue(args){const queuedAt=Date.now();const call=queue.catch(()=>{}).then(async()=>{if(args.operation==='position'&&Date.now()-queuedAt>20000)throw Error('Position expired in queue');const r=await db.rpc('delivery_position_write',{shop,...args});if(r.error)throw r.error;});queue=call;return call;}
function clearWatch(){if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;}
function controls(){ $('startSharing').hidden=!!lease;$('stopSharing').hidden=!lease;$('driverName').disabled=!!lease;notifyParent(); }
async function stop(message='Partage arrêté.'){
 const token=lease;lease=null;clearWatch();controls();$('startSharing').disabled=true;
 if(!token){$('startSharing').disabled=!actor;return;}
 status('Arrêt du partage en cours…');
 try{await enqueue({token,operation:'stop'});status(message);}
 catch{status('GPS arrêté sur ce téléphone. Arrêt serveur non confirmé : la dernière position disparaîtra du suivi sous 90 secondes.');}
 finally{$('startSharing').disabled=!actor;refresh();}
}
function paint(){
 markers.splice(0).forEach(m=>m.remove());$('vehicleList').replaceChildren();
 const elapsed=(Date.now()-receivedAt)/1000,fresh=recent();
 const select=$('driverSelect');select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='Tous les livreurs ('+fresh.length+')';select.append(all);for(const r of fresh){const option=document.createElement('option');option.value=r.user_id;option.textContent='#'+driverNumber(r)+' · '+r.label;select.append(option);}
 const chosen=fresh.find(r=>r.user_id===selectedDriver);if(selectedDriver&&!chosen){const absent=document.createElement('option');absent.value=selectedDriver;absent.textContent=selectedLabel+' — position indisponible';absent.disabled=true;select.append(absent);}select.value=selectedDriver;
 $('driverSelectionStatus').textContent=selectedDriver?(chosen?'Livreur sélectionné : '+chosen.label+'. Position récente.':'La position de '+selectedLabel+' n’est plus disponible. Choisissez un autre livreur ou attendez son prochain partage.'):'Choisissez un livreur pour centrer la carte sur sa position.';
 $('vehicleCount').textContent=fresh.length?fresh.length+' véhicule(s) · positions récentes':'○ Aucune position récente';
 for(const r of fresh){
  const age=Math.max(0,Math.floor(r.age_seconds+elapsed)),b=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('small');
  const number=driverNumber(r),color=['#087e70','#2859c5','#823fb0','#a63a30'][(number-1)%4];name.textContent='#'+number+' · '+r.label;detail.textContent='À '+new Date(r.updated_at).toLocaleTimeString('fr-FR')+' · précision ± '+Math.round(r.accuracy)+' m';b.append(name,detail);
  if(window.deliveryMap){const popup=document.createElement('span');popup.textContent=name.textContent+' · '+detail.textContent;const label=document.createElement('strong');label.textContent=name.textContent;
   markers.push(L.circle([r.latitude,r.longitude],{radius:Math.max(5,r.accuracy),color,weight:2,fillOpacity:.12}).addTo(deliveryMap));
   const marker=L.circleMarker([r.latitude,r.longitude],{radius:10,color:'#fff',weight:3,fillColor:color,fillOpacity:1}).addTo(deliveryMap).bindPopup(popup).bindTooltip(label,{permanent:true,direction:number%2?'right':'left',offset:[number%2?12:-12,((number-1)%3-1)*25],className:'driver-label'});markers.push(marker);
   b.onclick=()=>{deliveryMap.setView([r.latitude,r.longitude],17);marker.bringToFront();marker.openPopup();};
  }else b.disabled=true;
  $('vehicleList').append(b);
 }
}
async function refresh(){
 if(!actor||loading||document.hidden||!viewVisible)return;loading=true;const requestEpoch=epoch;
 try{const r=await db.rpc('delivery_positions_current',{shop});if(requestEpoch!==epoch)return;if(r.error)throw r.error;rows=r.data||[];receivedAt=Date.now();paint();$('viewerStatus').textContent=rows.length?'Positions partagées volontairement · actualisation toutes les 5 secondes.':'Aucun livreur ne partage actuellement de position récente.';}
 catch{if(requestEpoch===epoch){rows=[];paint();$('viewerStatus').textContent='Suivi indisponible. Vérifiez la connexion et votre accès au magasin.';}}
 finally{loading=false;}
}
$('startSharing').onclick=async()=>{
 const driver=$('driverName').value.trim();if(!driver){status('Renseignez votre nom pour que vos collègues vous reconnaissent.');$('driverName').focus();return;}
 if(!actor||lease||document.hidden)return;
 if(!navigator.geolocation||!window.isSecureContext){status('La localisation nécessite un navigateur compatible et une connexion HTTPS.');return;}
 rememberName(driver);const token=crypto.randomUUID(),requestEpoch=epoch;lease=token;sequence=0;lastSent=0;controls();status('Activation du partage…');
 try{await enqueue({token,operation:'begin',driver});if(lease!==token||requestEpoch!==epoch)return;
  status('Autorisez la localisation. En attente du premier signal GPS…');
  watch=navigator.geolocation.watchPosition(p=>{
   if(lease!==token||requestEpoch!==epoch)return;
   if(Date.now()-p.timestamp>20000){status('Signal GPS trop ancien. En attente d’une position récente…');return;}
   if(lastSent&&Date.now()-lastSent<5000)return;lastSent=Date.now();
   enqueue({token,operation:'position',lat:p.coords.latitude,lon:p.coords.longitude,precision_m:p.coords.accuracy,seq:++sequence}).then(()=>{
    if(lease===token){status('● Position partagée · '+new Date().toLocaleTimeString('fr-FR')+' · précision ± '+Math.round(p.coords.accuracy)+' m');refresh();}
   }).catch(e=>{if(lease===token){if(['PT409','40001'].includes(e.code)||e.code==='42501')stop('Partage interrompu : session remplacée ou accès retiré.');else status('Envoi impossible. GPS actif, nouvelle tentative au prochain signal. Les collègues ne reçoivent pas cette position.');}});
  },e=>{if(lease!==token)return;if(e.code===1)stop('Localisation refusée. Aucun partage actif.');else status('Signal GPS indisponible. Nouvelle tentative au prochain signal fourni par le navigateur.');},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 }catch{if(lease===token)await stop('Activation impossible. Réessayez après avoir vérifié votre connexion.');}
};
$('stopSharing').onclick=()=>stop();window.stopDeliverySharing=()=>stop();
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='alcorb-tracking-view')return;viewVisible=e.data.visible===true;if(viewVisible){window.deliveryMap?.invalidateSize();refresh();}});
// Keep the watch and lease when hidden; the browser may still suspend GPS delivery.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('pagehide',()=>{if(lease)stop();});
window.addEventListener('offline',()=>{rows=[];paint();$('viewerStatus').textContent='Hors connexion : aucune position en direct disponible.';});
window.addEventListener('online',refresh);
async function enter(session){
 const id=session?.user?.id||null;if(id===actor&&id)return;epoch++;lease=null;clearWatch();actor=null;rows=[];selectedDriver='';selectedLabel='';$('driverName').value=id?restoreName(id):'';driverNumbers.clear();paint();controls();$('startSharing').disabled=true;
 if(!id){unavailable('Connexion requise','Connectez-vous à l’application pour partager votre position.');$('viewerStatus').textContent='Le suivi des livreurs est réservé aux personnes connectées au magasin.';return;}
 const requestEpoch=epoch;
 try{const r=await db.from('scanette_members').select('role').eq('workspace_id',shop).eq('user_id',id).maybeSingle();if(requestEpoch!==epoch)return;if(r.error)throw r.error;if(!r.data){unavailable('Accès magasin requis','Votre compte n’a pas accès au suivi de ce magasin.');return;}const ready=await db.rpc('delivery_positions_current',{shop});if(requestEpoch!==epoch)return;if(ready.error){if(ready.error.code==='PGRST202'){unavailable('GPS non activé','Le service GPS n’est pas encore activé pour le magasin. Aucune position ne peut être partagée pour le moment.');$('viewerStatus').textContent='Activation du service GPS nécessaire.';return;}throw ready.error;}actor=id;$('startSharing').textContent='◎ Partager ma position';$('startSharing').disabled=false;status('Partage désactivé. Vous seul choisissez quand l’activer.');refresh();}
 catch{if(requestEpoch!==epoch)return;unavailable('Suivi indisponible','Impossible de vérifier le service GPS. Vérifiez votre connexion, puis rechargez cette page.');$('viewerStatus').textContent='Connexion au suivi non confirmée.';}
}
try{db=window.parent!==window&&window.parent.AlcorbAuth||supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>enter(s),0));db.auth.getSession().then(r=>{if(r.error)throw r.error;return enter(r.data.session);}).catch(()=>unavailable('Connexion indisponible','Impossible de vérifier votre session. Rechargez la page.'));}
catch{unavailable('Connexion indisponible','Connexion indisponible. Rechargez la page.');$('viewerStatus').textContent='Suivi indisponible.';}
setInterval(refresh,5000);setInterval(()=>{const fresh=rows.filter(r=>r.age_seconds+(Date.now()-receivedAt)/1000<90);if(fresh.length!==rows.length){rows=fresh;paint();}},1000);
})();
