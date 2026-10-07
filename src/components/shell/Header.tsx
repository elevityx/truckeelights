import type { RegionContext } from '@/lib/data/types';
import { PinIcon, PlusIcon } from './Icons';
import { Ridge } from './Ridge';

interface Props {
  ctx: RegionContext;
  onAdd(): void;
}

/** Quiet bar: wordmark + region/season line and Add a house, then the Donner ridge band, then the season trim. */
export default function Header({ ctx, onAdd }: Props) {
  const i = ctx.wordmark.lastIndexOf(' ');
  const first = i < 0 ? ctx.wordmark : ctx.wordmark.slice(0, i);
  const last = i < 0 ? '' : ctx.wordmark.slice(i + 1);
  const label = `${ctx.season === 'halloween' ? 'Halloween' : 'Christmas'} ${ctx.year}`;
  return (
    <>
      <header className="bar">
        <div className="bar-row">
          <div className="bar-id">
            <h1 className="wm disp" aria-label={ctx.wordmark}>
              {first}
              {last && (
                <>
                  {' '}
                  <span className="w2">{last}</span>
                </>
              )}
            </h1>
            <p className="sub">
              <PinIcon />
              <span>{ctx.region.name}</span>
              <span className="dot" aria-hidden="true">
                ·
              </span>
              <span>{label}</span>
            </p>
          </div>
          {ctx.submissionsOpen && (
            <button type="button" className="btn primary add" aria-label="Add a house to the map" onClick={onAdd}>
              <PlusIcon />
              <span className="add-long">Add a house</span>
              <span className="add-short">Add</span>
            </button>
          )}
        </div>
        <Ridge season={ctx.season} />
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
