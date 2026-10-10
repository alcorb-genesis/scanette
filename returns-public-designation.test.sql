-- Run after returns-public-designation.sql. Everything is rolled back.
-- The test creates its own shops and products.
begin;
create function pg_temp.sqlstate_of(statement text) returns text language plpgsql as $t$
begin execute statement; return 'ok'; exception when others then return sqlstate; end;$t$;
create function pg_temp.expect(label text,ok boolean) returns void language plpgsql as $t$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; end;$t$;

insert into public.scanette_workspaces(id,name) values('11111111-1111-4111-8111-111111111111','TEST OPEN'),('22222222-2222-4222-8222-222222222222','TEST CLOSED');
insert into public.returns_public_portals(workspace_id,enabled) values('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',false);
insert into public.scanette_products(id,workspace_id,reference,description,internal_barcode,manufacturer_barcode,source_line,source_sha256,location) values
 ('dd5e1e57-7e57-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','LX 1780','  Filtre   à air ','2000000000017','4009026000014',1,repeat('a',64),'A19a'),
 ('dd5e1e57-7e57-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','SANS-NOM','   ',null,null,2,repeat('a',64),'B2'),
 ('dd5e1e57-7e57-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','DOUBLE-1','Biellette de direction',null,'3333333333333',3,repeat('a',64),'C1'),
 ('dd5e1e57-7e57-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','DOUBLE-2','Rotule de suspension',null,'3333333333333',4,repeat('a',64),'C2'),
 ('dd5e1e57-7e57-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','PAIRE-1','Disque de frein',null,'4444444444444',5,repeat('a',64),'D1'),
 ('dd5e1e57-7e57-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','PAIRE-2','Disque de frein',null,'4444444444444',6,repeat('a',64),'D2'),
 ('dd5e1e57-7e57-4000-8000-000000000007','22222222-2222-4222-8222-222222222222','FERME-1','Pièce du magasin fermé',null,null,7,repeat('a',64),'Z9');

select set_config('request.jwt.claim.sub','',true);
set local role anon;

select pg_temp.expect('a reference gives its designation, cleaned',public.returns_public_designation('11111111-1111-4111-8111-111111111111','LX 1780')='Filtre à air');
select pg_temp.expect('typed in lower case with extra spaces',public.returns_public_designation('11111111-1111-4111-8111-111111111111','  lx   1780 ')='Filtre à air');
select pg_temp.expect('a scanned internal barcode',public.returns_public_designation('11111111-1111-4111-8111-111111111111','2000000000017')='Filtre à air');
select pg_temp.expect('a scanned manufacturer barcode',public.returns_public_designation('11111111-1111-4111-8111-111111111111','4009026000014')='Filtre à air');
select pg_temp.expect('an unknown reference gives nothing',public.returns_public_designation('11111111-1111-4111-8111-111111111111','INCONNUE-42') is null);
select pg_temp.expect('an empty designation gives nothing',public.returns_public_designation('11111111-1111-4111-8111-111111111111','SANS-NOM') is null);
select pg_temp.expect('a barcode shared by different parts is never guessed',public.returns_public_designation('11111111-1111-4111-8111-111111111111','3333333333333') is null);
select pg_temp.expect('a barcode shared by parts of the same designation is reliable',public.returns_public_designation('11111111-1111-4111-8111-111111111111','4444444444444')='Disque de frein');
select pg_temp.expect('no partial match, no pattern',public.returns_public_designation('11111111-1111-4111-8111-111111111111','LX') is null and public.returns_public_designation('11111111-1111-4111-8111-111111111111','LX%') is null and public.returns_public_designation('11111111-1111-4111-8111-111111111111','%') is null);
select pg_temp.expect('another shop''s catalogue is never read',public.returns_public_designation('11111111-1111-4111-8111-111111111111','FERME-1') is null);
select pg_temp.expect('a closed portal answers nothing',pg_temp.sqlstate_of($q$select public.returns_public_designation('22222222-2222-4222-8222-222222222222','FERME-1')$q$)='42501');
select pg_temp.expect('an unknown shop is closed',pg_temp.sqlstate_of($q$select public.returns_public_designation('33333333-3333-4333-8333-333333333333','LX 1780')$q$)='42501');
select pg_temp.expect('empty, too long or control codes are refused',pg_temp.sqlstate_of($q$select public.returns_public_designation('11111111-1111-4111-8111-111111111111','  ')$q$)='22023'
 and pg_temp.sqlstate_of($q$select public.returns_public_designation('11111111-1111-4111-8111-111111111111',repeat('R',81))$q$)='22023'
 and pg_temp.sqlstate_of($q$select public.returns_public_designation('11111111-1111-4111-8111-111111111111',null)$q$)='22023');
select pg_temp.expect('the answer is one text: no location, stock, price, supplier or identifier',
 (select pg_get_function_result(p.oid)='text' and pg_get_function_identity_arguments(p.oid)='shop_id uuid, code text' from pg_proc p where p.oid='public.returns_public_designation(uuid,text)'::regprocedure));
select pg_temp.expect('the catalogue itself stays closed to the visitor',pg_temp.sqlstate_of('select 1 from public.scanette_products limit 1')='42501');
reset role;
select pg_temp.expect('nothing is written by a lookup',(select count(*) from public.returns_cases where workspace_id='11111111-1111-4111-8111-111111111111')=0);
rollback;
select 'returns-public-designation: all checks passed' as result;
