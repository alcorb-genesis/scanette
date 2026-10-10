-- Second half of the compatibility check: see returns-actions.compat.before.sql.
select pg_temp.expect('the migration is applied in this session',to_regclass('public.returns_line_actions') is not null and to_regproc('public.shared_return_receive') is not null);

-- 1. The readings of the current screen are unchanged.
select pg_temp.expect('shared_returns answers exactly the same dossiers: documents, versions and dates untouched',
 (select jsonb_agg(to_jsonb(r) order by r.id) from public.shared_returns(1000,current_setting('t.token')) r where r.id::text like 'f0000000%')=(select answer from compat_before where what='returns'));
select pg_temp.expect('shared_return_events: same lines, same order, same values in every column the current screen reads — '||c.id,
 (select jsonb_agg(to_jsonb(e)-'line_id'-'action_kind'-'action_from'-'action_to'-'actor_label' order by e.created_at,e.event_kind desc) from public.shared_return_events(c.id,current_setting('t.token')) e)=(select answer from compat_before where what='events:'||c.id))
 from public.returns_cases c where c.id::text like 'f0000000%';
select pg_temp.expect('the new journal columns are empty on former lines',(select bool_and(e.line_id is null and e.action_kind is null and e.action_from is null and e.action_to is null and e.actor_label is null) from public.returns_cases c cross join lateral public.shared_return_events(c.id,current_setting('t.token')) e where c.id::text like 'f0000000%'));
select pg_temp.expect('the model answer read by the current screen is still 2',public.shared_returns_model(current_setting('t.token'))=2 and to_jsonb(2)=(select answer from compat_before where what='model'));
select pg_temp.expect('no dossier was rewritten and no decision invented',(select count(*)=0 from public.returns_line_actions) and (select count(*)=0 from public.returns_shipments) and (select count(*)=10 from public.returns_case_events where case_id::text like 'f0000000%'));

-- 2. What the current screen writes, as the visitor role with a session.
set local role anon;
create function pg_temp.doc(dossier text) returns jsonb language sql as $t$ select r.document from public.shared_returns(1000,current_setting('t.token')) r where r.id=dossier::uuid $t$;
create function pg_temp.save(dossier text,d jsonb) returns text language plpgsql as $t$
begin perform public.shared_save_return(dossier::uuid,(select r.version from public.shared_returns(1000,current_setting('t.token')) r where r.id=dossier::uuid),d,'',current_setting('t.token')); return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end;$t$;
select pg_temp.expect('assign a collector to a former dossier',pg_temp.save('f0000000-0000-4000-8000-000000000002',pg_temp.doc('f0000000-0000-4000-8000-000000000002')||'{"collector":"serge"}')='ok');
select pg_temp.expect('mark it collected',pg_temp.save('f0000000-0000-4000-8000-000000000002',pg_temp.doc('f0000000-0000-4000-8000-000000000002')||'{"status":"collected"}')='ok');
select pg_temp.expect('edit a requested dossier (lines included)',pg_temp.save('f0000000-0000-4000-8000-000000000001',jsonb_set(pg_temp.doc('f0000000-0000-4000-8000-000000000001'),'{lines,0,quantity}','3'))='ok');
select pg_temp.expect('close the former credited dossier and the former received one',pg_temp.save('f0000000-0000-4000-8000-000000000005',pg_temp.doc('f0000000-0000-4000-8000-000000000005')||'{"status":"closed"}')='ok' and pg_temp.save('f0000000-0000-4000-8000-000000000004',pg_temp.doc('f0000000-0000-4000-8000-000000000004')||'{"status":"closed"}')='ok');
select pg_temp.expect('KNOWN CHANGE: the current screen can no longer type a received quantity — refused with an explicit message, nothing is lost',
 pg_temp.save('f0000000-0000-4000-8000-000000000003',jsonb_set(pg_temp.doc('f0000000-0000-4000-8000-000000000003'),'{lines,0,received_quantity}','1')) like '22023 Received quantity is set by the reception%'
 and pg_temp.doc('f0000000-0000-4000-8000-000000000003')->'lines'->0->>'received_quantity' is null);
select pg_temp.expect('the same dossier is received through the server reception instead',(select line_id='a' from public.shared_return_receive('f0000000-0000-4000-8000-000000000003','ZZ-C-3','',current_setting('t.token'))) and pg_temp.save('f0000000-0000-4000-8000-000000000003',pg_temp.doc('f0000000-0000-4000-8000-000000000003')||'{"status":"received"}')='ok');
select pg_temp.expect('a former received dossier keeps its quantities as the limit of its decisions',pg_temp.err($q$select public.shared_return_action_add('f0000000-0000-4000-8000-000000000003','a','damaged',2,null,'','x','',current_setting('t.token'))$q$) like '22023 Quantity exceeds what was received%');

-- 3. Effective rights, without the session.
select pg_temp.expect('visitor without session: '||f,pg_temp.err(f) like 'PT401%') from unnest(array[
 $q$select * from public.shared_returns(10,null)$q$,$q$select * from public.shared_return_events('f0000000-0000-4000-8000-000000000001',null)$q$,$q$select public.shared_returns_model(null)$q$,
 $q$select * from public.shared_return_actions(null)$q$,$q$select * from public.shared_return_shipments(null)$q$,$q$select * from public.shared_return_receive('f0000000-0000-4000-8000-000000000003','ZZ-C-3','',null)$q$,
 $q$select * from public.shared_return_receive_line('f0000000-0000-4000-8000-000000000003','a',0,'x','',null)$q$,$q$select public.shared_return_action_add('f0000000-0000-4000-8000-000000000004','a','damaged',1,null,'','x','',null)$q$,
 $q$select public.shared_return_action_move(gen_random_uuid(),'cancelled','x',null,'',null)$q$,$q$select public.shared_return_shipment_open('e0000000-0000-4000-8000-000000000002','',null)$q$,
 $q$select public.shared_return_pack(gen_random_uuid(),'X','',null)$q$,$q$select public.shared_return_shipment_send(gen_random_uuid(),'','',null)$q$,
 $q$select * from public.shared_save_return(gen_random_uuid(),0,'{}'::jsonb,'',null)$q$,$q$select * from public.shared_returns(10,'0000000000000000000000000000000000000000000000000000000000000000')$q$]) f;
select pg_temp.expect('visitor: no table of the returns can be read or written — '||t,pg_temp.err('select 1 from public.'||t||' limit 1') like '42501%' and pg_temp.err('delete from public.'||t) like '42501%')
 from unnest(array['returns_cases','returns_case_events','returns_line_actions','returns_shipments','returns_public_requests','returns_public_portals']) t;
select pg_temp.expect('visitor: internal functions closed — '||f,pg_temp.err(f) like '42501%') from unnest(array[
 $q$select public.returns_apply_case(gen_random_uuid(),null,null,gen_random_uuid(),0,'{}','')$q$,$q$select public.returns_matching_lines(gen_random_uuid(),'{}','x')$q$,$q$select public.returns_actor_label('x')$q$,
 $q$select public.returns_collector_label('serge')$q$,$q$select public.returns_regroup_legacy()$q$,$q$select public.returns_save_case(gen_random_uuid(),gen_random_uuid(),0,'{}','')$q$]) f;
-- The garage portal: it creates its own request and reads nothing, not even that request.
select set_config('t.req',public.returns_public_submit(current_setting('t.shop')::uuid,'f0000000-0000-4000-8000-0000000000aa','e0000000-0000-4000-8000-000000000001',null,'Carton accueil','[{"reference":"ZZ-P-1","quantity":1}]')::text,false);
select pg_temp.expect('portal: one uuid back, the same on a retry',current_setting('t.req')='f0000000-0000-4000-8000-0000000000aa' and public.returns_public_submit(current_setting('t.shop')::uuid,'f0000000-0000-4000-8000-0000000000aa','e0000000-0000-4000-8000-000000000001',null,'Carton accueil','[{"reference":"ZZ-P-1","quantity":1}]')::text=current_setting('t.req'));
select pg_temp.expect('portal: the id of an existing internal dossier cannot be reused or probed',pg_temp.err(format($q$select public.returns_public_submit(%L,'f0000000-0000-4000-8000-000000000004',null,'Garage X','Carton accueil','[{"reference":"ZZ-P-1","quantity":1}]')$q$,current_setting('t.shop'))) like '22023 Invalid request%');
select pg_temp.expect('portal: the garage list answers id and name only',(select bool_and((to_jsonb(g)-'id'-'name')='{}'::jsonb) from public.returns_public_garages(current_setting('t.shop')::uuid) g));
reset role;
select pg_temp.expect('functions the visitor may call without a session are exactly the three of the portal',
 (select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname ~ 'return' and has_function_privilege('anon',p.oid,'execute') and not coalesce('session_token'=any(p.proargnames),false))
 =array['returns_public_designation','returns_public_garages','returns_public_submit']);
select pg_temp.expect('the portal request arrived as a plain dossier, unseen by its sender',(select document->>'status'='requested' and document->>'source'='public_portal' from public.returns_cases where id='f0000000-0000-4000-8000-0000000000aa'));
select pg_temp.expect('accounts and visitors hold no right on the new tables',not exists(select 1 from unnest(array['anon','authenticated']) r, unnest(array['returns_line_actions','returns_shipments']) t, unnest(array['select','insert','update','delete']) p where has_table_privilege(r,'public.'||t,p)));
-- A signed-in account that is not a member of the shop (no internal contract).
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000dead',true);select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect('account without membership: sees no dossier and no journal line, cannot save, cannot reach the new tables',
 (select count(*)=0 from public.returns_cases) and (select count(*)=0 from public.returns_case_events)
 and pg_temp.err(format($q$select public.returns_save_case(%L,'f0000000-0000-4000-8000-000000000001',1,'{}'::jsonb,'')$q$,current_setting('t.shop'))) like '42501%'
 and pg_temp.err('select 1 from public.returns_line_actions limit 1') like '42501%' and pg_temp.err('select 1 from public.returns_shipments limit 1') like '42501%'
 and pg_temp.err($q$select * from public.shared_return_actions(null)$q$) like 'PT401%' and pg_temp.err($q$select public.returns_apply_case(gen_random_uuid(),null,null,gen_random_uuid(),0,'{}','')$q$) like '42501%');
reset role;
rollback;
select 'returns-actions compatibility: all checks passed (rolled back)' as result;
