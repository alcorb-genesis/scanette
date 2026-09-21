(function(){
'use strict';
const $=id=>document.getElementById(id);
let tracker=new SweepTracker(),stream=null,worker=null,workerReject=null,running=false,revision=0,timer=null;
let recent=[],undo=null,cache=new Map(),releaseCameraControls=null;
const frameCanvas=document.createElement('canvas');
const button=document.createElement('button');button.id='sweepOpen';button.textContent='Balayage vidéo · bêta';button.type='button';button.className='sweep-open';$('scanBtn').insertAdjacentElement('afterend',button);
const mount=document.createElement('div');mount.innerHTML=`<dialog id="sweepDialog" class="warehouse-dialog sweep-dialog"><div class="row"><h2>Balayage vidéo</h2><button id="sweepClose">Fermer</button></div><p id="sweepStatus" role="status">Prêt. Avancez lentement, rangée par rangée.</p><div class="sweep-stage"><video id="sweepVideo" playsinline muted></video><svg id="sweepOverlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"></svg></div><div id="sweepCameraControls" class="camera-controls" hidden></div><div class="sweep-actions"><button id="sweepToggle">Démarrer</button><button id="sweepUndo" disabled>Annuler le dernier ajout</button></div><p>Vert : ajouté · Orange : en lecture. Une boîte qui revient après sa sortie peut être recomptée.</p><h3>Les 4 derniers ajouts</h3><ol id="sweepRecent"></ol><p>Pause conserve ces repères. La caméra s’arrête aussi si vous quittez l’application. Après un déplacement important, vérifiez votre position avant de reprendre.</p></dialog>`;document.body.append(mount);
function history(){const list=$('sweepRecent');list.replaceChildren();for(const item of recent){const li=document.createElement('li');li.textContent=item.reference+' · +1 · '+new Date(item.time).toLocaleTimeString('fr-FR')+(item.description?' — '+item.description:'');list.append(li);}$('sweepUndo').disabled=!undo;}
function stopResources(){releaseCameraControls?.();releaseCameraControls=null;frameCanvas.width=1;frameCanvas.height=1;clearTimeout(timer);timer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('sweepVideo').pause();$('sweepVideo').srcObject=null;if(worker){worker.terminate();worker=null;}if(workerReject){workerReject(Error('Lecture interrompue.'));workerReject=null;}}
function pause(message='En pause. Retrouvez votre position puis reprenez.') {running=false;revision++;tracker.pause(Date.now());stopResources();$('sweepToggle').disabled=false;$('sweepToggle').textContent='Reprendre';$('sweepStatus').textContent=message;}
function reset(){pause('Session fermée.');tracker=new SweepTracker();recent=[];undo=null;cache.clear();history();$('sweepOverlay').replaceChildren();$('sweepDialog').close();}
window.Sweep={reset,pause};
function paint(tracks){const overlay=$('sweepOverlay');overlay.replaceChildren();for(const t of tracks){const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',['topLeft','topRight','bottomRight','bottomLeft'].map(k=>t.position[k].x+','+t.position[k].y).join(' '));const color=t.counted?'#66e2c5':'#ffb454';polygon.setAttribute('stroke',color);polygon.setAttribute('fill',color+'44');polygon.setAttribute('stroke-width','.004');overlay.append(polygon);}}
function decode(image){return new Promise((resolve,reject)=>{const decoder=worker;const timeout=setTimeout(()=>{workerReject=null;reject(Error('Lecture trop lente. Rapprochez le téléphone des étiquettes.'));},12000);workerReject=error=>{clearTimeout(timeout);reject(error);};decoder.onmessage=e=>{clearTimeout(timeout);workerReject=null;e.data.error?reject(Error(e.data.error)):resolve(e.data.results);};decoder.onerror=()=>{clearTimeout(timeout);workerReject=null;reject(Error('Mémoire ou moteur de lecture indisponible.'));};decoder.postMessage({width:image.width,height:image.height,buffer:image.data.buffer},[image.data.buffer]);});}
async function productFor(code){if(cache.has(code))return cache.get(code);let products=await Warehouse.resolve(code);if(!products.length&&aliases[code])products=[{reference:aliases[code]}];cache.set(code,products);return products;}
function add(track,product){
 const before=ScanetteCore.validate(snapshot()).sections,beforeRecent=recent.slice();
 const nextRecent=[{reference:product.reference,description:product.description||'',time:Date.now()},...recent].slice(0,4);
 Warehouse.commit([{product:product.id?product:null,reference:product.reference,code:track.code,qty:1}],{recentScans:nextRecent});
 track.counted=true;recent=nextRecent;
 undo={before,after:JSON.stringify(sections),recent:beforeRecent,user:currentUserId};history();
}
async function frame(token,epoch){
 if(!running||token!==revision)return;
 try{
  const video=$('sweepVideo');if(!video.videoWidth){timer=setTimeout(()=>frame(token,epoch),250);return;}
  const canvas=frameCanvas,scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);const width=canvas.width,height=canvas.height;
  canvas.getContext('2d').drawImage(video,0,0,width,height);const pixels=canvas.getContext('2d').getImageData(0,0,width,height);
  const found=await decode(pixels);if(!running||token!==revision||epoch!==sessionEpoch)return;
  const normalized=found.filter(d=>d.text&&d.isValid!==false).map(d=>({...d,position:Object.fromEntries(Object.entries(d.position).map(([key,p])=>[key,{x:p.x/width,y:p.y/height}]))}));
  const visible=tracker.update(normalized,Date.now());paint(visible);
  for(const track of visible){
   if(track.counted||track.hits<2)continue;
   const products=await productFor(track.code);if(!running||token!==revision||epoch!==sessionEpoch)return;
   if(products.length!==1){
    pause(products.length?'Code ambigu : choisissez la fiche puis reprenez.':'Code '+track.code+' inconnu : aucune pièce ajoutée. Utilisez le scan unitaire pour l’associer.');
    if(products.length){const selected=await Warehouse.choose(products);if(selected&&epoch===sessionEpoch&&$('sweepDialog').open){add(track,selected);paint(visible);}}
    return;
   }
   add(track,products[0]);paint(visible);$('sweepStatus').textContent='Ajouté : '+products[0].reference+' · +1';
  }
  if(running&&token===revision)timer=setTimeout(()=>frame(token,epoch),250);
 }catch(error){if(token===revision)pause('Arrêt : '+error.message+' Les ajouts déjà enregistrés sont conservés.');}
}
async function start(){
 const token=++revision,epoch=sessionEpoch;$('sweepToggle').disabled=true;$('sweepStatus').textContent='Ouverture de la caméra…';
 try{
  const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280,max:1280},height:{ideal:720,max:1280}}});
  if(token!==revision||epoch!==sessionEpoch){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;const video=$('sweepVideo');video.srcObject=stream;await video.play();if(token!==revision)return;
  releaseCameraControls=CameraControls.mount(stream.getVideoTracks()[0],$('sweepCameraControls'));worker=new Worker('palette-worker.js?v=20260917-sweep1');tracker.resume(Date.now());running=true;$('sweepToggle').disabled=false;$('sweepToggle').textContent='Pause';$('sweepStatus').textContent='Balayage actif. Attendez le signal de chaque ajout.';frame(token,epoch);
 }catch(error){if(token===revision)pause('Caméra indisponible. Vérifiez son autorisation puis reprenez.');}
}
button.onclick=()=>{Warehouse.reset();if(scanning)stopScan();stopLiveStream();recent=(scanHistory||[]).slice();$('sweepDialog').showModal();$('sweepStatus').textContent=recent.length?'Vérifiez les derniers ajouts avant de reprendre.':'Prêt. Avancez lentement, rangée par rangée.';if(!recent.length)$('sweepToggle').textContent='Démarrer';history();};
$('sweepToggle').onclick=()=>running?pause():start();
$('sweepClose').onclick=()=>{pause();$('sweepDialog').close();};$('sweepDialog').oncancel=()=>pause();
$('sweepUndo').onclick=()=>{
 pause('En pause pour corriger le dernier ajout.');
 try{if(!undo||undo.user!==currentUserId||JSON.stringify(sections)!==undo.after)throw Error('Le pointage a changé. Corrigez la quantité depuis la liste.');
  const next=ScanetteCore.validate(snapshot());next.sections=undo.before;next.recentScans=undo.recent;ScanetteCore.write(localStorage,currentUserId,next);sections=next.sections;scanHistory=next.recentScans;recent=undo.recent;undo=null;lastAction=null;render();updateCurSection();updateLastScanBar();history();$('sweepStatus').textContent='Dernier ajout annulé. Reprenez depuis la bonne boîte.';
 }catch(error){$('sweepStatus').textContent=error.message;}
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&$('sweepDialog').open)pause('En pause après interruption. Vérifiez les derniers ajouts avant de reprendre.');});
})();
