import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Truckee Lights',
  description: 'A community map of decorated houses in Truckee, CA.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="halloween">
      <body>{children}</body>
    </html>
  );
}
