'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminCreateEvent,
  adminEventQueue,
  adminModerateEvent,
  adminSetEventsOpen,
  adminUpdateEvent,
  getRegionContext,
  toDataError,
  userMessage,
  type AdminEvent,
  type EventInput,
  type EventStatus,
  type RegionContext,
} from '@/lib/data';
import { switchChecked, switchDisabled, switchFromOpen, switchStatusText, switchTarget, type PhotosSwitch } from './photosState';
import {
  FILTERS, FILTER_LABEL, actionsFor, buildEventInput, checkReason, displayHost, emptyForm, eventErrorText, formFromEvent, REASON_MAX,
  type EventFormValues, type FormErrors,
} from './eventsState';
import './events-admin.css';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
  /** Tells the console to refresh the pending badge. */
  onChanged(): void;
}

const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export default function EventsTab({ ctx, onForbidden, onChanged }: Props) {
  const [status, setStatus] = useState<EventStatus>('pending');
  const [rows, setRows] = useState<AdminEvent[] | null>(null);
  const [err, setErr] = useState('');
  const [sw, setSw] = useState<PhotosSwitch>({ kind: 'loading' });
  const [switchBusy, setSwitchBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const region = ctx.region.id;
  const slug = ctx.region.slug;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setRows(null);
    try {
      const r = await adminEventQueue(region, status);
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

  // The switch always shows the server's events.open: loaded on mount, never defaulted.
  const loadSwitch = useCallback(async () => {
    setSw({ kind: 'loading' });
    try {
      const fresh = await getRegionContext(slug);
      setSw(fresh.events ? switchFromOpen(fresh.events.open) : { kind: 'unknown' });
    } catch {
      setSw({ kind: 'unknown' });
    }
  }, [slug]);
  useEffect(() => {
    const t = setTimeout(() => void loadSwitch(), 0);
    return () => clearTimeout(t);
  }, [loadSwitch]);

  async function toggle() {
    const target = switchTarget(sw);
    if (target === null) return;
    setSwitchBusy(true);
    setErr('');
    try {
      await adminSetEventsOpen(region, target);
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(eventErrorText(d, userMessage(d, ctx.region.name)));
    }
    try {
      const fresh = await getRegionContext(slug); // show what the database says, even after an error
      setSw(fresh.events ? switchFromOpen(fresh.events.open) : { kind: 'unknown' });
    } catch {
      setSw({ kind: 'unknown' });
    } finally {
      setSwitchBusy(false);
    }
  }

  async function changed() {
    await load();
    onChanged();
  }

  return (
    <section className="panel ev-sec" aria-label="Events">
      <div className="ev-head">
        <h3>Events</h3>
        <button className="sw" type="button" role="switch" aria-checked={switchChecked(sw)} disabled={switchDisabled(sw, switchBusy)} onClick={() => void toggle()}>
          <span className="tr" aria-hidden="true" />
          Visitors can add events: {switchStatusText(sw)}
        </button>
        {sw.kind === 'unknown' && (
          <span role="alert" className="err">
            Couldn&apos;t check whether event submissions are on. <button className="btn ghost" type="button" onClick={() => void loadSwitch()}>Retry</button>
          </span>
        )}
      </div>
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Filter events by status">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="radio" className="seg-b" aria-checked={status === f} onClick={() => setStatus(f)}>{FILTER_LABEL[f]}</button>
          ))}
        </div>
        <button className="btn primary" type="button" onClick={() => setAdding((a) => !a)}>{adding ? 'Close form' : 'Add event'}</button>
      </div>
      {adding && (
        <EventForm
          key="add"
          ctx={ctx}
          withSource
          submitLabel="Add event"
          onCancel={() => setAdding(false)}
          onSubmit={async (input, sourceUrl) => {
            await adminCreateEvent(region, input, sourceUrl);
            setAdding(false);
            await changed();
          }}
          onForbidden={onForbidden}
        />
      )}
      {err && <p className="err" role="alert">{err}</p>}
      {rows === null ? <p className="fine">Loading…</p> : rows.length === 0 ? <p className="fine">No {FILTER_LABEL[status].toLowerCase()} events.</p> : (
        <div className="queue ev-queue">
          {rows.map((e) => <Card key={e.id} ev={e} ctx={ctx} onForbidden={onForbidden} onChanged={changed} />)}
        </div>
      )}
    </section>
  );
}

function Card({ ev, ctx, onForbidden, onChanged }: { ev: AdminEvent; ctx: RegionContext; onForbidden(): void; onChanged(): Promise<void> }) {
  const tz = ctx.region.timezone;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const host = displayHost(ev.url);
  const sourceHost = displayHost(ev.sourceUrl);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      setRejecting(false);
      await onChanged();
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') return onForbidden();
      setErr(eventErrorText(d, userMessage(d, ctx.region.name)));
      if (d.code === 'not_found' || (d.code === 'invalid_input' && d.detail === 'transition')) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  function reject() {
    const r = checkReason(reason);
    if (!r.ok) return setErr(r.error);
    void act(() => adminModerateEvent(ev.id, 'rejected', r.reason));
  }

  const actions = actionsFor(ev.status);
  return (
    <div className="qcard ev-card">
      <div className="ev-title">
        <p className="addr">{ev.title}</p>
        {ev.adultsOnly && <span className="pill">21+</span>}
        {(ev.season !== ctx.season || ev.year !== ctx.year) && (
          <span className="pill" title="Submitted under an earlier season">{ev.season === 'halloween' ? 'Halloween' : 'Christmas'} {ev.year}</span>
        )}
        <span className="pill">{ev.source}</span>
      </div>
      {ev.sameDayWarning && <p className="ev-warn" role="status">Same-day warning: another event with a similar title starts on this day. Check for a duplicate.</p>}
      <p className="fine">{fmt(ev.startsAt, tz)}{ev.endsAt ? ` to ${fmt(ev.endsAt, tz)}` : ''}</p>
      <p className="fine">{ev.venue ? `${ev.venue} · ` : ''}{ev.address}</p>
      <p className="ev-desc">{ev.description}</p>
      {host && (
        <p className="ev-host">
          Link goes to <b className={host === 'unrecognized link' ? 'bad' : ''}>{host}</b>
          {ev.url && (
            <>
              <br />
              <span className="fine ev-fullurl">
                {host === 'unrecognized link' ? ev.url : (
                  <a href={ev.url} target="_blank" rel="nofollow ugc noopener noreferrer">{ev.url}</a>
                )}
              </span>
            </>
          )}
        </p>
      )}
      {ev.sourceUrl && sourceHost && (
        <p className="fine">
          Source: {sourceHost === 'unrecognized link' ? sourceHost : (
            <a href={ev.sourceUrl} target="_blank" rel="nofollow ugc noopener noreferrer">{sourceHost}</a>
          )}
        </p>
      )}
      {ev.status === 'rejected' && ev.rejectReason && <p className="fine">Rejected: {ev.rejectReason}</p>}
      <p className="fine">Submitted {fmt(ev.createdAt, tz)}</p>
      <p className="fine"><a href={`https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: `${ev.lat},${ev.lng}` }).toString()}`} target="_blank" rel="noopener noreferrer">{ev.lat.toFixed(5)}, {ev.lng.toFixed(5)}</a></p>
      {err && <p className="err" role="alert">{err}</p>}
      {editing ? (
        <EventForm
          ctx={ctx}
          initial={formFromEvent(ev, tz)}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            await adminUpdateEvent(ev.id, input);
            setEditing(false);
            await onChanged();
          }}
          onForbidden={onForbidden}
        />
      ) : rejecting ? (
        <div className="confirm" role="group" aria-label="Reject event">
          <label className="lbl">
            Reason (kept for the record)
            <input className="field" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={reject}>Reject</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row">
          {actions.includes('approve') && <button className="btn primary" type="button" disabled={busy} onClick={() => void act(() => adminModerateEvent(ev.id, 'approved'))}>Approve</button>}
          {actions.includes('restore') && <button className="btn primary" type="button" disabled={busy} onClick={() => void act(() => adminModerateEvent(ev.id, 'approved'))}>Restore</button>}
          {actions.includes('reject') && <button className="btn danger" type="button" disabled={busy} onClick={() => { setRejecting(true); setErr(''); }}>Reject…</button>}
          {actions.includes('hide') && <button className="btn danger" type="button" disabled={busy} onClick={() => void act(() => adminModerateEvent(ev.id, 'hidden'))}>Hide</button>}
          {actions.includes('edit') && <button className="btn ghost" type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
        </div>
      )}
    </div>
  );
}

function EventForm({ ctx, initial, withSource, submitLabel, onSubmit, onCancel, onForbidden }: {
  ctx: RegionContext;
  initial?: EventFormValues;
  withSource?: boolean;
  submitLabel: string;
  onSubmit(input: EventInput, sourceUrl: string | null): Promise<void>;
  onCancel(): void;
  onForbidden(): void;
}) {
  const [v, setV] = useState<EventFormValues>(initial ?? emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EventFormValues>(k: K, val: EventFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = buildEventInput(v, ctx.region);
    if (!r.ok) {
      setErrors(r.errors);
      setErr('');
      return;
    }
    setErrors({});
    setBusy(true);
    setErr('');
    try {
      await onSubmit(r.input, r.sourceUrl);
    } catch (x) {
      const d = toDataError(x);
      if (d.code === 'forbidden') return onForbidden();
      setErr(eventErrorText(d, userMessage(d, ctx.region.name)));
    } finally {
      setBusy(false);
    }
  }

  const f = (k: keyof EventFormValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="lbl">
      {label}
      <input className="field" value={String(v[k])} onChange={(e) => set(k, e.target.value as never)} aria-invalid={errors[k] ? true : undefined} {...props} />
      {errors[k] && <span className="err" role="alert">{errors[k]}</span>}
    </label>
  );

  return (
    <form className="form ev-form" onSubmit={(e) => void submit(e)} noValidate>
      {f('title', 'Title')}
      <label className="lbl ev-wide">
        Description
        <textarea className="field" rows={4} value={v.description} onChange={(e) => set('description', e.target.value)} aria-invalid={errors.description ? true : undefined} />
        {errors.description && <span className="err" role="alert">{errors.description}</span>}
      </label>
      {f('venue', 'Venue (optional)')}
      {f('address', 'Address')}
      {f('lat', 'Latitude', { inputMode: 'decimal' })}
      {f('lng', 'Longitude', { inputMode: 'decimal' })}
      {f('startDate', 'Start date', { type: 'date' })}
      {f('startTime', 'Start time', { type: 'time' })}
      {f('endDate', 'End date (optional)', { type: 'date' })}
      {f('endTime', 'End time (optional)', { type: 'time' })}
      {f('url', 'Website (optional)', { type: 'url', inputMode: 'url' })}
      {withSource && f('sourceUrl', 'Source page (optional, admin only)', { type: 'url', inputMode: 'url' })}
      <label className="radio ev-wide">
        <input type="checkbox" checked={v.adultsOnly} onChange={(e) => set('adultsOnly', e.target.checked)} />
        Adults only (21+)
      </label>
      <p className="fine ev-wide">Times are Pacific ({ctx.region.timezone}). Nothing is guessed: set the end date for events that run past midnight.</p>
      {err && <p className="err ev-wide" role="alert">{err}</p>}
      <div className="row ev-wide">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        <button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
