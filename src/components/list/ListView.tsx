import type { PinView, Season } from '@/lib/data/types';
import { pickGlyph } from '@/lib/maps/glyphs';
import Glyph from './Glyph';
import { THEMES } from '@/lib/theme/themes';
import { firstSegment, groupByStreet, restSegment } from '@/lib/text/address';

interface Props {
  season: Season;
  year: number;
  pins: PinView[];
  onOpen(id: string): void;
}

export default function ListView({ season, year, pins, onOpen }: Props) {
  const t = THEMES[season];
  if (pins.length === 0) {
    return (
      <div className="list">
        <div className="empty">
          <p className="disp">{t.empty}</p>
        </div>
      </div>
    );
  }
  const groups = groupByStreet(pins);
  const label = `${season === 'halloween' ? 'Halloween' : 'Christmas'} ${year}`;
  return (
    <div className="list">
      <div className="list-in">
        <div className="list-head">
          <h2 className="disp">{t.listTitle(pins.length)}</h2>
          <p>By street, A to Z · {label}</p>
        </div>
        {groups.map((g) => (
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
        ))}
        <p className="land-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
      </div>
    </div>
  );
}
