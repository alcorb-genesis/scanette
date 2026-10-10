/* The whole per-part journey, driven through the real page script (returns.js) against the test
   double of the server (returns-fake-server.js): reception by exact scan, manual exception,
   decisions, supplier carton, customer credit, stock, closing. The page is run on a small stand-in
   for the DOM: enough to click what an agent clicks and read what an agent reads. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createReturnsFakeServer}=require('./returns-fake-server.js');
const read=f=>fs.readFileSync(f,'utf8'),html=read('returns.html');
function dom(){
 class Node{constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.className='';this._text='';this.open=false;const self=this;this.classList={toggle(name,on){const set=new Set(self.className.split(/\s+/).filter(Boolean));if(on??!set.has(name))set.add(name);else set.delete(name);self.className=[...set].join(' ');},contains:name=>self.className.split(/\s+/).includes(name)};}
  set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
  append(...kids){for(const k of kids){if(k&&typeof k==='object'){k.parentElement=this;this.children.push(k);}}}
  replaceChildren(...kids){this.children=[];this._text='';this.append(...kids);}
  get lastChild(){return this.children.at(-1)||null;}get options(){return this.children.filter(c=>c.isOption);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  focus(){}select(){}click(){this.onclick?.({});}scrollIntoView(){}setAttribute(k,v){this[k]=v;}
  reset(){for(const n of all(this))if(['INPUT','SELECT'].includes(n.tagName))n.value='';}}
 const ids=new Map(),tagOf=id=>(html.match(new RegExp('<([a-z0-9]+)[^>]*id="'+id+'"'))||[])[1]||'div';
 for(const [,id] of html.matchAll(/id="([^"]+)"/g)){const n=new Node(tagOf(id));n.id=id;if(new RegExp('id="'+id+'"[^>]*hidden').test(html))n.hidden=true;ids.set(id,n);}
 const root=new Node('body');for(const n of ids.values())root.append(n);
 function all(node,out=[]){for(const c of node.children){out.push(c);all(c,out);}return out;}
 const document={hidden:false,body:root,getElementById:id=>ids.get(id)||(()=>{throw Error('unknown id '+id);})(),createElement:tag=>new Node(tag),addEventListener(){},
  querySelectorAll:()=>[],querySelector:sel=>{const m=sel.match(/^\[data-([a-z-]+)="(.*)"\]$/);if(!m)return null;const key=m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return all(root).find(n=>n.dataset[key]===m[2]&&visible(n))||null;}};
 function visible(n){for(let x=n;x;x=x.parentElement)if(x.hidden||(x.tagName==='DETAILS'&&x!==n&&!x.open&&x.children[0]!==n&&!inSummary(n,x)))return false;return true;}
 function inSummary(n,details){for(let x=n;x&&x!==details;x=x.parentElement)if(x.tagName==='SUMMARY')return true;return false;}
 class Option extends Node{constructor(text,value){super('option');this._text=text;this.value=value;this.isOption=true;}}
 return {document,ids,root,all,visible,Option,Node};}
const garage={id:'g1',kind:'client',name:'CN AUTO',details:{},departures:[]},apo={id:'s1',kind:'supplier',name:'APO',details:{}},bosch={id:'s2',kind:'supplier',name:'Bosch',details:{}};
const products=[{id:'p1',reference:'LX 1780',description:'Filtre à air',internal_barcode:'2000000000017',manufacturer_barcode:'4009026000014'},{id:'p2',reference:'GDB1330',description:'Plaquettes',internal_barcode:null,manufacturer_barcode:'3322937000000'},{id:'p9',reference:'LX 1781',description:'Autre filtre',internal_barcode:null,manufacturer_barcode:'4009026000021'}];
const collected=()=>({id:'11111111-aaaa-4000-8000-000000000001',version:2,created_at:'2026-10-05T08:00:00Z',updated_at:'2026-10-06T08:00:00Z',document:{type:'return',status:'collected',client_id:'g1',client_name:'CN AUTO',supplier_id:null,supplier_name:'',collector:'charlie',pickup_location:'Carton accueil',portal:true,source:'public_portal',garage_verified:true,lines:[
 {id:'l1',product_id:'p1',reference:'LX 1780',description:'Filtre à air',quantity:2,received_quantity:null,condition:'',reason:''},{id:'l2',product_id:null,reference:'GDB1330',description:'',quantity:1,received_quantity:null,condition:'',reason:''},{id:'l3',product_id:null,reference:'W 712',description:'Filtre à huile',quantity:1,received_quantity:null,condition:'',reason:''}]}});
async function page({missing=[]}={}){const d=dom(),server=createReturnsFakeServer({cases:[collected()],partners:[garage,apo,bosch],products}),exports=[],asked=[];let answer='Erreur de saisie';
 const SharedAccess={ACTOR:'shared',message:e=>'Accès fermé ('+e.code+')',
  // Refusals arrive as shared-access.js hands them over: an Error with a generic sentence, the code, and the server wording in « original ».
  call:async(name,args)=>{try{if(missing.includes(name))throw {code:'PGRST202',message:'missing'};return server.call(name,args);}catch(e){if(e&&e.code&&!(e instanceof Error))throw Object.assign(Error('Opération refusée par le serveur.'),{code:e.code,original:e.message});throw e;}}};
 const win={addEventListener(){}};const context={document:d.document,window:win,parent:win,location:{origin:'https://test.local',search:''},navigator:{},localStorage:{getItem:()=>'',setItem(){}},SharedAccess,ReturnsCore:require('./returns-core.js'),ReturnsActions:require('./returns-actions-core.js'),PartnerPlanning:require('./partner-planning-core.js'),
  Option:d.Option,crypto:{randomUUID:()=>'99999999-0000-4000-8000-'+String(Math.random()).slice(2,14).padEnd(12,'0')},structuredClone,Date,Promise,Set,Map,JSON,Math,Number,String,Object,Array,Error,RegExp,isNaN,setTimeout,setInterval(){},
  confirm:q=>{asked.push(q);return true;},prompt:q=>{asked.push(q);return answer;},File:class{constructor(parts,name){this.name=name;this.text=parts.join('');exports.push(this);}},URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Html5Qrcode:class{}};
 context.window.parent=context.window;vm.runInNewContext(read('returns.js'),context);
 const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};await tick();
 const $=id=>d.ids.get(id),shown=root=>d.all(root).filter(n=>d.visible(n)),text=n=>n.textContent.replace(/\s+/g,' ').trim();
 const button=(root,label)=>{const b=shown(root).find(n=>n.tagName==='BUTTON'&&text(n).includes(label));assert.ok(b,'button « '+label+' »');return b;};
 const click=async(root,label)=>{const b=button(root,label);assert.equal(b.disabled,false,'« '+label+' » is enabled');b.onclick({});await tick();};
 const by=(root,key,value)=>shown(root).filter(n=>n.dataset[key]===value);
 return {d,server,$,shown,text,button,click,by,tick,exports,asked,setAnswer:v=>{answer=v;}};}
const line=(p,id)=>p.by(p.$('lines'),'line',id)[0];
async function scan(p,code){p.$('receiveCode').value=code;p.$('receiveAdd').onclick({});await p.tick();return p.text(p.$('receiveFeedback'));}
async function decide(p,lineId,kind,fill){const l=line(p,lineId);p.by(l,'kind',kind)[0].onclick({});await p.tick();const form=p.shown(line(p,lineId)).find(n=>n.className==='decision-form');const inputs=p.shown(form).filter(n=>['INPUT','SELECT'].includes(n.tagName));fill?.(inputs);await p.click(form,'Enregistrer cette suite');const still=p.shown(line(p,lineId)).find(n=>n.className==='decision-form');return still?p.text(p.shown(still).find(n=>n.className==='error')):'ok';}

test('reception screen: garage, expected and received, scanner — no pickup place, no product record',async()=>{const p=await page();
 p.$('viewReceive').onclick({});assert.equal(p.text(p.$('receiveCount')),'1');const card=p.text(p.$('receiveList'));assert.match(card,/CN AUTO/);assert.match(card,/4 pièces attendues · 3 références/);assert.doesNotMatch(card,/Carton accueil/);
 await p.click(p.$('receiveList'),'Réceptionner');const screen=p.shown(p.$('editor')).map(n=>n._text).join(' | ');
 assert.match(p.text(p.$('title')),/CN AUTO/);assert.equal(p.$('receiveBox').hidden,false);assert.equal(p.$('placeLabel').hidden,true);assert.equal(p.$('identity').hidden,true);assert.equal(p.$('addBox').hidden,true);
 assert.doesNotMatch(screen,/Carton accueil|Fiche catalogue|Emplacement dans le garage/);assert.match(p.text(p.$('linesTitle')),/reçu 0 \/ 4 · 3 lignes à contrôler/);
 assert.match(p.text(line(p,'l1')),/LX 1780 Filtre à air Attendu 2 Reçu —/);assert.match(p.text(line(p,'l2')),/GDB1330 Désignation non renseignée Attendu 1/);
});
test('the whole journey: exact scans, manual exception, decisions, carton, credit, stock, closing',async()=>{const p=await page();p.$('agent').value='Léa';
 p.$('viewReceive').onclick({});await p.click(p.$('receiveList'),'Réceptionner');
 // Reception: only an exact code of a line of this dossier.
 for(const near of ['LX 1781','4009026000021','LX1780','LX 178','W712'])assert.match(await scan(p,near),/ne correspond exactement à aucune ligne/,near);
 assert.equal(p.server.db.cases[0].document.lines.every(l=>l.received_quantity===null),true,'nothing received by a refused scan');
 assert.equal(await scan(p,'lx 1780'),'✓ LX 1780 : 1 reçue sur 2 attendues.');assert.equal(await scan(p,'4009026000014'),'✓ LX 1780 : 2 reçues sur 2 attendues.');
 assert.match(await scan(p,'LX 1780'),/déjà reçue en totalité/,'no unit beyond what was announced');
 assert.equal(await scan(p,'3322937000000'),'✓ GDB1330 : 1 reçue sur 1 attendue.');assert.match(p.text(line(p,'l1')),/Attendu 2 Reçu 2/);
 await p.click(p.$('steps'),'Valider la réception contrôlée');assert.match(p.text(p.$('saved')),/quantité reçue pour W 712/,'a line is not controlled yet');
 // Manual exception, on the line itself, with its cause.
 p.by(line(p,'l3'),'manual','l3')[0].onclick({});await p.tick();let form=p.shown(line(p,'l3')).find(n=>n.className==='decision-form');assert.match(p.text(form),/Le scan reste la règle/);
 await p.click(form,'Enregistrer la saisie manuelle');assert.match(p.text(form),/Choisissez la raison/);
 const cause=p.shown(form).find(n=>n.tagName==='SELECT');assert.deepEqual(cause.options.map(o=>o._text),['Choisir la raison…','Pièce absente','Étiquette illisible']);cause.value='absent';cause.onchange({});
 await p.click(form,'Enregistrer la saisie manuelle');assert.match(p.text(p.$('receiveFeedback')),/W 712 : 0 reçue par saisie manuelle \(Pièce absente\)/);assert.match(p.text(line(p,'l3')),/Reçu 0 Motif : Pièce absente/);
 assert.equal(p.shown(p.$('lines')).some(n=>n.dataset.kind),false,'no decision is offered before the reception is validated');
 await p.click(p.$('steps'),'Valider la réception contrôlée');assert.match(p.text(p.$('saved')),/Réception validée/);assert.equal(p.server.db.cases[0].document.status,'received');assert.equal(p.$('receiveBox').hidden,true);
 // Decisions: explicit choices, short forms, consequences said.
 assert.deepEqual(p.shown(line(p,'l1')).filter(n=>n.dataset.kind).map(n=>p.text(n)),['＋ Abîmée','＋ Retour fournisseur','＋ Avoir client','＋ Attente de décision']);assert.match(p.text(line(p,'l3')),/aucune suite à donner/);
 assert.equal(await decide(p,'l1','damaged'),'Décrivez le dommage constaté.');assert.match(p.text(line(p,'l1')),/rejoint « Pièces abîmées » du garage/);
 assert.equal(await decide(p,'l1','damaged',i=>{i[0].value='1';i[1].value='Emballage ouvert';}),'ok');
 assert.equal(await decide(p,'l1','supplier_return'),'Choisissez le fournisseur du retour.');assert.equal(await decide(p,'l1','supplier_return',i=>{i[1].value='s1';}),'ok');
 assert.equal(await decide(p,'l1','customer_credit'),'Indiquez le numéro de BL, de facture ou de commande qui fonde l’avoir.');assert.equal(await decide(p,'l1','customer_credit',i=>{i[1].value='BL 123456';}),'ok');
 assert.equal(await decide(p,'l2','pending',i=>{i[1].value='À voir avec le comptoir';}),'ok');
 assert.deepEqual(p.shown(line(p,'l1')).filter(n=>n.className==='action-kind').map(n=>p.text(n)),['Abîmée × 1','Retour fournisseur × 2','Avoir client × 2'],'supplier return and customer credit on the same line');
 assert.equal(p.by(line(p,'l1'),'kind','supplier_return')[0].disabled,true,'the whole received quantity already has that decision');
 assert.equal(p.button(p.$('steps'),'Clôturer le dossier').disabled,true);assert.match(p.text(p.$('steps')),/3 suites en cours/);
 // Views: the same decisions, filtered.
 p.$('viewSuites').onclick({});const tab=async t=>{p.by(p.$('suiteTabs'),'tab',t)[0].onclick({});await p.tick();},unfold=async()=>{for(const d of p.shown(p.$('suiteBody')).filter(n=>n.tagName==='DETAILS'&&!n.open)){d.open=true;d.ontoggle({});}await p.tick();};
 assert.deepEqual(p.shown(p.$('suiteTabs')).filter(n=>n.dataset.tab).map(n=>p.text(n)),['À traiter 1','Pièces abîmées 1','Fournisseurs 1','Avoirs clients 1','Stock / clôturés 0']);
 assert.match(p.text(p.$('suiteBody')),/Attente de décision × 1 En attente GDB1330 · Désignation non renseignée CN AUTO/);
 await tab('damaged');await unfold();assert.match(p.text(p.$('suiteBody')),/CN AUTO 1 .*Abîmée × 1 Constatée LX 1780 · Filtre à air .*Emballage ouvert/);
 // Supplier carton: counter, one unit per exact scan, cannot leave incomplete.
 await tab('supplier');await unfold();assert.match(p.text(p.$('suiteBody')),/APO 1 1 ligne à envoyer · 0 dans le carton · 0 envoyée/);await p.click(p.$('suiteBody'),'Préparer un carton APO');
 const carton=()=>p.shown(p.$('suiteBody')).find(n=>n.className==='carton'),counter=()=>p.text(p.shown(carton()).find(n=>n.className.startsWith('carton-count'))),pack=async code=>{const input=p.by(carton(),'cartonCode','s1')[0];input.value=code;await p.click(carton(),'Ajouter au carton');const note=p.shown(carton()).find(n=>n.role==='status');return p.text(note)||p.text(p.$('status'));};
 assert.match(counter(),/Scanné 0 \/ 0/);assert.equal(p.button(carton(),'Carton envoyé').disabled,true,'an empty carton cannot leave');
 for(const wrong of ['LX 1781','GDB1330','LX1780'])assert.match(await pack(wrong),/Rien n’a été ajouté au carton/,wrong);
 assert.equal(await pack('LX 1780'),'✓ Dans le carton APO : 1 / 2.');assert.equal(counter(),'Scanné 1 / 2 pièces');assert.equal(p.button(carton(),'Carton envoyé').disabled,true,'an incomplete carton cannot leave');
 assert.equal(await pack('2000000000017'),'✓ Dans le carton APO : 2 / 2.');assert.equal(counter(),'Scanné 2 / 2 pièces');assert.match(p.text(carton()),/2 \/ 2 · LX 1780 · Filtre à air · CN AUTO · \d\d\/\d\d\/\d{4}/,'readable list: reference, designation, garage, date');
 assert.match(await pack('LX 1780'),/Rien n’a été ajouté au carton/,'a third unit does not exist');await p.click(carton(),'Manifeste CSV');assert.match(p.exports.at(-1).text,/"LX 1780";"Filtre à air";"2";"";"APO";"";"Retour fournisseur";"Dans le carton";""/);
 await p.click(carton(),'Carton envoyé');assert.equal(p.text(p.$('status')),'Carton APO envoyé.');assert.equal(p.server.db.actions.find(a=>a.kind==='supplier_return').status,'sent');assert.equal(p.server.db.shipments[0].status,'sent');
 // Customer credit: export, issued, then stock with a destination.
 await tab('credit');await unfold();assert.match(p.text(p.$('suiteBody')),/CN AUTO · BL 123456 1/);await p.click(p.$('suiteBody'),'Exporter les avoirs à traiter');
 const csv=p.exports.at(-1).text.replace('﻿','').split('\r\n');assert.equal(csv[0],'"Date";"Garage";"Dossier";"Référence";"Désignation";"Quantité";"BL / facture / commande";"Fournisseur";"Motif / commentaire";"Suite";"Statut";"Destination stock"');
 assert.match(csv[1],/^"\d\d\/\d\d\/\d{4}";"CN AUTO";"R-11111111";"LX 1780";"Filtre à air";"2";"BL 123456";"APO";"";"Avoir client";"Avoir à faire";""$/);
 await p.click(p.$('suiteBody'),'Avoir édité');await unfold();assert.match(p.text(p.$('suiteBody')),/Avoir client × 2 Avoir édité/);
 await p.click(p.$('suiteBody'),'Remis en stock');await unfold();await p.click(p.$('suiteBody'),'Confirmer la remise en stock');assert.match(p.text(p.$('suiteBody')),/Indiquez où la pièce est remise en stock/,'the destination is mandatory');assert.equal(p.server.db.actions.find(a=>a.kind==='customer_credit').status,'issued');
 const credit=p.server.db.actions.find(a=>a.kind==='customer_credit');p.by(p.$('suiteBody'),'stockPlace',credit.id)[0].value='Allée A12C';await p.click(p.$('suiteBody'),'Confirmer la remise en stock');
 assert.equal(credit.status,'restocked');assert.equal(credit.stock_destination,'Allée A12C');assert.match(p.text(p.$('status')),/Remis en stock : Allée A12C/);
 await tab('stock');await unfold();assert.match(p.text(p.$('suiteBody')),/Remis en stock 1 .*LX 1780 · Filtre à air .*Remis en stock : Allée A12C/);assert.match(p.text(p.$('suiteBody')),/Clôturés sans stock 0/);
 // Back to the dossier and its journal; the dossier closes once nothing runs.
 await tab('toDecide');await p.click(p.$('suiteBody'),'Décision prise');assert.match(p.text(p.$('suiteBody')),/Aucune pièce en attente de décision/);
 await tab('damaged');await unfold();await p.click(p.$('suiteBody'),'Dossier et historique');assert.match(p.text(p.$('title')),/CN AUTO/);assert.equal(p.$('editor').hidden,false);
 const journal=p.text(p.$('events'));for(const said of ['Collecté → Reçu et contrôlé','Abîmée · LX 1780 : Constatée · par Léa · Emballage ouvert','Retour fournisseur · LX 1780 : Dans le carton → Envoyée au fournisseur · par Léa','Avoir client · LX 1780 : Avoir édité → Remis en stock · par Léa · Destination : Allée A12C','Attente de décision · GDB1330 : En attente → Décision prise · par Léa'])assert.ok(journal.includes(said),said);
 await p.click(p.$('steps'),'Clôturer le dossier');assert.equal(p.server.db.cases[0].document.status,'closed');assert.match(p.text(p.$('summary')),/^Clôturé/);
 assert.deepEqual(p.server.db.cases[0].document.lines.map(l=>l.received_quantity),[2,1,0],'the reception was never rewritten by a decision');
});
test('refusals are read as the shared access hands them over',()=>{const A=require('./returns-actions-core.js'),access=read('shared-access.js');
 assert.match(access,/Object\.assign\(Error\(message\(error\)\),\{code:error\.code,original:error\.message\}\)/,'the stand-in of this test copies this shape');
 assert.match(A.serverMessage(Object.assign(Error('générique'),{code:'PT404',original:'Not a part of this dossier'})),/aucune ligne de ce dossier/);assert.match(A.serverMessage(Object.assign(Error('générique'),{code:'PT404',original:'No waiting part for this code'})),/ajouté au carton/);
 assert.match(A.serverMessage(Object.assign(Error('générique'),{code:'22023',original:'Line already complete'})),/déjà reçue en totalité/);
});
test('the page declares nothing by itself: reception, carton and sending are answers of the server',async()=>{const js=read('returns.js');
 assert.doesNotMatch(js,/received_quantity\s*=|receiveUnit|matchLine/,'no received quantity is written by the page');assert.doesNotMatch(js,/status:'packed'|status:'sent'|to_status:'packed'|to_status:'sent'/);
 for(const fn of ['shared_return_receive','shared_return_receive_line','shared_return_actions','shared_return_shipments','shared_return_action_add','shared_return_action_move','shared_return_shipment_open','shared_return_pack','shared_return_shipment_send'])assert.equal(js.split("call('"+fn+"'").length-1,1,fn+' is called from one place');
 assert.doesNotMatch(js,/shared_products_search|CatalogueSearch|Fiche catalogue/);assert.match(read('build.cjs'),/'returns-actions-core\.js'/);assert.doesNotMatch(read('build.cjs'),/returns-fake-server/,'the test double is never published');
});
test('without the migration the follow-ups say so and the rest of the screen works',async()=>{const p=await page({missing:['shared_return_actions','shared_return_shipments']});
 p.$('viewSuites').onclick({});assert.equal(p.$('suitesOff').hidden,false);assert.match(p.text(p.$('suitesOff')),/returns-actions\.sql/);p.$('viewCollect').onclick({});assert.equal(p.$('groups').children.length,10);
});
test('nothing of this appears on the garage portal',()=>{const pub=['returns-portal.html','returns-portal.js','returns-portal-core.js','returns-portal.css'].map(read).join('\n');
 assert.doesNotMatch(pub,/returns-actions|ReturnsActions|shared_return|fake-server|abîm|fournisseur|avoir|manifeste|remis en stock|saisie manuelle|historique/i);
});
