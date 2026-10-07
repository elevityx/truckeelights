import type { ReactNode } from 'react';

function Svg({ children, w = 2.2 }: { children: ReactNode; w?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
export const PinIcon = () => (
  <Svg>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg w={2.6}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const XIcon = () => (
  <Svg w={2.4}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const DirIcon = () => (
  <Svg>
    <path d="M12 2l10 10-10 10L2 12z" />
    <path d="M9 14v-3h5M12 8.5L14.5 11 12 13.5" />
  </Svg>
);
export const ShareIcon = () => (
  <Svg>
    <path d="M8 12h-2v8h12v-8h-2M12 3v12M8 7l4-4 4 4" />
  </Svg>
);
export const WarnIcon = () => (
  <Svg>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v5M12 18v.5" />
  </Svg>
);
