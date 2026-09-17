-- All write tests roll back. Run as postgres in the Supabase SQL editor.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);
set local role authenticated;
do $$
declare p public.scanette_products%rowtype; rejected boolean:=false;
begin
 if (select count(*) from public.scanette_products)<>14604 then raise exception 'Member catalog count mismatch'; end if;
 select * into p from public.scanette_products order by id limit 1;
 perform public.scanette_set_location(p.id,'TEST-ROLLBACK',p.updated_at);
 if (select location from public.scanette_products where id=p.id)<>'TEST-ROLLBACK' then raise exception 'Location update failed'; end if;
 begin perform public.scanette_set_location(p.id,'STALE',p.updated_at); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale write was accepted'; end if;
end;$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
 if (select count(*) from public.scanette_products)<>0 then raise exception 'Nonmember can read products'; end if;
 if (select count(*) from public.scanette_members)<>0 then raise exception 'Nonmember can read members'; end if;
 begin perform public.scanette_set_location('000e4aa8-47b8-572d-bdf0-8ef8f8bc58b0','UNAUTHORIZED',now()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Nonmember can update location'; end if;
end;$$;
reset role;
rollback;
select 'PASS: authorized read/write, rejected stale write and nonmember access; all test edits rolled back' as result,
 (select count(*) from public.scanette_products) as products,
 (select count(*) from public.scanette_products where location is not null) as assigned_locations,
 (select count(*) from public.scanette_location_events) as location_events;
