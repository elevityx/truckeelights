'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseConfigured } from '@/config/public-env';
import { getRegionContext, type Season } from '@/lib/data';
import type { QrPath } from '@/lib/share/qr';
import { displayUrl } from '@/lib/share/urls';
import { applySeason } from '@/lib/theme/applySeason';
import { FLYER_COPY, flyerSeasonFromQuery } from './copy';
import './flyer.css';

interface Props {
  qr: QrPath;
  url: string;
}

export default function Flyer({ qr, url }: Props) {
  const [season, setSeason] = useState<Season>('halloween');
  const [year, setYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The flyer works without data: halloween + this year, or the season in ?season=.
      const ctx = supabaseConfigured() ? await getRegionContext().catch(() => null) : await Promise.resolve(null);
      if (cancelled) return;
      // Always apply: the boot script may have restored another season's theme (and display font) from storage.
      const s = flyerSeasonFromQuery(window.location.search) ?? ctx?.season ?? 'halloween';
      if (ctx) setYear(ctx.year);
      setSeason(s);
      applySeason(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (s: Season) => {
    setSeason(s);
    applySeason(s);
    const u = new URL(window.location.href);
    u.searchParams.set('season', s);
    history.replaceState(null, '', u.pathname + u.search);
  };

  const c = FLYER_COPY[season];
  const box = qr.size + 2 * qr.quiet;
  return (
    <div className="flyer-page">
      <div className="flyer-tools" role="toolbar" aria-label="Flyer options">
        <Link className="btn ghost" href="/admin/">
          Back
        </Link>
        <div className="seg" role="group" aria-label="Flyer season">
          <button type="button" aria-pressed={season === 'halloween'} onClick={() => pick('halloween')}>
            Halloween
          </button>
          <button type="button" aria-pressed={season === 'christmas'} onClick={() => pick('christmas')}>
            Christmas
          </button>
        </div>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className="flyer" aria-label={`Printable ${season === 'halloween' ? 'Halloween' : 'Christmas'} flyer`}>
        <p className="fl-kicker">
          Truckee, CA · {c.seasonName} {year}
        </p>
        <h1 className="fl-wm disp">{c.wordmark}</h1>
        <p className="fl-head">{c.headline}</p>
        <FlyerMotif season={season} />
        <div className="fl-main">
          <figure className="fl-qr">
            <svg viewBox={`0 0 ${box} ${box}`} role="img" aria-label={`QR code for ${displayUrl(url)}`} shapeRendering="crispEdges">
              <rect width={box} height={box} fill="#fff" />
              <path d={qr.d} fill="#000" />
            </svg>
            <figcaption>{displayUrl(url)}</figcaption>
          </figure>
          <ol className="fl-steps">
            {c.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <p className="fl-pitch">{c.pitch}</p>
        <p className="fl-foot">{c.footer}</p>
      </article>
    </div>
  );
}

/** Black line-art version of the header's Donner ridge: peaks, two tunnel portals, and a seasonal guest. Constant markup. */
function FlyerMotif({ season }: { season: Season }) {
  const H = season === 'halloween';
  return (
    <svg className="fl-motif" viewBox="0 0 600 96" aria-hidden="true" focusable="false">
      <path d="M0 86L40 60L70 70L110 38L150 58L190 30L222 46L250 22L300 8L350 22L378 46L410 30L450 58L490 38L530 70L560 60L600 86" fill="none" stroke="#000" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M0 88H600" stroke="#000" strokeWidth="2.4" />
      <path d="M0 93H600" stroke="#000" strokeWidth="1.4" strokeDasharray="3 6" />
      {[244, 356].map((x) => (
        <g key={x}>
          <path d={`M${x - 20} 88v-16a20 20 0 0 1 40 0v16z`} fill="#000" />
          <path d={`M${x - 25} 88v-16a25 25 0 0 1 50 0v16`} fill="none" stroke="#000" strokeWidth="1.6" />
        </g>
      ))}
      {H ? (
        <g>
          <g transform="translate(300 62)">
            <path d="M-11 13V-1a11 11 0 0 1 22 0v14l-3.7-3.6-3.6 3.6-3.7-3.6-3.7 3.6-3.6-3.6z" fill="#fff" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
            <ellipse cx="-3.5" cy="-1.5" rx="2" ry="3" />
            <ellipse cx="4" cy="-1.5" rx="2" ry="3" />
            <ellipse cx="0.5" cy="5.5" rx="2" ry="2.6" />
          </g>
          <g transform="translate(470 18)">
            <circle r="11" fill="none" stroke="#000" strokeWidth="2" />
            <path d="M-26 6q3-5 7-2q2-3 5 0q3-3 5 0q3-3 7 2q-5 0-7 3q-2-2-5 0q-3-2-5 0q-2-3-7-3z" />
          </g>
          <g transform="translate(120 82)">
            <ellipse rx="9" ry="7" fill="#fff" stroke="#000" strokeWidth="2" />
            <path d="M-4-1l2 2-3 .5zM4-1l-2 2 3 .5zM-4 2.5q4 3 8 0" fill="none" stroke="#000" strokeWidth="1.4" />
            <path d="M0-7v-3" stroke="#000" strokeWidth="2" strokeLinecap="round" />
          </g>
        </g>
      ) : (
        <g>
          <g transform="translate(300 88)">
            <path d="M-12 0L0-30L12 0Z" fill="#fff" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
            <path d="M0-35l2 4h-4z" />
            {[[-5, -6], [4, -12], [-2, -18], [6, -4]].map(([x, y]) => (
              <circle key={`${x},${y}`} cx={x} cy={y} r="1.8" />
            ))}
          </g>
          {[[120, 20], [180, 12], [430, 14], [500, 24], [60, 30], [540, 10]].map(([x, y]) => (
            <path key={x} d={`M${x - 4} ${y}h8M${x} ${y - 4}v8M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6`} stroke="#000" strokeWidth="1.2" strokeLinecap="round" />
          ))}
        </g>
      )}
    </svg>
  );
}
