-- Run after returns-collectors.sql. Everything is rolled back.
-- Note: once returns-roles.sql is applied, the collector is frozen as soon as the parts are taken; the check
-- « the collector can still be corrected before reception » then fails. This file describes the base as
-- returns-collectors.sql leaves it; returns-roles.test.sql describes the current rules.
-- Uses the shop of the shared access for the session-based functions and its own shop for the rest.
begin;
create function pg_temp.sqlstate_of(statement text) returns text language plpgsql as $t$
begin execute statement; return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $t$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$t$;

-- Fixtures: a test shop with garages of every kind, and a live session of the shared access.
select set_config('t.shop','11111111-1111-4111-8111-111111111111',true);
select set_config('t.main',(select workspace_id::text from public.shared_access where singleton),true);
select set_config('t.token',repeat('ab',32),true);
insert into public.shared_access_sessions(token_hash,expires_at) values(encode(extensions.digest(current_setting('t.token'),'sha256'),'hex'),clock_timestamp()+interval '10 minutes');
insert into public.scanette_workspaces(id,name) values('11111111-1111-4111-8111-111111111111','TEST COLLECTORS');
insert into public.returns_public_portals(workspace_id,enabled,max_per_garage,max_per_window) values('11111111-1111-4111-8111-111111111111',true,50,200);
insert into public.gestion_partners(id,workspace_id,kind,name,details,departures,version) values
 ('aa5e1e57-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','client','G Damian','{"tours":["damian"]}','[]',1),
 ('aa5e1e57-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','client','G Charlie','{"tours":["charlie"]}','[{"carrier":"Charlie","time":"10:00","days":[1,2,3,4,5]},{"carrier":"Charlie","time":"15:00","days":[1,2,3,4,5]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','client','G Paketo PB','{}','[{"carrier":"Paketo Pays Basque","time":"11:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','client','G Deux services','{}','[{"carrier":"Paketo Pays Basque","time":"11:00","days":[1]},{"carrier":"Serge","time":"09:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','client','G Ace','{}','[{"carrier":"ACE Hendaye","time":"11:15","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','client','G Ace et autre','{}','[{"carrier":"ACE Hendaye","time":"11:15","days":[1]},{"carrier":"Paketo Hendaye","time":"12:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','client','G Inconnu','{}','[{"carrier":"Paketo Hendaye","time":"12:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','client','G Sans rien','{}','[]',1),
 ('aa5e1e57-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','client','G Béarn','{"tours":"pas une liste"}','[{"carrier":"Paketo Béarn","time":"12:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','client','G Tour et transporteur','{"tours":["cedric"]}','[{"carrier":"Serge","time":"09:00","days":[1]}]',1),
 ('aa5e1e57-0000-4000-8000-00000000000b','11111111-1111-4111-8111-111111111111','supplier','Fournisseur Test','{}','[]',1);

-- 1. Collectors: the ten services, and the certain collector of a garage.
select pg_temp.expect('ten collectors',(select count(*)=10 from unnest(array['serge','damian','paketo_landes','paketo_bearn','paketo_pays_basque','ace','ludovic','maxime','charlie','cedric']) c where public.returns_collector_label(c) is not null));
select pg_temp.expect('unknown collector',public.returns_collector_label('paketo') is null and public.returns_collector_label('') is null and public.returns_collector_label('SERGE') is null);
select pg_temp.expect('carrier names',public.returns_carrier_collector('  paketo  béarn ')='paketo_bearn' and public.returns_carrier_collector('ACE Hendaye')='ace' and public.returns_carrier_collector('Acer')='other:acer'
 and public.returns_carrier_collector('Paketo Hendaye')='other:paketo hendaye' and public.returns_carrier_collector('') is null and public.returns_carrier_collector('Cédric')='cedric');
select pg_temp.expect('certain: '||g.name,public.returns_certain_collector(current_setting('t.shop')::uuid,g.id) is not distinct from x.want)
from (values ('G Damian','damian'),('G Charlie','charlie'),('G Paketo PB','paketo_pays_basque'),('G Deux services',null),('G Ace','ace'),('G Ace et autre',null),('G Inconnu',null),('G Sans rien',null),('G Béarn','paketo_bearn'),('G Tour et transporteur',null),('Fournisseur Test',null)) x(name,want)
join public.gestion_partners g on g.name=x.name and g.workspace_id=current_setting('t.shop')::uuid;
select pg_temp.expect('a garage of another shop is never read',public.returns_certain_collector(current_setting('t.main')::uuid,'aa5e1e57-0000-4000-8000-000000000001') is null);

-- 2. The write path, called as the wrappers call it.
create function pg_temp.doc(status text,collector text default null,extra jsonb default '{}') returns jsonb language sql as $t$
 select jsonb_strip_nulls(jsonb_build_object('type','return','status',status,'client_id',null,'client_name','G Damian','supplier_id',null,'supplier_name','','collector',collector,
  'lines',jsonb_build_array(jsonb_build_object('id','l1','product_id',null,'reference','REF-1','description','','quantity',2,'received_quantity',null,'condition','','reason',''))))
  ||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id','l1','product_id',null,'reference','REF-1','description','','quantity',2,'received_quantity',null,'condition','','reason','')))||extra $t$;
create function pg_temp.save(c uuid,v integer,d jsonb,note text default '') returns text language plpgsql as $t$
begin
 -- After returns-actions.sql the received quantities are written by the reception functions only
 -- (tested in returns-actions.test.sql). This test is about states and collectors: when that later
 -- file is applied, the quantities of the document under test are placed as a fixture first.
 if to_regproc('public.shared_return_receive_line') is not null then update public.returns_cases set document=jsonb_set(document,'{lines}',d->'lines') where id=c; end if;
 perform public.returns_apply_case(current_setting('t.shop')::uuid,null,'shared_access',c,v,d,note); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
create function pg_temp.lines(got integer,refused integer,reason text) returns jsonb language sql as $t$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('id','l1','product_id',null,'reference','REF-1','description','','quantity',2,'received_quantity',got,'refused_quantity',refused,'condition','','reason',reason))) $t$;

select set_config('t.c','cc5e1e57-0000-4000-8000-000000000001',true);
select pg_temp.expect('a new dossier starts as requested',pg_temp.save(current_setting('t.c')::uuid,0,pg_temp.doc('collected','damian')) like '22023%');
select pg_temp.expect('unknown collector refused',pg_temp.save(current_setting('t.c')::uuid,0,pg_temp.doc('requested','paketo')) like '22023 Invalid collector%');
select pg_temp.expect('former states refused',pg_temp.save(current_setting('t.c')::uuid,0,pg_temp.doc('supplier_ready')) like '22023%');
select pg_temp.expect('created unassigned',pg_temp.save(current_setting('t.c')::uuid,0,pg_temp.doc('requested'))='ok');
select pg_temp.expect('one created event, no assignment',(select array_agg(event_kind order by created_at) from public.returns_case_events where case_id=current_setting('t.c')::uuid)=array['created']);
select pg_temp.expect('collected without a collector refused',pg_temp.save(current_setting('t.c')::uuid,1,pg_temp.doc('collected')) like '22023 Collector required%');
select pg_temp.expect('assigned',pg_temp.save(current_setting('t.c')::uuid,1,pg_temp.doc('requested','damian'),'tournée du garage')='ok');
select pg_temp.expect('reassigned',pg_temp.save(current_setting('t.c')::uuid,2,pg_temp.doc('requested','ludovic'))='ok');
select pg_temp.expect('the journal keeps both assignments, in order, and nothing else',
 (select jsonb_agg(jsonb_build_array(event_kind,from_collector,to_collector,note) order by created_at) from public.returns_case_events where case_id=current_setting('t.c')::uuid and event_kind='assigned')
 ='[["assigned",null,"damian","tournée du garage"],["assigned","damian","ludovic",""]]'::jsonb
 and (select count(*) from public.returns_case_events where case_id=current_setting('t.c')::uuid)=3);
select pg_temp.expect('stale version refused',pg_temp.save(current_setting('t.c')::uuid,1,pg_temp.doc('requested','serge')) like 'PT409%');
select pg_temp.expect('identical replay changes nothing',pg_temp.save(current_setting('t.c')::uuid,0,pg_temp.doc('requested','ludovic'))='ok' and (select version from public.returns_cases where id=current_setting('t.c')::uuid)=3);
select pg_temp.expect('no step can be skipped',pg_temp.save(current_setting('t.c')::uuid,3,pg_temp.doc('received','ludovic',pg_temp.lines(2,0,''))) like '22023 Invalid status transition%');
select pg_temp.expect('collected',pg_temp.save(current_setting('t.c')::uuid,3,pg_temp.doc('collected','ludovic'))='ok');
select pg_temp.expect('reception needs a control of every line',pg_temp.save(current_setting('t.c')::uuid,4,pg_temp.doc('received','ludovic')) like '22023 Reception control required%');
select pg_temp.expect('a difference needs a reason',pg_temp.save(current_setting('t.c')::uuid,4,pg_temp.doc('received','ludovic',pg_temp.lines(1,0,' '))) like '22023 Reason required%');
select pg_temp.expect('a refused part needs a reason',pg_temp.save(current_setting('t.c')::uuid,4,pg_temp.doc('received','ludovic',pg_temp.lines(2,1,''))) like '22023 Reason required%');
select pg_temp.expect('refused cannot exceed received',pg_temp.save(current_setting('t.c')::uuid,4,pg_temp.doc('received','ludovic',pg_temp.lines(1,2,'x'))) like '22023 Invalid return line%');
select pg_temp.expect('the collector can still be corrected before reception',pg_temp.save(current_setting('t.c')::uuid,4,pg_temp.doc('collected','damian'))='ok');
select pg_temp.expect('received with a refusal and its reason',pg_temp.save(current_setting('t.c')::uuid,5,pg_temp.doc('received','damian',pg_temp.lines(2,1,'Emballage ouvert')))='ok');
select pg_temp.expect('the collector is frozen after reception',pg_temp.save(current_setting('t.c')::uuid,6,pg_temp.doc('received','serge',pg_temp.lines(2,1,'Emballage ouvert'))) like '22023 Collector is frozen%');
select pg_temp.expect('waiting for a supplier needs a supplier',pg_temp.save(current_setting('t.c')::uuid,6,pg_temp.doc('supplier_pending','damian',pg_temp.lines(2,1,'Emballage ouvert'))) like '22023 Supplier required%');
select pg_temp.expect('a supplier of another kind or shop is refused',pg_temp.save(current_setting('t.c')::uuid,6,pg_temp.doc('supplier_pending','damian',pg_temp.lines(2,1,'Emballage ouvert')||'{"supplier_id":"aa5e1e57-0000-4000-8000-000000000001","supplier_name":"G Damian"}')) like '22023 Supplier outside%');
select set_config('t.sup','{"supplier_id":"aa5e1e57-0000-4000-8000-00000000000b","supplier_name":"Fournisseur Test"}',true);
select pg_temp.expect('waiting for the supplier',pg_temp.save(current_setting('t.c')::uuid,6,pg_temp.doc('supplier_pending','damian',pg_temp.lines(2,1,'Emballage ouvert')||current_setting('t.sup')::jsonb))='ok');
select pg_temp.expect('a credit needs its reference',pg_temp.save(current_setting('t.c')::uuid,7,pg_temp.doc('credited','damian',pg_temp.lines(2,1,'Emballage ouvert')||current_setting('t.sup')::jsonb||'{"credit_reference":"  "}')) like '22023 Credit reference required%');
select pg_temp.expect('credited',pg_temp.save(current_setting('t.c')::uuid,7,pg_temp.doc('credited','damian',pg_temp.lines(2,1,'Emballage ouvert')||current_setting('t.sup')::jsonb||'{"credit_reference":"AV-2026-0042"}'))='ok');
select pg_temp.expect('a credited dossier cannot be cancelled',pg_temp.save(current_setting('t.c')::uuid,8,pg_temp.doc('cancelled','damian',pg_temp.lines(2,1,'Emballage ouvert')||current_setting('t.sup')::jsonb||'{"credit_reference":"AV-2026-0042"}')) like '22023 Invalid status transition%');
select pg_temp.expect('closed',pg_temp.save(current_setting('t.c')::uuid,8,pg_temp.doc('closed','damian',pg_temp.lines(2,1,'Emballage ouvert')||current_setting('t.sup')::jsonb||'{"credit_reference":"AV-2026-0042"}'),'fin')='ok');
select pg_temp.expect('closed is final',pg_temp.save(current_setting('t.c')::uuid,9,pg_temp.doc('requested','damian')) like '22023 Invalid status transition%');
select pg_temp.expect('the journal tells the whole story, dated',
 (select array_agg(coalesce(from_status,'-')||'>'||to_status order by created_at) from public.returns_case_events where case_id=current_setting('t.c')::uuid and event_kind in ('created','status_changed'))
 =array['->requested','requested>collected','collected>received','received>supplier_pending','supplier_pending>credited','credited>closed']
 and (select bool_and(created_at is not null and access_source='shared_access') from public.returns_case_events where case_id=current_setting('t.c')::uuid));
select pg_temp.expect('closing without a credit is possible from reception, with nothing invented',
 pg_temp.save('cc5e1e57-0000-4000-8000-000000000002',0,pg_temp.doc('requested','charlie'))='ok' and pg_temp.save('cc5e1e57-0000-4000-8000-000000000002',1,pg_temp.doc('collected','charlie'))='ok'
 and pg_temp.save('cc5e1e57-0000-4000-8000-000000000002',2,pg_temp.doc('received','charlie',pg_temp.lines(2,0,'')))='ok' and pg_temp.save('cc5e1e57-0000-4000-8000-000000000002',3,pg_temp.doc('closed','charlie',pg_temp.lines(2,0,'')))='ok');
select pg_temp.expect('closed without a credit: supplier and credit stay unknown',(select document->>'status'='closed' and document->>'supplier_name'='' and not document ? 'credit_reference' from public.returns_cases where id='cc5e1e57-0000-4000-8000-000000000002'));
select pg_temp.expect('the table refuses an unknown state or collector whoever writes',
 pg_temp.sqlstate_of($q$update public.returns_cases set document=jsonb_set(document,'{status}','"sent"') where id='cc5e1e57-0000-4000-8000-000000000002'$q$) like '22023%'
 and pg_temp.sqlstate_of($q$update public.returns_cases set document=jsonb_set(document,'{collector}','"paketo"') where id='cc5e1e57-0000-4000-8000-000000000002'$q$) like '22023%');

-- 3. Public garage portal, as the anonymous visitor: one uuid back, nothing else.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect('portal: certain garage',public.returns_public_submit(current_setting('t.shop')::uuid,'dd5e1e57-0000-4000-8000-000000000001','aa5e1e57-0000-4000-8000-000000000002',null,'Carton accueil','[{"reference":"A1","quantity":2}]')='dd5e1e57-0000-4000-8000-000000000001');
select pg_temp.expect('portal: two services',public.returns_public_submit(current_setting('t.shop')::uuid,'dd5e1e57-0000-4000-8000-000000000002','aa5e1e57-0000-4000-8000-000000000004',null,'Carton accueil','[{"reference":"A1","quantity":1}]') is not null);
select pg_temp.expect('portal: typed name',public.returns_public_submit(current_setting('t.shop')::uuid,'dd5e1e57-0000-4000-8000-000000000003',null,'G Damian','Carton accueil','[{"reference":"A1","quantity":1}]') is not null);
select pg_temp.expect('portal: a retry answers the same id',public.returns_public_submit(current_setting('t.shop')::uuid,'dd5e1e57-0000-4000-8000-000000000001','aa5e1e57-0000-4000-8000-000000000002',null,'Carton accueil','[{"reference":"A1","quantity":2}]')='dd5e1e57-0000-4000-8000-000000000001');
select pg_temp.expect('the visitor reads no dossier, no journal, and calls no internal function',
 pg_temp.sqlstate_of('select 1 from public.returns_cases limit 1') like '42501%' and pg_temp.sqlstate_of('select 1 from public.returns_case_events limit 1') like '42501%'
 and pg_temp.sqlstate_of($q$select public.returns_certain_collector('11111111-1111-4111-8111-111111111111','aa5e1e57-0000-4000-8000-000000000002')$q$) like '42501%'
 and pg_temp.sqlstate_of($q$select public.returns_collector_label('serge')$q$) like '42501%'
 and pg_temp.sqlstate_of($q$select public.returns_apply_case('11111111-1111-4111-8111-111111111111',null,null,gen_random_uuid(),0,'{}','')$q$) like '42501%'
 and pg_temp.sqlstate_of($q$select * from public.shared_returns(5,null)$q$) like 'PT401%' and pg_temp.sqlstate_of($q$select public.shared_returns_model(null)$q$) like 'PT401%'
 and pg_temp.sqlstate_of($q$select * from public.shared_return_events('dd5e1e57-0000-4000-8000-000000000001',null)$q$) like 'PT401%');
select pg_temp.expect('the portal function still answers one uuid',(select pg_get_function_result('public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb)'::regprocedure)='uuid'));
reset role;
select pg_temp.expect('certain garage → attached, with a journal line; the others → À attribuer, never lost',
 (select jsonb_object_agg(right(id::text,1),document->>'collector') from public.returns_cases where id::text like 'dd5e1e57%')='{"1":"charlie","2":"","3":""}'::jsonb
 and (select count(*) from public.returns_case_events where case_id::text like 'dd5e1e57%' and event_kind='assigned' and to_collector='charlie' and from_collector is null)=1
 and (select count(*) from public.returns_case_events where case_id::text like 'dd5e1e57%')=4
 and (select bool_and(document->>'status'='requested' and document->>'pickup_location'='Carton accueil') from public.returns_cases where id::text like 'dd5e1e57%'));

-- 4. Shared logistics access: the same rules through the session, and the journal with assignments.
set local role anon;
select pg_temp.expect('model 2',public.shared_returns_model(current_setting('t.token'))=2);
select set_config('t.d',(jsonb_build_object('type','return','status','requested','client_id',null,'client_name','TEST PARTAGE','supplier_id',null,'supplier_name','','collector','serge','pickup_location','Atelier',
 'lines',jsonb_build_array(jsonb_build_object('id','l1','product_id',null,'reference','REF-1','description','','quantity',1,'received_quantity',null,'condition','','reason',''))))::text,true);
select pg_temp.expect('shared save',(select version=1 and document->>'collector'='serge' from public.shared_save_return('ee5e1e57-0000-4000-8000-000000000001',0,current_setting('t.d')::jsonb,'',current_setting('t.token'))));
select pg_temp.expect('shared save without a session',pg_temp.sqlstate_of(format($q$select * from public.shared_save_return('ee5e1e57-0000-4000-8000-000000000002',0,%L::jsonb,'',null)$q$,current_setting('t.d'))) like 'PT401%');
select pg_temp.expect('shared journal shows the assignment',(select jsonb_agg(jsonb_build_array(event_kind,to_collector) order by created_at,event_kind desc) from public.shared_return_events('ee5e1e57-0000-4000-8000-000000000001',current_setting('t.token')))='[["created",null],["assigned","serge"]]'::jsonb);
select pg_temp.expect('the dossier is listed for the team',exists(select 1 from public.shared_returns(500,current_setting('t.token')) r where r.id='ee5e1e57-0000-4000-8000-000000000001'));
reset role;

-- 5. Existing dossiers are regrouped by the migration block (run here on fabricated old rows).
alter table public.returns_cases disable trigger returns_cases_guard;
insert into public.returns_cases(id,workspace_id,document,version) values
 ('ff5e1e57-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'{"type":"return","status":"sent","client_name":"Ancien","supplier_name":"F","lines":[{"id":"x","reference":"X","quantity":1}],"services":["serge"]}',4),
 ('ff5e1e57-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'{"type":"return","status":"requested","client_name":"Ancien 2","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1}],"collection_carrier":"PAKETO","collection_done":false}',1),
 ('ff5e1e57-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'{"type":"return","status":"credited","client_name":"Ancien 3","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1}]}',7);
alter table public.returns_cases enable trigger returns_cases_guard;
select pg_temp.expect('three old rows touched… two: the third needs nothing',public.returns_regroup_legacy()=2);
select pg_temp.expect('former states regrouped, former assignment read only when certain, untouched dossiers untouched',
 (select jsonb_object_agg(right(id::text,1),jsonb_build_array(document->>'status',document->>'collector',version,document ? 'services' or document ? 'collection_carrier' or document ? 'collection_done')) from public.returns_cases where id::text like 'ff5e1e57%')
 ='{"1":["supplier_pending","serge",5,false],"2":["requested",null,2,false],"3":["credited",null,7,false]}'::jsonb
 and (select count(*) from public.returns_case_events where case_id='ff5e1e57-0000-4000-8000-000000000001' and ((event_kind='status_changed' and from_status='sent' and to_status='supplier_pending') or (event_kind='assigned' and to_collector='serge')))=2);
select pg_temp.expect('second run touches nothing',public.returns_regroup_legacy()=0);
select pg_temp.expect('running it again changes nothing',(select version from public.returns_cases where id='ff5e1e57-0000-4000-8000-000000000001')=5);

-- 6. Rights and leftovers.
select pg_temp.expect('internal functions are closed to '||r,not has_function_privilege(r,'public.returns_apply_case(uuid,uuid,text,uuid,integer,jsonb,text)','execute') and not has_function_privilege(r,'public.returns_certain_collector(uuid,uuid)','execute')
 and not has_function_privilege(r,'public.returns_regroup_legacy()','execute') and not has_function_privilege(r,'public.returns_collector_label(text)','execute') and not has_function_privilege(r,'public.returns_carrier_collector(text)','execute')) from unnest(array['anon','authenticated']) r;
select pg_temp.expect('the staff-account function stays closed to visitors',not has_function_privilege('anon','public.returns_save_case(uuid,uuid,integer,jsonb,text)','execute'));
select pg_temp.expect('tables stay closed to visitors',not has_table_privilege('anon','public.returns_cases','select') and not has_table_privilege('anon','public.returns_case_events','select'));
select pg_temp.expect('the orphan trigger is gone',not exists(select 1 from pg_trigger where tgname='returns_collection_assignment_check') and to_regprocedure('public.returns_validate_collection_assignment()') is null);
rollback;
select 'returns-collectors: all checks passed' as result;
