-- Execute after gestion-settings.sql. All temporary writes roll back.
begin;
do $$begin perform set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);end;$$;
set local role authenticated;
do $$declare initial integer; row_data public.gestion_store_settings; blocked boolean:=false;begin
 select coalesce(max(version),0) into initial from public.gestion_store_settings where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
 row_data:=public.gestion_save_store_settings('8770297c-cadb-4cc6-8b93-55a0f9bd154e',initial,'{"display_name":"TEST ROLLBACK","city":"Bayonne"}');
 if row_data.version<>initial+1 or row_data.updated_by<>auth.uid() then raise exception 'Incorrect revision or actor';end if;
 begin perform public.gestion_save_store_settings('8770297c-cadb-4cc6-8b93-55a0f9bd154e',initial,'{"display_name":"Stale"}');exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'Concurrent overwrite permitted';end if;
 blocked:=false;
 begin update public.gestion_store_settings set city='Direct write';exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Direct write permitted';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 if exists(select 1 from public.gestion_store_settings) then raise exception 'Outsider can read';end if;
 blocked:=false;
 begin perform public.gestion_save_store_settings('8770297c-cadb-4cc6-8b93-55a0f9bd154e',initial+1,'{"display_name":"Intruder"}');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Outsider can write';end if;
end;$$;
rollback;
select 'PASS settings transaction rolled back' as result;
