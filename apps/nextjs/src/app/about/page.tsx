import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNavigation } from '@/components/site-navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { copy } from '@/lib/copy';

export const metadata: Metadata = {
  title: 'About the archive',
  description:
    'How to read the records, sources, oral histories, and map positions in the South-View public archive demo.',
};

export default function AboutPage() {
  return (
    <div className="archive-page">
      <SiteNavigation />
      <main id="main-content" className="archive-about">
        <Link className="archive-back" href="/explore">
          <ArrowLeft size={18} aria-hidden="true" /> Back to the map
        </Link>
        <p className="archive-eyebrow">About this edition</p>
        <h1 className="archive-title">Every place holds a story.</h1>
        <p className="archive-summary">
          Explore the lives connected to South-View, and the Atlanta places that help tell their
          stories. This demonstration connects a small, sourced collection of person records,
          places, and archival materials.
        </p>

        <section className="archive-section">
          <h2>Read the story. Follow its sources.</h2>
          <p>
            Numbered citations appear beside factual summaries and place relationships. They link to
            a source list with the original collection, publication details, and access date. A
            source that documents a person’s burial does not, by itself, establish an exact grave
            position.
          </p>
          <p>
            Oral histories are identified as spoken accounts, with narrator, interviewer, and
            recording date when available. They remain valuable historical perspectives in their own
            right. Collection links open at the holding institution; audio and images are not
            reproduced without verified use conditions.
          </p>
        </section>

        <section className="archive-section">
          <h2>A map position has a level of certainty.</h2>
          <p>
            <strong>Reference positions</strong> come from the earlier project and have not been
            independently checked on site. <strong>Address positions</strong> identify an
            approximate building or address location. A <strong>verified position</strong> requires
            explicit supporting location evidence. <strong>Not yet mapped</strong> means the
            relationship can be read, but no supported map position is available.
          </p>
          <p>
            Position notes and their citations are separate from biographical evidence. The map is
            for exploring history and does not provide step-by-step cemetery navigation. When
            accounts conflict, uncertain details are withheld and an editorial note explains the
            gap.
          </p>
        </section>

        <section className="archive-section">
          <h2>An archive that can keep growing.</h2>
          <p>
            This edition is a public browsing prototype, built on the earlier{' '}
            <a
              className="archive-text-link"
              href="https://github.com/taologan/SVCMAP"
              target="_blank"
              rel="noopener noreferrer"
            >
              SVCMAP project <ArrowUpRight size={16} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            . It is not an exhaustive account of South-View or a replacement for the cemetery’s
            records.
          </p>
          <p>
            You can share a memory, photograph, source, correction, or a proposed person record
            without an account. Every submission is reviewed before publication. Your contact name
            and email stay private; choose a public name or an anonymous credit. Optional email
            sign-in lets you manage your contributions.
          </p>
          <p>
            Each entry names its provider separately from the original author, narrator, and holding
            institution. Initial records are credited to “Initial archive compilation.” Community
            memories remain personal accounts even after review, and can be cited through their
            permanent links.
          </p>
          <Link className="archive-text-link" href="/contribute">
            {copy.share} <ArrowUpRight size={17} />
          </Link>
        </section>
        <Link className="archive-button" href="/explore">
          Explore the archive <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </main>
      <footer className="archive-footer">
        <span>South-View · History in the Neighborhood</span>
        <Link href="/explore">Explore the map</Link>
      </footer>
    </div>
  );
}
