-- Run after returns-public-portal.sql and returns-collectors.sql (a collection needs its collector). Everything is rolled back.
-- The test creates its own shops and garages; it needs one existing auth.users row and the
-- Bellecave workspace (both present in Supabase).
begin;
create function pg_temp.sqlstate_of(statement text) returns text language plpgsql as $$
begin execute statement; return 'ok'; exception when others then return sqlstate; end;$$;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$$;

-- Fixtures: an open shop, a closed shop, active / archived / merged garages and a supplier.
select set_config('t.user',(select id::text from auth.users limit 1),true);
insert into public.scanette_workspaces(id,name) values('11111111-1111-4111-8111-111111111111','TEST OPEN'),('22222222-2222-4222-8222-222222222222','TEST CLOSED');
insert into public.returns_public_portals(workspace_id,enabled,max_per_garage,max_per_window) values('11111111-1111-4111-8111-111111111111',true,3,100),('22222222-2222-4222-8222-222222222222',false,6,40);
insert into public.gestion_partners(id,workspace_id,kind,name,details,version,updated_by) values
 ('aa5e1e57-7e57-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','client','Garage Actif','{"phone":"0500000000","email":"secret@example.test"}',1,current_setting('t.user')::uuid),
 ('aa5e1e57-7e57-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','client','Garage Archivé','{"archived":true}',1,current_setting('t.user')::uuid),
 ('aa5e1e57-7e57-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','client','Garage Fusionné','{"merged_into":"aa5e1e57-7e57-4000-8000-000000000001"}',1,current_setting('t.user')::uuid),
 ('aa5e1e57-7e57-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','supplier','Fournisseur Privé','{}',1,current_setting('t.user')::uuid),
 ('aa5e1e57-7e57-4000-8000-000000000005','22222222-2222-4222-8222-222222222222','client','Garage Autre Magasin','{}',1,current_setting('t.user')::uuid);
insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values('cc5e1e57-7e57-4000-8000-000000000009','11111111-1111-4111-8111-111111111111',
 '{"type":"return","status":"requested","client_name":"Interne","supplier_name":"","lines":[{"id":"x","reference":"X","quantity":1}]}',1,current_setting('t.user')::uuid,current_setting('t.user')::uuid);

-- Everything below runs as the anonymous visitor of the public portal.
select set_config('request.jwt.claim.sub','',true);
set local role anon;

select pg_temp.expect('the list shows only active garages of the open shop, id and name only',
 (select jsonb_agg(to_jsonb(g)) from public.returns_public_garages('11111111-1111-4111-8111-111111111111') g)
 ='[{"id":"aa5e1e57-7e57-4000-8000-000000000001","name":"Garage Actif"}]'::jsonb);
select pg_temp.expect('a closed shop lists nothing',not exists(select 1 from public.returns_public_garages('22222222-2222-4222-8222-222222222222')));

select pg_temp.expect('submit with a listed garage',public.returns_public_submit('11111111-1111-4111-8111-111111111111','bb5e1e57-7e57-4000-8000-000000000001','aa5e1e57-7e57-4000-8000-000000000001',null,'  Carton à   gauche de l’accueil ',
 '[{"reference":"abc 1","quantity":1},{"reference":" ABC 1 ","quantity":1},{"reference":"INCONNU-HORS-CATALOGUE","quantity":3}]')='bb5e1e57-7e57-4000-8000-000000000001');
select pg_temp.expect('retry of the same request returns the same id and changes nothing',public.returns_public_submit('11111111-1111-4111-8111-111111111111','bb5e1e57-7e57-4000-8000-000000000001',null,'Autre nom','Ailleurs','[{"reference":"ZZZ","quantity":9}]')='bb5e1e57-7e57-4000-8000-000000000001');
select pg_temp.expect('submit with a typed garage name',public.returns_public_submit('11111111-1111-4111-8111-111111111111','bb5e1e57-7e57-4000-8000-000000000002',null,'  Garage   Nouveau ','Sous l’auvent','[{"reference":"r-77","quantity":2}]')='bb5e1e57-7e57-4000-8000-000000000002');

-- Invalid requests are refused by the server, whatever the page sends.
select pg_temp.expect('closed shop',pg_temp.sqlstate_of($q$select public.returns_public_submit('22222222-2222-4222-8222-222222222222',gen_random_uuid(),null,'Garage','Accueil','[{"reference":"A","quantity":1}]')$q$)='42501');
select pg_temp.expect('garage of another shop',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000005',null,'Accueil','[{"reference":"A","quantity":1}]')$q$)='22023');
select pg_temp.expect('archived garage',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000002',null,'Accueil','[{"reference":"A","quantity":1}]')$q$)='22023');
select pg_temp.expect('supplier used as garage',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000004',null,'Accueil','[{"reference":"A","quantity":1}]')$q$)='22023');
select pg_temp.expect('internal case id cannot be reused or read',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111','cc5e1e57-7e57-4000-8000-000000000009',null,'Garage','Accueil','[{"reference":"A","quantity":1}]')$q$)='22023');
do $$ declare bad text; begin
 foreach bad in array array[
  $x$null,'G','Accueil','[{"reference":"A","quantity":1}]'$x$,
  $x$null,'Garage'||chr(7)||'X','Accueil','[{"reference":"A","quantity":1}]'$x$,
  $x$null,'Garage','A','[{"reference":"A","quantity":1}]'$x$,
  $x$null,'Garage',null,'[{"reference":"A","quantity":1}]'$x$,
  $x$null,'Garage',repeat('x',161),'[{"reference":"A","quantity":1}]'$x$,
  $x$null,'Garage','Accueil','[]'$x$,
  $x$null,'Garage','Accueil','{"reference":"A","quantity":1}'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A","quantity":0}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A","quantity":1000}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A","quantity":"2"}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A","quantity":1.5}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"  ","quantity":1}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A\u0007","quantity":1}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"$x$||repeat('R',81)||$x$","quantity":1}]'$x$,
  $x$null,'Garage','Accueil','[{"reference":"A","quantity":600},{"reference":"a","quantity":600}]'$x$,
  $x$null,'Garage','Accueil',(select jsonb_agg(jsonb_build_object('reference','R'||n,'quantity',1)) from generate_series(1,101) n)$x$]
 loop
  perform pg_temp.expect('rejected: '||bad,pg_temp.sqlstate_of('select public.returns_public_submit(''11111111-1111-4111-8111-111111111111'',gen_random_uuid(),'||bad||')')='22023');
 end loop;
 perform pg_temp.expect('missing request id',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',null,null,'Garage','Accueil','[{"reference":"A","quantity":1}]')$q$)='22023');
end $$;

-- Rate limits: three requests per garage in the window (fixture setting), then HTTP 429 through PostgREST.
select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000001',null,'Accueil','[{"reference":"L","quantity":1}]');
select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000001',null,'Accueil','[{"reference":"L","quantity":1}]');
select pg_temp.expect('per-garage limit',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'aa5e1e57-7e57-4000-8000-000000000001',null,'Accueil','[{"reference":"L","quantity":1}]')$q$)='PT429');
select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),null,'GARAGE nouveau','Accueil','[{"reference":"L","quantity":1}]');
select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),null,'garage   NOUVEAU','Accueil','[{"reference":"L","quantity":1}]');
select pg_temp.expect('the limit also applies to a typed name, whatever its case or spacing',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),null,'Garage Nouveau','Accueil','[{"reference":"L","quantity":1}]')$q$)='PT429');
select pg_temp.expect('another garage is not blocked by the first one',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),null,'Garage Voisin','Accueil','[{"reference":"L","quantity":1}]')$q$)='ok');
select pg_temp.expect('a retry is not counted as a new request',public.returns_public_submit('11111111-1111-4111-8111-111111111111','bb5e1e57-7e57-4000-8000-000000000001',null,'x','xx','[{"reference":"L","quantity":1}]')='bb5e1e57-7e57-4000-8000-000000000001');

-- The visitor reads nothing else and cannot use internal or retired functions.
select pg_temp.expect('no direct read of cases',pg_temp.sqlstate_of('select * from public.returns_cases')='42501');
select pg_temp.expect('no direct read of events',pg_temp.sqlstate_of('select * from public.returns_case_events')='42501');
select pg_temp.expect('no read of public requests',pg_temp.sqlstate_of('select * from public.returns_public_requests')='42501');
select pg_temp.expect('no read of portal settings',pg_temp.sqlstate_of('select * from public.returns_public_portals')='42501');
select pg_temp.expect('no read of partners',pg_temp.sqlstate_of('select * from public.gestion_partners')='42501');
select pg_temp.expect('no direct insert',pg_temp.sqlstate_of($q$insert into public.returns_cases(id,workspace_id,document,version) values(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','{}',1)$q$)='42501');
select pg_temp.expect('no internal save',pg_temp.sqlstate_of($q$select public.returns_save_case('11111111-1111-4111-8111-111111111111',gen_random_uuid(),0,'{}'::jsonb,'')$q$)='42501');
select pg_temp.expect('private-link portal closed (profile)',pg_temp.sqlstate_of($q$select * from public.returns_portal_profile(repeat('0',64))$q$)='42501');
select pg_temp.expect('private-link portal closed (submit)',pg_temp.sqlstate_of($q$select public.returns_portal_submit(repeat('0',64),'return','[]','')$q$)='42501');
reset role;

-- What the internal team receives.
select pg_temp.expect('listed garage request: linked, merged lines, unknown reference kept, place stored, no author',
 (select document->>'client_id'='aa5e1e57-7e57-4000-8000-000000000001' and document->>'client_name'='Garage Actif' and document->>'status'='requested' and document->>'type'='return'
   and document->>'pickup_location'='Carton à gauche de l’accueil' and (document->>'garage_verified')::boolean and document->>'source'='public_portal'
   and (select jsonb_agg(jsonb_build_array(l->>'reference',(l->>'quantity')::int) order by l->>'reference') from jsonb_array_elements(document->'lines') l)='[["ABC 1",2],["INCONNU-HORS-CATALOGUE",3]]'::jsonb
   and created_by is null and version=1
  from public.returns_cases where id='bb5e1e57-7e57-4000-8000-000000000001'));
select pg_temp.expect('typed garage request: not linked, name normalised, marked unverified',
 (select document->>'client_id' is null and document->>'client_name'='Garage Nouveau' and not (document->>'garage_verified')::boolean from public.returns_cases where id='bb5e1e57-7e57-4000-8000-000000000002'));
select pg_temp.expect('creation event without author, with the pickup place',
 (select count(*)=1 and bool_and(actor_id is null and event_kind='created' and note like '%Sous l’auvent') from public.returns_case_events where case_id='bb5e1e57-7e57-4000-8000-000000000002'));

-- The team processes a public request with the existing internal function; the garage fields stay.
do $$ declare saved public.returns_cases; doc jsonb; staff uuid:=current_setting('t.user')::uuid; begin
 insert into public.scanette_members(workspace_id,user_id,role) values('11111111-1111-4111-8111-111111111111',staff,'operator');
 perform set_config('request.jwt.claim.sub',staff::text,true);
 select document into doc from public.returns_cases where id='bb5e1e57-7e57-4000-8000-000000000002';
 set local role authenticated;
 saved:=public.returns_save_case('11111111-1111-4111-8111-111111111111','bb5e1e57-7e57-4000-8000-000000000002',1,jsonb_set(jsonb_set(doc,'{collector}','"serge"'),'{status}','"collected"'),'enlevé');
 reset role;
 perform pg_temp.expect('internal transition keeps the pickup place',saved.version=2 and saved.document->>'pickup_location'='Sous l’auvent' and saved.document->>'status'='collected');
end $$;
select pg_temp.expect('accepted requests are recorded once each',(select count(*) from public.returns_public_requests where workspace_id='11111111-1111-4111-8111-111111111111')=7);
-- Shop-wide limit: lower it, the next request of any garage is refused.
update public.returns_public_portals set max_per_window=7 where workspace_id='11111111-1111-4111-8111-111111111111';
set local role anon;
select pg_temp.expect('shop-wide limit',pg_temp.sqlstate_of($q$select public.returns_public_submit('11111111-1111-4111-8111-111111111111',gen_random_uuid(),null,'Garage Tout Neuf','Accueil','[{"reference":"L","quantity":1}]')$q$)='PT429');
reset role;
rollback;
select 'PASS: public garage portal list, submission, retries, validation, rate limits, isolation and internal processing verified; rolled back' as result;
