-- Business conflicts must not use SQLSTATE 40001: PostgREST can retry forever.
-- Change only the error code. Keep function identity, owner, ACL and security settings.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $fix$
declare f record;
begin
 for f in select p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('delivery_position_write','gestion_save_store_settings','gestion_save_team_member','gestion_save_partner','gestion_validate_sale','gestion_save_sale_draft','gestion_sale_action','gestion_adjust_stock','logistics_save_session')
 and p.prosrc like '%40001%'
 loop
  execute replace(f.definition,quote_literal('40001'),quote_literal('PT409'));
  if exists(select 1 from pg_proc p where p.oid=f.oid and
   (p.proowner<>f.proowner or p.proacl is distinct from f.proacl or p.prosecdef<>f.prosecdef or p.proconfig is distinct from f.proconfig or p.prosrc like '%40001%'))
  then raise exception 'Migration invariant failed';end if;
 end loop;
end $fix$;
commit;
