-- Internal article list: no guest secret and no counts are exposed.
begin;
create or replace function public.inventory_current_list(shop uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select i.document from public.inventory_invites i
 where i.workspace_id=shop and not i.revoked
 and exists(select 1 from public.scanette_members m where m.workspace_id=shop and m.user_id=auth.uid() and m.role in ('reader','operator','admin'))
 order by i.created_at desc,i.id desc limit 1;
$$;
revoke all on function public.inventory_current_list(uuid) from public,anon,authenticated;
grant execute on function public.inventory_current_list(uuid) to authenticated;
commit;
