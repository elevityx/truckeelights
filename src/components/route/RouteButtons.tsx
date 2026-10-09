'use client';

import { CheckIcon, PlusIcon, RouteIcon } from '@/components/shell/Icons';
import './route.css';

/** "+ Add to route" / "✓ In route" on the house and event sheets. */
export function RouteToggle({ inRoute, onToggle }: { inRoute: boolean; onToggle(): void }) {
  return (
    <button type="button" className={`btn ${inRoute ? 'ghost rin' : 'alt'} rtoggle`} aria-pressed={inRoute} onClick={onToggle}>
      {inRoute ? <CheckIcon /> : <PlusIcon />}
      {inRoute ? 'In route' : 'Add to route'}
    </button>
  );
}

/** The compact add icon on list rows. */
export function RouteAddButton({ inRoute, name, onToggle }: { inRoute: boolean; name: string; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`radd${inRoute ? ' on' : ''}`}
      aria-pressed={inRoute}
      aria-label={inRoute ? `${name}: in your route. Remove it` : `Add ${name} to your route`}
      onClick={onToggle}
    >
      {inRoute ? <CheckIcon /> : <PlusIcon />}
    </button>
  );
}

/** "My route (n)" above the Map/List pill; shown while the route has stops. The live region announces the count. */
export function RoutePill({ count, onOpen }: { count: number; onOpen(): void }) {
  return (
    <>
      {count > 0 && (
        <button type="button" className="routepill" onClick={onOpen} aria-label={`My route, ${count} ${count === 1 ? 'stop' : 'stops'}. Open the route`}>
          <RouteIcon />
          My route ({count})
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {count > 0 ? `My route: ${count} ${count === 1 ? 'stop' : 'stops'}` : ''}
      </span>
    </>
  );
}
