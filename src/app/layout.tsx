import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Next, Creepster, Fraunces } from 'next/font/google';
import { BOOT_SCRIPT } from '@/lib/theme/boot';
import './globals.css';

const creepster = Creepster({ weight: '400', subsets: ['latin'], variable: '--font-creepster', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
});
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--font-atkinson', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://truckeelights.com'),
  alternates: { canonical: '/' },
  title: 'Truckee Lights · Truckee Frights',
  description: 'A community map of decorated houses in Truckee, CA. Halloween and Christmas.',
  icons: '/favicon.ico',
};

// resizes-content: Android Chrome shrinks the layout (and dvh) for the keyboard, so bottom sheets stay above it.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#140A1F', interactiveWidget: 'resizes-content' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="halloween"
      className={`${creepster.variable} ${fraunces.variable} ${atkinson.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
