-- Alcorb Logistique: shared, auditable returns and warranty workflow.
-- Apply once in Supabase SQL Editor as postgres, then run returns-workflow.test.sql.
begin;

create table public.returns_cases (
 id uuid primary key,
 workspace_id uuid not null references public.scanette_workspaces(id),
 document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=150000),
 version integer not null check(version>0),
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index returns_cases_workspace_updated on public.returns_cases(workspace_id,updated_at desc);
create index returns_cases_workspace_status on public.returns_cases(workspace_id,(document->>'status'));

create table public.returns_case_events (
 id uuid primary key,
 case_id uuid not null references public.returns_cases(id),
 workspace_id uuid not null references public.scanette_workspaces(id),
 actor_id uuid not null references auth.users(id),
 event_kind text not null check(event_kind in ('created','updated','status_changed')),
 from_status text, to_status text not null,
 note text not null default '' check(length(note)<=1000),
 created_at timestamptz not null default clock_timestamp()
);
create index returns_case_events_case on public.returns_case_events(case_id,created_at);

alter table public.returns_cases enable row level security;
alter table public.returns_case_events enable row level security;
revoke all on public.returns_cases,public.returns_case_events from public,anon,authenticated;
grant select on public.returns_cases,public.returns_case_events to authenticated;
create policy returns_cases_member_read on public.returns_cases for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=returns_cases.workspace_id and m.user_id=(select auth.uid())));
create policy returns_events_member_read on public.returns_case_events for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=returns_case_events.workspace_id and m.user_id=(select auth.uid())));

create function public.returns_save_case(shop_id uuid,case_id uuid,expected_version integer,case_document jsonb,event_note text default '')
returns public.returns_cases language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.returns_cases%rowtype; saved public.returns_cases; line jsonb; client_id uuid; supplier_id uuid; before_status text; after_status text; event_type text;
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501'; end if;
 if case_id is null or expected_version is null or expected_version<0 or jsonb_typeof(case_document) is distinct from 'object' or octet_length(case_document::text)>150000 or length(coalesce(event_note,''))>1000 then raise exception 'Invalid request'; end if;
 if coalesce(case_document->>'type','') not in ('return','warranty','mixed') or coalesce(case_document->>'status','') not in ('requested','collected','received','supplier_ready','sent','credit_pending','credited','cancelled') or length(btrim(coalesce(case_document->>'client_name',''))) not between 1 and 180 or length(coalesce(case_document->>'supplier_name',''))>180 or jsonb_typeof(case_document->'lines') is distinct from 'array' or jsonb_array_length(case_document->'lines') not between 1 and 200 then raise exception 'Invalid return case'; end if;
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
end;$$;
revoke all on function public.returns_save_case(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.returns_save_case(uuid,uuid,integer,jsonb,text) to authenticated;

-- Live refreshes are advisory only: every write is still version checked by the RPC.
alter publication supabase_realtime add table public.returns_cases;
commit;
