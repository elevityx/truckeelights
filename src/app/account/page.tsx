import type { Metadata } from 'next';
import AccountApp from '@/components/subscribe/AccountApp';

export const metadata: Metadata = { title: 'My account | Truckee Lights', robots: { index: false, follow: false } };

// Static shell; the client checks for a non-anonymous session, else shows sign-in by emailed code.
export default function AccountPage() {
  return <AccountApp />;
}
