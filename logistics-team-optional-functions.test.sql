begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);
set local role authenticated;
do $$declare r public.gestion_team;begin
 r:=public.gestion_save_team_member('8770297c-cadb-4cc6-8b93-55a0f9bd154e',gen_random_uuid(),0,'TEST WITHOUT FUNCTION','{}'::text[],'','');
 if cardinality(r.functions)<>0 or r.display_name<>'TEST WITHOUT FUNCTION' then raise exception 'Empty functions failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.gestion_save_team_member('8770297c-cadb-4cc6-8b93-55a0f9bd154e',r.id,1,'FORBIDDEN','{}'::text[],'','');raise exception 'Unauthorized edit';exception when insufficient_privilege then null;end;
end;$$;
rollback;
select 'PASS: team record without function, administrator-only write; test rolled back' as result;
