(()=>{'use strict';
/* Retours et garanties: one screen per role, nothing kept open from one role or queue to another.
   Service Retours organises the collections and works from sorted lists; the driver sees his
   collections; the receiving agent scans a part and qualifies it at once. The server decides
   everything that matters (returns-roles.sql): exact codes, routing, freezing, closing. */
const C=ReturnsCore,A=ReturnsActions,F=ReturnsFlow,P=PartnerPlanning,$=id=>document.getElementById(id);
// Shared logistics access without account: shared_* functions serve the configured shop only.
// Other devices' changes arrive through the 30-second refresh (no realtime channel for anon).
const call=SharedAccess.call;
let actor=null,epoch=0,busy=false,ready=false,cases=[],clients=[],suppliers=[],actions=[],shipments=[],scanner=null,lastCode='',lastAt=0;
// What is on screen. Everything below « role » is dropped when the role or the queue changes.
let role='',queue='organise',planFor='',draftRequest=null,receiving='',pending=null,damagedFor='',finishing=null,cartonOf='',historyOpen='',historyQuery='',journal=null;
const plans=new Map();
const ROLES=Object.freeze({office:'roleOffice',driver:'roleDriver',reception:'roleReception'});
const QUEUES=Object.freeze([['organise','Collectes à organiser'],['damaged','Pièces abîmées'],['credits','Avoirs clients'],['suppliers','Retours fournisseur'],['stock','Remise en stock'],['gaps','Écarts'],['history','Historique']]);
const store={get(key){try{return localStorage.getItem(key)||'';}catch{return '';}},set(key,value){try{localStorage.setItem(key,value);}catch{}}};
const agent=()=>A.space($('agent').value).slice(0,60);
function el(tag,props={},children=[]){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k==='data')Object.assign(n.dataset,v);else n[k]=v;}n.append(...children.filter(Boolean));return n;}
function say(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
const fail=e=>say(message(e),true);
function message(e){const known=F.serverMessage(e);if(known)return known;if(e?.code==='42501'||e?.code==='PT401')return SharedAccess.message(e);return 'Enregistrement non confirmé'+(e?.message?' : '+e.message:'')+'. Rien n’a été modifié ; réessayez.';}
const clientById=id=>clients.find(p=>p.id===id)||null;
const when=value=>{const t=new Date(value);return isNaN(t)?'date inconnue':t.toLocaleDateString('fr-FR')+' à '+t.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});};
const plural=(n,one,many)=>n+' '+(n>1?many:one);
const first=answer=>Array.isArray(answer)?answer[0]:answer;
const adopt=row=>{const i=cases.findIndex(c=>c.id===row.id);if(i<0)cases.unshift(row);else cases[i]={...cases[i],...row};return cases[i<0?0:i];};
const keep=saved=>{const i=actions.findIndex(a=>a.id===saved.id);if(i<0)actions.push(saved);else actions[i]=saved;return saved;};
const caseById=id=>cases.find(c=>c.id===id)||null;
const pieces=d=>plural(C.pieces(d).pieces,'pièce','pièces');
const describe=line=>line.reference+' · '+(line.description||'Désignation non renseignée');
/* One guarded write: nothing else starts while it runs, and a refusal is said. */
async function act(work){if(busy||!actor||!ready)return false;busy=true;try{await work();return true;}catch(e){fail(e);if(e?.code==='PT409'){try{await load();}catch{}plans.clear();paint();say(message(e),true);}return false;}finally{busy=false;}}

/* ---- Roles: a role shows its screen and nothing of the others. ---- */
function reset(){paintReceiving.note=null;planFor='';draftRequest=null;receiving='';pending=null;damagedFor='';finishing=null;cartonOf='';historyOpen='';journal=null;plans.clear();stopCamera();}
function setRole(next){reset();role=next;store.set('repclick_returns_role',next);paint();}
function setQueue(next){reset();queue=next;paint();}
function paint(){for(const [name,id] of Object.entries(ROLES))$(id).ariaPressed=String(role===name);
 $('roleHint').hidden=!!role;$('office').hidden=role!=='office';$('driver').hidden=role!=='driver';$('reception').hidden=role!=='reception';$('agentLabel').hidden=role!=='office'&&role!=='reception';
 if(role==='office')paintOffice();else if(role==='driver')paintDriver();else if(role==='reception')paintReception();}

/* ---- Service Retours ---- */
function paintOffice(){const plan=F.organise(cases),q=F.queues(cases,actions),counts={organise:plan.count+plan.typeToFix.length,damaged:q.counts.damaged,credits:q.counts.credits,suppliers:q.counts.suppliers,stock:q.counts.stock,gaps:q.counts.gaps};
 $('queues').replaceChildren(...QUEUES.map(([id,label])=>{const b=el('button',{type:'button',class:'chip',ariaPressed:String(queue===id),data:{queue:id}},[el('span',{text:label}),id==='history'?null:el('span',{class:'count'+(counts[id]?'':' zero'),text:String(counts[id])})]);b.onclick=()=>setQueue(id);return b;}));
 const body=$('queueBody');body.replaceChildren();
 if(q.orphans.length&&queue!=='organise'&&queue!=='history')body.append(el('p',{class:'alert-info',text:plural(q.orphans.length,'pièce appartient','pièces appartiennent')+' à un dossier ancien non chargé ici.'}));
 ({organise:paintOrganise,damaged:paintDamaged,credits:paintCredits,suppliers:paintSuppliers,stock:paintStock,gaps:paintGaps,history:paintHistory})[queue](body,q,plan);}
const emptyList=text=>el('p',{class:'empty-list',text});
function exportCsv(name,rows,all){const file=new File([A.csv(rows,all)],name+'-'+new Date().toISOString().slice(0,10)+'.csv',{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Export CSV préparé : '+plural(rows.length,'ligne','lignes')+'.');}
/* A part in a queue: what it is, whose it is, and — at most — one thing to do. */
function partRow(row,extra=[],tools=[]){const a=row.action;return el('div',{class:'action '+a.kind+' '+a.status,data:{action:a.id}},[el('p',{class:'action-line',text:describe(row.line)+' × '+a.quantity}),
 el('p',{class:'meta',text:row.dossier.document.client_name+' · '+when(a.created_at)+' · dossier '+A.dossierRef(row.dossier)}),...extra,tools.length?el('div',{class:'action-tools'},tools):null]);}

/* Collectes à organiser: who collects, at which passage, and the type — before the parts leave the garage. */
function planOf(row){if(!plans.has(row.id)){const d=row.document,partner=clientById(d.client_id),collector=C.collector(d.collector)?d.collector:C.certainCollector(partner),known=F.proposals(partner,collector,P);
  plans.set(row.id,{type:F.typeOk(d.type)?d.type:'',collector,pickupAt:F.slotDate(d.pickup_at)?d.pickup_at:(known[0]?.value||''),free:!!F.slotDate(d.pickup_at)&&!known.some(k=>k.value===d.pickup_at),proposed:!C.collector(d.collector)&&!!collector});}return plans.get(row.id);}
function planForm(row,editing){const d=row.document,plan=planOf(row),partner=clientById(d.client_id),known=F.proposals(partner,plan.collector,P),form=el('div',{class:'plan-form',data:{plan:row.id}}),note=el('p',{class:'error',role:'status'});
 const type=el('select',{ariaLabel:'Type du dossier'});type.append(new Option('Type : choisir…',''));for(const [id,label] of Object.entries(F.TYPES))type.append(new Option(label,id));type.value=plan.type;type.onchange=()=>{plan.type=type.value;plan.touched=true;};
 const who=el('select',{ariaLabel:'Livreur'});who.append(new Option('Livreur : choisir…',''));for(const c of C.COLLECTORS)who.append(new Option(c.name+' · '+c.kind,c.id));who.value=plan.collector;
 who.onchange=()=>{plan.touched=true;plan.collector=who.value;plan.proposed=false;const next=F.proposals(partner,plan.collector,P);plan.pickupAt=next[0]?.value||'';plan.free=!next.length;paintOffice();};
 const slot=el('select',{ariaLabel:'Passage'});for(const k of known)slot.append(new Option('Passage : '+k.label,k.value));slot.append(new Option('Autre jour et heure…','free'));slot.value=plan.free||!known.length?'free':plan.pickupAt;
 slot.onchange=()=>{plan.touched=true;plan.free=slot.value==='free';if(!plan.free)plan.pickupAt=slot.value;paintOffice();};
 const free=el('input',{type:'datetime-local',value:plan.free||!known.length?plan.pickupAt:'',ariaLabel:'Jour et heure du passage'});free.oninput=()=>{plan.touched=true;plan.pickupAt=free.value;};
 const go=el('button',{type:'button',class:'primary',text:editing?'Enregistrer l’affectation':'Affecter',data:{assign:row.id}});
 go.onclick=()=>{const missing=F.planProblem(plan);if(missing){note.textContent=missing;return;}act(async()=>{adopt(first(await call('shared_return_plan',{case_id:row.id,collector:plan.collector,pickup_at:plan.pickupAt,case_type:plan.type,expected_version:row.version,actor_label:agent()})));
  plans.delete(row.id);planFor='';say(d.client_name+' : '+C.collectorName(plan.collector)+', passage '+F.slotLabel(plan.pickupAt)+'.');paintOffice();});};
 form.append(el('label',{text:'Type'},[type]),el('label',{text:'Livreur'},[who]));
 if(plan.proposed&&plan.collector)form.append(el('p',{class:'hint',text:'Proposé : '+C.collectorName(plan.collector)+', seul service connu de ce garage. À confirmer.'}));
 if(plan.collector){if(known.length)form.append(el('label',{text:'Passage'},[slot]));else form.append(el('p',{class:'hint',text:'Aucun passage connu de '+C.collectorName(plan.collector)+' chez ce garage : indiquez le jour et l’heure.'}));
  if(plan.free||!known.length)form.append(el('label',{text:'Jour et heure du passage'},[free]));}
 const tools=[go];
 if(editing){const no=el('button',{type:'button',class:'secondary',text:'Abandonner'});no.onclick=()=>{plans.delete(row.id);planFor='';paintOffice();};tools.push(no);}
 const cancel=el('button',{type:'button',class:'danger',text:'Annuler la demande',data:{cancel:row.id}});cancel.onclick=()=>{if(!confirm('Annuler la demande de '+d.client_name+' ? Elle restera consultable dans l’historique.'))return;
  act(async()=>{adopt(first(await call('shared_save_return',{case_id:row.id,expected_version:row.version,case_document:{...d,status:'cancelled'},event_note:'Demande annulée avant collecte'})));plans.delete(row.id);planFor='';say('Demande de '+d.client_name+' annulée.');paintOffice();});};tools.push(cancel);
 // The passages of this garage are kept in « Départs »: one tap away, in the same frame.
 if(typeof SectionLinks!=='undefined'){const link=el('button',{type:'button',class:'section-link',text:'Passages de ce garage dans Départs'});link.onclick=()=>SectionLinks.go('departures',{query:d.client_name});form.append(link);}
 form.append(note,el('div',{class:'row'},tools));return form;}
function requestCard(row,{form=false,editing=false}={}){const d=row.document,portal=C.portalInfo(d),card=el('article',{class:'case requested',data:{case:row.id}});
 card.append(el('h3',{text:d.client_name}),el('p',{class:'case-place',text:'Emplacement du carton : '+(String(d.pickup_location||'').trim()||'non indiqué')}),el('p',{class:'case-info',text:pieces(d)+' · '+F.typeLabel(d.type)}),
  el('p',{class:'meta',text:'Demande du '+when(row.created_at||row.updated_at)+(portal?' · déposée par le garage'+(portal.verified?'':' (nom saisi par le garage)'):'')}));
 if(form)card.append(planForm(row,editing));
 else{const slotText=F.slotDate(d.pickup_at)?'Passage prévu : '+F.slotLabel(d.pickup_at)+(F.late(d.pickup_at)?' · en retard, à replanifier':''):'Passage à préciser';
  const edit=el('button',{type:'button',class:'secondary',text:'Modifier',data:{edit:row.id}});edit.onclick=()=>{planFor=row.id;paintOffice();};card.append(el('p',{class:'case-slot'+(F.late(d.pickup_at)||!F.slotDate(d.pickup_at)?' late':''),text:slotText}),el('div',{class:'card-actions'},[edit]));}
 return card;}
function paintOrganise(body,q,plan){const add=el('button',{type:'button',class:'secondary',text:'＋ Nouvelle demande',data:{new:'1'}});add.onclick=()=>{draftRequest=draftRequest?null:{client:'',name:'',place:'',type:'',lines:[]};paintOffice();};body.append(el('div',{class:'row'},[add]));
 if(draftRequest)body.append(requestForm());
 body.append(el('h2',{},[el('span',{text:'À organiser '}),el('span',{class:'count'+(plan.toPlan.length?'':' zero'),text:String(plan.toPlan.length)})]));
 body.append(plan.toPlan.length?el('div',{class:'case-grid'},plan.toPlan.map(row=>requestCard(row,{form:true}))):emptyList('Aucune demande en attente d’affectation.'));
 if(plan.typeToFix.length){body.append(el('h2',{text:'Type à préciser · dossiers déjà pris'}),el('p',{class:'meta',text:'Ces dossiers anciens n’ont ni « Retour client » ni « Garantie » : la réception ne peut pas classer leurs pièces conformes.'}));
  body.append(el('div',{class:'case-grid'},plan.typeToFix.map(row=>{const type=el('select',{ariaLabel:'Type du dossier'}),ok=el('button',{type:'button',class:'primary',text:'Enregistrer le type',data:{type:row.id}});type.append(new Option('Choisir…',''));for(const [id,label] of Object.entries(F.TYPES))type.append(new Option(label,id));
   ok.onclick=()=>{if(!type.value){say('Choisissez le type : retour client ou garantie.',true);return;}act(async()=>{adopt(first(await call('shared_return_set_type',{case_id:row.id,case_type:type.value,actor_label:agent()})));say(row.document.client_name+' : '+F.TYPES[type.value]+'.');paintOffice();});};
   return el('article',{class:'case collected'},[el('h3',{text:row.document.client_name}),el('p',{class:'case-info',text:pieces(row.document)+' · '+F.typeLabel(row.document.type)}),el('div',{class:'row'},[type,ok])]);})));}
 body.append(el('h2',{text:'Collectes affectées, par livreur'}));if(!plan.groups.length)body.append(emptyList('Aucune collecte affectée en attente d’enlèvement.'));
 for(const g of plan.groups)body.append(el('section',{class:'driver-group',data:{group:g.id}},[el('h3',{},[el('span',{text:g.name+' '}),el('span',{class:'group-kind',text:g.kind+' '}),el('span',{class:'count',text:String(g.cases.length)})]),
  el('div',{class:'case-grid'},g.cases.map(row=>requestCard(row,{form:planFor===row.id,editing:true})))]));}
/* A request taken by phone or at the counter: the same four facts as the garage portal. */
function requestForm(){const r=draftRequest,form=el('div',{class:'plan-form new-request'}),note=el('p',{class:'error',role:'status'}),lookup=el('p',{class:'meta',role:'status'});
 const garage=el('select',{ariaLabel:'Garage'});garage.append(new Option('Garage : choisir dans la liste',''));for(const p of clients)garage.append(new Option(p.name+(p.details?.code?' · '+p.details.code:''),p.id));garage.value=r.client;
 const name=el('input',{maxLength:180,placeholder:'Ou saisir le nom du garage',value:r.name,ariaLabel:'Nom du garage'});garage.onchange=()=>{r.client=garage.value;const p=clientById(r.client);if(p){r.name=p.name;name.value=p.name;}};name.oninput=()=>{r.name=name.value;if(clientById(r.client)?.name!==name.value.trim()){r.client='';garage.value='';}};
 const place=el('input',{maxLength:160,placeholder:'Ex. carton à l’accueil',value:r.place,ariaLabel:'Emplacement du carton'});place.oninput=()=>{r.place=place.value;};
 const type=el('select',{ariaLabel:'Type'});type.append(new Option('Type : choisir…',''));for(const [id,label] of Object.entries(F.TYPES))type.append(new Option(label,id));type.value=r.type;type.onchange=()=>{r.type=type.value;};
 const ref=el('input',{maxLength:120,placeholder:'Référence ou code-barres',ariaLabel:'Référence ou code-barres',autocomplete:'off'}),addRef=el('button',{type:'button',text:'Ajouter'}),cam=el('button',{type:'button',class:'secondary',text:'Scanner'});
 const add=async raw=>{const answer=await addReference(r,raw);lookup.textContent=answer;if(answer.endsWith('ajoutée.')||answer.endsWith('à vérifier.'))paintOffice();};addRef.onclick=()=>add(ref.value);ref.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add(ref.value);}};cam.onclick=()=>startCamera(code=>add(code),lookup);
 const list=el('div',{class:'request-lines'},r.lines.map((line,i)=>{const qty=el('input',{type:'number',inputMode:'numeric',min:'1',max:'999',step:'1',value:String(line.quantity),ariaLabel:'Quantité de '+line.reference}),remove=el('button',{type:'button',class:'secondary',text:'Retirer'});qty.oninput=()=>{line.quantity=Number(qty.value);};remove.onclick=()=>{r.lines.splice(i,1);paintOffice();};
  return el('div',{class:'row request-line'},[el('span',{class:'action-line',text:describe(line)}),qty,remove]);}));
 const ok=el('button',{type:'button',class:'primary',text:'Enregistrer la demande',data:{save:'request'}}),no=el('button',{type:'button',class:'secondary',text:'Abandonner'});no.onclick=()=>{draftRequest=null;paintOffice();};
 ok.onclick=()=>{const partner=clientById(r.client),doc={type:r.type,status:'requested',client_id:partner?.id||null,client_name:(partner?.name||r.name).trim(),supplier_id:null,supplier_name:'',pickup_location:r.place.trim().replace(/\s+/g,' '),collector:'',lines:structuredClone(r.lines)};
  if(!F.typeOk(doc.type)){note.textContent='Choisissez le type : retour client ou garantie.';return;}if(!doc.pickup_location){note.textContent='Indiquez l’emplacement du carton dans le garage.';return;}try{C.validateDocument(doc);}catch(e){note.textContent=e.message;return;}
  act(async()=>{adopt(first(await call('shared_save_return',{case_id:crypto.randomUUID(),expected_version:0,case_document:doc,event_note:''})));draftRequest=null;say('Demande de '+doc.client_name+' enregistrée : à organiser.');paintOffice();});};
 form.append(el('h3',{text:'Nouvelle demande'}),el('div',{class:'grid'},[el('label',{text:'Garage'},[garage]),el('label',{text:'Nom du garage'},[name]),el('label',{text:'Emplacement du carton'},[place]),el('label',{text:'Type'},[type])]),
  el('label',{text:'Pièces à reprendre'},[el('div',{class:'row'},[ref,addRef,cam])]),lookup,list,note,el('div',{class:'row'},[ok,no]));return form;}
async function addReference(r,raw){const term=C.norm(raw);if(!term)return '';try{const code=String(raw).trim().slice(0,256),found=[];for(const value of new Set([term,code]))for(const p of await call('shared_product_lookup',{code:value}))if(!found.some(f=>f.id===p.id))found.push(p);
  let products=found.filter(p=>p.reference===term);if(!products.length)products=found.filter(p=>p.internal_barcode===code);if(!products.length)products=found.filter(p=>p.manufacturer_barcode===code);if(products.length>1)return 'Plusieurs fiches correspondent : saisissez la référence exacte.';
  const product=products[0];if(r.lines.some(l=>product?l.product_id===product.id:C.norm(l.reference)===term))return 'Cette référence est déjà dans la demande : ajustez sa quantité.';
  r.lines.push(product?C.newLine(product):C.newLine({reference:term,description:''}));return product?'Référence catalogue ajoutée.':'Référence absente du catalogue : ajoutée à vérifier.';}catch(e){return e.message||'Recherche indisponible.';}}

/* Pièces abîmées: a register by garage, with the reason given at the scan. */
function paintDamaged(body,q){if(!q.damaged.length)return body.append(emptyList('Aucune pièce abîmée.'));const rows=q.damaged.flatMap(g=>g.rows),out=el('button',{type:'button',class:'secondary',text:'Exporter en CSV',data:{export:'damaged'}});out.onclick=()=>exportCsv('pieces-abimees',rows,q.rows);body.append(el('div',{class:'row'},[out]));
 for(const g of q.damaged)body.append(el('section',{class:'driver-group'},[el('h3',{},[el('span',{text:g.label+' '}),el('span',{class:'count',text:String(g.rows.length)})]),...g.rows.map(r=>partRow(r,[el('p',{class:'action-detail',text:'Motif : '+(r.action.comment||'non renseigné')})]))]));}
/* Avoirs clients: conforming parts of customer returns. The number is typed when the credit is issued. */
function paintCredits(body,q){if(!q.credits.length)return body.append(emptyList('Aucun avoir client à éditer.'));const rows=q.credits.flatMap(g=>g.rows),out=el('button',{type:'button',class:'secondary',text:'Exporter en CSV',data:{export:'credits'}});out.onclick=()=>exportCsv('avoirs-a-editer',rows,q.rows);body.append(el('div',{class:'row'},[out]));
 for(const g of q.credits)body.append(el('section',{class:'driver-group'},[el('h3',{},[el('span',{text:g.label+' '}),el('span',{class:'count',text:String(g.rows.length)})]),...g.rows.map(r=>{const number=el('input',{maxLength:60,autocomplete:'off',placeholder:'N° de l’avoir',value:r.action.document_number||'',ariaLabel:'Numéro de l’avoir pour '+r.line.reference,data:{credit:r.action.id}}),ok=el('button',{type:'button',class:'primary',text:'Avoir édité',data:{issue:r.action.id}});
   ok.onclick=()=>{if(!A.space(number.value)){say('Indiquez le numéro de l’avoir de '+r.line.reference+'.',true);number.focus();return;}act(async()=>{keep(await call('shared_return_credit_issue',{action_id:r.action.id,document_number:number.value,expected_version:r.action.version,actor_label:agent()}));say('Avoir '+A.space(number.value)+' édité pour '+r.line.reference+' : la pièce passe en « Remise en stock ».');paintOffice();});};
   return partRow(r,[],[number,ok]);})]));}
/* Remise en stock: parts whose credit is issued. */
function paintStock(body,q){if(!q.stock.length)return body.append(emptyList('Aucune pièce à remettre en stock.'));
 for(const r of q.stock){const place=el('input',{maxLength:80,placeholder:'Emplacement (ex. A12C)',ariaLabel:'Emplacement de stock pour '+r.line.reference,data:{place:r.action.id}}),ok=el('button',{type:'button',class:'primary',text:'Rangé',data:{restock:r.action.id}}),no=el('button',{type:'button',class:'secondary',text:'Non remis en stock'});
  const move=(target,extra,done)=>act(async()=>{keep(await call('shared_return_action_move',A.movePayload(r.action,target,extra,agent())));await refreshCase(r.dossier.id);say(done);paintOffice();});
  ok.onclick=()=>{if(!A.space(place.value)){say('Indiquez où '+r.line.reference+' est rangée.',true);place.focus();return;}move('restocked',{destination:place.value},r.line.reference+' rangée : '+A.space(place.value)+'.');};
  no.onclick=()=>{if(confirm('Confirmer : '+r.line.reference+' n’est pas remise en stock ?'))move('closed_no_stock',{},r.line.reference+' : non remise en stock.');};
  body.append(partRow(r,[el('p',{class:'action-detail',text:'Avoir '+(r.action.document_number||'sans numéro')})],[place,ok,no]));}}
/* Retours fournisseur: conforming warranty parts, by supplier. A part leaves only after its exact rescan into a carton. */
function paintSuppliers(body,q){if(!q.suppliers.length)return body.append(emptyList('Aucun retour fournisseur à préparer.'));
 for(const g of q.suppliers){const box=el('section',{class:'driver-group',data:{supplier:g.supplierId||'none'}},[el('h3',{},[el('span',{text:g.label+' '}),el('span',{class:'count',text:String(g.rows.length)})])]);
  if(!g.supplierId){box.append(el('p',{class:'meta',text:'Le dossier ne dit pas le fournisseur de ces pièces : choisissez-le pour les classer.'}));
   for(const r of g.rows){const pick=el('select',{ariaLabel:'Fournisseur de '+r.line.reference}),ok=el('button',{type:'button',class:'primary',text:'Enregistrer le fournisseur',data:{supplierFor:r.action.id}});pick.append(new Option('Fournisseur : choisir…',''));for(const p of suppliers)pick.append(new Option(p.name,p.id));
    ok.onclick=()=>{if(!pick.value){say('Choisissez le fournisseur de '+r.line.reference+'.',true);return;}act(async()=>{const saved=keep(await call('shared_return_action_supplier',{action_id:r.action.id,supplier_id:pick.value,expected_version:r.action.version,actor_label:agent()}));say(r.line.reference+' : retour '+saved.supplier_name+'.');paintOffice();});};box.append(partRow(r,[],[pick,ok]));}
  }else{const carton=shipments.find(s=>s.supplier_id===g.supplierId&&s.status==='open');
   if(cartonOf===g.supplierId&&carton)box.append(cartonPanel(g,carton,q.rows));else{const start=el('button',{type:'button',class:'primary',text:(carton?'Reprendre le carton ':'Préparer un carton ')+g.label,data:{carton:g.supplierId}});
    start.onclick=()=>act(async()=>{const opened=await call('shared_return_shipment_open',{supplier_id:g.supplierId,actor_label:agent()});if(!shipments.some(s=>s.id===opened.id))shipments.unshift(opened);cartonOf=g.supplierId;paintOffice();});box.append(el('div',{class:'row'},[start]));}
   for(const r of g.rows)box.append(partRow(r,[el('p',{class:'action-detail',text:r.action.status==='packed'?'Dans le carton':r.action.packed_quantity?'Carton '+r.action.packed_quantity+' / '+r.action.quantity:'À mettre en carton'})]));}
  body.append(box);}}
/* Carton of a supplier: only an exact rescan puts a part in it. */
function cartonPanel(g,carton,all){const inside=A.carton(all,carton.id),n=A.cartonCount(all,carton.id),panel=el('div',{class:'carton'}),note=el('p',{role:'status'});
 const code=el('input',{maxLength:256,autocomplete:'off',autocapitalize:'characters',spellcheck:false,enterKeyHint:'done',placeholder:'Scannez la pièce à mettre dans le carton',ariaLabel:'Code de la pièce à mettre dans le carton',data:{cartonCode:g.supplierId}});
 const add=el('button',{type:'button',class:'primary',text:'Ajouter au carton'}),send=el('button',{type:'button',class:'primary',text:'Carton envoyé',disabled:!n.complete,title:n.complete?'':'Chaque ligne commencée doit être entièrement scannée',data:{send:g.supplierId}}),out=el('button',{type:'button',class:'secondary',text:'Manifeste CSV',disabled:!inside.length}),close=el('button',{type:'button',class:'secondary',text:'Fermer sans envoyer'});
 const scan=async()=>{const value=code.value.trim();if(!value||busy)return;busy=true;note.className='';note.textContent='Vérification…';try{const saved=keep(await call('shared_return_pack',{shipment_id:carton.id,code:value,actor_label:agent()}));busy=false;paintOffice();document.querySelector('[data-carton-code="'+g.supplierId+'"]')?.focus();say('✓ Dans le carton '+g.label+' : '+saved.packed_quantity+' / '+saved.quantity+'.');navigator.vibrate?.(60);}
  catch(e){busy=false;note.className='error';note.textContent=message(e);code.select?.();navigator.vibrate?.([80,60,80]);}};
 add.onclick=scan;code.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scan();}};
 send.onclick=()=>{if(!confirm('Confirmer l’envoi du carton '+g.label+' ('+plural(n.scanned,'pièce','pièces')+') ?'))return;act(async()=>{const done=await call('shared_return_shipment_send',{shipment_id:carton.id,note:'',actor_label:agent()});cartonOf='';await load();const i=shipments.findIndex(s=>s.id===done.id);if(i>=0)shipments[i]=done;say('Carton '+g.label+' envoyé.');paintOffice();});};
 out.onclick=()=>exportCsv('carton-'+g.label.replace(/[^a-z0-9]+/gi,'-').toLowerCase(),inside,all);close.onclick=()=>{cartonOf='';paintOffice();};
 panel.append(el('h4',{text:'Carton '+g.label+' · ouvert le '+when(carton.created_at)}),el('p',{class:'carton-count'+(n.complete?' complete':''),text:'Scanné '+n.scanned+' / '+n.expected+' '+(n.expected>1?'pièces':'pièce')+(n.expected?'':' — scannez une première pièce')}),
  el('p',{class:'meta',text:'Un scan = une pièce. Un code qui ne correspond pas exactement à une pièce en attente est refusé.'}),el('div',{class:'row'},[code,add]),note,
  ...inside.map(r=>el('p',{class:'carton-line',text:(r.action.status==='to_send'?r.action.packed_quantity:r.action.quantity)+' / '+r.action.quantity+' · '+describe(r.line)+' · '+r.dossier.document.client_name})),el('div',{class:'row'},[send,out,close]));return panel;}
/* Écarts: parts announced and not received, to settle with the garage. */
function paintGaps(body,q){if(!q.gaps.length)return body.append(emptyList('Aucun écart à régler.'));
 for(const r of q.gaps){const ok=el('button',{type:'button',class:'primary',text:'Réglé',data:{resolve:r.action.id}});ok.onclick=()=>act(async()=>{keep(await call('shared_return_gap_resolve',{action_id:r.action.id,note:'',expected_version:r.action.version,actor_label:agent()}));await refreshCase(r.dossier.id);say('Écart réglé : '+r.line.reference+' · '+r.dossier.document.client_name+'.');paintOffice();});
  body.append(partRow(r,[el('p',{class:'action-detail',text:r.action.kind==='missing'?'Manquante : annoncée, non reçue':'Ancienne attente de décision'+(r.action.comment?' : '+r.action.comment:'')})],[ok]));}}
/* Historique: every dossier, read only. */
function partsOf(dossier,line){const v=F.lineView(dossier,line,actions),tags=[];if(v.ok)tags.push('Conforme × '+v.ok);for(const a of v.damaged)tags.push('Abîmée × '+a.quantity+' : '+(a.comment||'motif non renseigné'));if(v.missing)tags.push('Manquante × '+v.missing);if(v.unqualified)tags.push('À qualifier × '+v.unqualified);return {v,tags};}
function paintHistory(body){if(historyOpen){const row=caseById(historyOpen);if(row)return paintDossier(body,row);historyOpen='';}
 const search=el('input',{type:'search',placeholder:'Garage, référence, livreur',value:historyQuery,ariaLabel:'Rechercher un dossier',data:{search:'history'}}),list=el('div',{class:'case-grid'}),count=el('p',{class:'meta'});
 const fill=()=>{const found=F.history(cases,historyQuery);count.textContent=plural(found.length,'dossier','dossiers')+' sur '+cases.length;list.replaceChildren(...found.map(row=>{const d=row.document,open=el('button',{type:'button',class:'secondary',text:'Voir',data:{open:row.id}});open.onclick=()=>{historyOpen=row.id;journal=null;paintOffice();loadJournal(row.id);};
   return el('article',{class:'case '+d.status},[el('span',{class:'case-state',text:F.stage(row)}),el('h3',{text:d.client_name}),el('p',{class:'case-info',text:F.typeLabel(d.type)+' · '+pieces(d)}),el('p',{class:'meta',text:'Demande du '+when(row.created_at||row.updated_at)}),open]);}));if(!found.length)list.append(emptyList(cases.length?'Aucun dossier ne correspond.':'Aucun dossier pour le moment.'));};
 search.oninput=()=>{historyQuery=search.value;fill();};fill();body.append(el('label',{text:'Rechercher'},[search]),count,list);}
function paintDossier(body,row){const d=row.document,back=el('button',{type:'button',class:'secondary',text:'← Tous les dossiers'});back.onclick=()=>{historyOpen='';journal=null;paintOffice();};
 body.append(el('div',{class:'row head'},[el('h2',{text:d.client_name}),back]),el('p',{class:'summary',text:F.stage(row)+' · '+F.typeLabel(d.type)+' · '+(C.collector(d.collector)?C.collectorName(d.collector)+(F.slotDate(d.pickup_at)?', passage '+F.slotLabel(d.pickup_at):''):'sans livreur')+' · demande du '+when(row.created_at||row.updated_at)}));
 if(String(d.supplier_name||'').trim()||String(d.credit_reference||'').trim())body.append(el('p',{class:'meta',text:'Ancien suivi du dossier — fournisseur : '+(d.supplier_name||'inconnu')+' · avoir : '+(d.credit_reference||'non renseigné')}));
 for(const line of d.lines){const {v,tags}=partsOf(row,line);body.append(el('article',{class:'line'},[el('strong',{text:line.reference}),el('p',{text:line.description||'Désignation non renseignée'}),el('p',{class:'counts',text:'Attendu '+v.expected+' · Reçu '+(line.received_quantity===null||line.received_quantity===undefined||line.received_quantity===''?'—':v.received)}),tags.length?el('p',{class:'tags',text:tags.join(' · ')}):null,line.reason?el('p',{class:'meta',text:line.reason}):null]));}
 body.append(el('h3',{text:'Historique'}),el('div',{id:'events'},journal?journal.map(e=>el('p',{class:e.event_kind,text:when(e.created_at)+' · '+F.eventLine(e,d.lines)+(e.actor_label?' · par '+e.actor_label:'')+(e.note?' · '+e.note:'')})):[el('p',{class:'meta',text:'Chargement de l’historique…'})]));}
async function loadJournal(id){try{const events=await call('shared_return_events',{case_id:id});if(historyOpen!==id)return;journal=events;}catch{if(historyOpen!==id)return;journal=[];say('Historique indisponible pour le moment.',true);}if(role==='office'&&queue==='history')paintOffice();}

/* ---- Livreur · Mes collectes ---- */
function paintDriver(){const select=$('driverName'),me=store.get('repclick_returns_collector');if(!select.options.length){select.append(new Option('Choisir mon nom…',''));for(const c of C.COLLECTORS)select.append(new Option(c.name,c.id));}select.value=C.collector(me)?me:'';
 const list=F.mine(cases,select.value);$('driverCount').textContent=list.length?String(list.length):'';
 if(!select.value)return $('driverList').replaceChildren(emptyList('Choisissez votre nom pour voir vos collectes.'));
 $('driverList').replaceChildren(...(list.length?list.map(row=>{const d=row.document,taken=el('button',{type:'button',class:'primary big',text:'Pris',data:{taken:row.id}});
  taken.onclick=()=>{if(!confirm('Confirmer : pièces prises chez '+d.client_name+' ?'))return;act(async()=>{adopt(first(await call('shared_return_taken',{case_id:row.id,expected_version:row.version,actor_label:C.collectorName(select.value)})));say('Pris : '+d.client_name+'. Les pièces partent en réception.');paintDriver();});};
  return el('article',{class:'case requested',data:{case:row.id}},[el('h3',{text:d.client_name}),el('p',{class:'case-place',text:'Emplacement du carton : '+(String(d.pickup_location||'').trim()||'non indiqué')}),el('p',{class:'case-info',text:pieces(d)}),
   el('p',{class:'case-slot'+(F.late(d.pickup_at)?' late':''),text:'Passage prévu : '+F.slotLabel(d.pickup_at)+(F.late(d.pickup_at)?' · en retard':'')}),taken]);}):[emptyList('Aucune collecte à faire.')]));}

/* ---- Réception: scan, qualify at once, declare what is missing at the end. ---- */
function paintReception(){const body=$('receptionBody');body.replaceChildren();const open=receiving&&caseById(receiving),list=F.receiving(cases,actions);
 if(open&&list.some(r=>r.dossier.id===open.id))return paintReceiving(body,open);receiving='';pending=null;finishing=null;
 body.append(el('h2',{},[el('span',{text:'Réception '}),el('span',{class:'count'+(list.length?'':' zero'),text:String(list.length)})]),el('p',{class:'meta',text:'Dossiers pris par un livreur. Ouvrez-en un, scannez chaque pièce et dites aussitôt si elle est conforme ou abîmée.'}));
 body.append(list.length?el('div',{class:'case-grid'},list.map(({dossier,legacy})=>{const pr=F.progress(dossier),go=el('button',{type:'button',class:'primary',text:legacy?'Qualifier':'Réceptionner',data:{receive:dossier.id}});go.onclick=()=>{receiving=dossier.id;pending=null;finishing=null;damagedFor='';paintReception();};
  return el('article',{class:'case collected',data:{case:dossier.id}},[el('h3',{text:dossier.document.client_name}),el('p',{class:'case-info',text:legacy?'Pièces déjà reçues à qualifier':plural(pr.expected,'pièce attendue','pièces attendues')+' · reçu '+pr.received}),go]);})):emptyList('Aucun dossier en attente de réception.'));}
/* The two answers, wherever they are asked. « Abîmée » opens its short reason. */
function qualifyButtons(key,send){const box=el('div',{class:'qualify',data:{qualify:key}}),ok=el('button',{type:'button',class:'primary big',text:'Conforme',data:{state:'ok'}}),bad=el('button',{type:'button',class:'danger big',text:'Abîmée',data:{state:'damaged'}});
 ok.onclick=()=>send('ok','');bad.onclick=()=>{damagedFor=key;paintReception();document.querySelector('[data-reason="'+key+'"]')?.focus();};box.append(el('div',{class:'row'},[ok,bad]));
 if(damagedFor===key){const reason=el('input',{maxLength:200,placeholder:'Motif court (obligatoire) : ex. carton écrasé',ariaLabel:'Motif de la pièce abîmée',data:{reason:key}}),note=el('p',{class:'error',role:'status'}),go=el('button',{type:'button',class:'primary',text:'Enregistrer abîmée',data:{state:'damaged-save'}});
  const save=()=>{if(!A.space(reason.value)){note.textContent='Indiquez le motif : il suit la pièce dans « Pièces abîmées ».';return;}send('damaged',reason.value);};go.onclick=save;reason.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save();}};box.append(el('label',{text:'Motif'},[reason]),note,el('div',{class:'row'},[go]));}
 return box;}
function paintReceiving(body,dossier){const d=dossier.document,inReception=d.status==='collected',pr=F.progress(dossier),back=el('button',{type:'button',class:'secondary',text:'← Autres dossiers',data:{back:'reception'}});back.onclick=()=>{receiving='';pending=null;finishing=null;damagedFor='';stopCamera();paintReception();};
 body.append(el('div',{class:'row head'},[el('h2',{id:'receptionTitle',text:'Réception · '+d.client_name}),back]),el('p',{id:'receptionProgress',class:'summary',text:'Reçu '+pr.received+' / '+pr.expected}));
 if(inReception&&!F.typeOk(d.type))body.append(el('p',{class:'alert-error',text:'Le type de ce dossier doit être précisé par le service Retours : une pièce conforme ne peut pas encore être classée. Une pièce abîmée peut l’être.'}));
 const feedback=el('p',{id:'receiveFeedback',role:'status',class:paintReceiving.note?.error?'error':paintReceiving.note?'success':'',text:paintReceiving.note?.text||''});
 if(inReception&&!finishing){
  if(pending){body.append(el('section',{class:'pending-part',data:{pending:pending.line_id}},[el('h3',{text:pending.reference}),el('p',{text:pending.description||'Désignation non renseignée'}),el('p',{class:'meta',text:'Pièce '+(pending.received+1)+' sur '+pending.quantity+' attendue'+(pending.quantity>1?'s':'')+'. Conforme ou abîmée ?'}),
    qualifyButtons('scan',(state,reason)=>receivePart(dossier,state,reason)),(()=>{const no=el('button',{type:'button',class:'secondary',text:'Annuler ce scan',data:{cancelScan:'1'}});no.onclick=()=>{pending=null;damagedFor='';paintReceiving.note=null;paintReception();focusScan();};return no;})()]));}
  else{const code=el('input',{id:'receiveCode',maxLength:256,autocomplete:'off',autocapitalize:'characters',spellcheck:false,enterKeyHint:'done',placeholder:'Scannez ou saisissez la référence de la pièce',ariaLabel:'Référence ou code-barres de la pièce reçue'}),go=el('button',{type:'button',class:'primary',text:'Valider',data:{scan:'1'}}),cam=el('button',{type:'button',class:'secondary',text:'Scanner'});
   go.onclick=()=>identify(dossier,code.value);code.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();identify(dossier,code.value);}};cam.onclick=()=>startCamera(value=>identify(dossier,value),feedback);body.append(el('section',{class:'add'},[el('div',{class:'row'},[code,go,cam])]));}}
 body.append(feedback);
 if(finishing)body.append(finishBox(dossier));
 const lines=el('div',{id:'receptionLines'});for(const line of d.lines){const {v,tags}=partsOf(dossier,line),card=el('article',{class:'line'+(v.complete?' done':'')+(pending?.line_id===line.id?' current':''),data:{line:line.id}},[el('strong',{text:line.reference}),el('p',{text:line.description||'Désignation non renseignée'}),el('p',{class:'counts',text:'Attendu '+v.expected+' · Reçu '+v.received}),tags.length?el('p',{class:'tags',text:tags.join(' · ')}):null]);
  if(v.unqualified&&!pending)card.append(el('p',{class:'undecided',text:plural(v.unqualified,'pièce déjà reçue','pièces déjà reçues')+' à qualifier :'}),qualifyButtons('line:'+line.id,(state,reason)=>qualifyUnit(dossier,line,state,reason)));
  // A qualification entered by mistake is taken back here, while the dossier is still in reception.
  if(inReception&&!pending&&!finishing)for(const a of actions.filter(a=>a.case_id===dossier.id&&a.line_id===line.id&&A.live(a)&&a.kind!=='missing'&&A.canCancel(a)&&!a.packed_quantity)){const fix=el('button',{type:'button',class:'secondary small',text:'Corriger « '+(a.kind==='damaged'?'Abîmée':'Conforme')+' × '+a.quantity+' »',data:{fix:a.id}});
   fix.onclick=()=>{if(!confirm('Reprendre la qualification de '+line.reference+' ? La pièce reste reçue ; vous direz à nouveau si elle est conforme ou abîmée.'))return;act(async()=>{keep(await call('shared_return_action_move',A.movePayload(a,'cancelled',{note:'Erreur de saisie à la réception'},agent())));paintReceiving.note=null;paintReception();});};card.append(fix);}
  lines.append(card);}
 body.append(el('h3',{text:'Pièces du dossier'}),lines);
 if(inReception&&!finishing){const end=el('button',{type:'button',class:'primary big',text:'Terminer la réception',data:{finish:dossier.id}});end.onclick=()=>startFinish(dossier);body.append(el('div',{class:'actions'},[end]));}
}
const focusScan=()=>{try{$('receiveCode')?.focus();}catch{}};
const note=(text,error=false)=>{paintReceiving.note=text?{text,error}:null;};
/* A scanned or typed code is checked by the server before anything is asked: unknown → refused, nothing created. */
async function identify(dossier,raw){const code=String(raw||'').trim().slice(0,256);if(!code||busy||pending)return;busy=true;try{const line=first(await call('shared_return_identify',{case_id:dossier.id,code}));pending={code,...line};damagedFor='';note('');}
 catch(e){note(message(e),true);navigator.vibrate?.([80,60,80]);}finally{busy=false;}await stopCamera();paintReception();if(!pending)focusScan();}
async function receivePart(dossier,state,reason){if(!pending)return;const part=pending;await act(async()=>{const row=first(await call('shared_return_receive_part',{case_id:dossier.id,code:part.code,part_state:state,reason,actor_label:agent()}));adopt({id:row.id,document:row.document,version:row.version,created_at:row.created_at,updated_at:row.updated_at});await loadActions();
  const line=row.document.lines.find(l=>l.id===row.line_id);pending=null;damagedFor='';note('✓ '+line.reference+' '+(state==='damaged'?'abîmée':'conforme')+' → '+F.destination(row.document.type,state)+' · reçu '+line.received_quantity+' / '+line.quantity);navigator.vibrate?.(60);})||note($('status').textContent,true);paintReception();if(!pending)focusScan();}
async function qualifyUnit(dossier,line,state,reason){await act(async()=>{keep(await call('shared_return_qualify',{case_id:dossier.id,line_id:line.id,part_state:state,reason,actor_label:agent()}));damagedFor='';await refreshCase(dossier.id);note('✓ '+line.reference+' '+(state==='damaged'?'abîmée':'conforme')+' → '+F.destination(dossier.document.type,state));})||note($('status').textContent,true);paintReception();}
/* End of the reception. Each part not scanned is named and ticked by the agent: nothing is missing by default. */
function startFinish(dossier){if(pending){note('Dites d’abord si la pièce scannée est conforme ou abîmée.',true);return paintReception();}
 if(dossier.document.lines.some(l=>F.unqualified(dossier,l,actions)>0)){note('Une pièce déjà reçue attend sa qualification : conforme ou abîmée.',true);return paintReception();}
 const gaps=F.missing(dossier);if(!gaps.length){if(confirm('Toutes les pièces sont reçues. Terminer la réception de '+dossier.document.client_name+' ?'))finish(dossier,[]);return;}
 finishing={ticked:new Set()};note('');paintReception();}
function finishBox(dossier){const gaps=F.missing(dossier),box=el('section',{class:'finish-box',data:{finishBox:dossier.id}}),go=el('button',{type:'button',class:'primary big',text:'Déclarer manquantes et terminer',disabled:gaps.some(g=>!finishing.ticked.has(g.line.id)),data:{confirmFinish:dossier.id}}),no=el('button',{type:'button',class:'secondary',text:'Continuer à scanner'});
 no.onclick=()=>{finishing=null;paintReception();focusScan();};go.onclick=()=>finish(dossier,gaps.map(g=>g.line.id));
 box.append(el('h3',{text:plural(gaps.length,'pièce n’a pas été scannée','pièces n’ont pas été scannées')}),el('p',{class:'meta',text:'Cochez chaque pièce pour la déclarer manquante. Si elle est là, continuez à scanner.'}),
  ...gaps.map(g=>{const tick=el('input',{type:'checkbox',checked:finishing.ticked.has(g.line.id),data:{missing:g.line.id}});tick.onchange=()=>{if(tick.checked)finishing.ticked.add(g.line.id);else finishing.ticked.delete(g.line.id);paintReception();};return el('label',{class:'tick'},[tick,el('span',{text:'Manquante : '+describe(g.line)+' × '+g.gap})]);}),el('div',{class:'row'},[go,no]));return box;}
async function finish(dossier,missing){const done=await act(async()=>{const row=adopt(first(await call('shared_return_finish',{case_id:dossier.id,missing_lines:missing,actor_label:agent()})));await loadActions();finishing=null;receiving='';note('');say('Réception de '+dossier.document.client_name+' terminée'+(F.outcome(row,actions)?' : '+F.outcome(row,actions):'')+'.');});if(!done)note($('status').textContent,true);paintReception();}

/* ---- Camera: one scanner at a time, closed with whatever opened it. ---- */
async function stopCamera(){const old=scanner;scanner=null;$('scanner').hidden=true;if(old)try{await old.stop();old.clear();}catch{}}
async function startCamera(onCode,where){if(scanner||!actor)return;const s=new Html5Qrcode('reader');scanner=s;$('scanner').hidden=false;try{await s.start({facingMode:'environment'},{fps:10,qrbox:{width:260,height:120}},async code=>{if(Date.now()-lastAt<1600||code===lastCode)return;lastAt=Date.now();lastCode=code;await onCode(code);},()=>{});}catch{await stopCamera();where.textContent='Caméra indisponible. Vérifiez l’autorisation ou saisissez la référence.';}}

/* ---- Data ---- */
async function loadActions(){const [a,s]=await Promise.all([call('shared_return_actions'),call('shared_return_shipments')]);actions=a;shipments=s;}
async function refreshCase(id){const data=await call('shared_returns',{max_rows:500});cases=data;return caseById(id);}
async function load(){const token=epoch;const data=await call('shared_returns',{max_rows:500});if(token!==epoch)return;cases=data;await loadActions();}
/* Nothing typed is ever replaced by the refresh: it waits while a field is in use or a step is open. */
const idle=()=>!busy&&!pending&&!finishing&&!draftRequest&&!planFor&&!damagedFor&&!cartonOf&&![...plans.values()].some(p=>p.touched)&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
async function refresh(){if(!actor||!ready||document.hidden||!idle())return;try{await load();if(idle()){plans.clear();paint();}}catch{}}
async function enter(){epoch++;actor=SharedAccess.ACTOR;const token=epoch;try{
  try{ready=await call('shared_returns_flow')===1;}catch(e){if(e?.code!=='PGRST202')throw e;ready=false;}if(token!==epoch)return;
  $('notReady').hidden=ready;$('notReady').textContent=ready?'':'Écran indisponible : la mise à jour de la base « returns-roles.sql » n’est pas encore appliquée. Aucune donnée n’est modifiée.';if(!ready){say('Mise à jour de la base attendue.',true);return;}
  const partners=await call('shared_partners',{partner_kind:null});if(token!==epoch)return;clients=partners.filter(p=>p.kind==='client'&&!p.details?.archived&&!p.details?.merged_into).sort((a,b)=>a.name.localeCompare(b.name,'fr'));suppliers=partners.filter(p=>p.kind==='supplier'&&!p.details?.archived).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  await load();if(token!==epoch)return;$('workspace').hidden=false;role=Object.hasOwn(ROLES,store.get('repclick_returns_role'))?store.get('repclick_returns_role'):'';
  // Arriving from « Départs » with a garage name opens the history on that garage.
  const wanted=typeof SectionLinks!=='undefined'?SectionLinks.param('q'):'';if(wanted){role='office';queue='history';historyQuery=wanted;}
  paint();say('Prêt. Les listes s’actualisent toutes les 30 secondes.');}catch(e){if(token===epoch)say(e?.code==='42501'||e?.code==='PT401'?SharedAccess.message(e):'Retours indisponibles'+(e?.message?' : '+e.message:'')+'.',true);}}

$('roleOffice').onclick=()=>setRole('office');$('roleDriver').onclick=()=>setRole('driver');$('roleReception').onclick=()=>setRole('reception');$('stopCamera').onclick=stopCamera;
$('agent').value=store.get('repclick_returns_agent');$('agent').oninput=()=>store.set('repclick_returns_agent',agent());
$('driverName').onchange=()=>{store.set('repclick_returns_collector',$('driverName').value);paintDriver();};
window.addEventListener('pagehide',()=>{stopCamera();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
setInterval(refresh,30000);
enter();
})();
