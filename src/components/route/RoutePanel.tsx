'use client';

import { useEffect, useState } from 'react';
import EventGlyph from '@/components/events/EventGlyph';
import Glyph from '@/components/list/Glyph';
import { DownIcon, ShareIcon, UpIcon, XIcon } from '@/components/shell/Icons';
import Sheet from '@/components/ui/Sheet';
import type { Season } from '@/lib/data/types';
import { pickGlyph } from '@/lib/maps/glyphs';
import { formatDistance, haversine } from '@/lib/route/geo';
import { legUrls, waypointsPerLeg } from '@/lib/route/mapsUrl';
import { pathLength } from '@/lib/route/order';
import { REMOVE_HOUSE_URL } from '@/lib/seo/jsonld';
import type { RouteApi } from './useRoute';
import './route.css';

export const SAFETY_LINE = 'Stick to sidewalks and lit streets, bring a light, and never use your phone while driving.';

const device = () => ({
  coarse: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  width: typeof window !== 'undefined' ? window.innerWidth : 1280,
});

/** 3 waypoints per leg on phones, 9 on desktop; follows rotation and window resizes. */
function usePerLeg(): number {
  const [per, setPer] = useState(() => waypointsPerLeg(device()));
  useEffect(() => {
    const on = () => setPer(waypointsPerLeg(device()));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return per;
}

interface Props {
  route: RouteApi;
  season: Season;
  year: number;
  onClose(): void;
}

export default function RoutePanel({ route, season, year, onClose }: Props) {
  const per = usePerLeg();
  const [confirmClear, setConfirmClear] = useState(false);
  const { views, mode } = route;
  const n = views.length;
  const urls = n > 0 ? legUrls(views, per, route.origin, mode) : [];
  const total = pathLength(views);
  const H = season === 'halloween';

  return (
    <Sheet label="My route" onClose={onClose} trap>
      <div className="sheet-in rpanel">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">
              {H ? 'Trick-or-treat walk' : 'Light tour'} · {H ? 'Halloween' : 'Christmas'} {year}
            </p>
            <h2 className="addr">My route</h2>
            <p className="town">
              {n === 0 ? 'No stops yet' : `${n} ${n === 1 ? 'stop' : 'stops'}${n > 1 ? ` · about ${formatDistance(total)} straight-line` : ''}`}
            </p>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close my route" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        {route.incoming && (
          <div className="rask" role="group" aria-labelledby="rask-h">
            <p id="rask-h">
              <b>Replace your route?</b>
            </p>
            <p>
              This link has {route.incoming.length} {route.incoming.length === 1 ? 'stop' : 'stops'}. Your saved route has {n}.
            </p>
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => route.resolveIncoming(true)}>
                Replace
              </button>
              <button type="button" className="btn ghost" onClick={() => route.resolveIncoming(false)}>
                Keep mine
              </button>
            </div>
          </div>
        )}

        <div className="sec">
          {n === 0 ? (
            <p className="nophotos">Tap “Add to route” on a house or event, or add the houses near you.</p>
          ) : (
            <ol className="rstops" aria-label="Stops in order">
              {views.map((v, i) => {
                const next = views[i + 1];
                return (
                  <li key={`${v.kind}:${v.id}`} className="rstop">
                    <span className="rn" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="g">{v.kind === 'house' ? <Glyph name={pickGlyph(v.id, season)} /> : <EventGlyph season={season} />}</span>
                    <span className="rt">
                      <b>{v.title}</b>
                      <small>
                        {v.kind === 'event' ? `Event${v.sub ? ` · ${v.sub}` : ''}` : 'House'}
                        {next && ` · ${formatDistance(haversine(v, next))} to next`}
                      </small>
                    </span>
                    <span className="rbtns">
                      <button type="button" className="iconbtn" aria-label={`Move ${i + 1} up`} disabled={i === 0} onClick={() => route.move(i, -1)}>
                        <UpIcon />
                      </button>
                      <button type="button" className="iconbtn" aria-label={`Move ${i + 1} down`} disabled={i === n - 1} onClick={() => route.move(i, 1)}>
                        <DownIcon />
                      </button>
                      <button type="button" className="iconbtn" aria-label={`Remove ${v.title} from route`} onClick={() => route.remove(i)}>
                        <XIcon />
                      </button>
                    </span>
                    {v.kind === 'house' && (
                      <a className="rown" href={REMOVE_HOUSE_URL} target="_blank" rel="noopener noreferrer">
                        Is this your house? Remove it
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="actions">
            {n > 1 && (
              <button type="button" className="btn ghost" onClick={() => void route.order()} disabled={route.busy !== null}>
                {route.busy === 'order' ? 'Finding you…' : 'Order for me'}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => void route.nearby()} disabled={route.busy !== null}>
              {route.busy === 'nearby' ? 'Finding you…' : 'Nearby houses'}
            </button>
          </div>
          <p className="fine">Order for me and Nearby houses ask for your location once. It stays on your phone.</p>
        </div>

        {n > 0 && (
          <div className="sec">
            <div className="seg rmode" role="group" aria-label="Travel mode">
              <button type="button" aria-pressed={mode === 'walking'} onClick={() => route.setMode('walking')}>
                Walking
              </button>
              <button type="button" aria-pressed={mode === 'driving'} onClick={() => route.setMode('driving')}>
                Driving
              </button>
            </div>
            {urls.length === 1 ? (
              <a className="btn primary rstart" href={urls[0]} target="_blank" rel="noopener noreferrer">
                Start route
              </a>
            ) : (
              <>
                <p className="fine">
                  Google Maps takes {per + 1} stops at a time here, so your route comes in {urls.length} legs. Each leg starts where the last one
                  ended.
                </p>
                <div className="rlegs">
                  {urls.map((u, i) => (
                    <a key={u} className={`btn ${i === 0 ? 'primary' : 'ghost'}`} href={u} target="_blank" rel="noopener noreferrer">
                      Leg {i + 1} of {urls.length}
                    </a>
                  ))}
                </div>
              </>
            )}
            <p className="fine">Opens Google Maps{route.origin ? '' : ', starting from where you are'}.</p>
          </div>
        )}

        <div className="sec">
          {n > 0 &&
            (confirmClear ? (
              <div className="rask" role="group" aria-label="Clear route">
                <p>
                  Clear all {n} {n === 1 ? 'stop' : 'stops'}?
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      route.clear();
                      setConfirmClear(false);
                    }}
                  >
                    Yes, clear
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => void route.share()}>
                  <ShareIcon />
                  Share route
                </button>
                <button type="button" className="btn danger" onClick={() => setConfirmClear(true)}>
                  Clear route
                </button>
              </div>
            ))}
          <p className="rsafe">{SAFETY_LINE}</p>
          {H && <p className="fine">Not every house is home or giving out candy. Skip porches with the lights off.</p>}
        </div>
      </div>
    </Sheet>
  );
}
