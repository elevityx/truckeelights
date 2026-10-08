## Moderation & storage-job fallback

- The admin **Photos** tab lists pending photos (oldest first) with 10-minute signed thumbnails, and live photos with a Revoke button. The database enforces admin and AAL2 on every RPC; the UI is not a boundary.
- **Approve** downloads the pending upload, re-encodes it in the browser (`toJpeg`, 1600 px, quality 0.85, metadata dropped) to a new random name `<house>/<uuid>.jpg` in the `photos` bucket, then calls `admin_approve_photo`. If the RPC fails the new object is removed (best effort; the reconciler is the backstop). Any failure leaves the photo not public.
- **Reject** and **Revoke** call their RPCs. After every photo action, hide, release, and season switch the browser runs the open storage jobs itself (`runStorageJobsFallback`): delete kinds `remove`; `rotate_public` is `copy` then `remove` (admins have no UPDATE). "Not found" is fine. Completion is only ever decided by `admin_complete_storage_job`.
- `StorageJobsBanner` polls every 30 s. Any `delete_public`/`rotate_public` job older than 60 s (or any other job older than 2 min) shows a red banner with **Run now**.
- "Visitors can add photos" (`photos_open`, default closed) is separate from house submissions.
