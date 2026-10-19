import type { Metadata } from 'next';
import { getArchive } from '@southview/db';
import { Suspense } from 'react';
import { SiteNavigation } from '@/components/site-navigation';
import { ReviewDesk } from '@/components/review-desk';
import '@/components/community.css';
import '@/components/review-desk.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Contribution review desk',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function ContributionReviewPage() {
  const archive = await getArchive();
  return (
    <div className="review-page">
      <SiteNavigation workspace />
      <main id="main-content" className="review-main">
        <Suspense fallback={<p className="review-access">Opening the review desk…</p>}>
          <ReviewDesk archive={archive} />
        </Suspense>
      </main>
    </div>
  );
}
