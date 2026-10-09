'use client';

import { useState } from 'react';
import type { Season } from '@/lib/data/types';
import { splitBold } from '@/lib/text/address';
import { ShareIcon } from '@/components/shell/Icons';
import { LORE } from './lore-data';

/** Bottom bar: a rotating Truckee fact, plus the quiet "Share the map" action (kept out of the header on purpose). */
export default function LoreBar({ season, onShare }: { season: Season; onShare?: () => void }) {
  const [i, setI] = useState(0);
  const facts = LORE[season];
  const parts = splitBold(facts[i % facts.length]);
  return (
    <p className="lore">
      <svg className="mt" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
        <path d="M0 12L5 4l3 4 3-6 5 10z" fill="currentColor" />
      </svg>
      <span className="lt">
        <span className="sr-only">Truckee fact: </span>
        {parts.map((p, k) => (p.bold ? <b key={k}>{p.text}</b> : <span key={k}>{p.text}</span>))}
      </span>
      <button type="button" aria-label="Show another Truckee fact" onClick={() => setI((n) => (n + 1) % facts.length)}>
        Next
      </button>
      {onShare && (
        <button type="button" className="lore-share" aria-label="Share the map" title="Share the map" onClick={onShare}>
          <ShareIcon />
          <span className="ls-long">Share map</span>
        </button>
      )}
    </p>
  );
}
