'use client';

import Sheet from '@/components/ui/Sheet';
import { publicEnv } from '@/config/public-env';
import type { PinView, Season } from '@/lib/data/types';
import { houseShareData, shareOrCopy, shareToast } from '@/lib/share/urls';
import { firstSegment, restSegment } from '@/lib/text/address';
import { DirIcon, ShareIcon, XIcon } from '@/components/shell/Icons';

interface Props {
  pin: PinView;
  season: Season;
  year: number;
  onClose(): void;
  onToast(msg: string): void;
}

export default function HouseSheet({ pin, season, year, onClose, onToast }: Props) {
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pin.address)}`;
  const label = `${season === 'halloween' ? 'Halloween' : 'Christmas'} ${year}`;

  const share = async () => {
    const msg = shareToast(await shareOrCopy(houseShareData(season, publicEnv.siteUrl, pin.id, firstSegment(pin.address)), navigator));
    if (msg) onToast(msg);
  };

  return (
    <Sheet label="House details" onClose={onClose}>
      <div className="sheet-in">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">{label}</p>
            <h2 className="addr">{firstSegment(pin.address)}</h2>
            <p className="town">{restSegment(pin.address)}</p>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close house details" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="sec">
          <ul className="badges" aria-label="What to expect">
            {pin.badges.map((b) => (
              <li key={`${b.kind}:${b.label}`}>
                {b.href && b.href.startsWith('https:') ? (
                  <a href={b.href} target="_blank" rel="noopener noreferrer">
                    {b.label}
                  </a>
                ) : (
                  b.label
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="sec">
          <p className="nophotos">No photos yet.</p>
        </div>
        <div className="sec">
          <div className="actions">
            <a className="btn ghost" href={dirUrl} target="_blank" rel="noopener">
              <DirIcon />
              Directions
            </a>
            <button type="button" className="btn primary" onClick={share}>
              <ShareIcon />
              Share this house
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
