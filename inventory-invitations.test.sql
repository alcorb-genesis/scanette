-- Run after the migration. All fixture changes roll back.
begin;
do $$
declare shop uuid; actor uuid; invite uuid:=gen_random_uuid(); token text:=repeat('a',64); doc jsonb; result jsonb;
begin
 select workspace_id,user_id into shop,actor from public.scanette_members where role='admin' limit 1;
 if actor is null then raise exception 'Test requires a pre-existing workspace administrator';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 doc:=jsonb_build_object('title','Disposable security fixture','rows',jsonb_build_array(jsonb_build_object('id','fixture','reference','000TEST','brand','TEST','range','TEST','quantity',99,'employee','not shared')));
 perform public.inventory_create_invite(shop,invite,token,doc,1);
 perform public.inventory_create_invite(shop,invite,token,doc,1);
 if (select count(*) from public.inventory_invites where id=invite)<>1 then raise exception 'Retry duplicated invite';end if;
 result:=public.inventory_read_invite(invite,token);
 if result is null or (result->'rows'->0) ? 'quantity' or (result->'rows'->0) ? 'employee' then raise exception 'Shared payload not whitelisted';end if;
 if public.inventory_read_invite(invite,repeat('b',64)) is not null then raise exception 'Wrong token accepted';end if;
 update public.inventory_invites set expires_at=clock_timestamp()-interval '1 second' where id=invite;
 if public.inventory_read_invite(invite,token) is not null then raise exception 'Expired link accepted';end if;
 update public.inventory_invites set expires_at=clock_timestamp()+interval '1 day' where id=invite;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 if public.inventory_read_invite(invite,token) is null then raise exception 'Guest link unreadable';end if;
 begin
  perform public.inventory_create_invite(shop,gen_random_uuid(),token,doc,1);
  raise exception 'Anonymous creation accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.inventory_revoke_invite(invite);
  raise exception 'Anonymous revocation accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 perform public.inventory_revoke_invite(invite);
 if public.inventory_read_invite(invite,token) is not null then raise exception 'Revoked link accepted';end if;
 if has_table_privilege('anon','public.inventory_invites','SELECT') or has_table_privilege('authenticated','public.inventory_invites','SELECT') then raise exception 'Direct table access exposed';end if;
 if has_function_privilege('anon','public.inventory_create_invite(uuid,uuid,text,jsonb,integer)','EXECUTE') or has_function_privilege('anon','public.inventory_list_invites(uuid)','EXECUTE') then raise exception 'Guest administration exposed';end if;
 raise notice 'Invitation security checks passed; fixture will roll back';
end;$$;
rollback;
