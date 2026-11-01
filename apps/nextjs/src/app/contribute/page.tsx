import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { CommunityShell } from '@/components/community-shell';
import { ContributionForm } from '@/components/contribution-form';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Share a story',
  description:
    'Contribute a memory, photograph, correction, or a new person to the South-View community archive.',
};
export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const [data, query] = await Promise.all([getArchive(), searchParams]);
  const initialPersonId = data.people.some((person) => person.id === query.person)
    ? query.person
    : undefined;
  return (
    <CommunityShell
      title="What will you help us remember?"
      description="Share a memory, a photograph, or a piece of history. Every contribution is reviewed by archive reviewers before it joins the public archive."
    >
      <ContributionForm
        people={data.people.map(({ id, name, aliases, birthYear, deathYear }) => ({
          id,
          name,
          aliases,
          birthYear,
          deathYear,
        }))}
        places={data.places.map(({ id, name, scope }) => ({ id, name, scope }))}
        initialPersonId={initialPersonId}
      />
    </CommunityShell>
  );
}
