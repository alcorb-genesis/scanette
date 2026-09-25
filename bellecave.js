'use strict';
const client=supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');
const workspaceId='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
const el=id=>document.getElementById(id);
let userId=null,role=null,pageIndex=0,total=0,epoch=0,requestId=0,selectedProduct=null;
let aisleRows=[],selectedAisle=null;
let cameraScanner=null,cameraStarting=false,cameraGeneration=0;
function status(text,error=false){el('status').textContent=text;el('status').classList.toggle('error',error);}
async function enter(session){
 if(!session){aisleRows=[];el('aisleResults').replaceChildren();stopLookup();userId=null;role=null;epoch++;requestId++;selectedProduct=null;el('results').replaceChildren();el('detail').close();el('catalogue').hidden=true;el('login').hidden=false;el('logout').hidden=true;return;}
 if(userId===session.user.id)return;
 stopLookup();aisleRows=[];el('aisleResults').replaceChildren();role=null;selectedProduct=null;el('results').replaceChildren();el('detail').close();el('catalogue').hidden=true;
 userId=session.user.id;const current=++epoch;
 el('login').hidden=true;el('logout').hidden=false;status('Vérification de l’accès Bellecave…');
 const {data,error}=await client.from('scanette_members').select('role').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
 if(current!==epoch)return;
 if(error||!data){status('Ce compte ne dispose pas encore d’un accès Bellecave. Contactez l’administrateur.',true);return;}
 role=data.role;el('catalogue').hidden=false;pageIndex=0;await Promise.all([search(),loadAisles(current)]);
}
async function search(){
 if(!userId||!role)return;
 const current=epoch,request=++requestId;
 status('Recherche…');el('previous').disabled=true;el('next').disabled=true;
 // Only letters, digits, spaces and common reference punctuation are used in PostgREST filters.
 const term=el('query').value.trim().replace(/[^\p{L}\p{N}\s./_-]/gu,' ').replace(/[%_*]/g,' ').trim();
 let query=client.from('scanette_products').select('*',{count:'exact'}).eq('workspace_id',workspaceId);
 if(selectedAisle){query=query.or(LocationSearch.filter(selectedAisle));}

 else if(term){query=query.or('reference.ilike.%'+term+'%,order_reference.ilike.%'+term+'%,description.ilike.%'+term+'%,'+(LocationSearch.filter(term)||'location.ilike.'+term)+',internal_barcode.eq.'+term+',manufacturer_barcode.eq.'+term);}
 const vehicle=CatalogueEvidence.clean(el('vehicleQuery').value),family=CatalogueEvidence.clean(el('familyQuery').value);
 if(vehicle)query=query.ilike('catalogue_enrichment->>vehicle_search','%'+vehicle+'%');
 if(family)query=query.or('description.ilike.%'+family+'%,catalogue_enrichment->>family_search.ilike.%'+family+'%');
 const {data,error,count}=await query.order('reference').order('id').range(pageIndex*40,pageIndex*40+39);
 if(current!==epoch||request!==requestId)return;
 if(error){status('Recherche indisponible. Réessayez dans un instant.',true);return;}
 const stocks=data.length?await client.from('gestion_stock').select('product_id,quantity,updated_at').in('product_id',data.map(p=>p.id)):{data:[]};if(current!==epoch||request!==requestId)return;for(const product of data)product.gestionStock=stocks.error?{unavailable:true}:stocks.data.find(s=>s.product_id===product.id)||null;total=count||0;el('results').replaceChildren();
 for(const product of data){
  const card=document.createElement('article');card.className='card';
  const ref=document.createElement('div');ref.className='ref reference-location';const number=document.createElement('span');number.textContent=product.reference;const location=document.createElement('span');location.className='location-badge'+(product.location?'':' missing');location.textContent=product.location?'📍 '+product.location:'Emplacement à renseigner';ref.append(number,location);
  const description=document.createElement('p');description.textContent=product.description;
  const info=document.createElement('p');info.className='muted';info.textContent='Stock : '+(product.gestionStock?.unavailable?'suivi indisponible':product.gestionStock?.quantity==null?'initial inconnu':product.gestionStock.quantity+' (suivi Gestion)');
  const button=document.createElement('button');button.textContent='Voir la fiche';button.addEventListener('click',()=>detail(product));
  const application=document.createElement('p');application.className='muted';const documented=CatalogueEvidence.vehicles(product.catalogue_enrichment);application.textContent=documented.length?'Véhicules cités par le fabricant : '+documented.map(v=>v.make+' '+v.model).join(', ')+' · détails à vérifier dans la fiche':'';
  card.append(ref,description,application,info,button);el('results').append(card);
 }
 el('summary').textContent=total.toLocaleString('fr-FR')+' fiche(s) trouvée(s). En cas de code-barres partagé, vérifiez la désignation.';
 el('page').textContent='Page '+(pageIndex+1)+' / '+Math.max(1,Math.ceil(total/40));
 el('previous').disabled=pageIndex===0;el('next').disabled=(pageIndex+1)*40>=total;
 status(total?'':'Aucune fiche correspondante.');
}
function detail(product){
 showEvidence(product.catalogue_enrichment);
 selectedProduct=product;el('detailRef').textContent=product.reference;el('description').textContent=product.description;
 el('identifiers').textContent='Référence commande : '+(product.order_reference||'—')+'\nCode interne : '+(product.internal_barcode||'—')+'\nCode fabricant : '+(product.manufacturer_barcode||'—');
 el('quantity').textContent='Stock suivi : '+(product.gestionStock?.unavailable?'indisponible':product.gestionStock?.quantity==null?'initial inconnu':product.gestionStock.quantity);
 el('observed').textContent=(product.gestionStock?.updated_at?'Dernier mouvement : '+new Date(product.gestionStock.updated_at).toLocaleString('fr-FR')+'. ':'')+'Les réceptions validées dans Gestion alimentent ce suivi. Les ventes externes ne sont pas encore importées. Un comptage initial est nécessaire pour connaître la quantité.';
 el('location').value=product.location||'';el('location').disabled=role==='reader';el('saveLocation').hidden=role==='reader';el('saveLocation').disabled=false;el('detailStatus').textContent='';el('detail').showModal();
}
el('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();el('connect').disabled=true;status('Connexion…');
 const {data,error}=await client.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});
 el('password').value='';el('connect').disabled=false;
 if(error)status('Connexion impossible. Vérifiez vos identifiants.',true);else await enter(data.session);
});
el('logout').addEventListener('click',async()=>{const {error}=await client.auth.signOut();if(error)status('Déconnexion impossible. Réessayez.',true);else{enter(null);status('Déconnecté.');}});
el('searchForm').addEventListener('submit',event=>{event.preventDefault();selectedAisle=null;pageIndex=0;if(LocationSearch.code(el('query').value)){el('aisleQuery').value=el('query').value;paintAisles();el('aisles').open=true;}search();});
el('previous').addEventListener('click',()=>{if(pageIndex>0){pageIndex--;search();}});
el('next').addEventListener('click',()=>{if((pageIndex+1)*40<total){pageIndex++;search();}});
el('closeDetail').addEventListener('click',()=>el('detail').close());
el('saveLocation').addEventListener('click',async()=>{
 if(!selectedProduct)return;
 const product=selectedProduct,current=epoch;el('saveLocation').disabled=true;
 const value=el('location').value.trim();
 const {error}=await client.rpc('scanette_set_location',{product_id:product.id,new_location:value,expected_updated_at:product.updated_at});
 if(current!==epoch)return;
 el('saveLocation').disabled=false;
 if(error){el('detailStatus').textContent='Enregistrement refusé ou fiche modifiée ailleurs. Fermez la fiche et relancez la recherche.';return;}
 el('detail').close();await search();status('Emplacement enregistré.');
});
client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>enter(session),0));
client.auth.getSession().then(({data})=>enter(data.session));
async function stopLookup(){
 cameraGeneration++;
 if(cameraScanner){const scanner=cameraScanner;cameraScanner=null;try{await scanner.stop();await scanner.clear();}catch(_){}}
 el('camera').hidden=true;el('scanLookup').textContent='Scanner un code-barres';
}
el('scanLookup').addEventListener('click',async()=>{
 if(cameraStarting)return;
 if(cameraScanner){await stopLookup();return;}
 cameraStarting=true;el('camera').hidden=false;el('scanLookup').disabled=true;
 const generation=++cameraGeneration,current=epoch;
 const scanner=new Html5Qrcode('camera');cameraScanner=scanner;let found=false;
 try{
  await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:120}},async code=>{
   if(found||generation!==cameraGeneration||current!==epoch)return;found=true;selectedAisle=null;el('query').value=code;pageIndex=0;
   if(navigator.vibrate)navigator.vibrate(60);
   await stopLookup();await search();
  },()=>{});
  if(generation!==cameraGeneration||current!==epoch){try{await scanner.stop();await scanner.clear();}catch(_){}return;}
  el('scanLookup').textContent='Arrêter la caméra';
 }catch(_){await stopLookup();status('Caméra indisponible. Vous pouvez saisir le code ou utiliser un lecteur externe.',true);}
 finally{cameraStarting=false;el('scanLookup').disabled=false;}
});
el('copyReference').addEventListener('click',async()=>{
 if(!selectedProduct)return;
 try{await navigator.clipboard.writeText(selectedProduct.reference);el('detailStatus').textContent='Référence copiée.';}
 catch(_){el('detailStatus').textContent='Copie indisponible. Référence : '+selectedProduct.reference;}
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopLookup();});
document.addEventListener('keydown',event=>{
 if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&!el('catalogue').hidden){event.preventDefault();el('query').focus();}
 if(event.key==='Escape')stopLookup();
});

async function loadAisles(current){
 el('aisleStatus').textContent='Chargement des emplacements…';
 const {data,error}=await client.from('scanette_aisles').select('code,description,notes').eq('workspace_id',workspaceId).order('code').limit(1000);
 if(current!==epoch)return;
 if(error){el('aisleStatus').textContent='Relevé des allées indisponible. Les emplacements des fiches restent consultables.';return;}
 aisleRows=(data||[]).sort((a,b)=>a.code.localeCompare(b.code,'fr',{numeric:true}));paintAisles();
}
function paintAisles(){
 const rows=aisleRows.filter(r=>LocationSearch.matches(r,el('aisleQuery').value));
 el('aisleStatus').textContent=rows.length+' emplacement(s) dans le relevé';el('aisleResults').replaceChildren();
 for(const row of rows){
  const card=document.createElement('article');card.className='card';
  const title=document.createElement('strong');title.textContent=row.code;
  const description=document.createElement('p');description.textContent=row.description;
  const notes=document.createElement('p');notes.className='muted';notes.textContent=row.notes;
  const button=document.createElement('button');button.textContent='Voir les pièces localisées ici';
  button.addEventListener('click',()=>{selectedAisle=row.code;el('query').value=row.code;pageIndex=0;search();el('aisles').open=false;el('query').focus();});
  card.append(title,description,notes,button);el('aisleResults').append(card);
 }
}
el('aisleQuery').addEventListener('input',paintAisles);

function showEvidence(evidence){
 const box=el('evidence');box.replaceChildren();
 if(!evidence||!Object.keys(evidence).length)return;
 const title=document.createElement('h3');title.textContent='Informations fabricant';box.append(title);
 const brand=document.createElement('p');brand.textContent=[evidence.brand,evidence.family].filter(Boolean).join(' · ');box.append(brand);
 function link(url,label){const href=CatalogueEvidence.sourceUrl(url);if(!href)return;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;box.append(a);}
 if(evidence.barcode){const p=document.createElement('p');p.textContent='Code fabricant documenté : '+evidence.barcode.value;box.append(p);link(evidence.barcode.source_url,'Consulter la source du code-barres');}
 const vehicles=CatalogueEvidence.vehicles(evidence);
 if(vehicles.length){const h=document.createElement('h4');h.textContent='Affectations citées par le fabricant';box.append(h);
  for(const v of vehicles){const row=document.createElement('p');row.textContent=v.make+' '+v.model+(v.engine?' · '+v.engine:'')+(v.years?' · '+v.years:'');box.append(row);}
  const note=document.createElement('p');note.className='muted';note.textContent=evidence.vehicle_note||'Les variantes non précisées par la source doivent être vérifiées avant la vente.';box.append(note);
  for(const url of [...new Set(vehicles.map(v=>v.source_url))])link(url,'Consulter les affectations fabricant');
 }
}
el('resetFilters').addEventListener('click',()=>{el('query').value='';el('vehicleQuery').value='';el('familyQuery').value='';selectedAisle=null;pageIndex=0;search();});
