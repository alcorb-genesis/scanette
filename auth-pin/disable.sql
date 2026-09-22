-- Retire PIN authentication without deleting team records, passwords or active sessions.
begin;
revoke execute on function public.logistics_pin_pair(uuid,uuid,text),public.logistics_pin_enrol(uuid,uuid,text,text),public.logistics_pin_roster(text),public.logistics_pin_attempt(text,uuid),public.logistics_pin_finish(text,uuid,uuid),public.logistics_pin_pepper() from service_role;
commit;
