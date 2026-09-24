-- Real shared store settings. Additive, no inventory or membership changes.
begin;
create table public.gestion_store_settings (
 workspace_id uuid primary key references public.scanette_workspaces(id),
 display_name text not null check(length(btrim(display_name)) between 1 and 120),
 legal_name text not null default '' check(length(legal_name)<=160),
 address text not null default '' check(length(address)<=500),
 postal_code text not null default '' check(length(postal_code)<=20),
 city text not null default '' check(length(city)<=120),
 country text not null default 'France' check(length(country)<=80),
 phone text not null default '' check(length(phone)<=40),
 email text not null default '' check(length(email)<=254),
 siret text not null default '' check(siret='' or siret ~ '^[0-9]{14}$'),
 version integer not null check(version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.gestion_store_settings enable row level security;
revoke all on public.gestion_store_settings from anon, authenticated;
grant select on public.gestion_store_settings to authenticated;
create policy settings_members on public.gestion_store_settings for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_store_settings.workspace_id and m.user_id=(select auth.uid())));
create function public.gestion_save_store_settings(shop_id uuid, expected_version integer, details jsonb)
returns public.gestion_store_settings language plpgsql security definer set search_path='' as $$
declare saved public.gestion_store_settings; actor uuid:=auth.uid(); previous integer;
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role='admin') then raise exception 'Access denied' using errcode='42501'; end if;
 if expected_version is null or expected_version<0 or jsonb_typeof(details) is distinct from 'object' then raise exception 'Invalid settings'; end if;
 -- Serialize initial creation as well as later edits.
 perform 1 from public.scanette_workspaces w where w.id=shop_id for update;
 select s.version into previous from public.gestion_store_settings s where s.workspace_id=shop_id;
 if coalesce(previous,0)<>expected_version then raise exception 'Settings changed: reload before saving' using errcode='PT409'; end if;
 insert into public.gestion_store_settings(workspace_id,display_name,legal_name,address,postal_code,city,country,phone,email,siret,version,updated_by)
 values(shop_id,btrim(details->>'display_name'),coalesce(details->>'legal_name',''),coalesce(details->>'address',''),coalesce(details->>'postal_code',''),coalesce(details->>'city',''),coalesce(details->>'country','France'),coalesce(details->>'phone',''),coalesce(details->>'email',''),coalesce(details->>'siret',''),expected_version+1,actor)
 on conflict(workspace_id) do update set display_name=excluded.display_name,legal_name=excluded.legal_name,address=excluded.address,postal_code=excluded.postal_code,city=excluded.city,country=excluded.country,phone=excluded.phone,email=excluded.email,siret=excluded.siret,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
 returning * into saved;
 return saved;
end;$$;
revoke all on function public.gestion_save_store_settings(uuid,integer,jsonb) from public,anon;
grant execute on function public.gestion_save_store_settings(uuid,integer,jsonb) to authenticated;
commit;
