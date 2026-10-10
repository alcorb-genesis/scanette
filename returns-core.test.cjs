const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),C=require('./returns-core.js'),P=require('./partner-planning-core.js');
const line={id:'1',reference:'ABC-01',description:'Pièce',quantity:2,received_quantity:null,refused_quantity:0,condition:'',reason:''};
const doc={type:'return',status:'requested',client_name:'Garage test',supplier_name:'',lines:[line]};
const row=(id,d,created='2026-10-01T08:00:00Z')=>({id,version:1,created_at:created,updated_at:created,document:{...doc,...d}});
test('return case keeps a reference even when it is absent from the catalogue',()=>{assert.equal(C.validateDocument(structuredClone(doc)).lines[0].reference,'ABC-01');});
test('quantities reject negatives and fractions; a control may differ from the announcement but refused never exceeds received',()=>{
 for(const quantity of [0,-1,1.5,100001])assert.throws(()=>C.quantity(quantity));
 assert.doesNotThrow(()=>C.validateDocument({...doc,lines:[{...line,received_quantity:3}]}),'more parts than announced is a difference, not an error');
 assert.throws(()=>C.validateDocument({...doc,lines:[{...line,received_quantity:1,refused_quantity:2}]}));assert.throws(()=>C.validateDocument({...doc,lines:[{...line,received_quantity:-1}]}));
 assert.throws(()=>C.validateDocument({...doc,lines:[line,{...line}]}));assert.throws(()=>C.validateDocument({...doc,collector:'paketo'}));
});
test('one readable cycle: ready → collected → received → waiting supplier → credited or closed',()=>{
 assert.deepEqual(Object.keys(C.STATUS),['requested','collected','received','supplier_pending','credited','closed','cancelled']);
 for(const [from,to] of [['requested','collected'],['collected','received'],['received','supplier_pending'],['received','credited'],['received','closed'],['supplier_pending','credited'],['supplier_pending','closed'],['credited','closed']])assert.equal(C.canMove(from,to),true,from+'→'+to);
 for(const [from,to] of [['requested','received'],['requested','credited'],['collected','closed'],['credited','cancelled'],['closed','requested'],['cancelled','requested'],['credited','requested']])assert.equal(C.canMove(from,to),false,from+'→'+to);
});
test('each step says what is missing; an unknown supplier or credit is never filled in',()=>{
 assert.match(C.requirement(doc,'collected'),/Attribuez/);assert.equal(C.requirement({...doc,collector:'serge'},'collected'),'');
 assert.match(C.requirement(doc,'received'),/quantité reçue pour ABC-01/);
 assert.match(C.requirement({...doc,lines:[{...line,received_quantity:1}]},'received'),/motif/);assert.match(C.requirement({...doc,lines:[{...line,received_quantity:2,refused_quantity:1}]},'received'),/motif/);
 assert.equal(C.requirement({...doc,lines:[{...line,received_quantity:2}]},'received'),'');assert.equal(C.requirement({...doc,lines:[{...line,received_quantity:0,reason:'Rien dans le carton'}]},'received'),'');
 assert.match(C.requirement(doc,'supplier_pending'),/fournisseur/);assert.match(C.requirement({...doc,supplier_name:'F'},'credited'),/avoir/);assert.equal(C.requirement({...doc,supplier_name:'F',credit_reference:'AV-1'},'credited'),'');
 assert.equal(C.requirement(doc,'closed'),'','a dossier can be closed without supplier or credit');
 assert.equal(C.canReassign('requested'),true);assert.equal(C.canReassign('collected'),true);assert.equal(C.canReassign('received'),false);
});
test('ten collectors in the order of the team, one per dossier',()=>{
 assert.deepEqual(C.COLLECTORS.map(c=>c.name),['Serge','Damian','Paketo Landes','Paketo Béarn','Paketo Pays Basque','Ace','Ludovic','Maxime','Charlie','Cédric']);
 assert.equal(C.collectorName('paketo_bearn'),'Paketo Béarn');assert.equal(C.collectorName(''),'À attribuer');assert.equal(C.collectorName('inconnu'),'À attribuer');
});
test('a collector is proposed only when the garage has exactly one known service',()=>{
 const g=(tours,carriers)=>({details:{tours},departures:carriers.map(carrier=>({carrier,time:'10:00',days:[1]}))});
 assert.equal(C.certainCollector(g(['damian'],[])),'damian');assert.equal(C.certainCollector(g(['charlie'],['Charlie','Charlie'])),'charlie');
 assert.equal(C.certainCollector(g([],['Paketo Pays Basque'])),'paketo_pays_basque');assert.equal(C.certainCollector(g([],['ACE Hendaye'])),'ace');assert.equal(C.certainCollector(g([],['paketo  béarn'])),'paketo_bearn');
 for(const uncertain of [g([],['Paketo Pays Basque','Serge']),g([],['ACE Hendaye','Paketo Hendaye']),g([],['Paketo Hendaye']),g([],[]),g(['cedric'],['Serge']),g(['damian','maxime'],[]),g([],['Ludovic']),null,{details:{tours:'damian'}}])assert.equal(C.certainCollector(uncertain),'');
 assert.equal(C.collectorOfCarrier('Acer'),'other:acer');assert.equal(C.collectorOfCarrier(''),null);
 // Same rule, same names, on the server.
 const sql=fs.readFileSync('returns-collectors.sql','utf8');for(const c of C.COLLECTORS){assert.ok(sql.includes("'"+c.id+"' then '"+c.name+"'"),c.id);}
 assert.match(sql,/when k='ace' or left\(k,4\)='ace ' then 'ace'/);assert.match(sql,/count\(\*\)=1 and min\(s\) in \('serge','damian','paketo_landes','paketo_bearn','paketo_pays_basque','ace','maxime','charlie','cedric'\)/);
});
test('collection view: unassigned first and never lost, one group per collector with its real count',()=>{
 const cases=[row('a',{collector:'charlie'}),row('b',{}),row('c',{collector:'inconnu'}),row('d',{collector:'charlie',status:'collected'}),row('e',{collector:'serge'},'2026-09-01T08:00:00Z'),row('f',{collector:'charlie'},'2026-09-15T08:00:00Z')];
 const v=C.collection(cases);assert.equal(v.total,5);assert.deepEqual(v.unassigned.map(c=>c.id),['b','c']);assert.equal(v.groups.length,10);
 assert.deepEqual(Object.fromEntries(v.groups.filter(g=>g.cases.length).map(g=>[g.id,g.cases.map(c=>c.id)])),{serge:['e'],charlie:['f','a']},'oldest first, collected dossiers are not counted');
 assert.equal(v.unassigned.length+v.groups.reduce((n,g)=>n+g.cases.length,0),v.total,'every dossier to collect is shown exactly once');
 assert.deepEqual(C.pieces({lines:[{quantity:2},{quantity:3}]}),{lines:2,pieces:5});assert.equal(C.badge(cases),5);
});
test('next visit: an hour only when the garage record has one for that collector',()=>{
 const garage={details:{tours:['charlie']},departures:[{carrier:'Charlie',time:'10:00',days:[1,2,3,4,5]},{carrier:'ACE Hendaye',time:'07:00',days:[1,2,3,4,5]}]},monday=new Date('2026-10-05T06:00:00Z');
 assert.equal(C.passage({collector:'charlie'},garage,P,monday),'Prochain passage : Charlie à 10:00 aujourd’hui');assert.match(C.passage({collector:'ace'},garage,P,monday),/Ace à 07:00 demain/);
 assert.equal(C.passage({collector:'damian'},garage,P,monday),'Tournée interne — horaire selon BL');assert.equal(C.passage({collector:'ludovic'},null,P,monday),'Tournée interne — horaire selon BL');
 assert.equal(C.passage({collector:'serge'},garage,P,monday),'Prochain passage non connu');assert.match(C.passage({},garage,P,monday),/à définir/);
});
test('filters add up: state, collector, garage, supplier, period and words; counters help sorting',()=>{
 const cases=[row('a',{collector:'charlie',client_name:'CN AUTO'},'2026-10-01T08:00:00Z'),row('b',{status:'received',supplier_name:'Bosch',client_name:'CN AUTO',collector:'serge'},'2026-10-05T08:00:00Z'),row('c',{status:'closed',supplier_name:'Bosch',credit_reference:'AV-42',client_name:'Garage Dupont'},'2026-09-01T08:00:00Z'),row('d',{status:'cancelled'},'2026-10-06T08:00:00Z')];
 const ids=f=>C.filter(cases,f).map(c=>c.id).sort().join('');
 assert.equal(ids({}),'abcd');assert.equal(ids({status:'open'}),'ab');assert.equal(ids({status:'closed'}),'c');assert.equal(ids({collector:'none'}),'cd');assert.equal(ids({collector:'serge'}),'b');
 assert.equal(ids({garage:'cn auto'}),'ab');assert.equal(ids({supplier:'Bosch'}),'bc');assert.equal(ids({supplier:'none'}),'ad');assert.equal(ids({from:'2026-10-02'}),'bd');assert.equal(ids({from:'2026-09-01',to:'2026-10-01'}),'ac');
 assert.equal(ids({query:'av-42'}),'c');assert.equal(ids({query:'charlie cn'}),'a');assert.equal(ids({query:'abc-01',status:'open',garage:'CN AUTO',supplier:'Bosch'}),'b');assert.equal(C.search(cases,'dupont').length,1);
 assert.deepEqual(C.counters(cases),{requested:1,collected:0,received:1,supplier_pending:0,credited:0,closed:1,cancelled:1,open:2,all:4});
});
test('the journal names assignments, reassignments and former states',()=>{
 assert.equal(C.eventMessage({event_kind:'assigned',from_collector:null,to_collector:'serge'}),'Attribué à Serge');assert.equal(C.eventMessage({event_kind:'assigned',from_collector:'serge',to_collector:'paketo_landes'}),'Réattribué : Serge → Paketo Landes');
 assert.match(C.eventMessage({event_kind:'assigned',from_collector:'serge',to_collector:null}),/à attribuer/);assert.equal(C.eventMessage({event_kind:'status_changed',from_status:'sent',to_status:'supplier_pending'}),'Envoyé fournisseur → En attente fournisseur');
 assert.equal(C.eventMessage({event_kind:'created'}),'Dossier créé');
});
test('export keeps every line, says what is unknown and protects spreadsheet formulas',()=>{const r={id:'case-1',document:{...doc,status:'received',lines:[{...line,reference:'=NOT-A-FORMULA',received_quantity:1,refused_quantity:1,reason:'Cassé'}]}};
 const csv=C.creditCsv(r);assert.match(csv,/"'=NOT-A-FORMULA"/);assert.match(csv,/"Inconnu";"Non renseigné"/);assert.match(csv,/"Cassé"/);const email=C.creditMail(r);assert.match(email.subject,/Garage test/);assert.match(email.body,/1 refusée\(s\) · Cassé/);});
test('garage portal requests are recognised and their fields survive an internal edit',()=>{const portal={...doc,client_id:null,client_name:'Garage Neuf',portal:true,source:'public_portal',pickup_location:'Carton accueil',garage_verified:false,collector:''};
 assert.deepEqual(C.portalInfo(portal),{location:'Carton accueil',verified:false});assert.equal(C.portalInfo(doc),null);
 const edited=C.mergeDocument(portal,{type:'warranty',status:'collected',client_id:'g-1',client_name:'Garage Neuf',supplier_id:null,supplier_name:'',collector:'serge',lines:portal.lines});
 assert.equal(edited.pickup_location,'Carton accueil');assert.equal(edited.source,'public_portal');assert.equal(edited.collector,'serge');assert.deepEqual(C.portalInfo(edited),{location:'Carton accueil',verified:true});assert.deepEqual(C.mergeDocument(null,{type:'return'}),{type:'return'});});
test('the internal screen: one screen per role, no universal form, every write through a function of the server',()=>{const js=fs.readFileSync('returns.js','utf8'),html=fs.readFileSync('returns.html','utf8');
 assert.deepEqual([...new Set([...js.matchAll(/call\('(shared_[a-z_]+)'/g)].map(m=>m[1]))].sort(),['shared_partners','shared_product_lookup','shared_return_action_move','shared_return_action_supplier','shared_return_actions','shared_return_credit_issue','shared_return_events','shared_return_finish','shared_return_gap_resolve','shared_return_identify','shared_return_pack','shared_return_plan','shared_return_qualify','shared_return_receive_part','shared_return_set_type','shared_return_shipment_open','shared_return_shipment_send','shared_return_shipments','shared_return_taken','shared_returns','shared_returns_flow','shared_save_return']);
 // shared_save_return only creates a request or cancels one before its collection: no dossier is edited as a whole.
 assert.equal(js.match(/call\('shared_save_return'/g).length,2);assert.match(js,/case_document:\{\.\.\.d,status:'cancelled'\}/);assert.match(js,/expected_version:0,case_document:doc/);
 for(const id of ['roleOffice','roleDriver','roleReception','office','driver','reception','queues','queueBody','driverName','driverList','receptionBody'])assert.match(html,new RegExp('id="'+id+'"'),id);
 assert.ok(html.indexOf('id="roles"')<html.indexOf('id="office"')&&html.indexOf('id="office"')<html.indexOf('id="driver"')&&html.indexOf('id="driver"')<html.indexOf('id="reception"'));
 assert.doesNotMatch(html,/<form|<fieldset|id="editor"|id="fields"/,'no universal form');assert.match(js,/function setRole\(next\)\{reset\(\);/,'a role starts from nothing');assert.match(js,/function setQueue\(next\)\{reset\(\);/,'a queue starts from nothing');
 assert.match(js,/for\(const c of C\.COLLECTORS\)/);assert.doesNotMatch(html,/type="password"|PIN|e-mail"|login/i);assert.match(js,/code!=='PGRST202'/,'closed until the migration is applied');
});
test('the public garage portal knows nothing of collectors, states, suppliers, controls or credits',()=>{
 const pub=['returns-portal.html','returns-portal.js','returns-portal-core.js','returns-portal.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
 assert.doesNotMatch(pub,/collector|livreur|Marquer collecté|supplier|fournisseur|credit|avoir|refused_quantity|received_quantity|motif|shared_|returns-core|ReturnsCore|status_changed|supplier_pending/i);
 assert.deepEqual([...pub.matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]).sort(),['returns_public_designation','returns_public_garages','returns_public_submit_typed']);
 const sql=fs.readFileSync('returns-collectors.sql','utf8'),submit=sql.slice(sql.indexOf('create or replace function public.returns_public_submit'));
 assert.match(submit,/returns uuid /);assert.match(submit,/return request_id;/);assert.doesNotMatch(sql,/\$\$|^\s*(begin|commit)\s*;/mi);
 assert.match(sql,/revoke all on function public\.returns_regroup_legacy\(\),public\.returns_collector_label\(text\),public\.returns_carrier_collector\(text\),public\.returns_certain_collector\(uuid,uuid\),public\.returns_cases_guard\(\),\s*public\.returns_apply_case\([^)]*\) from public,anon,authenticated;/);
});
