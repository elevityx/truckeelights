'use client';

import { useState, type ReactNode } from 'react';
import type { PinView, Season } from '@/lib/data/types';
import { pickGlyph } from '@/lib/maps/glyphs';
import Glyph from './Glyph';
import ListControls from './ListControls';
import SortMenu from './SortMenu';
import type { Sort } from './sortMenu.logic';
import Meter from '@/components/house/Meter';
import { VOTE_PRIVACY } from '@/components/house/votePanel.logic';
import { THEMES } from '@/lib/theme/themes';
import { firstSegment, groupByStreet, restSegment } from '@/lib/text/address';
import { displayVotes, meterAriaText, powerKind, rankHouses, snowFeet } from '@/lib/votes/meter';

interface Props {
  season: Season;
  year: number;
  pins: PinView[];
  onOpen(id: string): void;
  /** Shown above the houses (the Both view puts upcoming events here). */
  before?: ReactNode;
  /** The inline Houses · Events · Both switch; below 1024px it opens the list in a control row next to the sort button. */
  layerSwitch?: ReactNode;
}

const SORT_KEY = 'listSort';

function savedSort(): Sort {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(SORT_KEY) === 'az' ? 'az' : 'top';
  } catch {
    return 'top';
  }
}

function VoteRow({ pin, season, rank, top3, onOpen }: { pin: PinView; season: Season; rank: string; top3: boolean; onOpen(id: string): void }) {
  const glyph = pickGlyph(pin.id, season);
  const kind = powerKind(season, glyph);
  const ranked = rank !== '–';
  return (
    <button
      type="button"
      className={`row vrow${top3 ? ' top3' : ''}`}
      aria-label={`${ranked ? `Rank ${rank}. ` : ''}${pin.address}. ${meterAriaText(kind, pin.votes, pin.photoCount)}`}
      onClick={() => onOpen(pin.id)}
    >
      <span className="rk" aria-hidden="true">
        {rank}
      </span>
      <span className="g">
        <Glyph name={glyph} />
      </span>
      <span className="a">
        <span className="an">{firstSegment(pin.address)}</span>
        <Meter kind={kind} votes={pin.votes} photoCount={pin.photoCount} size="md" />
      </span>
      <span className="ct" aria-hidden="true">
        <b>{pin.votes.toLocaleString('en-US')}</b>
        <span>{pin.votes === 1 ? 'vote' : 'votes'}</span>
        {kind === 'snow' && <em>{snowFeet(displayVotes(pin.votes, pin.photoCount))} ft</em>}
      </span>
    </button>
  );
}

export default function ListView({ season, year, pins, onOpen, before, layerSwitch }: Props) {
  const t = THEMES[season];
  const [sort, setSortState] = useState<Sort>(savedSort);
  const setSort = (s: Sort) => {
    setSortState(s);
    try {
      window.sessionStorage.setItem(SORT_KEY, s);
    } catch {
      /* storage may be unavailable */
    }
  };
  const listClass = layerSwitch ? 'list has-ctl' : 'list';
  if (pins.length === 0) {
    return (
      <div className={listClass}>
        {(layerSwitch || before) && (
          <div className="list-in">
            {layerSwitch && <ListControls layerSwitch={layerSwitch} />}
            {before}
          </div>
        )}
        <div className="empty">
          <p className="disp">{t.empty}</p>
        </div>
      </div>
    );
  }
  const label = `${season === 'halloween' ? 'Halloween' : 'Christmas'} ${year}`;
  const { voted, waiting } = sort === 'top' ? rankHouses(pins) : { voted: [], waiting: [] };
  return (
    <div className={listClass}>
      <div className="list-in">
        {layerSwitch && <ListControls layerSwitch={layerSwitch} sort={<SortMenu sort={sort} onChange={setSort} />} />}
        {before}
        <div className="list-head">
          <div>
            <h2 className="disp">{t.listTitle(pins.length)}</h2>
            <p>{sort === 'top' ? `Top voted · ${label} · resets each season` : `By street, A to Z · ${label}`}</p>
          </div>
          <SortMenu sort={sort} onChange={setSort} className="sort-head" />
        </div>
        {sort === 'top' ? (
          <>
            {voted.length > 0 && (
              <ol className="rank" aria-label="Top voted houses">
                {voted.map(({ pin, rank }) => (
                  <li key={pin.id}>
                    <VoteRow pin={pin} season={season} rank={String(rank)} top3={rank <= 3} onOpen={onOpen} />
                  </li>
                ))}
              </ol>
            )}
            {waiting.length > 0 && (
              <section className="rank-wait" aria-label="Waiting for their first vote">
                <h3>Waiting for their first vote</h3>
                <ul className="rank">
                  {waiting.map((pin) => (
                    <li key={pin.id}>
                      <VoteRow pin={pin} season={season} rank="–" top3={false} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          groupByStreet(pins).map((g) => (
            <section key={g.street} className="grp" aria-label={g.street}>
              <h3>{g.street}</h3>
              <ul>
                {g.items.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="row" onClick={() => onOpen(p.id)}>
                      <span className="g">
                        <Glyph name={pickGlyph(p.id, season)} />
                      </span>
                      <span className="a">
                        {firstSegment(p.address)}
                        <span className="b">{restSegment(p.address)}</span>
                      </span>
                      <span />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <p className="land-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
        <p className="vprivacy">{VOTE_PRIVACY}</p>
      </div>
    </div>
  );
}
