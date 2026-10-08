'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Sheet from '@/components/ui/Sheet';
import { XIcon } from '@/components/shell/Icons';
import { mapsConfigured } from '@/config/public-env';
import { DataError, toDataError, userMessage, type PinView, type RegionContext } from '@/lib/data';
import { ensureAnonymousSession, hasSession, submitHouse } from '@/lib/data/submit';
import { reverseGeocode } from '@/lib/maps/geocode';
import { findNearbyDuplicate, mapPickMessage, pickStreetResult } from '@/lib/maps/mapPick';
import { createAddressPicker, createPinConfirm } from '@/lib/maps/picker';
import type { PickedPlace } from '@/lib/maps/types';
import BotCheck from './BotCheck';
import { BLOCKED_MESSAGE, initialState, NUDGE_MESSAGE, reducer, type Step } from './flow';

// Owner: WP-C
export interface AddHouseSheetProps {
  ctx: RegionContext;
  onClose(): void;
  onCreated(houseId: string): void;
  onOpenExisting(houseId: string): void;
  /** From a map tap: start at the pin step with this place. */
  initialPlace?: PickedPlace;
  /** This season's houses, for the "already on the map" check after the pin moves. */
  pins: readonly PinView[];
}

const STEPS = ['Find address', 'Confirm pin', 'Bot check'] as const;

function latlng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function AddHouseSheet({ ctx, onClose, onCreated, onOpenExisting, initialPlace, pins }: AddHouseSheetProps) {
  const [s, dispatch] = useReducer(reducer, initialPlace, (p) => (p ? reducer(initialState, { type: 'picked', place: p }) : initialState));
  const [token, setToken] = useState('');
  const [session, setSession] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false); // pin dragged on the map
  const { region, season } = ctx;
  const seasonLabel = season === 'halloween' ? 'Halloween' : 'Christmas';

  // Sheet re-runs its focus effect when onClose changes identity, so hand it a stable function.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => closeRef.current(), []);

  // Step 1: address picker
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (s.step !== 1 || s.result || !pickerRef.current) return;
    return createAddressPicker(
      pickerRef.current,
      region,
      (place: PickedPlace) => {
        setPlaced(false);
        dispatch({ type: 'picked', place });
      },
      { focus: true },
    );
  }, [s.step, s.result, region]);

  // Step 2: pin-confirm map (Google only)
  const miniRef = useRef<HTMLDivElement>(null);
  const startRef = useRef({ lat: s.lat, lng: s.lng });
  useEffect(() => {
    if (s.step === 2 && s.place) startRef.current = { lat: s.place.lat, lng: s.place.lng };
  }, [s.step, s.place]);
  useEffect(() => {
    if (s.step !== 2 || !s.place || !miniRef.current) return;
    return createPinConfirm(miniRef.current, region, season, startRef.current, (lat, lng) => {
      setPlaced(true);
      dispatch({ type: 'moved', lat, lng });
    });
  }, [s.step, s.place, region, season]);

  // Pin dragged: look up the street address at the drop point (debounced; stale answers are dropped by seq).
  const { seq: geoSeq, busy: geoBusy } = s.geo;
  const dropRef = useRef({ lat: s.lat, lng: s.lng });
  useEffect(() => {
    dropRef.current = { lat: s.lat, lng: s.lng };
  }, [s.lat, s.lng]);
  useEffect(() => {
    if (!geoBusy) return;
    const p = dropRef.current;
    const t = setTimeout(() => {
      reverseGeocode(p, season)
        .then((results) => {
          const r = pickStreetResult(results, region, p);
          if (r.ok) dispatch({ type: 'geocoded', seq: geoSeq, place: r.place });
          else dispatch({ type: 'geocodeFailed', seq: geoSeq, message: r.reason === 'outside' ? mapPickMessage('outside', region.name) : NUDGE_MESSAGE });
        })
        .catch(() => dispatch({ type: 'geocodeFailed', seq: geoSeq, message: NUDGE_MESSAGE }));
    }, 300);
    return () => clearTimeout(t);
  }, [geoSeq, geoBusy, region, season]);

  // A house already on the map at the current pin/address (UX only; the server dedupes too).
  const dup = s.step === 2 && s.place && !s.geo.busy ? findNearbyDuplicate(pins, { ...s.place, address: s.address, lat: s.lat, lng: s.lng }) : null;

  // Step 3: ask for a session only now (lazy), skip the bot check when one exists.
  useEffect(() => {
    if (s.step !== 3) return;
    let live = true;
    void hasSession().then((ok) => {
      if (live) setSession(ok);
    });
    return () => {
      live = false;
    };
  }, [s.step]);

  const needToken = session === false;
  const canSubmit = !s.busy && session !== null && (!needToken || token !== '');

  const submit = async () => {
    if (!canSubmit || !s.place) return;
    dispatch({ type: 'submitStart' });
    try {
      if (!(await hasSession())) await ensureAnonymousSession(token);
      const r = await submitHouse({
        regionSlug: region.slug,
        placeId: s.place.placeId,
        address: s.address.trim(),
        lat: s.lat,
        lng: s.lng,
      });
      dispatch({ type: 'submitDone', result: r });
    } catch (e) {
      const err = toDataError(e);
      if (err.code === 'captcha_failed') setToken('');
      dispatch({ type: 'submitFail', code: err.code, message: userMessage(new DataError(err.code), region.name) });
      void hasSession().then(setSession);
    }
  };

  const res = s.result;

  let body;
  if (res?.kind === 'created') {
    body = (
      <div className="result">
        <p className="disp">{season === 'halloween' ? 'It’s alive!' : 'Added!'}</p>
        <p>
          <strong>{res.address}</strong> is on the {seasonLabel} map.
        </p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onCreated(res.houseId)}>
            See it on the map
          </button>
        </div>
      </div>
    );
  } else if (res?.kind === 'exists') {
    body = (
      <div className="result">
        <p className="disp">Already on the map</p>
        <p>
          Someone added <strong>{res.address}</strong> this season.
        </p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onOpenExisting(res.houseId)}>
            Open that house
          </button>
        </div>
      </div>
    );
  } else if (res?.kind === 'blocked') {
    body = (
      <div className="result">
        <p>{BLOCKED_MESSAGE}</p>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={close}>
            Close
          </button>
        </div>
      </div>
    );
  } else if (s.step === 1) {
    body = (
      <>
        <label className="lbl" htmlFor="add-q">
          Street address in {region.name}
        </label>
        <div id="add-q" ref={pickerRef} aria-describedby="add-hint" />
        <p className="err" role="alert">
          {s.error}
        </p>
        <p className="fine" id="add-hint">
          Suggestions only cover the {region.name} area.
        </p>
      </>
    );
  } else if (s.step === 2) {
    body = (
      <>
        <p style={{ margin: 0 }}>
          {mapsConfigured(season)
            ? 'Drag the pin onto the house if it’s off. You can fix how the address reads, too.'
            : 'You can fix how the address reads.'}
        </p>
        {mapsConfigured(season) && <div className="mini" ref={miniRef} />}
        <p className="coords">
          {latlng(s.lat, s.lng)} · {placed ? 'placed by you' : initialPlace ? 'where you tapped' : 'from the address'}
        </p>
        <p className="geo-note" role="status">
          {s.geo.busy ? 'Finding address…' : s.geo.note}
        </p>
        {dup && (
          <div className="dupnote">
            <span>
              Already on the map: <strong>{dup.address}</strong>
            </span>
            <button type="button" className="btn ghost" onClick={() => onOpenExisting(dup.id)}>
              View it
            </button>
          </div>
        )}
        <label className="lbl" htmlFor="add-addr">
          Address as it will show
        </label>
        <input
          className="field"
          id="add-addr"
          type="text"
          maxLength={160}
          value={s.address}
          onChange={(e) => dispatch({ type: 'setAddress', address: e.target.value })}
        />
        {s.geo.undo !== null && (
          <p className="fine undo">
            Updated to match the pin.{' '}
            <button type="button" className="linkbtn" onClick={() => dispatch({ type: 'undoAddress' })}>
              Undo
            </button>
          </p>
        )}
        <p className="err" role="alert">
          {s.error}
        </p>
        <div className="actions">
          <button type="button" className="btn primary" disabled={s.geo.busy} onClick={() => dispatch({ type: 'confirm' })}>
            Yes, that’s the house
          </button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'goStep', step: 1 })}>
            Back
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {needToken ? (
          <>
            <p style={{ margin: 0 }}>One quick check that you’re a person. We ask once per visit.</p>
            <BotCheck onToken={setToken} onExpire={() => setToken('')} resetKey={s.captchaKey} />
          </>
        ) : (
          <p style={{ margin: 0 }}>{session === null ? 'One moment…' : 'You’re already checked. Ready to add it.'}</p>
        )}
        <div className="summary">
          <span className="fine">Adding</span>
          <strong>{s.address.trim()}</strong>
          <span className="fine" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {latlng(s.lat, s.lng)}
          </span>
        </div>
        <p className="err" role="alert">
          {s.error}
        </p>
        <div className="actions">
          <button type="button" className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
            {s.busy ? 'Adding…' : 'Add to the map'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={s.busy}
            onClick={() => dispatch({ type: 'goStep', step: 2 })}
          >
            Back
          </button>
        </div>
      </>
    );
  }

  return (
    <Sheet label="Add a house" onClose={close} tall>
      <div className="sheet-in">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">{seasonLabel}</p>
            <h2 className="disp">Add a house</h2>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close add a house" onClick={close}>
            <XIcon />
          </button>
        </div>
        {!res && (
          <ol className="steps" aria-label="Steps">
            {STEPS.map((t, i) => (
              <li key={t}>
                <button
                  type="button"
                  aria-current={s.step === i + 1 ? 'step' : 'false'}
                  onClick={() => dispatch({ type: 'goStep', step: (i + 1) as Step })}
                >
                  <b>Step {i + 1}</b>
                  {t}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="sec">{body}</div>
      </div>
    </Sheet>
  );
}
