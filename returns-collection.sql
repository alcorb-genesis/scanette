-- Validation server-side for collection assignment stored in return documents.
begin;
create or replace function public.returns_validate_collection_assignment()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.document ? 'collection_carrier' and coalesce(new.document->>'collection_carrier','') not in ('','SERGE','PAKETO','ACE','DAMIEN','LUDOVIC','CEDRIC','MAXIME','CHARLIE') then raise exception 'Invalid collection carrier'; end if;
 if new.document ? 'collection_done' and jsonb_typeof(new.document->'collection_done')<>'boolean' then raise exception 'Invalid collection state'; end if;
 return new;
end;$$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='returns_collection_assignment_check' and not tgisinternal) then
  create trigger returns_collection_assignment_check before insert or update of document on public.returns_cases for each row execute function public.returns_validate_collection_assignment();
 end if;
end $$;
commit;