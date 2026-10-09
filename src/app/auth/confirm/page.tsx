import type { Metadata } from 'next';
import ConfirmApp from '@/components/subscribe/ConfirmApp';

export const metadata: Metadata = { title: 'Confirm your email | Truckee Lights', robots: { index: false, follow: false } };

// Static shell; the client reads token_hash/type/next and verifies only when the person taps Confirm.
export default function ConfirmPage() {
  return <ConfirmApp />;
}
