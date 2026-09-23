(()=>{'use strict';const shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';let records=[],associatedId=null,busy=false;
const box=document.createElement('section');box.className='warehouse-controls';box.innerHTML='<h2>Palette terminée ?</h2><p>Associez ce pointage à une réception déjà enregistrée. Après confirmation, le pointage sera conservé dans Réception et la scanette repartira à zéro.</p><button id="receiptChoose">Associer à une réception</button><div id="receiptChoice" hidden><label>Pointage<select id="receiptPointage"></select></label><label>Réception<select id="receiptTarget"></select></label><label>Marque / nom du pointage (facultatif)<input id="receiptBatchName" maxlength="180" placeholder="Ex. : Bosch · disques"></label><button id="receiptSend">Associer le pointage sélectionné</button></div><button id="receiptOpen">Ouvrir Réception</button><p id="receiptMessage" role="status"></p>';document.getElementById('receiptAnchor').after(box);
const $=id=>document.getElementById(id),msg=s=>$('receiptMessage').textContent=s,check=r=>{if(r.error)throw Error(r.error.message);return r.data;};
$('receiptChoose').onclick=async()=>{if(busy)return;if(!currentUserId||!storageReady){msg('Connectez-vous et vérifiez la sauvegarde du pointage.');return;}const user=currentUserId,epoch=sessionEpoch;busy=true;try{
 for(const s of sections)if(!s.id)s.id=crypto.randomUUID();save();if(!storageReady)throw Error('Le pointage n’a pas pu être sauvegardé.');
 records=check(await supaClient.from('logistics_sessions').select('*').eq('workspace_id',shop).eq('kind','receipt').order('updated_at',{ascending:false}).limit(100));if(user!==currentUserId||epoch!==sessionEpoch)return;
 const requested=new URLSearchParams(location.search).get('receipt');if(requested&&!records.some(r=>r.id===requested)&&/^[0-9a-f-]{36}$/i.test(requested)){const found=check(await supaClient.from('logistics_sessions').select('*').eq('workspace_id',shop).eq('kind','receipt').eq('id',requested).maybeSingle());if(user!==currentUserId||epoch!==sessionEpoch)return;if(found)records.unshift(found);}
 $('receiptTarget').replaceChildren(new Option('Choisir la réception',''));for(const r of records)$('receiptTarget').append(new Option([r.content.supplier_name,r.content.orders,new Date(r.content.event_at).toLocaleString('fr-FR')].join(' · '),r.id));
 if(records.some(r=>r.id===requested))$('receiptTarget').value=requested;
 $('receiptPointage').replaceChildren(new Option('Choisir le pointage',''));for(const s of sections.filter(s=>Object.keys(s.items).length))$('receiptPointage').append(new Option(s.name+' · '+Object.keys(s.items).length+' références',s.id));if(sections.at(-1)?.id)$('receiptPointage').value=sections.at(-1).id;
 $('receiptBatchName').value='';$('receiptChoice').hidden=false;msg(records.length?'Choisissez la réception correspondant à cette palette.':'Créez d’abord la réception avec son fournisseur, son numéro et sa date.');
 }catch(e){msg(e.message);}finally{busy=false;}};
function finish(submitted,receipt){
 const next=ReceiptLinkCore.retire(sections,submitted,crypto.randomUUID());
 if(next!==sections){
  // Keep a recovery copy before removing the confirmed pointage from active work.
  const archiveKey='scanette_receipt_archive_v1:'+currentUserId,archive=JSON.parse(localStorage.getItem(archiveKey)||'{}');
  archive[submitted.id]={section:submitted,receipt_id:receipt.id,at:new Date().toISOString()};
  localStorage.setItem(archiveKey,JSON.stringify(archive));
  const state={...snapshot(),sections:next,recentScans:[]};
  try{ScanetteCore.write(localStorage,currentUserId,state);}catch(e){storageError(e);throw e;}
  sections=next;scanHistory=[];lastAction=null;selected={};render();updateCurSection();updateLastScanBar();
 }
 associatedId=receipt.id;$('receiptChoice').hidden=true;
 msg('Pointage enregistré dans '+receipt.content.supplier_name+' · '+receipt.content.orders+'. Le prochain pointage est vierge. Retrouvez les marques dans Réception.');
}
$('receiptSend').onclick=async()=>{if(busy||!currentUserId||!storageReady)return;const receiptId=$('receiptTarget').value,section=sections.find(s=>s.id===$('receiptPointage').value);if(!receiptId||!section){msg('Choisissez le pointage et la réception.');return;}
 const user=currentUserId,epoch=sessionEpoch,submitted=structuredClone(section),batchName=$('receiptBatchName').value.trim()||section.name;busy=true;$('receiptSend').disabled=true;let confirmed=false;
 try{const latest=check(await supaClient.from('logistics_sessions').select('*').eq('workspace_id',shop).eq('kind','receipt').eq('id',receiptId).single());if(user!==currentUserId||epoch!==sessionEpoch)return;
 const rows=LogisticsCore.importSection(submitted);const previous=(latest.content.pointages||[]).find(p=>p.id===submitted.id);
 if(previous&&ReceiptLinkCore.sameLines(previous.lines,rows)&&previous.name===batchName){confirmed=true;finish(submitted,latest);return;}
 const batch={id:submitted.id,name:batchName,at:new Date().toISOString(),by:user,lines:rows};
 const document=ReceiptLinkCore.associate(latest.content,batch);
 if(!confirm('Enregistrer « '+batchName+' » dans '+latest.content.supplier_name+' · '+latest.content.orders+' et repartir sur un pointage vierge ?'))return;
 const result=check(await supaClient.rpc('logistics_save_session',{shop,session_id:receiptId,session_kind:'receipt',expected_version:latest.version,document}));if(user!==currentUserId||epoch!==sessionEpoch)return;
 const saved=Array.isArray(result)?result[0]:result;
 if(!saved?.id||!saved.content?.pointages?.some(p=>p.id===batch.id&&ReceiptLinkCore.sameLines(p.lines,batch.lines)))throw Error('Le serveur n’a pas confirmé le contenu du pointage.');
 confirmed=true;finish(submitted,saved);
 }catch(e){if(user===currentUserId&&epoch===sessionEpoch)msg((confirmed?'La réception est enregistrée, mais le pointage local est conservé : ':'Association non confirmée : ')+e.message+' Réessayez : ce pointage ne sera pas cumulé deux fois.');}finally{busy=false;$('receiptSend').disabled=false;}};
$('receiptOpen').onclick=()=>{if(parent!==window)parent.postMessage({type:'alcorb-section',section:'receipts',receiptId:associatedId},location.origin);else location.href=associatedId?'logistics-sessions.html?kind=receipt&receipt='+encodeURIComponent(associatedId):'application.html#receipts';};
supaClient.auth.onAuthStateChange(()=>{$('receiptChoice').hidden=true;records=[];associatedId=null;msg('');});
})();
