'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MenuIcon } from './parts';
import './subscribe.css';

/** The header's menu (shown only while `subscribe.open`): Subscribe, My account, Privacy. */
export default function HeaderMenu({ onSubscribe }: { onSubscribe(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('.hmenu-pop > *')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="hmenu" ref={ref}>
      <button
        ref={btn}
        type="button"
        className="iconbtn"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="hmenu-pop"
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon />
      </button>
      {open && (
        <nav className="hmenu-pop" id="hmenu-pop" aria-label="Menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSubscribe();
            }}
          >
            <span>
              Subscribe<span className="hmenu-new">New</span>
            </span>
            <small>New houses and events by email</small>
          </button>
          <Link href="/account/">
            <span>My account</span>
            <small>Your house and your emails</small>
          </Link>
          <Link href="/privacy/">
            <span>Privacy</span>
            <small>What we keep and why</small>
          </Link>
        </nav>
      )}
    </div>
  );
}
