import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckGlyph, PageShell } from '@/components/subscribe/parts';
import '@/components/subscribe/subscribe.css';

export const metadata: Metadata = { title: 'You’re subscribed | Truckee Lights', robots: { index: false, follow: false } };

/** Where a confirmed sign-in link lands when the account box was unchecked (B9 `next=/subscribed/`). */
export default function SubscribedPage() {
  return (
    <PageShell>
      <section className="sb-card big">
        <div className="sb-done">
          <span className="ic">
            <CheckGlyph />
          </span>
          <h3>You’re subscribed</h3>
          <p>We’ll email you about new houses and events. You don’t need to sign in: every email has links to change or stop it.</p>
        </div>
        <Link className="btn primary" href="/">
          See the map
        </Link>
      </section>
      <p className="sb-fine">
        <Link href="/privacy/">What we keep and why</Link>
      </p>
    </PageShell>
  );
}
