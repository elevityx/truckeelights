-- Address normalization used for DB dedupe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(private.normalize_address('15212 Waterloo Cir, Truckee, CA 96161, USA'), '15212 waterloo cir, truckee, ca 96161', 'strips trailing USA, lowercases');
select is(private.normalize_address('  10013  Jibboom St. ,Truckee '), '10013 jibboom st, truckee', 'trims, collapses spaces, fixes comma spacing, drops dots');
select is(private.normalize_address('12 Elm St #4'), '12 elm st 4', 'drops #');
select is(private.normalize_address('1 Main St, Truckee, United States'), '1 main st, truckee', 'strips trailing United States');
select is(private.normalize_address(null), '', 'null -> empty string');
select is(private.normalize_address('100 Testfixture Rd, Truckee, CA'), private.normalize_address('  100   TESTFIXTURE  Rd ,Truckee, CA, USA'), 'case/space/USA variants collide');

select * from finish();
rollback;
