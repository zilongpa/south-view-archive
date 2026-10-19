'use client';
import { SiteNavigation } from '@/components/site-navigation';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <>
      <SiteNavigation />
      <main id="main-content" className="page-message">
        <p className="eyebrow">SOUTH-VIEW</p>
        <h1>The archive is temporarily unavailable.</h1>
        <p>
          We could not load the collection. Your view has not been replaced with demonstration data.
        </p>
        <button className="archive-button" onClick={reset}>
          Try again
        </button>
      </main>
    </>
  );
}
