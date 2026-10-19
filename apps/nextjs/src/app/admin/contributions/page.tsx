import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { CommunityShell } from '@/components/community-shell';
import { ReviewDesk } from '@/components/review-desk';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Contribution review desk',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function ContributionReviewPage() {
  const archive = await getArchive();
  return (
    <CommunityShell
      eyebrow="ARCHIVE REVIEW"
      title="A thoughtful place for every story."
      description="Review contributions with their original context, clear attribution, and room for a conversation."
    >
      <ReviewDesk archive={archive} />
    </CommunityShell>
  );
}
