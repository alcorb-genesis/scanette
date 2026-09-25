-- Additive metadata on the existing private catalogue. Existing member RLS applies.
-- No new grants, public dataset, or write endpoint.
begin;
alter table public.scanette_products add column if not exists catalogue_enrichment jsonb not null default '{}'::jsonb;
comment on column public.scanette_products.catalogue_enrichment is
 'Reviewed manufacturer evidence: brand, family, barcode provenance and vehicle applications with source precision. Model mentions are not a guarantee for every engine/version. Client read-only; reviewed imports only.';
commit;
