'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminClaimQueue, adminClearOwner, adminResolveClaim, toDataError, userMessage, type AdminClaim, type RegionContext } from '@/lib/data';
import {
  CLAIM_FILTERS, CLAIM_FILTER_LABEL, type ClaimFilter, CLAIM_REASON_MAX, KIND_LABEL, ageText, approveHint, approveLabel, checkClaimReason, claimActionsFor,
  claimErrorStale, claimErrorText,
} from './claimsState';
import './accounts-admin.css';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
  /** Tells the console to refresh the pending badge. */
  onChanged(): void;
}

export default function ClaimsTab({ ctx, onForbidden, onChanged }: Props) {
  const [status, setStatus] = useState<ClaimFilter>('pending');
  const [rows, setRows] = useState<AdminClaim[] | null>(null);
  const [err, setErr] = useState('');
  const region = ctx.region.id;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setRows(null);
    try {
      const r = await adminClaimQueue(region, status);
      if (mine !== seq.current) return;
      setRows(r);
      setErr('');
    } catch (e) {
      if (mine !== seq.current) return;
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(userMessage(d, ctx.region.name));
    }
  }, [region, status, ctx.region.name, onForbidden]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function changed() {
    await load();
    onChanged();
  }

  return (
    <section className="panel cl-sec" aria-label="Claims">
      <h3>House claims and removal requests</h3>
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Filter claims by status">
          {CLAIM_FILTERS.map((f) => (
            <button key={f} type="button" role="radio" className="seg-b" aria-checked={status === f} onClick={() => setStatus(f)}>{CLAIM_FILTER_LABEL[f]}</button>
          ))}
        </div>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {rows === null ? <p className="fine">Loading…</p> : rows.length === 0 ? <p className="fine">No {CLAIM_FILTER_LABEL[status].toLowerCase()} requests.</p> : (
        <div className="queue">
          {rows.map((c) => <Card key={c.id} claim={c} ctx={ctx} onForbidden={onForbidden} onChanged={changed} />)}
        </div>
      )}
      <p className="fine">Emails are masked on the server. Admins never see a full address.</p>
    </section>
  );
}

function Card({ claim, ctx, onForbidden, onChanged }: { claim: AdminClaim; ctx: RegionContext; onForbidden(): void; onChanged(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [reason, setReason] = useState('');
  const actions = claimActionsFor(claim);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      setRejecting(false);
      setClearing(false);
      await onChanged();
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(claimErrorText(d, userMessage(d, ctx.region.name)));
      if (claimErrorStale(d)) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  function reject() {
    const r = checkClaimReason(reason);
    if (!r.ok) return setErr(r.error);
    void act(() => adminResolveClaim(claim.id, false, r.reason));
  }

  return (
    <div className="qcard cl-card">
      <div className="cl-title">
        <p className="addr">{claim.address}</p>
        <span className="pill">{KIND_LABEL[claim.kind]}</span>
        <span className={`pill ${claim.status === 'pending' ? 'warn' : claim.status === 'approved' ? 'vis' : 'bad'}`}>{claim.status}</span>
      </div>
      <dl className="cl-kv">
        <dt>{claim.kind === 'removal' ? 'Owner' : 'Claimant'}</dt><dd className="mask">{claim.claimantMasked || 'unknown'}</dd>
        <dt>Owner now</dt><dd className={claim.currentOwnerMasked ? 'mask' : ''}>{claim.currentOwnerMasked ?? 'None'}</dd>
        <dt>House</dt><dd>{claim.houseStatus}</dd>
        {claim.note && (<><dt>Note</dt><dd className="cl-note">{claim.note}</dd></>)}
        <dt>Sent</dt><dd>{ageText(claim.createdAt)}</dd>
        {claim.reason && (<><dt>Reason</dt><dd>{claim.reason}</dd></>)}
      </dl>
      {err && <p className="err" role="alert">{err}</p>}
      {actions.length === 0 ? null : rejecting ? (
        <div className="confirm" role="group" aria-label="Reject request">
          <label className="lbl">
            Reason (optional, kept for admins)
            <input className="field" value={reason} maxLength={CLAIM_REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={reject}>Reject</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      ) : clearing ? (
        <div className="confirm" role="group" aria-label="Clear owner">
          <p>Clear the owner of this house? Nobody will be able to manage it until someone is approved. The house stays on the map.</p>
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={() => void act(() => adminClearOwner(claim.houseId))}>Clear owner</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setClearing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="fine">{approveHint(claim)}</p>
          <div className="row">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void act(() => adminResolveClaim(claim.id, true))}>{approveLabel(claim.kind)}</button>
            <button className="btn danger" type="button" disabled={busy} onClick={() => { setRejecting(true); setErr(''); }}>Reject…</button>
            {actions.includes('clear_owner') && (
              <button className="btn ghost" type="button" disabled={busy} onClick={() => { setClearing(true); setErr(''); }}>Clear owner…</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
