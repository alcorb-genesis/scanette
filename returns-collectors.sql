-- Retours et garanties : rattachement réel aux livreurs et traitement complet par l'équipe retours.
-- Prerequisites: returns-workflow.sql, returns-public-portal.sql and the shared logistics access applied.
-- Apply by hand, as postgres, in the Supabase SQL Editor (paste the whole file, run once), then run
-- returns-collectors.test.sql. Not applied by the application. Safe to run again: every statement
-- is idempotent. No BEGIN/COMMIT and no anonymous dollar tag: the editor sends the file as one
-- request, which PostgreSQL runs as a single transaction (all or nothing).
--
-- What changes
--   * one collector per dossier, in document.collector: one of the ten services below, or '' = « À attribuer »;
--   * a shorter cycle: requested → collected → received → supplier_pending → credited / closed (+ cancelled);
--     the former states supplier_ready, sent and credit_pending become supplier_pending, with a journal line;
--   * the journal records every assignment and reassignment (event_kind 'assigned', from/to collector);
--   * one write path: returns_apply_case, used by the shared access and by the staff-account function;
--   * a request from the public garage portal is attached to a collector only when the garage has exactly
--     one known collection service; otherwise it stays « À attribuer ». The portal still returns one uuid.
--   * the orphan trigger returns_collection_assignment_check (left by a reverted change) is removed.
-- Nothing is granted to the public beyond what it already had.

-- 1. Orphan validation of a reverted change (document.collection_carrier / collection_done).
drop trigger if exists returns_collection_assignment_check on public.returns_cases;
drop function if exists public.returns_validate_collection_assignment();

-- 2. Journal: assignments are events of their own.
alter table public.returns_case_events add column if not exists from_collector text;
alter table public.returns_case_events add column if not exists to_collector text;
alter table public.returns_case_events drop constraint if exists returns_case_events_event_kind_check;
alter table public.returns_case_events add constraint returns_case_events_event_kind_check check(event_kind in ('created','updated','status_changed','assigned'));

-- 3. The ten collection services, in the order shown to the team. null = not a collector.
create or replace function public.returns_collector_label(collector text) returns text language sql immutable set search_path='' as $repclick_fn$
 select case collector when 'serge' then 'Serge' when 'damian' then 'Damian' when 'paketo_landes' then 'Paketo Landes' when 'paketo_bearn' then 'Paketo Béarn'
  when 'paketo_pays_basque' then 'Paketo Pays Basque' when 'ace' then 'Ace' when 'ludovic' then 'Ludovic' when 'maxime' then 'Maxime' when 'charlie' then 'Charlie' when 'cedric' then 'Cédric' end;
$repclick_fn$;

-- The collector behind a carrier name written on a garage record. A name that is not one of the
-- services is kept as 'other:…' so that it still counts as a second service (never guessed).
create or replace function public.returns_carrier_collector(carrier text) returns text language sql immutable set search_path='' as $repclick_fn$
 select case when k='' then null
  when k in ('serge','damian','ludovic','maxime','charlie','cedric') then k
  when k='paketo landes' then 'paketo_landes' when k='paketo bearn' then 'paketo_bearn' when k='paketo pays basque' then 'paketo_pays_basque'
  when k='ace' or left(k,4)='ace ' then 'ace'
  else 'other:'||k end
 from (select btrim(regexp_replace(lower(translate(coalesce(carrier,''),'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç','AAAEEEEIIOOUUUCaaaeeeeiioouuuc')),'[^a-z0-9]+',' ','g')) as k) s;
$repclick_fn$;

-- The collector of a garage when it is certain: its internal rounds and the carriers of its recorded
-- departures name exactly one service, and that service is one of the ten. Ludovic reinforces the
-- other rounds and is never proposed. Anything else: null (« À attribuer »).
create or replace function public.returns_certain_collector(shop uuid,garage uuid) returns text language sql stable set search_path='' as $repclick_fn$
 select case when count(*)=1 and min(s) in ('serge','damian','paketo_landes','paketo_bearn','paketo_pays_basque','ace','maxime','charlie','cedric') then min(s) end
 from (
  select t.value as s from public.gestion_partners p
   cross join lateral jsonb_array_elements_text(case when jsonb_typeof(p.details->'tours')='array' then p.details->'tours' else '[]'::jsonb end) t
   where p.id=garage and p.workspace_id=shop and p.kind='client' and t.value in ('damian','maxime','charlie','cedric')
  union
  select public.returns_carrier_collector(d.value->>'carrier') from public.gestion_partners p
   cross join lateral jsonb_array_elements(case when jsonb_typeof(p.departures)='array' then p.departures else '[]'::jsonb end) d
   where p.id=garage and p.workspace_id=shop and p.kind='client'
 ) a where s is not null;
$repclick_fn$;

-- 4. Existing dossiers: former states are regrouped, former attempts at an assignment are read once.
--    Kept as an internal function so that the test can run it on fabricated old rows.
create or replace function public.returns_regroup_legacy() returns integer language plpgsql set search_path='' as $repclick_fn$
declare touched integer:=0; r record; doc jsonb; old_status text; found_collector text; old_carrier text;
begin
 for r in select * from public.returns_cases c where c.document->>'status' in ('supplier_ready','sent','credit_pending')
   or c.document ? 'services' or c.document ? 'collection_carrier' or c.document ? 'collection_done' for update loop
  doc:=r.document; old_status:=doc->>'status'; found_collector:=null;
  if not (doc ? 'collector') then
   if jsonb_typeof(doc->'services')='array' and jsonb_array_length(doc->'services')=1 and public.returns_collector_label(doc->'services'->>0) is not null then found_collector:=doc->'services'->>0; end if;
   old_carrier:=lower(coalesce(doc->>'collection_carrier',''));
   if found_collector is null and old_carrier<>'' then
    found_collector:=case old_carrier when 'damien' then 'damian' when 'serge' then 'serge' when 'ace' then 'ace' when 'ludovic' then 'ludovic' when 'cedric' then 'cedric' when 'maxime' then 'maxime' when 'charlie' then 'charlie' end;
   end if;
  end if;
  doc:=doc-'services'-'collection_carrier'-'collection_done';
  if found_collector is not null then doc:=jsonb_set(doc,'{collector}',to_jsonb(found_collector)); end if;
  if old_status in ('supplier_ready','sent','credit_pending') then doc:=jsonb_set(doc,'{status}','"supplier_pending"'); end if;
  update public.returns_cases c set document=doc,version=r.version+1 where c.id=r.id;
  if old_status in ('supplier_ready','sent','credit_pending') then
   insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note)
    values(gen_random_uuid(),r.id,r.workspace_id,null,'status_changed',old_status,'supplier_pending','Mise à jour du cycle : ancien état regroupé dans « En attente fournisseur ».');
  end if;
  touched:=touched+1;
  if found_collector is not null then
   insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,from_collector,to_collector)
    values(gen_random_uuid(),r.id,r.workspace_id,null,'assigned',doc->>'status',doc->>'status','Attribution reprise de l’ancienne saisie.',null,found_collector);
  end if;
 end loop;
 return touched;
end;$repclick_fn$;
select public.returns_regroup_legacy() as dossiers_regroupes;

-- 5. Last line of defence on the table itself, whoever writes: a known state, a known collector.
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;
drop trigger if exists returns_cases_guard on public.returns_cases;
create trigger returns_cases_guard before insert or update of document on public.returns_cases for each row execute function public.returns_cases_guard();

-- 6. The single write path. shop is already verified by the caller; actor is the staff account or null.
create or replace function public.returns_apply_case(shop uuid,actor uuid,via text,case_id uuid,expected_version integer,case_document jsonb,event_note text)
returns public.returns_cases language plpgsql security definer set search_path='' as $repclick_fn$
declare previous public.returns_cases%rowtype; saved public.returns_cases; line jsonb; client_id uuid; supplier_id uuid;
 before_status text; after_status text; before_collector text:=''; after_collector text; only_assignment boolean:=false; existed boolean; note text:=coalesce(event_note,'');
 qty integer; got integer; refused integer;
begin
 if shop is null or case_id is null or expected_version is null or expected_version<0 or jsonb_typeof(case_document) is distinct from 'object' or octet_length(case_document::text)>150000 or length(note)>1000 then raise exception 'Invalid request' using errcode='22023'; end if;
 if coalesce(case_document->>'type','') not in ('return','warranty','deposit','mixed')
  or coalesce(case_document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled')
  or length(btrim(coalesce(case_document->>'client_name',''))) not between 1 and 180 or length(coalesce(case_document->>'supplier_name',''))>180
  or jsonb_typeof(case_document->'lines') is distinct from 'array' or jsonb_array_length(case_document->'lines') not between 1 and 200 then raise exception 'Invalid return case' using errcode='22023'; end if;
 if case_document ? 'collector' and jsonb_typeof(case_document->'collector')<>'string' then raise exception 'Invalid collector' using errcode='22023'; end if;
 after_collector:=coalesce(case_document->>'collector','');
 if after_collector<>'' and public.returns_collector_label(after_collector) is null then raise exception 'Invalid collector' using errcode='22023'; end if;
 if case_document ? 'pickup_location' and (jsonb_typeof(case_document->'pickup_location')<>'string' or length(case_document->>'pickup_location')>160 or case_document->>'pickup_location' ~ '[[:cntrl:]]') then raise exception 'Invalid pickup location' using errcode='22023'; end if;
 if case_document ? 'credit_reference' and (jsonb_typeof(case_document->'credit_reference')<>'string' or length(case_document->>'credit_reference')>80 or case_document->>'credit_reference' ~ '[[:cntrl:]]') then raise exception 'Invalid credit reference' using errcode='22023'; end if;
 if coalesce(case_document->>'client_id','')<>'' then client_id:=(case_document->>'client_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=client_id and p.workspace_id=shop and p.kind='client') then raise exception 'Client outside workspace' using errcode='22023'; end if; end if;
 if coalesce(case_document->>'supplier_id','')<>'' then supplier_id:=(case_document->>'supplier_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=supplier_id and p.workspace_id=shop and p.kind='supplier') then raise exception 'Supplier outside workspace' using errcode='22023'; end if; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(case_document->'lines'))<>jsonb_array_length(case_document->'lines') then raise exception 'Duplicate line' using errcode='22023'; end if;
 for line in select value from jsonb_array_elements(case_document->'lines') loop
  if jsonb_typeof(line)<>'object' or coalesce(line->>'id','')='' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or length(coalesce(line->>'description',''))>500
   or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,5}$' or (line->>'quantity')::integer>100000
   or coalesce(line->>'received_quantity','0') !~ '^[0-9]{1,6}$' or coalesce(line->>'received_quantity','0')::integer>100000
   or coalesce(line->>'refused_quantity','0') !~ '^[0-9]{1,6}$' or coalesce(line->>'refused_quantity','0')::integer>coalesce(line->>'received_quantity','0')::integer
   or length(coalesce(line->>'condition',''))>300 or length(coalesce(line->>'reason',''))>500 then raise exception 'Invalid return line' using errcode='22023'; end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products p where p.id=(line->>'product_id')::uuid and p.workspace_id=shop) then raise exception 'Product outside workspace' using errcode='22023'; end if;
 end loop;

 perform 1 from public.scanette_workspaces w where w.id=shop for update;
 select * into previous from public.returns_cases c where c.id=case_id for update;
 existed:=found; after_status:=case_document->>'status';
 if existed then
  if previous.workspace_id<>shop then raise exception 'Access denied' using errcode='42501'; end if;
  if previous.document=case_document then return previous; end if;
  if previous.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
  before_status:=previous.document->>'status'; before_collector:=coalesce(previous.document->>'collector','');
  if before_status<>after_status and not (
      (before_status='requested' and after_status in ('collected','cancelled'))
   or (before_status='collected' and after_status in ('received','cancelled'))
   or (before_status='received' and after_status in ('supplier_pending','credited','closed','cancelled'))
   or (before_status='supplier_pending' and after_status in ('credited','closed','cancelled'))
   or (before_status='credited' and after_status='closed')) then raise exception 'Invalid status transition' using errcode='22023'; end if;
  -- Who collected is a fact once the parts are received: it can be corrected before, not after.
  if before_collector<>after_collector and before_status not in ('requested','collected') then raise exception 'Collector is frozen after reception' using errcode='22023'; end if;
  only_assignment:=before_status=after_status and (previous.document-'collector')=(case_document-'collector');
 else
  if expected_version<>0 or after_status<>'requested' then raise exception 'New return case must start as requested' using errcode='22023'; end if;
 end if;

 -- What a state requires when it is entered. Nothing is invented: an unknown supplier or credit stays unknown.
 if before_status is distinct from after_status then
  if after_status='collected' and after_collector='' then raise exception 'Collector required' using errcode='22023'; end if;
  if after_status='received' then
   for line in select value from jsonb_array_elements(case_document->'lines') loop
    if coalesce(line->>'received_quantity','')='' then raise exception 'Reception control required' using errcode='22023'; end if;
    qty:=(line->>'quantity')::integer; got:=(line->>'received_quantity')::integer; refused:=coalesce(line->>'refused_quantity','0')::integer;
    if (got<>qty or refused>0) and btrim(coalesce(line->>'reason',''))='' then raise exception 'Reason required for a difference' using errcode='22023'; end if;
   end loop;
  end if;
  if after_status in ('supplier_pending','credited') and btrim(coalesce(case_document->>'supplier_name',''))='' then raise exception 'Supplier required' using errcode='22023'; end if;
  if after_status='credited' and btrim(coalesce(case_document->>'credit_reference',''))='' then raise exception 'Credit reference required' using errcode='22023'; end if;
 end if;

 if existed then
  update public.returns_cases c set document=case_document,version=previous.version+1,updated_by=actor,access_source=via,updated_at=clock_timestamp() where c.id=case_id returning * into saved;
 else
  insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by,access_source) values(case_id,shop,case_document,1,actor,actor,via) returning * into saved;
 end if;
 if not only_assignment then
  insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source)
   values(gen_random_uuid(),saved.id,shop,actor,case when not existed then 'created' when before_status=after_status then 'updated' else 'status_changed' end,before_status,after_status,note,via);
 end if;
 if before_collector<>after_collector then
  insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,from_collector,to_collector)
   values(gen_random_uuid(),saved.id,shop,actor,'assigned',after_status,after_status,case when only_assignment then note else '' end,via,nullif(before_collector,''),nullif(after_collector,''));
 end if;
 return saved;
end;$repclick_fn$;

-- Shared logistics access: same signature and answer as before.
create or replace function public.shared_save_return(case_id uuid,expected_version integer,case_document jsonb,event_note text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare saved public.returns_cases;
begin
 saved:=public.returns_apply_case(public.shared_shop(session_token),null,'shared_access',case_id,expected_version,case_document,event_note);
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;

-- Staff accounts (not used by the published application): same rules, with the author.
create or replace function public.returns_save_case(shop_id uuid,case_id uuid,expected_version integer,case_document jsonb,event_note text default '')
returns public.returns_cases language plpgsql security definer set search_path='' as $repclick_fn$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501'; end if;
 return public.returns_apply_case(shop_id,actor,null,case_id,expected_version,case_document,event_note);
end;$repclick_fn$;

-- 7. Journal read by the shared access, with the assignments. The answer has two more columns,
--    so the function is recreated.
drop function if exists public.shared_return_events(uuid,text);
create function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text,from_collector text,to_collector text)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source,e.from_collector,e.to_collector from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at,e.event_kind desc limit 300;
end;$repclick_fn$;

-- The application asks this once to know that this file is applied (2 = collectors and short cycle).
create or replace function public.shared_returns_model(session_token text default null) returns integer language plpgsql stable security definer set search_path='' as $repclick_fn$
begin perform public.shared_shop(session_token); return 2; end;$repclick_fn$;

-- 8. Public garage portal: same arguments, same checks, same answer (one uuid). The only addition is
--    the collector, set when it is certain for a garage chosen in the list.
create or replace function public.returns_public_submit(shop_id uuid,request_id uuid,garage_id uuid,garage_name text,pickup_location text,case_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $repclick_fn$
declare
 portal public.returns_public_portals; partner public.gestion_partners;
 garage text; place text; gkey text; line jsonb; ref text; qty integer; doc jsonb; merged jsonb:='{}'::jsonb; line_rows jsonb; auto text;
begin
 -- The portal row is locked: concurrent requests of one shop are counted one after the other.
 select * into portal from public.returns_public_portals where workspace_id=shop_id and enabled for update;
 if not found then raise exception 'Portal closed' using errcode='42501'; end if;
 if request_id is null then raise exception 'Invalid request' using errcode='22023'; end if;

 -- A retry of an accepted request returns the same id and changes nothing.
 if exists(select 1 from public.returns_public_requests r where r.id=request_id and r.workspace_id=shop_id) then return request_id; end if;
 if exists(select 1 from public.returns_cases c where c.id=request_id) then raise exception 'Invalid request' using errcode='22023'; end if;

 if garage_id is not null then
  select * into partner from public.gestion_partners p where p.id=garage_id and p.workspace_id=shop_id and p.kind='client'
   and not coalesce((p.details->>'archived')::boolean,false) and coalesce(p.details->>'merged_into','')='';
  if not found then raise exception 'Unknown garage' using errcode='22023'; end if;
  garage:=partner.name; gkey:='id:'||partner.id::text; auto:=public.returns_certain_collector(shop_id,partner.id);
 else
  garage:=regexp_replace(btrim(coalesce(garage_name,'')),'\s+',' ','g');
  if length(garage) not between 2 and 120 or garage ~ '[[:cntrl:]]' then raise exception 'Invalid garage name' using errcode='22023'; end if;
  gkey:='name:'||lower(garage);
 end if;

 place:=regexp_replace(btrim(coalesce(pickup_location,'')),'\s+',' ','g');
 if length(place) not between 2 and 160 or place ~ '[[:cntrl:]]' then raise exception 'Invalid pickup location' using errcode='22023'; end if;

 if jsonb_typeof(case_lines) is distinct from 'array' or jsonb_array_length(case_lines) not between 1 and 100 or octet_length(case_lines::text)>20000 then raise exception 'Invalid lines' using errcode='22023'; end if;
 for line in select value from jsonb_array_elements(case_lines) loop
  if jsonb_typeof(line)<>'object' or jsonb_typeof(line->'reference')<>'string' or jsonb_typeof(line->'quantity')<>'number'
     or (line->>'quantity') !~ '^[1-9][0-9]{0,2}$' then raise exception 'Invalid line' using errcode='22023'; end if;
  ref:=upper(regexp_replace(btrim(line->>'reference'),'\s+',' ','g'));
  if length(ref) not between 1 and 80 or ref ~ '[[:cntrl:]]' then raise exception 'Invalid reference' using errcode='22023'; end if;
  qty:=coalesce((merged->>ref)::integer,0)+(line->>'quantity')::integer;
  if qty>999 then raise exception 'Invalid quantity' using errcode='22023'; end if;
  merged:=jsonb_set(merged,array[ref],to_jsonb(qty));
 end loop;

 if (select count(*) from public.returns_public_requests r where r.workspace_id=shop_id and r.created_at>clock_timestamp()-make_interval(mins=>portal.window_minutes))>=portal.max_per_window
  or (select count(*) from public.returns_public_requests r where r.workspace_id=shop_id and r.garage_key=gkey and r.created_at>clock_timestamp()-make_interval(mins=>portal.window_minutes))>=portal.max_per_garage
 then raise exception 'Too many requests' using errcode='PT429'; end if;

 select jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'product_id',null,'reference',key,'description','','quantity',value::integer,'received_quantity',null,'condition','','reason','') order by key) into line_rows from jsonb_each_text(merged);
 doc:=jsonb_build_object('type','return','status','requested','client_id',partner.id,'client_name',garage,'supplier_id',null,'supplier_name','',
  'lines',line_rows,'portal',true,'source','public_portal','pickup_location',place,'garage_verified',garage_id is not null,'collector',coalesce(auto,''));
 insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values(request_id,shop_id,doc,1,null,null);
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note)
  values(gen_random_uuid(),request_id,shop_id,null,'created',null,'requested','Retours prêts pour la collecte (portail garage) · À récupérer : '||place);
 if auto is not null then
  insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,from_collector,to_collector)
   values(gen_random_uuid(),request_id,shop_id,null,'assigned','requested','requested','Attribution automatique : seul service de collecte connu pour ce garage.',null,auto);
 end if;
 insert into public.returns_public_requests(id,workspace_id,garage_key) values(request_id,shop_id,gkey);
 return request_id;
end;$repclick_fn$;

-- 9. Rights. The helpers and the write path are internal: nobody calls them directly.
revoke all on function public.returns_regroup_legacy(),public.returns_collector_label(text),public.returns_carrier_collector(text),public.returns_certain_collector(uuid,uuid),public.returns_cases_guard(),
 public.returns_apply_case(uuid,uuid,text,uuid,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.shared_save_return(uuid,integer,jsonb,text,text),public.shared_return_events(uuid,text),public.shared_returns_model(text),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.shared_save_return(uuid,integer,jsonb,text,text),public.shared_return_events(uuid,text),public.shared_returns_model(text),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) to anon,authenticated;
revoke all on function public.returns_save_case(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.returns_save_case(uuid,uuid,integer,jsonb,text) to authenticated;
