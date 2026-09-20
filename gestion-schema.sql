-- Alcorb Gestion: additive receipt ledger. Existing catalogue/pointages untouched.
begin;
create table public.gestion_receipts (
 id uuid primary key, workspace_id uuid not null references public.scanette_workspaces(id),
 actor_id uuid not null references auth.users(id), label text not null check(length(label) between 1 and 160),
 payload jsonb not null, created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','partial','received'))
);
create table public.gestion_receipt_lines (
 receipt_id uuid not null references public.gestion_receipts(id),product_id uuid not null references public.scanette_products(id),
 expected integer not null check(expected between 1 and 1000000),accepted integer not null default 0 check(accepted>=0 and accepted<=expected),
 primary key(receipt_id,product_id)
);
create table public.gestion_stock (
 product_id uuid primary key references public.scanette_products(id),workspace_id uuid not null references public.scanette_workspaces(id),
 quantity bigint, updated_at timestamptz not null default now()
);
create table public.gestion_operations (
 id uuid primary key,workspace_id uuid not null references public.scanette_workspaces(id),actor_id uuid not null references auth.users(id),
 receipt_id uuid references public.gestion_receipts(id),kind text not null check(kind in ('receipt','count')),payload jsonb not null,
 created_at timestamptz not null default now()
);
create table public.gestion_movements (
 operation_id uuid not null references public.gestion_operations(id),product_id uuid not null references public.scanette_products(id),
 quantity bigint not null, primary key(operation_id,product_id)
);
alter table public.gestion_receipts enable row level security;
alter table public.gestion_receipt_lines enable row level security;
alter table public.gestion_stock enable row level security;
alter table public.gestion_operations enable row level security;
alter table public.gestion_movements enable row level security;
revoke all on public.gestion_receipts,public.gestion_receipt_lines,public.gestion_stock,public.gestion_operations,public.gestion_movements from anon,authenticated;
grant select on public.gestion_receipts,public.gestion_receipt_lines,public.gestion_stock,public.gestion_operations,public.gestion_movements to authenticated;
create policy member_receipts on public.gestion_receipts for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_receipts.workspace_id and m.user_id=auth.uid()));
create policy member_lines on public.gestion_receipt_lines for select to authenticated using(exists(select 1 from public.gestion_receipts r where r.id=receipt_id));
create policy member_stock on public.gestion_stock for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_stock.workspace_id and m.user_id=auth.uid()));
create policy member_operations on public.gestion_operations for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_operations.workspace_id and m.user_id=auth.uid()));
create policy member_movements on public.gestion_movements for select to authenticated using(exists(select 1 from public.gestion_operations o where o.id=operation_id));

create function public.gestion_submit_receipt(receipt_id uuid,shop_id uuid,receipt_label text,items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old public.gestion_receipts%rowtype; item jsonb; canonical jsonb; n integer;
begin
 if actor is null or not exists(select 1 from public.scanette_members where workspace_id=shop_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied'; end if;
 if receipt_id is null or receipt_label is null or length(btrim(receipt_label)) not between 1 and 160 or jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid receipt'; end if;
 n:=jsonb_array_length(items); if n<1 or n>500 then raise exception '1 to 500 lines required'; end if;
 for item in select value from jsonb_array_elements(items) loop
  if not (item ? 'product_id' and item ? 'quantity') or (item->>'quantity') !~ '^[1-9][0-9]{0,6}$' or (item->>'quantity')::bigint>1000000 then raise exception 'Invalid quantity'; end if;
  if not exists(select 1 from public.scanette_products p where p.id=(item->>'product_id')::uuid and p.workspace_id=shop_id) then raise exception 'Product outside workspace'; end if;
 end loop;
 if (select count(distinct value->>'product_id') from jsonb_array_elements(items))<>n then raise exception 'Duplicate product'; end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by value->>'product_id') into canonical from jsonb_array_elements(items);
 -- Lock covers simultaneous retry before the header exists.
 perform pg_advisory_xact_lock(hashtextextended(receipt_id::text,0));
 select * into old from public.gestion_receipts r where r.id=receipt_id;
 if found then
  if old.workspace_id<>shop_id or old.actor_id<>actor or old.payload<>canonical or old.label<>btrim(receipt_label) then raise exception 'Receipt identity already used'; end if;
  return receipt_id;
 end if;
 insert into public.gestion_receipts(id,workspace_id,actor_id,label,payload) values(receipt_id,shop_id,actor,btrim(receipt_label),canonical);
 insert into public.gestion_receipt_lines(receipt_id,product_id,expected) select receipt_id,(value->>'product_id')::uuid,(value->>'quantity')::integer from jsonb_array_elements(canonical);
 return receipt_id;
end;$$;

create function public.gestion_accept_receipt(receipt_id uuid,operation_id uuid,items jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt public.gestion_receipts%rowtype; previous public.gestion_operations%rowtype; item jsonb; line public.gestion_receipt_lines%rowtype; canonical jsonb; product uuid; qty integer; result text;
begin
 select * into receipt from public.gestion_receipts r where r.id=receipt_id for update;
 if not found or actor is null or not exists(select 1 from public.scanette_members where workspace_id=receipt.workspace_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied'; end if;
 if operation_id is null or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 500 then raise exception 'Invalid lines'; end if;
 for item in select value from jsonb_array_elements(items) loop
  if not(item ? 'product_id' and item ? 'quantity') or (item->>'quantity') !~ '^[1-9][0-9]{0,6}$' or (item->>'quantity')::bigint>1000000 then raise exception 'Invalid quantity'; end if;
 end loop;
 if (select count(distinct value->>'product_id') from jsonb_array_elements(items))<>jsonb_array_length(items) then raise exception 'Duplicate product'; end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by value->>'product_id') into canonical from jsonb_array_elements(items);
 perform pg_advisory_xact_lock(hashtextextended(operation_id::text,1));
 select * into previous from public.gestion_operations o where o.id=operation_id;
 if found then
  if previous.actor_id<>actor or previous.receipt_id is distinct from receipt_id or previous.payload<>canonical or previous.kind<>'receipt' then raise exception 'Operation identity already used'; end if;
  return receipt.status;
 end if;
 insert into public.gestion_operations(id,workspace_id,actor_id,receipt_id,kind,payload) values(operation_id,receipt.workspace_id,actor,receipt_id,'receipt',canonical);
 for item in select value from jsonb_array_elements(canonical) loop
  product:=(item->>'product_id')::uuid; qty:=(item->>'quantity')::integer;
  select * into line from public.gestion_receipt_lines l where l.receipt_id=gestion_accept_receipt.receipt_id and l.product_id=product for update;
  if not found or qty>line.expected-line.accepted then raise exception 'Quantity exceeds remaining receipt'; end if;
  insert into public.gestion_stock(product_id,workspace_id) values(product,receipt.workspace_id) on conflict do nothing;
  update public.gestion_stock set quantity=quantity+qty,updated_at=clock_timestamp() where product_id=product;
  update public.gestion_receipt_lines l set accepted=accepted+qty where l.receipt_id=gestion_accept_receipt.receipt_id and l.product_id=product;
  insert into public.gestion_movements values(operation_id,product,qty);
 end loop;
 result:=case when exists(select 1 from public.gestion_receipt_lines l where l.receipt_id=gestion_accept_receipt.receipt_id and l.accepted<l.expected) then 'partial' else 'received' end;
 update public.gestion_receipts r set status=result where r.id=receipt_id;
 return result;
end;$$;
create function public.gestion_record_count(operation_id uuid,product_id uuid,counted bigint,expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shop uuid; current public.gestion_stock%rowtype; previous public.gestion_operations%rowtype; payload jsonb;
begin
 select p.workspace_id into shop from public.scanette_products p where p.id=product_id;
 if actor is null or shop is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=actor and m.role='admin') then raise exception 'Access denied'; end if;
 if operation_id is null or counted is null or counted not between 0 and 1000000000 then raise exception 'Invalid count'; end if;
 payload:=jsonb_build_object('product_id',product_id,'quantity',counted,'expected_updated_at',expected_updated_at);
 perform pg_advisory_xact_lock(hashtextextended(operation_id::text,1));
 select * into previous from public.gestion_operations o where o.id=operation_id;
 if found then
  if previous.actor_id<>actor or previous.workspace_id<>shop or previous.payload<>payload or previous.kind<>'count' then raise exception 'Operation identity already used'; end if;
  return;
 end if;
 insert into public.gestion_stock(product_id,workspace_id) values(product_id,shop) on conflict do nothing;
 select * into current from public.gestion_stock s where s.product_id=gestion_record_count.product_id for update;
 if expected_updated_at is distinct from current.updated_at and not(expected_updated_at is null and current.quantity is null and not exists(select 1 from public.gestion_movements m where m.product_id=gestion_record_count.product_id)) then raise exception 'Stock changed; refresh'; end if;
 insert into public.gestion_operations values(operation_id,shop,actor,null,'count',payload,now());
 insert into public.gestion_movements values(operation_id,product_id,counted-coalesce(current.quantity,0));
 update public.gestion_stock s set quantity=counted,updated_at=clock_timestamp() where s.product_id=gestion_record_count.product_id;
end;$$;
revoke all on function public.gestion_submit_receipt(uuid,uuid,text,jsonb),public.gestion_accept_receipt(uuid,uuid,jsonb),public.gestion_record_count(uuid,uuid,bigint,timestamptz) from public,anon;
grant execute on function public.gestion_submit_receipt(uuid,uuid,text,jsonb),public.gestion_accept_receipt(uuid,uuid,jsonb),public.gestion_record_count(uuid,uuid,bigint,timestamptz) to authenticated;
commit;
