-- Retour arrière de returns-roles.sql. À n'utiliser que si l'écran précédent doit être remis en service.
-- Apply by hand, as postgres, in the Supabase SQL Editor (whole file, once). No BEGIN/COMMIT.
-- The functions of the role screens and the automatic closing are removed; the former guard comes back
-- (a collector can again be corrected until the reception).
-- NOTHING is deleted: dossiers, journal lines and the rows of returns_line_actions are kept, including
-- the parts declared missing and the warranty parts still without supplier. For that reason the three
-- relaxed constraints of returns_line_actions stay as returns-roles.sql left them: putting the former
-- ones back would refuse rows that exist. returns-roles.sql can be applied again later without loss.
drop trigger if exists returns_line_actions_done on public.returns_line_actions;
drop function if exists public.returns_line_actions_done();
drop function if exists public.shared_returns_flow(text);
drop function if exists public.shared_return_plan(uuid,text,text,text,integer,text,text);
drop function if exists public.shared_return_taken(uuid,integer,text,text);
drop function if exists public.shared_return_set_type(uuid,text,text,text);
drop function if exists public.shared_return_identify(uuid,text,text);
drop function if exists public.shared_return_receive_part(uuid,text,text,text,text,text);
drop function if exists public.shared_return_qualify(uuid,text,text,text,text,text);
drop function if exists public.shared_return_finish(uuid,text[],text,text);
drop function if exists public.shared_return_credit_issue(uuid,text,integer,text,text);
drop function if exists public.shared_return_action_supplier(uuid,uuid,integer,text,text);
drop function if exists public.shared_return_gap_resolve(uuid,text,integer,text,text);
drop function if exists public.returns_public_submit_typed(uuid,uuid,uuid,text,text,jsonb,text);
drop function if exists public.returns_route_unit(public.returns_cases,text,text,text,text);
drop function if exists public.returns_close_if_done(uuid);
drop function if exists public.returns_unqualified(uuid,jsonb);

-- The guard of returns-actions.sql, unchanged.
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 if tg_op='UPDATE' and new.document->>'status' in ('closed','cancelled') and old.document->>'status' is distinct from new.document->>'status'
  and exists(select 1 from public.returns_line_actions a where a.case_id=new.id and a.status in ('to_send','packed','to_do','issued','open')) then raise exception 'Open decisions remain' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;
revoke all on function public.returns_cases_guard() from public,anon,authenticated;
