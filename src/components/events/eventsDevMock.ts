// DEV ONLY. Loaded by api.ts only under `next dev` with NEXT_PUBLIC_EVENTS_MOCK=1; dead code in production builds.
// Query options: ?season=christmas, and ?eventsMock= a comma list of
//   closed (event submissions closed) · nodb (a database without events: no switch, no event option)
//   empty (no events yet) · session (already past the bot check) · add (open the Add chooser)
//   form (open the event form) · exists | full | hourly | daily | breaker | network (submit outcomes) · slow
// Pair with NEXT_PUBLIC_VOTES_MOCK=1 to fake the house sheet's vote calls too.
// Halloween rows follow the public 2026 listings in our own words; houses and Christmas rows are made up.
import { DataError, type EventInput, type PinView, type PublicEvent, type RegionContext } from '@/lib/data/types';
import { addDays, localDate, toUtc } from '@/lib/time/pacific';
import type { EventsApi, EventsFixture } from './api';

const TZ = 'America/Los_Angeles';
const q = () => new URLSearchParams(window.location.search);
const has = (opt: string) => (q().get('eventsMock') ?? '').split(',').includes(opt);
const wait = (ms = 600) => new Promise((r) => setTimeout(r, has('slow') ? 4000 : ms));
const at = (date: string, time: string) => toUtc(date, time, TZ) as string;
const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const HOUSES: [id: string, address: string, lat: number, lng: number, votes: number][] = [
  ['01a1', '412 Snowshed Ln, Truckee, CA 96161', 39.3312, -120.1905, 150],
  ['00b2', '88 Lantern Ct, Truckee, CA 96161', 39.3338, -120.1802, 100],
  ['05c3', '1730 Old Signal Rd, Truckee, CA 96161', 39.3268, -120.1738, 75],
  ['02d4', '9 Hollow Pine Ct, Truckee, CA 96161', 39.3241, -120.1931, 50],
  ['04e5', '2205 Ember Hill Dr, Truckee, CA 96161', 39.3289, -120.184, 25],
  ['03f6', '640 Pinecone Way, Truckee, CA 96161', 39.3209, -120.1858, 12],
  ['06a7', '15 Ridge Lamp Rd, Truckee, CA 96161', 39.3222, -120.1765, 0],
  ['07b8', '301 Snowshed Ln, Truckee, CA 96161', 39.3301, -120.1962, 33],
];

function ev(n: number, e: Omit<PublicEvent, 'id' | 'url' | 'venue' | 'endsAt' | 'adultsOnly'> & Partial<PublicEvent>): PublicEvent {
  return { id: id(n), venue: null, endsAt: null, url: null, adultsOnly: false, ...e };
}

/** Started half an hour ago (on the hour), ends in two hours: always in Today. */
function happeningNow(): { startsAt: string; endsAt: string } {
  const s = Math.floor((Date.now() - 30 * 60_000) / 3_600_000) * 3_600_000;
  return { startsAt: new Date(s).toISOString(), endsAt: new Date(s + 3 * 3_600_000).toISOString() };
}

function halloween(today: string): PublicEvent[] {
  return [
    ev(1, {
      title: 'Pumpkin carving on the porch',
      description: 'Bring a pumpkin and a spoon. Carving tools, candles and cider are on the porch.\nSample event for the mock.',
      address: '88 Lantern Ct, Truckee, CA',
      lat: 39.3341,
      lng: -120.1796,
      ...happeningNow(),
    }),
    ev(2, {
      title: 'Glenshire Glow Walk',
      description: 'Walk the loop with glow sticks and lanterns. Kids welcome; bring a flashlight.\nSample event for the mock.',
      address: 'Glenshire Dr, Truckee, CA',
      lat: 39.3555,
      lng: -120.1155,
      startsAt: at(addDays(today, 2), '18:30'),
    }),
    ev(3, {
      title: 'Truckee Historical Haunted Tour',
      description: 'Costumed storytellers lead small groups to six historic downtown sites.\nTickets $75; benefits Trails & Vistas.',
      venue: 'Historic Truckee Hotel',
      address: '10007 Bridge St, Truckee, CA',
      lat: 39.3276,
      lng: -120.1839,
      startsAt: at('2026-10-15', '18:00'),
      endsAt: at('2026-10-15', '21:00'),
      url: 'https://www.truckeehistorytour.org/',
      adultsOnly: true,
    }),
    ev(4, {
      title: 'Spooky Harbor outdoor movie',
      description: 'A free Halloween movie on the beach, about 30 minutes after sunset. The park entry fee applies.',
      venue: 'Sand Harbor State Park',
      address: '2005 NV-28, Incline Village, NV',
      lat: 39.1985,
      lng: -119.93,
      startsAt: at('2026-10-16', '19:00'),
      url: 'https://parks.nv.gov/events',
    }),
    ev(5, {
      title: 'Harvest Fest 2026',
      description: 'A fall carnival with big trucks, games, hayrides, bounce houses and food trucks. Costumes welcome.',
      venue: 'Tahoe City Community Center',
      address: '401 West Lake Blvd, Tahoe City, CA',
      lat: 39.1655,
      lng: -120.144,
      startsAt: at('2026-10-17', '11:00'),
      endsAt: at('2026-10-17', '15:00'),
      url: 'https://www.tcpud.org/recreation/special-events/harvest-fest',
    }),
    ev(6, {
      title: 'Tahoe City Zombie Crawl',
      description: 'A costumed bar crawl through downtown Tahoe City.',
      venue: 'Downtown Tahoe City',
      address: 'N Lake Blvd, Tahoe City, CA',
      lat: 39.1712,
      lng: -120.1385,
      startsAt: at('2026-10-23', '17:00'),
      url: 'https://tahoe.com/tahoe-city/tahoe-city-downtown-assoc/events',
      adultsOnly: true,
    }),
    ev(7, {
      title: 'Halloween in the Park',
      description: 'Trick-or-treat at park tables and downtown shops, with a live band and a costume contest at 5:30.\nDia de los Muertos in the Arts Center.',
      venue: 'Truckee Community Arts Center',
      address: '10046 Church St, Truckee, CA',
      lat: 39.3283,
      lng: -120.1873,
      startsAt: at('2026-10-30', '16:00'),
      endsAt: at('2026-10-30', '18:00'),
      url: 'https://www.tdrpd.org/223/Halloween-In-The-Park',
    }),
    ev(8, {
      title: "Creeper's Ball",
      description: 'A Halloween concert night. 21 and over.',
      venue: 'Crystal Bay Casino',
      address: '14 NV-28, Crystal Bay, NV',
      lat: 39.2275,
      lng: -120.0035,
      startsAt: at('2026-10-30', '20:00'),
      endsAt: at('2026-10-30', '23:00'),
      adultsOnly: true,
    }),
  ];
}

function christmas(today: string): PublicEvent[] {
  return [
    ev(21, {
      title: 'Cocoa on Lantern Ct',
      description: 'Neighbors pour cocoa under the lights. Sample event for the mock.',
      address: '88 Lantern Ct, Truckee, CA',
      lat: 39.3341,
      lng: -120.1796,
      ...happeningNow(),
    }),
    ev(22, {
      title: 'Downtown tree lighting',
      description: 'Carols, cocoa and the big tree switching on at dusk. Sample event for the mock.',
      venue: 'Downtown Park',
      address: '10046 Church St, Truckee, CA',
      lat: 39.3283,
      lng: -120.1873,
      startsAt: at(addDays(today, 3), '16:30'),
      endsAt: at(addDays(today, 3), '18:00'),
    }),
    ev(23, {
      title: 'Breakfast with Santa',
      description: 'Pancakes and photos with Santa. Sample event for the mock.',
      venue: 'Community Center',
      address: '401 West Lake Blvd, Tahoe City, CA',
      lat: 39.1655,
      lng: -120.144,
      startsAt: at(addDays(today, 12), '08:00'),
      endsAt: at(addDays(today, 12), '10:30'),
    }),
  ];
}

let session = false;
let events: PublicEvent[] = [];
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function fixture(): EventsFixture {
  session = has('session');
  const season = q().get('season') === 'christmas' ? 'christmas' : 'halloween';
  const today = localDate(Date.now(), TZ);
  events = has('empty') ? [] : season === 'halloween' ? halloween(today) : christmas(today);
  const pins: PinView[] = HOUSES.map(([prefix, address, lat, lng, votes]) => ({
    id: `${prefix}0000-0000-4000-8000-000000000000`,
    address,
    lat,
    lng,
    photoCount: 0,
    votes,
    badges: [],
  }));
  const ctx: RegionContext = {
    region: {
      id: 'dev-region',
      slug: 'truckee',
      name: 'Truckee',
      minLat: 39.15,
      maxLat: 39.45,
      minLng: -120.42,
      maxLng: -119.98,
      centerLat: 39.29,
      centerLng: -120.1,
      defaultZoom: 11,
      timezone: TZ,
      countryCode: 'US',
    },
    season,
    year: 2026,
    submissionsOpen: true,
    wordmark: season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights',
    photosOpen: false,
    votesOpen: true,
    events: has('nodb') ? undefined : { open: !has('closed') },
  };
  return { ctx, pins, open: has('form') ? 'event-form' : has('add') ? 'add' : undefined };
}

export function devEventsApi(): EventsApi {
  return {
    async listEvents() {
      await wait(250);
      return events;
    },
    async hasSession() {
      return session;
    },
    async ensureAnonymousSession() {
      await wait(900);
      session = true;
    },
    async submitEvent(_slug: string, input: EventInput) {
      await wait();
      if (!session) throw new DataError('not_signed_in');
      if (has('network')) throw new DataError('network');
      if (has('full')) throw new DataError('queue_full' as never);
      if (has('hourly')) throw new DataError('rate_limited', 'uid_hourly');
      if (has('daily')) throw new DataError('rate_limited', 'uid_daily');
      if (has('breaker')) throw new DataError('rate_limited', 'region_breaker');
      const dup = events.find((e) => norm(e.title) === norm(input.title) && e.startsAt === input.startsAt);
      if (dup || has('exists')) return { result: 'exists' as const, eventId: dup?.id ?? events[0]?.id ?? null };
      return { result: 'created' as const, eventId: id(900 + Math.floor(Math.random() * 99)) };
    },
  };
}
