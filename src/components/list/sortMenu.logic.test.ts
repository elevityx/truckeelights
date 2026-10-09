import { describe, expect, it } from 'vitest';
import { CLOSED, SORTS, onButtonClick, onButtonKey, onMenuKey, sortIndex, sortShort } from './sortMenu.logic';

describe('sort menu state', () => {
  it('lists Top voted then A–Z, with short button text', () => {
    expect(SORTS.map((o) => o.value)).toEqual(['top', 'az']);
    expect(sortShort('top')).toBe('Top voted');
    expect(sortShort('az')).toBe('A–Z');
    expect(sortIndex('az')).toBe(1);
  });

  it('a click toggles the menu, opening on the current sort', () => {
    expect(onButtonClick(CLOSED, 'az')).toEqual({ open: true, active: 1 });
    expect(onButtonClick(CLOSED, 'top')).toEqual({ open: true, active: 0 });
    expect(onButtonClick({ open: true, active: 1 }, 'az')).toEqual(CLOSED);
  });

  it('Down, Enter and Space on the button open on the current sort; Up opens on the last item', () => {
    for (const key of ['ArrowDown', 'Enter', ' ']) {
      expect(onButtonKey(key, 'az')).toEqual({ kind: 'state', state: { open: true, active: 1 } });
    }
    expect(onButtonKey('ArrowUp', 'top')).toEqual({ kind: 'state', state: { open: true, active: 1 } });
    expect(onButtonKey('a', 'top')).toEqual({ kind: 'none' });
    expect(onButtonKey('Escape', 'top')).toEqual({ kind: 'none' });
  });

  it('arrows wrap and Home/End jump inside the menu', () => {
    const at = (active: number) => ({ open: true, active });
    expect(onMenuKey('ArrowDown', at(0))).toEqual({ kind: 'state', state: at(1) });
    expect(onMenuKey('ArrowDown', at(1))).toEqual({ kind: 'state', state: at(0) });
    expect(onMenuKey('ArrowUp', at(0))).toEqual({ kind: 'state', state: at(1) });
    expect(onMenuKey('Home', at(1))).toEqual({ kind: 'state', state: at(0) });
    expect(onMenuKey('End', at(0))).toEqual({ kind: 'state', state: at(1) });
  });

  it('Enter or Space picks the focused item', () => {
    expect(onMenuKey('Enter', { open: true, active: 1 })).toEqual({ kind: 'select', value: 'az' });
    expect(onMenuKey(' ', { open: true, active: 0 })).toEqual({ kind: 'select', value: 'top' });
  });

  it('Escape closes back to the button; Tab closes and lets focus move on', () => {
    expect(onMenuKey('Escape', { open: true, active: 0 })).toEqual({ kind: 'close', focus: 'button' });
    expect(onMenuKey('Tab', { open: true, active: 0 })).toEqual({ kind: 'close', focus: 'none' });
    expect(onMenuKey('x', { open: true, active: 0 })).toEqual({ kind: 'none' });
  });
});
