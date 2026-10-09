import { SITE_URL } from '@/lib/share/urls';

/** Public source code. Also the place to ask for a house to be removed (see the About page). */
export const REPO_URL = 'https://github.com/elevityx/truckeelights';
export const REMOVE_HOUSE_URL = `${REPO_URL}/issues/new?template=remove-house.yml`;

export const SITE_NAME = 'Truckee Lights';
export const SITE_DESCRIPTION =
  'A free community map of Halloween houses and Christmas lights in Truckee, CA. Plan a trick-or-treat route or a holiday light tour, and add your house in seconds.';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonLd = { [k: string]: Json };

const ORG_ID = `${SITE_URL}/#org`;
const SITE_ID = `${SITE_URL}/#website`;

/** Site-wide graph: the website and the community project behind it. No SearchAction: the site has no search URL. */
export function siteGraph(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': SITE_ID,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        alternateName: ['Truckee Frights', 'truckeelights.com'],
        description: SITE_DESCRIPTION,
        inLanguage: 'en-US',
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: SITE_NAME,
        alternateName: 'Truckee Frights',
        url: `${SITE_URL}/`,
        description: 'A volunteer, open-source community project in Truckee, California.',
        areaServed: { '@type': 'City', name: 'Truckee', containedInPlace: { '@type': 'State', name: 'California' } },
        sameAs: [REPO_URL],
      },
    ],
  };
}

export interface Faq {
  q: string;
  a: string;
}

/** FAQPage built from the exact questions and answers the About page renders, so the markup always matches the page. */
export function faqPage(faqs: readonly Faq[], url: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url,
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/**
 * Serialize for a `<script type="application/ld+json">`. The input is constant, typed data (never user data), and `<`
 * is escaped anyway so no string can close the script element.
 */
export function jsonLdString(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
