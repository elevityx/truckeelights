// Decorative, aria-hidden map overlays ported from mockup v2. All markup is constant JSX; no data is rendered here.
import type { Season } from '@/lib/data/types';

export function Troll() {
  return (
    <svg className="troll" viewBox="0 0 100 80" aria-hidden="true" focusable="false"><path d="M18 30l-6-22 14 14-2-20 12 17 4-18 7 17 8-16 3 18 11-14-2 19 14-11-8 20z" fill="#7B3FBF"/><path d="M14 44c-12-6-14 6-6 12 4 3 9 3 12 1zM86 44c12-6 14 6 6 12-4 3-9 3-12 1z" fill="#5f7d3a"/><ellipse cx="50" cy="56" rx="37" ry="30" fill="#6f8f45"/><path d="M30 44q8-6 15 0M55 44q8-6 15 0" stroke="#2c3a18" strokeWidth="3" fill="none" strokeLinecap="round"/><g className="eyes"><circle cx="38" cy="52" r="7" fill="#FFE27A"/><circle cx="62" cy="52" r="7" fill="#FFE27A"/><circle cx="39" cy="53" r="3" fill="#140A1F"/><circle cx="61" cy="53" r="3" fill="#140A1F"/></g><path d="M47 58q3 6 6 0" fill="#56702f"/><path d="M33 68q17 10 34 0" stroke="#2c3a18" strokeWidth="3" fill="#2c1a10" /><path d="M38 69l3 5 3-4 3 5 3-5 3 5 3-5 3 4 3-5" fill="#F3ECDA"/></svg>
  );
}

export function Fog() {
  return (
    <>
      <div className="fog" aria-hidden="true" />
      <div className="fog f2" aria-hidden="true" />
    </>
  );
}

const RIDGE = 'M0 92V60L60 48L120 56L190 34L250 50L310 42L360 58L420 46L480 56L560 40L620 30L680 52L740 44L800 54L870 36L930 48L1000 42V92Z';
const RIDGE_LINE = RIDGE.replace(/V92Z$/, '').replace(/^M0 92V/, 'M0 ');

export function Ridge({ season }: { season: Season }) {
  const H = season === 'halloween';
  const glow = H ? '#FF7A1A' : '#F2C14E';
  const dark = H ? '#0b0412' : '#0d1a2c';
  const portal = (x: number) => (
    <g key={x}>
      <ellipse className="portal-glow" cx={x} cy="68" rx="16" ry="10" fill="url(#pg)" />
      <path d={`M${x - 9} 75v-7a9 9 0 0 1 18 0v7z`} fill={H ? '#05020a' : '#08111f'} stroke={H ? '#5b3884' : '#a9c2e0'} strokeWidth="1.2" />
    </g>
  );
  const posts = [];
  for (let x = 382; x <= 470; x += 11) {
    posts.push(<path key={x} d={`M${x} 64V75`} stroke={H ? '#3a2356' : '#7d94b3'} strokeWidth="1.4" />);
  }
  return (
    <div className="ridge" aria-hidden="true">
      <svg viewBox="0 0 1000 92" preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark} stopOpacity=".85" />
            <stop offset=".65" stopColor={dark} stopOpacity=".45" />
            <stop offset="1" stopColor={dark} stopOpacity="0" />
          </linearGradient>
          <radialGradient id="pg">
            <stop offset="0" stopColor={glow} stopOpacity=".9" />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
          <filter id="gt" x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={RIDGE} fill="url(#rg)" />
        <path d={RIDGE_LINE} fill="none" stroke={H ? '#7B3FBF' : '#a9c2e0'} strokeOpacity=".45" strokeWidth="1.2" />
        <path d="M0 75H1000" stroke={H ? '#5b3884' : '#7d94b3'} strokeOpacity=".3" strokeWidth="1" strokeDasharray="3 3" />
        <path d="M378 64H472" stroke={H ? '#5b3884' : '#e9f1fb'} strokeWidth="2.4" />
        {posts}
        {portal(340)}
        {portal(660)}
        {H ? (
          <>
            <clipPath id="rclip"><rect x="349" y="40" width="302" height="40" /></clipPath>
            <g clipPath="url(#rclip)">
              <g className="ghosttrain">
                <g filter="url(#gt)">
                  <path d="M0 75V66q0-4 4-4h70q14 0 18 9l1 4z" fill="#d6ffb0" fillOpacity=".55" />
                  <path d="M8 66h8v4H8zM22 66h8v4h-8zM36 66h8v4h-8zM50 66h8v4h-8zM64 66h8v4h-8z" fill="#8AE234" />
                  <path d="M80 66q7 1 10 6h-10z" fill="#8AE234" fillOpacity=".8" />
                </g>
              </g>
            </g>
          </>
        ) : (
          <>
            <path d="M178 41L190 34L203 41L196 40L190 43L184 40Z M609 37L620 30L632 37L625 36L620 39L614 36Z M858 43L870 36L882 43L875 42L870 45L864 42Z" fill="#eef4fb" opacity=".75" />
            <path d="M512 76L628 41" stroke="#c9d7ea" strokeWidth="1" strokeOpacity=".8" />
            <path d="M540 68v8M570 59v9M600 50v9" stroke="#7d94b3" strokeWidth="2" />
            <clipPath id="cclip"><rect x="514" y="36" width="112" height="44" /></clipPath>
            <g clipPath="url(#cclip)">
              <g className="chairs">
                {[0, 1, 2, 3, 4].map((i) => {
                  const x = 482 + i * 30;
                  const y = 85 - i * 9;
                  return <path key={i} d={`M${x} ${y}v5h-3v3h6`} stroke="#F2C14E" strokeWidth="1.2" fill="none" />;
                })}
              </g>
            </g>
          </>
        )}
        <text className="lbl" x="520" y="88" textAnchor="middle">
          {H ? 'DONNER PASS' : 'DONNER SUMMIT'} · 7,056 FT
        </text>
      </svg>
    </div>
  );
}
