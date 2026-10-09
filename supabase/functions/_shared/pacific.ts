// Wall-clock parts in the region's zone with Intl, never the host zone. Used to decide which digest runs are due.
import { REGION_TZ } from './digestEmail.ts';

export interface PacificParts { date: string; hour: number; weekday: string }

export function pacificParts(now: Date): PacificParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REGION_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, weekday: get('weekday') };
}

/** The 18:07 Pacific slot. pg_cron fires at 01:07 and 02:07 UTC (PDT/PST); only the one that lands at 18:xx Pacific runs. */
export function dueKinds(now: Date): { date: string; kinds: ('daily' | 'weekly')[] } {
  const p = pacificParts(now);
  if (p.hour !== 18) return { date: p.date, kinds: [] };
  return { date: p.date, kinds: p.weekday === 'Thu' ? ['daily', 'weekly'] : ['daily'] };
}
