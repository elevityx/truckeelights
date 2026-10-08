import { describe, expect, it } from 'vitest';
import { isSameSeason, statusLine, switchConfirmText, toggleCopy, yearChoices } from './seasonState';

describe('seasonState', () => {
  it('offers current year +/- 1', () => expect(yearChoices(2026)).toEqual([2025, 2026, 2027]));
  it('detects the live season', () => {
    expect(isSameSeason({ season: 'halloween', year: 2026 }, { season: 'halloween', year: 2026 })).toBe(true);
    expect(isSameSeason({ season: 'halloween', year: 2026 }, { season: 'christmas', year: 2026 })).toBe(false);
    expect(isSameSeason({ season: 'halloween', year: 2026 }, { season: 'halloween', year: 2027 })).toBe(false);
  });
  it('status line', () => {
    expect(statusLine({ season: 'halloween', year: 2026, open: true })).toBe('Live now: Halloween 2026 · Adding houses: OPEN');
    expect(statusLine({ season: 'christmas', year: 2026, open: false })).toBe('Live now: Christmas 2026 · Adding houses: CLOSED');
  });
  it('toggle button names the action', () => {
    expect(toggleCopy(true).button).toBe('Close adding');
    expect(toggleCopy(false).button).toBe('Open adding');
  });
  it('switch confirm states what changes', () => {
    expect(switchConfirmText({ season: 'christmas', year: 2026 })).toContain(
      'The public map will show Christmas 2026 houses and the Christmas theme; adding stays CLOSED',
    );
  });
});
