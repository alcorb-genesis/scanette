-- Retour arrière de returns-actions.sql. À n'utiliser que si l'écran précédent doit être remis en service.
-- Apply by hand, as postgres, in the Supabase SQL Editor (whole file, once). No BEGIN/COMMIT.
-- The functions of the decisions are removed and the former guard and journal reading come back.
-- Received quantities can again be typed in a saved document, as before.
-- NOTHING is deleted: the tables returns_line_actions and returns_shipments, the journal columns and
-- the journal lines of the decisions are kept, so that returns-actions.sql can be applied again later
-- without loss. A dossier can then be closed again even if decisions were still running.
drop function if exists public.shared_return_actions(text);
drop function if exists public.shared_return_shipments(text);
drop function if exists public.shared_return_action_add(uuid,text,text,integer,uuid,text,text,text,text);
drop function if exists public.shared_return_action_move(uuid,text,text,integer,text,text,text);
drop function if exists public.shared_return_shipment_open(uuid,text,text);
drop function if exists public.shared_return_pack(uuid,text,text,text);
drop function if exists public.shared_return_shipment_send(uuid,text,text,text);
drop function if exists public.shared_return_receive(uuid,text,text,text);
drop function if exists public.shared_return_receive_line(uuid,text,integer,text,text,text);
drop function if exists public.returns_set_received(public.returns_cases,text,integer,text,text,text);
drop function if exists public.returns_matching_lines(uuid,jsonb,text);
drop function if exists public.returns_action_log(public.returns_line_actions,text,text,text);
drop function if exists public.returns_actor_label(text);
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;
drop function if exists public.shared_return_events(uuid,text);
create function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text,from_collector text,to_collector text)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source,e.from_collector,e.to_collector from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at,e.event_kind desc limit 300;
end;$repclick_fn$;
revoke all on function public.returns_cases_guard() from public,anon,authenticated;
revoke all on function public.shared_return_events(uuid,text) from public;
grant execute on function public.shared_return_events(uuid,text) to anon,authenticated;
-- The write path of a dossier as it was: received quantities are again part of the saved document.
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
revoke all on function public.returns_apply_case(uuid,uuid,text,uuid,integer,jsonb,text) from public,anon,authenticated;
