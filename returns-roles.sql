-- Retours et garanties : un écran par rôle, une pièce qualifiée au moment de son scan.
-- Prerequisite: returns-actions.sql applied. Apply by hand, as postgres, in the Supabase SQL Editor
-- (whole file, once), then run returns-roles.test.sql. Safe to run again: every statement is idempotent.
-- No BEGIN/COMMIT, no anonymous dollar tag.
--
-- Additive: no table, column, dossier or journal line is removed or rewritten. Functions of the
-- former screen stay in place. What is added:
--   organise   shared_return_plan        a collector, a planned passage and the type, while « requested »
--              shared_return_taken       the driver took the parts: requested → collected
--              shared_return_set_type    « Retour client » or « Garantie » for an older dossier of another type
--   receive    shared_return_identify    is this code EXACTLY a line of the dossier? (reads only)
--              shared_return_receive_part one unit received AND qualified: 'ok' or 'damaged' (reason required)
--              shared_return_qualify     the same qualification for a unit received before this file
--              shared_return_finish      every part not scanned is declared missing, explicitly, then « received »
--   process    shared_return_credit_issue      the credit is issued, under its number
--              shared_return_action_supplier   the supplier of a warranty part, when the dossier did not say it
--              shared_return_gap_resolve       a missing part (or an older « pending ») is settled
--   garage     returns_public_submit_typed     the public request, with its type
--
-- Routing is done by the server, at the scan, from the type of the dossier:
--   return   + ok  → customer_credit (to_do)     « Avoirs clients », then « Remise en stock »
--   warranty + ok  → supplier_return (to_send)   « Retours fournisseur »
--   any type + damaged → damaged (recorded)      « Pièces abîmées », with its reason
--   not scanned at the end → missing (open)      « Écarts »
-- A dossier closes by itself once it is received and nothing of it is still running.
-- Once the driver took the parts, the collector and the planned passage are facts: they are frozen.

-- 1. A new kind of row: a part announced and not received. A warranty part may wait for its supplier.
alter table public.returns_line_actions drop constraint if exists returns_line_actions_kind_check;
alter table public.returns_line_actions add constraint returns_line_actions_kind_check check(kind in ('damaged','supplier_return','customer_credit','pending','missing'));
alter table public.returns_line_actions drop constraint if exists returns_line_actions_state;
alter table public.returns_line_actions add constraint returns_line_actions_state check(
     (kind='damaged' and status in ('recorded','cancelled'))
  or (kind='supplier_return' and status in ('to_send','packed','sent','cancelled'))
  or (kind='customer_credit' and status in ('to_do','issued','restocked','closed_no_stock','cancelled'))
  or (kind in ('pending','missing') and status in ('open','resolved','cancelled')));
alter table public.returns_line_actions drop constraint if exists returns_line_actions_supplier;
alter table public.returns_line_actions add constraint returns_line_actions_supplier check(supplier_id is null or kind='supplier_return');

-- 2. The guard of a dossier, as in returns-actions.sql, plus: a readable planned passage, and a
--    collector and a passage that no longer change once the parts are taken.
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 if new.document ? 'pickup_at' and (jsonb_typeof(new.document->'pickup_at')<>'string' or new.document->>'pickup_at' !~ '^(|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})$') then raise exception 'Invalid pickup time' using errcode='22023'; end if;
 if tg_op='UPDATE' and old.document->>'status'<>'requested'
  and (coalesce(new.document->>'collector','') is distinct from coalesce(old.document->>'collector','') or coalesce(new.document->>'pickup_at','') is distinct from coalesce(old.document->>'pickup_at',''))
  then raise exception 'Collection is frozen once taken' using errcode='22023'; end if;
 if tg_op='UPDATE' and new.document->>'status' in ('closed','cancelled') and old.document->>'status' is distinct from new.document->>'status'
  and exists(select 1 from public.returns_line_actions a where a.case_id=new.id and a.status in ('to_send','packed','to_do','issued','open')) then raise exception 'Open decisions remain' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;

-- 3. Units of a line that were received and carry no qualification yet. Zero in the new flow, where
--    the scan qualifies; positive only for parts received before this file.
create or replace function public.returns_unqualified(dossier uuid,line jsonb) returns integer language sql stable set search_path='' as $repclick_fn$
 select greatest(0,case when coalesce(line->>'received_quantity','') ~ '^[0-9]{1,6}$' then (line->>'received_quantity')::integer else 0 end
  -coalesce((select sum(a.quantity) from public.returns_line_actions a where a.case_id=dossier and a.line_id=line->>'id' and a.kind in ('damaged','supplier_return','customer_credit','pending') and a.status<>'cancelled'),0)::integer);
$repclick_fn$;

-- 4. One received unit goes to its queue. Nothing is chosen by the agent beyond « ok » or « damaged ».
create or replace function public.returns_route_unit(dossier public.returns_cases,target_line text,part_state text,why text,actor text)
returns public.returns_line_actions language plpgsql set search_path='' as $repclick_fn$
declare saved public.returns_line_actions; previous public.returns_line_actions; partner public.gestion_partners; kind_of_case text:=dossier.document->>'type';
begin
 if part_state='damaged' then
  insert into public.returns_line_actions(id,workspace_id,case_id,line_id,kind,status,quantity,comment)
   values(gen_random_uuid(),dossier.workspace_id,dossier.id,target_line,'damaged','recorded',1,why) returning * into saved;
  perform public.returns_action_log(saved,null,why,actor);
  return saved;
 end if;
 if kind_of_case='return' then
  select * into previous from public.returns_line_actions a where a.case_id=dossier.id and a.line_id=target_line and a.kind='customer_credit' and a.status='to_do' and a.document_number='' order by a.created_at limit 1 for update;
  if found then
   update public.returns_line_actions a set quantity=a.quantity+1,version=a.version+1,updated_at=clock_timestamp() where a.id=previous.id returning * into saved;
  else
   insert into public.returns_line_actions(id,workspace_id,case_id,line_id,kind,status,quantity)
    values(gen_random_uuid(),dossier.workspace_id,dossier.id,target_line,'customer_credit','to_do',1) returning * into saved;
  end if;
 elsif kind_of_case='warranty' then
  -- The supplier is the one of the dossier when it names one of the shop; otherwise it is asked later, never guessed.
  if coalesce(dossier.document->>'supplier_id','') ~ '^[0-9a-f-]{36}$' then
   select * into partner from public.gestion_partners p where p.id=(dossier.document->>'supplier_id')::uuid and p.workspace_id=dossier.workspace_id and p.kind='supplier';
  end if;
  select * into previous from public.returns_line_actions a where a.case_id=dossier.id and a.line_id=target_line and a.kind='supplier_return' and a.status='to_send' and a.packed_quantity=0 and a.shipment_id is null
   and a.supplier_id is not distinct from partner.id order by a.created_at limit 1 for update;
  if found then
   update public.returns_line_actions a set quantity=a.quantity+1,version=a.version+1,updated_at=clock_timestamp() where a.id=previous.id returning * into saved;
  else
   insert into public.returns_line_actions(id,workspace_id,case_id,line_id,kind,status,quantity,supplier_id,supplier_name)
    values(gen_random_uuid(),dossier.workspace_id,dossier.id,target_line,'supplier_return','to_send',1,partner.id,coalesce(partner.name,'')) returning * into saved;
  end if;
 else
  raise exception 'Type required' using errcode='22023';
 end if;
 perform public.returns_action_log(saved,previous.status,'Conforme · '||saved.quantity,actor);
 return saved;
end;$repclick_fn$;

-- 5. A received dossier whose parts are all settled closes by itself.
create or replace function public.returns_close_if_done(dossier uuid) returns void language plpgsql set search_path='' as $repclick_fn$
declare current_case public.returns_cases;
begin
 select * into current_case from public.returns_cases c where c.id=dossier;
 if not found or current_case.document->>'status'<>'received' then return; end if;
 if exists(select 1 from public.returns_line_actions a where a.case_id=dossier and a.status in ('to_send','packed','to_do','issued','open')) then return; end if;
 if not exists(select 1 from public.returns_line_actions a where a.case_id=dossier) then return; end if;
 if exists(select 1 from jsonb_array_elements(current_case.document->'lines') l where coalesce(l.value->>'received_quantity','')='' or public.returns_unqualified(dossier,l.value)>0) then return; end if;
 update public.returns_cases c set document=jsonb_set(c.document,'{status}','"closed"'),version=c.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp()
  where c.id=dossier and c.document->>'status'='received';
 if found then
  insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source)
   values(gen_random_uuid(),dossier,current_case.workspace_id,null,'status_changed','received','closed','Clôture automatique : toutes les pièces sont traitées','shared_access');
 end if;
end;$repclick_fn$;

create or replace function public.returns_line_actions_done() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin perform public.returns_close_if_done(new.case_id); return null; end;$repclick_fn$;
drop trigger if exists returns_line_actions_done on public.returns_line_actions;
create trigger returns_line_actions_done after insert or update of status on public.returns_line_actions for each row execute function public.returns_line_actions_done();

-- 6. Is this file applied? The page asks before offering the role screens.
create or replace function public.shared_returns_flow(session_token text default null) returns integer language plpgsql stable security definer set search_path='' as $repclick_fn$
begin perform public.shared_shop(session_token); return 1; end;$repclick_fn$;

-- 7. Organise a collection: who, when, and the type. Only before the parts are taken.
create or replace function public.shared_return_plan(case_id uuid,collector text,pickup_at text,case_type text,expected_version integer,actor_label text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; saved public.returns_cases; who text:=coalesce(collector,''); slot text:=coalesce(pickup_at,''); before_who text;
begin
 if case_id is null or expected_version is null or public.returns_collector_label(who) is null or coalesce(case_type,'') not in ('return','warranty')
  or slot !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' then raise exception 'Invalid plan' using errcode='22023'; end if;
 begin perform (replace(slot,'T',' ')||':00')::timestamp; exception when others then raise exception 'Invalid plan' using errcode='22023'; end;
 select * into dossier from public.returns_cases c where c.id=shared_return_plan.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status'<>'requested' then raise exception 'Collection is frozen once taken' using errcode='22023'; end if;
 if dossier.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
 before_who:=coalesce(dossier.document->>'collector','');
 update public.returns_cases c set document=c.document||jsonb_build_object('collector',who,'pickup_at',slot,'type',case_type),version=c.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp()
  where c.id=dossier.id returning * into saved;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,from_collector,to_collector,actor_label)
  values(gen_random_uuid(),saved.id,shop,null,case when before_who<>who then 'assigned' else 'updated' end,'requested','requested','Passage prévu : '||replace(slot,'T',' à '),'shared_access',
   case when before_who<>who then nullif(before_who,'') end,case when before_who<>who then who end,public.returns_actor_label(actor_label));
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;

-- 8. « Pris »: the driver took the parts. Nothing else changes.
create or replace function public.shared_return_taken(case_id uuid,expected_version integer,actor_label text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; saved public.returns_cases;
begin
 select * into dossier from public.returns_cases c where c.id=shared_return_taken.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status'<>'requested' then raise exception 'Already taken' using errcode='22023'; end if;
 if expected_version is not null and dossier.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
 if coalesce(dossier.document->>'collector','')='' then raise exception 'Collector required' using errcode='22023'; end if;
 update public.returns_cases c set document=jsonb_set(c.document,'{status}','"collected"'),version=c.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp()
  where c.id=dossier.id returning * into saved;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,actor_label)
  values(gen_random_uuid(),saved.id,shop,null,'status_changed','requested','collected','Pris par le livreur','shared_access',public.returns_actor_label(actor_label));
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;

-- 9. An older dossier of another type gets one of the two, before any of its parts is qualified.
create or replace function public.shared_return_set_type(case_id uuid,case_type text,actor_label text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; saved public.returns_cases;
begin
 if coalesce(case_type,'') not in ('return','warranty') then raise exception 'Type required' using errcode='22023'; end if;
 select * into dossier from public.returns_cases c where c.id=shared_return_set_type.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status' not in ('requested','collected','received') or exists(select 1 from public.returns_line_actions a where a.case_id=dossier.id and a.kind in ('customer_credit','supplier_return') and a.status<>'cancelled')
  then raise exception 'Type is fixed once a part is routed' using errcode='22023'; end if;
 if dossier.document->>'type'=case_type then return query select dossier.id,dossier.document,dossier.version,dossier.created_at,dossier.updated_at; return; end if;
 update public.returns_cases c set document=jsonb_set(c.document,'{type}',to_jsonb(case_type)),version=c.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp()
  where c.id=dossier.id returning * into saved;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,actor_label)
  values(gen_random_uuid(),saved.id,shop,null,'updated',saved.document->>'status',saved.document->>'status','Type : '||case when case_type='warranty' then 'Garantie' else 'Retour client' end,'shared_access',public.returns_actor_label(actor_label));
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;

-- 10. Reading only: the line that a scanned code designates, exactly. PT404 = not a part of this dossier.
create or replace function public.shared_return_identify(case_id uuid,code text,session_token text default null)
returns table(line_id text,reference text,description text,quantity integer,received integer)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; scanned text:=btrim(coalesce(code,'')); found_lines jsonb[]; line jsonb; got integer;
begin
 if case_id is null or length(scanned) not between 1 and 256 or scanned ~ '[[:cntrl:]]' then raise exception 'Invalid code' using errcode='22023'; end if;
 select * into dossier from public.returns_cases c where c.id=shared_return_identify.case_id and c.workspace_id=shop;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status'<>'collected' then raise exception 'Dossier not in reception' using errcode='22023'; end if;
 found_lines:=array(select m from public.returns_matching_lines(shop,dossier.document,scanned) m);
 if cardinality(found_lines)=0 then raise exception 'Not a part of this dossier' using errcode='PT404'; end if;
 if cardinality(found_lines)>1 then raise exception 'Several lines match this code' using errcode='22023'; end if;
 line:=found_lines[1]; got:=case when coalesce(line->>'received_quantity','') ~ '^[0-9]{1,6}$' then (line->>'received_quantity')::integer else 0 end;
 if got>=(line->>'quantity')::integer then raise exception 'Line already complete' using errcode='22023'; end if;
 return query select line->>'id',line->>'reference',coalesce(line->>'description',''),(line->>'quantity')::integer,got;
end;$repclick_fn$;

-- 11. One scanned unit, received and qualified in the same step. The code is checked again here.
create or replace function public.shared_return_receive_part(case_id uuid,code text,part_state text,reason text default '',actor_label text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz,line_id text,action_id uuid)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; scanned text:=btrim(coalesce(code,'')); words text:=regexp_replace(btrim(coalesce(reason,'')),'\s+',' ','g');
 found_lines jsonb[]; line jsonb; got integer; saved public.returns_cases; routed public.returns_line_actions;
begin
 if case_id is null or length(scanned) not between 1 and 256 or scanned ~ '[[:cntrl:]]' then raise exception 'Invalid code' using errcode='22023'; end if;
 if coalesce(part_state,'') not in ('ok','damaged') or length(words)>200 or words ~ '[[:cntrl:]]' then raise exception 'Invalid qualification' using errcode='22023'; end if;
 if part_state='damaged' and words='' then raise exception 'Reason required' using errcode='22023'; end if;
 select * into dossier from public.returns_cases c where c.id=shared_return_receive_part.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status'<>'collected' then raise exception 'Dossier not in reception' using errcode='22023'; end if;
 if part_state='ok' and dossier.document->>'type' not in ('return','warranty') then raise exception 'Type required' using errcode='22023'; end if;
 found_lines:=array(select m from public.returns_matching_lines(shop,dossier.document,scanned) m);
 if cardinality(found_lines)=0 then raise exception 'Not a part of this dossier' using errcode='PT404'; end if;
 if cardinality(found_lines)>1 then raise exception 'Several lines match this code' using errcode='22023'; end if;
 line:=found_lines[1]; got:=case when coalesce(line->>'received_quantity','') ~ '^[0-9]{1,6}$' then (line->>'received_quantity')::integer else 0 end;
 if got>=(line->>'quantity')::integer then raise exception 'Line already complete' using errcode='22023'; end if;
 saved:=public.returns_set_received(dossier,line->>'id',got+1,null,'Scan : '||scanned||' · '||case when part_state='damaged' then 'Abîmée : '||words else 'Conforme' end,actor_label);
 routed:=public.returns_route_unit(saved,line->>'id',part_state,case when part_state='damaged' then words else '' end,actor_label);
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at,line->>'id',routed.id;
end;$repclick_fn$;

-- 12. The same qualification for a unit that was received before this file, or whose qualification was cancelled.
create or replace function public.shared_return_qualify(case_id uuid,line_id text,part_state text,reason text default '',actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; line jsonb; words text:=regexp_replace(btrim(coalesce(reason,'')),'\s+',' ','g');
begin
 if case_id is null or coalesce(line_id,'')='' or coalesce(part_state,'') not in ('ok','damaged') or length(words)>200 or words ~ '[[:cntrl:]]' then raise exception 'Invalid qualification' using errcode='22023'; end if;
 if part_state='damaged' and words='' then raise exception 'Reason required' using errcode='22023'; end if;
 select * into dossier from public.returns_cases c where c.id=shared_return_qualify.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status' not in ('collected','received','supplier_pending','credited') then raise exception 'Dossier not in reception' using errcode='22023'; end if;
 select l.value into line from jsonb_array_elements(dossier.document->'lines') l where l.value->>'id'=shared_return_qualify.line_id;
 if line is null then raise exception 'Unknown line' using errcode='22023'; end if;
 if public.returns_unqualified(dossier.id,line)<1 then raise exception 'Nothing to qualify' using errcode='22023'; end if;
 return public.returns_route_unit(dossier,line->>'id',part_state,case when part_state='damaged' then words else '' end,actor_label);
end;$repclick_fn$;

-- 13. End of the reception. Every line that is not fully received must be named by the agent:
--     nothing is declared missing by default, and nothing is left undeclared.
create or replace function public.shared_return_finish(case_id uuid,missing_lines text[],actor_label text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; saved public.returns_cases; expected text[]; declared text[]; doc jsonb; line jsonb; gap integer; got integer; missing public.returns_line_actions;
begin
 select * into dossier from public.returns_cases c where c.id=shared_return_finish.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status'<>'collected' then raise exception 'Dossier not in reception' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(dossier.document->'lines') l where public.returns_unqualified(dossier.id,l.value)>0) then raise exception 'Parts not qualified' using errcode='22023'; end if;
 expected:=array(select l.value->>'id' from jsonb_array_elements(dossier.document->'lines') l
  where (case when coalesce(l.value->>'received_quantity','') ~ '^[0-9]{1,6}$' then (l.value->>'received_quantity')::integer else 0 end)<(l.value->>'quantity')::integer order by 1);
 declared:=array(select distinct m from unnest(coalesce(missing_lines,'{}'::text[])) m order by 1);
 if expected is distinct from declared then raise exception 'Missing parts must be declared' using errcode='22023'; end if;
 select jsonb_set(jsonb_set(dossier.document,'{status}','"received"'),'{lines}',jsonb_agg(case when l.value->>'id'=any(expected) then
   l.value||jsonb_build_object('received_quantity',case when coalesce(l.value->>'received_quantity','') ~ '^[0-9]{1,6}$' then (l.value->>'received_quantity')::integer else 0 end,
    'reason',btrim(coalesce(l.value->>'reason','')||' · Manquante : '||((l.value->>'quantity')::integer-case when coalesce(l.value->>'received_quantity','') ~ '^[0-9]{1,6}$' then (l.value->>'received_quantity')::integer else 0 end)||' sur '||(l.value->>'quantity'),' ·'))
   else l.value end order by l.ordinality))
  into doc from jsonb_array_elements(dossier.document->'lines') with ordinality l;
 update public.returns_cases c set document=doc,version=c.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp() where c.id=dossier.id returning * into saved;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,actor_label)
  values(gen_random_uuid(),saved.id,shop,null,'status_changed','collected','received','Réception terminée','shared_access',public.returns_actor_label(actor_label));
 for line in select l.value from jsonb_array_elements(dossier.document->'lines') l where l.value->>'id'=any(expected) loop
  got:=case when coalesce(line->>'received_quantity','') ~ '^[0-9]{1,6}$' then (line->>'received_quantity')::integer else 0 end; gap:=(line->>'quantity')::integer-got;
  insert into public.returns_line_actions(id,workspace_id,case_id,line_id,kind,status,quantity,comment)
   values(gen_random_uuid(),shop,saved.id,line->>'id','missing','open',gap,'Déclarée manquante à la réception') returning * into missing;
  perform public.returns_action_log(missing,null,'Manquante : '||gap||' sur '||(line->>'quantity'),actor_label);
 end loop;
 perform public.returns_close_if_done(saved.id);
 select * into saved from public.returns_cases c where c.id=saved.id;
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$repclick_fn$;

-- 14. The credit is issued: its number is given now, by the person who issues it.
create or replace function public.shared_return_credit_issue(action_id uuid,document_number text,expected_version integer default null,actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_line_actions; saved public.returns_line_actions; number text:=regexp_replace(btrim(coalesce(document_number,'')),'\s+',' ','g');
begin
 if length(number) not between 1 and 60 or number ~ '[[:cntrl:]]' then raise exception 'Document number required' using errcode='22023'; end if;
 select * into previous from public.returns_line_actions a where a.id=action_id and a.workspace_id=shop for update;
 if not found then raise exception 'Unknown decision' using errcode='22023'; end if;
 if expected_version is not null and previous.version<>expected_version then raise exception 'Decision changed' using errcode='PT409'; end if;
 if previous.kind<>'customer_credit' or previous.status<>'to_do' then raise exception 'Invalid step' using errcode='22023'; end if;
 update public.returns_line_actions a set status='issued',document_number=number,version=a.version+1,updated_at=clock_timestamp() where a.id=previous.id returning * into saved;
 perform public.returns_action_log(saved,previous.status,'Avoir : '||number,actor_label);
 return saved;
end;$repclick_fn$;

-- 15. The supplier of a warranty part, while it is not in a carton.
create or replace function public.shared_return_action_supplier(action_id uuid,supplier_id uuid,expected_version integer default null,actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_line_actions; saved public.returns_line_actions; partner public.gestion_partners;
begin
 select * into partner from public.gestion_partners p where p.id=shared_return_action_supplier.supplier_id and p.workspace_id=shop and p.kind='supplier';
 if not found then raise exception 'Supplier required' using errcode='22023'; end if;
 select * into previous from public.returns_line_actions a where a.id=action_id and a.workspace_id=shop for update;
 if not found then raise exception 'Unknown decision' using errcode='22023'; end if;
 if expected_version is not null and previous.version<>expected_version then raise exception 'Decision changed' using errcode='PT409'; end if;
 if previous.kind<>'supplier_return' or previous.status<>'to_send' or previous.packed_quantity<>0 or previous.shipment_id is not null then raise exception 'Invalid step' using errcode='22023'; end if;
 update public.returns_line_actions a set supplier_id=partner.id,supplier_name=partner.name,version=a.version+1,updated_at=clock_timestamp() where a.id=previous.id returning * into saved;
 perform public.returns_action_log(saved,previous.status,'Fournisseur : '||partner.name,actor_label);
 return saved;
end;$repclick_fn$;

-- 16. A missing part is settled with the garage (or an older « pending » decision is taken).
create or replace function public.shared_return_gap_resolve(action_id uuid,note text default '',expected_version integer default null,actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_line_actions; saved public.returns_line_actions; words text:=regexp_replace(btrim(coalesce(note,'')),'\s+',' ','g');
begin
 if length(words)>500 or words ~ '[[:cntrl:]]' then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into previous from public.returns_line_actions a where a.id=action_id and a.workspace_id=shop for update;
 if not found then raise exception 'Unknown decision' using errcode='22023'; end if;
 if expected_version is not null and previous.version<>expected_version then raise exception 'Decision changed' using errcode='PT409'; end if;
 if previous.kind not in ('missing','pending') or previous.status<>'open' then raise exception 'Invalid step' using errcode='22023'; end if;
 update public.returns_line_actions a set status='resolved',version=a.version+1,updated_at=clock_timestamp() where a.id=previous.id returning * into saved;
 perform public.returns_action_log(saved,previous.status,words,actor_label);
 return saved;
end;$repclick_fn$;

-- 17. The public request of a garage, with its type. The former function does all the checks and
--     the writing; only the type of a request created by this very call is set.
create or replace function public.returns_public_submit_typed(shop_id uuid,request_id uuid,garage_id uuid,garage_name text,pickup_location text,case_lines jsonb,case_type text)
returns uuid language plpgsql security definer set search_path='' as $repclick_fn$
declare known boolean; answer uuid;
begin
 if coalesce(case_type,'') not in ('return','warranty') then raise exception 'Invalid type' using errcode='22023'; end if;
 known:=exists(select 1 from public.returns_public_requests r where r.id=request_id and r.workspace_id=shop_id);
 answer:=public.returns_public_submit(shop_id,request_id,garage_id,garage_name,pickup_location,case_lines);
 if not known and case_type<>'return' then
  update public.returns_cases c set document=jsonb_set(c.document,'{type}',to_jsonb(case_type)) where c.id=answer and c.workspace_id=shop_id and c.version=1 and c.document->>'source'='public_portal' and c.document->>'status'='requested';
 end if;
 return answer;
end;$repclick_fn$;

-- 18. Rights: internal helpers closed; session functions open as the other shared functions; the
--     typed public request open as the public request.
revoke all on function public.returns_unqualified(uuid,jsonb),public.returns_route_unit(public.returns_cases,text,text,text,text),public.returns_close_if_done(uuid),public.returns_line_actions_done(),public.returns_cases_guard() from public,anon,authenticated;
revoke all on function public.shared_returns_flow(text),public.shared_return_plan(uuid,text,text,text,integer,text,text),public.shared_return_taken(uuid,integer,text,text),public.shared_return_set_type(uuid,text,text,text),
 public.shared_return_identify(uuid,text,text),public.shared_return_receive_part(uuid,text,text,text,text,text),public.shared_return_qualify(uuid,text,text,text,text,text),public.shared_return_finish(uuid,text[],text,text),
 public.shared_return_credit_issue(uuid,text,integer,text,text),public.shared_return_action_supplier(uuid,uuid,integer,text,text),public.shared_return_gap_resolve(uuid,text,integer,text,text),
 public.returns_public_submit_typed(uuid,uuid,uuid,text,text,jsonb,text) from public;
grant execute on function public.shared_returns_flow(text),public.shared_return_plan(uuid,text,text,text,integer,text,text),public.shared_return_taken(uuid,integer,text,text),public.shared_return_set_type(uuid,text,text,text),
 public.shared_return_identify(uuid,text,text),public.shared_return_receive_part(uuid,text,text,text,text,text),public.shared_return_qualify(uuid,text,text,text,text,text),public.shared_return_finish(uuid,text[],text,text),
 public.shared_return_credit_issue(uuid,text,integer,text,text),public.shared_return_action_supplier(uuid,uuid,integer,text,text),public.shared_return_gap_resolve(uuid,text,integer,text,text),
 public.returns_public_submit_typed(uuid,uuid,uuid,text,text,jsonb,text) to anon,authenticated;
