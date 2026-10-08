import type { StorageJob } from '@/lib/data/types';

export const REVOCATION_STUCK_MS = 60_000;
export const OTHER_STUCK_MS = 120_000;

const isRevocation = (j: StorageJob) => j.kind === 'delete_public' || j.kind === 'rotate_public';

/** Jobs that should light the red banner: revocation kinds past 60 s, anything else past 2 min. */
export function stuckJobs(jobs: StorageJob[], now: number): StorageJob[] {
  return jobs.filter((j) => {
    const age = now - Date.parse(j.createdAt);
    if (Number.isNaN(age)) return true; // unreadable timestamp: fail visible
    return age > (isRevocation(j) ? REVOCATION_STUCK_MS : OTHER_STUCK_MS);
  });
}

export function bannerText(n: number): string {
  return `${n} photo cleanup ${n === 1 ? 'task is' : 'tasks are'} stuck. The site can't hide ${n === 1 ? 'that photo' : 'those photos'} until ${n === 1 ? 'it runs' : 'they run'}.`;
}

export function runResultText(r: { done: number; open: number }): string {
  return `${r.done} finished, ${r.open} still waiting`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relativeAge(iso: string, now: number): string {
  const diff = Date.parse(iso) - now;
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return fmt.format(Math.round(diff / ms), unit);
  return 'just now';
}
