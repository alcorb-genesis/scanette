-- Removes the public designation lookup. The garage portal keeps working: it shows the reference alone.
drop function if exists public.returns_public_designation(uuid,text);
