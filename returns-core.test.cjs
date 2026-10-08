const test=require('node:test'),assert=require('node:assert/strict'),C=require('./returns-core.js');
const line={id:'1',reference:'ABC-01',description:'Pièce',quantity:2,received_quantity:null,condition:'',reason:''};
const doc={type:'return',status:'requested',client_name:'Garage test',supplier_name:'',lines:[line]};
test('return case keeps a reference even when it is absent from the catalogue',()=>{assert.equal(C.validateDocument(structuredClone(doc)).lines[0].reference,'ABC-01');});
test('quantities reject negatives, fractions, excess received and duplicate lines',()=>{for(const quantity of [0,-1,1.5,100001])assert.throws(()=>C.quantity(quantity));assert.throws(()=>C.validateDocument({...doc,lines:[{...line,received_quantity:3}]}));assert.throws(()=>C.validateDocument({...doc,lines:[line,{...line}]}));});
test('case states follow a one-way auditable workflow',()=>{assert.equal(C.canMove('requested','collected'),true);assert.equal(C.canMove('requested','credited'),false);assert.equal(C.canMove('credited','requested'),false);});
test('search and alerts do not lose unknown or manual references',()=>{const cases=[{updated_at:'2026-10-01',document:doc},{updated_at:'2026-10-02',document:{...doc,status:'received',lines:[{...line,reference:'MAN-42'}]}}];assert.equal(C.badge(cases),1);assert.equal(C.search(cases,'man').length,1);});
test('credit export keeps every scanned line and protects spreadsheet formulas',()=>{const row={id:'case-1',document:{...doc,status:'credited',supplier_name:'Fournisseur test',lines:[{...line,reference:'=NOT-A-FORMULA'}]}};assert.match(C.creditCsv(row),/"'=NOT-A-FORMULA"/);const email=C.creditMail(row);assert.match(email.subject,/Garage test/);assert.match(email.body,/=NOT-A-FORMULA/);});
test('garage portal requests are recognised and their pickup place survives an internal edit',()=>{const portal={...doc,client_id:null,client_name:'Garage Neuf',portal:true,source:'public_portal',pickup_location:'Carton accueil',garage_verified:false};
 assert.deepEqual(C.portalInfo(portal),{location:'Carton accueil',verified:false});assert.equal(C.portalInfo(doc),null);
 const edited=C.mergeDocument(portal,{type:'warranty',status:'collected',client_id:'g-1',client_name:'Garage Neuf',supplier_id:null,supplier_name:'',lines:portal.lines});
 assert.equal(edited.pickup_location,'Carton accueil');assert.equal(edited.source,'public_portal');assert.equal(edited.type,'warranty');assert.equal(edited.status,'collected');assert.deepEqual(C.portalInfo(edited),{location:'Carton accueil',verified:true});
 assert.deepEqual(C.mergeDocument(null,{type:'return'}),{type:'return'});});
test('the internal form keeps unedited document fields when it saves',()=>{const src=require('node:fs').readFileSync('returns.js','utf8');assert.match(src,/return C\.mergeDocument\(current\?\.document,\{type:/);assert.match(src,/paintPortal\(row\.document\)/);});
/* Lot 5 — steps, round services, element names. */
const at=(status,extra={},updated_at='2026-10-08T10:00:00Z')=>({id:status+JSON.stringify(extra),updated_at,document:{...doc,status,...extra}});
test('header steps cover every state exactly once, « Tous » has no filter',()=>{
 assert.deepEqual(C.STEPS.map(s=>s.label),['À enlever','Au magasin','Chez le fournisseur','Clôturés','Tous']);
 const covered=C.STEPS.flatMap(s=>s.statuses||[]);assert.deepEqual([...covered].sort(),Object.keys(C.STATUS).sort());assert.equal(new Set(covered).size,covered.length);
 assert.equal(C.stepOf('requested'),'pickup');assert.equal(C.stepOf('supplier_ready'),'shop');assert.equal(C.stepOf('credit_pending'),'supplier');assert.equal(C.stepOf('cancelled'),'closed');
 const cases=[at('requested'),at('collected'),at('received'),at('sent'),at('credited'),at('cancelled')];
 assert.deepEqual(C.stepCounts(cases),{pickup:1,shop:2,supplier:1,closed:2,all:6});
 assert.equal(C.filter(cases,{step:'shop'}).length,2);assert.equal(C.filter(cases,{step:'all'}).length,6);assert.equal(C.filter(cases,{step:'closed',type:'warranty'}).length,0);
});
test('the ten round services are always listed, in the given order, even without any case',()=>{
 const names=['Serge','Damian','Paketo Landes','Paketo Béarn','Paketo Pays Basque','Ace','Ludovic','Maxime','Charlie','Cédric'];
 assert.deepEqual(C.TOURS.map(t=>t.name),names);assert.deepEqual(C.groups([]).map(g=>g.name),names);assert.ok(C.groups([]).every(g=>g.cases.length===0));
 assert.equal(new Set(C.TOURS.map(t=>t.id)).size,10);for(const t of C.TOURS)assert.match(t.id,/^[a-z0-9_]{1,40}$/,'accepted by the server rule');
});
test('a case with several services appears under each of them; one without service is never lost',()=>{
 const both=at('requested',{services:['paketo_landes','serge']}),one=at('requested',{services:['ace']}),none=at('requested',{client_name:'Garage portail'});
 const groups=C.groups([both,one,none]),by=name=>groups.find(g=>g.name===name).cases;
 assert.deepEqual(by('Serge'),[both]);assert.deepEqual(by('Paketo Landes'),[both]);assert.deepEqual(by('Ace'),[one]);assert.deepEqual(by('Damian'),[]);
 assert.equal(groups.length,11);assert.deepEqual(groups.at(-1),{id:'',name:'Sans tournée',cases:[none]});
 assert.deepEqual(C.services(both.document),['serge','paketo_landes'],'listed in the order of the services');
 assert.deepEqual(C.services({services:['inconnu','serge','serge']}),['serge']);assert.deepEqual(C.services({services:'serge'}),[]);
 assert.equal(C.filter([both,one,none],{query:'paketo landes'}).length,1,'search by service name');
});
test('services are validated: known, distinct, a list',()=>{
 assert.doesNotThrow(()=>C.validateDocument({...doc,services:[]}));assert.doesNotThrow(()=>C.validateDocument({...doc,services:['serge','cedric']}));
 for(const services of [['serge','serge'],['inconnu'],'serge',[1]])assert.throws(()=>C.validateDocument({...doc,services}),/Service de tournée/);
});
test('no schedule is invented: services carry a name and nothing else',()=>{
 for(const t of C.TOURS)assert.deepEqual(Object.keys(t).sort(),['id','name']);
 const fs=require('node:fs');for(const f of ['returns-core.js','returns.js','returns.html']){const src=fs.readFileSync(f,'utf8');
  assert.equal(/\b([01]?\d|2[0-3])\s?[h:]\s?[0-5]\d\b/.test(src.replace(/\?v=[\w-]+/g,'')),false,f+' holds a time of day');
  assert.equal(/PartnerPlanning|partner-planning|Prochain passage|Passage à confirmer|departures/.test(src),false,f+' derives a passage');}
});
test('element names: filled from the catalogue when known, never over a typed name',()=>{
 const lines=[{id:'a',product_id:'p1',reference:'REF-1',description:''},{id:'b',product_id:null,reference:'ref-2',description:''},{id:'c',product_id:null,reference:'REF-3',description:'Saisie à la main'},{id:'d',product_id:null,reference:'DOUBLE',description:''},{id:'e',product_id:null,reference:'ABSENT',description:''}];
 const products=[{id:'p1',reference:'AUTRE',description:'Disque avant'},{id:'p2',reference:'REF-2',description:' Filtre à huile '},{id:'p3',reference:'REF-3',description:'Nom catalogue'},{id:'p4',reference:'DOUBLE',description:'Un'},{id:'p5',reference:'DOUBLE',description:'Deux'}];
 assert.equal(C.prefillNames(lines,products),2);
 assert.deepEqual(lines.map(l=>l.description),['Disque avant','Filtre à huile','Saisie à la main','','']);
 assert.match(C.creditCsv({id:'x',document:{...doc,status:'credited',lines:[{...line,description:'Nom modifié'}]}}),/"Dénomination"[\s\S]*"Nom modifié"/);
});

