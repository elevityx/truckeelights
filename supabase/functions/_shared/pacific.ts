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

/** Pacific hours in which cron ticks do work: 18:07-19:57, every 10 minutes (bounded worker; later ticks resume). */
export const SLOT_HOURS = [18, 19];

/**
 * The 18:07-19:57 Pacific slot. pg_cron fires every 10 minutes from 01:07 to 03:57 UTC to cover both PDT and PST; only
 * the fires that land in 18:xx or 19:xx Pacific run, the rest return "not_due".
 */
export function dueKinds(now: Date): { date: string; kinds: ('daily' | 'weekly')[] } {
  const p = pacificParts(now);
  if (!SLOT_HOURS.includes(p.hour)) return { date: p.date, kinds: [] };
  return { date: p.date, kinds: p.weekday === 'Thu' ? ['daily', 'weekly'] : ['daily'] };
}
