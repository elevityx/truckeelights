'use client';

import { useEffect, useRef, useState } from 'react';
import BotCheck from '@/components/add/BotCheck';
import type { PinView, Season } from '@/lib/data/types';
import { pickGlyph } from '@/lib/maps/glyphs';
import {
  DAILY_LIMIT,
  PHOTO_CAP_VOTES,
  displayVotes,
  isCapped,
  meterAriaText,
  meterCaption,
  meterFraction,
  powerKind,
  powerName,
  snowFeet,
  tier,
  tierName,
  unlockHint,
  votesLabel,
  type PowerKind,
} from '@/lib/votes/meter';
import Meter from './Meter';
import { VOTE_PRIVACY, leftText } from './votePanel.logic';
import { useHouseVotes } from './useHouseVotes';


interface Props {
  pin: PinView;
  season: Season;
  votesOpen: boolean;
  onVoted(houseId: string, total: number): void;
  onToast(msg: string): void;
  photosOpen?: boolean;
  /** Opens the photo picker (only while photo uploads are open). */
  onAddPhotos?: () => void;
}

const ANCHORS = [25, 50, 100, 150];

/** "23 more to Full power" / "23 more to 9 ft · I-80 is closed!", or null past the last anchor. */
export function nextStep(kind: PowerKind, votes: number): string | null {
  const at = ANCHORS.find((a) => votes < a);
  if (at === undefined) return null;
  const name = tierName(kind, tier(at));
  return `${at - votes} more to ${kind === 'snow' ? `${snowFeet(at)} ft · ${name}` : name}`;
}

export const ThumbIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10v11H3V10z" />
    <path d="M7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7" />
  </svg>
);
export const FlakeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const BUTTON: Record<PowerKind, string> = { pumpkin: 'Give it Pumpkin Power', ghost: 'Give it Ghost Power', snow: 'Let it snow' };
const STAKE = ['1 ft', '3 ft', '6 ft', '9 ft']; // depth at each notch (0, 25, 50, 100 votes), as painted
const CELLS = ['¼', '½', '¾', 'FULL'];

export default function VotePanel({ pin, season, votesOpen, onVoted, onToast, photosOpen = false, onAddPhotos }: Props) {
  const kind = powerKind(season, pickGlyph(pin.id, season));
  const { state, check, vote, refresh, onToken, cancelCheck } = useHouseVotes(pin.id, pin.votes);
  const { total, left, dailyExhausted, closed, note, taps, queue } = state;

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep the pin (and its map meter) in step with this house's total.
  const onVotedRef = useRef(onVoted);
  useEffect(() => {
    onVotedRef.current = onVoted;
  });
  useEffect(() => {
    if (total !== pin.votes) onVotedRef.current(pin.id, total);
  }, [total, pin.id, pin.votes]);

  // Errors also go to a toast; the status line under the button carries them for screen readers.
  const lastNote = useRef(note?.n ?? 0);
  useEffect(() => {
    if (!note || note.n === lastNote.current) return;
    lastNote.current = note.n;
    if (note.error) onToast(note.text);
  }, [note, onToast]);

  // A bot check started here is dropped when the sheet closes.
  const fromHere = check?.from === 'panel' ? check : null;
  const checkRef = useRef(fromHere);
  useEffect(() => {
    checkRef.current = fromHere;
  });
  useEffect(
    () => () => {
      if (checkRef.current) cancelCheck();
    },
    [cancelCheck],
  );

  const [firstTaps] = useState(taps);
  const shown = displayVotes(total, pin.photoCount);
  const capped = isCapped(pin.photoCount);
  const hint = unlockHint(kind, pin.photoCount, photosOpen);
  const maxed = capped && total >= PHOTO_CAP_VOTES;
  const next = maxed ? null : nextStep(kind, total);
  const open = votesOpen && !closed;
  const pending = queue.length > 0;

  let label = BUTTON[kind];
  let sub: string;
  if (!open) {
    label = 'Voting opens soon';
    sub = '';
  } else if (dailyExhausted) {
    label = "Today's votes used";
    sub = note?.error ? note.text : 'Come back tomorrow.';
  } else if (left === 0) {
    label = `All ${DAILY_LIMIT} votes used`;
    sub = note?.error ? note.text : 'More at midnight';
  } else {
    sub = !pending && note ? note.text : leftText(left);
  }
  const disabled = !open || dailyExhausted || left === 0 || !!check;

  return (
    <section className="vpanel" aria-label={powerName(kind)} data-kind={kind}>
      <div className="vp-top">
        <h3 className="vp-name disp">{powerName(kind)}</h3>
        <span className="vp-count">{votesLabel(total)}</span>
      </div>
      <div className="vp-meter">
        <Meter
          kind={kind}
          votes={total}
          photoCount={pin.photoCount}
          size="lg"
          role="meter"
          aria-label={powerName(kind)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meterFraction(shown) * 100)}
          aria-valuetext={meterAriaText(kind, total, pin.photoCount)}
        />
        {taps > firstTaps && (
          <span key={taps} className="vpop" aria-hidden="true">
            {kind === 'snow' ? '+1 ❄' : '+1 ✦'}
          </span>
        )}
      </div>
      <div className={`vticks${kind === 'snow' ? ' stake' : ''}`} aria-hidden="true">
        {(kind === 'snow' ? STAKE : CELLS).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <p className="vp-cap">
        <strong>{meterCaption(kind, shown)}</strong>
        {next && ` · ${next}`}
      </p>
      {hint && (
        <div className="vunlock">
          <LockIcon />
          <span>
            {maxed ? 'Meter maxed at ¾. ' : ''}
            {hint.endsWith('.') ? hint : `${hint}.`}
          </span>
          {photosOpen && onAddPhotos && (
            <button type="button" onClick={onAddPhotos}>
              Add a photo
            </button>
          )}
        </div>
      )}
      {fromHere && (
        <div className="vcheck">
          <p>{fromHere.busy ? 'Checking…' : 'Quick bot check, once per device'}</p>
          {!fromHere.busy && <BotCheck onToken={(t) => void onToken(t)} onExpire={() => {}} resetKey={fromHere.resetKey} />}
          {fromHere.error && <p className="err">{fromHere.error}</p>}
        </div>
      )}
      <button type="button" className="vbtn" disabled={disabled} onClick={() => vote(null, 'panel')}>
        {kind === 'snow' ? <FlakeIcon /> : <ThumbIcon />}
        {label}
      </button>
      {open && !dailyExhausted && (
        <div className="vdots" aria-hidden="true">
          {Array.from({ length: DAILY_LIMIT }, (_, i) => (
            <i key={i} className={i < left ? '' : 'used'} />
          ))}
        </div>
      )}
      <p className="vleft" aria-live="polite">
        {sub}
      </p>
      <p className="vprivacy">{VOTE_PRIVACY}</p>
    </section>
  );
}
