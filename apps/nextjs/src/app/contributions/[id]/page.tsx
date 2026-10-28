import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { resolveLegacyContribution } from '@southview/db/profiles';
import { safeArchiveReturn } from '@/lib/stories-state';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Person profile' };

/** Old story URLs remain usable after their text becomes part of the person profile. */
export default async function ContributionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const target = await resolveLegacyContribution(id);
  if (!target) notFound();
  const from = safeArchiveReturn(query.from);
  redirect(`/people/${encodeURIComponent(target.personId)}?from=${encodeURIComponent(from)}`);
}
