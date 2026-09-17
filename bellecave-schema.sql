-- Additive migration: existing public.catalogue and its policies are untouched.
begin;
create table public.scanette_workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 created_at timestamptz not null default now()
);
create table public.scanette_members (
 workspace_id uuid not null references public.scanette_workspaces(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('reader','operator','admin')),
 primary key(workspace_id,user_id)
);
create table public.scanette_products (
 id uuid primary key,
 workspace_id uuid not null references public.scanette_workspaces(id),
 reference text not null,
 order_reference text,
 description text not null,
 internal_barcode text,
 manufacturer_barcode text,
 source_line integer not null,
 source_sha256 text not null,
 stock_quantity numeric,
 stock_observed_at timestamptz,
 location text,
 updated_at timestamptz not null default now(),
 unique(workspace_id,source_sha256,source_line),
 check((stock_quantity is null) = (stock_observed_at is null))
);
create index scanette_products_reference on public.scanette_products(workspace_id,reference);
create index scanette_products_internal on public.scanette_products(workspace_id,internal_barcode);
create index scanette_products_manufacturer on public.scanette_products(workspace_id,manufacturer_barcode);
alter table public.scanette_workspaces enable row level security;
alter table public.scanette_members enable row level security;
alter table public.scanette_products enable row level security;
revoke all on public.scanette_workspaces,public.scanette_members,public.scanette_products from anon,authenticated;
grant select on public.scanette_workspaces,public.scanette_members,public.scanette_products to authenticated;
create policy own_memberships on public.scanette_members for select to authenticated using(user_id=(select auth.uid()));
create policy workspace_members on public.scanette_workspaces for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=scanette_workspaces.id and m.user_id=(select auth.uid())));
create policy product_members on public.scanette_products for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=scanette_products.workspace_id and m.user_id=(select auth.uid())));
insert into public.scanette_workspaces(id,name) values('8770297c-cadb-4cc6-8b93-55a0f9bd154e','Bellecave');
commit;
