'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminListHouses,
  adminReleaseHouse,
  adminSetHouseStatus,
  listMapHouses,
  toDataError,
  userMessage,
  type AdminHouse,
  type HouseStatus,
  type RegionContext,
} from '@/lib/data';
import SeasonPanel from './SeasonPanel';
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
  const [tab, setTab] = useState<'season' | 'houses'>('season');
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const refreshCount = useCallback(() => {
    listMapHouses(ctx.region.id)
      .then((h) => setVisibleCount(h.length))
      .catch(() => setVisibleCount(null));
  }, [ctx.region.id]);
  useEffect(refreshCount, [refreshCount, ctx.season, ctx.year]);

  return (
    <div className="adm">
      <header className="adm-bar">
        <span className="wm disp">{ctx.wordmark}</span>
        <span className="tag">Back office</span>
        <span className="chip">{ctx.region.name}</span>
        <span className="sp" />
        <Link className="btn ghost" href="/">View public map</Link>
        <button className="btn ghost" type="button" onClick={onSignOut}>Sign out</button>
      </header>
      <div className="adm-in">
        <div className="live" aria-label="Live status">
          <span className="chip">Season <b>{SEASON_LABEL[ctx.season]} {ctx.year}</b></span>
          <span className="chip">Submissions <b>{ctx.submissionsOpen ? 'open' : 'closed'}</b></span>
          <span className="chip">Visible houses <b>{visibleCount ?? '–'}</b></span>
        </div>
        <div className="tabs" role="tablist" aria-label="Back office sections">
          {(['season', 'houses'] as const).map((k) => (
            <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {k === 'season' ? 'Season' : 'Houses'}
            </button>
          ))}
        </div>
        {tab === 'season' ? (
          <SeasonPanel ctx={ctx} onCtx={onCtx} onForbidden={onForbidden} />
        ) : (
          <HousesPanel ctx={ctx} onForbidden={onForbidden} onChanged={refreshCount} />
        )}
      </div>
    </div>
  );
}

function HousesPanel({ ctx, onForbidden, onChanged }: { ctx: RegionContext; onForbidden(): void; onChanged(): void }) {
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
