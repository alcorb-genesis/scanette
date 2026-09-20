-- Run in SQL Editor as postgres. Every test write rolls back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);
set local role authenticated;
do $$
declare p uuid; rid uuid:=gen_random_uuid(); oid uuid:=gen_random_uuid(); known bigint; blocked boolean:=false;
begin
 select id into p from public.scanette_products where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' order by id limit 1;
 perform public.gestion_submit_receipt(rid,'8770297c-cadb-4cc6-8b93-55a0f9bd154e','TEST TRANSACTION ANNULEE',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)));
 perform public.gestion_submit_receipt(rid,'8770297c-cadb-4cc6-8b93-55a0f9bd154e','TEST TRANSACTION ANNULEE',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)));
 perform public.gestion_accept_receipt(rid,oid,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)));
 perform public.gestion_accept_receipt(rid,oid,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)));
 if (select accepted from public.gestion_receipt_lines where receipt_id=rid)<>1 then raise exception 'Duplicate receipt movement'; end if;
 begin
  perform public.gestion_accept_receipt(rid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3)));
 exception when others then blocked:=true; end;
 if not blocked then raise exception 'Over receipt accepted'; end if;
 perform public.gestion_accept_receipt(rid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2)));
 if (select status from public.gestion_receipts where id=rid)<>'received' then raise exception 'Incomplete receipt'; end if;
 blocked:=false;
 begin update public.gestion_stock set quantity=99 where product_id=p;
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Direct write permitted';end if;
end;$$;
rollback;
select 'transaction tests completed and rolled back' as result,(select count(*) from public.gestion_receipts) as persisted_receipts,(select count(*) from public.scanette_products) as catalogue_products;
