// WP-D MANDATORY (AC8, sol r3 P1 / grok r3 P1): with the cron unscheduled and the runner unable to reach
// Storage, jobs stay open and the admin "Run now" fallback (copy->remove, then admin_complete_storage_job)
// completes hide, revoke, expiry and reject. Completion is server-verified, never early.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  anonClient, newClient, adminAal2, sql, sqlOne, lit, makeHouse, enablePhotos, uploadPhoto, approvePhoto, leakedUrl,
  fetchStatus, objectExists, snapshotRunner, runnerDown, runnerRestore, openJobsFor, fallbackAction, complete, runFallback, waitFor,
} from './_local.mjs';

let admin, adminB, user, stranger, house, snap;
const photo = async (id) => (await sql(`select status, public_path from public.photos where id = ${lit(id)}`))[0];

before(async () => {
  await enablePhotos();
  snap = await snapshotRunner();      // restored exactly in after()
  await runnerDown();                 // cron off + Vault URL -> http://127.0.0.1:9
  admin = await adminAal2('global');
  adminB = await adminAal2('testville');
  user = await anonClient();
  stranger = await anonClient();
  house = await makeHouse('truckee', 'down');
});
after(async () => { if (snap) await runnerRestore(snap); });

async function approved() {
  const p = await uploadPhoto(user, house.id);
  const publicPath = await approvePhoto(admin, { regionId: house.regionId, houseId: house.id, photoId: p.photoId });
  return { ...p, publicPath, url: await leakedUrl('photos', publicPath) };
}

test('setup: the cron job is unscheduled', async () => {
  assert.equal(Number(await sqlOne(`select count(*) from cron.job where jobname = 'tl-storage-jobs'`)), 0);
});

test('a: hide with the runner down -> URL still works (stuck); fallback copy+remove+complete rotates and kills the URL', async () => {
  const a = await approved();
  const h = await admin.rpc('admin_set_house_status', { p_house_id: house.id, p_status: 'hidden', p_reason: 'runner down' });
  assert.equal(h.error, null, h.error?.message);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(await fetchStatus(a.url), 200, 'job is stuck: URL still live');
  const jobs = (await openJobsFor(admin, house.regionId, [house.id])).filter((j) => j.kind === 'rotate_public');
  assert.ok(jobs.length >= 1, 'a rotate_public job stays open');
  // (e) completion BEFORE the storage action must be false
  const early = await complete(admin, jobs[0].id);
  assert.equal(early.error, null, early.error?.message);
  assert.equal(early.data, false, 'never marks done early');
  for (const j of jobs) {
    await fallbackAction(admin, j); // copy to the fresh name, then remove the old one
    const r = await complete(admin, j.id);
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.data, true);
  }
  const row = await photo(a.photoId);
  assert.notEqual(row.public_path, a.publicPath, 'public_path rotated');
  assert.ok(await waitFor(async () => (await fetchStatus(a.url)) !== 200), 'old URL fails');
  assert.equal(await objectExists('photos', row.public_path), true);
  await admin.rpc('admin_set_house_status', { p_house_id: house.id, p_status: 'visible', p_reason: null });
});

test('b: revoke with the runner down -> fallback remove + complete; URL fails, object gone', async () => {
  const a = await approved();
  const rv = await admin.rpc('admin_revoke_photo', { p_photo_id: a.photoId });
  assert.equal(rv.error, null, rv.error?.message);
  assert.equal(await fetchStatus(a.url), 200, 'stuck while the runner is down');
  const done = await runFallback(admin, house.regionId, [house.id]);
  assert.ok(done.length >= 1 && done.every((d) => d.done === true));
  assert.ok(await waitFor(async () => (await fetchStatus(a.url)) !== 200));
  assert.equal(await objectExists('photos', a.publicPath), false);
});

test('c: expiry with the runner down -> fallback removes the photo-uploads object', async () => {
  const p = await uploadPhoto(user, house.id, { confirm: false });
  await sql(`update public.photos set reserved_until = now() - interval '1 minute' where id = ${lit(p.photoId)}`);
  await sql('select private.sweep_photos()');
  assert.equal(await objectExists('photo-uploads', p.uploadPath), true, 'stuck');
  const done = await runFallback(admin, house.regionId, [house.id]);
  assert.ok(done.some((d) => d.job.object_name === p.uploadPath && d.done === true));
  assert.equal(await objectExists('photo-uploads', p.uploadPath), false);
});

test('d: reject with the runner down -> fallback removes the upload', async () => {
  const p = await uploadPhoto(user, house.id);
  const r = await admin.rpc('admin_reject_photo', { p_photo_id: p.photoId });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(await objectExists('photo-uploads', p.uploadPath), true, 'stuck');
  const done = await runFallback(admin, house.regionId, [house.id]);
  assert.ok(done.some((d) => d.job.object_name === p.uploadPath && d.done === true));
  assert.equal(await objectExists('photo-uploads', p.uploadPath), false);
  assert.equal((await photo(p.photoId)).status, 'rejected');
});

test('f: non-admin and cross-region admin get forbidden; Storage denies their move/remove', async () => {
  const a = await approved();
  await admin.rpc('admin_revoke_photo', { p_photo_id: a.photoId }); // leaves open delete jobs (runner down)
  const [job] = await openJobsFor(admin, house.regionId, [house.id]);
  assert.ok(job, 'an open job exists');
  for (const who of [stranger, adminB, newClient()]) {
    const l = await who.rpc('admin_storage_jobs', { p_region_id: house.regionId });
    assert.match(l.error?.message ?? '', /forbidden/, 'admin_storage_jobs must be forbidden');
    const c = await who.rpc('admin_complete_storage_job', { p_job_id: job.id });
    assert.match(c.error?.message ?? '', /forbidden/, 'admin_complete_storage_job must be forbidden');
  }
  // Storage denies them (object must survive)
  const p2 = await approved();
  for (const who of [stranger, adminB]) {
    await who.storage.from('photos').remove([p2.publicPath]);
    assert.equal(await objectExists('photos', p2.publicPath), true, 'foreign remove must not delete');
    const mv = await who.storage.from('photos').move(p2.publicPath, `${house.id}/00000000-0000-4000-8000-000000000001.jpg`);
    assert.ok(mv.error, 'foreign move must fail');
  }
  await runFallback(admin, house.regionId, [house.id]); // tidy: leave no open jobs behind
});
