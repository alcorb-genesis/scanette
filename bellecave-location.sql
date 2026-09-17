begin;
create table public.scanette_location_events (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.scanette_workspaces(id),
 product_id uuid not null references public.scanette_products(id),
 actor_id uuid not null references auth.users(id),
 old_location text,new_location text,
 created_at timestamptz not null default now()
);
alter table public.scanette_location_events enable row level security;
revoke all on public.scanette_location_events from anon,authenticated;
grant select on public.scanette_location_events to authenticated;
create policy location_event_members on public.scanette_location_events for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=scanette_location_events.workspace_id and m.user_id=(select auth.uid())));
create function public.scanette_set_location(product_id uuid,new_location text,expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.scanette_products%rowtype; actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required'; end if;
 if length(new_location)>160 then raise exception 'Location too long'; end if;
 select * into p from public.scanette_products where id=product_id for update;
 if not found then raise exception 'Product unavailable'; end if;
 if not exists(select 1 from public.scanette_members m where m.workspace_id=p.workspace_id and m.user_id=actor and m.role in ('operator','admin')) then raise exception 'Access denied'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload before saving'; end if;
 update public.scanette_products set location=nullif(btrim(new_location),''),updated_at=clock_timestamp() where id=product_id;
 insert into public.scanette_location_events(workspace_id,product_id,actor_id,old_location,new_location) values(p.workspace_id,p.id,actor,p.location,nullif(btrim(new_location),''));
end;$$;
revoke all on function public.scanette_set_location(uuid,text,timestamptz) from public,anon;
grant execute on function public.scanette_set_location(uuid,text,timestamptz) to authenticated;
commit;
