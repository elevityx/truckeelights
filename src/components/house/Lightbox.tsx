'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '@/components/shell/Icons';
import type { HousePhoto } from '@/lib/data/types';
import { stepIndex, swipeStep } from '@/components/photos/lightboxNav';
import './photos.css';

interface Props {
  photos: readonly HousePhoto[];
  start: number;
  /** address first segment, for alt text */
  address: string;
  onClose(): void;
  /** Where focus goes when the viewer closes (Safari doesn't focus a clicked button, so pass the opener). */
  returnFocus?: HTMLElement | null;
}

const Left = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const Right = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

/**
 * Full-screen photo viewer: Esc closes, ←/→ step, swipe steps on touch, Tab stays inside.
 * Focus starts on Close and returns to the opener afterwards.
 */
export default function Lightbox({ photos, start, address, onClose, returnFocus }: Props) {
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
