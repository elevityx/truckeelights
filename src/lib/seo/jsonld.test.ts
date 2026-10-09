import { describe, expect, it } from 'vitest';
import { ABOUT_FAQ, faqForSchema } from '@/components/about/faq';
import { faqPage, jsonLdString, siteGraph } from './jsonld';

describe('jsonLdString', () => {
  it('round-trips as JSON and escapes < so a string cannot close the script tag', () => {
    const out = jsonLdString({ '@context': 'https://schema.org', name: '</script><b>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ '@context': 'https://schema.org', name: '</script><b>' });
  });
});

describe('siteGraph', () => {
  it('describes the website and the project, with no SearchAction (the site has no search URL)', () => {
    const g = JSON.parse(jsonLdString(siteGraph()));
    const types = g['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toEqual(['WebSite', 'Organization']);
    expect(JSON.stringify(g)).not.toContain('SearchAction');
    expect(g['@graph'][0].url).toBe('https://truckeelights.com/');
    expect(g['@graph'][0].publisher['@id']).toBe(g['@graph'][1]['@id']);
  });
});

describe('About FAQ markup', () => {
  it('has one Question per FAQ entry, with the same question text the page renders', () => {
    const page = JSON.parse(jsonLdString(faqPage(faqForSchema(), 'https://truckeelights.com/about/')));
    expect(page['@type']).toBe('FAQPage');
    expect(page.mainEntity).toHaveLength(ABOUT_FAQ.length);
    page.mainEntity.forEach((q: { name: string; acceptedAnswer: { text: string } }, i: number) => {
      expect(q.name).toBe(ABOUT_FAQ[i].q);
      expect(q.acceptedAnswer.text.startsWith(ABOUT_FAQ[i].a)).toBe(true);
    });
  });

  it('links removal requests to the repo issue template that exists', () => {
    const removal = ABOUT_FAQ.find((f) => f.q.includes('remove'));
    expect(removal?.link?.href).toBe('https://github.com/elevityx/truckeelights/issues/new?template=remove-house.yml');
  });
});
