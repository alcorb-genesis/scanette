-- The private-link portal (returns-portal.sql) is replaced by returns-public-portal.sql.
-- Run after returns-public-portal.sql: its functions must no longer be callable by the app roles.
begin;
do $$ declare fn text; denied integer:=0; begin
 foreach fn in array array['returns_portal_profile(text)','returns_portal_submit(text,text,jsonb,text)','returns_portal_issue_link(uuid,uuid)','returns_portal_revoke_client_links(uuid,uuid)'] loop
  if not has_function_privilege('anon','public.'||fn,'execute') and not has_function_privilege('authenticated','public.'||fn,'execute') then denied:=denied+1; end if;
 end loop;
 if denied<>4 then raise exception 'Private-link portal functions are still executable'; end if;
 if to_regclass('public.returns_portal_tokens') is null then raise exception 'Token table was dropped; it must be kept'; end if;
end $$;
rollback;
select 'PASS: private-link portal closed, token table kept; rolled back' as result;
