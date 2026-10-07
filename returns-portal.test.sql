-- Run after returns-workflow.sql and returns-portal.sql. All rows are rolled back.
begin;
do $$ declare w uuid:='8770297c-cadb-4cc6-8b93-55a0f9bd154e'; actor uuid; garage uuid; raw text; profile_name text; submitted uuid; denied boolean:=false; begin
 select user_id into actor from public.scanette_members where workspace_id=w and role='admin' limit 1;
 select id into garage from public.gestion_partners where workspace_id=w and kind='client' and not coalesce((details->>'archived')::boolean,false) limit 1;
 if actor is null or garage is null then raise exception 'Missing test member or client'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true); set local role authenticated;
 raw:=public.returns_portal_issue_link(w,garage);
 reset role;
 select client_name into profile_name from public.returns_portal_profile(raw);
 if profile_name is null then raise exception 'Portal profile unavailable'; end if;
 submitted:=public.returns_portal_submit(raw,'deposit',jsonb_build_array(jsonb_build_object('id','test-line','reference','CONSIGNE-TEST','quantity',1)),'test');
 if not exists(select 1 from public.returns_cases where id=submitted and document->>'type'='deposit' and document->>'client_id'=garage::text) then raise exception 'Portal submission missing'; end if;
 begin perform public.returns_portal_profile(repeat('0',64)); exception when others then denied:=true; end;
 if exists(select 1 from public.returns_portal_profile(repeat('0',64))) then raise exception 'Unknown token disclosed data'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true); set local role authenticated;
 perform public.returns_portal_revoke_client_links(w,garage);
 reset role;
 if exists(select 1 from public.returns_portal_profile(raw)) then raise exception 'Revoked token still works'; end if;
end $$;
rollback;
select 'PASS: private client portal profile, deposit submission and revocation verified; rolled back' as result;
