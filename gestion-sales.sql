-- Shared counter: drafts, immutable BL, atomic stock exit, preparation and cancellation.
begin;
alter table public.gestion_operations drop constraint gestion_operations_kind_check;
alter table public.gestion_operations add constraint gestion_operations_kind_check check(kind in ('receipt','count','sale','sale_cancel'));
create table public.gestion_sale_drafts (
 id uuid primary key, workspace_id uuid not null references public.scanette_workspaces(id), actor_id uuid not null references auth.users(id),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=60000),
 version integer not null default 1, closed boolean not null default false, updated_at timestamptz not null default now()
);
create table public.gestion_sale_counters(workspace_id uuid primary key references public.scanette_workspaces(id),last_number bigint not null);
create table public.gestion_sales (
 id uuid primary key references public.gestion_sale_drafts(id),workspace_id uuid not null references public.scanette_workspaces(id),
 number bigint not null, client_id uuid not null references public.gestion_partners(id), actor_id uuid not null references auth.users(id),
 snapshot jsonb not null,total_cents bigint not null check(total_cents>=0), status text not null default 'validated' check(status in ('validated','prepared','dispatched','cancelled')),
 version integer not null default 1,created_at timestamptz not null default now(),unique(workspace_id,number)
);
create table public.gestion_sale_events(
 id uuid primary key, sale_id uuid not null references public.gestion_sales(id),actor_id uuid not null references auth.users(id),action text not null check(action in ('prepared','dispatched','cancelled')),reason text not null default '',created_at timestamptz not null default now()
);
alter table public.gestion_sale_drafts enable row level security;
alter table public.gestion_sales enable row level security;
alter table public.gestion_sale_events enable row level security;
alter table public.gestion_sale_counters enable row level security;
revoke all on public.gestion_sale_drafts,public.gestion_sales,public.gestion_sale_events,public.gestion_sale_counters from anon,authenticated;
grant select on public.gestion_sale_drafts,public.gestion_sales,public.gestion_sale_events to authenticated;
create policy own_sale_drafts on public.gestion_sale_drafts for select to authenticated using(actor_id=(select auth.uid()) and exists(select 1 from public.scanette_members m where m.workspace_id=gestion_sale_drafts.workspace_id and m.user_id=(select auth.uid())));
create policy member_sales on public.gestion_sales for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_sales.workspace_id and m.user_id=(select auth.uid())));
create policy member_sale_events on public.gestion_sale_events for select to authenticated using(exists(select 1 from public.gestion_sales s where s.id=sale_id));
create function public.gestion_save_sale_draft(shop_id uuid,draft_id uuid,expected_version integer,content jsonb)
returns public.gestion_sale_drafts language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old public.gestion_sale_drafts; saved public.gestion_sale_drafts;
begin
 if actor is null or not exists(select 1 from public.scanette_members where workspace_id=shop_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501';end if;
 if draft_id is null or expected_version is null or expected_version<0 or jsonb_typeof(content) is distinct from 'object' then raise exception 'Invalid draft';end if;
 perform pg_advisory_xact_lock(hashtextextended(draft_id::text,2));
 select * into old from public.gestion_sale_drafts where id=draft_id for update;
 if found and (old.actor_id<>actor or old.workspace_id<>shop_id or old.closed) then raise exception 'Draft unavailable';end if;
 if coalesce(old.version,0)<>expected_version then raise exception 'Draft changed' using errcode='40001';end if;
 insert into public.gestion_sale_drafts(id,workspace_id,actor_id,payload,version) values(draft_id,shop_id,actor,content,expected_version+1)
 on conflict(id) do update set payload=excluded.payload,version=excluded.version,updated_at=now() returning * into saved;
 return saved;
end;$$;
create function public.gestion_validate_sale(draft_id uuid,expected_version integer)
returns public.gestion_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); d public.gestion_sale_drafts; result public.gestion_sales; c public.gestion_partners; p public.scanette_products; item jsonb; lines jsonb:='[]'; departure jsonb; store jsonb; seller text; qty integer; base bigint; discount integer; unit bigint; available bigint; total bigint:=0; sequence_number bigint; idx integer;
begin
 select * into d from public.gestion_sale_drafts where id=draft_id for update;
 if not found or actor is null or d.actor_id<>actor or not exists(select 1 from public.scanette_members where workspace_id=d.workspace_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501';end if;
 select * into result from public.gestion_sales where id=draft_id;
 if found then return result;end if;
 if d.closed or expected_version is distinct from d.version then raise exception 'Draft changed' using errcode='40001';end if;
 if jsonb_typeof(d.payload->'items') is distinct from 'array' then raise exception 'Lines required';end if;
 if jsonb_array_length(d.payload->'items') not between 1 and 100 then raise exception '1 to 100 lines required';end if;
 if length(coalesce(d.payload->>'note',''))>1000 then raise exception 'Note too long';end if;
 select * into c from public.gestion_partners where id=(d.payload->>'client_id')::uuid and workspace_id=d.workspace_id and kind='client' for share;
 if not found then raise exception 'Client unavailable';end if;
 if coalesce((d.payload->>'client_version')::integer,0)<>c.version then raise exception 'Client changed: reload' using errcode='40001';end if;
 if d.payload->>'departure_index' is not null then
  idx:=(d.payload->>'departure_index')::integer;
  if idx<0 or idx>=jsonb_array_length(c.departures) then raise exception 'Departure unavailable';end if;
  departure:=c.departures->idx;
 end if;
 if (select count(distinct (value->>'product_id')::uuid) from jsonb_array_elements(d.payload->'items'))<>jsonb_array_length(d.payload->'items') then raise exception 'Duplicate product';end if;
 -- Serializes store numbering. Stock rows use the same sorted UUID order as receipts.
 perform 1 from public.scanette_workspaces where id=d.workspace_id for update;
 for item in select value from jsonb_array_elements(d.payload->'items') order by (value->>'product_id')::uuid loop
  if coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,5}$' or (item->>'quantity')::bigint>100000 or coalesce(item->>'base_cents','') !~ '^[0-9]{1,9}$' or (item->>'base_cents')::bigint>100000000 or coalesce(item->>'discount_bp','') !~ '^[0-9]{1,5}$' or (item->>'discount_bp')::integer>10000 then raise exception 'Invalid quantity or price';end if;
  qty:=(item->>'quantity')::integer;base:=(item->>'base_cents')::bigint;discount:=(item->>'discount_bp')::integer;
  unit:=round(base::numeric*(10000-discount)/10000)::bigint;
  select * into p from public.scanette_products where id=(item->>'product_id')::uuid and workspace_id=d.workspace_id for share;
  if not found then raise exception 'Product outside store';end if;
  select quantity into available from public.gestion_stock where product_id=p.id and workspace_id=d.workspace_id for update;
  if not found or available is null then raise exception 'Stock unknown for %',p.reference;end if;
  -- Negative computer stock is allowed: a sale can create a replenishment need.
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',p.id,'ref',p.reference,'name',p.description,'location',p.location,'quantity',qty,'base_cents',base,'discount_bp',discount,'unit',unit));
  total:=total+unit*qty;
 end loop;
 insert into public.gestion_sale_counters values(d.workspace_id,1) on conflict(workspace_id) do update set last_number=public.gestion_sale_counters.last_number+1 returning last_number into sequence_number;
 select jsonb_build_object('name',display_name,'legal_name',legal_name,'address',address,'city',city,'postal_code',postal_code,'siret',siret) into store from public.gestion_store_settings where workspace_id=d.workspace_id;
 if store is null then select jsonb_build_object('name',name) into store from public.scanette_workspaces where id=d.workspace_id;end if;
 select display_name into seller from public.gestion_team where workspace_id=d.workspace_id and user_id=actor;
 insert into public.gestion_sales(id,workspace_id,number,client_id,actor_id,snapshot,total_cents)
 values(draft_id,d.workspace_id,sequence_number,c.id,actor,jsonb_build_object('store',store,'client',jsonb_build_object('name',c.name,'details',c.details),'seller',coalesce(seller,actor::text),'lines',lines,'departure',departure,'note',coalesce(d.payload->>'note','')),total) returning * into result;
 insert into public.gestion_operations(id,workspace_id,actor_id,kind,payload) values(draft_id,d.workspace_id,actor,'sale',jsonb_build_object('sale_id',draft_id,'number',sequence_number));
 for item in select value from jsonb_array_elements(lines) loop
  update public.gestion_stock set quantity=quantity-(item->>'quantity')::bigint,updated_at=clock_timestamp() where product_id=(item->>'product_id')::uuid;
  insert into public.gestion_movements values(draft_id,(item->>'product_id')::uuid,-(item->>'quantity')::bigint);
 end loop;
 update public.gestion_sale_drafts set closed=true,updated_at=now() where id=draft_id;
 return result;
end;$$;
create function public.gestion_sale_action(sale_id uuid,event_id uuid,expected_version integer,action text,reason text)
returns public.gestion_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.gestion_sales; prior public.gestion_sale_events; item jsonb;
begin
 select * into s from public.gestion_sales where id=sale_id for update;
 if not found or actor is null or not exists(select 1 from public.scanette_members where workspace_id=s.workspace_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501';end if;
 if event_id is null or action not in ('prepared','dispatched','cancelled') or action is null or reason is null or length(reason)>1000 then raise exception 'Invalid action';end if;
 perform pg_advisory_xact_lock(hashtextextended(event_id::text,1));
 select * into prior from public.gestion_sale_events where id=event_id;
 if found then
  if prior.sale_id<>sale_id or prior.actor_id<>actor or prior.action<>action or prior.reason<>reason then raise exception 'Event identity already used';end if;
  return s;
 end if;
 if expected_version is distinct from s.version then raise exception 'Sale changed' using errcode='40001';end if;
 if not ((action='prepared' and s.status='validated') or (action='dispatched' and s.status='prepared') or (action='cancelled' and s.status in ('validated','prepared') and length(btrim(reason))>0)) then raise exception 'Invalid transition';end if;
 if action='cancelled' then
  insert into public.gestion_operations(id,workspace_id,actor_id,kind,payload) values(event_id,s.workspace_id,actor,'sale_cancel',jsonb_build_object('sale_id',sale_id,'reason',reason));
  for item in select value from jsonb_array_elements(s.snapshot->'lines') order by (value->>'product_id')::uuid loop
   update public.gestion_stock set quantity=quantity+(item->>'quantity')::bigint,updated_at=clock_timestamp() where product_id=(item->>'product_id')::uuid and workspace_id=s.workspace_id;
   insert into public.gestion_movements values(event_id,(item->>'product_id')::uuid,(item->>'quantity')::bigint);
  end loop;
 end if;
 insert into public.gestion_sale_events values(event_id,sale_id,actor,action,reason,now());
 update public.gestion_sales set status=action,version=version+1 where id=sale_id returning * into s;
 return s;
end;$$;
revoke all on function public.gestion_save_sale_draft(uuid,uuid,integer,jsonb),public.gestion_validate_sale(uuid,integer),public.gestion_sale_action(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.gestion_save_sale_draft(uuid,uuid,integer,jsonb),public.gestion_validate_sale(uuid,integer),public.gestion_sale_action(uuid,uuid,integer,text,text) to authenticated;
commit;
