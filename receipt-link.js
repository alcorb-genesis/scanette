(()=>{'use strict';const shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';let records=[],selectedSection=null,busy=false;
const box=document.createElement('section');box.className='warehouse-controls';box.innerHTML='<h2>Palette terminée ?</h2><p>Associez ce pointage à une réception déjà enregistrée. Le pointage reste sur cet appareil.</p><button id="receiptChoose">Associer à une réception</button><div id="receiptChoice" hidden><label>Pointage<select id="receiptPointage"></select></label><label>Réception<select id="receiptTarget"></select></label><button id="receiptSend">Associer le pointage sélectionné</button><button id="receiptOpen">Ouvrir Réception</button></div><p id="receiptMessage" role="status"></p>';document.getElementById('backupBtn').parentElement.after(box);
const $=id=>document.getElementById(id),msg=s=>$('receiptMessage').textContent=s,check=r=>{if(r.error)throw Error(r.error.message);return r.data;};
$('receiptChoose').onclick=async()=>{if(busy)return;if(!currentUserId||!storageReady){msg('Connectez-vous et vérifiez la sauvegarde du pointage.');return;}const user=currentUserId,epoch=sessionEpoch;busy=true;try{
 for(const s of sections)if(!s.id)s.id=crypto.randomUUID();save();if(!storageReady)throw Error('Le pointage n’a pas pu être sauvegardé.');
 records=check(await supaClient.from('logistics_sessions').select('*').eq('workspace_id',shop).eq('kind','receipt').order('updated_at',{ascending:false}).limit(100));if(user!==currentUserId||epoch!==sessionEpoch)return;
 $('receiptTarget').replaceChildren(new Option('Choisir la réception',''));for(const r of records)$('receiptTarget').append(new Option([r.content.supplier_name,r.content.orders,new Date(r.content.event_at).toLocaleString('fr-FR')].join(' · '),r.id));
 $('receiptPointage').replaceChildren(new Option('Choisir le pointage',''));for(const s of sections.filter(s=>Object.keys(s.items).length))$('receiptPointage').append(new Option(s.name+' · '+Object.keys(s.items).length+' références',s.id));if(sections.at(-1)?.id)$('receiptPointage').value=sections.at(-1).id;
 $('receiptChoice').hidden=false;msg(records.length?'Choisissez la réception correspondant à cette palette.':'Créez d’abord la réception avec son fournisseur, son numéro et sa date.');
 }catch(e){msg(e.message);}finally{busy=false;}};
$('receiptSend').onclick=async()=>{if(busy||!currentUserId||!storageReady)return;const receiptId=$('receiptTarget').value,section=sections.find(s=>s.id===$('receiptPointage').value);if(!receiptId||!section){msg('Choisissez le pointage et la réception.');return;}
 const user=currentUserId,epoch=sessionEpoch;busy=true;$('receiptSend').disabled=true;
 try{const latest=check(await supaClient.from('logistics_sessions').select('*').eq('workspace_id',shop).eq('kind','receipt').eq('id',receiptId).single());if(user!==currentUserId||epoch!==sessionEpoch)return;
 const rows=LogisticsCore.importSection(section);const previous=(latest.content.pointages||[]).find(p=>p.id===section.id);
 if(previous&&JSON.stringify(previous.lines)===JSON.stringify(rows)){msg('Ce pointage est déjà associé : aucune pièce ajoutée deux fois.');return;}
 const batch={id:section.id,name:section.name,at:new Date().toISOString(),by:user,lines:rows};
 const document=ReceiptLinkCore.associate(latest.content,batch);
 if(!confirm('Associer « '+section.name+' » à '+latest.content.supplier_name+' · '+latest.content.orders+' ?'+(previous?' Le pointage déjà associé sera mis à jour, sans doublon.':'')))return;
 check(await supaClient.rpc('logistics_save_session',{shop,session_id:receiptId,session_kind:'receipt',expected_version:latest.version,document}));if(user!==currentUserId||epoch!==sessionEpoch)return;
 msg('Pointage associé à '+latest.content.supplier_name+' · '+latest.content.orders+'. Ouvrez Réception pour consulter les articles.');
 }catch(e){if(user===currentUserId&&epoch===sessionEpoch)msg('Association non confirmée : '+e.message+'. Réessayez : le même pointage ne sera pas cumulé deux fois.');}finally{busy=false;$('receiptSend').disabled=false;}};
$('receiptOpen').onclick=()=>{if(parent!==window)parent.postMessage({type:'alcorb-section',section:'receipts'},location.origin);else location.href='application.html#receipts';};
supaClient.auth.onAuthStateChange(()=>{$('receiptChoice').hidden=true;records=[];msg('');});
})();
