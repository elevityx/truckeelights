'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CLOSED, SORTS, onButtonClick, onButtonKey, onMenuKey, sortShort, type MenuEffect, type MenuState, type Sort } from './sortMenu.logic';

interface Props {
  sort: Sort;
  onChange(s: Sort): void;
  /** Extra class for placement (the narrow control row or the wide houses heading). */
  className?: string;
}

function SortIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 5h14M5 10h10M7.5 15h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** One compact button that shows the current sort; it opens a two-item menu. Closes on pick, Escape, Tab or a tap outside. */
export default function SortMenu({ sort, onChange, className }: Props) {
  const [state, setState] = useState<MenuState>(CLOSED);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const menuId = `${id}-menu`;

  useEffect(() => {
    if (state.open) items.current[state.active]?.focus();
  }, [state]);

  useEffect(() => {
    if (!state.open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setState(CLOSED);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [state.open]);

  const pick = (s: Sort) => {
    if (s !== sort) onChange(s);
    setState(CLOSED);
    button.current?.focus();
  };

  const apply = (fx: MenuEffect, e: KeyboardEvent) => {
    if (fx.kind === 'none') return;
    if (fx.kind !== 'close' || fx.focus === 'button') e.preventDefault();
    if (fx.kind === 'state') setState(fx.state);
    else if (fx.kind === 'select') pick(fx.value);
    else {
      setState(CLOSED);
      if (fx.focus === 'button') button.current?.focus();
    }
  };

  return (
    <div ref={root} className={`sortmenu${className ? ` ${className}` : ''}`}>
      <button
        ref={button}
        type="button"
        className="sortbtn"
        aria-haspopup="menu"
        aria-expanded={state.open}
        aria-controls={state.open ? menuId : undefined}
        aria-label={`Sort houses: ${sortShort(sort)}`}
        onClick={() => setState((s) => onButtonClick(s, sort))}
        onKeyDown={(e) => {
          if (!state.open) apply(onButtonKey(e.key, sort), e);
        }}
      >
        <SortIcon />
        <span className="sl">{sortShort(sort)}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {state.open && (
        <div id={menuId} className="sortpop" role="menu" aria-label="Sort houses" onKeyDown={(e) => apply(onMenuKey(e.key, state), e)}>
          {SORTS.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === sort}
              tabIndex={i === state.active ? 0 : -1}
              onClick={() => pick(o.value)}
            >
              <span className="ck" aria-hidden="true">
                {o.value === sort ? '✓' : ''}
              </span>
              {o.long}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
