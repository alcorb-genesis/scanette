-- Run after returns-roles.sql. Everything is rolled back. Uses the shop of the shared access.
begin;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $t$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$t$;
create function pg_temp.err(statement text) returns text language plpgsql as $t$
begin execute statement; return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
select set_config('t.shop',(select workspace_id::text from public.shared_access where singleton),true);
select set_config('t.token',repeat('ef',32),true);
insert into public.shared_access_sessions(token_hash,expires_at) values(encode(extensions.digest(current_setting('t.token'),'sha256'),'hex'),clock_timestamp()+interval '10 minutes');
insert into public.gestion_partners(id,workspace_id,kind,name,details,departures,version) values
 ('a0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'supplier','ZZ APO','{}','[]',1),
 ('a0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'client','ZZ GARAGE','{}','[]',1);
insert into public.scanette_products(id,workspace_id,reference,description,internal_barcode,manufacturer_barcode,source_line,source_sha256) values
 ('b0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'ZZ-REF-1','Filtre test','2990000000011','4990000000019',990001,repeat('e',64)),
 ('b0000000-0000-4000-8000-000000000009',current_setting('t.shop')::uuid,'ZZ-REF-9','Voisin',null,'4990000000099',990009,repeat('e',64));
-- d1 customer return, d2 warranty, both to organise. d3 older dossier, received, one unit without decision.
-- d4 older dossier of another type, already collected. d5 collected with a unit received before this file.
insert into public.returns_cases(id,workspace_id,document,version) values
 ('d0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'{"type":"return","status":"requested","client_id":"a0000000-0000-4000-8000-000000000003","client_name":"ZZ GARAGE","supplier_name":"","pickup_location":"Accueil","lines":[
   {"id":"l1","product_id":"b0000000-0000-4000-8000-000000000001","reference":"ZZ-REF-1","description":"Filtre test","quantity":2,"received_quantity":null,"reason":""},
   {"id":"l2","product_id":null,"reference":"ZZ-REF-2","description":"","quantity":1,"received_quantity":null,"reason":""},
   {"id":"l3","product_id":null,"reference":"ZZ-REF-3","description":"","quantity":1,"received_quantity":null,"reason":""}]}',1),
 ('d0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'{"type":"warranty","status":"requested","client_name":"ZZ GARAGE","supplier_name":"","lines":[
   {"id":"l1","product_id":"b0000000-0000-4000-8000-000000000001","reference":"ZZ-REF-1","description":"Filtre test","quantity":1,"received_quantity":null,"reason":""},
   {"id":"l2","product_id":null,"reference":"ZZ-REF-2","description":"","quantity":1,"received_quantity":null,"reason":""}]}',1),
 ('d0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'{"type":"return","status":"received","client_name":"ZZ ANCIEN","supplier_name":"","collector":"serge","lines":[{"id":"l1","reference":"ZZ-REF-1","quantity":1,"received_quantity":1,"reason":""}]}',4),
 ('d0000000-0000-4000-8000-000000000004',current_setting('t.shop')::uuid,'{"type":"mixed","status":"collected","client_name":"ZZ MIXTE","supplier_name":"","collector":"serge","lines":[{"id":"l1","reference":"ZZ-REF-2","quantity":2,"received_quantity":null,"reason":""}]}',2),
 ('d0000000-0000-4000-8000-000000000005',current_setting('t.shop')::uuid,'{"type":"return","status":"collected","client_name":"ZZ EN COURS","supplier_name":"","collector":"serge","lines":[{"id":"l1","reference":"ZZ-REF-1","quantity":2,"received_quantity":1,"reason":""},{"id":"l2","reference":"ZZ-REF-2","quantity":1,"received_quantity":null,"reason":""}]}',3);
select set_config('t.before',(select coalesce(md5(string_agg(c.id::text||c.document::text||c.version,'' order by c.id)),'none') from public.returns_cases c where c.id::text not like 'd0000000-%'),true);

select set_config('request.jwt.claim.sub','',true);
set local role anon;
create function pg_temp.tok() returns text language sql as $t$ select current_setting('t.token') $t$;
create function pg_temp.d(n integer) returns uuid language sql as $t$ select ('d0000000-0000-4000-8000-00000000000'||n)::uuid $t$;
create function pg_temp.doc(n integer) returns jsonb language sql as $t$ select r.document from public.shared_returns(500,pg_temp.tok()) r where r.id=pg_temp.d(n) $t$;
create function pg_temp.ver(n integer) returns integer language sql as $t$ select r.version from public.shared_returns(500,pg_temp.tok()) r where r.id=pg_temp.d(n) $t$;
create function pg_temp.line(n integer,l text) returns jsonb language sql as $t$ select x.value from jsonb_array_elements(pg_temp.doc(n)->'lines') x where x.value->>'id'=l $t$;
create function pg_temp.plan(n integer,who text,slot text,kind text,v integer default null) returns text language plpgsql as $t$
begin perform public.shared_return_plan(pg_temp.d(n),who,slot,kind,coalesce(v,pg_temp.ver(n)),' Nadia ',pg_temp.tok()); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.taken(n integer) returns text language plpgsql as $t$
begin perform public.shared_return_taken(pg_temp.d(n),null,'Charlie',pg_temp.tok()); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.ident(n integer,code text) returns text language plpgsql as $t$
declare r record; begin select * into r from public.shared_return_identify(pg_temp.d(n),code,pg_temp.tok()); return r.line_id||' '||r.received||'/'||r.quantity; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.part(n integer,code text,state text,why text default '') returns text language plpgsql as $t$
declare r record; begin select * into r from public.shared_return_receive_part(pg_temp.d(n),code,state,why,'Léa',pg_temp.tok()); return r.line_id; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.qualify(n integer,l text,state text,why text default '') returns text language plpgsql as $t$
declare a public.returns_line_actions; begin a:=public.shared_return_qualify(pg_temp.d(n),l,state,why,'Léa',pg_temp.tok()); return a.kind||' '||a.status||' '||a.quantity; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.finish(n integer,missing text[]) returns text language plpgsql as $t$
begin perform public.shared_return_finish(pg_temp.d(n),missing,'Léa',pg_temp.tok()); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.acts(n integer) returns text language sql as $t$
 select coalesce(string_agg(a.line_id||':'||a.kind||':'||a.status||':'||a.quantity,' ' order by a.line_id,a.kind,a.created_at),'') from public.shared_return_actions(pg_temp.tok()) a where a.case_id=pg_temp.d(n) $t$;
create function pg_temp.act(n integer,l text,k text) returns public.returns_line_actions language sql as $t$
 select a from public.shared_return_actions(pg_temp.tok()) a where a.case_id=pg_temp.d(n) and a.line_id=l and a.kind=k order by a.created_at limit 1 $t$;
create function pg_temp.journal(n integer) returns text language sql as $t$
 select string_agg(e.event_kind||'/'||coalesce(e.to_status,'')||'/'||coalesce(e.action_kind,'')||'/'||coalesce(e.action_to,'')||'/'||coalesce(e.actor_label,'')||'/'||e.note,' | ' order by e.created_at) from public.shared_return_events(pg_temp.d(n),pg_temp.tok()) e $t$;

-- 1. Organise: a collector, a passage and the type, only before the parts are taken.
select pg_temp.expect('the page can tell this file is applied',public.shared_returns_flow(pg_temp.tok())=1);
select pg_temp.expect('unknown collector refused',pg_temp.plan(1,'personne','2026-10-13T14:30','return') like '22023 Invalid plan%');
select pg_temp.expect('a passage without hour refused',pg_temp.plan(1,'charlie','2026-10-13','return') like '22023 Invalid plan%');
select pg_temp.expect('an impossible date refused',pg_temp.plan(1,'charlie','2026-13-45T14:30','return') like '22023 Invalid plan%');
select pg_temp.expect('a type other than the two refused',pg_temp.plan(1,'charlie','2026-10-13T14:30','mixed') like '22023 Invalid plan%' and pg_temp.plan(1,'charlie','2026-10-13T14:30','') like '22023 Invalid plan%');
select pg_temp.expect('nothing written by a refused plan',pg_temp.ver(1)=1 and not pg_temp.doc(1) ? 'pickup_at');
select pg_temp.expect('the parts cannot be taken before a collector is chosen',pg_temp.taken(1) like '22023 Collector required%');
select pg_temp.expect('a dossier is organised',pg_temp.plan(1,'charlie','2026-10-13T14:30','return')='ok' and pg_temp.doc(1)->>'collector'='charlie' and pg_temp.doc(1)->>'pickup_at'='2026-10-13T14:30' and pg_temp.doc(1)->>'type'='return' and pg_temp.doc(1)->>'status'='requested');
select pg_temp.expect('a stale screen does not overwrite',pg_temp.plan(1,'serge','2026-10-13T16:00','return',1) like 'PT409%');
select pg_temp.expect('it can be changed while the parts are not taken',pg_temp.plan(1,'serge','2026-10-14T09:00','return')='ok' and pg_temp.plan(1,'charlie','2026-10-14T09:15','return')='ok' and pg_temp.plan(1,'charlie','2026-10-14T10:00','return')='ok' and pg_temp.doc(1)->>'pickup_at'='2026-10-14T10:00');
select pg_temp.expect('the journal says who was chosen, when, by whom',pg_temp.journal(1) like '%assigned/requested///Nadia/Passage prévu : 2026-10-13 à 14:30%' and pg_temp.journal(1) like '%updated/requested///Nadia/Passage prévu : 2026-10-14 à 10:00%');
select pg_temp.expect('lines and announced quantities untouched by the plan',pg_temp.doc(1)->'lines'->0->>'quantity'='2' and jsonb_array_length(pg_temp.doc(1)->'lines')=3 and pg_temp.doc(1)->>'pickup_location'='Accueil');
select pg_temp.expect('« Pris »',pg_temp.taken(1)='ok' and pg_temp.doc(1)->>'status'='collected' and pg_temp.journal(1) like '%status_changed/collected///Charlie/Pris par le livreur%');
select pg_temp.expect('taken once',pg_temp.taken(1) like '22023 Already taken%');
select pg_temp.expect('once taken, the plan is frozen',pg_temp.plan(1,'serge','2026-10-15T09:00','return') like '22023 Collection is frozen once taken%');
select pg_temp.expect('frozen for the former write path too',pg_temp.err(format($q$select public.shared_save_return(%L,%s,%L::jsonb,'',%L)$q$,pg_temp.d(1),pg_temp.ver(1),(pg_temp.doc(1)||'{"collector":"serge"}')::text,pg_temp.tok())) like '22023 Collection is frozen once taken%'
 and pg_temp.err(format($q$select public.shared_save_return(%L,%s,%L::jsonb,'',%L)$q$,pg_temp.d(1),pg_temp.ver(1),(pg_temp.doc(1)||'{"pickup_at":"2026-10-20T08:00"}')::text,pg_temp.tok())) like '22023 Collection is frozen once taken%');

-- 2. Reception: the code is exact, and the part is qualified in the same step.
select pg_temp.expect('a neighbour reference or barcode is not a part of the dossier',pg_temp.ident(1,'ZZ-REF-9') like 'PT404%' and pg_temp.ident(1,'4990000000099') like 'PT404%' and pg_temp.ident(1,'ZZ-REF-') like 'PT404%' and pg_temp.ident(1,'ZZREF1') like 'PT404%');
select pg_temp.expect('an exact reference or barcode designates its line, and writes nothing',pg_temp.ident(1,'ZZ-REF-1')='l1 0/2' and pg_temp.ident(1,'4990000000019')='l1 0/2' and pg_temp.ident(1,'2990000000011')='l1 0/2' and pg_temp.ident(1,'zz-ref-2')='l2 0/1' and pg_temp.line(1,'l1')->>'received_quantity' is null);
select set_config('t.v',pg_temp.ver(1)::text,true);
select pg_temp.expect('a part is never received without its qualification',pg_temp.part(1,'ZZ-REF-1','') like '22023 Invalid qualification%' and pg_temp.part(1,'ZZ-REF-1','later') like '22023 Invalid qualification%');
select pg_temp.expect('damaged needs its reason',pg_temp.part(1,'ZZ-REF-1','damaged','   ') like '22023 Reason required%');
select pg_temp.expect('an unknown reference is refused and creates nothing',pg_temp.part(1,'ZZ-REF-9','ok') like 'PT404%' and pg_temp.part(1,'INCONNUE','damaged','choc') like 'PT404%' and jsonb_array_length(pg_temp.doc(1)->'lines')=3);
select pg_temp.expect('nothing written by refused scans',pg_temp.ver(1)=current_setting('t.v')::integer and pg_temp.acts(1)='');
select pg_temp.expect('customer return, conforming → customer credit to do',pg_temp.part(1,'ZZ-REF-1','ok')='l1' and pg_temp.line(1,'l1')->>'received_quantity'='1' and pg_temp.acts(1)='l1:customer_credit:to_do:1');
select pg_temp.expect('the second unit by its barcode joins the same row',pg_temp.part(1,'4990000000019','ok')='l1' and pg_temp.acts(1)='l1:customer_credit:to_do:2');
select pg_temp.expect('no unit beyond what was announced',pg_temp.part(1,'ZZ-REF-1','ok') like '22023 Line already complete%' and pg_temp.ident(1,'ZZ-REF-1') like '22023 Line already complete%');
select pg_temp.expect('damaged → damaged parts at once, with its reason',pg_temp.part(1,'ZZ-REF-2','damaged','  Carton   écrasé ')='l2' and pg_temp.acts(1)='l1:customer_credit:to_do:2 l2:damaged:recorded:1' and (pg_temp.act(1,'l2','damaged')).comment='Carton écrasé');
select pg_temp.expect('the journal keeps scan, qualification and author',pg_temp.journal(1) like '%reception/collected//2/Léa/Scan : 4990000000019 · Conforme%' and pg_temp.journal(1) like '%reception/collected//1/Léa/Scan : ZZ-REF-2 · Abîmée : Carton écrasé%' and pg_temp.journal(1) like '%action/collected/damaged/recorded/Léa/Carton écrasé%');
select pg_temp.expect('the dossier is still in reception',pg_temp.doc(1)->>'status'='collected');

-- 3. End of the reception: what was not scanned is declared missing, explicitly.
select pg_temp.expect('a line not scanned cannot be passed over',pg_temp.finish(1,'{}') like '22023 Missing parts must be declared%' and pg_temp.finish(1,null) like '22023 Missing parts must be declared%');
select pg_temp.expect('a received line cannot be declared missing',pg_temp.finish(1,'{l3,l2}') like '22023 Missing parts must be declared%' and pg_temp.finish(1,'{l2}') like '22023 Missing parts must be declared%');
select pg_temp.expect('still in reception after refusals',pg_temp.doc(1)->>'status'='collected' and pg_temp.line(1,'l3')->>'received_quantity' is null);
select pg_temp.expect('reception finished',pg_temp.finish(1,'{l3}')='ok' and pg_temp.doc(1)->>'status'='received');
select pg_temp.expect('the missing line is received at zero, with its reason, and joins the gaps',pg_temp.line(1,'l3')->>'received_quantity'='0' and pg_temp.line(1,'l3')->>'reason'='Manquante : 1 sur 1' and pg_temp.acts(1)='l1:customer_credit:to_do:2 l2:damaged:recorded:1 l3:missing:open:1');
select pg_temp.expect('scanned lines are not rewritten by the end of the reception',pg_temp.line(1,'l1')->>'received_quantity'='2' and pg_temp.line(1,'l1')->>'reason'='' and pg_temp.line(1,'l2')->>'received_quantity'='1');
select pg_temp.expect('no scan after the reception',pg_temp.part(1,'ZZ-REF-3','ok') like '22023 Dossier not in reception%' and pg_temp.finish(1,'{}') like '22023 Dossier not in reception%');
select pg_temp.expect('not closed while a credit and a gap are open',pg_temp.doc(1)->>'status'='received');

-- 4. Customer credit → number at the moment it is issued → stock; gap settled; the dossier closes by itself.
select pg_temp.expect('a credit is not issued without its number',pg_temp.err(format($q$select public.shared_return_credit_issue(%L,'  ',null,'Nadia',%L)$q$,(pg_temp.act(1,'l1','customer_credit')).id,pg_temp.tok())) like '22023 Document number required%');
select pg_temp.expect('credit issued under its number',pg_temp.err(format($q$select public.shared_return_credit_issue(%L,' AV  2026-118 ',null,'Nadia',%L)$q$,(pg_temp.act(1,'l1','customer_credit')).id,pg_temp.tok()))='ok' and (pg_temp.act(1,'l1','customer_credit')).status='issued' and (pg_temp.act(1,'l1','customer_credit')).document_number='AV 2026-118');
select pg_temp.expect('issued once',pg_temp.err(format($q$select public.shared_return_credit_issue(%L,'X',null,'Nadia',%L)$q$,(pg_temp.act(1,'l1','customer_credit')).id,pg_temp.tok())) like '22023 Invalid step%');
select pg_temp.expect('put back in stock, with its place',pg_temp.err(format($q$select public.shared_return_action_move(%L,'restocked','',null,'Nadia','A12C',%L)$q$,(pg_temp.act(1,'l1','customer_credit')).id,pg_temp.tok()))='ok' and pg_temp.doc(1)->>'status'='received');
select pg_temp.expect('a gap is settled, not a credit',pg_temp.err(format($q$select public.shared_return_gap_resolve(%L,'',null,'Nadia',%L)$q$,(pg_temp.act(1,'l1','customer_credit')).id,pg_temp.tok())) like '22023 Invalid step%'
 and pg_temp.err(format($q$select public.shared_return_gap_resolve(%L,'Vu avec le garage',null,'Nadia',%L)$q$,(pg_temp.act(1,'l3','missing')).id,pg_temp.tok()))='ok');
select pg_temp.expect('everything settled: the dossier closed by itself, and the journal says so',pg_temp.doc(1)->>'status'='closed' and pg_temp.journal(1) like '%status_changed/closed////Clôture automatique : toutes les pièces sont traitées%' and pg_temp.journal(1) like '%/missing/resolved/Nadia/Vu avec le garage%');
select pg_temp.expect('received quantities never rewritten by the processing',pg_temp.line(1,'l1')->>'received_quantity'='2' and pg_temp.line(1,'l3')->>'received_quantity'='0');

-- 5. Warranty: conforming → supplier return; supplier asked when unknown; exact rescan into the carton kept.
select pg_temp.expect('warranty organised and taken',pg_temp.plan(2,'ace','2026-10-13T11:00','warranty')='ok' and pg_temp.taken(2)='ok');
select pg_temp.expect('warranty, conforming → supplier return, supplier not guessed',pg_temp.part(2,'ZZ-REF-1','ok')='l1' and pg_temp.acts(2)='l1:supplier_return:to_send:1' and (pg_temp.act(2,'l1','supplier_return')).supplier_id is null and (pg_temp.act(2,'l1','supplier_return')).supplier_name='');
select pg_temp.expect('warranty, damaged → damaged parts',pg_temp.part(2,'ZZ-REF-2','damaged','Filetage arraché')='l2' and pg_temp.acts(2)='l1:supplier_return:to_send:1 l2:damaged:recorded:1');
select pg_temp.expect('nothing missing: the reception ends without declaration',pg_temp.finish(2,'{}')='ok' and pg_temp.doc(2)->>'status'='received');
select pg_temp.expect('a client is not a supplier',pg_temp.err(format($q$select public.shared_return_action_supplier(%L,'a0000000-0000-4000-8000-000000000003',null,'Nadia',%L)$q$,(pg_temp.act(2,'l1','supplier_return')).id,pg_temp.tok())) like '22023 Supplier required%');
select pg_temp.expect('the supplier is named',pg_temp.err(format($q$select public.shared_return_action_supplier(%L,'a0000000-0000-4000-8000-000000000001',null,'Nadia',%L)$q$,(pg_temp.act(2,'l1','supplier_return')).id,pg_temp.tok()))='ok' and (pg_temp.act(2,'l1','supplier_return')).supplier_name='ZZ APO');
select set_config('t.carton',(public.shared_return_shipment_open('a0000000-0000-4000-8000-000000000001','Nadia',pg_temp.tok())).id::text,true);
select pg_temp.expect('the carton still takes exact codes only',pg_temp.err(format($q$select public.shared_return_pack(%L,'ZZ-REF-9','Nadia',%L)$q$,current_setting('t.carton'),pg_temp.tok())) like 'PT404%' and pg_temp.err(format($q$select public.shared_return_pack(%L,'4990000000019','Nadia',%L)$q$,current_setting('t.carton'),pg_temp.tok()))='ok');
select pg_temp.expect('not closed while the carton has not left',pg_temp.doc(2)->>'status'='received');
select pg_temp.expect('carton sent: the warranty dossier closed by itself',pg_temp.err(format($q$select public.shared_return_shipment_send(%L,'','Nadia',%L)$q$,current_setting('t.carton'),pg_temp.tok()))='ok' and (pg_temp.act(2,'l1','supplier_return')).status='sent' and pg_temp.doc(2)->>'status'='closed');

-- 6. Dossiers that existed before: readable, never rewritten, completed with the same two answers.
select pg_temp.expect('an older received unit waits for its qualification: the dossier does not close',pg_temp.doc(3)->>'status'='received' and pg_temp.acts(3)='');
select pg_temp.expect('it is qualified without rescan',pg_temp.qualify(3,'l1','damaged') like '22023 Reason required%' and pg_temp.qualify(3,'l1','ok')='customer_credit to_do 1' and pg_temp.qualify(3,'l1','ok') like '22023 Nothing to qualify%');
select pg_temp.expect('its reception is untouched',pg_temp.line(3,'l1')->>'received_quantity'='1' and pg_temp.ver(3)=4);
select pg_temp.expect('another type: conforming cannot be routed, damaged can',pg_temp.part(4,'ZZ-REF-2','ok') like '22023 Type required%' and pg_temp.part(4,'ZZ-REF-2','damaged','Rayée')='l1');
select pg_temp.expect('the type is one of the two',pg_temp.err(format($q$select public.shared_return_set_type(%L,'deposit','Nadia',%L)$q$,pg_temp.d(4),pg_temp.tok())) like '22023 Type required%' and pg_temp.err(format($q$select public.shared_return_set_type(%L,'warranty','Nadia',%L)$q$,pg_temp.d(4),pg_temp.tok()))='ok' and pg_temp.doc(4)->>'type'='warranty');
select pg_temp.expect('then the conforming part is routed, and the type is fixed',pg_temp.part(4,'ZZ-REF-2','ok')='l1' and pg_temp.acts(4)='l1:damaged:recorded:1 l1:supplier_return:to_send:1' and pg_temp.err(format($q$select public.shared_return_set_type(%L,'return','Nadia',%L)$q$,pg_temp.d(4),pg_temp.tok())) like '22023 Type is fixed once a part is routed%');
select pg_temp.expect('a unit received before this file blocks the end until it is qualified',pg_temp.finish(5,'{l1,l2}') like '22023 Parts not qualified%' and pg_temp.qualify(5,'l1','damaged','Choc')='damaged recorded 1');
select pg_temp.expect('a partly received line is declared missing for the rest',pg_temp.finish(5,'{l2}') like '22023 Missing parts must be declared%' and pg_temp.finish(5,'{l1,l2}')='ok' and pg_temp.line(5,'l1')->>'received_quantity'='1' and pg_temp.line(5,'l1')->>'reason'='Manquante : 1 sur 2' and pg_temp.acts(5)='l1:damaged:recorded:1 l1:missing:open:1 l2:missing:open:1');
select pg_temp.expect('a qualification entered by mistake is cancelled, then given again',pg_temp.err(format($q$select public.shared_return_action_move(%L,'cancelled','Erreur de saisie',null,'Léa','',%L)$q$,(pg_temp.act(5,'l1','damaged')).id,pg_temp.tok()))='ok' and pg_temp.qualify(5,'l1','ok')='customer_credit to_do 1');
select pg_temp.expect('the former decisions still work on a received dossier',pg_temp.err(format($q$select public.shared_return_action_move(%L,'issued','',null,'Nadia','',%L)$q$,(pg_temp.act(3,'l1','customer_credit')).id,pg_temp.tok()))='ok');

-- 7. The garage chooses the type on the public portal. Same checks and limits as before.
reset role;
insert into public.returns_public_portals(workspace_id,enabled) values(current_setting('t.shop')::uuid,true) on conflict (workspace_id) do update set enabled=true;
set local role anon;
select pg_temp.expect('a request without one of the two types is refused',pg_temp.err(format($q$select public.returns_public_submit_typed(%L,'e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',null,'Accueil','[{"reference":"ZZ-REF-1","quantity":1}]','mixed')$q$,current_setting('t.shop'))) like '22023 Invalid type%'
 and pg_temp.err(format($q$select public.returns_public_submit_typed(%L,'e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',null,'Accueil','[{"reference":"ZZ-REF-1","quantity":1}]',null)$q$,current_setting('t.shop'))) like '22023 Invalid type%');
select pg_temp.expect('the checks of the public request still apply',pg_temp.err(format($q$select public.returns_public_submit_typed(%L,'e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',null,'','[{"reference":"ZZ-REF-1","quantity":1}]','warranty')$q$,current_setting('t.shop'))) like '22023 Invalid pickup location%');
select pg_temp.expect('warranty and return requests',public.returns_public_submit_typed(current_setting('t.shop')::uuid,'e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',null,'Accueil','[{"reference":"ZZ-REF-1","quantity":1}]','warranty')='e0000000-0000-4000-8000-000000000001'
 and public.returns_public_submit_typed(current_setting('t.shop')::uuid,'e0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003',null,'Accueil','[{"reference":"ZZ-REF-1","quantity":1}]','return')='e0000000-0000-4000-8000-000000000002');
select pg_temp.expect('the type is stored; everything else as the public request writes it',(select r.document->>'type'='warranty' and r.document->>'status'='requested' and r.document->>'source'='public_portal' and r.version=1 from public.shared_returns(500,pg_temp.tok()) r where r.id='e0000000-0000-4000-8000-000000000001')
 and (select r.document->>'type'='return' from public.shared_returns(500,pg_temp.tok()) r where r.id='e0000000-0000-4000-8000-000000000002'));
select pg_temp.expect('a retry changes nothing, even with another type',public.returns_public_submit_typed(current_setting('t.shop')::uuid,'e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000003',null,'Ailleurs','[{"reference":"ZZ-REF-1","quantity":5}]','return')='e0000000-0000-4000-8000-000000000001'
 and (select r.document->>'type'='warranty' and r.document->>'pickup_location'='Accueil' from public.shared_returns(500,pg_temp.tok()) r where r.id='e0000000-0000-4000-8000-000000000001'));
select pg_temp.expect('the former public request still answers',pg_get_function_result('public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)='uuid');

-- 8. Rights, and what was there before.
select pg_temp.expect('no session, no access',pg_temp.err($q$select public.shared_returns_flow('nope')$q$) not like 'ok' and pg_temp.err(format($q$select * from public.shared_return_identify(%L,'ZZ-REF-1','nope')$q$,pg_temp.d(4))) not like 'ok'
 and pg_temp.err(format($q$select public.shared_return_taken(%L,null,'x','nope')$q$,pg_temp.d(4))) not like 'ok' and pg_temp.err(format($q$select public.shared_return_finish(%L,'{}','x','nope')$q$,pg_temp.d(4))) not like 'ok');
select pg_temp.expect('internal helpers closed',pg_temp.err(format($q$select public.returns_close_if_done(%L)$q$,pg_temp.d(4))) like '42501%' and pg_temp.err(format($q$select public.returns_unqualified(%L,'{}'::jsonb)$q$,pg_temp.d(4))) like '42501%');
select pg_temp.expect('tables still closed',pg_temp.err('select 1 from public.returns_line_actions limit 1') like '42501%' and pg_temp.err('select 1 from public.returns_cases limit 1') like '42501%' and pg_temp.err('select 1 from public.returns_case_events limit 1') like '42501%');
reset role;
select pg_temp.expect('no dossier that existed before was rewritten',current_setting('t.before')=(select coalesce(md5(string_agg(c.id::text||c.document::text||c.version,'' order by c.id)),'none') from public.returns_cases c where c.id::text not like 'd0000000-%' and c.id::text not like 'e0000000-%'));
select pg_temp.expect('nothing is ever deleted from the journal',(select count(*) from public.returns_case_events e where e.case_id=pg_temp.d(1))>=14);
rollback;
select 'returns-roles: all checks passed' as result;
