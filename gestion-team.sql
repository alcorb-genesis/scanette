-- Team records are not authentication accounts. No membership grants here.
begin;
create table public.gestion_team (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.scanette_workspaces(id),
 user_id uuid,
 display_name text not null check(length(btrim(display_name)) between 1 and 120),
 functions text[] not null check(cardinality(functions) between 1 and 12 and array_position(functions,null) is null and functions <@ array['office','management','logistics','receiving','warranty','returns','picking','shipping','driver','commercial','sales','purchasing','accounting','apprentice']::text[]),
 contact_email text not null default '' check(length(contact_email)<=254),
 notes text not null default '' check(length(notes)<=500),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,user_id) references public.scanette_members(workspace_id,user_id) on delete set null (user_id),
 unique(workspace_id,user_id)
);
alter table public.gestion_team enable row level security;
revoke all on public.gestion_team from anon,authenticated;
grant select on public.gestion_team to authenticated;
create policy team_visible on public.gestion_team for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.scanette_members m where m.workspace_id=gestion_team.workspace_id and m.user_id=(select auth.uid()) and m.role='admin'));
create function public.gestion_save_team_member(shop_id uuid, member_id uuid, expected_version integer, member_name text, member_functions text[], member_email text, member_notes text)
returns public.gestion_team language plpgsql security definer set search_path='' as $$
declare saved public.gestion_team; previous integer; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop_id and m.user_id=actor and m.role='admin') then raise exception 'Access denied' using errcode='42501';end if;
 if member_id is null or expected_version is null or expected_version<0 then raise exception 'Invalid request';end if;
 perform 1 from public.scanette_workspaces w where w.id=shop_id for update;
 if exists(select 1 from public.gestion_team t where t.id=member_id and t.workspace_id<>shop_id) then raise exception 'Access denied' using errcode='42501';end if;
 select t.version into previous from public.gestion_team t where t.id=member_id and t.workspace_id=shop_id;
 if coalesce(previous,0)<>expected_version then raise exception 'Team record changed' using errcode='PT409';end if;
 insert into public.gestion_team(id,workspace_id,display_name,functions,contact_email,notes,version,updated_by)
 values(member_id,shop_id,btrim(member_name),member_functions,coalesce(btrim(member_email),''),coalesce(member_notes,''),expected_version+1,actor)
 on conflict(id) do update set display_name=excluded.display_name,functions=excluded.functions,contact_email=excluded.contact_email,notes=excluded.notes,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
 returning * into saved;
 return saved;
end;$$;
revoke all on function public.gestion_save_team_member(uuid,uuid,integer,text,text[],text,text) from public,anon;
grant execute on function public.gestion_save_team_member(uuid,uuid,integer,text,text[],text,text) to authenticated;
commit;

