begin;
-- One current sharing lease per person; never an itinerary history.
create table public.delivery_positions (
 workspace_id uuid not null references public.scanette_workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 lease uuid not null, active boolean not null, label text not null,
 latitude double precision, longitude double precision, accuracy double precision,
 sequence bigint not null default 0, updated_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,user_id)
);
alter table public.delivery_positions enable row level security;
revoke all on public.delivery_positions from public,anon,authenticated;
create function public.delivery_position_write(shop uuid, token uuid, operation text, driver text default '', lat double precision default null, lon double precision default null, precision_m double precision default null, seq bigint default 0)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if actor is null or not exists(select 1 from public.scanette_members where workspace_id=shop and user_id=actor) then raise exception 'Access denied' using errcode='42501';end if;
 if token is null or operation is null or operation not in ('begin','position','stop') then raise exception 'Invalid operation';end if;
 perform pg_advisory_xact_lock(hashtextextended(shop::text||actor::text,29));
 if operation='begin' then
  if length(btrim(driver)) not between 1 and 80 or driver is null then raise exception 'Driver required';end if;
  insert into public.delivery_positions(workspace_id,user_id,lease,active,label) values(shop,actor,token,true,btrim(driver))
  on conflict(workspace_id,user_id) do update set lease=excluded.lease,active=true,label=excluded.label,latitude=null,longitude=null,accuracy=null,sequence=0,updated_at=clock_timestamp();
 elsif operation='stop' then
  update public.delivery_positions set active=false,latitude=null,longitude=null,accuracy=null,updated_at=clock_timestamp() where workspace_id=shop and user_id=actor and lease=token;
 else
  if lat is null or lon is null or precision_m is null or not(lat between -90 and 90) or not(lon between -180 and 180) or not(precision_m between 0 and 100000) or seq is null or seq<1 then raise exception 'Invalid position';end if;
  update public.delivery_positions set latitude=lat,longitude=lon,accuracy=precision_m,sequence=seq,updated_at=clock_timestamp()
   where workspace_id=shop and user_id=actor and lease=token and active and sequence<seq;
  if not found then raise exception 'Sharing stopped or replaced' using errcode='40001';end if;
 end if;
end $$;
create function public.delivery_positions_current(shop uuid)
returns table(user_id uuid,label text,latitude double precision,longitude double precision,accuracy double precision,updated_at timestamptz,age_seconds integer)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.scanette_members member where member.workspace_id=shop and member.user_id=auth.uid()) then raise exception 'Access denied' using errcode='42501';end if;
 return query select p.user_id,p.label,p.latitude,p.longitude,p.accuracy,p.updated_at,extract(epoch from (clock_timestamp()-p.updated_at))::integer from public.delivery_positions p
 where p.workspace_id=shop and p.active and p.latitude is not null and p.updated_at>clock_timestamp()-interval '90 seconds'
 and exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=p.user_id);
end $$;
revoke all on function public.delivery_position_write(uuid,uuid,text,text,double precision,double precision,double precision,bigint) from public,anon;
revoke all on function public.delivery_positions_current(uuid) from public,anon;
grant execute on function public.delivery_position_write(uuid,uuid,text,text,double precision,double precision,double precision,bigint) to authenticated;
grant execute on function public.delivery_positions_current(uuid) to authenticated;
commit;
