begin;
create table public.logistics_sessions (
 id uuid primary key,workspace_id uuid not null references public.scanette_workspaces(id),
 kind text not null check(kind in ('receipt','inventory')),content jsonb not null,
 version integer not null,created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default clock_timestamp()
);
alter table public.logistics_sessions enable row level security;
revoke all on public.logistics_sessions from public,anon,authenticated;
grant select on public.logistics_sessions to authenticated;
create policy logistics_sessions_members on public.logistics_sessions for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=logistics_sessions.workspace_id and m.user_id=(select auth.uid())));
create function public.logistics_save_session(shop uuid,session_id uuid,session_kind text,expected_version integer,document jsonb)
returns public.logistics_sessions language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();old public.logistics_sessions;saved public.logistics_sessions;supplier public.gestion_partners;line jsonb;employee jsonb;begin
 if actor is null or not exists(select 1 from public.scanette_members where workspace_id=shop and user_id=actor and role in ('admin','operator')) then raise exception 'Access denied' using errcode='42501';end if;
 if session_id is null or session_kind not in ('receipt','inventory') or session_kind is null or expected_version is null or expected_version<0 or jsonb_typeof(document) is distinct from 'object' or octet_length(document::text)>2000000 then raise exception 'Invalid document';end if;
 if jsonb_typeof(document->'lines') is distinct from 'array' or jsonb_array_length(document->'lines')>5000 or length(coalesce(document->>'label',''))>180 or coalesce(document->>'event_at','')='' then raise exception 'Invalid header';end if;
 perform (document->>'event_at')::timestamptz;
 if session_kind='receipt' then
  select * into supplier from public.gestion_partners where id=(document->>'supplier_id')::uuid and workspace_id=shop and kind='supplier';
  if not found or length(btrim(coalesce(document->>'orders',''))) not between 1 and 1000 then raise exception 'Supplier and order required';end if;
  document:=jsonb_set(document,'{supplier_name}',to_jsonb(supplier.name));
 else
  if jsonb_typeof(document->'employees') is distinct from 'array' or jsonb_array_length(document->'employees') not between 1 and 2 then raise exception 'One or two employees required';end if;
  for employee in select value from jsonb_array_elements(document->'employees') loop
   if jsonb_typeof(employee)<>'string' or length(btrim(employee#>>'{}')) not between 1 and 180 then raise exception 'Invalid employee';end if;
  end loop;
 end if;
 for line in select value from jsonb_array_elements(document->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or not (line ? 'quantity') or (line->'quantity'<>'null'::jsonb and (coalesce(line->>'quantity','') !~ '^(0|[1-9][0-9]{0,6})$' or (line->>'quantity')::bigint>1000000)) or length(coalesce(line->>'location',''))>300 then raise exception 'Invalid line';end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products where id=(line->>'product_id')::uuid and workspace_id=shop) then raise exception 'Product outside workspace';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(session_id::text,8));
 select * into old from public.logistics_sessions where id=session_id for update;
 if found and (old.workspace_id<>shop or old.kind<>session_kind) then raise exception 'Document unavailable';end if;
 if old.id is not null and old.updated_by=actor and old.content=document and old.version=expected_version+1 then return old;end if;
 if coalesce(old.version,0)<>expected_version then raise exception 'Document changed' using errcode='PT409';end if;
 insert into public.logistics_sessions(id,workspace_id,kind,content,version,created_by,updated_by) values(session_id,shop,session_kind,document,expected_version+1,actor,actor)
 on conflict(id) do update set content=excluded.content,version=excluded.version,updated_by=actor,updated_at=clock_timestamp() returning * into saved;
 return saved;
end;$$;
create function public.logistics_employee_names(shop uuid) returns table(name text,functions text[]) language sql stable security definer set search_path='' as $$
 select t.display_name,t.functions from public.gestion_team t where t.workspace_id=shop and exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=auth.uid()) order by t.display_name,t.id;
$$;
revoke all on function public.logistics_save_session(uuid,uuid,text,integer,jsonb),public.logistics_employee_names(uuid) from public,anon;
grant execute on function public.logistics_save_session(uuid,uuid,text,integer,jsonb),public.logistics_employee_names(uuid) to authenticated;
commit;
