'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import BotCheck from '@/components/add/BotCheck';
import Sheet from '@/components/ui/Sheet';
import { XIcon } from '@/components/shell/Icons';
import { mapsConfigured } from '@/config/public-env';
import { toDataError } from '@/lib/data/errors';
import type { RegionContext } from '@/lib/data/types';
import { eventBounds, inEventBounds } from '@/lib/data/events';
import { reverseGeocode } from '@/lib/maps/geocode';
import { createAddressPicker, createPinConfirm } from '@/lib/maps/picker';
import type { PickedPlace } from '@/lib/maps/types';
import { localDate } from '@/lib/time/pacific';
import { eventsApi } from './api';
import EventGlyph from './EventGlyph';
import { FIELD_ORDER, checkDraft, emptyDraft, isBot, type EventDraft, type Field, type FieldErrors } from './eventForm';
import { ALREADY_LISTED, THANKS, eventErrorCopy } from './messages';

interface Props {
  ctx: RegionContext;
  onClose(): void;
  /** Back to the Add chooser. */
  onBack?: () => void;
  /** Open an already-listed (approved) event. */
  onOpenEvent(id: string): void;
  /** Ids of the events on the map, so "View it" shows only when there is something to open. */
  knownIds: ReadonlySet<string>;
}

type Phase = { kind: 'form' } | { kind: 'done' } | { kind: 'exists'; eventId: string | null };

const DESC_MAX = 600;

export default function AddEventSheet({ ctx, onClose, onBack, onOpenEvent, knownIds }: Props) {
  const { region, season } = ctx;
  const tz = region.timezone;
  const [d, setD] = useState<EventDraft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusTick, setFocusTick] = useState(0);
  const [formError, setFormError] = useState('');
  const [showEndDate, setShowEndDate] = useState(false);
  const [picking, setPicking] = useState(false);
  const [geoNote, setGeoNote] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [busy, setBusy] = useState(false);
  const [needCheck, setNeedCheck] = useState(false);
  const [token, setToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [today] = useState(() => localDate(Date.now(), tz));
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  // Sheet re-runs its focus effect when onClose changes identity, so hand it a stable function.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => closeRef.current(), []);

  // Places autocomplete limited to the event area (establishments, parks, plazas and street addresses).
  const pickerRef = useRef<HTMLDivElement>(null);
  const formShown = phase.kind === 'form';
  useEffect(() => {
    if (!formShown || !pickerRef.current) return;
    const b = eventBounds(region);
    const area = { ...region, ...b };
    return createAddressPicker(pickerRef.current, area, (p: PickedPlace) => {
      setPicking(false);
      setGeoNote('');
      setD((x) => ({ ...x, place: { placeId: p.placeId, lat: p.lat, lng: p.lng }, address: p.address }));
      setErrors((e) => ({ ...e, location: undefined, address: undefined }));
    });
  }, [formShown, region]);

  // Or drop a pin: a draggable pin on a small map; the address comes from a reverse lookup and stays editable.
  const miniRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef(d.place);
  useEffect(() => {
    placeRef.current = d.place;
  }, [d.place]);
  const geoSeq = useRef(0);
  useEffect(() => {
    if (!picking || !miniRef.current) return;
    const start = placeRef.current ?? { lat: region.centerLat, lng: region.centerLng };
    return createPinConfirm(miniRef.current, region, season, start, (lat, lng) => {
      const n = ++geoSeq.current;
      setD((x) => ({ ...x, place: { placeId: null, lat, lng } }));
      setErrors((e) => ({ ...e, location: undefined }));
      setGeoNote('Finding the address…');
      reverseGeocode({ lat, lng }, season)
        .then((rs) => {
          if (n !== geoSeq.current) return;
          const hit = rs.find((r) => inEventBounds(region, r.lat, r.lng));
          if (!hit) {
            setGeoNote('No address found there. Type the address below.');
            return;
          }
          setGeoNote('');
          setD((x) => ({ ...x, address: hit.address, place: { placeId: hit.placeId, lat, lng } }));
        })
        .catch(() => {
          if (n === geoSeq.current) setGeoNote('Couldn’t look up that spot. Type the address below.');
        });
    });
  }, [picking, region, season]);

  // Move focus to the first field with a problem after a failed send.
  useEffect(() => {
    if (!focusTick) return;
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (first) document.getElementById(`ef-${first}`)?.focus();
  }, [focusTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (tok: string) => {
    if (busy) return;
    const c = checkDraft(d, region, Date.now());
    setErrors(c.errors);
    setFormError('');
    if (c.askEndDate) setShowEndDate(true);
    if (!c.input) {
      setFocusTick((t) => t + 1);
      return;
    }
    if (isBot(d)) {
      setPhase({ kind: 'done' }); // honeypot filled: look normal, send nothing
      return;
    }
    setBusy(true);
    try {
      const api = await eventsApi();
      const signedIn = await api.hasSession();
      if (!signedIn && !tok) {
        setNeedCheck(true);
        return;
      }
      if (!signedIn) await api.ensureAnonymousSession(tok);
      const r = await api.submitEvent(region.slug, c.input);
      setPhase(r.result === 'created' ? { kind: 'done' } : { kind: 'exists', eventId: r.eventId });
    } catch (e) {
      const err = toDataError(e);
      if (err.code === 'captcha_failed' || err.code === 'not_signed_in') {
        setToken('');
        setCaptchaKey((k) => k + 1);
        setNeedCheck(true);
      }
      const copy = eventErrorCopy(err, region.name);
      if (copy.field) {
        setErrors({ [copy.field]: copy.message });
        setFocusTick((t) => t + 1);
      } else setFormError(copy.message);
    } finally {
      setBusy(false);
    }
  };
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void send(token);
  };

  const err = (f: Field) => errors[f];
  const a11y = (f: Field) => (err(f) ? { 'aria-invalid': true as const, 'aria-describedby': `ef-${f}-err` } : {});
  const errLine = (f: Field) =>
    err(f) ? (
      <p className="err" id={`ef-${f}-err`}>
        {err(f)}
      </p>
    ) : null;

  let body;
  if (phase.kind === 'done' || phase.kind === 'exists') {
    const canView = phase.kind === 'exists' && phase.eventId !== null && knownIds.has(phase.eventId);
    body = (
      <div className="result edone" role="status">
        <span className="eg">
          <EventGlyph season={season} />
        </span>
        <h3>{phase.kind === 'done' ? THANKS : ALREADY_LISTED}</h3>
        {phase.kind === 'done' && <p className="fine">We check every event before it goes on the map.</p>}
        <div className="actions">
          {phase.kind === 'done' ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setD(emptyDraft);
                setErrors({});
                setShowEndDate(false);
                setPicking(false);
                setPhase({ kind: 'form' });
              }}
            >
              Add another
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => setPhase({ kind: 'form' })}>
              Back to the form
            </button>
          )}
          {canView ? (
            <button type="button" className="btn primary" onClick={() => onOpenEvent(phase.eventId!)}>
              View it
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={close}>
              Done
            </button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <form className="ef" noValidate onSubmit={onSubmit} aria-label="Event details">
        <div className="fld">
          <label className="lbl" htmlFor="ef-title">
            Title
          </label>
          <input className="field" id="ef-title" type="text" maxLength={80} autoComplete="off" placeholder={season === 'halloween' ? 'Halloween in the Park' : 'Tree lighting on Church St'} value={d.title} onChange={(e) => set('title', e.target.value)} {...a11y('title')} />
          {errLine('title')}
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="ef-startDate">
            Date
          </label>
          <input className="field" id="ef-startDate" type="date" min={today} value={d.startDate} onChange={(e) => set('startDate', e.target.value)} {...a11y('startDate')} />
          {errLine('startDate')}
        </div>
        <div className="two">
          <div className="fld">
            <label className="lbl" htmlFor="ef-startTime">
              Starts
            </label>
            <input className="field" id="ef-startTime" type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} {...a11y('startTime')} />
            {errLine('startTime')}
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="ef-endTime">
              Ends <span className="opt-t">(optional)</span>
            </label>
            <input className="field" id="ef-endTime" type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} {...a11y('endTime')} />
          </div>
        </div>
        {errLine('endTime')}
        {showEndDate || d.endDate ? (
          <div className="fld">
            <label className="lbl" htmlFor="ef-endDate">
              End date
            </label>
            <input className="field" id="ef-endDate" type="date" min={d.startDate || today} value={d.endDate} onChange={(e) => set('endDate', e.target.value)} {...a11y('endDate')} />
            {errLine('endDate')}
          </div>
        ) : (
          <button type="button" className="linkbtn left" onClick={() => setShowEndDate(true)}>
            Ends on a later day?
          </button>
        )}
        <p className="fine">Times are Pacific time.</p>

        <div className="fld">
          <span className="lbl" id="ef-loc-lbl">
            Location
          </span>
          <div id="ef-location" ref={pickerRef} tabIndex={-1} aria-labelledby="ef-loc-lbl" className="epicker" {...a11y('location')} />
          {mapsConfigured(season) && (
            <button type="button" className="linkbtn left" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
              {picking ? 'Hide the map' : 'Or drop a pin on the map'}
            </button>
          )}
          {picking && <div className="mini" ref={miniRef} />}
          {picking && <p className="fine">Drag the pin to the spot.</p>}
          <p className="geo-note" role="status">
            {geoNote}
          </p>
          {errLine('location')}
        </div>
        {d.place && (
          <div className="fld">
            <label className="lbl" htmlFor="ef-address">
              Address as it will show
            </label>
            <input className="field" id="ef-address" type="text" maxLength={120} value={d.address} onChange={(e) => set('address', e.target.value)} {...a11y('address')} />
            {errLine('address')}
          </div>
        )}
        <div className="fld">
          <label className="lbl" htmlFor="ef-venue">
            Venue name <span className="opt-t">(optional)</span>
          </label>
          <input className="field" id="ef-venue" type="text" maxLength={80} placeholder="Downtown Park" value={d.venue} onChange={(e) => set('venue', e.target.value)} {...a11y('venue')} />
          {errLine('venue')}
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="ef-description">
            Description
          </label>
          <textarea className="field" id="ef-description" rows={4} maxLength={DESC_MAX} placeholder="What happens, who it’s for, what it costs" value={d.description} onChange={(e) => set('description', e.target.value)} {...a11y('description')} />
          <p className="hint">
            <span>10 to 600 characters</span>
            <span>
              {d.description.length} / {DESC_MAX}
            </span>
          </p>
          {errLine('description')}
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="ef-url">
            Website <span className="opt-t">(optional)</span>
          </label>
          <input className="field" id="ef-url" type="url" inputMode="url" maxLength={300} placeholder="https://" value={d.url} onChange={(e) => set('url', e.target.value)} {...a11y('url')} />
          {errLine('url')}
        </div>
        <label className="ckbox">
          <input type="checkbox" checked={d.adultsOnly} onChange={(e) => set('adultsOnly', e.target.checked)} />
          <span>
            Adults only (21+)
            <small>Bars, late concerts, anything not for kids</small>
          </span>
        </label>
        {/* Honeypot: hidden from people and screen readers. A filled value means a bot. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="ef-website2">Leave this empty</label>
          <input id="ef-website2" type="text" tabIndex={-1} autoComplete="off" value={d.honeypot} onChange={(e) => set('honeypot', e.target.value)} />
        </div>
        {needCheck && (
          <div className="fld">
            <p style={{ margin: 0 }}>One quick check that you’re a person. We ask once per visit.</p>
            <BotCheck
              resetKey={captchaKey}
              onToken={(t) => {
                setToken(t);
                void sendRef.current(t);
              }}
              onExpire={() => setToken('')}
            />
          </div>
        )}
        <p className="err" role="alert">
          {formError}
        </p>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy || (needCheck && !token)}>
            {busy ? 'Sending…' : 'Send for review'}
          </button>
        </div>
        <p className="fine">We check every event before it goes on the map.</p>
      </form>
    );
  }

  return (
    <Sheet label="Add an event" onClose={close} tall>
      <div className="sheet-in">
        {onBack && phase.kind === 'form' && (
          <button type="button" className="linkbtn back" onClick={onBack}>
            ‹ Back
          </button>
        )}
        <div className="sheet-h">
          <div>
            <p className="eyebrow">Add an event</p>
            <h2 className="disp">{phase.kind === 'form' ? 'Tell us about it' : phase.kind === 'done' ? 'Thanks!' : 'Already listed'}</h2>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close add an event" onClick={close}>
            <XIcon />
          </button>
        </div>
        <div className="sec">{body}</div>
      </div>
    </Sheet>
  );
}
