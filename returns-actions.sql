-- Retours et garanties : suites par pièce (abîmée, retour fournisseur, avoir client, attente de décision).
-- Prerequisite: returns-collectors.sql applied. Apply by hand, as postgres, in the Supabase SQL Editor
-- (whole file, once), then run returns-actions.test.sql. Safe to run again: every statement is idempotent.
-- No BEGIN/COMMIT, no anonymous dollar tag.
--
-- One source of truth: public.returns_line_actions. One row = one decision taken for a received line
-- of a dossier. A line may carry several decisions (a supplier return AND a customer credit); none
-- replaces the reception, none replaces another. « Pièces abîmées », the supplier queues, « Avoirs à
-- faire », the cartons and « En attente » are filters on this table: no line is ever copied.
--
--   kind             states (→ = allowed step)                                   required at creation
--   damaged          recorded                                                    a comment
--   supplier_return  to_send → packed (exact rescan only) → sent                 a supplier of the shop
--   customer_credit  to_do → issued → restocked | closed_no_stock                a BL / invoice / order number
--   pending          open → resolved                                             a comment
--   any state that is not final → cancelled, with a reason. Nothing is deleted.
--
-- Existing dossiers are not rewritten: a received line without decision simply appears as « à décider ».
-- No stock quantity is changed by « restocked »: it records where the part went.
-- Nothing is opened to the public portal: every function below requires the logistics session.

-- 1. Cartons sent to a supplier. Their content is the actions that point to them.
create table if not exists public.returns_shipments (
 id uuid primary key,
 workspace_id uuid not null references public.scanette_workspaces(id),
 supplier_id uuid not null references public.gestion_partners(id),
 supplier_name text not null check(length(supplier_name) between 1 and 180),
 status text not null default 'open' check(status in ('open','sent')),
 note text not null default '' check(length(note)<=500),
 opened_by text not null default '' check(length(opened_by)<=60),
 created_at timestamptz not null default clock_timestamp(),
 sent_at timestamptz
);
create unique index if not exists returns_shipments_one_open on public.returns_shipments(workspace_id,supplier_id) where status='open';

-- 2. The decisions.
create table if not exists public.returns_line_actions (
 id uuid primary key,
 workspace_id uuid not null references public.scanette_workspaces(id),
 case_id uuid not null references public.returns_cases(id),
 line_id text not null check(length(line_id) between 1 and 80),
 kind text not null check(kind in ('damaged','supplier_return','customer_credit','pending')),
 status text not null,
 quantity integer not null check(quantity between 1 and 100000),
 packed_quantity integer not null default 0,
 supplier_id uuid references public.gestion_partners(id),
 supplier_name text not null default '' check(length(supplier_name)<=180),
 document_number text not null default '' check(length(document_number)<=60),
 comment text not null default '' check(length(comment)<=500),
 shipment_id uuid references public.returns_shipments(id),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 constraint returns_line_actions_state check(
     (kind='damaged' and status in ('recorded','cancelled'))
  or (kind='supplier_return' and status in ('to_send','packed','sent','cancelled'))
  or (kind='customer_credit' and status in ('to_do','issued','restocked','closed_no_stock','cancelled'))
  or (kind='pending' and status in ('open','resolved','cancelled'))),
 constraint returns_line_actions_packed check(packed_quantity between 0 and quantity and (kind='supplier_return' or packed_quantity=0)),
 constraint returns_line_actions_supplier check((kind='supplier_return')=(supplier_id is not null)),
 constraint returns_line_actions_carton check(shipment_id is null or kind='supplier_return')
);
create index if not exists returns_line_actions_case on public.returns_line_actions(case_id);
create index if not exists returns_line_actions_queue on public.returns_line_actions(workspace_id,kind,status);

alter table public.returns_shipments enable row level security;
alter table public.returns_line_actions enable row level security;
revoke all on public.returns_shipments,public.returns_line_actions from public,anon,authenticated;

-- 3. One journal per dossier: decisions are written next to the reception and the assignments.
alter table public.returns_case_events add column if not exists action_id uuid;
alter table public.returns_case_events add column if not exists line_id text;
alter table public.returns_case_events add column if not exists action_kind text;
alter table public.returns_case_events add column if not exists action_from text;
alter table public.returns_case_events add column if not exists action_to text;
alter table public.returns_case_events add column if not exists actor_label text;
alter table public.returns_case_events drop constraint if exists returns_case_events_event_kind_check;
alter table public.returns_case_events add constraint returns_case_events_event_kind_check check(event_kind in ('created','updated','status_changed','assigned','action'));

-- The name the agent typed for himself: the shared access has no personal account, so this is a
-- declared author, not an authenticated one.
create or replace function public.returns_actor_label(value text) returns text language sql immutable set search_path='' as $repclick_fn$
 select left(regexp_replace(btrim(regexp_replace(coalesce(value,''),'[[:cntrl:]]',' ','g')),'\s+',' ','g'),60);
$repclick_fn$;

create or replace function public.returns_action_log(action public.returns_line_actions,before_state text,note text,actor text) returns void language plpgsql set search_path='' as $repclick_fn$
begin
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source,action_id,line_id,action_kind,action_from,action_to,actor_label)
  select gen_random_uuid(),c.id,c.workspace_id,null,'action',c.document->>'status',c.document->>'status',left(coalesce(note,''),1000),'shared_access',action.id,action.line_id,action.kind,before_state,action.status,public.returns_actor_label(actor)
  from public.returns_cases c where c.id=action.case_id;
end;$repclick_fn$;

-- 4. A dossier is not closed or cancelled while one of its decisions is still running.
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 if tg_op='UPDATE' and new.document->>'status' in ('closed','cancelled') and old.document->>'status' is distinct from new.document->>'status'
  and exists(select 1 from public.returns_line_actions a where a.case_id=new.id and a.status in ('to_send','packed','to_do','issued','open')) then raise exception 'Open decisions remain' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;

-- 5. Reading: every decision and every carton of the shop. The page joins them to the dossiers it already has.
create or replace function public.shared_return_actions(session_token text default null)
returns setof public.returns_line_actions language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin return query select a.* from public.returns_line_actions a where a.workspace_id=shop order by a.created_at,a.id limit 5000; end;$repclick_fn$;

create or replace function public.shared_return_shipments(session_token text default null)
returns setof public.returns_shipments language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin return query select s.* from public.returns_shipments s where s.workspace_id=shop order by s.created_at desc,s.id limit 500; end;$repclick_fn$;

-- 6. A new decision for a received line.
create or replace function public.shared_return_action_add(case_id uuid,line_id text,action_kind text,quantity integer,supplier_id uuid default null,document_number text default '',comment text default '',actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); dossier public.returns_cases; line jsonb; received integer; used integer; saved public.returns_line_actions;
 number text:=regexp_replace(btrim(coalesce(document_number,'')),'\s+',' ','g'); words text:=regexp_replace(btrim(coalesce(comment,'')),'\s+',' ','g'); partner public.gestion_partners; first_state text;
begin
 if case_id is null or coalesce(line_id,'')='' or quantity is null or coalesce(action_kind,'') not in ('damaged','supplier_return','customer_credit','pending')
  or length(number)>60 or number ~ '[[:cntrl:]]' or length(words)>500 or words ~ '[[:cntrl:]]' then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into dossier from public.returns_cases c where c.id=shared_return_action_add.case_id and c.workspace_id=shop for update;
 if not found then raise exception 'Unknown dossier' using errcode='22023'; end if;
 if dossier.document->>'status' not in ('received','supplier_pending','credited') then raise exception 'Dossier not received' using errcode='22023'; end if;
 select l.value into line from jsonb_array_elements(dossier.document->'lines') l where l.value->>'id'=shared_return_action_add.line_id;
 if line is null then raise exception 'Unknown line' using errcode='22023'; end if;
 received:=case when coalesce(line->>'received_quantity','') ~ '^[0-9]{1,6}$' then (line->>'received_quantity')::integer else 0 end;
 select coalesce(sum(a.quantity),0) into used from public.returns_line_actions a where a.case_id=dossier.id and a.line_id=shared_return_action_add.line_id and a.kind=action_kind and a.status<>'cancelled';
 if quantity<1 or quantity>received-used then raise exception 'Quantity exceeds what was received' using errcode='22023'; end if;
 if action_kind='supplier_return' then
  select * into partner from public.gestion_partners p where p.id=shared_return_action_add.supplier_id and p.workspace_id=shop and p.kind='supplier';
  if not found then raise exception 'Supplier required' using errcode='22023'; end if;
  first_state:='to_send';
 elsif shared_return_action_add.supplier_id is not null then raise exception 'Invalid decision' using errcode='22023';
 elsif action_kind='customer_credit' then
  if number='' then raise exception 'Document number required' using errcode='22023'; end if; first_state:='to_do';
 elsif action_kind='damaged' then
  if words='' then raise exception 'Comment required' using errcode='22023'; end if; first_state:='recorded';
 else
  if words='' then raise exception 'Comment required' using errcode='22023'; end if; first_state:='open';
 end if;
 insert into public.returns_line_actions(id,workspace_id,case_id,line_id,kind,status,quantity,supplier_id,supplier_name,document_number,comment)
  values(gen_random_uuid(),shop,dossier.id,shared_return_action_add.line_id,action_kind,first_state,quantity,partner.id,coalesce(partner.name,''),case when action_kind='customer_credit' then number else '' end,words) returning * into saved;
 perform public.returns_action_log(saved,null,words,actor_label);
 return saved;
end;$repclick_fn$;

-- 7. A step of a decision. « packed » and « sent » are never set here: only the rescan and the
--    sending of the carton do it.
create or replace function public.shared_return_action_move(action_id uuid,to_status text,note text default '',expected_version integer default null,actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_line_actions; saved public.returns_line_actions; words text:=regexp_replace(btrim(coalesce(note,'')),'\s+',' ','g');
begin
 if length(words)>500 or words ~ '[[:cntrl:]]' then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into previous from public.returns_line_actions a where a.id=action_id and a.workspace_id=shop for update;
 if not found then raise exception 'Unknown decision' using errcode='22023'; end if;
 if expected_version is not null and previous.version<>expected_version then raise exception 'Decision changed' using errcode='PT409'; end if;
 if not ((previous.kind='customer_credit' and previous.status='to_do' and to_status='issued')
      or (previous.kind='customer_credit' and previous.status='issued' and to_status in ('restocked','closed_no_stock'))
      or (previous.kind='pending' and previous.status='open' and to_status='resolved')
      or (previous.kind='supplier_return' and previous.status='packed' and to_status='to_send')
      or (to_status='cancelled' and previous.status in ('recorded','to_send','to_do','issued','open'))) then raise exception 'Invalid step' using errcode='22023'; end if;
 if to_status='cancelled' and words='' then raise exception 'Reason required' using errcode='22023'; end if;
 if previous.kind='supplier_return' and previous.shipment_id is not null then
  -- Out of the carton (or cancelled while partly scanned): only while the carton is still open.
  if not exists(select 1 from public.returns_shipments s where s.id=previous.shipment_id and s.status='open') then raise exception 'Carton already sent' using errcode='22023'; end if;
 end if;
 update public.returns_line_actions a set status=to_status,version=a.version+1,updated_at=clock_timestamp(),
  packed_quantity=case when a.kind='supplier_return' then 0 else a.packed_quantity end,shipment_id=case when a.kind='supplier_return' then null else a.shipment_id end
  where a.id=previous.id returning * into saved;
 perform public.returns_action_log(saved,previous.status,words,actor_label);
 return saved;
end;$repclick_fn$;

-- 8. The carton of a supplier: one open carton at a time, opened on demand.
create or replace function public.shared_return_shipment_open(supplier_id uuid,actor_label text default '',session_token text default null)
returns public.returns_shipments language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); partner public.gestion_partners; carton public.returns_shipments;
begin
 select * into partner from public.gestion_partners p where p.id=shared_return_shipment_open.supplier_id and p.workspace_id=shop and p.kind='supplier';
 if not found then raise exception 'Supplier required' using errcode='22023'; end if;
 perform 1 from public.scanette_workspaces w where w.id=shop for update;
 select * into carton from public.returns_shipments s where s.workspace_id=shop and s.supplier_id=partner.id and s.status='open';
 if not found then
  insert into public.returns_shipments(id,workspace_id,supplier_id,supplier_name,opened_by) values(gen_random_uuid(),shop,partner.id,partner.name,public.returns_actor_label(actor_label)) returning * into carton;
 end if;
 return carton;
end;$repclick_fn$;

-- 9. Rescan of one part into the carton. The code must be exactly the reference of a waiting line of
--    this supplier, or exactly a barcode of its catalogue record. One scan = one unit. PT404 = no
--    waiting part answers this code: nothing is added, nothing is guessed.
create or replace function public.shared_return_pack(shipment_id uuid,code text,actor_label text default '',session_token text default null)
returns public.returns_line_actions language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); carton public.returns_shipments; scanned text:=btrim(coalesce(code,'')); chosen public.returns_line_actions; saved public.returns_line_actions;
begin
 if length(scanned) not between 1 and 256 or scanned ~ '[[:cntrl:]]' then raise exception 'Invalid code' using errcode='22023'; end if;
 select * into carton from public.returns_shipments s where s.id=shared_return_pack.shipment_id and s.workspace_id=shop for update;
 if not found or carton.status<>'open' then raise exception 'Carton closed' using errcode='22023'; end if;
 select a.* into chosen from public.returns_line_actions a
  join public.returns_cases c on c.id=a.case_id
  cross join lateral (select l.value from jsonb_array_elements(c.document->'lines') l where l.value->>'id'=a.line_id limit 1) line
  where a.workspace_id=shop and a.kind='supplier_return' and a.status='to_send' and a.supplier_id=carton.supplier_id and (a.shipment_id is null or a.shipment_id=carton.id)
   and (line.value->>'reference'=scanned or line.value->>'reference'=upper(scanned)
     or exists(select 1 from public.scanette_products p where p.workspace_id=shop and (p.internal_barcode=scanned or p.manufacturer_barcode=scanned)
               and (p.id::text=line.value->>'product_id' or p.reference=line.value->>'reference')))
  order by a.packed_quantity desc,a.created_at,a.id limit 1 for update of a;
 if not found then raise exception 'No waiting part for this code' using errcode='PT404'; end if;
 update public.returns_line_actions a set packed_quantity=a.packed_quantity+1,shipment_id=carton.id,status=case when a.packed_quantity+1=a.quantity then 'packed' else 'to_send' end,version=a.version+1,updated_at=clock_timestamp()
  where a.id=chosen.id returning * into saved;
 perform public.returns_action_log(saved,chosen.status,'Scan carton : '||saved.packed_quantity||' / '||saved.quantity,actor_label);
 return saved;
end;$repclick_fn$;

-- 10. The carton leaves: every line in it must be complete.
create or replace function public.shared_return_shipment_send(shipment_id uuid,note text default '',actor_label text default '',session_token text default null)
returns public.returns_shipments language plpgsql security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token); carton public.returns_shipments; words text:=regexp_replace(btrim(coalesce(note,'')),'\s+',' ','g'); action public.returns_line_actions;
begin
 if length(words)>500 or words ~ '[[:cntrl:]]' then raise exception 'Invalid note' using errcode='22023'; end if;
 select * into carton from public.returns_shipments s where s.id=shared_return_shipment_send.shipment_id and s.workspace_id=shop for update;
 if not found or carton.status<>'open' then raise exception 'Carton closed' using errcode='22023'; end if;
 if exists(select 1 from public.returns_line_actions a where a.shipment_id=carton.id and a.status='to_send') then raise exception 'A line is partly scanned' using errcode='22023'; end if;
 if not exists(select 1 from public.returns_line_actions a where a.shipment_id=carton.id and a.status='packed') then raise exception 'Empty carton' using errcode='22023'; end if;
 for action in update public.returns_line_actions a set status='sent',version=a.version+1,updated_at=clock_timestamp() where a.shipment_id=carton.id and a.status='packed' returning * loop
  perform public.returns_action_log(action,'packed',words,actor_label);
 end loop;
 update public.returns_shipments s set status='sent',sent_at=clock_timestamp(),note=words where s.id=carton.id returning * into carton;
 return carton;
end;$repclick_fn$;

-- 11. Journal of a dossier, with the decisions. More columns, so the function is recreated.
drop function if exists public.shared_return_events(uuid,text);
create function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text,from_collector text,to_collector text,line_id text,action_kind text,action_from text,action_to text,actor_label text)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source,e.from_collector,e.to_collector,e.line_id,e.action_kind,e.action_from,e.action_to,e.actor_label from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at,e.event_kind desc limit 500;
end;$repclick_fn$;

-- 12. Rights: internal helpers closed; the session functions open as the other shared functions.
revoke all on function public.returns_actor_label(text),public.returns_action_log(public.returns_line_actions,text,text,text),public.returns_cases_guard() from public,anon,authenticated;
revoke all on function public.shared_return_actions(text),public.shared_return_shipments(text),public.shared_return_action_add(uuid,text,text,integer,uuid,text,text,text,text),
 public.shared_return_action_move(uuid,text,text,integer,text,text),public.shared_return_shipment_open(uuid,text,text),public.shared_return_pack(uuid,text,text,text),
 public.shared_return_shipment_send(uuid,text,text,text),public.shared_return_events(uuid,text) from public;
grant execute on function public.shared_return_actions(text),public.shared_return_shipments(text),public.shared_return_action_add(uuid,text,text,integer,uuid,text,text,text,text),
 public.shared_return_action_move(uuid,text,text,integer,text,text),public.shared_return_shipment_open(uuid,text,text),public.shared_return_pack(uuid,text,text,text),
 public.shared_return_shipment_send(uuid,text,text,text),public.shared_return_events(uuid,text) to anon,authenticated;
