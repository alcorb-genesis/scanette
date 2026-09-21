begin;
create table public.logistics_pin_devices (
 token_hash text primary key check(length(token_hash)=64), workspace_id uuid not null references public.scanette_workspaces(id),
 created_by uuid not null references auth.users(id), expires_at timestamptz not null,
 revoked boolean not null default false, window_at timestamptz not null default clock_timestamp(), attempts integer not null default 0
);
create table public.logistics_pin_credentials (
 user_id uuid primary key references auth.users(id), workspace_id uuid not null,
 salt text not null, digest text not null, version uuid not null default gen_random_uuid(),
 window_at timestamptz not null default clock_timestamp(), attempts integer not null default 0,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,user_id) references public.scanette_members(workspace_id,user_id) on delete cascade
);
alter table public.logistics_pin_devices enable row level security;
alter table public.logistics_pin_credentials enable row level security;
revoke all on public.logistics_pin_devices,public.logistics_pin_credentials from public,anon,authenticated;
create function public.logistics_pin_pair(actor uuid,shop uuid,device_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.scanette_members where user_id=actor and workspace_id=shop and role='admin') then raise exception 'Denied';end if;
 insert into public.logistics_pin_devices(token_hash,workspace_id,created_by,expires_at) values(device_hash,shop,actor,clock_timestamp()+interval '90 days');
end;$$;
create function public.logistics_pin_enrol(actor uuid,shop uuid,pin_salt text,pin_digest text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.scanette_members where user_id=actor and workspace_id=shop) or length(pin_salt)<>32 or length(pin_digest)<>64 then raise exception 'Denied';end if;
 insert into public.logistics_pin_credentials(user_id,workspace_id,salt,digest) values(actor,shop,pin_salt,pin_digest)
 on conflict(user_id) do update set workspace_id=excluded.workspace_id,salt=excluded.salt,digest=excluded.digest,version=gen_random_uuid(),window_at=clock_timestamp(),attempts=0,updated_at=clock_timestamp();
end;$$;
create function public.logistics_pin_roster(device_hash text) returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select c.user_id,t.display_name from public.logistics_pin_devices d
 join public.logistics_pin_credentials c on c.workspace_id=d.workspace_id
 join public.scanette_members m on m.workspace_id=c.workspace_id and m.user_id=c.user_id
 join public.gestion_team t on t.workspace_id=c.workspace_id and t.user_id=c.user_id
 where d.token_hash=device_hash and not d.revoked and d.expires_at>now() order by t.display_name,c.user_id;
$$;
create function public.logistics_pin_attempt(device_hash text,person uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.logistics_pin_devices;c public.logistics_pin_credentials; stamp timestamptz:=clock_timestamp();begin
 select * into d from public.logistics_pin_devices where token_hash=device_hash for update;
 if not found or d.revoked or d.expires_at<=stamp then return null;end if;
 if d.window_at<=stamp-interval '15 minutes' then d.attempts:=0;d.window_at:=stamp;end if;
 if d.attempts>=20 then return null;end if;
 update public.logistics_pin_devices set attempts=d.attempts+1,window_at=d.window_at where token_hash=device_hash;
 select * into c from public.logistics_pin_credentials where user_id=person and workspace_id=d.workspace_id for update;
 if not found or not exists(select 1 from public.scanette_members where user_id=person and workspace_id=d.workspace_id) then return null;end if;
 if c.window_at<=stamp-interval '15 minutes' then c.attempts:=0;c.window_at:=stamp;end if;
 if c.attempts>=5 then return null;end if;
 update public.logistics_pin_credentials set attempts=c.attempts+1,window_at=c.window_at where user_id=person;
 return jsonb_build_object('user_id',c.user_id,'salt',c.salt,'digest',c.digest,'version',c.version);
end;$$;
create function public.logistics_pin_finish(device_hash text,person uuid,credential_version uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.logistics_pin_devices;c public.logistics_pin_credentials;begin
 select * into d from public.logistics_pin_devices where token_hash=device_hash for update;
 if not found or d.revoked or d.expires_at<=clock_timestamp() then return false;end if;
 select * into c from public.logistics_pin_credentials where user_id=person and workspace_id=d.workspace_id for update;
 if not found or c.version<>credential_version or not exists(select 1 from public.scanette_members where user_id=person and workspace_id=d.workspace_id) then return false;end if;
 -- A verified PIN clears failures for this account. The device retains its overall request budget.
 update public.logistics_pin_credentials set attempts=0,window_at=clock_timestamp() where user_id=person;
 return true;
end;$$;
create function public.logistics_pin_revoke(actor uuid,device_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.logistics_pin_devices d set revoked=true where d.token_hash=device_hash and exists(select 1 from public.scanette_members m where m.user_id=actor and m.workspace_id=d.workspace_id and m.role='admin');
end;$$;
revoke all on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_revoke(uuid,text) from public,anon,authenticated;
grant execute on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_revoke(uuid,text) to service_role;
-- The pepper is generated inside Vault; its value is never displayed or committed.
do $$begin
 if not exists(select 1 from vault.secrets where name='logistics-pin-pepper-v1') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'logistics-pin-pepper-v1','Server-only PIN hashing secret');
 end if;
end;$$;
create function public.logistics_pin_pepper() returns text language sql stable security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='logistics-pin-pepper-v1';
$$;
revoke all on function public.logistics_pin_pepper() from public,anon,authenticated;
grant execute on function public.logistics_pin_pepper() to service_role;
commit;
