/* Bellecave lookup and explicitly reviewed photo batches. Images stay on device. */
(function(){
'use strict';
const workspace='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
let generation=0,chooseCancel=null,rows=[],detections=[],committed=false,busy=false;
let paletteStream=null,cameraRequest=0;
function stopPaletteCamera(){cameraRequest++;if(paletteStream){paletteStream.getTracks().forEach(track=>track.stop());paletteStream=null;}const video=byId('paletteVideo');if(video){video.pause();video.srcObject=null;video.hidden=true;}if(byId('paletteCapture'))byId('paletteCapture').hidden=true;}
const byId=id=>document.getElementById(id);
async function resolve(code){
 if(!currentUserId)throw Error('Reconnectez-vous.');
 if(code.length>256)throw Error('Code trop long.');
 const quoted='"'+code.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
 const filter=encodeURIComponent('(internal_barcode.eq.'+quoted+',manufacturer_barcode.eq.'+quoted+')');
 const response=await authenticatedFetch('/rest/v1/scanette_products?workspace_id=eq.'+workspace+'&select=id,reference,description,internal_barcode,manufacturer_barcode&or='+filter,{},sessionEpoch);
 const products=await response.json();
 if(!Array.isArray(products))throw Error('Réponse catalogue invalide.');
 return products;
}
function commit(entries,options={}){
 if(!currentUserId||!storageReady)throw Error('Enregistrement indisponible.');
 const next=ScanetteCore.validate(snapshot());
 if(options.recentScans)next.recentScans=options.recentScans;
 if(!next.sections.length)next.sections.push({name:'DIVERS',items:Object.create(null)});
 const target=next.sections[next.sections.length-1];
 let last=null;
 for(const entry of entries){
  if(!Number.isSafeInteger(entry.qty)||entry.qty<1||entry.qty>1000000)throw Error('Quantité invalide.');
  const product=entry.product,key=product?'BELLECAVE:'+product.id:normRef(entry.reference);
  if(!key)throw Error('Référence manquante.');
  if(!Object.hasOwn(target.items,key))target.items[key]={qty:0,prix:null};
  const item=target.items[key];item.qty+=entry.qty;
  if(product)Object.assign(item,{productId:product.id,reference:product.reference,description:product.description||'',barcode:entry.code});
  last={si:next.sections.length-1,ref:key,n:entry.qty,ean:entry.code};
 }
 // One durable write for the whole lot; in-memory totals change only after success.
 ScanetteCore.write(localStorage,currentUserId,next);
 scanHistory=next.recentScans;sections=next.sections;aliases=next.aliases;pushQueue=next.pushQueue;lastAction=last;
 render();updateCurSection();updateLastScanBar();beep();
 flash(entries.length===1?'✓ '+(entries[0].product?.reference||entries[0].reference)+' ajouté':'✓ Lot ajouté au pointage');
}
function reset(){
 generation++;releaseDecoder();stopPaletteCamera();chooseCancel?.();chooseCancel=null;
 if(byId('paletteDialog')?.open)byId('paletteDialog').close();
 rows=[];detections=[];committed=false;busy=false;
 if(byId('paletteFile'))byId('paletteFile').disabled=false;
 if(byId('paletteCamera'))byId('paletteCamera').disabled=false;
 if(byId('paletteRows'))byId('paletteRows').replaceChildren();
 if(byId('paletteCanvas')){byId('paletteCanvas').width=1;byId('paletteCanvas').height=1;}
}
function choose(products){
 return new Promise(resolveChoice=>{
  const dialog=byId('productChoice'),list=byId('productChoices');list.replaceChildren();
  const done=product=>{chooseCancel=null;dialog.close();resolveChoice(product);};
  chooseCancel=()=>done(null);
  for(const product of products){const button=document.createElement('button');button.type='button';button.textContent=product.reference+' — '+product.description+' · '+(product.internal_barcode||product.manufacturer_barcode);button.onclick=()=>done(product);list.append(button);}
  byId('cancelProductChoice').onclick=()=>done(null);
  dialog.oncancel=event=>{event.preventDefault();done(null);};dialog.showModal();
 });
}
window.Warehouse={resolve,commit,choose,reset};
// Kept separate from the legacy reference catalogue: private shop data is never uploaded there.
const controls=document.createElement('section');controls.className='warehouse-controls';
controls.innerHTML='<div class="eyebrow">Bellecave connecté au pointage</div><p>Les codes du magasin retrouvent leur fiche automatiquement. Une connexion est nécessaire pour consulter Bellecave.</p><form id="warehouseCodeForm"><label for="warehouseCode">Code-barres · lecteur externe ou saisie</label><div class="row"><input id="warehouseCode" autocomplete="off" maxlength="256" placeholder="Code-barres, puis Entrée"><button id="warehouseCodeAdd" type="submit">Pointer</button></div></form><button id="paletteOpen" type="button">▥ Scanner une palette · photo bêta</button>';
byId('scanBtn').insertAdjacentElement('afterend',controls);
const dialogs=document.createElement('div');dialogs.innerHTML=`
<dialog id="productChoice" class="warehouse-dialog"><h2>Quel produit souhaitez-vous pointer ?</h2><p>Ce code correspond à plusieurs fiches Bellecave. Vérifiez la désignation.</p><div id="productChoices"></div><button id="cancelProductChoice">Annuler</button></dialog>
<dialog id="paletteDialog" class="warehouse-dialog"><div class="row"><h2>Palette · lecture multiple</h2><button id="paletteClose" type="button">Fermer</button></div>
<p>Photographiez plusieurs étiquettes nettes, sans viser un seul code. L’image reste sur cet appareil.</p>
<button id="paletteCamera" type="button">Ouvrir la caméra légère</button><video id="paletteVideo" playsinline muted hidden style="width:100%;max-height:45vh"></video><button id="paletteCapture" type="button" hidden>Capturer et analyser</button><p>Mode conseillé sur téléphone : image limitée pour économiser la mémoire.</p><label class="photo-button" for="paletteFile">Ou choisir une image existante</label><input id="paletteFile" type="file" accept="image/*">
<p id="paletteStatus" role="status" aria-live="polite">Choisissez une photo pour commencer.</p><div class="palette-stage"><canvas id="paletteCanvas" width="1" height="1"></canvas><svg id="paletteOverlay" aria-hidden="true"></svg></div>
<p class="palette-legend">Vert : référence reconnue · Orange : à vérifier ou exclue · Gris : lot ajouté.</p>
<p><strong>Un code détecté n’est pas une boîte comptée.</strong> La quantité proposée est 1 par code distinct. Vérifiez les boîtes identiques et les doubles étiquettes. Deux photos peuvent montrer les mêmes pièces.</p>
<div id="paletteRows"></div><label class="batch-confirm"><input type="checkbox" id="paletteVerified">J’ai vérifié les références, les quantités et les pièces déjà pointées.</label>
<button id="paletteCommit" type="button" disabled>Ajouter le lot au pointage</button></dialog>`;
document.body.append(dialogs);
byId('warehouseCodeForm').addEventListener('submit',async event=>{event.preventDefault();const input=byId('warehouseCode'),code=input.value.trim();if(!code)return;byId('warehouseCodeAdd').disabled=true;try{await onBarcode(code);input.value='';}finally{byId('warehouseCodeAdd').disabled=false;}});
byId('paletteOpen').onclick=()=>{if(scanning)stopScan();stopLiveStream();byId('paletteDialog').showModal();};
function cancelAnalysis(){generation++;releaseDecoder();stopPaletteCamera();if(busy){rows=[];detections=[];byId('paletteRows').replaceChildren();byId('paletteStatus').textContent='Analyse annulée. Choisissez une nouvelle photo.';}busy=false;byId('paletteFile').disabled=false;byId('paletteCamera').disabled=false;update();}
byId('paletteClose').onclick=()=>{cancelAnalysis();byId('paletteDialog').close();byId('paletteCanvas').width=1;byId('paletteCanvas').height=1;rows=[];detections=[];byId('paletteRows').replaceChildren();update();};
byId('paletteDialog').oncancel=()=>byId('paletteClose').onclick();
function update(){
 byId('paletteCommit').disabled=busy||committed||!byId('paletteVerified').checked||!rows.some(row=>row.qty>0&&(row.product||row.reference));
 const overlay=byId('paletteOverlay');overlay.replaceChildren();
 for(const detection of detections){
  const row=rows.find(row=>row.code===detection.text),position=detection.position;
  if(!position)continue;
  const points=['topLeft','topRight','bottomRight','bottomLeft'].map(key=>position[key]);
  if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))continue;
  const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');
  polygon.setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));
  const color=committed&&row?.qty>0&&(row.product||row.reference)?'#9aa6b2':row?.qty>0&&(row.product||row.reference)?'#66e2c5':'#ffb454';
  polygon.setAttribute('fill',color+'55');polygon.setAttribute('stroke',color);polygon.setAttribute('stroke-width','5');overlay.append(polygon);
 }
}
byId('paletteVerified').onchange=update;
function renderRows(){
 const list=byId('paletteRows');list.replaceChildren();
 for(const row of rows){
  const card=document.createElement('div');card.className='palette-row';
  const code=document.createElement('p');code.textContent=row.code+' · '+row.count+' zone(s) détectée(s)';card.append(code);
  const select=document.createElement('select');select.setAttribute('aria-label','Référence pour '+row.code);
  const empty=document.createElement('option');empty.value='';empty.textContent=row.products.length?'Choisir la bonne fiche…':'Code absent des catalogues — exclu';select.append(empty);
  row.products.forEach((p,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=p.reference+' — '+(p.description||'catalogue historique');select.append(option);});
  if(row.products.length===1)select.value='0';
  select.onchange=()=>{const p=select.value===''?null:row.products[Number(select.value)];row.product=p?.id?p:null;row.reference=p&&!p.id?p.reference:null;byId('paletteVerified').checked=false;update();};
  card.append(select);
  const label=document.createElement('label');label.textContent='Quantité à ajouter (0 = exclure)';const qty=document.createElement('input');qty.type='number';qty.min='0';qty.max='1000000';qty.step='1';qty.value=String(row.qty);qty.setAttribute('aria-label','Quantité pour '+row.code);
  qty.oninput=()=>{row.qty=Number(qty.value);byId('paletteVerified').checked=false;update();};label.append(qty);card.append(label);list.append(card);
 }
 update();
}
let activeDecoder=null;
function releaseDecoder(){if(activeDecoder){activeDecoder.cancel();activeDecoder=null;}}
function decodeCanvas(canvas){
 return new Promise((resolve,reject)=>{
  const worker=new Worker('palette-worker.js?v=20260919-photo1');let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();activeDecoder=null;error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('Analyse trop longue. Photographiez une zone plus petite.')),35000);
  activeDecoder={cancel:()=>finish(Error('Analyse annulée.'))};
  worker.onmessage=event=>event.data.error?finish(Error(event.data.error)):finish(null,event.data.results);
  worker.onerror=()=>finish(Error('Mémoire ou moteur de lecture indisponible. Essayez une photo plus petite.'));
  try{const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);worker.postMessage({width:image.width,height:image.height,buffer:image.data.buffer,photo:true},[image.data.buffer]);}
  catch(error){finish(error);}
 });
}
byId('paletteFile').onchange=async event=>{
 const file=event.target.files[0];event.target.value='';if(!file)return;
 stopPaletteCamera();const token=++generation,epoch=sessionEpoch;busy=true;committed=false;rows=[];detections=[];byId('paletteRows').replaceChildren();byId('paletteVerified').checked=false;byId('paletteFile').disabled=true;update();
 const status=byId('paletteStatus');status.textContent='Préparation de la photo · mode mémoire réduite…';
 const oldCanvas=byId('paletteCanvas');oldCanvas.width=1;oldCanvas.height=1;releaseDecoder();
 try{
  if(file.size>25000000)throw Error('Photo trop volumineuse (25 Mo maximum).');
  const bitmap=await createImageBitmap(file,{resizeWidth:1200,resizeQuality:'medium'});
  if(token!==generation){bitmap.close();return;}
  const canvas=byId('paletteCanvas'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  await analyzePalette(canvas,token,epoch);
 }catch(error){if(token===generation){rows=[];detections=[];byId('paletteRows').replaceChildren();byId('paletteCanvas').width=1;byId('paletteCanvas').height=1;status.textContent='Lot non ajouté. '+error.message+' Essayez une photo plus petite ou une zone plus rapprochée. Le pointage existant est conservé.';}}
 finally{if(token===generation){busy=false;byId('paletteFile').disabled=false;byId('paletteCamera').disabled=false;update();}}
};
async function analyzePalette(canvas,token,epoch){
 const status=byId('paletteStatus');
  byId('paletteOverlay').setAttribute('viewBox','0 0 '+canvas.width+' '+canvas.height);
  status.textContent='Lecture des codes puis agrandissement par zones · patientez…';
  const found=await decodeCanvas(canvas);
  if(token!==generation||epoch!==sessionEpoch)return;
  detections=found.filter(x=>x.text&&x.isValid!==false);
  const codes=[...new Set(detections.map(x=>x.text))];
  for(let i=0;i<codes.length;i+=4){
   const portion=await Promise.all(codes.slice(i,i+4).map(async code=>{let products=await resolve(code);if(!products.length&&aliases[code])products=[{reference:aliases[code]}];const p=products.length===1?products[0]:null;return {code,products,product:p?.id?p:null,reference:p&&!p.id?p.reference:null,qty:p?1:0,count:detections.filter(x=>x.text===code).length};}));
   if(token!==generation||epoch!==sessionEpoch)return;rows.push(...portion);
  }
  status.textContent=detections.length?detections.length+' zone(s) lue(s), '+codes.length+' code(s) distinct(s). Vérifiez le lot avant de l’ajouter.':'Aucun code lisible. Rapprochez-vous, améliorez la lumière ou photographiez une zone plus petite.';
  renderRows();

}
byId('paletteCamera').onclick=async()=>{
 cancelAnalysis();rows=[];detections=[];committed=false;byId('paletteRows').replaceChildren();byId('paletteVerified').checked=false;update();
 const request=++cameraRequest;byId('paletteStatus').textContent='Ouverture de la caméra légère…';
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280,max:1600},height:{ideal:720,max:1600}}});
  if(request!==cameraRequest){stream.getTracks().forEach(track=>track.stop());return;}
  paletteStream=stream;const video=byId('paletteVideo');video.srcObject=stream;video.hidden=false;await video.play();
  if(request!==cameraRequest)return;
  byId('paletteCapture').hidden=false;byId('paletteStatus').textContent='Approchez les étiquettes, stabilisez le téléphone puis capturez.';
 }catch(error){if(request===cameraRequest){stopPaletteCamera();byId('paletteStatus').textContent='Caméra indisponible. Autorisez son accès ou choisissez une image existante.';}}
};
byId('paletteCapture').onclick=async()=>{
 if(busy)return;const video=byId('paletteVideo');if(!video.videoWidth||!video.videoHeight)return;
 const token=++generation,epoch=sessionEpoch,canvas=byId('paletteCanvas');
 busy=true;committed=false;rows=[];detections=[];byId('paletteRows').replaceChildren();byId('paletteVerified').checked=false;byId('paletteFile').disabled=true;byId('paletteCamera').disabled=true;update();
 try{
  const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);stopPaletteCamera();
  await analyzePalette(canvas,token,epoch);
 }catch(error){if(token===generation){rows=[];detections=[];byId('paletteRows').replaceChildren();canvas.width=1;canvas.height=1;byId('paletteStatus').textContent='Lot non ajouté : '+error.message;}}
 finally{if(token===generation){stopPaletteCamera();busy=false;byId('paletteFile').disabled=false;byId('paletteCamera').disabled=false;update();}}
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopPaletteCamera();});
byId('paletteCommit').onclick=()=>{
 if(busy||committed||!byId('paletteVerified').checked)return;
 try{
  const selected=rows.filter(row=>row.qty!==0);
  if(!selected.length)throw Error('Sélectionnez au moins une pièce.');
  const identities=new Set();
  for(const row of selected){if(!row.product&&!row.reference)throw Error('Choisissez une fiche ou mettez sa quantité à 0.');const key=row.product?.id||row.reference;if(identities.has(key))throw Error('Deux codes désignent la même fiche. Regroupez la quantité sur une ligne et mettez l’autre à 0.');identities.add(key);}
  commit(selected);committed=true;byId('paletteStatus').textContent='Lot enregistré. Les repères gris correspondent aux lignes ajoutées. Une nouvelle photo ne reconnaîtra pas les boîtes déjà pointées.';
  byId('paletteRows').querySelectorAll('input,select').forEach(input=>input.disabled=true);byId('paletteVerified').checked=false;update();
 }catch(error){byId('paletteStatus').textContent='Lot non ajouté : '+error.message;}
};
})();
