'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminApprovePhoto,
  adminPhotoPreviewUrl,
  adminPhotoQueue,
  adminRejectPhoto,
  adminRevokePhoto,
  adminSetPhotosOpen,
  getRegionContext,
  runStorageJobsFallback,
  toDataError,
  userMessage,
  type AdminPhoto,
  type RegionContext,
} from '@/lib/data';
import { relativeAge } from './photosState';
import './photos-admin.css';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
}

export default function PhotoQueue({ ctx, onForbidden }: Props) {
  const [open, setOpen] = useState(ctx.photosOpen);
  const [pending, setPending] = useState<AdminPhoto[] | null>(null);
  const [live, setLive] = useState<AdminPhoto[] | null>(null);
  const [err, setErr] = useState('');
  const [switchBusy, setSwitchBusy] = useState(false);
  const region = ctx.region.id;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [p, a] = await Promise.all([adminPhotoQueue(region, 'pending'), adminPhotoQueue(region, 'approved')]);
      if (mine !== seq.current) return;
      setPending(p);
      setLive(a);
      setErr('');
    } catch (e) {
      if (mine !== seq.current) return;
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
  }, [region, ctx.region.name, onForbidden]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function toggle() {
    setSwitchBusy(true);
    setErr('');
    try {
      await adminSetPhotosOpen(region, !open);
      const fresh = await getRegionContext(ctx.region.slug); // show what the database says
      setOpen(fresh.photosOpen);
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    } finally {
      setSwitchBusy(false);
    }
  }

  return (
    <section className="panel pq-sec" aria-label="Photos">
      <div className="pq-head">
        <h3>Photos</h3>
        <button className="sw" type="button" role="switch" aria-checked={open} disabled={switchBusy} onClick={() => void toggle()}>
          <span className="tr" aria-hidden="true" />
          Visitors can add photos
        </button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <h4>Pending{pending ? ` (${pending.length})` : ''}</h4>
      {pending === null ? <p className="fine">Loading…</p> : pending.length === 0 ? <p className="fine">Nothing waiting for review.</p> : (
        <div className="queue">
          {pending.map((p) => (
            <Card key={p.id} photo={p} region={region} ctxName={ctx.region.name} onForbidden={onForbidden} onChanged={load} />
          ))}
        </div>
      )}
      <h4>Live photos{live ? ` (${live.length})` : ''}</h4>
      {live === null ? <p className="fine">Loading…</p> : live.length === 0 ? <p className="fine">No photos are live.</p> : (
        <div className="queue">
          {live.map((p) => (
            <Card key={p.id} photo={p} region={region} ctxName={ctx.region.name} onForbidden={onForbidden} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function Card({ photo, region, ctxName, onForbidden, onChanged }: {
  photo: AdminPhoto; region: string; ctxName: string; onForbidden(): void; onChanged(): Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [thumbErr, setThumbErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    adminPhotoPreviewUrl(photo).then((u) => alive && setUrl(u), () => alive && setThumbErr(true));
    return () => {
      alive = false;
    };
  }, [photo]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    setUnreadable(false);
    try {
      await fn();
      await runStorageJobsFallback(region).catch(() => undefined); // A.3: run cleanup now; the banner covers failures
      await onChanged();
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      if (d.code === 'not_pending' || d.code === 'not_approved') {
        setErr(userMessage(d, ctxName));
        await onChanged();
      } else if (d.code === 'invalid_image') setUnreadable(true);
      else setErr(userMessage(d, ctxName));
    } finally {
      setBusy(false);
      setConfirmRevoke(false);
    }
  }

  const pending = photo.status === 'pending';
  return (
    <div className="qcard">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={url} alt={`Photo at ${photo.address}`} loading="lazy" onError={() => setThumbErr(true)} />
      ) : (
        <div className="thumb ph">{thumbErr ? 'Preview unavailable' : 'Loading…'}</div>
      )}
      <p className="addr">{photo.address}</p>
      <p className="fine">{relativeAge(photo.createdAt, now)}</p>
      {unreadable && <p className="err" role="alert">This image couldn&apos;t be read. Reject it?</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {pending ? (
        <div className="row">
          <button className="btn primary" type="button" disabled={busy || thumbErr} onClick={() => void act(() => adminApprovePhoto(photo))}>
            {err && !unreadable ? 'Try again' : 'Approve'}
          </button>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void act(() => adminRejectPhoto(photo.id))}>Reject</button>
        </div>
      ) : confirmRevoke ? (
        <div className="confirm" role="group" aria-label="Confirm revoke">
          <p>Remove this photo from the site? It can&apos;t be undone.</p>
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={() => void act(() => adminRevokePhoto(photo.id))}>Remove</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn danger" type="button" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke</button>
        </div>
      )}
    </div>
  );
}
