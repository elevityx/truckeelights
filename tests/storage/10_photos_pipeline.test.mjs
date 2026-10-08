// WP-D: photo pipeline against the LOCAL stack (AC3, AC7, AC9). Written test-first against Amendment 1:
// fails until WP-A (migrations, storage policies, photo-urls signer, runner script) lands.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  URL_, PUBLISHABLE, newClient, anonClient, adminAal2, sql, lit, jpegBlob, makeHouse, enablePhotos,
  uploadPhoto, approvePhoto, leakedUrl, fetchStatus, objectExists, runJobs, waitFor,
} from './_local.mjs';

let admin, adminB, user, other, house;

before(async () => {
  await enablePhotos();
  admin = await adminAal2('global');
  adminB = await adminAal2('testville');
  user = await anonClient();
  other = await anonClient();
  house = await makeHouse('truckee', 'pipe');
});

const photoRow = async (id) => (await sql(`select status, public_path, upload_path from public.photos where id = ${lit(id)}`))[0];
const signer = async (houseId) => user.functions.invoke('photo-urls', { body: { house_id: houseId } });

test('1: reserve, upload, confirm -> pending; another anon cannot upload there; no overwrite; no public sign/download of uploads', async () => {
  const p = await uploadPhoto(user, house.id);
  assert.equal(p.confirm, 'pending');
  assert.equal((await photoRow(p.photoId)).status, 'pending');
  // second anon can't write to the first one's reserved path
  const x = await other.storage.from('photo-uploads').upload(p.uploadPath, jpegBlob(), { contentType: 'image/jpeg', upsert: false });
  assert.ok(x.error, 'another user must not upload to a foreign reservation path');
  // uploader can't overwrite
  const o = await user.storage.from('photo-uploads').upload(p.uploadPath, jpegBlob(), { contentType: 'image/jpeg', upsert: true });
  assert.ok(o.error, 'upsert over own object must fail (no UPDATE policy)');
  // nobody but admins can sign/download uploads
  for (const c of [user, other, newClient()]) {
    const s = await c.storage.from('photo-uploads').createSignedUrl(p.uploadPath, 60);
    assert.ok(s.error, 'non-admin must not sign a photo-uploads object');
    const d = await c.storage.from('photo-uploads').download(p.uploadPath);
    assert.ok(d.error, 'non-admin must not download a photo-uploads object');
  }
});

test('2: unconfirmed upload expires -> object removed by the runner, row tombstoned (never deleted)', async () => {
  const p = await uploadPhoto(user, house.id, { confirm: false });
  assert.equal(await objectExists('photo-uploads', p.uploadPath), true);
  await sql(`update public.photos set reserved_until = now() - interval '1 minute' where id = ${lit(p.photoId)}`);
  await sql('select private.sweep_photos()');
  assert.equal((await photoRow(p.photoId)).status, 'expired');
  assert.ok(await runJobs([house.id]), 'jobs should drain with the runner on');
  assert.ok(await waitFor(async () => !(await objectExists('photo-uploads', p.uploadPath))), 'upload object should be gone');
  assert.equal((await photoRow(p.photoId)).status, 'expired', 'row stays (tombstone)');
});

test('3-6: approve -> signer 1 h URL; leaked 10-year URL dies on hide (rotate), unhide works, revoke deletes; half-failed approval is reconciled', async () => {
  // 3: approve, mint the "leaked" 10-year URL with the secret key
  const p = await uploadPhoto(user, house.id);
  const publicPath = await approvePhoto(admin, { regionId: house.regionId, houseId: house.id, photoId: p.photoId });
  const row = await photoRow(p.photoId);
  assert.equal(row.status, 'approved');
  assert.equal(row.public_path, publicPath);
  const longUrl = await leakedUrl('photos', publicPath);
  assert.equal(await fetchStatus(longUrl), 200);
  // public signing is closed; the signer function is the only way (200, 1 h)
  const pub = await user.storage.from('photos').createSignedUrl(publicPath, 3600);
  assert.ok(pub.error, 'anon must not sign photos directly');
  const sg = await signer(house.id);
  assert.equal(sg.error, null, sg.error?.message);
  const mine = sg.data.photos.find((x) => x.id === p.photoId);
  assert.ok(mine?.url, 'signer returns the approved photo');
  assert.equal(await fetchStatus(mine.url), 200);

  // 4: runner ON, hide -> rotate; the leaked URL stops working and public_path changed
  const h = await admin.rpc('admin_set_house_status', { p_house_id: house.id, p_status: 'hidden', p_reason: 'storage test' });
  assert.equal(h.error, null, h.error?.message);
  assert.ok(await runJobs([house.id]));
  assert.ok(await waitFor(async () => (await fetchStatus(longUrl)) !== 200), 'the 10-year URL must fail after hide');
  const rotated = (await photoRow(p.photoId)).public_path;
  assert.notEqual(rotated, publicPath, 'public_path must rotate');
  const hiddenSigner = await signer(house.id);
  assert.deepEqual(hiddenSigner.data?.photos ?? [], [], 'hidden house signs nothing');
  const u = await admin.rpc('admin_set_house_status', { p_house_id: house.id, p_status: 'visible', p_reason: null });
  assert.equal(u.error, null, u.error?.message);
  const again = await signer(house.id);
  const url2 = again.data.photos.find((x) => x.id === p.photoId)?.url;
  assert.ok(url2, 'unhidden: signer returns the rotated path');
  assert.equal(await fetchStatus(url2), 200);

  // 5: revoke -> URL fails, object gone
  const rotatedUrl = await leakedUrl('photos', rotated);
  const rv = await admin.rpc('admin_revoke_photo', { p_photo_id: p.photoId });
  assert.equal(rv.error, null, rv.error?.message);
  assert.ok(await runJobs([house.id]));
  assert.ok(await waitFor(async () => (await fetchStatus(rotatedUrl)) !== 200), 'URL must fail after revoke');
  assert.equal(await objectExists('photos', rotated), false);
  assert.equal((await photoRow(p.photoId)).status, 'revoked');

  // 6: approve-half-fail: object in `photos` without an approve call -> unsigned, then reconciled
  const orphan = `${house.id}/${crypto.randomUUID()}.jpg`;
  const up = await admin.storage.from('photos').upload(orphan, jpegBlob(), { contentType: 'image/jpeg', upsert: false });
  assert.equal(up.error, null, up.error?.message);
  const s = await user.storage.from('photos').createSignedUrl(orphan, 60);
  assert.ok(s.error, 'anon cannot sign an unapproved object');
  assert.ok(!(await signer(house.id)).data.photos.some((x) => x.url.includes(orphan)), 'signer never lists an unreferenced object');
  await sql(`update storage.objects set created_at = now() - interval '2 days' where bucket_id = 'photos' and name = ${lit(orphan)}`);
  await sql('select private.reconcile_storage()');
  assert.ok(await runJobs([house.id]));
  assert.ok(await waitFor(async () => !(await objectExists('photos', orphan))), 'orphan should be reconciled away');
});

test('7: negative Storage tests (AC3)', async () => {
  const p = await uploadPhoto(user, house.id);
  const publicPath = await approvePhoto(admin, { regionId: house.regionId, houseId: house.id, photoId: p.photoId });
  // list on both buckets: empty or error
  for (const bucket of ['photos', 'photo-uploads']) {
    const l = await newClient().storage.from(bucket).list(house.id);
    assert.ok(l.error || (l.data ?? []).length === 0, `anon list on ${bucket} must be empty/denied`);
    const l2 = await user.storage.from(bucket).list(house.id);
    assert.ok(l2.error || (l2.data ?? []).length === 0, `authenticated non-admin list on ${bucket} must be empty/denied`);
  }
  // direct authenticated-path download as anon
  const r = await fetch(`${URL_}/storage/v1/object/authenticated/photos/${publicPath}`, { headers: { apikey: PUBLISHABLE } });
  assert.notEqual(r.status, 200);
  const r2 = await fetch(`${URL_}/storage/v1/object/public/photos/${publicPath}`);
  assert.notEqual(r2.status, 200, 'buckets are private');
  // anon createSignedUrl
  assert.ok((await newClient().storage.from('photos').createSignedUrl(publicPath, 60)).error);
  // admin cannot overwrite or update an approved path
  const up = await admin.storage.from('photos').upload(publicPath, jpegBlob(), { contentType: 'image/jpeg', upsert: true });
  assert.ok(up.error, 'admin upsert must fail (no UPDATE policy)');
  const upd = await admin.storage.from('photos').update(publicPath, jpegBlob(), { contentType: 'image/jpeg' });
  assert.ok(upd.error, 'admin update must fail');
  // cross-region: Testville admin cannot copy into a Truckee house folder (control: same-region copy works)
  const tv = await makeHouse('testville', 'pipe');
  const src = `${tv.id}/${crypto.randomUUID()}.jpg`;
  const mk = await admin.storage.from('photos').upload(src, jpegBlob(), { contentType: 'image/jpeg', upsert: false });
  assert.equal(mk.error, null, mk.error?.message);
  const okDest = `${tv.id}/${crypto.randomUUID()}.jpg`;
  const ctl = await adminB.storage.from('photos').copy(src, okDest);
  assert.equal(ctl.error, null, `control: region admin copy within own region should work: ${ctl.error?.message}`);
  const bad = await adminB.storage.from('photos').copy(src, `${house.id}/${crypto.randomUUID()}.jpg`);
  assert.ok(bad.error, 'region admin must not copy into another region');
  await admin.storage.from('photos').remove([src, okDest]);
  // exactly the 6 policies, none for anon, none UPDATE/ALL
  const pol = await sql(`select policyname, roles::text as roles, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tl\\_%'`);
  assert.equal(pol.length, 6, `expected 6 tl_* policies, got ${pol.map((x) => x.policyname)}`);
  assert.ok(pol.every((x) => !/anon|public/.test(x.roles) && !['UPDATE', 'ALL'].includes(x.cmd)));
});
