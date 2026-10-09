'use client';

import Glyph from '@/components/list/Glyph';
import Sheet from '@/components/ui/Sheet';
import { XIcon } from '@/components/shell/Icons';
import type { Season } from '@/lib/data/types';
import { THEMES } from '@/lib/theme/themes';
import EventGlyph from './EventGlyph';
import { ChevIcon } from './EventIcons';

interface Props {
  season: Season;
  housesOpen: boolean;
  eventsOpen: boolean;
  onHouse(): void;
  onEvent(): void;
  onClose(): void;
}

/** Add → A house (the existing flow) or An event. A closed option stays visible with "opens soon". */
export default function AddChooser({ season, housesOpen, eventsOpen, onHouse, onEvent, onClose }: Props) {
  const H = season === 'halloween';
  return (
    <Sheet label="Add to the map" onClose={onClose}>
      <div className="sheet-in">
        <div className="sheet-h">
          <div>
            <p className="eyebrow">Add to the map</p>
            <h2 className="disp">What are you adding?</h2>
          </div>
          <button type="button" className="iconbtn x" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="sec choose">
          <button type="button" className="opt" disabled={!housesOpen} onClick={onHouse}>
            <span className="og">
              <Glyph name={THEMES[season].glyph} />
            </span>
            <span className="ot">
              <b>A house</b>
              <span>{housesOpen ? (H ? 'Decorations, a haunted yard, a spooky porch' : 'Lights, decorations, a glowing yard') : 'Adding houses opens soon'}</span>
            </span>
            {housesOpen ? (
              <span className="chev" aria-hidden="true">
                <ChevIcon />
              </span>
            ) : (
              <span className="soon">Soon</span>
            )}
          </button>
          <button type="button" className="opt" disabled={!eventsOpen} onClick={onEvent}>
            <span className="og">
              <EventGlyph season={season} />
            </span>
            <span className="ot">
              <b>An event</b>
              <span>{eventsOpen ? (H ? 'A trick-or-treat, tour, party or haunt' : 'A tree lighting, concert, parade or party') : 'Event submissions open soon'}</span>
            </span>
            {eventsOpen ? (
              <span className="chev" aria-hidden="true">
                <ChevIcon />
              </span>
            ) : (
              <span className="soon">Soon</span>
            )}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
