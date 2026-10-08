-- Public garage portal: « Retours prêts pour la collecte », without account, PIN or private link.
-- Replaces the private-link mechanism of returns-portal.sql (its functions are closed, its table is kept).
-- Prerequisites: returns-workflow.sql and returns-portal.sql applied.
-- Apply manually as postgres in the Supabase SQL Editor, then run returns-public-portal.test.sql.
-- Not applied by the application.
--
-- What an anonymous visitor can do, and nothing else:
--   * read the minimal garage list (id, name) of a shop whose portal is open;
--   * create one new request per call. A request never reads, changes or lists another one.
-- Server-side protection: fixed workspace switch, strict validation of every field, size limits,
-- per-shop and per-garage rate limits in a short window, idempotent retries.
-- Limits: the anon key is public by design, so a script can call these functions; the rate limits
-- cap the volume, they do not identify a person. The garage names of an open shop are public.
begin;

-- Requests from the public portal have no authenticated author (already true if returns-portal.sql ran).
alter table public.returns_cases alter column created_by drop not null;
alter table public.returns_cases alter column updated_by drop not null;
alter table public.returns_case_events alter column actor_id drop not null;

create table if not exists public.returns_public_portals (
 workspace_id uuid primary key references public.scanette_workspaces(id),
 enabled boolean not null default false,
 list_garages boolean not null default true,
 window_minutes integer not null default 15 check(window_minutes between 1 and 1440),
 max_per_window integer not null default 40 check(max_per_window between 1 and 1000),
 max_per_garage integer not null default 6 check(max_per_garage between 1 and 100)
);
alter table public.returns_public_portals enable row level security;
revoke all on public.returns_public_portals from public,anon,authenticated;

-- One row per accepted public request; used for idempotent retries and rate limits.
create table if not exists public.returns_public_requests (
 id uuid primary key references public.returns_cases(id),
 workspace_id uuid not null references public.scanette_workspaces(id),
 garage_key text not null check(length(garage_key) between 1 and 200),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists returns_public_requests_window on public.returns_public_requests(workspace_id,created_at desc);
create index if not exists returns_public_requests_garage on public.returns_public_requests(workspace_id,garage_key,created_at desc);
alter table public.returns_public_requests enable row level security;
revoke all on public.returns_public_requests from public,anon,authenticated;

create or replace function public.returns_public_garages(shop_id uuid)
returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select p.id,p.name from public.gestion_partners p
 join public.returns_public_portals c on c.workspace_id=p.workspace_id and c.enabled and c.list_garages
 where p.workspace_id=shop_id and p.kind='client'
   and not coalesce((p.details->>'archived')::boolean,false) and coalesce(p.details->>'merged_into','')=''
 order by p.name,p.id limit 5000;
$$;

create or replace function public.returns_public_submit(shop_id uuid,request_id uuid,garage_id uuid,garage_name text,pickup_location text,case_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
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
end;$$;

revoke all on function public.returns_public_garages(uuid),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.returns_public_garages(uuid),public.returns_public_submit(uuid,uuid,uuid,text,text,jsonb) to anon,authenticated;

-- The private-link portal is closed. Its table and the cases it created are kept.
revoke all on function public.returns_portal_profile(text),public.returns_portal_submit(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.returns_portal_issue_link(uuid,uuid),public.returns_portal_revoke_client_links(uuid,uuid) from public,anon,authenticated;

-- Opening the portal for Bellecave is a deliberate step. Limits can be tuned on this row.
insert into public.returns_public_portals(workspace_id,enabled) values('8770297c-cadb-4cc6-8b93-55a0f9bd154e',true)
on conflict (workspace_id) do update set enabled=true;
commit;
