'use client';

import Link from 'next/link';
import './subscribe.css';

/** On the add-house success card, for an anonymous visitor (spec §6). Opens Subscribe with the account box checked. */
export function AccountNudge({ onCreate, onDismiss }: { onCreate(): void; onDismiss(): void }) {
  return (
    <div className="sb-nudge">
      <b>Want to manage this house later?</b>
      <p>
        Create a free account. You can see its votes, hide it for a while, or ask us to take it down. Without one, this house
        stays tied to this browser only.
      </p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onCreate}>
          Create a free account
        </button>
        <button type="button" className="btn ghost" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** The list's last card: Subscribe and a Privacy link. */
export function ListSubscribeFooter({ onSubscribe }: { onSubscribe(): void }) {
  return (
    <div className="sb-lfoot">
      <p>Get new houses and events by email.</p>
      <button type="button" className="linkbtn" onClick={onSubscribe}>
        Subscribe
      </button>
      <p className="fine">
        Daily or weekly. Unsubscribe anytime. <Link href="/privacy/">Privacy</Link>
      </p>
    </div>
  );
}
