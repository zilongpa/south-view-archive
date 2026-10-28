import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublishedProfile } from '@southview/db/profiles';
import { profilePlainText } from '@southview/validators';
import { PersonArchive } from '../../../components/person-archive';

const readProfile = cache(getPublishedProfile);
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function siteOrigin() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    /* The local demo still has a usable canonical URL. */
  }
  return 'http://localhost:3000';
}

function safeReturnPath(value: string | string[] | undefined, id: string) {
  const fallback = `/explore?person=${encodeURIComponent(id)}`;
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  try {
    const url = new URL(value, 'https://archive.invalid');
    if (
      url.origin !== 'https://archive.invalid' ||
      !['/explore', '/stories'].includes(url.pathname)
    )
      return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const publication = await readProfile(id);
  const person = publication?.profile;
  if (!person) return { title: 'Record not found', robots: { index: false } };
  const canonical = `${siteOrigin()}/people/${encodeURIComponent(id)}`;
  return {
    title: person.name,
    description: profilePlainText(person.bodyMarkdown).slice(0, 200),
    alternates: { canonical },
    openGraph: {
      title: `${person.name} | South-View`,
      description: profilePlainText(person.bodyMarkdown).slice(0, 200),
      url: canonical,
      type: 'article',
    },
  };
}

export default async function PersonPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const publication = await readProfile(id);
  if (!publication) notFound();
  return (
    <PersonArchive
      publication={publication}
      returnTo={safeReturnPath(query.from, publication.id)}
      canonicalUrl={`${siteOrigin()}/people/${encodeURIComponent(publication.id)}`}
    />
  );
}
