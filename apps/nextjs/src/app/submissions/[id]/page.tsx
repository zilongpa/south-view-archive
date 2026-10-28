import type { Metadata } from 'next';
import { CommunityShell } from '@/components/community-shell';
import { ProfileReceipt } from '@/components/profile-receipt';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your profile submission',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CommunityShell
      title="Your profile submission."
      description="Follow your complete profile proposal from submission to publication."
    >
      <ProfileReceipt id={id} />
    </CommunityShell>
  );
}
