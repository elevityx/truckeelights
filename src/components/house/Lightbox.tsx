'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '@/components/shell/Icons';
import type { HousePhoto } from '@/lib/data/types';
import { stepIndex, swipeStep } from '@/components/photos/lightboxNav';
import BotCheck from '@/components/add/BotCheck';
import { DAILY_LIMIT, votesLabel } from '@/lib/votes/meter';
import { leftText } from './votePanel.logic';
import { useHouseVotes } from './useHouseVotes';
import './photos.css';

/** Set when votes are on: the heart casts a house vote that records this photo. */
export interface LightboxVote {
  houseId: string;
  /** The pin's count, until the shared vote state has the server's. */
  seedTotal: number;
  open: boolean;
}

interface Props {
  photos: readonly HousePhoto[];
  start: number;
  /** address first segment, for alt text */
  address: string;
  onClose(): void;
  /** Where focus goes when the viewer closes (Safari doesn't focus a clicked button, so pass the opener). */
  returnFocus?: HTMLElement | null;
  vote?: LightboxVote;
}

const Left = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const Heart = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
  </svg>
);

/** The photo heart: same shared state, limits, and queue as the sheet's VotePanel. */
function PhotoHeart({ vote: v, photoId }: { vote: LightboxVote; photoId: string }) {
  const { state, check, vote, onToken, cancelCheck } = useHouseVotes(v.houseId, v.seedTotal);
  const { total, left, closed, dailyExhausted, note, queue, taps } = state;
  const [firstTaps] = useState(taps);
  const fromHere = check?.from === 'photo' ? check : null;
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
  const open = v.open && !closed;
  const disabled = !open || dailyExhausted || left === 0 || !!check;
  let line: string;
  if (!open) line = 'Voting opens soon';
  else if (dailyExhausted) line = note?.error ? note.text : "You've used today's votes. Come back tomorrow.";
  else if (left === 0) line = note?.error ? note.text : `All ${DAILY_LIMIT} votes used today. More at midnight.`;
  else line = queue.length === 0 && note ? `${note.text} ${votesLabel(total)}.` : `${votesLabel(total)} · ${leftText(left)}`;
  return (
    <div className="lb-vote">
      {fromHere && (
        <div className="vcheck">
          <p>{fromHere.busy ? 'Checking…' : 'Quick bot check, once per device'}</p>
          {!fromHere.busy && <BotCheck onToken={(t) => void onToken(t)} onExpire={() => {}} resetKey={fromHere.resetKey} />}
          {fromHere.error && <p className="err">{fromHere.error}</p>}
        </div>
      )}
      <button
        type="button"
        className="lb-heart"
        aria-label="Vote for this house with this photo"
        disabled={disabled}
        onClick={() => vote(photoId, 'photo')}
      >
        <Heart />
        Vote for this house
        {taps > firstTaps && (
          <span key={taps} className="vpop" aria-hidden="true">
            +1
          </span>
        )}
      </button>
      <p className="lb-vleft" aria-live="polite">
        {line}
      </p>
    </div>
  );
}

const Right = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

/**
 * Full-screen photo viewer: Esc closes, ←/→ step, swipe steps on touch, Tab stays inside.
 * Focus starts on Close and returns to the opener afterwards.
 */
export default function Lightbox({ photos, start, address, onClose, returnFocus, vote }: Props) {
  const [i, setI] = useState(start);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const downX = useRef<number | null>(null);
  const n = photos.length;
  const photo = photos[i];

  const returnRef = useRef(returnFocus);
  useEffect(() => {
    const opener = returnRef.current ?? (document.activeElement as HTMLElement | null);
    closeBtn.current?.focus();
    const node = root.current;
    return () => {
      // Next frame, and only if the viewer really closed (StrictMode re-runs effects on a live node).
      requestAnimationFrame(() => {
        if (!node?.isConnected) opener?.focus?.();
      });
    };
  }, []);

  const step = (d: number) => setI((cur) => stepIndex(cur, d, n));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // the sheet underneath also listens for Escape
      onClose();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'Tab') {
      const f = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.current?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    downX.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (downX.current === null) return;
    const d = swipeStep(e.clientX - downX.current);
    downX.current = null;
    if (d) step(d);
  };

  if (!photo) return null;
  const alt = `Photo ${i + 1} of ${address}`;

  return createPortal(
    <div ref={root} className="lb" role="dialog" aria-modal="true" aria-label="Photo viewer" onKeyDown={onKeyDown}>
      <button ref={closeBtn} type="button" className="iconbtn lbc" aria-label="Close photo" onClick={onClose}>
        <XIcon />
      </button>
      <div
        className="lb-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (downX.current = null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {broken.has(photo.id) ? (
          <p className="lb-broken">This photo couldn’t load. Close and open the house again.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed URLs from Storage, static export (no next/image optimizer)
          <img
            key={photo.id}
            src={photo.url}
            alt={alt}
            draggable={false}
            onError={() => setBroken((b) => new Set(b).add(photo.id))}
          />
        )}
      </div>
      {vote && <PhotoHeart vote={vote} photoId={photo.id} />}
      {n > 1 && (
        <div className="nav">
          <button type="button" className="iconbtn" aria-label="Previous photo" onClick={() => step(-1)}>
            <Left />
          </button>
          <span aria-live="polite">
            {i + 1} / {n}
          </span>
          <button type="button" className="iconbtn" aria-label="Next photo" onClick={() => step(1)}>
            <Right />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
