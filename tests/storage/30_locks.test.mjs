// AC17 (Amendment 1 A.2): rotate-finish racing revoke on the same photo, 20 iterations: no deadlock (40P01),
// final state revoked / public_path null / both names deleted after the runner drains.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { adminAal2, sql, sqlRaw, lit, jpegBlob, makeHouse, enablePhotos, objectExists, runJobs, waitFor } from './_local.mjs';

let admin, house;
before(async () => { await enablePhotos(); admin = await adminAal2('global'); house = await makeHouse('truckee', 'lock'); });

test('20x: finish_storage_job (rotate, new object exists) races admin_revoke_photo', async () => {
  for (let i = 0; i < 20; i += 1) {
    const id = crypto.randomUUID();
    const oldPath = `${house.id}/${crypto.randomUUID()}.jpg`;
    const newPath = `${house.id}/${crypto.randomUUID()}.jpg`;
    const up = await admin.storage.from('photos').upload(newPath, jpegBlob(), { contentType: 'image/jpeg', upsert: false });
    assert.equal(up.error, null, up.error?.message);
    await sql(`insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until)
               values (${lit(id)}, ${lit(house.id)}, ${lit(`${house.id}/${id}.jpg`)}, ${lit(oldPath)}, 'approved', now())`);
    const [{ jid }] = await sql(`insert into private.storage_jobs (kind, bucket, object_name, new_object_name, photo_id, region_id)
               values ('rotate_public', 'photos', ${lit(oldPath)}, ${lit(newPath)}, ${lit(id)}, ${lit(house.regionId)}) returning id as jid`);
    const [fin, rev] = await Promise.all([
      sqlRaw(`select private.finish_storage_job(${jid})`),
      admin.rpc('admin_revoke_photo', { p_photo_id: id }),
    ]);
    assert.ok(!/40P01|deadlock/i.test(fin.text), `iteration ${i}: deadlock in finish_storage_job: ${fin.text.slice(0, 200)}`);
    assert.ok(!/40P01|deadlock/i.test(rev.error?.message ?? '') && rev.error?.code !== '40P01', `iteration ${i}: deadlock in revoke`);
    assert.equal(rev.error, null, `iteration ${i}: revoke failed: ${rev.error?.message}`);
    assert.ok(await runJobs([house.id]), `iteration ${i}: jobs drain`);
    const row = (await sql(`select status, public_path from public.photos where id = ${lit(id)}`))[0];
    assert.equal(row.status, 'revoked');
    assert.equal(row.public_path, null);
    assert.ok(await waitFor(async () => !(await objectExists('photos', newPath)) && !(await objectExists('photos', oldPath))),
      `iteration ${i}: both names deleted`);
  }
});
