import { describe, expect, it } from 'vitest';
import { BOOT_SCRIPT, bootSeasonForDate } from './boot';

describe('bootSeasonForDate', () => {
  it.each([
    ['2026-09-01', 'halloween'],
    ['2026-10-31', 'halloween'],
    ['2026-11-05', 'halloween'],
    ['2026-11-06', 'christmas'],
    ['2027-01-10', 'christmas'],
  ])('%s -> %s', (iso, want) => {
    const [y, m, d] = iso.split('-').map(Number);
    expect(bootSeasonForDate(new Date(y, m - 1, d))).toBe(want);
  });
  it('boot script uses the same rule', () => {
    expect(BOOT_SCRIPT).toContain('m===9||m===10||(m===11&&day<=5)');
  });
});
