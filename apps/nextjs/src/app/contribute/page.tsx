import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { ProfileEditor } from '@/components/profile-editor';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Propose a person profile',
  description: 'Propose a complete, sourced person profile for the South-View community archive.',
};
export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const query = await searchParams;
  return (
    <CommunityShell
      title="Help preserve a person’s story."
      description="Edit a complete person profile, with sources and connected places. Archive reviewers check every proposal before publication."
    >
      <ProfileEditor initialPersonId={query.person} />
    </CommunityShell>
  );
}
