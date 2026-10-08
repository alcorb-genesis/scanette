-- Shared logistics access behind one shared password (decision of Alexis Bertrand, 8 October 2026).
-- The logistics space asks for a single password, the same for everyone: no e-mail, no name, no PIN,
-- no Supabase account. The garage portal stays open and never reaches these functions.
-- Apply manually as postgres in the Supabase SQL Editor, then run logistics-shared-access.test.sql.
-- Not applied by the application.
--
-- THE PASSWORD IS NOT IN THIS FILE, NOR ANYWHERE IN THE REPOSITORY. After applying, set it by hand
-- (section 11). Until then nobody can enter: the shared functions answer « session required ».
--
-- Design:
--   * The password is checked on the server only (bcrypt hash in public.shared_access). The browser
--     sends it once to shared_access_open and receives a random session token, valid for a limited
--     time. Only the SHA-256 of the token is stored.
--   * Every shared_* function takes that token and refuses to work without a valid one (PT401).
--   * No table is granted to anon. The browser reaches data only through the shared_* functions below.
--   * Every function works on the single shop configured in public.shared_access, chosen on the
--     server. No function accepts a workspace id from the browser.
--   * Writes repeat the validations of the existing member RPCs. Rows written this way have no
--     author (actor null) and carry access_source='shared_access'.
--   * Out of scope, unchanged and still reserved to authenticated members: team records, shop
--     settings, memberships and roles, inventory guest links. The PIN service is closed.
--
-- Prerequisites: bellecave-schema.sql, bellecave-location.sql, warehouse-aisles.sql,
-- catalogue-enrichment.sql, gestion-schema.sql, gestion-partners.sql, logistics-sessions.sql,
-- inventory-invitations.sql, inventory-current.sql, returns-workflow.sql, auth-pin/schema.sql,
-- the legacy public.catalogue table (ean → ref) and the pgcrypto extension in schema extensions.
begin;

-- 0. The legacy barcode → reference table must have the shape the scanner uses.
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='catalogue' and column_name='ean')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='catalogue' and column_name='ref')
 or not exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
   where i.indrelid='public.catalogue'::regclass and i.indisunique and i.indnatts=1 and a.attname='ean')
 then raise exception 'public.catalogue must have columns ean, ref and a unique key on ean; adapt shared_aliases_* before applying'; end if;
end $$;

-- 1. Which shop the shared access serves, and the hash of its password. One row at most; closing it
--    closes every shared function. password_hash stays null until section 11 is done by hand.
create table if not exists public.shared_access (
 singleton boolean primary key default true check(singleton),
 workspace_id uuid not null references public.scanette_workspaces(id),
 enabled boolean not null default false
);
alter table public.shared_access add column if not exists password_hash text;
alter table public.shared_access add column if not exists session_minutes integer not null default 480;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.shared_access'::regclass and conname='shared_access_session_minutes_check') then
  alter table public.shared_access add constraint shared_access_session_minutes_check check(session_minutes between 5 and 1440);
 end if;
end $$;
alter table public.shared_access enable row level security;
revoke all on public.shared_access from public,anon,authenticated;

-- Open sessions: only the SHA-256 of each token is kept. Failed attempts: time only, to slow guessing.
create table if not exists public.shared_access_sessions (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null
);
create index if not exists shared_access_sessions_expiry on public.shared_access_sessions(expires_at);
create table if not exists public.shared_access_attempts (
 id bigint generated always as identity primary key,
 attempted_at timestamptz not null default clock_timestamp()
);
create index if not exists shared_access_attempts_time on public.shared_access_attempts(attempted_at);
alter table public.shared_access_sessions enable row level security;
alter table public.shared_access_attempts enable row level security;
revoke all on public.shared_access_sessions,public.shared_access_attempts from public,anon,authenticated;

-- The first version of this migration had functions without a session: remove them so that no
-- unprotected overload survives.
drop function if exists public.shared_shop();
do $$ declare f text; begin
 foreach f in array array[
  'shared_products_search(text,text,text,text,integer,integer)','shared_product_lookup(text)','shared_products_by_references(text[])','shared_products_by_ids(uuid[])',
  'shared_aisles()','shared_set_location(uuid,text,timestamptz)','shared_aliases_page(integer,integer)','shared_aliases_save(jsonb)',
  'shared_partners(text)','shared_save_partner(uuid,integer,text,text,jsonb,jsonb,text)',
  'shared_sessions(text,integer)','shared_session(uuid)','shared_save_session(uuid,text,integer,jsonb)',
  'shared_returns(integer)','shared_return_events(uuid)','shared_save_return(uuid,integer,jsonb,text)',
  'shared_inventory_current()','shared_inventory_lists()','shared_inventory_publish(uuid,jsonb,integer)','shared_inventory_revoke(uuid)'] loop
  execute 'drop function if exists public.'||f;
 end loop;
end $$;

-- The gate of every shared function: the access must be open AND the token must be a live session.
-- 42501 = access closed by the shop; PT401 = no session, unknown token or expired session.
create or replace function public.shared_shop(session_token text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare shop uuid;
begin
 select workspace_id into shop from public.shared_access where singleton and enabled;
 if shop is null then raise exception 'Shared access closed' using errcode='42501'; end if;
 if session_token is null or session_token !~ '^[0-9a-f]{64}$' or not exists(
  select 1 from public.shared_access_sessions s
  where s.token_hash=encode(extensions.digest(session_token,'sha256'),'hex') and s.expires_at>clock_timestamp())
 then raise exception 'Session required' using errcode='PT401'; end if;
 return shop;
end;$$;
revoke all on function public.shared_shop(text) from public,anon,authenticated;

-- Password check. A wrong password returns no row (an exception would roll back the recorded
-- attempt). More than 10 failures in 15 minutes refuse every new attempt (PT429) until they age out;
-- sessions already open keep working. The lock on the single row makes attempts sequential.
create or replace function public.shared_access_open(password text) returns table(token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare access public.shared_access%rowtype; fresh text; until timestamptz;
begin
 select * into access from public.shared_access where singleton and enabled for update;
 if not found or access.password_hash is null then raise exception 'Shared access closed' using errcode='42501'; end if;
 if password is null or length(password) not between 1 and 200 then raise exception 'Invalid password' using errcode='22023'; end if;
 delete from public.shared_access_attempts a where a.attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from public.shared_access_attempts a where a.attempted_at>clock_timestamp()-interval '15 minutes')>=10 then
  raise exception 'Too many attempts' using errcode='PT429';
 end if;
 if extensions.crypt(password,access.password_hash) is distinct from access.password_hash then
  insert into public.shared_access_attempts default values;
  return;
 end if;
 delete from public.shared_access_sessions s where s.expires_at<=clock_timestamp();
 fresh:=encode(extensions.gen_random_bytes(32),'hex');
 until:=clock_timestamp()+access.session_minutes*interval '1 minute';
 insert into public.shared_access_sessions(token_hash,expires_at) values(encode(extensions.digest(fresh,'sha256'),'hex'),until);
 token:=fresh; expires_at:=until; return next;
end;$$;

-- Leaving: the session of this browser is removed. Unknown tokens are ignored.
create or replace function public.shared_access_close(session_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if session_token ~ '^[0-9a-f]{64}$' then
  delete from public.shared_access_sessions s where s.token_hash=encode(extensions.digest(session_token,'sha256'),'hex');
 end if;
end;$$;

-- Setting or changing the password: postgres only, by hand (section 11). Every open session ends.
-- The placeholder of this file is refused, so a copy-paste without editing cannot become the password.
create or replace function public.shared_access_set_password(new_password text) returns void language plpgsql security definer set search_path='' as $$
begin
 if new_password is null or length(new_password) not between 10 and 200 then raise exception 'Password must have 10 to 200 characters' using errcode='22023'; end if;
 if new_password ~ '^<.*>$' then raise exception 'Replace the placeholder by the real password' using errcode='22023'; end if;
 update public.shared_access set password_hash=extensions.crypt(new_password,extensions.gen_salt('bf',10)) where singleton;
 if not found then raise exception 'Shared access is not configured' using errcode='22023'; end if;
 delete from public.shared_access_sessions;
 delete from public.shared_access_attempts;
end;$$;
revoke all on function public.shared_access_set_password(text) from public,anon,authenticated,service_role;

-- 2. Shared writes have no author: make the author columns optional and mark the source.
alter table public.logistics_sessions alter column created_by drop not null, alter column updated_by drop not null;
alter table public.gestion_partners alter column updated_by drop not null;
alter table public.scanette_location_events alter column actor_id drop not null;
alter table public.inventory_invites alter column created_by drop not null;
alter table public.returns_cases alter column created_by drop not null, alter column updated_by drop not null;
alter table public.returns_case_events alter column actor_id drop not null;
do $$ declare t text; begin
 foreach t in array array['logistics_sessions','gestion_partners','scanette_location_events','inventory_invites','returns_cases','returns_case_events'] loop
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='access_source') then
   execute format('alter table public.%I add column access_source text check(access_source in (''shared_access''))',t);
  end if;
 end loop;
end $$;

-- 3. Catalogue and locations -------------------------------------------------------------------
create or replace function public.shared_location_code(value text) returns text language sql immutable set search_path='' as $$
 select case when c ~ '^A[0-9]{1,3}[A-Z]?$' then c end
 from (select regexp_replace(regexp_replace(upper(btrim(coalesce(value,''))),'^(ALLEE|ALLÉE|EMPLACEMENT)\s*',''),'[\s-]+','','g') c) x;
$$;

create or replace function public.shared_products_search(search_term text default '',aisle text default '',vehicle text default '',family text default '',page_offset integer default 0,page_size integer default 40,session_token text default null)
returns table(id uuid,reference text,order_reference text,description text,internal_barcode text,manufacturer_barcode text,location text,catalogue_enrichment jsonb,updated_at timestamptz,tracked_quantity bigint,tracked_at timestamptz,total bigint)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); term text:=lower(btrim(coalesce(search_term,''))); code text:=public.shared_location_code(aisle); term_code text:=public.shared_location_code(search_term);
 v text:=lower(btrim(coalesce(vehicle,''))); f text:=lower(btrim(coalesce(family,'')));
begin
 if page_offset is null or page_offset<0 or page_offset>1000000 or page_size is null or page_size not between 1 and 500
  or length(term)>160 or length(v)>100 or length(f)>80 or (btrim(coalesce(aisle,''))<>'' and code is null) then raise exception 'Invalid search' using errcode='22023'; end if;
 return query
 select p.id,p.reference,p.order_reference,p.description,p.internal_barcode,p.manufacturer_barcode,p.location,p.catalogue_enrichment,p.updated_at,s.quantity,s.updated_at,count(*) over()
 from public.scanette_products p left join public.gestion_stock s on s.product_id=p.id and s.workspace_id=p.workspace_id
 where p.workspace_id=shop
  and (code is null or upper(coalesce(p.location,'')) ~ ('^'||code||case when code ~ '[0-9]$' then '[A-Z]?' else '' end||'$'))
  and (code is not null or term='' or position(term in lower(p.reference))>0 or position(term in lower(coalesce(p.order_reference,'')))>0
       or position(term in lower(p.description))>0 or lower(coalesce(p.location,''))=term
       or (term_code is not null and upper(coalesce(p.location,'')) ~ ('^'||term_code||case when term_code ~ '[0-9]$' then '[A-Z]?' else '' end||'$'))
       or p.internal_barcode=btrim(search_term) or p.manufacturer_barcode=btrim(search_term))
  and (v='' or position(v in lower(coalesce(p.catalogue_enrichment->>'vehicle_search','')))>0)
  and (f='' or position(f in lower(p.description))>0 or position(f in lower(coalesce(p.catalogue_enrichment->>'family_search','')))>0)
 order by p.reference,p.id offset page_offset limit page_size;
end;$$;

-- Exact match on either barcode or the reference (as typed or upper case). Never a partial match.
create or replace function public.shared_product_lookup(code text,session_token text default null)
returns table(id uuid,reference text,description text,internal_barcode text,manufacturer_barcode text,location text)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); value text:=btrim(coalesce(code,''));
begin
 if length(value) not between 1 and 256 then raise exception 'Invalid code' using errcode='22023'; end if;
 return query select p.id,p.reference,p.description,p.internal_barcode,p.manufacturer_barcode,p.location from public.scanette_products p
  where p.workspace_id=shop and (p.internal_barcode=value or p.manufacturer_barcode=value or p.reference=value or p.reference=upper(value))
  order by p.reference,p.id limit 20;
end;$$;

create or replace function public.shared_products_by_references(refs text[],session_token text default null)
returns table(id uuid,reference text,description text,location text) language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 if refs is null or cardinality(refs) not between 1 and 300 then raise exception 'Invalid references' using errcode='22023'; end if;
 return query select p.id,p.reference,p.description,p.location from public.scanette_products p where p.workspace_id=shop and p.reference=any(refs) order by p.reference,p.id limit 3000;
end;$$;

create or replace function public.shared_products_by_ids(ids uuid[],session_token text default null)
returns table(id uuid,location text) language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 if ids is null or cardinality(ids) not between 1 and 5000 then raise exception 'Invalid identifiers' using errcode='22023'; end if;
 return query select p.id,p.location from public.scanette_products p where p.workspace_id=shop and p.id=any(ids);
end;$$;

create or replace function public.shared_aisles(session_token text default null) returns table(code text,description text,notes text) language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin return query select a.code,a.description,a.notes from public.scanette_aisles a where a.workspace_id=shop order by a.code limit 1000; end;$$;

create or replace function public.shared_set_location(product_id uuid,new_location text,expected_updated_at timestamptz,session_token text default null)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); p public.scanette_products%rowtype; next_at timestamptz:=clock_timestamp();
begin
 if new_location is null or length(new_location)>160 or new_location ~ '[[:cntrl:]]' then raise exception 'Invalid location' using errcode='22023'; end if;
 select * into p from public.scanette_products x where x.id=product_id and x.workspace_id=shop for update;
 if not found then raise exception 'Product unavailable' using errcode='22023'; end if;
 if p.updated_at is distinct from expected_updated_at then raise exception 'Product changed; reload before saving' using errcode='PT409'; end if;
 update public.scanette_products set location=nullif(btrim(new_location),''),updated_at=next_at where id=p.id;
 insert into public.scanette_location_events(workspace_id,product_id,actor_id,old_location,new_location,access_source) values(shop,p.id,null,p.location,nullif(btrim(new_location),''),'shared_access');
 return next_at;
end;$$;

-- Legacy barcode → reference memory used by the scanner when Bellecave has no match.
create or replace function public.shared_aliases_page(page_offset integer default 0,page_size integer default 500,session_token text default null)
returns table(ean text,ref text) language plpgsql stable security definer set search_path='' as $$
begin
 perform public.shared_shop(session_token);
 if page_offset is null or page_offset<0 or page_size is null or page_size not between 1 and 1000 then raise exception 'Invalid page' using errcode='22023'; end if;
 return query execute 'select c.ean::text,c.ref::text from public.catalogue c order by c.ean offset $1 limit $2' using page_offset,page_size;
end;$$;

create or replace function public.shared_aliases_save(rows jsonb,session_token text default null) returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb; saved integer:=0;
begin
 perform public.shared_shop(session_token);
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 200 then raise exception 'Invalid aliases' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(rows) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'ean')<>'string' or jsonb_typeof(item->'ref')<>'string'
   or length(item->>'ean') not between 1 and 256 or length(item->>'ref') not between 1 and 120 or (item->>'ean')||(item->>'ref') ~ '[[:cntrl:]]'
  then raise exception 'Invalid alias' using errcode='22023'; end if;
  execute 'insert into public.catalogue(ean,ref) values($1,$2) on conflict(ean) do update set ref=excluded.ref' using item->>'ean',item->>'ref';
  saved:=saved+1;
 end loop;
 return saved;
end;$$;

-- 4. Partners (garages and suppliers) and their departures --------------------------------------
create or replace function public.shared_partners(partner_kind text default null,session_token text default null)
returns table(id uuid,kind text,name text,details jsonb,departures jsonb,source_key text,version integer,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 if partner_kind is not null and partner_kind not in ('client','supplier') then raise exception 'Invalid kind' using errcode='22023'; end if;
 return query select p.id,p.kind,p.name,p.details,p.departures,p.source_key,p.version,p.updated_at from public.gestion_partners p
  where p.workspace_id=shop and (partner_kind is null or p.kind=partner_kind) order by p.id limit 20000;
end;$$;

-- Same checks as gestion_save_partner; no author, marked as shared.
create or replace function public.shared_save_partner(partner_id uuid,expected_version integer,partner_kind text,partner_name text,partner_details jsonb,partner_departures jsonb,partner_source text,session_token text default null)
returns table(id uuid,kind text,name text,details jsonb,departures jsonb,source_key text,version integer,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); previous integer; slot jsonb; day jsonb;
begin
 if partner_id is null or expected_version is null or expected_version<0 or partner_kind not in ('client','supplier') or length(btrim(coalesce(partner_name,''))) not between 1 and 180
  or jsonb_typeof(partner_details) is distinct from 'object' or octet_length(partner_details::text)>20000 or jsonb_typeof(partner_departures) is distinct from 'array' or jsonb_array_length(partner_departures)>30 or length(coalesce(partner_source,''))>200
 then raise exception 'Invalid request' using errcode='22023'; end if;
 if partner_kind='supplier' and jsonb_array_length(partner_departures)>0 then raise exception 'Supplier cannot have garage departures' using errcode='22023'; end if;
 for slot in select value from jsonb_array_elements(partner_departures) loop
  if jsonb_typeof(slot) is distinct from 'object' or coalesce(slot->>'mode','') not in ('internal','external') or coalesce(slot->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or length(btrim(coalesce(slot->>'carrier',''))) not between 1 and 120 or length(coalesce(slot->>'sector',''))>120 or length(coalesce(slot->>'place',''))>160 or length(coalesce(slot->>'notes',''))>500 then raise exception 'Invalid departure' using errcode='22023';end if;
  if coalesce(slot->>'cutoff','')<>'' and ((slot->>'cutoff') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (slot->>'cutoff')>(slot->>'time')) then raise exception 'Invalid preparation cutoff' using errcode='22023';end if;
  if jsonb_typeof(slot->'days') is distinct from 'array' or jsonb_array_length(slot->'days') not between 1 and 7 then raise exception 'Days required' using errcode='22023';end if;
  for day in select value from jsonb_array_elements(slot->'days') loop
   if day::text !~ '^[1-7]$' then raise exception 'Invalid weekday' using errcode='22023';end if;
  end loop;
 end loop;
 perform 1 from public.scanette_workspaces w where w.id=shop for update;
 if exists(select 1 from public.gestion_partners p where p.id=partner_id and p.workspace_id<>shop) then raise exception 'Access denied' using errcode='42501';end if;
 select p.version into previous from public.gestion_partners p where p.id=partner_id and p.workspace_id=shop;
 if coalesce(previous,0)<>expected_version then raise exception 'Partner changed' using errcode='PT409';end if;
 return query
 insert into public.gestion_partners as g(id,workspace_id,kind,name,details,departures,source_key,version,updated_by,access_source)
 values(partner_id,shop,partner_kind,btrim(partner_name),partner_details,partner_departures,coalesce(partner_source,''),expected_version+1,null,'shared_access')
 on conflict on constraint gestion_partners_pkey do update set kind=excluded.kind,name=excluded.name,details=excluded.details,departures=excluded.departures,source_key=excluded.source_key,version=excluded.version,updated_by=null,access_source='shared_access',updated_at=now()
 returning g.id,g.kind,g.name,g.details,g.departures,g.source_key,g.version,g.updated_at;
end;$$;

-- 5. Receipts (and the older shared inventory dossiers, kept readable) --------------------------
create or replace function public.shared_sessions(session_kind text,max_rows integer default 100,session_token text default null)
returns table(id uuid,kind text,content jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 if session_kind not in ('receipt','inventory') or max_rows is null or max_rows not between 1 and 500 then raise exception 'Invalid request' using errcode='22023'; end if;
 return query select s.id,s.kind,s.content,s.version,s.created_at,s.updated_at from public.logistics_sessions s where s.workspace_id=shop and s.kind=session_kind order by s.updated_at desc limit max_rows;
end;$$;

create or replace function public.shared_session(session_id uuid,session_token text default null)
returns table(id uuid,kind text,content jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin return query select s.id,s.kind,s.content,s.version,s.created_at,s.updated_at from public.logistics_sessions s where s.workspace_id=shop and s.id=session_id; end;$$;

-- Same checks as logistics_save_session; no author, marked as shared.
create or replace function public.shared_save_session(session_id uuid,session_kind text,expected_version integer,document jsonb,session_token text default null)
returns table(id uuid,kind text,content jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); old public.logistics_sessions; supplier public.gestion_partners; line jsonb; employee jsonb;
begin
 if session_id is null or session_kind is null or session_kind not in ('receipt','inventory') or expected_version is null or expected_version<0 or jsonb_typeof(document) is distinct from 'object' or octet_length(document::text)>2000000 then raise exception 'Invalid document' using errcode='22023';end if;
 if jsonb_typeof(document->'lines') is distinct from 'array' or jsonb_array_length(document->'lines')>5000 or length(coalesce(document->>'label',''))>180 or coalesce(document->>'event_at','')='' then raise exception 'Invalid header' using errcode='22023';end if;
 perform (document->>'event_at')::timestamptz;
 if session_kind='receipt' then
  if coalesce(document->>'supplier_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Supplier and order required' using errcode='22023';end if;
  select * into supplier from public.gestion_partners p where p.id=(document->>'supplier_id')::uuid and p.workspace_id=shop and p.kind='supplier';
  if not found or length(btrim(coalesce(document->>'orders',''))) not between 1 and 1000 then raise exception 'Supplier and order required' using errcode='22023';end if;
  document:=jsonb_set(document,'{supplier_name}',to_jsonb(supplier.name));
 else
  if jsonb_typeof(document->'employees') is distinct from 'array' or jsonb_array_length(document->'employees') not between 1 and 2 then raise exception 'One or two employees required' using errcode='22023';end if;
  for employee in select value from jsonb_array_elements(document->'employees') loop
   if jsonb_typeof(employee)<>'string' or length(btrim(employee#>>'{}')) not between 1 and 180 then raise exception 'Invalid employee' using errcode='22023';end if;
  end loop;
 end if;
 for line in select value from jsonb_array_elements(document->'lines') loop
  if jsonb_typeof(line) is distinct from 'object' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or not (line ? 'quantity') or (line->'quantity'<>'null'::jsonb and (coalesce(line->>'quantity','') !~ '^(0|[1-9][0-9]{0,6})$' or (line->>'quantity')::bigint>1000000)) or length(coalesce(line->>'location',''))>300 then raise exception 'Invalid line' using errcode='22023';end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products p where p.id=(line->>'product_id')::uuid and p.workspace_id=shop) then raise exception 'Product outside workspace' using errcode='22023';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(session_id::text,8));
 select * into old from public.logistics_sessions s where s.id=session_id for update;
 if found and (old.workspace_id<>shop or old.kind<>session_kind) then raise exception 'Document unavailable' using errcode='42501';end if;
 -- A retry of the same shared save returns the stored version instead of failing.
 if old.id is not null and old.updated_by is null and old.access_source='shared_access' and old.content=document and old.version=expected_version+1 then
  return query select old.id,old.kind,old.content,old.version,old.created_at,old.updated_at; return;
 end if;
 if coalesce(old.version,0)<>expected_version then raise exception 'Document changed' using errcode='PT409';end if;
 return query
 insert into public.logistics_sessions as s(id,workspace_id,kind,content,version,created_by,updated_by,access_source) values(session_id,shop,session_kind,document,expected_version+1,null,null,'shared_access')
 on conflict on constraint logistics_sessions_pkey do update set content=excluded.content,version=excluded.version,updated_by=null,access_source='shared_access',updated_at=clock_timestamp()
 returning s.id,s.kind,s.content,s.version,s.created_at,s.updated_at;
end;$$;

-- 6. Returns and warranties (internal processing) ---------------------------------------------
create or replace function public.shared_returns(max_rows integer default 500,session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 if max_rows is null or max_rows not between 1 and 1000 then raise exception 'Invalid request' using errcode='22023'; end if;
 return query select c.id,c.document,c.version,c.created_at,c.updated_at from public.returns_cases c where c.workspace_id=shop order by c.updated_at desc limit max_rows;
end;$$;

create or replace function public.shared_return_events(case_id uuid,session_token text default null)
returns table(created_at timestamptz,event_kind text,from_status text,to_status text,note text,by_account boolean,access_source text)
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select e.created_at,e.event_kind,e.from_status,e.to_status,e.note,e.actor_id is not null,e.access_source from public.returns_case_events e
  where e.case_id=shared_return_events.case_id and e.workspace_id=shop order by e.created_at limit 200;
end;$$;

-- Same checks as returns_save_case; no author, marked as shared.
create or replace function public.shared_save_return(case_id uuid,expected_version integer,case_document jsonb,event_note text default '',session_token text default null)
returns table(id uuid,document jsonb,version integer,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); previous public.returns_cases%rowtype; saved public.returns_cases; line jsonb; client_id uuid; supplier_id uuid; before_status text; after_status text; event_type text;
begin
 if case_id is null or expected_version is null or expected_version<0 or jsonb_typeof(case_document) is distinct from 'object' or octet_length(case_document::text)>150000 or length(coalesce(event_note,''))>1000 then raise exception 'Invalid request' using errcode='22023'; end if;
 if coalesce(case_document->>'type','') not in ('return','warranty','deposit','mixed') or coalesce(case_document->>'status','') not in ('requested','collected','received','supplier_ready','sent','credit_pending','credited','cancelled') or length(btrim(coalesce(case_document->>'client_name',''))) not between 1 and 180 or length(coalesce(case_document->>'supplier_name',''))>180 or jsonb_typeof(case_document->'lines') is distinct from 'array' or jsonb_array_length(case_document->'lines') not between 1 and 200 then raise exception 'Invalid return case' using errcode='22023'; end if;
 -- Round services of the case (optional, several allowed): a short list of distinct identifiers.
 if case_document ? 'services' then
  if jsonb_typeof(case_document->'services') is distinct from 'array' or jsonb_array_length(case_document->'services')>20 then raise exception 'Invalid services' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(case_document->'services') v where jsonb_typeof(v.value)<>'string' or (v.value#>>'{}') !~ '^[a-z0-9_]{1,40}$')
   or (select count(distinct v.value) from jsonb_array_elements(case_document->'services') v)<>jsonb_array_length(case_document->'services') then raise exception 'Invalid services' using errcode='22023'; end if;
 end if;
 if coalesce(case_document->>'client_id','')<>'' then client_id:=(case_document->>'client_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=client_id and p.workspace_id=shop and p.kind='client') then raise exception 'Client outside workspace' using errcode='22023'; end if; end if;
 if coalesce(case_document->>'supplier_id','')<>'' then supplier_id:=(case_document->>'supplier_id')::uuid; if not exists(select 1 from public.gestion_partners p where p.id=supplier_id and p.workspace_id=shop and p.kind='supplier') then raise exception 'Supplier outside workspace' using errcode='22023'; end if; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(case_document->'lines'))<>jsonb_array_length(case_document->'lines') then raise exception 'Duplicate line' using errcode='22023'; end if;
 for line in select value from jsonb_array_elements(case_document->'lines') loop
  if coalesce(line->>'id','')='' or length(btrim(coalesce(line->>'reference',''))) not between 1 and 120 or length(coalesce(line->>'description',''))>500 or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,4}$' or (line->>'quantity')::integer>100000 or (line ? 'received_quantity' and line->>'received_quantity'<>'' and ((line->>'received_quantity') !~ '^[0-9]{1,5}$' or (line->>'received_quantity')::integer>(line->>'quantity')::integer)) or length(coalesce(line->>'condition',''))>300 or length(coalesce(line->>'reason',''))>500 then raise exception 'Invalid return line' using errcode='22023'; end if;
  if coalesce(line->>'product_id','')<>'' and not exists(select 1 from public.scanette_products p where p.id=(line->>'product_id')::uuid and p.workspace_id=shop) then raise exception 'Product outside workspace' using errcode='22023'; end if;
 end loop;
 perform 1 from public.scanette_workspaces w where w.id=shop for update;
 select * into previous from public.returns_cases c where c.id=case_id for update;
 after_status:=case_document->>'status';
 if found then
  if previous.workspace_id<>shop then raise exception 'Access denied' using errcode='42501'; end if;
  if previous.document=case_document then return query select previous.id,previous.document,previous.version,previous.created_at,previous.updated_at; return; end if;
  if previous.version<>expected_version then raise exception 'Return case changed' using errcode='PT409'; end if;
  before_status:=previous.document->>'status';
  if before_status<>after_status and not ((before_status='requested' and after_status in ('collected','cancelled')) or (before_status='collected' and after_status in ('received','cancelled')) or (before_status='received' and after_status in ('supplier_ready','cancelled')) or (before_status='supplier_ready' and after_status in ('sent','cancelled')) or (before_status='sent' and after_status in ('credit_pending','cancelled')) or (before_status='credit_pending' and after_status in ('credited','cancelled'))) then raise exception 'Invalid status transition' using errcode='22023'; end if;
  event_type:=case when before_status=after_status then 'updated' else 'status_changed' end;
  update public.returns_cases c set document=case_document,version=previous.version+1,updated_by=null,access_source='shared_access',updated_at=clock_timestamp() where c.id=case_id returning * into saved;
 else
  if expected_version<>0 or after_status<>'requested' then raise exception 'New return case must start as requested' using errcode='22023'; end if;
  event_type:='created';
  insert into public.returns_cases(id,workspace_id,document,version,created_by,updated_by,access_source) values(case_id,shop,case_document,1,null,null,'shared_access') returning * into saved;
 end if;
 insert into public.returns_case_events(id,case_id,workspace_id,actor_id,event_kind,from_status,to_status,note,access_source) values(gen_random_uuid(),saved.id,shop,null,event_type,before_status,after_status,coalesce(event_note,''),'shared_access');
 return query select saved.id,saved.document,saved.version,saved.created_at,saved.updated_at;
end;$$;

-- 7. Inventory: article lists prepared for counting (counts stay on each phone) -----------------
create or replace function public.shared_inventory_current(session_token text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); result jsonb;
begin
 select i.document into result from public.inventory_invites i where i.workspace_id=shop and not i.revoked order by i.created_at desc,i.id desc limit 1;
 return result;
end;$$;

create or replace function public.shared_inventory_lists(session_token text default null)
returns table(id uuid,title text,article_count integer,expires_at timestamptz,revoked boolean,shared boolean) language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 return query select i.id,i.document->>'title',jsonb_array_length(i.document->'rows'),i.expires_at,i.revoked,i.access_source='shared_access' from public.inventory_invites i
  where i.workspace_id=shop order by i.created_at desc limit 100;
end;$$;

-- Same list checks as inventory_create_invite. No guest link is produced: the shared space reads the current list.
create or replace function public.shared_inventory_publish(invite_id uuid,document jsonb,valid_days integer,session_token text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token); item jsonb; clean_rows jsonb; clean jsonb; old public.inventory_invites;
begin
 if invite_id is null or valid_days is null or valid_days not between 1 and 14 or jsonb_typeof(document) is distinct from 'object' or octet_length(document::text)>10000000 then raise exception 'Invalid list' using errcode='22023';end if;
 if length(btrim(coalesce(document->>'title',''))) not between 1 and 180 or jsonb_typeof(document->'rows') is distinct from 'array' or jsonb_array_length(document->'rows') not between 1 and 20000 then raise exception 'Invalid list' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(document->'rows') loop
  if jsonb_typeof(item) is distinct from 'object' or length(btrim(coalesce(item->>'id',''))) not between 1 and 128 or length(btrim(coalesce(item->>'reference',''))) not between 1 and 120 or length(btrim(coalesce(item->>'brand',''))) not between 1 and 120 or length(btrim(coalesce(item->>'range',''))) not between 1 and 120 or length(coalesce(item->>'description',''))>500 or length(coalesce(item->>'location',''))>160 or length(coalesce(item->>'internal_barcode',''))>128 or length(coalesce(item->>'manufacturer_barcode',''))>128 then raise exception 'Invalid article' using errcode='22023';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',x.value->>'id','reference',x.value->>'reference','brand',x.value->>'brand','range',x.value->>'range','description',coalesce(x.value->>'description',''),'location',coalesce(x.value->>'location',''),'internal_barcode',coalesce(x.value->>'internal_barcode',''),'manufacturer_barcode',coalesce(x.value->>'manufacturer_barcode',''))) into clean_rows from jsonb_array_elements(document->'rows') as x(value);
 if (select count(distinct x->>'id') from jsonb_array_elements(clean_rows) x)<>jsonb_array_length(clean_rows) then raise exception 'Duplicate identifiers' using errcode='22023';end if;
 clean:=jsonb_build_object('title',btrim(document->>'title'),'rows',clean_rows);
 perform pg_advisory_xact_lock(hashtextextended(invite_id::text,0));
 select * into old from public.inventory_invites i where i.id=invite_id;
 if found then
  if old.workspace_id<>shop or old.document<>clean or old.revoked then raise exception 'List conflict' using errcode='PT409';end if;
  return old.id;
 end if;
 -- The secret is random and never returned: shared lists are not opened through guest links.
 insert into public.inventory_invites(id,workspace_id,created_by,secret_hash,document,expires_at,access_source)
 values(invite_id,shop,null,encode(extensions.digest(encode(extensions.gen_random_bytes(32),'hex'),'sha256'),'hex'),clean,clock_timestamp()+valid_days*interval '1 day','shared_access');
 return invite_id;
end;$$;

create or replace function public.shared_inventory_revoke(invite_id uuid,session_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare shop uuid:=public.shared_shop(session_token);
begin
 update public.inventory_invites i set revoked=true where i.id=invite_id and i.workspace_id=shop;
 if not found then raise exception 'List unavailable' using errcode='22023'; end if;
end;$$;

-- 8. Grants: the shared functions only. No table is opened to anon. Only shared_access_open and
--    shared_access_close work without a session; shared_location_code is a pure text helper.
do $$ declare f text; begin
 foreach f in array array[
  'shared_access_open(text)','shared_access_close(text)','shared_location_code(text)','shared_products_search(text,text,text,text,integer,integer,text)',
  'shared_product_lookup(text,text)','shared_products_by_references(text[],text)','shared_products_by_ids(uuid[],text)','shared_aisles(text)',
  'shared_set_location(uuid,text,timestamptz,text)','shared_aliases_page(integer,integer,text)','shared_aliases_save(jsonb,text)',
  'shared_partners(text,text)','shared_save_partner(uuid,integer,text,text,jsonb,jsonb,text,text)','shared_sessions(text,integer,text)',
  'shared_session(uuid,text)','shared_save_session(uuid,text,integer,jsonb,text)','shared_returns(integer,text)','shared_return_events(uuid,text)',
  'shared_save_return(uuid,integer,jsonb,text,text)','shared_inventory_current(text)','shared_inventory_lists(text)',
  'shared_inventory_publish(uuid,jsonb,integer,text)','shared_inventory_revoke(uuid,text)'] loop
  execute format('revoke all on function public.%s from public',f);
  execute format('grant execute on function public.%s to anon,authenticated',f);
 end loop;
end $$;

-- 9. The PIN service is retired. Its tables stay for the record; nobody can call its functions.
revoke all on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),
 public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_revoke(uuid,text),public.logistics_pin_pepper()
 from public,anon,authenticated,service_role;

-- 10. Declare Bellecave as the shop of the shared access. Set enabled=false to close every shared
--     function at once. An existing password hash is kept when this file is applied again.
insert into public.shared_access(workspace_id,enabled) values('8770297c-cadb-4cc6-8b93-55a0f9bd154e',true)
on conflict (singleton) do update set workspace_id=excluded.workspace_id,enabled=true;
commit;

-- 11. BY HAND, ONCE, AFTER THIS FILE — never saved in a file, a commit, a ticket or a chat.
--     In the Supabase SQL Editor, type the statement below and replace the placeholder by the real
--     password (10 characters at least). Do not save the query as a snippet. Run it again to change
--     the password: every open session ends at once.
--
--     select public.shared_access_set_password('<MOT_DE_PASSE_LOGISTIQUE_A_SAISIR_A_LA_MAIN>');
