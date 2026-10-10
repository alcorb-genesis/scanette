/* Rules of the role screens (returns-flow-core.js) and their mirror on the server (returns-roles.sql). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const F=require('./returns-flow-core.js'),C=require('./returns-core.js'),P=require('./partner-planning-core.js');
const read=f=>fs.readFileSync(f,'utf8');
const line=(id,quantity,received=null,extra={})=>({id,reference:'REF-'+id,description:'',quantity,received_quantity:received,reason:'',...extra});
const dossier=(id,status,extra={},lines=[line('l1',2)])=>({id,version:1,created_at:'2026-10-0'+id+'T08:00:00Z',updated_at:'2026-10-0'+id+'T09:00:00Z',document:{type:'return',status,client_name:'Garage '+id,supplier_name:'',collector:'',lines,...extra}});
const action=(caseId,lineId,kind,status,quantity=1,extra={})=>({id:caseId+lineId+kind+status,case_id:caseId,line_id:lineId,kind,status,quantity,packed_quantity:0,supplier_id:null,supplier_name:'',document_number:'',comment:'',shipment_id:null,stock_destination:'',version:1,created_at:'2026-10-09T10:00:00Z',...extra});
const monday=new Date(2026,9,12,10,0);// Monday 12 October 2026, 10:00

test('two types only; an older type is named as such and is never accepted for a plan',()=>{
 assert.deepEqual(Object.entries(F.TYPES),[['return','Retour client'],['warranty','Garantie']]);assert.equal(F.typeOk('mixed'),false);assert.equal(F.typeOk('deposit'),false);
 assert.equal(F.typeLabel('mixed'),'Retour et garantie (ancien type)');assert.equal(F.typeLabel('deposit'),'Consigne (ancien type)');assert.equal(F.typeLabel(undefined),'Type à préciser');
});
test('routing is said in the words of the queues, and only the type and the answer decide',()=>{
 assert.equal(F.destination('return','ok'),'Avoirs clients');assert.equal(F.destination('warranty','ok'),'Retours fournisseur');assert.equal(F.destination('return','damaged'),'Pièces abîmées');assert.equal(F.destination('warranty','damaged'),'Pièces abîmées');assert.equal(F.destination('mixed','ok'),'');
 const sql=read('returns-roles.sql').replace(/^--.*$/gm,'');
 assert.match(sql,/if part_state='damaged' then\s+insert into public\.returns_line_actions\([^)]*\)\s+values\(gen_random_uuid\(\),[^;]*'damaged','recorded',1,why\) returning \* into saved;[\s\S]*?return saved;\s+end if;\s+if kind_of_case='return'/,'damaged, whatever the type, before the type is even read');
 assert.match(sql,/if kind_of_case='return' then[\s\S]*?'customer_credit','to_do',1\)[\s\S]*?elsif kind_of_case='warranty' then[\s\S]*?'supplier_return','to_send',1,partner\.id[\s\S]*?else\s+raise exception 'Type required'/);
 assert.match(sql,/'missing','open',gap,'Déclarée manquante à la réception'/);
});
test('a planned passage is a real local day and hour',()=>{
 assert.equal(F.slotValue(new Date(2026,9,13,9,5)),'2026-10-13T09:05');assert.ok(F.slotDate('2026-10-13T14:30'));for(const bad of ['','2026-10-13','2026-13-01T10:00','2026-02-30T10:00','2026-10-13T24:00','2026-10-13 14:30',null])assert.equal(F.slotDate(bad),null,String(bad));
 assert.equal(F.slotLabel('2026-10-12T14:30',monday),'aujourd’hui à 14:30');assert.equal(F.slotLabel('2026-10-13T08:00',monday),'demain à 08:00');assert.equal(F.slotLabel('2026-10-16T11:15',monday),'vendredi 16/10 à 11:15');assert.equal(F.slotLabel('',monday),'passage à préciser');
 assert.equal(F.late('2026-10-12T09:00',monday),true);assert.equal(F.late('2026-10-12T14:30',monday),false);assert.equal(F.late('',monday),false);
});
test('proposed passages come from the record of the garage for that service, and from nowhere else',()=>{
 const garage={id:'g',name:'G',departures:[{carrier:'Charlie',time:'14:30',days:[1,3]},{carrier:'Charlie',time:'08:15',days:[2]},{carrier:'Paketo Landes',time:'16:00',days:[1,2,3,4,5]}]};
 assert.deepEqual(F.proposals(garage,'charlie',P,monday),[{value:'2026-10-12T14:30',label:'aujourd’hui à 14:30'},{value:'2026-10-13T08:15',label:'demain à 08:15'}]);
 assert.deepEqual(F.proposals(garage,'paketo_landes',P,monday).map(s=>s.value),['2026-10-12T16:00']);
 assert.deepEqual(F.proposals(garage,'serge',P,monday),[],'no known passage: nothing is invented');assert.deepEqual(F.proposals(null,'charlie',P,monday),[]);assert.deepEqual(F.proposals(garage,'',P,monday),[]);
});
test('a collection is assigned with its type, its driver and its passage, all three',()=>{
 assert.match(F.planProblem({collector:'charlie',pickupAt:'2026-10-13T14:30',type:'mixed'}),/retour client ou garantie/);assert.match(F.planProblem({collector:'',pickupAt:'2026-10-13T14:30',type:'return'}),/le livreur/);
 assert.match(F.planProblem({collector:'charlie',pickupAt:'',type:'return'}),/jour et heure/);assert.equal(F.planProblem({collector:'charlie',pickupAt:'2026-10-13T14:30',type:'warranty'}),'');
 const sql=read('returns-roles.sql');assert.match(sql,/public\.returns_collector_label\(who\) is null or coalesce\(case_type,''\) not in \('return','warranty'\)\s+or slot !~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T\[0-9\]\{2\}:\[0-9\]\{2\}\$' then raise exception 'Invalid plan'/);
});
test('« Collectes à organiser »: what waits for a driver, then every driver with his collections; nothing taken is offered',()=>{
 const cases=[dossier(1,'requested'),dossier(2,'requested',{collector:'charlie',pickup_at:'2026-10-13T14:30'}),dossier(3,'requested',{collector:'charlie',pickup_at:'2026-10-13T09:00'}),dossier(4,'requested',{collector:'ace'}),dossier(5,'collected',{collector:'charlie',pickup_at:'2026-10-12T09:00'}),dossier(6,'collected',{collector:'serge',type:'deposit'}),dossier(7,'cancelled')];
 const plan=F.organise(cases);assert.deepEqual(plan.toPlan.map(c=>c.id),[1]);assert.deepEqual(plan.groups.map(g=>[g.name,g.cases.map(c=>c.id)]),[['Ace',[4]],['Charlie',[3,2]]],'by driver, earliest passage first');
 assert.equal(plan.count,2,'to plan: no driver, or a driver without a passage');assert.deepEqual(plan.typeToFix.map(c=>c.id),[6]);
 assert.equal(F.planned(cases[1].document),true);assert.equal(F.planned(cases[3].document),false);
});
test('« Mes collectes »: only mine, only what is still to take',()=>{
 const cases=[dossier(1,'requested',{collector:'charlie',pickup_at:'2026-10-13T14:30'}),dossier(2,'requested',{collector:'ace',pickup_at:'2026-10-13T09:00'}),dossier(3,'collected',{collector:'charlie'}),dossier(4,'requested',{collector:'charlie',pickup_at:'2026-10-13T08:00'}),dossier(5,'requested')];
 assert.deepEqual(F.mine(cases,'charlie').map(c=>c.id),[4,1]);assert.deepEqual(F.mine(cases,'ace').map(c=>c.id),[2]);assert.deepEqual(F.mine(cases,''),[]);assert.deepEqual(F.mine(cases,'inconnu'),[]);
});
test('reception: a unit is qualified or it is not; what was not scanned is what must be declared',()=>{
 const d=dossier(1,'collected',{},[line('l1',2,2),line('l2',1,1),line('l3',2,1),line('l4',1)]),acts=[action(1,'l1','customer_credit','to_do',1),action(1,'l1','damaged','recorded',1,{comment:'Choc'}),action(1,'l2','damaged','cancelled',1),action(1,'l3','supplier_return','to_send',1)];
 assert.deepEqual(d.document.lines.map(l=>F.unqualified(d,l,acts)),[0,1,0,0],'a cancelled answer leaves the unit to qualify');
 const v=F.lineView(d,d.document.lines[0],acts);assert.deepEqual([v.expected,v.received,v.left,v.ok,v.damaged.length,v.unqualified,v.complete],[2,2,0,1,1,0,true]);
 assert.deepEqual(F.missing(d).map(m=>[m.line.id,m.gap]),[['l3',1],['l4',1]],'a partly received line is missing for the rest');assert.deepEqual(F.progress(d),{expected:6,received:4});
 assert.deepEqual(F.receiving([d,dossier(2,'requested'),dossier(3,'received',{},[line('l1',1,1)]),dossier(4,'received',{},[line('l1',1,0)]),dossier(5,'credited',{},[line('l1',1,1)]),dossier(6,'closed',{},[line('l1',1,1)])],acts).map(r=>[r.dossier.id,r.legacy]),[[1,false],[3,true]]);
 assert.equal(F.outcome(d,[...acts,action(1,'l4','missing','open',1)]),'1 → Avoirs clients · 1 → Retours fournisseur · 1 → Pièces abîmées · 1 → Écarts');
});
test('the queues are filters on the same rows: each part is in one place, none is lost',()=>{
 const cases=[dossier(1,'received',{},[line('l1',3,3),line('l2',1,0)]),dossier(2,'received',{type:'warranty'},[line('l1',2,2),line('l2',1,1)])];
 const acts=[action(1,'l1','damaged','recorded'),action(1,'l1','customer_credit','to_do'),action(1,'l1','customer_credit','issued',1,{id:'x2',document_number:'AV1'}),action(1,'l2','missing','open'),
  action(2,'l1','supplier_return','to_send',1,{supplier_id:'s1',supplier_name:'APO'}),action(2,'l1','supplier_return','to_send',1,{id:'x5'}),action(2,'l2','supplier_return','sent',1,{supplier_id:'s1',supplier_name:'APO'}),action(2,'l2','pending','open',1,{id:'x7'}),action(9,'l1','damaged','recorded',1,{id:'x8'})];
 const q=F.queues(cases,acts);assert.deepEqual(q.counts,{damaged:1,credits:1,stock:1,suppliers:2,gaps:2});assert.equal(q.orphans.length,1,'a part whose dossier is not loaded is said, not dropped');
 assert.deepEqual(q.suppliers.map(g=>[g.label,g.supplierId,g.rows.length]),[['Fournisseur à préciser','',1],['APO','s1',1]],'the supplier to name comes first; a sent part has left the queue');
 assert.deepEqual(q.gaps.map(r=>r.action.kind).sort(),['missing','pending']);assert.equal(q.stock[0].action.document_number,'AV1');assert.equal(q.credits[0].label,'Garage 1');
 const placed=[...q.damaged.flatMap(g=>g.rows),...q.credits.flatMap(g=>g.rows),...q.stock,...q.suppliers.flatMap(g=>g.rows),...q.gaps].map(r=>r.action.id);assert.equal(new Set(placed).size,placed.length,'no part in two queues');
});
test('the history says where a dossier stands in the words of the screens',()=>{
 assert.equal(F.stage(dossier(1,'requested')),'À organiser');assert.equal(F.stage(dossier(1,'requested',{collector:'charlie'})),'À enlever · Charlie');assert.equal(F.stage(dossier(1,'collected')),'Pris · en réception');assert.equal(F.stage(dossier(1,'received')),'Reçu · en traitement');
 assert.equal(F.stage(dossier(1,'closed')),'Terminé');assert.equal(F.stage(dossier(1,'cancelled')),'Annulé');assert.equal(F.stage(dossier(1,'credited')),C.STATUS.credited);
 const lines=[line('l1',1)];assert.equal(F.eventLine({event_kind:'status_changed',from_status:'requested',to_status:'collected'},lines),'À enlever → Pris');assert.equal(F.eventLine({event_kind:'reception',line_id:'l1'},lines),'Réception · REF-l1');
 assert.equal(F.eventLine({event_kind:'action',action_kind:'missing',action_to:'open',line_id:'l1'},lines),'Manquante · REF-l1 : déclarée');assert.equal(F.eventLine({event_kind:'action',action_kind:'missing',action_to:'resolved',line_id:'l1'},lines),'Manquante · REF-l1 : écart réglé');
 assert.equal(F.eventLine({event_kind:'action',action_kind:'damaged',action_from:null,action_to:'recorded',line_id:'l1'},lines),'Abîmée · REF-l1 : Constatée');assert.equal(F.eventLine({event_kind:'assigned',to_collector:'charlie'},lines),'Attribué à Charlie');
});
test('every refusal of the new functions has its words for the agent',()=>{const sql=read('returns-roles.sql').replace(/^--.*$/gm,''),raised=[...new Set([...sql.matchAll(/raise exception '([^']+)' using errcode='([A-Z0-9]+)'/g)].map(m=>m[2]+'|'+m[1]))];
 assert.ok(raised.length>=25,String(raised.length));const internal=['Invalid code','Unknown dossier','Unknown line','Unknown decision','Invalid qualification','Invalid decision','Invalid step','Invalid type','Invalid return status','Invalid collector','Invalid pickup time','Decision changed'];
 for(const r of raised){const [code,message]=r.split('|');if(internal.includes(message))continue;assert.notEqual(F.serverMessage(Object.assign(Error('x'),{code,original:message})),'',message+' is said to the agent');}
});
test('the migration is additive, idempotent, pasted as is, and opens nothing beyond the session and the public request',()=>{const sql=read('returns-roles.sql'),body=sql.replace(/^--.*$/gm,'');
 assert.doesNotMatch(sql,/\$\$|^\s*(begin|commit)\s*;/mi,'pastes as is in the Supabase SQL Editor');assert.doesNotMatch(body,/delete from|drop table|drop column|truncate|alter table [a-z_.]+ drop column/i,'nothing is deleted');
 assert.doesNotMatch(body,/update public\.returns_cases(?![^;]*where c\.id=)/,'a dossier is only ever written one at a time, by its identifier');
 for(const statement of body.split(';').map(s=>s.trim()).filter(s=>/^create /.test(s)))assert.match(statement,/^create (or replace function|trigger)/,'re-runnable: '+statement.slice(0,60));
 assert.match(body,/drop trigger if exists returns_line_actions_done on public\.returns_line_actions;\s*create trigger returns_line_actions_done/);for(const c of ['returns_line_actions_kind_check','returns_line_actions_state','returns_line_actions_supplier'])assert.match(body,new RegExp('drop constraint if exists '+c+';\\s*alter table public\\.returns_line_actions add constraint '+c+' '));
 const shared=[...body.matchAll(/create or replace function public\.(shared_[a-z_]+)\(([^)]*)\)/g)];assert.equal(shared.length,11);for(const [,fn,args] of shared)assert.match(args,/session_token text default null$/,fn+' requires the session');
 const grant=body.slice(body.indexOf('grant execute on function'));for(const [,fn] of shared)assert.ok(grant.includes('public.'+fn+'('),fn+' is granted');assert.match(grant,/public\.returns_public_submit_typed\(uuid,uuid,uuid,text,text,jsonb,text\) to anon,authenticated;/);
 assert.match(body,/revoke all on function public\.returns_unqualified\(uuid,jsonb\),public\.returns_route_unit\([^)]*\),public\.returns_close_if_done\(uuid\),public\.returns_line_actions_done\(\),public\.returns_cases_guard\(\) from public,anon,authenticated;/);
 // Exact codes: the same match as before, never an approximate one.
 assert.equal(body.split('public.returns_matching_lines(shop,dossier.document,scanned)').length-1,2);assert.doesNotMatch(body,/\blike\b|ilike|similarity|position\(/i);
 // The former guard is kept whole; two rules are added to it.
 const guard=text=>{const a=text.indexOf('create or replace function public.returns_cases_guard()');return text.slice(a,text.indexOf('end;$repclick_fn$;',a)).split('\n').map(l=>l.trim()).filter(Boolean);};
 const before=guard(read('returns-actions.sql')),after=guard(sql);assert.deepEqual(before.filter(l=>!after.includes(l)),[],'every former rule is still there, word for word');
 assert.ok(after.some(l=>l.includes("raise exception 'Collection is frozen once taken'"))&&after.some(l=>l.includes("raise exception 'Invalid pickup time'")));
 const back=read('returns-roles.rollback.sql');assert.doesNotMatch(back,/delete from|drop table|drop column|truncate/i);assert.match(back,/drop trigger if exists returns_line_actions_done/);for(const [,fn] of shared)assert.ok(back.includes('drop function if exists public.'+fn+'('),fn+' is removed by the rollback');
 assert.doesNotMatch(guard(back).join('\n'),/Collection is frozen once taken/,'the rollback puts the former guard back');
});
