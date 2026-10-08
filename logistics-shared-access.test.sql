-- Run after logistics-shared-access.sql. Everything is rolled back, including the password used here:
-- a random value generated for this run only, never written anywhere. The real password and the
-- sessions of the shop are back as they were when this script ends.
-- Creates its own rows in the shared shop (Bellecave) and in a second shop, then calls the
-- shared functions as the anonymous role, exactly as the browser does.
begin;
create function pg_temp.sqlstate_of(statement text) returns text language plpgsql as $$
begin execute statement; return 'ok'; exception when others then return sqlstate; end;$$;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$$;

select set_config('t.user',(select id::text from auth.users limit 1),true);
select set_config('t.shop',(select workspace_id::text from public.shared_access where singleton),true);
insert into public.scanette_workspaces(id,name) values('33333333-3333-4333-8333-333333333333','TEST AUTRE MAGASIN');
insert into public.scanette_products(id,workspace_id,reference,description,internal_barcode,manufacturer_barcode,source_line,source_sha256,location) values
 ('d5e1e57a-0000-4000-8000-000000000001',current_setting('t.shop')::uuid,'TSTREF-1','Plaquette essai partagé','TSTINT1','TSTEAN1',1,'test-shared-access','A12C'),
 ('d5e1e57a-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333','TSTREF-1','Plaquette autre magasin','TSTINT2','TSTEAN1',1,'test-shared-access','A12C');
insert into public.gestion_partners(id,workspace_id,kind,name,details,version,updated_by) values
 ('d5e1e57a-0000-4000-8000-000000000011',current_setting('t.shop')::uuid,'supplier','TST Fournisseur partagé','{}',1,current_setting('t.user')::uuid),
 ('d5e1e57a-0000-4000-8000-000000000012',current_setting('t.shop')::uuid,'client','TST Garage partagé','{}',1,current_setting('t.user')::uuid),
 ('d5e1e57a-0000-4000-8000-000000000013','33333333-3333-4333-8333-333333333333','supplier','TST Fournisseur autre','{}',1,current_setting('t.user')::uuid),
 ('d5e1e57a-0000-4000-8000-000000000014','33333333-3333-4333-8333-333333333333','client','TST Garage autre','{"phone":"0600000000"}',1,current_setting('t.user')::uuid);
insert into public.logistics_sessions(id,workspace_id,kind,content,version,created_by,updated_by) values('d5e1e57a-0000-4000-8000-000000000021','33333333-3333-4333-8333-333333333333','receipt','{"lines":[],"event_at":"2026-10-08T10:00:00Z","orders":"AUTRE"}',1,current_setting('t.user')::uuid,current_setting('t.user')::uuid);
insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values('d5e1e57a-0000-4000-8000-000000000031','33333333-3333-4333-8333-333333333333','{"type":"return","status":"requested","client_name":"Autre","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1}]}',1,current_setting('t.user')::uuid,current_setting('t.user')::uuid);
insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,to_status,note) values(gen_random_uuid(),'d5e1e57a-0000-4000-8000-000000000031','33333333-3333-4333-8333-333333333333',current_setting('t.user')::uuid,'created','requested','autre magasin');
insert into public.inventory_invites(id,workspace_id,created_by,secret_hash,document,expires_at) values('d5e1e57a-0000-4000-8000-000000000041','33333333-3333-4333-8333-333333333333',current_setting('t.user')::uuid,repeat('0',64),'{"title":"Autre","rows":[]}',now()+interval '1 day');

-- Tables: nothing is granted to the anonymous role, whatever the shared access allows.
select pg_temp.expect('no table privilege for anon on '||t,not has_table_privilege('anon','public.'||t,'select,insert,update,delete'))
from unnest(array['scanette_workspaces','scanette_members','scanette_products','scanette_aisles','scanette_location_events','gestion_partners','gestion_stock','gestion_team','gestion_store_settings',
 'logistics_sessions','inventory_invites','returns_cases','returns_case_events','returns_public_portals','returns_public_requests','catalogue','shared_access','shared_access_sessions','shared_access_attempts','logistics_pin_devices','logistics_pin_credentials']) t;
-- Member, team, settings and PIN functions stay closed to anon; PIN functions are closed to every application role.
select pg_temp.expect('anon cannot run '||p.oid::regprocedure::text,not has_function_privilege('anon',p.oid,'execute'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('logistics_save_session','logistics_employee_names','gestion_save_partner','returns_save_case','scanette_set_location','inventory_create_invite','inventory_list_invites','inventory_revoke_invite','inventory_current_list','inventory_load_list','gestion_save_team_member','gestion_save_store_settings','shared_shop','shared_access_set_password');
select pg_temp.expect('password setter closed for '||r,not has_function_privilege(r,'public.shared_access_set_password(text)','execute')) from unnest(array['anon','authenticated','service_role']) r;
select pg_temp.expect('no shared function without a session parameter is left',not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'shared\_%'
  and p.proname not in ('shared_location_code','shared_access_open','shared_access_close','shared_access_set_password')
  and not coalesce('session_token'=any(p.proargnames),false)));

-- A password for this run only (random, rolled back). The placeholder of the migration is refused.
select pg_temp.expect('placeholder refused',pg_temp.sqlstate_of($q$select public.shared_access_set_password('<MOT_DE_PASSE_LOGISTIQUE_A_SAISIR_A_LA_MAIN>')$q$)='22023');
select pg_temp.expect('short password refused',pg_temp.sqlstate_of($q$select public.shared_access_set_password('court')$q$)='22023');
select set_config('t.pw',encode(extensions.gen_random_bytes(18),'hex'),true);
select public.shared_access_set_password(current_setting('t.pw'));
select pg_temp.expect('only a bcrypt hash is stored',(select password_hash like '$2_$10$%' and position(current_setting('t.pw') in password_hash)=0 from public.shared_access));
select pg_temp.expect('setting the password ends every session',(select count(*)=0 from public.shared_access_sessions));
select pg_temp.expect('PIN function closed for '||r||': '||p.oid::regprocedure::text,not has_function_privilege(r,p.oid,'execute'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
where n.nspname='public' and p.proname like 'logistics\_pin\_%';
select pg_temp.expect('PIN tables and their records are kept',to_regclass('public.logistics_pin_devices') is not null and to_regclass('public.logistics_pin_credentials') is not null);

select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect('direct read refused: '||t,pg_temp.sqlstate_of('select 1 from public.'||t||' limit 1')='42501')
from unnest(array['scanette_products','gestion_partners','logistics_sessions','returns_cases','inventory_invites','gestion_team','gestion_store_settings','catalogue','shared_access','shared_access_sessions','shared_access_attempts']) t;

-- Without a session nothing answers: no token, a made-up token, the password itself used as a token.
select set_config('t.tok','',true);
select pg_temp.expect('no session: '||f,pg_temp.sqlstate_of(f)='PT401') from unnest(array[
 $q$select * from public.shared_products_search('','','','',0,1)$q$,$q$select * from public.shared_product_lookup('X')$q$,$q$select * from public.shared_products_by_references(array['X'])$q$,
 $q$select * from public.shared_products_by_ids(array[gen_random_uuid()])$q$,$q$select * from public.shared_aisles()$q$,$q$select public.shared_set_location(gen_random_uuid(),'A1',now())$q$,
 $q$select * from public.shared_aliases_page(0,1)$q$,$q$select public.shared_aliases_save('[{"ean":"1","ref":"X"}]')$q$,$q$select * from public.shared_partners(null)$q$,
 $q$select * from public.shared_save_partner(gen_random_uuid(),0,'supplier','X','{}','[]','')$q$,$q$select * from public.shared_sessions('receipt',1)$q$,$q$select * from public.shared_session(gen_random_uuid())$q$,
 $q$select * from public.shared_save_session(gen_random_uuid(),'receipt',0,'{}')$q$,$q$select * from public.shared_returns(1)$q$,$q$select * from public.shared_return_events(gen_random_uuid())$q$,
 $q$select * from public.shared_save_return(gen_random_uuid(),0,'{}','')$q$,$q$select public.shared_inventory_current()$q$,$q$select * from public.shared_inventory_lists()$q$,
 $q$select public.shared_inventory_publish(gen_random_uuid(),'{}',1)$q$,$q$select public.shared_inventory_revoke(gen_random_uuid())$q$,
 $q$select * from public.shared_partners(null,repeat('0',64))$q$,$q$select * from public.shared_partners(null,current_setting('t.pw'))$q$,$q$select * from public.shared_partners(null,'')$q$]) f;
select pg_temp.expect('wrong password opens nothing',not exists(select 1 from public.shared_access_open('pas-le-bon-'||current_setting('t.pw'))));
select pg_temp.expect('empty password refused',pg_temp.sqlstate_of($q$select * from public.shared_access_open('')$q$)='22023');
select set_config('t.tok',(select token from public.shared_access_open(current_setting('t.pw'))),true);
select pg_temp.expect('right password returns a 256-bit token',current_setting('t.tok') ~ '^[0-9a-f]{64}$');
select pg_temp.expect('session opened: functions answer',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok'))$q$)='ok');
select pg_temp.expect('anon cannot set the password',pg_temp.sqlstate_of($q$select public.shared_access_set_password('une-valeur-de-test-quelconque')$q$)='42501');

-- Catalogue: only the shared shop; the browser never chooses the shop.
select pg_temp.expect('search finds the shared shop product only',(select array_agg(id) from public.shared_products_search('tstref-1','','','',0,40,current_setting('t.tok')))=array['d5e1e57a-0000-4000-8000-000000000001'::uuid]);
select pg_temp.expect('aisle A12 includes its sections',exists(select 1 from public.shared_products_search('','A12','','',0,500,current_setting('t.tok')) where id='d5e1e57a-0000-4000-8000-000000000001'));
select pg_temp.expect('search total counts shop rows only',(select bool_and(total>=1) and count(*) filter (where id='d5e1e57a-0000-4000-8000-000000000002')=0 from public.shared_products_search('TSTEAN1','','','',0,500,current_setting('t.tok'))));
select pg_temp.expect('invalid aisle refused',pg_temp.sqlstate_of($q$select * from public.shared_products_search('','rayon 4','','',0,40,current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('oversized page refused',pg_temp.sqlstate_of($q$select * from public.shared_products_search('','','','',0,501,current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('lookup by barcode stays in the shop',(select array_agg(id) from public.shared_product_lookup('TSTEAN1',current_setting('t.tok')))=array['d5e1e57a-0000-4000-8000-000000000001'::uuid]);
select pg_temp.expect('lookup by reference, typed in lower case',(select count(*) from public.shared_product_lookup('tstref-1',current_setting('t.tok')))=1);
select pg_temp.expect('product ids of another shop are invisible',not exists(select 1 from public.shared_products_by_ids(array['d5e1e57a-0000-4000-8000-000000000002'::uuid],current_setting('t.tok'))));
select pg_temp.expect('location saved without author',public.shared_set_location('d5e1e57a-0000-4000-8000-000000000001','A13',(select updated_at from public.shared_products_search('tstref-1','','','',0,1,current_setting('t.tok'))),current_setting('t.tok')) is not null);
select pg_temp.expect('stale location refused',pg_temp.sqlstate_of($q$select public.shared_set_location('d5e1e57a-0000-4000-8000-000000000001','A14','2000-01-01',current_setting('t.tok'))$q$)='PT409');
select pg_temp.expect('location of another shop refused',pg_temp.sqlstate_of($q$select public.shared_set_location('d5e1e57a-0000-4000-8000-000000000002','A14',now(),current_setting('t.tok'))$q$)='22023');

-- Partners and departures.
select pg_temp.expect('partners of the shop only',(select count(*) filter (where id in ('d5e1e57a-0000-4000-8000-000000000011','d5e1e57a-0000-4000-8000-000000000012'))=2 and count(*) filter (where id in ('d5e1e57a-0000-4000-8000-000000000013','d5e1e57a-0000-4000-8000-000000000014'))=0 from public.shared_partners(null,current_setting('t.tok'))));
select pg_temp.expect('new supplier created with version 1',(select version=1 from public.shared_save_partner('d5e1e57a-0000-4000-8000-000000000015',0,'supplier','TST Nouveau fournisseur','{}','[]','',current_setting('t.tok'))));
select pg_temp.expect('departure saved on a garage',(select jsonb_array_length(departures)=1 from public.shared_save_partner('d5e1e57a-0000-4000-8000-000000000012',1,'client','TST Garage partagé','{}','[{"mode":"internal","time":"11:00","carrier":"Serge","days":[1,2]}]','',current_setting('t.tok'))));
select pg_temp.expect('stale partner version refused',pg_temp.sqlstate_of($q$select * from public.shared_save_partner('d5e1e57a-0000-4000-8000-000000000012',1,'client','X','{}','[]','',current_setting('t.tok'))$q$)='PT409');
select pg_temp.expect('partner of another shop cannot be overwritten',pg_temp.sqlstate_of($q$select * from public.shared_save_partner('d5e1e57a-0000-4000-8000-000000000014',1,'client','Pris','{}','[]','',current_setting('t.tok'))$q$)='42501');
select pg_temp.expect('supplier with departures refused',pg_temp.sqlstate_of($q$select * from public.shared_save_partner(gen_random_uuid(),0,'supplier','X','{}','[{"mode":"internal","time":"11:00","carrier":"S","days":[1]}]','',current_setting('t.tok'))$q$)='22023');

-- Receipts.
select pg_temp.expect('receipt saved',(select version=1 from public.shared_save_session('d5e1e57a-0000-4000-8000-000000000022','receipt',0,'{"lines":[{"reference":"TSTREF-1","quantity":2,"product_id":"d5e1e57a-0000-4000-8000-000000000001"}],"event_at":"2026-10-08T10:00:00Z","supplier_id":"d5e1e57a-0000-4000-8000-000000000011","orders":"BL-TEST"}',current_setting('t.tok'))));
select pg_temp.expect('identical retry returns the stored version',(select version=1 from public.shared_save_session('d5e1e57a-0000-4000-8000-000000000022','receipt',0,'{"lines":[{"reference":"TSTREF-1","quantity":2,"product_id":"d5e1e57a-0000-4000-8000-000000000001"}],"event_at":"2026-10-08T10:00:00Z","supplier_id":"d5e1e57a-0000-4000-8000-000000000011","orders":"BL-TEST","supplier_name":"TST Fournisseur partagé"}',current_setting('t.tok'))));
select pg_temp.expect('supplier of another shop refused',pg_temp.sqlstate_of($q$select * from public.shared_save_session(gen_random_uuid(),'receipt',0,'{"lines":[],"event_at":"2026-10-08T10:00:00Z","supplier_id":"d5e1e57a-0000-4000-8000-000000000013","orders":"X"}',current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('product of another shop refused',pg_temp.sqlstate_of($q$select * from public.shared_save_session(gen_random_uuid(),'receipt',0,'{"lines":[{"reference":"X","quantity":1,"product_id":"d5e1e57a-0000-4000-8000-000000000002"}],"event_at":"2026-10-08T10:00:00Z","supplier_id":"d5e1e57a-0000-4000-8000-000000000011","orders":"X"}',current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('session of another shop cannot be overwritten',pg_temp.sqlstate_of($q$select * from public.shared_save_session('d5e1e57a-0000-4000-8000-000000000021','receipt',1,'{"lines":[],"event_at":"2026-10-08T10:00:00Z","supplier_id":"d5e1e57a-0000-4000-8000-000000000011","orders":"X"}',current_setting('t.tok'))$q$)='42501');
select pg_temp.expect('session of another shop is invisible',not exists(select 1 from public.shared_session('d5e1e57a-0000-4000-8000-000000000021',current_setting('t.tok'))) and not exists(select 1 from public.shared_sessions('receipt',500,current_setting('t.tok')) where id='d5e1e57a-0000-4000-8000-000000000021'));

-- Returns.
select pg_temp.expect('return case created',(select version=1 from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000032',0,'{"type":"return","status":"requested","client_id":"d5e1e57a-0000-4000-8000-000000000012","client_name":"TST Garage partagé","supplier_name":"","lines":[{"id":"l1","reference":"TSTREF-1","quantity":1}]}','test',current_setting('t.tok'))));
select pg_temp.expect('return moved to collected',(select version=2 and document->>'status'='collected' from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000032',1,'{"type":"return","status":"collected","client_id":"d5e1e57a-0000-4000-8000-000000000012","client_name":"TST Garage partagé","supplier_name":"","lines":[{"id":"l1","reference":"TSTREF-1","quantity":1}]}','enlevé',current_setting('t.tok'))));
select pg_temp.expect('illegal transition refused',pg_temp.sqlstate_of($q$select * from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000032',2,'{"type":"return","status":"credited","client_name":"G","supplier_name":"","lines":[{"id":"l1","reference":"R","quantity":1}]}','',current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('client of another shop refused',pg_temp.sqlstate_of($q$select * from public.shared_save_return(gen_random_uuid(),0,'{"type":"return","status":"requested","client_id":"d5e1e57a-0000-4000-8000-000000000014","client_name":"G","supplier_name":"","lines":[{"id":"l1","reference":"R","quantity":1}]}','',current_setting('t.tok'))$q$)='22023');
select pg_temp.expect('case of another shop cannot be overwritten',pg_temp.sqlstate_of($q$select * from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000031',1,'{"type":"return","status":"collected","client_name":"G","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1}]}','',current_setting('t.tok'))$q$)='42501');
select pg_temp.expect('cases and events of another shop are invisible',not exists(select 1 from public.shared_returns(1000,current_setting('t.tok')) where id='d5e1e57a-0000-4000-8000-000000000031') and not exists(select 1 from public.shared_return_events('d5e1e57a-0000-4000-8000-000000000031',current_setting('t.tok'))));
-- Round services and element names (lot 5): several services per case, names editable, no schedule stored.
select pg_temp.expect('case saved with two services and an edited name',(select version=3 and document->'services'='["serge","paketo_landes"]'::jsonb and document->'lines'->0->>'description'='Plaquettes avant' from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000032',2,'{"type":"return","status":"collected","client_id":"d5e1e57a-0000-4000-8000-000000000012","client_name":"TST Garage partagé","supplier_name":"","services":["serge","paketo_landes"],"lines":[{"id":"l1","reference":"TSTREF-1","description":"Plaquettes avant","quantity":1}]}','tournées',current_setting('t.tok'))));
select pg_temp.expect('invalid services refused: '||v,pg_temp.sqlstate_of(format($q$select * from public.shared_save_return('d5e1e57a-0000-4000-8000-000000000032',3,'{"type":"return","status":"collected","client_name":"G","supplier_name":"","services":%s,"lines":[{"id":"l1","reference":"R","quantity":1}]}','',current_setting('t.tok'))$q$,v))='22023')
from unnest(array['"serge"','["serge","serge"]','[1]','["Serge 11h"]','{"a":1}']) v;
select pg_temp.expect('no schedule is stored with the services',(select not (document ? 'departures') and not (document ? 'schedule') and document::text !~ '[0-2][0-9]:[0-5][0-9]' from public.shared_returns(1000,current_setting('t.tok')) where id='d5e1e57a-0000-4000-8000-000000000032'));
select pg_temp.expect('catalogue names can be read for prefill',(select description='Plaquette essai partagé' from public.shared_products_by_references(array['TSTREF-1'],current_setting('t.tok'))));
select pg_temp.expect('shared events are marked',(select count(*)=3 and bool_and(not by_account and access_source='shared_access') from public.shared_return_events('d5e1e57a-0000-4000-8000-000000000032',current_setting('t.tok'))));

-- Inventory lists.
select pg_temp.expect('list published',public.shared_inventory_publish('d5e1e57a-0000-4000-8000-000000000042','{"title":"TST liste","rows":[{"id":"a","reference":"TSTREF-1","brand":"B","range":"R"}]}',3,current_setting('t.tok'))='d5e1e57a-0000-4000-8000-000000000042');
select pg_temp.expect('current list is the published one',public.shared_inventory_current(current_setting('t.tok'))->>'title'='TST liste');
select pg_temp.expect('lists of another shop are invisible',not exists(select 1 from public.shared_inventory_lists(current_setting('t.tok')) where id='d5e1e57a-0000-4000-8000-000000000041'));
select pg_temp.expect('list of another shop cannot be closed',pg_temp.sqlstate_of($q$select public.shared_inventory_revoke('d5e1e57a-0000-4000-8000-000000000041',current_setting('t.tok'))$q$)='22023');

-- Scanner memory.
select pg_temp.expect('aliases saved',public.shared_aliases_save('[{"ean":"TSTALIAS1","ref":"TSTREF-1"}]',current_setting('t.tok'))=1);
select pg_temp.expect('aliases read back',exists(select 1 from public.shared_aliases_page(0,1000,current_setting('t.tok')) where ean='TSTALIAS1' and ref='TSTREF-1'));
select pg_temp.expect('invalid alias refused',pg_temp.sqlstate_of($q$select public.shared_aliases_save('[{"ean":"","ref":"X"}]',current_setting('t.tok'))$q$)='22023');

-- The garage portal keeps its two functions and nothing else changes for it.
select pg_temp.expect('garage portal functions still callable',has_function_privilege('anon','public.returns_public_garages(uuid)','execute') and has_function_privilege('anon','public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb)','execute'));
reset role;

-- Audit: shared writes have no author and are marked.
select pg_temp.expect('audit marks shared writes',
 (select updated_by is null and access_source='shared_access' from public.gestion_partners where id='d5e1e57a-0000-4000-8000-000000000012')
 and (select created_by is null and updated_by is null and access_source='shared_access' from public.logistics_sessions where id='d5e1e57a-0000-4000-8000-000000000022')
 and (select actor_id is null and access_source='shared_access' from public.scanette_location_events where product_id='d5e1e57a-0000-4000-8000-000000000001' order by id desc limit 1)
 and (select created_by is null and access_source='shared_access' from public.inventory_invites where id='d5e1e57a-0000-4000-8000-000000000042')
 and (select updated_by is null and access_source='shared_access' from public.returns_cases where id='d5e1e57a-0000-4000-8000-000000000032'));
select pg_temp.expect('rows of the other shop untouched',(select name='TST Garage autre' and version=1 from public.gestion_partners where id='d5e1e57a-0000-4000-8000-000000000014') and (select location='A12C' from public.scanette_products where id='d5e1e57a-0000-4000-8000-000000000002'));

-- Sessions: token stored as a digest, limited in time, ended by leaving or by a password change.
select pg_temp.expect('only the digest of the token is stored',(select count(*)=1 and bool_and(token_hash<>current_setting('t.tok') and token_hash=encode(extensions.digest(current_setting('t.tok'),'sha256'),'hex')) from public.shared_access_sessions));
select pg_temp.expect('session lasts session_minutes',(select expires_at between clock_timestamp()+interval '470 minutes' and clock_timestamp()+interval '481 minutes' from public.shared_access_sessions));
select pg_temp.expect('one failed attempt recorded so far',(select count(*)=1 from public.shared_access_attempts));
update public.shared_access_sessions set expires_at=clock_timestamp()-interval '1 second';
set local role anon;
select pg_temp.expect('expired session refused',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok'))$q$)='PT401');
select set_config('t.tok',(select token from public.shared_access_open(current_setting('t.pw'))),true);
select set_config('t.tok2',(select token from public.shared_access_open(current_setting('t.pw'))),true);
select public.shared_access_close(current_setting('t.tok'));
select pg_temp.expect('closed session refused',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok'))$q$)='PT401');
select pg_temp.expect('the other session is untouched',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok2'))$q$)='ok');
-- Guessing is slowed: ten failures close the form for everyone, open sessions keep working.
select count(*) from generate_series(1,9) g where exists(select 1 from public.shared_access_open('essai-faux-'||g));
select pg_temp.expect('eleventh attempt refused, even with the right password',pg_temp.sqlstate_of($q$select * from public.shared_access_open(current_setting('t.pw'))$q$)='PT429');
select pg_temp.expect('open session still works during the lock',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok2'))$q$)='ok');
reset role;
update public.shared_access_attempts set attempted_at=attempted_at-interval '16 minutes';
set local role anon;
select pg_temp.expect('attempts age out',exists(select 1 from public.shared_access_open(current_setting('t.pw'))));
reset role;
select public.shared_access_set_password(current_setting('t.pw')||'-change');
set local role anon;
select pg_temp.expect('password change ends open sessions',pg_temp.sqlstate_of($q$select * from public.shared_partners(null,current_setting('t.tok2'))$q$)='PT401');
select pg_temp.expect('old password no longer opens',not exists(select 1 from public.shared_access_open(current_setting('t.pw'))));
select set_config('t.tok',(select token from public.shared_access_open(current_setting('t.pw')||'-change')),true);
reset role;
update public.shared_access set password_hash=null;
set local role anon;
select pg_temp.expect('no password configured: nobody enters',pg_temp.sqlstate_of($q$select * from public.shared_access_open('nimporte-quoi')$q$)='42501');
reset role;

-- Closing the shared access closes every shared function at once.
update public.shared_access set enabled=false;
set local role anon;
select pg_temp.expect('closed: '||f,pg_temp.sqlstate_of(f)='42501') from unnest(array[
 $q$select * from public.shared_products_search('','','','',0,1,current_setting('t.tok'))$q$,$q$select * from public.shared_partners(null,current_setting('t.tok'))$q$,$q$select * from public.shared_returns(1,current_setting('t.tok'))$q$,
 $q$select public.shared_inventory_current(current_setting('t.tok'))$q$,$q$select * from public.shared_sessions('receipt',1,current_setting('t.tok'))$q$]) f;
reset role;
rollback;
select 'PASS: shared logistics access behind the shop password and a session, limited to the configured shop, tables closed to anon, PIN closed, audit marked; rolled back' as result;
