'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  label: string;
  onClose(): void;
  children: ReactNode;
}

/**
 * Bottom sheet below 760px, 400px right panel at 760px and up, with a scrim on mobile.
 * Escape closes it; the first heading takes focus on open.
 */
export default function Sheet({ label, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  // Keep the latest onClose without re-running the focus effect when a parent passes an inline closure.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const heading = ref.current?.querySelector<HTMLElement>('h1,h2,h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
        className="fixed z-50 overflow-y-auto bg-[var(--panel,#17121f)] text-[var(--text,#f3eefa)] shadow-2xl inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl p-4 min-[760px]:inset-x-auto min-[760px]:top-0 min-[760px]:right-0 min-[760px]:bottom-0 min-[760px]:max-h-none min-[760px]:w-[400px] min-[760px]:rounded-none"
      >
        {children}
      </aside>
    </>
  );
}
