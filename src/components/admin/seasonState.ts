import type { Season } from '@/lib/data';

export const SEASON_LABEL: Record<Season, string> = { halloween: 'Halloween', christmas: 'Christmas' };
const THEME_LABEL: Record<Season, string> = { halloween: 'Halloween theme', christmas: 'Christmas theme' };

/** Years offered in the stepper: the live year plus or minus one. */
export function yearChoices(liveYear: number): number[] {
  return [liveYear - 1, liveYear, liveYear + 1];
}

export function isSameSeason(live: { season: Season; year: number }, target: { season: Season; year: number }): boolean {
  return live.season === target.season && live.year === target.year;
}

export function statusLine(live: { season: Season; year: number; open: boolean }): string {
  return `Live now: ${SEASON_LABEL[live.season]} ${live.year} · Adding houses: ${live.open ? 'OPEN' : 'CLOSED'}`;
}

export function toggleCopy(open: boolean): { button: string; confirm: string } {
  return open
    ? { button: 'Close adding', confirm: 'Visitors will no longer be able to add houses. The map stays visible.' }
    : { button: 'Open adding', confirm: 'Visitors will be able to add houses to the live season.' };
}

/** Exact sentence shown before a season switch. New seasons always start with adding closed. */
export function switchConfirmText(target: { season: Season; year: number }): string {
  return `The public map will show ${SEASON_LABEL[target.season]} ${target.year} houses and the ${THEME_LABEL[target.season]}; adding stays CLOSED. You can open adding afterwards.`;
}
