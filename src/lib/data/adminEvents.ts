// stub: replaced by events/db
// Admin events data layer with exactly the A12 admin signatures. This stub is an in-memory fake so the
// Events tab runs without the database. The database enforces admin + aal2; nothing here is a boundary.
import { DataError, type AdminEvent, type EventInput, type EventStatus } from './types';

const store = new Map<string, AdminEvent>();
let seeded = false;

function seed() {
  if (seeded) return;
  seeded = true;
  const day = 86_400_000;
  const t = Date.now();
  const mk = (id: string, title: string, status: EventStatus, off: number, extra: Partial<AdminEvent> = {}) =>
    store.set(id, {
      id, title, description: 'A fake event for local development only.', venue: 'Downtown Park',
      address: '10181 Donner Pass Rd, Truckee', lat: 39.3279, lng: -120.1833,
      startsAt: new Date(t + off * day).toISOString(), endsAt: null, url: 'https://example.com/event', adultsOnly: false,
      status, source: 'community', sourceUrl: null, rejectReason: null, createdAt: new Date(t - day).toISOString(),
      sameDayWarning: false, ...extra,
    });
  mk('00000000-0000-4000-8000-000000000001', 'Fake Pumpkin Walk', 'pending', 5);
  mk('00000000-0000-4000-8000-000000000002', 'Fake Pumpkin Walk', 'pending', 5, { sameDayWarning: true, adultsOnly: true });
  mk('00000000-0000-4000-8000-000000000003', 'Fake Trunk or Treat', 'approved', 9, { source: 'seed', sourceUrl: 'https://example.org/source' });
  mk('00000000-0000-4000-8000-000000000004', 'Fake Hidden Party', 'hidden', 12);
}

export async function adminEventQueue(_regionId: string, status: EventStatus): Promise<AdminEvent[]> {
  seed();
  const rows = [...store.values()].filter((e) => e.status === status);
  return rows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

const ALLOWED: Record<EventStatus, EventStatus[]> = {
  pending: ['approved', 'rejected'], approved: ['hidden'], hidden: ['approved'], rejected: ['approved'],
};

export async function adminModerateEvent(id: string, status: EventStatus, reason?: string): Promise<void> {
  seed();
  const e = store.get(id);
  if (!e) throw new DataError('not_found');
  if (!ALLOWED[e.status].includes(status)) throw new DataError('invalid_input', 'transition');
  store.set(id, { ...e, status, rejectReason: status === 'rejected' ? reason ?? null : null });
}

export async function adminUpdateEvent(id: string, input: EventInput): Promise<void> {
  seed();
  const e = store.get(id);
  if (!e) throw new DataError('not_found');
  store.set(id, { ...e, ...input });
}

export async function adminCreateEvent(_regionId: string, input: EventInput, sourceUrl: string | null): Promise<string> {
  seed();
  const id = crypto.randomUUID();
  store.set(id, { ...input, id, status: 'approved', source: 'seed', sourceUrl, rejectReason: null, createdAt: new Date().toISOString(), sameDayWarning: false });
  return id;
}

export async function adminSetEventsOpen(regionId: string, open: boolean): Promise<void> {
  void regionId; void open; // no-op in the stub
}

export async function adminEventCounts(regionId: string): Promise<{ pending: number }> {
  void regionId;
  seed();
  return { pending: [...store.values()].filter((e) => e.status === 'pending').length };
}

