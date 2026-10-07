-- Run after returns-workflow.sql. All writes are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);
set local role authenticated;
do $$ declare w uuid:='8770297c-cadb-4cc6-8b93-55a0f9bd154e'; c uuid:=gen_random_uuid(); got public.returns_cases; doc jsonb:=jsonb_build_object('type','return','status','requested','client_name','TEST ROLLED BACK','supplier_name','','lines',jsonb_build_array(jsonb_build_object('id','line-1','product_id',null,'reference','MANUAL-1','description','Manual reference','quantity',2,'received_quantity',null,'condition','','reason',''))); blocked boolean:=false; begin
 got:=public.returns_save_case(w,c,0,doc,'test'); if got.version<>1 then raise exception 'Creation failed'; end if;
 got:=public.returns_save_case(w,c,0,doc,'retry'); if got.version<>1 then raise exception 'Retry duplicated'; end if;
 begin perform public.returns_save_case(w,c,1,jsonb_set(doc,'{status}','"credited"'),'skip'); exception when others then blocked:=true; end; if not blocked then raise exception 'Illegal transition accepted'; end if;
 got:=public.returns_save_case(w,c,1,jsonb_set(doc,'{status}','"collected"'),'collected'); if got.version<>2 then raise exception 'Transition failed'; end if;
 begin update public.returns_cases set version=99 where id=c; exception when insufficient_privilege then blocked:=true; end; if not blocked then raise exception 'Direct write accepted'; end if;
end $$;
rollback;
select 'PASS: return case creation, replay, workflow transition and direct-write denial verified; rolled back' as result;
