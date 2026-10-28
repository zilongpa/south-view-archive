import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { ProfileReceipt } from '@/components/profile-receipt';
export const metadata: Metadata = {
  title: 'My profile submissions',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function MyContributionsPage() {
  return (
    <CommunityShell
      title="Your profile submissions."
      description="Follow complete profiles you have proposed to the archive."
    >
      <ProfileReceipt />
    </CommunityShell>
  );
}
