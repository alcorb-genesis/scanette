begin;
alter table public.gestion_operations drop constraint gestion_operations_kind_check;
alter table public.gestion_operations add constraint gestion_operations_kind_check check(kind in ('receipt','count','sale','sale_cancel','adjustment'));
create table public.gestion_purchase_orders (
 id uuid primary key references public.gestion_receipts(id),workspace_id uuid not null references public.scanette_workspaces(id),supplier_id uuid not null references public.gestion_partners(id),actor_id uuid not null references auth.users(id),supplier_snapshot jsonb not null,payload jsonb not null,expected_at timestamptz,created_at timestamptz not null default now()
);
alter table public.gestion_purchase_orders enable row level security;
revoke all on public.gestion_purchase_orders from anon,authenticated;
grant select on public.gestion_purchase_orders to authenticated;
create policy member_purchase_orders on public.gestion_purchase_orders for select to authenticated using(exists(select 1 from public.scanette_members m where m.workspace_id=gestion_purchase_orders.workspace_id and m.user_id=(select auth.uid())));
create function public.gestion_create_purchase(shop_id uuid,order_id uuid,supplier_id uuid,items jsonb,expected_at timestamptz,order_note text)
returns public.gestion_purchase_orders language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); supplier public.gestion_partners; prior public.gestion_purchase_orders; result public.gestion_purchase_orders; canonical jsonb; payload jsonb;
begin
 if actor is null or not exists(select 1 from public.scanette_members where workspace_id=shop_id and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501';end if;
 if order_id is null or jsonb_typeof(items) is distinct from 'array' or length(coalesce(order_note,''))>1000 then raise exception 'Invalid purchase';end if;
 select * into supplier from public.gestion_partners p where p.id=supplier_id and p.workspace_id=shop_id and p.kind='supplier';
 if not found then raise exception 'Supplier unavailable';end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by (value->>'product_id')::uuid) into canonical from jsonb_array_elements(items);
 payload:=jsonb_build_object('items',canonical,'expected_at',expected_at,'note',coalesce(order_note,''),'supplier_id',supplier_id);
 perform pg_advisory_xact_lock(hashtextextended(order_id::text,0));
 select * into prior from public.gestion_purchase_orders o where o.id=order_id;
 if found then
  if prior.workspace_id<>shop_id or prior.actor_id<>actor or prior.payload<>payload then raise exception 'Purchase identity already used';end if;
  return prior;
 end if;
 perform public.gestion_submit_receipt(order_id,shop_id,left('Commande '||supplier.name,160),canonical);
 insert into public.gestion_purchase_orders(id,workspace_id,supplier_id,actor_id,supplier_snapshot,payload,expected_at) values(order_id,shop_id,supplier_id,actor,jsonb_build_object('name',supplier.name,'details',supplier.details),payload,expected_at) returning * into result;
 return result;
end;$$;
create function public.gestion_replenishment_needs(shop_id uuid)
returns table(product_id uuid,reference text,description text,quantity bigint,expected bigint,proposed bigint) language sql stable security invoker set search_path='' as $$
 select s.product_id,p.reference,p.description,s.quantity,coalesce(a.pending,0)::bigint,greatest(0,-s.quantity-coalesce(a.pending,0))::bigint
 from public.gestion_stock s join public.scanette_products p on p.id=s.product_id
 left join (select l.product_id,sum(l.expected-l.accepted) as pending from public.gestion_receipt_lines l join public.gestion_receipts r on r.id=l.receipt_id where r.workspace_id=shop_id and r.status<>'received' group by l.product_id) a on a.product_id=s.product_id
 where s.workspace_id=shop_id and s.quantity<0 order by p.reference;
$$;
create function public.gestion_adjust_stock(operation_id uuid,product_id uuid,delta bigint,expected_updated_at timestamptz,reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shop uuid; current public.gestion_stock; prior public.gestion_operations; payload jsonb;
begin
 select p.workspace_id into shop from public.scanette_products p where p.id=product_id;
 if actor is null or shop is null or not exists(select 1 from public.scanette_members where workspace_id=shop and user_id=actor and role in ('operator','admin')) then raise exception 'Access denied' using errcode='42501';end if;
 if operation_id is null or delta is null or delta=0 or delta not between -1000000 and 1000000 or reason is null or length(btrim(reason)) not between 1 and 500 then raise exception 'Invalid adjustment';end if;
 payload:=jsonb_build_object('product_id',product_id,'delta',delta,'expected_updated_at',expected_updated_at,'reason',btrim(reason));
 perform pg_advisory_xact_lock(hashtextextended(operation_id::text,1));
 select * into prior from public.gestion_operations o where o.id=operation_id;
 if found then
  if prior.actor_id<>actor or prior.workspace_id<>shop or prior.kind<>'adjustment' or prior.payload<>payload then raise exception 'Operation identity already used';end if;
  return;
 end if;
 select * into current from public.gestion_stock s where s.product_id=gestion_adjust_stock.product_id for update;
 if not found or current.quantity is null then raise exception 'Stock unknown';end if;
 if expected_updated_at is distinct from current.updated_at then raise exception 'Stock changed' using errcode='40001';end if;
 insert into public.gestion_operations(id,workspace_id,actor_id,kind,payload) values(operation_id,shop,actor,'adjustment',payload);
 insert into public.gestion_movements values(operation_id,product_id,delta);
 update public.gestion_stock s set quantity=quantity+delta,updated_at=clock_timestamp() where s.product_id=gestion_adjust_stock.product_id;
end;$$;
revoke all on function public.gestion_create_purchase(uuid,uuid,uuid,jsonb,timestamptz,text),public.gestion_replenishment_needs(uuid),public.gestion_adjust_stock(uuid,uuid,bigint,timestamptz,text) from public,anon;
grant execute on function public.gestion_create_purchase(uuid,uuid,uuid,jsonb,timestamptz,text),public.gestion_replenishment_needs(uuid),public.gestion_adjust_stock(uuid,uuid,bigint,timestamptz,text) to authenticated;
commit;
