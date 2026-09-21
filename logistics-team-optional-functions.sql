begin;
alter table public.gestion_team drop constraint gestion_team_functions_check;
alter table public.gestion_team add constraint gestion_team_functions_check check(cardinality(functions) between 0 and 12 and array_position(functions,null) is null and functions <@ array['office','management','logistics','receiving','warranty','returns','picking','shipping','driver','commercial','sales','purchasing','accounting','apprentice']::text[]);
alter table public.gestion_team alter column functions set default '{}';
commit;
