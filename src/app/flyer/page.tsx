import type { Metadata } from 'next';
import Flyer from '@/components/flyer/Flyer';
import { qrPath } from '@/lib/share/qr';
import { SITE_URL } from '@/lib/share/urls';

export const metadata: Metadata = {
  title: 'Print a flyer · Truckee Lights',
  robots: { index: false, follow: false },
  alternates: { canonical: '/flyer/' },
};

// Server component: the QR is computed once during `next build` and shipped as static SVG path data (no runtime library, no network).
const QR = qrPath(SITE_URL);

export default function FlyerPage() {
  return <Flyer qr={QR} url={SITE_URL} />;
}
