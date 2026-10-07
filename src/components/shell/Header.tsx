import type { RegionContext } from '@/lib/data/types';
import { Ridge } from '../map/Decor';
import { PinIcon, PlusIcon } from './Icons';

interface Props {
  ctx: RegionContext;
  view: 'map' | 'list';
  onView(v: 'map' | 'list'): void;
  onAdd(): void;
}

export default function Header({ ctx, view, onView, onAdd }: Props) {
  const i = ctx.wordmark.lastIndexOf(' ');
  const first = i < 0 ? ctx.wordmark : ctx.wordmark.slice(0, i);
  const last = i < 0 ? '' : ctx.wordmark.slice(i + 1);
  const label = `${ctx.season === 'halloween' ? 'Halloween' : 'Christmas'} ${ctx.year}`;
  return (
    <>
      <header className="bar">
        <Ridge season={ctx.season} />
        <h1 className="wm disp" aria-label={ctx.wordmark}>
          {first}
          {last && (
            <>
              {' '}
              <span className="w2">{last}</span>
            </>
          )}
        </h1>
        <div className="meta">
          <span className="chip" title="Region">
            <PinIcon />
            {ctx.region.name}
          </span>
          <span className="season-lbl">{label}</span>
        </div>
        <div className="bar-actions">
          <div className="seg" role="group" aria-label="Show houses as">
            <button type="button" aria-pressed={view === 'map'} onClick={() => onView('map')}>
              Map
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => onView('list')}>
              List
            </button>
          </div>
          {ctx.submissionsOpen && (
            <button type="button" className="btn primary" aria-label="Add a house to the map" onClick={onAdd}>
              <PlusIcon />
              Add a house
            </button>
          )}
        </div>
        {ctx.season === 'halloween' ? (
          <div className="drip" aria-hidden="true">
            <i style={{ left: '13%', animationDelay: '-1s' }} />
            <i style={{ left: '52%', animationDelay: '-3.4s' }} />
            <i style={{ left: '81%', animationDelay: '-5s' }} />
          </div>
        ) : (
          <div className="lights" aria-hidden="true" />
        )}
      </header>
      {!ctx.submissionsOpen && (
        <p className="banner" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18v.5" strokeLinecap="round" />
          </svg>
          <span>
            <strong>Adding houses opens soon.</strong> The map is open for browsing.
          </span>
        </p>
      )}
    </>
  );
}
