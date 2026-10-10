import type { ReactNode } from 'react';
import type { PublicEvent, Season } from '@/lib/data/types';
import ListControls from '@/components/list/ListControls';
import { formatRange, formatTimes, groupEvents } from '@/lib/time/pacific';
import DateChip from './DateChip';
import EventGlyph from './EventGlyph';
import { ChevIcon } from './EventIcons';
import { townOf, worthTheDrive, type RegionBox } from './links';

interface RowProps {
  e: PublicEvent;
  tz: string;
  region: RegionBox;
  onOpen(id: string): void;
}

export function EventRow({ e, tz, region, onOpen }: RowProps) {
  const town = townOf(e.address);
  const far = worthTheDrive(region, e);
  return (
    <button
      type="button"
      className="erow"
      onClick={() => onOpen(e.id)}
      aria-label={`${e.title}, ${formatRange(e.startsAt, e.endsAt, tz)}${town ? `, ${town}` : ''}${e.adultsOnly ? ', adults only, 21 and over' : ''}${far ? ', worth the drive' : ''}`}
    >
      <DateChip iso={e.startsAt} tz={tz} />
      <span className="info" aria-hidden="true">
        <strong>{e.title}</strong>
        <span className="meta">
          <span>
            {formatTimes(e.startsAt, e.endsAt, tz)}
            {town && ` · ${town}`}
          </span>
          {e.adultsOnly && <span className="t21">21+</span>}
          {far && <span className="tdrive">Worth the drive</span>}
        </span>
      </span>
      <span className="chev" aria-hidden="true">
        <ChevIcon />
      </span>
    </button>
  );
}

function EmptyEvents({ season, onAdd }: { season: Season; onAdd?: () => void }) {
  return (
    <div className="eempty">
      <EventGlyph season={season} />
      <p>No events yet — know one? Add it.</p>
      {onAdd && (
        <button type="button" className="btn primary" onClick={onAdd}>
          Add an event
        </button>
      )}
    </div>
  );
}

interface ListProps {
  events: PublicEvent[];
  tz: string;
  /** The region's bbox: rows outside its local event box get the "Worth the drive" chip. */
  region: RegionBox;
  now: number;
  season: Season;
  year: number;
  onOpen(id: string): void;
  /** Set only while event submissions are open. */
  onAdd?: () => void;
}

function EventItem({ e, tz, region, onOpen }: RowProps) {
  return (
    <li>
      <EventRow e={e} tz={tz} region={region} onOpen={onOpen} />
    </li>
  );
}

const seasonLabel = (season: Season, year: number) => `${season === 'halloween' ? 'Halloween' : 'Christmas'} ${year}`;

/** The Events view: Today · This week · Later, by start time. */
export function EventsView({ events, tz, region, now, season, year, onOpen, onAdd, layerSwitch }: ListProps & { layerSwitch?: ReactNode }) {
  const g = groupEvents(events, now, tz);
  const groups: [string, PublicEvent[]][] = [
    ['Today', g.today],
    ['This week', g.week],
    ['Later', g.later],
  ];
  const total = g.today.length + g.week.length + g.later.length;
  return (
    <div className={layerSwitch ? 'list has-ctl' : 'list'}>
      <div className="list-in">
        {layerSwitch && <ListControls layerSwitch={layerSwitch} />}
        <div className="list-head">
          <h2 className="disp">Upcoming events</h2>
          <p>{seasonLabel(season, year)} · Pacific time</p>
        </div>
        {total === 0 && <EmptyEvents season={season} onAdd={onAdd} />}
        {groups.map(
          ([label, items]) =>
            items.length > 0 && (
              <section key={label} className="grp" aria-label={label}>
                <h3>
                  {label} <span className="gn">{items.length}</span>
                </h3>
                <ul>
                  {items.map((e) => (
                    <EventItem key={e.id} e={e} tz={tz} region={region} onOpen={onOpen} />
                  ))}
                </ul>
              </section>
            ),
        )}
        <p className="land-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
      </div>
    </div>
  );
}

/** The Both view's top section: the next 3 events and a link to all of them. */
export function UpcomingEvents({ events, tz, region, now, season, onOpen, onAdd, onSeeAll }: Omit<ListProps, 'year'> & { onSeeAll(): void }) {
  const g = groupEvents(events, now, tz);
  const all = [...g.today, ...g.week, ...g.later];
  return (
    <section className="upcoming" aria-label="Upcoming events">
      <div className="list-head">
        <h2 className="disp">Upcoming events</h2>
        {all.length > 3 ? (
          <button type="button" className="linkbtn" onClick={onSeeAll}>
            See all events
          </button>
        ) : (
          all.length > 0 && <p>Next {all.length}</p>
        )}
      </div>
      {all.length === 0 ? (
        <EmptyEvents season={season} onAdd={onAdd} />
      ) : (
        <ul className="erows">
          {all.slice(0, 3).map((e) => (
            <EventItem key={e.id} e={e} tz={tz} region={region} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}
