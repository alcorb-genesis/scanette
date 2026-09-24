-- No real team changes survive this test.
begin;
do $$begin perform set_config('request.jwt.claim.sub',(select user_id::text from public.scanette_members where workspace_id='8770297c-cadb-4cc6-8b93-55a0f9bd154e' and role='admin' limit 1),true);end;$$;
set local role authenticated;
do $$declare r public.gestion_team; old_count integer; blocked boolean:=false;begin
 select count(*) into old_count from public.scanette_members;
 r:=public.gestion_save_team_member('8770297c-cadb-4cc6-8b93-55a0f9bd154e',gen_random_uuid(),0,'TEST ROLLBACK',array['sales','picking'],'','');
 if r.user_id is not null or (select count(*) from public.scanette_members)<>old_count then raise exception 'Profile unexpectedly grants access';end if;
 begin perform public.gestion_save_team_member(r.workspace_id,r.id,0,'Stale',array['sales'],'','');exception when sqlstate 'PT409' then blocked:=true;end;
 if not blocked then raise exception 'Stale update permitted';end if;
 blocked:=false;
 begin update public.gestion_team set user_id=auth.uid() where id=r.id;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Direct identity change permitted';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 if exists(select 1 from public.gestion_team) then raise exception 'Outsider can read team';end if;
 blocked:=false;
 begin perform public.gestion_save_team_member(r.workspace_id,r.id,1,'Intruder',array['management'],'','');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Outsider can write team';end if;
end;$$;
rollback;
select 'PASS team security, no test records retained' as result;
-- Administrative session: prove membership removal detaches instead of deleting a profile.
begin;
do $$declare a uuid; w uuid; before_count integer;begin
 select user_id,workspace_id into strict a,w from public.gestion_team where user_id is not null limit 1;
 select count(*) into before_count from public.gestion_team;
 delete from public.scanette_members where workspace_id=w and user_id=a;
 if exists(select 1 from public.gestion_team where workspace_id=w and user_id=a) then raise exception 'Revocation did not detach profile';end if;
 if (select count(*) from public.gestion_team)<>before_count then raise exception 'Team record lost';end if;
end;$$;
rollback;
