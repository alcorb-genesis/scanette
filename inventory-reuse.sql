-- Administrators can reuse the prepared article list after its guest link expires.
begin;
create function public.inventory_load_list(shop uuid,invite_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select i.document from public.inventory_invites i
 where i.id=invite_id and i.workspace_id=shop
 and exists(select 1 from public.scanette_members m
 where m.workspace_id=shop and m.user_id=auth.uid() and m.role='admin');
$$;
revoke all on function public.inventory_load_list(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inventory_load_list(uuid,uuid) to authenticated;
commit;
