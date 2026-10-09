import { REMOVE_HOUSE_URL, REPO_URL, type Faq } from '@/lib/seo/jsonld';

export interface AboutFaq {
  q: string;
  a: string;
  /** Optional link shown right after the answer. */
  link?: { text: string; href: string };
}

/** The About page FAQ. Keep answers true to what the site does today (see docs/ARCHITECTURE.md). */
export const ABOUT_FAQ: readonly AboutFaq[] = [
  {
    q: 'Is Truckee Lights free?',
    a: 'Yes. The map is free to use and free to add to. It is a volunteer community project with no ads.',
  },
  {
    q: 'Do I need an account to add a house?',
    a: 'No. There is no sign-up, and we never ask for your name, email, or phone number. A quick, automatic bot check keeps spam out.',
  },
  {
    q: 'Which houses can I add?',
    a: 'Any decorated house in the Truckee area, including Donner Lake, Tahoe Donner, Glenshire, Northstar, Serene Lakes, Tahoe City, and Kings Beach. It can be your own house or one you enjoyed driving past. Each address appears once per season.',
  },
  {
    q: 'When do the Halloween and Christmas maps run?',
    a: 'In the fall the site is Truckee Frights, a map of Halloween houses for trick-or-treating. After Halloween it becomes Truckee Lights, a map of Christmas lights for a holiday light tour. Each season starts a fresh map.',
  },
  {
    q: 'How do photos work?',
    a: 'Anyone can add a few photos of a house on the map. Photos stay hidden until a volunteer reviews them, and location data is removed from each photo before it is stored.',
  },
  {
    q: 'How do I remove my house from the map?',
    a: 'Open a short removal request on GitHub with the street address and we will take it down. You only need a free GitHub account. Please do not include your name or other personal details.',
    link: { text: 'Request a removal', href: REMOVE_HOUSE_URL },
  },
  {
    q: 'What data does the site keep?',
    a: 'The map stores the street address and map location of each house, and any photos that pass review. Your browser gets an anonymous session so we can limit spam, and it remembers the last season you saw so the colors load right. There are no ads and no tracking or analytics scripts. The map itself is provided by Google Maps.',
  },
  {
    q: 'Who runs it, and can I help?',
    a: 'Truckee Lights is run by volunteers in Truckee, and the code is open source under the MIT license. Bug reports, ideas, and pull requests are welcome.',
    link: { text: 'See the code on GitHub', href: REPO_URL },
  },
];

/** The FAQ as plain question/answer text for FAQPage markup, matching what the page renders. */
export function faqForSchema(faqs: readonly AboutFaq[] = ABOUT_FAQ): Faq[] {
  return faqs.map((f) => ({ q: f.q, a: f.link ? `${f.a} ${f.link.text}: ${f.link.href}` : f.a }));
}
