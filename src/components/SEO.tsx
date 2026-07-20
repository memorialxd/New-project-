import { Helmet } from 'react-helmet-async';

const SITE = 'https://freshdelivery.app';

interface SEOProps {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article' | 'product';
  image?: string;
  jsonLd?: Record<string, any> | Record<string, any>[];
  noindex?: boolean;
}

/**
 * Per-route head metadata. Drop into the top of any page component to
 * give it a unique title/description/canonical and matching OpenGraph tags.
 */
export function SEO({ title, description, path, type = 'website', image, jsonLd, noindex }: SEOProps) {
  const url = `${SITE}${path}`;
  const t = title.length > 60 ? title.slice(0, 57) + '…' : title;
  const d =
    description.length > 160
      ? description.slice(0, 157) + '…'
      : description.length < 50
        ? description + ' Παραγγείλτε φαγητό online στο Fresh Delivery.'.slice(0, 160 - description.length)
        : description;
  const schemas = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{t}</title>
      <meta name="description" content={d} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      <meta property="og:title" content={t} />
      <meta property="og:description" content={d} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      {image && <meta property="og:image" content={image} />}

      <meta name="twitter:title" content={t} />
      <meta name="twitter:description" content={d} />
      {image && <meta name="twitter:image" content={image} />}

      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(s)}</script>
      ))}
    </Helmet>
  );
}
