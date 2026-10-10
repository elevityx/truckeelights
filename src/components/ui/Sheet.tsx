'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { captureFocus } from './focusRestore';

interface Props {
  label: string;
  onClose(): void;
  children: ReactNode;
  /** Phones: a tall sheet (top at 12dvh) so a text field near its top stays above the on-screen keyboard. */
  tall?: boolean;
  /** Keep Tab and Shift+Tab inside the sheet (the route panel). */
  trap?: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet below 760px, 400px right panel at 760px and up, with a scrim on mobile.
 * Escape closes it; the first heading takes focus on open.
 */
export default function Sheet({ label, onClose, children, tall = false, trap = false }: Props) {
  const ref = useRef<HTMLElement>(null);
  // Keep the latest onClose without re-running the focus effect when a parent passes an inline closure.
  const onCloseRef = useRef(onClose);
  const trapRef = useRef(trap);
  useEffect(() => {
    onCloseRef.current = onClose;
    trapRef.current = trap;
  });

  useEffect(() => {
    const restoreFocus = captureFocus(document);
    const heading = ref.current?.querySelector<HTMLElement>('h1,h2,h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key !== 'Tab' || !trapRef.current || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === ref.current.querySelector('h1,h2,h3'))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreFocus();
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 min-[760px]:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        role="dialog"
        aria-label={label}
        className={`fixed z-50 overflow-y-auto overscroll-contain bg-[var(--panel,#17121f)] text-[var(--text,#f3eefa)] shadow-2xl inset-x-0 bottom-0 ${tall ? 'top-[12dvh]' : 'max-h-[85dvh]'} rounded-t-2xl p-4 min-[760px]:inset-x-auto min-[760px]:top-0 min-[760px]:right-0 min-[760px]:bottom-0 min-[760px]:max-h-none min-[760px]:w-[400px] min-[760px]:rounded-none`}
      >
        {children}
      </aside>
    </>
  );
}
