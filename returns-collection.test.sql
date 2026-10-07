-- Run after returns-workflow.sql and returns-collection.sql. All writes are rolled back.
begin;
do $$ declare w uuid:='8770297c-cadb-4cc6-8b93-55a0f9bd154e'; actor uuid; c uuid:=gen_random_uuid(); doc jsonb:=jsonb_build_object('type','return','status','requested','client_name','TEST COLLECTION','supplier_name','','collection_carrier','SERGE','collection_done',false,'lines',jsonb_build_array(jsonb_build_object('id','line-1','reference','MANUAL-1','quantity',1,'received_quantity',null,'condition','','reason',''))); begin
 select user_id into actor from public.scanette_members where workspace_id=w and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true); set local role authenticated;
 perform public.returns_save_case(w,c,0,doc,'test carrier');
 begin perform public.returns_save_case(w,gen_random_uuid(),0,jsonb_set(doc,'{collection_carrier}','"INCONNU"'),'invalid'); raise exception 'Invalid carrier accepted'; exception when others then if sqlerrm='Invalid carrier accepted' then raise; end if; end;
end $$;
rollback;
select 'PASS: transporteur et état de collecte validés; rolled back' as result;