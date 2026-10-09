import { jsonLdString, type JsonLd as JsonLdData } from '@/lib/seo/jsonld';

/** Structured data block. Only constant, typed data reaches it (see jsonLdString), never user data. */
export default function JsonLd({ data }: { data: JsonLdData }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
