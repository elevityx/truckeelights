/** Pure state for the list's compact sort button and its menu (role="menu", two menuitemradio items). */

export type Sort = 'top' | 'az';

/** Button text (short) and menu item text (long), in menu order. */
export const SORTS: readonly { value: Sort; short: string; long: string }[] = [
  { value: 'top', short: 'Top voted', long: 'Top voted' },
  { value: 'az', short: 'A–Z', long: 'A–Z by street' },
];

export const sortIndex = (s: Sort) => SORTS.findIndex((o) => o.value === s);
export const sortShort = (s: Sort) => SORTS[sortIndex(s)].short;

export interface MenuState {
  open: boolean;
  /** The item that holds focus while the menu is open. */
  active: number;
}

export const CLOSED: MenuState = { open: false, active: 0 };

/** What a key or click does. `focus` says where focus goes after a close ('button' returns it to the trigger). */
export type MenuEffect =
  | { kind: 'none' }
  | { kind: 'state'; state: MenuState }
  | { kind: 'select'; value: Sort }
  | { kind: 'close'; focus: 'button' | 'none' };

/** A click on the trigger toggles the menu; it opens on the current sort. */
export function onButtonClick(state: MenuState, current: Sort): MenuState {
  return state.open ? CLOSED : { open: true, active: sortIndex(current) };
}

/** Keys on the closed trigger: Down/Enter/Space open on the current sort, Up opens on the last item. */
export function onButtonKey(key: string, current: Sort): MenuEffect {
  switch (key) {
    case 'ArrowDown':
    case 'Enter':
    case ' ':
      return { kind: 'state', state: { open: true, active: sortIndex(current) } };
    case 'ArrowUp':
      return { kind: 'state', state: { open: true, active: SORTS.length - 1 } };
    default:
      return { kind: 'none' };
  }
}

/** Keys inside the open menu: arrows wrap, Home/End jump, Enter/Space pick, Escape closes to the trigger, Tab closes. */
export function onMenuKey(key: string, state: MenuState): MenuEffect {
  const n = SORTS.length;
  switch (key) {
    case 'ArrowDown':
      return { kind: 'state', state: { open: true, active: (state.active + 1) % n } };
    case 'ArrowUp':
      return { kind: 'state', state: { open: true, active: (state.active - 1 + n) % n } };
    case 'Home':
      return { kind: 'state', state: { open: true, active: 0 } };
    case 'End':
      return { kind: 'state', state: { open: true, active: n - 1 } };
    case 'Enter':
    case ' ':
      return { kind: 'select', value: SORTS[state.active].value };
    case 'Escape':
      return { kind: 'close', focus: 'button' };
    case 'Tab':
      return { kind: 'close', focus: 'none' };
    default:
      return { kind: 'none' };
  }
}
