'use client';

import { useState } from 'react';
import { adminSetSeason, getRegionContext, runStorageJobsFallback, toDataError, userMessage, type RegionContext, type Season } from '@/lib/data';
import { applySeason } from '@/lib/theme/applySeason';
import { SEASON_LABEL, isSameSeason, statusLine, switchConfirmText, toggleCopy, yearChoices } from './seasonState';

interface Props {
  ctx: RegionContext;
  onCtx(c: RegionContext): void;
  /** A forbidden error means the session may have dropped to aal1: re-run the gate. */
  onForbidden(): void;
}

type Toast = { ok: boolean; text: string };

export default function SeasonPanel({ ctx, onCtx, onForbidden }: Props) {
  const live = { season: ctx.season, year: ctx.year, open: ctx.submissionsOpen };
  const [target, setTarget] = useState<{ season: Season; year: number }>({ season: ctx.season, year: ctx.year });
  const [confirm, setConfirm] = useState<'toggle' | 'switch' | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const years = yearChoices(ctx.year);
  const same = isSameSeason(live, target);
  const copy = toggleCopy(live.open);

  async function run(season: Season, year: number, open: boolean, success: string) {
    setBusy(true);
    setToast(null);
    try {
      await adminSetSeason(ctx.region.id, season, year, open);
      await runStorageJobsFallback(ctx.region.id).catch(() => undefined); // A.3: run cleanup now; the banner covers failures
      const fresh = await getRegionContext(ctx.region.slug);
      applySeason(fresh.season);
      onCtx(fresh);
      setTarget({ season: fresh.season, year: fresh.year });
      setToast({ ok: true, text: success });
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setToast({ ok: false, text: userMessage(d, ctx.region.name) });
    } finally {
      setConfirm(null);
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Season">
      <div className="status-card" aria-labelledby="sc-h">
        <h3 id="sc-h">{statusLine(live)}</h3>
        {confirm !== 'toggle' ? (
          <button
            type="button"
            className={`btn big ${live.open ? 'alt' : 'primary'}`}
            onClick={() => { setToast(null); setConfirm('toggle'); }}
          >
            {copy.button}
          </button>
        ) : (
          <div className="confirm" role="group" aria-label={`Confirm: ${copy.button}`}>
            <p>{copy.confirm}</p>
            <div className="row">
              <button className="btn primary" type="button" disabled={busy} onClick={() => run(ctx.season, ctx.year, !live.open, live.open ? 'Adding is now CLOSED.' : 'Adding is now OPEN.')}>
                Yes, {copy.button.toLowerCase()}
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="switch-card">
        <h3>Switch season</h3>
        <p className="fine">Pick a different season or year to show on the public map.</p>
        <div className="seg" role="radiogroup" aria-label="Season">
          {(['halloween', 'christmas'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={target.season === s}
              className="seg-b"
              onClick={() => { setConfirm(null); setTarget((t) => ({ ...t, season: s })); }}
            >
              {SEASON_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="Year">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="radio"
              aria-checked={target.year === y}
              className="seg-b"
              onClick={() => { setConfirm(null); setTarget((t) => ({ ...t, year: y })); }}
            >
              {y}
            </button>
          ))}
        </div>
        {confirm !== 'switch' ? (
          <button
            type="button"
            className="btn primary big"
            disabled={same}
            onClick={() => { setToast(null); setConfirm('switch'); }}
          >
            Make this the live season
          </button>
        ) : (
          <div className="confirm" role="group" aria-label="Confirm season switch">
            <p>{switchConfirmText(target)}</p>
            <div className="row">
              <button className="btn alt" type="button" disabled={busy} onClick={() => run(target.season, target.year, false, `Done. ${SEASON_LABEL[target.season]} ${target.year} is live; adding is CLOSED.`)}>
                Yes, switch to {SEASON_LABEL[target.season]} {target.year}
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {same && <p className="fine">That is already the live season.</p>}
      </div>

      <div aria-live="polite" role="status">
        {toast && <p className={`toast ${toast.ok ? 'ok' : 'err'}`}>{toast.text}</p>}
      </div>
    </section>
  );
}
