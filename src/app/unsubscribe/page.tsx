import type { Metadata } from 'next';
import UnsubscribeApp from '@/components/subscribe/UnsubscribeApp';

export const metadata: Metadata = { title: 'Email settings | Truckee Lights', robots: { index: false, follow: false } };

// Static shell; opening it never changes anything (Stop emails is a POST from the button).
export default function UnsubscribePage() {
  return <UnsubscribeApp />;
}
