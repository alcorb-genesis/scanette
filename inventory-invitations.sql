-- Only immutable article lists are shared. Counts and employee names stay on the phone.
begin;
create table public.inventory_invites(
 id uuid primary key,workspace_id uuid not null references public.scanette_workspaces(id),
 created_by uuid not null references auth.users(id),secret_hash text not null,
 document jsonb not null,expires_at timestamptz not null,revoked boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.inventory_invites enable row level security;
revoke all on public.inventory_invites from public,anon,authenticated;
create function public.inventory_create_invite(shop uuid,invite_id uuid,secret text,document jsonb,valid_days integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare item jsonb; clean_rows jsonb:='[]'; clean jsonb; old public.inventory_invites; hash text;
begin
 if auth.uid() is null or not exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=auth.uid() and m.role='admin') then raise exception 'Administrator required' using errcode='42501';end if;
 if invite_id is null or secret is null or secret !~ '^[0-9a-f]{64}$' or valid_days is null or valid_days not between 1 and 14 or jsonb_typeof(document) is distinct from 'object' or octet_length(document::text)>10000000 then raise exception 'Invalid invitation';end if;
 if length(btrim(coalesce(document->>'title',''))) not between 1 and 180 or jsonb_typeof(document->'rows') is distinct from 'array' then raise exception 'Invalid list';end if;
 if jsonb_array_length(document->'rows') not between 1 and 20000 then raise exception 'Invalid list size';end if;
 for item in select value from jsonb_array_elements(document->'rows') loop
  if jsonb_typeof(item) is distinct from 'object' or length(btrim(coalesce(item->>'id',''))) not between 1 and 128 or length(btrim(coalesce(item->>'reference',''))) not between 1 and 120 or length(btrim(coalesce(item->>'brand',''))) not between 1 and 120 or length(btrim(coalesce(item->>'range',''))) not between 1 and 120 or length(coalesce(item->>'description',''))>500 or length(coalesce(item->>'location',''))>160 or length(coalesce(item->>'internal_barcode',''))>128 or length(coalesce(item->>'manufacturer_barcode',''))>128 then raise exception 'Invalid article';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',x.value->>'id','reference',x.value->>'reference','brand',x.value->>'brand','range',x.value->>'range','description',coalesce(x.value->>'description',''),'location',coalesce(x.value->>'location',''),'internal_barcode',coalesce(x.value->>'internal_barcode',''),'manufacturer_barcode',coalesce(x.value->>'manufacturer_barcode',''))) into clean_rows from jsonb_array_elements(document->'rows') as x(value);
 if (select count(distinct x->>'id') from jsonb_array_elements(clean_rows) x)<>jsonb_array_length(clean_rows) then raise exception 'Duplicate identifiers';end if;
 clean:=jsonb_build_object('title',btrim(document->>'title'),'rows',clean_rows);hash:=encode(extensions.digest(secret,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(invite_id::text,0));
 select * into old from public.inventory_invites where id=invite_id;
 if found then
  if old.workspace_id<>shop or old.created_by<>auth.uid() or old.secret_hash<>hash or old.document<>clean or old.revoked then raise exception 'Invitation conflict';end if;
  return old.id;
 end if;
 insert into public.inventory_invites(id,workspace_id,created_by,secret_hash,document,expires_at) values(invite_id,shop,auth.uid(),hash,clean,clock_timestamp()+valid_days*interval '1 day');return invite_id;
end;$$;
create function public.inventory_read_invite(invite_id uuid,secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if secret is null or secret !~ '^[0-9a-f]{64}$' then return null;end if;
 select i.document into result from public.inventory_invites i where i.id=invite_id and i.secret_hash=encode(extensions.digest(secret,'sha256'),'hex') and not i.revoked and i.expires_at>clock_timestamp() and exists(select 1 from public.scanette_members m where m.workspace_id=i.workspace_id and m.user_id=i.created_by and m.role='admin');return result;
end;$$;
create function public.inventory_list_invites(shop uuid) returns table(id uuid,title text,article_count integer,expires_at timestamptz,revoked boolean) language sql security definer set search_path='' as $$
 select i.id,i.document->>'title',jsonb_array_length(i.document->'rows'),i.expires_at,i.revoked from public.inventory_invites i where i.workspace_id=shop and exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=auth.uid() and m.role='admin') order by i.created_at desc limit 100;
$$;
create function public.inventory_revoke_invite(invite_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.inventory_invites i set revoked=true where i.id=invite_id and exists(select 1 from public.scanette_members m where m.workspace_id=i.workspace_id and m.user_id=auth.uid() and m.role='admin');if not found then raise exception 'Access denied' using errcode='42501';end if;
end;$$;
revoke all on function public.inventory_create_invite(uuid,uuid,text,jsonb,integer),public.inventory_read_invite(uuid,text),public.inventory_list_invites(uuid),public.inventory_revoke_invite(uuid) from public,anon,authenticated;
grant execute on function public.inventory_create_invite(uuid,uuid,text,jsonb,integer),public.inventory_list_invites(uuid),public.inventory_revoke_invite(uuid) to authenticated;
grant execute on function public.inventory_read_invite(uuid,text) to anon,authenticated;
commit;
