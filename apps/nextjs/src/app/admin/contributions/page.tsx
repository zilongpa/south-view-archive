import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { ProfileReview } from '@/components/profile-review';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Profile review',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function ContributionReviewPage() {
  return (
    <CommunityShell title="Profile review" hideIntro>
      <ProfileReview />
    </CommunityShell>
  );
}
