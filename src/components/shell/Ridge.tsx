// Decorative Donner Pass / Donner Summit band under the header. aria-hidden; all markup is constant (no data rendered).
// Drawn in a 3200x72 viewBox, sliced around the middle, so its scale follows the band height and the set piece
// (two tunnel portals around C) stays centered at every width. Animations are CSS transform/opacity only (globals.css).
import type { CSSProperties, ReactNode } from 'react';
import type { Season } from '@/lib/data/types';

const C = 1600; // center of the set piece
const G = 64; // rail line
const FACE = 176; // the cliff faces sit at C ± FACE; moving things are clipped between them
const R = 19; // portal radius
const ARCH = 14; // straight side of the portal before the arch
const K = 1.2; // train scale

const pts = (p: [number, number][]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');

// Far range: a fixed profile repeated across the width.
const FAR_X = [0, 60, 120, 190, 250, 310, 360, 420, 480, 560, 620, 680, 740, 800, 870, 930];
const FAR_Y = [26, 15, 22, 10, 25, 17, 30, 20, 28, 14, 8, 26, 19, 28, 12, 22];
const FAR: [number, number][] = [];
for (let k = 0; k < 4; k++) FAR_X.forEach((x, i) => FAR.push([k * 1000 + x - 200, Math.round(FAR_Y[i] * 1.25)]));
const FAR_LINE = pts(FAR);
const FAR_FILL = `${FAR_LINE}L3800 72L-200 72Z`;
const FAR_CAPS = FAR.filter(([, y]) => y <= 20).map(([x, y]) => `M${x - 9} ${y + 6}L${x} ${y}L${x + 9} ${y + 6}L${x + 4} ${y + 4.5}L${x} ${y + 6.5}L${x - 4} ${y + 4.5}Z`).join('');

// Near shoulders with the tunnel cliffs. Top edges listed separately so snow can sit on them.
const L_TOP: [number, number][] = [[C - 660, G], [C - 580, 46], [C - 520, 38], [C - 465, 24], [C - 410, 13], [C - 360, 6], [C - 325, 2], [C - 295, 8], [C - 268, 16], [C - 244, 13], [C - 222, 7], [C - 205, 4], [C - FACE - 2, 4]];
const R_TOP: [number, number][] = [[C + FACE + 2, 4], [C + 212, 2], [C + 234, 9], [C + 258, 13], [C + 292, 7], [C + 334, 1], [C + 384, 9], [C + 434, 18], [C + 486, 27], [C + 546, 37], [C + 606, 47], [C + 680, G]];
const L_FILL = `${pts(L_TOP)}L${C - FACE} 22L${C - FACE + 2} ${G + 8}L${C - 660} ${G + 8}Z`;
const R_FILL = `M${C + FACE} 22${pts(R_TOP).replace('M', 'L')}L${C + 680} ${G + 8}L${C + FACE - 2} ${G + 8}Z`;

const arch = (x: number, r = R) => `M${x - r} ${G}v${-ARCH}a${r} ${r} 0 0 1 ${2 * r} 0v${ARCH}z`;
const PORTALS = [C - FACE - R, C + FACE + R];

const pine = (x: number, h: number) => `M${x - h * 0.36} ${G}L${x} ${G - h}L${x + h * 0.36} ${G}Z M${x - h * 0.28} ${G - h * 0.4}L${x} ${G - h * 1.05}L${x + h * 0.28} ${G - h * 0.4}Z`;
const PINES: [number, number][] = [[C - 150, 17], [C - 132, 12], [C + 58, 13], [C + 150, 18], [C + 166, 12], [C - 860, 14], [C - 900, 18], [C + 860, 16], [C + 905, 12], [C - 1100, 15], [C + 1120, 17]];

// Pines standing on the shoulder slopes (desktop widths mostly).
const yAt = (top: [number, number][], x: number) => {
  for (let i = 1; i < top.length; i++) {
    const [x0, y0] = top[i - 1];
    const [x1, y1] = top[i];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return G;
};
const SLOPE_PINES = [
  ...[-610, -560, -505, -450, -395, -300].map((dx) => [C + dx, yAt(L_TOP, C + dx)]),
  ...[300, 395, 455, 515, 570, 625].map((dx) => [C + dx, yAt(R_TOP, C + dx)]),
].map(([x, y], i) => {
  const h = 9 + (i % 3) * 2.5;
  const b = y + 7;
  return `M${x - h * 0.36} ${b}L${x} ${b - h}L${x + h * 0.36} ${b}Z`;
});

const v = (o: Record<string, string>) => o as CSSProperties;

function Ghost({ x, y, d, tilt = 12, flip = false }: { x: number; y: number; d: string; tilt?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})${flip ? ' scale(-1 1)' : ''}`}>
      <g className="tl-bob" style={v({ animationDelay: d })}>
        <path d="M-8 9V-1a8 8 0 0 1 16 0V9l-2.7-2.6-2.6 2.6-2.7-2.6-2.7 2.6-2.6-2.6z" fill="#F7F1E3" fillOpacity=".93" />
        <path d="M7 1q5 0 8-4M-5 5q-4 2-7 1" stroke="#F7F1E3" strokeOpacity=".8" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <ellipse cx="-2.4" cy="-1.6" rx="1.5" ry="2.2" fill="#140A1F" />
        <ellipse cx="3.2" cy="-1.6" rx="1.5" ry="2.2" fill="#140A1F" />
        <ellipse cx="0.6" cy="3.6" rx="1.4" ry="1.9" fill="#140A1F" />
      </g>
    </g>
  );
}

function Puffs({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <circle key={i} className="tl-puff" cx={x} cy={y} r={2.6} fill={fill} style={v({ animationDelay: `${-i * 0.45}s` })} />
      ))}
    </g>
  );
}

function GhostTrain() {
  return (
    <g className="tl-run tl-run-h">
      <g transform={`translate(0 ${G}) scale(${K}) translate(0 ${-G})`}>
      <path d={`M146 ${G - 12}L192 ${G - 22}V${G - 1}Z`} fill="url(#tlr-beam)" />
      <Puffs x={127} y={G - 27} fill="#d6ffb0" />
      <g filter="url(#tlr-glow)">
        <g fill="#d6ffb0" fillOpacity=".5" stroke="#8AE234" strokeOpacity=".85" strokeWidth="1">
          <rect x="2" y={G - 18} width="42" height="13" rx="3" />
          <rect x="50" y={G - 18} width="42" height="13" rx="3" />
          <rect x="98" y={G - 16} width="36" height="11" rx="4" />
          <rect x="96" y={G - 25} width="18" height="20" rx="2" />
          <rect x="123" y={G - 25} width="7" height="9" rx="1" />
          <path d={`M134 ${G - 9}L148 ${G - 2}H134Z`} />
        </g>
        <path d={`M93 ${G - 25}h24M44 ${G - 9}h6M92 ${G - 9}h6`} stroke="#8AE234" strokeWidth="1.4" />
        <g fill="#8AE234">
          {[7, 18, 29, 55, 66, 77].map((x) => (
            <rect key={x} x={x} y={G - 15} width="7" height="5" rx="1" />
          ))}
          <rect x="100" y={G - 22} width="10" height="6" rx="1" />
        </g>
        <circle cx="145" cy={G - 12} r="2.4" fill="#f4ffe6" />
      </g>
      <g fill="#140A1F" stroke="#8AE234" strokeWidth="1">
        {[10, 34, 58, 82, 104, 118, 130].map((x) => (
          <circle key={x} cx={x} cy={G - 3} r="3" />
        ))}
      </g>
      <Ghost x={-26} y={G - 32} d="-0.2s" />
      <Ghost x={-56} y={G - 24} d="-0.9s" tilt={16} />
      <Ghost x={-86} y={G - 36} d="-1.4s" tilt={8} />
      </g>
    </g>
  );
}

function SnowTrain() {
  return (
    <g className="tl-run tl-run-c">
      <g transform={`translate(0 ${G}) scale(${K}) translate(0 ${-G})`}>
      <path d={`M150 ${G - 13}L196 ${G - 22}V${G - 1}Z`} fill="url(#tlr-beam)" />
      <Puffs x={127} y={G - 27} fill="#eef4fb" />
      <rect x="2" y={G - 18} width="42" height="13" rx="2.5" fill="#2E8B57" />
      <rect x="50" y={G - 18} width="42" height="13" rx="2.5" fill="#C62828" />
      <path d={`M2 ${G - 18}q21-4 42 0zM50 ${G - 18}q21-4 42 0z`} fill="#F7F5EF" />
      <g fill="#F2C14E">
        {[7, 18, 29, 55, 66, 77].map((x) => (
          <rect key={x} x={x} y={G - 15} width="7" height="5" rx="1" />
        ))}
      </g>
      <rect x="98" y={G - 16} width="36" height="11" rx="4" fill="#C62828" />
      <rect x="98" y={G - 12} width="36" height="2" fill="#F2C14E" />
      <rect x="96" y={G - 25} width="18" height="20" rx="2" fill="#a51f1f" />
      <rect x="93" y={G - 27} width="24" height="3" rx="1.5" fill="#F7F5EF" />
      <rect x="100" y={G - 22} width="10" height="6" rx="1" fill="#F2C14E" />
      <rect x="123" y={G - 25} width="7" height="9" rx="1" fill="#2a1a12" />
      <circle cx="122" cy={G - 13} r="3" fill="none" stroke="#2E8B57" strokeWidth="1.8" />
      <path d={`M134 ${G - 13}L153 ${G - 1}H134Z`} fill="#dfe8f3" stroke="#7d94b3" strokeWidth=".8" />
      <circle cx="137" cy={G - 13} r="2.2" fill="#fff6d6" />
      <path d={`M44 ${G - 9}h6M92 ${G - 9}h6`} stroke="#0d1a2c" strokeWidth="1.6" />
      <g fill="#0d1a2c" stroke="#a9c2e0" strokeWidth=".8">
        {[10, 34, 58, 82, 104, 118].map((x) => (
          <circle key={x} cx={x} cy={G - 3} r="3" />
        ))}
      </g>
      <g fill="#F7FBFF">
        {[
          ['8px', '-12px', '0s', 2.2],
          ['14px', '-7px', '-.18s', 1.8],
          ['5px', '-15px', '-.36s', 1.6],
          ['16px', '-12px', '-.54s', 2],
          ['11px', '-4px', '-.27s', 1.5],
          ['3px', '-9px', '-.45s', 1.4],
        ].map(([dx, dy, d, r], i) => (
          <circle key={i} className="tl-spray" cx="152" cy={G - 2} r={r} style={v({ '--dx': dx as string, '--dy': dy as string, animationDelay: d as string })} />
        ))}
      </g>
      </g>
    </g>
  );
}

const SPACING = 180; // cabin spacing along the haul rope; the CSS loop moves one spacing per cycle
const SLOPE = -4 / 480;

function Cabin({ k }: { k: number }) {
  return (
    <g transform={`translate(${k * SPACING} ${k * SPACING * SLOPE})`}>
      <path d="M0 0V5.5" stroke="#c9d7ea" strokeWidth="1" />
      <circle cx="0" cy="0" r="1.4" fill="#c9d7ea" />
      <rect x="-7.5" y="5" width="15" height="13" rx="3.4" fill="#C62828" />
      <rect x="-6" y="7.4" width="12" height="5" rx="1.3" fill="#F2C14E" />
      <path d="M0 7.4v5" stroke="#C62828" strokeWidth="1" />
      <rect x="-7.5" y="15.2" width="15" height="2.8" rx="1" fill="#F7F5EF" fillOpacity=".85" />
    </g>
  );
}

function Gondola() {
  const a: [number, number] = [C - 240, 9];
  const b: [number, number] = [C + 240, 5];
  return (
    <g>
      <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke="#c9d7ea" strokeWidth="1.1" />
      <g clipPath="url(#tlr-gclip)">
        <g transform={`translate(${a[0]} ${a[1]})`}>
          <g className="tl-cab">
            {[-1, 0, 1, 2].map((k) => (
              <Cabin key={k} k={k + 0.35} />
            ))}
          </g>
        </g>
      </g>
      {/* terminals */}
      {[
        [a[0] - 6, 17],
        [b[0] + 6, 14],
      ].map(([x, base]) => (
        <g key={x}>
          <rect x={x - 12} y={base - 13} width="24" height="13" rx="1.5" fill="#13233A" stroke="#a9c2e0" strokeWidth=".9" />
          <path d={`M${x - 14} ${base - 12}L${x} ${base - 17}L${x + 14} ${base - 12}Z`} fill="#F7F5EF" />
          <rect x={x - 8} y={base - 9} width="5" height="4" fill="#F2C14E" />
          <rect x={x + 3} y={base - 9} width="5" height="4" fill="#F2C14E" />
        </g>
      ))}
    </g>
  );
}

const FLAKES: [number, number, number, number][] = [
  [C - 640, 9, 0, 1.2], [C - 520, 7.5, -3, 1], [C - 380, 10, -6, 1.3], [C - 270, 8, -1.5, 1], [C - 190, 9.5, -4.5, 1.2],
  [C - 90, 8.5, -2.2, 1.1], [C + 20, 10.5, -7, 1.3], [C + 110, 7.8, -3.6, 1], [C + 200, 9.2, -5.4, 1.2], [C + 300, 8.6, -0.8, 1],
  [C + 420, 10, -4, 1.3], [C + 560, 7.6, -6.2, 1.1],
];

export function Ridge({ season }: { season: Season }) {
  const H = season === 'halloween';
  const glow = H ? '#FF7A1A' : '#F2C14E';
  const beam = H ? '#d6ffb0' : '#fff2c4';
  let scene: ReactNode;
  if (H) {
    scene = (
      <>
        <GhostTrain />
        <g transform={`translate(${C + FACE + 12} ${G - 40}) scale(${K})`}>
          <g className="tl-peek">
            <Ghost x={0} y={0} d="-0.6s" tilt={-6} flip />
          </g>
        </g>
      </>
    );
  } else {
    scene = <SnowTrain />;
  }
  return (
    <div className="ridge" aria-hidden="true">
      <svg viewBox="0 0 3200 72" preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="tlr-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="tl-far-a" />
            <stop offset="1" className="tl-far-b" />
          </linearGradient>
          <radialGradient id="tlr-pg">
            <stop offset="0" stopColor={glow} stopOpacity=".95" />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="tlr-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={beam} stopOpacity=".55" />
            <stop offset="1" stopColor={beam} stopOpacity="0" />
          </linearGradient>
          <filter id="tlr-glow" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="tlr-gap">
            <rect x={C - FACE} y="-20" width={2 * FACE} height="100" />
          </clipPath>
          <clipPath id="tlr-gclip">
            <rect x={C - 238} y="-10" width="476" height="60" />
          </clipPath>
        </defs>

        {/* sky */}
        {H ? (
          <g>
            <circle cx={C + 560} cy="20" r="11" fill="#F3ECDA" fillOpacity=".9" />
            <circle cx={C + 556} cy="17" r="2.2" fill="#d9cfb8" />
            <circle cx={C + 563} cy="24" r="1.6" fill="#d9cfb8" />
            {[
              [C + 520, 14, '0s'],
              [C + 600, 26, '-.35s'],
            ].map(([x, y, d]) => (
              <g key={x as number} transform={`translate(${x} ${y})`}>
                <g className="tl-bat" style={v({ animationDelay: d as string })}>
                  <path d="M-7 0q2-3 4-1q1-2 3 0q2-2 3 0q2-2 4 1q-3 0-4 2q-1-1-3 0q-2-1-3 0q-1-2-4-2z" fill="#0b0412" />
                </g>
              </g>
            ))}
          </g>
        ) : (
          <g fill="#F7F5EF">
            {[
              [C - 560, 8], [C - 330, 4], [C + 60, 6], [C + 380, 10], [C + 620, 5], [C - 760, 12],
            ].map(([x, y], i) => (
              <circle key={x} className="tl-twinkle" cx={x} cy={y} r="1.1" style={v({ animationDelay: `${-i * 0.7}s` })} />
            ))}
          </g>
        )}

        {/* far range */}
        <path d={FAR_FILL} fill="url(#tlr-far)" />
        <path d={FAR_LINE} fill="none" className="tl-edge" strokeOpacity=".55" strokeWidth="1.2" />
        {!H && <path d={FAR_CAPS} fill="#eef4fb" opacity=".7" />}

        {/* ground, pines behind the track */}
        <rect x="-200" y={G} width="3600" height="10" className="tl-near" />
        {!H && <rect x="-200" y={G - 0.5} width="3600" height="10" fill="#dfe9f5" fillOpacity=".9" />}
        <path d={PINES.map(([x, h]) => pine(x, h)).join('')} fill={H ? '#0c0513' : '#1f5c3d'} />
        {!H && <path d={PINES.map(([x, h]) => `M${x - 2.5} ${G - h + 4}L${x} ${G - h - 0.5}L${x + 2.5} ${G - h + 4}Z`).join('')} fill="#F7F5EF" />}
        {!H && (
          <g transform={`translate(${C + 96} ${G})`}>
            <path d="M-7 0L0-18L7 0Z" fill="#2E8B57" />
            <path d="M0-19.5l1 2h-2z" fill="#F2C14E" />
            <g className="tl-bulbs">
              <circle cx="-3" cy="-4" r="1.1" fill="#ff5a5f" />
              <circle cx="2.6" cy="-8" r="1.1" fill="#6fd3ff" />
              <circle cx="-1.4" cy="-12" r="1.1" fill="#F2C14E" />
              <circle cx="3.4" cy="-2.6" r="1.1" fill="#7FD6A0" />
            </g>
          </g>
        )}

        {/* track */}
        <path d={`M-200 ${G + 2.5}H3400`} className="tl-rail" strokeWidth="2.4" strokeDasharray="1.6 4.4" strokeOpacity=".7" />
        <path d={`M-200 ${G}H3400`} className="tl-rail" strokeWidth="1.4" />

        {/* the train (and its ghosts) run between the cliffs */}
        <g clipPath="url(#tlr-gap)">{scene}</g>

        {/* near shoulders with the tunnel portals */}
        <path d={L_FILL} className="tl-near" />
        <path d={R_FILL} className="tl-near" />
        <path d={pts(L_TOP)} fill="none" className="tl-edge" strokeWidth="1.5" />
        <path d={pts(R_TOP)} fill="none" className="tl-edge" strokeWidth="1.5" />
        <path d={`M${C - FACE - 2} 4L${C - FACE} 22L${C - FACE + 2} ${G}M${C + FACE + 2} 4L${C + FACE} 22L${C + FACE - 2} ${G}`} fill="none" className="tl-edge" strokeOpacity=".6" strokeWidth="1" />
        {!H && (
          <path
            d={`${pts(L_TOP.slice(1))}${pts(R_TOP.slice(0, -1))}`}
            fill="none"
            stroke="#F7F5EF"
            strokeWidth="3.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {PORTALS.map((x) => (
          <g key={x}>
            <path d={arch(x, R + 4)} fill={H ? '#2f1b4a' : '#2c4466'} stroke={H ? '#7B3FBF' : '#a9c2e0'} strokeWidth="1" />
            <path d={arch(x)} fill={H ? '#05020a' : '#08111f'} />
            <ellipse className="tl-pglow" cx={x} cy={G - 12} rx={R * 1.25} ry={R * 0.95} fill="url(#tlr-pg)" />
            {!H && <path d={`M${x - R - 5} ${G - ARCH}a${R + 5} ${R + 5} 0 0 1 ${2 * R + 10} 0`} fill="none" stroke="#F7F5EF" strokeWidth="2.6" strokeLinecap="round" />}
          </g>
        ))}

        <path d={SLOPE_PINES.join('')} fill={H ? '#26133d' : '#1f5c3d'} />
        {H && (
          <g transform={`translate(${C - FACE + 22} ${G + 2.5}) scale(.9)`}>
            <circle r="7" className="tl-flicker" fill="url(#tlr-pg)" />
            <ellipse rx="4.6" ry="3.8" fill="#FF7A1A" />
            <path d="M-2.2-1l1 1.2-1.6.3zM2.2-1l-1 1.2 1.6.3zM-2.4 1.2q2.4 1.8 4.8 0" fill="#3a1600" stroke="#3a1600" strokeWidth=".6" />
            <path d="M0-3.6v-1.8" stroke="#8AE234" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        )}
        {!H && <Gondola />}
        {!H && (
          <g fill="#F7FBFF">
            {FLAKES.map(([x, dur, d, r]) => (
              <circle key={x} className="tl-flake" cx={x} cy="-4" r={r} style={v({ animationDuration: `${dur}s`, animationDelay: `${d}s` })} />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
