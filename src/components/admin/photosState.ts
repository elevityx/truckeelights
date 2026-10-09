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

/** Kill-switch view of the server's `photos_open`. Never seeded from a default: it starts as `loading`. */
export type PhotosSwitch = { kind: 'loading' } | { kind: 'on' } | { kind: 'off' } | { kind: 'unknown' };

export const switchFromOpen = (open: boolean): PhotosSwitch => ({ kind: open ? 'on' : 'off' });

/** Only a value read from the server can be toggled. */
export function switchDisabled(s: PhotosSwitch, busy: boolean): boolean {
  return busy || (s.kind !== 'on' && s.kind !== 'off');
}

/** `true`/`false` for aria-checked, `undefined` while the state isn't known (never reports OFF). */
export function switchChecked(s: PhotosSwitch): boolean | undefined {
  return s.kind === 'on' ? true : s.kind === 'off' ? false : undefined;
}

export function switchStatusText(s: PhotosSwitch): string {
  switch (s.kind) {
    case 'on': return 'On';
    case 'off': return 'Off';
    case 'loading': return 'Checking…';
    default: return 'Unknown';
  }
}

/** The value a click should request, or null when the current state isn't known. */
export function switchTarget(s: PhotosSwitch): boolean | null {
  return s.kind === 'on' ? false : s.kind === 'off' ? true : null;
}

export const CLEANUP_WARNING = 'Photo hidden in the app, but file cleanup is still pending.';

/** Runs the post-action storage cleanup. Pending means it threw or left jobs open. */
export async function settleCleanup(run: () => Promise<{ open: number }>): Promise<{ pending: boolean }> {
  try {
    const r = await run();
    return { pending: !(r.open === 0) };
  } catch {
    return { pending: true };
  }
}
