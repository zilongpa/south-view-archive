'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProfileProposal, PublishedProfile } from '@southview/validators';
import { communityRequest, receiptFor, type CommunitySession } from '../lib/community-client';
import { profileRequest, useProfileMedia } from '../lib/profile-client';
import { CommunityNotice } from './community-shell';
import { ProfileView } from './profile-view';
import './profile.css';
const noFiles: Record<string, File> = {};
export function ProfileReceipt({ id }: { id?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [proposal, setProposal] = useState<ProfileProposal | null>(null);
  const [publication, setPublication] = useState<PublishedProfile | null>(null);
  const [items, setItems] = useState<ProfileProposal[]>([]);
  const [publications, setPublications] = useState<PublishedProfile[]>([]);
  const [token, setToken] = useState<string | undefined>();
  const [receiptUrl, setReceiptUrl] = useState('');
  const mediaUrls = useProfileMedia(
    proposal?.profile ?? publication?.profile ?? null,
    noFiles,
    token,
  );
  async function load() {
    setLoading(true);
    setError('');
    try {
      const access = await communityRequest<CommunitySession>('/session');
      setSession(access);
      if (id) {
        const receipt = receiptFor(id);
        setToken(receipt);
        if (receipt)
          setReceiptUrl(
            `${window.location.origin}/submissions/${encodeURIComponent(id)}#receipt=${encodeURIComponent(receipt)}`,
          );
        const result = await profileRequest<{
          proposal?: ProfileProposal;
          publication?: PublishedProfile;
        }>(`submissions/${encodeURIComponent(id)}`, {}, receipt);
        setProposal(result.proposal ?? null);
        setPublication(result.publication ?? null);
      } else if (access.user) {
        const result = await profileRequest<{
          proposals: ProfileProposal[];
          publications?: PublishedProfile[];
        }>('mine');
        setItems(result.proposals);
        setPublications(result.publications ?? []);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your submission could not be loaded.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  if (loading) return <p role="status">Loading your profile submissions…</p>;
  if (id)
    return (
      <div>
        {error ? (
          <CommunityNotice title="Submission unavailable" kind="error">
            <p>{error}</p>
            <p>
              A deleted proposal is no longer available. If you submitted as a guest, open the
              complete receipt link you saved.
            </p>
          </CommunityNotice>
        ) : proposal ? (
          <>
            <CommunityNotice title="Awaiting review">
              <p>
                Your complete profile proposal has been submitted. The public archive stays
                unchanged until an archive reviewer approves it.
              </p>
              <p>Public contributor credit: {proposal.publicCredit}</p>
            </CommunityNotice>
            <details className="profile-history">
              <summary>View the submitted profile</summary>
              <ProfileView
                profile={proposal.profile}
                mediaUrls={mediaUrls}
                publicCredit={proposal.publicCredit}
              />
            </details>
          </>
        ) : publication ? (
          <>
            <CommunityNotice kind="success" title="Your profile proposal was published">
              <p>The accepted profile is part of the public archive.</p>
              <Link href={`/people/${encodeURIComponent(publication.id)}`}>
                View published profile
              </Link>
            </CommunityNotice>
            <ProfileView
              profile={publication.profile}
              personId={publication.id}
              publicCredit={publication.publicCredit}
              mediaUrls={mediaUrls}
            />
          </>
        ) : (
          <CommunityNotice title="Submission unavailable">
            This proposal is no longer available. Deleted proposals and their private review
            information are not retained.
          </CommunityNotice>
        )}
        {receiptUrl && (
          <section className="community-section">
            <h2>Keep your private receipt</h2>
            <p>
              This link grants access to your submission. Save it privately; anyone with the
              complete link may view it.
            </p>
            <a className="profile-receipt-link" href={receiptUrl}>
              {receiptUrl}
            </a>
          </section>
        )}
        <div className="community-actions">
          <button className="community-secondary" type="button" onClick={() => void load()}>
            Refresh status
          </button>
          <Link className="community-secondary" href="/contribute">
            Submit another complete profile
          </Link>
          {session?.user && <Link href="/my-contributions">My profile submissions</Link>}
        </div>
      </div>
    );
  if (!session?.user)
    return (
      <CommunityNotice title="Sign in to follow your submissions">
        <p>
          Account submissions appear here. Guest submissions are available through their private
          receipt links.
        </p>
        <Link className="community-secondary" href="/sign-in?next=/my-contributions">
          Sign in
        </Link>
      </CommunityNotice>
    );
  return (
    <div>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <section className="community-section">
        <h2>Awaiting review</h2>
        {items.length ? (
          <ul className="profile-account-list">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/submissions/${encodeURIComponent(item.id)}`}>
                  <strong>{item.profile.name}</strong>
                  <span>
                    {item.personId ? 'Complete replacement' : 'New person'} · submitted{' '}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No pending profile submissions in your account.</p>
        )}
      </section>
      {publications.length > 0 && (
        <section className="community-section">
          <h2>Published</h2>
          <ul className="profile-account-list">
            {publications.map((item) => (
              <li key={`${item.id}-${item.version}`}>
                <Link href={`/people/${encodeURIComponent(item.id)}`}>
                  {item.profile.name} · version {item.version}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="community-hint">
        Deleted proposals are no longer available. To suggest a correction or add evidence, submit a
        complete replacement profile.
      </p>
      <div className="community-actions">
        <Link className="community-primary" href="/contribute">
          Propose a profile
        </Link>
        <button type="button" className="community-secondary" onClick={() => void load()}>
          Refresh submissions
        </button>
      </div>
    </div>
  );
}
