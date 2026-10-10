-- Public garage portal: the designation of a typed or scanned reference (« Filtre à air »…).
-- Prerequisite: returns-public-portal.sql applied. Apply manually as postgres in the Supabase
-- SQL Editor, then run returns-public-designation.test.sql. Not applied by the application.
-- The page works without this function: it then shows the reference alone.
--
-- What an anonymous visitor gets, and nothing else: ONE text, the designation recorded in the shop
-- catalogue for a code that matches exactly (reference or barcode). Never a location, a stock, a
-- price, a supplier, an identifier or a list of products.
--   * null when the portal knows no reliable designation: unknown code, empty designation, or
--     several products with different designations (never guessed);
--   * 42501 when the portal of the shop is closed, 22023 for an unusable code.
-- Limit: the anon key is public by design, so a script can ask designations one exact code at a
-- time. Nothing can be searched or listed, and a designation is what is printed on the part's box.
-- Single statement block, named dollar tags: safe to paste in the Supabase SQL Editor.
create or replace function public.returns_public_designation(shop_id uuid,code text)
returns text language plpgsql stable security definer set search_path='' as $repclick_fn$
declare value text:=regexp_replace(btrim(coalesce(code,'')),'\s+',' ','g'); found_count integer; label text;
begin
 if not exists(select 1 from public.returns_public_portals c where c.workspace_id=shop_id and c.enabled) then raise exception 'Portal closed' using errcode='42501'; end if;
 if length(value) not between 1 and 80 or value ~ '[[:cntrl:]]' then raise exception 'Invalid reference' using errcode='22023'; end if;
 select count(*),min(d) into found_count,label from (
  select distinct regexp_replace(btrim(regexp_replace(p.description,'[[:cntrl:]]',' ','g')),'\s+',' ','g') as d
  from public.scanette_products p
  where p.workspace_id=shop_id and (p.reference=value or p.reference=upper(value) or p.internal_barcode=value or p.manufacturer_barcode=value)
  limit 20) m where m.d<>'';
 if found_count=1 then return left(label,120); end if;
 return null;
end;$repclick_fn$;
revoke all on function public.returns_public_designation(uuid,text) from public;
grant execute on function public.returns_public_designation(uuid,text) to anon,authenticated;
