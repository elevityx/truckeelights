'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminEventCounts,
  adminListHouses,
  adminReleaseHouse,
  adminSetHouseStatus,
  listMapHouses,
  runStorageJobsFallback,
  toDataError,
  userMessage,
  type AdminHouse,
  type HouseStatus,
  type RegionContext,
} from '@/lib/data';
import EventsTab from './EventsTab';
import PhotoQueue from './PhotoQueue';
import SeasonPanel from './SeasonPanel';
import StorageJobsBanner from './StorageJobsBanner';
import { CLEANUP_WARNING, settleCleanup } from './photosState';
import { badgeText } from './eventsState';
import { SEASON_LABEL } from './seasonState';

const REASONS = ['Duplicate', 'Not a display', 'Owner asked us to remove it', 'Inappropriate', 'Other'];

interface Props {
  ctx: RegionContext;
  onCtx(c: RegionContext): void;
  /** A forbidden error means the session may have dropped to aal1: re-run the gate. */
  onForbidden(): void;
  onSignOut(): void;
}

export default function Console({ ctx, onCtx, onForbidden, onSignOut }: Props) {
  const [tab, setTab] = useState<'season' | 'houses' | 'photos' | 'events'>('season');
  // A1: no events key in the context means a database without events: hide the tab and never call it.
  const hasEvents = ctx.events !== undefined;
  const [pendingEvents, setPendingEvents] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [bannerTick, setBannerTick] = useState(0);

  /** A.3: run cleanup now. A throw or leftover jobs raises a visible warning; success clears it. */
  const runCleanup = useCallback(async () => {
    const r = await settleCleanup(() => runStorageJobsFallback(ctx.region.id));
    setCleanupPending(r.pending);
    setBannerTick((n) => n + 1);
    return r;
  }, [ctx.region.id]);
  const cleanupAfterAction = useCallback(async () => { await runCleanup(); }, [runCleanup]);
  async function retryCleanup() {
    setCleanupBusy(true);
    try { await runCleanup(); } finally { setCleanupBusy(false); }
  }

  const refreshCount = useCallback(() => {
    listMapHouses(ctx.region.id)
      .then((h) => setVisibleCount(h.length))
      .catch(() => setVisibleCount(null));
  }, [ctx.region.id]);
  useEffect(refreshCount, [refreshCount, ctx.season, ctx.year]);

  const refreshEventCount = useCallback(() => {
    if (!hasEvents) return;
    adminEventCounts(ctx.region.id)
      .then((c) => setPendingEvents(c.pending))
      .catch(() => setPendingEvents(null));
  }, [ctx.region.id, hasEvents]);
  useEffect(() => {
    const t = setTimeout(refreshEventCount, 0);
    return () => clearTimeout(t);
  }, [refreshEventCount]);

  return (
    <div className="adm">
      <header className="adm-bar">
        <span className="wm disp">{ctx.wordmark}</span>
        <span className="tag">Back office</span>
        <span className="chip">{ctx.region.name}</span>
        <span className="sp" />
        <Link className="btn ghost" href="/">View public map</Link>
        <Link className="btn ghost" href={`/flyer/?season=${ctx.season}`}>Print a flyer</Link>
        <button className="btn ghost" type="button" onClick={onSignOut}>Sign out</button>
      </header>
      <div className="adm-in">
        <div className="live" aria-label="Live status">
          <span className="chip">Season <b>{SEASON_LABEL[ctx.season]} {ctx.year}</b></span>
          <span className="chip">Submissions <b>{ctx.submissionsOpen ? 'open' : 'closed'}</b></span>
          <span className="chip">Visible houses <b>{visibleCount ?? '–'}</b></span>
        </div>
        <StorageJobsBanner ctx={ctx} onForbidden={onForbidden} refreshKey={bannerTick} />
        {cleanupPending && (
          <div className="confirm" role="status">
            <p>{CLEANUP_WARNING}</p>
            <div className="row">
              <button className="btn ghost" type="button" disabled={cleanupBusy} onClick={() => void retryCleanup()}>{cleanupBusy ? 'Retrying…' : 'Retry'}</button>
            </div>
          </div>
        )}
        <div className="tabs" role="tablist" aria-label="Back office sections">
          {(hasEvents ? (['season', 'houses', 'photos', 'events'] as const) : (['season', 'houses', 'photos'] as const)).map((k) => (
            <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {k === 'season' ? 'Season' : k === 'houses' ? 'Houses' : k === 'photos' ? 'Photos' : badgeText(pendingEvents)}
            </button>
          ))}
        </div>
        {tab === 'season' && <SeasonPanel ctx={ctx} onCtx={onCtx} onForbidden={onForbidden} onCleanup={runCleanup} />}
        {tab === 'houses' && <HousesPanel ctx={ctx} onForbidden={onForbidden} onChanged={refreshCount} onCleanup={cleanupAfterAction} />}
        {tab === 'photos' && <PhotoQueue ctx={ctx} onForbidden={onForbidden} onCleanup={cleanupAfterAction} />}
        {tab === 'events' && hasEvents && <EventsTab ctx={ctx} onForbidden={onForbidden} onChanged={refreshEventCount} />}
      </div>
    </div>
  );
}

function HousesPanel({ ctx, onForbidden, onChanged, onCleanup }: { ctx: RegionContext; onForbidden(): void; onChanged(): void; onCleanup(): Promise<void> }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<HouseStatus | ''>('');
  const [rows, setRows] = useState<AdminHouse[] | null>(null);
  const [err, setErr] = useState('');
  const [hiding, setHiding] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await adminListHouses(ctx.region.id, status === '' ? null : status, debounced === '' ? null : debounced);
      if (mine === seq.current) {
        setRows(r);
        setErr('');
      }
    } catch (e) {
      if (mine !== seq.current) return;
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
  }, [ctx.region.id, ctx.region.name, status, debounced, onForbidden]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await onCleanup(); // A.3: warning shows in the console if cleanup stays pending
      setHiding(null);
      setReleasing(null);
      await load();
      onChanged();
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Houses">
      <h3>Houses</h3>
      <div className="toolbar">
        <label className="lbl">
          Search
          <input className="field" type="search" placeholder="Address" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="lbl">
          Status
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as HouseStatus | '')}>
            <option value="">All</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="released">Released</option>
          </select>
        </label>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th>Address</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={3}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={3}>No houses match.</td></tr>}
            {rows?.map((h) => (
              <tr key={h.id} className={h.status === 'visible' ? '' : 'dim'}>
                <td>
                  {h.address}
                  <div className="fine">{SEASON_LABEL[h.season]} {h.year}{h.hiddenReason ? ` · ${h.hiddenReason}` : ''}</div>
                </td>
                <td><span className={`pill ${h.status === 'visible' ? 'vis' : h.status === 'hidden' ? 'hid' : ''}`}>{h.status}</span></td>
                <td>
                  {h.status === 'visible' && hiding !== h.id && (
                    <button className="btn ghost" type="button" onClick={() => { setHiding(h.id); setReason(REASONS[0]); }}>Hide…</button>
                  )}
                  {h.status === 'visible' && hiding === h.id && (
                    <div className="hideform">
                      <select className="field" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                        {REASONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                      <button className="btn danger" type="button" disabled={busy} onClick={() => act(() => adminSetHouseStatus(h.id, 'hidden', reason))}>Hide</button>
                      <button className="btn ghost" type="button" onClick={() => setHiding(null)}>Cancel</button>
                    </div>
                  )}
                  {h.status === 'hidden' && releasing !== h.id && (
                    <div className="hideform">
                      <button className="btn ghost" type="button" disabled={busy} onClick={() => act(() => adminSetHouseStatus(h.id, 'visible', null))}>Unhide</button>
                      <button className="btn danger" type="button" onClick={() => setReleasing(h.id)}>Release…</button>
                    </div>
                  )}
                  {h.status === 'hidden' && releasing === h.id && (
                    <div className="confirm">
                      <p>Release frees this address so it can be added again. It can&apos;t be undone.</p>
                      <div className="row">
                        <button className="btn danger" type="button" disabled={busy} onClick={() => act(() => adminReleaseHouse(h.id))}>Release</button>
                        <button className="btn ghost" type="button" onClick={() => setReleasing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
