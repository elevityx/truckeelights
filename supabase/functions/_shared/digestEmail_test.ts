import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { DigestRecipient } from './db.ts';
import { dateChip, introFor, normalizeContent, renderDigest, subjectFor, timeLabel, type RenderInput } from './digestEmail.ts';
import { buildEmail, type RunConfig } from './digestRun.ts';
import { dueKinds, pacificParts } from './pacific.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base: Omit<RenderInput, 'houses' | 'events' | 'housesTotal' | 'eventsTotal'> = {
  siteUrl: 'https://example.test', unsubUrl: 'https://example.test/unsubscribe/?t=U', prefsUrl: 'https://example.test/unsubscribe/?t=P',
  cadence: 'daily', timezone: 'America/Los_Angeles', season: 'halloween', seasonYear: 2026, seasonOpener: false,
  windowTo: '2026-10-16T01:07:00Z', regionName: 'Truckee',
};
const house = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), address: `${n} Pine St`, town: 'Truckee', votes: 0, ...over });
const event = (n: number, over: Record<string, unknown> = {}) =>
  ({ id: id(100 + n), title: `Event ${n}`, starts_at: '2026-10-17T02:00:00Z', venue: 'Town Hall', town: 'Truckee', far: false, ...over });

Deno.test('empty content renders nothing (skip)', () => {
  assertEquals(renderDigest({ ...base, houses: [], events: [], housesTotal: 0, eventsTotal: 0 }), null);
  assertEquals(normalizeContent({ houses: [{ id: 'not-a-uuid', address: 'x' }], events: [], housesTotal: 1, eventsTotal: 0 }), null);
  assertEquals(normalizeContent({ houses: [{ id: id(1), address: '   ' }], events: [{ id: id(2), title: 'x', starts_at: 'nope' }], housesTotal: 1, eventsTotal: 1 }), null);
});

Deno.test('caps at 10 per list and says how many more (houses link to the list, events to the events list)', () => {
  const houses = Array.from({ length: 14 }, (_, i) => house(i + 1));
  const events = Array.from({ length: 12 }, (_, i) => event(i + 1));
  const r = renderDigest({ ...base, houses, events, housesTotal: 25, eventsTotal: 12 })!;
  assertEquals(r.html.split('?house=').length - 1, 10);
  assertEquals(r.html.split('?event=').length - 1, 10);
  assertStringIncludes(r.html, 'And 15 more houses on the map');
  assertStringIncludes(r.html, 'And 2 more events on the map');
  assertStringIncludes(r.html, 'href="https://example.test/?view=list"');
  assertStringIncludes(r.html, 'href="https://example.test/?view=list&amp;layer=events"');
  assertStringIncludes(r.text, 'And 15 more houses on the map: https://example.test/?view=list');
  assertEquals(r.subject, 'New on the Frights map: 25 houses, 12 events');
});

Deno.test('escapes every data field (address, town, title, venue, region) and links only validated ids', () => {
  const evil = '<script>alert(1)</script> & "q" \'x\'';
  const r = renderDigest({
    ...base,
    regionName: '<b>Region</b>',
    houses: [house(1, { address: evil, town: '<i>Town</i>', votes: 2 }), { id: 'javascript:alert(1)', address: 'bad' }],
    events: [event(2, { title: '<img src=x onerror=1>', town: null, venue: '"><svg onload=1>' }), { id: id(9), title: 'no date', starts_at: 'x' }],
    housesTotal: 2, eventsTotal: 2,
  })!;
  assert(!r.html.includes('<script') && !r.html.includes('<svg') && !r.html.includes('<b>') && !r.html.includes('<i>'));
  assert(!r.html.includes('<img src=x') && !r.html.includes('"><svg'));
  assertStringIncludes(r.html, '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;x&#39;');
  assertStringIncludes(r.html, '&lt;i&gt;Town&lt;/i&gt;');
  assertStringIncludes(r.html, '&lt;img src=x onerror=1&gt;');
  assertStringIncludes(r.html, '&quot;&gt;&lt;svg onload=1&gt;');
  assertStringIncludes(r.html, '&lt;b&gt;Region&lt;/b&gt;');
  assert(!r.html.includes('javascript:'));
  assertEquals(r.html.split('?house=').length - 1, 1);
  assertEquals(r.html.split('?event=').length - 1, 1); // the event with a bad date is dropped
  assertStringIncludes(r.html, `https://example.test/?event=${id(102)}`);
  // The only <img> tags are the wordmark from SITE_URL.
  assertEquals([...r.html.matchAll(/<img\b[^>]*>/g)].length, 1);
  assertEquals([...r.html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]), ['https://example.test/email/halloween-badge.png']);
  // The text part is plain text: the data appears as written, and there is no HTML.
  assertStringIncludes(r.text, evil);
  assert(!/<(a|td|tr|table|p|div|span)\b/.test(r.text));
});

Deno.test('a SITE_URL that tries to break out of an attribute is escaped', () => {
  const r = renderDigest({ ...base, siteUrl: 'https://example.test/"><x', houses: [house(1)], events: [], housesTotal: 1, eventsTotal: 0 })!;
  assert(!r.html.includes('"><x'));
  assertStringIncludes(r.html, 'https://example.test/&quot;&gt;&lt;x/email/halloween-badge.png');
});

Deno.test('Direction B: badge row with the date; houses show town and votes; events show chip, time, town and Worth the drive', () => {
  const r = renderDigest({
    ...base,
    houses: [house(1, { votes: 14 }), house(2, { votes: 1, town: null }), house(3)],
    events: [
      event(1, { far: true, town: 'Reno', starts_at: '2026-10-18T03:00:00Z' }),
      event(2, { town: null, venue: 'Fixture Plaza', starts_at: '2026-10-17T18:30:00Z' }),
    ],
    housesTotal: 3, eventsTotal: 2,
  })!;
  assertStringIncludes(r.html, 'src="https://example.test/email/halloween-badge.png" width="150" height="35" alt="Truckee Frights"');
  assert(!r.html.includes('-band.png'));
  assertStringIncludes(r.html, '>Thu, Oct 15<'); // 01:07Z Oct 16 is 18:07 PDT Oct 15
  assertStringIncludes(r.html, 'Hi neighbor,');
  assertStringIncludes(r.html, '3 new houses went up on the map since yesterday, and 2 new events were added. Here’s what’s new.');
  assertStringIncludes(r.html, 'Truckee · 14 votes');
  assertStringIncludes(r.html, '>1 vote<');
  assertStringIncludes(r.html, 'Be the first to vote');
  assertStringIncludes(r.html, '>OCT<');
  assertStringIncludes(r.html, 'Sat 8 pm · Reno');
  assertEquals(r.html.split('Worth the drive').length - 1, 1);
  assertStringIncludes(r.html, 'Sat 11:30 am · Fixture Plaza'); // no town -> venue
  assertStringIncludes(r.html, 'Vote for your favorite');
  assertStringIncludes(r.html, 'You’re getting this daily email because you subscribed to new houses and events around Truckee.');
  assertStringIncludes(r.html, 'Washoe (Wašiw)');
  assertStringIncludes(r.text, '- Event 1: Sat, Oct 17, 8 pm, Reno (worth the drive)');
  assertStringIncludes(r.text, '- 1 Pine St, Truckee (14 votes)');
  assertStringIncludes(r.text, '- 2 Pine St (1 vote)');
  assertEquals(r.subject, 'New on the Frights map: 3 houses, 2 events');
});

Deno.test("season opener: A's header band replaces the badge; subject and intro say the season is back", () => {
  const r = renderDigest({
    ...base, season: 'christmas', seasonOpener: true, windowTo: '2026-12-04T02:07:00Z',
    houses: [house(1)], events: [], housesTotal: 1, eventsTotal: 0,
  })!;
  assertStringIncludes(r.html, 'src="https://example.test/email/christmas-band.png" width="600" height="150" alt="Truckee Lights"');
  assert(!r.html.includes('-badge.png'));
  assertStringIncludes(r.html, 'Christmas 2026 · Thu, Dec 3');
  assertStringIncludes(r.html, 'Truckee Lights is back for Christmas 2026. 1 new house went up on the map since yesterday. Here’s what’s new.');
  assertEquals(r.subject, 'Truckee Lights is back: 1 house');
  assertStringIncludes(r.html, '#C62828'); // Christmas button color
  assertStringIncludes(r.text, 'Truckee Lights · Christmas 2026 · Thu, Dec 3');
});

Deno.test('events only: no vote prompt, the button goes to the events list; weekly wording', () => {
  const r = renderDigest({ ...base, cadence: 'weekly', houses: [], events: [event(1)], housesTotal: 0, eventsTotal: 1 })!;
  assert(!r.html.includes('Vote for your favorite'));
  assertStringIncludes(r.html, 'See what’s coming up');
  assertStringIncludes(r.html, '1 new event went up on the map this past week. Here’s what’s coming up.');
  assertStringIncludes(r.html, 'this weekly email');
  assertEquals(r.subject, 'New on the Frights map: 1 event');
  assertEquals(introFor({ housesTotal: 1, eventsTotal: 1 }, 'daily', 'halloween', 2026, false),
    '1 new house went up on the map since yesterday, and 1 new event was added. Here’s what’s new.');
  assertEquals(subjectFor({ housesTotal: 2, eventsTotal: 0 }, 'christmas'), 'New on the Lights map: 2 houses');
});

Deno.test('footer carries the unsubscribe and preferences links in both parts; text part has the plain links', () => {
  const r = renderDigest({ ...base, houses: [house(1)], events: [event(1)], housesTotal: 1, eventsTotal: 1 })!;
  assertStringIncludes(r.html, 'href="https://example.test/unsubscribe/?t=U"');
  assertStringIncludes(r.html, 'href="https://example.test/unsubscribe/?t=P"');
  assertStringIncludes(r.text, 'Unsubscribe: https://example.test/unsubscribe/?t=U');
  assertStringIncludes(r.text, 'Manage preferences: https://example.test/unsubscribe/?t=P');
  assertStringIncludes(r.text, `https://example.test/?house=${id(1)}`);
  assertStringIncludes(r.text, `https://example.test/?event=${id(101)}`);
});

Deno.test('times and dates are in the region zone (fallback Pacific)', () => {
  assertEquals(timeLabel('2026-12-06T02:00:00Z'), '6 pm'); // PST
  assertEquals(timeLabel('2026-10-17T00:30:00Z', 'America/Los_Angeles'), '5:30 pm'); // PDT
  assertEquals(dateChip('2026-12-06T02:00:00Z', 'Not/AZone'), { mon: 'DEC', day: '5', dow: 'Sat' });
});

Deno.test('deterministic: the same row renders byte-for-byte the same email, whatever the clock', async () => {
  const row: DigestRecipient = {
    run_id: id(900), user_id: id(901), email: 'p@example.test', idempotency_key: `digest:${id(902)}:a/b`, window_to: '2026-10-16T01:07:00Z',
    public_id: id(902), token_version: 3, region_slug: 'truckee', region_name: 'Truckee', timezone: 'America/Los_Angeles', cadence: 'daily',
    season: 'halloween', season_year: 2026, season_opener: true,
    houses: [house(1, { votes: 2 })], house_total: 1, events: [event(1, { far: true })], event_total: 1, payload: null,
  };
  const cfg = (t: string): RunConfig => ({
    siteUrl: 'https://truckeelights.com', functionsUrl: 'https://fn.test/functions/v1', from: 'TL <d@x.test>', hmacSecret: 's', resendKey: 'k',
    paceMs: 0, now: () => new Date(t),
  });
  const a = await buildEmail(row, cfg('2026-10-16T01:07:05Z'));
  const b = await buildEmail(row, cfg('2026-10-18T09:00:00Z'));
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertStringIncludes(a!.html, 'https://truckeelights.com/email/halloween-band.png');
  assertEquals(a!.subject, 'Truckee Frights is back: 1 house, 1 event');
});

Deno.test('dueKinds: only the 18:xx-19:xx Pacific slot runs, Thursday adds weekly', () => {
  // 2026-12-04 is a Friday. 02:07Z Dec 5 = 18:07 PST Friday Dec 4.
  assertEquals(dueKinds(new Date('2026-12-05T02:07:00Z')), { date: '2026-12-04', kinds: ['daily'] });
  assertEquals(dueKinds(new Date('2026-12-05T01:07:00Z')).kinds, []); // 17:07 PST: before the slot in winter
  // Thursday 2026-12-03, 18:07 PST.
  assertEquals(dueKinds(new Date('2026-12-04T02:07:00Z')), { date: '2026-12-03', kinds: ['daily', 'weekly'] });
  // Summer (PDT): 01:07Z is 18:07 Pacific, 02:57Z is 19:57, 03:07Z is 20:07 (after the slot).
  assertEquals(dueKinds(new Date('2026-07-10T01:07:00Z')).kinds, ['daily', 'weekly']); // Thursday Jul 9
  assertEquals(dueKinds(new Date('2026-07-10T02:57:00Z')).kinds, ['daily', 'weekly']);
  assertEquals(dueKinds(new Date('2026-07-10T03:07:00Z')).kinds, []);
  assertEquals(pacificParts(new Date('2026-12-05T08:30:00Z')).hour, 0);
});
