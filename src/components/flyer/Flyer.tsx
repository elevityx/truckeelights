'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseConfigured } from '@/config/public-env';
import { getRegionContext, type Season } from '@/lib/data';
import type { QrPath } from '@/lib/share/qr';
import { displayUrl } from '@/lib/share/urls';
import { applySeason } from '@/lib/theme/applySeason';
import { FLYER_COPY, FLYER_INK_KEY, flyerSeasonFromQuery, resolveFlyerInk, type FlyerInk, type RichText } from './copy';
import './flyer.css';

interface Props {
  qr: QrPath;
  url: string;
}

export default function Flyer({ qr, url }: Props) {
  const [season, setSeason] = useState<Season>('halloween');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [ink, setInk] = useState<FlyerInk>('color');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The flyer works without data: halloween + this year, or the season in ?season=.
      const ctx = supabaseConfigured() ? await getRegionContext().catch(() => null) : await Promise.resolve(null);
      if (cancelled) return;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(FLYER_INK_KEY);
      } catch {
        /* storage may be unavailable */
      }
      setInk(resolveFlyerInk(window.location.search, stored));
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

  const setParam = (key: string, value: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set(key, value);
    history.replaceState(null, '', u.pathname + u.search);
  };

  const pick = (s: Season) => {
    setSeason(s);
    applySeason(s);
    setParam('season', s);
  };

  const pickInk = (i: FlyerInk) => {
    setInk(i);
    setParam('ink', i);
    try {
      localStorage.setItem(FLYER_INK_KEY, i);
    } catch {
      /* storage may be unavailable */
    }
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
        <div className="seg" role="group" aria-label="Flyer ink">
          <button type="button" aria-pressed={ink === 'color'} onClick={() => pickInk('color')}>
            Color
          </button>
          <button type="button" aria-pressed={ink === 'bw'} onClick={() => pickInk('bw')}>
            Black &amp; white
          </button>
        </div>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className={`flyer ink-${ink} fl-${season}`} aria-label={`Printable ${season === 'halloween' ? 'Halloween' : 'Christmas'} flyer`}>
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
            {c.steps.map((s, i) => (
              <li key={i}>
                <Rich parts={s} />
              </li>
            ))}
          </ol>
        </div>
        <p className="fl-pitch">{c.pitch}</p>
        <p className="fl-foot">{c.footer}</p>
      </article>
      <p className="fl-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
    </div>
  );
}

function Rich({ parts }: { parts: RichText }) {
  return (
    <span>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <strong key={i}>{p.strong}</strong>))}
    </span>
  );
}

/** Line-art version of the header's Donner ridge: peaks, two tunnel portals, and a seasonal guest. Constant markup.
 * Colors come from the `--m-*` properties in flyer.css: all black and white for B/W ink, the season palette for color. */
function FlyerMotif({ season }: { season: Season }) {
  const H = season === 'halloween';
  const ridge = 'M0 86L40 60L70 70L110 38L150 58L190 30L222 46L250 22L300 8L350 22L378 46L410 30L450 58L490 38L530 70L560 60L600 86';
  return (
    <svg className="fl-motif" viewBox="0 0 600 96" aria-hidden="true" focusable="false">
      <path className="m-ridge-fill" d={`${ridge}V88H0Z`} />
      <path className="m-ridge" d={ridge} fill="none" strokeWidth="2.4" strokeLinejoin="round" />
      <path className="m-rail" d="M0 88H600" strokeWidth="2.4" />
      <path className="m-rail" d="M0 93H600" strokeWidth="1.4" strokeDasharray="3 6" />
      {[244, 356].map((x) => (
        <g key={x}>
          <path className="m-portal" d={`M${x - 20} 88v-16a20 20 0 0 1 40 0v16z`} />
          <path className="m-arch" d={`M${x - 25} 88v-16a25 25 0 0 1 50 0v16`} fill="none" strokeWidth="1.6" />
        </g>
      ))}
      {H ? (
        <g>
          <g transform="translate(300 62)">
            <path className="m-ghost" d="M-11 13V-1a11 11 0 0 1 22 0v14l-3.7-3.6-3.6 3.6-3.7-3.6-3.7 3.6-3.6-3.6z" strokeWidth="2" strokeLinejoin="round" />
            <ellipse className="m-face" cx="-3.5" cy="-1.5" rx="2" ry="3" />
            <ellipse className="m-face" cx="4" cy="-1.5" rx="2" ry="3" />
            <ellipse className="m-face" cx="0.5" cy="5.5" rx="2" ry="2.6" />
          </g>
          <g transform="translate(470 18)">
            <circle className="m-moon" r="11" strokeWidth="2" />
            <path className="m-bat" d="M-26 6q3-5 7-2q2-3 5 0q3-3 5 0q3-3 7 2q-5 0-7 3q-2-2-5 0q-3-2-5 0q-2-3-7-3z" />
          </g>
          <g transform="translate(120 82)">
            <ellipse className="m-pumpkin" rx="9" ry="7" strokeWidth="2" />
            <path className="m-pumpkin-face" d="M-4-1l2 2-3 .5zM4-1l-2 2 3 .5zM-4 2.5q4 3 8 0" fill="none" strokeWidth="1.4" />
            <path className="m-stem" d="M0-7v-3" strokeWidth="2" strokeLinecap="round" />
          </g>
        </g>
      ) : (
        <g>
          <g transform="translate(300 88)">
            <path className="m-tree" d="M-12 0L0-30L12 0Z" strokeWidth="2" strokeLinejoin="round" />
            <path className="m-star" d="M0-35l2 4h-4z" />
            {[[-5, -6], [4, -12], [-2, -18], [6, -4]].map(([x, y]) => (
              <circle className="m-bulb" key={`${x},${y}`} cx={x} cy={y} r="1.8" />
            ))}
          </g>
          {[[120, 20], [180, 12], [430, 14], [500, 24], [60, 30], [540, 10]].map(([x, y]) => (
            <path className="m-flake" key={x} d={`M${x - 4} ${y}h8M${x} ${y - 4}v8M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6`} strokeWidth="1.2" strokeLinecap="round" />
          ))}
        </g>
      )}
    </svg>
  );
}
