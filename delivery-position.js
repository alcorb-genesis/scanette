(()=>{'use strict';
const $=id=>document.getElementById(id),shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
let db,actor=null,epoch=0,lease=null,watch=null,sequence=0,lastSent=0,queue=Promise.resolve(),rows=[],receivedAt=0,loading=false;
const markers=[];
const status=t=>{$('sharingStatus').textContent=t;};
function enqueue(args){const queuedAt=Date.now();const call=queue.catch(()=>{}).then(async()=>{if(args.operation==='position'&&Date.now()-queuedAt>20000)throw Error('Position expired in queue');const r=await db.rpc('delivery_position_write',{shop,...args});if(r.error)throw r.error;});queue=call;return call;}
function clearWatch(){if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;}
function controls(){ $('startSharing').hidden=!!lease;$('stopSharing').hidden=!lease;$('driverName').disabled=!!lease; }
async function stop(message='Partage arrêté.'){
 const token=lease;lease=null;clearWatch();controls();$('startSharing').disabled=true;
 if(!token)return;
 status('Arrêt du partage en cours…');
 try{await enqueue({token,operation:'stop'});status(message);}
 catch{status('GPS arrêté sur ce téléphone. Arrêt serveur non confirmé : la dernière position disparaîtra du suivi sous 90 secondes.');}
 finally{$('startSharing').disabled=!actor;refresh();}
}
function paint(){
 markers.splice(0).forEach(m=>m.remove());$('vehicleList').replaceChildren();
 const elapsed=(Date.now()-receivedAt)/1000,fresh=rows.filter(r=>r.age_seconds+elapsed<90);
 $('vehicleCount').textContent=fresh.length?fresh.length+' véhicule(s) · positions récentes':'○ Aucune position récente';
 for(const r of fresh){
  const age=Math.max(0,Math.floor(r.age_seconds+elapsed)),b=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('small');
  name.textContent=r.label;detail.textContent='À '+new Date(r.updated_at).toLocaleTimeString('fr-FR')+' · précision ± '+Math.round(r.accuracy)+' m';b.append(name,detail);
  if(window.deliveryMap){const popup=document.createElement('span');popup.textContent=r.label+' · '+detail.textContent;
   markers.push(L.circle([r.latitude,r.longitude],{radius:Math.max(5,r.accuracy),color:'#198f83',weight:2,fillOpacity:.12}).addTo(deliveryMap));
   markers.push(L.circleMarker([r.latitude,r.longitude],{radius:10,color:'#fff',weight:3,fillColor:'#087e70',fillOpacity:1}).addTo(deliveryMap).bindPopup(popup));
   b.onclick=()=>deliveryMap.setView([r.latitude,r.longitude],15);
  }else b.disabled=true;
  $('vehicleList').append(b);
 }
}
async function refresh(){
 if(!actor||loading||document.hidden)return;loading=true;const requestEpoch=epoch;
 try{const r=await db.rpc('delivery_positions_current',{shop});if(requestEpoch!==epoch)return;if(r.error)throw r.error;rows=r.data||[];receivedAt=Date.now();paint();$('viewerStatus').textContent=rows.length?'Positions partagées volontairement · actualisation toutes les 15 secondes.':'Aucun livreur ne partage actuellement de position récente.';}
 catch{if(requestEpoch===epoch){rows=[];paint();$('viewerStatus').textContent='Suivi indisponible. Vérifiez la connexion et votre accès au magasin.';}}
 finally{loading=false;}
}
$('startSharing').onclick=async()=>{
 const driver=$('driverName').value.trim();if(!driver){status('Renseignez votre nom pour que vos collègues vous reconnaissent.');$('driverName').focus();return;}
 if(!actor||lease||document.hidden)return;
 if(!navigator.geolocation||!window.isSecureContext){status('La localisation nécessite un navigateur compatible et une connexion HTTPS.');return;}
 const token=crypto.randomUUID(),requestEpoch=epoch;lease=token;sequence=0;lastSent=0;controls();status('Activation du partage…');
 try{await enqueue({token,operation:'begin',driver});if(lease!==token||requestEpoch!==epoch)return;
  status('Autorisez la localisation. En attente du premier signal GPS…');
  watch=navigator.geolocation.watchPosition(p=>{
   if(lease!==token||requestEpoch!==epoch||document.hidden)return;
   if(Date.now()-p.timestamp>20000){status('Signal GPS trop ancien. En attente d’une position récente…');return;}
   if(lastSent&&Date.now()-lastSent<10000)return;lastSent=Date.now();
   enqueue({token,operation:'position',lat:p.coords.latitude,lon:p.coords.longitude,precision_m:p.coords.accuracy,seq:++sequence}).then(()=>{
    if(lease===token){status('● Position partagée · '+new Date().toLocaleTimeString('fr-FR')+' · précision ± '+Math.round(p.coords.accuracy)+' m');refresh();}
   }).catch(e=>{if(lease===token){if(e.code==='40001'||e.code==='42501')stop('Partage interrompu : session remplacée ou accès retiré.');else status('Envoi impossible. GPS actif, nouvelle tentative au prochain signal. Les collègues ne reçoivent pas cette position.');}});
  },e=>{if(lease!==token)return;if(e.code===1)stop('Localisation refusée. Aucun partage actif.');else status('Signal GPS indisponible. Restez sur cette page ; nouvelle tentative automatique.');},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 }catch{if(lease===token)await stop('Activation impossible. Réessayez après avoir vérifié votre connexion.');}
};
$('stopSharing').onclick=()=>stop();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&lease)stop('Partage arrêté quand la page a été masquée. Réactivez-le pour continuer.');else if(!document.hidden)refresh();});
window.addEventListener('pagehide',()=>{if(lease)stop();});
window.addEventListener('offline',()=>{rows=[];paint();$('viewerStatus').textContent='Hors connexion : aucune position en direct disponible.';});
window.addEventListener('online',refresh);
async function enter(session){
 const id=session?.user?.id||null;if(id===actor&&id)return;epoch++;lease=null;clearWatch();actor=null;rows=[];paint();controls();$('startSharing').disabled=true;
 if(!id){status('Connectez-vous à l’application pour partager votre position.');$('viewerStatus').textContent='Le suivi des livreurs est réservé aux personnes connectées au magasin.';return;}
 const requestEpoch=epoch;
 try{const r=await db.from('scanette_members').select('role').eq('workspace_id',shop).eq('user_id',id).maybeSingle();if(requestEpoch!==epoch)return;if(r.error||!r.data)throw Error();const ready=await db.rpc('delivery_positions_current',{shop});if(requestEpoch!==epoch)return;if(ready.error){status('Partage GPS préparé : activation du service serveur en attente.');$('viewerStatus').textContent='Le suivi privé n’est pas encore disponible.';return;}actor=id;$('startSharing').disabled=false;status('Partage désactivé. Vous seul choisissez quand l’activer.');refresh();}
 catch{status('Votre accès au magasin ne permet pas d’activer le partage.');}
}
try{db=window.parent!==window&&window.parent.AlcorbAuth||supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>enter(s),0));db.auth.getSession().then(r=>enter(r.data.session));}
catch{status('Connexion indisponible. Rechargez la page.');$('viewerStatus').textContent='Suivi indisponible.';}
setInterval(refresh,15000);setInterval(()=>{const fresh=rows.filter(r=>r.age_seconds+(Date.now()-receivedAt)/1000<90);if(fresh.length!==rows.length){rows=fresh;paint();}},1000);
})();
