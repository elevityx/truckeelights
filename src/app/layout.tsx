import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Next, Creepster, Fraunces } from 'next/font/google';
import JsonLd from '@/components/about/JsonLd';
import { SITE_DESCRIPTION, siteGraph } from '@/lib/seo/jsonld';
import { BOOT_SCRIPT } from '@/lib/theme/boot';
import './globals.css';

const creepster = Creepster({ weight: '400', subsets: ['latin'], variable: '--font-creepster', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
  // Christmas-only display font, about 270 KB: don't preload it on every visit. It still loads (and swaps in) when the
  // Christmas theme uses it.
  preload: false,
});
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--font-atkinson', display: 'swap' });

const SHARE_TITLE = 'Truckee Frights · Truckee Lights';
const SHARE_DESCRIPTION = 'The community map of decorated houses in Truckee, CA. Find the spookiest (and brightest) houses in town, and add yours.';

export const metadata: Metadata = {
  metadataBase: new URL('https://truckeelights.com'),
  alternates: { canonical: '/' },
  title: 'Truckee Halloween Houses & Christmas Lights Map | Truckee Lights',
  description: SITE_DESCRIPTION,
  icons: '/favicon.ico',
  // Static export: one site-wide card. `?house=` links share it too (no per-house OG without a server).
  // public/og/christmas.png is the matching card for the Christmas season; swap the path when the season flips.
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Truckee Lights',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [{ url: '/og/halloween.png', width: 1200, height: 630, alt: 'Truckee Frights: a spooky house map of Truckee, CA' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: ['/og/halloween.png'],
  },
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
        <JsonLd data={siteGraph()} />
      </head>
      <body>{children}</body>
    </html>
  );
}
