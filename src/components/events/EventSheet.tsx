'use client';

import Sheet from '@/components/ui/Sheet';
import { DirIcon, ShareIcon, XIcon } from '@/components/shell/Icons';
import { RouteToggle } from '@/components/route/RouteButtons';
import { publicEnv } from '@/config/public-env';
import type { PublicEvent, Season } from '@/lib/data/types';
import { shareOrCopy, shareToast } from '@/lib/share/urls';
import { formatRange } from '@/lib/time/pacific';
import DateChip from './DateChip';
import { CalIcon, WebIcon } from './EventIcons';
import { directionsUrl, eventShareData, googleCalendarUrl, safeWebsite, worthTheDrive, type RegionBox } from './links';

interface Props {
  event: PublicEvent;
  season: Season;
  year: number;
  tz: string;
  /** The region's bbox: an event outside its local event box gets the "Worth the drive" chip. */
  region: RegionBox;
  onClose(): void;
  onToast(msg: string): void;
  /** Build my route: every event is at a public venue, so any event can be a stop. */
  route?: { inRoute: boolean; onToggle(): void };
}

/** Event details. Every data string renders as React text; nothing is injected as HTML. */
export default function EventSheet({ event: e, season, year, tz, region, onClose, onToast, route }: Props) {
  const far = worthTheDrive(region, e);
  const website = safeWebsite(e.url);
  const share = async () => {
    const msg = shareToast(await shareOrCopy(eventShareData(season, publicEnv.siteUrl, e), navigator));
    if (msg) onToast(msg);
  };
  return (
    <Sheet label="Event details" onClose={onClose}>
      <div className="sheet-in esheet">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">
              Event · {season === 'halloween' ? 'Halloween' : 'Christmas'} {year}
            </p>
            <h2 className="etitle">{e.title}</h2>
            {(e.adultsOnly || far) && (
              <p className="etags">
                {e.adultsOnly && <span className="t21 big">21+ · Adults only</span>}
                {far && <span className="tdrive big">Worth the drive</span>}
              </p>
            )}
          </div>
          <button type="button" className="iconbtn x" aria-label="Close event details" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="sec">
          <div className="ewhen">
            <DateChip iso={e.startsAt} tz={tz} />
            <p>
              <b>{formatRange(e.startsAt, e.endsAt, tz)}</b>
              <span>Pacific time</span>
            </p>
          </div>
          <p className="eplace">
            {e.venue && <b>{e.venue}</b>}
            <span>{e.address}</span>
          </p>
          <p className="edesc">{e.description}</p>
          {route && <RouteToggle inRoute={route.inRoute} onToggle={route.onToggle} />}
        </div>
        <div className="sec">
          <div className="eacts">
            {website && (
              <a className="btn ghost" href={website} target="_blank" rel="nofollow ugc noopener noreferrer">
                <WebIcon />
                Website
              </a>
            )}
            <a className="btn ghost" href={directionsUrl(e)} target="_blank" rel="noopener noreferrer">
              <DirIcon />
              Directions
            </a>
            <a className="btn ghost" href={googleCalendarUrl(e, tz)} target="_blank" rel="noopener noreferrer">
              <CalIcon />
              Add to calendar
            </a>
            <button type="button" className="btn primary" onClick={share}>
              <ShareIcon />
              Share
            </button>
          </div>
          <p className="fine">Add to calendar opens Google Calendar.</p>
        </div>
      </div>
    </Sheet>
  );
}
