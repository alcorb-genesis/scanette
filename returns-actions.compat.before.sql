-- Compatibility of returns-actions.sql with what already exists. Run in ONE psql session, on a base
-- that has NOT received returns-actions.sql yet:
--   psql … -f returns-actions.compat.before.sql -f returns-actions.sql -f returns-actions.compat.after.sql
-- The whole session is one transaction, rolled back at the end: the migration is applied over
-- dossiers and journal lines written in the formats found in production, the readings of the
-- current screen are compared before and after, then everything is undone.
begin;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $t$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$t$;
create function pg_temp.err(statement text) returns text language plpgsql as $t$
begin execute statement; return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
select pg_temp.expect('this base has not received returns-actions.sql yet',to_regclass('public.returns_line_actions') is null and to_regproc('public.shared_return_receive') is null);
select set_config('t.shop',(select workspace_id::text from public.shared_access where singleton),false);
select set_config('t.token',repeat('9a',32),false);
insert into public.shared_access_sessions(token_hash,expires_at) values(encode(extensions.digest(current_setting('t.token'),'sha256'),'hex'),clock_timestamp()+interval '10 minutes');
insert into public.gestion_partners(id,workspace_id,kind,name,details,departures,version) values
 ('e0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'client','ZZ GARAGE COMPAT','{}','[]',1),
 ('e0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'supplier','ZZ FOURNISSEUR COMPAT','{}','[]',1);
-- Five dossiers in the shapes read in production on 10 October 2026: document keys type, status,
-- client_id, client_name, supplier_id, supplier_name, lines (id, product_id, reference, description,
-- quantity, received_quantity, condition, reason); portal requests add portal, source,
-- pickup_location, garage_verified. No collector key on the older ones. States: 2 requested,
-- 1 collected, 1 received, 1 credited.
insert into public.returns_cases(id,workspace_id,document,version,created_at,updated_at,access_source) values
 ('f0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'{"type":"return","status":"requested","client_id":"e0000000-0000-4000-8000-000000000001","client_name":"ZZ GARAGE COMPAT","supplier_id":null,"supplier_name":"","portal":true,"source":"public_portal","pickup_location":"Carton accueil","garage_verified":true,"lines":[{"id":"a","product_id":null,"reference":"ZZ-C-1","description":"","quantity":2,"received_quantity":null,"condition":"","reason":""}]}',1,'2026-10-07 09:00+02','2026-10-07 09:00+02',null),
 ('f0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,'{"type":"warranty","status":"requested","client_id":null,"client_name":"Garage saisi","supplier_id":null,"supplier_name":"","lines":[{"id":"a","product_id":null,"reference":"ZZ-C-2","description":"Pièce","quantity":1,"received_quantity":null,"condition":"","reason":""}]}',1,'2026-10-07 10:00+02','2026-10-07 10:00+02',null),
 ('f0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,'{"type":"return","status":"collected","client_id":"e0000000-0000-4000-8000-000000000001","client_name":"ZZ GARAGE COMPAT","supplier_id":null,"supplier_name":"","lines":[{"id":"a","product_id":null,"reference":"ZZ-C-3","description":"","quantity":1,"received_quantity":null,"condition":"","reason":""}]}',2,'2026-10-06 09:00+02','2026-10-08 09:00+02','shared_access'),
 ('f0000000-0000-4000-8000-000000000004',current_setting('t.shop')::uuid,'{"type":"return","status":"received","client_id":"e0000000-0000-4000-8000-000000000001","client_name":"ZZ GARAGE COMPAT","supplier_id":null,"supplier_name":"","lines":[{"id":"a","product_id":null,"reference":"ZZ-C-4","description":"","quantity":2,"received_quantity":2,"condition":"","reason":""},{"id":"b","product_id":null,"reference":"ZZ-C-5","description":"","quantity":1,"received_quantity":0,"condition":"abîmé","reason":"Absente"}]}',3,'2026-10-05 09:00+02','2026-10-08 10:00+02',null),
 ('f0000000-0000-4000-8000-000000000005',current_setting('t.shop')::uuid,'{"type":"return","status":"credited","client_id":"e0000000-0000-4000-8000-000000000001","client_name":"ZZ GARAGE COMPAT","supplier_id":"e0000000-0000-4000-8000-000000000002","supplier_name":"ZZ FOURNISSEUR COMPAT","lines":[{"id":"a","product_id":null,"reference":"ZZ-C-6","description":"","quantity":1,"received_quantity":1,"condition":"","reason":""}]}',7,'2026-10-01 09:00+02','2026-10-09 09:00+02',null);
-- Journal lines as stored before: created / status_changed, with and without the shared-access mark,
-- one former state (credit_pending), no collector columns filled.
insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,created_at,access_source) values
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,null,'created',null,'requested','Retours prêts pour la collecte (portail garage) · À récupérer : Carton accueil','2026-10-07 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000002',current_setting('t.shop')::uuid,null,'created',null,'requested','','2026-10-07 10:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,null,'created',null,'requested','','2026-10-06 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000003',current_setting('t.shop')::uuid,null,'status_changed','requested','collected','enlevé','2026-10-08 09:00+02','shared_access'),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000004',current_setting('t.shop')::uuid,null,'created',null,'requested','','2026-10-05 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000004',current_setting('t.shop')::uuid,null,'status_changed','requested','collected','','2026-10-06 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000004',current_setting('t.shop')::uuid,null,'status_changed','collected','received','','2026-10-08 10:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000005',current_setting('t.shop')::uuid,null,'created',null,'requested','','2026-10-01 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000005',current_setting('t.shop')::uuid,null,'status_changed','sent','credit_pending','','2026-10-08 09:00+02',null),
 (gen_random_uuid(),'f0000000-0000-4000-8000-000000000005',current_setting('t.shop')::uuid,null,'status_changed','credit_pending','credited','','2026-10-09 09:00+02','shared_access');
-- What the current screen reads, before the migration.
create temp table compat_before as
 select 'returns' as what,(select jsonb_agg(to_jsonb(r) order by r.id) from public.shared_returns(1000,current_setting('t.token')) r where r.id::text like 'f0000000%') as answer
 union all select 'events:'||c.id,(select jsonb_agg(to_jsonb(e) order by e.created_at,e.event_kind desc) from public.shared_return_events(c.id,current_setting('t.token')) e) from public.returns_cases c where c.id::text like 'f0000000%'
 union all select 'model',to_jsonb(public.shared_returns_model(current_setting('t.token')));
select pg_temp.expect('before: 5 dossiers and 10 journal lines are read',(select jsonb_array_length(answer)=5 from compat_before where what='returns') and (select sum(jsonb_array_length(answer))=10 from compat_before where what like 'events:%'));
