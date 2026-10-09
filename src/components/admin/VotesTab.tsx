'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminNetworkCapStatus,
  adminSetNetworkCap,
  adminSetVotesOpen,
  adminVoidVotes,
  adminVoteStats,
  getRegionContext,
  toDataError,
  userMessage,
  type AdminVoteRow,
  type RegionContext,
} from '@/lib/data';
import { switchChecked, switchDisabled, switchFromOpen, switchStatusText, switchTarget } from './photosState';
import {
  capBannerVisible, capFromBool, nowMs, capText, flooded, shortUid, topShare, voidArgs, voidConfirmText, voidResultText,
  type CapState, type VoidKind, type VotesSwitch,
} from './votesState';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
}

export default function VotesTab({ ctx, onForbidden }: Props) {
  const region = ctx.region.id;
  const slug = ctx.region.slug;
  const [sw, setSw] = useState<VotesSwitch>({ kind: 'loading' });
  const [swBusy, setSwBusy] = useState(false);
  const [cap, setCap] = useState<CapState>({ kind: 'loading' });
  const [capBusy, setCapBusy] = useState(false);
  const [rows, setRows] = useState<AdminVoteRow[] | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<{ houseId: string; kind: VoidKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Voting switch: always the server's votes_open, never a default.
  const loadSwitch = useCallback(async () => {
    setSw({ kind: 'loading' });
    try {
      const fresh = await getRegionContext(slug);
      setSw(switchFromOpen(fresh.votesOpen));
    } catch {
      setSw({ kind: 'unknown' });
    }
  }, [slug]);

  // Network cap: global-admin read; forbidden means a region-only admin.
  const loadCap = useCallback(async () => {
    setCap({ kind: 'loading' });
    try {
      setCap(capFromBool(await adminNetworkCapStatus()));
    } catch (e) {
      setCap(toDataError(e).code === 'forbidden' ? { kind: 'managed' } : { kind: 'unknown' });
    }
  }, []);

  const loadStats = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await adminVoteStats(region);
      if (mine !== seq.current) return;
      setRows(r);
      setErr('');
    } catch (e) {
      if (mine !== seq.current) return;
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
  }, [region, ctx.region.name, onForbidden]);

  useEffect(() => {
    const t = setTimeout(() => { void loadSwitch(); void loadCap(); void loadStats(); }, 0);
    return () => clearTimeout(t);
  }, [loadSwitch, loadCap, loadStats]);

  async function toggle() {
    const target = switchTarget(sw);
    if (target === null) return;
    setSwBusy(true);
    setErr('');
    try {
      await adminSetVotesOpen(region, target);
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
    try {
      const fresh = await getRegionContext(slug); // show what the database says, even after an error
      setSw(switchFromOpen(fresh.votesOpen));
    } catch {
      setSw({ kind: 'unknown' });
    } finally {
      setSwBusy(false);
    }
    void loadCap();
  }

  // Global admin only. Always re-reads the server's answer afterwards, even after an error.
  async function toggleCap() {
    if (cap.kind !== 'on' && cap.kind !== 'off') return;
    setCapBusy(true);
    setErr('');
    try {
      await adminSetNetworkCap(cap.kind === 'off');
    } catch (e) {
      const d = toDataError(e);
      if (d.code !== 'forbidden') setErr(userMessage(d, ctx.region.name));
    }
    try {
      await loadCap(); // forbidden here becomes the "managed by the site owner" state
    } finally {
      setCapBusy(false);
    }
  }

  async function runVoid(row: AdminVoteRow, kind: VoidKind) {
    const a = voidArgs(kind, row, nowMs());
    if (!a) return;
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const n = await adminVoidVotes(row.houseId, a.since, a.uid);
      setNote(`${row.address}: ${voidResultText(n)}`);
      setPending(null);
      await loadStats();
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Votes">
      <div className="pq-head">
        <h3>Votes</h3>
        <button className="sw" type="button" role="switch" aria-checked={switchChecked(sw)} disabled={switchDisabled(sw, swBusy)} onClick={() => void toggle()}>
          <span className="tr" aria-hidden="true" />
          Voting open: {switchStatusText(sw)}
        </button>
        {sw.kind === 'unknown' && (
          <span role="alert" className="err">
            Couldn&apos;t check whether voting is on. <button className="btn ghost" type="button" onClick={() => void loadSwitch()}>Retry</button>
          </span>
        )}
      </div>

      <div className="capline">
        <span className="chip">{capText(cap)}</span>
        {cap.kind === 'unknown' && (
          <button className="btn ghost" type="button" onClick={() => void loadCap()}>Retry</button>
        )}
        {(cap.kind === 'on' || cap.kind === 'off') && (
          <>
            <button className="sw" type="button" role="switch" aria-checked={cap.kind === 'on'} disabled={capBusy} onClick={() => void toggleCap()}>
              <span className="tr" aria-hidden="true" />
              Network cap: {capBusy ? 'working…' : cap.kind === 'on' ? 'on' : 'off'}
            </button>
            <span className="fine">Only turn on after the network check passes.</span>
          </>
        )}
      </div>
      {capBannerVisible(sw, cap) && (
        <div className="warn-banner" role="status">
          Voting is open but the per-network cap is off or unverified. Only the per-device limits and the flood breakers are protecting votes.
        </div>
      )}

      {err && <p className="err" role="alert">{err}</p>}
      {note && <p className="ok" role="status">{note}</p>}

      <p className="fine">
        Flood breakers (per house and per region) run in the database and show up to voters as rate limits. Rows are highlighted when one voter holds half or more of the last 24 hours.
      </p>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th>Address</th><th>Total</th><th>Today</th><th>24 h</th><th>Voters 24 h</th><th>Top voter</th><th>Networks today</th><th>Voided</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={9}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={9}>No votes yet.</td></tr>}
            {rows?.map((r) => {
              const share = topShare(r);
              const hot = flooded(r);
              const isPending = pending?.houseId === r.houseId;
              return (
                <tr key={r.houseId} className={hot ? 'flood' : ''}>
                  <td>{r.address}{hot && <div className="fine">Flood watch</div>}</td>
                  <td>{r.totalVotes}</td>
                  <td>{r.votesToday}</td>
                  <td>{r.votes24h}</td>
                  <td>{r.voters24h}</td>
                  <td>{r.topVoter ? <><code>{shortUid(r.topVoter)}</code> {share === null ? '' : `${share}%`}</> : '–'}</td>
                  <td>{r.networksToday > 0 ? `${r.networksToday} (top ${r.topNetworkToday})` : '–'}</td>
                  <td>{r.voided}</td>
                  <td>
                    {!isPending && (
                      <div className="hideform">
                        <button className="btn ghost" type="button" disabled={busy} onClick={() => setPending({ houseId: r.houseId, kind: 'hour' })}>Void last hour…</button>
                        <button className="btn ghost" type="button" disabled={busy || !r.topVoter} onClick={() => setPending({ houseId: r.houseId, kind: 'top' })}>Void top voter…</button>
                        <button className="btn danger" type="button" disabled={busy} onClick={() => setPending({ houseId: r.houseId, kind: 'reset' })}>Reset to 0…</button>
                      </div>
                    )}
                    {isPending && pending && (
                      <div className="confirm">
                        <p>{voidConfirmText(pending.kind, r.address, r)}</p>
                        <div className="row">
                          <button className="btn danger" type="button" disabled={busy} onClick={() => void runVoid(r, pending.kind)}>{busy ? 'Working…' : 'Confirm'}</button>
                          <button className="btn ghost" type="button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
