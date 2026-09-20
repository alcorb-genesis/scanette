-- Shared partner records and recurring departure assignments. No stock changes.
begin;
create table public.gestion_partners (
 id uuid primary key, workspace_id uuid not null references public.scanette_workspaces(id),
 kind text not null check(kind in ('client','supplier')),
 name text not null check(length(btrim(name)) between 1 and 180),
 details jsonb not null default '{}' check(jsonb_typeof(details)='object' and octet_length(details::text)<=20000),
 departures jsonb not null default '[]' check(jsonb_typeof(departures)='array' and jsonb_array_length(departures)<=30),
 source_key text not null default '' check(length(source_key)<=200),
 version integer not null check(version>0), updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create unique index gestion_partner_source on public.gestion_partners(workspace_id,kind,source_key) where source_key<>'';
alter table public.gestion_partners add constraint partner_siret_format check(coalesce(details->>'siret','')='' or (details->>'siret') ~ '^[0-9]{14}$');
create unique index gestion_partner_siret on public.gestion_partners(workspace_id,kind,(details->>'siret')) where coalesce(details->>'siret','')<>'';
alter table public.gestion_partners enable row level security;
revoke all on public.gestion_partners from anon,authenticated;
grant select on public.gestion_partners to authenticated;
create policy partner_members on public.gestion_partners for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_partners.workspace_id and m.user_id=(select auth.uid())));
create function public.gestion_save_partner(shop_id uuid,partner_id uuid,expected_version integer,partner_kind text,partner_name text,partner_details jsonb,partner_departures jsonb,partner_source text)
returns public.gestion_partners language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous integer; saved public.gestion_partners; slot jsonb; day jsonb;
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role in ('admin','operator')) then raise exception 'Access denied' using errcode='42501';end if;
 if partner_id is null or expected_version is null or expected_version<0 or jsonb_typeof(partner_details) is distinct from 'object' or jsonb_typeof(partner_departures) is distinct from 'array' or jsonb_array_length(partner_departures)>30 then raise exception 'Invalid request';end if;
 if partner_kind='supplier' and jsonb_array_length(partner_departures)>0 then raise exception 'Supplier cannot have garage departures';end if;
 for slot in select value from jsonb_array_elements(partner_departures) loop
  if jsonb_typeof(slot) is distinct from 'object' or coalesce(slot->>'mode','') not in ('internal','external') or coalesce(slot->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or length(btrim(coalesce(slot->>'carrier',''))) not between 1 and 120 or length(coalesce(slot->>'sector',''))>120 or length(coalesce(slot->>'place',''))>160 or length(coalesce(slot->>'notes',''))>500 then raise exception 'Invalid departure';end if;
  if coalesce(slot->>'cutoff','')<>'' and ((slot->>'cutoff') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (slot->>'cutoff')>(slot->>'time')) then raise exception 'Invalid preparation cutoff';end if;
  if jsonb_typeof(slot->'days') is distinct from 'array' then raise exception 'Days required';end if;
  if jsonb_array_length(slot->'days') not between 1 and 7 then raise exception 'Days required';end if;
  for day in select value from jsonb_array_elements(slot->'days') loop
   if day::text !~ '^[1-7]$' then raise exception 'Invalid weekday';end if;
  end loop;
 end loop;
 perform 1 from public.scanette_workspaces where id=shop_id for update;
 if exists(select 1 from public.gestion_partners where id=partner_id and workspace_id<>shop_id) then raise exception 'Access denied' using errcode='42501';end if;
 select version into previous from public.gestion_partners where id=partner_id and workspace_id=shop_id;
 if coalesce(previous,0)<>expected_version then raise exception 'Partner changed' using errcode='40001';end if;
 insert into public.gestion_partners(id,workspace_id,kind,name,details,departures,source_key,version,updated_by)
 values(partner_id,shop_id,partner_kind,btrim(partner_name),partner_details,partner_departures,coalesce(partner_source,''),expected_version+1,actor)
 on conflict(id) do update set kind=excluded.kind,name=excluded.name,details=excluded.details,departures=excluded.departures,source_key=excluded.source_key,version=excluded.version,updated_by=excluded.updated_by,updated_at=now() returning * into saved;
 return saved;
end;$$;
revoke all on function public.gestion_save_partner(uuid,uuid,integer,text,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.gestion_save_partner(uuid,uuid,integer,text,text,jsonb,jsonb,text) to authenticated;
commit;
