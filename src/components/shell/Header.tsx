import type { RegionContext } from '@/lib/data/types';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { InfoIcon, PinIcon, PlusIcon } from './Icons';
import './header-about.css';
import { Ridge } from './Ridge';

interface Props {
  ctx: RegionContext;
  onAdd(): void;
  /** Houses · Events · Both, shown in the bar on wide screens (events-capable database only). */
  layerSwitch?: ReactNode;
  /** Add opens a chooser (a house or an event), so it shows when either kind is open. */
  addChooser?: { eventsOpen: boolean };
  /** The menu button (Subscribe, My account, Privacy), shown only while subscriptions are open. */
  menu?: ReactNode;
}

/** Quiet bar: wordmark + region/season line, the Donner ridge scene, and Add a house. The scene sits between them on wide screens and in a short band below them on narrow ones. */
export default function Header({ ctx, onAdd, layerSwitch, addChooser, menu }: Props) {
  const i = ctx.wordmark.lastIndexOf(' ');
  const first = i < 0 ? ctx.wordmark : ctx.wordmark.slice(0, i);
  const last = i < 0 ? '' : ctx.wordmark.slice(i + 1);
  const label = `${ctx.season === 'halloween' ? 'Halloween' : 'Christmas'} ${ctx.year}`;
  const add = addChooser ? (
    (ctx.submissionsOpen || addChooser.eventsOpen) && (
      <button type="button" className="btn primary add" aria-label="Add a house or an event" onClick={onAdd}>
        <PlusIcon />
        <span className="add-long">Add</span>
        <span className="add-short">Add</span>
      </button>
    )
  ) : (
    ctx.submissionsOpen && (
      <button type="button" className="btn primary add" aria-label="Add a house to the map" onClick={onAdd}>
        <PlusIcon />
        <span className="add-long">Add a house</span>
        <span className="add-short">Add</span>
      </button>
    )
  );
  return (
    <>
      <header className="bar">
        <div className={layerSwitch ? 'bar-row has-layer' : 'bar-row'}>
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
              <span className="dot sa-dot" aria-hidden="true">
                ·
              </span>
              <Link className="sub-about" href="/about/">
                <InfoIcon />
                <span className="sa-txt">About</span>
              </Link>
            </p>
          </div>
          <Ridge season={ctx.season} />
          {layerSwitch && <div className="bar-layer">{layerSwitch}</div>}
          {menu ? (
            <div className="bar-acts">
              {add}
              {menu}
            </div>
          ) : (
            add
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
