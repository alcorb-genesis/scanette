-- Private warehouse directory. Product positions remain audited through scanette_set_location.
begin;
create table public.scanette_aisles (
 workspace_id uuid not null references public.scanette_workspaces(id),
 code text not null,
 description text not null,
 notes text not null default '',
 updated_at timestamptz not null default now(),
 primary key(workspace_id,code)
);
alter table public.scanette_aisles enable row level security;
revoke all on public.scanette_aisles from anon,authenticated;
grant select on public.scanette_aisles to authenticated;
create policy aisle_members on public.scanette_aisles for select to authenticated using(
 exists(select 1 from public.scanette_members m where m.workspace_id=scanette_aisles.workspace_id and m.user_id=(select auth.uid()))
);
commit;
