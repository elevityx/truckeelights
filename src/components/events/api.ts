// The event calls the public UI makes. Production always uses the real data layer.
// `next dev` with NEXT_PUBLIC_EVENTS_MOCK=1 swaps in eventsDevMock.ts (an in-memory fake, for screenshots
// before the events database exists). The NODE_ENV check is inlined at build, so the mock is dead code in
// `next build` and never ships.
import { listEvents, submitEvent } from '@/lib/data/events';
import { ensureAnonymousSession, hasSession } from '@/lib/data/submit';
import type { EventInput, PinView, PublicEvent, RegionContext } from '@/lib/data/types';

export interface EventsApi {
  listEvents(regionId: string): Promise<PublicEvent[]>;
  submitEvent(regionSlug: string, input: EventInput): Promise<{ result: 'created' | 'exists'; eventId: string | null }>;
  hasSession(): Promise<boolean>;
  ensureAnonymousSession(token: string): Promise<void>;
}

export interface EventsFixture {
  ctx: RegionContext;
  pins: PinView[];
  /** Dev only: open a sheet on load, for screenshots. */
  open?: 'add' | 'event-form';
}

const real: EventsApi = { listEvents, submitEvent, hasSession, ensureAnonymousSession };
const mocked = () => process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_EVENTS_MOCK === '1';

export async function eventsApi(): Promise<EventsApi> {
  if (mocked()) return (await import('./eventsDevMock')).devEventsApi();
  return real;
}

/** Region context and houses from the dev mock; null outside `next dev` with the events mock. */
export async function devEventsFixture(): Promise<EventsFixture | null> {
  if (mocked()) return (await import('./eventsDevMock')).fixture();
  return null;
}
