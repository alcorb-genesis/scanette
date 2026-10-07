-- Reactivate only the server-side PIN service. The browser never receives these permissions.
-- Apply after schema.sql. Do not grant these functions to anon or authenticated.
begin;
grant execute on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_revoke(uuid,text),public.logistics_pin_pepper() to service_role;
revoke all on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_revoke(uuid,text),public.logistics_pin_pepper() from public,anon,authenticated;
commit;
