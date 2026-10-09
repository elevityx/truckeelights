import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { normalizeContent, renderDigest, subjectFor } from './digestEmail.ts';
import { dueKinds, pacificParts } from './pacific.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { siteUrl: 'https://example.test', unsubUrl: 'https://example.test/unsubscribe/?t=U', prefsUrl: 'https://example.test/unsubscribe/?t=P', cadence: 'daily' as const };

Deno.test('empty content renders nothing (skip)', () => {
  assertEquals(renderDigest({ ...base, houses: [], events: [], housesTotal: 0, eventsTotal: 0 }), null);
  assertEquals(normalizeContent({ houses: [{ id: 'not-a-uuid', address: 'x' }], events: [], housesTotal: 1, eventsTotal: 0 }), null);
});

Deno.test('caps at 10 per list and says how many more', () => {
  const houses = Array.from({ length: 14 }, (_, i) => ({ id: id(i), address: `${i + 1} Pine St`, town: 'Truckee' }));
  const r = renderDigest({ ...base, houses, events: [], housesTotal: 25, eventsTotal: 0 })!;
  assertEquals(r.html.split('?house=').length - 1, 10);
  assertStringIncludes(r.html, 'and 15 more on the map');
  assertStringIncludes(r.text, 'and 15 more on the map');
  assertEquals(r.subject, 'Truckee Lights: 25 new houses');
});

Deno.test('escapes data and links only validated ids', () => {
  const r = renderDigest({
    ...base,
    houses: [{ id: id(1), address: '<script>alert(1)</script> & "q"' }, { id: 'javascript:alert(1)', address: 'bad' }],
    events: [{ id: id(2), title: '<img src=x onerror=1>', starts_at: '2026-12-12T02:00:00Z' }],
    housesTotal: 2, eventsTotal: 1,
  })!;
  assert(!r.html.includes('<script>') && !r.html.includes('<img'));
  assertStringIncludes(r.html, '&lt;script&gt;');
  assert(!r.html.includes('javascript:'));
  assertStringIncludes(r.html, `https://example.test/?event=${id(2)}`);
});

Deno.test('events show Pacific time, and footer carries the unsubscribe and preferences links', () => {
  const r = renderDigest({ ...base, houses: [], events: [{ id: id(3), title: 'Tree lighting', starts_at: '2026-12-06T02:00:00Z' }], housesTotal: 0, eventsTotal: 1 })!;
  assertStringIncludes(r.text, 'Sat, Dec 5, 6:00 PM'); // 02:00Z is 6 PM the day before in PST
  assertStringIncludes(r.html, 'https://example.test/unsubscribe/?t=U');
  assertStringIncludes(r.html, 'https://example.test/unsubscribe/?t=P');
  assertStringIncludes(r.html, 'Manage preferences');
  assertEquals(subjectFor({ houses: [], events: [], housesTotal: 1, eventsTotal: 2 }), 'Truckee Lights: 1 new house and 2 new events');
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
