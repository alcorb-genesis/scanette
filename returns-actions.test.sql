-- Run after returns-actions.sql. Everything is rolled back. Uses the shop of the shared access.
-- Note: once returns-roles.sql is applied, a received dossier closes by itself when nothing of it is still running;
-- the check « cancelling needs a reason and frees the quantity » then stops on its last step (the dossier is closed).
-- This file describes the base as returns-actions.sql leaves it; returns-roles.test.sql describes the current rules.
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
 ('a0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'supplier','ZZ BOSCH','{}','[]',1),
 ('a0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'client','ZZ GARAGE','{}','[]',1);
insert into public.scanette_products(id,workspace_id,reference,description,internal_barcode,manufacturer_barcode,source_line,source_sha256) values
 ('b0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'ZZ-REF-1','Filtre test','2990000000011','4990000000019',990001,repeat('e',64)),
 ('b0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'ZZ-REF-2','Disque test',null,'4990000000026',990002,repeat('e',64));
-- A received dossier (2 × ZZ-REF-1 linked to the catalogue, 1 × ZZ-REF-2 typed by hand, 1 line not received) and one still to collect.
insert into public.returns_cases(id,workspace_id,document,version) values
 ('c0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'{"type":"return","status":"received","client_id":"a0000000-0000-4000-8000-000000000003","client_name":"ZZ GARAGE","supplier_name":"","collector":"serge","lines":[
   {"id":"l1","product_id":"b0000000-0000-4000-8000-000000000001","reference":"ZZ-REF-1","description":"Filtre test","quantity":2,"received_quantity":2,"reason":""},
   {"id":"l2","product_id":null,"reference":"ZZ-REF-2","description":"","quantity":1,"received_quantity":1,"reason":""},
   {"id":"l3","product_id":null,"reference":"ZZ-REF-3","description":"","quantity":1,"received_quantity":0,"reason":"Absente du carton"}]}',3),
 ('c0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'{"type":"return","status":"requested","client_name":"ZZ GARAGE","supplier_name":"","lines":[{"id":"l1","reference":"ZZ-REF-1","quantity":1,"received_quantity":null}]}',1);

select set_config('request.jwt.claim.sub','',true);
set local role anon;
create function pg_temp.add(line text,kind text,qty integer,supplier uuid default null,doc text default '',note text default '',dossier uuid default 'c0000000-0000-4000-8000-000000000001') returns text language plpgsql as $t$
declare a public.returns_line_actions;
begin a:=public.shared_return_action_add(dossier,line,kind,qty,supplier,doc,note,'  Léa  ',current_setting('t.token')); return a.id::text; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.move(action text,target text,note text default '',place text default '') returns text language plpgsql as $t$
begin perform public.shared_return_action_move(action::uuid,target,note,null,'Léa',place,current_setting('t.token')); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.pack(carton text,code text) returns text language plpgsql as $t$
declare a public.returns_line_actions;
begin a:=public.shared_return_pack(carton::uuid,code,'Léa',current_setting('t.token')); return a.line_id||' '||a.packed_quantity||'/'||a.quantity||' '||a.status; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.state(action text) returns text language sql as $t$ select a.status from public.shared_return_actions(current_setting('t.token')) a where a.id=action::uuid $t$;

-- 0. Reception is owned by the server: exact scan or declared line, nothing else.
reset role;
insert into public.returns_cases(id,workspace_id,document,version) values
 ('c0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'{"type":"return","status":"collected","client_id":"a0000000-0000-4000-8000-000000000003","client_name":"ZZ GARAGE","supplier_name":"","collector":"serge","lines":[
   {"id":"l1","product_id":"b0000000-0000-4000-8000-000000000001","reference":"ZZ-REF-1","description":"Filtre test","quantity":2,"received_quantity":null,"reason":""},
   {"id":"l2","product_id":null,"reference":"ZZ-REF-2","description":"","quantity":1,"received_quantity":null,"reason":""},
   {"id":"l3","product_id":null,"reference":"ZZ-REF-3","description":"","quantity":1,"received_quantity":null,"reason":""},
   {"id":"l4","product_id":null,"reference":"ZZ-DOUBLE","description":"","quantity":1,"received_quantity":null,"reason":""},
   {"id":"l5","product_id":null,"reference":"ZZ-DOUBLE","description":"","quantity":1,"received_quantity":null,"reason":""}]}',2);
set local role anon;
create function pg_temp.scan(code text,dossier uuid default 'c0000000-0000-4000-8000-000000000003') returns text language plpgsql as $t$
declare r record;
begin select * into r from public.shared_return_receive(dossier,code,'Léa',current_setting('t.token')); return r.line_id||' '||(select l.value->>'received_quantity' from jsonb_array_elements(r.document->'lines') l where l.value->>'id'=r.line_id); exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.declare(line text,qty integer,why text,dossier uuid default 'c0000000-0000-4000-8000-000000000003') returns text language plpgsql as $t$
begin perform public.shared_return_receive_line(dossier,line,qty,why,'Léa',current_setting('t.token')); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.doc(dossier uuid) returns jsonb language sql as $t$ select r.document from public.shared_returns(500,current_setting('t.token')) r where r.id=dossier $t$;
create function pg_temp.version(dossier uuid) returns integer language sql as $t$ select r.version from public.shared_returns(500,current_setting('t.token')) r where r.id=dossier $t$;
create function pg_temp.save(dossier uuid,d jsonb) returns text language plpgsql as $t$
begin perform public.shared_save_return(dossier,pg_temp.version(dossier),d,'',current_setting('t.token')); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
select pg_temp.expect('no session, no reception',pg_temp.err($q$select * from public.shared_return_receive('c0000000-0000-4000-8000-000000000003','ZZ-REF-1','',null)$q$) like 'PT401%' and pg_temp.err($q$select * from public.shared_return_receive_line('c0000000-0000-4000-8000-000000000003','l3',0,'x','',null)$q$) like 'PT401%');
select pg_temp.expect('a reference absent from the dossier is refused',pg_temp.scan('ZZ-AUTRE') like 'PT404%' and pg_temp.scan('ZZ-REF-9') like 'PT404%');
select pg_temp.expect('a near scan is refused: prefix, extra character, missing separator, truncated barcode',pg_temp.scan('ZZ-REF') like 'PT404%' and pg_temp.scan('ZZ-REF-11') like 'PT404%' and pg_temp.scan('ZZREF1') like 'PT404%' and pg_temp.scan('ZZ REF 1') like 'PT404%' and pg_temp.scan('499000000001') like 'PT404%');
select pg_temp.expect('a dossier that is not collected takes no reception',(select count(*) from public.shared_product_lookup('4990000000026',current_setting('t.token')))=1 and pg_temp.scan('4990000000026','c0000000-0000-4000-8000-000000000002') like '22023 Dossier not in reception%');
select pg_temp.expect('nothing was received by these refusals',(select bool_and(l.value->>'received_quantity' is null) from jsonb_array_elements(pg_temp.doc('c0000000-0000-4000-8000-000000000003')->'lines') l) and pg_temp.version('c0000000-0000-4000-8000-000000000003')=2);
select pg_temp.expect('exact reference: one unit',pg_temp.scan(' zz-ref-1 ')='l1 1');
select pg_temp.expect('exact barcode of the linked record: second unit',pg_temp.scan('2990000000011')='l1 2');
select pg_temp.expect('an excessive quantity is refused: nothing beyond what was announced',pg_temp.scan('ZZ-REF-1') like '22023 Line already complete%' and pg_temp.scan('4990000000019') like '22023 Line already complete%');
select pg_temp.expect('a hand-typed line, by the barcode of the record that bears its reference',pg_temp.scan('4990000000026')='l2 1');
select pg_temp.expect('two lines with the same reference are never chosen by chance',pg_temp.scan('ZZ-DOUBLE') like '22023 Several lines match%');
select pg_temp.expect('a declared line needs its reason, an existing line, and never exceeds the announcement',pg_temp.declare('l3',0,'  ') like '22023 Reason required%' and pg_temp.declare('zz',0,'x') like '22023 Unknown line%' and pg_temp.declare('l3',2,'x') like '22023 Quantity exceeds what was announced%' and pg_temp.declare('l3',-1,'x') like '22023%');
select pg_temp.expect('absent part declared at zero; ambiguous lines declared one by one',pg_temp.declare('l3',0,'Absente du carton')='ok' and pg_temp.declare('l4',1,'Étiquette en double')='ok');
select pg_temp.expect('a saved document cannot set or change a received quantity',
 pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{lines,4,received_quantity}','1')) like '22023 Received quantity is set by the reception%'
 and pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{lines,0,received_quantity}','1')) like '22023 Received quantity is set by the reception%'
 and pg_temp.save('c0000000-0000-4000-8000-000000000002',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000002'),'{lines,0,received_quantity}','1')) like '22023 Received quantity is set by the reception%');
select pg_temp.expect('a new dossier cannot arrive already received',pg_temp.err(format($q$select * from public.shared_save_return(gen_random_uuid(),0,%L::jsonb,'',current_setting('t.token'))$q$,'{"type":"return","status":"requested","client_name":"ZZ","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1,"received_quantity":1}]}')) like '22023 Received quantity is set by the reception%');
select pg_temp.expect('once collected the lines are fixed: none added, removed, renamed or resized',
 pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{lines,0,quantity}','5')) like '22023 Lines are fixed once collected%'
 and pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{lines,1,reference}','"ZZ-REF-1"')) like '22023 Lines are fixed once collected%'
 and pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{lines}',(pg_temp.doc('c0000000-0000-4000-8000-000000000003')->'lines')-4)) like '22023 Lines are fixed once collected%');
select pg_temp.expect('the reception cannot be validated while a line is not controlled',pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{status}','"received"')) like '22023 Reception control required%');
select pg_temp.expect('no decision before the reception is validated',pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000003','l1','damaged',1,null,'','Cassée','',current_setting('t.token'))$q$) like '22023 Dossier not received%');
select pg_temp.expect('last line declared, reception validated',pg_temp.declare('l5',1,'Étiquette en double')='ok' and pg_temp.save('c0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('c0000000-0000-4000-8000-000000000003'),'{status}','"received"'))='ok');
select pg_temp.expect('a validated reception is frozen',pg_temp.scan('ZZ-REF-2') like '22023 Dossier not in reception%' and pg_temp.declare('l3',1,'retrouvée') like '22023 Dossier not in reception%');
select pg_temp.expect('decisions are limited by what was really received and validated',
 pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000003','l1','damaged',3,null,'','Cassées','',current_setting('t.token'))$q$) like '22023 Quantity exceeds what was received%'
 and pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000003','l3','customer_credit',1,null,'BL 1','','',current_setting('t.token'))$q$) like '22023 Quantity exceeds what was received%'
 and pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000003','l9','damaged',1,null,'','x','',current_setting('t.token'))$q$) like '22023 Unknown line%'
 and pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000003','l1','damaged',2,null,'','Cassées','',current_setting('t.token'))$q$)='ok');
select pg_temp.expect('the journal keeps every reception step with its author: scans and declared lines',
 (select count(*) filter (where note like 'Scan : %')=3 and count(*) filter (where note like 'Saisie déclarée : %')=3 and bool_and(actor_label='Léa' and line_id is not null)
  from public.shared_return_events('c0000000-0000-4000-8000-000000000003',current_setting('t.token')) where event_kind='reception'));

-- 1. What a decision needs.
select pg_temp.expect('no session, nothing',pg_temp.err($q$select * from public.shared_return_actions(null)$q$) like 'PT401%' and pg_temp.err($q$select public.shared_return_action_add('c0000000-0000-4000-8000-000000000001','l1','damaged',1,null,'','x','',null)$q$) like 'PT401%');
select pg_temp.expect('a dossier not yet received takes no decision',pg_temp.add('l1','damaged',1,null,'','Carton écrasé','c0000000-0000-4000-8000-000000000002') like '22023 Dossier not received%');
select pg_temp.expect('a line that was not received takes no decision',pg_temp.add('l3','damaged',1,null,'','Cassée') like '22023 Quantity exceeds%');
select pg_temp.expect('unknown line',pg_temp.add('zz','damaged',1,null,'','Cassée') like '22023 Unknown line%');
select pg_temp.expect('damaged needs a comment',pg_temp.add('l1','damaged',1,null,'','  ') like '22023 Comment required%');
select pg_temp.expect('supplier return needs a supplier of the shop',pg_temp.add('l1','supplier_return',1) like '22023 Supplier required%' and pg_temp.add('l1','supplier_return',1,'a0000000-0000-4000-8000-000000000003') like '22023 Supplier required%');
select pg_temp.expect('customer credit needs its document number',pg_temp.add('l1','customer_credit',1,null,'  ') like '22023 Document number required%');
select pg_temp.expect('waiting for a decision needs a comment',pg_temp.add('l1','pending',1) like '22023 Comment required%');
select pg_temp.expect('unknown kind',pg_temp.add('l1','destroyed',1,null,'','x') like '22023%');

-- 2. Several decisions on the same line; each kind limited by what was received.
select set_config('t.dmg',pg_temp.add('l1','damaged',1,null,'','Emballage  ouvert'),true);
select set_config('t.sup',pg_temp.add('l1','supplier_return',2,'a0000000-0000-4000-8000-000000000001','','Garantie'),true);
select set_config('t.cre',pg_temp.add('l1','customer_credit',2,null,' BL  123456 '),true);
select set_config('t.pen',pg_temp.add('l2','pending',1,null,'','À voir avec le comptoir'),true);
select set_config('t.sup2',pg_temp.add('l2','supplier_return',1,'a0000000-0000-4000-8000-000000000001'),true);
select set_config('t.bosch',pg_temp.add('l2','damaged',1,null,'','Rayée'),true);
select pg_temp.expect('four kinds recorded, supplier return AND customer credit on the same line',
 (select jsonb_object_agg(kind,n) from (select kind,count(*) n from public.shared_return_actions(current_setting('t.token')) where case_id='c0000000-0000-4000-8000-000000000001' and line_id='l1' group by 1) t)='{"damaged":1,"supplier_return":1,"customer_credit":1}'::jsonb);
select pg_temp.expect('first states, cleaned fields, supplier name from the record',
 (select jsonb_agg(jsonb_build_array(kind,status,quantity,supplier_name,document_number,comment) order by kind) from public.shared_return_actions(current_setting('t.token')) where line_id='l1' and case_id='c0000000-0000-4000-8000-000000000001')
 ='[["customer_credit","to_do",2,"","BL 123456",""],["damaged","recorded",1,"","","Emballage ouvert"],["supplier_return","to_send",2,"ZZ APO","","Garantie"]]'::jsonb);
select pg_temp.expect('a kind cannot exceed the received quantity',pg_temp.add('l1','supplier_return',1,'a0000000-0000-4000-8000-000000000002') like '22023 Quantity exceeds%' and pg_temp.add('l1','damaged',2,null,'','x') like '22023 Quantity exceeds%' and pg_temp.add('l1','damaged',1,null,'','Seconde pièce') not like '22023%');

-- 3. Carton by exact rescan.
select set_config('t.carton',(select id::text from public.shared_return_shipment_open('a0000000-0000-4000-8000-000000000001','Léa',current_setting('t.token'))),true);
select pg_temp.expect('one open carton per supplier',(select id::text from public.shared_return_shipment_open('a0000000-0000-4000-8000-000000000001','Léa',current_setting('t.token')))=current_setting('t.carton'));
select pg_temp.expect('a carton needs a supplier',pg_temp.err($q$select public.shared_return_shipment_open('a0000000-0000-4000-8000-000000000003','',current_setting('t.token'))$q$) like '22023 Supplier required%');
select pg_temp.expect('an empty carton does not leave',pg_temp.err(format($q$select public.shared_return_shipment_send(%L,'','',current_setting('t.token'))$q$,current_setting('t.carton'))) like '22023 Empty carton%');
select pg_temp.expect('a near code is refused',pg_temp.pack(current_setting('t.carton'),'ZZ-REF') like 'PT404%' and pg_temp.pack(current_setting('t.carton'),'ZZ-REF-11') like 'PT404%' and pg_temp.pack(current_setting('t.carton'),'499000000001') like 'PT404%' and pg_temp.pack(current_setting('t.carton'),'ZZ-REF-3') like 'PT404%');
select pg_temp.expect('first unit by reference',pg_temp.pack(current_setting('t.carton'),'zz-ref-1')='l1 1/2 to_send');
select pg_temp.expect('a partly scanned line blocks the sending',pg_temp.err(format($q$select public.shared_return_shipment_send(%L,'','',current_setting('t.token'))$q$,current_setting('t.carton'))) like '22023 A line is partly scanned%');
select pg_temp.expect('second unit by manufacturer barcode',pg_temp.pack(current_setting('t.carton'),'4990000000019')='l1 2/2 packed');
select pg_temp.expect('a third scan of the same part finds nothing left',pg_temp.pack(current_setting('t.carton'),'2990000000011') like 'PT404%');
select pg_temp.expect('a hand-typed line is packed by the barcode of the record that bears its reference',pg_temp.pack(current_setting('t.carton'),'4990000000026')='l2 1/1 packed');
select pg_temp.expect('out of the carton, then back',pg_temp.move(current_setting('t.sup2'),'to_send')='ok' and pg_temp.state(current_setting('t.sup2'))='to_send' and pg_temp.pack(current_setting('t.carton'),'ZZ-REF-2')='l2 1/1 packed');
select pg_temp.expect('packed and sent are never set by hand',pg_temp.move(current_setting('t.sup'),'sent') like '22023 Invalid step%' and pg_temp.move(current_setting('t.sup'),'cancelled','erreur') like '22023 Invalid step%');
select pg_temp.expect('the dossier cannot be closed while decisions run',pg_temp.err($q$select public.shared_save_return('c0000000-0000-4000-8000-000000000001',3,(select jsonb_set(document,'{status}','"closed"') from public.shared_returns(500,current_setting('t.token')) where id='c0000000-0000-4000-8000-000000000001'),'',current_setting('t.token'))$q$) like '22023 Open decisions remain%');
select pg_temp.expect('the carton leaves',(select status='sent' and sent_at is not null and note='Colis 1' from public.shared_return_shipment_send(current_setting('t.carton')::uuid,' Colis  1 ','Léa',current_setting('t.token'))));
select pg_temp.expect('its lines are sent, and a sent carton takes nothing more',pg_temp.state(current_setting('t.sup'))='sent' and pg_temp.state(current_setting('t.sup2'))='sent' and pg_temp.pack(current_setting('t.carton'),'ZZ-REF-1') like '22023 Carton closed%' and pg_temp.move(current_setting('t.sup'),'to_send') like '22023 Invalid step%');
select pg_temp.expect('the next carton of the supplier is a new one',(select id::text<>current_setting('t.carton') and status='open' from public.shared_return_shipment_open('a0000000-0000-4000-8000-000000000001','',current_setting('t.token'))));

-- 4. Customer credit, stock destination, pending, cancellation.
select pg_temp.expect('a credit is issued before its destination',pg_temp.move(current_setting('t.cre'),'restocked','','A12C') like '22023 Invalid step%' and pg_temp.move(current_setting('t.cre'),'issued')='ok');
select pg_temp.expect('put back in stock needs where; no other step takes a destination',pg_temp.move(current_setting('t.cre'),'restocked') like '22023 Stock destination required%' and pg_temp.move(current_setting('t.cre'),'restocked','','   ') like '22023 Stock destination required%' and pg_temp.move(current_setting('t.cre'),'closed_no_stock','','A12C') like '22023 Stock destination required%');
select pg_temp.expect('restocked with its destination',pg_temp.move(current_setting('t.cre'),'restocked','','  Allée  A12C ')='ok');
select pg_temp.expect('the destination is kept, cleaned, and the step is final',(select stock_destination='Allée A12C' from public.shared_return_actions(current_setting('t.token')) a where a.id=current_setting('t.cre')::uuid) and pg_temp.move(current_setting('t.cre'),'closed_no_stock') like '22023 Invalid step%');
select pg_temp.expect('pending is resolved once',pg_temp.move(current_setting('t.pen'),'resolved','Repris par le comptoir')='ok' and pg_temp.move(current_setting('t.pen'),'open') like '22023 Invalid step%');
select pg_temp.expect('cancelling needs a reason and frees the quantity',pg_temp.move(current_setting('t.dmg'),'cancelled') like '22023 Reason required%' and pg_temp.move(current_setting('t.dmg'),'cancelled','Erreur de ligne')='ok' and pg_temp.add('l1','damaged',1,null,'','Bonne ligne') not like '22023%');
select pg_temp.expect('a stale version is refused',pg_temp.err(format($q$select public.shared_return_action_move(%L,'cancelled','x',1,'','',current_setting('t.token'))$q$,current_setting('t.cre'))) like 'PT409%');
select pg_temp.expect('nothing is deleted: the cancelled decision is still listed',pg_temp.state(current_setting('t.dmg'))='cancelled');
select pg_temp.expect('the journal of the dossier tells every decision, with the declared author',
 (select count(*) filter (where event_kind='action')>=14 and bool_and(actor_label='Léa') filter (where event_kind='action')
   and count(*) filter (where action_kind='supplier_return' and action_to='sent')=2 and count(*) filter (where action_kind='customer_credit' and action_from='issued' and action_to='restocked')=1
   and count(*) filter (where action_to='cancelled' and note='Erreur de ligne')=1
  from public.shared_return_events('c0000000-0000-4000-8000-000000000001',current_setting('t.token'))));
select pg_temp.expect('the reception itself is untouched',(select document->'lines'->0->>'received_quantity'='2' and version=3 from public.shared_returns(500,current_setting('t.token')) where id='c0000000-0000-4000-8000-000000000001'));

-- 5. The public visitor sees none of it.
select pg_temp.expect('tables closed to the visitor',pg_temp.err('select 1 from public.returns_line_actions limit 1') like '42501%' and pg_temp.err('select 1 from public.returns_shipments limit 1') like '42501%' and pg_temp.err('select 1 from public.returns_case_events limit 1') like '42501%');
select pg_temp.expect('internal helpers closed',pg_temp.err($q$select public.returns_actor_label('x')$q$) like '42501%');
select pg_temp.expect('the portal functions answer as before: one uuid, a text, two columns',
 (select pg_get_function_result('public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)='uuid' and pg_get_function_result('public.returns_public_designation(uuid,text)'::regprocedure)='text' and pg_get_function_result('public.returns_public_garages(uuid)'::regprocedure)='TABLE(id uuid, name text)'));
reset role;
select pg_temp.expect('no table right for visitors or accounts',not has_table_privilege('anon','public.returns_line_actions','select') and not has_table_privilege('authenticated','public.returns_line_actions','select') and not has_table_privilege('anon','public.returns_shipments','select'));
select pg_temp.expect('every decision points to its dossier and line: no copy of the line',(select count(*)=0 from information_schema.columns where table_name='returns_line_actions' and column_name in ('reference','description','client_name','garage')));
rollback;
select 'returns-actions: all checks passed' as result;
