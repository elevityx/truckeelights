'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminStorageJobs, runStorageJobsFallback, toDataError, userMessage, type RegionContext } from '@/lib/data';
import { bannerText, runResultText, stuckJobs } from './photosState';
import './photos-admin.css';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
  /** Bump to re-poll immediately (after a cleanup attempt). */
  refreshKey?: number;
}

const POLL_MS = 30_000;

export default function StorageJobsBanner({ ctx, onForbidden, refreshKey = 0 }: Props) {
  const [stuck, setStuck] = useState(0);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const forbidden = useRef(onForbidden);
  useEffect(() => {
    forbidden.current = onForbidden;
  }, [onForbidden]);

  const poll = useCallback(async () => {
    try {
      const jobs = await adminStorageJobs(ctx.region.id);
      setStuck(stuckJobs(jobs, Date.now()).length);
    } catch (e) {
      if (toDataError(e).code === 'forbidden') forbidden.current();
      // Other errors: keep the last known state; the next poll retries.
    }
  }, [ctx.region.id]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [poll, refreshKey]);

  async function runNow() {
    setBusy(true);
    setErr('');
    try {
      setNote(runResultText(await runStorageJobsFallback(ctx.region.id)));
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return forbidden.current();
      setErr(userMessage(d, ctx.region.name));
    } finally {
      setBusy(false);
    }
    await poll();
  }

  if (stuck === 0 && !note && !err) return null;
  return (
    <div className="confirm jobs-banner" role="alert">
      {stuck > 0 && <p>{bannerText(stuck)}</p>}
      {note && <p className="fine">{note}</p>}
      {err && <p className="err">{err}</p>}
      {stuck > 0 && (
        <div className="row">
          <button className="btn danger" type="button" disabled={busy} onClick={() => void runNow()}>
            {busy ? 'Running…' : err ? 'Try again' : 'Run now'}
          </button>
        </div>
      )}
    </div>
  );
}
