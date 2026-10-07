import type { Season } from '@/lib/data/types';

export function applySeason(season: Season): void {
  document.documentElement.dataset.theme = season;
  try {
    localStorage.setItem('lastSeason:default', season);
  } catch {
    /* storage may be unavailable */
  }
}
