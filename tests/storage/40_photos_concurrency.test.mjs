// AC4/AC5: parallel reserve/confirm caps. Uses the seeded Testville region so Truckee's hourly
// confirm ledger is not consumed; this file clears Testville's photo_confirm ledger before and after.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { anonClient, sql, sqlOne, lit, makeHouse, enablePhotos, uploadPhoto, runJobs } from './_local.mjs';

const clearLedger = () => sql(`delete from private.quota_events where kind = 'photo_confirm'
  and region_id = (select id from public.regions where slug = 'testville')`);
before(async () => { await enablePhotos(); await clearLedger(); });
after(async () => { await clearLedger(); });

test('1: 10 users x 3 reservations, all 30 confirmed in parallel -> exactly 20 pending, 10 over_cap, 10 delete_upload jobs', async () => {
  const house = await makeHouse('testville', 'cc');
  const users = await Promise.all(Array.from({ length: 10 }, () => anonClient()));
  const photos = (await Promise.all(users.map(async (u) =>
    Promise.all([0, 1, 2].map(async () => ({ u, ...(await uploadPhoto(u, house.id, { confirm: false })) })))))).flat();
  assert.equal(photos.length, 30);
  const res = await Promise.all(photos.map((p) => p.u.rpc('confirm_photo_upload', { p_photo_id: p.photoId })));
  const errs = res.filter((r) => r.error).map((r) => r.error.message);
  assert.deepEqual(errs, [], 'no confirm errors');
  const tally = res.reduce((t, r) => ({ ...t, [r.data]: (t[r.data] ?? 0) + 1 }), {});
  assert.deepEqual(tally, { pending: 20, over_cap: 10 });
  assert.equal(Number(await sqlOne(`select count(*) from public.photos where house_id = ${lit(house.id)} and status = 'pending'`)), 20);
  assert.equal(Number(await sqlOne(`select count(*) from public.photos where house_id = ${lit(house.id)} and status = 'expired'`)), 10);
  // done or not (the runner may already have processed some), exactly 10 delete_upload jobs exist for the over-cap rows
  assert.equal(Number(await sqlOne(`select count(*) from private.storage_jobs j join public.photos p on p.id = j.photo_id
    where p.house_id = ${lit(house.id)} and p.status = 'expired' and j.kind = 'delete_upload'`)), 10);
  await runJobs([house.id]);
});

test('2: one user, 12 parallel reserve_photo -> exactly 3 succeed, the rest rate_limited', async () => {
  const house = await makeHouse('testville', 'cr');
  const u = await anonClient();
  const res = await Promise.all(Array.from({ length: 12 }, () => u.rpc('reserve_photo', { p_house_id: house.id })));
  const ok = res.filter((r) => !r.error).length;
  const limited = res.filter((r) => r.error?.message === 'rate_limited').length;
  assert.equal(ok, 3, `ok=${ok}`);
  assert.equal(limited, 9, `limited=${limited}; other: ${res.filter((r) => r.error && r.error.message !== 'rate_limited').map((r) => r.error.message)}`);
});

test('3: region confirm cap: 99 ledger rows, then 3 parallel confirms on 3 houses -> exactly 1 pending', async () => {
  await clearLedger();
  const houses = await Promise.all([1, 2, 3].map((n) => makeHouse('testville', `cap${n}`)));
  const u = await anonClient();
  const photos = [];
  for (const h of houses) photos.push(await uploadPhoto(u, h.id, { confirm: false }));
  await sql(`insert into private.quota_events (kind, uid, region_id, house_id)
    select 'photo_confirm', ${lit(crypto.randomUUID())}, r.id, null from public.regions r, generate_series(1, 99) where r.slug = 'testville'`);
  const res = await Promise.all(photos.map((p) => u.rpc('confirm_photo_upload', { p_photo_id: p.photoId })));
  assert.deepEqual(res.filter((r) => r.error).map((r) => r.error.message), []);
  const pending = res.filter((r) => r.data === 'pending').length;
  assert.equal(pending, 1, `pending=${pending}`);
  assert.equal(res.filter((r) => r.data === 'over_cap').length, 2);
});
