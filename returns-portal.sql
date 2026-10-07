-- Client portal for returns, deposits and warranties.
-- Prerequisite: returns-workflow.sql has been applied. Run as postgres in Supabase SQL Editor.
begin;

alter table public.returns_cases alter column created_by drop not null;
alter table public.returns_cases alter column updated_by drop not null;
alter table public.returns_case_events alter column actor_id drop not null;

create table if not exists public.returns_portal_tokens (
 token_hash text primary key check(length(token_hash)=64),
 workspace_id uuid not null references public.scanette_workspaces(id),
 client_id uuid not null references public.gestion_partners(id),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.returns_portal_tokens enable row level security;
revoke all on public.returns_portal_tokens from public,anon,authenticated;

create or replace function public.returns_portal_issue_link(shop_id uuid,garage_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); raw text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 if not exists(select 1 from public.scanette_members where workspace_id=shop_id and user_id=actor and role in ('operator','admin')) then raise exception 'Denied'; end if;
 if not exists(select 1 from public.gestion_partners where id=garage_id and workspace_id=shop_id and kind='client' and not coalesce((details->>'archived')::boolean,false)) then raise exception 'Unknown client'; end if;
 insert into public.returns_portal_tokens(token_hash,workspace_id,client_id,expires_at,created_by) values(encode(extensions.digest(raw,'sha256'),'hex'),shop_id,garage_id,clock_timestamp()+interval '90 days',actor);
 return raw;
end;$$;

create or replace function public.returns_portal_profile(portal_token text)
returns table(client_name text) language sql security definer set search_path='' as $$
 select p.name from public.returns_portal_tokens t join public.gestion_partners p on p.id=t.client_id
 where t.token_hash=encode(extensions.digest(portal_token,'sha256'),'hex') and t.revoked_at is null and t.expires_at>clock_timestamp() and not coalesce((p.details->>'archived')::boolean,false)
 limit 1;
$$;

create or replace function public.returns_portal_revoke_client_links(shop_id uuid,garage_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if not exists(select 1 from public.scanette_members where workspace_id=shop_id and user_id=actor and role in ('operator','admin')) then raise exception 'Denied'; end if;
 update public.returns_portal_tokens set revoked_at=clock_timestamp() where workspace_id=shop_id and client_id=garage_id and revoked_at is null;
end;$$;

create or replace function public.returns_portal_submit(portal_token text,case_type text,case_lines jsonb,case_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare token public.returns_portal_tokens; partner public.gestion_partners; case_id uuid:=gen_random_uuid(); line jsonb; doc jsonb; count_lines integer;
begin
 select * into token from public.returns_portal_tokens where token_hash=encode(extensions.digest(portal_token,'sha256'),'hex') and revoked_at is null and expires_at>clock_timestamp() for update;
 if not found then raise exception 'Invalid portal link'; end if;
 select * into partner from public.gestion_partners where id=token.client_id and workspace_id=token.workspace_id and kind='client' and not coalesce((details->>'archived')::boolean,false);
 if not found or case_type not in ('return','deposit','warranty') or jsonb_typeof(case_lines)<>'array' or jsonb_array_length(case_lines) not between 1 and 200 or length(coalesce(case_note,''))>1000 then raise exception 'Invalid return'; end if;
 for line in select value from jsonb_array_elements(case_lines) loop
  if jsonb_typeof(line)<>'object' or length(trim(coalesce(line->>'reference','')))<1 or length(trim(coalesce(line->>'reference','')))>120 or coalesce((line->>'quantity')::integer,0) not between 1 and 100000 then raise exception 'Invalid line'; end if;
 end loop;
 doc:=jsonb_build_object('type',case_type,'status','requested','client_id',partner.id,'client_name',partner.name,'supplier_id',null,'supplier_name','','lines',(select jsonb_agg(jsonb_build_object('id',coalesce(value->>'id',gen_random_uuid()::text),'product_id',null,'reference',upper(trim(value->>'reference')),'description','','quantity',(value->>'quantity')::integer,'received_quantity',null,'condition','','reason','')) from jsonb_array_elements(case_lines)),'portal',true);
 insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by) values(case_id,token.workspace_id,doc,1,null,null);
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note) values(gen_random_uuid(),case_id,token.workspace_id,null,'created',null,'requested','Déposé depuis le portail garage. '||trim(coalesce(case_note,'')));
 return case_id;
end;$$;

revoke all on function public.returns_portal_issue_link(uuid,uuid),public.returns_portal_revoke_client_links(uuid,uuid),public.returns_portal_profile(text),public.returns_portal_submit(text,text,jsonb,text) from public;
grant execute on function public.returns_portal_issue_link(uuid,uuid),public.returns_portal_revoke_client_links(uuid,uuid) to authenticated;
grant execute on function public.returns_portal_profile(text),public.returns_portal_submit(text,text,jsonb,text) to anon,authenticated;
commit;
