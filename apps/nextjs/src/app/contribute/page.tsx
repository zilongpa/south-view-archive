import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { CommunityShell } from '@/components/community-shell';
import { ContributionForm } from '@/components/contribution-form';
import { PersonJump } from '@/components/person-jump';
import { copy } from '@/lib/copy';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: copy.share,
  description:
    'Add to a person already in the South-View archive from their own page, or introduce someone who is not in it yet.',
};
export default async function ContributePage() {
  const data = await getArchive();
  const people = data.people.map(({ id, name, aliases, birthYear, deathYear }) => ({
    id,
    name,
    aliases,
    birthYear,
    deathYear,
  }));
  return (
    <CommunityShell
      title={copy.share}
      description="Everything about a person who is already in the archive is added on their own page. Use the form below only to remember someone who is not here yet. Reviewers read every story before it is published, and nothing is sent by email."
    >
      <PersonJump people={people} />
      <div className="community-section-heading" style={{ marginTop: 10 }}>
        <h2>{copy.addPerson}</h2>
      </div>
      <ContributionForm
        people={people}
        places={data.places.map(({ id, name, scope }) => ({ id, name, scope }))}
      />
    </CommunityShell>
  );
}
