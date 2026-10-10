/* The returns screen, role by role, driven through the real page script (returns.js) against the
   test double of the server (returns-fake-server.js): a collection organised then taken, a
   reception where each scanned part is qualified at once, and the sorted lists of the returns desk.
   The page runs on a small stand-in for the DOM: enough to click what an agent clicks and read
   what an agent reads. */
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
 /* The elements of the page that bear an id, nested as in returns.html, with their own text: a
    hidden section hides what it contains, as in a browser. */
 const ids=new Map(),root=new Node('body'),stack=[{node:root}],VOID=['input','meta','link','br','img'];
 for(const m of html.slice(html.indexOf('<body')).matchAll(/<(\/?)([a-z0-9]+)([^>]*)>([^<]*)/g)){const [,closing,tag,attrs,after]=m;if(tag==='script'||tag==='body')continue;
  if(closing){for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break;}continue;}
  const id=(attrs.match(/\bid="([^"]+)"/)||[])[1];let node=null;
  if(id){node=new Node(tag);node.id=id;node._text=after.trim();if(/\shidden(\s|$)/.test(attrs+' '))node.hidden=true;ids.set(id,node);stack.findLast(e=>e.node).node.append(node);}
  if(!VOID.includes(tag))stack.push({tag,node});}
 function all(node,out=[]){for(const c of node.children){out.push(c);all(c,out);}return out;}
 const document={hidden:false,body:root,getElementById:id=>ids.get(id)||(()=>{throw Error('unknown id '+id);})(),createElement:tag=>new Node(tag),addEventListener(){},
  querySelectorAll:()=>[],querySelector:sel=>{const m=sel.match(/^\[data-([a-z-]+)="(.*)"\]$/);if(!m)return null;const key=m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return all(root).find(n=>n.dataset[key]===m[2]&&visible(n))||null;}};
 function visible(n){for(let x=n;x;x=x.parentElement)if(x.hidden||(x.tagName==='DETAILS'&&x!==n&&!x.open&&x.children[0]!==n&&!inSummary(n,x)))return false;return true;}
 function inSummary(n,details){for(let x=n;x&&x!==details;x=x.parentElement)if(x.tagName==='SUMMARY')return true;return false;}
 class Option extends Node{constructor(text,value){super('option');this._text=text;this.value=value;this.isOption=true;}}
 return {document,ids,root,all,visible,Option,Node};}
const charlie14={carrier:'Charlie',time:'14:30',days:[1,2,3,4,5,6,7]};
const cnAuto={id:'g1',kind:'client',name:'CN AUTO',details:{},departures:[charlie14]},loin={id:'g2',kind:'client',name:'GARAGE DU LAC',details:{},departures:[]},apo={id:'s1',kind:'supplier',name:'APO',details:{}},bosch={id:'s2',kind:'supplier',name:'Bosch',details:{}};
const products=[{id:'p1',reference:'LX 1780',description:'Filtre à air',internal_barcode:'2000000000017',manufacturer_barcode:'4009026000014'},{id:'p9',reference:'LX 1781',description:'Autre filtre',internal_barcode:null,manufacturer_barcode:'4009026000021'}];
const line=(id,reference,quantity,extra={})=>({id,product_id:null,reference,description:'',quantity,received_quantity:null,condition:'',reason:'',...extra});
const R1='11111111-aaaa-4000-8000-000000000001',R2='22222222-aaaa-4000-8000-000000000002';
const requested=()=>[
 {id:R1,version:1,created_at:'2026-10-05T08:00:00Z',updated_at:'2026-10-05T08:00:00Z',document:{type:'return',status:'requested',client_id:'g1',client_name:'CN AUTO',supplier_id:null,supplier_name:'',pickup_location:'Carton accueil',portal:true,source:'public_portal',garage_verified:true,
   lines:[line('l1','LX 1780',2,{product_id:'p1',description:'Filtre à air'}),line('l2','A1276',1),line('l3','W 712',1,{description:'Filtre à huile'})]}},
 {id:R2,version:1,created_at:'2026-10-06T08:00:00Z',updated_at:'2026-10-06T08:00:00Z',document:{type:'warranty',status:'requested',client_id:'g2',client_name:'GARAGE DU LAC',supplier_id:null,supplier_name:'',pickup_location:'Étagère atelier',lines:[line('l1','GDB1330',1,{description:'Plaquettes'}),line('l2','A1276',1)]}}];
async function page({cases=requested(),missing=[],stored={}}={}){const d=dom(),server=createReturnsFakeServer({cases,partners:[cnAuto,loin,apo,bosch],products}),exports=[],asked=[],memory={...stored};
 const SharedAccess={ACTOR:'shared',message:e=>'Accès fermé ('+e.code+')',
  // Refusals arrive as shared-access.js hands them over: an Error with a generic sentence, the code, and the server wording in « original ».
  call:async(name,args)=>{try{if(missing.includes(name))throw {code:'PGRST202',message:'missing'};return server.call(name,args);}catch(e){if(e&&e.code&&!(e instanceof Error))throw Object.assign(Error('Opération refusée par le serveur.'),{code:e.code,original:e.message});throw e;}}};
 const win={addEventListener(){}};const context={document:d.document,window:win,parent:win,location:{origin:'https://test.local',search:''},navigator:{},localStorage:{getItem:k=>memory[k]||'',setItem(k,v){memory[k]=String(v);}},SharedAccess,ReturnsCore:require('./returns-core.js'),ReturnsActions:require('./returns-actions-core.js'),ReturnsFlow:require('./returns-flow-core.js'),PartnerPlanning:require('./partner-planning-core.js'),
  Option:d.Option,crypto:{randomUUID:()=>'99999999-0000-4000-8000-'+String(Math.random()).slice(2,14).padEnd(12,'0')},structuredClone,Date,Promise,Set,Map,JSON,Math,Number,String,Object,Array,Error,RegExp,isNaN,setTimeout,setInterval(){},
  confirm:q=>{asked.push(q);return true;},File:class{constructor(parts,name){this.name=name;this.text=parts.join('');exports.push(this);}},URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Html5Qrcode:class{}};
 d.document.body.append=()=>{};context.window.parent=context.window;vm.runInNewContext(read('returns.js'),context);
 const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};await tick();
 const $=id=>d.ids.get(id),shown=root=>d.all(root).filter(n=>d.visible(n)),text=n=>n.textContent.replace(/\s+/g,' ').trim();
 const buttons=root=>shown(root).filter(n=>n.tagName==='BUTTON').map(text);
 const button=(root,label)=>{const b=shown(root).find(n=>n.tagName==='BUTTON'&&text(n)===label)||shown(root).find(n=>n.tagName==='BUTTON'&&text(n).startsWith(label));assert.ok(b,'button « '+label+' » among '+buttons(root).join(' | '));return b;};
 const click=async(root,label)=>{const b=button(root,label);assert.equal(b.disabled,false,'« '+label+' » is enabled');b.onclick({});await tick();};
 const by=(root,key,value)=>shown(root).filter(n=>n.dataset[key]===value),field=(root,label)=>{const f=shown(root).find(n=>n.ariaLabel===label);assert.ok(f,'field « '+label+' »');return f;};
 const role=async name=>{$({office:'roleOffice',driver:'roleDriver',reception:'roleReception'}[name]).onclick({});await tick();},queue=async id=>{by($('queues'),'queue',id)[0].onclick({});await tick();};
 const counts=()=>Object.fromEntries(shown($('queues')).filter(n=>n.dataset.queue).map(n=>[n.dataset.queue,text(n)]));
 const dossier=id=>server.db.cases.find(c=>c.id===id),acts=id=>server.db.actions.filter(a=>a.case_id===id).map(a=>a.line_id+':'+a.kind+':'+a.status+':'+a.quantity).sort().join(' ');
 return {d,server,$,shown,text,buttons,button,click,by,field,role,queue,counts,dossier,acts,tick,exports,asked,memory};}
const scanInput=p=>p.shown(p.$('receptionBody')).find(n=>n.id==='receiveCode');
async function scan(p,code){const input=scanInput(p);assert.ok(input,'the scan field is offered');input.value=code;await p.click(p.$('receptionBody'),'Valider');return p.text(p.shown(p.$('receptionBody')).find(n=>n.id==='receiveFeedback'));}
const feedback=p=>p.text(p.shown(p.$('receptionBody')).find(n=>n.id==='receiveFeedback'));
const pendingPart=p=>p.shown(p.$('receptionBody')).find(n=>n.className==='pending-part');
async function damaged(p,root,why){await p.click(root,'Abîmée');const reason=p.shown(p.$('receptionBody')).find(n=>n.dataset.reason);reason.value=why;await p.click(p.$('receptionBody'),'Enregistrer abîmée');}
const received=(p,id)=>p.dossier(id).document.lines.map(l=>l.received_quantity);

test('a role shows its own screen and nothing of the others; changing role leaves nothing open',async()=>{const p=await page();
 assert.equal(p.$('workspace').hidden,false);for(const id of ['office','driver','reception','agentLabel'])assert.equal(p.$(id).hidden,true,id+' is closed until a role is chosen');assert.deepEqual(p.buttons(p.$('workspace')),['Service Retours','Livreur','Réception']);
 await p.role('driver');assert.equal(p.$('driver').hidden,false);assert.equal(p.$('office').hidden,true);assert.equal(p.$('reception').hidden,true);assert.equal(p.$('agentLabel').hidden,true,'the driver is not asked a first name: his name is his identity');assert.equal(p.memory.repclick_returns_role,'driver','the device reopens on its role');
 await p.role('office');assert.equal(p.$('office').hidden,false);assert.equal(p.$('driver').hidden,true);
 assert.deepEqual(p.shown(p.$('queues')).filter(n=>n.dataset.queue).map(n=>p.text(n).replace(/ \d+$/,'')),['Collectes à organiser','Pièces abîmées','Avoirs clients','Retours fournisseur','Remise en stock','Écarts','Historique'],'the queues bear the names of the work');
 // A dossier opened in a role is not carried into another role, nor back.
 await p.server.call('shared_return_plan',{case_id:R1,collector:'charlie',pickup_at:'2026-10-13T14:30',case_type:'return',expected_version:1});await p.server.call('shared_return_taken',{case_id:R1,expected_version:null});
 const again=await page({cases:p.server.db.cases});await again.role('reception');await again.click(again.$('receptionBody'),'Réceptionner');assert.match(again.text(again.$('receptionBody')),/^Réception · CN AUTO/);
 await again.role('office');assert.equal(again.$('reception').hidden,true);await again.role('reception');assert.match(again.text(again.$('receptionBody')),/^Réception 1 Dossiers pris par un livreur/,'back on the list: no dossier survives a change of role');
 for(const q of ['organise','damaged','credits','suppliers','stock','gaps','history']){await again.role('office');await again.queue(q);assert.doesNotMatch(again.text(again.$('workspace')),/Suites|À traiter|Valider la réception|Enregistrer le dossier/,q);}
});

test('the whole cycle: organise, « Pris », scan and qualify at once, missing declared, then sorted lists down to the automatic closing',async()=>{const p=await page();p.$('agent').value='Nadia';
 /* 1. Service Retours organises the collections before they are taken. */
 await p.role('office');assert.equal(p.counts().organise,'Collectes à organiser 2');const body=p.$('queueBody'),card=id=>p.by(body,'case',id)[0];
 assert.match(p.text(card(R1)),/^CN AUTO Emplacement du carton : Carton accueil 4 pièces · Retour client Demande du .* déposée par le garage/);
 assert.equal(p.field(card(R1),'Type du dossier').value,'return');assert.equal(p.field(card(R1),'Livreur').value,'charlie');assert.match(p.text(card(R1)),/Proposé : Charlie, seul service connu de ce garage\. À confirmer\./);
 assert.match(p.field(card(R1),'Passage').options[0]._text,/^Passage : (aujourd’hui|demain) à 14:30$/,'the next known passage of this driver at this garage');
 await p.click(card(R1),'Affecter');assert.equal(p.dossier(R1).document.collector,'charlie');assert.match(p.dossier(R1).document.pickup_at,/^\d{4}-\d\d-\d\dT14:30$/);assert.equal(p.dossier(R1).document.status,'requested');assert.match(p.text(p.$('status')),/^CN AUTO : Charlie, passage (aujourd’hui|demain) à 14:30\.$/);
 // A garage without a known passage: nothing is invented, the day and hour are typed.
 assert.equal(p.field(card(R2),'Type du dossier').value,'warranty');assert.equal(p.field(card(R2),'Livreur').value,'');await p.click(card(R2),'Affecter');assert.match(p.text(card(R2)),/Choisissez le livreur\./);assert.equal(p.dossier(R2).version,1);
 p.field(card(R2),'Livreur').value='ace';p.field(card(R2),'Livreur').onchange({});await p.tick();assert.match(p.text(card(R2)),/Aucun passage connu de Ace chez ce garage : indiquez le jour et l’heure\./);
 await p.click(card(R2),'Affecter');assert.match(p.text(card(R2)),/Choisissez le passage : jour et heure\./);const when=p.field(card(R2),'Jour et heure du passage');when.value='2026-10-13T11:00';when.oninput({});await p.click(card(R2),'Affecter');
 assert.deepEqual([p.dossier(R2).document.collector,p.dossier(R2).document.pickup_at,p.dossier(R2).document.type],['ace','2026-10-13T11:00','warranty']);assert.equal(p.counts().organise,'Collectes à organiser 0');
 // Grouped by driver, and still modifiable while the parts are not taken.
 assert.deepEqual(p.shown(body).filter(n=>n.dataset.group).map(n=>p.text(n).split(' Emplacement')[0]),['Ace Transporteur 1 GARAGE DU LAC','Charlie Tournée interne 1 CN AUTO']);
 await p.click(card(R2),'Modifier');const edit=p.field(card(R2),'Jour et heure du passage');assert.equal(edit.value,'2026-10-13T11:00');edit.value='2026-10-14T09:15';edit.oninput({});await p.click(card(R2),'Enregistrer l’affectation');assert.equal(p.dossier(R2).document.pickup_at,'2026-10-14T09:15');assert.equal(p.dossier(R2).version,3);
 assert.match(p.server.db.events.filter(e=>e.case_id===R2).map(e=>e.event_kind+':'+e.actor_label+':'+e.note).join(' | '),/assigned:Nadia:Passage prévu : 2026-10-13 à 11:00 \| updated:Nadia:Passage prévu : 2026-10-14 à 09:15/);

 /* 2. The driver: his collections, one button. */
 await p.role('driver');assert.match(p.text(p.$('driverList')),/Choisissez votre nom/);p.$('driverName').value='charlie';p.$('driverName').onchange({});await p.tick();
 assert.match(p.text(p.$('driverList')),/^CN AUTO Emplacement du carton : Carton accueil 4 pièces Passage prévu : (aujourd’hui|demain) à 14:30( · en retard)? Pris$/);assert.deepEqual(p.buttons(p.$('driver')),['Pris'],'no dossier, no assignment, no administration');
 assert.doesNotMatch(p.text(p.$('driver')),/GARAGE DU LAC|LX 1780|Retour client|Garantie|Modifier|Affecter|Annuler/);
 await p.click(p.$('driverList'),'Pris');assert.match(p.asked.at(-1),/pièces prises chez CN AUTO/);assert.equal(p.dossier(R1).document.status,'collected');assert.match(p.text(p.$('driverList')),/Aucune collecte à faire\./);
 assert.equal(p.server.db.events.findLast(e=>e.case_id===R1).actor_label,'Charlie');
 p.$('driverName').value='ace';p.$('driverName').onchange({});await p.tick();await p.click(p.$('driverList'),'Pris');assert.equal(p.dossier(R2).document.status,'collected');
 // Once taken, the assignment is a fact: the returns desk no longer offers to change it, and the server refuses.
 await p.role('office');assert.equal(p.by(body,'case',R1).length,0);assert.equal(p.buttons(body).includes('Modifier'),false);
 assert.throws(()=>p.server.call('shared_return_plan',{case_id:R1,collector:'serge',pickup_at:'2026-10-15T09:00',case_type:'return',expected_version:p.dossier(R1).version}),e=>e.message==='Collection is frozen once taken');

 /* 3. Reception: only taken dossiers; each scanned part is qualified at once. */
 await p.role('reception');p.$('agent').value='Léa';const rb=p.$('receptionBody');assert.match(p.text(rb),/CN AUTO 4 pièces attendues · reçu 0 Réceptionner/);assert.doesNotMatch(p.text(rb),/Carton accueil|Charlie|Ace|Passage|Retour client|Garantie|Emplacement/,'nothing of the collection is shown to the receiving agent');
 await p.click(p.by(rb,'case',R1)[0],'Réceptionner');assert.match(p.text(rb),/^Réception · CN AUTO ← Autres dossiers Reçu 0 \/ 4/);
 // An unknown reference is refused and creates nothing.
 for(const near of ['LX 1781','4009026000021','LX1780','LX 178','INCONNUE'])assert.match(await scan(p,near),/Référence inconnue pour ce dossier : pièce refusée, rien n’est enregistré/,near);
 assert.deepEqual(received(p,R1),[null,null,null]);assert.equal(p.dossier(R1).document.lines.length,3);assert.equal(p.acts(R1),'');assert.equal(pendingPart(p),undefined);
 // A known part: the question comes at once, and nothing is received before the answer.
 await scan(p,'lx 1780');assert.match(p.text(pendingPart(p)),/^LX 1780 Filtre à air Pièce 1 sur 2 attendues\. Conforme ou abîmée \? Conforme Abîmée Annuler ce scan$/);assert.equal(scanInput(p),undefined,'no other scan before the answer');assert.deepEqual(received(p,R1),[null,null,null]);
 assert.equal(p.buttons(rb).includes('Terminer la réception'),true);await p.click(rb,'Terminer la réception');assert.match(feedback(p),/Dites d’abord si la pièce scannée est conforme ou abîmée/);assert.equal(p.dossier(R1).document.status,'collected');
 await p.click(pendingPart(p),'Conforme');assert.deepEqual(received(p,R1),[1,null,null]);assert.equal(p.acts(R1),'l1:customer_credit:to_do:1');assert.equal(feedback(p),'✓ LX 1780 conforme → Avoirs clients · reçu 1 / 2');
 // Damaged: the short reason is mandatory, and the part is in « Pièces abîmées » at once.
 await scan(p,'4009026000014');assert.match(p.text(pendingPart(p)),/Pièce 2 sur 2/);await p.click(pendingPart(p),'Abîmée');await p.click(rb,'Enregistrer abîmée');assert.match(p.text(pendingPart(p)),/Indiquez le motif : il suit la pièce dans « Pièces abîmées »\./);assert.deepEqual(received(p,R1),[1,null,null]);
 p.shown(rb).find(n=>n.dataset.reason).value='  Carton   écrasé ';await p.click(rb,'Enregistrer abîmée');assert.deepEqual(received(p,R1),[2,null,null]);assert.equal(p.acts(R1),'l1:customer_credit:to_do:1 l1:damaged:recorded:1');assert.equal(p.server.db.actions.find(a=>a.kind==='damaged').comment,'Carton écrasé');assert.equal(feedback(p),'✓ LX 1780 abîmée → Pièces abîmées · reçu 2 / 2');
 assert.match(await scan(p,'LX 1780'),/déjà reçue en totalité/,'no unit beyond what was announced');
 await p.role('office');assert.equal(p.counts().damaged,'Pièces abîmées 1','the damaged part is in its queue while the reception is still going on');await p.queue('damaged');assert.match(p.text(body),/CN AUTO 1 LX 1780 · Filtre à air × 1 CN AUTO · .* · dossier R-11111111 Motif : Carton écrasé/);
 await p.role('reception');p.$('agent').value='Léa';await p.click(p.by(rb,'case',R1)[0],'Réceptionner');assert.match(p.text(p.by(rb,'line','l1')[0]),/^LX 1780 Filtre à air Attendu 2 · Reçu 2 Conforme × 1 · Abîmée × 1 : Carton écrasé/);
 await scan(p,'A1276');await p.click(pendingPart(p),'Conforme');assert.deepEqual(received(p,R1),[2,1,null]);
 // The end: what was not scanned is named and ticked, never assumed.
 await p.click(rb,'Terminer la réception');const box=()=>p.shown(rb).find(n=>n.className==='finish-box');assert.match(p.text(box()),/^1 pièce n’a pas été scannée Cochez chaque pièce pour la déclarer manquante\. .* Manquante : W 712 · Filtre à huile × 1 Déclarer manquantes et terminer Continuer à scanner$/);
 assert.equal(p.button(box(),'Déclarer manquantes et terminer').disabled,true,'nothing is missing by default');assert.equal(p.dossier(R1).document.status,'collected');
 const tick=p.shown(box()).find(n=>n.dataset.missing==='l3');tick.checked=true;tick.onchange({});await p.tick();await p.click(box(),'Déclarer manquantes et terminer');
 assert.equal(p.dossier(R1).document.status,'received');assert.deepEqual(received(p,R1),[2,1,0]);assert.equal(p.dossier(R1).document.lines[2].reason,'Manquante : 1 sur 1');assert.equal(p.acts(R1),'l1:customer_credit:to_do:1 l1:damaged:recorded:1 l2:customer_credit:to_do:1 l3:missing:open:1');
 assert.equal(p.text(p.$('status')),'Réception de CN AUTO terminée : 2 → Avoirs clients · 1 → Pièces abîmées · 1 → Écarts.');assert.match(p.text(rb),/^Réception 1 /,'back on the list, the finished dossier is gone');
 // Warranty: the same two answers, another destination.
 await p.click(p.by(rb,'case',R2)[0],'Réceptionner');await scan(p,'GDB1330');await p.click(pendingPart(p),'Conforme');assert.equal(feedback(p),'✓ GDB1330 conforme → Retours fournisseur · reçu 1 / 1');
 await scan(p,'A1276');await damaged(p,pendingPart(p),'Filetage arraché');assert.equal(p.acts(R2),'l1:supplier_return:to_send:1 l2:damaged:recorded:1');
 await p.click(rb,'Terminer la réception');assert.match(p.asked.at(-1),/Toutes les pièces sont reçues\. Terminer la réception de GARAGE DU LAC/);assert.equal(p.dossier(R2).document.status,'received');assert.match(p.text(rb),/Aucun dossier en attente de réception\./);

 /* 4. Service Retours: lists already sorted, one action each. */
 await p.role('office');p.$('agent').value='Nadia';assert.deepEqual(p.counts(),{organise:'Collectes à organiser 0',damaged:'Pièces abîmées 2',credits:'Avoirs clients 2',suppliers:'Retours fournisseur 1',stock:'Remise en stock 0',gaps:'Écarts 1',history:'Historique'});
 await p.queue('damaged');assert.deepEqual(p.buttons(body),['Exporter en CSV'],'a register: nothing to decide');await p.click(body,'Exporter en CSV');assert.match(p.exports.at(-1).text,/"CN AUTO";"R-11111111";"LX 1780";"Filtre à air";"1";"";"";"Carton écrasé";"Abîmée";"Constatée";""/);
 // Customer credit: the number is typed when the credit is issued, then the part goes to stock.
 await p.queue('credits');const credit=ref=>p.shown(body).find(n=>n.dataset.action&&p.text(n).startsWith(ref));assert.match(p.text(body),/CN AUTO 2 LX 1780 · Filtre à air × 1 .* Avoir édité A1276 · Désignation non renseignée × 1 .* Avoir édité$/);
 await p.click(credit('LX 1780'),'Avoir édité');assert.match(p.text(p.$('status')),/Indiquez le numéro de l’avoir de LX 1780/);assert.equal(p.server.db.actions.find(a=>a.kind==='customer_credit'&&a.line_id==='l1').status,'to_do');
 p.shown(credit('LX 1780')).find(n=>n.dataset.credit).value=' AV 2026-118 ';await p.click(credit('LX 1780'),'Avoir édité');const c1=p.server.db.actions.find(a=>a.kind==='customer_credit'&&a.line_id==='l1');assert.deepEqual([c1.status,c1.document_number],['issued','AV 2026-118']);
 p.shown(credit('A1276')).find(n=>n.dataset.credit).value='AV 2026-119';await p.click(credit('A1276'),'Avoir édité');assert.equal(p.counts().credits,'Avoirs clients 0');assert.equal(p.counts().stock,'Remise en stock 2');
 await p.queue('stock');const stock=ref=>p.shown(body).find(n=>n.dataset.action&&p.text(n).startsWith(ref));assert.match(p.text(stock('LX 1780')),/Avoir AV 2026-118/);await p.click(stock('LX 1780'),'Rangé');assert.match(p.text(p.$('status')),/Indiquez où LX 1780 est rangée/);assert.equal(c1.status,'issued');
 p.shown(stock('LX 1780')).find(n=>n.dataset.place).value='Allée A12C';await p.click(stock('LX 1780'),'Rangé');assert.deepEqual([c1.status,c1.stock_destination],['restocked','Allée A12C']);
 await p.click(stock('A1276'),'Non remis en stock');assert.equal(p.server.db.actions.find(a=>a.kind==='customer_credit'&&a.line_id==='l2').status,'closed_no_stock');assert.match(p.text(body),/Aucune pièce à remettre en stock\./);
 assert.equal(p.dossier(R1).document.status,'received','a gap is still open');
 // Supplier return: the supplier is asked when the dossier did not say it; the carton keeps its exact rescan.
 await p.queue('suppliers');assert.match(p.text(body),/^Fournisseur à préciser 1 Le dossier ne dit pas le fournisseur/);await p.click(body,'Enregistrer le fournisseur');assert.match(p.text(p.$('status')),/Choisissez le fournisseur de GDB1330/);
 p.field(body,'Fournisseur de GDB1330').value='s1';await p.click(body,'Enregistrer le fournisseur');assert.equal(p.server.db.actions.find(a=>a.kind==='supplier_return').supplier_name,'APO');assert.match(p.text(body),/^APO 1 Préparer un carton APO GDB1330 · Plaquettes × 1 .* À mettre en carton$/);
 await p.click(body,'Préparer un carton APO');const carton=()=>p.shown(body).find(n=>n.className==='carton'),pack=async code=>{p.by(carton(),'cartonCode','s1')[0].value=code;await p.click(carton(),'Ajouter au carton');};
 assert.equal(p.button(carton(),'Carton envoyé').disabled,true,'an empty carton cannot leave');await pack('LX 1781');assert.match(p.text(carton()),/Rien n’a été ajouté au carton/);await pack('GDB 1330');assert.match(p.text(carton()),/Rien n’a été ajouté au carton/);
 await pack('GDB1330');assert.match(p.text(carton()),/Scanné 1 \/ 1 pièce/);await p.click(carton(),'Carton envoyé');assert.equal(p.server.db.actions.find(a=>a.kind==='supplier_return').status,'sent');assert.equal(p.text(p.$('status')),'Carton APO envoyé.');
 assert.equal(p.dossier(R2).document.status,'closed','the warranty dossier closed by itself once its carton left');
 // Gap settled: the customer return closes by itself too.
 await p.queue('gaps');assert.match(p.text(body),/^W 712 · Filtre à huile × 1 CN AUTO · .* Manquante : annoncée, non reçue Réglé$/);await p.click(body,'Réglé');assert.equal(p.dossier(R1).document.status,'closed');assert.match(p.text(body),/Aucun écart à régler\./);
 assert.deepEqual(received(p,R1),[2,1,0],'the reception was never rewritten by the processing');

 /* 5. Historique: everything is kept, nothing can be changed. */
 await p.queue('history');assert.match(p.text(body),/2 dossiers sur 2/);assert.deepEqual(p.shown(body).filter(n=>n.className==='case-state').map(n=>p.text(n)),['Terminé','Terminé']);
 await p.click(p.by(body,'open',R1)[0].parentElement,'Voir');assert.deepEqual(p.buttons(body),['← Tous les dossiers'],'read only');
 const seen=p.text(body);assert.match(seen,/^CN AUTO ← Tous les dossiers Terminé · Retour client · Charlie, passage /);assert.match(seen,/LX 1780 Filtre à air Attendu 2 · Reçu 2 Conforme × 1 · Abîmée × 1 : Carton écrasé/);assert.match(seen,/W 712 Filtre à huile Attendu 1 · Reçu 0 Manquante × 1 Manquante : 1 sur 1/);
 for(const said of ['Attribué à Charlie · par Nadia · Passage prévu','À enlever → Pris · par Charlie · Pris par le livreur','Réception · LX 1780 · par Léa · Scan : lx 1780 · Conforme','Réception · LX 1780 · par Léa · Scan : 4009026000014 · Abîmée : Carton écrasé','Pris → Reçu · par Léa · Réception terminée','Manquante · W 712 : déclarée · par Léa','Avoir client · LX 1780 : Avoir à faire → Avoir édité · par Nadia · Avoir : AV 2026-118','Remis en stock · par Nadia · Destination : Allée A12C','Manquante · W 712 : écart réglé · par Nadia','Reçu → Terminé · Clôture automatique'])assert.ok(seen.includes(said),said+' — in — '+seen.slice(seen.indexOf('Historique')));
});

test('a request taken by phone: garage, place of the carton, parts and a mandatory type — then it waits to be organised',async()=>{const p=await page({cases:[]});await p.role('office');const body=p.$('queueBody');
 assert.match(p.text(body),/Aucune demande en attente d’affectation\./);await p.click(body,'＋ Nouvelle demande');const form=()=>p.shown(body).find(n=>/new-request/.test(n.className));
 p.field(form(),'Garage').value='g1';p.field(form(),'Garage').onchange({});p.field(form(),'Emplacement du carton').value='Sous le comptoir';p.field(form(),'Emplacement du carton').oninput({});
 const add=async code=>{p.field(form(),'Référence ou code-barres').value=code;await p.click(form(),'Ajouter');};await add('4009026000014');await add('a1276');assert.match(p.text(form()),/LX 1780 · Filtre à air/);assert.match(p.text(form()),/A1276 · Désignation non renseignée/);
 await p.click(form(),'Enregistrer la demande');assert.match(p.text(form()),/Choisissez le type : retour client ou garantie\./);assert.equal(p.server.db.cases.length,0,'no request without its type');
 assert.deepEqual(p.field(form(),'Type').options.map(o=>o._text),['Type : choisir…','Retour client','Garantie']);p.field(form(),'Type').value='warranty';p.field(form(),'Type').onchange({});await p.click(form(),'Enregistrer la demande');
 const saved=p.server.db.cases[0].document;assert.deepEqual([saved.type,saved.status,saved.client_name,saved.pickup_location,saved.collector,saved.lines.map(l=>l.reference+'×'+l.quantity).join()],['warranty','requested','CN AUTO','Sous le comptoir','','LX 1780×1,A1276×1']);
 assert.equal(p.counts().organise,'Collectes à organiser 1');assert.equal(form(),undefined);
 // A request can be cancelled before the collection; it stays in the history.
 await p.click(body,'Annuler la demande');assert.equal(p.server.db.cases[0].document.status,'cancelled');await p.queue('history');assert.match(p.text(body),/Annulé CN AUTO Garantie · 2 pièces/);
});

test('dossiers that existed before are readable and completed with the same two answers, never rewritten',async()=>{
 const before=[
  // In reception when the screen changed: one unit already received, never qualified (the ADOUR OCCASION case).
  {id:R1,version:5,created_at:'2026-10-08T08:00:00Z',updated_at:'2026-10-10T08:00:00Z',document:{type:'return',status:'collected',client_name:'ADOUR OCCASION',supplier_name:'',collector:'serge',lines:[line('l1','A1276',1,{received_quantity:1}),line('l2','B2001',1)]}},
  // Received with the former screen, a line never decided, and a former « attente de décision ».
  {id:R2,version:7,created_at:'2026-10-07T08:00:00Z',updated_at:'2026-10-09T08:00:00Z',document:{type:'return',status:'received',client_name:'ANCIEN REÇU',supplier_name:'',collector:'serge',lines:[line('l1','C3001',1,{received_quantity:1}),line('l2','C3002',1,{received_quantity:1})]}},
  // Taken, of a type that no longer exists; assigned by the former screen, without a planned passage; closed by the former cycle.
  {id:'33333333-aaaa-4000-8000-000000000003',version:3,created_at:'2026-10-06T08:00:00Z',updated_at:'2026-10-08T08:00:00Z',document:{type:'mixed',status:'collected',client_name:'TYPE ANCIEN',supplier_name:'',collector:'serge',lines:[line('l1','D4001',1)]}},
  {id:'44444444-aaaa-4000-8000-000000000004',version:2,created_at:'2026-10-05T08:00:00Z',updated_at:'2026-10-07T08:00:00Z',document:{type:'return',status:'requested',client_name:'DÉJÀ ATTRIBUÉ',supplier_name:'',collector:'damian',lines:[line('l1','E5001',1)]}},
  {id:'55555555-aaaa-4000-8000-000000000005',version:9,created_at:'2026-09-01T08:00:00Z',updated_at:'2026-09-20T08:00:00Z',document:{type:'deposit',status:'credited',client_name:'ANCIEN CYCLE',supplier_name:'Bosch',credit_reference:'AV-77',collector:'serge',lines:[line('l1','F6001',2,{received_quantity:2})]}}];
 const p=await page({cases:structuredClone(before)});p.server.db.actions.push({id:'a-old',case_id:R2,line_id:'l2',kind:'pending',status:'open',quantity:1,packed_quantity:0,supplier_id:null,supplier_name:'',document_number:'',comment:'À voir avec le comptoir',shipment_id:null,stock_destination:'',version:1,created_at:'2026-10-09T09:00:00Z',updated_at:'2026-10-09T09:00:00Z'});
 const snapshot=id=>JSON.stringify(p.dossier(id).document.lines);
 await p.role('reception');const rb=p.$('receptionBody');assert.match(p.text(rb),/ANCIEN REÇU Pièces déjà reçues à qualifier Qualifier/);assert.match(p.text(rb),/ADOUR OCCASION 2 pièces attendues · reçu 1 Réceptionner/);assert.doesNotMatch(p.text(rb),/ANCIEN CYCLE|DÉJÀ ATTRIBUÉ/);
 // The unit received before is qualified without rescan; the reception cannot end before.
 await p.click(p.by(rb,'case',R1)[0],'Réceptionner');const l1=()=>p.by(rb,'line','l1')[0];assert.match(p.text(l1()),/A1276 Désignation non renseignée Attendu 1 · Reçu 1 À qualifier × 1 1 pièce déjà reçue à qualifier : Conforme Abîmée/);
 await p.click(rb,'Terminer la réception');assert.match(feedback(p),/Une pièce déjà reçue attend sa qualification/);assert.equal(p.dossier(R1).document.status,'collected');
 const lines=snapshot(R1);await p.click(l1(),'Conforme');assert.equal(p.acts(R1),'l1:customer_credit:to_do:1');assert.equal(snapshot(R1),lines,'the received quantity is not touched');assert.equal(feedback(p),'✓ A1276 conforme → Avoirs clients');
 // A wrong answer is taken back while the dossier is in reception, then given again.
 await p.click(l1(),'Corriger « Conforme × 1 »');assert.equal(p.acts(R1),'l1:customer_credit:cancelled:1');await damaged(p,l1(),'Rayée');assert.equal(p.acts(R1),'l1:customer_credit:cancelled:1 l1:damaged:recorded:1');
 await p.click(rb,'Terminer la réception');const tick=p.shown(rb).find(n=>n.dataset.missing==='l2');tick.checked=true;tick.onchange({});await p.tick();await p.click(rb,'Déclarer manquantes et terminer');assert.equal(p.dossier(R1).document.status,'received');
 // Received with the former screen: the line never decided is qualified; the former decision stays as it was.
 await p.click(p.by(rb,'case',R2)[0],'Qualifier');assert.equal(scanInput(p),undefined,'its reception is over: nothing is scanned again');assert.equal(p.buttons(rb).includes('Terminer la réception'),false);const old=snapshot(R2);
 await p.click(p.by(rb,'line','l1')[0],'Conforme');assert.equal(snapshot(R2),old);assert.equal(p.acts(R2),'l1:customer_credit:to_do:1 l2:pending:open:1');assert.match(p.text(rb),/^Réception 1 /,'nothing left to qualify: back on the list');
 // Another type: the conforming part waits for the returns desk to say which of the two.
 const T='33333333-aaaa-4000-8000-000000000003';await p.click(p.by(rb,'case',T)[0],'Réceptionner');assert.match(p.text(rb),/Le type de ce dossier doit être précisé par le service Retours/);await scan(p,'D4001');await p.click(pendingPart(p),'Conforme');
 assert.match(feedback(p),/Le type de ce dossier \(retour client ou garantie\) doit être précisé par le service Retours/);assert.deepEqual(received(p,T),[null]);
 await p.role('office');const body=p.$('queueBody');assert.match(p.text(body),/Type à préciser · dossiers déjà pris .* TYPE ANCIEN 1 pièce · Retour et garantie \(ancien type\)/);p.field(body,'Type du dossier').value;const fix=p.shown(body).find(n=>n.dataset.type===T).parentElement;p.shown(fix).find(n=>n.tagName==='SELECT').value='warranty';await p.click(fix,'Enregistrer le type');assert.equal(p.dossier(T).document.type,'warranty');
 // Assigned by the former screen: shown under its driver, passage to be given.
 assert.match(p.text(p.by(body,'group','damian')[0]),/^Damian Tournée interne 1 DÉJÀ ATTRIBUÉ .* Passage à préciser Modifier$/);assert.equal(p.counts().organise,'Collectes à organiser 1');
 // The former « attente de décision » is in « Écarts », with its words; the former cycle is readable in the history.
 await p.queue('gaps');assert.match(p.text(body),/C3002 · Désignation non renseignée × 1 ANCIEN REÇU · .* Ancienne attente de décision : À voir avec le comptoir Réglé/);assert.match(p.text(body),/B2001 .* Manquante : annoncée, non reçue/);
 await p.queue('history');assert.match(p.text(body),/5 dossiers sur 5/);assert.match(p.text(body),/Avoir obtenu ANCIEN CYCLE Consigne \(ancien type\) · 2 pièces/);
 await p.click(p.by(body,'open','55555555-aaaa-4000-8000-000000000005')[0].parentElement,'Voir');assert.match(p.text(body),/Ancien suivi du dossier — fournisseur : Bosch · avoir : AV-77/);assert.match(p.text(body),/F6001 Désignation non renseignée Attendu 2 · Reçu 2 Historique/,'a dossier of the former cycle asks nothing');
 assert.equal(JSON.stringify(p.dossier('55555555-aaaa-4000-8000-000000000005')),JSON.stringify(before[4]),'a dossier nobody touched is exactly what it was');
});

test('without the migration the screen says so and offers nothing; nothing is written',async()=>{const p=await page({missing:['shared_returns_flow']});
 assert.equal(p.$('workspace').hidden,true);assert.equal(p.$('notReady').hidden,false);assert.match(p.text(p.$('notReady')),/returns-roles\.sql.*n’est pas encore appliquée\. Aucune donnée n’est modifiée\./);
 assert.deepEqual(p.server.db.calls,[],'not even a reading');
});

test('the page declares nothing by itself: codes, routing, freezing and closing are answers of the server',()=>{const js=read('returns.js'),html=read('returns.html');
 assert.doesNotMatch(js,/received_quantity\s*=[^=]|status:'(collected|received|closed|packed|sent|issued)'|to_status:'(packed|sent)'|kind:'|action_kind/,'no received quantity, state or routing is written by the page');
 for(const fn of ['shared_return_plan','shared_return_taken','shared_return_set_type','shared_return_identify','shared_return_receive_part','shared_return_qualify','shared_return_finish','shared_return_credit_issue','shared_return_action_supplier','shared_return_gap_resolve','shared_return_shipment_open','shared_return_pack','shared_return_shipment_send'])assert.equal(js.split("call('"+fn+"'").length-1,1,fn+' is called from one place');
 assert.doesNotMatch(js,/call\('shared_return_(receive|receive_line|action_add)'/,'the former reception and the decisions taken afterwards are no longer offered');
 assert.doesNotMatch(js+html,/Suites|À traiter|Attente de décision|Valider la réception|<form|id="editor"|beforeunload/,'no abstract step, no universal form');
 assert.doesNotMatch(js,/shared_products_search|CatalogueSearch|Fiche catalogue/);assert.match(read('build.cjs'),/'returns-actions-core\.js','returns-flow-core\.js'/);assert.doesNotMatch(read('build.cjs'),/returns-fake-server/,'the test double is never published');
});
test('refusals are read as the shared access hands them over',()=>{const F=require('./returns-flow-core.js'),access=read('shared-access.js');
 assert.match(access,/Object\.assign\(Error\(message\(error\)\),\{code:error\.code,original:error\.message\}\)/,'the stand-in of this test copies this shape');
 const said=(code,original)=>F.serverMessage(Object.assign(Error('générique'),{code,original}));
 assert.match(said('PT404','Not a part of this dossier'),/Référence inconnue pour ce dossier : pièce refusée/);assert.match(said('PT404','No waiting part for this code'),/ajouté au carton/);assert.match(said('22023','Line already complete'),/déjà reçue en totalité/);
 assert.match(said('22023','Missing parts must be declared'),/déclarée manquante/);assert.match(said('22023','Collection is frozen once taken'),/ne se modifie plus/);assert.match(said('PT409','Return case changed'),/modifié sur un autre appareil/);assert.match(said('22023','Reason required'),/motif est obligatoire/);assert.equal(said('XX000','boom'),'');
});
test('nothing of this appears on the garage portal',()=>{const pub=['returns-portal.html','returns-portal.js','returns-portal-core.js','returns-portal.css'].map(read).join('\n');
 assert.doesNotMatch(pub,/returns-actions|returns-flow|ReturnsActions|ReturnsFlow|shared_return|fake-server|abîm|fournisseur|avoir|manifeste|remis en stock|manquant|livreur|historique|écart/i);
});
