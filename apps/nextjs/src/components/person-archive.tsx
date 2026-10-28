import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import type { PublishedProfile } from '@southview/validators';
import { SiteNavigation } from './site-navigation';
import { ProfileView } from './profile-view';
import './community.css';

export function PersonArchive({
  publication,
  returnTo,
  canonicalUrl,
}: {
  publication: PublishedProfile;
  returnTo: string;
  canonicalUrl: string;
}) {
  return (
    <div className="archive-page">
      <SiteNavigation personId={publication.id} />
      <main id="main-content">
        <div className="archive-topbar">
          <Link className="archive-back" href={returnTo}>
            <ArrowLeft size={18} aria-hidden="true" />
            {returnTo.startsWith('/stories') ? 'Back to stories' : 'Back to the map'}
          </Link>
          <a className="archive-permalink" href={canonicalUrl}>
            <ExternalLink size={16} aria-hidden="true" /> Permanent link
          </a>
        </div>
        <article className="archive-profile-record">
          <p className="archive-eyebrow">Lives remembered · Person profile</p>
          <ProfileView
            profile={publication.profile}
            personId={publication.id}
            publicCredit={publication.publicCredit}
          />
          <div className="archive-profile-edit">
            <div>
              <h2>Help tell this story.</h2>
              <p>Propose changes to this profile, its sources, or its connected places.</p>
            </div>
            <Link
              className="community-primary"
              href={`/contribute?person=${encodeURIComponent(publication.id)}`}
            >
              Edit this profile <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
