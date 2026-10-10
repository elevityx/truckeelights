import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/about/JsonLd';
import { ABOUT_FAQ, faqForSchema } from '@/components/about/faq';
import { REPO_URL, faqPage } from '@/lib/seo/jsonld';
import { SITE_URL } from '@/lib/share/urls';
import '@/components/about/about.css';

const TITLE = 'About Truckee Lights | Halloween & Christmas Lights Map';
const DESCRIPTION =
  'How the free community map of Halloween houses and Christmas lights in Truckee, CA works: add a house in seconds, no account, photos after review. FAQ and privacy.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about/' },
  openGraph: {
    type: 'website',
    url: '/about/',
    siteName: 'Truckee Lights',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/og/halloween.png', width: 1200, height: 630, alt: 'Truckee Frights: a spooky house map of Truckee, CA' }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og/halloween.png'] },
};

// Static server component: no data, no client JS. Season-specific bits are both rendered and toggled by
// [data-theme] in about.css, which the boot script sets before first paint.
export default function AboutPage() {
  return (
    <div className="about-page">
      <JsonLd data={faqPage(faqForSchema(), `${SITE_URL}/about/`)} />
      <header className="about-top">
        <div className="about-top-in">
          <Link className="about-wm disp" href="/" aria-label="Truckee Lights: back to the map">
            Truckee <span className="w2 s-h">Frights</span>
            <span className="w2 s-x">Lights</span>
          </Link>
          <Link className="btn primary" href="/">
            Open the map
          </Link>
        </div>
        <div className="drip s-h" aria-hidden="true" />
        <div className="lights s-x" aria-hidden="true" />
      </header>

      <main className="about-main">
        <p className="eyebrow">About · Truckee, CA</p>
        <h1>Truckee&rsquo;s community map of Halloween houses and Christmas lights</h1>
        <p className="about-lede">
          Truckee Lights is a free map of the best decorated houses in Truckee, California, added by neighbors.
          <span className="s-h">
            {' '}
            Right now it&rsquo;s <strong>Truckee Frights</strong>: find the spookiest Halloween houses and plan a trick-or-treat
            route.
          </span>
          <span className="s-x">
            {' '}
            Right now it&rsquo;s <strong>Truckee Lights</strong>: find the brightest Christmas lights and plan a holiday light tour.
          </span>
        </p>

        <section aria-labelledby="story">
          <h2 id="story">The story</h2>
          <p>
            It started in the winter of 2024 as a simple map of Christmas lights in Truckee, so families could find the
            best-lit houses without driving every street in the snow. Neighbors added a few dozen houses that first season.
          </p>
          <p>
            In 2026 it came back rebuilt, with two seasons. In the fall it&rsquo;s <strong>Truckee Frights</strong>, for
            Halloween houses, haunted yards, and trick-or-treat streets. After Halloween it becomes <strong>Truckee Lights</strong>,
            for Christmas lights and holiday light tours.
          </p>
        </section>

        <section aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="about-steps">
            <li>
              <span>
                <strong>Add a house in seconds.</strong> Tap <em>Add a house</em> and search for the address, or tap the spot on
                the map and confirm the pin. No account needed.
              </span>
            </li>
            <li>
              <span>
                <strong>Browse the map or the list.</strong> Tap a pin to see the house and its photos, then get directions.
              </span>
            </li>
            <li>
              <span>
                <strong>Share the photos.</strong> Anyone can add a few photos of a house. They appear after a quick review.
              </span>
            </li>
            <li>
              <span>
                <strong>A fresh map each season.</strong> Halloween and Christmas each start a new map, so every pin is current.
              </span>
            </li>
          </ol>
          <p>
            The map covers Truckee and nearby: Donner Lake, Tahoe Donner, Glenshire, Northstar, Serene Lakes, Tahoe City, and
            Kings Beach.
          </p>
          <p>
            <Link className="btn primary" href="/">
              Open the map
            </Link>
          </p>
        </section>

        <section aria-labelledby="faq">
          <h2 id="faq">Questions</h2>
          <div className="about-faq">
            {ABOUT_FAQ.map((f) => (
              <div key={f.q}>
                <h3>{f.q}</h3>
                <p>
                  {f.a}
                  {f.link && (
                    <>
                      {' '}
                      <a href={f.link.href} target="_blank" rel="noopener">
                        {f.link.text}
                      </a>
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>

        <p className="about-ack">Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.</p>
        <nav className="about-foot" aria-label="More">
          <Link href="/">The map</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy/">Privacy</Link>
          <span aria-hidden="true">·</span>
          <a href={REPO_URL} target="_blank" rel="noopener">
            Open source on GitHub
          </a>
        </nav>
      </main>
    </div>
  );
}
