import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/subscribe/parts';
import '@/components/subscribe/subscribe.css';

const TITLE = 'Privacy | Truckee Lights';
const DESCRIPTION = 'What the Truckee Lights community map stores, why, who processes it, how long it is kept, and how to delete it.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/privacy/' },
  openGraph: { type: 'website', url: '/privacy/', siteName: 'Truckee Lights', title: TITLE, description: DESCRIPTION },
};

// Static server component (spec §8). Keep it in plain words and in step with what the code really stores.
export default function PrivacyPage() {
  return (
    <PageShell>
      <h1>Privacy</h1>
      <p className="sb-lede">Truckee Lights is a free, open-source community map. We keep as little as we can.</p>
      <div className="sb-prose">
        <h2>Without an account</h2>
        <p>
          You can browse, add a house, vote and upload photos without giving us your name or email. Your browser gets an
          anonymous session after a bot check, so we can limit how often one device adds or votes.
        </p>
        <ul>
          <li>Houses you add (address and map pin) are public once added. Photos are public only after an admin approves them.</li>
          <li>
            To stop vote flooding, we may keep a salted hash of part of your network address for one day. We never store your IP
            address itself, and the daily salt is destroyed, so old hashes can’t be linked back.
          </li>
        </ul>

        <h2>When you subscribe or create an account</h2>
        <ul>
          <li>Your email address, which only our sign-in system and outgoing emails use. It is never shown on the map or to admins in full.</li>
          <li>What you asked for: new houses, new events, or both, and daily or weekly.</li>
          <li>Which houses you manage, and any request you send to manage or remove a house, with your note.</li>
          <li>A record of which digests were sent to your account, so we can avoid sending you the same digest twice.</li>
          <li>
            A copy of a digest email while it is being sent, so a retry after a network error sends exactly the same email instead
            of a second, different one.
          </li>
          <li>
            If you start from a device that already added a house, a one-way hash of your email (not the address itself), usable for
            one hour, so that device’s houses can move to your account once you confirm the email.
          </li>
        </ul>
        <p>
          We email only what you asked for. Every digest has a link to change or stop it, and email apps like Gmail show a one-tap
          Unsubscribe.
        </p>

        <h2>Who processes it</h2>
        <ul>
          <li>Supabase hosts the database and the sign-in system.</li>
          <li>Resend sends our emails (sign-in codes and digests).</li>
          <li>Cloudflare hosts the site and runs the Turnstile bot check.</li>
          <li>Google Maps draws the map and looks up addresses when you add a house.</li>
        </ul>
        <p>We don’t sell or share your email, and there are no ads or tracking pixels in our emails.</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>
            Your email and choices: while your account or subscription exists. If you stop emails, we keep your choices so you can
            start again.
          </li>
          <li>The email hash for linking a device’s houses: deleted within a day.</li>
          <li>The copy of a digest email being sent: deleted as soon as it is sent or fails, and if a send is never resolved, within 2 days at most (the send is then closed as failed and a later run starts a new one).</li>
          <li>Records of which digests were sent: 60 days.</li>
          <li>Requests to manage or remove a house: while they are open, then 180 days after they are decided.</li>
        </ul>
        <p>
          When you delete your account, we delete your sign-in, email, subscription, requests and digest records right away, in
          one step. Houses you managed stay on the map with no manager.
        </p>

        <h2>Delete your data</h2>
        <p>
          Sign in on <Link href="/account/">My account</Link> with your email and choose Delete my account. Replying to one of
          our emails doesn’t delete anything; the account page does it right away.
        </p>
      </div>
      <nav className="sb-foot" aria-label="More">
        <Link href="/">The map</Link>
        <span aria-hidden="true">·</span>
        <Link href="/about/">About</Link>
      </nav>
    </PageShell>
  );
}
