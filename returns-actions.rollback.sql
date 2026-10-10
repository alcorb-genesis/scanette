-- Retour arrière de returns-actions.sql. À n'utiliser que si l'écran précédent doit être remis en service.
-- Apply by hand, as postgres, in the Supabase SQL Editor (whole file, once). No BEGIN/COMMIT.
-- The functions of the decisions are removed and the former guard and journal reading come back.
-- NOTHING is deleted: the tables returns_line_actions and returns_shipments, the journal columns and
-- the journal lines of the decisions are kept, so that returns-actions.sql can be applied again later
-- without loss. A dossier can then be closed again even if decisions were still running.
drop function if exists public.shared_return_actions(text);
drop function if exists public.shared_return_shipments(text);
drop function if exists public.shared_return_action_add(uuid,text,text,integer,uuid,text,text,text,text);
drop function if exists public.shared_return_action_move(uuid,text,text,integer,text,text);
drop function if exists public.shared_return_shipment_open(uuid,text,text);
drop function if exists public.shared_return_pack(uuid,text,text,text);
drop function if exists public.shared_return_shipment_send(uuid,text,text,text);
drop function if exists public.returns_action_log(public.returns_line_actions,text,text,text);
drop function if exists public.returns_actor_label(text);
create or replace function public.returns_cases_guard() returns trigger language plpgsql set search_path='' as $repclick_fn$
begin
 if coalesce(new.document->>'status','') not in ('requested','collected','received','supplier_pending','credited','closed','cancelled') then raise exception 'Invalid return status' using errcode='22023'; end if;
 if new.document ? 'collector' and (jsonb_typeof(new.document->'collector')<>'string' or (new.document->>'collector'<>'' and public.returns_collector_label(new.document->>'collector') is null)) then raise exception 'Invalid collector' using errcode='22023'; end if;
 return new;
end;$repclick_fn$;
drop function if exists public.shared_return_events(uuid,text);
create function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text,from_collector text,to_collector text)
language plpgsql stable security definer set search_path='' as $repclick_fn$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source,e.from_collector,e.to_collector from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at,e.event_kind desc limit 300;
end;$repclick_fn$;
revoke all on function public.returns_cases_guard() from public,anon,authenticated;
revoke all on function public.shared_return_events(uuid,text) from public;
grant execute on function public.shared_return_events(uuid,text) to anon,authenticated;
