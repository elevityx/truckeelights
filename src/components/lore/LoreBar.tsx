'use client';

import { useState } from 'react';
import type { Season } from '@/lib/data/types';
import { splitBold } from '@/lib/text/address';
import { LORE } from './lore-data';

export default function LoreBar({ season }: { season: Season }) {
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
    </p>
  );
}
