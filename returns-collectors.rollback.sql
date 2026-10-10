-- Retour arrière de returns-collectors.sql. À n'utiliser que si l'application précédente doit être remise en service.
-- Apply by hand, as postgres, in the Supabase SQL Editor (whole file, once). No BEGIN/COMMIT.
--
-- What it does: puts back the former functions and the former cycle. What it cannot do:
--   * the former cycle has no « Clôturé » state: a closed dossier becomes « Avoir reçu » when it has a
--     credit reference, « Annulé » otherwise, with a journal line that says so;
--   * « En attente fournisseur » becomes « Avoir attendu »;
--   * collectors, pickup places, credit references and refused quantities stay in the documents and in
--     the journal (nothing is deleted), but the former application does not show them;
--   * the two journal columns and the 'assigned' events are kept.
-- The orphan trigger removed by returns-collectors.sql is not put back.
drop trigger if exists returns_cases_guard on public.returns_cases;
do $repclick_run$
declare r record; target text;
begin
 for r in select * from public.returns_cases c where c.document->>'status' in ('supplier_pending','closed') for update loop
  target:=case when r.document->>'status'='supplier_pending' then 'credit_pending' when btrim(coalesce(r.document->>'credit_reference',''))<>'' then 'credited' else 'cancelled' end;
  update public.returns_cases c set document=jsonb_set(r.document,'{status}',to_jsonb(target)),version=r.version+1 where c.id=r.id;
  insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note)
   values(gen_random_uuid(),r.id,r.workspace_id,null,'status_changed',r.document->>'status',target,'Retour à l’ancien cycle : état converti.');
 end loop;
end $repclick_run$;
drop function if exists public.shared_returns_model(text);
drop function if exists public.shared_return_events(uuid,text);
create function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at limit 200;
end;$repclick_fn$;
create or replace function public.shared_save_return(case_id uuid,expected_version integer,case_document jsonb,event_note text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_cases%rowtype; saved public.returns_cases; line jsonb; client_id uuid; supplier_id uuid; before_status text; after_status text; event_type text;
begin
 if case_id is null or expected_version is null or expected_version<0 or jsonb_typeof(case_document) is distinct from 'object' or octet_length(case_document::text)>150000 or length(coalesce(event_note,''))>1000 then raise exception 'Invalid request' using errcode='22023'; end if;
 if coalesce(case_document->>'type','') not in ('return','warranty','deposit','mixed') or coalesce(case_document->>'status','') not in ('requested','collected','received','supplier_ready','sent','credit_pending','credited','cancelled') or length(btrim(coalesce(case_document->>'client_name',''))) not between 1 and 180 or length(coalesce(case_document->>'supplier_name',''))>180 or jsonb_typeof(case_document->'lines') is distinct from 'array' or jsonb_array_length(case_document->'lines') not between 1 and 200 then raise exception 'Invalid return case' using errcode='22023'; end if;
 -- Round services of the case (optional, several allowed): a short list of distinct identifiers.
 if case_document ? 'services' then
  if jsonb_typeof(case_document->'services') is distinct from 'array' or jsonb_array_length(case_document->'services')>20 then raise exception 'Invalid services' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(case_document->'services') v where jsonb_typeof(v.value)<>'string' or (v.value#>>'{}') !~ '^[a-z0-9_]{1,40}$')
   or (select count(distinct v.value) from jsonb_array_elements(case_document->'services') v)<>jsonb_array_length(case_document->'services') then raise exception 'Invalid services' using errcode='22023'; end if;
 end if;
 if coalesce(case_document->>'client_id','')<>'' then client_id:=(case_document->>'client_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=client_id and p.workspace_id=shop and p.kind='client') then raise exception 'Client outside workspace' using errcode='22023'; end if; end if;
 if coalesce(case_document->>'supplier_id','')<>'' then supplier_id:=(case_document->>'supplier_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=supplier_id and p.workspace_id=shop and p.kind='supplier') then raise exception 'Supplier outside workspace' using errcode='22023'; end if; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(case_document->'lines'))<>jsonb_array_length(case_document->'lines') then raise exception 'Duplicate line' using errcode='22023'; end if;
 for line in select value from jsonb_array_elements(case_document->'lines') loop
  if coalesce(line->>'id','')='' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or length(coalesce(line->>'description',''))>500 or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,4}$' or (line->>'quantity')::integer>100000 or (line ? 'received_quantity' and line->>'received_quantity'<>'' and ((line->>'received_quantity') !~ '^[0-9]{1,5}$' or (line->>'received_quantity')::integer>(line->>'quantity')::integer)) or length(coalesce(line->>'condition',''))>300 or length(coalesce(line->>'reason',''))>500 then raise exception 'Invalid return line' using errcode='22023'; end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products p where p.id=(line->>'product_id')::uuid and p.workspace_id=shop) then raise exception 'Product outside workspace' using errcode='22023'; end if;
 end loop;
 perform 1 from public.scanette_workspaces w where w.id=shop for update;
 select * into previous from public.returns_cases c where c.id=case_id for update;
 after_status:=case_document->>'status';
 if found then
  if previous.workspace_id<>shop then raise exception 'Access denied' using errcode='42501'; end if;
  if previous.document=case_document then return query select previous.id,previous.document,previous.version,previous.created_at,previous.updated_at; return; end if;
  if previous.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
  before_status:=previous.document->>'status';
  if before_status<>after_status and not ((before_status='requested' and after_status in ('collected','cancelled')) or (before_status='collected' and after_status in ('received','cancelled')) or (before_status='received' and after_status in ('supplier_ready','cancelled')) or (before_status='supplier_ready' and after_status in ('sent','cancelled')) or (before_status='sent' and after_status in ('credit_pending','cancelled')) or (before_status='credit_pending' and after_status in ('credited','cancelled'))) then raise exception 'Invalid status transition' using errcode='22023'; end if;
  event_type:=case when before_status=after_status then 'updated' else 'status_changed' end;
  update public.returns_cases c set document=case_document,version=previous.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp() where c.id=case_id returning * into saved;
 else
  if expected_version<>0 or after_status<>'requested' then raise exception 'New return case must start as requested' using errcode='22023'; end if;
  event_type:='created';
  insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by,access_source) values(case_id,shop,case_document,1,null,null,'shared_access') returning * into saved;
 end if;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source) values(gen_random_uuid(),saved.id,shop,null,event_type,before_status,after_status,coalesce(event_note,''),'shared_access');
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;
create or replace function public.returns_save_case(shop_id uuid,case_id uuid,expected_version integer,case_document jsonb,event_note text default '')
returns public.returns_cases language plpgsql security definer set search_path='' as $repclick_fn$
declare actor uuid:=auth.uid(); previous public.returns_cases%rowtype; saved public.returns_cases; line jsonb; client_id uuid; supplier_id uuid; before_status text; after_status text; event_type text;
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501'; end if;
 if case_id is null or expected_version is null or expected_version<0 or jsonb_typeof(case_document) is distinct from 'object' or octet_length(case_document::text)>150000 or length(coalesce(event_note,''))>1000 then raise exception 'Invalid request'; end if;
 if coalesce(case_document->>'type','') not in ('return','warranty','deposit','mixed') or coalesce(case_document->>'status','') not in ('requested','collected','received','supplier_ready','sent','credit_pending','credited','cancelled') or length(btrim(coalesce(case_document->>'client_name',''))) not between 1 and 180 or length(coalesce(case_document->>'supplier_name',''))>180 or jsonb_typeof(case_document->'lines') is distinct from 'array' or jsonb_array_length(case_document->'lines') not between 1 and 200 then raise exception 'Invalid return case'; end if;
 if coalesce(case_document->>'client_id','')<>'' then client_id:=(case_document->>'client_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=client_id and p.workspace_id=shop_id and p.kind='client') then raise exception 'Client outside workspace'; end if; end if;
 if coalesce(case_document->>'supplier_id','')<>'' then supplier_id:=(case_document->>'supplier_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=supplier_id and p.workspace_id=shop_id and p.kind='supplier') then raise exception 'Supplier outside workspace'; end if; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(case_document->'lines'))<>jsonb_array_length(case_document->'lines') then raise exception 'Duplicate line'; end if;
 for line in select value from jsonb_array_elements(case_document->'lines') loop
  if coalesce(line->>'id','')='' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or length(coalesce(line->>'description',''))>500 or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,4}$' or (line->>'quantity')::integer>100000 or (line ? 'received_quantity' and line->>'received_quantity'<>'' and ((line->>'received_quantity') !~ '^[0-9]{1,5}$' or (line->>'received_quantity')::integer>(line->>'quantity')::integer)) or length(coalesce(line->>'condition',''))>300 or length(coalesce(line->>'reason',''))>500 then raise exception 'Invalid return line'; end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products p where p.id=(line->>'product_id')::uuid and p.workspace_id=shop_id) then raise exception 'Product outside workspace'; end if;
 end loop;
 perform 1 from public.scanette_workspaces where id=shop_id for update;
 select * into previous from public.returns_cases where id=case_id for update;
 after_status:=case_document->>'status';
 if found then
  if previous.workspace_id<>shop_id then raise exception 'Access denied' using errcode='42501'; end if;
  if previous.document=case_document then return previous; end if;
  if previous.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
  before_status:=previous.document->>'status';
  if before_status<>after_status and not ((before_status='requested' and after_status in ('collected','cancelled')) or (before_status='collected' and after_status in ('received','cancelled')) or (before_status='received' and after_status in ('supplier_ready','cancelled')) or (before_status='supplier_ready' and after_status in ('sent','cancelled')) or (before_status='sent' and after_status in ('credit_pending','cancelled')) or (before_status='credit_pending' and after_status in ('credited','cancelled'))) then raise exception 'Invalid status transition'; end if;
  event_type:=case when before_status=after_status then 'updated' else 'status_changed' end;
  update public.returns_cases set document=case_document,version=previous.version+1,updated_by=actor,updated_at=clock_timestamp() where id=case_id returning * into saved;
 else
  if expected_version<>0 or after_status<>'requested' then raise exception 'New return case must start as requested'; end if;
  event_type:='created';
  insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values(case_id,shop_id,case_document,1,actor,actor) returning * into saved;
 end if;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note) values(gen_random_uuid(),saved.id,shop_id,actor,event_type,before_status,after_status,coalesce(event_note,''));
 return saved;
end;$repclick_fn$;
create or replace function public.returns_public_submit(shop_id uuid,request_id uuid,garage_id uuid,garage_name text,pickup_location text,case_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $repclick_fn$
declare
 portal public.returns_public_portals; partner public.gestion_partners;
 garage text; place text; gkey text; line jsonb; ref text; qty integer; doc jsonb; merged jsonb:='{}'::jsonb; line_rows jsonb;
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
  garage:=partner.name; gkey:='id:'||partner.id::text;
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
  'lines',line_rows,'portal',true,'source','public_portal','pickup_location',place,'garage_verified',garage_id is not null);
 insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values(request_id,shop_id,doc,1,null,null);
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note)
  values(gen_random_uuid(),request_id,shop_id,null,'created',null,'requested','Retours prêts pour la collecte (portail garage) · À récupérer : '||place);
 insert into public.returns_public_requests(id,workspace_id,garage_key) values(request_id,shop_id,gkey);
 return request_id;
end;$repclick_fn$;
drop function if exists public.returns_apply_case(uuid,uuid,text,uuid,integer,jsonb,text);
drop function if exists public.returns_regroup_legacy();
drop function if exists public.returns_certain_collector(uuid,uuid);
drop function if exists public.returns_carrier_collector(text);
drop function if exists public.returns_cases_guard();
drop function if exists public.returns_collector_label(text);
revoke all on function public.shared_save_return(uuid,integer,jsonb,text,text),public.shared_return_events(uuid,text),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.shared_save_return(uuid,integer,jsonb,text,text),public.shared_return_events(uuid,text),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) to anon,authenticated;
revoke all on function public.returns_save_case(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.returns_save_case(uuid,uuid,integer,jsonb,text) to authenticated;
